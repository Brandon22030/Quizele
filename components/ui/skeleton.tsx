import { cn } from "@/lib/utils";

function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "motion-safe:animate-pulse rounded-sm bg-adire/20",
        className
      )}
      aria-hidden="true"
    />
  );
}

export { Skeleton };
