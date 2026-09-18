'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Share2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { isSafeContentUrl } from '@/lib/blocks/validation';
import type { Banner, BannerVariant } from '@/lib/api/banners';

const DISMISSED_KEY = 'dismissed-banners';

/**
 * LOS TRES ESTILOS — sólo color, y cada uno con el token de SU intención.
 *
 * La forma no está aquí: la cadena de maquetado (`flex … rounded-md border px-4 py-3`) es
 * una sola, común a los tres, y vive en el `className` del banner. Eso es la frontera del
 * sistema de estilo puesta en una tabla: un modelo reviste los tres, no reorganiza ninguno.
 *
 * ── PROMO YA NO VA CON `--success`, Y ERA UN COLOR QUE MENTÍA ───────────────────────
 *
 * Decía `border-success-border bg-success text-success-foreground`, prestado, porque no
 * había otra cosa. Pero `--success` no está libre: significa «ha ido bien» y se usa así en
 * doce sitios —reporte resuelto, cambios guardados, reporte enviado, vendedor verificado—,
 * así que un «20 % de descuento esta semana» salía pintado exactamente igual que un «se ha
 * guardado». No es que quedara feo: el color estaba diciendo otra cosa.
 *
 * Ahora tiene el suyo, `--promo`, que además es el ÚNICO de los tres que cambia de un
 * modelo a otro — y no por capricho. Info (azul) y aviso (amarillo) son convenciones que
 * el usuario trae puestas de fuera de esta plataforma, y el registro las fija a propósito
 * (decisión #2). De qué color es una oferta no lo trae nadie: eso es la casa hablando, y
 * ahí sí manda el modelo. Ver docs/diagnostico-estilos-banner-por-modelo.md §2.
 */
const VARIANT_STYLES: Record<BannerVariant, string> = {
  INFO: 'border-info-border bg-info text-info-foreground',
  PROMO: 'border-promo-border bg-promo text-promo-foreground',
  WARNING: 'border-warning-border bg-warning text-warning-foreground',
};

function readDismissedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function persistDismissedIds(ids: Set<string>) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]));
  } catch {
    // localStorage no disponible (modo privado/cuota) — el descarte no persiste, no bloquea nada.
  }
}

async function shareBanner(banner: Banner): Promise<'shared' | 'copied' | 'failed'> {
  const shareUrl = banner.linkUrl && isSafeContentUrl(banner.linkUrl)
    ? new URL(banner.linkUrl, window.location.origin).toString()
    : window.location.origin;
  const shareText = banner.shareText ?? banner.text;

  if (navigator.share) {
    try {
      await navigator.share({ title: banner.title, text: shareText, url: shareUrl });
      return 'shared';
    } catch {
      // Usuario canceló el share nativo — no es un error a mostrar.
      return 'failed';
    }
  }

  try {
    await navigator.clipboard.writeText(`${shareText} ${shareUrl}`);
    return 'copied';
  } catch {
    return 'failed';
  }
}

interface Props {
  /** Banners ya resueltos por SSR — se renderizan de inmediato (SEO, sin esperar al cliente). */
  banners: Banner[];
  /**
   * El espaciado (y la caja) que esta lista ocupa en SU página, en la raíz del
   * propio componente. Ver el bloque de abajo: es lo que hace que «no hay banner»
   * y «no hay espacio» sean la misma cosa.
   */
  className?: string;
}

