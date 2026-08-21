'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { AlertCircle, ChevronLeft, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { createStaffTicket, getStaffTicketTopics, toStaffTicketMessage } from '@/lib/api/admin-tickets';
import { getAdminListing, getAdminUser } from '@/lib/api/admin';
import { searchUsers } from '@/lib/api/usuarios';
import type { PersonStub, TicketTopic } from '@/types';

/**
 * FLUJO (b) — la administración abre un hilo con un usuario concreto.
 *
 * El usuario se elige con `GET /users/search`, que YA EXISTE (lo usa el selector
 * de comprador al cerrar un Deal). No se crea ninguna búsqueda nueva.
 *
 * ─── PUNTO 1 DEL LOTE: LLEGAR AQUÍ YA RELLENO, DESDE UNA FICHA ────────────────
 *
 * Dos parámetros, y **nunca los dos a la vez**:
 *
 *   · `?listingId=…`  — desde la ficha de un anuncio (F1).
 *   · `?userId=…`     — desde la ficha de un usuario (U3).
 *
 * **EL DESTINATARIO NO VIAJA EN LA URL CUANDO HAY ANUNCIO: SE DERIVA DE ÉL.** Es la
 * pieza que hace que esta pantalla no pueda construir un ticket que el backend vaya a
 * rechazar. `assertLinkable` valida el enlace **contra el destinatario del hilo**, no
 * contra el agente —porque el `linkedLabel` se le sirve a él, y enlazar ahí el anuncio
 * de un tercero sería filtrarle un dato ajeno—, así que «anuncio X» y «usuario Y» sólo
 * son una combinación legal si X es de Y. Con un único parámetro de entrada, del que
 * sale el otro, **la incoherencia no es representable**: no hay dos campos que puedan
 * discrepar.
 *
 * Y NADA DE LO QUE SE PINTA SALE DE LA URL: el nombre del destinatario y el título del
 * anuncio se piden al servidor (`GET /admin/users/:id`, `GET /admin/listings/:id`, los
 * dos MODERATOR, el mismo piso que esta sección). Un `?userName=` en la barra de
 * direcciones podría mentirle al agente sobre a quién le está escribiendo — es el mismo
 * criterio por el que el backend deriva `linkedLabel` en vez de aceptarlo del cliente.
 */
