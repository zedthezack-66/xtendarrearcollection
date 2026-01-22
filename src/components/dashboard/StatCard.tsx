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

export function StatCard({ title, value, icon: Icon, imageSrc, trend, variant = 'default' }: StatCardProps) {
  const variantStyles = {
    default: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    destructive: 'bg-destructive/10 text-destructive',
    info: 'bg-info/10 text-info',
  };

  return (
    <Card className="animate-fade-in h-full min-h-[120px]">
      <CardContent className="p-4 h-full flex flex-col justify-between">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1 flex-1 min-w-0">
            <p className="text-xs font-medium text-muted-foreground truncate">{title}</p>
            <p className="text-xl font-bold text-foreground truncate" title={String(value)}>{value}</p>
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
