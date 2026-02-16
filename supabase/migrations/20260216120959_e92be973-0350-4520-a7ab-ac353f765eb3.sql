
-- Drop the old agent SELECT policy that filters by recorded_by
DROP POLICY IF EXISTS "Agents see own payments" ON public.payments;

-- Create new policy: agents see payments on tickets assigned to them
CREATE POLICY "Agents see payments on assigned tickets"
ON public.payments
FOR SELECT
USING (
  recorded_by = auth.uid()
  OR
  ticket_id IN (
    SELECT id FROM public.tickets WHERE assigned_agent = auth.uid()
  )
);
