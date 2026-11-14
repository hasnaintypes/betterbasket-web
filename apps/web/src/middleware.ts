import { NextResponse, type NextRequest } from "next/server";
import { cspPolicy } from "@betterbasket/ui/security/csp";

export function middleware(request: NextRequest) {
  const nonce = crypto.randomUUID();
  const policy = cspPolicy(nonce, process.env.NEXT_PUBLIC_API_URL, "web");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy-Report-Only", policy);
  return response;
}

export const config = { matcher: "/((?!_next/static|_next/image|favicon.ico).*)" };
