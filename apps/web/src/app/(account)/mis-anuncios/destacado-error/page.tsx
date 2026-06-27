import Link from 'next/link';
import type { Metadata } from 'next';
import { XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Pago no completado' };

export default function DestacadoErrorPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center">
      <XCircle className="h-14 w-14 text-destructive" />

      <h1 className="text-3xl font-bold">El pago no se completó</h1>

      <p className="max-w-sm text-muted-foreground">
        El pago fue cancelado o rechazado. No se ha realizado ningún cargo ni
        se ha modificado tu anuncio.
      </p>

      <div className="flex gap-3">
        <Button asChild>
          <Link href="/mis-anuncios">Volver a mis anuncios</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/mis-creditos">Comprar créditos</Link>
        </Button>
      </div>
    </div>
  );
}
