import { Skeleton } from "@betterbasket/ui/components/skeleton";

export default function Loading() {
  return (
    <main aria-label="Loading page" className="mx-auto max-w-4xl space-y-4 p-8">
      <span className="sr-only">Loading page</span>
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
    </main>
  );
}
