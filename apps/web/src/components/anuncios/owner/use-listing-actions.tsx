'use client';

import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Archive,
  BarChart3,
  CheckCircle,
  Eye,
  LifeBuoy,
  Lock,
  PauseCircle,
  Pencil,
  PlayCircle,
  RotateCcw,
  Send,
  Trash2,
  UserPlus,
} from 'lucide-react';
import {
  publishListing,
  reserveListing,
  deleteListing,
  renewListing,
  pauseListing,
  reactivateListing,
  archiveListing,
} from '@/lib/api/anuncios';
import { toUserMessage } from '@/lib/api/client';
import { useApiAction } from '@/lib/api/use-api-action';
import { useRequireAuth } from '@/hooks/use-require-auth';
import type { ListingSummary } from '@/types';

/**
 * UXV.4 (A6) — QUÉ acciones tiene un anuncio y CON QUÉ PESO, en un solo sitio.
 *
 * EL DEFECTO: `MyListingCard` pintaba hasta doce botones `variant="outline" size="sm"` en
 * un `flex-wrap`, todos con el mismo peso — promocionar (ingreso), gestionar el ciclo de
 * vida y DESTRUIR de forma irreversible, al mismo nivel visual. En móvil eran tres o
 * cuatro filas de botones por tarjeta.
 *
 * EL REPARTO (TARJETA-D1), y por qué así:
 *  - **primaria**: promocionar. No sale de aquí — la monta `PromocionarControl`, que tiene
 *    su propia lógica de bump gratis y diálogo.
 *  - **secundarias**: Editar, Ver anuncio y **la acción de estado que toque AHORA** (una,
 *    no todas). Que sea una sola según el estado es lo que descarga la fila: un ACTIVE
 *    ofrece Pausar; un PAUSED, Reactivar; un DRAFT, Publicar. Nunca las tres.
 *  - **menú**: lo poco frecuente (Reservar, cerrar trato, Renovar, Estadísticas, ayuda) y
 *    lo DESTRUCTIVO (Archivar, Eliminar), que conserva su `AlertDialog`.
 *
 * NINGUNA ACCIÓN SE PIERDE: las mismas once de antes, repartidas. Lo único que cambia es
 * cuánto pesa cada una.
 *
 * Vive aquí y no dentro de la tarjeta porque la ficha pública usa el MISMO conjunto (ver
 * `ListingOwnerActions`): dos listas de acciones mantenidas por separado es justo lo que
 * hizo divergir a las dos superficies.
 */

export interface ListingAction {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Acción inmediata. Excluyente con `href` y con `dialog`. */
  run?: () => void;
  /** Navegación. */
  href?: string;
  /** Abre un diálogo propio del llamador (cerrar trato). */
  dialog?: 'deal';
  /** Irreversible: se confirma con AlertDialog antes de ejecutar. */
  destructive?: boolean;
  /** Texto de la confirmación, cuando `destructive`. */
  confirm?: { title: string; description: string; cta: string };
}

interface Options {
  listing: ListingSummary;
  token: string;
  onDone: () => void;
}

/** Estados desde los que se puede editar: nada impide corregir algo fuera del catálogo. */
const EDITABLE = ['DRAFT', 'ACTIVE', 'RESERVED', 'PAUSED'];
/** Ciclo de vida RÁFAGA 2 — estados desde los que se puede archivar (irreversible). */
const ARCHIVABLE = ['ACTIVE', 'PAUSED', 'SOLD', 'EXPIRED', 'REJECTED'];
/** Estados con página pública: solo ahí tiene destino «Ver anuncio» (A5). */
const CON_FICHA_PUBLICA = ['ACTIVE', 'RESERVED'];

