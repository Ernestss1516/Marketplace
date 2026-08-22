import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { DetectionEngine } from './detection.engine';
import type { DetectableText, DetectionRunResult } from './detection.types';

/**
 * PUNTO 6 · RÁFAGA A — CORRER LOS DETECTORES SOBRE UN ANUNCIO Y GUARDAR LO QUE ENCUENTREN.
 *
 * Separado del motor a propósito: el motor es detección pura sobre texto —se puede probar
 * sin base de datos— y esto es lo que le da un `listingId` y persiste el resultado. Mezclar
 * las dos cosas habría hecho que probar un patrón exigiera montar Postgres.
 *
 * ─── EL REEMPLAZO ENTERO ES EL DISEÑO, NO UN DETALLE ─────────────────────────────────
 *
 * Cada pasada **borra las detecciones de ese anuncio e inserta las del texto actual**, en
 * una transacción. Molde del reemplazo completo de tags de B2.
 *
 * Es lo que resuelve el único riesgo de persistir en vez de derivar al vuelo: **nunca hay
 * detecciones viejas**. Siempre son el producto de la última pasada sobre el texto que hay
 * ahora. El dueño quita el teléfono y la detección desaparece sola, sin que nadie tenga que
 * acordarse de limpiarla — que es como se pudren los flags puestos a mano.
 *
 * Acumular en vez de reemplazar sería peor que no guardar nada: una tabla que dice que hay
 * un teléfono en un texto donde ya no lo hay hace perder tiempo al moderador y le enseña a
 * desconfiar del aviso.
 *
 * ─── NUNCA LANZA ─────────────────────────────────────────────────────────────────────
 *
 * Fail-open, heredado del contrato del filtro de palabras y extendido a la escritura: si la
 * transacción revienta, se registra y se sigue. **Publicar y editar no pueden depender de
 * que la detección funcione.** Es más fuerte al editar, donde la regla del proyecto es
 * «editar limpia, pero nunca frena» —editar es la vía de salida de un anuncio marcado, y si
 * pudiera fallar por tener un teléfono, quien ya lo tuviera no podría quitarlo—.
 *
 * `blocking` se devuelve igualmente aunque la escritura falle: la decisión de estado sale
 * del motor, no de la tabla. Son dos cosas y sólo una puede fallar sin arrastrar a la otra.
 */
@Injectable()
export class ListingDetectionsService {
  private readonly logger = new Logger(ListingDetectionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: DetectionEngine,
  ) {}

  /**
   * Una pasada completa: detectar y reemplazar.
   *
   * Devuelve el resultado del motor —con `blocking`— porque quien publica lo necesita para
   * decidir el destino, y hacerle correr los detectores una segunda vez para eso sería
   * pagar dos veces por la misma respuesta.
   */
  async refresh(listingId: string, text: DetectableText): Promise<DetectionRunResult> {
    const result = await this.engine.run(text);

    try {
      await this.prisma.$transaction([
        this.prisma.listingDetection.deleteMany({ where: { listingId } }),
        ...(result.detections.length > 0
          ? [
              this.prisma.listingDetection.createMany({
                data: result.detections.map((d) => ({
                  listingId,
                  detector: d.detector,
                  field: d.field,
                  match: d.match,
                  rule: d.rule,
                })),
              }),
            ]
          : []),
      ]);
    } catch (err) {
      // El `deleteMany` va SIEMPRE, también cuando no hay nada que insertar: si el texto
      // dejó de tener hallazgos, lo que hay que hacer es vaciar, no no-hacer-nada.
      this.logger.error(
        `No se han podido guardar las detecciones del anuncio ${listingId} — se continúa`,
        err,
      );
    }

    return result;
  }
}
