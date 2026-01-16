import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/layout/AppLayout";
import Dashboard from "./pages/Dashboard";
import Customers from "./pages/Customers";
import CustomerProfile from "./pages/CustomerProfile";
import CSVImport from "./pages/CSVImport";
import Tickets from "./pages/Tickets";
import Payments from "./pages/Payments";
import RecordPayment from "./pages/RecordPayment";
import Settings from "./pages/Settings";
import Export from "./pages/Export";
import MasterRegistry from "./pages/MasterRegistry";
import Reports from "./pages/Reports";
import LoanBookSync from "./pages/LoanBookSync";
import ArrearsAnalytics from "./pages/ArrearsAnalytics";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

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
                    <Routes>
                      <Route path="/" element={<Dashboard />} />
                      <Route path="/customers" element={<Customers />} />
                      <Route path="/customers/:id" element={<CustomerProfile />} />
                      <Route path="/batch/new" element={<CSVImport />} />
                      <Route path="/tickets" element={<Tickets />} />
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
