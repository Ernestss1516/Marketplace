import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { LISTING_CACHE_PATTERN, listingCacheKey } from '../../infra/redis/cache-keys';
import { RateLimitService } from '../../infra/redis/rate-limit.service';
import {
  PHONE_REVEAL_LIMIT_IP_PER_HOUR,
  PHONE_REVEAL_LIMIT_USER_PER_HOUR,
  PHONE_REVEAL_WINDOW_SECONDS,
} from './listing-phone.constants';
import { EntitlementType, Prisma } from '@prisma/client';
import type { Deal, Listing, ListingStatus } from '@prisma/client';
import {
  QUEUE_INDEXING,
  QUEUE_MEDIA_CLEANUP,
  QUEUE_NOTIFICATIONS,
} from '../../infra/queue/queue.constants';
import { R2Service } from '../../infra/r2/r2.service';
import { listingMediaKeys } from '../../infra/r2/media-keys';
import { NOTIFICATION_JOB, SendReviewRequestEmailData } from '../../infra/queue/notification.types';
import { isP2002 } from '../../common/prisma/is-p2002';
import { CUENTA_EN_ESCAPARATE } from '../users/account-visibility';
import { ExpirationService } from '../expiration/expiration.service';
import { EntitlementService } from '../billing/entitlement.service';
// UXV.1 (A2) — la ventana de cooldown del bump se define en billing (que es quien la
// aplica) y se sirve YA RESUELTA desde aquí. La dirección del import respeta la
// dependencia existente ListingsModule → BillingModule.
import { nextBumpAt } from '../billing/bump-cooldown';
// FUGA DE FAVORITOS — «lo que una tarjeta puede ver» ya no es privado de este servicio: era
// justamente lo que la undécima lista (`GET /favorites`) no podía reutilizar, y por eso servía
// la fila cruda con `phone` dentro. Ver listing-summary.ts.
import {
  LISTING_OWNER_SELECT,
  LISTING_PUBLIC_SELECT,
  SELECT_SUMMARY,
  attachSellerRatings,
  toOwnerListing,
  toPublicListing,
  toSummary,
} from './listing-summary';
import { ListingDetectionsService } from '../moderation/detection/listing-detections.service';
import { computeCtr } from './listing-ctr';
import { LIKE_RATIO_MIN_VIEWS, ratioWithMinSample } from './sample-threshold';
import { camposDeTelefono } from '../moderation/detection/phone-format';
import { PreModerationService } from '../moderation/pre-moderation.service';
import { ListingActivationService } from '../listing-activation/listing-activation.service';
import { MessagingService } from '../messaging/messaging.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ReviewsService } from '../reviews/reviews.service';
import { TagsService } from '../tags/tags.service';
import {
  AttributeField,
  resolveEffectivePolicy,
  isListingTypeAllowed,
  resolveEffectivePriceUnits,
  isPriceUnitAllowed,
} from '../categories/category.types';
// PUERTA — RÁFAGA 2: el QUÉ de los tres validadores, ahora compartido con la
// puerta y con el comando de medición. Ver la nota sobre los envoltorios abajo.
import {
  applicableSchemaFor,
  missingRequiredNames,
  unknownAttributeKeys,
  invalidValueIssues,
  linkedSelectIssues,
} from '../categories/attribute-validation';
import { CategoryTreeService, type CategoryNode } from '../categories/category-tree.service';
import { ListingGateService } from '../listing-gate/listing-gate.service';
import { RevalidationService } from '../listing-gate/revalidation.service';
import { unicoMotivo } from '../listing-gate/listing-gate.exception';
import { EMAIL_NOT_VERIFIED_CODE } from '../listing-gate/rules/email-verified.rule';
import type { GateReason } from '../listing-gate/listing-gate.types';
import { AttributeCheckService } from '../listing-gate/attribute-check.service';
import { PhotoLimitsService } from '../listing-gate/photo-limits.service';
import type { ListingTypePolicy, PriceUnit } from '@prisma/client';
// ETIQUETA INTERNA (P1) — la única transición automática del triaje, en un
// fichero puro para poder probar sus tres ramas sin montar el servicio.
import { triageAfterOwnerEdit } from './listing-triage';
// P3a — las validaciones de campos, compartidas con el camino del staff.
import { ListingEditValidationService } from './listing-edit-validation.service';
import { ListingImagesService } from './listing-images.service';
import { ListingOwnerActivityService } from './listing-owner-activity.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { MyListingsQueryDto } from './dto/my-listings-query.dto';
import { CloseDealDto } from './dto/close-deal.dto';

/** Ventana para deshacer un Deal — mismo criterio que el plazo de edición/borrado de Review. */
const DEAL_UNDO_WINDOW_MS = 72 * 60 * 60 * 1000;

const SELECT_CONTACT = { id: true, name: true, slug: true, avatarUrl: true } as const;

/** Cap on slug-collision retries — high enough that exhausting it means something is very wrong, not bad luck. */
const MAX_SLUG_ATTEMPTS = 5;

const CACHE_TTL = 60 * 5;
// UXV.1 (A2) — el formato de la clave se movió a infra/redis/cache-keys.ts: ahora
// esta caché también la invalida BillingService.bump, y ninguno de los dos módulos
// puede importar del otro sin invertir la dirección ListingsModule → BillingModule.
const cacheKey = listingCacheKey;

/**
 * FUGA DE LA FICHA PÚBLICA — AQUÍ ESTABA `LISTING_INCLUDE`, y aquí ya no está.
 *
 * Era un `include` con las cuatro relaciones y ningún `select` de escalares, o sea la FILA
 * ENTERA. La defensa era un destructuring de DOS campos (`phone`, `tags`) sobre un payload
 * de cuarenta, en el endpoint más expuesto que tiene la plataforma. Salían por ahí, sin
 * sesión: `phoneNormalized` (el MISMO teléfono que `phone` acababa de filtrar, por la
 * columna hermana), `lastOwnerIp`, `lastOwnerInteractionAt`, `triage`, `watched` y
 * `needsRevalidation`.
 *
 * Lo sustituyen DOS listas blancas explícitas —`LISTING_PUBLIC_SELECT` (visitante) y
 * `LISTING_OWNER_SELECT` (dueño)— en `listing-summary.ts`, junto a la de la tarjeta. Ver
 * docs/auditoria-pro-video.md, «Hallazgo NUEVO y MÁS GRAVE».
 */

@Injectable()
export class ListingsService implements OnModuleInit {
  private readonly logger = new Logger(ListingsService.name);

  /**
   * PURGA DE LAS FICHAS CACHEADAS AL ARRANCAR.
   *
   * Estrechar la consulta no arregla lo que Redis ya tiene escrito. Los blobs guardados
   * antes de este cambio llevan dentro `phoneNormalized`, `lastOwnerIp`, `triage` y
   * `watched`, y `findBySlug` los sirve TAL CUAL cuando hay acierto de caché — así que sin
   * esto la fuga habría seguido viva hasta cinco minutos después del despliegue, sobre
   * fichas que son justo las más visitadas (las que están en caché son las que alguien
   * acaba de pedir).
   *
   * SE HACE SOLO, y no es un paso documentado del despliegue: un paso manual es un paso que
   * alguien olvida, y este hay que darlo en CADA despliegue que estreche el payload
   * público, no solo en éste.
   *
   * ES BARATO: el TTL de la ficha son 5 minutos, así que la caché que se tira es la de los
   * últimos cinco minutos y se repuebla a demanda. `scanStream` (cursor) y no `KEYS`
   * (bloqueante) para no parar Redis mientras recorre el espacio de claves.
   *
   * Si el borrado falla, se registra y se sigue: arrancar la API importa más que la purga,
   * y el TTL acaba haciendo el trabajo de todas formas.
   */
  async onModuleInit(): Promise<void> {
    try {
      let borradas = 0;
      const stream = this.redis.client.scanStream({ match: LISTING_CACHE_PATTERN, count: 100 });
      for await (const claves of stream as AsyncIterable<string[]>) {
        if (claves.length === 0) continue;
        borradas += await this.redis.client.del(...claves);
      }
      if (borradas > 0) {
        this.logger.log(`Caché de fichas purgada al arrancar: ${borradas} claves`);
      }
    } catch (err) {
      this.logger.warn(`No se pudo purgar la caché de fichas al arrancar: ${String(err)}`);
    }
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly rateLimit: RateLimitService,
    @InjectQueue(QUEUE_INDEXING) private readonly indexingQueue: Queue,
    @InjectQueue(QUEUE_NOTIFICATIONS) private readonly notificationQueue: Queue,
    // PUNTO 6 — la pasada de detección que además PERSISTE lo encontrado. Ocupa el sitio
    // que tenía `BadWordService` en la firma, para no mover el resto.
    private readonly detections: ListingDetectionsService,
    // MODERACIÓN PREVIA (M1) — decide si el anuncio se desvía a revisión.
    private readonly preModeration: PreModerationService,
    private readonly entitlementService: EntitlementService,
    private readonly activation: ListingActivationService,
    private readonly messaging: MessagingService,
    private readonly notifications: NotificationsService,
    private readonly reviews: ReviewsService,
    // B2 — el sistema de tags es HERMANO del de atributos, no parte de él: los
    // atributos se validan en este servicio (viven en un jsonb del propio anuncio),
    // los tags los valida el suyo (viven en tablas propias, con herencia de categoría
    // y un tope configurable).
    private readonly tags: TagsService,
    // PROFUNDIDAD N — RÁFAGA 1: el único lector de la jerarquía. Sustituye a los
    // `parent: { select: … }` de un nivel que había en create() y update().
    private readonly categoryTree: CategoryTreeService,
    // PUERTA — el punto único que valida ANTES de escribir ACTIVE. Es el hermano
    // PREVIO de ListingActivationService (que corre después). Sustituye al
    // `checkActiveListingLimit` privado que vivía aquí: era inalcanzable desde
    // Moderation y Admin, y por eso la cuota se escapaba por varios caminos.
    private readonly gate: ListingGateService,
    // PUERTA — RÁFAGA 2: sólo para LIMPIAR el aviso cuando el vendedor corrige
    // su anuncio editándolo. Marcar no se hace nunca desde aquí.
    private readonly revalidation: RevalidationService,
    // PUERTA — RÁFAGA 2: los MOTIVOS que se le enseñan al vendedor en «Mis
    // anuncios». Es el mismo comprobador que usa la regla que frena, y eso no es
    // un detalle: si el aviso listara otros motivos que los que bloquean, sería
    // peor que no avisar.
    private readonly attributeCheck: AttributeCheckService,
    // PUERTA regla #3 — el ÚNICO lector del tope de fotos (antes, un 15 clavado
    // en los dos DTOs y en React).
    private readonly photoLimits: PhotoLimitsService,
    // BORRADO B3 — limpiar del bucket las fotos de un borrador descartado. Van
    // AL FINAL a propósito: insertar parámetros en medio obliga a recontar
    // posiciones en cada spec que construya el servicio a mano, y aquí hay dos.
    @InjectQueue(QUEUE_MEDIA_CLEANUP) private readonly mediaCleanupQueue: Queue,
    private readonly r2: R2Service,
    // P3a — las reglas de los campos, ahora compartidas con el camino del staff.
    // AL FINAL, por la misma razón que las dos de arriba.
    private readonly editValidation: ListingEditValidationService,
    // 2b — las FOTOS, también compartidas con el camino del staff. Al final, ídem.
    private readonly listingImages: ListingImagesService,
  ) {}

