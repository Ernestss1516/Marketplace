import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CategoryTreeService } from '../categories/category-tree.service';
import { resolveEffectiveRequiresReview } from '../categories/category.types';

/**
 * El interruptor del nivel PLATAFORMA. Sin fila, APAGADO — molde `videoEnabled` y
 * los tres interruptores de la puerta.
 */
export const PRE_MODERATION_ALL_SETTING = 'preModerationAllListings';

/** Por qué un anuncio acabó en revisión. Informativo: nada ramifica por esto. */
export type ReviewTrigger = 'PLATFORM' | 'CATEGORY';

/**
 * MODERACIÓN PREVIA — EL DISPARADOR (ráfaga M1).
 *
 * Responde a UNA pregunta: **¿este anuncio tiene que pasar por revisión antes de
 * publicarse?** No valida nada y no rechaza nada — sólo dice si el destino de
 * `publish()` cambia de ACTIVE a PENDING_REVIEW.
 *
 * ES EL CUARTO DESENLACE. La puerta y sus reglas ya sabían pasar, rechazar,
 * marcar (`needsRevalidation`) y degradar a borrador. Desviar a revisión es el
 * cuarto, y es de otra naturaleza: al vendedor **no se le pide nada**. Su anuncio
 * está bien; sólo tiene que esperar a que alguien lo mire. Por eso esto no es una
 * regla de la puerta —no produce motivos accionables— sino una decisión de
 * DESTINO, y vive donde el destino se elige.
 *
 * LOS NIVELES SON UN `OR` SIN EXENCIONES: basta que uno diga «revisar». No hay
 * precedencia ni forma de que un nivel desactive a otro, que es lo que evita las
 * preguntas del tipo «¿el vendedor de confianza se salta la revisión de su
 * categoría?» — decisiones de producto que este mecanismo no necesita tomar.
 *
 *   · PLATAFORMA — un `Setting` global. Todo anuncio a revisión.
 *   · CATEGORÍA  — la marca `requiresReview`, heredada MONÓTONA por la cadena.
 *   · USUARIO    — RÁFAGA M4. El hueco está diseñado; aquí todavía no existe.
 *
 * FAIL-CLOSED, AL REVÉS QUE EL FILTRO DE PALABRAS. `BadWordService` es fail-open
 * por contrato escrito: si falla, se publica. Aquí NO, y la diferencia no es de
 * gusto sino de qué se pierde en cada caso. Si el filtro falla se pierde una
 * HEURÍSTICA —nadie había pedido que ese anuncio se revisara—. Si esto falla se
 * salta una POLÍTICA EXPLÍCITA: alguien encendió la revisión para esa rama y el
 * anuncio se publicaría sin ella. El coste de equivocarse hacia el cierre es
 * trabajo de más para el moderador, y se ve; el del contrario es invisible.
 */
@Injectable()
export class PreModerationService {
  private readonly logger = new Logger(PreModerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly categoryTree: CategoryTreeService,
  ) {}

  /**
   * `null` = no hace falta revisión. Si hace falta, devuelve POR QUÉ.
   *
   * Se devuelve el motivo y no un booleano porque la cola del moderador (M3)
   * necesita saber si este anuncio está ahí porque la plataforma revisa todo o
   * porque su categoría es sensible: no se revisa igual un caso que el otro. En
   * M1 el motivo aún no se persiste —eso es M2—, pero la decisión ya lo produce
   * en vez de tirarlo.
   *
   * Con los dos niveles activos gana el primero que dispara, en el orden de
   * abajo: PLATAFORMA es el más general, así que es el que mejor explica por qué
   * está en la cola.
   */
  async reviewTriggerFor(listing: { categoryId: string }): Promise<ReviewTrigger | null> {
    try {
      if (await this.plataformaRevisaTodo()) return 'PLATFORM';
      if (await this.categoriaRequiereRevision(listing.categoryId)) return 'CATEGORY';
      return null;
    } catch (err) {
      // FAIL-CLOSED. Ver la cabecera: ante la duda, a revisión. Se registra
      // porque un fallo sostenido aquí manda TODO a la cola, y eso hay que poder
      // diagnosticarlo desde los logs y no desde la cola creciendo sin motivo.
      this.logger.error(
        'No se ha podido decidir si el anuncio requiere revisión — se envía a revisión (fail-closed)',
        err,
      );
      return 'PLATFORM';
    }
  }

  /** Nivel 1 — el interruptor global. Sin fila, apagado. */
  private async plataformaRevisaTodo(): Promise<boolean> {
    const ajuste = await this.prisma.setting.findUnique({
      where: { key: PRE_MODERATION_ALL_SETTING },
      select: { value: true },
    });
    return ajuste?.value === true;
  }

  /**
   * Nivel 2 — la marca de categoría, PLEGADA SOBRE TODA LA CADENA.
   *
   * Mirar sólo `categoria.requiresReview` sería el fallo silencioso: un anuncio
   * de un nivel 4 cuyo ABUELO exige revisión se publicaría sin ella, y ningún
   * test de dos niveles lo notaría. Es el riesgo R1 de la profundidad, que en
   * este repo ya se materializó una vez, y por eso el pliegue va sobre la cadena
   * que devuelve el único lector de la jerarquía.
   *
   * Una cadena vacía (categoría inexistente) devuelve `false` y no revisión: el
   * anuncio no podría ni haberse creado, y `publish()` ya tiene su propio camino
   * para eso.
   */
  private async categoriaRequiereRevision(categoryId: string): Promise<boolean> {
    const cadena = await this.categoryTree.getAncestorChain(categoryId);
    return cadena.reduce(
      (heredado, nodo) => resolveEffectiveRequiresReview(nodo.requiresReview, heredado),
      false,
    );
  }
}
