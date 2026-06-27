import Link from 'next/link';
import type { Metadata } from 'next';
import { Loader2, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Destacado en proceso' };

/**
 * INVARIANTE: esta página NO concede ni verifica el destacado.
 * El entitlement FEATURED_LISTING lo crea exclusivamente la notificación
 * Redsys (POST /webhooks/redsys → RedsysProcessor.handleFeaturedPay).
 * Esta página es solo UI de confirmación de pago iniciado.
 */
export default function DestacadoExitoPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center">
      <div className="relative flex items-center justify-center">
        <Loader2 className="h-14 w-14 animate-spin text-primary" />
        <Star className="absolute h-6 w-6 fill-primary text-primary" />
      </div>

      <h1 className="text-3xl font-bold">¡Pago recibido!</h1>

      <p className="max-w-sm text-muted-foreground">
        Tu anuncio está siendo destacado. Aparecerá como destacado en unos instantes,
        una vez que confirmemos el pago con el banco.
      </p>

      <p className="max-w-sm text-sm text-muted-foreground">
        Si no ves el cambio en 5 minutos, contacta con soporte.
      </p>

      <Button asChild>
        <Link href="/mis-anuncios">Ver mis anuncios</Link>
      </Button>
    </div>
  );
}
