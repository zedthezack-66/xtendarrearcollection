
-- Drop and recreate get_loan_book_sync_template (return type changed)
DROP FUNCTION IF EXISTS public.get_loan_book_sync_template();

CREATE OR REPLACE FUNCTION public.get_loan_book_sync_template()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSON;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can download sync templates';
  END IF;

  SELECT json_build_object(
    'total_customers', (SELECT COUNT(*) FROM master_customers),
    'total_old_arrears', COALESCE((SELECT SUM(outstanding_balance) FROM master_customers WHERE outstanding_balance > 0), 0),
    'customers', COALESCE((
      SELECT json_agg(json_build_object(
        'loan_id', t.loan_id,
        'nrc_number', mc.nrc_number,
        'customer_name', mc.name,
        'old_arrears_amount', COALESCE(mc.outstanding_balance, 0)
      ) ORDER BY mc.name)
      FROM master_customers mc
      LEFT JOIN tickets t ON t.master_customer_id = mc.id AND t.status != 'Resolved'
    ), '[]'::json)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;
