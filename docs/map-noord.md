# Seated’s Noord layer

Built 6 November 2026 for the public map’s **Pilot** stage. Noord uses our pre-sez renderer, revived from `a49cefd^:scripts/map-world.ts` and `a49cefd^:src/map/paint.ts`, with the current `pix.ts` software rasterizer. It is independent open-data art. Sezlab’s images are only read for colour and alignment measurements; no reference pixels or shapes are copied into our tiles.

## Rebuild

From the repository root, with dependencies already installed:

```sh
npx tsx scripts/map-noord.ts
npm run typecheck
npm test
npm run test:e2e
du -sh src/map/public/ours
```

The existing `src/map/public/sez/manifest.json` and its local images must be present. “Cold cache” refers to our open-data cache, not to downloading his art. No new npm dependencies were added. Building uses Node built-ins and the Mac’s `sips` to decode the PDOK JPEGs to BMP; viewing the committed PNGs does not require `sips`.

Downloads are sequential, carry `User-Agent: Seated-map/0.3 (one-off Noord open-data build; seated.food)`, and pause between requests. They go under `.cache/noord/<RD-box-hash>/`, which is gitignored. This box’s hash is `a9dd1f10a848`. A warm build reads only local files. To intentionally refresh upstream data, move that cache directory aside before rebuilding. The script never contacts restaurant or booking services.

Sources:

- OpenStreetMap Overpass, `https://overpass-api.de/api/interpreter`: water polygons and holes, parks, land use, roads, rails and trees. © OpenStreetMap contributors, ODbL.
- 3DBAG WFS, `https://data.3dbag.nl/api/BAG3D/wfs`, `BAG3D:lod13`: footprint, height above ground, ridge height, roof type and construction year. TU Delft/3DGI, CC BY 4.0.
- PDOK, `https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0`, `Actueel_ortho25`: 15 aerial tiles at one metre per pixel, used to sample roof colours. Beeldmateriaal Nederland, CC BY 4.0.

The verified cold data path made 23 requests: one OSM terrain query, six 3DBAG pages, 15 aerial images and one tree query. It returned 20,275 OSM terrain features and 59,627 3DBAG parts. Cached inputs are deliberately not automatically refreshed: byte-for-byte repeatability applies to the same cache and reference version, not to changing upstream datasets.

## Grid and painting

The RD box is **x 118000–127500, y 487600–492500**. Before building, the script checks the ten required restaurants and the places marked as Noord in `data/map-places.json`, and enlarges the box with a 100 m margin if needed. None required enlargement in this build.

Grid x runs east and grid y south. The old diamond painter is preserved, refined from 8×4 to **4×2 level-0 pixels** to remove conspicuous stepped roof edges. At reference scale 3:

```text
S = (hi.w / meta.w) / 2 = 1.5
cell metres = (TW / 2) / (S / sqrt(2)) = 1.8856180831641265
height pixels per metre = S * VZ = 1.299
level-0 x = ((RDx-X0 + RDy-Y0)/sqrt(2) - meta.x) * S
level-0 y = ((RDx-X0 - RDy+Y0)/(2*sqrt(2)) - meta.y) * S
```

The resulting grid has 5039×2599 cells. Each step east adds exactly `(2,1)` pixels; each step south adds `(-2,1)`. Only the common origin is rounded, so local errors cannot accumulate into chunk seams. A measured registration of **(+1,+3) level-0 pixels** is then applied to our drawing. It is recorded separately from rounding in the manifest. The original coarser painter measured roughly `(-1,-3)` at the IJ, `(-2,-2)` at Centraal and `(-1,-3)` east of Centraal before registration. This is an image-placement calibration, not a copied shoreline. Recheck it when changing the reference or painter.

The build retains the old scanline polygon fill, physical building heights, age-based walls and windows, pitched-roof corner interpolation, quays, bridges, rails, trees and software rasterization. Roads, pavement margins and procedural tree densities keep their physical size when the cell size changes. Ground is painted first; buildings and props follow back-to-front. Large flat roofs use measured grey tones and three discrete contrasts sampled from actual PDOK pixels, rather than invented roof fixtures. Round 2 adds coherent, world-anchored material wear at several scales and shore-distance-dependent water ripples. There are no repeating per-cell texture stamps. The 7,147 cached OSM tree anchors stay in place; additional trees follow OSM vegetation with clustered density, varied stature, lobed crowns and seeded lighting. Tree geometry uses the full position seed rather than a short sprite cycle. Ground, bridges and then buildings/props are painted as separate passes.

