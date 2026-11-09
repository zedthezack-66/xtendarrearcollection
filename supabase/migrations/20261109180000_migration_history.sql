-- Record of which migrations have been run on the live database (2026-11-09)
--
-- Migrations are run by hand through Lovable, so until now nothing showed which ones the live database
-- has. From here on, every migration ends by adding its own row:
--
--   INSERT INTO public.schema_migrations (version, name) VALUES ('<file timestamp>', '<file name>')
--   ON CONFLICT (version) DO NOTHING;
--
-- To see what has run:  SELECT * FROM public.schema_migrations ORDER BY version;
--
-- The history below is filled in only where the database shows the migration's changes are there,
-- or where it was confirmed with the platform owner. Migrations before 2026-11-03 were applied by
-- Lovable and are recorded as one baseline row.

BEGIN;

CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version text PRIMARY KEY,
  name text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  note text
);

-- Readable and writable only by the database owner (migrations, SQL editor), not through the app's API.
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.schema_migrations FROM PUBLIC, anon, authenticated;

INSERT INTO public.schema_migrations (version, name, applied_at, note) VALUES
  ('00000000000000', 'baseline', '2026-11-02', 'All migrations before 20261103120000, applied by Lovable'),
  ('20261103120000', '20261103120000_emergency_lockdown.sql', '2026-11-03', 'Confirmed applied and verified 2026-11-03'),
  ('20261106100000', '20261106100000_merge_duplicate_customers.sql', '2026-11-06', 'Confirmed applied and verified 2026-11-06'),
  ('20261106110000', '20261106110000_merge_duplicate_customers_part2.sql', '2026-11-06', 'Confirmed applied and verified 2026-11-06')
ON CONFLICT (version) DO NOTHING;

-- The rest are recorded only if their changes are present.
DO $$
BEGIN
  IF to_regprocedure('public.guard_agent_column_changes()') IS NOT NULL THEN
    INSERT INTO public.schema_migrations (version, name, applied_at, note)
    VALUES ('20261103130000', '20261103130000_phase0_access_rules.sql', '2026-11-03', 'Detected: guard_agent_column_changes exists')
    ON CONFLICT (version) DO NOTHING;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'payments' AND column_name = 'verification_status') THEN
    INSERT INTO public.schema_migrations (version, name, applied_at, note)
    VALUES ('20261104090000', '20261104090000_loan_book_source_of_truth.sql', '2026-11-04', 'Detected: payments.verification_status exists')
    ON CONFLICT (version) DO NOTHING;
  END IF;

  IF to_regprocedure('public.refresh_provisional_balance(uuid, uuid)') IS NOT NULL THEN
    INSERT INTO public.schema_migrations (version, name, applied_at, note)
    VALUES ('20261106090000', '20261106090000_agent_payments_until_sync.sql', '2026-11-06', 'Detected: refresh_provisional_balance exists')
    ON CONFLICT (version) DO NOTHING;
  END IF;

  IF to_regprocedure('public.import_batch(text, text, jsonb, boolean)') IS NOT NULL THEN
    INSERT INTO public.schema_migrations (version, name, applied_at, note)
    VALUES ('20261109120000', '20261109120000_server_side_batch_import.sql', '2026-11-09', 'Detected: import_batch exists')
    ON CONFLICT (version) DO NOTHING;
  END IF;

  IF to_regclass('public.loan_book_positions') IS NOT NULL THEN
    INSERT INTO public.schema_migrations (version, name, applied_at, note)
    VALUES ('20261109150000', '20261109150000_loan_book_month_to_date.sql', '2026-11-09', 'Detected: loan_book_positions exists')
    ON CONFLICT (version) DO NOTHING;
  END IF;

  IF to_regprocedure('public.sync_loan_book_mtd(uuid[], jsonb, text, boolean)') IS NOT NULL
     AND pg_get_functiondef('public.sync_loan_book_mtd(uuid[], jsonb, text, boolean)'::regprocedure) LIKE '%WHERE true%' THEN
    INSERT INTO public.schema_migrations (version, name, applied_at, note)
    VALUES ('20261109160000', '20261109160000_loan_book_mtd_where_clauses.sql', '2026-11-09', 'Detected: sync_loan_book_mtd has WHERE true')
    ON CONFLICT (version) DO NOTHING;
  END IF;

  IF to_regprocedure('public.sync_loan_book_mtd(uuid[], jsonb, text, boolean)') IS NOT NULL
     AND pg_get_functiondef('public.sync_loan_book_mtd(uuid[], jsonb, text, boolean)'::regprocedure) LIKE '%''loanbook_daily'', ''verified''%' THEN
    INSERT INTO public.schema_migrations (version, name, applied_at, note)
    VALUES ('20261109170000', '20261109170000_loan_book_mtd_live_constraints.sql', '2026-11-09', 'Detected: sync_loan_book_mtd writes loanbook_daily')
    ON CONFLICT (version) DO NOTHING;
  END IF;
END $$;

INSERT INTO public.schema_migrations (version, name)
VALUES ('20261109180000', '20261109180000_migration_history.sql')
ON CONFLICT (version) DO NOTHING;

COMMIT;
