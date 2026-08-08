'use client';

import { useSession } from 'next-auth/react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { PromocionarControl } from './owner/PromocionarControl';
import { PromotionStatus } from './owner/PromotionStatus';
import { useBumpPricing } from '@/hooks/use-bump-pricing';
import { canPromote } from './owner/promocion';
import type { ListingStatus } from '@/types';

interface Props {
  listingId: string;
  sellerSlug: string;
  listingStatus: ListingStatus;
  featuredUntil?: string | null;
  /** UXV.1 (A2) — mismo campo y misma fuente que consume la tarjeta de /mis-anuncios. */
  nextBumpAt?: string | null;
}

/**
 * UXV.4 — las acciones del propietario EN LA FICHA, reconciliadas con las de la tarjeta.
 *
 * EL DEFECTO (transversal 2 de la auditoría): esta superficie y `MyListingCard` hacían lo
 * mismo de forma distinta. «Subir al inicio (bump)» aquí vs «Bump 5 cr.» allí; el coste
 * visible en una y no en la otra; el saldo y la cuota Pro tenidos en cuenta allí e
 * ignorados aquí. El mismo usuario veía dos productos según por dónde entrase.
 *
 * AHORA las dos montan `PromocionarControl` con el mismo `BumpPricing`, así que comparten
 * rótulo, coste, orden de consumo de las monedas, cooldown (UXV.1) y feedback (UXV.3).
 * Lo único que cambia entre ellas es la FORMA: aquí una columna a ancho completo, allí una
 * fila compacta — que es lo que `contexto` parametriza.
 *
 * LO QUE NO SE TRAE DE LA TARJETA: el ciclo de vida (pausar, archivar, eliminar…). La
 * ficha es donde el vendedor se ve a sí mismo como lo ve un comprador; gestionar el
 * anuncio es lo que hace en `/mis-anuncios`, y duplicar aquí un menú de once acciones
 * volvería a repartir la gestión en dos sitios.
 */
export function ListingOwnerActions({
  listingId,
  sellerSlug,
  listingStatus,
  featuredUntil,
  nextBumpAt,
}: Props) {
  const { data: session } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  const token = session?.user.accessToken;
  const esDuenyo = Boolean(session && session.user.slug === sellerSlug);

  // Solo se piden precios si quien mira es el dueño: una ficha la ven sobre todo
  // visitantes anónimos, y no deben disparar tres llamadas por nada.
  const bumpPricing = useBumpPricing(token, esDuenyo && canPromote(listingStatus));

  if (!esDuenyo || !canPromote(listingStatus) || !token) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">Mis opciones</p>

      <PromotionStatus featuredUntil={featuredUntil} nextBumpAt={nextBumpAt} />

      {bumpPricing ? (
        <PromocionarControl
          listing={{ id: listingId, status: listingStatus, nextBumpAt }}
          token={token}
          bumpPricing={bumpPricing}
          onDone={() => router.refresh()}
          returnTo={pathname}
          contexto="ficha"
        />
      ) : (
        // Mientras llegan los precios NO se pinta un botón sin coste: enseñar
        // «Promocionar» y que al pulsarlo cambie el precio debajo es exactamente la
        // incoherencia que esta ráfaga cierra.
        <div className="flex h-9 w-full items-center justify-center rounded-md border text-xs text-muted-foreground">
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden />
          Cargando opciones…
        </div>
      )}
    </div>
  );
}
