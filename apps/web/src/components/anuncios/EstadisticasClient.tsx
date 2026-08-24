'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Eye, Heart, Search, TrendingUp } from 'lucide-react';
import { ProGate } from '@/components/pro/ProGate';
import { StatsChart, STATS_COLORS } from '@/components/stats/StatsChart';
import { CtrLine } from '@/components/stats/CtrLine';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
          {/* A2 — «veces listado» va EN ESTA MISMA FILA y no en una tarjeta aparte: es la
              tercera cifra de la misma pregunta («¿cómo le va a mi anuncio?») y el
              vendedor la busca donde ya mira. Solo llega para Pro, así que la fila crece
              sola sin ninguna condición de plan escrita aquí. */}
          {stats.impressionCount !== undefined && (
            <span className="flex items-center gap-1.5" data-testid="stats-impressions">
              <Search className="h-4 w-4 text-muted-foreground" />
              <strong>{stats.impressionCount}</strong> veces listado
            </span>
          )}
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

          <StatsChart
            testId="stats-chart"
            title="Visitas y veces listado, por día"
            description="Últimos 30 días"
            emptyMessage="Aún no hay datos suficientes para este anuncio."
            series={[
              {
                key: 'views',
                label: 'Visitas',
                color: STATS_COLORS.views,
                data: stats?.dailyViews ?? [],
              },
              {
                key: 'impressions',
                label: 'Veces listado',
                color: STATS_COLORS.impressions,
                data: stats?.dailyImpressions ?? [],
              },
            ]}
          />

          {/* QUÉ ES «VECES LISTADO», dicho donde el vendedor lo lee y con las palabras que
              la métrica significa de verdad. Ni «impresiones» (jerga) ni «visualizaciones»
              (mentira: aparecer en una lista no es que alguien lo haya mirado). */}
          <Card data-testid="stats-ctr">
            <CardHeader>
              <CardTitle className="text-base">Qué te dicen estos números</CardTitle>
              <CardDescription>
                <strong>Veces listado</strong> es cuántas veces tu anuncio ha aparecido en una
                página de resultados de búsqueda. <strong>Visitas</strong> es cuántas veces
                alguien ha entrado a verlo.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <CtrLine ctr={stats?.ctr} />
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
        // El otro gate que ya estaba bien hecho, ahora sobre el molde común. Mismo testid
        // y mismo texto: lo que cambia es que la forma sale de un solo sitio.
        <ProGate testId="stats-upgrade-cta" titulo="Estadísticas avanzadas (gráficas, tendencias)">
          Disponibles con Pro: vistas por día, <strong>veces listado</strong> (cuántas veces sales
          en los resultados de búsqueda), ratio de me gusta y el agregado de todos tus anuncios.
        </ProGate>
      )}
    </div>
  );
}
