'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { createCheckout, getProStatus } from '@/lib/api/billing';
import { toUserMessage } from '@/lib/api/client';
import { useApiAction } from '@/lib/api/use-api-action';
import { useRequireAuth } from '@/hooks/use-require-auth';

interface Props {
  priceId: string;
  label?: string;
}

/**
 * UXV.6 (M4) — «Hazte Pro», pero no a quien ya lo es.
 *
 * EL DEFECTO: este botón se pintaba igual para todo el mundo. Un suscriptor que volvía a
 * `/planes` —y volvía, porque hasta UXV.2 era el único camino de upgrade y sigue siendo el
 * enlace del menú— veía «Hazte Pro» y, al pulsarlo, se le abría un SEGUNDO checkout de
 * Stripe sobre la misma cuenta. Dos suscripciones, dos cobros recurrentes.
 *
 * EL ARREGLO DE VERDAD ESTÁ EN EL BACKEND: `createCheckoutSession` rechaza ahora con
 * `ALREADY_SUBSCRIBED` si hay una suscripción ACTIVE o CANCELING. Esconder el botón sin
 * eso habría dejado el agujero abierto a cualquier POST directo. Lo de aquí es lo que
 * evita que el usuario llegue siquiera a intentarlo, y que si lo intenta entienda por qué
 * no puede.
 */
export function CheckoutButton({ priceId, label = 'Hazte Pro' }: Props) {
  const { data: session, status } = useSession();
  const { run } = useApiAction();
  const { requireAuth, loginUrl } = useRequireAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [yaEsPro, setYaEsPro] = useState<boolean | null>(null);

  const token = session?.user.accessToken;

  // Solo se pregunta con sesión: `/planes` es página de captación y la ve sobre todo gente
  // sin cuenta, que no debe disparar nada.
  useEffect(() => {
    if (!token) {
      setYaEsPro(false);
      return;
    }
    let cancelado = false;
    getProStatus(token)
      .then((s) => !cancelado && setYaEsPro(s.isPro))
      // Ante la duda NO se bloquea la compra: el backend sigue siendo quien decide, y
      // dejar sin suscribirse a alguien que sí puede sería peor que enseñarle el botón.
      .catch(() => !cancelado && setYaEsPro(false));
    return () => {
      cancelado = true;
    };
  }, [token]);

  async function handleClick() {
    if (status === 'loading') return;
    if (!requireAuth()) return;

    setLoading(true);
    setError(null);
    await run(
      () => createCheckout(session!.user.accessToken!, priceId),
      {
        onSuccess: ({ checkoutUrl }) => { window.location.href = checkoutUrl; },
        onError: (err) => { setError(toUserMessage(err)); setLoading(false); },
        callbackUrl: loginUrl,
      },
    );
  }

  if (yaEsPro) {
    return (
      <div className="w-full space-y-2" data-testid="ya-eres-pro">
        <Button className="w-full" variant="outline" disabled>
          <Check className="mr-2 h-4 w-4" />
          Ya eres Pro
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          <Link href="/perfil/suscripcion" className="underline hover:text-foreground">
            Gestionar mi suscripción
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-2">
      <Button
        className="w-full"
        onClick={handleClick}
        disabled={loading || status === 'loading' || yaEsPro === null}
      >
        {loading ? 'Redirigiendo a Stripe…' : label}
      </Button>
      {error && <p className="text-center text-sm text-destructive">{error}</p>}
    </div>
  );
}
