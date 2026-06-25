import * as Sentry from '@sentry/nextjs';

// Server-side observability: captures errors from Server Components, Route
// Handlers, Server Actions and Middleware (Node.js runtime only).
// Client-side (browser) errors are captured via sentry.client.config.ts +
// global-error.tsx (added in RD.1).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV ?? 'development',
    });
  }
}

// Captures errors from nested React Server Components (Next.js 15+).
export const onRequestError = Sentry.captureRequestError;
