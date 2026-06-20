'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h2 className="text-2xl font-bold">Algo salió mal</h2>
      <button
        onClick={reset}
        className="text-primary underline underline-offset-4"
      >
        Intentar de nuevo
      </button>
    </div>
  );
}
