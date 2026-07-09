'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Bell } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useApiAction } from '@/lib/api/use-api-action';
import { createAlert } from '@/lib/api/alertas';
import type { AlertCriteria, Alert } from '@/types';
import type { SearchResponse } from '@/lib/api/busqueda';

interface Props {
  criteria: AlertCriteria;
}

/** "Crear alerta con esta búsqueda" — reads the criteria BusquedaPage already
 * parsed from the URL (no re-parsing), only asks for a name. */
export function CrearAlertaButton({ criteria }: Props) {
  const { data: session } = useSession();
  const token = session?.user.accessToken;
  const { run } = useApiAction();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ alert: Alert; matches: SearchResponse } | null>(null);

  if (!token) return null;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setName('');
      setError(null);
      setResult(null);
    }
  }

  function handleSubmit() {
    if (!name.trim() || !token) return;
    setBusy(true);
    setError(null);
    run(() => createAlert({ ...criteria, name: name.trim() }, token), {
      onSuccess: (data) => {
        setResult(data);
        setBusy(false);
      },
      onError: () => {
        setError('No se pudo crear la alerta. Inténtalo de nuevo.');
        setBusy(false);
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Bell className="mr-1.5 h-4 w-4" />
          Crear alerta
        </Button>
      </DialogTrigger>
      <DialogContent>
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle>Alerta creada</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              {result.matches.totalHits > 0
                ? `Ahora mismo hay ${result.matches.totalHits} ${
                    result.matches.totalHits === 1 ? 'anuncio que coincide' : 'anuncios que coinciden'
                  }. Te avisaremos cuando se publique uno nuevo.`
                : 'No hay anuncios que coincidan ahora mismo. Te avisaremos en cuanto se publique uno.'}
            </p>
            <DialogFooter>
              <Button variant="outline" asChild>
                <Link href="/mis-alertas">Ver mis alertas</Link>
              </Button>
              <Button onClick={() => handleOpenChange(false)}>Cerrar</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Crear alerta con esta búsqueda</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="alert-name">Nombre de la alerta</Label>
              <Input
                id="alert-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej. iPhone en Madrid"
                maxLength={100}
                disabled={busy}
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <DialogFooter>
              <Button onClick={handleSubmit} disabled={busy || !name.trim()}>
                {busy ? 'Creando…' : 'Crear alerta'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