  async create(sellerId: string, dto: CreateListingDto): Promise<Listing> {
    // PUERTA — REGLA #1 (límite total). LA ÚNICA COMPROBACIÓN DE LA PUERTA QUE NO
    // RECIBE UN ANUNCIO: pregunta si este vendedor puede tener uno más, y el que
    // lo pregunta es justo el que todavía no existe.
    //
    // LO PRIMERO DE TODO, antes incluso de resolver la categoría: si el vendedor
    // está en su tope, no tiene sentido pagar consultas para validar un anuncio
    // que no se va a crear.
    //
    // NO cambia nada mientras la regla esté apagada, que es como nace: sin la
    // fila de `Setting`, esta llamada no consulta ni una tabla.
    await this.gate.assertCanCreate(sellerId, {
      actor: 'seller', transition: 'create', actorId: sellerId,
    });

    // PROFUNDIDAD N — RÁFAGA 1: la cadena raíz→hoja sustituye a la consulta con
    // `parent` de un nivel. `[]` = la categoría no existe.
    // B2 — el slug (de la hoja) hace falta para los tags: TagsService cachea el
    // set efectivo POR SLUG, así que se reutiliza esa caché en vez de abrir un
    // segundo camino de resolución por id.
    const cadena = await this.categoryTree.getAncestorChain(dto.categoryId);
    if (cadena.length === 0) throw new NotFoundException('Category not found');
    const category = cadena[cadena.length - 1];
    // El pliegue de la herencia + el filtro por tipo, en el orden de siempre.
    // required se exige solo entre los campos aplicables al tipo del anuncio —
    // igual que el wizard, que nunca envía un campo appliesTo-restringido al
    // otro tipo. Sin este filtro, un required de un tipo bloquearía SIEMPRE
    // los anuncios del tipo contrario (RÁFAGA 5, bug real encontrado en verificación).
    const applicableSchema = applicableSchemaFor(cadena, dto.type);
    // create() valida COMPLETO — no hay "existing" con el que calcular un delta.
    this.editValidation.validateRequired(dto.attributes ?? {}, applicableSchema);
    this.editValidation.validateAttributeValues(dto.attributes ?? {}, applicableSchema);
    this.editValidation.validateLinkedSelects(dto.attributes ?? {}, applicableSchema);
    this.editValidation.validateListingTypeAllowed(dto.type, cadena);
    // priceUnit es opcional en el DTO: ausente equivale a ONE_TIME (el default de
    // la columna), así que se valida ese mismo valor — una categoría que NO
    // permita ONE_TIME rechaza igual un alta que lo omita que una que lo mande.
    const priceUnit: PriceUnit = dto.priceUnit ?? 'ONE_TIME';
    this.editValidation.validatePriceUnitAllowed(priceUnit, cadena);

    // B2 — los tags se validan COMPLETO en create, igual que los atributos: no hay
    // "existing" con el que calcular un delta. Se resuelven a ids ANTES de crear nada,
    // para que un 422 no deje un anuncio a medias.
    const tagIds = await this.tags.resolveTagsForListing(dto.tags ?? [], category.slug);

    const listing = await this.createWithUniqueSlug(dto.title, {
      title: dto.title,
      description: dto.description,
      price: dto.price,
      currency: dto.currency ?? 'EUR',
      type: dto.type,
      condition: dto.condition,
      priceType: dto.priceType,
      priceUnit,
      attributes: (dto.attributes ?? {}) as Prisma.InputJsonValue,
      city: dto.city,
      province: dto.province,
      postalCode: dto.postalCode,
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
      // FILTRO DEL BACKOFFICE — los DOS campos SIEMPRE JUNTOS. `phone` es lo que tecleó el
      // vendedor y es lo que se le enseña al comprador; `phoneNormalized` es lo mismo en su
      // forma canónica, y es lo único con lo que se puede buscar. Escribir uno sin el otro
      // deja un anuncio con teléfono que el buscador no encuentra — invisible, porque la
      // pantalla del vendedor sigue viéndose bien. `camposDeTelefono()` los emite a la vez
      // para que no se puedan separar por descuido.
      ...camposDeTelefono(dto.phone),
      sellerId,
      categoryId: dto.categoryId,
      // B2 — escritura ATÓMICA con el anuncio: un create anidado de Prisma va en la
      // misma transacción implícita que la fila padre, así que o se crean el anuncio y
      // sus tags, o no se crea nada. Un segundo createMany después habría dejado la
      // puerta abierta a un anuncio sin sus tags si fallara.
      ...(tagIds.length > 0 && {
        tags: { create: tagIds.map((tagId) => ({ tagId })) },
      }),
    });

    if (dto.imageIds?.length) {
      await this.listingImages.sync({
        listingId: listing.id,
        sellerId,
        imageIds: dto.imageIds,
      });
    }

    // Geocode in background via BullMQ — coordinates are not needed to publish.
    // This avoids blocking the HTTP response on an external service (Nominatim).
    if (dto.latitude == null && dto.longitude == null) {
      await this.indexingQueue.add('geocode', { listingId: listing.id });
    }

    return listing;
  }

