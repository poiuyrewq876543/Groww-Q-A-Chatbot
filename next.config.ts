import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/chat": ["./config/prompts/**"],
  },
};

export default nextConfig;
