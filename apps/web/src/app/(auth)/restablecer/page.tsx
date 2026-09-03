'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch, ApiError } from '@/lib/api/client';

export default function RestablecerPage() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const data = new FormData(e.currentTarget);
    const newPassword = data.get('password') as string;
    const confirm = data.get('confirm') as string;

    if (newPassword !== confirm) {
      setError('Las contraseñas no coinciden.');
      setLoading(false);
      return;
    }

    try {
      await apiFetch('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, newPassword }),
      });
      router.push('/login?verified=1');
    } catch (err) {
      setError(
        err instanceof ApiError && err.statusCode === 400
          ? 'El enlace no es válido o ha caducado. Solicita uno nuevo.'
          : 'Error inesperado. Inténtalo de nuevo.',
      );
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="rounded-lg border bg-card p-8 shadow-sm text-center">
        <h1 className="mb-4 text-2xl font-bold">Enlace no válido</h1>
        <p className="mb-4 text-muted-foreground">
          El enlace de restablecimiento no es válido.
        </p>
        <Link href="/recuperar" className="text-sm hover:underline">
          Solicitar un nuevo enlace
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-8 shadow-sm">
      <h1 className="mb-6 text-2xl font-bold">Nueva contraseña</h1>
      {error && (
        <p className="mb-4 rounded bg-destructive-subtle p-3 text-sm text-destructive-strong">{error}</p>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="password">
            Nueva contraseña
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <p className="mt-1 text-xs text-muted-foreground">Mínimo 8 caracteres</p>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="confirm">
            Repite la contraseña
          </label>
          <input
            id="confirm"
            name="confirm"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? 'Guardando…' : 'Restablecer contraseña'}
        </button>
      </form>
    </div>
  );
}
