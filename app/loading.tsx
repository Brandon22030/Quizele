import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6">
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-4 w-48" />
    </div>
  );
}
