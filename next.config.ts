import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async redirects() {
    // Routes from earlier versions (bills and statements are gone). Temporary, so
    // browsers don't cache them: some older permanent redirects pointed at these.
    const home = ["/subscriptions/:p*", "/bills/:p*", "/payments/:p*", "/pay/:p*", "/review", "/onboarding", "/ask", "/agent"];
    return [
      ...home.map((source) => ({ source, destination: "/", permanent: false })),
      { source: "/spending", destination: "/history", permanent: false },
      { source: "/activity", destination: "/history", permanent: false },
      { source: "/activity/:id", destination: "/history", permanent: false },
      { source: "/autopilot", destination: "/payment-wallet", permanent: false },
      { source: "/wallet/:id", destination: "/history", permanent: false },
    ];
  },
};

export default nextConfig;
