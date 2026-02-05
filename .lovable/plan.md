

# Daily Loan Book Update - Payment Creation for Collections

## Problem Statement

The current Daily Loan Book Update correctly updates `amount_owed` and `outstanding_balance`, but **does not create payment records**. This means:

- When arrears are cleared (15,000 to 0), the K15,000 recovered does NOT appear in "Total Collected"
- When arrears are reduced (15,000 to 5,000), the K10,000 recovered does NOT appear in "Total Collected"
- Dashboard KPIs are inaccurate because they only count agent-recorded payments

## Solution

Add a `source` column to the `payments` table and create payment records for cleared/reduced movements during loan book sync.

---

## Implementation Plan

### Phase 1: Database Schema Update

**Add `source` column to payments table:**

```text
payments table
+------------------+
| ...existing...   |
| source (text)    |  <- NEW: 'system_manual' | 'loanbook_daily'
+------------------+
```

- Default: `'system_manual'` (backward compatible - all existing payments become manual)
- Check constraint: `source IN ('system_manual', 'loanbook_daily')`

### Phase 2: Update RPC Functions

**Modify `process_loan_book_sync` (global sync):**

When movement is CLEARED or REDUCED:
1. Create a payment record with:
   - `amount` = difference (old - new)
   - `source` = 'loanbook_daily'
   - `payment_method` = 'Loan Book Reconciliation'
   - `customer_name` from master_customers
   - `ticket_id` if ticket exists
2. This payment will automatically be included in Total Collected calculations

**Modify `process_daily_loan_book_update` (batch-specific sync):**

Same payment creation logic for CLEARED and REDUCED movements.

### Phase 3: Template Enhancement

**Update template download to include "Old Arrears":**

Current template columns:
- NRC Number
- Amount Owed (empty)
- Days in Arrears (empty)
- Last Payment Date (empty)

New template columns:
- NRC Number
- Old Arrears Amount (pre-filled from current `amount_owed`)
- New Arrears Amount (empty - admin fills from external loan book)
- Days in Arrears (empty)
- Last Payment Date (empty)

The admin workflow:
1. Download template (system fills NRC + Old Arrears from database)
2. Open in Excel alongside external loan book
3. Fill in "New Arrears Amount" from external source
4. Upload back to system

### Phase 4: Dashboard Verification

**Existing `get_dashboard_stats` already sums ALL payments:**

```sql
v_total_collected := SUM(p.amount) FROM payments p ...
```

Since it sums all payments, adding `loanbook_daily` payments will:
- Increase Total Collected
- Decrease Total Outstanding (because Outstanding = Owed - Collected)

**Update `get_collections_by_agent` for agent KPIs:**

Add filter: `WHERE source = 'system_manual'`

This ensures agent performance metrics only show their manual collections, not loan book reconciliations.

---

## Movement Logic Summary

```text
+---------------+-------------------+-----------------------------------+
| Condition     | Movement Type     | Payment Created?                  |
+---------------+-------------------+-----------------------------------+
| Old>0, New=0  | CLEARED           | YES: amount = Old                 |
|               |                   | source = loanbook_daily           |
|               |                   | Ticket -> Resolved                |
+---------------+-------------------+-----------------------------------+
| Old>New>0     | REDUCED           | YES: amount = (Old - New)         |
|               |                   | source = loanbook_daily           |
|               |                   | Ticket stays current status       |
+---------------+-------------------+-----------------------------------+
| New>Old       | INCREASED         | NO payment                        |
|               |                   | Just increase outstanding         |
+---------------+-------------------+-----------------------------------+
| Old=New       | MAINTAINED        | NO changes                        |
+---------------+-------------------+-----------------------------------+
| Old=0, New>0  | REOPENED          | NO payment                        |
|               |                   | Ticket -> In Progress             |
+---------------+-------------------+-----------------------------------+
```

---

## Files to Change

| File | Change |
|------|--------|
| `supabase/migrations/NEW.sql` | Add `source` column to payments, update both RPC functions |
| `src/pages/LoanBookSync.tsx` | Update template download to include Old Arrears column |
| `src/pages/CSVImport.tsx` | Update Daily Loan Book Update mode to use new format |

---

## Technical Details (for implementation)

### SQL Migration

```sql
-- Add source column to payments
ALTER TABLE payments 
ADD COLUMN IF NOT EXISTS source text DEFAULT 'system_manual';

-- Add constraint
ALTER TABLE payments
ADD CONSTRAINT payments_source_check 
CHECK (source IN ('system_manual', 'loanbook_daily'));

-- Update RPC to create payments for cleared/reduced
-- (in process_loan_book_sync and process_daily_loan_book_update)
INSERT INTO payments (
  ticket_id, master_customer_id, customer_name,
  amount, payment_method, source, notes, recorded_by
) VALUES (
  v_ticket_id, v_customer_id, v_customer_name,
  v_old_arrears - v_new_arrears, -- difference is the "collected" amount
  'Loan Book Reconciliation',
  'loanbook_daily',
  'Daily loan book sync - arrears ' || v_movement_type,
  v_admin_id
);
```

### Template CSV Format

```text
NRC Number,Old Arrears Amount,New Arrears Amount,Days in Arrears,Last Payment Date
123456/10/1,15000,,, 
234567/20/2,8500,,,
345678/30/3,0,,,
```

Admin fills the "New Arrears Amount" column from their external loan book.

---

## Expected Outcome

After implementation:

1. **Cleared account (15,000 → 0):**
   - Creates K15,000 payment (source = loanbook_daily)
   - Total Collected increases by K15,000
   - Total Outstanding decreases by K15,000
   - Ticket marked as Resolved

2. **Reduced account (15,000 → 5,000):**
   - Creates K10,000 payment (source = loanbook_daily)
   - Total Collected increases by K10,000
   - Outstanding shows K5,000
   - Ticket stays In Progress

3. **Agent KPIs:**
   - Only show payments with source = system_manual
   - Loan book collections don't inflate agent performance

4. **Dashboard accuracy:**
   - Total Collected = Agent collections + Loan book collections
   - Outstanding = Amount Owed - Total Collected

