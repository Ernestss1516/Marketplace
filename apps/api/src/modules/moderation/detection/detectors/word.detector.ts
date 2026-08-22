import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../infra/prisma/prisma.service';
import type { DetectableText, Detection, Detector } from '../detection.types';

export const BAD_WORD_LIST_SETTING = 'badWordList';

/**
 * EL DETECTOR DE PALABRAS. Era `BadWordService` (ráfaga 0).
 *
 * ─── RÁFAGA C — EL FAIL-OPEN, CERRADO ────────────────────────────────────────────────
 *
 * Hasta aquí el emparejamiento era éste:
 *
 *     tokenize: text.split(/[^a-z0-9]+/)        ← el texto se parte en tokens alfanuméricos
 *     match:    tokens.has(entradaDeLaLista)    ← igualdad EXACTA contra un token completo
 *
 * De ahí que **sólo funcionaran las entradas de una única palabra alfanumérica**. Un admin
 * escribía `dinero facil` o `100%-garantizado`, la pantalla se lo guardaba y le prometía que
 * filtraba, y **casaba cero veces**. Fail-open: creías que filtrabas y no filtrabas.
 *
 * Ahora se comparan FORMAS COLAPSADAS (ver `colapsar`), así que una entrada casa **tal como
 * se escribió**, con espacios y con símbolos. Lo que NO cambia es la semántica de palabra
 * entera: «estafa» sigue sin casar dentro de «estafador».
 *
 * ─── POR QUÉ ESTO LLEGÓ EL ÚLTIMO ────────────────────────────────────────────────────
 *
 * Porque endurece un detector que está en modo `BLOCK`, y desde la ráfaga B **bloquear actúa
 * también al editar**: entradas inertes desde hace meses empiezan a sacar del escaparate
 * anuncios ya publicados en cuanto su dueño los toque. Por eso la pantalla de ajustes marca
 * cuáles son ésas —`entradas-inertes.ts` en el frontal— antes de que el admin pueda
 * sorprenderse. Ver `docs/diseno-listas-bloqueo.md` §5.4.
 *
 * ─── EL ALCANCE, Y LA PREGUNTA QUE HAY QUE RESPONDER BIEN ────────────────────────────
 *
 * Con esto, `192.168.1.1` puesto en la lista **sí casa**. ¿No pisa eso al detector de IPs?
 * No, y la diferencia es la que separa una lista de un patrón:
 *
 *   · El detector `IP` es una HEURÍSTICA: dispara con CUALQUIER IP, incluidas las legítimas
 *     (el anuncio de router que documenta su `192.168.1.1`). Por eso nació avisando y por
 *     eso su ascenso se mide.
 *   · Una entrada de la lista es una CADENA LITERAL que alguien tecleó a propósito. Que
 *     `192.168.1.1` case significa «bloquea ESE texto», que es exactamente lo que pidió
 *     quien lo escribió.
 *
 * Excluir las entradas «que parezcan una IP» exigiría que el emparejador adivinara si
 * `192.168.1.1` es una IP o una referencia de producto con puntos — y adivinar es lo que
 * produce fail-opens. Se casa lo que se escribió; los patrones siguen siendo cosa de los
 * detectores de patrón.
 *
 * ─── EL CONTRATO DE FALLO, INTACTO ───────────────────────────────────────────────────
 *
 * FAIL-OPEN: si la lista falta, está vacía o la consulta revienta, esto devuelve CERO
 * detecciones y la publicación sigue su curso. Moderar no puede frenar publicar. Lo hereda
 * el motor detector a detector, así que un fallo aquí no puede apagar a los demás.
 *
 * ─── POR CAMPO, NO POR LOS DOS JUNTOS ────────────────────────────────────────────────
 *
 * `hasBadWords` miraba `${title} ${description}` a la vez y devolvía un booleano; esto mira
 * cada campo por separado para poder decir en cuál apareció. Una entrada no puede cruzar la
 * frontera entre los dos, que es lo que se pierde al juntarlos y lo que un test clava.
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

    const detections: Detection[] = [];
    for (const [field, valor] of [
      ['TITLE', text.title],
      ['DESCRIPTION', text.description],
    ] as const) {
      const pajar = colapsar(valor);
      if (!pajar) continue;

      for (const original of words) {
        const aguja = colapsar(original);
        // Una entrada que se queda en nada al normalizar («---», «!!!») se descarta. Sin
        // esto, su forma colapsada sería un espacio suelto y **casaría con TODO texto**:
        // un símbolo perdido en la lista bloquearía el marketplace entero.
        if (!aguja) continue;

        if (pajar.includes(aguja)) {
          detections.push({
            detector: this.id,
            field,
            // La entrada normalizada pero CON su puntuación, no la forma colapsada: la
            // colapsada convierte «192.168.1.1» en «192 168 1 1», que el moderador de la
            // ficha lee sin reconocerla. Lo que se enseña es lo que se buscó.
            match: normalizar(original),
            // La entrada TAL COMO LA ESCRIBIÓ el admin, no su forma normalizada: quien
            // lea el aviso tiene que reconocer su propia regla para poder corregirla.
            rule: original,
          });
        }
      }
    }
    return detections;
  }

}

/** Sin tildes, en minúsculas. Igual que siempre. */
function normalizar(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * PUNTO 6 · RÁFAGA C — LA FUNCIÓN QUE CIERRA EL FAIL-OPEN.
 *
 * Normaliza y **reduce todo lo que no sea `[a-z0-9]` a UN espacio**, con un espacio de
 * guarda a cada lado:
 *
 *     «Gana dinero  facil, desde casa!» → « gana dinero facil desde casa »
 *     «dinero facil»                    → « dinero facil »
 *     «100%-garantizado»                → « 100 garantizado »
 *
 * Y el emparejamiento es `pajar.includes(aguja)` sobre esas formas. Los espacios de guarda
 * son lo que conserva la semántica de PALABRA ENTERA que el tokenizador daba gratis:
 * `« estafa »` no está dentro de `« ...no soy estafador »`, porque tras «estafa» viene «dor»
 * y no un espacio. Sin ellos esto sería un `contains` a secas y «estafa» empezaría a casar
 * dentro de «estafador» — un cambio de conducta que nadie ha pedido y que multiplicaría los
 * falsos positivos justo en el detector que BLOQUEA.
 *
 * DE REGALO, LA PUNTUACIÓN DEJA DE IMPORTAR en los dos lados: `100%-garantizado` en la lista
 * casa con «100 % garantizado» en el anuncio. Es lo correcto — quien escribe una regla no
 * puede adivinar cómo puntuará el vendedor— y es imposible de conseguir con tokens sueltos.
 *
 * Devuelve `''` si no queda nada: ver por qué importa en el cuerpo de `scan`.
 */
function colapsar(text: string): string {
  const limpio = normalizar(text).replace(/[^a-z0-9]+/g, ' ').trim();
  return limpio ? ` ${limpio} ` : '';
}
