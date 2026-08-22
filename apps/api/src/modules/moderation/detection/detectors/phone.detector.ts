import { Injectable } from '@nestjs/common';
import type { DetectableText, Detection, Detector } from '../detection.types';
import { esPhonePattern } from '../phone-format';

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

  scan(text: DetectableText): Promise<Detection[]> {
    const detections: Detection[] = [];

    for (const [field, valor] of [
      ['TITLE', text.title],
      ['DESCRIPTION', text.description],
    ] as const) {
      // EL PATRÓN SE MUDÓ a `phone-format.ts`, junto al normalizador, y no por orden: para
      // buscar anuncios por teléfono hace falta CANONIZARLO además de reconocerlo, y son
      // dos caras de la misma regla. Tenerlas en ficheros distintos es como divergen — un
      // patrón que reconoce una cosa y un normalizador que canoniza otra, en silencio.
      //
      // Una expresión NUEVA por campo: `lastIndex` de una global es estado compartido y
      // reutilizarla se saltaría hallazgos del segundo. Mismo cuidado que `IpDetector`.
      const patron = esPhonePattern();
      for (const m of valor.matchAll(patron)) {
        detections.push({ detector: this.id, field, match: m[0], rule: null });
      }
    }

    return Promise.resolve(detections);
  }
}
