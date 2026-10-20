import type { NextConfig } from "next";
import path from "node:path";

const apiOrigin = (process.env.API_ORIGIN ?? "http://127.0.0.1:8109").replace(/\/$/, "");

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  allowedDevOrigins: ["127.0.0.1"],
  // Keep native Windows builds usable alongside Docker and the development tools.
  experimental: { ...(process.platform === "win32" ? {cpus:2} : {}), serverActions:{bodySizeLimit:"3mb"} },
  async rewrites() {
    return {
      fallback: [{ source: "/api/:path*", destination: `${apiOrigin}/:path*` }],
    };
  },
};

export default nextConfig;
