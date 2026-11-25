import { makeAuthClient } from "@betterbasket/auth-shared/client";

let client: ReturnType<typeof makeAuthClient> | undefined;

export function getAuthClient() {
  if (client) return client;
  const baseURL = process.env.NEXT_PUBLIC_API_URL;
  if (!baseURL) throw new Error("NEXT_PUBLIC_API_URL is required for account actions");
  client = makeAuthClient(baseURL);
  return client;
}
