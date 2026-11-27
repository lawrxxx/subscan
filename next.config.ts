import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async redirects() {
    // Old routes from earlier versions.
    return [
      { source: "/subscriptions", destination: "/payments", permanent: true },
      { source: "/subscriptions/:id", destination: "/payments/:id", permanent: true },
      { source: "/bills", destination: "/payments", permanent: true },
      { source: "/bills/:id", destination: "/payments/:id", permanent: true },
      { source: "/activity", destination: "/spending", permanent: true },
      { source: "/activity/:id", destination: "/wallet/:id", permanent: true },
      { source: "/agent", destination: "/ask", permanent: true },
    ];
  },
};

export default nextConfig;
