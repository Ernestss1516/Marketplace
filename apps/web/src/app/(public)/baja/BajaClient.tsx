'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { unsubscribe, type EmailCategory } from '@/lib/api/usuarios';
import { toUserMessage } from '@/lib/api/client';

const NOMBRE: Record<EmailCategory, string> = {
  MESSAGES: 'mensajes sin leer',
  LISTINGS: 'caducidad de tus anuncios',
  REVIEWS: 'valoraciones',
  ALERTS: 'alertas guardadas',
};

/**
 * La baja se ejecuta con un CLIC, nunca al cargar la página: los clientes de correo
 * y los antivirus visitan los enlaces para analizarlos, y una baja automática daría
 * de baja a quien no pulsó nada.
 */
export function BajaClient({
  userId,
  category,
  signature,
}: {
  userId: string;
  category: string;
  signature: string;
}) {
  const [estado, setEstado] = useState<'inicio' | 'enviando' | 'hecho'>('inicio');
  const [error, setError] = useState<string | null>(null);

  const nombre = NOMBRE[category as EmailCategory] ?? 'estos avisos';

  async function darDeBaja() {
    setEstado('enviando');
    setError(null);
    try {
      await unsubscribe({ userId, category: category as EmailCategory, signature });
      setEstado('hecho');
    } catch (err) {
      setError(toUserMessage(err));
      setEstado('inicio');
    }
  }

  if (estado === 'hecho') {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <Check className="mx-auto mb-4 h-10 w-10 text-primary" />
        <h1 className="mb-3 text-2xl font-bold">Listo</h1>
        <p className="mb-6 text-muted-foreground">
          Ya no recibirás correos de <strong>{nombre}</strong>. Seguirás viendo estos avisos en
          la campana cuando entres.
        </p>
        <p className="text-sm text-muted-foreground">
          Puedes volver a activarlos cuando quieras desde{' '}
          <Link href="/perfil" className="text-primary underline">
            tu perfil
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="mb-3 text-2xl font-bold">¿Dejar de recibir estos correos?</h1>
      <p className="mb-6 text-muted-foreground">
        Dejarás de recibir los correos de <strong>{nombre}</strong>. No afecta a los avisos
        sobre tu cuenta, tu saldo ni tus facturas, que se envían siempre.
      </p>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <div className="flex justify-center gap-3">
        <Button onClick={() => void darDeBaja()} disabled={estado === 'enviando'}>
          {estado === 'enviando' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Darme de baja
        </Button>
        <Button variant="outline" asChild>
          <Link href="/perfil">Ver todas mis preferencias</Link>
        </Button>
      </div>
    </div>
  );
}
