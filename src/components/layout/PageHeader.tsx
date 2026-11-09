import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Small label above the title, e.g. the section or a status. */
  eyebrow?: React.ReactNode;
  /** Buttons or indicators shown on the right. */
  actions?: React.ReactNode;
  className?: string;
}

// The title block every page starts with.
export function PageHeader({ title, description, eyebrow, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0 space-y-1">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-[28px] md:leading-9">{title}</h1>
        {description && <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>}
    </div>
  );
}
