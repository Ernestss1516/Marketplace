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
 * **La condición `subscriptionId: { not: null }` SE QUEDA**: separa al cliente de
 * pago del Pro concedido a mano, y desde la PIEZA 2 esa separación ya no decide
 * «cuota sí / cuota no» sino **de qué ajustes sale la cuota** (ver
 * `resolverConcesionDeCuota`).
 */
function proDePagoFilter(userId: string): Prisma.EntitlementWhereInput {
  return {
    userId,
    type: EntitlementType.PRO_SUBSCRIPTION,
    subscriptionId: { not: null },
    ...activeFilter(),
  };
}

/**
 * CUOTAS PRO PIEZA 2 — EL PRO CONCEDIDO A MANO.
 *
 * `subscriptionId: null` es LA MARCA, y no hay otra: `AdminBillingService.grantPro`
 * crea el entitlement así y su propio comentario lo dice —«no hay columna `source`:
 * esto ES la procedencia»—. `revokePro` usa el mismo predicado para no poder
 * quitarle nunca el Pro a alguien que está pagando.
 */
function proManualFilter(userId: string): Prisma.EntitlementWhereInput {
  return {
    userId,
    type: EntitlementType.PRO_SUBSCRIPTION,
    subscriptionId: null,
    ...activeFilter(),
  };
}

const DEFAULT_PRO_MONTHLY_FEATURED_QUOTA = 4;
const DEFAULT_PRO_QUOTA_FEATURED_DURATION_DAYS = 7;
/** Monetización ráfaga 3 — mismo default que la cuota de destacados. */
const DEFAULT_PRO_MONTHLY_BUMP_QUOTA = 4;

/**
 * CUOTAS PRO PIEZA 2 — LAS DOS DEL PRO MANUAL NACEN EN **CERO**, y el cero es la
 * decisión (D-6), no un hueco a rellenar.
 *
 * Es lo que hace el cambio retrocompatible: sin tocar nada, un Pro concedido a mano
 * sigue exactamente como hoy —sin cuota—, y empieza a tenerla el día que Ernest pone
 * un número en `/admin/ajustes`. Lo contrario —un default generoso— repartiría valor
 * a todas las concesiones ya existentes el día del despliegue sin que nadie lo
 * hubiera decidido.
 */
const DEFAULT_PRO_MANUAL_MONTHLY_FEATURED_QUOTA = 0;
const DEFAULT_PRO_MANUAL_MONTHLY_BUMP_QUOTA = 0;

/** De dónde sale la cuota de este usuario: del plan que paga, o de una concesión a mano. */
type FuenteDeCuota = 'SUBSCRIPTION' | 'MANUAL';

/** Las claves de `Setting` y los respaldos de cada fuente. Un solo sitio, dos juegos. */
const CLAVES_DE_CUOTA: Record<
  FuenteDeCuota,
  { featured: string; bump: string; featuredPorDefecto: number; bumpPorDefecto: number }
> = {
  SUBSCRIPTION: {
    featured: 'proMonthlyFeaturedQuota',
    bump: 'proMonthlyBumpQuota',
    featuredPorDefecto: DEFAULT_PRO_MONTHLY_FEATURED_QUOTA,
    bumpPorDefecto: DEFAULT_PRO_MONTHLY_BUMP_QUOTA,
  },
  MANUAL: {
    featured: 'proManualMonthlyFeaturedQuota',
    bump: 'proManualMonthlyBumpQuota',
    featuredPorDefecto: DEFAULT_PRO_MANUAL_MONTHLY_FEATURED_QUOTA,
    bumpPorDefecto: DEFAULT_PRO_MANUAL_MONTHLY_BUMP_QUOTA,
  },
};

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
   * nada de lo que ya leía el frontend cambia.
   *
   * ─── `MANUAL` — EL TERCER VALOR (PIEZA 2) ────────────────────────────────────
   *
   * El hueco estaba dejado a propósito desde U1, y ya está ocupado: una concesión a
   * mano puede traer **su propia cuota**, con cantidades configurables en
   * `/admin/ajustes` e independientes del plan de pago (decisión D-6).
   *
   * ⚠ `MANUAL` significa «tiene cuota concedida a mano», **no** «es un Pro manual».
   * Un Pro concedido a mano cuyas dos cantidades valgan 0 —que es el estado por
   * defecto— devuelve `NONE`, igual que antes de esta pieza. El motivo está en el
   * cuerpo de `getFeaturedQuotaStatus`, y no es cosmético: con `MANUAL` y ceros,
   * `/mis-anuncios` le diría que gastó unos destacados que nunca tuvo.
   */
  quotaSource: 'SUBSCRIPTION' | 'MANUAL' | 'NONE';
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

