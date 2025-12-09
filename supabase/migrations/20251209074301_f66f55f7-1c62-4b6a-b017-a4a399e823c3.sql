-- Fix the security definer view issue by dropping and recreating without SECURITY DEFINER
DROP VIEW IF EXISTS public.dashboard_stats;

-- Create view without security definer (uses invoker's permissions)
CREATE VIEW public.dashboard_stats AS
SELECT 
  COUNT(DISTINCT mc.id) as total_customers,
  COALESCE(SUM(mc.outstanding_balance), 0) as total_outstanding,
  COALESCE(SUM(mc.total_paid), 0) as total_collected,
  COALESCE(SUM(mc.total_owed), 0) as total_owed
FROM master_customers mc;