export default function NuevoAdminTicketPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;

  const listingIdParam = searchParams.get('listingId');
  const userIdParam = searchParams.get('userId');

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PersonStub[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<PersonStub | null>(null);

  /** El anuncio enlazado, ya resuelto contra el servidor. Null si no se vino de uno. */
  const [linkedListing, setLinkedListing] = useState<{ id: string; title: string } | null>(null);
  const [prefilling, setPrefilling] = useState(Boolean(listingIdParam || userIdParam));

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [topicId, setTopicId] = useState('');
  const [topics, setTopics] = useState<TicketTopic[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    void getStaffTicketTopics(token)
      .then(setTopics)
      .catch(() => setTopics([]));
  }, [token]);

  /**
   * El prellenado. `listingId` GANA sobre `userId` si llegaran los dos: el anuncio es
   * el dato más específico y además determina al destinatario, así que hacerle caso al
   * otro sólo podría producir la pareja incoherente que el guard rechaza.
   */
  const prellenar = useCallback(async () => {
    if (!token || (!listingIdParam && !userIdParam)) return;
    setPrefilling(true);
    setError(null);
    try {
      if (listingIdParam) {
        const listing = await getAdminListing(token, listingIdParam);
        // AQUÍ ESTÁ LA COHERENCIA: el destinatario es el VENDEDOR del anuncio, salido
        // de la misma respuesta que el título. No hay forma de que sea otro.
        setSelected({
          id: listing.seller.id,
          name: listing.seller.name ?? listing.seller.email,
          slug: listing.seller.slug ?? '',
        });
        setLinkedListing({ id: listing.id, title: listing.title });
      } else if (userIdParam) {
        const user = await getAdminUser(token, userIdParam);
        setSelected({ id: user.id, name: user.name ?? user.email, slug: user.slug ?? '' });
      }
    } catch (err) {
      // Si no se puede resolver, la pantalla NO se queda a medias: se queda como la de
      // siempre (buscador de usuario) con el aviso puesto. Un prellenado roto no debe
      // impedir abrir un ticket a mano.
      setError(toStaffTicketMessage(err));
    } finally {
      setPrefilling(false);
    }
  }, [token, listingIdParam, userIdParam]);

  useEffect(() => {
    void prellenar();
  }, [prellenar]);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!token || query.trim().length < 2) return;
    setSearching(true);
    setError(null);
    try {
      setResults(await searchUsers(query.trim(), token));
    } catch (err) {
      setError(toStaffTicketMessage(err));
    } finally {
      setSearching(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !selected || subject.trim().length < 3 || !body.trim() || sending) return;

    setSending(true);
    setError(null);
    try {
      const ticket = await createStaffTicket(
        {
          userId: selected.id,
          subject: subject.trim(),
          body: body.trim(),
          ...(topicId && { topicId }),
          // El vínculo, si se vino de una ficha de anuncio. Va SOLO el id: el título
          // que el usuario leerá en su ticket lo deriva el servidor.
          ...(linkedListing && { listingId: linkedListing.id }),
        },
        token,
      );
      router.push(`/admin/tickets/${ticket.id}`);
    } catch (err) {
      setError(toStaffTicketMessage(err));
      setSending(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/admin/tickets">
          <ChevronLeft className="mr-1 h-4 w-4" />
          Bandeja
        </Link>
      </Button>

      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Abrir un hilo con un usuario</h1>
        <p className="text-sm text-muted-foreground">
          El usuario lo verá en sus tickets y podrá responder. Nace esperando su respuesta y
          asignado a ti.
        </p>
      </div>

      {/* ── El anuncio enlazado, si se vino de su ficha ─────────────────────── */}
      {linkedListing && (
        <div
          className="flex items-start justify-between gap-3 rounded-md border bg-muted/40 p-3 text-sm"
          data-testid="ticket-anuncio-enlazado"
        >
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Anuncio enlazado</p>
            <Link
              href={`/admin/anuncios/${linkedListing.id}`}
              className="font-medium hover:underline"
            >
              {linkedListing.title}
            </Link>
            <p className="mt-0.5 text-xs text-muted-foreground">
              El destinatario es su vendedor: un anuncio sólo se puede enlazar al ticket
              de quien lo publicó.
            </p>
          </div>
          {/* Quitar el enlace es lo que DESBLOQUEA cambiar de destinatario, y en ese
              orden a propósito: mientras haya anuncio, la pareja la fija él. */}
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={() => setLinkedListing(null)}
            data-testid="ticket-quitar-enlace"
          >
            Quitar
          </Button>
        </div>
      )}

      {/* ── Paso 1: elegir usuario ─────────────────────────────────────────── */}
      <div className="space-y-2">
        <Label htmlFor="buscar-usuario">Usuario</Label>
        {prefilling ? (
          <div className="flex items-center gap-2 rounded-md border p-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando…
          </div>
        ) : selected ? (
          <div className="flex items-center justify-between rounded-md border bg-muted/40 p-3 text-sm">
            <div>
              <p className="font-medium" data-testid="ticket-destinatario">
                {selected.name}
              </p>
              <p className="text-muted-foreground">/vendedor/{selected.slug}</p>
            </div>
            {/* Con un anuncio enlazado NO se ofrece cambiar: la pareja anuncio↔usuario
                la impone el guard del backend, y un botón que produce un 422 seguro es
                un botón que no debe existir. Se cambia quitando antes el anuncio. */}
            {!linkedListing && (
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                Cambiar
              </Button>
            )}
          </div>
        ) : (
          <>
            <form onSubmit={handleSearch} className="flex gap-2">
              <Input
                id="buscar-usuario"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Nombre o identificador…"
                data-testid="buscar-usuario"
              />
              <Button type="submit" variant="outline" disabled={searching || query.trim().length < 2}>
                {searching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
              </Button>
            </form>
            {results.length > 0 && (
              <ul className="divide-y rounded-md border" data-testid="resultados-usuarios">
                {results.map((u) => (
                  <li key={u.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted/50"
                      onClick={() => setSelected(u)}
                    >
                      <span>{u.name}</span>
                      <span className="text-xs text-muted-foreground">/vendedor/{u.slug}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {/* ── Paso 2: el mensaje ─────────────────────────────────────────────── */}
      <form onSubmit={handleSubmit} className="space-y-4" data-testid="form-admin-ticket">
        <div className="space-y-2">
          <Label htmlFor="subject">Asunto</Label>
          <Input
            id="subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={150}
            required
          />
        </div>

        {topics.length > 0 && (
          <div className="space-y-2">
            <Label htmlFor="topicId">Motivo (opcional)</Label>
            <select
              id="topicId"
              value={topicId}
              onChange={(e) => setTopicId(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">Sin especificar</option>
              {topics.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="body">Mensaje</Label>
          <Textarea
            id="body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            maxLength={5000}
            required
          />
        </div>

        {error && (
          <div
            className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            role="alert"
            data-testid="error-admin-ticket"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <Button
          type="submit"
          disabled={!selected || subject.trim().length < 3 || !body.trim() || sending}
          data-testid="enviar-admin-ticket"
        >
          {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Abrir hilo
        </Button>
      </form>
    </div>
  );
}
