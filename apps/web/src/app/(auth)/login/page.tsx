'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { signIn } from 'next-auth/react';

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const verified = params.get('verified') === '1';
  const callbackUrl = params.get('callbackUrl') ?? '/mis-anuncios';

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const data = new FormData(e.currentTarget);

    const result = await signIn('credentials', {
      email: data.get('email'),
      password: data.get('password'),
      redirect: false,
    });

    if (result?.error) {
      setError('Email o contraseña incorrectos.');
    } else {
      router.push(callbackUrl);
      router.refresh();
    }
    setLoading(false);
  }

  return (
    <div className="rounded-lg border bg-card p-8 shadow-sm">
      <h1 className="mb-6 text-2xl font-bold">Iniciar sesión</h1>
      {verified && (
        <p className="mb-4 rounded bg-green-50 p-3 text-sm text-green-700">
          Email verificado correctamente. Ya puedes iniciar sesión.
        </p>
      )}
      {error && (
        <p className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="password">
            Contraseña
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? 'Entrando…' : 'Iniciar sesión'}
        </button>
      </form>
      <div className="mt-4 flex justify-between text-sm">
        <Link href="/recuperar" className="text-muted-foreground hover:underline">
          ¿Olvidaste tu contraseña?
        </Link>
        <Link href="/registro" className="text-muted-foreground hover:underline">
          Crear cuenta
        </Link>
      </div>
    </div>
  );
}
