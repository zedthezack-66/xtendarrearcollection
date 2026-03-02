
-- Add loan_id columns
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS loan_id TEXT;
ALTER TABLE public.batch_customers ADD COLUMN IF NOT EXISTS loan_id TEXT;
ALTER TABLE public.arrears_sync_logs ADD COLUMN IF NOT EXISTS loan_id TEXT;

-- Backfill tickets with 12-char UUID suffix for uniqueness
UPDATE public.tickets 
SET loan_id = 'LN' || TO_CHAR(created_at, 'YYYYMMDD') || UPPER(SUBSTRING(REPLACE(id::text, '-', '') FROM 1 FOR 12))
WHERE loan_id IS NULL;

-- Backfill batch_customers from linked tickets
UPDATE public.batch_customers bc
SET loan_id = t.loan_id
FROM public.tickets t
WHERE t.master_customer_id = bc.master_customer_id
  AND t.batch_id = bc.batch_id
  AND bc.loan_id IS NULL
  AND t.loan_id IS NOT NULL;

-- Backfill remaining batch_customers
UPDATE public.batch_customers
SET loan_id = 'LN' || TO_CHAR(created_at, 'YYYYMMDD') || UPPER(SUBSTRING(REPLACE(id::text, '-', '') FROM 1 FOR 12))
WHERE loan_id IS NULL;

-- Set NOT NULL on tickets
ALTER TABLE public.tickets ALTER COLUMN loan_id SET NOT NULL;

-- Unique index on tickets.loan_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_loan_id ON public.tickets(loan_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_batch_customers_loan_id ON public.batch_customers(loan_id);
CREATE INDEX IF NOT EXISTS idx_arrears_sync_logs_loan_id ON public.arrears_sync_logs(loan_id);
