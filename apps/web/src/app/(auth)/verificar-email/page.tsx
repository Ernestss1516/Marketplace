'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { apiFetch, ApiError } from '@/lib/api/client';

type Status = 'pending' | 'verifying' | 'success' | 'error' | 'no-token';

export default function VerificarEmailPage() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token');
  const { update } = useSession();
  const [status, setStatus] = useState<Status>(token ? 'verifying' : 'no-token');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!token) return;

    apiFetch<{ verified: boolean; accessToken: string }>('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        // Update the session if one exists, then redirect
        await update({ accessToken: res.accessToken, emailVerified: true });
        setStatus('success');
        setTimeout(() => router.push('/mis-anuncios'), 2000);
      })
      .catch((err) => {
        setErrorMsg(
          err instanceof ApiError && err.statusCode === 400
            ? 'El enlace no es válido o ha caducado. Solicita uno nuevo.'
            : 'Error inesperado. Inténtalo de nuevo.',
        );
        setStatus('error');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (status === 'no-token') {
    return (
      <div className="rounded-lg border bg-card p-8 shadow-sm text-center">
        <h1 className="mb-4 text-2xl font-bold">Confirma tu email</h1>
        <p className="text-muted-foreground">
          Te hemos enviado un enlace de verificación. Revisa tu bandeja de entrada y haz clic en
          el enlace para activar tu cuenta.
        </p>
        <p className="mt-4 text-sm text-muted-foreground">
          ¿No lo ves?{' '}
          <Link href="/login" className="hover:underline">
            Vuelve al inicio de sesión
          </Link>
        </p>
      </div>
    );
  }

  if (status === 'verifying') {
    return (
      <div className="rounded-lg border bg-card p-8 shadow-sm text-center">
        <p className="text-muted-foreground">Verificando tu email…</p>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="rounded-lg border bg-card p-8 shadow-sm text-center">
        <h1 className="mb-4 text-2xl font-bold">¡Email verificado!</h1>
        <p className="text-muted-foreground">Redirigiendo a tu cuenta…</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-8 shadow-sm text-center">
      <h1 className="mb-4 text-2xl font-bold">Enlace no válido</h1>
      <p className="mb-4 text-muted-foreground">{errorMsg}</p>
      <Link href="/login" className="text-sm hover:underline">
        Volver al inicio de sesión
      </Link>
    </div>
  );
}
