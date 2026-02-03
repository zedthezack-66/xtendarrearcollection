-- Drop arrears_snapshots table completely (causes FK constraint errors on batch deletion)
DROP TABLE IF EXISTS public.arrears_snapshots CASCADE;

-- Remove pending confirmation related columns from tickets if they exist
-- (The status already allows standard values, no changes needed there)

-- Drop the pending confirmation RPC functions
DROP FUNCTION IF EXISTS public.get_pending_confirmation_tickets(uuid);
DROP FUNCTION IF EXISTS public.confirm_ticket_resolution(uuid);
DROP FUNCTION IF EXISTS public.reopen_ticket(uuid, numeric);
DROP FUNCTION IF EXISTS public.create_arrears_snapshots(text, uuid);

-- Clean up any orphaned data or constraints
-- Ensure arrears_sync_logs doesn't have blocking constraints
ALTER TABLE IF EXISTS public.arrears_sync_logs 
DROP CONSTRAINT IF EXISTS arrears_sync_logs_movement_type_check;