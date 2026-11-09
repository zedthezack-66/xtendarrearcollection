import { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: string | number;
  icon?: LucideIcon;
  imageSrc?: string;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  variant?: 'default' | 'success' | 'warning' | 'destructive' | 'info' | 'brand';
  subtitle?: string;
  className?: string;
}

// Large currency values are shortened (K21.71M); the full figure shows on hover.
function formatCompactValue(value: string | number): { display: string; full: string } {
  const full = String(value);
  const match = full.match(/^([A-Z]{1,3}\s?)?([\d,]+\.?\d*)$/);
  if (match) {
    const prefix = match[1] || '';
    const num = parseFloat(match[2]?.replace(/,/g, '') || '0');
    if (num >= 1_000_000) return { display: `${prefix}${(num / 1_000_000).toFixed(2)}M`, full };
    if (num >= 100_000) return { display: `${prefix}${(num / 1000).toFixed(1)}K`, full };
  }
  return { display: full, full };
}

const variantStyles = {
  default: 'bg-primary/[0.06] text-primary ring-primary/10',
  brand: 'bg-brand/10 text-brand ring-brand/20',
  success: 'bg-success/10 text-success ring-success/20',
  warning: 'bg-warning/10 text-warning ring-warning/20',
  destructive: 'bg-destructive/10 text-destructive ring-destructive/20',
  info: 'bg-info/10 text-info ring-info/20',
};

export function StatCard({ title, value, icon: Icon, imageSrc, trend, variant = 'default', subtitle, className }: StatCardProps) {
  const { display, full } = formatCompactValue(value);

  return (
    <Card className={cn("h-full p-5 transition-shadow duration-200 hover:shadow-elevated", className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium leading-tight text-muted-foreground">{title}</p>
        {(Icon || imageSrc) && (
          <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset", variantStyles[variant])}>
            {imageSrc ? <img src={imageSrc} alt="" className="h-4 w-4 object-contain" /> : Icon ? <Icon className="h-4 w-4" /> : null}
          </div>
        )}
      </div>
      <p className="num mt-3 text-[26px] font-semibold leading-none tracking-tight text-foreground" title={display !== full ? full : undefined}>
        {display}
      </p>
      {subtitle && <p className="mt-2 text-xs leading-snug text-muted-foreground">{subtitle}</p>}
      {trend && (
        <p className={cn("mt-2 text-xs font-medium", trend.isPositive ? "text-success" : "text-destructive")}>
          {trend.isPositive ? '+' : ''}{trend.value}% from last month
        </p>
      )}
    </Card>
  );
}