  async update(id: string, userId: string, dto: UpdateListingDto): Promise<Listing> {
    const existing = await this.assertOwnership(id, userId);

    // P3a — LAS VALIDACIONES DE LOS CAMPOS VIVEN FUERA, y las comparte el camino
    // del STAFF (`AdminService.updateListing`). Eran ocho reglas con
    // grandfathering fino —required sobre el bag completo pero el resto sólo
    // sobre el delta, tags estrictos si se eligen y podados si sólo se mueve de
    // categoría—; copiarlas para el backoffice habría dejado divergir justo la
    // copia que menos se ejerce. Lo que se movió es DÓNDE viven: el bloque está
    // en `ListingEditValidationService.validarEdicion` tal cual estaba aquí, con
    // sus mismos disparadores y sus mismos mensajes.
    //
    // LO QUE NO SE MOVIÓ, y es la línea que separa los dos caminos: la guarda de
    // propiedad (`assertOwnership`, arriba) y la anotación del triaje (abajo). La
    // primera dice QUIÉN puede editar; la segunda afirma que editó EL DUEÑO.
    const tagIds = await this.editValidation.validarEdicion({
      listingId: id,
      existing,
      dto,
    });

    const { imageIds, ...fields } = dto;

    // Re-geocode when location text changed and no explicit coords were provided.
    // Explicit lat/lng in the DTO always take priority over geocoding.
    const locationChanged =
      fields.city !== undefined ||
      fields.province !== undefined ||
      fields.postalCode !== undefined;
    const coordsExplicit =
      fields.latitude !== undefined && fields.longitude !== undefined;

    let coordUpdate: { latitude?: number; longitude?: number } = {};
    if (coordsExplicit) {
      coordUpdate = { latitude: fields.latitude, longitude: fields.longitude };
    }

    const listing = await this.prisma.listing.update({
      where: { id },
      data: {
        ...(fields.title !== undefined && { title: fields.title }),
        ...(fields.description !== undefined && { description: fields.description }),
        ...(fields.price !== undefined && { price: fields.price }),
        ...(fields.currency !== undefined && { currency: fields.currency }),
        ...(fields.condition !== undefined && { condition: fields.condition }),
        ...(fields.priceType !== undefined && { priceType: fields.priceType }),
        ...(fields.priceUnit !== undefined && { priceUnit: fields.priceUnit }),
        ...(fields.categoryId !== undefined && { categoryId: fields.categoryId }),
        ...(fields.attributes !== undefined && { attributes: fields.attributes as object }),
        ...(fields.city !== undefined && { city: fields.city }),
        ...(fields.province !== undefined && { province: fields.province }),
        ...(fields.postalCode !== undefined && { postalCode: fields.postalCode }),
        // Los dos juntos, igual que en el alta. `undefined` (el PATCH no tocó el teléfono)
        // no emite ninguno de los dos, así que el par nunca se desparea.
        ...(fields.phone !== undefined && camposDeTelefono(fields.phone)),
        // B2 — reemplazo COMPLETO del set, en la MISMA transacción implícita que el
        // resto de la fila: deleteMany + create anidados no pueden dejar un anuncio
        // sin tags a medio camino. `tagIds === undefined` (el PATCH no los tocó) no
        // emite nada, así que ni siquiera se leen.
        ...(tagIds !== undefined && {
          tags: {
            deleteMany: {},
            create: tagIds.map((tagId) => ({ tagId })),
          },
        }),
        ...coordUpdate,
        // ETIQUETA INTERNA (P1) — LA ANOTACIÓN, AL LADO DEL MECANISMO Y SIN
        // MEZCLARSE CON ÉL.
        //
        // El mismo evento —el dueño edita— mueve DOS ejes que no se leen entre sí:
        //
        //   · el MECANISMO: qué le pasa al anuncio. Es lo que hace el resto de
        //     este `data` y el `clearIfCompliant` de abajo. Destinatario: el
        //     vendedor y la puerta.
        //   · la ANOTACIÓN: cómo lo ve el staff. Es esta línea. Destinatario: el
        //     moderador.
        //
        // Va DENTRO de la misma escritura por atomicidad —o se guardan el
        // contenido y su etiqueta, o ninguno de los dos—, no porque el mecanismo
        // decida la etiqueta: quien decide es `triageAfterOwnerEdit`, que sólo
        // mira el triaje anterior y no sabe qué es un `status`.
        //
        // NO TOCA `status` NI `needsRevalidation`, ni ellos tocan a ésta.
        triage: triageAfterOwnerEdit(existing.triage),
      },
    });

    if (imageIds !== undefined) {
      // 2b — UN SOLO SITIO, compartido con el camino del staff. Lo que había aquí
      // —desvincular las que salen (`listingId: null`) y enlazar las que quedan— dejaba
      // la fila y sus DOS objetos de R2 huérfanos para siempre. Era la sexta fuente de
      // huérfanas, y la única que se dispara editando un anuncio vivo. Ahora salir es
      // BORRARSE, con su limpieza encolada. Ver `ListingImagesService`.
      await this.listingImages.sync({ listingId: id, sellerId: userId, imageIds });
    }

    // PUERTA — RÁFAGA 2. EDITAR LIMPIA, PERO NUNCA FRENA.
    //
    // Es la asimetría más importante de todo el mecanismo. Editar es LA VÍA DE
    // SALIDA de un anuncio marcado: frenar aquí dejaría al vendedor encerrado —
    // no puede publicar porque no cumple, y no puede arreglarlo porque no le
    // dejan editar—. Así que la edición no pasa por la puerta; lo que hace es
    // preguntar, ya guardado, si el anuncio volvió a cumplir, y en ese caso
    // retirar el aviso él solo.
    //
    // Se le pasa `listing`, que es la fila RECIÉN escrita: preguntárselo a la
    // versión anterior diría que no cumple justo después de haberlo arreglado.
    if (listing.needsRevalidation) {
      await this.revalidation.clearIfCompliant(listing);
    }

    // PUNTO 6 · RÁFAGA A — EL HUECO QUE P1 DEJÓ ANOTADO, CERRADO.
    //
    // `listing-triage.ts` lo dice con todas las letras: hasta ahora la edición del dueño no
    // cambiaba `status`, no volvía a pasar por el filtro de palabras y no consultaba la
    // moderación previa —los cuatro caminos corrían sólo en `publish()`—, así que **un
    // anuncio ACTIVE se podía reescribir entero sin que se enterara nadie**. El triaje era
    // la única señal que el staff recibía.
    //
    // POR QUÉ ESTO ES INOFENSIVO HOY, y es la razón de que la ráfaga A lo cierre y no la B:
    // aquí NO se toca `status`. Los detectores nuevos están en `WARN` y el de palabras
    // gobierna `publish()`, no esto. Lo único que ocurre es que las detecciones se ponen al
    // día, así que **el cambio estructural (que editar se mire) llega separado del
    // arriesgado (que editar despublique)**, que es la ráfaga B y llega con datos delante.
    //
    // Se le pasa `listing`, la fila RECIÉN escrita —igual que a `clearIfCompliant`—: mirar
    // la versión anterior detectaría el teléfono que el vendedor acaba de quitar.
    //
    // NO LANZA NUNCA, y no es una precaución de más: «editar limpia, pero nunca frena» (ver
    // el bloque de arriba). Editar es la vía de salida de un anuncio marcado; si pudiera
    // fallar por tener un teléfono, quien ya lo tuviera no podría quitarlo. `refresh` se
    // traga sus propios fallos, y el `void` deja escrito que aquí no se mira el resultado.
    const { blocking } = await this.detections.refresh(listing.id, {
      title: listing.title,
      description: listing.description,
      // A2 — el campo del teléfono entra en lo escaneado. Sólo lo mira `PHONE_LIST`: un
      // número marcado lo está esté donde esté. La fila RECIÉN escrita, igual que el resto.
      phone: listing.phone,
    });
    const trasEditar = await this.aplicarConsecuenciaDeLaEdicion(listing, blocking, userId);

    // Clear cache immediately, then enqueue exactly one indexing-affecting job.
    // When the address changed without explicit coords, the 'geocode' job
    // reindexes itself once it has resolved (or given up on) the new
    // coordinates (see handleGeocode) — it is NOT paired with a separate
    // 'index' job here anymore. Two jobs for the same listingId with no
    // ordering guarantee beyond incidental queue concurrency=1 previously
    // raced: enqueuing only one job per update removes that race regardless
    // of @Processor(QUEUE_INDEXING) concurrency.
    await this.redis.client.del(cacheKey(existing.slug));
    if (locationChanged && !coordsExplicit) {
      await this.indexingQueue.add('geocode', { listingId: id });
    } else {
      await this.indexingQueue.add('index', { listingId: id });
    }
    // `SearchService.indexListing` decide por el estado, así que el mismo trabajo saca del
    // índice un anuncio que acaba de irse a revisión y mete el que acaba de salir de ella.
    return trasEditar;
  }

  /**
   * PUNTO 6 · RÁFAGA B — LA CONSECUENCIA DE EDITAR, EN LOS DOS SENTIDOS.
   *
   * ─── EL CAMBIO DE COMPORTAMIENTO, DICHO SIN ADORNOS ─────────────────────────────────
   *
   * Hasta la ráfaga A, editar un ACTIVE **no podía cambiar su estado**: la detección corría
   * y sólo dejaba avisos. Desde aquí, **con un detector en `BLOCK`, meter un teléfono en
   * un anuncio publicado lo devuelve a la cola de revisión**. Su anuncio desaparece del
   * escaparate a media vida, por una edición. Es nuevo para el vendedor.
   *
   * Por eso llega en su propia ráfaga y detrás de un interruptor: `IP` y `PHONE` nacieron
   * avisando y sólo bloquean si un ADMIN los asciende viendo cuánto disparan.
   *
   * ─── Y LA PUERTA DE SALIDA, QUE ES LA MITAD QUE HACE QUE ESTO NO SEA UNA TRAMPA ─────
   *
   * Bloquear sin salida es encerrar: «no se publica porque no cumple, y no puede arreglarlo
   * porque ya no le deja». `publish()` sólo admite DRAFT, y de `PENDING_REVIEW` sólo salía
   * un moderador aprobando. Con un detector bloqueando al editar, eso convertiría cada
   * falso positivo en una espera indefinida por algo que el vendedor puede arreglar solo.
   *
   * Así que la simetría es obligatoria: **editar un `PENDING_REVIEW` que ya no dispara nada
   * lo devuelve a ACTIVE**. Molde exacto de `clearIfCompliant` —«editar limpia»—, y con su
   * misma pregunta: no «¿por qué entró?» sino «¿queda algún motivo AHORA?».
   *
   * ─── LO QUE NO LIBERA, Y ES DELIBERADO ──────────────────────────────────────────────
   *
   * Se consulta también `reviewTriggerFor`. Si la plataforma revisa todo, o la categoría o
   * el vendedor están marcados, **el anuncio se queda en la cola por mucho que el texto
   * quede limpio**: eso son POLÍTICAS que alguien encendió a mano, y quitar un teléfono no
   * las satisface. Sólo se libera lo que se bloqueó por el contenido.
   *
   * ALCANCE: sólo `ACTIVE ⇄ PENDING_REVIEW`. Un `RESERVED` tiene una negociación abierta y
   * un `PAUSED`/`DRAFT` no está en el escaparate — moverlos por una edición sería tocar
   * ciclos de vida que este punto no viene a tocar.
   *
   * NUNCA LANZA. «Editar limpia, pero nunca frena»: si la puerta rechaza la reactivación
   * —cuota, por ejemplo— el anuncio se queda donde estaba y la edición se guarda igual.
   */
  private async aplicarConsecuenciaDeLaEdicion(
    listing: Listing,
    blocking: boolean,
    userId: string,
  ): Promise<Listing> {
    try {
      if (listing.status === 'ACTIVE' && blocking) {
        return await this.prisma.listing.update({
          where: { id: listing.id },
          // `expiresAt` NO se toca: el anuncio no ha caducado, está en revisión. Al volver
          // conserva el plazo que le quedaba en vez de estrenar uno.
          data: { status: 'PENDING_REVIEW' },
        });
      }

      if (listing.status === 'PENDING_REVIEW' && !blocking) {
        if (await this.preModeration.reviewTriggerFor(listing)) return listing;

        // LA PUERTA, IGUAL QUE AL PUBLICAR: volver al escaparate ocupa plaza, así que se
        // comprueba la cuota. Si la rechaza, se queda en revisión — sin lanzar.
        await this.gate.assertCanBecomeActive(listing, {
          actor: 'seller', transition: 'publish', actorId: userId,
        });

        const publishedAt = listing.publishedAt ?? new Date();
        const liberado = await this.prisma.listing.update({
          where: { id: listing.id },
          data: {
            status: 'ACTIVE',
            publishedAt,
            // Molde de `approveListing`: el plazo se cuenta desde la publicación, no desde
            // ahora, para que pasar por la cola no regale caducidad.
            expiresAt: ExpirationService.expiresAt(publishedAt),
          },
        });
        await this.activation.listingBecameActive(liberado.slug, liberado.id);
        return liberado;
      }
    } catch (err) {
      this.logger.error(
        `No se ha podido aplicar la consecuencia de la edición al anuncio ${listing.id} — se conserva su estado`,
        err,
      );
    }

    return listing;
  }

  /**
   * REGLA #2 — LA DEGRADACIÓN, Y POR QUÉ VIVE AQUÍ Y NO EN LA PUERTA.
   *
   * Publicar sin el correo verificado no es un error del vendedor: su anuncio
   * está bien, sólo le falta un paso a él. Así que no se rechaza —se deja el
   * anuncio EXACTAMENTE como estaba, en DRAFT, sin tocar un solo campo— y se le
   * dice qué hacer. Es un tercer resultado: ni «publicado» ni «error».
   *
   * SE EVALUARON DOS SITIOS PARA ESE TERCER RESULTADO:
   *
   *  (a) Que la puerta tuviera tres veredictos (pasa / rechaza / degrada). Más
   *      potente, pero cambia el contrato de la puerta —hoy binario— para los
   *      diez caminos que la llaman, y sólo UNA regla lo usaría. Los otros nueve
   *      caminos tendrían que aprender a manejar un veredicto que nunca van a
   *      recibir.
   *
   *  (b) Que la puerta siga siendo binaria y que sea ESTE camino, el único que
   *      sabe degradar, quien reconozca ese motivo concreto. ← ELEGIDA.
   *
   * Se eligió (b), y la razón que la hace segura no es de estilo: la regla
   * declara `appliesTo` = sólo `publish`, así que el motivo `EMAIL_NOT_VERIFIED`
   * NO PUEDE aparecer en ningún otro camino. Ninguno de los otros nueve necesita
   * saber que existe. Con (a), en cambio, todos habrían tenido que decidir qué
   * hacen con un veredicto que no les llega nunca.
   *
   * El coste de (b) es este try/catch, que usa una excepción como decisión. Se
   * acota con `unicoMotivo`: si hay CUALQUIER otro motivo —o más de uno—, el
   * rechazo se propaga tal cual. Sólo el caso exacto se convierte en degradación.
   *
   * `publishBlocked` es ADITIVO: quien sólo mire `status` ve un DRAFT y ya sabe
   * que no se publicó — que es justo como el frontend distingue hoy un
   * PENDING_REVIEW de un ACTIVE.
   */
  async publish(
    id: string,
    userId: string,
  ): Promise<Listing & { publishBlocked?: GateReason }> {
    const existing = await this.assertOwnership(id, userId);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Solo se pueden publicar anuncios en estado DRAFT');
    }

