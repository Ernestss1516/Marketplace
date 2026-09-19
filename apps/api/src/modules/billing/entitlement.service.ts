import { ForbiddenException, Injectable } from '@nestjs/common';
import { BumpLedgerType, EntitlementType, FeaturedOrigin, ListingStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ProStatusService } from '../listing-gate/pro-status.service';
import { suscripcionVigenteFilter } from './subscription-vigente';
// R4 — LA MISMA aritmética que reparte los turnos, no una copia: si la ventana cambia, la
// cifra que se le enseña al vendedor cambia con ella. Es una función pura, sin Nest ni
// Meilisearch, así que importarla no acopla este módulo al de búsqueda.
import { cuotaDeVitrina } from '../search/featured-rotation';
// CUOTAS PRO PIEZA 1 — la ventana de la cuota, en un solo sitio y pura. Ver `mes-natural.ts`.
import { finDelMesNatural, inicioDelMesNatural } from './mes-natural';

function activeFilter() {
  const now = new Date();
  return {
    revokedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };
}

/**
 * EL ENTITLEMENT QUE CONCEDE LA CUOTA — hoy, el de un cliente que PAGA.
 *
 * ─── LO QUE VIENE DE U1 (ficha de usuario) Y NO CAMBIA ───────────────────────
 *
 * LAS DOS PREGUNTAS QUE ESTE FICHERO CONFUNDÍA. «¿Es Pro?» la responde el
 * `Entitlement` y ya tiene dueño único (`ProStatusService.isProActive`).
 * «¿De dónde sale la cuota MENSUAL?» es otra pregunta, y las tres funciones de
 * cuota buscaban «el entitlement PRO vigente más reciente» y luego comprobaban si
 * tenía `subscriptionId`. Con un solo entitlement daba igual; con dos deja de
 * darlo, y ahí está el defecto que U1 cerró:
 *
 *   **un Pro CONCEDIDO A MANO a alguien que YA PAGA es más nuevo, no tiene
 *   suscripción, y taparía la cuota mensual que ese cliente está pagando.**
 *
 * Se arregla pidiendo desde el principio lo único que sirve para la cuota: un
 * entitlement PRO vigente **con suscripción**. Entre varios de pago sigue ganando
 * el más reciente. Ver docs/diseno-ficha-usuario.md §0.4 y §1.4.
 *
 * ─── POR QUÉ YA NO SE LLAMA «CON PERIODO» (cuotas Pro, pieza 1) ──────────────
 *
 * Porque el periodo dejó de salir de aquí. La cuota ya NO se cuenta desde
 * `Subscription.currentPeriodStart` sino desde el inicio del MES NATURAL
 * (`mes-natural.ts`), así que este filtro no aporta ninguna ventana: aporta la
 * respuesta a **«¿quién le concede la cuota a este usuario?»**, que hoy es «quien
 * paga un plan» y nada más.
 *
 * El nombre viejo describía el mecanismo roto —atar la cuota al ciclo de cobro—
 * y es justo el que hacía parecer natural que un Pro anual recibiera su cuota
 * «mensual» una vez al año.
 *
 * **La condición `subscriptionId: { not: null }` SE QUEDA a propósito**: es lo que
 * mantiene al Pro concedido a mano sin cuota, que es el comportamiento de hoy y
 * sigue siéndolo tras esta pieza. Darle cuota propia y configurable es la pieza 2
 * (`docs/auditoria-y-diseno-cuotas-pro.md` §9), y entrará ensanchando ESTE filtro
 * —no duplicándolo.
 */
function proDePagoFilter(userId: string): Prisma.EntitlementWhereInput {
  return {
    userId,
    type: EntitlementType.PRO_SUBSCRIPTION,
    subscriptionId: { not: null },
    ...activeFilter(),
  };
}

const DEFAULT_PRO_MONTHLY_FEATURED_QUOTA = 4;
const DEFAULT_PRO_QUOTA_FEATURED_DURATION_DAYS = 7;
/** Monetización ráfaga 3 — mismo default que la cuota de destacados. */
const DEFAULT_PRO_MONTHLY_BUMP_QUOTA = 4;

/** Monetización ráfaga 3 — cuota mensual de bumps gratis de Pro, campo hermano
 * de la cuota de destacados en GET /billing/pro-status (una sola petición para
 * pintar el estado mensual completo de Pro). Mismo shape en los tres campos
 * que el nivel superior, sin periodStart/periodEnd propios: comparte
 * necesariamente la ventana de la cuota de destacados (el mismo mes natural). */
