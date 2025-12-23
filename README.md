Loan Collections & Arrears Management System

A modern web application for managing loan arrears, customer follow-ups, payments, and agent performance.
Built to replace manual Excel-based tracking with a centralized, role-based system optimized for free-tier infrastructure.

📌 Overview

The system enables arrears portfolios to be uploaded via CSV, automatically generates follow-up tickets, tracks payments and call activity, and provides clear visibility into agent performance.

First registered user → Admin

Subsequent users → Agents

Agents see only their assigned clients

Admin sees full system performance

Designed for small to mid-sized arrears teams operating under cost constraints.

✨ Key Features

Role-based access control (Admin / Agent)

Batch-based CSV arrears uploads

Automatic ticket creation

Centralized customer master registry

Payment tracking with computed balances

Call notes and ticket status history

Agent-level dashboards and analytics

Safe, chunked batch deletion

CSV & PDF reporting

🎯 Target Scale (Free Tier)

Optimized for:

~2,500 customers

~2,000–2,500 tickets

7 agents

7 active batches (1 per agent)

Scaling beyond this requires paid infrastructure.

🧱 Tech Stack
Frontend

React

TypeScript

Vite

Tailwind CSS

shadcn-ui

Backend

Supabase (PostgreSQL, Auth, Storage)

Row Level Security (RLS)

Hosting

Lovable (development & publishing)

Vercel (free tier)

🗂️ Project Structure
src/
 ├─ components/        # Reusable UI components
 ├─ pages/             # Application pages
 ├─ hooks/             # Custom hooks
 ├─ contexts/          # Auth & global context
 ├─ store/             # Client-side state
 ├─ integrations/      # Supabase client & types
 ├─ lib/               # Utilities
 └─ types/             # Shared TypeScript types


Database migrations:

supabase/
 └─ migrations/

📥 CSV Import Rules
Required Columns

customer_name

nrc

mobile

amount_owed

assigned_agent

Import Behavior

Chunked (≤500 rows)

Customers matched by NRC

Agent name must match an existing profile

Invalid rows rejected with clear errors

Existing tickets, payments, and notes are preserved

🔐 Roles & Access Control
Admin

View all customers, batches, tickets, and payments

Access per-agent analytics

Delete batches

Reset database

Agent

View only assigned batches and customers

Manage tickets, payments, and call notes

⚠️ All permissions are enforced via Supabase RLS, not frontend filtering.

⚡ Performance & Stability

Pagination enforced on all lists

Indexed queries only

KPIs computed via SQL views / RPCs

No full-table loads in the frontend

Safe concurrent multi-agent usage

🧪 Development
Local Setup
npm install
npm run dev

Editing via Lovable

Open the project in Lovable

Prompt changes directly

All updates auto-commit to the repository

🚧 Current Status

Functional prototype running locally

Core workflows implemented

Multi-user support partially resolved

Optimized for free-tier constraints

🛣️ Next Steps (MVP)

Finalize multi-agent concurrency handling

Complete automated PDF/CSV reporting

Prepare production deployment

Validate performance with full batch loads

Plan scaling strategy beyond free tier

🎯 Purpose

To replace manual Excel-based arrears tracking with a reliable, auditable, and efficient system that improves agent productivity and management visibility—without increasing operational costs.