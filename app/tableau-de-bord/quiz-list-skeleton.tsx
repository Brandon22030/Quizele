import { Skeleton } from "@/components/ui/skeleton";

export function QuizListSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className="flex flex-col justify-between gap-4 rounded-md border border-adire bg-card p-6"
        >
          <div className="space-y-3">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="size-9 rounded-sm" />
            <Skeleton className="size-9 rounded-sm" />
            <Skeleton className="size-9 rounded-sm" />
            <Skeleton className="size-9 rounded-sm rounded-sm" />
          </div>
        </div>
      ))}
    </div>
  );
}