export interface BumpQuotaStatus {
  limit: number;
  used: number;
  remaining: number;
}

/**
 * H8.2 — estado de la cuota mensual de destacados gratis de Pro.
 * isPro=false para no-Pro (no aplica cuota). periodStart/periodEnd/
 * quotaDurationDays solo presentes cuando hay cuota que contar.
 */
export interface FeaturedQuotaStatus {
  isPro: boolean;
  limit: number;
  used: number;
  remaining: number;
  /**
   * CUOTAS PRO PIEZA 1 — ESTOS DOS CAMPOS CAMBIARON DE SIGNIFICADO, NO DE NOMBRE.
   *
   * ANTES eran el ciclo de FACTURACIÓN (`Subscription.currentPeriodStart/End`).
   * AHORA son **la ventana de la CUOTA**: el mes natural en curso, del día 1 a las
   * 00:00 peninsulares (`periodStart`, inclusivo) al día 1 del mes siguiente
   * (`periodEnd`, **exclusivo** — el instante en que lo no gastado se pierde).
   *
   * POR QUÉ SE CONSERVA EL NOMBRE. Sus dos lectores están dentro del bloque de
   * CUOTA, no en el de facturación: el aviso de caducidad (`cuota-caducidad.ts`)
   * y el «Se renueva» que va junto a «restantes este mes» en
   * `/perfil/suscripcion`. Para los dos, el significado nuevo es el que les
   * corresponde — y es el que arregla la contradicción que ese bloque tenía para
   * un Pro anual: decía «4 de 4 restantes ESTE MES» junto a «Se renueva: dentro
   * de un año».
   *
   * LA FECHA DE RENOVACIÓN DEL COBRO NO SE PIERDE: se pinta desde
   * `activeSubscription.currentPeriodEnd`, que es otro campo y otro origen.
   * Ver docs/auditoria-y-diseno-cuotas-pro.md §7.2 (decisión D-4).
   */
  periodStart?: Date;
  periodEnd?: Date;
  /** H8.5b — duración fija (días) que otorga un destacado pagado con la cuota. */
  quotaDurationDays?: number;
  /** Monetización ráfaga 3 — cuota mensual de bumps gratis, mismo periodo. */
  bumpQuota: BumpQuotaStatus;
  /**
   * FICHA DE USUARIO — U1: DE DÓNDE SALE LA CUOTA MENSUAL.
   *
   * `SUBSCRIPTION` — de un plan de pago vigente. `NONE` — nadie se la concede, así
   * que la cuota mensual **no aplica**. Y «no aplica» NO significa «no es Pro»:
   * son las dos preguntas que este fichero confundía, y el campo existe para que
   * no se puedan volver a confundir.
   *
   * Antes de U1 la ausencia de cuota se decía devolviendo `isPro: false`, que
   * es mentira sobre un Pro concedido a mano: tiene todas las capacidades (sus
   * cuotas de anuncios, el vídeo, la insignia) y lo único que no tiene son las
   * gratuidades mensuales, porque nadie está pagando un plan que las conceda.
   *
   * Es un campo ADITIVO: para un cliente de pago vale siempre `SUBSCRIPTION` y
   * nada de lo que ya leía el frontend cambia. Y deja sitio a un tercer valor
   * —`MANUAL`— para cuando una concesión a mano traiga su propia cuota
   * configurable: es la PIEZA 2, aparte de ésta
   * (docs/auditoria-y-diseno-cuotas-pro.md §9).
   */
  quotaSource: 'SUBSCRIPTION' | 'NONE';
  /**
   * PARIDAD DEL PRO MANUAL — EL SEGUNDO EJE, que la interfaz no tenía.
   *
   * «¿Tiene una suscripción de pago viva?», que NO es «¿es Pro?». El frontend fundía las
   * dos en `isPro` y de ahí salían los dos huecos de §1.5:
   *
   *   · `/perfil/suscripcion` sólo pintaba contenido si había `Subscription`, así que un Pro
   *     manual —Pro sin suscripción— se quedaba con la cabecera «Plan Pro» y nada debajo.
   *   · `/planes` deshabilitaba el botón con «Ya eres Pro» mirando `isPro`, así que un Pro
   *     manual NO podía convertirse en cliente de pago… aunque el servidor sí le dejaba (el
   *     guard `ALREADY_SUBSCRIBED` mira `Subscription`, y él no tiene ninguna).
   *
   * Se calcula con el MISMO predicado que ese guard (`suscripcionVigenteFilter`), y ése es
   * el punto: el botón ofrece exactamente lo que el checkout acepta. Con dos copias del
   * criterio, la interfaz podría volver a ofrecer lo que el servidor rechaza.
   *
   * NO se deriva de `quotaSource`, aunque se le parezca: `quotaSource` mira si el
   * ENTITLEMENT cuelga de una suscripción, y una `PAST_DUE` daría `SUBSCRIPTION` mientras el
   * guard —que la deja pasar a propósito— permitiría rehacer el pago. Serían dos respuestas
   * distintas a la misma pregunta.
   */
  hasActiveSubscription: boolean;
}

