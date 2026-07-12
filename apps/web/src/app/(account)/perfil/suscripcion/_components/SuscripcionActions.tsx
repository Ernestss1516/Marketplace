'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cancelSubscription, type MySubscription } from '@/lib/api/billing';
import { toUserMessage } from '@/lib/api/client';
import { useApiAction } from '@/lib/api/use-api-action';
import { useRequireAuth } from '@/hooks/use-require-auth';

interface Props {
  subscription: MySubscription;
  token: string;
}

export function SuscripcionActions({ subscription, token }: Props) {
  const { run } = useApiAction();
  const { loginUrl } = useRequireAuth();
  const [open, setOpen] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localStatus, setLocalStatus] = useState(subscription.status);

  async function handleCancel() {
    setCanceling(true);
    setError(null);
    await run(
      () => cancelSubscription(token, subscription.id),
      {
        onSuccess: () => { setLocalStatus('CANCELING'); setOpen(false); },
        onError: (err) => setError(toUserMessage(err)),
        callbackUrl: loginUrl,
      },
    );
    setCanceling(false);
  }

  if (localStatus === 'CANCELING' || subscription.cancelAtPeriodEnd) {
    const periodEnd = new Date(subscription.currentPeriodEnd).toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    return (
      <p className="text-sm text-muted-foreground">
        Tu suscripción se cancelará al final del período actual:{' '}
        <strong>{periodEnd}</strong>. Seguirás siendo Pro hasta esa fecha.
      </p>
    );
  }

  return (
    <>
      <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
        Cancelar suscripción
      </Button>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cancelar suscripción Pro?</AlertDialogTitle>
            <AlertDialogDescription>
              Tu plan Pro seguirá activo hasta el final del período de facturación actual.
              A partir de entonces no se realizarán más cargos y volverás al plan gratuito.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={canceling}>Mantener Pro</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancel}
              disabled={canceling}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {canceling ? 'Cancelando…' : 'Confirmar cancelación'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
