import { Badge } from '@/components/ui/badge';

/**
 * «ESTO ES PUBLICIDAD» — una palabra, un estilo, un sitio donde cambiarlos.
 *
 * POR QUÉ EXISTE. El sitio tiene DOS superficies de pago y hasta ahora sólo una lo decía: la
 * tarjeta patrocinada llevaba este `<Badge>` escrito a mano con la palabra «Publicidad», y el
 * bloque «Promocionados» no llevaba nada. Un visitante podía leer «Promocionados» como
 * «rebajados», «recomendados por la plataforma» o «los mejores» — y la lectura correcta, «el
 * vendedor ha pagado por estar ahí», no estaba escrita en ninguna parte (auditoría §5, P2B).
 *
 * SE COMPARTE PARA QUE NO HAYA DOS VOCABULARIOS. Si cada bloque escribe su propia palabra, el
 * sitio acaba llamando a lo mismo «publicidad» en un sitio y «promocionado» en otro, y el
 * visitante tiene que deducir que son la misma cosa. Con un componente, la palabra es una.
 *
 * NO DICE LO MISMO QUE «Destacado» (`FeaturedBadge`), y por eso son dos componentes y dos
 * colores: aquél identifica QUÉ anuncio ha pagado —va sobre la tarjeta, en ámbar—, y éste
 * identifica que UN ESPACIO es publicidad. El gris neutro es deliberado desde H6.6: un
 * patrocinado no puede confundirse con un anuncio real destacado.
 */
export function PublicidadBadge({
  /**
   * Sobre una foto (por defecto) o EN LÍNEA, junto a un título. Mismo criterio que el `inline`
   * de `VideoIndicator`: en la cabecera de una sección no hay foto debajo contra la que
   * posicionarse en absoluto.
   */
  inline = false,
  className = 'left-2 top-2',
}: {
  inline?: boolean;
  className?: string;
}) {
  return (
    <Badge
      className={
        inline
          ? 'bg-slate-600 text-white hover:bg-slate-600'
          : `absolute bg-slate-600 text-white hover:bg-slate-600 ${className}`
      }
      data-testid="etiqueta-publicidad"
    >
      Publicidad
    </Badge>
  );
}
