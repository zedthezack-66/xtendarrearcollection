-- Add loan book fields to master_customers table
ALTER TABLE public.master_customers ADD COLUMN IF NOT EXISTS branch_name text;
ALTER TABLE public.master_customers ADD COLUMN IF NOT EXISTS arrear_status text;
ALTER TABLE public.master_customers ADD COLUMN IF NOT EXISTS employer_name text;
ALTER TABLE public.master_customers ADD COLUMN IF NOT EXISTS employer_subdivision text;
ALTER TABLE public.master_customers ADD COLUMN IF NOT EXISTS loan_consultant text;
ALTER TABLE public.master_customers ADD COLUMN IF NOT EXISTS tenure text;
ALTER TABLE public.master_customers ADD COLUMN IF NOT EXISTS reason_for_arrears text;
ALTER TABLE public.master_customers ADD COLUMN IF NOT EXISTS last_payment_date timestamp with time zone;

-- Add loan book fields to batch_customers table
ALTER TABLE public.batch_customers ADD COLUMN IF NOT EXISTS branch_name text;
ALTER TABLE public.batch_customers ADD COLUMN IF NOT EXISTS arrear_status text;
ALTER TABLE public.batch_customers ADD COLUMN IF NOT EXISTS employer_name text;
ALTER TABLE public.batch_customers ADD COLUMN IF NOT EXISTS employer_subdivision text;
ALTER TABLE public.batch_customers ADD COLUMN IF NOT EXISTS loan_consultant text;
ALTER TABLE public.batch_customers ADD COLUMN IF NOT EXISTS tenure text;
ALTER TABLE public.batch_customers ADD COLUMN IF NOT EXISTS reason_for_arrears text;
ALTER TABLE public.batch_customers ADD COLUMN IF NOT EXISTS last_payment_date timestamp with time zone;

-- Create index on branch_name for future filtering
CREATE INDEX IF NOT EXISTS idx_master_customers_branch_name ON public.master_customers(branch_name);
CREATE INDEX IF NOT EXISTS idx_batch_customers_branch_name ON public.batch_customers(branch_name);