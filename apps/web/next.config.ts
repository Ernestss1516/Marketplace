import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';
import { remotePatterns } from './src/lib/image-domains';

const nextConfig: NextConfig = {
  // react-markdown, remark-gfm and rehype-sanitize are ESM-only packages.
  // transpilePackages ensures Webpack can bundle them without module-type errors.
  transpilePackages: ['react-markdown', 'remark-gfm', 'rehype-sanitize'],
  images: { remotePatterns },
};

export default withSentryConfig(nextConfig, {
  // Suppress Sentry build output; source maps are not uploaded (no auth token
  // needed). Client-side init is injected automatically from
  // sentry.client.config.ts; server-side init stays in instrumentation.ts.
  silent: true,
  telemetry: false,
});
