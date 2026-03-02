/**
 * Generates a unique Loan ID for tickets.
 * Format: LN + YYYYMMDD + 8 random hex chars
 * Example: LN20260302A1B2C3D4
 */
export function generateLoanId(): string {
  const now = new Date();
  const dateStr = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0');
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  return `LN${dateStr}${hex}`;
}
