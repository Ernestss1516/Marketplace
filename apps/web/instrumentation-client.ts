import * as Sentry from '@sentry/nextjs';

// Captures browser errors: React hydration failures, unhandled rejections,
// clicks that throw, etc. Empty DSN → SDK deactivates silently (dev/test).
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV ?? 'development',
});

// Instruments client-side navigations (route transitions).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
