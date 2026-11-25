"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ForgotPasswordInputSchema } from "@betterbasket/contracts";
import { Button } from "@betterbasket/ui/components/button";
import { Form, FormField } from "@betterbasket/ui/components/form";
import { Input } from "@betterbasket/ui/components/input";
import { AuthCard } from "@/components/auth-card";
import { fieldErrors } from "@/lib/form-errors";
import { getAuthClient } from "@/lib/auth-client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const parsed = ForgotPasswordInputSchema.safeParse({ email });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    setMessage("");
    setPending(true);
    try {
      const { error } = await getAuthClient().requestPasswordReset({
        email: parsed.data.email,
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setSent(true);
    } catch {
      setMessage("We could not process the request. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthCard
      title="Reset your password"
      description="We will email a reset link if the account exists."
    >
      {sent ? (
        <p role="status" className="rounded-md border border-border bg-card p-4">
          Check your email for a reset link. You can request another link if needed.
        </p>
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
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Sending…" : sent ? "Send another link" : "Send reset link"}
        </Button>
      </Form>
      <Link href="/sign-in" className="text-sm text-primary underline">
        Back to sign in
      </Link>
    </AuthCard>
  );
}
