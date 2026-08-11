import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { listingCacheKey } from '../../infra/redis/cache-keys';
import { RateLimitService } from '../../infra/redis/rate-limit.service';
import {
  PHONE_REVEAL_LIMIT_IP_PER_HOUR,
  PHONE_REVEAL_LIMIT_USER_PER_HOUR,
  PHONE_REVEAL_WINDOW_SECONDS,
} from './listing-phone.constants';
import { EntitlementType, Prisma } from '@prisma/client';
import type { Deal, Listing, ListingStatus, ListingType, PriceType } from '@prisma/client';
import { QUEUE_INDEXING, QUEUE_NOTIFICATIONS } from '../../infra/queue/queue.constants';
import { NOTIFICATION_JOB, SendReviewRequestEmailData } from '../../infra/queue/notification.types';
import { isP2002 } from '../../common/prisma/is-p2002';
import { ExpirationService } from '../expiration/expiration.service';
import { EntitlementService } from '../billing/entitlement.service';
// UXV.1 (A2) — la ventana de cooldown del bump se define en billing (que es quien la
// aplica) y se sirve YA RESUELTA desde aquí. La dirección del import respeta la
// dependencia existente ListingsModule → BillingModule.
import { nextBumpAt } from '../billing/bump-cooldown';
import { BadWordService } from '../moderation/bad-word.service';
import { ListingActivationService } from '../listing-activation/listing-activation.service';
import { MessagingService } from '../messaging/messaging.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ReviewsService } from '../reviews/reviews.service';
import { TagsService } from '../tags/tags.service';
import {
  AttributeField,
  resolveEffectiveSchema,
  resolveEffectivePolicy,
  resolveLinkedOptions,
  filterSchemaByType,
  isListingTypeAllowed,
  resolveEffectivePriceUnits,
  isPriceUnitAllowed,
} from '../categories/category.types';
import type { ListingTypePolicy, PriceUnit } from '@prisma/client';
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

const LISTING_INCLUDE = {
  // A1 (URLs anidadas) — `parent` es NUEVO: el breadcrumb de la ficha
  // (Inicio > Vehículos > Coches > Título) y el enlace a la categoría necesitan el
  // padre para construir la URL canónica. Aditivo en el payload.
  // NOTA: findBySlug cachea el resultado en Redis 5 min, así que justo tras
  // desplegar habrá fichas servidas desde caché SIN `category.parent`. El frontend
  // lo trata como opcional (categoryPath() cae a la URL plana y el breadcrumb a 2
  // niveles) — se autocorrige solo al expirar la caché, sin invalidación manual.
  category: {
    select: { id: true, slug: true, name: true, parent: { select: { slug: true, name: true } } },
  },
  images: { orderBy: { order: 'asc' as const } },
  // trusted: H8 Bloque E — "Vendedor de confianza" en la ficha del anuncio (SellerCard).
  seller: { select: { id: true, name: true, slug: true, avatarUrl: true, trusted: true } },
  // B2 — tags para pintarlos en la ficha. Ordenados por el `orden` del CATÁLOGO
  // (ListingTag no tiene orden propio): así el mismo par de tags sale igual en todas
  // las fichas, en vez de en el orden accidental de inserción.
  tags: {
    orderBy: { tag: { orden: 'asc' as const } },
    select: { tag: { select: { id: true, slug: true, name: true } } },
  },
};

const SELECT_SUMMARY = {
  id: true,
  title: true,
  slug: true,
  price: true,
  currency: true,
  priceType: true,
  // ATRIBUTOS EN CARD — respetar producto/servicio: sin `type` aquí, el fallback a
  // Postgres (findByCategory y demás usos de SELECT_SUMMARY) no podía filtrar los
  // atributos de card por tipo de anuncio — a diferencia del documento de Meilisearch,
  // que ya indexaba `type` desde antes (ver toDocument() en search.service.ts).
  type: true,
  city: true,
  province: true,
  status: true,
  publishedAt: true,
  expiresAt: true,
  bumpedAt: true,
  attributes: true,
  viewCount: true,
  category: { select: { slug: true } },
  images: { orderBy: { order: 'asc' as const }, take: 1, select: { url: true } },
  // Vídeo Pro — se selecciona la URL SOLO para derivar `hasVideo`; la URL en sí NUNCA
  // sale en el resumen de tarjeta. Es lo que garantiza el cero-bytes-de-vídeo en listas por
  // construcción y no por disciplina: sin dirección, no hay nada que descargar.
  videoUrl: true,
  // Escaparate RÁFAGA 4 — necesario para enriquecer la card con la media
  // verificada del vendedor en lote (ver enrichWithSellerRating), no para
  // mostrarlo tal cual.
  sellerId: true,
} as const;

