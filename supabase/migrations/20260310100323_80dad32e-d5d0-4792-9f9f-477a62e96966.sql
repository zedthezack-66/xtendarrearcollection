
CREATE OR REPLACE FUNCTION public.get_batch_loan_book_sync_template(p_batch_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result json;
  v_batch_name text;
  v_batch_institution text;
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can download sync templates';
  END IF;

  SELECT name, institution_name INTO v_batch_name, v_batch_institution
  FROM batches WHERE id = p_batch_id;

  IF v_batch_name IS NULL THEN
    RAISE EXCEPTION 'Batch not found';
  END IF;

  SELECT json_build_object(
    'batch_id', p_batch_id,
    'batch_name', v_batch_name,
    'institution_name', v_batch_institution,
    'export_date', now(),
    'customers', COALESCE(json_agg(
      json_build_object(
        'loan_id', t.loan_id,
        'nrc_number', t.nrc_number,
        'customer_name', t.customer_name,
        'old_arrears_amount', t.amount_owed
      ) ORDER BY t.customer_name
    ), '[]'::json),
    'total_nrcs', COUNT(*),
    'total_old_arrears', COALESCE(SUM(t.amount_owed), 0)
  ) INTO v_result
  FROM tickets t
  WHERE t.batch_id = p_batch_id;

  RETURN v_result;
END;
$function$;
