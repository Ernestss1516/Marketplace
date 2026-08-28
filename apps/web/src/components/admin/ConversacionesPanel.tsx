'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { adminConversationHref, adminListingHref, adminUserHref } from '@/lib/admin-links';
import { ApiError } from '@/lib/api/client';
import type {
  ConversacionCabecera,
  ConversacionesPaginadas,
} from '@/lib/api/admin-mensajeria';

/**
 * MENSAJERÍA — LA LISTA DE HILOS.
 *
 * Lo que enseña la LISTA es lo que se puede saber sin leer correspondencia ajena:
 * con quién, sobre qué anuncio, cuándo empezó, cuándo se movió y cuántos mensajes
 * tiene. Con eso un moderador ya responde «¿hubo contacto? ¿cuánto? ¿cuándo?» sin
 * abrir nada — y esa consulta no se registra, porque es metadato y se carga en
 * cada visita a una ficha.
 *
 * C2 AÑADIÓ EL ENLACE «LEER», que en C1 no existía porque no había pantalla al
 * otro lado. Cruzar ese enlace ya no es lo mismo: sirve el contenido íntegro y
 * **deja una fila de `AuditLog`**. La distancia entre las dos cosas —mirar la
 * lista y abrir el hilo— es deliberada, y es donde vive la salvaguarda.
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

  const totalPages = datos ? Math.max(1, Math.ceil(datos.total / datos.perPage)) : 1;

  // EL ENVOLTORIO SE PINTA SIEMPRE, también cargando, vacío o con error.
  //
  // Antes cada uno de esos tres estados hacía un `return` temprano con su `<p>` y
  // SIN el `data-testid`, y eso no era un detalle de test: hacía indistinguibles
  // «todavía no ha llegado», «no hay ninguna» y «la petición falló». Un caso que
  // esperase el panel se quedaba mirando quince segundos y decía «element not
  // found» — señalando a la ausencia del panel en vez de a lo que de verdad
  // pasaba. Con el envoltorio siempre presente, el estado se lee.
  return (
    <div data-testid={testId}>
      {loading && !datos && (
        <p className="text-xs text-muted-foreground">Cargando conversaciones…</p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {!loading && !error && datos && datos.items.length === 0 && (
        <p className="text-xs text-muted-foreground">{vacio}</p>
      )}
      {datos && datos.items.length > 0 && (
        <PanelConLista
          datos={datos}
          mostrarAnuncio={mostrarAnuncio}
          totalPages={totalPages}
          page={page}
          loading={loading}
          setPage={setPage}
        />
      )}
    </div>
  );
}

/** La lista propiamente dicha. Separada para que el envoltorio de arriba pueda
 *  pintarse siempre sin anidar el marcado tres niveles. */
function PanelConLista({
  datos,
  mostrarAnuncio,
  totalPages,
  page,
  loading,
  setPage,
}: {
  datos: ConversacionesPaginadas;
  mostrarAnuncio: boolean;
  totalPages: number;
  page: number;
  loading: boolean;
  setPage: (f: (p: number) => number) => void;
}) {
  return (
    <>
      <ul className="space-y-2">
        {datos.items.map((c) => (
          <li key={c.id} className="rounded-md border p-2 text-sm" data-testid="conversacion-fila">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <Persona p={c.buyer} /> <span className="text-muted-foreground">↔</span>{' '}
                <Persona p={c.seller} />
              </span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>
                  {c._count.messages} mensaje{c._count.messages === 1 ? '' : 's'}
                </span>
                {/* C2 — el enlace que en C1 no existía porque no había pantalla.
                    Dice «Leer» y no «Ver» a propósito: lo que hay al otro lado es
                    correspondencia privada, y la palabra debe pesar lo que pesa el
                    acto — que además queda registrado. */}
                <Link
                  href={adminConversationHref(c.id)}
                  className="underline underline-offset-2 hover:text-foreground"
                  data-testid="conversacion-abrir"
                >
                  Leer
                </Link>
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

      {/* El aviso va ANTES de pulsar, no dentro del hilo: quien decide abrir debe
          saber lo que implica cuando todavía puede no hacerlo. Dentro también está,
          pero entonces ya se ha leído y ya consta. */}
      <p className="mt-2 text-[11px] text-muted-foreground">
        Esta lista no muestra el contenido. Abrir una conversación con «Leer» da
        acceso a los mensajes y <strong>queda registrado</strong>.
      </p>
    </>
  );
}
