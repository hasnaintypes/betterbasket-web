"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAppSession } from "@betterbasket/ui/providers/app-providers";
import { AuthCard } from "@/components/auth-card";

export default function EmailVerifiedPage() {
  const { session, refresh } = useAppSession();
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    setInvalid(url.searchParams.has("error"));
    window.history.replaceState(window.history.state, "", url.pathname);
    refresh();
  }, [refresh]);

  return (
    <AuthCard
      title={invalid ? "Verification link expired" : "Email verified"}
      description={
        invalid
          ? "Request another link to verify your address."
          : "Your email address is ready to use."
      }
    >
      {invalid ? (
        <Link href="/verify-email" className="text-primary underline">
          Request a new verification link
        </Link>
      ) : session.status === "loading" ? (
        <p role="status">Checking your account…</p>
      ) : session.status === "authenticated" ? (
        <Link href="/account" className="text-primary underline">
          Go to your account
        </Link>
      ) : (
        <Link href="/sign-in" className="text-primary underline">
          Continue to sign in
        </Link>
      )}
    </AuthCard>
  );
}