/**
 * CUOTAS PRO PIEZA 2 — «¿QUIÉN LE CONCEDE LA CUOTA A ESTE USUARIO?», EN UN SOLO SITIO.
 *
 * Las tres funciones de cuota —la que se PINTA y las dos que RESERVAN— tienen que responder
 * lo mismo a esta pregunta, y la pieza 1 ya dejó escrito lo que pasa si no: la pantalla dice
 * «te quedan 3» y el botón responde «no tienes cuota». Con dos fuentes en vez de una, el
 * riesgo se dobla, así que el desempate vive aquí y las tres tiran de él.
 *
 * ─── EL ORDEN, Y POR QUÉ GANA EL DE PAGO ────────────────────────────────────────
 *
 * 1. El entitlement CON suscripción (el más reciente si hay varios) → `SUBSCRIPTION`.
 * 2. Si no hay ninguno de pago, el manual más reciente → `MANUAL`.
 * 3. Ninguno vigente → `null`, que no es Pro.
 *
 * El paso 1 va primero **conservando la corrección de U1**, que es la razón de que esta
 * función exista con este orden y no con un `orderBy` a secas: a un cliente que YA PAGA se le
 * puede conceder un Pro a mano (soporte, una compensación), y ese entitlement es más nuevo.
 * Con «el más reciente gana», la concesión de cortesía TAPARÍA la cuota que ese cliente está
 * pagando — y ahora, además, se la cambiaría por la del manual, que por defecto es cero. Sería
 * quitarle a un cliente de pago lo que compró, por hacerle un favor.
 *
 * **Consecuencia deliberada: quien paga Y tiene una concesión manual cobra la del PLAN, no la
 * suma.** Una cortesía no es un acumulable. Ver docs/auditoria-y-diseno-cuotas-pro.md §8.3
 * (decisión D-8).
 *
 * Recibe el cliente (`PrismaService` o el `tx` de una transacción) para que las reservas la
 * usen DENTRO de su transacción, que es donde se coge el cerrojo.
 */
