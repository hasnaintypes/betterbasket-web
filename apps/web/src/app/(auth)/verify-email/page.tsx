"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ForgotPasswordInputSchema } from "@betterbasket/contracts";
import { Button } from "@betterbasket/ui/components/button";
import { Form, FormField } from "@betterbasket/ui/components/form";
import { Input } from "@betterbasket/ui/components/input";
import { AuthCard } from "@/components/auth-card";
import { fieldErrors } from "@/lib/form-errors";
import { getAuthClient } from "@/lib/auth-client";

export default function VerifyEmailPage() {
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [nextTry, setNextTry] = useState(0);

  useEffect(() => {
    if (!nextTry) return;
    const timer = window.setTimeout(() => setNextTry(0), Math.max(nextTry - Date.now(), 0));
    return () => window.clearTimeout(timer);
  }, [nextTry]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending || Date.now() < nextTry) return;
    const parsed = ForgotPasswordInputSchema.safeParse({ email });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    setMessage("");
    setPending(true);
    try {
      const { error } = await getAuthClient().sendVerificationEmail({
        email: parsed.data.email,
        callbackURL: `${window.location.origin}/email-verified`,
      });
      if (error) throw error;
      setSent(true);
      setNextTry(Date.now() + 60_000);
    } catch {
      setMessage("We could not send a new link. Please try again later.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthCard title="Verify your email" description="Check your inbox for the link we sent you.">
      {sent ? (
        <p role="status">If this address needs verification, a new link is on its way.</p>
      ) : null}
      <Form onSubmit={submit} noValidate>
        <FormField id="email" label="Email" error={errors.email}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            aria-describedby={errors.email ? "email-error" : undefined}
          />
        </FormField>
        {message ? (
          <p role="alert" className="text-sm text-destructive">
            {message}
          </p>
        ) : null}
        <Button type="submit" disabled={pending || Date.now() < nextTry} className="w-full">
          {pending ? "Sending…" : "Resend verification link"}
        </Button>
      </Form>
      <Link href="/sign-in" className="text-sm text-primary underline">
        Back to sign in
      </Link>
    </AuthCard>
  );
}
