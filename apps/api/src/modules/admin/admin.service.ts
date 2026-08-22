import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  ListingStatus,
  ListingTypePolicy,
  ListingViewMode,
  PriceUnit,
  Prisma,
  ReportStatus,
  Role,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { MeilisearchService } from '../../infra/meilisearch/meilisearch.service';
import { isP2002 } from '../../common/prisma/is-p2002';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ExpirationService } from '../expiration/expiration.service';
import {
  QUEUE_INDEXING,
  QUEUE_MEDIA_CLEANUP,
  QUEUE_REVALIDATION,
} from '../../infra/queue/queue.constants';
import { R2Service } from '../../infra/r2/r2.service';
import { listingMediaKeys } from '../../infra/r2/media-keys';
import {
  ListingImagesService,
  type ImagenRetirada,
} from '../listings/listing-images.service';
import { ListAdminListingsDto } from './dto/list-admin-listings.dto';
import { ChangeListingStatusDto } from './dto/change-listing-status.dto';
import { ListAdminUsersDto } from './dto/list-admin-users.dto';
import { ChangeUserRoleDto } from './dto/change-user-role.dto';
import { SetUserTrustedDto } from './dto/set-user-trusted.dto';
import { SetUserRequiresReviewDto } from './dto/set-user-requires-review.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { ReorderCategoriesDto } from './dto/reorder-categories.dto';
import { UpdateSettingDto } from './dto/update-setting.dto';
import {
  AttributeField,
  resolveEffectiveSchema,
  resolveEffectivePolicy,
  countAttributesByType,
  CATEGORY_MAX_DEPTH,
} from '../categories/category.types';
import { CategoryTreeService } from '../categories/category-tree.service';
// FICHA F1 — las señales de moderación de la ficha.
// ETIQUETA INTERNA (P1) — las reglas del triaje, en su fichero puro (no importa
// nada de `ListingStatus`: son ejes distintos).
import {
  describeIllegalManualTriage,
  isManualTriageTarget,
} from '../listings/listing-triage';
import { SetListingTriageDto } from './dto/set-listing-triage.dto';
// P3a — la edición de campos por el staff.
import { UpdateAdminListingDto } from './dto/update-admin-listing.dto';
import { ListingEditValidationService } from '../listings/listing-edit-validation.service';
import { PreModerationService } from '../moderation/pre-moderation.service';
import { DetectionEngine } from '../moderation/detection/detection.engine';
import { ListingDetectionsService } from '../moderation/detection/listing-detections.service';
import {
  DETECTION_MODES_SETTING,
  parseDetectionModes,
  type DetectorId,
} from '../moderation/detection/detection.types';
import { normalizarTelefono } from '../moderation/detection/phone-format';
import { ListingGateService } from '../listing-gate/listing-gate.service';
// FICHA DE USUARIO U3 — el dueño único de «¿es Pro?».
import { ProStatusService } from '../listing-gate/pro-status.service';
import { MARK_STALE_JOB } from '../listing-gate/revalidation.processor';
import {
  PRE_MODERATION_ALL_SETTING,
  PRE_MODERATION_TRUSTED_EXEMPT_SETTING,
} from '../moderation/pre-moderation.service';
import { EMAIL_VERIFIED_RULE_ENABLED_SETTING } from '../listing-gate/rules/email-verified.rule';
import {
  DEFAULT_MAX_PHOTOS,
  DEFAULT_MIN_PHOTOS,
  MAX_PHOTOS_SETTING,
  MIN_PHOTOS_RULE_ENABLED_SETTING,
  MIN_PHOTOS_SETTING,
} from '../listing-gate/photo-limits';
import {
  DEFAULT_FREE_ACTIVE_LIMIT,
  DEFAULT_FREE_TOTAL_LIMIT,
  DEFAULT_PRO_ACTIVE_LIMIT,
  DEFAULT_PRO_TOTAL_LIMIT,
  FREE_ACTIVE_LIMIT_SETTING,
  FREE_TOTAL_LIMIT_SETTING,
  PRO_ACTIVE_LIMIT_SETTING,
  PRO_TOTAL_LIMIT_SETTING,
  TOTAL_LIMIT_RULE_ENABLED_SETTING,
} from '../listing-gate/listing-limits';
import { FilterableAttributesResolver } from '../search/filterable-attributes.resolver';
import { DEFAULT_MAX_TAGS_PER_LISTING } from '../tags/tag.types';
import { TICKET_REOPEN_WINDOW_DAYS } from '../tickets/tickets.constants';
// RÁFAGA (A1) — la máquina de estados vive en un fichero PURO de listings (mismo
// molde que category.types.ts) porque AdminModule no importa ListingsModule.
import {
  isLegalTransition,
  describeIllegalTransition,
} from '../listings/listing-status.transitions';

const cacheKey = (slug: string) => `listing:${slug}`;

// Mirrors the constant in SearchService — must stay in sync with MEILI_INDEX_NAME env.
const LISTINGS_INDEX = process.env.MEILI_INDEX_NAME ?? 'listings';

/**
 * Un valor que `normalizarTelefono` NO PUEDE devolver nunca: su salida es siempre nueve
 * dígitos o `null`. Sirve para que buscar algo que no es un teléfono devuelva vacío en vez
 * de colarse como `phoneNormalized: null`, que preguntaría lo contrario.
 */
const TELEFONO_IMPOSIBLE = 'no-es-un-telefono';

// Keys the admin is allowed to update via PATCH /admin/settings/:key.
const SETTING_KEYS = [
  'badWordList',
  'listingExpiryDays',
  'contactRequiresVerification',
  // RF.7: active listing limits per plan
  'freeActiveListingLimit',
  'proActiveListingLimit',
  // PUERTA regla #1 — topes TOTALES por plan (todo menos ARCHIVED y SOLD). Otra
  // regla, otro universo: los de arriba limitan el escaparate, éstos la
  // acumulación. Ver `listing-gate/listing-limits.ts`.
  'freeTotalListingLimit',
  'proTotalListingLimit',
  // PUERTA regla #1 — su interruptor. SIN FILA, APAGADA: es política NUEVA, y
  // encenderla sin saber a cuánta gente frena es justo lo que M2 evita.
  'totalListingLimitEnabled',
  // PUERTA regla #2 — correo verificado para publicar. SIN FILA, APAGADA. No
  // rechaza nada: deja el anuncio en borrador con un aviso.
  'emailVerifiedToPublishEnabled',
  // PUERTA regla #3 — topes de fotos. El MÁXIMO sólo se muda de constante a
  // ajuste (15 sigue siendo 15); el MÍNIMO es nuevo y por eso trae interruptor.
  'maxPhotosPerListing',
  'minPhotosPerListing',
  'minPhotosRuleEnabled',
  // H8.1: monthly free-featured quota granted to Pro subscribers
  'proMonthlyFeaturedQuota',
  // H8.5a: fixed duration of a featured grant paid from the quota
  'proQuotaFeaturedDurationDays',
  // Monetización: credit costs for bump / featured-by-credits
  'bumpCreditCost',
  'featuredCreditCost7d',
  'featuredCreditCost14d',
  'featuredCreditCost30d',
  // §2.5 RF.10: Pro bonus percentage on credit-pack purchases
  'proExtraCreditsPercent',
  // Monetización ráfaga 3: monthly free-bump quota granted to Pro subscribers
  'proMonthlyBumpQuota',
  // Monetización ráfaga 4: Pro bonus percentage on bump-pack purchases — a
  // Setting OF ITS OWN, not reused from proExtraCreditsPercent (distinct,
  // separately calibrated Pro perks).
  'proExtraBumpsPercent',
  // Atención al usuario R4: buzón único al que llegan los avisos por email de
  // tickets (NO fan-out por administrador — ver §14.4 del diseño). Sin sembrar
  // en el seed: "sin configurar" es un estado válido y explícito, en el que
  // TicketNotificationsService registra un warning y omite SOLO el correo (el
  // aviso in-app al staff se crea igual).
  'supportEmail',
  // Atención al usuario R8: ventana (en días) de reapertura de un ticket RESOLVED
  // y, por tanto, de su cierre automático. UN SOLO valor para las dos cosas — el
  // guard de T8 y el cron de T9 lo leen del mismo sitio, o habría un limbo entre
  // "ya no puedo reabrir" y "aún no me han cerrado". Sin configurar → 14 días
  // (TICKET_REOPEN_WINDOW_DAYS), así que no hace falta sembrarlo.
  'ticketAutoCloseWindowDays',
  // B1 (tags) — tope de tags por anuncio. B1 solo lo DEFINE; quien lo usa para validar
  // al crear/editar un anuncio es B2. Sin sembrar: "sin configurar" cae a
  // DEFAULT_MAX_TAGS_PER_LISTING (5), mismo patrón que ticketAutoCloseWindowDays.
  'maxTagsPerListing',
  // Bump automático (D7) — interruptor de emergencia. Es la primera feature que gasta
  // dinero de los usuarios de forma DESATENDIDA: un fallo se multiplica por cada
  // programación activa, y sin este ajuste la única salida sería desplegar. Apagarlo
  // detiene el cron pero NO toca las programaciones: al reencender siguen donde estaban.
  // Sin fila, encendido (ver BUMP_AUTO_ENABLED_SETTING).
  'bumpAutoEnabled',
  // D3 — tope de programaciones ACTIVAS por usuario. Sin fila, DEFAULT_MAX_SCHEDULES_PER_USER.
  'maxBumpSchedulesPerUser',
  // Vídeo Pro (proyecto 3) — interruptor de toda la feature. Al revés que `bumpAutoEnabled`,
  // SIN FILA ESTÁ APAGADA: el vídeo cuesta almacenamiento y ancho de banda desde el primero,
  // así que encenderlo debe ser un acto explícito. Apagarlo oculta la opción y los vídeos
  // ya subidos, pero NO borra nada — mismo criterio que el flag del bump automático.
  'videoEnabled',
  // PUERTA ráfaga 2 — el interruptor de la regla de atributos. SIN FILA, APAGADA,
  // igual que `videoEnabled` y por un motivo parecido: es la única regla que puede
  // frenar a anuncios publicados hace años sin que su dueño haya tocado nada, así
  // que encenderla tiene que ser un acto explícito y con el número de
  // `pnpm gate-impact-report` delante. Mientras está apagada el mecanismo sigue
  // marcando y avisando, que es lo que hace que encenderla no sea a ciegas.
  'attributeRevalidationEnabled',
  // MODERACIÓN PREVIA M1 — nivel PLATAFORMA. Sin fila, APAGADO: nada va a
  // revisión por esta vía hasta que alguien lo encienda. El nivel CATEGORÍA no
  // es un ajuste global sino una marca por categoría (`Category.requiresReview`),
  // y por eso no aparece aquí.
  'preModerationAllListings',
  // MODERACIÓN M4 — ¿la confianza exime de la revisión de PLATAFORMA? SIN FILA,
  // NO: encenderlo es decidir que una insignia que hoy es cosmética pase a tener
  // consecuencias. Nunca exime de las marcas específicas (categoría o usuario).
  'preModerationTrustedExempt',
  // PUNTO 6 · RÁFAGA B — EL ASCENSO. `{ WORD, IP, PHONE } → 'WARN' | 'BLOCK'`.
  //
  // Sin fila, los modos son los de nacimiento: `WORD` bloquea (lo hace desde siempre) e
  // `IP`/`PHONE` avisan. Ascender un detector es CAMBIAR ESTE VALOR — no se reescribe
  // ningún detector, que es para lo que la ráfaga 0 dejó la forma.
  //
  // ADMIN, mismo criterio que `preModerationAllListings`: elegir qué ramas entran en la
  // cola es moderar; decidir que a partir de ahora un patrón despublica es una política.
  'detectionModes',
] as const;
type SettingKey = (typeof SETTING_KEYS)[number];

// Keys whose value must be a positive integer (>= 1) — credit costs, and (as
// of ráfaga 3) the two Pro monthly quotas. proMonthlyFeaturedQuota was
// whitelisted (SETTING_KEYS) without ever landing here — the backend accepted
// negative or non-integer values, protected only by the frontend's min={0}.
// Closed here rather than replicated: "coherencia con el molde" no aplica
// cuando el molde tiene un fallo de validación — server-side validation is
// what actually protects, client-side is UX. Both quotas now require >= 1
// (a Pro plan always grants at least one of each per period); the frontend
// editor for proMonthlyFeaturedQuota was updated to match (min 0 → min 1).
const POSITIVE_INT_SETTING_KEYS: readonly string[] = [
  'bumpCreditCost',
  'featuredCreditCost7d',
  'featuredCreditCost14d',
  'featuredCreditCost30d',
  'proMonthlyFeaturedQuota',
  'proMonthlyBumpQuota',
  // R8 — una ventana de 0 o negativa cerraría al instante todo lo resuelto.
  'ticketAutoCloseWindowDays',
  // B1 — un tope de 0 dejaría el sistema de tags muerto: nadie podría poner ninguno.
  'maxTagsPerListing',
  // D3 — un tope de 0 dejaría la feature muerta: nadie podría programar nada.
  'maxBumpSchedulesPerUser',
  // PUERTA regla #1 — un tope total de 0 impediría crear ningún anuncio.
  //
  // Los dos de ACTIVOS no están en esta lista y NO se añaden aquí: llevan años
  // aceptando cualquier valor y endurecerlos ahora cambiaría el comportamiento de
  // una clave existente, que es justo lo que estas ráfagas no hacen. Queda
  // anotado como asimetría conocida.
  'freeTotalListingLimit',
  'proTotalListingLimit',
  // PUERTA regla #3 — un máximo de 0 dejaría los anuncios sin fotos, y un mínimo
  // de 0 sería no tener mínimo (para eso está el interruptor).
  'maxPhotosPerListing',
  'minPhotosPerListing',
];

/**
 * PUERTA regla #1 — los defaults de las cuatro claves de límite, para poder
 * comparar contra el valor EFECTIVO del otro cuando no tiene fila. Salen de
 * `listing-gate/listing-limits.ts`, que es donde los leen las reglas: si se
 * copiaran aquí, la guarda podría validar contra números que ya no se aplican.
 */
const DEFAULTS_DE_LIMITE: Record<string, number> = {
  [FREE_ACTIVE_LIMIT_SETTING]: DEFAULT_FREE_ACTIVE_LIMIT,
  [PRO_ACTIVE_LIMIT_SETTING]: DEFAULT_PRO_ACTIVE_LIMIT,
  [FREE_TOTAL_LIMIT_SETTING]: DEFAULT_FREE_TOTAL_LIMIT,
  [PRO_TOTAL_LIMIT_SETTING]: DEFAULT_PRO_TOTAL_LIMIT,
};

// Keys whose value is a percentage: integer in [0, 100]. 0 is valid (disables
// the Pro bonus without removing the key); >100 would gift more credits than
// the pack costs, which is never intended.
const PERCENT_SETTING_KEYS: readonly string[] = ['proExtraCreditsPercent', 'proExtraBumpsPercent'];

