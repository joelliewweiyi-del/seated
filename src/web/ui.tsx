import type { ButtonHTMLAttributes, ReactNode } from 'react';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-09" -> "Fri 9 Oct". */
export function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[(weekday + 6) % 7]} ${d} ${MONTHS[m - 1]}`;
}

export function weekdayNames(days: number[]): string {
  if (days.length === 7) return 'Any day';
  if (days.join() === '6,7') return 'Weekends';
  if (days.join() === '1,2,3,4,5') return 'Weekdays';
  return days.map((d) => WEEKDAYS[d - 1]).join(', ');
}

export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return 'not yet';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function duration(fromIso: string, toIso: string): string {
  const m = Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000));
  if (m < 1) return 'under a minute';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-copper-600 text-white hover:bg-copper-700 disabled:bg-stone-300',
  secondary: 'border border-stone-300 bg-white text-stone-700 hover:bg-stone-50 disabled:text-stone-400',
  ghost: 'text-stone-500 hover:text-ink hover:bg-stone-100',
  danger: 'text-red-700 hover:bg-red-50',
};

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-copper-600 disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

const BADGE_TONES = {
  teal: 'bg-copper-50 text-copper-700 border-copper-100',
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
  green: 'bg-green-50 text-green-800 border-green-200',
  red: 'bg-red-50 text-red-700 border-red-200',
  stone: 'bg-stone-100 text-stone-600 border-stone-200',
};

export function Badge({ tone, children }: { tone: keyof typeof BADGE_TONES; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide ${BADGE_TONES[tone]}`}>
      {children}
    </span>
  );
}

export function SectionLabel({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500">{children}</h2>
      {aside}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`overflow-hidden rounded-xl border border-stone-200 bg-white ${className}`}>{children}</div>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-stone-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-ink placeholder:text-stone-400 focus:border-copper-600 focus:bg-white focus:outline-none';
