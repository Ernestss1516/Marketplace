'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Eye, Heart, Lock, TrendingUp } from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getMineStats, getMineStatsSummary } from '@/lib/api/anuncios';
import type { ProStatus } from '@/lib/api/billing';
import type { ListingStats, ListingStatsSummary, ListingSummary } from '@/types';

interface Props {
  listings: ListingSummary[];
  proStatus: ProStatus;
  token: string;
}

function formatDay(iso: string): string {
  return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit' }).format(
    new Date(iso),
  );
}

export function EstadisticasClient({ listings, proStatus, token }: Props) {
  /**
   * UXV.4 (M10) — el anuncio puede venir en la URL (`?anuncio=<id>`), que es como llega
   * quien pulsa «Ver estadísticas» en una tarjeta concreta. Antes esta pantalla solo se
   * abría en global y había que volver a buscar el anuncio en un `<Select>` de N.
   * Un id que no es del usuario simplemente no está en la lista → se cae al primero, que
   * es el comportamiento de siempre.
   */
  const pedido = useSearchParams().get('anuncio');
  const inicial = listings.some((l) => l.id === pedido) ? pedido! : listings[0]?.id;
  const [selectedId, setSelectedId] = useState<string | undefined>(inicial);
  const [stats, setStats] = useState<ListingStats | null>(null);
  const [summary, setSummary] = useState<ListingStatsSummary | null>(null);

  useEffect(() => {
    if (!selectedId) return;
    getMineStats(selectedId, token)
      .then(setStats)
      .catch(() => setStats(null));
  }, [selectedId, token]);

  useEffect(() => {
    if (!proStatus.isPro) return;
    getMineStatsSummary(token)
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [proStatus.isPro, token]);

  const mostViewed = useMemo(
    () => listings.find((l) => l.id === summary?.mostViewedListingId),
    [listings, summary],
  );

  if (listings.length === 0) {
    return (
      <p className="text-muted-foreground">
        Aún no tienes anuncios. Publica uno para empezar a ver estadísticas.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="max-w-sm">
        <Select value={selectedId} onValueChange={setSelectedId}>
          <SelectTrigger data-testid="stats-listing-select">
            <SelectValue placeholder="Selecciona un anuncio…" />
          </SelectTrigger>
          <SelectContent>
            {listings.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {stats && (
        <div
          className="flex items-center gap-6 rounded-md border bg-muted/30 px-4 py-3 text-sm"
          data-testid="stats-basic"
        >
          <span className="flex items-center gap-1.5">
            <Eye className="h-4 w-4 text-muted-foreground" />
            <strong>{stats.viewCount}</strong> vistas
          </span>
          <span className="flex items-center gap-1.5">
            <Heart className="h-4 w-4 text-muted-foreground" />
            <strong>{stats.favoritesCount}</strong> me gusta
          </span>
        </div>
      )}

      {proStatus.isPro ? (
        <>
          {stats?.likeRatio !== undefined && (
            <p className="text-sm text-muted-foreground" data-testid="stats-like-ratio">
              Un <strong>{Math.round(stats.likeRatio * 100)}%</strong> de quienes lo ven lo guardan
              en favoritos.
            </p>
          )}

          <Card data-testid="stats-chart">
            <CardHeader>
              <CardTitle className="text-base">Vistas por día</CardTitle>
              <CardDescription>Últimos 30 días</CardDescription>
            </CardHeader>
            <CardContent>
              {stats?.dailyViews && stats.dailyViews.length > 0 ? (
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={stats.dailyViews}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="date" tickFormatter={formatDay} fontSize={12} />
                      <YAxis allowDecimals={false} fontSize={12} />
                      <Tooltip labelFormatter={(label) => formatDay(String(label))} />
                      <Line type="monotone" dataKey="count" name="Vistas" stroke="#2563eb" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Aún no hay datos suficientes para este anuncio.
                </p>
              )}
            </CardContent>
          </Card>

          <Card data-testid="stats-summary">
            <CardHeader>
              <CardTitle className="text-base">Todos tus anuncios</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>
                Total de vistas: <strong>{summary?.totalViews ?? 0}</strong>
              </p>
              <p>
                Total de me gusta: <strong>{summary?.totalFavorites ?? 0}</strong>
              </p>
              {mostViewed && (
                <p className="flex items-center gap-1.5">
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  Tu anuncio más visto:{' '}
                  <Link href={`/anuncio/${mostViewed.slug}`} className="underline hover:text-foreground">
                    {mostViewed.title}
                  </Link>
                </p>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <Card className="border-dashed" data-testid="stats-upgrade-cta">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <Lock className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium">Estadísticas avanzadas (gráficas, tendencias)</p>
            <p className="text-sm text-muted-foreground">
              Disponibles con Pro: vistas por día, ratio de me gusta y el agregado de todos tus
              anuncios.
            </p>
            <Button asChild>
              <Link href="/planes">Hazte Pro</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
