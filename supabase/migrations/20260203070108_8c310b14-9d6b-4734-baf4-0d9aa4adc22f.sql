
-- Fix tickets_status_check to include Pending Confirmation status
ALTER TABLE tickets
DROP CONSTRAINT IF EXISTS tickets_status_check;

ALTER TABLE tickets
ADD CONSTRAINT tickets_status_check
CHECK (
  status IN (
    'Open',
    'In Progress',
    'Resolved',
    'Pending Confirmation'
  )
);
