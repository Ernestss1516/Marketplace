import { Injectable } from '@nestjs/common';
import type { DetectableText, Detection, Detector } from '../detection.types';

/**
 * PUNTO 6 · RÁFAGA A — DETECTOR DE IPv4. **Nace AVISANDO.**
 *
 * ─── POR QUÉ NO ES UNA ENTRADA EN LA LISTA DE PALABRAS ───────────────────────────────
 *
 * Porque **no funcionaría, y nadie lo vería fallar**. El detector de palabras parte el texto
 * por lo no alfanumérico, así que `192.168.1.1` se convierte en los tokens `192`, `168`,
 * `1`; la entrada de la lista se compara entera contra cada token y **casa cero veces**. Un
 * admin escribe la regla, la pantalla se la guarda y no filtra nada. Ver `WordDetector`.
 *
 * De ahí que esto mire el **texto crudo**: sin normalizar, sin tokenizar, sin tocar los
 * puntos. Es la corrección central del punto 6.
 *
 * ─── POR QUÉ AVISA Y NO BLOQUEA ──────────────────────────────────────────────────────
 *
 * Tiene un falso positivo incómodo de bueno:
 *
 *   > **Alguien vende un router y escribe «configuración en 192.168.1.1».** El anuncio es
 *   > impecable, la IP es parte de la descripción del producto, y en modo BLOQUEAR lo
 *   > sacaría del escaparate.
 *
 * También versiones de firmware (`1.2.3.4`) y referencias numéricas con puntos. Nunca ha
 * corrido, así que no hay un solo dato sobre cuánto se equivoca. Se mide avisando.
 *
 * ─── LO QUE MIRA Y LO QUE NO ─────────────────────────────────────────────────────────
 *
 * IPv4, cuatro grupos de 1-3 dígitos con **cada octeto validado en 0-255**. Sin la
 * validación, `999.999.999.999` casaría y el detector sería aún más ruidoso de lo que ya es.
 *
 * NO mira IPv6, ni IPs ofuscadas (decimal, hexadecimal, con espacios). Perseguir ofuscación
 * antes de saber si el patrón simple acierta es empezar una carrera armamentística sobre
 * nada — ver `docs/diseno-listas-bloqueo.md` §2.2.
 */
@Injectable()
export class IpDetector implements Detector {
  readonly id = 'IP' as const;

  /**
   * Las guardas de los extremos son la mitad del patrón, y **el punto tiene que mirarse
   * junto a lo que venga detrás**. Escribirlas como «ni dígito ni punto» a secas
   * (`(?<![\d.])` / `(?![\d.])`) parecía equivalente y no lo es: se comía el caso más
   * común de todos.
   *
   *   > «Se configura entrando en **192.168.1.1.**» — una IP al final de una frase, con su
   *   > punto. Con la guarda ingenua, el punto de puntuación se leía como parte de una
   *   > secuencia más larga y el detector NO detectaba nada. Un detector de IPs que no ve
   *   > las IPs escritas al final de una oración no sirve para leer descripciones.
   *
   * Lo que de verdad hay que rechazar es estar dentro de una secuencia MÁS LARGA de grupos
   * numéricos, y eso es «un punto SEGUIDO DE DÍGITO», no un punto cualquiera:
   *
   *   · `(?<!\d)(?<!\d\.)` — que no venga pegado a un dígito, ni a un dígito con punto.
   *   · `(?!\d)(?!\.\d)`   — lo mismo por el otro lado.
   *
   * Con eso, `10.1.2.3.4` no produce ningún acierto (ni por delante ni por detrás), y
   * `192.168.1.1.` sí. `192.168.1.10` casa entero por la avidez de `\d{1,3}`.
   */
  private static readonly IPV4 =
    /(?<!\d)(?<!\d\.)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?!\d)(?!\.\d)/g;

  scan(text: DetectableText): Promise<Detection[]> {
    const detections: Detection[] = [];

    for (const [field, valor] of [
      ['TITLE', text.title],
      ['DESCRIPTION', text.description],
    ] as const) {
      // Se crea una expresión por campo: `lastIndex` de una regex global es estado
      // compartido, y reutilizar la constante entre campos se saltaría hallazgos del
      // segundo — un fallo silencioso de manual.
      const patron = new RegExp(IpDetector.IPV4.source, 'g');
      for (const m of valor.matchAll(patron)) {
        const octetos = [m[1], m[2], m[3], m[4]].map(Number);
        if (octetos.some((o) => o > 255)) continue;
        detections.push({ detector: this.id, field, match: m[0], rule: null });
      }
    }

    return Promise.resolve(detections);
  }
}
