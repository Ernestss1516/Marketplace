'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Share2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Banner, BannerVariant } from '@/lib/api/banners';

const DISMISSED_KEY = 'dismissed-banners';

const VARIANT_STYLES: Record<BannerVariant, string> = {
  INFO: 'border-blue-200 bg-blue-50 text-blue-900',
  PROMO: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  WARNING: 'border-amber-200 bg-amber-50 text-amber-900',
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
  const shareUrl = banner.linkUrl
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
}

/**
 * Descarte permanente por id en localStorage (H8 Bloque D fase 4 — mini-diseño
 * aprobado): el primer render coincide con el SSR (nada descartado todavía) para
 * no romper la hidratación; el filtro real corre en un efecto tras montar. Eso
 * acepta un flash breve para banners YA descartados en visitas anteriores — el
 * propio mini-diseño autoriza este trade-off si evitarlo del todo complica de más.
 */
export function BannerList({ banners }: Props) {
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
    <div className="space-y-3">
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
              {banner.linkUrl && (
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
