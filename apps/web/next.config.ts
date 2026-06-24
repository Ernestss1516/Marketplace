import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // react-markdown, remark-gfm and rehype-sanitize are ESM-only packages.
  // transpilePackages ensures Webpack can bundle them without module-type errors.
  transpilePackages: ['react-markdown', 'remark-gfm', 'rehype-sanitize'],
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost' },
      { protocol: 'https', hostname: '*.r2.cloudflarestorage.com' },
    ],
  },
};

export default nextConfig;
