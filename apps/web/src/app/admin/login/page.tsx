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
    <div className="flex min-h-screen items-center justify-center bg-background px-4" data-zona="login">
      {/* E6 — la misma entrada que el acceso de usuario. Los dos logins comparten el
          REGISTRO DE IMPACTO, que es lo que el §5.3 proponía compartir; lo que no
          comparten es la PALETA (éste es oscuro y aquél claro), y esa distinción se
          decidió en E5 mirándola, no dentro del mecanismo. */}
      <div className="entra-escalonado w-full max-w-sm rounded-lg border bg-card p-8 shadow-xl">
        <h1 className="mb-1 text-lg font-semibold text-card-foreground">Administración</h1>
        <p className="mb-6 text-sm text-muted-foreground">Acceso restringido al panel.</p>

        {error && (
          <p className="mb-4 rounded-md border border-destructive-border bg-destructive-subtle p-3 text-sm text-destructive-strong">
            {error}
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground" htmlFor="password">
              Contraseña
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
