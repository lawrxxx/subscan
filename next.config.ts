import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async redirects() {
    // Bills used to live under /subscriptions.
    return [
      { source: "/subscriptions", destination: "/bills", permanent: true },
      { source: "/subscriptions/:id", destination: "/bills/:id", permanent: true },
    ];
  },
};

export default nextConfig;
