'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { AlertTriangle, Eye, Heart, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatListingPrice } from './listing-card-shared';
import { VideoIndicator } from './VideoIndicator';
import { ProHint } from '@/components/pro/ProGate';
import { PromocionarControl } from './owner/PromocionarControl';
import { PromotionStatus } from './owner/PromotionStatus';
import { OwnerActionsMenu } from './owner/OwnerActionsMenu';
import { useListingActions } from './owner/use-listing-actions';
import { canPromote } from './owner/promocion';
import { CloseDealDialog } from './CloseDealDialog';
import type { BumpPricing, ListingSummary } from '@/types';

// I18N T3-B — los nueve estados estaban copiados aquí, idénticos a los de la fuente.
// Es la copia que MÁS caro salía si divergía: el vendedor lee el estado de su anuncio
// en esta tarjeta y el staff lo lee en el backoffice, y tienen que estar hablando de
// lo mismo cuando uno escribe al otro.
import { STATUS_LABELS } from '@/lib/etiquetas-enums';

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  DRAFT: 'secondary',
  ACTIVE: 'default',
  RESERVED: 'secondary',
  SOLD: 'outline',
  EXPIRED: 'outline',
  PENDING_REVIEW: 'secondary',
  REJECTED: 'destructive',
  PAUSED: 'secondary',
  ARCHIVED: 'outline',
};

interface Props {
  listing: ListingSummary;
  token: string;
  onAction: () => void;
  bumpPricing: BumpPricing;
}

/**
 * UXV.4 (A6) — la tarjeta de gestión, con JERARQUÍA.
 *
 * LO QUE HABÍA: hasta doce botones `variant="outline" size="sm"` en un solo `flex-wrap`.
 * Editar, Reservar, Marcar vendido, Renovar, Pausar, Reactivar, Destacar, Bump, Archivar,
 * Eliminar y «¿Necesitas ayuda?», todos con el mismo peso: la acción que genera ingreso,
 * la gestión del ciclo de vida y la destrucción irreversible, indistinguibles. En móvil,
 * tres o cuatro filas de botones por anuncio.
 *
 * LO QUE HAY: tres niveles (TARJETA-D1).
 *   [ Promocionar ]  Editar · Ver anuncio · <la acción de estado que toca>   ⋯
 *
 * NINGUNA ACCIÓN SE HA PERDIDO — están todas, repartidas por peso. Qué va en cada nivel lo
 * decide `useListingActions`, que es la MISMA lista que consume la ficha pública: dos
 * inventarios mantenidos por separado es lo que hizo divergir las dos superficies.
 */
