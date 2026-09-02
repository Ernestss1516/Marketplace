export const remotePatterns = [
  { protocol: 'http' as const, hostname: 'localhost' },
  // Desarrollo local en Windows: S3_PUBLIC_URL apunta a 127.0.0.1, no a
  // localhost, porque Node resuelve localhost a ::1 y el reenvío IPv6 de Docker
  // Desktop corta la conexión al primer byte (ECONNRESET) — el fetch de
  // /_next/image contra MinIO fallaba con 500. Ver CLAUDE.md. Sin esta entrada
  // next/image rechazaría el dominio de las imágenes servidas por MinIO.
  { protocol: 'http' as const, hostname: '127.0.0.1' },
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
