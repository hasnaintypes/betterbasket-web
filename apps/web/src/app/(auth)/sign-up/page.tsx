"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { SignUpInputSchema } from "@betterbasket/contracts";
import { Button } from "@betterbasket/ui/components/button";
import { Form, FormField } from "@betterbasket/ui/components/form";
import { Input } from "@betterbasket/ui/components/input";
import { AuthCard } from "@/components/auth-card";
import { fieldErrors } from "@/lib/form-errors";
import { getAuthClient } from "@/lib/auth-client";

export default function SignUpPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const parsed = SignUpInputSchema.safeParse({ name, email, password, confirmPassword });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    setMessage("");
    setPending(true);
    try {
      const { error } = await getAuthClient().signUp.email({
        name: parsed.data.name,
        email: parsed.data.email,
        password: parsed.data.password,
        callbackURL: `${window.location.origin}/email-verified`,
      });
      if (error) throw error;
      setSent(true);
      setPassword("");
      setConfirmPassword("");
    } catch {
      setMessage("We could not create the account. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthCard title="Create your account" description="Shop with independent sellers.">
      {sent ? (
        <div role="status" className="rounded-md border border-border bg-card p-4">
          Check your email for a verification link. If you already have an account, you can sign in.
        </div>
      ) : (
        <Form onSubmit={submit} noValidate>
          <FormField id="name" label="Name" error={errors.name}>
            <Input
              id="name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              aria-describedby={errors.name ? "name-error" : undefined}
            />
          </FormField>
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
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              aria-describedby={errors.password ? "password-error" : undefined}
            />
          </FormField>
          <FormField id="confirmPassword" label="Confirm password" error={errors.confirmPassword}>
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              aria-describedby={errors.confirmPassword ? "confirmPassword-error" : undefined}
            />
          </FormField>
          {message ? (
            <p role="alert" className="text-sm text-destructive">
              {message}
            </p>
          ) : null}
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Creating account…" : "Create account"}
          </Button>
        </Form>
      )}
      <p className="text-sm">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium text-primary underline">
          Sign in
        </Link>
      </p>
    </AuthCard>
  );
}
