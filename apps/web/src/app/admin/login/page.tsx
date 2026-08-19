'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { resolveCallbackUrl } from '@/lib/auth/callback-url';

// Deliberadamente fuera de (admin) y (public): no hereda el chrome del
// backoffice (AdminNav/AdminUserBar, exige rol de staff) ni el del sitio
// público (Header/Footer). Estilo propio, sobrio — es la puerta de entrada,
// no puede depender de nada que a su vez dependa de estar ya autenticado.
// Sin botón de Google: el backend ya rechaza el login social para ADMIN
// (RÁFAGA 3), esto es solo que la UI no lo ofrezca aquí tampoco.
export default function AdminLoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = resolveCallbackUrl(params.get('callbackUrl'), '/admin');

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const data = new FormData(e.currentTarget);

    // Provider separado ('admin-credentials') — pega contra
    // POST /auth/admin-login, nunca contra /auth/login (que rechaza a los
    // ADMIN). result.code solo puede ser 'admin_login_not_admin' — un
    // AdminOnlyError deliberado (ver lib/auth/index.ts) — o el genérico
    // "CredentialsSignin" de cualquier otro fallo (credenciales incorrectas,
    // cuenta bloqueada, suspendida...); ambos casos, igual que en /login,
    // solo distinguen DESPUÉS de que Auth.js ya intentó validar la
    // contraseña en el backend.
    //
    // ROLES R4 — esta puerta ya NO es solo de ADMIN: la usan EDITOR, MODERATOR y
    // ADMIN. El código `admin_login_not_admin` conserva su nombre (es un
    // identificador estable que viaja desde el backend hasta aquí), pero desde R4
    // significa «no eres del equipo del backoffice» — sólo lo recibe un USER.
    const result = await signIn('admin-credentials', {
      email: data.get('email'),
      password: data.get('password'),
      redirect: false,
    });

    if (result?.code === 'admin_login_not_admin') {
      setError('Esta entrada es solo para el equipo del backoffice.');
    } else if (result?.error) {
      setError('Email o contraseña incorrectos.');
    } else {
      router.push(callbackUrl);
      router.refresh();
    }
    setLoading(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-800 bg-slate-900 p-8 shadow-xl">
        <h1 className="mb-1 text-lg font-semibold text-slate-100">Administración</h1>
        <p className="mb-6 text-sm text-slate-400">Acceso restringido al panel.</p>

        {error && (
          <p className="mb-4 rounded-md border border-red-900 bg-red-950/60 p-3 text-sm text-red-300">
            {error}
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300" htmlFor="password">
              Contraseña
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-slate-100 px-4 py-2 text-sm font-medium text-slate-900 transition-colors hover:bg-white disabled:opacity-50"
          >
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
