/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @bp/core and @bp/ledger use explicit .js extensions on relative imports
  // (required for their own tsx/vitest NodeNext resolution) — webpack
  // doesn't resolve those to .ts/.tsx by default.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
