// Helpers for the "Days In Arrears" field on tickets.
// Buckets: 0-30, 31-90, 91-120, 121-180, 180+

export type DaysInArrearsBucket = '0-30' | '31-90' | '91-120' | '121-180' | '180+';

export const DAYS_IN_ARREARS_BUCKETS: DaysInArrearsBucket[] = [
  '0-30',
  '31-90',
  '91-120',
  '121-180',
  '180+',
];

export function getDaysInArrearsBucket(days: number | null | undefined): DaysInArrearsBucket | null {
  if (days === null || days === undefined || isNaN(Number(days))) return null;
  const d = Number(days);
  if (d < 0) return null;
  if (d <= 30) return '0-30';
  if (d <= 90) return '31-90';
  if (d <= 120) return '91-120';
  if (d <= 180) return '121-180';
  return '180+';
}

export function getDaysInArrearsBadgeClass(days: number | null | undefined): string {
  const bucket = getDaysInArrearsBucket(days);
  switch (bucket) {
    case '0-30':
      return 'bg-success/10 text-success border-success/20';
    case '31-90':
      return 'bg-warning/10 text-warning border-warning/20';
    case '91-120':
      return 'bg-orange-500/10 text-orange-600 border-orange-500/20';
    case '121-180':
      return 'bg-destructive/10 text-destructive border-destructive/20';
    case '180+':
      return 'bg-destructive/20 text-destructive border-destructive/40 font-semibold';
    default:
      return 'bg-muted text-muted-foreground border-muted';
  }
}

/**
 * Parse a Days In Arrears value from a CSV cell.
 * Returns null for empty / non-numeric / Excel artifacts (#N/A, etc.).
 * Returns a non-negative integer otherwise.
 */
export function parseDaysInArrears(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const upper = s.toUpperCase();
  if (upper === '#N/A' || upper === 'N/A' || upper === 'NA' || upper === '-' || upper === 'NULL') return null;
  // Strip any non-digit characters that may sneak in (e.g. "30 days")
  const match = s.match(/-?\d+/);
  if (!match) return null;
  const n = parseInt(match[0], 10);
  if (isNaN(n) || n < 0) return null;
  return n;
}
