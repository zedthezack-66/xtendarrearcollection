import { useLocation } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { NotificationsInbox } from "@/components/NotificationsInbox";
import { AppSidebar } from "./AppSidebar";
import { findNavItem } from "./navigation";

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const { pathname } = useLocation();
  const current = findNavItem(pathname);

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border/70 bg-background/80 px-4 backdrop-blur-md supports-[backdrop-filter]:bg-background/65 md:px-6">
            <SidebarTrigger className="-ml-1 h-8 w-8 text-muted-foreground hover:text-foreground" />
            <Separator orientation="vertical" className="h-5" />
            {current && (
              <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
                <span className="hidden text-muted-foreground sm:inline">{current.section}</span>
                <ChevronRight className="hidden h-3.5 w-3.5 text-muted-foreground/60 sm:inline" />
                <span className="truncate font-medium text-foreground">{current.title}</span>
              </nav>
            )}
            <div className="flex-1" />
            <NotificationsInbox />
          </header>
          <div className="flex-1">
            <div key={pathname} className="mx-auto w-full max-w-[1440px] animate-fade-in px-4 py-6 md:px-8 md:py-8">
              {children}
            </div>
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
