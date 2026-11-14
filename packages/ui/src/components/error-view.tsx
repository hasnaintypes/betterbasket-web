"use client";

import { ApiError } from "@betterbasket/api-client";
import { Button } from "./button";

export function ErrorView({ error, reset }: { error: Error; reset: () => void }) {
  const requestId =
    "requestId" in error && typeof error.requestId === "string" ? error.requestId : null;
  return (
    <main
      role="alert"
      className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-start justify-center gap-4 p-8"
    >
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="text-muted-foreground">
        {error instanceof ApiError
          ? error.message
          : "Please try again. If the problem continues, contact support."}
      </p>
      {requestId ? <p className="font-mono text-sm">Request ID: {requestId}</p> : null}
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
