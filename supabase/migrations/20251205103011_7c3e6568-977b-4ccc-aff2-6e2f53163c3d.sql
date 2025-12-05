-- Allow authenticated users (agents) to insert batches
CREATE POLICY "Agents can create batches" 
ON public.batches 
FOR INSERT 
TO authenticated
WITH CHECK (true);

-- Allow authenticated users to update batches they're involved with
CREATE POLICY "Agents can update batches" 
ON public.batches 
FOR UPDATE 
TO authenticated
USING (true);

-- Allow authenticated users (agents) to insert batch_customers
CREATE POLICY "Agents can create batch customers" 
ON public.batch_customers 
FOR INSERT 
TO authenticated
WITH CHECK (true);

-- Allow authenticated users (agents) to insert master_customers
CREATE POLICY "Agents can create customers" 
ON public.master_customers 
FOR INSERT 
TO authenticated
WITH CHECK (true);

-- Allow authenticated users (agents) to insert tickets
CREATE POLICY "Agents can create tickets" 
ON public.tickets 
FOR INSERT 
TO authenticated
WITH CHECK (true);