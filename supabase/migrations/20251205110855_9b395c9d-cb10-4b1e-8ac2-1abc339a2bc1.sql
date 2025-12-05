-- Allow agents to delete their assigned tickets
CREATE POLICY "Agents can delete assigned tickets" 
ON public.tickets 
FOR DELETE 
TO authenticated
USING (assigned_agent = auth.uid());

-- Allow admins to delete any batch_customers
CREATE POLICY "Admins can delete batch_customers" 
ON public.batch_customers 
FOR DELETE 
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- Allow admins to delete batches
CREATE POLICY "Admins can delete batches" 
ON public.batches 
FOR DELETE 
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));