import { Button } from '@/components/ui/button';
import { SmartLink } from './SmartLink';

/**
 * CTA destacado. Lo comparten los bloques `cta` de LOS DOS MOTORES —el del blog y el de
 * portada— y por eso su firma son props planas y no un `CtaBlock`: cada motor conserva su
 * propio tipo y le pasa los campos (docs/diseno-portada.md §4.0).
 *
 * El `<SmartLink>` va dentro de `<Button asChild>`, que usa Slot de Radix: el botón no se
 * pinta a sí mismo, clona a su hijo y le fusiona sus clases. Por eso `SmartLink` reenvía
 * ref y props — sin eso el estilo del botón no llegaría al `<a>`/`<Link>`.
 */

export type CtaStyle = 'primary' | 'secondary' | 'outline';

const STYLE_TO_VARIANT: Record<CtaStyle, 'default' | 'secondary' | 'outline'> = {
  primary: 'default',
  secondary: 'secondary',
  outline: 'outline',
};

/**
 * ══ ESCAPARATE · RÁFAGA C — EL BRILLO ════════════════════════════════════════════════
 *
 * El destello que cruza el botón: un `<span>` estrecho que recorre la caja y espera fuera
 * el resto del ciclo. El keyframe y su clase (`.anima-brillo`, con su
 * `prefers-reduced-motion`) los declaró la ráfaga A; esto es su primer consumidor.
 *
 * ── EL COLOR SALE DE `currentColor`, Y ESO RESUELVE UN PROBLEMA REAL ────────────────
 *
 * El boceto pinta el destello en blanco. Funciona sobre el botón de marca —relleno
 * oscuro, destello claro— y **desaparece sobre el botón inverso de la banda**, que tiene
 * el relleno claro. Con `currentColor` el destello es del color de la LETRA del botón,
 * sea cual sea: sobre relleno de marca la letra es `--primary-foreground` (claro), sobre
 * el inverso es `--primary` (oscuro). Siempre contrasta, en los dos, sin una condición y
 * sin un color escrito a mano.
 *
 * ── LA ANCHURA ES RELATIVA, Y TAMBIÉN POR UN MOTIVO ────────────────────────────────
 *
 * `w-1/2`. El keyframe va de `translateX(-120%)` a `220%` **de la anchura del propio
 * span**, así que con una anchura fija en píxeles el destello sólo recorrería un trozo
 * del botón y se quedaría a medias en los anchos. A media caja, el recorrido va de
 * −0,6× a +1,1× del botón: entra por fuera de la izquierda y sale por fuera de la
 * derecha, en cualquier anchura.
 *
 * ── Y CUMPLE LAS CINCO REGLAS DEL §6.2 ─────────────────────────────────────────────
 *
 * Es CSS (regla 1): cero KB de bundle y funciona sin hidratar. Sólo `transform` (regla
 * 2): no reflowea. No hay asset ni script que cargar en ninguna ruta (regla 3). No toca
 * el LCP (regla 4). Y `prefers-reduced-motion` lo apaga dejando el botón ENTERO, porque
 * el destello vive en un nodo aparte y nada de lo que se lee estaba dentro (regla 5).
 */
function Brillo() {
  return (
    <span
      aria-hidden="true"
      className="anima-brillo pointer-events-none absolute inset-y-0 left-0 w-1/2 opacity-25"
      style={{ background: 'linear-gradient(90deg, transparent, currentColor, transparent)' }}
    />
  );
}

/**
 * El gesto del botón, compartido por los dos tamaños de CTA.
 *
 * SÓLO `transform` (regla 2): un levantamiento de 2 px y un 2 % de escala al pasar el
 * ratón, que vuelven a cero al pulsar — el gesto de «se puede tocar» y luego «lo has
 * tocado». Nada que reflowee y nada que pintar de más.
 *
 * EL TEMPO NO SE ESCRIBE AQUÍ: `transition-transform` sin `duration-*` usa el DEFAULT de
 * la escala, que E3 ató a `var(--motion-duration)`. O sea que el botón responde al ritmo
 * del modelo y de la zona, como las capas. Y `motion-reduce:transform-none` apaga el
 * gesto entero para quien lo pide, dejando el botón en su sitio — un estado completo.
 */
const GESTO =
  'relative overflow-hidden transition-transform will-change-transform ' +
  'hover:-translate-y-0.5 hover:scale-[1.02] active:translate-y-0 active:scale-100 ' +
  'motion-reduce:transform-none motion-reduce:transition-none';

