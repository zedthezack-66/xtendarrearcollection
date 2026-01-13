-- Add policy for agents to update their own call_logs
CREATE POLICY "Agents can update own call_logs" 
ON public.call_logs 
FOR UPDATE 
USING (agent_id = auth.uid())
WITH CHECK (agent_id = auth.uid());