Light comes from the upper left. Boundary walls use the nearest actual 3DBAG polygon edge normal, avoiding alternating bright/dark bars on a diagonal raster staircase. Roof slopes retain three shading steps. Full BAG identifiers select façade materials and continuous window bays; industrial land use, construction age and height select industrial upper glazing/loading doors, post-war bays or newbuild ribbons. Blank bays and reflections break the universal grid. Roof interpolation joins only cells belonging to the same building, rather than joining unrelated buildings with the same truncated seed and colour. Darkening still mixes toward violet `#1d1a24`, with `#2b2733` for our dark ink. Every resulting colour is snapped to the measured palette before encoding. There are no partially transparent or interpolated edge colours.

### Ground fixes for open water (6 Nov 2026)

- Stone wins over vegetation on one OSM way (`parkOrStoneTerrain` in `src/map/noord-tags.ts`): `natural=stone|bare_rock` and `man_made=breakwater|groyne` paint as quay stone even when the way also says `landuse=grass` (the strekdammen north of Bacalar, ways 55343276 and 847117009).
- Green slivers on water (`cleanSlivers`, same file): after the water fill, a park, wood, field or garden cell with water on 5 or more of its 8 neighbours becomes water, repeated until none is left. A park outline that pokes past the water outline (Stenen Hoofd) otherwise leaves thin green strokes and lone trees on open water. The first build with it turned 2,178 cells to water.

### Gaps in his art, and the render order (8 Nov 2026)

His drawing has gaps inside the city (Oost, the Indische Buurt, Watergraafsmeer), and fades out at its edges in a dither about 128 world pixels deep. The box now runs south to RD y 484200. `gapMask` (in `src/map/noord-grid.ts`) keeps our pixels only where his overview is transparent, plus 16 overview pixels (128 world pixels) over his edge. `render.ts` draws our layer **after** his art. Because ours is cut to that strip, it covers only his gaps and his fading edge, never the rest of his drawing. The fog band is drawn last, over the edge of both drawings, in a ragged line (as on 6 Nov). The alignment test moved to Westerdok, where the strip meets the IJ. Building-edge correlation in Oost gives 1 to 3 level-0 pixels, the same as at the IJ. The style change between the two drawings is still visible at the join.

## Colour measurements

`src/map/noord-palette.ts` counts all opaque pixels in all reference level-0 chunks for version **2611020030**. These are representative semantic swatches identified in the reference and verified against that histogram, not automatically segmented class averages. The counts below are occurrences of the swatch, not the area of its semantic class. Tests also require every listed “ours” swatch to occur in the generated tiles.

| Class | His measured colour | Ours | Reference pixel count | RGB distance |
| --- | --- | --- | ---: | ---: |
| water | `#2c8ba1` | `#3a869a` | 418,717 | 16.43 |
| IJ water | `#3a869a` | `#3a869a` | 578,718 | 0.00 |
| grass | `#8cc43b` | `#8cc43b` | 267,020 | 0.00 |
| tree | `#599533` | `#599533` | 479,885 | 0.00 |
| street | `#dfcdae` | `#dfcdae` | 388,971 | 0.00 |
| quay | `#e7d4b8` | `#e7d4b8` | 588,309 | 0.00 |
| roof red | `#893824` | `#893824` | 384,084 | 0.00 |
| roof brown | `#482518` | `#5c2b1b` | 760,703 | 21.10 |
| roof grey | `#585657` | `#585657` | 493,048 | 0.00 |
| wall | `#b9a489` | `#b9a489` | 495,636 | 0.00 |
| shadow | `#2a2c33` | `#2b2733` | 238,198 | 5.10 |

The level-0 output palette has 61 entries, including transparent index zero. It retains all twelve grey roof tones and a wider range of brown/grey edge tones instead of relying almost entirely on violet ink. Rare near-duplicate colours are omitted to keep the added detail within the asset budget. The old painter uses the IJ water base throughout Noord’s waterways; its difference from the representative canal-water swatch is 16.43, within the requested 24. Park grass and garden ground use different measured greens. The table shows representative colours; the manifest lists the complete palette and measurement records.

## Tiles, coverage and fog

`src/map/public/ours/` contains **142 files, 12,545,640 bytes** (limit 13,000,000 bytes, checked by the build and by `test/mapNoord.test.ts`; 10 MB at first, 12 MB on 6 Nov 2026 for the Oostelijke Eilanden, 13 MB on 8 Nov 2026 when the RD box went south to y 484200 to fill his gaps in Oost; only his gaps and a strip over his edge are kept, see below). The chunk counts in this list are from 6 Nov:

