import { LogOut, Shield } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { BatchSelector } from "@/components/BatchSelector";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { navSections } from "./navigation";

const getInitials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

export function BrandMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <div
      className={`${className} flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[hsl(30_100%_58%)] to-[hsl(20_92%_48%)] text-white shadow-brand`}
    >
      <svg viewBox="0 0 24 24" className="h-[55%] w-[55%]" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </div>
  );
}

const groupLabel = "px-3 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-sidebar-foreground/40";

export function AppSidebar() {
  const { profile, userRole, signOut, isAdmin } = useAuth();
  const { isMobile, setOpen, setOpenMobile } = useSidebar();
  // Choosing a page closes the panel so the page gets the full screen; the Menu button reopens it.
  const closePanel = () => (isMobile ? setOpenMobile(false) : setOpen(false));
  const fullName = profile?.display_name || profile?.full_name || "User";

  return (
    <Sidebar className="border-r-0">
      <SidebarHeader className="px-4 pb-3 pt-5">
        <div className="flex items-center gap-3">
          <BrandMark />
          <div className="leading-tight">
            <p className="text-[15px] font-semibold tracking-tight text-white">Xtenda</p>
            <p className="text-xs text-sidebar-foreground/55">Arrears Collections</p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-1 px-2">
        <SidebarGroup className="py-2">
          <SidebarGroupLabel className={groupLabel}>Active batch</SidebarGroupLabel>
          <SidebarGroupContent className="px-1 pt-1">
            <BatchSelector />
          </SidebarGroupContent>
        </SidebarGroup>

        {navSections
          .filter((section) => !section.adminOnly || isAdmin)
          .map((section) => (
            <SidebarGroup key={section.label} className="py-1.5">
              <SidebarGroupLabel className={groupLabel}>{section.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="gap-0.5">
                  {section.items.map((item) => (
                    <SidebarMenuItem key={item.url}>
                      <NavLink
                          to={item.url}
                          end={item.url === "/"}
                          onClick={closePanel}
                          className="group/nav relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-white"
                          activeClassName="bg-sidebar-accent text-white before:absolute before:left-0 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:bg-sidebar-primary [&>svg]:text-sidebar-primary"
                        >
                          <item.icon className="h-[18px] w-[18px] shrink-0 text-sidebar-foreground/50 transition-colors group-hover/nav:text-white" />
                          <span className="truncate">{item.title}</span>
                        </NavLink>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
      </SidebarContent>

      <SidebarFooter className="p-3">
        <div className="flex items-center gap-3 rounded-xl border border-sidebar-border bg-sidebar-accent/60 p-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-xs font-semibold text-white">
            {getInitials(fullName) || "U"}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">{fullName}</p>
            <p className="flex items-center gap-1 text-xs capitalize text-sidebar-foreground/55">
              {isAdmin && <Shield className="h-3 w-3 text-sidebar-primary" />}
              {userRole || "Agent"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={signOut}
            aria-label="Sign out"
            className="h-8 w-8 text-sidebar-foreground/55 hover:bg-white/10 hover:text-white"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
