-- Drop the existing movement_type check constraint
ALTER TABLE arrears_sync_logs
DROP CONSTRAINT IF EXISTS arrears_sync_logs_movement_type_check;

-- Add updated constraint with ALL movement types including existing data values
ALTER TABLE arrears_sync_logs
ADD CONSTRAINT arrears_sync_logs_movement_type_check
CHECK (
  movement_type IN (
    'Cleared', 'cleared', 'CLEARED',
    'Reduced', 'reduced', 'REDUCED',
    'Increased', 'increased', 'INCREASED',
    'Maintained', 'maintained', 'MAINTAINED',
    'Reopened', 'reopened', 'REOPENED',
    'blocked_reopen', 'Blocked_Reopen', 'BLOCKED_REOPEN',
    'Updated', 'updated', 'UPDATED',
    'Not Found', 'not_found', 'NOT_FOUND'
  )
);