type SummaryDbRow = {
  id: string;
  title: string;
  slug: string;
  price: Prisma.Decimal;
  currency: string;
  priceType: PriceType;
  type: ListingType;
  city: string | null;
  province: string | null;
  status: ListingStatus;
  publishedAt: Date | null;
  expiresAt: Date | null;
  bumpedAt: Date | null;
  attributes: Prisma.JsonValue;
  viewCount: number;
  category: { slug: string };
  images: { url: string }[];
  videoUrl: string | null;
  sellerId: string;
};

@Injectable()
export class ListingsService {
  private readonly logger = new Logger(ListingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly rateLimit: RateLimitService,
    @InjectQueue(QUEUE_INDEXING) private readonly indexingQueue: Queue,
    @InjectQueue(QUEUE_NOTIFICATIONS) private readonly notificationQueue: Queue,
    private readonly badWordService: BadWordService,
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
  ) {}

  async create(sellerId: string, dto: CreateListingDto): Promise<Listing> {
    const category = await this.prisma.category.findUnique({
      where: { id: dto.categoryId },
      select: {
        // B2 — el slug hace falta para los tags: TagsService cachea el set efectivo
        // POR SLUG (B1), así que pedirlo aquí reutiliza esa caché en vez de abrir un
        // segundo camino de resolución por id.
        slug: true,
        attributeSchema: true,
        allowedListingType: true,
        allowedPriceUnits: true,
        parent: {
          select: { attributeSchema: true, allowedListingType: true, allowedPriceUnits: true },
        },
      },
    });
    if (!category) throw new NotFoundException('Category not found');
    const effectiveSchema = resolveEffectiveSchema(
      (category.attributeSchema as unknown as AttributeField[]) ?? [],
      (category.parent?.attributeSchema as unknown as AttributeField[]) ?? [],
    );
    // required se exige solo entre los campos aplicables al tipo del anuncio —
    // igual que el wizard, que nunca envía un campo appliesTo-restringido al
    // otro tipo. Sin este filtro, un required de un tipo bloquearía SIEMPRE
    // los anuncios del tipo contrario (RÁFAGA 5, bug real encontrado en verificación).
    const applicableSchema = filterSchemaByType(effectiveSchema, dto.type);
    // create() valida COMPLETO — no hay "existing" con el que calcular un delta.
    this.validateRequired(dto.attributes ?? {}, applicableSchema);
    this.validateAttributeValues(dto.attributes ?? {}, applicableSchema);
    this.validateLinkedSelects(dto.attributes ?? {}, applicableSchema);
    this.validateListingTypeAllowed(
      dto.type,
      category.allowedListingType,
      category.parent?.allowedListingType,
    );
    // priceUnit es opcional en el DTO: ausente equivale a ONE_TIME (el default de
    // la columna), así que se valida ese mismo valor — una categoría que NO
    // permita ONE_TIME rechaza igual un alta que lo omita que una que lo mande.
    const priceUnit: PriceUnit = dto.priceUnit ?? 'ONE_TIME';
    this.validatePriceUnitAllowed(
      priceUnit,
      category.allowedPriceUnits,
      category.parent?.allowedPriceUnits,
    );

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
      phone: dto.phone,
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
      await this.linkImages(listing.id, sellerId, dto.imageIds);
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

    // La categoría (propia + padre) la necesitan DOS validaciones con
    // disparadores distintos: la de atributos/tipo (categoryId o attributes) y
    // la de formato de precio (priceUnit o categoryId, RP.1). Se resuelve una
    // sola vez aquí para no consultar dos veces la misma fila en un PATCH que
    // toque ambas cosas — y, sobre todo, para que cada bloque conserve su
    // propio disparador: un PATCH de solo `priceUnit` NO debe reejecutar
    // validateRequired sobre los atributos (rompería anuncios antiguos con el
    // bag incompleto, justo el grandfathering que este método ya protege).
    const needsCategory =
      dto.categoryId !== undefined ||
      dto.attributes !== undefined ||
      dto.priceUnit !== undefined ||
      // B2 — los tags son la CUARTA validación con disparador propio.
      dto.tags !== undefined;

    // B2 — se resuelve dentro del bloque de categoría y se aplica al final, junto al
    // resto de campos. `undefined` = no tocar los tags (grandfathering).
    let tagIds: string[] | undefined;

    if (needsCategory) {
      const catId = dto.categoryId ?? existing.categoryId;
      const category = await this.prisma.category.findUnique({
        where: { id: catId },
        select: {
          slug: true,
          attributeSchema: true,
          allowedListingType: true,
          allowedPriceUnits: true,
          parent: {
            select: { attributeSchema: true, allowedListingType: true, allowedPriceUnits: true },
          },
        },
      });
      if (!category) throw new NotFoundException('Category not found');

      if (dto.categoryId !== undefined || dto.attributes !== undefined) {
        const effectiveSchema = resolveEffectiveSchema(
          (category.attributeSchema as unknown as AttributeField[]) ?? [],
          (category.parent?.attributeSchema as unknown as AttributeField[]) ?? [],
        );
        const mergedAttrs = {
          ...(existing.attributes as Record<string, unknown>),
          ...(dto.attributes ?? {}),
        };
        // type es inmutable — se filtra por el tipo YA fijado del anuncio, igual que en create().
        const applicableSchema = filterSchemaByType(effectiveSchema, existing.type);
        // required se exige siempre sobre el bag COMPLETO (invariante de completitud
        // del anuncio, no depende de qué campo tocó esta edición en concreto).
        this.validateRequired(mergedAttrs, applicableSchema);
        // El resto (opciones/tipo/claves desconocidas + el guard de vinculados) se
        // acota al DELTA: valores ya guardados que el usuario ni toca se toleran
        // (grandfathering por construcción) — así una edición trivial (p. ej. solo
        // el precio) de un anuncio con datos sucios preexistentes no rompe.
        const delta = this.computeAttributesDelta(
          (existing.attributes as Record<string, unknown>) ?? {},
          dto.attributes ?? {},
        );
        const deltaAttrs: Record<string, unknown> = {};
        for (const key of delta) deltaAttrs[key] = mergedAttrs[key];
        this.validateAttributeValues(deltaAttrs, applicableSchema);
        this.validateLinkedSelects(mergedAttrs, applicableSchema, delta);

        // type is immutable (not on UpdateListingDto) — but categoryId can still change,
        // so a listing's fixed type must stay allowed by whatever category it moves into.
        if (dto.categoryId !== undefined) {
          this.validateListingTypeAllowed(
            existing.type,
            category.allowedListingType,
            category.parent?.allowedListingType,
          );
        }
      }

      // Formato de precio (RP.1) — mismo grandfathering que validateListingTypeAllowed:
      // solo se revalida si el usuario TOCA el formato, o si el anuncio se mueve a
      // otra categoría (donde su formato ya fijado debe seguir siendo válido). Una
      // edición que no toca ninguna de las dos cosas nunca falla, aunque un admin
      // haya restringido la categoría después de publicar el anuncio.
      if (dto.priceUnit !== undefined || dto.categoryId !== undefined) {
        this.validatePriceUnitAllowed(
          dto.priceUnit ?? existing.priceUnit,
          category.allowedPriceUnits,
          category.parent?.allowedPriceUnits,
        );
      }

      // B2 — TAGS. Mismo grandfathering que los dos bloques de arriba, con una
      // asimetría deliberada entre los dos disparadores:
      //
      //  · `dto.tags` presente → el usuario ELIGIÓ estos tags: se validan estrictos
      //    contra la nueva categoría y el tope vigente. Un tag ajeno o pasarse del
      //    tope es un 422, porque el usuario puede corregirlo.
      //
      //  · solo cambia `categoryId` → el usuario NO eligió romper nada, movió el
      //    anuncio. Los tags que la categoría destino no ofrece se PODAN en silencio
      //    y la edición pasa. Rechazarla obligaría a limpiar tags a mano antes de
      //    poder mover un anuncio, que es exactamente el tipo de fricción que el
      //    grandfathering de los atributos ya evita.
      //
      // Un PATCH que no toca ni `tags` ni `categoryId` no entra aquí: un anuncio con 8
      // tags y un tope nuevo de 5 sigue editándose sin problema.
      if (dto.tags !== undefined) {
        tagIds = await this.tags.resolveTagsForListing(dto.tags, category.slug);
      } else if (dto.categoryId !== undefined) {
        const actuales = await this.prisma.listingTag.findMany({
          where: { listingId: id },
          select: { tagId: true },
        });
        tagIds = await this.tags.pruneTagsForCategory(
          actuales.map((t) => t.tagId),
          category.slug,
        );
      }
    }

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
        ...(fields.phone !== undefined && { phone: fields.phone }),
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
      },
    });

    if (imageIds !== undefined) {
      await this.prisma.listingImage.updateMany({
        where: { listingId: id, id: { notIn: imageIds } },
        data: { listingId: null, order: 0 },
      });
      if (imageIds.length) {
        await this.linkImages(id, userId, imageIds);
      }
    }

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
    return listing;
  }

  async publish(id: string, userId: string): Promise<Listing> {
    const existing = await this.assertOwnership(id, userId);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Solo se pueden publicar anuncios en estado DRAFT');
    }

    // Content filter — if the list is empty or service fails, targetStatus stays
    // ACTIVE. Moderation is a helper layer and must never block publication.
    let targetStatus: 'ACTIVE' | 'PENDING_REVIEW' = 'ACTIVE';
    try {
      const flagged = await this.badWordService.hasBadWords(
        existing.title,
        existing.description,
      );
      if (flagged) targetStatus = 'PENDING_REVIEW';
    } catch (_err) {
      // Silent fallback — publication continues normally.
    }

    // RF.7: enforce active listing limit before activating.
    if (targetStatus === 'ACTIVE') {
      await this.checkActiveListingLimit(userId);
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

    // RF.7: renewing brings the listing back to ACTIVE — counts against the limit
    // the same as publishing (Opción A). A slot is a slot regardless of origin.
    await this.checkActiveListingLimit(userId);

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

    await this.checkActiveListingLimit(userId);

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
   * cuenta para la cuota (`checkActiveListingLimit` cuenta solo `status: ACTIVE`),
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
    // ANTES de abrir la transacción: `checkActiveListingLimit` hace su propio
    // count y lanza; dejarlo dentro solo alargaría la transacción para acabar
    // haciéndole rollback.
    const volveraAActivo = existing.type === 'PRODUCT' && existing.status === 'SOLD';
    if (volveraAActivo) {
      await this.checkActiveListingLimit(sellerId);
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
      include: LISTING_INCLUDE,
    });
    if (!listing) throw new NotFoundException('Anuncio no encontrado');
    if (listing.sellerId !== userId) {
      throw new ForbiddenException('No tienes permiso sobre este anuncio');
    }
    // B2 — se aplana igual que en findBySlug: la tabla puente es un detalle de
    // almacenamiento, y el wizard de edición espera la misma forma (TagRef[]) que la
    // ficha pública. Si una devolviera `{tag:{…}}` y la otra no, el front tendría que
    // saber por qué endpoint llegó cada anuncio.
    const { tags, ...resto } = listing;
    return { ...resto, tags: tags.map((t) => t.tag) };
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

  async remove(id: string, userId: string): Promise<void> {
    const existing = await this.assertOwnership(id, userId);
    await this.prisma.listing.delete({ where: { id } });
    await this.redis.client.del(cacheKey(existing.slug));
    await this.indexingQueue.add('remove', { listingId: id });
  }

  async findBySlug(slug: string) {
    const raw = await this.redis.client.get(cacheKey(slug));
    let listingData: object & { id: string };

    if (raw) {
      listingData = JSON.parse(raw) as object & { id: string };
    } else {
      const listing = await this.prisma.listing.findUnique({
        where: { slug },
        include: LISTING_INCLUDE,
      });
      if (!listing || listing.status !== 'ACTIVE') {
        throw new NotFoundException('Anuncio no encontrado');
      }
      // PRIVACIDAD — CRÍTICO: phone se descarta aquí, antes de cachear y de
      // devolver nada. No hay una capa de serialización posterior que lo
      // filtre — este destructuring ES el único punto donde se garantiza que
      // el teléfono nunca viaja en el payload público de la ficha (ni en
      // Redis ni en la respuesta). hasPhone es lo único que se expone, para
      // pintar el botón "Ver teléfono" sin revelar el número.
      // B2 — `tags` se APLANA aquí, antes de cachear: la ficha quiere TagRef[], no la
      // tabla puente. Este es el mismo punto donde `phone` ya se descarta, así que la
      // forma pública del payload se decide en un solo sitio.
      //
      // OJO con la caché: los blobs guardados antes de B2 no llevan `tags`. Se
      // autocorrige al expirar (5 min) y el frontend lo trata como opcional — mismo
      // precedente que `category.parent` en A1.
      const { phone, tags, ...publicListing } = listing;
      const listingToCache = {
        ...publicListing,
        hasPhone: Boolean(phone),
        tags: tags.map((t) => t.tag),
      };
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
    // El OR de aquí es el equivalente en Postgres de ese categoryPath, con el mismo
    // supuesto de 2 niveles (hoja → padre) que todo lo demás. Para una categoría hoja
    // la segunda rama no casa con nada y el resultado es idéntico al de antes.
    const where = {
      status: 'ACTIVE' as const,
      category: {
        OR: [{ slug: categorySlug }, { parent: { slug: categorySlug } }],
      },
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
    const items = await this.enrichWithSellerRating(rows.map((r) => this.toSummary(r)));
    return { items, total, page, perPage };
  }

  async findBySellerSlug(sellerSlug: string, page = 1, perPage = 24) {
    const where = { status: 'ACTIVE' as const, seller: { slug: sellerSlug } };
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
    const items = await this.enrichWithSellerRating(rows.map((r) => this.toSummary(r)));
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
    const items = await this.enrichWithSellerRating(rows.map((r) => this.toSummary(r)));
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
        select: SELECT_SUMMARY,
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

    return {
      counts,
      items: rows.map((r) => ({
        ...this.toSummary(r),
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

  /**
   * Escaparate RÁFAGA 4 — enriquece una página de summaries con la media
   * verificada de sus vendedores, en UNA sola consulta agrupada por los
   * sellerId distintos de esa página (nunca N+1 por listing). Medido: ver
   * ReviewsService.getRatingSummaries. `average: null` (0 verificadas) es la
   * señal de "Nuevo" que consume el frontend — no se convierte a 0 aquí.
   */
  private async enrichWithSellerRating<T extends { sellerId: string }>(
    items: T[],
  ): Promise<(T & { sellerRatingAverage: number | null; sellerRatingCount: number })[]> {
    const sellerIds = [...new Set(items.map((i) => i.sellerId))];
    const ratings = await this.reviews.getRatingSummaries(sellerIds);
    return items.map((item) => {
      const rating = ratings.get(item.sellerId);
      return {
        ...item,
        sellerRatingAverage: rating?.average ?? null,
        sellerRatingCount: rating?.count ?? 0,
      };
    });
  }

  private toSummary({ images, bumpedAt, attributes, category, videoUrl, ...rest }: SummaryDbRow) {
    return {
      ...rest,
      // SOLO EL BOOLEANO. `videoUrl` se desestructura fuera a propósito, para que no pueda
      // colarse en `...rest`: una tarjeta que recibiera la dirección podría descargar el
      // vídeo, y el cero-bytes-en-listas dejaría de ser una garantía estructural.
      hasVideo: videoUrl != null,
      thumbnailUrl: images[0]?.url ?? undefined,
      bumpedAt: bumpedAt?.toISOString() ?? undefined,
      categorySlug: category.slug,
      attributes: (attributes as Record<string, unknown>) ?? {},
    };
  }

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
      select: { id: true, sellerId: true, viewCount: true },
    });
    if (!listing) throw new NotFoundException('Anuncio no encontrado');
    if (listing.sellerId !== userId) {
      throw new ForbiddenException('No tienes permiso sobre este anuncio');
    }

    const favoritesCount = await this.prisma.favorite.count({ where: { listingId: id } });
    const isPro = await this.entitlementService.isProActive(userId);
    if (!isPro) {
      return { viewCount: listing.viewCount, favoritesCount };
    }

    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 30);
    since.setUTCHours(0, 0, 0, 0);

    const dailyRows = await this.prisma.listingViewDaily.findMany({
      where: { listingId: id, date: { gte: since } },
      orderBy: { date: 'asc' },
      select: { date: true, count: true },
    });

    return {
      viewCount: listing.viewCount,
      favoritesCount,
      dailyViews: dailyRows,
      likeRatio: listing.viewCount > 0 ? favoritesCount / listing.viewCount : 0,
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

  private validateRequired(
    attributes: Record<string, unknown>,
    schema: AttributeField[],
  ): void {
    const missing = schema
      .filter((f) => f.required && !Object.prototype.hasOwnProperty.call(attributes, f.name))
      .map((f) => f.name);
    if (missing.length) {
      throw new UnprocessableEntityException(
        `Atributos requeridos faltantes: ${missing.join(', ')}`,
      );
    }
  }

  /**
   * Refuerzo de validación (cierra la asimetría con validateLinkedSelects,
   * que ya valida sus valores desde R5): claves desconocidas, opciones de
   * select PLANO, y tipo de dato. Los selects vinculados (`dependsOn`) se
   * saltan aquí — los valida `validateLinkedSelects`. Presencia/required-ness
   * es trabajo de `validateRequired`, no de esta función.
   *
   * `attributes` puede ser el bag completo (create) o solo el delta (update)
   * — el caller decide qué subconjunto pasar; esta función valida lo que
   * recibe sin distinguir el origen.
   */
  private validateAttributeValues(
    attributes: Record<string, unknown>,
    schema: AttributeField[],
  ): void {
    const byName = new Map(schema.map((f) => [f.name, f]));

    const unknown = Object.keys(attributes).filter((k) => !byName.has(k));
    if (unknown.length) {
      throw new UnprocessableEntityException(
        `Atributos no reconocidos: ${unknown.join(', ')}`,
      );
    }

    for (const field of schema) {
      if (field.dependsOn) continue; // vinculados: los valida validateLinkedSelects
      if (!(field.name in attributes)) continue;
      const value = attributes[field.name];
      if (value === null || value === undefined || value === '') continue;

      if (field.type === 'select') {
        if (!(field.options ?? []).includes(String(value))) {
          throw new UnprocessableEntityException(
            `"${value}" no es una opción válida de "${field.label}".`,
          );
        }
      } else if (field.type === 'number') {
        const n = typeof value === 'number' ? value : Number(value);
        if (typeof value === 'boolean' || value === '' || Number.isNaN(n)) {
          throw new UnprocessableEntityException(`"${field.label}" debe ser un número.`);
        }
      } else if (field.type === 'boolean') {
        if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
          throw new UnprocessableEntityException(`"${field.label}" debe ser verdadero/falso.`);
        }
      }
      // text: cualquier string vale, sin refuerzo adicional.
    }
  }

  /**
   * Una clave cuenta como "delta" (cambiada en ESTA petición) si su valor en
   * el payload entrante difiere del ya guardado, o es una clave nueva. Una
   * clave reenviada con el MISMO valor no es delta — así update() puede
   * recibir el bag completo (como hace EditarWizard, incondicionalmente) sin
   * que eso re-valide datos preexistentes que el usuario ni toca.
   * JSON.stringify en vez de `===`: los 4 tipos de atributo son siempre
   * primitivos planos, nunca objetos/arrays anidados, así que es suficiente
   * y cubre null/undefined sin casos especiales.
   */
  private computeAttributesDelta(
    existingAttrs: Record<string, unknown>,
    incomingAttrs: Record<string, unknown>,
  ): Set<string> {
    const changed = new Set<string>();
    for (const [key, value] of Object.entries(incomingAttrs)) {
      if (
        !Object.prototype.hasOwnProperty.call(existingAttrs, key) ||
        JSON.stringify(existingAttrs[key]) !== JSON.stringify(value)
      ) {
        changed.add(key);
      }
    }
    return changed;
  }

  /**
   * Enforces linked selects (`AttributeField.dependsOn` / `optionsByParent`):
   * a dependent field's value must belong to its parent's currently-chosen
   * value. Deliberately asymmetric with `validateAttributeValues` — plain
   * attributes not present in the schema are tolerated, but a *linked* field
   * with a value must resolve against its parent within the SAME payload.
   * Only fields that actually carry a value are checked; presence/required-ness
   * is `validateRequired`'s job.
   *
   * `deltaKeys` — solo en update(): si ni el campo ni su padre (`dependsOn`)
   * cambiaron en esta petición, el par no se re-valida, aunque ya fuera
   * inválido (grandfathering, igual que `validateAttributeValues`). Ausente
   * en create() — ahí se valida siempre, no hay "existing" con el que
   * comparar. `attributes` sigue siendo el bag COMPLETO (fusionado) en
   * ambos casos: se necesita para resolver el valor ACTUAL del padre,
   * aunque no haya cambiado en esta petición.
   */
  private validateLinkedSelects(
    attributes: Record<string, unknown>,
    schema: AttributeField[],
    deltaKeys?: Set<string>,
  ): void {
    for (const field of schema) {
      if (!field.dependsOn) continue;
      if (deltaKeys && !deltaKeys.has(field.name) && !deltaKeys.has(field.dependsOn)) continue;

      const rawValue = attributes[field.name];
      if (rawValue === undefined || rawValue === null || rawValue === '') continue;
      const value = String(rawValue);

      const parentRaw = attributes[field.dependsOn];
      if (parentRaw === undefined || parentRaw === null || parentRaw === '') {
        const parentLabel =
          schema.find((f) => f.name === field.dependsOn)?.label ?? field.dependsOn;
        throw new UnprocessableEntityException(
          `"${field.label}" requiere seleccionar primero "${parentLabel}".`,
        );
      }

      const validOptions = resolveLinkedOptions(field, String(parentRaw));
      if (!validOptions.includes(value)) {
        throw new UnprocessableEntityException(
          `"${value}" no es una opción válida de "${field.label}" para el valor elegido.`,
        );
      }
    }
  }

  /**
   * Validates a listing's type against its category's effective ListingTypePolicy
   * (own + parent, same 2-level depth as resolveEffectiveSchema). Every existing
   * category defaults to BOTH, so this is a no-op until an admin restricts one.
   */
  private validateListingTypeAllowed(
    type: Listing['type'],
    ownPolicy: ListingTypePolicy,
    parentPolicy: ListingTypePolicy | undefined,
  ): void {
    const effective = resolveEffectivePolicy(ownPolicy, parentPolicy ?? 'BOTH');
    if (!isListingTypeAllowed(effective, type)) {
      throw new UnprocessableEntityException(
        `Esta categoría no admite anuncios de tipo ${type}.`,
      );
    }
  }

  /**
   * Validates a listing's price format against its category's effective list of
   * allowed formats (own + parent, same 2-level depth as resolveEffectiveSchema).
   * Every existing category defaults to `[]` = not configured, which resolves to
   * DEFAULT_ALLOWED_PRICE_UNITS (`[ONE_TIME]`) — and every existing listing is
   * ONE_TIME — so this is a no-op until an admin configures a category.
   *
   * The parent is resolved against `null` first (not against the child's own
   * list): `resolveEffectivePriceUnits` is an override, so feeding the child's
   * value in as the parent's fallback would make an unconfigured parent shadow
   * the global default. Same two-step shape used by findBySlug for allowedViews.
   */
  private validatePriceUnitAllowed(
    unit: PriceUnit,
    ownAllowed: PriceUnit[],
    parentAllowed: PriceUnit[] | undefined,
  ): void {
    const effective = resolveEffectivePriceUnits(
      ownAllowed,
      parentAllowed ? resolveEffectivePriceUnits(parentAllowed, null) : null,
    );
    if (!isPriceUnitAllowed(effective, unit)) {
      throw new UnprocessableEntityException(
        `Esta categoría no admite el formato de precio ${unit}.`,
      );
    }
  }

  /**
   * RF.7 — la cuota de anuncios activos del plan (free/pro, desde Setting).
   *
   * QUIÉN LA COMPRUEBA (RÁFAGA A2). Todos los caminos de VENDEDOR que dejan un
   * anuncio en ACTIVE: `publish`, `renew`, `reactivate` y —nuevo en esta
   * ráfaga— `undoDeal`. Antes, deshacer un trato devolvía un PRODUCT de SOLD a
   * ACTIVE sin mirar la cuota: un vendedor en el tope podía vender, deshacer y
   * quedarse con un activo de más, indefinidamente.
   *
   * QUIÉN NO, Y ES DELIBERADO — POLÍTICA DE STAFF, PENDIENTE DE DECISIÓN.
   * `ModerationService.approveListing`, `ModerationService.restoreListing` y
   * `AdminService.changeListingStatus` NO la comprueban. Eso ya era así antes de
   * esta ráfaga, pero de FACTO y sin declararlo en ningún sitio; queda escrito
   * aquí para que sea una política y no un olvido.
   *
   * Se mantiene sin cambios A PROPÓSITO: cerrarla tiene una consecuencia real
   * que hay que querer, no heredar — si el vendedor llena su cupo mientras su
   * anuncio espera revisión, el moderador ya NO podría aprobarlo, y el trabajo
   * de staff quedaría rehén de la cuota de un tercero. Es una decisión de
   * producto (¿el staff puede exceder el plan del vendedor?), no un bug, y va
   * con la puerta de validación — ver docs/auditoria-puerta-validacion.md, D3.
   *
   * `closeDeal` tampoco la comprueba; el porqué está en su propio método.
   */
  private async checkActiveListingLimit(userId: string): Promise<void> {
    const isPro = await this.entitlementService.isProActive(userId);
    const settingKey = isPro ? 'proActiveListingLimit' : 'freeActiveListingLimit';
    const defaultLimit = isPro ? 20 : 5;

    const setting = await this.prisma.setting.findUnique({ where: { key: settingKey } });
    const limit = setting ? Number(setting.value) : defaultLimit;

    const activeCount = await this.prisma.listing.count({
      where: { sellerId: userId, status: 'ACTIVE' },
    });

    if (activeCount >= limit) {
      throw new ForbiddenException(
        `Has alcanzado el límite de ${limit} anuncios activos de tu plan`,
      );
    }
  }

  private async linkImages(
    listingId: string,
    userId: string,
    imageIds: string[],
  ): Promise<void> {
    const images = await this.prisma.listingImage.findMany({
      where: { id: { in: imageIds } },
      select: { id: true, uploadedById: true, listingId: true },
    });

    const notFound = imageIds.filter((imgId) => !images.some((img) => img.id === imgId));
    if (notFound.length) {
      throw new UnprocessableEntityException(
        `Imágenes no encontradas: ${notFound.join(', ')}`,
      );
    }

    for (const img of images) {
      if (img.uploadedById !== userId) {
        throw new UnprocessableEntityException(
          `La imagen ${img.id} no pertenece al usuario`,
        );
      }
      if (img.listingId !== null && img.listingId !== listingId) {
        throw new UnprocessableEntityException(
          `La imagen ${img.id} ya está vinculada a otro anuncio`,
        );
      }
    }

    await Promise.all(
      imageIds.map((imgId, order) =>
        this.prisma.listingImage.update({
          where: { id: imgId },
          data: { listingId, order },
        }),
      ),
    );
  }
}
