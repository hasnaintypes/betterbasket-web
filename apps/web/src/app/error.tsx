"use client";

import { ErrorView } from "@betterbasket/ui/components/error-view";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return <ErrorView error={error} reset={reset} />;
}
