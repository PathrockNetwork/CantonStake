/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output bundles only the runtime deps Next actually traces
  // through the import graph, dropping the production image's node_modules
  // from ~1 GB to ~150 MB. Cuts deploy push time and cold-start RAM.
  output: "standalone",
};

module.exports = nextConfig;