- 84 level-0 PNG chunks, each 1024×1024, at one image pixel per two world pixels (`k=0.5`). Negative and out-of-reference-range chunk indices are supported.
- 26 level-1 chunks, also 1024×1024, at `k=0.25`.
- One level-2 overview, `2.png`, at `k=0.125`, 4096×2560 pixels, with image-grid offset `(512,-1024)`.
- `manifest.json`: projection/version, RD extent, palette, registration, level offsets and chunk lists, exact overview-alpha row runs, and SHA-256/size records for every PNG.

Level 0 is 8-bit indexed colour. Levels 1 and 2 use a shared 16-colour subset in packed 4-bit PNGs. Each reduction selects the modal opaque colour in a 2×2 block, retaining coverage whenever any source pixel is opaque; it never averages colours. Lossless PNG encoding compares raw and adaptively filtered rows and keeps the smaller stream. The reduced far palette trades subtle material variation at zoom 0.25 and below for more detail at near/mid zoom under the 13 MB cap. Tiles are staged in the cache and the size limit is checked before replacing the public layer. Empty chunks are omitted and stale generated chunks removed.

`World.load()` loads both manifests. Our coverage is the overview-alpha runs translated back to world coordinates; `covers()` returns the union with the existing reference mask. The App’s existing roof-height and outside-city rules then work for Noord without changing restaurant data or marker behavior. A projection/version mismatch fails explicitly with the rebuild instruction, instead of silently putting stale tiles in the wrong place.

(Superseded on 8 Nov 2026, see "Gaps in his art" above.) `render.ts` drew our overview and chosen detail level **before all of his art**, including his overview fallback. At zooms 0.125, 0.25, 0.5, 1, 2, 3 and 4 our displayed pixel multiples are 1, 1, 1, 2, 4, 6 and 8. Image smoothing is disabled. The fog mask uses an explicit OR of both overview alphas on one shared grid, including the negative extension offset. The ragged transition is generated with `fogEdgeIndex` on the outside of this union, clipped to empty pixels, and composited before all art levels. Restaurant clearances remain. See the round-2 diagnosis below.

## Alignment and verification

`src/map/noord-alignment.ts` reads both actual rendered level-0 layers. It classifies water by RGB channel thresholds, then cross-correlates binary water masks in a fixed 440×440-pixel overlap window. Samples are within 12 pixels of a reference water/land boundary and have common alpha. It searches integer offsets in both directions with normalized correlation. The acceptance test searches ±8 pixels; the additional measurements below search ±12. This is a best-fit boundary offset, not a claim that every individual shoreline pixel is identical: buildings, quays, bridges and data dates cause local differences.

| Overlap | Centre (lat, lng) | Offset (x,y), level-0 px | Correlation | Samples |
| --- | --- | --- | ---: | ---: |
| IJ / Westerdok (acceptance strip) | 52.3833, 4.8953 | (0, -1) | 0.7158 | 27,157 |
| Westerdok west | 52.3845, 4.891 | (1, 0) | 0.5996 | 53,534 |
| Centraal | 52.3792, 4.9 | (-1, 0) | 0.6520 | 29,556 |
| IJ east of Centraal | 52.3785, 4.91 | (0, 0) | 0.5844 | 3,308 |

All four best-fit offsets are within one pixel per axis, below the requested two-pixel limit. The main acceptance strip is `(0,-1)`.

Verified commands:

- `npm run typecheck`: no errors.
- `npm test`: 232 tests passed, including eleven individual restaurant anchor/coverage checks, rendered-palette membership and alpha, alignment, file hashes/size, integer zoom scaling and the fog union/restaurant-clear rule.
- `npm run test:e2e`: 17 tests passed against the demo server. No booking-system requests.
- `npx tsx scripts/map-noord.ts`: two consecutive final warm builds each reported zero requests and 9,486,099 bytes. The second ran with global `fetch` replaced by a throwing function; all 98 output SHA-256 hashes, including the manifest, matched. The cold data path was verified in round 1.
- All **175** local sezlab image SHA-256 hashes match the pre-task snapshot; `git status --short -- src/map/public/sez` is empty.

The one new e2e test saves `test-results/screens/map-noord-{far,mid,near,seam}.png`. Far/mid/near zooms are 0.125/0.5/1. The final seam is centred at 52.3838, 4.9025 at zoom 0.5 so both shores can be compared at level 0; it asserts the camera zoom, waits for pending images, then two animation frames. The normal desktop sidebar remains visible. Screenshots are reviewed by a subagent as required by CLAUDE.md.

