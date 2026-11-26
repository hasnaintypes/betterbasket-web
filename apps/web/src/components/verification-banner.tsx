"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@betterbasket/ui/components/button";
import { useAppSession } from "@betterbasket/ui/providers/app-providers";
import { getAuthClient } from "@/lib/auth-client";

export function VerificationBanner() {
  const { session } = useAppSession();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [nextTry, setNextTry] = useState(0);

  useEffect(() => {
    if (!nextTry) return;
    const timer = window.setTimeout(() => setNextTry(0), Math.max(nextTry - Date.now(), 0));
    return () => window.clearTimeout(timer);
  }, [nextTry]);

  if (session.status !== "authenticated" || session.user.emailVerified) return null;

  async function resend() {
    if (session.status !== "authenticated" || pending || Date.now() < nextTry) return;
    setPending(true);
    setMessage("");
    try {
      const { error } = await getAuthClient().sendVerificationEmail({
        email: session.user.email,
        callbackURL: `${window.location.origin}/email-verified`,
      });
      if (error) throw error;
      setMessage("A verification link is on its way.");
      setNextTry(Date.now() + 60_000);
    } catch {
      setMessage("We could not send a link. Try again later.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-center gap-3 border-b border-border bg-warning px-4 py-2 text-sm text-warning-foreground"
    >
      <span>Verify your email to use your account.</span>
      <Button
        size="sm"
        variant="outline"
        onClick={resend}
        disabled={pending || Date.now() < nextTry}
      >
        {pending ? "Sending…" : "Resend verification"}
      </Button>
      <Link href="/verify-email" className="underline">
        More help
      </Link>
      {message ? <span role="alert">{message}</span> : null}
    </div>
  );
}
