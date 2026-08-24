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
 *
 * PARIDAD DEL PRO MANUAL (§1.5, H-2) — Y EL BOTÓN MIRABA EL EJE EQUIVOCADO.
 *
 * Bloqueaba con `isPro`, que es «¿tiene las ventajas Pro?». La pregunta que decide si
 * alguien puede comprar el plan es otra: «¿ya tiene una suscripción de pago?». Para un
 * cliente de pago las dos coinciden y por eso no se notaba; para un Pro CONCEDIDO por el
 * equipo —Pro sin suscripción— no coinciden en absoluto, y el botón le decía «Ya eres Pro»
 * mientras el servidor **sí** le habría dejado suscribirse.
 *
 * Perdía justo el caso más deseable: el que tuvo Pro de regalo y quiere pagarlo. Ahora se
 * lee `hasActiveSubscription`, que el backend calcula con el MISMO predicado que su guard —
 * así el botón ofrece exactamente lo que el checkout acepta, ni más ni menos.
 */
export function CheckoutButton({ priceId, label = 'Hazte Pro' }: Props) {
  const { data: session, status } = useSession();
  const { run } = useApiAction();
  const { requireAuth, loginUrl } = useRequireAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** «Ya paga el plan», NO «ya es Pro» — ver la cabecera. */
  const [yaSuscrito, setYaSuscrito] = useState<boolean | null>(null);

  const token = session?.user.accessToken;

  // Solo se pregunta con sesión: `/planes` es página de captación y la ve sobre todo gente
  // sin cuenta, que no debe disparar nada.
  useEffect(() => {
    if (!token) {
      setYaSuscrito(false);
      return;
    }
    let cancelado = false;
    getProStatus(token)
      // `hasActiveSubscription`, NO `isPro`. Y con `?? false` por lo mismo que el `catch` de
      // abajo: si el backend es anterior a este campo, se deja pasar y decide el servidor.
      .then((s) => !cancelado && setYaSuscrito(s.hasActiveSubscription ?? false))
      // Ante la duda NO se bloquea la compra: el backend sigue siendo quien decide, y
      // dejar sin suscribirse a alguien que sí puede sería peor que enseñarle el botón.
      .catch(() => !cancelado && setYaSuscrito(false));
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

  if (yaSuscrito) {
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
        disabled={loading || status === 'loading' || yaSuscrito === null}
      >
        {loading ? 'Redirigiendo a Stripe…' : label}
      </Button>
      {error && <p className="text-center text-sm text-destructive">{error}</p>}
    </div>
  );
}
