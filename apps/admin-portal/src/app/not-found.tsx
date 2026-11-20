import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-muted-foreground">The page you requested is unavailable.</p>
      <Link href="/" className="underline">
        Return home
      </Link>
    </main>
  );
}
