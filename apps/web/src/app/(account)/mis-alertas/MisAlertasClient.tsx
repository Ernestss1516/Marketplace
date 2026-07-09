'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Eye, Pause, Play, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useApiAction } from '@/lib/api/use-api-action';
import { deleteAlert, getAlertMatches, updateAlert } from '@/lib/api/alertas';
import { formatAlertCriteria } from '@/lib/alert-summary';
import type { Alert, ListingSummary } from '@/types';

interface Props {
  initialItems: Alert[];
  totalInitial: number;
  page: number;
  pages: number;
}

type MatchesState = 'loading' | 'error' | ListingSummary[];

export function MisAlertasClient({ initialItems, totalInitial, page, pages }: Props) {
  const { data: session } = useSession();
  const { run } = useApiAction();
  const token = session?.user.accessToken;

  const [items, setItems] = useState(initialItems);
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [matches, setMatches] = useState<Record<string, MatchesState>>({});

  const visibleItems = items.filter((a) => !removedIds.has(a.id));
  const visibleTotal = totalInitial - removedIds.size;

  function handleToggleActive(alert: Alert) {
    if (!token) return;
    const next = !alert.active;
    setItems((prev) => prev.map((a) => (a.id === alert.id ? { ...a, active: next } : a)));
    run(() => updateAlert(alert.id, { active: next }, token), {
      onError: () =>
        setItems((prev) => prev.map((a) => (a.id === alert.id ? { ...a, active: !next } : a))),
    });
  }

  function handleDelete(id: string) {
    if (!token) return;
    setRemovedIds((prev) => new Set([...prev, id]));
    run(() => deleteAlert(id, token), {
      onError: () =>
        setRemovedIds((prev) => {
          const s = new Set(prev);
          s.delete(id);
          return s;
        }),
    });
  }

  function handleToggleMatches(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!token || matches[id]) return;
    setMatches((prev) => ({ ...prev, [id]: 'loading' }));
    run(() => getAlertMatches(id, token), {
      onSuccess: (data) => setMatches((prev) => ({ ...prev, [id]: data.hits })),
      onError: () => setMatches((prev) => ({ ...prev, [id]: 'error' })),
    });
  }

  return (
    <>
      <p className="text-sm text-muted-foreground">
        {visibleTotal} {visibleTotal === 1 ? 'alerta guardada' : 'alertas guardadas'}
      </p>

      <ul className="space-y-3">
        {visibleItems.map((alert) => {
          const alertMatches = matches[alert.id];
          return (
            <li key={alert.id} className="rounded-md border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{alert.name}</span>
                    {!alert.active && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        Pausada
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{formatAlertCriteria(alert)}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="outline" size="sm" onClick={() => handleToggleMatches(alert.id)}>
                    <Eye className="mr-1.5 h-4 w-4" />
                    Ver coincidencias
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleToggleActive(alert)}>
                    {alert.active ? (
                      <Pause className="mr-1.5 h-4 w-4" />
                    ) : (
                      <Play className="mr-1.5 h-4 w-4" />
                    )}
                    {alert.active ? 'Pausar' : 'Reactivar'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleDelete(alert.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {expandedId === alert.id && (
                <div className="mt-3 border-t pt-3">
                  {alertMatches === 'loading' && (
                    <p className="text-sm text-muted-foreground">Cargando…</p>
                  )}
                  {alertMatches === 'error' && (
                    <p className="text-sm text-destructive">
                      No se pudieron cargar las coincidencias.
                    </p>
                  )}
                  {Array.isArray(alertMatches) && alertMatches.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No hay anuncios que coincidan ahora mismo.
                    </p>
                  )}
                  {Array.isArray(alertMatches) && alertMatches.length > 0 && (
                    <ul className="space-y-1">
                      {alertMatches.map((l) => (
                        <li key={l.id}>
                          <Link
                            href={`/anuncio/${l.slug}`}
                            className="text-sm text-primary hover:underline"
                          >
                            {l.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          {page > 1 && (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/mis-alertas?page=${page - 1}`}>Anterior</Link>
            </Button>
          )}
          <span className="text-sm text-muted-foreground">
            Página {page} de {pages}
          </span>
          {page < pages && (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/mis-alertas?page=${page + 1}`}>Siguiente</Link>
            </Button>
          )}
        </div>
      )}
    </>
  );
}