export function MyListingCard({ listing, token, onAction, bumpPricing }: Props) {
  const [dealDialogOpen, setDealDialogOpen] = useState(false);

  const { secundarias, menu, busy, error, aviso, limiteAlcanzado } = useListingActions({
    listing,
    token,
    onDone: onAction,
  });

  const location = [listing.city, listing.province].filter(Boolean).join(', ');

  /**
   * UXV.3 (A7-flujo) — si el usuario sale a comprar créditos, aquí es a dónde vuelve: la
   * FICHA de este anuncio, donde puede rematar la acción en un clic.
   */
  const returnTo = listing.status === 'ACTIVE' ? `/anuncio/${listing.slug}` : '/mis-anuncios';

  return (
    <Card className="overflow-hidden" data-testid={`listing-card-${listing.id}`}>
      <div className="flex gap-4 p-4">
        {/* Thumbnail */}
        <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-muted">
          {listing.thumbnailUrl ? (
            <Image
              src={listing.thumbnailUrl}
              alt={listing.title}
              fill
              className="object-cover"
              sizes="96px"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              Sin foto
            </div>
          )}
          {/*
            EL INDICADOR QUE LE FALTABA JUSTO A QUIEN MÁS LE IMPORTA. `hasVideo` llegaba en
            el payload desde siempre (findMine → toSummary; el e2e lo comprueba contra
            /users/me/listings), pero esta tarjeta no pasa por `CardPhotoCarousel` —pinta su
            propia miniatura— así que era la única superficie donde el dato estaba y no se
            usaba: un vendedor Pro no podía ver desde su panel a cuáles de sus anuncios les
            había puesto vídeo. Mismo componente que el resto, sin URL y sin `<video>`.

            `bottom-1 right-1` y no `bottom-2 right-2`: la miniatura aquí mide 96 px, no el
            ancho de una tarjeta de parrilla.
          */}
          {listing.hasVideo && <VideoIndicator className="bottom-1 right-1" />}
        </div>

        {/* Info */}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-start justify-between gap-2">
            <p className="line-clamp-2 text-sm font-medium leading-snug">{listing.title}</p>
            <Badge
              variant={STATUS_VARIANTS[listing.status] ?? 'outline'}
              className="shrink-0 text-xs"
            >
              {STATUS_LABELS[listing.status] ?? listing.status}
            </Badge>
          </div>

          <p className="text-base font-bold">
            {formatListingPrice(
              listing.price,
              listing.currency,
              listing.priceType,
              listing.priceUnit,
            )}
          </p>

          {location && <p className="text-xs text-muted-foreground">{location}</p>}

          {/* EL ANCLA DE LA MÁSCARA de la barrera visual va en el PÁRRAFO, y no en un
              `<span>` que envuelva sólo la fecha. Se intentó lo segundo —enmascarar
              estrictamente la fecha— y está MEDIDO que no vale: la máscara se dibuja sobre
              la CAJA del elemento, así que si la caja se encoge con el texto, la máscara se
              encoge con ella y la captura vuelve a depender del día. El `<span>` medía
              68,77 px con «4 sept 2026» y 73,02 px con «15 sept 2026»; el párrafo mide
              342 px con las dos, porque es de bloque y ocupa su columna.

              El precio, dicho entero: así se tapa también la palabra «Publicado»/«Caduca».
              Es el mínimo que se puede tapar sin que la máscara se mueva, y lo que se
              pierde está cubierto al lado — la línea de la ubicación, justo encima, lleva
              exactamente la misma tipografía (`text-xs text-muted-foreground`) y sigue
              vigilada. Ver `FECHAS` en `e2e-snapshots/pantallas.spec.ts`. */}
          {listing.publishedAt && (
            <p className="text-xs text-muted-foreground" data-testid="mi-anuncio-publicado">
              Publicado{' '}
              {new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' }).format(
                new Date(listing.publishedAt),
              )}
            </p>
          )}
          {listing.expiresAt && listing.status === 'ACTIVE' && (
            <p className="text-xs text-muted-foreground" data-testid="mi-anuncio-caduca">
              Caduca{' '}
              {new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' }).format(
                new Date(listing.expiresAt),
              )}
            </p>
          )}

          {/*
            PUERTA ráfaga 2 — EL AVISO DE REVALIDACIÓN.
            Va aquí, en la propia tarjeta, y no en un banner de la página: el
            problema es de ESTE anuncio y de ningún otro. Y LLEVA A LA SOLUCIÓN —
            los motivos concretos y el botón de editar—, que es lo que separa un
            aviso útil de uno que sólo preocupa (mitigación M6).
            No cambia el `Badge` de estado: el anuncio sigue activo, y decir lo
            contrario sería mentir sobre lo que ve el comprador.
          */}
          {listing.needsRevalidation && (
            <div
              className="mt-1 rounded-md border border-warning-border bg-warning p-2 text-xs"
              data-testid={`revalidation-notice-${listing.id}`}
            >
              <p className="flex items-center gap-1 font-medium text-warning-foreground">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Este anuncio necesita una actualización
              </p>
              {listing.revalidationReasons && listing.revalidationReasons.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-warning-foreground">
                  {listing.revalidationReasons.map((r) => (
                    <li key={`${r.code}-${r.field}`}>{r.message}</li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-warning-foreground">
                Sigue publicado y visible. Edítalo para corregirlo.
              </p>
            </div>
          )}

          {/* UXV.4 — ZONA de estado promocional (antes, una línea suelta de featuredUntil).
              Es donde entrará «Próximo bump: …» con el bump automático. */}
          <PromotionStatus
            featuredUntil={listing.featuredUntil}
            nextBumpAt={listing.nextBumpAt}
            bumpSchedule={listing.bumpSchedule}
            className="mt-0.5"
          />

          {/* H8 Bloque C2 — cifras básicas: vistas + me gusta */}
          <div
            className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground"
            data-testid="listing-stats-basic"
          >
            <span className="flex items-center gap-1">
              <Eye className="h-3.5 w-3.5" />
              {listing.viewCount ?? 0} vista{(listing.viewCount ?? 0) === 1 ? '' : 's'}
            </span>
            <span className="flex items-center gap-1">
              <Heart className="h-3.5 w-3.5" />
              {listing.favoritesCount ?? 0} me gusta
            </span>
          </div>
        </div>
      </div>

      {dealDialogOpen && listing.type && (
        <CloseDealDialog
          listing={{ id: listing.id, type: listing.type }}
          token={token}
          open={dealDialogOpen}
          onOpenChange={setDealDialogOpen}
          onSuccess={onAction}
        />
      )}

      {/* Acciones */}
      <CardContent className="border-t px-4 pb-4 pt-3">
        {error && <p className="mb-2 text-xs text-destructive">{error}</p>}

        {/*
          E-3 — LA SALIDA, donde antes sólo había un muro. Al topar el cupo de anuncios
          activos, el mensaje del backend ya dice que Pro sube el límite (y con qué número);
          esto añade lo que un texto no puede llevar: el enlace para hacerlo.

          Sólo cuando el rechazo ES ese (`limiteAlcanzado`, decidido por el CÓDIGO del error,
          no por su texto). Y la pista no se le enseña a un Pro que agota sus 20: el backend
          no le pone el «con Pro puedes tener hasta N», porque venderle Pro otra vez no es
          una salida para él.
        */}
        {limiteAlcanzado && (
          <div className="mb-2">
            <ProHint testId="limite-activos-upsell" cta="Ver planes">
              Sube de plan para publicar más anuncios a la vez.
            </ProHint>
          </div>
        )}

        {/*
          PUERTA regla #2 — la acción salió bien pero el anuncio se quedó en
          borrador. NO va en el canal de error (no ha fallado nada ni se ha
          perdido nada) ni en el de éxito (no se ha publicado). Va INLINE, junto
          al botón que lo provocó, porque lleva una acción de recuperación
          anclada — es el mismo reparto que fija el CLAUDE.md de apps/web para
          «saldo insuficiente + comprar créditos».
        */}
        {aviso && (
          <div
            className="mb-2 rounded-md bg-warning px-3 py-2 text-xs text-warning-foreground"
            data-testid={`publish-blocked-${listing.id}`}
          >
            <p>{aviso}</p>
            <Link href="/verificar-email" className="mt-1 inline-block font-medium underline">
              Verificar ahora
            </Link>
          </div>
        )}

        {/*
          `flex-wrap` con el menú empujado a la derecha por `ml-auto`: en escritorio es una
          sola fila; en móvil, la primaria y las secundarias saltan de línea entre ellas
          pero NUNCA son doce botones, porque las secundarias son como mucho tres y el
          resto vive en el «⋯».
        */}
        <div className="flex flex-wrap items-center gap-2">
          {canPromote(listing.status) && (
            <PromocionarControl
              listing={listing}
              token={token}
              bumpPricing={bumpPricing}
              onDone={onAction}
              returnTo={returnTo}
            />
          )}

          {secundarias.map((action) => {
            const Icon = action.icon;
            return action.href ? (
              <Button key={action.key} asChild variant="outline" size="sm">
                {/* prefetch={false}: misma mitigación que ListingCard.tsx — parrilla de
                    varias tarjetas sobre rutas dinámicas. */}
                <Link href={action.href} prefetch={false}>
                  <Icon className="mr-1.5 h-3.5 w-3.5" />
                  {action.label}
                </Link>
              </Button>
            ) : (
              <Button
                key={action.key}
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={action.run}
              >
                {busy === action.key ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Icon className="mr-1.5 h-3.5 w-3.5" />
                )}
                {action.label}
              </Button>
            );
          })}

          <div className="ml-auto">
            <OwnerActionsMenu
              actions={menu}
              onDialog={() => setDealDialogOpen(true)}
              disabled={busy !== null}
              label={`Más acciones de «${listing.title}»`}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