## Round-2 rendering diagnoses

**Canal-edge stripes (desk-near):** the paved crossing at the right edge of the canal exposed a per-cell quay bug. Each diamond guessed its land-facing sides and drew a pale lip, dark wall and water highlight independently. On the nearly vertical bank those guesses alternated, creating a comb. It was not a tile edge, chunk seam or clipping fault. `finishQuays` now shades the completed pixel shoreline continuously. Bridge-deck cells had the same per-cell railing hazard; `finishBridges` likewise follows their completed water-facing boundary. Tests cover both a straight paved bank and an uninterrupted diagonal bridge deck. The final near camera matches the original location and exposes the crossing outside the sidebar.

**Far fog (desk-far):** the overview registration and scales were correct: sezlab’s image is 2144×1472 at 1/8 world scale; ours is 4096×2560 with overview-grid offset `(512,-1024)`. Their union is `(0,-1024,4608,2560)`. The old `fogEdgeIndex` deliberately extended the fog inward over opaque art, and that mask was drawn after art. Applied to the real union without restaurant clearances, it covered 291,145 occupied overview pixels. The replacement outside mask covers zero. A translated synthetic union test includes transparent overlap and negative offsets; an e2e oracle independently composites both overview alphas at the far camera transform and checks the final canvas for fog colours over occupied pixels.

A lavender wedge still exists below the southern limit of our RD box: neither source contains art there. For example, the box stops at RD y=487600; Scheepskameel is approximately y=487210 and the installed reference alpha also ends in that area. The new mask must preserve this genuine coverage gap. Its ragged tonal band lies outside the art; changing the art’s straight data boundary would require additional coverage, not another mask offset.

## Matched-scale style comparison

`src/map/noord-style.ts` reads reference and output level-0 pixels at the same scale. It never feeds reference positions or shapes into the painter. The installed reference stops before most of Eastern Docklands, so that comparison uses its available western quay/newbuild edge. The rectangular samples are:

| Reference place | Level-0 rectangle (x,y,w,h) | Comparable Noord sample | Level-0 rectangle |
| --- | --- | --- | --- |
| Westerdok, warehouse-like façades | 6640,1390,450,350 | Bacalar industrial area | 8520,1610,450,350 |
| Oostelijke eilanden, mixed blocks | 7168,3340,200,480 | Noord post-war blocks | 8920,1980,200,480 |
| Eastern Docklands western quay/newbuild | 7168,2690,190,300 | Overhoeks newbuild | 7840,1920,190,300 |
| Westerpark | 5470,792,330,150 | Noord park | 8690,2240,330,150 |

These are colour-family statistics in comparable neighbourhoods, not a semantic segmentation or a claim that their building mix is identical. Ground tones also occur on walls; grey roof tones occur on some façades/windows. Therefore neighbour-change rate measures colour detail within each family, not roof fixtures or window counts. It is useful for exposing excessive uniformity, but is not a score to maximize. The before baseline is the round-1 WIP `3c69538`, preserved locally in `.cache/noord/round2-before/` (only our tiles). Reproduce with that baseline restored there and:

```sh
npx tsx -e "import {styleComparison} from './src/map/noord-style'; console.log(JSON.stringify(styleComparison(), null, 2))"
```

Luminance SD uses Rec.709 RGB weights on 0–255 channels. Each cell below gives **colour count / luminance SD / horizontal neighbour-change %**. Vegetation saturation is HSV saturation averaged by pixel count.

| Family | His | Ours before | Ours after |
| --- | ---: | ---: | ---: |
| Ground | 14 / 19.77 / 45.16 | 12 / 20.26 / 6.62 | 11 / 19.15 / 7.39 |
| Vegetation | 10 / 32.89 / 43.09 | 9 / 30.53 / 28.22 | 8 / 26.18 / 27 |
| Water | 9 / 6.81 / 24.98 | 2 / 0.15 / 1.17 | 4 / 5.45 / 16.26 |
| Roofs | 12 / 32.35 / 47.35 | 12 / 26.86 / 16.2 | 12 / 26.04 / 12.2 |
| Outlines | 9 / 20 / 51.66 | 2 / 2.32 / 0 | 6 / 18.25 / 11.63 |
| Windows | 7 / 27.99 / 30.48 | 6 / 31.93 / 33.55 | 6 / 28.98 / 5.45 |

