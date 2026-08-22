import { Injectable } from '@nestjs/common';
import type { DetectableText, Detection, Detector } from '../detection.types';

/**
 * PUNTO 6 · RÁFAGA A — DETECTOR DE TELÉFONO ESPAÑOL. **Nace AVISANDO.**
 *
 * ─── QUÉ PERSIGUE DE VERDAD: EVASIÓN, NO TELÉFONOS ───────────────────────────────────
 *
 * Esto es lo que reformula el detector, y sale del propio dominio y no de la prudencia:
 *
 *   `Listing.phone` EXISTE (`schema.prisma`), y `GET /listings/:id/phone` lo sirve **tras
 *   `JwtAuthGuard`** y con rate limit; nunca viaja en la ficha pública.
 *
 * O sea: **la plataforma ya ofrece un canal para el teléfono, y publicarlo es legítimo.**
 * Lo que este detector señala no es contenido prohibido, es que el vendedor está
 * **esquivando una puerta que ya está puesta**: escribir el número en la descripción lo hace
 * visible a cualquiera sin identificarse.
 *
 * De ahí que la primera respuesta razonable no sea sacar el anuncio del escaparate. Y de ahí
 * también cuál será la respuesta buena el día que se construya: **decírselo al vendedor**
 * («tienes un campo para esto»), que probablemente reduzca el problema más que bloquear.
 * Ver `docs/diseno-listas-bloqueo.md` §0.2 y §5.5.
 *
 * ─── POR QUÉ AVISA Y NO BLOQUEA ──────────────────────────────────────────────────────
 *
 * **Se equivoca en las dos direcciones**, y eso es exactamente lo que no puede bloquear:
 *
 *   · **Falsos positivos**: cualquier tirada de nueve dígitos que empiece por 6, 7, 8 o 9.
 *     Una referencia de pieza, un código de producto, un trozo de número de bastidor.
 *   · **Falsos negativos**: no ve `seis cinco cuatro…` escrito en letra, que es evasión
 *     deliberada — justo el caso que más querría cazar.
 *
 * Perseguir la ofuscación (dígitos en letra, unicode parecido) es una carrera armamentística
 * y empezarla antes de saber si el patrón simple acierta es construir sobre nada.
 *
 * ─── EL PATRÓN ───────────────────────────────────────────────────────────────────────
 *
 * Nueve dígitos que empiezan por 6/7 (móvil) u 8/9 (fijo), con prefijo opcional `+34`/`0034`
 * y separadores entre dígitos. Sobre el **texto crudo**: como el de IPs, no tokeniza — un
 * token nunca contiene espacios ni guiones, así que la lista de palabras no puede con esto.
 */
@Injectable()
export class PhoneDetector implements Detector {
  readonly id = 'PHONE' as const;

  /**
   * Las tres decisiones del patrón:
   *
   *   · `(?:(?:\+|00)34[\s.\-]{0,2})?` — prefijo internacional opcional. **`34` a secas no
   *     cuenta como prefijo**: aceptarlo convertiría cualquier «34 612345678» en un acierto
   *     con once dígitos, y peor, haría que un `3` suelto delante cambiara el resultado.
   *   · `[6-9](?:[\s.\-]{0,2}\d){8}` — nueve dígitos con hasta DOS separadores entre cada
   *     par. El tope no es estética: `[\s.\-]*` sin límite es una invitación al backtracking
   *     catastrófico sobre un texto adversarial, y esto corre dentro de una petición HTTP.
   *     Con `{0,2}` entra `654 12 34 56` y entra `6 5 4 1 2 3 4 5 6`, que es lo real.
   *   · `(?<!\d)` / `(?!\d)` — que no sea un trozo de una tirada más larga. Sin ellas, un
   *     número de veinte dígitos daría un acierto por cada ventana de nueve.
   */
  private static readonly ES_PHONE =
    /(?<!\d)(?:(?:\+|00)34[\s.\-]{0,2})?[6-9](?:[\s.\-]{0,2}\d){8}(?!\d)/g;

  scan(text: DetectableText): Promise<Detection[]> {
    const detections: Detection[] = [];

    for (const [field, valor] of [
      ['TITLE', text.title],
      ['DESCRIPTION', text.description],
    ] as const) {
      // Una expresión por campo: `lastIndex` de una regex global es estado compartido y
      // reutilizarla se saltaría hallazgos del segundo campo. Mismo cuidado que `IpDetector`.
      const patron = new RegExp(PhoneDetector.ES_PHONE.source, 'g');
      for (const m of valor.matchAll(patron)) {
        detections.push({ detector: this.id, field, match: m[0], rule: null });
      }
    }

    return Promise.resolve(detections);
  }
}
