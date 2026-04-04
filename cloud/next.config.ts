import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Pin the Turbopack root to the cloud package so Next.js doesn't get
  // confused by the root package-lock.json and pnpm-workspace.yaml above.
  turbopack: {
    root: path.resolve(__dirname),
  },
  webpack: (config) => {
    config.externals.push('pino-pretty', 'lokijs', 'encoding');
    return config;
  },
  // Packages used by server-only connector routes — skip bundling, use Node require()
  serverExternalPackages: ['ethers', 'tweetnacl', '@noble/hashes'],
};

export default nextConfig;
