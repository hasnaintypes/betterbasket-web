import { Skeleton } from "@betterbasket/ui/components/skeleton";

export default function ProductsLoading() {
  return (
    <main aria-label="Loading products" className="mx-auto max-w-6xl space-y-8 px-6 py-12">
      <span className="sr-only">Loading products</span>
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-32 w-full" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="aspect-square rounded-2xl" />
        ))}
      </div>
    </main>
  );
}
