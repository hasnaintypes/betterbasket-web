"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError, createApiClient } from "@betterbasket/api-client";
import { Button } from "../components/button";

type ApiClient = ReturnType<typeof createApiClient>;
type SessionState =
  | { status: "loading" | "anonymous" | "unavailable"; user: null }
  | { status: "authenticated"; user: { id: string; email: string } };

const SessionContext = React.createContext<{
  api: ApiClient | null;
  session: SessionState;
  refresh: () => void;
} | null>(null);

export function useAppSession() {
  const context = React.useContext(SessionContext);
  if (!context) throw new Error("useAppSession must be used within AppProviders");
  return context;
}

export function AppProviders({ children, apiUrl }: { children: React.ReactNode; apiUrl?: string }) {
  const [queryClient] = React.useState(() => new QueryClient());
  const api = React.useMemo(() => (apiUrl ? createApiClient({ baseUrl: apiUrl }) : null), [apiUrl]);
  const [session, setSession] = React.useState<SessionState>({ status: "loading", user: null });
  const refresh = React.useCallback(() => {
    if (!api) {
      setSession({ status: "unavailable", user: null });
      return;
    }
    setSession({ status: "loading", user: null });
    api
      .get<unknown>("/api/auth/get-session", { auth: false, credentials: "include" })
      .then((value) => {
        const user = value && typeof value === "object" && "user" in value ? value.user : null;
        if (
          user &&
          typeof user === "object" &&
          "id" in user &&
          "email" in user &&
          typeof user.id === "string" &&
          typeof user.email === "string"
        ) {
          setSession({ status: "authenticated", user: { id: user.id, email: user.email } });
        } else {
          setSession({ status: "anonymous", user: null });
        }
      })
      .catch((error: unknown) => {
        setSession({
          status: error instanceof ApiError && error.status === 401 ? "anonymous" : "unavailable",
          user: null,
        });
      });
  }, [api]);
  React.useEffect(() => refresh(), [refresh]);

  return (
    <QueryClientProvider client={queryClient}>
      <SessionContext.Provider value={{ api, session, refresh }}>
        {session.status === "unavailable" ? (
          <div
            role="alert"
            className="flex items-center justify-between gap-4 border-b border-border bg-warning px-4 py-2 text-sm text-warning-foreground"
          >
            <span>We could not reach the account service.</span>
            <Button variant="outline" size="sm" onClick={refresh}>
              Retry
            </Button>
          </div>
        ) : null}
        {children}
      </SessionContext.Provider>
    </QueryClientProvider>
  );
}
