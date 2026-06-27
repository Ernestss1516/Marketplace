import Link from 'next/link';
import { XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function MisCreditosErrorPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center">
      <XCircle className="h-14 w-14 text-destructive" />

      <h1 className="text-3xl font-bold">El pago no se completó</h1>

      <p className="max-w-sm text-muted-foreground">
        El proceso de pago fue cancelado o hubo un problema con la transacción.
        No se te ha cobrado ningún importe.
      </p>

      <Button asChild>
        <Link href="/mis-creditos">Volver a mis créditos</Link>
      </Button>
    </div>
  );
}
