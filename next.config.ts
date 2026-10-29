import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
  serverExternalPackages: ["jwks-rsa"],
  async rewrites() {
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    if (!projectId) return [];

    return [{
      source: "/__/auth/:path*",
      destination: `https://${projectId}.firebaseapp.com/__/auth/:path*`,
    }];
  },
};

export default nextConfig;
