'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { AlertCircle, ChevronLeft, Flag, Link2, Loader2, Lock, Send, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { TicketStatusBadge } from '@/components/tickets/TicketStatusBadge';
import { AttachmentList, AttachmentPicker } from '@/components/tickets/TicketAttachments';
import { resolveStaffActions } from '@/components/tickets/staff-actions';
import { cn } from '@/lib/utils';
import {
  closeTicketAsStaff,
  getAdminTicket,
  reassignTicket,
  replyAsStaff,
  resolveTicket,
  takeTicket,
  toStaffTicketMessage,
} from '@/lib/api/admin-tickets';
import type { AdminTicketDetail, Role } from '@/types';

function formatFechaHora(iso: string) {
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Hilo completo desde el lado del staff (R7).
 *
 * Muestra TODOS los mensajes, incluidas las NOTAS INTERNAS — es el contraste con
 * la vista de usuario, que las filtra en la propia query.
 *
 * El toggle de "nota interna" cambia el DESTINATARIO de lo que se escribe, no un
 * detalle de formato: por eso el recuadro cambia de color, el botón cambia de
 * texto e icono, y el toggle se resetea después de cada envío. Un modo pegajoso
 * es exactamente el que acaba mandándole al usuario lo que era para el equipo —
 * o al revés, dejando sin responder al usuario creyendo que se le respondió.
 */
export default function AdminTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: session } = useSession();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;
  const actorId = (session?.user as { id?: string } | undefined)?.id ?? '';
  const actorRole = ((session?.user as { role?: Role } | undefined)?.role ?? 'MODERATOR') as Role;

  const [ticket, setTicket] = useState<AdminTicketDetail | null>(null);
  const [body, setBody] = useState('');
  /** R5 — adjuntos pendientes de enviar. Se vacían tras un envío correcto, igual
   *  que el toggle de nota interna: lo que ya se mandó no puede quedar colgando. */
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  /** Toggle de nota interna. Se resetea tras enviar para que la siguiente
   * respuesta no salga interna por inercia — el modo "pegajoso" es justo el
   * que acaba publicando una nota como respuesta al usuario. */
  const [esNotaInterna, setEsNotaInterna] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      setTicket(await getAdminTicket(id, token));
      setLoadError(null);
    } catch (err) {
      setLoadError(toStaffTicketMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id, token]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Ejecuta una acción y recarga: el estado resultante lo dicta el BACKEND. */
  async function run(key: string, action: () => Promise<unknown>) {
    if (busy || !token) return;
    setBusy(key);
    setError(null);
    try {
      await action();
      await load();
      if (key === 'reply') {
        setBody('');
        setFiles([]);
        setEsNotaInterna(false);
      }
    } catch (err) {
      setError(toStaffTicketMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <p className="py-12 text-center text-sm text-muted-foreground">Cargando…</p>;

  if (loadError || !ticket) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link href="/admin/tickets">
            <ChevronLeft className="mr-1 h-4 w-4" />
            Bandeja
          </Link>
        </Button>
        <div
          className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
          data-testid="error-acceso"
        >
          <AlertCircle className="h-4 w-4" />
          {loadError ?? 'Ticket no encontrado.'}
        </div>
      </div>
    );
  }

  // La misma matriz que prueba staff-actions.test.ts. La UI restringe por
  // experiencia; el backend garantiza con 403/400 aunque se fuerce la petición.
  const acciones = resolveStaffActions({
    status: ticket.status,
    assignedToId: ticket.assignedTo?.id ?? null,
    hasInvoice: ticket.invoiceId !== null,
    actorId,
    actorRole,
  });

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/admin/tickets">
          <ChevronLeft className="mr-1 h-4 w-4" />
          Bandeja
        </Link>
      </Button>

      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <div className="space-y-4">
          <div className="space-y-2 rounded-lg border p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h1 className="text-xl font-semibold">{ticket.subject}</h1>
              <TicketStatusBadge status={ticket.status} />
            </div>
            <p className="text-sm text-muted-foreground">
              Abierto el {formatFechaHora(ticket.createdAt)}
              {ticket.assignedTo && ` · lo lleva ${ticket.assignedTo.name}`}
              {!ticket.assignedTo && ' · sin asignar'}
            </p>
          </div>

          {/* ── Acciones ─────────────────────────────────────────────────── */}
          <div className="flex flex-wrap gap-2" data-testid="acciones-staff">
            {acciones.puedeTomar && (
              <Button
                size="sm"
                disabled={busy !== null}
                onClick={() => run('take', () => takeTicket(ticket.id, token!))}
                data-testid="accion-tomar"
              >
                {busy === 'take' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Tomar
              </Button>
            )}
            {acciones.puedeResolver && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => run('resolve', () => resolveTicket(ticket.id, token!))}
                data-testid="accion-resolver"
              >
                {busy === 'resolve' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Resolver
              </Button>
            )}
            {acciones.puedeCerrar && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => run('close', () => closeTicketAsStaff(ticket.id, token!))}
                data-testid="accion-cerrar"
              >
                {busy === 'close' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Cerrar
              </Button>
            )}
            {/* Reasignar. El backend exige ADMIN si el ticket lo lleva OTRO agente
                (403 TICKET_REASSIGN_ADMIN_ONLY), así que a un MODERATOR en ese
                caso ni se le ofrece. Se asigna al propio actor: reasignar a un
                tercero necesitaría un selector de agentes, y no hace falta para
                el flujo de "me hago cargo yo". */}
            {acciones.puedeReasignar && ticket.assignedTo?.id !== actorId && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy !== null}
                onClick={() => run('reassign', () => reassignTicket(ticket.id, actorId, token!))}
                data-testid="accion-reasignar"
              >
                {busy === 'reassign' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Asignármelo
              </Button>
            )}
          </div>

          {error && (
            <div
              className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
              role="alert"
              data-testid="error-accion"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* ── Hilo (DESC del backend → se invierte para leer) ───────────── */}
          <div className="space-y-3" data-testid="hilo-staff">
            {[...ticket.messages].reverse().map((m) => (
              <div
                key={m.id}
                className={cn('flex', m.side === 'STAFF' ? 'justify-end' : 'justify-start')}
                data-testid={`mensaje-${m.side.toLowerCase()}`}
              >
                <div
                  className={cn(
                    'max-w-[80%] rounded-lg px-3 py-2 text-sm',
                    m.internal
                      ? 'border border-amber-300 bg-amber-50 text-amber-950'
                      : m.side === 'STAFF'
                        ? 'bg-primary text-primary-foreground'
                        : 'border bg-muted',
                  )}
                >
                  {/* Las notas internas se VEN aquí (y nunca en la vista de
                      usuario), pero R7 no añade forma de crearlas. */}
                  {m.internal && (
                    <p className="mb-1 text-[11px] font-semibold uppercase">Nota interna</p>
                  )}
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  {/* Los adjuntos de una NOTA INTERNA se ven aquí y solo aquí: el
                      endpoint de descarga del usuario los niega con 404, porque
                      heredan la privacidad de la nota (defensa 6). */}
                  {m.attachments && m.attachments.length > 0 && (
                    <AttachmentList
                      ticketId={ticket.id}
                      attachments={m.attachments}
                      token={token!}
                      scope="staff"
                    />
                  )}
                  <p
                    className={cn(
                      'mt-1 text-[11px]',
                      m.side === 'STAFF' && !m.internal
                        ? 'text-primary-foreground/70'
                        : 'text-muted-foreground',
                    )}
                  >
                    {m.side === 'USER' ? 'Usuario · ' : 'Soporte · '}
                    {formatFechaHora(m.createdAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {acciones.puedeResponder ? (
            <div className="space-y-2">
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
                maxLength={5000}
                placeholder={
                  esNotaInterna
                    ? 'Anota algo para el equipo. El usuario NO lo verá…'
                    : 'Escribe la respuesta al usuario…'
                }
                data-testid="input-respuesta-staff"
                className={esNotaInterna ? 'border-amber-400 bg-amber-50/50' : undefined}
              />

              {/* El toggle cambia el DESTINO del mensaje, así que se avisa en
                  claro y el propio recuadro cambia de color: escribir para el
                  equipo y escribir para el usuario no pueden parecer lo mismo. */}
              <label className="flex items-start gap-2 text-sm" data-testid="toggle-nota-interna">
                <input
                  type="checkbox"
                  checked={esNotaInterna}
                  onChange={(e) => setEsNotaInterna(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-input"
                />
                <span>
                  <span className="font-medium">Nota interna</span>
                  <span className="block text-xs text-muted-foreground">
                    Solo visible para el equipo. El usuario no la ve, no le llega ningún aviso y
                    no cambia el estado del ticket.
                  </span>
                </span>
              </label>

              <AttachmentPicker
                files={files}
                onChange={setFiles}
                disabled={busy !== null}
                testId="adjuntos-picker-staff"
              />

              <Button
                size="sm"
                variant={esNotaInterna ? 'secondary' : 'default'}
                disabled={!body.trim() || busy !== null}
                onClick={() =>
                  run('reply', () =>
                    replyAsStaff(ticket.id, body.trim(), token!, esNotaInterna, files),
                  )
                }
                data-testid="enviar-respuesta-staff"
              >
                {busy === 'reply' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : esNotaInterna ? (
                  <Lock className="mr-2 h-4 w-4" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                {esNotaInterna ? 'Guardar nota interna' : 'Responder'}
              </Button>
            </div>
          ) : (
            <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
              {ticket.status === 'CLOSED'
                ? 'Este ticket está cerrado.'
                : 'Este ticket está resuelto: la pelota está en el usuario, que puede reabrirlo respondiendo.'}
            </p>
          )}
        </div>

        {/* ── Panel lateral ──────────────────────────────────────────────── */}
        <aside className="space-y-4 text-sm">
          <div className="space-y-1 rounded-lg border p-3">
            <p className="flex items-center gap-1.5 font-medium">
              <User className="h-4 w-4" />
              Usuario
            </p>
            <p>{ticket.user.name}</p>
            <Link
              href={`/vendedor/${ticket.user.slug}`}
              className="text-xs text-muted-foreground underline underline-offset-2"
            >
              Ver perfil público
            </Link>
          </div>

          {ticket.linkedLabel && (
            <div className="space-y-1 rounded-lg border p-3">
              <p className="flex items-center gap-1.5 font-medium">
                <Link2 className="h-4 w-4" />
                Relacionado
              </p>
              <p className="text-muted-foreground">{ticket.linkedLabel}</p>
              {ticket.listing && (
                <Link
                  href={`/anuncio/${ticket.listing.slug}`}
                  className="text-xs underline underline-offset-2"
                >
                  Ver anuncio
                </Link>
              )}
            </div>
          )}

          {/* Flujo (c): el hilo referencia la denuncia, no la gestiona. Resolver
              el reporte y cerrar el ticket son acciones independientes. */}
          {ticket.report && (
            <div className="space-y-1 rounded-lg border p-3" data-testid="panel-reporte">
              <p className="flex items-center gap-1.5 font-medium">
                <Flag className="h-4 w-4" />
                Desde una denuncia
              </p>
              <p className="text-muted-foreground">
                {ticket.report.reason} · {ticket.report.status}
              </p>
              <Link href="/admin/reportes" className="text-xs underline underline-offset-2">
                Ir a moderación
              </Link>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
