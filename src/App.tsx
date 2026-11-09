import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/layout/AppLayout";
import Auth from "./pages/Auth";
import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";

// Each page downloads only when it's first opened, so the app starts without loading every page and library.
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Customers = lazy(() => import("./pages/Customers"));
const CustomerProfile = lazy(() => import("./pages/CustomerProfile"));
const CSVImport = lazy(() => import("./pages/CSVImport"));
const Tickets = lazy(() => import("./pages/Tickets"));
const TicketDetail = lazy(() => import("./pages/TicketDetail"));
const Payments = lazy(() => import("./pages/Payments"));
const RecordPayment = lazy(() => import("./pages/RecordPayment"));
const Settings = lazy(() => import("./pages/Settings"));
const Export = lazy(() => import("./pages/Export"));
const MasterRegistry = lazy(() => import("./pages/MasterRegistry"));
const Reports = lazy(() => import("./pages/Reports"));
const LoanBookSync = lazy(() => import("./pages/LoanBookSync"));
const ArrearsAnalytics = lazy(() => import("./pages/ArrearsAnalytics"));
const NotFound = lazy(() => import("./pages/NotFound"));

// Data loaded in the last minute is reused when moving between pages instead of being fetched again.
// Saving a payment, note or status still refreshes the affected lists straight away.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

const PageLoading = () => (
  <div className="flex min-h-[50vh] items-center justify-center">
    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route
              path="/*"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <Suspense fallback={<PageLoading />}>
                    <Routes>
                      <Route path="/" element={<Dashboard />} />
                      <Route path="/customers" element={<Customers />} />
                      <Route path="/customers/:id" element={<CustomerProfile />} />
                      <Route path="/batch/new" element={<ProtectedRoute requireAdmin><CSVImport /></ProtectedRoute>} />
                      <Route path="/tickets" element={<Tickets />} />
                      <Route path="/tickets/:id" element={<TicketDetail />} />
                      <Route path="/payments" element={<Payments />} />
                      <Route path="/payments/new" element={<RecordPayment />} />
                      <Route path="/settings" element={<Settings />} />
                      <Route path="/export" element={<Export />} />
                      <Route path="/master-registry" element={<MasterRegistry />} />
                      <Route path="/reports" element={<Reports />} />
                      <Route path="/loan-book-sync" element={<LoanBookSync />} />
                      <Route path="/arrears-analytics" element={<ArrearsAnalytics />} />
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                    </Suspense>
                  </AppLayout>
                </ProtectedRoute>
              }
            />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
