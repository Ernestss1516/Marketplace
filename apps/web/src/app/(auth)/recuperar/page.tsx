'use client';

import { useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api/client';

export default function RecuperarPage() {
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const data = new FormData(e.currentTarget);
    await apiFetch('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: data.get('email') }),
    }).catch(() => {});
    // Always show confirmation — never reveal if email exists
    setSent(true);
    setLoading(false);
  }

  if (sent) {
    return (
      <div className="rounded-lg border bg-card p-8 shadow-sm text-center">
        <h1 className="mb-4 text-2xl font-bold">Revisa tu email</h1>
        <p className="text-muted-foreground">
          Si el email está registrado, recibirás un enlace para restablecer tu contraseña en
          los próximos minutos.
        </p>
        <Link href="/login" className="mt-4 block text-sm hover:underline">
          Volver al inicio de sesión
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-8 shadow-sm">
      <h1 className="mb-6 text-2xl font-bold">Recuperar contraseña</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Introduce tu email y te enviaremos un enlace para restablecer tu contraseña.
      </p>
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
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? 'Enviando…' : 'Enviar enlace'}
        </button>
      </form>
      <p className="mt-4 text-center text-sm">
        <Link href="/login" className="text-muted-foreground hover:underline">
          Volver al inicio de sesión
        </Link>
      </p>
    </div>
  );
}
