'use client';

/**
 * MENSAJERÍA C2 — EL HILO, COMO LO LEE EL STAFF.
 *
 * RUTA PROPIA Y NO UN PANEL DESPLEGABLE, por el mismo motivo que la ficha de
 * anuncio (F1, D-1): **hace falta un destino con URL**. Aquí es donde va a querer
 * llegar una denuncia de fraude o un ticket de soporte, y un panel dentro de una
 * lista no se puede enlazar.
 *
 * ─── POR QUÉ CUELGA DE `/admin/anuncios/` Y NO DE `/admin/conversaciones/` ──
 *
 * Porque `canAccessAdminPath` es **fail-closed ante una ruta sin sección**: una
 * ruta bajo `/admin` que no case con ninguna fila de `BACKOFFICE_SECTIONS` se
 * deniega a todos, incluido ADMIN. Con un segmento nuevo (`conversaciones`) esta
 * pantalla habría redirigido a la portada a todo el mundo — y sin ruido, porque
 * un redirect no es un error.
 *
 * Y una sección propia tampoco vale: el mapa dice, con todas las letras, que «no
 * hay, ni debe haber, ninguna forma de que una sección accesible se quede fuera
 * del nav» —`hiddenFromNav` se borró a propósito—, así que declararla obligaría a
 * poner en la barra lateral una entrada «Conversaciones» que llevaría a un
 * explorador global de mensajería. Eso es justo la pantalla que el diseño
 * descartó: cruzar toda la correspondencia de la plataforma es otro alcance y
 * otro rol.
 *
 * Colgando de `anuncios` la ruta casa por prefijo, hereda su `minRole: MODERATOR`
 * —que es el que esta pantalla quiere— y no añade ninguna entrada al nav. Además
 * es honesto con el modelo: una conversación existe SOBRE un anuncio
 * (`@@unique([listingId, buyerId])`), aunque se llegue a ella desde un usuario.
 *
 * SOLO LECTURA, Y SIN CAJA DE RESPUESTA. El staff no escribe en conversaciones
 * ajenas: para hablar con alguien está el sistema de tickets, que además deja
 * rastro de lo que se dijo. Aquí no hay ningún camino que escriba.
 *
 * Y ABRIR ESTA PANTALLA QUEDA REGISTRADO. Se dice en la propia pantalla, arriba
 * del todo: que quien lee sepa que su acceso deja constancia es la mitad de para
 * qué sirve el registro — la otra mitad es poder responder, algún día, «¿quién ha
 * leído mis mensajes?».
 */

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { AlertCircle, ChevronLeft, Eye } from 'lucide-react';
import { abrirConversacion, type ConversacionCompleta } from '@/lib/api/admin-mensajeria';
import { ApiError } from '@/lib/api/client';
import { adminListingHref, adminUserHref } from '@/lib/admin-links';
import { SesionNoDisponible } from '@/app/(admin)/components/SesionNoDisponible';

function fechaHora(iso: string) {
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Una persona del hilo, enlazada a su ficha de staff. */
function Persona({ p }: { p: { id: string; name: string | null } }) {
  // `name` a null es una cuenta eliminada: la fila sobrevive vaciada y no hay
  // snapshot del interlocutor en `Conversation` (residuo anotado en el diseño
  // §3.2). Se dice lo que se sabe; inventar un nombre sería peor.
  return (
    <Link href={adminUserHref(p.id)} className="hover:underline">
      {p.name ?? 'Usuario eliminado'}
    </Link>
  );
}

export default function AdminConversacionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: session } = useSession();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;

  const [data, setData] = useState<ConversacionCompleta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setData(await abrirConversacion(token, id));
    } catch (err) {
      setError(
        err instanceof ApiError ? `Error ${err.statusCode}: ${err.message}` : 'Error al cargar',
      );
    } finally {
      setLoading(false);
    }
  }, [id, token]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (!token) {
    return (
      <SesionNoDisponible />
    );
  }

  if (loading) {
    return <p className="py-12 text-center text-sm text-muted-foreground">Cargando…</p>;
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <Link
          href="/admin/anuncios"
          className="inline-flex items-center text-sm text-muted-foreground hover:underline"
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          Volver
        </Link>
        <div
          className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          <AlertCircle className="h-4 w-4" />
          {error ?? 'Conversación no encontrada.'}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="ficha-conversacion">
      {/* EL AVISO, ARRIBA Y NO AL PIE. Quien abre esto está leyendo la
          correspondencia privada de dos personas; que sepa que consta es parte de
          la salvaguarda, no un detalle de cortesía. */}
      <div
        className="flex items-start gap-2 rounded-md border border-warning-border bg-warning px-3 py-2 text-xs text-warning-foreground"
        data-testid="aviso-auditoria"
      >
        <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          Estás leyendo una conversación privada. <strong>Esta apertura queda registrada</strong>{' '}
          con tu usuario y la fecha. Vista de solo lectura: para hablar con alguien, abre un
          ticket.
        </span>
      </div>

      <header className="rounded-lg border bg-card p-4">
        <h1 className="text-lg font-semibold">
          <Persona p={data.buyer} /> <span className="text-muted-foreground">↔</span>{' '}
          <Persona p={data.seller} />
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          <span>Sobre: </span>
          {data.listing ? (
            <Link href={adminListingHref(data.listing.id)} className="hover:underline">
              {data.listing.title}
            </Link>
          ) : data.listingTitle ? (
            // Mismo trato que en la lista y que en las denuncias: se dice cuál era
            // y se marca que ya no está, sin ofrecer un enlace muerto.
            <span data-testid="conversacion-anuncio-fantasma">
              <span className="line-through">{data.listingTitle}</span>
              <span className="ml-1 rounded bg-muted px-1 py-0.5 text-[10px]">
                Anuncio ya no existe
              </span>
            </span>
          ) : (
            '—'
          )}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Empezó el {fechaHora(data.createdAt)} · {data.messages.length} mensaje
          {data.messages.length === 1 ? '' : 's'}
        </p>
      </header>

      {/* ÍNTEGRO Y EN ORDEN. Sin recortes: nadie denuncia «el mensaje catorce», se
          denuncia a una persona, y un hilo con huecos no permite decidir ni a
          favor ni en contra. */}
      <ol className="space-y-2" data-testid="hilo-mensajes">
        {data.messages.map((m) => (
          <li key={m.id} className="rounded-md border p-3 text-sm" data-testid="mensaje">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {m.sender.name ?? 'Usuario eliminado'}
              </span>
              <span>
                {fechaHora(m.createdAt)}
                {/* Se enseña si el DESTINATARIO lo leyó — y abrir desde aquí no lo
                    cambia: la vista de staff no toca `readAt`. */}
                {m.readAt ? ' · leído' : ' · sin leer'}
              </span>
            </div>
            <p className="whitespace-pre-wrap">{m.body}</p>
          </li>
        ))}
      </ol>

      {data.messages.length === 0 && (
        <p className="text-xs text-muted-foreground">Esta conversación no tiene mensajes.</p>
      )}
    </div>
  );
}