export function useListingActions({ listing, token, onDone }: Options) {
  const { run } = useApiAction();
  const { loginUrl } = useRequireAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * PUERTA regla #2 — el aviso cuando la acción SALE BIEN pero no hace lo que el
   * usuario esperaba: publicar sin el correo verificado deja el anuncio en
   * borrador. No es `error` (la petición devolvió 200 y no se ha perdido nada) ni
   * es éxito (no se ha publicado), así que necesita su propio canal.
   */
  const [aviso, setAviso] = useState<string | null>(null);

  async function ejecutar<T>(
    key: string,
    fn: () => Promise<T>,
    // Acepta una FUNCIÓN del resultado, no sólo un texto: es lo que permite que
    // el mismo botón anuncie «publicado» o no anuncie nada según lo que devuelva
    // el backend. El hook ya lo soportaba (`Message<T>`); aquí sólo se deja pasar.
    successMessage: string | ((result: T) => string | null),
  ) {
    setBusy(key);
    setError(null);
    setAviso(null);
    await run(fn, {
      // UXV.3 — canal común. Antes estas siete acciones se completaban en absoluto
      // silencio: el listado se refrescaba y el usuario deducía por el badge si había
      // pasado algo.
      successMessage,
      onSuccess: () => onDone(),
      onError: (err) => setError(toUserMessage(err)),
      callbackUrl: loginUrl,
    });
    setBusy(null);
  }

  const { status, type } = listing;

  // ── Secundarias: frecuentes, no destructivas, poquísimas ────────────────────
  const secundarias: ListingAction[] = [];

  if (EDITABLE.includes(status)) {
    secundarias.push({
      key: 'editar',
      label: 'Editar',
      icon: Pencil,
      href: `/mis-anuncios/${listing.id}/editar`,
    });
  }

  // A5 — «Ver anuncio». El slug ya viajaba en ListingSummary y no se usaba: el vendedor no
  // tenía forma de ver su propio anuncio como lo ve un comprador sin buscarlo a mano.
  if (CON_FICHA_PUBLICA.includes(status) && listing.slug) {
    secundarias.push({
      key: 'ver',
      label: 'Ver anuncio',
      icon: Eye,
      href: `/anuncio/${listing.slug}`,
    });
  }

  // LA acción de estado que toca ahora — una, no todas.
  if (status === 'DRAFT') {
    secundarias.push({
      key: 'publish',
      label: 'Publicar',
      icon: Send,
      run: () =>
        ejecutar(
          'publish',
          async () => {
            const res = await publishListing(listing.id, token);
            // PUERTA regla #2 — el anuncio se quedó en borrador. El aviso lo
            // escribe el backend, que es quien sabe por qué.
            if (res.status === 'DRAFT' && res.publishBlocked) {
              setAviso(res.publishBlocked.message);
            }
            return res;
          },
          // Sin toast cuando no se publicó: anunciar «Anuncio publicado» sobre un
          // borrador sería mentirle al vendedor con el canal de éxito.
          (res) => (res.status === 'DRAFT' ? null : 'Anuncio publicado.'),
        ),
    });
  } else if (status === 'ACTIVE') {
    secundarias.push({
      key: 'pause',
      label: 'Pausar',
      icon: PauseCircle,
      run: () =>
        ejecutar(
          'pause',
          () => pauseListing(listing.id, token),
          'Anuncio pausado. Deja de verse hasta que lo reactives.',
        ),
    });
  } else if (status === 'PAUSED') {
    secundarias.push({
      key: 'reactivate',
      label: 'Reactivar',
      icon: PlayCircle,
      run: () =>
        ejecutar(
          'reactivate',
          () => reactivateListing(listing.id, token),
          'Anuncio reactivado. Vuelve a estar publicado.',
        ),
    });
  } else if (status === 'EXPIRED') {
    secundarias.push({
      key: 'renew',
      label: 'Renovar',
      icon: RotateCcw,
      run: () => ejecutar('renew', () => renewListing(listing.id, token), 'Anuncio renovado.'),
    });
  }

  // ── Menú: poco frecuente o destructivo ──────────────────────────────────────
  const menu: ListingAction[] = [];

  if (status === 'ACTIVE') {
    menu.push({
      key: 'reserve',
      label: 'Reservar',
      icon: Lock,
      run: () =>
        ejecutar('reserve', () => reserveListing(listing.id, token), 'Anuncio reservado.'),
    });
  }

  // Cerrar trato — ACTIVE o RESERVED. Ramificado por tipo (ciclo de vida RÁFAGA 1):
  // PRODUCTO «Marcar vendido» (se agota), SERVICIO «Registrar cliente» (sigue publicado).
  if (['ACTIVE', 'RESERVED'].includes(status) && type) {
    menu.push({
      key: 'deal',
      label: type === 'SERVICE' ? 'Registrar cliente' : 'Marcar vendido',
      icon: type === 'SERVICE' ? UserPlus : CheckCircle,
      dialog: 'deal',
    });
  }

  // Renovar un ACTIVE es raro (extiende la caducidad antes de tiempo) → al menú. En
  // EXPIRED es LA acción del momento y ya está arriba, en secundarias.
  if (status === 'ACTIVE') {
    menu.push({
      key: 'renew',
      label: 'Renovar',
      icon: RotateCcw,
      run: () => ejecutar('renew', () => renewListing(listing.id, token), 'Anuncio renovado.'),
    });
  }

  // M10 — estadísticas de ESTE anuncio. Antes había que ir a la pantalla global y buscarlo
  // en un <Select> de N.
  menu.push({
    key: 'stats',
    label: 'Ver estadísticas',
    icon: BarChart3,
    href: `/mis-anuncios/estadisticas?anuncio=${listing.id}`,
  });

  menu.push({
    key: 'ayuda',
    label: '¿Necesitas ayuda?',
    icon: LifeBuoy,
    href: `/mis-tickets/nuevo?listingId=${listing.id}`,
  });

  if (ARCHIVABLE.includes(status)) {
    menu.push({
      key: 'archive',
      label: 'Archivar',
      icon: Archive,
      destructive: true,
      confirm: {
        title: '¿Archivar este anuncio?',
        description: `«${listing.title}» dejará de estar publicado de forma permanente. A diferencia de eliminar, conserva las conversaciones, tratos y valoraciones — pero esta acción no se puede deshacer.`,
        cta: 'Archivar',
      },
      run: () =>
        ejecutar('archive', () => archiveListing(listing.id, token), 'Anuncio archivado.'),
    });
  }

  menu.push({
    key: 'delete',
    label: 'Eliminar',
    icon: Trash2,
    destructive: true,
    confirm: {
      title: '¿Eliminar este anuncio?',
      description: `Se eliminará «${listing.title}» de forma permanente. Esta acción no se puede deshacer.`,
      cta: 'Eliminar',
    },
    run: () => ejecutar('delete', () => deleteListing(listing.id, token), 'Anuncio eliminado.'),
  });

  return { secundarias, menu, busy, error, aviso };
}
