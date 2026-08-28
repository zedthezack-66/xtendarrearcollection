# Plan: Make Call Notes Permanent (Customer-Centric)

## Problem
Call notes currently die with the ticket: `safe_delete_batch` and `hard_delete_ticket` run `DELETE FROM call_logs`, so every monthly batch replacement wipes valuable call history. Notes should belong to the **customer/loan**, not the temporary ticket.

## Approach
Keep every call log forever by *detaching* it from its ticket (instead of deleting it) when a batch or ticket is removed. The log stays linked to the customer via `master_customer_id`, `loan_id`, `nrc_number`, and `customer_name` — columns that already exist on `call_logs`.

## Changes

### 1. Database migration
- **`safe_delete_batch`**: replace `DELETE FROM call_logs WHERE ticket_id = ANY(...)` with `UPDATE call_logs SET ticket_id = NULL WHERE ticket_id = ANY(...)` (same chunking). Return count renamed/kept for UI compatibility (report as "archived" notes).
- **`hard_delete_ticket`**: same change — detach (`ticket_id = NULL`) instead of delete.
- **RLS on `call_logs`**: extend the agent SELECT policy so an agent can also read detached logs whose `master_customer_id` belongs to a customer currently assigned to them (keeps history visible after re-import next month). Insert/update rules unchanged.
- `clear_all_data` (full admin reset) intentionally still wipes everything — unchanged.

### 2. Note capture (frontend)
- Verify every call-log insert populates `master_customer_id`, `loan_id`, `nrc_number`, `customer_name` so detached notes remain identifiable (schema already supports these fields).

### 3. Ticket Detail page (`src/pages/TicketDetail.tsx`)
- Fetch call history by `master_customer_id` instead of `ticket_id`, so the full customer history (including notes from previous/deleted batches) shows on the current ticket.
- Label notes from earlier batches subtly (e.g. "Previous batch").

### 4. Customer Profile page
- Show the complete call-history timeline for the customer (all batches, all time).

### 5. Dashboard recent-notes
- Keep existing behavior; notes now persist across batch cycles automatically.

## Technical details
- `call_logs.ticket_id` becomes nullable-in-practice (FK stays; we only null it before the ticket row is deleted, so no FK violation).
- No new tables, no new UI libraries, no data migration needed for existing rows (they already carry `master_customer_id`).
- Deletion RPC responses keep the same JSON keys so the deletion-progress UI doesn't break.

## Result
Deleting a batch or ticket never loses a call note again; when the customer reappears in next month's import, their full call history is right there on the new ticket.
