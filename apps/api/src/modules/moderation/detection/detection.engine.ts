import { Injectable, Logger } from '@nestjs/common';
import {
  DEFAULT_DETECTION_MODES,
  type DetectableText,
  type Detection,
  type DetectionRunResult,
  type Detector,
  type DetectorId,
} from './detection.types';
import { WordDetector } from './detectors/word.detector';

/**
 * PUNTO 6 · RÁFAGA 0 — EL MOTOR. Corre los detectores y aplica su modo.
 *
 * ─── POR QUÉ EXISTE ──────────────────────────────────────────────────────────────────
 *
 * Hasta ahora había UNA comprobación de contenido (`BadWordService.hasBadWords`) que
 * devolvía un booleano y cuyo único significado posible era «manda esto a revisión».
 * El punto 6 necesita tres cosas que ese booleano no puede dar:
 *
 *   · **varios detectores** — las IPs y los teléfonos no caben en la lista de palabras,
 *     porque el tokenizador los parte (ver `WordDetector`);
 *   · **dos modos** — un detector que avisa sin bloquear, para medir cuánto se equivoca
 *     antes de dejarle sacar anuncios del escaparate;
 *   · **rastro** — qué se encontró y dónde, para que el staff pueda juzgarlo.
 *
 * Esta ráfaga monta la forma de las tres. **No enciende ninguna**: hay un detector, está en
 * `BLOCK` como siempre, y las detecciones todavía no se persisten.
 *
 * ─── CONDUCTA: BYTE-IDÉNTICA ─────────────────────────────────────────────────────────
 *
 * Con un único detector en `BLOCK`, `run().blocking` vale exactamente lo que valía
 * `hasBadWords()`. Los tests del filtro de palabras pasan sin tocarse, y ésa es la barrera
 * de esta ráfaga: si hubiera que editarlos, la extracción habría cambiado la conducta.
 *
 * ─── EL FALLO, DETECTOR A DETECTOR ───────────────────────────────────────────────────
 *
 * FAIL-OPEN, heredado de `BadWordService` y de su contrato escrito: si esto revienta, no
 * bloquea nadie y la publicación sigue. Pero se acota **por detector**, que es una mejora
 * de robustez sin cambio de conducta observable:
 *
 *   · hoy, con un solo detector, «falla el detector» y «falla el motor» son lo mismo:
 *     cero detecciones, `blocking: false`, publicación normal — igual que antes;
 *   · mañana, un patrón mal formado en el detector de teléfonos no podrá apagar el filtro
 *     de palabras, que es el que sí bloquea.
 *
 * Lo que NO absorbe: `PreModerationService`. Son cosas distintas —uno mira el texto, el otro
 * mira políticas sobre personas y categorías— y sigue siendo fail-CLOSED, al revés que esto.
 * Fundirlos obligaría a un contrato de fallo común que a uno de los dos le vendría mal.
 *
 * ─── DÓNDE NO CORRE: LA COLA ─────────────────────────────────────────────────────────
 *
 * Inline, no en BullMQ. La regla del proyecto es que el trabajo pesado se encola y esto no
 * lo es: la parte cara es leer la configuración, y eso ya se hacía inline en `publish()`.
 * Encolarlo además rompería la corrección — un anuncio en modo `BLOCK` se publicaría ACTIVE
 * y se despublicaría segundos después, que es peor que no detectar.
 *
 * Ver `docs/diseno-listas-bloqueo.md` §2 y §5.1.
 */
@Injectable()
export class DetectionEngine {
  private readonly logger = new Logger(DetectionEngine.name);
  private readonly detectors: readonly Detector[];

  constructor(wordDetector: WordDetector) {
    // Ráfaga A añade aquí `IpDetector` y `PhoneDetector`. Nada más cambia: el bucle de
    // abajo ya los corre y el modo ya decide qué hacen.
    this.detectors = [wordDetector];
  }

  /**
   * Una pasada sobre el texto de un anuncio.
   *
   * NUNCA LANZA. Es la mitad del contrato: quien llame no tiene que envolverlo para que
   * publicar siga funcionando.
   */
  async run(text: DetectableText): Promise<DetectionRunResult> {
    const detections: Detection[] = [];
    let blocking = false;

    for (const detector of this.detectors) {
      let encontradas: Detection[];
      try {
        encontradas = await detector.scan(text);
      } catch (err) {
        // Un detector caído no encuentra nada — y no arrastra a los demás.
        this.logger.error(
          `El detector ${detector.id} ha fallado — se continúa sin sus detecciones`,
          err,
        );
        continue;
      }

      if (!encontradas.length) continue;
      detections.push(...encontradas);
      if (this.modeOf(detector.id) === 'BLOCK') blocking = true;
    }

    return { detections, blocking };
  }

  /**
   * El modo de un detector.
   *
   * HOY UNA CONSTANTE, y a propósito: leerlo de `Setting['detectionModes']` sería una
   * consulta a base de datos NUEVA, y una consulta nueva no es conducta byte-idéntica.
   * Hacerlo configurable —y con ello el ascenso de avisar a bloquear— es la ráfaga B.
   *
   * Vive en un método y no en línea para que ese cambio sea un cuerpo, no una búsqueda.
   */
  private modeOf(id: DetectorId) {
    return DEFAULT_DETECTION_MODES[id];
  }
}
