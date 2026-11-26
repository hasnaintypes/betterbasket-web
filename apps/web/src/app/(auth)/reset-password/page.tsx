"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ResetPasswordInputSchema } from "@betterbasket/contracts";
import { Button } from "@betterbasket/ui/components/button";
import { Form, FormField } from "@betterbasket/ui/components/form";
import { Input } from "@betterbasket/ui/components/input";
import { AuthCard } from "@/components/auth-card";
import { fieldErrors } from "@/lib/form-errors";
import { getAuthClient } from "@/lib/auth-client";

export default function ResetPasswordPage() {
  const processed = useRef(false);
  const [token, setToken] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;
    const url = new URL(window.location.href);
    const value = url.searchParams.get("token");
    const hasError = url.searchParams.has("error");
    window.history.replaceState(window.history.state, "", url.pathname);
    setToken(value);
    setInvalid(hasError || !value);
    setReady(true);
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending || !token) return;
    const parsed = ResetPasswordInputSchema.safeParse({ password, confirmPassword });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    setMessage("");
    setPending(true);
    try {
      const { error } = await getAuthClient().resetPassword({
        newPassword: parsed.data.password,
        token,
      });
      if (error) throw error;
      setToken(null);
      setPassword("");
      setConfirmPassword("");
      setDone(true);
    } catch {
      setMessage("This link may have expired. Request a new link and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthCard title="Choose a new password" description="Use at least 12 characters.">
      {!ready ? <p role="status">Checking your link…</p> : null}
      {ready && invalid ? <p role="alert">This link is invalid or expired.</p> : null}
      {done ? <p role="status">Your password has been changed. You can sign in now.</p> : null}
      {ready && token && !invalid && !done ? (
        <Form onSubmit={submit} noValidate>
          <FormField id="password" label="New password" error={errors.password}>
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
          <FormField
            id="confirmPassword"
            label="Confirm new password"
            error={errors.confirmPassword}
          >
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
            {pending ? "Changing password…" : "Change password"}
          </Button>
        </Form>
      ) : null}
      <div className="flex gap-4 text-sm">
        <Link href="/forgot-password" className="text-primary underline">
          Request a new link
        </Link>
        <Link href="/sign-in" className="text-primary underline">
          Sign in
        </Link>
      </div>
    </AuthCard>
  );
}
