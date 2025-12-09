# Customer Collection Management System

A modern web application for managing customer relationships, tracking payments, and coordinating collection efforts. Built with React, TypeScript, and Supabase.

## Overview

This system helps organizations:
- Manage customer data and batch imports via CSV
- Track payment history and outstanding balances
- Organize collection activities through a ticket system
- Monitor agent performance and collection metrics
- Generate reports and export data

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite
- **Database**: Supabase (PostgreSQL)
- **Styling**: Tailwind CSS, shadcn/ui components
- **State Management**: Zustand, React Query
- **Form Handling**: React Hook Form, Zod validation
- **Charts**: Recharts
- **Routing**: React Router v6

## Features

### Core Functionality
- **Authentication**: Secure email/password authentication with role-based access (Admin/Agent)
- **Customer Management**: Create, update, and track customer profiles with NRC numbers
- **Batch Processing**: Upload customer data in bulk via CSV files
- **Master Registry**: Unified view of all customers across all batches
- **Ticket System**: Create and track collection tickets with priority levels and status
- **Payment Recording**: Log payments with multiple payment methods (Mobile Money, Bank)
- **Reporting**: Generate comprehensive reports on collections and outstanding amounts
- **Agent Management**: Assign customers to specific agents and track their performance

### Dashboard
- Real-time statistics (total customers, outstanding balance, collected amount)
- Collection rate tracking
- Ticket status overview (Open, In Progress, Resolved)
- Agent performance metrics
- Interactive charts for data visualization

### Settings
- Configure agent names
- Manage user profiles and authentication
- System configuration

## Prerequisites

