-- Clear all data from tables
TRUNCATE public.call_logs CASCADE;
TRUNCATE public.payments CASCADE;
TRUNCATE public.tickets CASCADE;
TRUNCATE public.batch_customers CASCADE;
TRUNCATE public.batches CASCADE;
TRUNCATE public.master_customers CASCADE;
TRUNCATE public.user_roles CASCADE;
TRUNCATE public.profiles CASCADE;

-- Delete all users from auth.users (this will cascade to profiles and user_roles via trigger)
DELETE FROM auth.users;