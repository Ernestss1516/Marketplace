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
  return (
    <div className="flex justify-center">
      <Button asChild variant={STYLE_TO_VARIANT[style]} size="lg">
        <SmartLink href={href}>{label}</SmartLink>
      </Button>
    </div>
  );
}
