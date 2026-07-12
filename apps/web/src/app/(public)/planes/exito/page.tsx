'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { CheckCircle, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getMyEntitlements, type MyEntitlement } from '@/lib/api/billing';
import { buildLoginUrl } from '@/lib/auth/callback-url';

export default function PlanesExitoPage() {
  const { data: session, status: sessionStatus } = useSession();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id');

  const [entitlements, setEntitlements] = useState<MyEntitlement[] | null>(null);
  const [checking, setChecking] = useState(false);

  const token = session?.user.accessToken;

  const check = useCallback(async () => {
    if (!token) return;
    setChecking(true);
    try {
      const result = await getMyEntitlements(token);
      setEntitlements(result);
    } catch {
      setEntitlements([]);
    } finally {
      setChecking(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) check();
  }, [token, check]);

  const isPro =
    entitlements != null &&
    entitlements.some((e) => e.type === 'PRO_SUBSCRIPTION' && !e.revokedAt);

  // While Next-Auth resolves the session
  if (sessionStatus === 'loading') {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-muted-foreground">Verificando tu cuenta…</p>
      </div>
    );
  }

  // Not logged in — unlikely (they just paid) but handled gracefully
  if (sessionStatus === 'unauthenticated') {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center">
        <h1 className="text-2xl font-bold">¡Gracias por tu compra!</h1>
        <p className="text-muted-foreground">
          Inicia sesión para activar tu suscripción Pro.
        </p>
        <Button asChild>
          <Link href={buildLoginUrl('/perfil/suscripcion')}>Iniciar sesión</Link>
        </Button>
      </div>
    );
  }

  // Pro already active
  if (isPro) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center">
        <CheckCircle className="h-14 w-14 text-primary" />
        <h1 className="text-3xl font-bold">¡Ya eres Pro!</h1>
        <p className="text-muted-foreground">
          Tu suscripción Plan Pro está activa. Disfruta de todas las ventajas.
        </p>
        {sessionId && (
          <p className="text-xs text-muted-foreground">Referencia: {sessionId}</p>
        )}
        <div className="flex gap-3">
          <Button asChild>
            <Link href="/perfil/suscripcion">Ver mi suscripción</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/publicar">Publicar anuncio</Link>
          </Button>
        </div>
      </div>
    );
  }

  // Webhook not yet processed — show "activating" state
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center">
      <div className="relative">
        <Loader2 className="h-14 w-14 animate-spin text-primary" />
      </div>
      <h1 className="text-3xl font-bold">¡Gracias por tu compra!</h1>
      <p className="max-w-sm text-muted-foreground">
        Tu suscripción se está activando. Normalmente tarda unos segundos. Si la página
        no se actualiza sola, usa el botón de abajo.
      </p>
      {sessionId && (
        <p className="text-xs text-muted-foreground">Referencia: {sessionId}</p>
      )}
      <Button onClick={check} disabled={checking} variant="outline" className="gap-2">
        <RefreshCw className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} />
        {checking ? 'Comprobando…' : 'Refrescar estado'}
      </Button>
      <p className="text-sm text-muted-foreground">
        ¿Algo va mal?{' '}
        <Link href="/perfil/suscripcion" className="underline hover:text-foreground">
          Ver mi suscripción
        </Link>
      </p>
    </div>
  );
}
