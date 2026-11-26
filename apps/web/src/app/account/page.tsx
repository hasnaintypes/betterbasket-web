"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ChangePasswordInputSchema, ProfileInputSchema } from "@betterbasket/contracts";
import { Button } from "@betterbasket/ui/components/button";
import { Form, FormField } from "@betterbasket/ui/components/form";
import { Input } from "@betterbasket/ui/components/input";
import { useAppSession } from "@betterbasket/ui/providers/app-providers";
import { fieldErrors } from "@/lib/form-errors";
import { getAuthClient } from "@/lib/auth-client";

type OwnSession = { token: string; userAgent?: string | null; createdAt?: Date | string };

export default function AccountPage() {
  const { session, refresh } = useAppSession();
  const [name, setName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [sessions, setSessions] = useState<OwnSession[]>([]);
  const [sessionsState, setSessionsState] = useState<"loading" | "ready" | "error">("loading");
  const [profileErrors, setProfileErrors] = useState<Record<string, string>>({});
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const loadSessions = useCallback(async () => {
    setSessionsState("loading");
    try {
      const { data, error } = await getAuthClient().listSessions();
      if (error) throw error;
      setSessions(
        Array.isArray(data)
          ? data
              .filter((value) => typeof value?.token === "string")
              .map((value) => ({
                token: value.token,
                userAgent: value.userAgent,
                createdAt: value.createdAt,
              }))
          : [],
      );
      setSessionsState("ready");
    } catch {
      setSessionsState("error");
    }
  }, []);

  useEffect(() => {
    if (session.status !== "authenticated") return;
    setName(session.user.name);
    void loadSessions();
  }, [session.status, session.status === "authenticated" ? session.user.name : "", loadSessions]);

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const parsed = ProfileInputSchema.safeParse({ name });
    if (!parsed.success) {
      setProfileErrors(fieldErrors(parsed.error.issues));
      return;
    }
    setProfileErrors({});
    setBusy("profile");
    setMessage("");
    try {
      const { error } = await getAuthClient().updateUser({ name: parsed.data.name });
      if (error) throw error;
      refresh();
      setMessage("Profile updated.");
    } catch {
      setMessage("We could not update your profile. Try again.");
    } finally {
      setBusy("");
    }
  }

  async function savePassword(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const parsed = ChangePasswordInputSchema.safeParse({
      currentPassword,
      newPassword,
      confirmPassword,
    });
    if (!parsed.success) {
      setPasswordErrors(fieldErrors(parsed.error.issues));
      return;
    }
    setPasswordErrors({});
    setBusy("password");
    setMessage("");
    try {
      const { error } = await getAuthClient().changePassword({
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
        revokeOtherSessions: true,
      });
      if (error) throw error;
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage("Password updated. Other sessions have been revoked.");
      void loadSessions();
    } catch {
      setMessage("We could not change your password. Check your current password and try again.");
    } finally {
      setBusy("");
    }
  }

  async function revoke(token: string) {
    if (busy) return;
    setBusy(token);
    setMessage("");
    try {
      const { error } = await getAuthClient().revokeSession({ token });
      if (error) throw error;
      await loadSessions();
      refresh();
      setMessage("Session revoked.");
    } catch {
      setMessage("We could not revoke that session. Try again.");
    } finally {
      setBusy("");
    }
  }

  async function signOut() {
    if (busy) return;
    setBusy("sign-out");
    try {
      const { error } = await getAuthClient().signOut();
      if (error) throw error;
      refresh();
      window.location.assign("/");
    } catch {
      setMessage("We could not sign you out. Try again.");
      setBusy("");
    }
  }

  if (session.status === "loading")
    return (
      <main className="mx-auto max-w-2xl p-8" role="status">
        Loading your account…
      </main>
    );
  if (session.status === "unavailable")
    return (
      <main className="mx-auto max-w-2xl space-y-4 p-8" role="alert">
        <p>We could not load your account.</p>
        <Button onClick={refresh}>Try again</Button>
      </main>
    );
  if (session.status === "anonymous")
    return (
      <main className="mx-auto max-w-2xl space-y-4 p-8">
        <h1 className="text-3xl font-semibold">Your account</h1>
        <p>Sign in to manage your account.</p>
        <Link href="/sign-in?returnTo=%2Faccount" className="text-primary underline">
          Sign in
        </Link>
      </main>
    );
  if (session.status !== "authenticated") return null;

  return (
    <main className="mx-auto max-w-2xl space-y-10 px-6 py-12">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Your account</h1>
          <p className="mt-2 text-muted-foreground">{session.user.email}</p>
        </div>
        <Button variant="outline" onClick={signOut} disabled={Boolean(busy)}>
          {busy === "sign-out" ? "Signing out…" : "Sign out"}
        </Button>
      </div>
      {message ? (
        <p role="status" className="rounded-md border border-border p-3">
          {message}
        </p>
      ) : null}
      <section
        aria-labelledby="profile-heading"
        className="space-y-4 rounded-lg border border-border p-5"
      >
        <h2 id="profile-heading" className="text-xl font-semibold">
          Profile
        </h2>
        <Form onSubmit={saveProfile} noValidate>
          <FormField id="name" label="Name" error={profileErrors.name}>
            <Input
              id="name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-describedby={profileErrors.name ? "name-error" : undefined}
            />
          </FormField>
          <Button type="submit" disabled={Boolean(busy)}>
            {busy === "profile" ? "Saving…" : "Save name"}
          </Button>
        </Form>
      </section>
      <section
        aria-labelledby="password-heading"
        className="space-y-4 rounded-lg border border-border p-5"
      >
        <h2 id="password-heading" className="text-xl font-semibold">
          Change password
        </h2>
        <Form onSubmit={savePassword} noValidate>
          <FormField
            id="currentPassword"
            label="Current password"
            error={passwordErrors.currentPassword}
          >
            <Input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              aria-describedby={
                passwordErrors.currentPassword ? "currentPassword-error" : undefined
              }
            />
          </FormField>
          <FormField id="newPassword" label="New password" error={passwordErrors.newPassword}>
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              aria-describedby={passwordErrors.newPassword ? "newPassword-error" : undefined}
            />
          </FormField>
          <FormField
            id="confirmPassword"
            label="Confirm new password"
            error={passwordErrors.confirmPassword}
          >
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              aria-describedby={
                passwordErrors.confirmPassword ? "confirmPassword-error" : undefined
              }
            />
          </FormField>
          <Button type="submit" disabled={Boolean(busy)}>
            {busy === "password" ? "Changing…" : "Change password"}
          </Button>
        </Form>
      </section>
      <section
        aria-labelledby="sessions-heading"
        className="space-y-4 rounded-lg border border-border p-5"
      >
        <h2 id="sessions-heading" className="text-xl font-semibold">
          Active sessions
        </h2>
        {sessionsState === "loading" ? <p role="status">Loading sessions…</p> : null}
        {sessionsState === "error" ? (
          <div role="alert" className="space-y-3">
            <p>We could not load your sessions.</p>
            <Button variant="outline" onClick={() => void loadSessions()}>
              Try again
            </Button>
          </div>
        ) : null}
        {sessionsState === "ready" && sessions.length === 0 ? (
          <p>No active sessions found.</p>
        ) : null}
        {sessionsState === "ready" ? (
          <ul className="space-y-3">
            {sessions.map((item) => (
              <li
                key={item.token}
                className="flex items-center justify-between gap-4 rounded-md border border-border p-3"
              >
                <div>
                  <p className="text-sm font-medium">{item.userAgent || "Unknown device"}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.createdAt ? new Date(item.createdAt).toLocaleString() : ""}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={Boolean(busy)}
                  onClick={() => void revoke(item.token)}
                >
                  {busy === item.token ? "Revoking…" : "Revoke"}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </main>
  );
}
