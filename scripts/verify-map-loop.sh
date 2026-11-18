#!/usr/bin/env bash
# Finds and fixes what a visitor would see broken on the map: scripts/verify-map.ts (code checks and one Opus judge),
# then headless Claude fixes the findings, then typecheck and tests, a commit, and the next round. At most ROUNDS (5).
# Never deploys and never pushes: it runs on a worktree branch, and Joel gets the result as a queue item.
#   herdr worktree create --cwd . --branch map-fix --base origin/main   # then, in that worktree:
#   npm run verify:map:loop
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(git branch --show-current)" == main ]]; then
  echo "Not on main: the loop commits its fixes. Make a worktree first: herdr worktree create --cwd . --branch map-fix --base origin/main" >&2
  exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Commit or stash your changes first: each round commits only its own fixes." >&2
  exit 1
fi
rounds=${ROUNDS:-5}
run=test-results/verify/loop-$(date +%Y%m%d-%H%M%S)
for i in $(seq 1 "$rounds"); do
  out=$run/round-$i
  if npx tsx scripts/verify-map.ts --judge --out "$out"; then
    echo "Clean after $((i - 1)) round(s) of fixes. Report: $out/report.json"
    status=clean
    break
  fi
  status=failing
  [[ $i == "$rounds" ]] && break
  claude -p --model opus --permission-mode acceptEdits \
    --allowedTools "Read,Edit,Write,Grep,Glob,Bash(npm run typecheck),Bash(npm test),Bash(npx vite build -c vite.map.config.ts)" \
    "Fix what $out/report.json found on Seated's public map (src/map). The screenshots are beside it; read the ones you fix.
Follow CLAUDE.md (map design language, hard rules). Surgical changes, the codebase's style, no new dependencies.
Fix only clear bugs: overlaps, cut-off text, things off the screen, a lost link, errors. A finding that needs a design
decision (what art to draw where, a new feature, a change of look) is not yours: list it under 'Needs Joel' in
$out/fixes.md and leave the code. Never edit sezlab's images (src/map/public/sez), never deploy, never run git.
After your changes run npm run typecheck and npm test; both must pass. Write $out/fixes.md: per finding, fixed (file and
what) or left (why)." || echo "Round $i: Claude stopped with an error; the next round checks what it left." >&2
  npm run typecheck && npm test
  git add -A src scripts e2e test docs
  if git diff --cached --quiet; then
    echo "Round $i changed nothing: what is left needs a decision (see $out/fixes.md)."
    break
  fi
  git commit -qm "Map: verify-map round $i fixes (scripts/verify-map-loop.sh)"
done
failing=$(node -p "require('./$out/report.json').failing")
echo "Done: $status, $failing failing finding(s) left. Reports: $run"
if command -v q >/dev/null; then
  q add "Map check: $failing finding(s) left after the fix loop ($status)" \
    --gist "The map was checked like a visitor sees it, and the problems found were fixed where they were clear bugs." \
    --why "Branch $(git branch --show-current): $(git log --oneline origin/main..HEAD | wc -l | tr -d ' ') fix commit(s). Report $PWD/$out/report.json; what needs your decision is under 'Needs Joel' in each round's fixes.md." \
    --rec "Review and land" --option "Review and land" --option "Discard" \
    --evidence "$PWD/$out/ours-390-near.png::After the last round" || echo "q add failed: queue the result by hand (q add, ~/kit/mac/queue/README.md)." >&2
fi
[[ $status == clean ]]
