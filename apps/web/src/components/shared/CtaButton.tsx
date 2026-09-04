import { Button } from '@/components/ui/button';
import { SmartLink } from './SmartLink';

/**
 * Botón destacado centrado. Lo comparten los bloques `cta` de LOS DOS motores
 * —el del blog y el de portada— y por eso su firma son props planas y no un
 * `CtaBlock`: cada motor conserva su propio tipo y le pasa los campos
 * (docs/diseno-portada.md §4.0).
 *
 * El `<SmartLink>` va dentro de `<Button asChild>`, que usa Slot de Radix: el
 * botón no se pinta a sí mismo, clona a su hijo y le fusiona sus clases. Por eso
 * `SmartLink` reenvía ref y props — sin eso el estilo del botón no llegaría al
 * `<a>`/`<Link>`.
 */

export type CtaStyle = 'primary' | 'secondary' | 'outline';

const STYLE_TO_VARIANT: Record<CtaStyle, 'default' | 'secondary' | 'outline'> = {
  primary: 'default',
  secondary: 'secondary',
  outline: 'outline',
};

export function CtaButton({
  label,
  href,
  style = 'primary',
}: {
  label: string;
  href: string;
  style?: CtaStyle;
}) {
  /**
   * E6 — EL CTA ES ZONA DE IMPACTO, Y ES UN SOLO PUNTO.
   *
   * `CtaButton` es el CTA canónico que comparten los motores de portada y de blog
   * (§6.1), así que darle carácter aquí se lo da en sus tres usos sin ir a buscar
   * botones por el repo. Y la contención es deliberada: el resto de los ~160
   * componentes es zona de RENDIMIENTO y sigue con su micro-feedback de color.
   *
   * SÓLO `transform` (regla 2): un levantamiento de 2 px y un 2 % de escala al pasar
   * el ratón, que vuelven a cero al pulsar — el gesto de «se puede tocar» y luego
   * «lo has tocado». Nada que reflowee y nada que pintar de más.
   *
   * EL TEMPO NO SE ESCRIBE AQUÍ: `transition-transform` sin `duration-*` usa el
   * DEFAULT de la escala, que E3 ató a `var(--motion-duration)`. O sea que el botón
   * responde al ritmo del modelo y de la zona, como las capas.
   *
   * `motion-reduce:transform-none` apaga el gesto entero para quien lo pide, y lo
   * que queda es el botón en su sitio — un estado completo, no uno a medias.
   */
  return (
    <div className="flex justify-center">
      <Button
        asChild
        variant={STYLE_TO_VARIANT[style]}
        size="lg"
        className="transition-transform will-change-transform hover:-translate-y-0.5 hover:scale-[1.02] active:translate-y-0 active:scale-100 motion-reduce:transform-none motion-reduce:transition-none"
      >
        <SmartLink href={href}>{label}</SmartLink>
      </Button>
    </div>
  );
}
