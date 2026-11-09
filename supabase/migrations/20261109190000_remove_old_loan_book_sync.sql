-- Remove the old loan book sync functions (2026-11-09)
--
-- The Daily Update page now uses sync_loan_book_mtd (20261109150000 to 20261109170000). These earlier
-- functions are no longer called by the app, but an admin could still call them through the API, and
-- they would compare against the last figure instead of the month's opening and create payments the
-- old way. create_arrears_snapshots wrote to the arrears_snapshots table, which no longer exists, and
-- was only called by old versions of these functions.
--
-- Every version of each function is removed, whatever its arguments.

BEGIN;

DO $$
DECLARE
  v_fn regprocedure;
BEGIN
  FOR v_fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN (
        'process_loan_book_sync',
        'process_daily_loan_book_update',
        'process_batch_arrears_update',
        'get_batch_loan_book_sync_template',
        'create_arrears_snapshots'
      )
  LOOP
    RAISE NOTICE 'Dropping %', v_fn;
    EXECUTE format('DROP FUNCTION %s', v_fn);
  END LOOP;
END $$;

INSERT INTO public.schema_migrations (version, name)
VALUES ('20261109190000', '20261109190000_remove_old_loan_book_sync.sql')
ON CONFLICT (version) DO NOTHING;

COMMIT;
