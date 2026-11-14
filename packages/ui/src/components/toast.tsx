import * as React from "react";
import { cn } from "../lib/utils";

export function Toast({
  title,
  description,
  onDismiss,
  className,
}: {
  title: string;
  description?: string;
  onDismiss?: () => void;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn("rounded-md border border-border bg-background p-4 shadow-md", className)}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-medium">{title}</p>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss notification"
            className="text-sm underline"
          >
            Close
          </button>
        ) : null}
      </div>
    </div>
  );
}
