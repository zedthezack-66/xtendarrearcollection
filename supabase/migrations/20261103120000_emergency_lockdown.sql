-- Emergency lockdown (2026-11-03)
-- Closes anonymous (not-logged-in) access and locks unused functions that bypass all access rules.
-- No impact on the current app: every screen requires login, and the five functions in step 3
-- are not called anywhere in the frontend.

-- 1. Anonymous callers (anyone holding the public key) get no table access.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- 2. Anonymous callers can't run any database function; logged-in users keep access.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;

-- 3. Unused functions with no admin check: only the backend (service_role) may call them.
--    get_admin_full_export currently lets anyone dump every customer's NRC, phone and next of kin.
REVOKE EXECUTE ON FUNCTION public.get_admin_full_export(text, text, text, text, text, text, boolean, integer, integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.process_batch_arrears_update(uuid, json) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.import_master_customer(jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.import_ticket_row(jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.create_arrears_snapshots(uuid, text) FROM authenticated;
