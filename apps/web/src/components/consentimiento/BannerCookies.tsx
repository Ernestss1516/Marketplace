'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import type { CookieTextConfig } from '@/lib/api/cookies-config';
import { CONSENT_REOPEN_EVENT, useConsent } from './consentimiento';

/**
 * COOKIES RÁFAGA 2 — EL BANNER.
 *
 * Ver docs/diseno-consentimiento-cookies.md §3.
 *
 * ─── AUTÓNOMO, COMO LOS GATES — Y AQUÍ ESTÁ EL PORQUÉ ───────────────────────────
 *
 * El diseño pedía un `ConsentProvider` central en el layout raíz. **La ráfaga 1 demostró
 * que eso rompe la hidratación**: anidar un Client Component alrededor de `{children}`
 * dentro del `SessionProvider` hacía que React montara una segunda copia del árbol
 * entero —dos cabeceras, dos de cada botón—, y sólo se veía en `next start`. Así que este
 * banner NO reintroduce el proveedor: lee la cookie por su cuenta y habla con los gates
 * por el bus del navegador, igual que ellos entre sí.
 *
 * Va en el layout raíz pero **como hermano de `{children}`, fuera de `AuthProvider`**,
 * que es exactamente donde vive el `<Toaster/>` y por el mismo motivo escrito allí: «no
 * depende de la sesión, y tiene que poder salir también en las pantallas anónimas».
 *
 * ─── NO ES MODAL, Y ES UNA DECISIÓN (D-nueva-2) ─────────────────────────────────
 *
 * Con el gate de la ráfaga 1 en pie, **ignorar el banner ya significa no cargar nada**:
 * el estado por defecto es el correcto y no hay que forzar la decisión. Un modal sólo
 * añadiría lo malo — atrapa el foco, deja el contenido inaccesible a teclado y lector, es
 * un muro para el visitante y para Google (y esta plataforma vive del SEO), y presiona a
 * aceptar, que es justo lo que vicia el consentimiento.
 *
 * ─── SIN CLS ────────────────────────────────────────────────────────────────────
 *
 * `fixed` al pie, en su propia capa: no empuja el contenido ni un píxel. Y el texto viene
 * en el HTML (lo lee el layout de servidor, cacheado), así que no hay un fetch que lo
 * haga aparecer medio segundo después.
 */