    // Content filter — if the list is empty or service fails, targetStatus stays
    // ACTIVE. Moderation is a helper layer and must never block publication.
    //
    // PUNTO 6 · RÁFAGA 0 — LO MISMO QUE ANTES, POR OTRO SITIO. Era
    // `badWordService.hasBadWords(title, description)` devolviendo un booleano; ahora es el
    // motor, que corre sus detectores y dice si alguno de los que BLOQUEAN encontró algo.
    // Con un único detector (`WORD`) y en modo `BLOCK` —que es lo que hace desde siempre—,
    // `blocking` vale exactamente lo que valía `flagged`.
    //
    // El try/catch se conserva aunque `run()` prometa no lanzar: es el cinturón que ya
    // estaba puesto, y quitarlo en la misma ráfaga que mueve el cuerpo sería cambiar dos
    // cosas a la vez sobre el camino que no puede fallar.
    //
    // RÁFAGA A — la pasada además GUARDA lo encontrado (`refresh`). `blocking` sigue
    // valiendo exactamente lo mismo que antes: los detectores nuevos nacen en `WARN`, así
    // que dejan detecciones y no tocan el destino. Lo único que cambia para el vendedor es
    // que un moderador puede ver qué hay en su texto.
    let targetStatus: 'ACTIVE' | 'PENDING_REVIEW' = 'ACTIVE';
    try {
      const { blocking } = await this.detections.refresh(existing.id, {
        title: existing.title,
        description: existing.description,
        phone: existing.phone,
      });
      if (blocking) targetStatus = 'PENDING_REVIEW';
    } catch (_err) {
      // Silent fallback — publication continues normally.
    }

    // MODERACIÓN PREVIA (M1) — EL CUARTO DESENLACE: DESVIAR.
    //
    // No valida ni rechaza: cambia el DESTINO. El anuncio está bien; lo que pasa
    // es que alguien decidió que esta rama (o la plataforma entera) se revisa
    // antes de publicar. Por eso no es una regla de la puerta —no produce nada
    // que el vendedor pueda corregir— sino una decisión sobre a dónde va.
    //
    // AQUÍ, JUNTO AL FILTRO DE PALABRAS, porque son la misma clase de decisión y
    // este sitio ya existía: `targetStatus` lleva desde siempre pudiendo ser
    // PENDING_REVIEW. Los dos CONVIVEN sin pisarse — cualquiera de los dos manda
    // el anuncio a revisión, y que el otro también lo pida no cambia nada.
    //
    // La diferencia está en el fallo, y es deliberada: el filtro es fail-OPEN
    // (arriba, con su try/catch que sigue adelante) porque es una heurística;
    // esto es fail-CLOSED (dentro del servicio) porque es una política explícita.
    // Ver `PreModerationService`.
    //
    // APAGADO NO HACE NADA: sin el ajuste de plataforma y sin ninguna categoría
    // marcada, `reviewTriggerFor` devuelve `null` y este bloque no toca
    // `targetStatus`.
    if (targetStatus === 'ACTIVE' && (await this.preModeration.reviewTriggerFor(existing))) {
      targetStatus = 'PENDING_REVIEW';
    }

    // PUERTA — la cuota de RF.7 y todo lo que venga después. Sólo si de verdad
    // va a quedar ACTIVE: un PENDING_REVIEW no ocupa plaza.
    if (targetStatus === 'ACTIVE') {
      try {
        await this.gate.assertCanBecomeActive(existing, {
          actor: 'seller', transition: 'publish', actorId: userId,
        });
      } catch (err) {
        const correoSinVerificar = unicoMotivo(err, EMAIL_NOT_VERIFIED_CODE);
        if (!correoSinVerificar) throw err;

        // DEGRADACIÓN. Se devuelve el anuncio SIN ESCRIBIR NADA: sigue en DRAFT,
        // sin `publishedAt` y sin `expiresAt`. No es que se revierta la
        // publicación — es que no llega a ocurrir, así que no hay ninguna huella
        // de un intento fallido que limpiar después.
        return { ...existing, publishBlocked: correoSinVerificar };
      }
    }

    const publishedAt = existing.publishedAt ?? new Date();
    const listing = await this.prisma.listing.update({
      where: { id },
      data: {
        status: targetStatus,
        publishedAt,
        // Only ACTIVE listings get an expiry. PENDING_REVIEW gets it on approval.
        ...(targetStatus === 'ACTIVE' && {
          expiresAt: ExpirationService.expiresAt(publishedAt),
        }),
      },
    });

    if (targetStatus === 'ACTIVE') {
      await this.activation.listingBecameActive(listing.slug, id);
    }