async function resolverConcesionDeCuota(
  client: PrismaService | Prisma.TransactionClient,
  userId: string,
): Promise<{ entitlementId: string; fuente: FuenteDeCuota } | null> {
  const dePago = await client.entitlement.findFirst({
    where: proDePagoFilter(userId),
    select: { id: true },
    orderBy: { createdAt: 'desc' },
  });
  if (dePago) return { entitlementId: dePago.id, fuente: 'SUBSCRIPTION' };

  const manual = await client.entitlement.findFirst({
    where: proManualFilter(userId),
    select: { id: true },
    orderBy: { createdAt: 'desc' },
  });
  if (manual) return { entitlementId: manual.id, fuente: 'MANUAL' };

  return null;
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
    const [concesion, suscripcionVigente] = await Promise.all([
      // PIEZA 2 — quién concede la cuota: el plan de pago si lo hay, si no la
      // concesión a mano. El desempate entero vive en `resolverConcesionDeCuota`.
      resolverConcesionDeCuota(this.prisma, userId),
      // PARIDAD DEL PRO MANUAL — el segundo eje, con el MISMO predicado que el guard del
      // checkout. En paralelo con la de arriba: no dependen la una de la otra, así que
      // añadir el eje no añade latencia (`Subscription` tiene índice por `userId`).
      this.prisma.subscription.findFirst({
        where: suscripcionVigenteFilter(userId),
        select: { id: true },
      }),
    ]);
    const hasActiveSubscription = suscripcionVigente !== null;

    /** La respuesta de «es Pro pero nadie le concede cuota». Se usa en dos sitios. */
    const sinCuota = async (): Promise<FeaturedQuotaStatus> => ({
      // Se pregunta por el HECHO a su dueño único (U1): «no tiene cuota» NO es «no
      // es Pro», y decir lo segundo es lo que le mentía a un Pro concedido a mano.
      isPro: await this.proStatus.isProActive(userId),
      quotaSource: 'NONE',
      hasActiveSubscription,
      limit: 0,
      used: 0,
      remaining: 0,
      bumpQuota: { limit: 0, used: 0, remaining: 0 },
    });

    // Ni plan de pago ni concesión a mano vigentes: no es Pro, y no hay cuota.
    if (!concesion) return sinCuota();

    /**
     * LA VENTANA, CALCULADA UNA VEZ Y USADA POR LOS DOS CONTADORES.
     *
     * El mismo instante para destacados y para bumps, y no dos llamadas al reloj:
     * entre una y otra puede caer justo el cambio de mes, y entonces la respuesta
     * diría que los destacados son de octubre y los bumps de septiembre. Es un
     * hueco de milisegundos, pero es facturación.
     *
     * PIEZA 2 — es la MISMA ventana para el manual, y ésa es la conexión entre las
     * dos piezas: el mes natural no necesita ciclo de facturación, así que sirve
     * igual para quien no tiene ninguno.
     */
    const ahora = new Date();
    const periodStart = inicioDelMesNatural(ahora);
    const periodEnd = finDelMesNatural(ahora);

    const claves = CLAVES_DE_CUOTA[concesion.fuente];
    const settings = await this.prisma.setting.findMany({
      where: { key: { in: [claves.featured, claves.bump, 'proQuotaFeaturedDurationDays'] } },
      select: { key: true, value: true },
    });
    const settingMap = Object.fromEntries(settings.map((s) => [s.key, Number(s.value)]));
    const limit = settingMap[claves.featured] ?? claves.featuredPorDefecto;
    const bumpLimit = settingMap[claves.bump] ?? claves.bumpPorDefecto;
    const quotaDurationDays =
      settingMap['proQuotaFeaturedDurationDays'] ?? DEFAULT_PRO_QUOTA_FEATURED_DURATION_DAYS;

    /**
     * PIEZA 2 — UN MANUAL SIN CUOTA CONFIGURADA RESPONDE `NONE`, NO `MANUAL` CON CEROS.
     *
     * Y la diferencia no es cosmética. `/mis-anuncios` decide pintar el recuadro de cuota con
     * `isPro && quotaSource !== 'NONE'` y, con `remaining` a cero, escribe **«Has usado tus
     * destacados gratis de este mes»**. Decirle eso a un Pro concedido a mano que no tiene
     * cuota es contarle que gastó algo que nunca tuvo — **exactamente el defecto que UXV.6
     * arregló**, reintroducido por la puerta de atrás.
     *
     * Así que el contrato lo hace imposible: mientras las dos cantidades sean 0 —que es el
     * estado por defecto—, la respuesta es la de siempre, byte a byte. Es lo que hace esta
     * pieza retrocompatible de verdad y no «retrocompatible si nadie mira».
     *
     * Sólo aplica al manual: un plan de pago con las dos cuotas a 0 no es alcanzable (su
     * validación exige `>= 1`) y, si lo fuera, `SUBSCRIPTION` seguiría siendo la verdad sobre
     * de dónde cuelga su cuota.
     */
    if (concesion.fuente === 'MANUAL' && limit <= 0 && bumpLimit <= 0) return sinCuota();

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
      quotaSource: concesion.fuente,
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
    // PIEZA 2 — el MISMO desempate que usa la lectura, no una copia: si divergieran, la
    // pantalla y el botón dirían cosas distintas sobre la misma cuota.
    const concesion = await resolverConcesionDeCuota(tx, userId);
    // Sin concesión vigente NO HAY CUOTA MENSUAL, y aquí ese `false` es la respuesta
    // correcta y completa: esta función responde «¿queda cuota?», no «¿es Pro?».
    if (!concesion) return false;

    // PIEZA 1 — el cerrojo cuelga del `Entitlement`, y ÉSA es la razón de que la pieza 2
    // no tenga que tocarlo: el Pro concedido a mano no tiene fila `Subscription`, pero
    // entitlement tiene siempre. Se mudó antes de necesitarlo, con los tests de carrera
    // vigilando, en vez de descubrir aquí que la reserva del manual no era atómica.
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Entitlement" WHERE id = ${concesion.entitlementId} FOR UPDATE
    `;
    if (rows.length === 0) return false; // defensive — la fila se esfumó a mitad de vuelo

    const claves = CLAVES_DE_CUOTA[concesion.fuente];
    const setting = await tx.setting.findUnique({
      where: { key: claves.featured },
      select: { value: true },
    });
    const limit = setting ? Number(setting.value) : claves.featuredPorDefecto;

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
    // PIEZA 2 — el mismo desempate y el mismo cerrojo que su hermana de destacados.
    const concesion = await resolverConcesionDeCuota(tx, userId);
    if (!concesion) return false;

    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Entitlement" WHERE id = ${concesion.entitlementId} FOR UPDATE
    `;
    if (rows.length === 0) return false; // defensive — la fila se esfumó a mitad de vuelo

    const claves = CLAVES_DE_CUOTA[concesion.fuente];
    const setting = await tx.setting.findUnique({
      where: { key: claves.bump },
      select: { value: true },
    });
    const limit = setting ? Number(setting.value) : claves.bumpPorDefecto;

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
