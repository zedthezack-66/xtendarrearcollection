import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
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
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AppLayout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/customers/:id" element={<CustomerProfile />} />
            <Route path="/customers/import" element={<CSVImport />} />
            <Route path="/tickets" element={<Tickets />} />
            <Route path="/payments" element={<Payments />} />
            <Route path="/payments/new" element={<RecordPayment />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/export" element={<Export />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AppLayout>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