export function BannerCookies({ config }: { config: CookieTextConfig }) {
  const { cargado, decidido, permite, conceder, rechazar } = useConsent();
  const [reabierto, setReabierto] = useState(false);
  const [detalle, setDetalle] = useState(false);
  const contenedorRef = useRef<HTMLDivElement>(null);

  // El footer pide reabrir el panel para cambiar o retirar la decisión (RGPD: retirar
  // tiene que ser tan fácil como dar).
  useEffect(() => {
    const abrir = () => {
      setReabierto(true);
      setDetalle(true);
    };
    window.addEventListener(CONSENT_REOPEN_EVENT, abrir);
    return () => window.removeEventListener(CONSENT_REOPEN_EVENT, abrir);
  }, []);

  // Al reabrirlo desde el footer el foco va al panel: quien lo pidió tiene que aterrizar
  // donde está lo que pidió, también si navega con teclado o lector de pantalla.
  useEffect(() => {
    if (reabierto) contenedorRef.current?.focus();
  }, [reabierto]);

  /**
   * EL BANNER RESERVA SU HUECO MIENTRAS ESTÁ, Y ESTO NO ES COSMÉTICA.
   *
   * Al ser `fixed`, flotaba sobre el final de la página y **tapaba lo que hubiera
   * debajo**: en móvil dejaba inalcanzable el botón de una tarjeta de anuncio. No es una
   * hipótesis — lo cazó `bump-programado` («en móvil el diálogo se usa igual»), donde
   * Playwright veía el botón, hacía scroll hasta él y el clic se lo comía el banner.
   *
   * Se compensa con un `padding-bottom` del alto real del banner, medido al montar y
   * retirado al decidir. El precio es un desplazamiento **una vez, en la primera visita y
   * después de hidratar**; a cambio, ningún control queda bajo el banner. Tapar un botón
   * es un fallo funcional; el desplazamiento es una molestia medible y acotada — y entre
   * los dos no hay duda.
   */
  useEffect(() => {
    const alto = contenedorRef.current?.offsetHeight;
    if (!alto) return;
    const anterior = document.body.style.paddingBottom;
    document.body.style.paddingBottom = `${alto}px`;
    return () => {
      document.body.style.paddingBottom = anterior;
    };
    // `cargado` y `decidido` van en la lista porque el banner NO existe en el primer
    // render —se espera a leer la cookie— y sin ellas el efecto corría con el `ref` aún
    // vacío y no volvía a correr nunca: el hueco se quedaba sin reservar. Lo cazó el
    // caso «el banner NO tapa el contenido».
  }, [cargado, decidido, detalle, reabierto]);

  /**
   * NO SE PINTA HASTA SABER, y esto es lo que evita el parpadeo.
   *
   * En el servidor y en el primer render del cliente `cargado` es `false`, así que el
   * banner no está en el HTML: quien ya decidió no llega a verlo aparecer y desaparecer.
   * Es el trade-off inverso al del gate —allí el marcador SÍ va en el HTML, porque el
   * peor caso tiene que ser no cargar el tercero—, y aquí se puede hacer así porque un
   * banner que tarda un frame no incumple nada: **el gate ya está reteniendo desde el
   * primer byte**.
   */
  if (!cargado) return null;
  if (decidido && !reabierto) return null;

  const yaAcepto = permite('terceros');

  const cerrarTrasDecidir = () => {
    setReabierto(false);
    setDetalle(false);
  };

  return (
    <div
      // `region` y no `alertdialog`: informa y ofrece, no interrumpe. Un `alertdialog`
      // declararía que hay que atenderlo antes de seguir, que es precisamente lo que este
      // banner no hace.
      role="region"
      aria-label="Consentimiento de cookies"
      ref={contenedorRef}
      tabIndex={-1}
      data-testid="banner-cookies"
      // FONDO SÓLIDO, sin translucidez ni desenfoque. Se probó con `bg-background/95` y
      // `backdrop-blur` y el contenido de debajo se transparentaba a través del texto: en
      // un aviso legal la legibilidad manda sobre el efecto, y además el contraste medido
      // deja de ser el del token en cuanto el fondo depende de lo que haya detrás.
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background shadow-lg"
    >
      <div className="container mx-auto flex max-w-5xl flex-col gap-4 px-4 py-4 sm:py-5">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-foreground">{config.title}</h2>
          <p className="text-sm text-muted-foreground">{config.body}</p>
        </div>

        {detalle && (
          <div
            // `id` DE VERDAD, no sólo `data-testid`: el botón de «más información» lo
            // referencia con `aria-controls`, y `aria-controls` sólo entiende de `id`.
            // Apuntando a un testid, un lector de pantalla no encuentra el panel y la
            // relación entre el botón y lo que despliega se pierde — el atributo parecía
            // puesto y no servía para nada.
            id="banner-cookies-detalle"
            data-testid="banner-cookies-detalle"
            className="space-y-3 rounded-md border border-border bg-muted/40 p-3 text-sm"
          >
            {/* LAS CATEGORÍAS REALES, Y NINGUNA MÁS. No hay «analítica» (la telemetría
                propia no toca el terminal), ni «marketing» (no hay un solo tercero
                publicitario), ni «preferencias» (no hay cookie de tema ni de idioma).
                Ofrecer apagar algo que no existe sería mentirle al usuario. */}
            <div>
              <p className="font-medium text-foreground">Esenciales · siempre activas</p>
              <p className="text-muted-foreground">
                Tu sesión y la seguridad del acceso, y esta misma elección para no volver a
                preguntártela. Sin ellas la plataforma no funciona, así que no se pueden
                desactivar.
              </p>
            </div>
            <div>
              <p className="font-medium text-foreground">Contenido de terceros · tú decides</p>
              <p className="text-muted-foreground">
                Vídeos (YouTube, Vimeo) y mapas (MapTiler) incrustados en algunas páginas.
                Si no los aceptas, no se cargan: verás un aviso en su lugar y podrás
                cargarlos uno a uno cuando quieras.
              </p>
            </div>
            <p className="text-muted-foreground">
              Estado actual:{' '}
              <strong className="text-foreground">
                {yaAcepto ? 'contenido de terceros permitido' : 'solo cookies esenciales'}
              </strong>
              .
            </p>
            {/* El enlace sólo existe cuando hay política publicada (ráfaga 3). Enlazar a
                una ruta inexistente desde el banner legal sería peor que no enlazar. */}
            {config.policyUrl && (
              <Link
                href={config.policyUrl}
                className="inline-block font-medium text-foreground underline underline-offset-2"
                data-testid="banner-cookies-politica"
              >
                Leer la política de cookies
              </Link>
            )}
          </div>
        )}

        {/*
          LOS TRES BOTONES, AL MISMO NIVEL. Y «al mismo nivel» es literal: misma variante,
          mismo tamaño, mismo peso, mismo contraste. Nada de «Aceptar» en primario sólido
          y «Rechazar» como enlace gris en una esquina — la AEPD ha sancionado
          específicamente ese patrón, y es la trampa más fácil de colar sin querer.

          El orden es Rechazar → Aceptar → Más información, y tampoco es casual: la opción
          que menos compromete al usuario va primera.
        */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
            data-testid="banner-cookies-rechazar"
            onClick={() => {
              rechazar();
              cerrarTrasDecidir();
            }}
          >
            {config.rejectLabel}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
            data-testid="banner-cookies-aceptar"
            onClick={() => {
              conceder('terceros');
              cerrarTrasDecidir();
            }}
          >
            {config.acceptLabel}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
            data-testid="banner-cookies-mas"
            aria-expanded={detalle}
            aria-controls="banner-cookies-detalle"
            onClick={() => setDetalle((v) => !v)}
          >
            {config.moreLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
