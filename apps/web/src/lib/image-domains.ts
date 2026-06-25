export const remotePatterns = [
  { protocol: 'http' as const, hostname: 'localhost' },
  { protocol: 'https' as const, hostname: '*.r2.cloudflarestorage.com' },
];

export function isSafeSrc(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return remotePatterns.some(({ protocol: p, hostname: h }) => {
      if (p + ':' !== protocol) return false;
      // "*.foo.com" wildcard: matches any single-label subdomain
      if (h.startsWith('*.')) return hostname.endsWith(h.slice(1));
      return hostname === h;
    });
  } catch {
    return false;
  }
}
