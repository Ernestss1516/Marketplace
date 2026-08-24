import type { ListingLikeRatio } from '@/types';
import { RatioLine } from './RatioLine';

/**
 * ESTADÍSTICAS — el ratio de me gusta, con el MISMO tratamiento de muestra pequeña que el
 * CTR de al lado.
 *
 * Antes de esto la línea decía, literalmente, «Un 100% de quienes lo ven lo guardan en
 * favoritos» cuando el anuncio tenía una visita y un me gusta. No era un fallo de cálculo
 * —el cociente era 1— sino de publicación: el porcentaje era la traducción de un único
 * suceso, y se leía como una propiedad del anuncio.
 *
 * NO puede pasar de 1: un «me gusta» exige una visita previa (`Favorite` se crea desde la
 * ficha), así que no hay caso `overOne` que contar. Es la única diferencia real con el CTR
 * además de las palabras y del umbral.
 */
export function LikeRatioLine({ likeRatio }: { likeRatio?: ListingLikeRatio }) {
  return (
    <RatioLine
      testId="stats-like-ratio"
      ratio={
        likeRatio && {
          value: likeRatio.value,
          count: likeRatio.favorites,
          sample: likeRatio.views,
          minSample: likeRatio.minViews,
        }
      }
      countNoun={{ one: 'me gusta', many: 'me gusta' }}
      sampleNoun={{ one: 'visita', many: 'visitas' }}
      whatIsMissing="qué parte de quienes lo ven lo guardan en favoritos"
      sentence={(percent) => <>Un {percent} de quienes lo ven lo guardan en favoritos</>}
    />
  );
}
