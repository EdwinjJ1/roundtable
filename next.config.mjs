/** @type {import('next').NextConfig} */
const nextConfig = {
  // E2E starts a second dev server while contributors may already have their
  // normal server open. Separate build output prevents the two Next processes
  // from invalidating each other's manifests and active page compilations.
  distDir: process.env.ROUNDTABLE_NEXT_DIST_DIR || '.next',
  // The server modules use ESM-style `.js` extensions on relative imports
  // (e.g. `../db/index.js`). tsc/tsx/vitest resolve those to `.ts`; webpack does
  // not by default — teach it to, so route handlers can import `@/server/*`.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
