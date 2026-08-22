import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import {
  DEFAULT_DETECTION_MODES,
  DETECTION_MODES_SETTING,
  parseDetectionModes,
  type DetectableText,
  type Detection,
  type DetectionMode,
  type DetectionRunResult,
  type Detector,
  type DetectorId,
} from './detection.types';
import { PhoneDetector } from './detectors/phone.detector';
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

  constructor(
    private readonly prisma: PrismaService,
    wordDetector: WordDetector,
    phoneDetector: PhoneDetector,
  ) {
    // A1 — AQUÍ ESTABA `ipDetector`, y sale por la misma puerta por la que entró: una línea.
    // Que retirar un detector cueste lo mismo que añadirlo es la prueba de que la forma de
    // la ráfaga 0 era la correcta — el motor no sabe qué buscan sus detectores.
    //
    // Buscaba IPv4 en el texto y no respondía a ninguna pregunta que alguien hiciera: una IP
    // en una descripción suele ser producto (el router que documenta su `192.168.1.1`). Lo
    // que sí hacía falta —«esta IP concreta es fraudulenta»— se mira en `lastOwnerIp` y
    // `lastLoginIp`, no en el texto, y ni siquiera necesita un detector: es
    // `columna IN (lista)`. Ver `Setting['flaggedIps']`.
    this.detectors = [wordDetector, phoneDetector];
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

    // RÁFAGA B — LOS MODOS, UNA VEZ POR PASADA y no uno por detector. Es la lectura que la
    // ráfaga 0 se negó a hacer para no cambiar la conducta; ahora sí, porque el ascenso es
    // precisamente lo que esta ráfaga construye.
    const modes = await this.loadModes();

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
      if (modes[detector.id] === 'BLOCK') blocking = true;
    }

    return { detections, blocking };
  }

  /**
   * RÁFAGA B — el ascenso, leído.
   *
   * FAIL-OPEN HACIA EL DEFECTO, no hacia «no bloquea nadie»: si el ajuste falta o la
   * consulta revienta, se usan los modos de NACIMIENTO —`WORD` bloquea, `IP`/`PHONE`
   * avisan—. La diferencia importa: caer a «todo en WARN» apagaría el filtro de palabras
   * cada vez que la base de datos tosiera, y eso es un fallo invisible que nadie notaría.
   * Caer al defecto conserva la conducta que había antes de que existiera el ajuste.
   *
   * SIN CACHÉ, a propósito. Es un `findUnique` por clave primaria —el mismo coste que la
   * lectura de la lista de palabras que ya se hacía— y cachearlo significaría que ascender
   * o degradar un detector tardara en surtir efecto. Un interruptor de moderación que no
   * responde al momento es peor que uno que cuesta una consulta.
   */
  private async loadModes(): Promise<Record<DetectorId, DetectionMode>> {
    try {
      const ajuste = await this.prisma.setting.findUnique({
        where: { key: DETECTION_MODES_SETTING },
        select: { value: true },
      });
      return parseDetectionModes(ajuste?.value);
    } catch (err) {
      this.logger.error(
        'No se han podido leer los modos de detección — se usan los de nacimiento',
        err,
      );
      return { ...DEFAULT_DETECTION_MODES };
    }
  }
}
