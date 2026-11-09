import {
  LayoutDashboard,
  Users,
  Ticket,
  CreditCard,
  Upload,
  Settings,
  Download,
  FileText,
  Database,
  RefreshCw,
  BarChart3,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  title: string;
  url: string;
  icon: LucideIcon;
}

export interface NavSection {
  label: string;
  items: NavItem[];
  adminOnly?: boolean;
}

export const navSections: NavSection[] = [
  {
    label: "Workspace",
    items: [
      { title: "Dashboard", url: "/", icon: LayoutDashboard },
      { title: "Customers", url: "/customers", icon: Users },
      { title: "Tickets", url: "/tickets", icon: Ticket },
      { title: "Payments", url: "/payments", icon: CreditCard },
    ],
  },
  {
    label: "Reports",
    items: [
      { title: "Export Data", url: "/export", icon: Download },
      { title: "Weekly Report", url: "/reports", icon: FileText },
      { title: "Master Registry", url: "/master-registry", icon: Database },
    ],
  },
  {
    label: "Admin",
    adminOnly: true,
    items: [
      { title: "Daily Update", url: "/loan-book-sync", icon: RefreshCw },
      { title: "New Batch Import", url: "/batch/new", icon: Upload },
      { title: "Arrears Analytics", url: "/arrears-analytics", icon: BarChart3 },
    ],
  },
  {
    label: "Account",
    items: [{ title: "Settings", url: "/settings", icon: Settings }],
  },
];

// The section and page name for the top bar, from the current path.
export function findNavItem(pathname: string): { section: string; title: string } | null {
  for (const section of navSections) {
    for (const item of section.items) {
      if (item.url === "/" ? pathname === "/" : pathname === item.url || pathname.startsWith(`${item.url}/`)) {
        return { section: section.label, title: item.title };
      }
    }
  }
  return null;
}
