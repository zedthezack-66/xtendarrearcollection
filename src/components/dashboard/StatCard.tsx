import { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
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
  variant?: 'default' | 'success' | 'warning' | 'destructive' | 'info';
}

// Format large currency values compactly while preserving precision
function formatCompactValue(value: string | number): { display: string; full: string } {
  const strValue = String(value);
  const full = strValue;
  
  // Check if it's a currency value (starts with K or contains currency symbols)
  const currencyMatch = strValue.match(/^([A-Z]{1,3}\s?)?([\d,]+\.?\d*)$/);
  if (currencyMatch) {
    const prefix = currencyMatch[1] || '';
    const numStr = currencyMatch[2]?.replace(/,/g, '') || '0';
    const num = parseFloat(numStr);
    
    if (num >= 1000000) {
      return { display: `${prefix}${(num / 1000000).toFixed(2)}M`, full };
    } else if (num >= 10000) {
      return { display: `${prefix}${(num / 1000).toFixed(1)}K`, full };
    }
  }
  
  return { display: strValue, full };
}

export function StatCard({ title, value, icon: Icon, imageSrc, trend, variant = 'default' }: StatCardProps) {
  const variantStyles = {
    default: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    destructive: 'bg-destructive/10 text-destructive',
    info: 'bg-info/10 text-info',
  };

  const { display, full } = formatCompactValue(value);
  const showTooltip = display !== full;

  return (
    <Card className="animate-fade-in h-full min-h-[120px]">
      <CardContent className="p-4 h-full flex flex-col justify-between">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1 flex-1 min-w-0">
            <p className="text-xs font-medium text-muted-foreground leading-tight">{title}</p>
            <div className="relative group">
              <p 
                className="text-lg md:text-xl font-bold text-foreground leading-tight"
                style={{ wordBreak: 'keep-all' }}
              >
                {display}
              </p>
              {showTooltip && (
                <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 z-50 hidden group-hover:block">
                  <div className="bg-foreground text-background text-xs px-2 py-1 rounded shadow-lg whitespace-nowrap">
                    {full}
                  </div>
                </div>
              )}
            </div>
            {trend && (
              <p className={cn(
                "text-xs font-medium",
                trend.isPositive ? "text-success" : "text-destructive"
              )}>
                {trend.isPositive ? '+' : ''}{trend.value}% from last month
              </p>
            )}
          </div>
          <div className={cn("p-2 rounded-lg shrink-0", variantStyles[variant])}>
            {imageSrc ? (
              <img src={imageSrc} alt={title} className="h-4 w-4 object-contain" />
            ) : Icon ? (
              <Icon className="h-4 w-4" />
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
