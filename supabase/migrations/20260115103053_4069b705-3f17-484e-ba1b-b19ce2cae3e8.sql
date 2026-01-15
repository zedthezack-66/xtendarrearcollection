-- Add agent-managed interaction outcome fields to tickets table
-- These are editable by agents/admins and stored at ticket level only

ALTER TABLE public.tickets
ADD COLUMN IF NOT EXISTS ticket_arrear_status text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS ticket_payment_status text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS employer_reason_for_arrears text DEFAULT NULL;

-- Add indexes for filtering/reporting
CREATE INDEX IF NOT EXISTS idx_tickets_ticket_arrear_status ON public.tickets(ticket_arrear_status);
CREATE INDEX IF NOT EXISTS idx_tickets_ticket_payment_status ON public.tickets(ticket_payment_status);
CREATE INDEX IF NOT EXISTS idx_tickets_employer_reason ON public.tickets(employer_reason_for_arrears);

-- Add comments for documentation
COMMENT ON COLUMN public.tickets.ticket_arrear_status IS 'Agent-managed arrears status for this ticket interaction';
COMMENT ON COLUMN public.tickets.ticket_payment_status IS 'Agent-managed payment status for this ticket interaction';
COMMENT ON COLUMN public.tickets.employer_reason_for_arrears IS 'Agent-managed employer reason for arrears';