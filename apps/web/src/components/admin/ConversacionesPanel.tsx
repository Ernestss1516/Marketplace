'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { adminListingHref, adminUserHref } from '@/lib/admin-links';
import { ApiError } from '@/lib/api/client';
import type {
  ConversacionCabecera,
  ConversacionesPaginadas,
} from '@/lib/api/admin-mensajeria';

/**
 * MENSAJERÍA C1 — LA LISTA DE HILOS, SIN ABRIR NINGUNO.
 *
 * Lo que enseña es deliberadamente lo que se puede saber SIN leer
 * correspondencia ajena: con quién, sobre qué anuncio, cuándo empezó, cuándo se
 * movió por última vez y cuántos mensajes tiene. Con eso un moderador responde
 * «¿hubo contacto? ¿cuánto? ¿cuándo?», que es la mitad del encargo — y la mitad
 * que no invade nada.
 *
 * **NO HAY ENLACE AL HILO**, y no es que falte: la pantalla que muestra los
 * mensajes es C2, con su registro de acceso. Poner aquí un enlace a algo que aún
 * no existe sería prometer lo que no hay.
 *
 * COMPARTIDO desde el primer uso por las dos fichas —anuncio y usuario—, que es
 * lo que evita que acaben divergiendo como divergieron las tres versiones de «una
 * denuncia resumida» hasta que A+B las unificó.
 */

function fecha(iso: string) {
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Una persona: enlazada a su ficha de staff, o su nombre si no lo tiene. */
function Persona({ p }: { p: { id: string; name: string | null } }) {
  // `name` a null es una cuenta eliminada: la fila sobrevive vaciada. Se dice
  // así, sin inventar — ver el residuo anotado en el diseño §3.2: `Conversation`
  // NO guarda snapshot de los interlocutores, así que no hay forma de recuperar
  // quién era, y fingir un nombre sería peor que decir la verdad.
  return (
    <Link href={adminUserHref(p.id)} className="hover:underline">
      {p.name ?? 'Usuario eliminado'}
    </Link>
  );
}

/** De qué iba el hilo — con el snapshot de respaldo si el anuncio ya no está. */
function SobreQue({ c }: { c: ConversacionCabecera }) {
  if (c.listing) {
    return (
      <Link
        href={adminListingHref(c.listing.id)}
        className="hover:underline"
        data-testid="conversacion-anuncio"
      >
        {c.listing.title}
      </Link>
    );
  }
  if (c.listingTitle) {
    // Mismo trato que una denuncia cuyo objeto desapareció (`ReporteDiana`): se
    // dice cuál era, se marca que ya no está, y NO se ofrece un enlace muerto.
    return (
      <span data-testid="conversacion-anuncio-fantasma">
        <span className="text-muted-foreground line-through">{c.listingTitle}</span>
        <span className="ml-1 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
          Anuncio ya no existe
        </span>
      </span>
    );
  }
  return <span className="text-muted-foreground">—</span>;
}

export function ConversacionesPanel({
  token,
  cargar,
  /** Se oculta la columna del anuncio en la ficha de anuncio: es siempre el mismo. */
  mostrarAnuncio = true,
  vacio,
  testId,
}: {
  token: string;
  cargar: (page: number) => Promise<ConversacionesPaginadas>;
  mostrarAnuncio?: boolean;
  vacio: string;
  testId?: string;
}) {
  const [datos, setDatos] = useState<ConversacionesPaginadas | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const pedir = useCallback(
    async (p: number) => {
      if (!token) return;
      setLoading(true);
      setError(null);
      try {
        setDatos(await cargar(p));
      } catch (err) {
        setError(
          err instanceof ApiError ? `Error ${err.statusCode}: ${err.message}` : 'Error al cargar',
        );
      } finally {
        setLoading(false);
      }
    },
    // `cargar` la memoriza quien llama; si no, esto se repetiría en bucle.
    [token, cargar],
  );

  useEffect(() => {
    void pedir(page);
  }, [pedir, page]);

  if (loading && !datos) {
    return <p className="text-xs text-muted-foreground">Cargando conversaciones…</p>;
  }
  if (error) {
    return <p className="text-xs text-destructive">{error}</p>;
  }
  if (!datos || datos.items.length === 0) {
    return <p className="text-xs text-muted-foreground">{vacio}</p>;
  }

  const totalPages = Math.max(1, Math.ceil(datos.total / datos.perPage));

  return (
    <div data-testid={testId}>
      <ul className="space-y-2">
        {datos.items.map((c) => (
          <li key={c.id} className="rounded-md border p-2 text-sm" data-testid="conversacion-fila">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <Persona p={c.buyer} /> <span className="text-muted-foreground">↔</span>{' '}
                <Persona p={c.seller} />
              </span>
              <span className="text-xs text-muted-foreground">
                {c._count.messages} mensaje{c._count.messages === 1 ? '' : 's'}
              </span>
            </div>
            {mostrarAnuncio && (
              <p className="mt-0.5 text-xs">
                <span className="text-muted-foreground">Sobre: </span>
                <SobreQue c={c} />
              </p>
            )}
            <p className="mt-0.5 text-xs text-muted-foreground">
              Empezó el {fecha(c.createdAt)} · último mensaje el {fecha(c.lastMessageAt)}
            </p>
          </li>
        ))}
      </ul>

      {/* CON CONTROLES, no sólo con `page` en el API. Es la lección de A+B: la cola
          de reportes paginaba en el servidor y la interfaz no lo usaba, así que la
          denuncia 25 era inalcanzable — no difícil de ver: imposible. */}
      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between" data-testid="conversaciones-paginacion">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1 || loading}
            className="rounded border px-2 py-1 text-xs disabled:opacity-40"
          >
            Anterior
          </button>
          <span className="text-xs text-muted-foreground">
            Página {page} de {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
            className="rounded border px-2 py-1 text-xs disabled:opacity-40"
            data-testid="conversaciones-siguiente"
          >
            Siguiente
          </button>
        </div>
      )}

      {/* Que se vea POR QUÉ no se puede entrar: si no, la ausencia de enlace se lee
          como un descuido de la pantalla en vez de como una decisión. */}
      <p className="mt-2 text-[11px] text-muted-foreground">
        Sólo se muestra que la conversación existe. El contenido de los mensajes no
        se abre desde aquí.
      </p>
    </div>
  );
}
