
## Goal

Repurpose the CSV upload "Arrear Status" column into a numeric **Days In Arrears** field, persist it on each ticket, display it prominently in ticket views, and add a bucketed filter on the Tickets page (0–30, 31–90, 91–120, 121–180, 180+).

## Important scoping note

The project has **two different "arrear" fields** today and we must not confuse them:

1. **`tickets.ticket_arrear_status`** (text) — agent-managed locked dropdown (`Non-paying`, `Settled`, etc. in `TicketStatusDropdowns.tsx`). **This is NOT being changed.** Per the locked-dropdown memory, agent interaction statuses must remain untouched.
2. **`master_customers.arrear_status` / `batch_customers.arrear_status`** (text) — comes from the CSV upload "Arrear Status" column. **This is what gets renamed/repurposed** into a numeric `days_in_arrears` value on each ticket.

The `tickets.days_in_arrears` column already exists in the schema but is never populated from CSV imports today — we'll start populating it.

## Changes

### 1. CSV Import (`src/pages/CSVImport.tsx`) — Create / Add to / Update batch

- Rename the parsed CSV header from `Arrear Status` to `Days In Arrears` (also accept legacy `Arrear Status` and `days_in_arrears` headers as fallback so older templates don't break).
- Replace `arrearStatus = cleanString(row['Arrear Status'])` with `daysInArrears = parseDaysInArrears(row['Days In Arrears'] ?? row['Arrear Status'])`.
  - Helper validates: integer ≥ 0; non-numeric/empty → `null` (per fault-tolerance rule).
- Update `ParsedRow` typing: drop `arrearStatus`, add `daysInArrears: number | null`.
- Update the SAMPLE_CSV string and the on-screen template legend to show `Days In Arrears` instead of `Arrear Status`.
- Stop writing `arrear_status` from CSV onto `master_customers` and `batch_customers`. Instead:
  - Write `days_in_arrears` onto every newly inserted **ticket** row.
  - On Update-Existing-Batch, update `tickets.days_in_arrears` when a value is provided.
- Leave the existing `arrear_status` columns in the database alone (no migration / no destructive change) — they simply stop being written from CSV. Existing data remains queryable.

### 2. Tickets list page (`src/pages/Tickets.tsx`)

- Add a new **Days In Arrears** column in the table (positioned next to Amount Owed) showing the numeric value with a colored badge by bucket:
  - 0–30 → green, 31–90 → yellow, 91–120 → orange, 121–180 → red, 180+ → dark red, `null` → muted dash.
- Add a `daysInArrearsFilter` Select with options `all | 0-30 | 31-90 | 91-120 | 121-180 | 180+`.
  - Persist to `localStorage` under `tickets_days_arrears` (consistent with the existing filter-persistence pattern).
- Apply the bucket filter in the existing `useMemo` filter pipeline alongside search/status/priority/agent.
- Filtering is purely client-side over the already-fetched `tickets` array — respects the ≤500-row guardrail and existing RLS.

### 3. Ticket detail page (`src/pages/TicketDetail.tsx`)

- Add **Days In Arrears** as a prominent stat in the "Ticket Details" card (next to Priority), rendered as a colored badge using the same bucket coloring helper.
- Show `—` when `null`.

### 4. Customer profile (`src/pages/CustomerProfile.tsx`)

- Where each customer ticket is listed, show `Days In Arrears` next to the amount, using the same badge helper. Read-only.

### 5. Shared helper

- New `src/lib/daysInArrears.ts` exporting:
  - `getDaysInArrearsBucket(days: number | null): '0-30' | '31-90' | '91-120' | '121-180' | '180+' | null`
  - `getDaysInArrearsBadgeClass(days: number | null): string` (Tailwind classes for each bucket)
  - Used by Tickets list, Ticket detail, Customer profile.

### 6. Export (`src/pages/Export.tsx`)

- Add a **Days In Arrears** column to ticket-row exports (numeric). Keep existing `Arrear Status` text column for backward compatibility with historical data.

## Out of scope (explicitly NOT changed)

- The agent dropdown `ticket_arrear_status` (locked options) and its UI in `TicketStatusDropdowns.tsx` remain exactly as they are.
- No DB schema changes required (column `tickets.days_in_arrears` already exists).
- RLS policies, batch deletion, sync logic, and all other behavior unchanged.

## Verification checklist

- Upload a CSV with `Days In Arrears` values (and a few blank / "#N/A" rows). Confirm tickets are created with the correct numeric value and blanks become `null`.
- Re-upload using the legacy header `Arrear Status` with numeric values — still parsed (graceful fallback).
- On Tickets page, each bucket filter narrows the list correctly; filter persists across navigation.
- Ticket detail and Customer profile show the colored Days In Arrears badge.
- Existing `ticket_arrear_status` dropdown and saved values are untouched.
