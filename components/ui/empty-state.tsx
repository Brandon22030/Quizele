import { cn } from "@/lib/utils";

type EmptyStateProps = {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
};

function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 rounded-md border border-adire bg-card p-8 text-center",
        className
      )}
    >
      <div className="text-adire" aria-hidden="true">
        {icon}
      </div>
      <div className="max-w-xs space-y-2">
        <h3 className="font-display text-xl text-foreground">{title}</h3>
        <p className="text-base text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

export { EmptyState };
export type { EmptyStateProps };
