import { Brain, FlaskConical, History, LayoutDashboard, ScrollText, Users, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Second key of the `g` then <key> shortcut. */
  key: string;
  crumb: string;
}

export const NAV: NavItem[] = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard, key: "o", crumb: "Command center" },
  { href: "/incidents", label: "Incidents", icon: History, key: "i", crumb: "Decisions & timeline" },
  { href: "/scenarios", label: "Scenario Lab", icon: FlaskConical, key: "s", crumb: "Attack & compare" },
  { href: "/tenants", label: "Tenants", icon: Users, key: "t", crumb: "Policies & quotas" },
  { href: "/predictor", label: "Predictor", icon: Brain, key: "p", crumb: "Forecast & lead time" },
  { href: "/audit", label: "Audit", icon: ScrollText, key: "a", crumb: "Every automated action" },
];

export function navFor(path: string): NavItem | undefined {
  return NAV.find((n) => path === n.href || path.startsWith(n.href + "/"));
}