The dominant ground colour falls from 35.7% to 24.1% (his largest is 13.6%): less flat beige, still less detailed than his pavements. Vegetation saturation changes **0.655 → 0.627**, versus his **0.639**; shape/placement diversity is a separate visual check. The water base falls from 98.9% to 71.0%, with shore variation and luminance SD approaching his sample. Violet ink falls from 99.7% to 46.2% of the outline family; warm grey/brown edges now carry much of the shading. Grey-roof and window neighbour-change rates decrease partly because the old per-cell wall bars are gone; this is **not** evidence that roof detail now matches his. Broad roof planes remain visibly simpler.

Window patterns are short 1–6 px blue/grey runs bracketed by wall tones. Values below are **mean run width / mean horizontal bay spacing / matched runs**. They are neighbourhood/type proxies, not annotated individual façades; especially the 14-run Oostelijke sample is too small for a precise post-war population estimate. The useful before/after finding is that almost every detected old window was one pixel wide, whereas the new renderer supports wider industrial glazing and varied bays.

| Type / reference sample | His | Ours before | Ours after |
| --- | ---: | ---: | ---: |
| Industrial / Westerdok | 1.18 / 3 / 74 | 1 / 4.54 / 2124 | 1.57 / 6.61 / 1320 |
| Post-war comparison / Oostelijke eilanden | 1.64 / 4 / 14 | 1 / 5.26 / 2079 | 1.19 / 6.27 / 1373 |
| Newbuild / western Docklands | 1.09 / 11.2 / 58 | 1.13 / 3.56 / 730 | 1.81 / 5.07 / 3102 |

Top measured outline tones by those same samples (shares within the outline family):

| Sample | His | Ours before | Ours after |
| --- | --- | --- | --- |
| Westerdok | #2a2c33 19.2%; #544b45 14.0%; #453a36 11.3% | #2b2733 99.2%; #585349 0.8% | #544b45 33.7%; #2b2733 33.1%; #585349 18.4% |
| Oostelijke eilanden | #544b45 22.3%; #251d19 13.7%; #585349 12.5% | #2b2733 100.0% | #544b45 48.9%; #2b2733 19.6%; #453a36 12.1% |
| Eastern Docklands western quay | #251d19 35.5%; #585349 17.3%; #48433a 11.4% | #2b2733 100.0% | #2b2733 75.0%; #585349 19.7%; #544b45 3.6% |

## Visual review and remaining differences

Own review uses the supplied round-1 desk/phone/seam screenshots, untouched reference tiles, and the generated near/mid/far/seam screenshots at the zooms above. A separate subagent reviewed the map screenshots as required by CLAUDE.md and confirmed the original comb is gone, no new near/mid regression, no visible far fog intrusion, and continuous water/registration at the seam.

- **Near (1):** the original canal-edge comb is absent; both banks at the crossing are continuous. Industrial façades no longer carry the same dense window grid as apartment blocks; grey/brown outlines are softer, shoreline variation is visible, and crowns are rounder with varied lobes and stature. Large paved yards still have fewer kerbs and fine surface marks than sezlab’s art. Some apartment window bays remain visibly regular. Our level-0 pixels are doubled beside his higher-resolution detail at this zoom.
- **Mid (0.5):** palette and water make the neighbourhoods read more continuously; tree spacing is less regimented. Broad roofs and contiguous tan ground still disclose the procedural construction. Detailed roof fixtures are limited to what the 3DBAG/PDOK inputs reveal; no reference geometry was traced to fill them in.
- **Far (0.125):** the final canvas has zero fog-coloured pixels over either overview’s opaque art. The remaining southern lavender wedge is genuinely empty in both sources. Its art boundary remains geometric, while the outer tonal transition is ragged. The 16-colour far palette has less subtle material variation than level 0.
- **Seam (0.5):** no registration discontinuity is apparent; the water base is continuous and the shoreline texture helps. His side remains richer in small architectural and paving details. Style parity is not claimed.

The two requested stale texts are corrected. About now describes outside restaurants’ fog signs. CLAUDE’s City count is **18 outside / 138 listed**, computed from `data/restaurants.json` filtered to Amsterdam, known map places and opt-outs using the same exclusion rules as `buildMapData`, then `World.covers` on the combined manifests. This is the repository list, not a claim about a changing live census.

To revisit: richer open-data roof/pavement detail and the remaining regular apartment bays; the existing CLAUDE Rendering paragraph still describes the old sez-only inward fog wording (only the requested City count was edited). Additional art south of the current Noord extent would fill the real southern gap, but is outside this task’s coverage. No commits, new dependencies, reference-image edits or booking-system requests were made.
