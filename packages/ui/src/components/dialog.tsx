"use client";

import * as React from "react";
import { cn } from "../lib/utils";

/** Native modal dialog gives focus trapping, Escape handling, and an inert backdrop. */
export function Dialog({
  open,
  onOpenChange,
  title,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const titleId = React.useId();
  React.useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={() => onOpenChange(false)}
      className={cn(
        "m-auto w-full max-w-lg rounded-lg border border-border bg-background p-6 text-foreground shadow-lg backdrop:bg-black/60",
        className,
      )}
    >
      <h2 id={titleId} className="mb-4 text-lg font-semibold">
        {title}
      </h2>
      {children}
    </dialog>
  );
}
