'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ApiError } from '@/lib/api/client';
import {
  getContactMotivos,
  getContactTimeTrapToken,
  submitContactMessage,
  type ContactReasonOption,
} from '@/lib/api/contacto';

export function ContactForm() {
  // RC.2 — motivos configurables por el admin, ya no un enum fijo. Se piden
  // en cliente (igual que el token del time-trap) al montar.
  const [motivos, setMotivos] = useState<ContactReasonOption[] | null>(null);
  const [motivoId, setMotivoId] = useState('');
  const [email, setEmail] = useState('');
  const [telefono, setTelefono] = useState('');
  const [mensaje, setMensaje] = useState('');
  // Honeypot (RC.1) — un humano nunca rellena este campo, oculto por CSS más
  // abajo (nunca type="hidden": un bot autorrellenador sí lo detecta y rellena).
  const [empresa, setEmpresa] = useState('');
  // Emitido por GET /contacto/token al montar — fetch de cliente normal (sin
  // caché de Next.js), así cada carga de la página obtiene un issuedAt propio.
  const [timeTrapToken, setTimeTrapToken] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getContactTimeTrapToken()
      .then(({ token }) => setTimeTrapToken(token))
      .catch(() => setTimeTrapToken(null));
    getContactMotivos()
      .then((options) => {
        setMotivos(options);
        if (options.length > 0) setMotivoId(options[0].id);
      })
      .catch(() => setMotivos([]));
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');

    if (!timeTrapToken || !motivoId) {
      setError('El formulario aún se está cargando. Espera unos segundos e inténtalo de nuevo.');
      return;
    }

    setLoading(true);
    try {
      await submitContactMessage({
        motivoId,
        email,
        telefono: telefono.trim() || undefined,
        mensaje,
        empresa: empresa || undefined,
        timeTrapToken,
      });
      setSent(true);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 429) {
        setError('Has enviado demasiados mensajes. Inténtalo de nuevo más tarde.');
      } else {
        setError('No se ha podido enviar el mensaje. Inténtalo de nuevo.');
      }
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center">
        <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-primary" />
        <h2 className="mb-2 text-lg font-semibold">Mensaje enviado</h2>
        <p className="text-sm text-muted-foreground">
          Gracias por escribirnos. Te responderemos a la mayor brevedad al email indicado.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {error && (
        <p className="rounded bg-destructive-subtle p-3 text-sm text-destructive-strong" role="alert">
          {error}
        </p>
      )}

      {motivos !== null && motivos.length === 0 ? (
        <p className="rounded bg-warning p-3 text-sm text-warning-foreground" role="alert">
          El formulario no está disponible en este momento. Inténtalo más tarde.
        </p>
      ) : (
        <div>
          <Label htmlFor="motivo">Motivo</Label>
          <Select value={motivoId} onValueChange={setMotivoId} disabled={!motivos}>
            <SelectTrigger id="motivo">
              <SelectValue placeholder={motivos ? undefined : 'Cargando…'} />
            </SelectTrigger>
            <SelectContent>
              {(motivos ?? []).map((opt) => (
                <SelectItem key={opt.id} value={opt.id}>
                  {opt.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div>
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div>
        <Label htmlFor="telefono">Teléfono (opcional)</Label>
        <Input
          id="telefono"
          type="tel"
          autoComplete="tel"
          maxLength={20}
          value={telefono}
          onChange={(e) => setTelefono(e.target.value)}
        />
      </div>

      <div>
        <Label htmlFor="mensaje">Mensaje</Label>
        <Textarea
          id="mensaje"
          required
          minLength={10}
          maxLength={5000}
          rows={6}
          value={mensaje}
          onChange={(e) => setMensaje(e.target.value)}
        />
      </div>

      {/* Honeypot (RC.1): oculto por CSS (posición fuera de pantalla + sin
          tamaño), nunca type="hidden" — los bots que autorrellenan formularios
          filtran por ese atributo. aria-hidden + tabIndex=-1 para que no
          interfiera con lectores de pantalla ni con la navegación por tabulador. */}
      <div className="absolute left-[-9999px] top-0 h-0 w-0 overflow-hidden" aria-hidden="true">
        <label htmlFor="empresa">Empresa</label>
        <input
          id="empresa"
          name="empresa"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={empresa}
          onChange={(e) => setEmpresa(e.target.value)}
        />
      </div>

      <Button type="submit" disabled={loading || !motivoId} className="w-full">
        {loading ? 'Enviando…' : 'Enviar mensaje'}
      </Button>
    </form>
  );
}
