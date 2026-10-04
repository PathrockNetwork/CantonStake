const skipBuildChecks = process.env.SKIP_BUILD_CHECKS === "true";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Build workers share the production host with Canton. Bound their fan-out
  // instead of deriving it from every CPU exposed by Docker.
  experimental: { cpus: 1 },
  // Standalone output bundles only the runtime deps Next actually traces
  // through the import graph, dropping the production image's node_modules
  // from ~1 GB to ~150 MB. Cuts deploy push time and cold-start RAM.
  output: "standalone",
  // All artwork is served directly (the brand mark already uses unoptimized).
  // Disable the unused image-processing endpoint as defense in depth while
  // the Next.js major-version security migration is pending.
  images: { unoptimized: true },
  // `scripts/build-frontends.sh` runs TypeScript once before starting the
  // mainnet and testnet builds in parallel. One-off builds keep Next's
  // validation enabled because SKIP_BUILD_CHECKS defaults to false.
  eslint: { ignoreDuringBuilds: skipBuildChecks },
  typescript: { ignoreBuildErrors: skipBuildChecks },
  // Route documents must be revalidated after a deployment so an open wallet
  // flow cannot keep loading an older SDK bundle and reconnecting an expired
  // ticket. Hashed assets under /_next/static retain Next's immutable cache.
  async headers() {
    const documentRoutes = [
      "/",
      "/analytics",
      "/dashboard",
      "/portfolio",
      "/positions",
      "/rewards",
      "/settings",
      "/stake",
      "/stake/liquid",
    ];

    return documentRoutes.map((source) => ({
      source,
      headers: [
        {
          key: "Cache-Control",
          value: "no-store, max-age=0, must-revalidate",
        },
      ],
    }));
  },
};

module.exports = nextConfig;
