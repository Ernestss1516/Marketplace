import type { NextConfig } from 'next';
import { remotePatterns } from './src/lib/image-domains';

const nextConfig: NextConfig = {
  // react-markdown, remark-gfm and rehype-sanitize are ESM-only packages.
  // transpilePackages ensures Webpack can bundle them without module-type errors.
  transpilePackages: ['react-markdown', 'remark-gfm', 'rehype-sanitize'],
  images: { remotePatterns },
};

export default nextConfig;
