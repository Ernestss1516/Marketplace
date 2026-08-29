'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import {
  AlertCircle,
  FileText,
  MessageSquare,
  RefreshCw,
  Search,
  Users,
} from 'lucide-react';
import { getAdminStats, getWorkQueue, type AdminStats, type WorkQueue } from '@/lib/api/admin';
import { ColaDeTrabajo } from '@/components/admin/ColaDeTrabajo';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

function KpiCard({
  title,
  value,
  sub,
  icon: Icon,
}: {
  title: string;
  value: number | string;
  sub?: string;
  icon: React.ElementType;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export default function AdminDashboardPage() {
  const { data: session } = useSession();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;

  const [stats, setStats] = useState<AdminStats | null>(null);
  // N6 — la cola de trabajo. Si falla, el dashboard sigue: son dos lecturas
  // independientes y las métricas no dependen de los contadores.
  const [cola, setCola] = useState<WorkQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    // N6 — dos lecturas INDEPENDIENTES: si la cola falla, el dashboard sigue
    // pintando sus métricas, y al revés. Ninguna de las dos puede tumbar a la otra.
    void getWorkQueue(token)
      .then(setCola)
      .catch(() => setCola(null));
    getAdminStats(token)
      .then(setStats)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Error desconocido'))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-bold">Dashboard</h1>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="pb-2">
                <div className="h-4 w-28 rounded bg-muted" />
              </CardHeader>
              <CardContent>
                <div className="h-8 w-16 rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-bold">Dashboard</h1>
        <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>Error al cargar las métricas: {error}</span>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Dashboard</h1>

      {/*
        N6 — LA COLA DE TRABAJO, LO PRIMERO. Por encima de las métricas porque no
        son la misma clase de dato: «usuarios totales» se mira una vez al mes y
        «3 denuncias abiertas» es trabajo de hoy. Mezcladas —como estaban— lo
        segundo se pierde entre lo primero.
      */}
      {cola && <ColaDeTrabajo cola={cola} />}

      {/* Anuncios */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Anuncios
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <KpiCard
            title="Activos"
            value={stats.listings.active.toLocaleString('es-ES')}
            icon={FileText}
          />
          <KpiCard
            title="En revisión"
            value={stats.listings.pendingReview.toLocaleString('es-ES')}
            sub={stats.listings.pendingReview > 0 ? 'Requieren atención' : undefined}
            icon={AlertCircle}
          />
          <KpiCard
            title="Publicados hoy"
            value={stats.listings.publishedToday.toLocaleString('es-ES')}
            icon={FileText}
          />
        </div>
      </section>

      {/* Usuarios y moderación */}
      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Usuarios y moderación
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <KpiCard
            title="Usuarios totales"
            value={stats.users.total.toLocaleString('es-ES')}
            sub={`+${stats.users.newToday} hoy`}
            icon={Users}
          />
          <KpiCard
            title="Reportes pendientes"
            value={stats.moderation.reportsPending.toLocaleString('es-ES')}
            sub={
              stats.moderation.reportsPending > 0 ? 'Pendientes de revisión' : 'Sin pendientes'
            }
            icon={AlertCircle}
          />
          <KpiCard
            title="Conversaciones"
            value={stats.conversations.total.toLocaleString('es-ES')}
            icon={MessageSquare}
          />
        </div>
      </section>

      {/* Índice de búsqueda */}
      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Índice de búsqueda
        </h2>
        {stats.search ? (
          <Card>
            <CardContent className="flex items-center justify-between pt-6">
              <div className="flex items-center gap-3">
                <Search className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">
                    {stats.search.totalDocuments.toLocaleString('es-ES')} documentos indexados
                  </p>
                  <p className="text-xs text-muted-foreground">Meilisearch</p>
                </div>
              </div>
              {stats.search.isIndexing ? (
                <Badge variant="secondary" className="gap-1">
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  Indexando
                </Badge>
              ) : (
                <Badge variant="outline">Sincronizado</Badge>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="flex items-center gap-2 pt-6 text-sm text-muted-foreground">
              <AlertCircle className="h-4 w-4" />
              Meilisearch no disponible
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
