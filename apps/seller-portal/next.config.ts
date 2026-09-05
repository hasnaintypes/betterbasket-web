import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@betterbasket/ui"],
  images: {
    remotePatterns: [{ protocol: "https", hostname: "ik.imagekit.io" }],
  },
};

export default nextConfig;