/** La geometría del CTA grande: 64 px de alto y el radio de la escala tokenizada. */
const GRANDE = 'h-16 rounded-2xl px-10 text-base';

export function CtaButton({
  label,
  href,
  style = 'primary',
  title,
  description,
}: {
  label: string;
  href: string;
  style?: CtaStyle;
  title?: string;
  description?: string;
}) {
  /**
   * ══ LA BANDA ═══════════════════════════════════════════════════════════════════════
   *
   * E6 — EL CTA ES ZONA DE IMPACTO, Y ES UN SOLO PUNTO. `CtaButton` es el CTA canónico
   * que comparten los motores de portada y de blog (§6.1), así que darle carácter aquí se
   * lo da en sus tres usos sin ir a buscar botones por el repo. Y la contención es
   * deliberada: el resto de los ~160 componentes es zona de RENDIMIENTO.
   *
   * ── SIN `title`, EL BOTÓN DE SIEMPRE ───────────────────────────────────────────────
   *
   * No es una concesión: es lo que hace que una portada o un artículo guardados antes de
   * esta ráfaga se sigan pintando como se pintaban, en vez de aparecer con una banda
   * vacía. Misma doctrina que la rejilla con celdas sin `media`.
   *
   * ── ⚠ EL REPARTO DE COLOR DE LA BANDA, QUE ES LA DECISIÓN MÁS IMPORTANTE DE AQUÍ ──
   *
   *     banda:          fondo `--primary`             · letra `--primary-foreground`
   *     botón interior: fondo `--primary-foreground`  · letra `--primary`
   *
   * El boceto proponía el botón en `--background` con letra `--primary`. **Eso se rompe
   * en el catálogo real**, y está medido en el propio registro de estilo: sobre el carbón
   * de `premium@oscuro`, el marino de marca da **1,85:1** — el mismo número que obligó a
   * aclarar el anillo de foco de esa versión. Un botón de lienzo con letra de marca sobre
   * una banda de marca sería, ahí, invisible dos veces.
   *
   * Con `--primary-foreground` la garantía **ya está pagada y es de las que bloquean**:
   * ese token se ELIGE por contraste contra `--primary` (`mejorTextoSobre`) y la pareja
   * «letra sobre el color principal» está en `parejasBloqueantes` a 4,5:1. Así que el
   * botón contrasta con la banda por construcción, y su letra con su relleno por la misma
   * pareja. Cero comprobaciones nuevas.
   *
   * ── Y POR ESO NO HAY `opacity` SOBRE NINGÚN TEXTO ─────────────────────────────────
   *
   * El boceto atenúa la frase al 85 %. Eso baja el contraste por debajo de lo que la
   * pareja garantiza y **anula la propiedad entera**. La jerarquía entre titular y frase
   * se hace con tamaño y peso, que no cuestan contraste.
   *
   * ── EL `style` NO GOBIERNA LA BANDA ───────────────────────────────────────────────
   *
   * `primary | secondary | outline` describe un botón suelto, no una banda. Aplicarlo
   * aquí significaría inventar tres repartos de color más, y dos de ellos sin garantía.
   * La banda tiene UN reparto, el de arriba; `style` sigue mandando en el caso sin
   * `title`, que es donde significa algo.
   */
  if (title) {
    return (
      <div className="rounded-2xl bg-primary px-6 py-10 text-center text-primary-foreground md:px-10 md:py-12">
        <h2 className="text-2xl font-bold tracking-tight md:text-3xl">{title}</h2>

        {description && (
          // Sin `opacity`: la jerarquía es de tamaño, no de transparencia. Ver arriba.
          <p className="mx-auto mt-3 max-w-2xl text-base md:text-lg">{description}</p>
        )}

        <Button
          asChild
          size="lg"
          className={`${GESTO} ${GRANDE} mt-8 bg-primary-foreground text-primary hover:bg-primary-foreground`}
        >
          <SmartLink href={href}>
            {label}
            <Brillo />
          </SmartLink>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex justify-center">
      <Button asChild variant={STYLE_TO_VARIANT[style]} size="lg" className={`${GESTO} ${GRANDE}`}>
        <SmartLink href={href}>
          {label}
          <Brillo />
        </SmartLink>
      </Button>
    </div>
  );
}
