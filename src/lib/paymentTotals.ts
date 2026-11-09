// Payment totals under the loan book rules:
// - reported: recorded by a user since the last sync; counts as paid and reduces the balance
// - verified: created by the loan book sync; counts as paid, already reflected in amount_owed
// - overridden: replaced by the loan book; never counts

interface PaymentLike {
  amount: number | string;
  verification_status?: string | null;
}

export function paidTotal(payments: PaymentLike[]): number {
  return payments
    .filter((p) => p.verification_status === 'verified' || p.verification_status === 'reported')
    .reduce((sum, p) => sum + Number(p.amount), 0);
}

export function reportedTotal(payments: PaymentLike[]): number {
  return payments
    .filter((p) => p.verification_status === 'reported')
    .reduce((sum, p) => sum + Number(p.amount), 0);
}

// Live balance: the last loan book figure minus payments recorded since.
export function liveBalance(amountOwed: number | string, payments: PaymentLike[]): number {
  return Math.max(0, Number(amountOwed) - reportedTotal(payments));
}