@Injectable()
export class EntitlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly proStatus: ProStatusService,
  ) {}

  /**
   * Returns true if the user has an active PRO_SUBSCRIPTION entitlement.
   * Active = revokedAt IS NULL AND (expiresAt IS NULL OR expiresAt > now()).
   *
   * PUERTA — RÁFAGA 1: la consulta se mudó a `ProStatusService`, un sitio neutral
   * del que la puerta también puede tirar sin que `ListingGateModule` importe
   * `BillingModule` (sería un ciclo). Este método SE QUEDA porque es la puerta de
   * entrada que usan `BillingService` y `ListingsService`; lo que no se queda es
   * una segunda copia de la consulta, que podría divergir en silencio de la que
   * usa la cuota de anuncios activos.
   */
  async isProActive(userId: string): Promise<boolean> {
    return this.proStatus.isProActive(userId);
  }

  /**
   * Returns true if the listing has an active FEATURED_LISTING entitlement.
   * Active = revokedAt IS NULL AND expiresAt > now().
   */
  async isFeaturedActive(listingId: string): Promise<boolean> {
    const now = new Date();
    const row = await this.prisma.entitlement.findFirst({
      where: {
        listingId,
        type: EntitlementType.FEATURED_LISTING,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      select: { id: true },
    });
    return row !== null;
  }

  /**
   * R4 — LA CIFRA QUE VE EL VENDEDOR ANTES DE PAGAR.
   *
   * Cuántos destacados vigentes tiene ya la categoría de este anuncio y, con ese dato, cuánta
   * vitrina le tocaría si comprara ahora. La frase de R3 dice que su anuncio «se irá
   * alternando»; esto dice CON CUÁNTOS y CUÁNTO — es la diferencia entre una promesa honesta y
   * una promesa que además informa la decisión de compra.
   *
   * LA CATEGORÍA ES LA DEL ANUNCIO (la hoja), y es una decisión, no un descuido: un destacado
   * compite además en las búsquedas de sus ancestros y en la global, donde el anillo es mayor y
   * su cuota menor. Contar la hoja responde al escenario principal —quien navega «Coches» ve el
   * bloque de «Coches»— y no promete de más: la cifra que se enseña es la de SU categoría, que
   * es la mejor de las suyas, y se dice como tal.
   *
   * LA VIGENCIA ES LA MISMA QUE LA DE LA ROTACIÓN: `activeFilter()` (no revocado y sin caducar)
   * es el predicado del que sale `boostScore` al indexar. Contar caducados inflaría N y le
   * enseñaría al vendedor una categoría más competida de lo que está — mentir a la baja también
   * es mentir.
   *
   * SE CUENTAN ANUNCIOS, NO ENTITLEMENTS, y por eso el `count` va sobre `listing`: si un anuncio
   * arrastrara dos concesiones vivas contaría dos veces, y en el bloque ocupa un hueco.
   */
  async getFeaturedCompetition(userId: string, listingId: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: {
        sellerId: true,
        categoryId: true,
        category: { select: { name: true, slug: true } },
      },
    });
    if (!listing || listing.sellerId !== userId) {
      throw new ForbiddenException('El anuncio no existe o no es tuyo');
    }

    const vigentes = await this.prisma.listing.count({
      where: {
        categoryId: listing.categoryId,
        status: ListingStatus.ACTIVE,
        // EXCLUIDO EL PROPIO ANUNCIO: si ya estuviera destacado estaría entre los vigentes, y
        // sumarle uno más abajo lo contaría dos veces.
        id: { not: listingId },
        entitlements: {
          some: { type: EntitlementType.FEATURED_LISTING, ...activeFilter() },
        },
      },
    });

    return {
      categoria: listing.category,
      vigentes,
      // `+ 1` — EL QUE PREGUNTA. Todavía no está entre los vigentes, así que calcular con los
      // que ya hay le prometería una cuota que deja de ser cierta en el mismo instante en que
      // pague. Con cuatro destacados en su categoría, la cuenta ingenua diría «saldrás siempre»
      // y la verdad es que pasarían a ser cinco y saldría media jornada.
      cuota: cuotaDeVitrina(vigentes + 1),
    };
  }

  /** Returns all active entitlements for a user (for the /my-entitlements endpoint). */
  async findActiveForUser(userId: string) {
    return this.prisma.entitlement.findMany({
      where: { userId, ...activeFilter() },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * H8.2 — cuota mensual de destacados gratis de Pro. Reseteo DERIVADO: no hay
   * contador que resetear ni cron. "Usado este mes" se cuenta contando los
   * Entitlement FEATURED_LISTING con origin=PRO_QUOTA creados desde el inicio
   * del MES NATURAL en curso. En cuanto entra el día 1, los PRO_QUOTA del mes
   * anterior dejan de contar automáticamente: no hace falta resetear nada.
   *
   * CUOTAS PRO PIEZA 1 — LA VENTANA YA NO ES EL CICLO DE COBRO, Y AHÍ ESTABA EL BUG.
   *
   * Se contaba desde `Subscription.currentPeriodStart`. Para un Pro MENSUAL eso
   * coincide con «al mes» y funcionaba; para un Pro **ANUAL** el ciclo dura un
   * año, así que la cuota «mensual» se contaba sobre 365 días y recibía **4
   * destacados y 4 bumps AL AÑO en vez de 48 y 48 — 1/12 de lo que /planes le
   * promete en su propia tarjeta**.
   *
   * Contar por mes natural (`mes-natural.ts`) lo arregla sin tocar ninguna
   * cantidad: el mensual recibe lo mismo que antes (su ciclo ya era mensual) y
   * el anual recibe **la misma cuota que el mensual, cada mes**. La paridad no
   * hay que construirla — aparece sola en cuanto la ventana deja de preguntarle
   * a la suscripción. Ver docs/auditoria-y-diseno-cuotas-pro.md §2 y §7.
   */
  async getFeaturedQuotaStatus(userId: string): Promise<FeaturedQuotaStatus> {
    const [proEntitlement, suscripcionVigente] = await Promise.all([
      this.prisma.entitlement.findFirst({
        // U1 — se pide directamente el de PAGO. Antes se cogía el más reciente y
        // se comprobaba después si tenía suscripción, que es lo que dejaba a un
        // Pro manual tapar la cuota de un cliente de pago.
        where: proDePagoFilter(userId),
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      }),
      // PARIDAD DEL PRO MANUAL — el segundo eje, con el MISMO predicado que el guard del
      // checkout. En paralelo con la de arriba: no dependen la una de la otra, así que
      // añadir el eje no añade latencia (`Subscription` tiene índice por `userId`).
      this.prisma.subscription.findFirst({
        where: suscripcionVigenteFilter(userId),
        select: { id: true },
      }),
    ]);
    const hasActiveSubscription = suscripcionVigente !== null;

    // SIN PLAN DE PAGO NO HAY CUOTA. Aquí estaba el defecto que cerró U1: se
    // devolvía `isPro: false`, es decir, se decía «no es Pro» cuando lo que pasa
    // es «nadie le concede cuota». Ahora se pregunta por el HECHO a su dueño único
    // y se responde cada cosa por su nombre. El coste de esa consulta sólo lo paga
    // este camino: un cliente de pago sale arriba y no llega hasta aquí.
    //
    // ES TAMBIÉN LA PUERTA DE LA PIEZA 2: el Pro concedido a mano cae justo aquí,
    // y darle cuota propia es sustituir este `return` por la lectura de sus dos
    // ajustes (§9 del diseño). Esta pieza no lo hace: hoy sigue sin cuota.
    if (!proEntitlement) {
      const esPro = await this.proStatus.isProActive(userId);
      return {
        isPro: esPro,
        quotaSource: 'NONE',
        hasActiveSubscription,
        limit: 0,
        used: 0,
        remaining: 0,
        bumpQuota: { limit: 0, used: 0, remaining: 0 },
      };
    }

    /**
     * LA VENTANA, CALCULADA UNA VEZ Y USADA POR LOS DOS CONTADORES.
     *
     * El mismo instante para destacados y para bumps, y no dos llamadas al reloj:
     * entre una y otra puede caer justo el cambio de mes, y entonces la respuesta
     * diría que los destacados son de octubre y los bumps de septiembre. Es un
     * hueco de milisegundos, pero es facturación.
     */
    const ahora = new Date();
    const periodStart = inicioDelMesNatural(ahora);
    const periodEnd = finDelMesNatural(ahora);

    const settings = await this.prisma.setting.findMany({
      where: {
        key: {
          in: ['proMonthlyFeaturedQuota', 'proQuotaFeaturedDurationDays', 'proMonthlyBumpQuota'],
        },
      },
      select: { key: true, value: true },
    });
    const settingMap = Object.fromEntries(settings.map((s) => [s.key, Number(s.value)]));
    const limit = settingMap['proMonthlyFeaturedQuota'] ?? DEFAULT_PRO_MONTHLY_FEATURED_QUOTA;
    const quotaDurationDays =
      settingMap['proQuotaFeaturedDurationDays'] ?? DEFAULT_PRO_QUOTA_FEATURED_DURATION_DAYS;
    const bumpLimit = settingMap['proMonthlyBumpQuota'] ?? DEFAULT_PRO_MONTHLY_BUMP_QUOTA;

    const [used, bumpUsed] = await Promise.all([
      this.prisma.entitlement.count({
        where: {
          userId,
          type: EntitlementType.FEATURED_LISTING,
          origin: FeaturedOrigin.PRO_QUOTA,
          createdAt: { gte: periodStart },
        },
      }),
      // Monetización ráfaga 3 — mismo COUNT derivado que la cuota de
      // destacados, pero sobre BumpLedger (los bumps no tienen Entitlement).
      // BumpLedger no tiene columna userId propia; el filtro por relación
      // wallet:{userId} resuelve el join en una sola query.
      this.prisma.bumpLedger.count({
        where: {
          type: BumpLedgerType.PRO_QUOTA,
          createdAt: { gte: periodStart },
          wallet: { userId },
        },
      }),
    ]);

    return {
      isPro: true,
      quotaSource: 'SUBSCRIPTION',
      hasActiveSubscription,
      limit,
      used,
      remaining: Math.max(0, limit - used),
      periodStart,
      periodEnd,
      quotaDurationDays,
      bumpQuota: {
        limit: bumpLimit,
        used: bumpUsed,
        remaining: Math.max(0, bumpLimit - bumpUsed),
      },
    };
  }

  /**
   * H8.3 — comprueba si queda cuota Pro disponible Y RESERVA el hueco atómicamente
   * dentro de la transacción del caller (`tx`), bloqueando la fila del
   * **Entitlement** que concede la cuota (`SELECT ... FOR UPDATE`).
   *
   * Por qué el lock es imprescindible: la cuota es DERIVADA (un COUNT, no un saldo
   * decrementable como el Wallet), así que dos peticiones concurrentes del mismo
   * usuario podrían leer "remaining=1" ANTES de que ninguna cree su Entitlement, y
   * ambas pasarían por cuota — dos destacados gratis con cupo para uno. El lock
   * serializa: la segunda petición espera a que la primera confirme (o revierta) su
   * transacción; al reanudar, su propio COUNT (ejecutado tras adquirir el lock) ya ve
   * el Entitlement PRO_QUOTA que la primera creó, y devuelve remaining=0 correctamente.
   *
   * ─── POR QUÉ EL CERROJO SE MUDÓ DE `Subscription` A `Entitlement` (pieza 1) ───
   *
   * Bloqueaba la fila `Subscription`, y tenía dos motivos: serializar a los dos
   * concurrentes, y **frenar una renovación de Stripe que intentara avanzar
   * `currentPeriodStart` a mitad de la operación**. El segundo motivo **desapareció**
   * con esta pieza: la ventana es el mes natural, así que una renovación concurrente
   * ya no puede alterarla. Y el primero se cumple igual de bien sobre cualquier fila,
   * con tal de que sea LA MISMA para los dos concurrentes y exista siempre.
   *
   * `Entitlement` cumple las dos condiciones y `Subscription` sólo la primera: **un
   * Pro concedido a mano NO tiene fila `Subscription`**, así que en cuanto la pieza 2
   * le dé cuota, este método se quedaría sin nada que bloquear y la reserva dejaría de
   * ser atómica justo para el caso nuevo. Se muda ahora, con los dos tests de carrera
   * existentes vigilando que la serialización sigue siendo real —no se pospone a la
   * pieza 2, donde el fallo llegaría sin red.
   *
   * Es además la fila CORRECTA conceptualmente: se bloquea la que responde a «¿quién
   * le concede esta cuota a este usuario?», que es exactamente de lo que cuelga el
   * COUNT. Ver docs/auditoria-y-diseno-cuotas-pro.md §8 (decisión D-7).
   *
   * El caller SOLO debe crear el Entitlement PRO_QUOTA dentro de la misma `tx` si este
   * método devuelve `true` — el lock se mantiene hasta que esa `tx` confirme.
   */
  async hasAvailableFeaturedQuota(tx: Prisma.TransactionClient, userId: string): Promise<boolean> {
    const proEntitlement = await tx.entitlement.findFirst({
      // U1 — el de PAGO, no el más reciente (ver `proDePagoFilter`).
      where: proDePagoFilter(userId),
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });
    // Sin plan de pago NO HAY CUOTA MENSUAL, y aquí ese `false` es la respuesta
    // correcta y completa: esta función responde «¿queda cuota?», no «¿es Pro?».
    // Lo que cambia con U1 es que ahora nunca se llega aquí por haber elegido el
    // entitlement equivocado.
    if (!proEntitlement) return false;

    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Entitlement" WHERE id = ${proEntitlement.id} FOR UPDATE
    `;
    if (rows.length === 0) return false; // defensive — la fila se esfumó a mitad de vuelo

    const setting = await tx.setting.findUnique({
      where: { key: 'proMonthlyFeaturedQuota' },
      select: { value: true },
    });
    const limit = setting ? Number(setting.value) : DEFAULT_PRO_MONTHLY_FEATURED_QUOTA;

    const used = await tx.entitlement.count({
      where: {
        userId,
        type: EntitlementType.FEATURED_LISTING,
        origin: FeaturedOrigin.PRO_QUOTA,
        // LA MISMA ventana que `getFeaturedQuotaStatus`, del mismo sitio: si la
        // pantalla y la reserva contaran desde instantes distintos, el usuario
        // vería «te quedan 3» y el botón le respondería «no tienes cuota».
        createdAt: { gte: inicioDelMesNatural() },
      },
    });

    return used < limit;
  }

  /**
   * Monetización ráfaga 3 — réplica literal de hasAvailableFeaturedQuota para
   * la cuota mensual de bumps: mismo lock `SELECT ... FOR UPDATE` sobre la
   * MISMA fila Entitlement (es el mismo entitlement del mismo usuario — las dos
   * cuotas cuelgan del mismo plan por construcción, no hay dos filas distintas
   * que lockear). Única diferencia real: el COUNT es sobre
   * BumpLedger{type:PRO_QUOTA} en vez de Entitlement{type:FEATURED_LISTING,
   * origin:PRO_QUOTA} — los bumps no tienen Entitlement propio.
   *
   * Que las dos cuotas bloqueen LA MISMA fila no es casualidad ni desperdicio: un
   * bump y un destacado simultáneos del mismo usuario se serializan entre sí, que
   * es más de lo que hace falta pero nunca menos. El motivo de la mudanza desde
   * `Subscription` está entero en el doc-comment de su hermana.
   *
   * El caller SOLO debe crear la fila BumpLedger PRO_QUOTA (amount:0, ver
   * comentario del enum en schema.prisma) dentro de la misma `tx` si este
   * método devuelve `true` — el lock se mantiene hasta que esa `tx` confirme.
   */
  async hasAvailableBumpQuota(tx: Prisma.TransactionClient, userId: string): Promise<boolean> {
    const proEntitlement = await tx.entitlement.findFirst({
      // U1 — el de PAGO, igual que su hermana de destacados.
      where: proDePagoFilter(userId),
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!proEntitlement) return false;

    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Entitlement" WHERE id = ${proEntitlement.id} FOR UPDATE
    `;
    if (rows.length === 0) return false; // defensive — la fila se esfumó a mitad de vuelo

    const setting = await tx.setting.findUnique({
      where: { key: 'proMonthlyBumpQuota' },
      select: { value: true },
    });
    const limit = setting ? Number(setting.value) : DEFAULT_PRO_MONTHLY_BUMP_QUOTA;

    const used = await tx.bumpLedger.count({
      where: {
        type: BumpLedgerType.PRO_QUOTA,
        // La misma ventana que las otras dos, por el mismo motivo.
        createdAt: { gte: inicioDelMesNatural() },
        wallet: { userId },
      },
    });

    return used < limit;
  }
}