/**
 * Descarte permanente por id en localStorage (H8 Bloque D fase 4 — mini-diseño
 * aprobado): el primer render coincide con el SSR (nada descartado todavía) para
 * no romper la hidratación; el filtro real corre en un efecto tras montar. Eso
 * acepta un flash breve para banners YA descartados en visitas anteriores — el
 * propio mini-diseño autoriza este trade-off si evitarlo del todo complica de más.
 *
 * ── EL ESPACIADO ES SUYO, Y ESO ARREGLA UN HUECO ────────────────────────────
 *
 * Hasta aquí, cada página envolvía la lista en un `<div className="mb-6">` (o
 * `pt-4`, o `mb-8`) y la protegía con `banners.length > 0`. Las dos cosas fallan
 * a la vez en el único camino que decide de CLIENTE: el servidor manda banners
 * —activos, en fecha, en esa ubicación—, así que el guard pasa y el envoltorio se
 * monta; después el efecto de abajo ve que el visitante ya los descartó y esto
 * devuelve `null`. El envoltorio se queda vacío **con su margen**.
 *
 * MEDIDO PÁGINA A PÁGINA (docs/diagnostico-hueco-banner-invisible.md §2.1), y el
 * resultado no es el que parece: **16 px en la portada y 0 px en las otras
 * nueve**. La portada usa PADDING (`pt-4`), que no colapsa con nada; las demás
 * usan margen, y el elemento que va justo encima del banner ya trae el suyo
 * (`mb-6`, `mb-10`…), que se funde con el del envoltorio y lo absorbe.
 *
 * Esos nueve ceros no son «no hay defecto»: son un envoltorio LATENTE. No cuesta
 * píxeles mientras el vecino de arriba conserve su margen, y los cuesta el día que
 * alguien se lo quite, en una página que nadie estaba tocando. El arreglo quita la
 * trampa; que además quite 16 px visibles es el caso de hoy, no la razón.
 *
 * Con la clase EN LA RAÍZ, ese estado no existe: `null` se lleva el margen con
 * él, igual que hace `FeaturedBlock` con su `mb-6`. Y el guard del punto de
 * llamada sobra —era la segunda copia de la decisión que se toma diez líneas más
 * abajo—, que es justamente cómo se llegó a que una de las dos se quedara atrás.
 *
 * El espaciado sigue decidiéndolo la página, que es quien conoce su ritmo: las
 * seis de cuenta no pasan nada (su `space-y-*` ya lo da) y las diez públicas
 * pasan la misma clase que antes llevaba el envoltorio. Ni un píxel de cambio
 * cuando el banner SÍ se pinta.
 */
export function BannerList({ banners, className }: Props) {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    setDismissedIds(readDismissedIds());
  }, []);

  function dismiss(id: string) {
    setDismissedIds((prev) => {
      const next = new Set(prev).add(id);
      persistDismissedIds(next);
      return next;
    });
  }

  async function handleShare(banner: Banner) {
    const result = await shareBanner(banner);
    if (result === 'copied') {
      setCopiedId(banner.id);
      setTimeout(() => setCopiedId((current) => (current === banner.id ? null : current)), 2000);
    }
  }

  const visible = banners.filter((b) => !dismissedIds.has(b.id));
  if (visible.length === 0) return null;

  return (
    <div className={cn('space-y-3', className)} data-testid="banner-list">
      {visible.map((banner) => (
        <div
          key={banner.id}
          data-testid="banner"
          className={`flex items-start justify-between gap-3 rounded-md border px-4 py-3 ${VARIANT_STYLES[banner.variant]}`}
        >
          <div className="flex-1">
            <p className="font-medium">{banner.title}</p>
            <p className="text-sm">{banner.text}</p>
            <div className="mt-2 flex items-center gap-3">
              {banner.linkUrl && isSafeContentUrl(banner.linkUrl) && (
                <Link href={banner.linkUrl} className="text-sm font-medium underline underline-offset-2">
                  {banner.linkText ?? 'Ver más'}
                </Link>
              )}
              {banner.shareable && (
                <button
                  type="button"
                  onClick={() => handleShare(banner)}
                  className="inline-flex items-center gap-1 text-sm font-medium underline underline-offset-2"
                  data-testid="banner-share-button"
                >
                  <Share2 className="h-3.5 w-3.5" />
                  {copiedId === banner.id ? 'Enlace copiado' : 'Compartir'}
                </button>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={() => dismiss(banner.id)}
            aria-label="Cerrar aviso"
            data-testid="banner-dismiss-button"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}
