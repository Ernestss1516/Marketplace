'use client';

import Link from 'next/link';
import { BarChart3, FileText, Users } from 'lucide-react';

/**
 * ESTADÍSTICAS — LA SECCIÓN DEL BACKOFFICE.
 *
 * ─── POR QUÉ ESTA PÁGINA EXISTE YA, SI SU CONTENIDO LLEGA EN B2 ──────────────────
 *
 * Porque la fila de `backoffice-sections.ts` y la página son **la misma decisión**:
 * `canAccessAdminPath` es fail-closed ante una ruta sin sección, y el test «no hay
 * secciones declaradas que no existan en disco» exige lo contrario — una fila sin página.
 * Declarar la sección es, por construcción, crear la ruta.
 *
 * ─── Y POR QUÉ NO SE LE INVENTA CONTENIDO ───────────────────────────────────────
 *
 * Lo que va aquí es el monitoreo por categoría y el pulso de plataforma (B.3 y B.4 del
 * diseño), que es una ráfaga entera: un `GROUP BY` por categoría sobre la ventana, el
 * subárbol de cada categoría y la tabla ordenable con deltas. Rellenar el hueco mientras
 * tanto con cifras a medias sería peor que decir dónde está hoy cada cosa: **la actividad
 * por anuncio y por usuario ya está**, y esta pantalla lleva a ella en vez de duplicarla.
 */

const DESTINOS = [
  {
    href: '/admin/anuncios',
    icon: FileText,
    titulo: 'Actividad de un anuncio',
    texto:
      'Visitas y veces listado por día, con sus ratios. Está en la ficha de cada anuncio, en la sección «Actividad».',
  },
  {
    href: '/admin/usuarios',
    icon: Users,
    titulo: 'Actividad de un usuario',
    texto:
      'El conjunto de sus anuncios, agregado: totales, la serie diaria y sus anuncios más vistos y más listados.',
  },
];

export default function AdminEstadisticasPage() {
  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Estadísticas</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        La actividad real del sitio: cuántas veces se ven los anuncios y cuántas veces salen en
        los resultados de búsqueda.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {DESTINOS.map(({ href, icon: Icon, titulo, texto }) => (
          <Link
            key={href}
            href={href}
            className="rounded-lg border bg-card p-4 transition-colors hover:bg-muted/50"
            data-testid={`estadisticas-destino-${href.split('/').pop()}`}
          >
            <div className="mb-1 flex items-center gap-2">
              <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
              <h2 className="font-medium">{titulo}</h2>
            </div>
            <p className="text-sm text-muted-foreground">{texto}</p>
          </Link>
        ))}
      </div>

      <div
        className="mt-6 flex items-start gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground"
        data-testid="estadisticas-pendiente"
      >
        <BarChart3 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>
          El monitoreo por categoría y el pulso de la plataforma —qué categoría genera más
          actividad, y cómo evoluciona— se añaden aquí en la siguiente entrega.
        </p>
      </div>
    </div>
  );
}
