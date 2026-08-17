import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CategoryTreeService } from '../categories/category-tree.service';
import { resolveEffectiveRequiresReview } from '../categories/category.types';

/**
 * El interruptor del nivel PLATAFORMA. Sin fila, APAGADO — molde `videoEnabled` y
 * los tres interruptores de la puerta.
 */
export const PRE_MODERATION_ALL_SETTING = 'preModerationAllListings';

/**
 * M4 — ¿un «vendedor de confianza» se salta la revisión de PLATAFORMA?
 *
 * SIN FILA, NO. Y esa elección es la mitad del trabajo de esta ráfaga, así que
 * conviene explicarla entera.
 *
 * QUÉ ES `trusted` HOY, verificado: **puramente cosmético**. Se escribe desde
 * `PATCH /admin/users/:id/trusted` y sólo se LEE PARA PINTARLO — la insignia
 * «Vendedor de confianza» de la ficha, el perfil público y la columna del
 * backoffice. Ninguna regla, guard ni límite lo consulta. No exime de nada.
 *
 * POR QUÉ ENTONCES NO SE LE DA PODER DIRECTAMENTE. Porque convertirlo en una
 * exención de moderación cambiaría, con efecto retroactivo, lo que significa una
 * marca que alguien ya puso: los vendedores marcados hace meses —para lucir una
 * insignia— quedarían exentos de una revisión que nadie decidió eximirles. El
 * administrador que encienda «revisar todos los anuncios» leería «todos» y
 * obtendría «todos menos aquellos doce».
 *
 * Así que la exención existe, con su fórmula, pero **nace apagada**: encenderla
 * es decir «sí, quiero que la confianza signifique esto». Es el mismo criterio
 * que el resto del proyecto — lo que cambia lo que le pasa a alguien lleva
 * interruptor.
 */
export const PRE_MODERATION_TRUSTED_EXEMPT_SETTING = 'preModerationTrustedExempt';

/**
 * Por qué un anuncio acabó en revisión. Informativo: nada ramifica por esto
 * todavía (persistirlo y enseñarlo en la cola es el siguiente paso — ver el
 * final de `docs/auditoria-y-diseno-moderacion.md`).
 */
export type ReviewTrigger = 'USER' | 'CATEGORY' | 'PLATFORM';

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
 * LOS NIVELES SON UN `OR`: basta que uno diga «revisar». Ninguno desactiva a otro.
 * La ÚNICA excepción es la que M4 introduce —y va detrás de su propio interruptor,
 * apagado— : la confianza puede levantar la red genérica de plataforma, nunca una
 * marca puesta a dedo sobre este vendedor o esta rama.
 *
 *   · USUARIO    — `User.requiresReview`. La más específica: apunta a un vendedor.
 *   · CATEGORÍA  — la marca `requiresReview`, heredada MONÓTONA por la cadena.
 *   · PLATAFORMA — un `Setting` global. Todo anuncio a revisión.
 *
 * LA FÓRMULA COMPLETA (M4):
 *
 *     requiereRevisión =
 *          usuario.requiresReview                      ← específica: nada la afloja
 *       OR categoría-o-ancestro.requiresReview         ← específica: nada la afloja
 *       OR (plataforma  AND  NOT (trusted Y exención))  ← genérica: se puede eximir
 *
 * LA ESPECÍFICA GANA A LA CONFIANZA, y es el corazón de la decisión. Marcar una
 * rama del catálogo o a un vendedor concreto es señalar algo puntual que alguien
 * ha mirado; «reviso a todo el mundo» es una red genérica. Que la confianza
 * levante la red genérica es razonable; que levante una señal puesta a dedo sobre
 * ESE vendedor o ESA rama sería anular la decisión más informada con la menos
 * informada.
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
   * CON VARIOS NIVELES ACTIVOS GANA EL MÁS ESPECÍFICO, y en M4 ese orden cambia
   * respecto a M1: antes se devolvía PLATAFORMA primero «porque es el más general
   * y explica mejor». Con tres niveles es al revés — al moderador le dice mucho
   * más «este VENDEDOR está marcado» que «revisamos todo», que ya lo sabe.
   */
  async reviewTriggerFor(listing: {
    categoryId: string;
    sellerId: string;
  }): Promise<ReviewTrigger | null> {
    try {
      if (await this.usuarioRequiereRevision(listing.sellerId)) return 'USER';
      if (await this.categoriaRequiereRevision(listing.categoryId)) return 'CATEGORY';
      if (await this.plataformaRevisaTodo(listing.sellerId)) return 'PLATFORM';
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

  /**
   * Nivel USUARIO — la marca directa sobre el vendedor. La más específica de las
   * tres, y por eso NO la afloja `trusted`: un usuario puede estar marcado y ser
   * de confianza a la vez, y en ese caso se revisa. Son ejes independientes, no
   * los dos extremos de uno.
   */
  private async usuarioRequiereRevision(sellerId: string): Promise<boolean> {
    const vendedor = await this.prisma.user.findUnique({
      where: { id: sellerId },
      select: { requiresReview: true },
    });
    return vendedor?.requiresReview === true;
  }

  /**
   * Nivel PLATAFORMA — el interruptor global. Sin fila, apagado.
   *
   * ES EL ÚNICO QUE ADMITE EXENCIÓN, y sólo si alguien la ha encendido a
   * propósito (ver `PRE_MODERATION_TRUSTED_EXEMPT_SETTING`). Con las dos cosas
   * puestas, un «vendedor de confianza» se salta la red genérica — pero no las
   * marcas específicas, que ya se han comprobado antes de llegar aquí.
   */
  private async plataformaRevisaTodo(sellerId: string): Promise<boolean> {
    const ajuste = await this.prisma.setting.findUnique({
      where: { key: PRE_MODERATION_ALL_SETTING },
      select: { value: true },
    });
    if (ajuste?.value !== true) return false;

    const exencion = await this.prisma.setting.findUnique({
      where: { key: PRE_MODERATION_TRUSTED_EXEMPT_SETTING },
      select: { value: true },
    });
    // Sin la exención encendida, «revisar todos» significa TODOS — que es lo que
    // lee el administrador que activa el interruptor.
    if (exencion?.value !== true) return true;

    const vendedor = await this.prisma.user.findUnique({
      where: { id: sellerId },
      select: { trusted: true },
    });
    return vendedor?.trusted !== true;
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
