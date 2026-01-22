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

// Format number to compact form (K 8.85M, K 48.3K, etc.)
const formatCompact = (value: number): string => {
  const absValue = Math.abs(value);
  
  if (absValue >= 1_000_000_000) {
    return `K ${(value / 1_000_000_000).toFixed(2)}B`;
  } else if (absValue >= 1_000_000) {
    return `K ${(value / 1_000_000).toFixed(2)}M`;
  } else if (absValue >= 1_000) {
    return `K ${(value / 1_000).toFixed(1)}K`;
  } else if (absValue >= 100) {
    return `K ${value.toFixed(0)}`;
  } else {
    return value.toFixed(0);
  }
};

// Format number to full currency format (K 8,849,231)
const formatFull = (value: number): string => {
  return `K ${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
};

// Check if value is a currency/financial number that needs formatting
const isFinancialValue = (value: string | number): boolean => {
  if (typeof value === 'number') return true;
  // Check if string starts with currency symbol or contains only numbers
  const cleaned = value.toString().replace(/[K,\s]/g, '');
  return !isNaN(Number(cleaned)) && cleaned.length > 0 && Number(cleaned) >= 100;
};

// Parse value to number for formatting
const parseValue = (value: string | number): number | null => {
  if (typeof value === 'number') return value;
  const cleaned = value.toString().replace(/[K,\s]/g, '');
  const num = Number(cleaned);
  return isNaN(num) ? null : num;
};

export function StatCard({ title, value, icon: Icon, imageSrc, trend, variant = 'default' }: StatCardProps) {
  const variantStyles = {
    default: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    destructive: 'bg-destructive/10 text-destructive',
    info: 'bg-info/10 text-info',
  };

  // Determine if we should format as financial
  const numericValue = parseValue(value);
  const shouldFormat = numericValue !== null && isFinancialValue(value) && numericValue >= 100;
  
  const displayValue = shouldFormat ? formatCompact(numericValue!) : String(value);
  const fullValue = shouldFormat ? formatFull(numericValue!) : String(value);
  const showTooltip = shouldFormat && displayValue !== fullValue;

  return (
    <Card className="animate-fade-in h-full min-h-[120px]">
      <CardContent className="p-4 h-full flex flex-col justify-between">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1 flex-1 min-w-0">
            <p className="text-xs font-medium text-muted-foreground truncate">{title}</p>
            {/* KPI Value with tooltip */}
            <div className="relative group">
              <p 
                className="text-xl sm:text-2xl font-bold text-foreground whitespace-nowrap overflow-hidden"
                style={{ fontSize: 'clamp(1rem, 4vw, 1.5rem)' }}
              >
                {displayValue}
              </p>
              {/* CSS-only tooltip */}
              {showTooltip && (
                <div className="absolute left-0 top-full mt-2 z-50 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 ease-in-out">
                  <div className="bg-foreground text-background px-3 py-2 rounded-lg shadow-lg text-sm font-semibold whitespace-nowrap">
                    {fullValue}
                  </div>
                  {/* Tooltip arrow */}
                  <div className="absolute left-4 -top-1 w-2 h-2 bg-foreground rotate-45" />
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
