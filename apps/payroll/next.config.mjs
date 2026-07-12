/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // pdfkit reads its built-in font metrics (.afm files) from disk relative
  // to its own package at runtime — webpack bundling breaks that path
  // resolution, so it must run un-bundled via native `require`.
  serverExternalPackages: ["pdfkit", "fontkit"],
  // @bp/core, @bp/ledger, and @bp/rules use explicit .js extensions on
  // relative imports (required for their own tsx/vitest NodeNext
  // resolution) — webpack doesn't resolve those to .ts/.tsx by default.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
