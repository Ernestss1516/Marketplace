'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { AlertCircle, ChevronLeft, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { createStaffTicket, getStaffTicketTopics, toStaffTicketMessage } from '@/lib/api/admin-tickets';
import { searchUsers } from '@/lib/api/usuarios';
import type { PersonStub, TicketTopic } from '@/types';

/**
 * FLUJO (b) — la administración abre un hilo con un usuario concreto.
 *
 * El usuario se elige con `GET /users/search`, que YA EXISTE (lo usa el selector
 * de comprador al cerrar un Deal). No se crea ninguna búsqueda nueva.
 */
export default function NuevoAdminTicketPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PersonStub[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<PersonStub | null>(null);

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

      {/* ── Paso 1: elegir usuario ─────────────────────────────────────────── */}
      <div className="space-y-2">
        <Label htmlFor="buscar-usuario">Usuario</Label>
        {selected ? (
          <div className="flex items-center justify-between rounded-md border bg-muted/40 p-3 text-sm">
            <div>
              <p className="font-medium">{selected.name}</p>
              <p className="text-muted-foreground">/vendedor/{selected.slug}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
              Cambiar
            </Button>
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
