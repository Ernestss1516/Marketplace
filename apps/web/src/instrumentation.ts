// Server-side observability: captures errors from Server Components, Route
// Handlers, Server Actions and Middleware (Node.js runtime only).
// Client-side (browser) errors are out of scope for RT.6 — they would require
// a separate init with NEXT_PUBLIC_SENTRY_DSN and a client config file.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const Sentry = await import('@sentry/nextjs');
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV ?? 'development',
    });
  }
}
