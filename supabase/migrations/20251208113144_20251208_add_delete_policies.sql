/*
  # Add DELETE policies for data management
  
  1. New Policies
    - Add DELETE policies for admins on all tables
    - Allows complete database cleanup while maintaining RLS security
  
  2. Tables Updated
    - `master_customers` - Allow admins to delete (cascades to tickets, payments, call_logs, batch_customers)
    - `tickets` - Allow admins to delete all tickets
    - `payments` - Allow admins to delete all payments
    - `call_logs` - Allow admins to delete all call logs
    - `user_roles` - Allow admins to delete roles
*/

CREATE POLICY "Admins can delete customers" 
ON public.master_customers 
FOR DELETE 
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete all tickets" 
ON public.tickets 
FOR DELETE 
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete payments" 
ON public.payments 
FOR DELETE 
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete call logs" 
ON public.call_logs 
FOR DELETE 
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete roles" 
ON public.user_roles 
FOR DELETE 
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));
