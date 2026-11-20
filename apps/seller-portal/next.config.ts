import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
  transpilePackages: ["@betterbasket/ui", "@betterbasket/auth-shared"],
  outputFileTracingRoot: path.join(__dirname, "../.."),
  images: {
    remotePatterns: [{ protocol: "https", hostname: "ik.imagekit.io" }],
  },
};

export default nextConfig;
