'use client';
import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

// Root-level error boundary for the App Router. Required by @sentry/nextjs to
// capture React render errors that escape all nested error.tsx boundaries.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="es">
      <body>
        <div style={{ padding: '2rem', textAlign: 'center', fontFamily: 'sans-serif' }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>
            Algo ha ido mal
          </h1>
          <p style={{ color: '#666', marginBottom: '1.5rem' }}>
            Se ha producido un error inesperado.
          </p>
          <button
            onClick={reset}
            style={{
              padding: '0.5rem 1.5rem',
              border: '1px solid #ccc',
              borderRadius: '0.375rem',
              cursor: 'pointer',
            }}
          >
            Reintentar
          </button>
        </div>
      </body>
    </html>
  );
}
