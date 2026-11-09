-- Record the live database's own rules in the repo, and remove unused unchecked functions (2026-11-09)
--
-- A structure check of the live database on 2026-11-09 found rules that exist only there, and old
-- functions that run with owner rights without checking the user's role.
--
-- 1. Rules that existed only in the live database are written down here, so a fresh database gets
--    them and future migrations are written against them. On the live database these steps change
--    nothing: each is skipped or replaced with an identical definition.
-- 2. Unused functions that skip the role check are removed. The emergency lockdown (20261103120000)
--    already stopped users calling three of them; removing them closes the door for good.
-- 3. Internal helpers that only triggers and other database functions use can no longer be called
--    directly through the API. Triggers and owner-rights functions are not affected by this.
--    has_role and is_staff stay callable: the access rules use them.

BEGIN;

-- ============================================================
-- 1. Live-only rules
-- ============================================================

-- Payment sources: agent-recorded payments and loan book payments.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.payments'::regclass AND conname = 'payments_source_check') THEN
    ALTER TABLE public.payments ADD CONSTRAINT payments_source_check
      CHECK (source = ANY (ARRAY['system_manual'::text, 'loanbook_daily'::text])) NOT VALID;
  END IF;
END $$;

-- Payment methods, including the one used for loan book payments.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.payments'::regclass AND conname = 'payments_payment_method_check'
                   AND pg_get_constraintdef(oid) LIKE '%Loan Book Sync%') THEN
    ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_payment_method_check;
    ALTER TABLE public.payments ADD CONSTRAINT payments_payment_method_check
      CHECK (payment_method = ANY (ARRAY['Mobile Money'::text, 'Bank'::text, 'Loan Book Sync'::text])) NOT VALID;
  END IF;
END $$;

-- A ticket's agent becomes the customer's agent when the ticket is created or reassigned.
-- Definition copied from the live database.
CREATE OR REPLACE FUNCTION public.sync_master_customer_owner()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.assigned_agent IS NOT NULL AND NEW.master_customer_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.assigned_agent IS DISTINCT FROM OLD.assigned_agent) THEN
    UPDATE public.master_customers
       SET assigned_agent = NEW.assigned_agent, updated_at = now()
     WHERE id = NEW.master_customer_id
       AND assigned_agent IS DISTINCT FROM NEW.assigned_agent;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_sync_master_customer_owner ON public.tickets;
CREATE TRIGGER trg_sync_master_customer_owner
  AFTER INSERT OR UPDATE OF assigned_agent ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.sync_master_customer_owner();

-- ============================================================
-- 2. Unused functions that skip the role check
-- ============================================================

-- Dumped every customer's NRC, phone and next of kin; unused by the app.
DROP FUNCTION IF EXISTS public.get_admin_full_export(text, text, text, text, text, text, boolean, integer, integer);
-- The old browser import, replaced by import_batch.
DROP FUNCTION IF EXISTS public.import_master_customer(jsonb);
DROP FUNCTION IF EXISTS public.import_ticket_row(jsonb);
-- Older duplicate of get_interaction_analytics(uuid, date, date), which the app uses and which checks roles.
DROP FUNCTION IF EXISTS public.get_interaction_analytics(text, text, text);
-- Template for the removed loan book sync.
DROP FUNCTION IF EXISTS public.get_loan_book_sync_template();

-- ============================================================
-- 3. Internal helpers: not callable directly through the API
-- ============================================================

REVOKE EXECUTE ON FUNCTION public.refresh_customer_payment_totals(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_provisional_balance(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.on_reported_payment_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_payment_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_master_customer_owner() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_agent_column_changes() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_loan_book_balances() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('20261109200000', '20261109200000_record_live_rules_and_tighten.sql')
ON CONFLICT (version) DO NOTHING;

COMMIT;