// Defaults of the keys that are deliberately NOT seeded: "sin configurar" is a
// valid state and each reader falls back to its own constant. Listed here so
// getSettings() can hand the backoffice the SAME value the backend would use —
// otherwise the editor would have to hardcode a 5 that could silently drift from
// DEFAULT_MAX_TAGS_PER_LISTING. The constants are imported, never copied.
//
// `supportEmail` has no constant on purpose: unset means "no hay buzón", and
// TicketNotificationsService logs a warning and skips only the email.
const SETTING_DEFAULTS: Readonly<Record<string, unknown>> = {
  maxTagsPerListing: DEFAULT_MAX_TAGS_PER_LISTING,
  ticketAutoCloseWindowDays: TICKET_REOPEN_WINDOW_DAYS,
  supportEmail: null,
  // PUERTA regla #1 — las tres nacen sin fila. Sin esto, el backoffice pintaría
  // un hueco donde debería verse el tope que se está aplicando de verdad, y sería
  // imposible saber desde la UI si la regla está encendida o apagada.
  [FREE_TOTAL_LIMIT_SETTING]: DEFAULT_FREE_TOTAL_LIMIT,
  [PRO_TOTAL_LIMIT_SETTING]: DEFAULT_PRO_TOTAL_LIMIT,
  // Apagada, que es como nace. Mismo criterio que `videoEnabled`.
  [TOTAL_LIMIT_RULE_ENABLED_SETTING]: false,
  // MODERACIÓN M1 — apagado, que es como nace.
  [PRE_MODERATION_ALL_SETTING]: false,
  [PRE_MODERATION_TRUSTED_EXEMPT_SETTING]: false,
  [EMAIL_VERIFIED_RULE_ENABLED_SETTING]: false,
  // PUERTA regla #3. El máximo enseña 15 —el mismo que llevaba clavado el DTO—
  // para que el backoffice no pinte un hueco donde hay un tope aplicándose.
  [MAX_PHOTOS_SETTING]: DEFAULT_MAX_PHOTOS,
  [MIN_PHOTOS_SETTING]: DEFAULT_MIN_PHOTOS,
  [MIN_PHOTOS_RULE_ENABLED_SETTING]: false,
};

// A1 (URLs anidadas) — segmentos de primer nivel que YA ocupan rutas estáticas del
// frontend. Una categoría RAÍZ con uno de estos slugs es inalcanzable: Next resuelve
// el segmento estático antes que el catch-all de categorías, así que /blog siempre
// sería el blog y nunca la categoría. Eso ya pasaba con la ruta /[categoria] anterior
// —en silencio, sin error—, y el catch-all no lo cambia; lo que sí cambia es que
// ahora hay un único sitio donde el problema se puede nombrar, así que se cierra aquí.
//
// Solo aplica a RAÍCES: una hija llamada "blog" vive en /vehiculos/blog y no colisiona
// con nada (ver assertRootSlugNotReserved).
//
// Derivada de las rutas reales de apps/web/src/app: los grupos ((public), (account),
// (auth), (admin)) NO añaden segmento a la URL, así que todos comparten el espacio de
// nombres de primer nivel.
const RESERVED_ROOT_SLUGS: ReadonlySet<string> = new Set([
  // (public)
  'anuncio', 'blog', 'busqueda', 'contacto', 'paginas', 'planes', 'vendedor',
  // (account)
  'favoritos', 'mensajes', 'mis-alertas', 'mis-anuncios', 'mis-creditos', 'mis-tickets',
  'notificaciones', 'perfil', 'publicar',
  // (auth)
  'login', 'recuperar', 'registro', 'restablecer', 'verificar-email',
  // (admin) + route handlers + estáticos de Next
  'admin', 'api', '_next', 'favicon.ico', 'robots.txt', 'sitemap.xml',
]);

/**
 * FICHA F2 (P6) — los órdenes de la lista del backoffice, en un solo sitio.
 *
 * `recent` y `oldest` son EXACTAMENTE lo que eran antes de F2 (`updatedAt` desc
 * y asc): la cola de revisión de M3 pide `oldest` y no puede notar este cambio.
 * El resto son ejes nuevos, y cada uno responde a una pregunta concreta — no hay
 * uno por columna. Ver docs/diseno-ficha-anuncio.md §2.4.
 */
const ORDER_BY: Record<string, Prisma.ListingOrderByWithRelationInput> = {
  // «Qué se ha movido» — el de siempre, y el que se aplica sin parámetro.
  recent: { updatedAt: 'desc' },
  // La cola: lo que lleva más tiempo esperando, primero.
  oldest: { updatedAt: 'asc' },
  // «Lo último que entró» / «lo más viejo que sigue vivo».
  'created-desc': { createdAt: 'desc' },
  'created-asc': { createdAt: 'asc' },
  // Se combinan con el resto de filtros para cazar precios absurdos (el 1 € de
  // estafa, el 999.999 € de prueba).
  'price-desc': { price: 'desc' },
  'price-asc': { price: 'asc' },
  // Lo más denunciado primero — el orden natural de la bandeja de problemas.
  'reports-desc': { reports: { _count: 'desc' } },
};

/**
 * ÚLTIMA IP (5b) — LOS ÓRDENES DE LA LISTA DE USUARIOS. Molde `ORDER_BY` de F2, TRAÍDO:
 * aquél es de `Listing` y no vale para `User`. Esta lista no tenía eje ninguno.
 *
 * ─── `nulls: 'last'`, Y NO ES UN DETALLE ──────────────────────────────────────
 *
 * `lastLoginAt` nace NULL para todo el mundo —el dato no existía antes de 5a y no hay
 * backfill posible— y **Postgres pone los NULL PRIMERO en un `ORDER BY ... DESC`**. Sin
 * esto, «ordenar por última conexión» pondría arriba exactamente a quien NUNCA ha entrado:
 * lo contrario de lo que el moderador ha pedido, y el tipo de cosa que se ve una vez en
 * producción y se atribuye a otra causa.
 *
 * Va en los DOS órdenes de última conexión: en `asc` los NULL van últimos por defecto,
 * pero escribirlo en uno y no en el otro dejaría la regla a medias y a merced de que
 * alguien cambie el sentido.
 */
