-- Fix: Add 'loan_book_sync' to the arrears_snapshots source check constraint
ALTER TABLE public.arrears_snapshots DROP CONSTRAINT IF EXISTS arrears_snapshots_source_check;

ALTER TABLE public.arrears_snapshots 
ADD CONSTRAINT arrears_snapshots_source_check 
CHECK (source = ANY (ARRAY['daily_sync'::text, 'batch_upload'::text, 'batch_update'::text, 'manual'::text, 'loan_book_sync'::text]));