'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { signIn } from 'next-auth/react';
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton';
import { Separator } from '@/components/ui/separator';
import { resolveCallbackUrl } from '@/lib/auth/callback-url';

// Codes set by our signIn callback (auth.config.ts) when it redirects back here after a
// failed Google sign-in — see the comment there for why the exchange returns a redirect
// string instead of throwing.
const GOOGLE_ERROR_MESSAGES: Record<string, string> = {
  google_unverified_email:
    'No pudimos verificar tu email con Google. Inicia sesión con tu contraseña.',
  google_error: 'No se pudo iniciar sesión con Google. Inténtalo de nuevo.',
  admin_google_blocked: 'Las cuentas de administración deben iniciar sesión con contraseña.',
};

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const verified = params.get('verified') === '1';
  // Nunca confiar en el query param tal cual — es input del atacante en
  // potencia (enlace a /login?callbackUrl=https://evil.com). Validado UNA vez
  // aquí; tanto el submit de credentials como GoogleSignInButton usan este
  // mismo valor ya seguro.
  const callbackUrl = resolveCallbackUrl(params.get('callbackUrl'));
  const googleErrorCode = params.get('error');

  const [error, setError] = useState(
    googleErrorCode
      ? (GOOGLE_ERROR_MESSAGES[googleErrorCode] ?? 'No se pudo iniciar sesión. Inténtalo de nuevo.')
      : '',
  );
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

    // result.code solo se distingue del genérico "credenciales incorrectas"
    // DESPUÉS de que Auth.js ya intentó validar la contraseña contra el
    // backend — nunca antes (ver AdminMustUseAdminLoginError en lib/auth).
    if (result?.code === 'admin_must_use_admin_login') {
      setError('Las cuentas de administración deben iniciar sesión en /admin/login.');
    } else if (result?.error) {
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
        <p className="mb-4 rounded bg-success p-3 text-sm text-success-foreground">
          Email verificado correctamente. Ya puedes iniciar sesión.
        </p>
      )}
      {error && (
        <p className="mb-4 rounded bg-destructive-subtle p-3 text-sm text-destructive-strong">{error}</p>
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
      <div className="my-6 flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-xs text-muted-foreground">o</span>
        <Separator className="flex-1" />
      </div>
      <GoogleSignInButton callbackUrl={callbackUrl} />
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