- **Node.js**: v16+ (use [nvm](https://github.com/nvm-sh/nvm) to manage versions)
- **npm** or **yarn** (comes with Node.js)
- **Git**: For cloning the repository
- **Supabase Account**: Database credentials are already configured

## Installation

### Step 1: Clone the Repository

```bash
git clone <YOUR_GIT_URL>
cd <YOUR_PROJECT_NAME>
```

### Step 2: Install Dependencies

```bash
npm install
```

This installs all required packages defined in `package.json`.

### Step 3: Environment Configuration

The project uses environment variables for Supabase connection. These are already configured in the `.env` file:

```
VITE_SUPABASE_PROJECT_ID=sqcvgzhmdmicjqftpejk
VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
VITE_SUPABASE_URL=https://sqcvgzhmdmicjqftpejk.supabase.co
```

**⚠️ Important**: Never commit `.env` to version control. The `.gitignore` file already excludes it.

### Step 4: Verify Installation

```bash
npm run build
```

This ensures all dependencies are properly installed and TypeScript compiles without errors.

## Running the Project

### Development Mode (Recommended)

```bash
npm run dev
```

This starts the Vite development server with:
- Hot module replacement (HMR) - changes appear instantly
- Source maps for easier debugging
- Development optimizations

The app typically runs on: `http://localhost:5173`

Open your browser and navigate to that URL.

### Production Build

```bash
npm run build
```

This creates an optimized production build in the `dist` folder. Files are minified and optimized for deployment.

### Preview Production Build

```bash
npm run preview
```

Preview the production build locally before deploying.

### Linting

```bash
npm run lint
```

Check for code style issues and potential bugs.

## Project Structure

```
src/
├── App.tsx                          # Main app component with routing
├── main.tsx                         # Application entry point
├── index.css                        # Global styles
├── components/
│   ├── ui/                          # shadcn/ui components (buttons, dialogs, etc.)
│   ├── layout/
│   │   ├── AppLayout.tsx           # Main layout wrapper
│   │   └── AppSidebar.tsx          # Navigation sidebar
│   ├── dashboard/
│   │   └── StatCard.tsx            # Dashboard statistics card
│   ├── ProtectedRoute.tsx          # Route protection wrapper
│   ├── BatchSelector.tsx           # Batch selection component
│   └── NavLink.tsx                 # Navigation link component
├── pages/
│   ├── Dashboard.tsx               # Dashboard overview
│   ├── Customers.tsx               # Customer list and management
│   ├── CustomerProfile.tsx         # Individual customer details
│   ├── CSVImport.tsx               # Batch import interface
│   ├── Tickets.tsx                 # Ticket management
│   ├── RecordPayment.tsx           # Payment entry form
│   ├── Payments.tsx                # Payment history
│   ├── Reports.tsx                 # Reporting interface
│   ├── MasterRegistry.tsx          # Master customer registry
│   ├── Export.tsx                  # Data export functionality
│   ├── Settings.tsx                # System settings
│   ├── Auth.tsx                    # Login/registration
│   └── NotFound.tsx                # 404 page
├── contexts/
│   └── AuthContext.tsx             # Authentication state management
├── hooks/
│   ├── useSupabaseData.ts          # Generic Supabase data fetching
│   ├── use-mobile.tsx              # Mobile viewport detection
│   └── use-toast.ts                # Toast notifications
├── store/
│   ├── useAppStore.ts              # Application state
│   └── useUIStore.ts               # UI state (sidebar, etc.)
├── integrations/
│   └── supabase/
│       ├── client.ts               # Supabase client configuration
│       └── types.ts                # Generated TypeScript types
├── lib/
│   └── utils.ts                    # Utility functions
├── types/
│   └── index.ts                    # Application type definitions
└── vite-env.d.ts                   # Vite environment types

public/
├── favicon.ico
├── robots.txt
└── placeholder.svg

supabase/
├── config.toml                     # Supabase configuration
└── migrations/                     # Database migrations

Configuration Files:
├── vite.config.ts                  # Vite bundler configuration
├── tailwind.config.ts              # Tailwind CSS configuration
├── tsconfig.json                   # TypeScript configuration
├── package.json                    # Project dependencies
├── .env                            # Environment variables (not in git)
└── .gitignore                      # Git ignore rules
```

## Database Schema

The application uses Supabase PostgreSQL database with the following main tables:

### Core Tables
- **auth.users**: Supabase authentication users
- **profiles**: User profile information
- **user_roles**: User role assignments (admin, agent)
- **master_customers**: Central customer registry with NRC as unique identifier
- **batch_customers**: Customers within specific batches
- **tickets**: Collection activity tickets
- **payments**: Payment transaction records
- **batches**: Batch import metadata
- **app_settings**: System-wide configuration

All tables have Row Level Security (RLS) enabled to ensure users can only access their authorized data.

## Authentication

The app uses Supabase email/password authentication.

### Login
1. Navigate to `/auth` (shown if not logged in)
2. Click "Sign In"
3. Enter email and password
4. Click "Sign In"

### Registration
1. Click "Don't have an account? Sign up"
2. Enter email, password, and full name
3. Click "Sign Up"
4. You'll be logged in automatically

### First-Time Setup
1. Register a new account
2. Contact an admin to set your role (admin or agent)
3. Configure agent names in Settings (admins only)

## Key Usage Flows

### Importing Customer Data

1. Go to **Batch → Import**
2. Select CSV file with customer data
3. Review the preview
4. Click "Import" to upload
5. Customers are automatically linked to master registry

**CSV Format Required**:
```
NRC Number, Name, Mobile Number, Amount Owed
123456789, John Doe, 260123456789, 5000
```

### Recording Payments

1. Go to **Payments → Record Payment**
2. Select customer from dropdown
3. Enter amount and payment method
4. Add optional notes
5. Click "Record Payment"
6. Balance automatically updates

### Managing Tickets

1. Go to **Tickets**
2. Click "Create Ticket" or select existing ticket
3. Set priority, status, and assigned agent
4. Add call notes
5. Update status as work progresses

### Viewing Reports

1. Go to **Reports**
2. Select report type and date range
3. View charts and statistics
4. Export to PDF or Excel

## Common Tasks

### Adding a New Agent

1. Admin goes to **Settings**
2. Update "Agent 1 Name", "Agent 2 Name", or "Agent 3 Name"
3. Click "Save Settings"

### Viewing Customer Profile

1. Go to **Customers**
2. Click on any customer name
3. View full profile with:
   - Payment history
   - Associated batches
   - Ticket information
   - Call notes

### Exporting Data

1. Go to **Export**
2. Select data type and filters
3. Choose export format (CSV, Excel, PDF)
4. Click "Export"
5. File downloads automatically

## Troubleshooting

### "npm: command not found"
Install Node.js from [nodejs.org](https://nodejs.org/) or use nvm:
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 18
nvm use 18
```

### Database connection errors
- Verify `.env` file exists and contains valid Supabase credentials
- Check internet connection (app needs to reach Supabase servers)
- Ensure Supabase project is active in your account

### "Port 5173 already in use"
Kill the process or use a different port:
```bash
npm run dev -- --port 3000
```

### Blank page or 404 errors
- Clear browser cache (Ctrl+Shift+Delete)
- Run `npm run build` to check for compilation errors
- Check browser console for JavaScript errors (F12)

### Login not working
- Verify email and password are correct
- Check Supabase project settings for authentication configuration
- Ensure user role is set in `user_roles` table

## Performance Tips

- The app uses React Query for intelligent data caching
- Batch imports are optimized for large CSV files
- Dashboard uses virtualized lists for rendering thousands of records
- Charts are memoized to prevent unnecessary re-renders

## Security Features

- Role-based access control (RBAC) via RLS policies
- Secure password authentication with Supabase
- No sensitive data stored in browser cache
- All API calls authenticated with JWT tokens
- HTTPS enforced in production

## Development Workflow

1. Create a feature branch: `git checkout -b feature/your-feature`
2. Make changes and test locally with `npm run dev`
3. Run linting: `npm run lint`
4. Build for production: `npm run build`
5. Commit changes: `git add . && git commit -m "description"`
6. Push to remote: `git push origin feature/your-feature`
7. Create a pull request on GitHub

## Deployment

The app can be deployed to any static hosting service:

### Vercel (Recommended)
```bash
npm install -g vercel
vercel
```

### Netlify
```bash
npm install -g netlify-cli
netlify deploy
```

### Docker
```bash
docker build -t customer-collection .
docker run -p 80:5173 customer-collection
```

## Support & Resources

- **Supabase Docs**: https://supabase.com/docs
- **React Docs**: https://react.dev
- **TypeScript Docs**: https://www.typescriptlang.org/docs
- **Tailwind CSS**: https://tailwindcss.com/docs
- **shadcn/ui**: https://ui.shadcn.com

## License

This project is proprietary software. All rights reserved.

## Contact

For questions or issues:
- Create an issue in the repository
- Contact the development team
- Check the project documentation on Lovable
