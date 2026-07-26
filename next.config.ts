import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // sharp needs native binaries, so image processing and storage signing must run
  // on the Node runtime — never Edge. See research.md D5.
  serverExternalPackages: ['sharp'],

  images: {
    // Every visitor-facing image is fetched through the publication-gated /img route
    // (FR-009a). Both storage buckets are private, so no remote pattern is configured:
    // adding one would create a second path to image bytes that skips the gate.
    remotePatterns: [],
    // Widths the /img route is prepared to serve.
    deviceSizes: [320, 480, 640, 828, 1080, 1280, 1920],
  },
};

export default nextConfig;
