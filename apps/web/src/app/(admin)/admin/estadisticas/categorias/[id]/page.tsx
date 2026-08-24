'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { ArrowLeft } from 'lucide-react';
import { ActivityPanel } from '@/components/stats/ActivityPanel';
import { useActividad } from '@/components/stats/useActividad';
import { getActividadCategoria, type ActividadCategoria } from '@/lib/api/admin-stats';

/**
 * ESTADÍSTICAS B.3 — la actividad de una categoría.
 *
 * ─── POR QUÉ VIVE AQUÍ Y NO EN `/admin/categorias` ───────────────────────────────
 *
 * Aquella pantalla es el EDITOR del catálogo (crear, ordenar, esquema de atributos,
 * políticas) y no tiene ficha de detalle donde colgar esto. Ésta cuelga del pulso de
 * plataforma, que es donde el staff está mirando cuando le surge la pregunta: ve una
 * categoría con números raros en la tabla y entra a verla.
 *
 * Ruta PROPIA y no un panel dentro de la tabla, por el mismo motivo que las fichas de
 * anuncio y de usuario: un panel no se puede enlazar. Y al colgar de `/admin/estadisticas`
 * hereda su piso de rol por segmento, sin fila nueva en el mapa de secciones.
 *
 * ─── EL INTERRUPTOR DEL SUBÁRBOL ────────────────────────────────────────────────
 *
 * `Listing.categoryId` apunta siempre a la HOJA, así que por defecto se suma la rama
 * entera: una raíz sin plegar diría casi cero y se leería como «esta categoría está
 * muerta» cuando lo que pasa es que sus anuncios cuelgan de sus hijas. El interruptor
 * existe porque las dos cifras responden preguntas distintas —«¿cuánto mueve esta rama?» y
 * «¿cuánto mueve esta categoría concreta?»— y enseñar sólo una miente en la mitad de los
 * casos.
 */
export default function AdminEstadisticasCategoriaPage() {
  const params = useParams<{ id: string }>();
  const { data: session } = useSession();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;

  const [subtree, setSubtree] = useState(true);

  // `extraKey: subtree` es lo que hace que el interruptor recargue: el hook lo lleva en
  // las dependencias de su efecto, igual que la ventana.
  const { actividad, days, setDays, loading, error } = useActividad<ActividadCategoria>(
    (rango, tk) => getActividadCategoria(params.id, rango, tk, subtree),
    token,
    { extraKey: subtree },
  );

  return (
    <div>
      <Link
        href="/admin/estadisticas"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver al pulso de la plataforma
      </Link>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold" data-testid="categoria-nombre">
            {actividad?.name ?? 'Categoría'}
          </h1>
          {actividad && (
            <p className="text-sm text-muted-foreground">
              {actividad.listingCount === 1
                ? '1 anuncio'
                : `${actividad.listingCount.toLocaleString('es-ES')} anuncios`}
              {actividad.subtree && actividad.descendantCount > 0
                ? `, incluyendo ${actividad.descendantCount} ${
                    actividad.descendantCount === 1 ? 'subcategoría' : 'subcategorías'
                  }`
                : ''}
            </p>
          )}
        </div>

        {actividad && actividad.descendantCount > 0 && (
          <button
            type="button"
            onClick={() => setSubtree((v) => !v)}
            aria-pressed={subtree}
            data-testid="categoria-subarbol"
            className="rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-muted/50"
          >
            {subtree ? 'Incluyendo subcategorías' : 'Solo esta categoría'}
          </button>
        )}
      </div>

      <ActivityPanel
        testId="actividad-categoria"
        actividad={actividad}
        days={days}
        onDaysChange={setDays}
        loading={loading}
        error={error}
      >
        {actividad && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span>
              <strong>{actividad.viewCount.toLocaleString('es-ES')}</strong> visitas
            </span>
            <span>
              <strong>{actividad.impressionCount.toLocaleString('es-ES')}</strong> veces listado
            </span>
          </div>
        )}
      </ActivityPanel>

      {actividad && (actividad.mostViewed || actividad.mostListed) && (
        <div className="mt-4 space-y-1 rounded-lg border bg-card p-4 text-sm">
          {actividad.mostViewed && (
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Su anuncio más visto</span>
              <Link
                href={`/admin/anuncios/${actividad.mostViewed.id}`}
                className="line-clamp-1 text-right font-medium hover:underline"
                data-testid="categoria-mas-visto"
              >
                {actividad.mostViewed.title} ({actividad.mostViewed.viewCount})
              </Link>
            </div>
          )}
          {actividad.mostListed && (
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Su anuncio más listado</span>
              <Link
                href={`/admin/anuncios/${actividad.mostListed.id}`}
                className="line-clamp-1 text-right font-medium hover:underline"
                data-testid="categoria-mas-listado"
              >
                {actividad.mostListed.title} ({actividad.mostListed.impressionCount})
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
