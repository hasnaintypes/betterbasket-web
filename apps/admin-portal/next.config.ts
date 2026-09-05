import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  transpilePackages: ["@betterbasket/ui", "@betterbasket/auth-shared"],
  outputFileTracingRoot: path.join(__dirname, "../.."),
};

export default nextConfig;
