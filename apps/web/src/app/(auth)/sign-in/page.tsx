"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { SignInInputSchema } from "@betterbasket/contracts";
import { Button } from "@betterbasket/ui/components/button";
import { Form, FormField } from "@betterbasket/ui/components/form";
import { Input } from "@betterbasket/ui/components/input";
import { useAppSession } from "@betterbasket/ui/providers/app-providers";
import { AuthCard } from "@/components/auth-card";
import { fieldErrors } from "@/lib/form-errors";
import { getAuthClient } from "@/lib/auth-client";
import { safeReturnTo } from "@/lib/return-to.mjs";

export default function SignInPage() {
  const { refresh } = useAppSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const parsed = SignInInputSchema.safeParse({ email, password });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    setMessage("");
    setPending(true);
    try {
      const { error } = await getAuthClient().signIn.email(parsed.data);
      if (error) throw error;
      refresh();
      window.location.assign(
        safeReturnTo(new URLSearchParams(window.location.search).get("returnTo")),
      );
    } catch {
      setMessage("We could not sign you in. Check your details and try again.");
      setPassword("");
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthCard title="Sign in" description="Welcome back to BetterBasket.">
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
        <FormField id="password" label="Password" error={errors.password}>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            aria-describedby={errors.password ? "password-error" : undefined}
          />
        </FormField>
        {message ? (
          <p role="alert" className="text-sm text-destructive">
            {message}
          </p>
        ) : null}
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </Form>
      <div className="flex justify-between gap-4 text-sm">
        <Link href="/forgot-password" className="text-primary underline">
          Forgot password?
        </Link>
        <Link href="/sign-up" className="text-primary underline">
          Create account
        </Link>
      </div>
    </AuthCard>
  );
}
