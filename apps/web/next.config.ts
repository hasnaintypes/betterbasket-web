import type { NextConfig } from "next";
import path from "node:path";

if (
  process.env.PAYMENTS_LIVE_MODE_ENABLED !== "true" &&
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.startsWith("pk_live_")
) {
  throw new Error("Live Stripe publishable key requires PAYMENTS_LIVE_MODE_ENABLED=true");
}

const nextConfig: NextConfig = {
  transpilePackages: ["@betterbasket/ui", "@betterbasket/auth-shared"],
  outputFileTracingRoot: path.join(__dirname, "../.."),
  images: {
    remotePatterns: [{ protocol: "https", hostname: "ik.imagekit.io" }],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
