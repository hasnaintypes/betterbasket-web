"use client";

import { ErrorView } from "@betterbasket/ui/components/error-view";

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <ErrorView error={error} reset={reset} />
      </body>
    </html>
  );
}
