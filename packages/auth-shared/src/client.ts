import { createAuthClient } from "better-auth/client";
import { organizationClient, adminClient, jwtClient } from "better-auth/client/plugins";

/**
 * Shared Better Auth browser client used by all three Next.js apps
 * (web, seller-portal, admin-portal). Each app just does:
 *
 *   export const authClient = makeAuthClient(process.env.NEXT_PUBLIC_AUTH_URL!);
 */
export function makeAuthClient(baseURL: string) {
  return createAuthClient({
    baseURL,
    plugins: [organizationClient(), adminClient(), jwtClient()],
  });
}

export type AuthClient = ReturnType<typeof makeAuthClient>;
