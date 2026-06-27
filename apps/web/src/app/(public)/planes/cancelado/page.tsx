import type { Metadata } from 'next';
import Link from 'next/link';
import { XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Pago cancelado',
};

export default function PlanesCanceladoPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center">
      <XCircle className="h-14 w-14 text-muted-foreground" />
      <h1 className="text-3xl font-bold">Has cancelado el proceso de pago</h1>
      <p className="max-w-sm text-muted-foreground">
        No se ha realizado ningún cargo. Puedes volver a los planes cuando quieras.
      </p>
      <div className="flex gap-3">
        <Button asChild>
          <Link href="/planes">Ver planes</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/">Ir al inicio</Link>
        </Button>
      </div>
    </div>
  );
}
