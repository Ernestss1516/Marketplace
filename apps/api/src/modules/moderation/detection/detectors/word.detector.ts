import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../infra/prisma/prisma.service';
import type { DetectableText, Detection, Detector } from '../detection.types';

export const BAD_WORD_LIST_SETTING = 'badWordList';

/**
 * PUNTO 6 · RÁFAGA 0 — EL DETECTOR DE PALABRAS. Era `BadWordService`.
 *
 * ─── BYTE-IDÉNTICO, Y ESO INCLUYE EL FALLO QUE TIENE ─────────────────────────────────
 *
 * Este cuerpo es el de `BadWordService` con la misma lectura, la misma normalización, el
 * mismo tokenizador y la misma comparación. **No se ha arreglado nada**, y la parte que
 * pica es ésta:
 *
 *     tokenize: text.split(/[^a-z0-9]+/)        ← el texto se parte en tokens alfanuméricos
 *     match:    tokens.has(entradaDeLaLista)    ← igualdad EXACTA contra un token completo
 *
 * De ahí que **sólo funcionen las entradas de una única palabra alfanumérica**. Un admin
 * puede escribir `dinero facil`, `100%-garantizado` o `192.168.1.1` en la lista, la pantalla
 * de ajustes se lo guarda y le promete que filtra, y **casan cero veces**. Es fail-open, y
 * es un fallo vivo hoy, no una limitación teórica.
 *
 * **NO SE ARREGLA AQUÍ, Y ES DELIBERADO.** Arreglar el emparejamiento es cambiar la conducta
 * de un detector que está en modo `BLOCK`, y hacerlo sin banco de pruebas significa que un
 * admin que escribió `dinero facil` hace meses —y a quien nunca le funcionó— se encontraría
 * de golpe con anuncios yéndose a revisión. Tiene su propia ráfaga, y empieza por enseñarle
 * al admin qué entradas suyas no casan nunca. Ver `docs/diseno-listas-bloqueo.md` §0.1 y §5.4.
 *
 * Lo que las IPs y los teléfonos necesitan no es una entrada en esta lista —el tokenizador
 * las parte— sino **detectores propios que miren el texto crudo**. Ráfaga A.
 *
 * ─── EL CONTRATO DE FALLO, TAMBIÉN INTACTO ───────────────────────────────────────────
 *
 * FAIL-OPEN: si la lista falta, está vacía o la consulta revienta, esto devuelve CERO
 * detecciones y la publicación sigue su curso. Moderar no puede frenar publicar. Lo hereda
 * el motor detector a detector, así que un fallo aquí ya no podrá apagar a los demás.
 *
 * ─── LA ÚNICA DIFERENCIA DE CÁLCULO, Y POR QUÉ NO CAMBIA EL RESULTADO ────────────────
 *
 * `hasBadWords` tokenizaba `${title} ${description}` JUNTOS y devolvía un booleano; esto
 * tokeniza cada campo por separado para poder decir en cuál apareció.
 *
 * El conjunto de tokens es **demostrablemente el mismo**: el separador que unía los dos
 * campos era un espacio, y el espacio ya está en `[^a-z0-9]`, así que ningún token podía
 * cruzar la frontera. Partir por campos no crea tokens nuevos ni pierde ninguno.
 *
 * La otra diferencia: aquél cortaba en el primer acierto (`some`) y esto recoge todos. El
 * booleano resultante es el mismo; lo que se gana es el rastro que la ráfaga A va a
 * persistir.
 */
@Injectable()
export class WordDetector implements Detector {
  readonly id = 'WORD' as const;

  constructor(private readonly prisma: PrismaService) {}

  async scan(text: DetectableText): Promise<Detection[]> {
    const setting = await this.prisma.setting.findUnique({
      where: { key: BAD_WORD_LIST_SETTING },
    });

    const words = setting?.value as string[] | null | undefined;
    if (!words?.length) return [];

    const normalizedWords = words.map((w) => this.normalize(w)).filter(Boolean);
    if (!normalizedWords.length) return [];

    const detections: Detection[] = [];
    for (const [field, valor] of [
      ['TITLE', text.title],
      ['DESCRIPTION', text.description],
    ] as const) {
      const tokens = this.tokenize(valor);
      for (const word of normalizedWords) {
        if (tokens.has(word)) {
          detections.push({ detector: this.id, field, match: word, rule: word });
        }
      }
    }
    return detections;
  }

  private normalize(text: string): string {
    return text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim();
  }

  private tokenize(text: string): Set<string> {
    return new Set(
      this.normalize(text)
        .split(/[^a-z0-9]+/)
        .filter(Boolean),
    );
  }
}
