'use client';

import { useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { trackListingView } from '@/lib/api/anuncios';

interface Props {
  slug: string;
}

/**
 * Dispara el tracking de la vista al montar la ficha — desacoplado del render
 * cacheado en Redis (findBySlug), porque este POST se ejecuta siempre en el
 * cliente. Silencioso: no bloquea el render ni muestra nada, y los errores se
 * ignoran (el tracking nunca debe afectar la experiencia de ver el anuncio).
 *
 * Espera a que la sesión termine de resolverse (status !== 'loading') antes de
 * disparar: si se envía mientras aún no se sabe si hay sesión, el backend no
 * puede excluir al dueño (llegaría sin token aunque el visitante esté logueado).
 */
export function ListingViewTracker({ slug }: Props) {
  const { data: session, status } = useSession();
  const firedForSlug = useRef<string | null>(null);

  useEffect(() => {
    if (status === 'loading') return;
    if (firedForSlug.current === slug) return;
    firedForSlug.current = slug;
    trackListingView(slug, session?.user.accessToken).catch(() => {});
  }, [slug, status, session]);

  return null;
}
