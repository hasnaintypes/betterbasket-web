import type { ReactNode } from "react";
import Link from "next/link";

export function AuthCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-[75vh] w-full max-w-md flex-col justify-center px-6 py-12">
      <Link href="/" className="mb-8 text-sm font-semibold text-primary hover:underline">
        BetterBasket
      </Link>
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-muted-foreground">{description}</p>
      <div className="mt-8 space-y-5">{children}</div>
    </main>
  );
}