const USER_ORDER_BY: Record<string, Prisma.UserOrderByWithRelationInput> = {
  // EL DE ENTRADA (5b): «quién ha estado aquí hace menos». Es el orden en que un
  // moderador piensa una lista de personas cuando investiga.
  'last-login-desc': { lastLoginAt: { sort: 'desc', nulls: 'last' } },
  // «Quién lleva más tiempo sin aparecer», con los que nunca entraron al final igual.
  'last-login-asc': { lastLoginAt: { sort: 'asc', nulls: 'last' } },
  // El de siempre hasta 5b, conservado: quien quiera el alta lo sigue teniendo.
  recent: { createdAt: 'desc' },
  oldest: { createdAt: 'asc' },
};

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly meili: MeilisearchService,
    private readonly auditLog: AuditLogService,
    private readonly attributesResolver: FilterableAttributesResolver,
    // PROFUNDIDAD N — RÁFAGA 1: el único lector de la jerarquía.
    private readonly categoryTree: CategoryTreeService,
    private readonly gate: ListingGateService,
    @InjectQueue(QUEUE_INDEXING) private readonly indexingQueue: Queue,
    // PUERTA — RÁFAGA 2: el marcado por cambio de schema. Cola aparte del
    // indexado a propósito (ver QUEUE_REVALIDATION).
    @InjectQueue(QUEUE_REVALIDATION) private readonly revalidationQueue: Queue,
    // BORRADO B3 — retirar del bucket lo que se queda sin dueño al eliminar.
    @InjectQueue(QUEUE_MEDIA_CLEANUP) private readonly mediaCleanupQueue: Queue,
    private readonly r2: R2Service,
    // FICHA F1 — las señales de moderación de la ficha. AL FINAL DE LA LISTA a
    // propósito: insertar un parámetro en medio rompe todos los specs que
    // construyen el servicio a mano (pasó en B3 y costó dos arreglos).
    private readonly preModeration: PreModerationService,
    // PUNTO 6 — LOS DOS, y no es redundancia. `DetectionEngine` es detección PURA sobre
    // texto: la ficha la usa para la señal en vivo y no debe poder escribir nada.
    // `ListingDetectionsService` es la pasada que además persiste, y sólo la usa el camino
    // que edita. Quien sólo lee no puede escribir sin querer.
    private readonly detection: DetectionEngine,
    private readonly detections: ListingDetectionsService,
    // FICHA DE USUARIO U3 — el HECHO de ser Pro para la ficha de usuario. Es el
    // dueño único de esa pregunta (ver su cabecera); aquí sólo se consulta.
    private readonly proStatus: ProStatusService,
    // P3a — las reglas de los campos, las MISMAS que usa el camino del dueño.
    private readonly editValidation: ListingEditValidationService,
    // 2b — las FOTOS, también las mismas. Al final, por la nota de arriba.
    private readonly listingImages: ListingImagesService,
  ) {}

  // ===========================================================================
  // Listings (R7.4)
  // ===========================================================================

  /**
   * FICHA F2 (P6) — la lista con la que el moderador encuentra CUALQUIER anuncio.
   *
   * Los ejes se COMBINAN: todo lo que llega se acumula en el mismo `where`, así
   * que «los borradores de este vendedor en esta rama» es una consulta y no tres
   * pasadas a ojo. Y los cinco ejes que el diseño dejó para después —precio,
   * provincia, tipo, condición, vídeo— entran añadiendo una línea aquí y un
   * campo al DTO: la forma no cambia. Igual que el filtro por etiqueta interna
   * cuando exista P1.
   */
  async listListings(query: ListAdminListingsDto) {
    const {
      q,
      status,
      statuses,
      categoryId,
      sellerId,
      hasReports,
      needsRevalidation,
      hasDetections,
      detector,
      phone,
      province,
      city,
      triage,
      watched,
      ip,
      createdFrom,
      createdTo,
      updatedFrom,
      updatedTo,
      page = 1,
      perPage = 24,
      order,
    } = query;

    // LA PROFUNDIDAD N, y es la barrera de esta ráfaga. Filtrar por «Motor» tiene
    // que devolver el anuncio que cuelga de «Motor › Coches › Berlinas»: los
    // anuncios viven en las HOJAS, así que un filtro exacto por una categoría
    // intermedia devuelve cero y parece que no hay nada. Molde exacto de los
    // otros cinco sitios que ya recorren la descendencia (`listings.service.ts`,
    // `revalidation.service.ts`, `indexing.processor.ts`).
    const categoryIds = categoryId
      ? [categoryId, ...(await this.categoryTree.getDescendantIds(categoryId))]
      : undefined;

    // `statuses` gana a `status` cuando vienen los dos: es el más específico y
    // sólo puede haberlo puesto alguien a propósito. Sin `statuses`, `status`
    // sigue comportándose EXACTAMENTE igual que antes de F2 — que es lo que la
    // cola de revisión (M3) depende de que no cambie.
    const estados = statuses?.length ? { status: { in: statuses } } : status ? { status } : {};

    const where: Prisma.ListingWhereInput = {
      ...estados,
      ...(categoryIds && { categoryId: { in: categoryIds } }),
      ...(sellerId && { sellerId }),
      // `some: {}` = «tiene al menos una denuncia». El `false` es la pregunta
      // contraria y también es útil («qué está limpio»), así que se distingue de
      // «sin filtro» en vez de colapsarse.
      ...(hasReports !== undefined && {
        reports: hasReports ? { some: {} } : { none: {} },
      }),
      ...(needsRevalidation !== undefined && { needsRevalidation }),
      // PUNTO 6 · RÁFAGA A — EL EJE PROPIO DEL AVISO. Dos líneas, molde literal de
      // `hasReports`: la relación con `some`/`none`, y el `false` como pregunta contraria.
      //
      // `hasDetections` pregunta «¿el motor encontró algo?»; `detector` acota a cuál. Se
      // pueden combinar entre sí y con todo lo demás —incluidos `triage` y `watched`, que
      // siguen siendo ejes independientes—: «los revisados que además tienen un teléfono»
      // es `?triage=REVIEWED&detector=PHONE`, y ninguno de los tres sabe de los otros.
      //
      // POR RELACIÓN Y SIN BOOLEANO DENORMALIZADO en `Listing`: se apoya en el índice de
      // `ListingDetection.listingId`. Si resulta caro se mide con EXPLAIN ANALYZE y ENTONCES
      // se decide, que es el criterio con el que F2 añadió un índice y E2 decidió no
      // añadirlo. Denormalizar antes de medir inventa un problema y crea una segunda verdad.
      //
      // VAN EN `AND` Y NO COMO DOS CAMPOS SUELTOS, y esto es un fallo evitado, no estilo:
      // los dos filtran la MISMA relación, así que dos `detections:` en el mismo objeto se
      // pisan — el segundo gana y el primero desaparece **sin error**. `?hasDetections=false
      // &detector=PHONE` habría respondido «los que tienen teléfono» a quien preguntó por
      // los que no tienen nada. Con `AND` la contradicción devuelve vacío, que es la
      // respuesta correcta a una pregunta contradictoria.
      ...((hasDetections !== undefined || detector) && {
        AND: [
          ...(hasDetections !== undefined
            ? [{ detections: hasDetections ? { some: {} } : { none: {} } }]
            : []),
          ...(detector ? [{ detections: { some: { detector } } }] : []),
        ],
      }),
      // ÚLTIMA IP (5b) — la línea que F2 prometió. Exacta, no `contains`.
      ...(ip && { lastOwnerIp: ip }),
      // EL TELÉFONO — contra la columna CANÓNICA, con la entrada del moderador normalizada
      // por la misma función. Es lo que hace que `654 123 456` encuentre un anuncio guardado
      // como `+34654123456`.
      //
      // SI LO QUE ESCRIBE NO ES UN TELÉFONO ESPAÑOL, `normalizarTelefono` devuelve `null`, y
      // filtrar por `phoneNormalized: null` significaría «los anuncios SIN teléfono válido»
      // — la pregunta CONTRARIA a la que se hizo, y respondida con una lista larga que
      // parece un acierto. Se usa un valor imposible para que la respuesta sea VACÍO, que es
      // lo correcto para «enséñame los que tienen ESE teléfono» cuando eso no es un teléfono.
      ...(phone?.trim() && {
        phoneNormalized: normalizarTelefono(phone) ?? TELEFONO_IMPOSIBLE,
      }),
      // PROVINCIA Y MUNICIPIO — parámetros propios, nunca dentro de `q`: «de Toledo» y
      // «menciona Toledo» son preguntas distintas (ver el DTO). `contains` insensible
      // porque son texto libre del vendedor.
      ...(province?.trim() && {
        province: { contains: province.trim(), mode: 'insensitive' as const },
      }),
      ...(city?.trim() && {
        city: { contains: city.trim(), mode: 'insensitive' as const },
      }),
      // ETIQUETA INTERNA (P1, E2) — los dos ejes del triaje, cada uno por su
      // cuenta y combinables con todo lo demás. Son literalmente las dos líneas
      // que F2 prometió que costaría añadir un eje nuevo.
      ...(triage?.length && { triage: { in: triage } }),
      ...(watched !== undefined && { watched }),
      ...((createdFrom || createdTo) && {
        createdAt: {
          ...(createdFrom && { gte: new Date(createdFrom) }),
          ...(createdTo && { lte: new Date(createdTo) }),
        },
      }),
      ...((updatedFrom || updatedTo) && {
        updatedAt: {
          ...(updatedFrom && { gte: new Date(updatedFrom) }),
          ...(updatedTo && { lte: new Date(updatedTo) }),
        },
      }),
      // El texto casa por CONTENIDO y por IDENTIDAD: «me han pasado este
      // anuncio» llega tanto como nombre cuanto como enlace pegado, y buscar el
      // slug de una URL tenía que funcionar sin recortarla a mano.
      //
      // EL COSTE, DICHO DE ANTEMANO: `contains` insensible es `ILIKE '%x%'`, y un
      // comodín por delante NO usa un índice B-tree — es un recorrido. Se acepta
      // a propósito con el volumen actual, y el umbral está escrito para no
      // descubrirlo en producción: pasadas las ~100.000 filas, o si la lista
      // supera los ~300 ms, la salida es un índice GIN con `pg_trgm` sobre
      // `title`, que no obliga a cambiar esta consulta. Mandar el texto a Meili
      // NO es la salida: sólo indexa ACTIVE, que es justo lo que aquí no sirve.
      // Ver docs/diseno-ficha-anuncio.md §3.3.
      ...(q?.trim() && {
        OR: [
          { title: { contains: q.trim(), mode: 'insensitive' as const } },
          { description: { contains: q.trim(), mode: 'insensitive' as const } },
          { slug: { contains: q.trim(), mode: 'insensitive' as const } },
          { id: q.trim() },
        ],
      }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.listing.findMany({
        where,
        orderBy: ORDER_BY[order ?? 'recent'],
        skip: (page - 1) * perPage,
        take: perPage,
        select: {
          id: true,
          title: true,
          slug: true,
          status: true,
          price: true,
          currency: true,
          priceType: true,
          publishedAt: true,
          createdAt: true,
          updatedAt: true,
          // ETIQUETA INTERNA (P1, E2) — para pintar la insignia en la lista sin
          // tener que entrar en cada ficha.
          triage: true,
          watched: true,
          category: { select: { id: true, name: true, slug: true } },
          seller: { select: { id: true, name: true, slug: true, email: true } },
          images: {
            orderBy: { order: 'asc' },
            take: 1,
            select: { url: true },
          },
          _count: { select: { reports: true } },
        },
      }),
      this.prisma.listing.count({ where }),
    ]);
    return { items, total, page, perPage };
  }

  /**
   * FICHA F1 (P4) — EL DETALLE QUE ALIMENTA `/admin/anuncios/{id}`.
   *
   * POR QUÉ ESTA AMPLIACIÓN ES SEGURA: hasta F1 este endpoint estaba construido,
   * protegido y **sin un solo consumidor** — el cliente web tenía funciones para
   * listar, cambiar estado y eliminar, ninguna para el detalle. Todo lo que se
   * añade aquí es aditivo sobre una respuesta que nadie leía.
   *
   * LO QUE ARREGLA, que es más que «enseñar más campos»: la cola de revisión
   * enlazaba cada anuncio a `/anuncio/{slug}`, y la página pública lanza 404 para
   * todo lo que no sea ACTIVE. Como la cola contiene por construcción sólo
   * PENDING_REVIEW, ese enlace estaba roto SIEMPRE y no existe vista previa de
   * staff: el moderador aprobaba y rechazaba sin ver la descripción ni las fotos.
   * Esta respuesta es lo que hace que pueda verlas.
   */
  async getListingById(id: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      include: {
        category: true,
        images: { orderBy: { order: 'asc' } },
        seller: {
          select: {
            id: true,
            name: true,
            email: true,
            slug: true,
            status: true,
            role: true,
            createdAt: true,
            // F1 — las dos marcas del vendedor que el moderador necesita ver
            // junto al anuncio: `requiresReview` explica una cola, `trusted`
            // matiza. Son ejes independientes (ver PreModerationService).
            trusted: true,
            requiresReview: true,
          },
        },
        reports: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: {
            reporter: { select: { id: true, name: true, slug: true } },
          },
        },
        // F1 — los registros que B1 hizo SOBREVIVIR al borrado del anuncio. Que
        // sobrevivan y no se puedan ver desde ningún sitio sería media pieza.
        reviews: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          // 7b — SIN filtrar por `retiredAt`, a propósito: el staff ve las retiradas
          // (marcadas) porque es quien tiene que poder restaurarlas. Retirar no es
          // esconderle la valoración a quien la modera.
          select: {
            id: true,
            rating: true,
            comment: true,
            createdAt: true,
            // 7a dejó anotado que `verified` no viajaba, y es el campo que dice si esa
            // valoración CUENTA para la media: retirar una `verified: false` no cambia
            // la reputación de nadie, y el moderador necesita saberlo antes de decidir.
            verified: true,
            retiredAt: true,
            retiredReason: true,
            author: { select: { id: true, name: true, slug: true } },
          },
        },
        tickets: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            subject: true,
            status: true,
            createdAt: true,
          },
        },
        // `Deal` no tiene estado: existir ES el hecho («este anuncio se cerró con
        // este comprador»). Por eso se muestra el comprador y la fecha, y nada más.
        deals: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            createdAt: true,
            buyer: { select: { id: true, name: true, slug: true } },
          },
        },
        // F1 — la programación de bump. `bumpedAt` ya venía; lo que faltaba era
        // saber si HAY una programación viva, que es lo que explica por qué un
        // anuncio sube solo.
        bumpSchedule: true,
        // PUNTO 6 · RÁFAGA A — LO QUE EL MOTOR ENCONTRÓ, con su fragmento.
        //
        // Se sirve el hallazgo entero y no un booleano porque el moderador tiene que poder
        // JUZGARLO, que es todo el propósito del modo avisar: una IP en un anuncio de router
        // es legítima y una en uno de bicicletas no, y esa diferencia sólo se ve leyendo qué
        // se encontró y dónde. Es la misma regla que rige F1 desde el principio — enseñar el
        // dato, no fingir.
        detections: {
          orderBy: [{ detector: 'asc' }, { field: 'asc' }],
          select: { id: true, detector: true, field: true, match: true, rule: true },
        },
        _count: {
          select: {
            conversations: true,
            reports: true,
            reviews: true,
            tickets: true,
            deals: true,
            favorites: true,
            viewsDaily: true,
          },
        },
      },
    });
    if (!listing) throw new NotFoundException('Anuncio no encontrado');

    // Las tres piezas que no salen de la fila y se piden en paralelo: la RUTA de
    // la categoría (un moderador necesita «Motor › Coches › Berlinas», no
    // «Berlinas»), las señales de moderación y el historial.
    const [categoryPath, señales, palabraProhibida, historial] = await Promise.all([
      this.categoryTree.getAncestorChain(listing.categoryId),
      this.preModeration.reviewSignalsFor(listing),
      // Molde `publish()`: el filtro de palabras es FAIL-OPEN por contrato — si
      // falla, no bloquea. Aquí el coste de un fallo es aún menor (una señal que
      // no se pinta), así que se mantiene el mismo criterio y no se propaga.
      // PUNTO 6 · RÁFAGA 0 — el motor en lugar de `hasBadWords`. La señal que viaja al
      // frontal SIGUE SIENDO EL MISMO BOOLEANO (`moderationSignals.palabraProhibida`): la
      // respuesta de este endpoint no cambia de forma, que es media barrera de la ráfaga.
      // Se pregunta explícitamente por el detector `WORD` y no por `blocking`, porque la
      // señal se llama «palabra prohibida» y tiene que seguir significando eso cuando la
      // ráfaga A añada detectores.
      this.detection
        .run({ title: listing.title, description: listing.description })
        .then((r) => r.detections.some((d) => d.detector === 'WORD'))
        .catch(() => false),
      this.auditLog.listForResource('Listing', listing.id),
    ]);

    return {
      ...listing,
      categoryPath: categoryPath.map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
      /**
       * SEÑALES, NO «EL MOTIVO». Son cuatro caminos distintos hacia
       * PENDING_REVIEW —la palabra prohibida se comprueba primero en `publish()`,
       * y los tres niveles después— y ninguno se persiste al disparar. Así que
       * esto es lo que está encendido AHORA, que no tiene por qué ser lo que
       * mandó el anuncio a la cola. La ficha lo dice con esas palabras.
       */
      /**
       * PUNTO 6 · RÁFAGA A — `detections` viaja al lado de `moderationSignals`, NO dentro.
       *
       * Y separadas a propósito, porque **su garantía es distinta** y mezclarlas haría que
       * la ficha prometiera de las señales algo que no puede cumplir:
       *
       *   · `moderationSignals` son lo que está encendido AHORA, y ninguno se persiste al
       *     disparar (ver el comentario de arriba). No dicen por qué el anuncio entró en la
       *     cola.
       *   · `detections` SÍ son el resultado de la última pasada real sobre ESTE texto,
       *     porque se reemplazan enteras cada vez que alguien lo escribe.
       */
      moderationSignals: { ...señales, palabraProhibida },
      historial,
    };
  }

  /**
   * ETIQUETA INTERNA (P1) — EL CAMBIO MANUAL DEL TRIAJE Y DE LA OBSERVACIÓN.
   *
   * LO QUE ESTE MÉTODO NO HACE, y es lo importante: **no toca `status` ni
   * `needsRevalidation`**. La etiqueta es un eje del staff que corre en paralelo
   * al estado del anuncio; poner «revisado» no publica nada y quitar la
   * observación no despublica nada. La ortogonalidad no es una propiedad que
   * emerja sola: es que aquí no se escribe nada más que estas dos columnas.
   *
   * SÓLO SE AUDITA ESTO, lo manual. La transición automática (`REVIEWED →
   * EDITED`, cuando el dueño edita) NO genera registro, y no por comodidad: no
   * lleva ningún dato que el anuncio no tenga ya —el «quién» es el dueño por
   * definición y el «cuándo» es `updatedAt`— y además `AuditLog.actorId` es NOT
   * NULL con FK a `User`, así que no existe un actor «sistema» que ponerle. Es el
   * mismo criterio que ya sigue `needsRevalidation`, que se marca sin traza.
   * Ver docs/diseno-etiqueta-interna.md §3.
   */
  async setListingTriage(
    listingId: string,
    actorId: string,
    dto: SetListingTriageDto,
    ip?: string,
  ) {
    if (dto.triage === undefined && dto.watched === undefined) {
      throw new BadRequestException('Nada que cambiar: manda `triage`, `watched` o ambos.');
    }
    if (dto.triage !== undefined && !isManualTriageTarget(dto.triage)) {
      throw new BadRequestException(describeIllegalManualTriage(dto.triage));
    }

    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { id: true, triage: true, watched: true },
    });
    if (!listing) throw new NotFoundException('Anuncio no encontrado');

    const before = { triage: listing.triage, watched: listing.watched };
    const after = {
      triage: dto.triage ?? listing.triage,
      watched: dto.watched ?? listing.watched,
    };

    // Omitir un campo NO lo pisa: los dos ejes se editan juntos y se guardan por
    // separado.
    const updated = await this.prisma.listing.update({
      where: { id: listingId },
      data: {
        ...(dto.triage !== undefined && { triage: dto.triage }),
        ...(dto.watched !== undefined && { watched: dto.watched }),
      },
      select: { id: true, triage: true, watched: true },
    });

    // Sin cambio real, sin registro: un doble clic no debe ensuciar el historial
    // con una fila que dice que nada pasó.
    if (before.triage !== after.triage || before.watched !== after.watched) {
      await this.auditLog.log({
        action: 'LISTING_TRIAGE_CHANGE',
        actorId,
        resourceType: 'Listing',
        resourceId: listingId,
        before,
        after,
        ip,
      });
    }

    return updated;
  }

  /**
   * P3a — EL STAFF EDITA LOS CAMPOS DE UN ANUNCIO AJENO.
   *
   * CAMINO PROPIO, Y NO UN `update()` CON BANDERA. La edición del dueño empieza
   * con `assertOwnership` —que le devolvería un 403 a un moderador— y termina
   * anotando `REVIEWED → EDITED` dentro de su propia escritura. Reutilizarla
   * exigiría un parámetro `esStaff` que apagara las dos cosas, y entonces **la
   * guarda de propiedad pasaría a depender de un booleano**: el sitio donde más
   * caro sale equivocarse.
   *
   * LO QUE SÍ SE COMPARTE SON LAS REGLAS. `ListingEditValidationService` es el
   * mismo objeto que usa el dueño, extraído para eso. El staff **no se salta
   * ninguna validación**: dejarle escribir un anuncio inválido «porque es de
   * confianza» produce una fila que el propio sistema marca acto seguido con
   * `needsRevalidation`, y el aviso le cae al VENDEDOR por un cambio que no hizo.
   *
   * LO QUE NO HACE, y es el cuidado que atraviesa P3:
   *
   *   · **No toca `triage`.** `EDITED` afirma «el DUEÑO cambió algo tras la
   *     revisión»; dispararlo desde aquí mandaría al staff a revisar su propio
   *     cambio y vaciaría de sentido la única señal que P1 construyó.
   *   · **No toca `status`.** Cambiar de estado tiene su vía, que registra y
   *     avisa (M2). Ésta es de campos.
   *   · **No re-modera.** El filtro de palabras existe para lo que escribe un
   *     vendedor; pasarle el texto que acaba de escribir un moderador sería
   *     pedirle a la máquina que revise a quien la opera.
   *
   * Ver docs/diseno-editar-anuncio.md §1.
   */
  async updateListing(
    listingId: string,
    actorId: string,
    dto: UpdateAdminListingDto,
    ip?: string,
  ) {
    const existing = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!existing) throw new NotFoundException('Anuncio no encontrado');

    const { reason, imageIds, ...fields } = dto;

    // LAS MISMAS REGLAS QUE EL DUEÑO, desde el mismo sitio.
    const tagIds = await this.editValidation.validarEdicion({
      listingId,
      existing,
      dto: fields,
    });

    // El `before` guarda SÓLO los campos que esta edición toca: un snapshot de la
    // fila entera enterraría el cambio real entre treinta columnas iguales.
    const before: Record<string, unknown> = {};
    for (const clave of Object.keys(fields) as (keyof typeof fields)[]) {
      before[clave] = (existing as unknown as Record<string, unknown>)[clave];
    }

    const listing = await this.prisma.listing.update({
      where: { id: listingId },
      data: {
        ...(fields.title !== undefined && { title: fields.title }),
        ...(fields.description !== undefined && { description: fields.description }),
        ...(fields.price !== undefined && { price: fields.price }),
        ...(fields.priceType !== undefined && { priceType: fields.priceType }),
        ...(fields.priceUnit !== undefined && { priceUnit: fields.priceUnit }),
        ...(fields.categoryId !== undefined && { categoryId: fields.categoryId }),
        ...(fields.attributes !== undefined && { attributes: fields.attributes as object }),
        ...(fields.city !== undefined && { city: fields.city }),
        ...(fields.province !== undefined && { province: fields.province }),
        ...(fields.postalCode !== undefined && { postalCode: fields.postalCode }),
        // Reemplazo COMPLETO del set, en la misma escritura — molde de B2.
        ...(tagIds !== undefined && {
          tags: { deleteMany: {}, create: tagIds.map((tagId) => ({ tagId })) },
        }),
        // AQUÍ NO HAY `triage`. Es la diferencia entera con el camino del dueño.
      },
    });

    // 2b — LAS FOTOS, POR EL MISMO SITIO QUE EL DUEÑO.
    //
    // Lo que había aquí eran dos `updateMany` a pelo que NO escribían el `order`
    // (reordenar respondía 200 sin mover nada), NO aplicaban el tope ni comprobaban
    // existencia ni propiedad —contra la promesa de P3a—, y cuyo `where: { id: { in:
    // imageIds } }` no acotaba a este anuncio: un id ajeno se llevaba la foto de otro.
    // `ListingImagesService.sync` es el camino único, con las tres validaciones, el
    // orden, el aislamiento entre anuncios y la limpieza de R2.
    let fotosRetiradas: ImagenRetirada[] = [];
    if (imageIds !== undefined) {
      const { retiradas } = await this.listingImages.sync({
        listingId,
        // EL DUEÑO DEL ANUNCIO, no el moderador: las fotos que se enganchen tienen que
        // ser del vendedor igual que si las hubiera puesto él.
        sellerId: existing.sellerId,
        imageIds,
      });
      fotosRetiradas = retiradas;
    }

    await this.auditLog.log({
      action: 'LISTING_EDIT',
      actorId,
      resourceType: 'Listing',
      resourceId: listingId,
      before: before as Prisma.InputJsonValue,
      after: {
        ...fields,
        reason,
        // 2b (§5.4b) — QUÉ FOTOS SE QUITARON, con su URL.
        //
        // `imageIds` se destructura fuera de `fields`, así que hasta ahora las fotos no
        // entraban ni en el `before` ni en el `after`. Mientras quitar una foto era
        // reversible —la fila sobrevivía desvinculada— daba igual; desde que el fichero
        // se borra de R2, un error del staff es IRRECUPERABLE, y sin esto sería además
        // INVISIBLE. No devuelve la foto: hace que se pueda saber cuál era.
        ...(imageIds !== undefined && {
          imageIds,
          imagenesRetiradas: fotosRetiradas,
        }),
      } as unknown as Prisma.InputJsonValue,
      ip,
    });

    // PUNTO 6 · RÁFAGA A — LAS DETECCIONES SE REFRESCAN, EL `status` NO SE TOCA.
    //
    // Es la separación que hace limpia la integración, y conviene leerla entera porque las
    // dos mitades tiran en sentidos contrarios:
    //
    //   · Una DETECCIÓN es un hecho sobre el TEXTO ACTUAL. La refresca quien escriba el
    //     texto, sea quien sea. Si el moderador acaba de quitar el teléfono, la detección
    //     TIENE QUE MORIR — dejarla viva sería exactamente el flag podrido contra el que
    //     existe el reemplazo entero, y encima puesto por quien vino a arreglarlo.
    //   · Un cambio de `status` es una CONSECUENCIA SOBRE EL VENDEDOR. Ésa sólo la dispara
    //     el vendedor. Un moderador que edita para LIMPIAR un anuncio no puede provocar de
    //     su propia mano que se despublique.
    //
    // Dos cosas, dos dueños. Es la misma separación que P3a hizo con `EDITED` (que afirma un
    // hecho sobre el dueño, y por eso el camino del staff no lo escribe — ver arriba, «AQUÍ
    // NO HAY triage») y que 5a hizo con la IP de gestión. La diferencia con aquéllas es que
    // una detección **no afirma nada sobre quién escribió el texto**: dice qué hay en él.
    //
    // En la ráfaga A esto no se nota —nadie cambia `status` al editar—, pero se construye
    // ahora para que la ráfaga B, que sí lo hará, no tenga que decidirlo con prisa.
    //
    // `fields.title ?? existing.title`: la edición es un PATCH, así que un campo ausente
    // conserva el valor viejo. Escanear `fields.description` a secas dejaría de ver la
    // descripción entera cada vez que alguien tocara sólo el precio.
    await this.detections.refresh(listingId, {
      title: fields.title ?? existing.title,
      description: fields.description ?? existing.description,
    });

    // Los mismos efectos que la edición del dueño: la ficha cacheada y el índice
    // no pueden quedarse con el contenido viejo por venir el cambio de otra
    // puerta.
    await this.redis.client.del(cacheKey(existing.slug));
    await this.indexingQueue.add('index', { listingId });

    return listing;
  }

  async changeListingStatus(
    listingId: string,
    actorId: string,
    dto: ChangeListingStatusDto,
    ip?: string,
  ) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
    });
    if (!listing) throw new NotFoundException('Anuncio no encontrado');

    // RÁFAGA (A1) — LA MÁQUINA DE ESTADOS. Este era el ÚNICO escritor de estado
    // sin guarda alguna: `@IsEnum(ListingStatus)` en el DTO valida que el valor
    // exista en el enum, no que el SALTO tenga sentido, así que cualquier estado
    // valía desde cualquier estado (incluido resucitar un ARCHIVED, que el
    // schema declara irreversible). Ver listing-status.transitions.ts.
    //
    // TOPOLOGÍA, NO VALIDEZ: comprueba que el salto es legal, NO que el anuncio
    // merezca estar activo (cuota, categoría, atributos) — eso es la futura
    // puerta de validación y no entra en esta ráfaga.
    //
    // La cuota NO se comprueba aquí a propósito: staff sigue exento, igual que
    // antes de esta ráfaga (ver la nota de política en checkActiveListingLimit,
    // listings.service.ts). Cambiar eso es una decisión pendiente, no un arreglo.
    if (!isLegalTransition(listing.status, dto.status)) {
      throw new BadRequestException(describeIllegalTransition(listing.status, dto.status));
    }

    // PUERTA — sólo cuando el destino es ACTIVE (los demás destinos sacan del
    // mercado y no hay nada que validar). Acción de STAFF: la regla de cuota
    // declara que no le aplica, así que un admin puede seguir activando por
    // encima del cupo del vendedor — ver ActiveListingLimitRule.appliesTo.
    //
    // ORTOGONAL a la máquina de estados de arriba: aquélla responde «¿es legal
    // ir de X a Y?» (topología) y ésta «¿merece estar activo?» (validez). Se
    // componen: un ARCHIVED → ACTIVE muere antes, sin llegar aquí.
    if (dto.status === ListingStatus.ACTIVE) {
      await this.gate.assertCanBecomeActive(listing, {
        actor: 'staff',
        transition: 'adminStatus',
        actorId,
      });
    }

    const before = { status: listing.status };

    // Ensure timestamps are set when transitioning to ACTIVE.
    const updateData: Prisma.ListingUpdateInput = { status: dto.status };
    if (dto.status === ListingStatus.ACTIVE) {
      const publishedAt = listing.publishedAt ?? new Date();
      updateData.publishedAt = publishedAt;
      updateData.expiresAt = ExpirationService.expiresAt(publishedAt);
    }

    const updated = await this.prisma.listing.update({
      where: { id: listingId },
      data: updateData,
    });

    // Meilisearch + Redis side effects.
    if (dto.status === ListingStatus.ACTIVE) {
      await this.redis.client.del(cacheKey(listing.slug));
      await this.indexingQueue.add('index', { listingId });
    } else if (listing.status === ListingStatus.ACTIVE) {
      await this.redis.client.del(cacheKey(listing.slug));
      await this.indexingQueue.add('remove', { listingId });
    }

    await this.auditLog.log({
      action: 'LISTING_STATUS_CHANGE',
      actorId,
      resourceType: 'Listing',
      resourceId: listingId,
      before,
      after: { status: dto.status, reason: dto.reason },
      ip,
    });

    return updated;
  }

  /**
   * BORRADO B2 — LA ÚNICA VÍA QUE DESTRUYE UN ANUNCIO. Es de staff, es
   * irreversible, y sólo funciona sobre `ARCHIVED`.
   *
   * LOS DOS PASOS SON LA SALVAGUARDA, no una molestia: para eliminar un anuncio
   * vivo hay que archivarlo primero. Eso separa «sacarlo del mercado» —reversible
   * en sus efectos, no destructivo— de «destruirlo», y obliga a que las dos cosas
   * se decidan por separado. Un borrado directo desde ACTIVE convertiría un clic
   * mal dado en una pérdida de datos.
   *
   * NO ES UNA TRANSICIÓN DE ESTADO, y por eso no pasa por `isLegalTransition`:
   * destruye la fila, no la mueve. Lo que sí hace es comprobar el estado de
   * partida con su propio `if`, igual que los doce escritores de estado que ya
   * llevan su guarda (`archive`, `publish`, `reserve`, `reactivate`…).
   *
   * QUÉ SE LLEVA Y QUÉ NO. Lo decide el schema, relación por relación, y está
   * fijado en `borrado-inventario.e2e-spec.ts`: mueren las imágenes, los tags, los
   * favoritos, las vistas y la programación de bumps (son del anuncio);
   * sobreviven las denuncias, las conversaciones, los tratos, las valoraciones,
   * los tickets y los registros contables (son constancia de algo que pasó).
   * Desde B1 con su título guardado, para que sigan siendo legibles.
   *
   * PENDIENTE DE B3: los objetos en R2 (imágenes, miniaturas y vídeo) todavía no
   * se limpian. Es basura, no corrupción — la BD queda consistente— y por eso el
   * diseño lo separa en su propia ráfaga (§3.1).
   */
  async deleteListing(listingId: string, actorId: string, ip?: string): Promise<void> {
    // Se carga ANTES de borrar, y con lo que hará falta después: una vez borrada la
    // fila no hay de dónde sacar nada. Molde `ModerationService.deleteReview`.
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: {
        id: true,
        title: true,
        slug: true,
        status: true,
        sellerId: true,
        categoryId: true,
        // BORRADO B3 — las URLs de los ficheros, AQUÍ y no después: cuando el
        // trabajo de limpieza se ejecute, la fila ya no existirá y no habría de
        // dónde sacarlas. Es el mismo motivo por el que la cola recibe claves y
        // no un `listingId` (ver `media-keys.ts`).
        videoUrl: true,
        videoPosterUrl: true,
        images: { select: { url: true } },
        _count: { select: { images: true, conversations: true, reports: true } },
      },
    });
    if (!listing) throw new NotFoundException('Anuncio no encontrado');

    if (listing.status !== ListingStatus.ARCHIVED) {
      throw new BadRequestException(
        'Solo se puede eliminar un anuncio archivado. Archívalo primero: eliminar es irreversible.',
      );
    }

    await this.prisma.listing.delete({ where: { id: listingId } });

    // EL REGISTRO ES LO ÚNICO QUE SOBREVIVE AL BORRADO, así que `before` tiene que
    // permitir reconstruir QUÉ se destruyó — no el anuncio entero (el AuditLog no
    // es una papelera), pero sí lo suficiente para responder «¿qué era esto?»:
    // su identidad, su dueño, y el tamaño de lo que colgaba.
    await this.auditLog.log({
      action: 'LISTING_DELETE',
      actorId,
      resourceType: 'Listing',
      resourceId: listingId,
      before: {
        title: listing.title,
        slug: listing.slug,
        status: listing.status,
        sellerId: listing.sellerId,
        categoryId: listing.categoryId,
        counts: listing._count,
      },
      ip,
    });

    // Fuera de la transacción y sin poder tumbar el borrado: la fila ya no está y
    // eso es lo correcto. Reintentar una limpieza es trivial; resucitar un anuncio
    // no. Un ARCHIVED no está ni cacheado ni indexado, pero los dos gestos son
    // idempotentes y baratos, y omitirlos sería confiar en que esas reglas no
    // cambien nunca.
    await this.redis.client.del(cacheKey(listing.slug));
    await this.indexingQueue.add('remove', { listingId });

    // BORRADO B3 — los ficheros del bucket. Va DESPUÉS del borrado y no puede
    // tumbarlo: si esto falla, sobra un fichero que nadie ve; si el borrado
    // fallara por esto, se perdería una decisión que alguien tomó.
    //
    // Se envían las CLAVES, no el id: el anuncio ya no existe. Y son dos por
    // imagen —original y miniatura—, que es la mitad que se quedaba fuera cuando
    // se miraba sólo lo que hay en la base de datos.
    const keys = listingMediaKeys(
      {
        imageUrls: listing.images.map((i) => i.url),
        videoUrl: listing.videoUrl,
        videoPosterUrl: listing.videoPosterUrl,
      },
      this.r2.getPublicUrl(''),
    );
    if (keys.length > 0) {
      await this.mediaCleanupQueue.add('purge', { keys, origen: `listing:${listingId}` });
    }
  }

  // ===========================================================================
  // Users (R7.4)
  // ===========================================================================

  async listUsers(query: ListAdminUsersDto) {
    const { status, role, q, ip, order, page = 1, perPage = 24 } = query;
    const where: Prisma.UserWhereInput = {
      ...(status && { status }),
      ...(role && { role }),
      // ÚLTIMA IP (5b) — coincidencia EXACTA. Ver el doc-comment del DTO: un `contains`
      // sobre «10.0.0.1» traería «110.0.0.10», y en una investigación de multicuenta eso
      // no es un falso positivo cualquiera — es señalar a quien no es.
      ...(ip && { lastLoginIp: ip }),
      ...(q && {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
        ],
      }),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: USER_ORDER_BY[order ?? 'last-login-desc'],
        skip: (page - 1) * perPage,
        take: perPage,
        select: {
          id: true,
          name: true,
          email: true,
          slug: true,
          role: true,
          status: true,
          emailVerified: true,
          city: true,
          province: true,
          createdAt: true,
          trusted: true,
          // MODERACIÓN M4 — el backoffice tiene que poder VER quién está marcado,
          // no sólo marcarlo.
          requiresReview: true,
          // ÚLTIMA IP (5b) — el dato que 5a captura, servido a MODERATOR por decisión
          // escrita (`docs/diseno-ultima-ip.md` §6): dato personal, finalidad única de
          // moderación antifraude, sólo la ÚLTIMA y nunca un historial.
          lastLoginAt: true,
          lastLoginIp: true,
          _count: { select: { listings: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total, page, perPage };
  }

  async getUserById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        slug: true,
        role: true,
        status: true,
        emailVerified: true,
        phone: true,
        avatarUrl: true,
        bio: true,
        city: true,
        province: true,
        postalCode: true,
        createdAt: true,
        trusted: true,
        requiresReview: true,
        updatedAt: true,
        // ÚLTIMA IP (5b) — el dato de 5a en la ficha. MODERATOR+, por decisión escrita.
        // Es la IP DEL USUARIO (su último inicio de sesión), no la de `AuditLog`, que es
        // del staff y que 5a sacó de esta misma respuesta. Son dos datos con dos sujetos.
        lastLoginAt: true,
        lastLoginIp: true,
        listings: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            title: true,
            slug: true,
            status: true,
            price: true,
            currency: true,
            priceType: true,
            publishedAt: true,
            createdAt: true,
          },
        },
        reportsReceived: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: {
            reporter: { select: { id: true, name: true, slug: true } },
          },
        },
        // FICHA DE USUARIO U3 — «ver todo». Los reportes que ESTE usuario ha
        // hecho no se mostraban, y dicen tanto como los recibidos: un denunciante
        // compulsivo sólo se ve mirando este lado.
        reportsMade: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            reason: true,
            status: true,
            createdAt: true,
            listingId: true,
            reportedUserId: true,
          },
        },
        // 7b — las dos SIN filtrar por `retiredAt`: el staff ve las retiradas, marcadas,
        // porque es quien puede restaurarlas. Y con `verified`, que es el campo que dice
        // si esa valoración cuenta para la media (la nota que dejó 7a).
        reviewsReceived: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            rating: true,
            comment: true,
            createdAt: true,
            verified: true,
            retiredAt: true,
            retiredReason: true,
            author: { select: { id: true, name: true, slug: true } },
          },
        },
        reviewsAuthored: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            rating: true,
            comment: true,
            createdAt: true,
            verified: true,
            retiredAt: true,
            retiredReason: true,
            target: { select: { id: true, name: true, slug: true } },
          },
        },
        tickets: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { id: true, subject: true, status: true, createdAt: true },
        },
        _count: {
          select: { listings: true, reviewsReceived: true, reportsMade: true, tickets: true },
        },
      },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    /**
     * FICHA DE USUARIO U3 — el HECHO de ser Pro, y sólo el hecho.
     *
     * Se sirve a MODERATOR a propósito: es **información pública** —la insignia
     * Pro está en el perfil público de cualquier vendedor— y al moderador le sirve
     * para entender a quién tiene delante.
     *
     * Lo que NO se sirve aquí es la PROCEDENCIA (pagó / se lo dieron), el
     * vencimiento y el saldo: eso describe una relación comercial y vive en
     * `GET /admin/billing/users/:id`, que es ADMIN. El reparto no es cosmético —
     * el dato no sale por esta puerta. Ver docs/diseno-ficha-usuario.md §7 (D-3).
     */
    const isPro = await this.proStatus.isProActive(id);

    /**
     * ÚLTIMA IP (5a) — AQUÍ SE ARREGLA UNA FUGA, Y NO ERA LA QUE PARECÍA.
     *
     * Esto era un `findMany` propio con `include: { actor }`. Un `include` sin `select`
     * devuelve TODOS los escalares, así que la respuesta llevaba `AuditLog.ip` — mientras
     * `AuditLogService.listForResource` (F1) la excluye con su razón escrita. Dos
     * lectores del mismo historial diciendo cosas distintas.
     *
     * **Y el sujeto de esa IP no es quien se está mirando.** Este `where` pide las
     * acciones en las que el usuario es el OBJETO («actions taken against them»), y
     * `AuditLog.actorId` es quien las EJECUTÓ: siempre staff —es NOT NULL con FK a `User`
     * y «no existe actor sistema» (E1)—. O sea que lo que se filtraba era **la IP del
     * MODERADOR que suspendió, cambió el rol o concedió un Pro**, servida a cualquier
     * otro moderador que abriera la ficha.
     *
     * Por eso la decisión de privacidad de 5a NO la cubre y esto se ARREGLA en vez de
     * bendecirse: `User.lastLoginIp` es del usuario investigado y su finalidad es
     * antifraude; `AuditLog.ip` es del staff y es rastro de seguridad interno — «auditar
     * personas es otra pantalla con otro rol», que es exactamente lo que F1 escribió.
     *
     * El arreglo es usar SU función, no copiar su `select`: un solo lector del historial
     * para las dos fichas. Ver `docs/diseno-ultima-ip.md` §3.
     */
    const auditLogs = await this.auditLog.listForResource('User', id, 20);

    return { ...user, isPro, auditLogs };
  }

  async suspendUser(targetId: string, actorId: string, ip?: string) {
    return this.changeUserStatus(targetId, actorId, UserStatus.SUSPENDED, 'USER_SUSPEND', ip);
  }

  // Reverses a suspension (SUSPENDED → ACTIVE). Accessible to MODERATOR+ADMIN.
  // Throws 400 if the user is not currently SUSPENDED (use reinstateUser for BANNED).
  async unsuspendUser(targetId: string, actorId: string, ip?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: targetId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (user.status !== UserStatus.SUSPENDED) {
      throw new BadRequestException(
        'Solo se pueden reactivar usuarios en estado SUSPENDED. Para BANNED, usa desbanear.',
      );
    }
    return this.changeUserStatus(targetId, actorId, UserStatus.ACTIVE, 'USER_UNSUSPEND', ip);
  }

  async banUser(targetId: string, actorId: string, ip?: string) {
    return this.changeUserStatus(targetId, actorId, UserStatus.BANNED, 'USER_BAN', ip);
  }

  // Reverses a ban (BANNED → ACTIVE). ADMIN-only.
  async reinstateUser(targetId: string, actorId: string, ip?: string) {
    return this.changeUserStatus(targetId, actorId, UserStatus.ACTIVE, 'USER_REINSTATE', ip);
  }

  async changeUserRole(
    targetId: string,
    actorId: string,
    dto: ChangeUserRoleDto,
    ip?: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: targetId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    // INNEGOCIABLE: no se puede degradar a otro ADMIN (diseño §4.2).
    if (user.role === Role.ADMIN) {
      throw new ForbiddenException('No se puede cambiar el rol de un administrador');
    }
    if ((dto.role as Role) === Role.ADMIN) {
      throw new ForbiddenException('No se puede asignar el rol de administrador desde aquí');
    }

    const before = { role: user.role };

    // ROLES R3 — CAMBIAR EL ROL INVALIDA LAS SESIONES DEL AFECTADO.
    //
    // EL DEFECTO QUE CIERRA. El backend ya leía el rol FRESCO de la BD en cada
    // petición (`JwtStrategy.validate`), así que la API nunca estuvo mal. Lo que
    // estaba caducado era la COPIA del rol que el frontend guarda en la cookie de
    // NextAuth, que sólo se escribe en el login (`auth.config.ts`, callback `jwt`:
    // `if (user) { token.role = ... }`). Resultado: a un degradado el middleware
    // le seguía abriendo el backoffice con su rol viejo y la API le respondía 403
    // a todo — veía el panel y no funcionaba nada.
    //
    // EL MOLDE ES EL DE LA CONTRASEÑA, y se replica sin variantes: el mismo
    // `{ increment: 1 }` sobre el mismo campo que usan `resetPassword`,
    // `changePassword` y `setPassword` (auth.service.ts). `JwtStrategy` compara
    // `tokenVersion` contra la BD en cada request, así que todo JWT emitido antes
    // de esta línea muere al instante.
    //
    // POR QUÉ NO SE DEVUELVE UN TOKEN FRESCO, y no es una omisión. El molde tiene
    // dos variantes según quién es el afectado:
    //   · `changePassword`/`setPassword` — el afectado ES el llamante, así que se
    //     le devuelve un `accessToken` nuevo «para que el propio llamante no se
    //     quede desconectado»; mueren sólo sus OTRAS sesiones.
    //   · `resetPassword` — el afectado NO es el llamante (llega con un token de
    //     correo), así que no hay sesión que rescatar: mueren todas.
    // Un cambio de rol lo hace un ADMIN sobre OTRA persona, que no está en esta
    // petición: cae en la segunda variante. Mueren todas sus sesiones y su próxima
    // acción es un 401 → re-login → cookie nueva con el rol nuevo.
    //
    // El 401 lo traduce a re-login `AdminSessionGuard` en el shell de `(admin)`;
    // sin él esto daría una pantalla de «Error 401» en vez de una vuelta al login.
    const updated = await this.prisma.user.update({
      where: { id: targetId },
      data: { role: dto.role, tokenVersion: { increment: 1 } },
      select: { id: true, name: true, email: true, slug: true, role: true, status: true },
    });

    await this.auditLog.log({
      action: 'USER_ROLE_CHANGE',
      actorId,
      resourceType: 'User',
      resourceId: targetId,
      before,
      after: { role: dto.role },
      ip,
    });

    return updated;
  }

  // H8 Bloque E — "Vendedor de confianza": decisión de plataforma, ADMIN-only
  // (ver @Roles en el controller). Independiente de Pro: no se deriva de isProActive
  // ni al revés.
  async setUserTrusted(
    targetId: string,
    actorId: string,
    dto: SetUserTrustedDto,
    ip?: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: targetId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const before = { trusted: user.trusted };

    const updated = await this.prisma.user.update({
      where: { id: targetId },
      data: { trusted: dto.trusted },
      select: { id: true, name: true, email: true, slug: true, role: true, status: true, trusted: true },
    });

    await this.auditLog.log({
      action: dto.trusted ? 'USER_TRUST' : 'USER_UNTRUST',
      actorId,
      resourceType: 'User',
      resourceId: targetId,
      before,
      after: { trusted: dto.trusted },
      ip,
    });

    return updated;
  }

  /**
   * MODERACIÓN M4 — marca a un vendedor para que sus anuncios pasen por revisión.
   *
   * Molde exacto de `setUserTrusted`, incluido el registro en el histórico: quién
   * marcó a quién y cuándo es justo lo que hay que poder reconstruir de una
   * decisión así.
   *
   * NO es «lo contrario de trusted», y por eso son dos campos y dos endpoints: un
   * vendedor puede estar marcado y ser de confianza a la vez, y en ese caso se
   * revisa igual (la marca es específica; la confianza sólo levanta la red
   * genérica de plataforma, y sólo si esa exención está encendida — ver
   * `PreModerationService`).
   */
  async setUserRequiresReview(
    targetId: string,
    actorId: string,
    dto: SetUserRequiresReviewDto,
    ip?: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: targetId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const before = { requiresReview: user.requiresReview };

    const updated = await this.prisma.user.update({
      where: { id: targetId },
      data: { requiresReview: dto.requiresReview },
      select: {
        id: true, name: true, email: true, slug: true, role: true, status: true,
        trusted: true, requiresReview: true,
      },
    });

    await this.auditLog.log({
      action: dto.requiresReview ? 'USER_REQUIRE_REVIEW' : 'USER_UNREQUIRE_REVIEW',
      actorId,
      resourceType: 'User',
      resourceId: targetId,
      before,
      after: { requiresReview: dto.requiresReview },
      ip,
    });

    return updated;
  }

  // ===========================================================================
  // Categories (R7.5)
  // ===========================================================================

  /**
   * PROFUNDIDAD N — RÁFAGA 2. El árbol del backoffice, RECURSIVO.
   *
   * Antes eran raíces + un nivel de `children` con un `select` anidado a mano, y
   * eso hacía que una categoría de nivel 3 fuese INVISIBLE en el panel: existía
   * en la base y no salía por ningún sitio. Ahora se traen todas las filas de
   * una vez (decenas) y el árbol se monta en memoria a cualquier profundidad.
   *
   * La respuesta conserva la MISMA FORMA que antes —`children` anidados,
   * ordenados por `order`— así que un árbol de 2 niveles se sirve exactamente
   * igual que se servía; lo único nuevo es que ahora los hijos también pueden
   * tener hijos.
   *
   * Sigue devolviendo los valores CRUDOS (propios de cada categoría), no los
   * efectivos: el admin edita lo que esta categoría configura, no lo que hereda.
   */
  async getCategories() {
    const filas = await this.prisma.category.findMany({
      orderBy: { order: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        iconUrl: true,
        order: true,
        parentId: true,
        attributeSchema: true,
        allowedListingType: true,
        allowedViews: true,
        defaultView: true,
        allowedPriceUnits: true,
        // MODERACIÓN M1/M5 — la marca de revisión. La ESCRITURA ya existía desde
        // M1 (DTO + updateCategory); sin este campo aquí el backoffice podía
        // encenderla y no volver a verla nunca: el panel no sabía cuál estaba
        // marcada, ni podía avisar de la herencia monótona a los descendientes.
        // Es el valor PROPIO, como el resto (el pliegue lo hace el cliente).
        requiresReview: true,
      },
    });

    type Fila = (typeof filas)[number];
    type Nodo = Fila & { children: Nodo[] };

    const porPadre = new Map<string | null, Fila[]>();
    for (const fila of filas) {
      const lista = porPadre.get(fila.parentId);
      if (lista) lista.push(fila);
      else porPadre.set(fila.parentId, [fila]);
    }

    const montar = (parentId: string | null): Nodo[] =>
      (porPadre.get(parentId) ?? []).map((fila) => ({ ...fila, children: montar(fila.id) }));

    return montar(null);
  }

  /**
   * Valida un tope de card (cardAttribute o wideCardAttribute) POR TIPO, no
   * globalmente: un atributo marcado solo para PRODUCT (o solo SERVICE) solo
   * cuenta en el tope de ESE tipo; uno sin `appliesTo` (aplica a ambos) cuenta
   * en los dos. Así, 2 atributos de producto + 2 de servicio marcados para la
   * card estándar son válidos (4 en total, pero ningún anuncio ve más de 2) —
   * ver «ATRIBUTOS EN CARD — respetar producto/servicio» en docs/estado-tecnico.md.
   */
  private async validateCardAttributeLimitByType(
    ownSchema: AttributeField[],
    parentId: string | null | undefined,
    flag: 'cardAttribute' | 'wideCardAttribute',
    limit: number,
  ): Promise<void> {
    // PROFUNDIDAD N — RÁFAGA 1: el heredado es el PLIEGUE de la cadena del
    // padre, no su schema propio. Sin esto, una categoría de nivel 3 validaría
    // su tope de card sin contar los atributos del abuelo.
    const parentSchema = parentId ? await this.efectivoDe(parentId) : [];
    const effective = resolveEffectiveSchema(ownSchema, parentSchema);
    const counts = countAttributesByType(effective, flag);
    const exceeded = (['PRODUCT', 'SERVICE'] as const).find((type) => counts[type] > limit);
    if (exceeded) {
      const typeLabel = exceeded === 'PRODUCT' ? 'producto' : 'servicio';
      throw new BadRequestException(
        `El schema efectivo tiene ${counts[exceeded]} atributos de tipo ${typeLabel} con ` +
          `${flag}:true pero el máximo permitido es ${limit}.`,
      );
    }
  }

  private async validateCardAttributeLimit(
    ownSchema: AttributeField[],
    parentId: string | null | undefined,
  ): Promise<void> {
    await this.validateCardAttributeLimitByType(ownSchema, parentId, 'cardAttribute', 2);
  }

  /**
   * PROFUNDIDAD N — RÁFAGA 1. Schema efectivo de una categoría YA PERSISTIDA:
   * el pliegue de su cadena. Se usa donde antes se leía el `attributeSchema`
   * propio del padre y se daba por hecho que era su efectivo (cierto solo
   * mientras el padre fuera siempre una raíz).
   */
  private async efectivoDe(categoryId: string): Promise<AttributeField[]> {
    const cadena = await this.categoryTree.getAncestorChain(categoryId);
    return cadena.reduce<AttributeField[]>(
      (acc, nodo) => resolveEffectiveSchema(nodo.attributeSchema, acc),
      [],
    );
  }

  /**
   * A4 (rango numérico) — un atributo NO puede llamarse `X_min`/`X_max` si existe un
   * atributo NUMÉRICO llamado `X` en el mismo ámbito, ni al revés.
   *
   * Por qué: desde A4, `km_min=50000` en la búsqueda significa "km mayor o igual que
   * 50000". Si además existiera un atributo literalmente llamado `km_min`, la misma
   * clave querría decir dos cosas — y el parser, que mira la clave literal primero,
   * resolvería a favor del atributo, dejando el rango de `km` en la sombra sin que
   * nadie se entere. Es la misma clase de problema que `RESERVED_ATTRIBUTE_NAMES`
   * (colisión con un campo core) resuelto en el mismo sitio: la configuración, con un
   * 400 claro al guardar, en vez de un comportamiento raro en tiempo de búsqueda.
   *
   * El ÁMBITO es el que ve el parser al resolver una categoría: propio + padre para
   * una hoja, y propio + hijas para un padre (igual que
   * `getAttributeTypesForCategory`). Se comprueban las dos direcciones — crear el
   * `_min` teniendo el número, y crear el número teniendo el `_min`.
   */
  private async assertNoRangeSuffixCollision(
    ownSchema: AttributeField[],
    categoryId: string | null,
    parentId: string | null | undefined,
  ): Promise<void> {
    // PROFUNDIDAD N — RÁFAGA 2. El ámbito era «padre + hijas directas»; ahora es
    // la CADENA DE ANCESTROS completa + TODOS los descendientes. Es el ámbito
    // que ve el parser al resolver una categoría, y con N niveles ese ámbito
    // llega hasta el bisabuelo y hasta el bisnieto: un `km` numérico en la raíz
    // y un atributo llamado `km_min` en un bisnieto chocarían igual que a un
    // nivel de distancia.
    const vecinos: AttributeField[] = [];

    if (parentId) {
      for (const ancestro of await this.categoryTree.getAncestorChain(parentId)) {
        vecinos.push(...ancestro.attributeSchema);
      }
    }
    if (categoryId) {
      for (const id of await this.categoryTree.getDescendantIds(categoryId)) {
        const nodo = (await this.categoryTree.getAncestorChain(id)).at(-1);
        if (nodo) vecinos.push(...nodo.attributeSchema);
      }
    }

    const todos = [...ownSchema, ...vecinos];
    const numericos = new Set(todos.filter((f) => f.type === 'number').map((f) => f.name));

    for (const campo of todos) {
      for (const sufijo of ['_min', '_max']) {
        if (campo.name.length > sufijo.length && campo.name.endsWith(sufijo)) {
          const base = campo.name.slice(0, -sufijo.length);
          if (numericos.has(base)) {
            throw new BadRequestException(
              `El atributo "${campo.name}" choca con el filtro de rango del atributo numérico ` +
                `"${base}": desde A4, "${base}${sufijo}" en una búsqueda significa el ` +
                `${sufijo === '_min' ? 'mínimo' : 'máximo'} de "${base}". Renombra uno de los dos.`,
            );
          }
        }
      }
    }
  }

  /**
   * RÁFAGA 2 (vista ampliada): mismo mecanismo que validateCardAttributeLimit
   * pero para wideCardAttribute, con un tope de 6 en vez de 2 — la card ancha
   * tiene más espacio que la compacta pero sigue acotada.
   */
  private async validateWideCardAttributeLimit(
    ownSchema: AttributeField[],
    parentId: string | null | undefined,
  ): Promise<void> {
    await this.validateCardAttributeLimitByType(ownSchema, parentId, 'wideCardAttribute', 6);
  }

  /**
   * BUG 2 (auditoría de herencia, parte 2) — el guard de arriba solo mira HACIA
   * ARRIBA (el propio schema efectivo contra el padre). Editar el PADRE nunca
   * comprobaba si el cambio rompía a una HIJA que YA tenía sus propios
   * cardAttribute/wideCardAttribute: el tope es una propiedad del conjunto
   * EFECTIVO (propios + heredados), no de "lo que cada categoría tiene por su
   * cuenta" — confirmado en vivo antes de escribir esto (2 cardAttribute en el
   * padre + 2 ya existentes en una hija se aceptaba sin más, dejando a la hija
   * con 4 en su schema efectivo — visible en la card sin truncar, sin aviso).
   * Mismo mecanismo que validateCardAttributeLimitByType, aplicado en la
   * dirección contraria: por cada hija DIRECTA, se recalcula su schema
   * efectivo con el NUEVO schema propuesto para el padre (no el que ya está
   * persistido) y se valida igual que si fuera la propia hija la que se
   * estuviera guardando.
   */
  private async assertCardAttributeChangeDoesNotBreakChildren(
    categoryId: string,
    newOwnSchema: AttributeField[],
  ): Promise<void> {
    // PROFUNDIDAD N — RÁFAGA 2: DESCENDIENTES, no hijos directos. El tope es una
    // propiedad del schema EFECTIVO, y el efectivo de un bisnieto incluye lo que
    // ponga la raíz. Mirando sólo a las hijas, editar la raíz podía dejar a una
    // nieta con 4 cardAttribute sin que nadie avisara — el mismo defecto que
    // este guard cerró en su día, un nivel más abajo.
    const descendantIds = await this.categoryTree.getDescendantIds(categoryId);
    if (descendantIds.length === 0) return;

    const checks: Array<{ flag: 'cardAttribute' | 'wideCardAttribute'; limit: number }> = [
      { flag: 'cardAttribute', limit: 2 },
      { flag: 'wideCardAttribute', limit: 6 },
    ];

    for (const child of await this.descendientesConSchema(categoryId, newOwnSchema)) {
      const effective = child.efectivo;
      for (const { flag, limit } of checks) {
        const counts = countAttributesByType(effective, flag);
        const exceeded = (['PRODUCT', 'SERVICE'] as const).find((type) => counts[type] > limit);
        if (exceeded) {
          const typeLabel = exceeded === 'PRODUCT' ? 'producto' : 'servicio';
          throw new BadRequestException(
            `No se puede guardar: la subcategoría "${child.name}" quedaría con ${counts[exceeded]} ` +
              `atributos de tipo ${typeLabel} con ${flag}:true (máximo ${limit}) al heredar este cambio.`,
          );
        }
      }
    }
  }

  /**
   * PROFUNDIDAD N — RÁFAGA 2. Cada descendiente de `categoryId` con su schema
   * EFECTIVO recalculado como si `newOwnSchema` ya estuviera guardado.
   *
   * Se pliega la cadena entera (no se fusiona con el padre): el efectivo de un
   * bisnieto depende de los cuatro niveles. Para el nodo que se está editando se
   * usa el schema NUEVO —el que trae el DTO— y no el persistido, que es todo el
   * sentido de este guard: comprobar el cambio ANTES de escribirlo.
   */
  private async descendientesConSchema(
    categoryId: string,
    newOwnSchema: AttributeField[],
  ): Promise<Array<{ name: string; efectivo: AttributeField[] }>> {
    const descendantIds = await this.categoryTree.getDescendantIds(categoryId);
    const salida: Array<{ name: string; efectivo: AttributeField[] }> = [];
    for (const id of descendantIds) {
      const cadena = await this.categoryTree.getAncestorChain(id);
      const efectivo = cadena.reduce<AttributeField[]>(
        (acc, nodo) =>
          resolveEffectiveSchema(nodo.id === categoryId ? newOwnSchema : nodo.attributeSchema, acc),
        [],
      );
      salida.push({ name: cadena[cadena.length - 1].name, efectivo });
    }
    return salida;
  }

  /**
   * RÁFAGA 2 (vistas configurables): valida el estado FINAL (ya fusionado con lo
   * persistido, en el caso de update) de allowedViews/defaultView.
   * `allowedViews: []` es válido siempre (equivale a "no configurado" — el
   * resto de allowedViews:[]+defaultView:null nunca se rechaza). Con al menos
   * una vista permitida, la vista por defecto es obligatoria y debe estar
   * entre ellas — un 400 explícito en vez de auto-corregir en silencio, para
   * que un PATCH inconsistente (p. ej. hecho a mano contra la API) falle alto
   * y claro en vez de guardar un estado a medias.
   */
  private validateViewsConfig(
    finalAllowedViews: ListingViewMode[],
    finalDefaultView: ListingViewMode | null,
  ): void {
    if (finalAllowedViews.length === 0) {
      if (finalDefaultView !== null) {
        throw new BadRequestException(
          'No se puede fijar una vista por defecto sin al menos una vista permitida.',
        );
      }
      return;
    }
    if (finalDefaultView === null || !finalAllowedViews.includes(finalDefaultView)) {
      throw new BadRequestException(
        'La vista por defecto debe estar entre las vistas permitidas.',
      );
    }
  }

  /**
   * Hacia arriba: una política propia no puede CONTRADECIR la que se hereda.
   *
   * PROFUNDIDAD N — HUECO CERRADO. Esto comparaba contra
   * `parent.allowedListingType`, el valor PROPIO del padre. Con dos niveles eso
   * era correcto porque el padre siempre era una raíz y su valor propio ERA su
   * efectivo. Con cuatro deja de serlo, y el fallo es silencioso:
   *
   *   raíz PRODUCT_ONLY → hija BOTH → nieta que declara SERVICE_ONLY
   *
   * La guarda miraba a la hija (BOTH, no contradice) y dejaba pasar. Después
   * `resolveEffectivePolicy` —defensiva a propósito, nunca lanza— conserva la del
   * ancestro. Resultado: el admin guarda SERVICE_ONLY, el panel se lo muestra, y
   * el sistema se comporta como PRODUCT_ONLY. Sin ningún aviso. Ejercido antes de
   * escribir esto.
   *
   * CONTRADECIR vs REFINAR — la distinción que decide qué se rechaza:
   *   · REFINAR (se permite): lo heredado es BOTH y el nodo restringe a un tipo.
   *     Es el caso normal y su declaración SÍ manda.
   *   · REPETIR (se permite): declara lo mismo que ya hereda. Redundante, inocuo.
   *   · CONTRADECIR (se rechaza): lo heredado restringe a un tipo y el nodo
   *     declara el CONTRARIO. Su declaración no se puede cumplir, así que
   *     aceptarla sería guardar una mentira.
   * Es exactamente la misma condición de antes; lo único que cambia es contra QUÉ
   * se compara — y por eso con 1-2 niveles el comportamiento es idéntico.
   *
   * Guard explícito que LANZA; no reutiliza `resolveEffectivePolicy` para decidir
   * (esa es defensiva y nunca lanza, pensada para la lectura), pero sí para
   * calcular lo heredado, que es justo lo que hay que mirar.
   */
  private async assertPolicyConsistentWithAncestors(
    own: ListingTypePolicy,
    parentId: string | null | undefined,
  ): Promise<void> {
    if (!parentId || own === 'BOTH') return;

    const cadena = await this.categoryTree.getAncestorChain(parentId);
    const heredada = cadena.reduce<ListingTypePolicy>(
      (acc, nodo) => resolveEffectivePolicy(nodo.allowedListingType, acc),
      'BOTH',
    );
    if (heredada === 'BOTH' || heredada === own) return;

    // Se nombra el ancestro que IMPONE la política, no el padre inmediato: con
    // varios niveles, «contradice a tu padre» sería falso y llevaría a mirar el
    // sitio equivocado.
    const culpable = [...cadena].reverse().find((n) => n.allowedListingType === heredada);
    throw new BadRequestException(
      `La política "${own}" contradice la política heredada ("${heredada}")` +
        (culpable ? ` de "${culpable.name}"` : '') +
        '. Una subcategoría puede restringir lo que hereda, pero no contradecirlo.',
    );
  }

  /**
   * Hacia abajo: cambiar la política de una categoría con hijos y/o anuncios
   * ya existentes puede volverlos incoherentes. Mismo molde que
   * deleteCategory (conteos exactos, 400 con el número) — rechazar, no
   * avisar ni permitir en silencio. Ensanchar a BOTH nunca rompe nada.
   */
  private async assertPolicyChangeDoesNotBreakChildren(
    categoryId: string,
    newPolicy: ListingTypePolicy,
  ): Promise<void> {
    if (newPolicy === 'BOTH') return;

    // PROFUNDIDAD N — RÁFAGA 2: DESCENDIENTES, no hijos directos. Con 2 niveles
    // eran lo mismo; con N, restringir una raíz a PRODUCT_ONLY no veía a una
    // NIETA configurada como SERVICE_ONLY, ni los anuncios de servicio colgados
    // de ella. La contradicción se guardaba y aparecía después, sin aviso.
    const descendantIds = await this.categoryTree.getDescendantIds(categoryId);
    const children = await this.prisma.category.findMany({
      where: { id: { in: descendantIds } },
      select: { id: true, name: true, allowedListingType: true },
    });

    // La política SÍ es jerárquica (a diferencia de los formatos de precio): un
    // descendiente sólo puede RESTRINGIR dentro de lo que permite su ancestro,
    // nunca contradecirlo. Por eso aquí no hay corte por override — cualquier
    // descendiente con una política incompatible es una contradicción, esté al
    // nivel que esté.
    const contradictingChild = children.find(
      (c) => c.allowedListingType !== 'BOTH' && c.allowedListingType !== newPolicy,
    );
    if (contradictingChild) {
      throw new BadRequestException(
        `No se puede cambiar la política: la subcategoría "${contradictingChild.name}" ya está configurada como ${contradictingChild.allowedListingType}.`,
      );
    }

    // Incluye la propia categoría y TODOS sus descendientes: uno BOTH hereda la
    // nueva restricción del ancestro, así que sus anuncios del tipo prohibido
    // quedarían igual de incoherentes que los de la propia categoría.
    const forbiddenType = newPolicy === 'PRODUCT_ONLY' ? 'SERVICE' : 'PRODUCT';
    const categoryIds = [categoryId, ...descendantIds];
    const count = await this.prisma.listing.count({
      where: { categoryId: { in: categoryIds }, type: forbiddenType },
    });
    if (count > 0) {
      throw new BadRequestException(
        `No se puede cambiar la política: ${count} anuncio(s) de tipo ${forbiddenType} quedarían fuera de la política permitida.`,
      );
    }
  }

  /**
   * Compara dos listas de formatos como CONJUNTOS: reordenar los checkboxes del
   * panel no es un cambio real y no debe disparar el guard (ni sus consultas).
   * Solo se usa para decidir si hace falta validar, nunca para escribir — lo que
   * se persiste es siempre la lista tal cual llega en el DTO.
   */
  private samePriceUnits(a: PriceUnit[], b: PriceUnit[]): boolean {
    if (a.length !== b.length) return false;
    const setB = new Set(b);
    return a.every((u) => setB.has(u));
  }

  /**
   * RP.2 — red de seguridad de los formatos de precio. Mismo molde que
   * assertPolicyChangeDoesNotBreakChildren (conteo exacto, 400 con el número):
   * restringir los formatos de una categoría con anuncios ya publicados podría
   * dejarlos con un formato que su propia categoría ya no admite. Se rechaza el
   * cambio; no se avisa ni se permite en silencio. Es lo que hace que abrir la
   * edición del campo en el admin (esta misma ráfaga) sea seguro.
   *
   * NO hay guarda de coherencia con el PADRE, a diferencia de
   * assertPolicyConsistentWithParent: los formatos se heredan por override
   * total, no por restricción jerárquica, así que una hija con [PER_MONTH] bajo
   * un padre [ONE_TIME] es legítima (Inmobiliaria → Alquiler), no una
   * contradicción. Ver resolveEffectivePriceUnits en category.types.ts.
   */
  private async assertPriceUnitsChangeDoesNotBreakListings(
    categoryId: string,
    newUnits: PriceUnit[],
  ): Promise<void> {
    // Volver a "no configurado" solo puede AMPLIAR lo permitido (se pasa a
    // heredar del padre o al default global), nunca dejar un anuncio fuera.
    if (newUnits.length === 0) return;

    // PROFUNDIDAD N — RÁFAGA 2. Descendientes, PERO NO TODOS: la herencia de
    // formatos es un OVERRIDE TOTAL, así que la propagación se CORTA en el
    // primer descendiente que define los suyos. Ese nodo y toda su rama son
    // inmunes al cambio de un ancestro.
    //
    // Con 2 niveles esto era «las hijas sin config propia». Generalizarlo a un
    // barrido ciego de descendientes sería INCORRECTO en las dos direcciones:
    // bloquearía cambios legítimos por culpa de anuncios que no se ven
    // afectados, y con nietos bajo un padre sin config seguiría sin ver a los
    // que sí lo están.
    const affectedIds = [categoryId, ...(await this.descendientesQueHeredanFormatos(categoryId))];

    const count = await this.prisma.listing.count({
      where: { categoryId: { in: affectedIds }, priceUnit: { notIn: newUnits } },
    });
    if (count > 0) {
      throw new BadRequestException(
        `No se puede cambiar los formatos de precio: ${count} anuncio(s) usan un formato que quedaría fuera de los permitidos.`,
      );
    }
  }

  /**
   * PROFUNDIDAD N — RÁFAGA 2. Los descendientes que REALMENTE heredan los
   * formatos de precio de `categoryId`: se recorre hacia abajo y la rama se
   * corta en cuanto un nodo define `allowedPriceUnits` propios.
   *
   * Ejemplo de por qué el corte importa: Inmobiliaria [ONE_TIME] → Alquiler
   * [PER_MONTH] → Pisos [] → Áticos []. Cambiar los formatos de Inmobiliaria
   * NO afecta a Pisos ni a Áticos: los dos heredan de Alquiler, que tiene los
   * suyos. Un barrido ciego de descendientes los contaría y bloquearía el
   * cambio sin motivo.
   */
  private async descendientesQueHeredanFormatos(categoryId: string): Promise<string[]> {
    const afectados: string[] = [];
    const pendientes = [categoryId];
    while (pendientes.length > 0) {
      const actual = pendientes.pop()!;
      for (const hijo of await this.categoryTree.getChildren(actual)) {
        // Config propia = override total = la rama entera queda fuera del
        // alcance de este cambio, no sólo este nodo.
        if (hijo.allowedPriceUnits.length > 0) continue;
        afectados.push(hijo.id);
        pendientes.push(hijo.id);
      }
    }
    return afectados;
  }

  /**
   * PROFUNDIDAD N — RÁFAGA 1. Guarda de profundidad. SUSTITUYE a
   * `assertParentIsRoot`, que exigía que el padre fuera raíz porque toda la
   * resolución de herencia asumía 2 niveles. Ahora la herencia se pliega sobre
   * la cadena completa (ver `CategoryTreeService`), así que lo que queda no es
   * una limitación de la lógica sino un TOPE DE PRODUCTO: `CATEGORY_MAX_DEPTH`.
   *
   * NO SE BORRA LA GUARDA, SE CAMBIA. Sin tope, el árbol admitiría cualquier
   * profundidad y volvería el problema que `assertParentIsRoot` cerró: nodos que
   * ningún consumidor sabe enseñar. Hoy el frontend modela los niveles con rutas
   * explícitas, así que una categoría más profunda que `CATEGORY_MAX_DEPTH` no
   * tendría URL.
   *
   * UNA SOLA REGLA, a diferencia de `NavService.assertMaxDepth` (el molde), que
   * necesita dos: allí un nodo se puede MOVER de padre y arrastraría a sus hijos
   * por debajo del tope. Aquí el padre se fija al crear y es inmutable
   * (`UpdateCategoryDto` no admite `parentId` — decisión formalizada, ver su
   * comentario), así que comprobar en la creación basta para siempre.
   */
  private async assertMaxDepth(parentId: string | null | undefined): Promise<void> {
    if (!parentId) return; // Nace como raíz: profundidad 1, siempre cabe.

    const cadena = await this.categoryTree.getAncestorChain(parentId);
    if (cadena.length === 0) {
      throw new BadRequestException('La categoría padre no existe');
    }
    // La nueva colgaría un nivel por debajo del padre.
    if (cadena.length + 1 > CATEGORY_MAX_DEPTH) {
      const padre = cadena[cadena.length - 1];
      throw new BadRequestException(
        `No se puede crear: "${padre.name}" ya está en el nivel ${cadena.length} y el árbol de ` +
          `categorías admite ${CATEGORY_MAX_DEPTH} niveles como máximo.`,
      );
    }
  }

  /**
   * A1 (URLs anidadas) — rechaza un slug de categoría RAÍZ que colisione con una ruta
   * estática de primer nivel del frontend (ver RESERVED_ROOT_SLUGS). Una hija queda
   * exenta a propósito: su URL lleva el slug del padre delante (/vehiculos/blog), así
   * que nunca compite con /blog.
   *
   * `isRoot` se pasa explícito en vez de deducirlo aquí porque las dos llamadas lo
   * saben desde sitios distintos: create lo sabe por `dto.parentId`, update por la
   * fila ya persistida (UpdateCategoryDto no permite mover una categoría de padre).
   */
  private assertRootSlugNotReserved(slug: string | undefined, isRoot: boolean): void {
    if (!slug || !isRoot) return;
    if (RESERVED_ROOT_SLUGS.has(slug)) {
      throw new BadRequestException(
        `El slug "${slug}" está reservado por una ruta del sitio: una categoría raíz con ese slug sería inaccesible. Elige otro, o créala como subcategoría.`,
      );
    }
  }

  async createCategory(actorId: string, dto: CreateCategoryDto, ip?: string) {
    await this.assertMaxDepth(dto.parentId);
    this.assertRootSlugNotReserved(dto.slug, !dto.parentId);
    if (dto.attributeSchema) {
      await this.validateCardAttributeLimit(dto.attributeSchema as AttributeField[], dto.parentId);
      await this.validateWideCardAttributeLimit(dto.attributeSchema as AttributeField[], dto.parentId);
      // A4 — sin categoryId todavía (se está creando), así que no hay hijas que mirar.
      await this.assertNoRangeSuffixCollision(
        dto.attributeSchema as AttributeField[],
        null,
        dto.parentId,
      );
    }
    if (dto.allowedListingType !== undefined) {
      await this.assertPolicyConsistentWithAncestors(dto.allowedListingType, dto.parentId);
    }
    this.validateViewsConfig(dto.allowedViews ?? [], dto.defaultView ?? null);
    try {
      const created = await this.prisma.category.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          parentId: dto.parentId,
          iconUrl: dto.iconUrl,
          order: dto.order ?? 0,
          ...(dto.attributeSchema !== undefined && {
            attributeSchema: dto.attributeSchema as Prisma.InputJsonValue,
          }),
          ...(dto.allowedListingType !== undefined && {
            allowedListingType: dto.allowedListingType,
          }),
          // MODERACIÓN M1 — la marca de revisión de esta categoría. Se hereda
          // monótona hacia los descendientes; ver resolveEffectiveRequiresReview.
          ...(dto.requiresReview !== undefined && { requiresReview: dto.requiresReview }),
          ...(dto.allowedViews !== undefined && { allowedViews: dto.allowedViews }),
          ...(dto.defaultView !== undefined && { defaultView: dto.defaultView }),
          // RP.2 — sin guard anti-huérfanos aquí: una categoría recién creada no
          // tiene anuncios todavía, así que ninguna restricción puede dejar a
          // ninguno fuera. El guard solo tiene sentido en updateCategory.
          ...(dto.allowedPriceUnits !== undefined && {
            allowedPriceUnits: dto.allowedPriceUnits,
          }),
        },
      });

      // PROFUNDIDAD N — RÁFAGA 1. El árbol memoizado acaba de quedarse viejo:
      // hay una categoría más. Se invalida AQUÍ, síncronamente, y no solo por el
      // job de abajo, porque el job es asíncrono y la propia respuesta de este
      // POST (o la lectura inmediatamente siguiente en este mismo proceso) ya
      // debe ver la categoría nueva. Antes esto no hacía falta porque cada
      // consulta leía la jerarquía de Postgres cada vez.
      this.categoryTree.invalidate();

      // PROFUNDIDAD N — RÁFAGA 2. REINDEXADO ACOTADO. `categoryPath` es la
      // cadena de ancestros del anuncio, así que colgar una categoría nueva por
      // debajo del segundo nivel alarga el path de todo lo que cuelgue de ella.
      //
      // SÓLO a partir del nivel 3: para 1-2 niveles el path calculado con la
      // cadena es byte-idéntico al que ya está escrito, así que no hay nada que
      // reescribir y no se paga nada. Y sólo la SUBCADENA afectada, nunca el
      // catálogo entero: los anuncios de otras ramas no han cambiado de path.
      //
      // Va a la cola (CLAUDE.md: el trabajo pesado nunca inline en el HTTP).
      // Una categoría recién creada no tiene anuncios todavía; esto cubre el
      // caso real de crear un nivel bajo una rama que YA los tiene por debajo.
      if (dto.parentId) {
        const profundidad = await this.categoryTree.getDepth(created.id);
        if (profundidad >= 3) {
          await this.indexingQueue.add('reindex-category-subtree', { categoryId: created.id });
        }
      }

      await this.auditLog.log({
        action: 'CATEGORY_CREATE',
        actorId,
        resourceType: 'Category',
        resourceId: created.id,
        after: { name: created.name, slug: created.slug },
        ip,
      });

      if (dto.attributeSchema !== undefined) {
        await this.indexingQueue.add('refresh-filterable-attributes', {});
      }

      return created;
    } catch (e) {
      if (isP2002(e)) {
        throw new ConflictException('Ya existe una categoría con ese slug');
      }
      throw e;
    }
  }

  async updateCategory(
    id: string,
    actorId: string,
    dto: UpdateCategoryDto,
    ip?: string,
  ) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('Categoría no encontrada');

    // UpdateCategoryDto no admite `parentId`, así que la condición raíz/hija no puede
    // cambiar en este PATCH: la de la fila persistida es la definitiva.
    this.assertRootSlugNotReserved(dto.slug, category.parentId === null);

    if (dto.attributeSchema) {
      await this.validateCardAttributeLimit(
        dto.attributeSchema as AttributeField[],
        category.parentId,
      );
      await this.validateWideCardAttributeLimit(
        dto.attributeSchema as AttributeField[],
        category.parentId,
      );
      // BUG 2 — la validación de arriba solo mira hacia el padre; esta mira
      // hacia las hijas (si las hay) con el schema NUEVO que se está guardando.
      await this.assertCardAttributeChangeDoesNotBreakChildren(id, dto.attributeSchema as AttributeField[]);
      // A4 — aquí SÍ hay id, así que la colisión se mira en las dos direcciones:
      // contra el padre y contra las hijas.
      await this.assertNoRangeSuffixCollision(
        dto.attributeSchema as AttributeField[],
        id,
        category.parentId,
      );
    }

    if (dto.allowedListingType !== undefined) {
      await this.assertPolicyConsistentWithAncestors(dto.allowedListingType, category.parentId);
      // Solo se consulta hijos/anuncios (coste extra) cuando la política REALMENTE
      // cambia respecto a la ya persistida — editar nombre/schema sin tocar la
      // política no paga este coste.
      if (dto.allowedListingType !== category.allowedListingType) {
        await this.assertPolicyChangeDoesNotBreakChildren(id, dto.allowedListingType);
      }
    }

    // RÁFAGA 2 — valida el estado FINAL (lo que ya había + lo que este PATCH cambia),
    // no solo lo que llega en el body: un PATCH que solo toca `defaultView` debe
    // seguir siendo válido contra el `allowedViews` ya persistido, y viceversa.
    // Caso especial: vaciar allowedViews (→ []) sin tocar defaultView explícitamente
    // AUTO-LIMPIA defaultView a null en vez de dejarlo huérfano apuntando a una vista
    // que ya no está permitida — "volver a no configurado" debe limpiar el par entero.
    const defaultViewToWrite: ListingViewMode | null | undefined =
      dto.allowedViews !== undefined && dto.allowedViews.length === 0 && dto.defaultView === undefined
        ? null
        : dto.defaultView;
    if (dto.allowedViews !== undefined || defaultViewToWrite !== undefined) {
      this.validateViewsConfig(
        dto.allowedViews ?? category.allowedViews,
        defaultViewToWrite !== undefined ? defaultViewToWrite : category.defaultView,
      );
    }

    // RP.2 — formatos de precio: igual que con allowedListingType, solo se paga
    // el coste de consultar hijas/anuncios cuando la lista CAMBIA de verdad
    // respecto a la persistida (editar el nombre o el schema no lo paga).
    if (
      dto.allowedPriceUnits !== undefined &&
      !this.samePriceUnits(dto.allowedPriceUnits, category.allowedPriceUnits)
    ) {
      await this.assertPriceUnitsChangeDoesNotBreakListings(id, dto.allowedPriceUnits);
    }

    const before = { name: category.name, slug: category.slug, order: category.order };

    try {
      const updated = await this.prisma.category.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.slug !== undefined && { slug: dto.slug }),
          ...(dto.iconUrl !== undefined && { iconUrl: dto.iconUrl }),
          ...(dto.order !== undefined && { order: dto.order }),
          ...(dto.attributeSchema !== undefined && {
            attributeSchema: dto.attributeSchema as Prisma.InputJsonValue,
          }),
          ...(dto.allowedListingType !== undefined && {
            allowedListingType: dto.allowedListingType,
          }),
          // MODERACIÓN M1 — la marca de revisión de esta categoría. Se hereda
          // monótona hacia los descendientes; ver resolveEffectiveRequiresReview.
          ...(dto.requiresReview !== undefined && { requiresReview: dto.requiresReview }),
          ...(dto.allowedViews !== undefined && { allowedViews: dto.allowedViews }),
          ...(defaultViewToWrite !== undefined && { defaultView: defaultViewToWrite }),
          ...(dto.allowedPriceUnits !== undefined && {
            allowedPriceUnits: dto.allowedPriceUnits,
          }),
        },
      });

      // PROFUNDIDAD N — RÁFAGA 1: mismo motivo que en createCategory. Aquí
      // además puede haber cambiado el `attributeSchema`, que es justo lo que
      // las 5 resoluciones pliegan.
      this.categoryTree.invalidate();

      await this.auditLog.log({
        action: 'CATEGORY_EDIT',
        actorId,
        resourceType: 'Category',
        resourceId: id,
        before,
        after: { name: updated.name, slug: updated.slug, order: updated.order },
        ip,
      });

      if (dto.attributeSchema !== undefined) {
        await this.indexingQueue.add('refresh-filterable-attributes', {});

        // PUERTA — RÁFAGA 2. EL DISPARADOR DEL MARCADO.
        //
        // Éste es el caso que el mapa (§3.1) documentó como SILENCIOSO y que
        // ninguna guarda cubre: renombrar un atributo, borrarlo, marcarlo como
        // requerido o quitarle opciones a un select deja anuncios ya publicados
        // fuera de norma y hoy no pasa absolutamente nada. Las otras guardas
        // (tipo, formatos de precio) siguen RECHAZANDO el cambio como siempre —
        // convertirlas en marcado es decisión de otro proyecto, no de éste.
        //
        // Se revisa TODA LA DESCENDENCIA, no sólo esta categoría: el schema se
        // hereda, así que tocar una raíz cambia el efectivo de sus bisnietos.
        // A la cola, por lo mismo que el resto del trabajo pesado.
        await this.revalidationQueue.add(MARK_STALE_JOB, { categoryId: id });
      }

      return updated;
    } catch (e) {
      if (isP2002(e)) {
        throw new ConflictException('Ya existe una categoría con ese slug');
      }
      throw e;
    }
  }

  async reorderCategories(
    actorId: string,
    dto: ReorderCategoriesDto,
    ip?: string,
  ) {
    await this.prisma.$transaction(
      dto.items.map(({ id, order }) =>
        this.prisma.category.update({ where: { id }, data: { order } }),
      ),
    );

    await this.auditLog.log({
      action: 'CATEGORY_REORDER',
      actorId,
      resourceType: 'Category',
      resourceId: 'batch',
      after: { items: dto.items as unknown as Prisma.InputJsonValue },
      ip,
    });
  }

  async getSearchableAttributeKeys(): Promise<{ keys: readonly string[] }> {
    const attributeTypes = await this.attributesResolver.getAttributeTypes();
    return { keys: [...attributeTypes.keys()] };
  }

  // Cuenta cuántos anuncios de una categoría tienen datos bajo `key` en su
  // JSON `attributes` (operador jsonb `?` = existencia de clave de nivel
  // superior). Usado por el editor de atributos para avisar antes de
  // renombrar una key con datos existentes (no migra nada, solo informa).
  async getAttributeUsage(categoryId: string, key: string): Promise<{ count: number }> {
    const category = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) throw new NotFoundException('Categoría no encontrada');

    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count
      FROM "Listing"
      WHERE "categoryId" = ${categoryId}
        AND "attributes" ? ${key}
    `;
    return { count: Number(rows[0]?.count ?? 0) };
  }

  async deleteCategory(id: string, actorId: string, ip?: string) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('Categoría no encontrada');

    // Cuenta TODOS los anuncios de la categoría, sin filtrar por status. La
    // constraint física Listing_categoryId_fkey es RESTRICT sobre cualquier
    // Listing (no solo ACTIVE); si aquí solo se contaran los ACTIVE, una
    // categoría con anuncios DRAFT/SOLD/EXPIRED/etc. pasaría este chequeo y el
    // DELETE físico posterior fallaría con un 500 sin controlar (RESTRICT de
    // Postgres) en vez de este 400 legible.
    // Mismo chequeo que totalListings/children: SponsoredAd.categoryId también
    // es RESTRICT (H6.6) — sin este chequeo el DELETE físico fallaría con un
    // 500 sin controlar en vez de este 400 legible.
    const [totalListings, children, sponsoredAds] = await this.prisma.$transaction([
      this.prisma.listing.count({ where: { categoryId: id } }),
      this.prisma.category.count({ where: { parentId: id } }),
      this.prisma.sponsoredAd.count({ where: { categoryId: id } }),
    ]);

    if (totalListings > 0) {
      throw new BadRequestException(
        `No se puede eliminar: la categoría tiene ${totalListings} anuncio(s)`,
      );
    }
    if (children > 0) {
      throw new BadRequestException(
        `No se puede eliminar: la categoría tiene ${children} subcategoría(s)`,
      );
    }
    if (sponsoredAds > 0) {
      throw new BadRequestException(
        `No se puede eliminar: la categoría tiene ${sponsoredAds} patrocinado(s)`,
      );
    }

    await this.prisma.category.delete({ where: { id } });

    // PROFUNDIDAD N — RÁFAGA 1: mismo motivo que create/update.
    this.categoryTree.invalidate();

    await this.auditLog.log({
      action: 'CATEGORY_DELETE',
      actorId,
      resourceType: 'Category',
      resourceId: id,
      before: { name: category.name, slug: category.slug },
      ip,
    });
  }

  // ===========================================================================
  // Settings (R7.5)
  // ===========================================================================

  /**
   * TODA clave del whitelist sale aquí, tenga fila o no. Las que no la tienen se
   * devuelven con su default y `configured: false`.
   *
   * Antes solo salían las filas existentes, y el editor del backoffice hacía
   * `if (!setting) return null` — así que las tres claves que nacen sin fila
   * (maxTagsPerListing, supportEmail, ticketAutoCloseWindowDays) eran invisibles.
   * Con el PATCH ya arreglado a upsert, lo único que faltaba era que el editor
   * supiera que existen y con qué valor pintarlas.
   *
   * Aditivo: las filas reales salen exactamente igual que antes (mismos campos,
   * mismo orden por clave); lo nuevo son las entradas sintéticas y el flag.
   */
  /**
   * PUNTO 6 · RÁFAGA B — EL CONTADOR CON EL QUE SE DECIDE UN ASCENSO.
   *
   * ─── LO QUE ES, Y LO QUE NO ES ───────────────────────────────────────────────────────
   *
   * Devuelve, por detector, su modo y DOS RECUENTOS EN BRUTO:
   *
   *   · `listings`   — cuántos anuncios tienen al menos una detección suya. Es la magnitud
   *                    que corresponde a la decisión: «a cuántos anuncios afectaría
   *                    ascender esto».
   *   · `detections` — cuántos hallazgos en total. Un detector que dispara 50 veces sobre 3
   *                    anuncios no es lo mismo que 50 sobre 50, y con un solo número no se
   *                    distingue.
   *
   * **NINGUNO DE LOS DOS ES UNA TASA DE FALSOS POSITIVOS, y llamarlo así sería mentir.**
   * Medirla exige que alguien juzgue cada detección —«esto era un teléfono de verdad» /
   * «esto era una referencia»—, y eso es un veredicto por hallazgo: otro modelo, propuesto
   * como opcional y fuera de esta ráfaga.
   *
   * Lo que este contador da de verdad es una MAGNITUD y una puerta al banco de pruebas: el
   * admin ve que `PHONE` dispara en 340 anuncios, filtra la lista por ese detector, abre
   * veinte y ve con sus ojos cuántos eran ruido. Es poco y es honesto. Un porcentaje con
   * decimales sacado de un recuento convencería más de lo que mide, que es exactamente el
   * fallo que un dato de moderación no puede permitirse.
   *
   * NO SE DEVUELVE NINGÚN PORCENTAJE, y no por olvido: no hay ninguno que calcular sin
   * inventarse el denominador.
   */
  async getDetectionStats() {
    const [porDetector, anuncios, modosAjuste] = await Promise.all([
      this.prisma.listingDetection.groupBy({ by: ['detector'], _count: { _all: true } }),
      // `distinct` sobre `listingId` — «anuncios con al menos una», no «hallazgos».
      this.prisma.listingDetection.findMany({
        distinct: ['listingId', 'detector'],
        select: { detector: true },
      }),
      this.prisma.setting.findUnique({
        where: { key: DETECTION_MODES_SETTING },
        select: { value: true },
      }),
    ]);

    const modos = parseDetectionModes(modosAjuste?.value);
    const hallazgos = new Map(porDetector.map((f) => [f.detector, f._count._all]));
    const conAnuncios = new Map<string, number>();
    for (const fila of anuncios) {
      conAnuncios.set(fila.detector, (conAnuncios.get(fila.detector) ?? 0) + 1);
    }

    // Los TRES siempre, también los que no han disparado nunca: un detector ausente de la
    // lista se leería como «no existe» en vez de como «no ha encontrado nada».
    return (Object.keys(modos) as DetectorId[]).map((detector) => ({
      detector,
      mode: modos[detector],
      listings: conAnuncios.get(detector) ?? 0,
      detections: hallazgos.get(detector) ?? 0,
    }));
  }

  async getSettings() {
    const filas = await this.prisma.setting.findMany({ orderBy: { key: 'asc' } });
    const conFila = new Set(filas.map((f) => f.key));

    const sinFila = SETTING_KEYS.filter((k) => !conFila.has(k)).map((key) => ({
      key,
      value: SETTING_DEFAULTS[key] ?? null,
      // Nunca se ha guardado, así que no hay fecha que enseñar. El front pinta
      // "Sin configurar" en vez de una fecha inventada.
      updatedAt: null,
      updatedById: null,
      configured: false,
    }));

    return [...filas.map((f) => ({ ...f, configured: true })), ...sinFila].sort((a, b) =>
      a.key.localeCompare(b.key),
    );
  }

  /**
   * PUERTA regla #1 — LA INVARIANTE ENTRE LOS DOS LÍMITES: el tope TOTAL tiene
   * que ser mayor que el de ACTIVOS, en cada plan.
   *
   * Si no lo fuera, el sistema se contradice: el tope de activos prometería
   * plazas de escaparate que el tope total impide siquiera crear. No es una
   * hipótesis remota — este repo ya tiene la cicatriz del caso gemelo, cuando
   * `freeActiveListingLimit` podía superar al de Pro y /planes acababa vendiendo
   * como ventaja algo que el plan gratuito daba mejor (ver
   * `planes-limite-anuncios.e2e-spec.ts`). Aquello se descubrió a posteriori;
   * esto se cierra al escribirlo.
   *
   * SE COMPRUEBA EN LAS DOS DIRECCIONES —al subir el de activos y al bajar el
   * total— porque la incoherencia se puede fabricar por cualquiera de los dos
   * lados, y una guarda que sólo mira uno es media guarda.
   *
   * Contra el valor EFECTIVO del otro (su fila, o su default si no la tiene): es
   * el que va a aplicarse de verdad, y comparar contra «no configurado» dejaría
   * pasar cruces reales.
   */
  private async assertLimitesCoherentes(key: string, valor: unknown): Promise<void> {
    const PAREJAS: Record<string, { activos: string; total: string; plan: string }> = {
      [FREE_ACTIVE_LIMIT_SETTING]: { activos: FREE_ACTIVE_LIMIT_SETTING, total: FREE_TOTAL_LIMIT_SETTING, plan: 'gratuito' },
      [FREE_TOTAL_LIMIT_SETTING]: { activos: FREE_ACTIVE_LIMIT_SETTING, total: FREE_TOTAL_LIMIT_SETTING, plan: 'gratuito' },
      [PRO_ACTIVE_LIMIT_SETTING]: { activos: PRO_ACTIVE_LIMIT_SETTING, total: PRO_TOTAL_LIMIT_SETTING, plan: 'Pro' },
      [PRO_TOTAL_LIMIT_SETTING]: { activos: PRO_ACTIVE_LIMIT_SETTING, total: PRO_TOTAL_LIMIT_SETTING, plan: 'Pro' },
    };
    const pareja = PAREJAS[key];
    if (!pareja) return;

    const nuevo = Number(valor);
    // Un valor no numérico no es cosa de esta guarda: lo rechaza (o lo tolera) la
    // validación de tipo que corre justo antes.
    if (!Number.isFinite(nuevo)) return;

    const esElTotal = key === pareja.total;
    const otraClave = esElTotal ? pareja.activos : pareja.total;
    const otraFila = await this.prisma.setting.findUnique({ where: { key: otraClave } });
    const porDefecto = DEFAULTS_DE_LIMITE[otraClave];
    const otro = otraFila ? Number(otraFila.value) : porDefecto;

    const activos = esElTotal ? otro : nuevo;
    const total = esElTotal ? nuevo : otro;
    if (total > activos) return;

    throw new BadRequestException(
      `El tope TOTAL del plan ${pareja.plan} (${total}) tiene que ser mayor que el de anuncios ` +
        `activos (${activos}): si no, el plan promete plazas de escaparate que no se pueden ` +
        'llegar a crear.',
    );
  }

  /**
   * PUERTA regla #3 — LA INVARIANTE DE LAS FOTOS: el mínimo no puede superar al
   * máximo.
   *
   * Un mínimo de 5 con un máximo de 3 dejaría el sistema pidiendo algo imposible:
   * ningún anuncio podría publicarse jamás, y el vendedor recibiría un «añade al
   * menos 5 fotos» del que no hay salida porque el propio sistema le impide subir
   * más de 3. Mismo criterio que la invariante `total > activos` de la regla #1,
   * con una diferencia: aquí IGUALES SÍ VALEN (min 3 y max 3 significa
   * «exactamente tres fotos», que es una configuración legítima).
   *
   * Se comprueba en las dos direcciones, al subir el mínimo y al bajar el máximo,
   * porque la incoherencia se fabrica igual de fácil por cualquiera de los dos
   * lados. Y contra el valor EFECTIVO del otro —su fila o su defecto—, que es el
   * que se va a aplicar de verdad.
   */
  private async assertFotosCoherentes(key: string, valor: unknown): Promise<void> {
    if (key !== MAX_PHOTOS_SETTING && key !== MIN_PHOTOS_SETTING) return;

    const nuevo = Number(valor);
    if (!Number.isFinite(nuevo)) return;

    const esElMaximo = key === MAX_PHOTOS_SETTING;
    const otraClave = esElMaximo ? MIN_PHOTOS_SETTING : MAX_PHOTOS_SETTING;
    const otraFila = await this.prisma.setting.findUnique({ where: { key: otraClave } });
    const otroValor = Number(otraFila?.value);
    const otro = Number.isFinite(otroValor) && otroValor > 0
      ? otroValor
      : (esElMaximo ? DEFAULT_MIN_PHOTOS : DEFAULT_MAX_PHOTOS);

    const min = esElMaximo ? otro : nuevo;
    const max = esElMaximo ? nuevo : otro;
    if (min <= max) return;

    throw new BadRequestException(
      `El mínimo de fotos (${min}) no puede superar al máximo (${max}): ningún anuncio ` +
        'podría publicarse, porque el propio sistema impediría subir las que se le exigen.',
    );
  }

  async updateSetting(
    key: string,
    actorId: string,
    dto: UpdateSettingDto,
    ip?: string,
  ) {
    if (!(SETTING_KEYS as readonly string[]).includes(key)) {
      throw new BadRequestException(
        `Clave '${key}' no permitida. Claves válidas: ${SETTING_KEYS.join(', ')}`,
      );
    }

    if (POSITIVE_INT_SETTING_KEYS.includes(key)) {
      const value = dto.value;
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
        throw new BadRequestException(
          `'${key}' debe ser un número entero mayor o igual a 1.`,
        );
      }
    }

    await this.assertLimitesCoherentes(key, dto.value);
    await this.assertFotosCoherentes(key, dto.value);

    if (PERCENT_SETTING_KEYS.includes(key)) {
      const value = dto.value;
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100) {
        throw new BadRequestException(
          `'${key}' debe ser un número entero entre 0 y 100.`,
        );
      }
    }

    // UPSERT, no update: varias claves del whitelist nacen A PROPÓSITO sin fila
    // ("sin configurar" → el default de lectura), y con findUnique+404 eran
    // ineditables para siempre — catch-22: para editarlas la fila debía existir, y
    // para que existiera había que editarlas. Afectaba a maxTagsPerListing,
    // supportEmail y ticketAutoCloseWindowDays.
    //
    // Esto NO relaja nada: el whitelist de arriba sigue siendo la única puerta y ya
    // ha rechazado con 400 cualquier clave ajena, así que el upsert nunca puede
    // crear una fila arbitraria. Las validaciones por-clave también van ANTES, de
    // modo que un valor inválido se rechaza igual exista la fila o no.
    const setting = await this.prisma.setting.findUnique({ where: { key } });

    // Mismo shape en los dos caminos; `value: null` es "no había fila todavía".
    const before = { value: setting?.value ?? null } as unknown as Prisma.InputJsonValue;
    const after = { value: dto.value } as unknown as Prisma.InputJsonValue;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.setting.upsert({
        where: { key },
        // `updatedById` también en el create: quien crea la fila queda registrado
        // igual que quien la modifica.
        create: {
          key,
          value: dto.value as Prisma.InputJsonValue,
          updatedById: actorId,
        },
        update: {
          value: dto.value as Prisma.InputJsonValue,
          updatedById: actorId,
        },
      });

      await this.auditLog.log(
        {
          action: 'SETTING_UPDATE',
          actorId,
          resourceType: 'Setting',
          resourceId: key,
          before,
          after,
          ip,
        },
        tx,
      );

      return updated;
    });
  }

  // ===========================================================================
  // Stats dashboard (R7.5)
  // ===========================================================================

  async getStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      listingsActive,
      listingsPendingReview,
      listingsPublishedToday,
      usersTotal,
      usersNewToday,
      reportsPending,
      conversationsTotal,
    ] = await this.prisma.$transaction([
      this.prisma.listing.count({ where: { status: ListingStatus.ACTIVE } }),
      this.prisma.listing.count({ where: { status: ListingStatus.PENDING_REVIEW } }),
      this.prisma.listing.count({
        where: { status: ListingStatus.ACTIVE, publishedAt: { gte: today } },
      }),
      this.prisma.user.count(),
      this.prisma.user.count({ where: { createdAt: { gte: today } } }),
      this.prisma.report.count({ where: { status: ReportStatus.PENDING } }),
      this.prisma.conversation.count(),
    ]);

    let search: { totalDocuments: number; isIndexing: boolean } | null = null;
    try {
      const meiliStats = await this.meili.client
        .index(LISTINGS_INDEX)
        .getStats();
      search = {
        totalDocuments: meiliStats.numberOfDocuments,
        isIndexing: meiliStats.isIndexing,
      };
    } catch {
      // Meilisearch unavailable — dashboard still functional without search stats.
    }

    return {
      listings: {
        active: listingsActive,
        pendingReview: listingsPendingReview,
        publishedToday: listingsPublishedToday,
      },
      users: {
        total: usersTotal,
        newToday: usersNewToday,
      },
      moderation: {
        reportsPending,
      },
      conversations: {
        total: conversationsTotal,
      },
      search,
    };
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  private async changeUserStatus(
    targetId: string,
    actorId: string,
    newStatus: UserStatus,
    action: string,
    ip?: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: targetId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const before = { status: user.status };

    const updated = await this.prisma.user.update({
      where: { id: targetId },
      data: { status: newStatus },
      select: { id: true, name: true, email: true, slug: true, role: true, status: true },
    });

    await this.auditLog.log({
      action,
      actorId,
      resourceType: 'User',
      resourceId: targetId,
      before,
      after: { status: newStatus },
      ip,
    });

    return updated;
  }
}