    return listing;
  }

  async renew(id: string, userId: string): Promise<Listing> {
    const existing = await this.assertOwnership(id, userId);
    if (existing.status !== 'ACTIVE' && existing.status !== 'EXPIRED') {
      throw new BadRequestException(
        'Solo se pueden renovar anuncios en estado ACTIVE o EXPIRED',
      );
    }

    // PUERTA — renovar devuelve el anuncio al mercado y cuenta igual que publicar
    // (Opción A de RF.7): una plaza es una plaza, venga de donde venga.
    await this.gate.assertCanBecomeActive(existing, {
      actor: 'seller', transition: 'renew', actorId: userId,
    });

    const now = new Date();
    const listing = await this.prisma.listing.update({
      where: { id },
      data: {
        status: 'ACTIVE',
        // Preserve the original publishedAt: resetting it would be a free bump that
        // defeats the paid bump mechanic (RF.6) and gives wrong datePublished for SEO.
        // Only extend the expiry window from now.
        expiresAt: ExpirationService.expiresAt(now),
      },
    });

    // Not the generic wrapper: a renewed listing reappears in the marketplace
    // exactly like an approved/restored/reactivated one, so it must also feed
    // the alert-matching hook (dedup in AlertMatch prevents re-notifying
    // alerts that already matched this listing — see B3).
    await this.activation.listingBecameActive(listing.slug, id);
    return listing;
  }

  async reserve(id: string, userId: string): Promise<Listing> {
    const existing = await this.assertOwnership(id, userId);
    if (existing.status !== 'ACTIVE') {
      throw new BadRequestException('Solo se pueden reservar anuncios en estado ACTIVE');
    }

    const listing = await this.prisma.listing.update({
      where: { id },
      data: { status: 'RESERVED' },
    });

    await this.invalidateAndReindex(existing.slug, id);
    return listing;
  }

  /**
   * Ciclo de vida RÁFAGA 2 — pausa temporal, reactivable, ambos tipos. Solo
   * desde ACTIVE (ni RESERVED — negociación abierta, ni DRAFT/PENDING_REVIEW —
   * nunca estuvo publicado). Sin comprobación de cuota: salir de ACTIVE
   * siempre libera, nunca hay que bloquearlo. El cron de expiración
   * (`ExpirationService.expireListings`) solo consulta status=ACTIVE, así que
   * un PAUSED queda invisible para él por construcción — no hace falta
   * "congelar" expiresAt aquí, solo recalcularlo al reactivar (ver abajo).
   */
  async pause(id: string, userId: string): Promise<Listing> {
    const existing = await this.assertOwnership(id, userId);
    if (existing.status !== 'ACTIVE') {
      throw new BadRequestException('Solo se pueden pausar anuncios en estado ACTIVE');
    }

    const listing = await this.prisma.listing.update({
      where: { id },
      data: { status: 'PAUSED' },
    });

    await this.invalidateAndReindex(existing.slug, id);
    return listing;
  }

  /**
   * Ciclo de vida RÁFAGA 2 — reactiva un anuncio pausado. Recalcula expiresAt
   * desde ahora (mismo motivo que renew(): un pausado "viejo" podría tener un
   * expiresAt ya pasado y el cron lo caducaría en <24h) y respeta la cuota de
   * activos — si se llenó mientras estaba pausado, falla igual que
   * publish()/renew(). Alimenta el matching de alertas: un anuncio reactivado
   * reaparece en el marketplace igual que uno recién publicado/renovado.
   */
  async reactivate(id: string, userId: string): Promise<Listing> {
    const existing = await this.assertOwnership(id, userId);
    if (existing.status !== 'PAUSED') {
      throw new BadRequestException('Solo se pueden reactivar anuncios en estado PAUSED');
    }

    await this.gate.assertCanBecomeActive(existing, {
      actor: 'seller', transition: 'reactivate', actorId: userId,
    });

    const now = new Date();
    const listing = await this.prisma.listing.update({
      where: { id },
      data: {
        status: 'ACTIVE',
        expiresAt: ExpirationService.expiresAt(now),
      },
    });

    await this.activation.listingBecameActive(listing.slug, id);
    return listing;
  }

  /**
   * Ciclo de vida RÁFAGA 2 — archiva permanentemente, IRREVERSIBLE, ambos
   * tipos. Desde cualquier estado donde hoy la única salida era el borrado
   * físico (remove()): ACTIVE, PAUSED, SOLD, EXPIRED, REJECTED. Excluye
   * DRAFT/PENDING_REVIEW (nada publicado aún) y RESERVED (negociación
   * abierta — archivar dejaría un trato colgado sin resolver). A diferencia
   * de remove(), NO borra conversaciones/tratos/valoraciones — esas
   * relaciones sobreviven tal cual (Conversation/Deal/Review no dependen del
   * status del Listing, solo de su existencia).
   */
  private static readonly ARCHIVABLE_STATUSES: ListingStatus[] = [
    'ACTIVE',
    'PAUSED',
    'SOLD',
    'EXPIRED',
    'REJECTED',
  ];

  async archive(id: string, userId: string): Promise<Listing> {
    const existing = await this.assertOwnership(id, userId);
    if (!ListingsService.ARCHIVABLE_STATUSES.includes(existing.status)) {
      throw new BadRequestException(
        'Solo se pueden archivar anuncios en estado ACTIVE, PAUSED, SOLD, EXPIRED o REJECTED',
      );
    }

    const listing = await this.prisma.listing.update({
      where: { id },
      data: { status: 'ARCHIVED' },
    });

    await this.invalidateAndReindex(existing.slug, id);
    return listing;
  }

  /**
   * Ciclo de vida RÁFAGA 1 — cierra un trato, ramificado por ListingType.
   * PRODUCTO: se agota (→ SOLD), un único Deal. SERVICIO: sigue ACTIVE (nunca
   * SOLD por esto — también si venía de RESERVED, que no tiene un significado
   * claro de "no acepto más clientes" para un servicio), puede repetirse.
   * Sustituye a markAsSold(): la guarda de estado (antes ausente — un DRAFT
   * podía marcarse SOLD directo) aplica igual a ambos tipos.
   *
   * RÁFAGA (A2) — POR QUÉ AQUÍ NO SE COMPRUEBA LA CUOTA. DECISIÓN CONSCIENTE,
   * PENDIENTE DE REVISAR.
   *
   * Un SERVICIO en RESERVED vuelve a ACTIVE al cerrar el trato, así que este es
   * técnicamente un camino a ACTIVE. Y hay un hueco real detrás: `RESERVED` no
   * cuenta para la cuota (`ActiveListingLimitRule` cuenta solo `status: ACTIVE`),
   * de modo que reservar LIBERA plaza y volver de la reserva la recupera sin
   * mirar si el cupo se llenó mientras tanto.
   *
   * No se cierra aquí, por dos razones:
   *
   *  1. Bloquear esto sería DESTRUCTIVO y sin salida. Cerrar un trato registra
   *     un hecho que YA ocurrió (un cliente atendido), y con él nacen el `Deal`,
   *     el enlace a la conversación y los avisos de valoración a las dos partes.
   *     Un 403 aquí no «pospone» nada: pierde el registro, y el vendedor no
   *     tiene forma de arreglarlo salvo despublicar otro anuncio.
   *
   *  2. La causa raíz no está en este método, sino en QUÉ CUENTA la cuota. El
   *     arreglo correcto es que `RESERVED` cuente como plaza ocupada — pero eso
   *     cambia el comportamiento de `publish`/`renew`/`reactivate` para todo el
   *     mundo (un vendedor con 5 activos y 1 reservado hoy puede publicar; con
   *     ese cambio, no), y esta ráfaga tiene el compromiso explícito de dejar
   *     esos tres caminos idénticos.
   *
   * Queda PINNED por un test (listing-status-machine.e2e-spec.ts) para que
   * quien cambie el criterio lo vea romperse a propósito y no por accidente.
   * Ver docs/auditoria-puerta-validacion.md §1.5.
   */
  async closeDeal(id: string, sellerId: string, dto: CloseDealDto): Promise<{ listing: Listing; deal: Deal | null }> {
    const existing = await this.assertOwnership(id, sellerId);
    if (existing.status !== 'ACTIVE' && existing.status !== 'RESERVED') {
      throw new BadRequestException('Solo se puede cerrar un trato desde un anuncio ACTIVE o RESERVED');
    }
    if (existing.type === 'SERVICE' && !dto.buyerId) {
      throw new BadRequestException('Un servicio necesita un cliente registrado para cerrar un trato');
    }
    if (dto.buyerId === sellerId) {
      throw new BadRequestException('No puedes registrar un trato contigo mismo');
    }

    let deal: Deal | null = null;
    if (dto.buyerId) {
      // Trae ambas partes de una vez — nombre+email hacen falta para el
      // aviso de reputación de abajo, no solo para validar que el comprador existe.
      const [buyer, seller] = await Promise.all([
        this.prisma.user.findUnique({
          where: { id: dto.buyerId },
          select: { id: true, name: true, email: true, slug: true },
        }),
        this.prisma.user.findUniqueOrThrow({
          where: { id: sellerId },
          select: { id: true, name: true, email: true, slug: true },
        }),
      ]);
      if (!buyer) throw new NotFoundException('Comprador no encontrado');

      // El backend enlaza la conversación por sí mismo a partir de los hechos —
      // NUNCA acepta un conversationId del cliente. Aceptar uno enviado por el
      // vendedor permitiría fabricar un Deal con apariencia de "verificable"
      // adjuntando una conversación arbitraria, justo el hueco que Deal existe
      // para cerrar (ver Deal.conversationId en schema.prisma).
      const conversation = await this.prisma.conversation.findFirst({
        where: { listingId: id, buyerId: dto.buyerId, sellerId },
        select: { id: true },
      });

      deal = await this.prisma.deal.create({
        data: {
          listingId: id,
          listingTitle: existing.title,
          sellerId,
          buyerId: dto.buyerId,
          conversationId: conversation?.id ?? null,
        },
      });

      // Reputación RÁFAGA 3 — aviso bidireccional a ambas partes, in-app +
      // email, mismo patrón que ContactService.submitMessage() (dispatches
      // independientes, uno puede fallar sin bloquear el otro). Sin
      // deduplicar entre Deals distintos del mismo par — cada trato es un
      // evento real nuevo, no un reenvío del mismo evento (a diferencia de
      // ALERT_MATCH). Copy sin presión, sin plazo (ventana indefinida).
      await Promise.all([
        this.notifications.createNotification(sellerId, 'REVIEW_REQUEST', {
          dealId: deal.id,
          listingId: id,
          listingTitle: existing.title,
          otherUserId: buyer.id,
          otherUserName: buyer.name,
          otherUserSlug: buyer.slug,
        }),
        this.notifications.createNotification(buyer.id, 'REVIEW_REQUEST', {
          dealId: deal.id,
          listingId: id,
          listingTitle: existing.title,
          otherUserId: sellerId,
          otherUserName: seller.name,
          otherUserSlug: seller.slug,
        }),
        this.notificationQueue.add(NOTIFICATION_JOB.SEND_REVIEW_REQUEST_EMAIL, {
          email: seller.email,
          name: seller.name,
          otherUserName: buyer.name,
          listingTitle: existing.title,
          listingSlug: existing.slug,
        } satisfies SendReviewRequestEmailData),
        this.notificationQueue.add(NOTIFICATION_JOB.SEND_REVIEW_REQUEST_EMAIL, {
          email: buyer.email,
          name: buyer.name,
          otherUserName: seller.name,
          listingTitle: existing.title,
          listingSlug: existing.slug,
        } satisfies SendReviewRequestEmailData),
      ]);
    }

    const newStatus: ListingStatus = existing.type === 'PRODUCT' ? 'SOLD' : 'ACTIVE';
    const listing = await this.prisma.listing.update({
      where: { id },
      data: { status: newStatus },
    });
    await this.invalidateAndReindex(existing.slug, id);
    return { listing, deal };
  }

  /**
   * Deshace un Deal dentro de la ventana de 72h (mismo plazo que editar/borrar
   * una Review). Para PRODUCTO revierte el status a ACTIVE en la misma
   * transacción — si no, el anuncio quedaría fuera del catálogo sin ningún
   * Deal que lo explique. Para SERVICIO solo borra el Deal (el status nunca
   * cambió al cerrarlo).
   */
  async undoDeal(id: string, dealId: string, sellerId: string): Promise<Listing> {
    const existing = await this.assertOwnership(id, sellerId);
    const deal = await this.prisma.deal.findUnique({ where: { id: dealId } });
    if (!deal || deal.listingId !== id || deal.sellerId !== sellerId) {
      throw new NotFoundException('Trato no encontrado');
    }
    if (Date.now() > deal.createdAt.getTime() + DEAL_UNDO_WINDOW_MS) {
      throw new ForbiddenException('El plazo de 72 horas para deshacer este trato ha expirado');
    }

    // RÁFAGA (A2) — este era uno de los caminos de VENDEDOR que llegaban a
    // ACTIVE saltándose la cuota: un PRODUCT vuelve de SOLD a ACTIVE y ocupa
    // plaza otra vez. Con el cupo lleno, vender → deshacer daba un activo de más.
    //
    // CONDICIONAL, no incondicional: solo se comprueba cuando la vuelta a ACTIVE
    // va a ocurrir de verdad (mismo criterio que el `data` de abajo). Un SERVICE
    // —o un PRODUCT que ya no esté en SOLD— no cambia de estado al deshacer el
    // trato, así que exigirle cuota bloquearía por nada una operación que no
    // ocupa ninguna plaza nueva.
    //
    // ANTES de abrir la transacción: la puerta consulta y lanza; dejarla dentro
    // solo alargaría la transacción para acabar haciéndole rollback.
    const volveraAActivo = existing.type === 'PRODUCT' && existing.status === 'SOLD';
    if (volveraAActivo) {
      await this.gate.assertCanBecomeActive(existing, {
        actor: 'seller', transition: 'undoDeal', actorId: sellerId,
      });
    }

    const [, listing] = await this.prisma.$transaction([
      this.prisma.deal.delete({ where: { id: dealId } }),
      this.prisma.listing.update({
        where: { id },
        // Misma condición que el guard de cuota de arriba, en una sola variable:
        // si divergieran, se cobraría plaza sin ocuparla (o al revés).
        data: volveraAActivo ? { status: 'ACTIVE' } : {},
      }),
    ]);

    await this.invalidateAndReindex(existing.slug, id);
    return listing;
  }

  /** Tratos cerrados sobre este anuncio — p. ej. para que un servicio muestre "N clientes atendidos". */
  async getDeals(id: string, sellerId: string) {
    await this.assertOwnership(id, sellerId);
    return this.prisma.deal.findMany({
      where: { listingId: id },
      orderBy: { createdAt: 'desc' },
      include: { buyer: { select: SELECT_CONTACT } },
    });
  }

  /** Contactos de este anuncio (quick-pick del selector de comprador/cliente). */
  async getContacts(id: string, sellerId: string) {
    await this.assertOwnership(id, sellerId);
    return this.messaging.findContactsForListing(id, sellerId);
  }

  async findMineById(id: string, userId: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      // Lista blanca del DUEÑO: su teléfono sí (el editor lo edita), las etiquetas de
      // moderación y el rastro de IP no. Ver LISTING_OWNER_SELECT.
      select: LISTING_OWNER_SELECT,
    });
    if (!listing) throw new NotFoundException('Anuncio no encontrado');
    if (listing.sellerId !== userId) {
      throw new ForbiddenException('No tienes permiso sobre este anuncio');
    }
    // B2 — se aplana igual que en findBySlug: la tabla puente es un detalle de
    // almacenamiento, y el wizard de edición espera la misma forma (TagRef[]) que la
    // ficha pública. Si una devolviera `{tag:{…}}` y la otra no, el front tendría que
    // saber por qué endpoint llegó cada anuncio.
    return toOwnerListing(listing);
  }

  /**
   * "Ver teléfono" — requiere sesión (JwtAuthGuard en el controller). El
   * rate limit se comprueba PRIMERO, antes de tocar la BD (mismo orden que
   * ContactService: es el chequeo más barato y evita que un scraper agote
   * el presupuesto de la query en vez del propio). Cuenta tanto si el
   * anuncio no existe/no tiene teléfono como si lo revela — un usuario/IP
   * que insiste en ids inválidos también está "cosechando".
   */
  async getPhone(id: string, userId: string, ip: string): Promise<{ phone: string }> {
    const [userLimit, ipLimit] = await Promise.all([
      this.rateLimit.checkAndIncrement(
        `phone:reveal:user:${userId}`,
        PHONE_REVEAL_LIMIT_USER_PER_HOUR,
        PHONE_REVEAL_WINDOW_SECONDS,
      ),
      this.rateLimit.checkAndIncrement(
        `phone:reveal:ip:${ip}`,
        PHONE_REVEAL_LIMIT_IP_PER_HOUR,
        PHONE_REVEAL_WINDOW_SECONDS,
      ),
    ]);
    if (userLimit.limited || ipLimit.limited) {
      throw new HttpException(
        { message: 'Demasiadas peticiones, inténtalo más tarde', retryAfter: PHONE_REVEAL_WINDOW_SECONDS },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const listing = await this.prisma.listing.findUnique({
      where: { id },
      select: { phone: true, status: true },
    });
    if (!listing || listing.status !== 'ACTIVE' || !listing.phone) {
      throw new NotFoundException('Anuncio no encontrado');
    }
    return { phone: listing.phone };
  }

  /**
   * BORRADO B2 — DESCARTAR UN BORRADOR. Sustituye a `remove()`, que era el borrado
   * del dueño desde CUALQUIER estado.
   *
   * LA POLÍTICA, y por qué esta operación existe. El dueño deja de poder eliminar:
   * lo que puede hacer con un anuncio publicado es ARCHIVARLO (irreversible, no
   * destructivo), y destruirlo es cosa del staff y sólo sobre archivados. La razón
   * es concreta y no teórica: mientras borrar fue del dueño, el denunciado podía
   * llevarse por delante la denuncia y el vendedor el hilo de mensajes que probaba
   * lo que dijo (B1 cerró ese daño; B2 cierra la puerta).
   *
   * PERO QUITARLO SIN MÁS DEJABA UN CALLEJÓN SIN SALIDA, y es el hallazgo que
   * obligó a diseñar esto: un `DRAFT` **cuenta para el tope total**
   * (`ESTADOS_QUE_CUENTAN_AL_TOTAL`) y **no es archivable** (`ARCHIVABLE_STATUSES`
   * excluye «nada publicado aún»). Un usuario con tres borradores abandonados se
   * habría quedado tres plazas de su cupo ocupadas para siempre, sin ninguna acción
   * a su alcance.
   *
   * POR QUÉ SE LLAMA DISTINTO Y NO ES UNA EXCEPCIÓN A LA POLÍTICA. La política
   * protege la HISTORIA PÚBLICA. Un `DRAFT` no tiene ninguna: no está en el índice,
   * nadie lo ha marcado como favorito, no tiene conversaciones, ni denuncias, ni
   * valoraciones, ni tratos — no ha existido para nadie más que su autor.
   * Descartarlo no destruye nada que otra persona pueda echar en falta. Es una
   * operación distinta de «eliminar un anuncio», y por eso tiene otro nombre aquí y
   * en la interfaz: para que nadie la lea como el borrado de antes con la puerta
   * entornada. Ver docs/diseno-borrado.md §1.2 (D-1).
   *
   * `PENDING_REVIEW` NO entra: ahí hay un moderador con trabajo encolado, y
   * retirarlo por debajo es una decisión de la cola de moderación (D-2).
   */
  async discardDraft(id: string, userId: string): Promise<void> {
    const existing = await this.assertOwnership(id, userId);

    if (existing.status !== 'DRAFT') {
      throw new BadRequestException(
        'Solo se pueden descartar borradores. Un anuncio publicado se archiva, y eliminarlo es cosa del equipo.',
      );
    }

    // BORRADO B3 — un borrador SÍ puede tener ficheros: el wizard sube las fotos
    // (y el vídeo) antes de publicar, así que descartarlo sin limpiar es
    // exactamente la fuente de huérfanas que `docs/pendientes.md` ya describía
    // («las imágenes de wizards abandonados quedan huérfanas para siempre»).
    // Se leen ANTES del borrado — después no habría de dónde.
    const media = await this.prisma.listing.findUnique({
      where: { id },
      select: {
        videoUrl: true,
        videoPosterUrl: true,
        videoPreviewUrl: true,
        images: { select: { url: true } },
      },
    });

    await this.prisma.listing.delete({ where: { id } });
    // Se conservan los dos efectos del borrado anterior aunque un DRAFT no esté
    // ni cacheado ni indexado (sólo se indexan los ACTIVE): son idempotentes y
    // baratos, y quitarlos sería confiar en que esas dos reglas no cambien nunca.
    await this.redis.client.del(cacheKey(existing.slug));
    await this.indexingQueue.add('remove', { listingId: id });

    const keys = listingMediaKeys(
      {
        imageUrls: media?.images.map((i) => i.url) ?? [],
        videoUrl: media?.videoUrl,
        videoPosterUrl: media?.videoPosterUrl,
        videoPreviewUrl: media?.videoPreviewUrl,
      },
      this.r2.getPublicUrl(''),
    );
    if (keys.length > 0) {
      await this.mediaCleanupQueue.add('purge', { keys, origen: `draft:${id}` });
    }
  }

  async findBySlug(slug: string) {
    const raw = await this.redis.client.get(cacheKey(slug));
    let listingData: object & { id: string };

    if (raw) {
      listingData = JSON.parse(raw) as object & { id: string };
    } else {
      const listing = await this.prisma.listing.findUnique({
        where: { slug },
        // PRIVACIDAD — CRÍTICO, Y AHORA POR CONSTRUCCIÓN.
        //
        // Esto era `include: LISTING_INCLUDE` —la fila entera— con un destructuring de dos
        // campos como única defensa, y la defensa no bastaba: quitaba `phone` y dejaba
        // salir `phoneNormalized`, que es el MISMO número. Salían además `lastOwnerIp`,
        // `lastOwnerInteractionAt`, `triage` y `watched`, en un endpoint sin sesión.
        //
        // Ahora la ficha pide una LISTA BLANCA. Lo que no está enumerada ahí no se
        // selecciona, así que no puede salir ni acabar en el blob de Redis — hoy ni cuando
        // `Listing` gane una columna nueva. Ver LISTING_PUBLIC_SELECT.
        select: LISTING_PUBLIC_SELECT,
      });
      if (!listing || listing.status !== 'ACTIVE') {
        throw new NotFoundException('Anuncio no encontrado');
      }
      // `toPublicListing` cambia el teléfono por `hasPhone` (para pintar el botón "Ver
      // teléfono" sin revelar el número) y aplana los tags a TagRef[].
      //
      // SE CACHEA EL RESULTADO DE LA PROYECCIÓN, no la fila: el blob de Redis no puede
      // contener nada que esta función no emita. Es lo que hace que la garantía valga
      // también para las fichas servidas desde caché.
      //
      // OJO con la caché: los blobs guardados antes de este cambio llevan los campos
      // viejos. Los purga `purgarFichasCacheadas()` al arrancar; sin eso tardarían hasta
      // 5 minutos (el TTL) en desaparecer.
      const listingToCache = toPublicListing(listing);
      await this.redis.client.setex(cacheKey(slug), CACHE_TTL, JSON.stringify(listingToCache));
      listingData = listingToCache;
    }

    // Always computed fresh — not cached — so router.refresh() reflects featuring instantly.
    const now = new Date();
    const featuredEntitlement = await this.prisma.entitlement.findFirst({
      where: {
        listingId: listingData.id,
        type: EntitlementType.FEATURED_LISTING,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      select: { expiresAt: true },
      orderBy: { expiresAt: 'desc' },
    });

    // Escaparate RÁFAGA 4 — igual que featuredUntil arriba: SIEMPRE fresca,
    // nunca dentro del blob cacheado en Redis. Una ficha se ve mucho menos
    // que una card en agregado, así que pagar una query propia (~sub-ms,
    // ver ReviewsService.getRatingSummaries) por la media EXACTA en el
    // momento de la visita es preferible a arrastrar la caché de 5 min del
    // listado y su propia invalidación.
    const seller = (listingData as unknown as { seller: { id: string } }).seller;
    const ratings = await this.reviews.getRatingSummaries([seller.id]);
    const sellerRating = ratings.get(seller.id) ?? { average: null, count: 0 };

    return {
      ...listingData,
      featuredUntil: featuredEntitlement?.expiresAt ?? null,
      // UXV.1 (A2) — la MISMA ventana que consume la tarjeta en /mis-anuncios, para
      // que las dos superficies de propietario no puedan discrepar. Se deriva aquí,
      // fuera del blob cacheado (igual que featuredUntil arriba): así los payloads
      // guardados antes de este despliegue también lo llevan. `bumpedAt` sale de la
      // caché como string ISO y `nextBumpAt` acepta ambas formas.
      //
      // La frescura del dato la garantiza BillingService.bump, que ahora borra esta
      // clave al bumpear — sin eso el blob viviría 5 min con un bumpedAt viejo.
      nextBumpAt: nextBumpAt((listingData as { bumpedAt?: Date | string | null }).bumpedAt),
      seller: { ...seller, ratingAverage: sellerRating.average, ratingCount: sellerRating.count },
    };
  }

  async findByCategory(
    categorySlug: string,
    page = 1,
    perPage = 24,
    sort = 'publishedAt:desc',
  ) {
    const [sortField, sortDir] = sort.split(':');
    const dir: 'asc' | 'desc' = sortDir === 'asc' ? 'asc' : 'desc';
    const orderBy =
      sortField === 'price' ? { price: dir } : { publishedAt: dir };

    // Este es el FALLBACK de /[categoria] cuando Meilisearch no responde. Filtraba
    // por `category: { slug }` EXACTO, sin las hijas — así que con Meili caído una
    // categoría PADRE mostraba solo los anuncios colgados directamente de ella
    // (normalmente ninguno: los anuncios cuelgan de las hojas) en vez de los de sus
    // hijas. Es decir, el fallback no reproducía lo que reemplaza: Meilisearch filtra
    // por `categoryPath = slug`, y categoryPath es [slugHoja, slugPadre], así que
    // navegar el padre SÍ agrega las hijas.
    //
    // PROFUNDIDAD N — RÁFAGA 2. El equivalente en Postgres de ese categoryPath.
    // Era un `OR: [{slug}, {parent: {slug}}]` de DOS niveles; ahora es la
    // categoría más TODOS sus descendientes, a cualquier profundidad. Sin esto,
    // con Meilisearch caído una raíz mostraría los anuncios de sus hijas pero no
    // los de sus nietas — el fallback volvería a no reproducir lo que reemplaza,
    // que es justo el bug que este OR vino a cerrar en su día.
    //
    // Para un árbol de 2 niveles el resultado es idéntico al anterior: los
    // descendientes de una raíz son exactamente sus hijas.
    const cadena = await this.categoryTree.getAncestorChainBySlug(categorySlug);
    const objetivo = cadena[cadena.length - 1];
    const categoryIds = objetivo
      ? [objetivo.id, ...(await this.categoryTree.getDescendantIds(objetivo.id))]
      : [];
    const where = {
      status: 'ACTIVE' as const,
      // Slug desconocido → lista vacía, igual que antes (el OR no casaba con nada).
      categoryId: { in: categoryIds },
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.listing.findMany({
        where,
        select: SELECT_SUMMARY,
        orderBy,
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.listing.count({ where }),
    ]);
    const items = await attachSellerRatings(this.reviews, rows.map((r) => toSummary(r)));
    return { items, total, page, perPage };
  }

  async findBySellerSlug(sellerSlug: string, page = 1, perPage = 24) {
    /**
     * BORRADO DE CUENTAS C3 — el vendedor se resuelve APARTE, y con dos efectos.
     *
     * 1. **La cuenta oculta deja de tener escaparate.** Antes este `where` sólo
     *    miraba `status: 'ACTIVE'` del ANUNCIO; el estado del vendedor no entraba.
     *
     * 2. **Un slug desconocido pasa a dar 404, y es un cambio deliberado.** Antes
     *    devolvía 200 con la lista vacía, y eso era justo lo que habría convertido
     *    este endpoint en un delator: si el oculto diera 404 y el inexistente
     *    200-vacío, **el 404 confirmaría que la cuenta existe**. Los dos hermanos
     *    de este endpoint —`GET /users/:slug` y `GET /users/:slug/reviews`— ya
     *    daban 404 sobre un slug desconocido; era éste el que discrepaba.
     *
     * Cuesta una consulta más. Es un listado público de un vendedor, no una ruta
     * caliente, y a cambio el filtro por `sellerId` va por su índice en vez de por
     * un join contra `User`.
     */
    const seller = await this.prisma.user.findFirst({
      where: { slug: sellerSlug, ...CUENTA_EN_ESCAPARATE },
      select: { id: true },
    });
    if (!seller) throw new NotFoundException('Usuario no encontrado');

    const where = { status: 'ACTIVE' as const, sellerId: seller.id };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.listing.findMany({
        where,
        select: SELECT_SUMMARY,
        orderBy: { publishedAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.listing.count({ where }),
    ]);
    // Todas las cards de esta página pertenecen al MISMO vendedor — una sola
    // fila en el batch de todos modos (el helper ya dedup por sellerId), no
    // hace falta un camino especial.
    const items = await attachSellerRatings(this.reviews, rows.map((r) => toSummary(r)));
    return { items, total, page, perPage };
  }

  async findRecent(page = 1, perPage = 8) {
    const where = { status: 'ACTIVE' as const };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.listing.findMany({
        where,
        select: SELECT_SUMMARY,
        orderBy: { publishedAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.listing.count({ where }),
    ]);
    const items = await attachSellerRatings(this.reviews, rows.map((r) => toSummary(r)));
    return { items, total, page, perPage };
  }

  async findMine(userId: string, query: MyListingsQueryDto) {
    const { status, page = 1, perPage = 24 } = query;
    const where = {
      sellerId: userId,
      // Ciclo de vida RÁFAGA 2 — "todos" (sin filtro explícito) significa "todo
      // menos archivado": un anuncio ARCHIVED ya está cerrado para el vendedor
      // y no debería seguir ensuciando la vista por defecto de /mis-anuncios.
      // Solo aparece cuando se pide explícitamente status=ARCHIVED.
      ...(status !== undefined ? { status } : { status: { not: 'ARCHIVED' as const } }),
    };
    const [rows, total, statusGroups] = await this.prisma.$transaction([
      this.prisma.listing.findMany({
        where,
        // PUERTA RÁFAGA 2 — `needsRevalidation` se añade AQUÍ y no dentro de
        // SELECT_SUMMARY: ese select lo comparten las rutas públicas (portada,
        // categorías, búsqueda), y que un anuncio esté pendiente de revalidar es
        // asunto de su dueño, no del catálogo. Mismo criterio que `bumpSchedule`.
        // `categoryId` va con él: es lo que necesita el comprobador para plegar la
        // cadena y decir QUÉ hay que corregir (SELECT_SUMMARY sólo trae el slug
        // de la categoría, que sirve para el enlace pero no para la jerarquía).
        select: { ...SELECT_SUMMARY, needsRevalidation: true, categoryId: true },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.listing.count({ where }),
      // UXV.4 (B3) — cuántos anuncios hay en CADA estado, para que las pestañas de
      // /mis-anuncios dejen de estar mudas: hoy hay que pincharlas una a una para
      // descubrir qué contienen. Es un groupBy sobre `sellerId` (indexado) que
      // devuelve nueve filas como mucho, y va en la MISMA transacción que ya se
      // hacía: ni una ida y vuelta más a Postgres.
      //
      // OJO: sin el `where` de arriba a propósito. Los recuentos son de TODOS los
      // estados, no del filtro activo — si siguieran el filtro, la pestaña
      // seleccionada sería la única con número.
      //
      // `orderBy` es obligatorio en `groupBy` de Prisma; el orden da igual (se vuelca a
      // un mapa), pero sin él no compila.
      this.prisma.listing.groupBy({
        by: ['status'],
        where: { sellerId: userId },
        _count: { _all: true },
        orderBy: { status: 'asc' },
      }),
    ]);

    // Batch query for active FEATURED_LISTING entitlements — one query for all listings, no N+1.
    const featuredMap = new Map<string, string>();
    // H8 Bloque C2 — cifras básicas de estadísticas (vistas + me gusta) por anuncio,
    // igual patrón: una sola query batch, no N+1 por card.
    const favoritesCountMap = new Map<string, number>();
    const bumpScheduleMap = new Map<
      string,
      { id: string; status: string; nextRunAt: Date; intervalDays: number; hourOfDay: number }
    >();
    if (rows.length > 0) {
      const now = new Date();
      const ids = rows.map((r) => r.id);
      const [entitlements, favoriteGroups] = await Promise.all([
        this.prisma.entitlement.findMany({
          where: {
            listingId: { in: ids },
            type: 'FEATURED_LISTING',
            revokedAt: null,
            expiresAt: { gt: now },
          },
          select: { listingId: true, expiresAt: true },
        }),
        this.prisma.favorite.groupBy({
          by: ['listingId'],
          where: { listingId: { in: ids } },
          _count: { _all: true },
        }),
      ]);
      for (const e of entitlements) {
        if (e.listingId && e.expiresAt) {
          featuredMap.set(e.listingId, e.expiresAt.toISOString());
        }
      }
      for (const g of favoriteGroups) {
        favoritesCountMap.set(g.listingId, g._count._all);
      }

      // Bump automático — la programación de cada anuncio, en UNA consulta para todos
      // (mismo criterio batch que featuredUntil y los favoritos: nada de N+1 por tarjeta).
      //
      // VIAJA SOLO EN EL PAYLOAD DE PROPIETARIO, nunca en el público de la ficha: que un
      // vendedor tenga bumps programados es asunto suyo, y además la ficha se sirve desde
      // un blob cacheado 5 min donde este estado se quedaría viejo enseguida.
      const programaciones = await this.prisma.bumpSchedule.findMany({
        where: { listingId: { in: ids } },
        select: { id: true, listingId: true, status: true, nextRunAt: true, intervalDays: true, hourOfDay: true },
      });
      for (const p of programaciones) bumpScheduleMap.set(p.listingId, p);
    }

    // UXV.4 (B3) — recuentos por estado + el de «Todos», que NO es la suma: la vista por
    // defecto excluye ARCHIVED (misma regla que el `where` de arriba), así que sumarlo
    // todo daría un número que no cuadra con lo que la pestaña enseña.
    // El array de `$transaction` pierde la inferencia fina de Prisma sobre `_count`, así
    // que se reafirma la forma que la propia consulta pide (`_count: { _all: true }`).
    const grupos = statusGroups as { status: ListingStatus; _count: { _all: number } }[];
    const countsByStatus = Object.fromEntries(
      grupos.map((g) => [g.status, g._count._all]),
    ) as Record<string, number>;
    const counts = {
      ...countsByStatus,
      all: grupos
        .filter((g) => g.status !== 'ARCHIVED')
        .reduce((sum, g) => sum + g._count._all, 0),
    };

    // PUERTA RÁFAGA 2 — EL AVISO. Los motivos SÓLO de los anuncios marcados, y en
    // UNA consulta para todos ellos (`issuesForMany`), no una por tarjeta.
    //
    // Se calculan en vivo en vez de guardarlos junto al flag porque el schema
    // puede haber cambiado otra vez desde el marcado: unos motivos congelados
    // mandarían al vendedor a corregir algo que ya no es el problema. El coste
    // sólo lo pagan los marcados, que son la excepción — si no hay ninguno, no se
    // hace ni una consulta.
    const marcados = rows.filter((r) => r.needsRevalidation);
    const motivos = await this.attributeCheck.issuesForMany(marcados);

    return {
      counts,
      items: rows.map((r) => ({
        ...toSummary(r),
        needsRevalidation: r.needsRevalidation,
        revalidationReasons: motivos.get(r.id) ?? [],
        featuredUntil: featuredMap.get(r.id) ?? null,
        favoritesCount: favoritesCountMap.get(r.id) ?? 0,
        // UXV.1 (A2) — enriquecido SOLO en la vista del propietario, junto a
        // featuredUntil y por el mismo motivo: es estado de gestión, no de catálogo.
        // Derivado en el servidor para que la tarjeta no tenga que conocer la
        // ventana (antes se inventaba 24 h; la real es 1 h).
        nextBumpAt: nextBumpAt(r.bumpedAt),
        // null cuando el anuncio no tiene bumps programados, que es el caso normal.
        bumpSchedule: bumpScheduleMap.get(r.id) ?? null,
      })),
      total,
      page,
      perPage,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async assertOwnership(id: string, userId: string): Promise<Listing> {
    const listing = await this.prisma.listing.findUnique({ where: { id } });
    if (!listing) throw new NotFoundException('Anuncio no encontrado');
    if (listing.sellerId !== userId) {
      throw new ForbiddenException('No tienes permiso sobre este anuncio');
    }
    return listing;
  }

  /** Non-activation reindex trigger (renew/reserve/markAsSold) — delegates the
   * mechanical work to ListingActivationService without going through
   * listingBecameActive, which is reserved for the 3 paths that reach ACTIVE. */
  private async invalidateAndReindex(slug: string, id: string): Promise<void> {
    await this.activation.reindexListing(slug, id);
  }

  // ---------------------------------------------------------------------------
  // H8 Bloque C1 — tracking de vistas (fuera de findBySlug, sortea la caché de
  // 5 min de la ficha porque el cliente llama a este endpoint en cada montaje,
  // venga el HTML de caché o no) + lectura de estadísticas.
  // ---------------------------------------------------------------------------

  private static readonly VIEW_DEDUP_TTL_SECONDS = 60 * 30;

  async trackView(slug: string, viewerId: string | null, visitorHash: string): Promise<void> {
    const listing = await this.prisma.listing.findUnique({
      where: { slug },
      select: { id: true, sellerId: true },
    });
    if (!listing) throw new NotFoundException('Anuncio no encontrado');

    // El dueño viendo su propio anuncio nunca cuenta — ni siquiera marca dedup.
    if (viewerId && viewerId === listing.sellerId) return;

    const visitorKey = viewerId ? `user:${viewerId}` : `anon:${visitorHash}`;
    const dedupKey = `view:dedup:${listing.id}:${visitorKey}`;
    const accepted = await this.redis.client.set(
      dedupKey,
      '1',
      'EX',
      ListingsService.VIEW_DEDUP_TTL_SECONDS,
      'NX',
    );
    if (accepted !== 'OK') return; // recarga duplicada dentro de la ventana

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    await Promise.all([
      this.prisma.listing.update({
        where: { id: listing.id },
        data: { viewCount: { increment: 1 } },
      }),
      this.prisma.listingViewDaily.upsert({
        where: { listingId_date: { listingId: listing.id, date: today } },
        create: { listingId: listing.id, date: today, count: 1 },
        update: { count: { increment: 1 } },
      }),
    ]);
  }

  /** Estadísticas de un anuncio propio. Básicas para todos; enriquecidas si el dueño es Pro. */
  async getMineStats(id: string, userId: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      // A2 — `impressionCount` (el total de «veces listado») viaja en el MISMO select:
      // ya se estaba leyendo la fila, así que el dato sale sin una consulta más.
      select: { id: true, sellerId: true, viewCount: true, impressionCount: true },
    });
    if (!listing) throw new NotFoundException('Anuncio no encontrado');
    if (listing.sellerId !== userId) {
      throw new ForbiddenException('No tienes permiso sobre este anuncio');
    }

    const favoritesCount = await this.prisma.favorite.count({ where: { listingId: id } });
    const isPro = await this.entitlementService.isProActive(userId);
    if (!isPro) {
      // EL GATE PRO, INTACTO. La forma básica no cambia ni un campo con A2: «veces
      // listado» es una ventaja Pro igual que la gráfica, así que ni el total ni la
      // serie ni el CTR asoman por aquí.
      return { viewCount: listing.viewCount, favoritesCount };
    }

    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 30);
    since.setUTCHours(0, 0, 0, 0);

    // Las dos series, EN PARALELO: son dos consultas independientes sobre dos tablas
    // gemelas, y encadenarlas sumaría una ida y vuelta a una pantalla que ya espera.
    const [dailyRows, dailyImpressionRows] = await Promise.all([
      this.prisma.listingViewDaily.findMany({
        where: { listingId: id, date: { gte: since } },
        orderBy: { date: 'asc' },
        select: { date: true, count: true },
      }),
      this.prisma.listingImpressionDaily.findMany({
        where: { listingId: id, date: { gte: since } },
        orderBy: { date: 'asc' },
        select: { date: true, count: true },
      }),
    ]);

    return {
      viewCount: listing.viewCount,
      impressionCount: listing.impressionCount,
      favoritesCount,
      dailyViews: dailyRows,
      dailyImpressions: dailyImpressionRows,
      // MISMA FORMA QUE `ctr`, y por el mismo motivo: era un porcentaje rotundo sobre una
      // muestra que podía ser de UNA visita («un 100% de quienes lo ven lo guardan»). El
      // cociente no estaba mal calculado; lo que estaba mal era publicarlo sin mirar el
      // tamaño de la muestra. Ver `sample-threshold.ts`, que es donde vive la regla
      // —compartida con el CTR— y donde se justifica por qué el umbral es 30 y no 100.
      likeRatio: {
        value: ratioWithMinSample(favoritesCount, listing.viewCount, LIKE_RATIO_MIN_VIEWS),
        favorites: favoritesCount,
        views: listing.viewCount,
        minViews: LIKE_RATIO_MIN_VIEWS,
      },
      // NO es `viewCount / impressionCount`: los dos totales miden ventanas distintas y
      // ese cociente da cifras absurdas durante meses. Ver `listing-ctr.ts`, que además
      // decide cuándo el número es publicable y cuándo es ruido.
      ctr: computeCtr(dailyRows, dailyImpressionRows),
    };
  }

  /** Agregado del vendedor (todos sus anuncios) — solo Pro. */
  async getMineStatsSummary(userId: string) {
    const isPro = await this.entitlementService.isProActive(userId);
    if (!isPro) {
      throw new ForbiddenException('Estadísticas agregadas disponibles solo para Pro');
    }

    const listings = await this.prisma.listing.findMany({
      where: { sellerId: userId },
      select: { id: true, viewCount: true },
    });
    const totalViews = listings.reduce((sum, l) => sum + l.viewCount, 0);
    const totalFavorites = await this.prisma.favorite.count({
      where: { listing: { sellerId: userId } },
    });
    const mostViewed = listings.reduce<{ id: string; viewCount: number } | null>(
      (max, l) => (max === null || l.viewCount > max.viewCount ? l : max),
      null,
    );

    return {
      totalViews,
      totalFavorites,
      mostViewedListingId: mostViewed?.id ?? null,
    };
  }

  private buildSlug(title: string): string {
    const base = title
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 60);
    const suffix = randomBytes(3).toString('hex');
    return `${base}-${suffix}`;
  }

  // The slug isn't user-chosen (it's derived from the title + a random hex
  // suffix), so a P2002 collision isn't a conflict for the user to resolve —
  // regenerate a fresh random suffix and retry, silently. Only surfaces to the
  // caller if MAX_SLUG_ATTEMPTS is exhausted, which at a 16.7M-value keyspace
  // means something is very wrong (not ordinary bad luck).
  private async createWithUniqueSlug(
    title: string,
    data: Omit<Prisma.ListingUncheckedCreateInput, 'slug'>,
  ): Promise<Listing> {
    for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt++) {
      try {
        return await this.prisma.listing.create({
          data: { ...data, slug: this.buildSlug(title) },
        });
      } catch (err) {
        if (!isP2002(err)) throw err;
        if (attempt < MAX_SLUG_ATTEMPTS) continue;
        this.logger.error(`Slug generation exhausted ${MAX_SLUG_ATTEMPTS} attempts for title="${title}"`);
        throw new ConflictException({
          message: 'No se pudo generar un identificador único para el anuncio, inténtalo de nuevo',
          code: 'SLUG_GENERATION_FAILED',
        });
      }
    }
    // Unreachable: every loop iteration either returns or throws above.
    throw new ConflictException({
      message: 'No se pudo generar un identificador único para el anuncio, inténtalo de nuevo',
      code: 'SLUG_GENERATION_FAILED',
    });
  }

  /*




  /**
   * PROFUNDIDAD N — RÁFAGA 1. Los pliegues que esta clase necesita.
   *
   * Los cuerpos de `resolveEffectivePolicy`/`resolveEffectivePriceUnits` NO
   * cambian: son reductores `(propio, efectivoDelPadre) → efectivo`, y aquí
   * simplemente se aplican sobre la cadena raíz→hoja en vez de una sola vez
   * contra el padre.
   *
   * Para 2 niveles el resultado es idéntico al anterior (la cadena de una hija es
   * `[raíz, hija]`, que es exactamente lo que se fusionaba a mano). Para 4, el
   * bisnieto hereda del abuelo — que es todo el objetivo.
   *
   * PUERTA — RÁFAGA 2: el del SCHEMA ya no está aquí. Se fue a
   * `applicableSchemaFor` (attribute-validation.ts) porque la puerta necesita
   * exactamente el mismo par «plegar + filtrar por tipo», y dos implementaciones
   * de eso divergirían en silencio — que es el riesgo R1 otra vez.
   */



  // 2b — `linkImages` VIVÍA AQUÍ Y HA DESAPARECIDO. Era la mitad buena de dos
  // implementaciones de «pon estas fotos en este anuncio»: ésta validaba tope,
  // existencia y propiedad y escribía el `order`; la del staff (P3a) no hacía nada
  // de eso. Ahora las dos llaman a `ListingImagesService.sync`, que además borra la
  // fila y encola la limpieza de R2 al quitar una foto — la fuga que este camino
  // también tenía. Ver `listing-images.service.ts`.
}
