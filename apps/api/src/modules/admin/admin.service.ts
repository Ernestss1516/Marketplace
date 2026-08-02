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
import { QUEUE_INDEXING } from '../../infra/queue/queue.constants';
import { ListAdminListingsDto } from './dto/list-admin-listings.dto';
import { ChangeListingStatusDto } from './dto/change-listing-status.dto';
import { ListAdminUsersDto } from './dto/list-admin-users.dto';
import { ChangeUserRoleDto } from './dto/change-user-role.dto';
import { SetUserTrustedDto } from './dto/set-user-trusted.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { ReorderCategoriesDto } from './dto/reorder-categories.dto';
import { UpdateSettingDto } from './dto/update-setting.dto';
import { AttributeField, resolveEffectiveSchema, countAttributesByType } from '../categories/category.types';
import { FilterableAttributesResolver } from '../search/filterable-attributes.resolver';

const cacheKey = (slug: string) => `listing:${slug}`;

// Mirrors the constant in SearchService — must stay in sync with MEILI_INDEX_NAME env.
const LISTINGS_INDEX = process.env.MEILI_INDEX_NAME ?? 'listings';

// Keys the admin is allowed to update via PATCH /admin/settings/:key.
const SETTING_KEYS = [
  'badWordList',
  'listingExpiryDays',
  'contactRequiresVerification',
  // RF.7: active listing limits per plan
  'freeActiveListingLimit',
  'proActiveListingLimit',
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
];

// Keys whose value is a percentage: integer in [0, 100]. 0 is valid (disables
// the Pro bonus without removing the key); >100 would gift more credits than
// the pack costs, which is never intended.
const PERCENT_SETTING_KEYS: readonly string[] = ['proExtraCreditsPercent', 'proExtraBumpsPercent'];

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

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly meili: MeilisearchService,
    private readonly auditLog: AuditLogService,
    private readonly attributesResolver: FilterableAttributesResolver,
    @InjectQueue(QUEUE_INDEXING) private readonly indexingQueue: Queue,
  ) {}

  // ===========================================================================
  // Listings (R7.4)
  // ===========================================================================

  async listListings(query: ListAdminListingsDto) {
    const { status, categoryId, sellerId, page = 1, perPage = 24 } = query;
    const where: Prisma.ListingWhereInput = {
      ...(status && { status }),
      ...(categoryId && { categoryId }),
      ...(sellerId && { sellerId }),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.listing.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
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
          },
        },
        reports: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: {
            reporter: { select: { id: true, name: true, slug: true } },
          },
        },
        _count: { select: { conversations: true } },
      },
    });
    if (!listing) throw new NotFoundException('Anuncio no encontrado');
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

  // ===========================================================================
  // Users (R7.4)
  // ===========================================================================

  async listUsers(query: ListAdminUsersDto) {
    const { status, role, q, page = 1, perPage = 24 } = query;
    const where: Prisma.UserWhereInput = {
      ...(status && { status }),
      ...(role && { role }),
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
        orderBy: { createdAt: 'desc' },
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
        updatedAt: true,
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
      },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    // AuditLogs where this user is the subject (actions taken against them).
    const auditLogs = await this.prisma.auditLog.findMany({
      where: { resourceType: 'User', resourceId: id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        actor: { select: { id: true, name: true, slug: true } },
      },
    });

    return { ...user, auditLogs };
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

    const updated = await this.prisma.user.update({
      where: { id: targetId },
      data: { role: dto.role },
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

  // ===========================================================================
  // Categories (R7.5)
  // ===========================================================================

  getCategories() {
    return this.prisma.category.findMany({
      where: { parentId: null },
      orderBy: { order: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        iconUrl: true,
        order: true,
        attributeSchema: true,
        allowedListingType: true,
        allowedViews: true,
        defaultView: true,
        // RP.2 — valor CRUDO (propio de la categoría), no el efectivo: el admin
        // edita lo que esta categoría configura, no lo que hereda. Mismo
        // criterio que allowedListingType y allowedViews en este árbol; el
        // resuelto solo lo sirve el findBySlug público, para el wizard.
        allowedPriceUnits: true,
        children: {
          orderBy: { order: 'asc' },
          select: {
            id: true,
            name: true,
            slug: true,
            iconUrl: true,
            order: true,
            attributeSchema: true,
            allowedListingType: true,
            allowedViews: true,
            defaultView: true,
            allowedPriceUnits: true,
          },
        },
      },
    });
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
    let parentSchema: AttributeField[] = [];
    if (parentId) {
      const parent = await this.prisma.category.findUnique({
        where: { id: parentId },
        select: { attributeSchema: true },
      });
      if (parent) parentSchema = (parent.attributeSchema as unknown as AttributeField[]) ?? [];
    }
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
    const vecinos: AttributeField[] = [];

    if (parentId) {
      const parent = await this.prisma.category.findUnique({
        where: { id: parentId },
        select: { attributeSchema: true },
      });
      if (parent) vecinos.push(...((parent.attributeSchema as unknown as AttributeField[]) ?? []));
    }
    if (categoryId) {
      const hijas = await this.prisma.category.findMany({
        where: { parentId: categoryId },
        select: { attributeSchema: true },
      });
      for (const hija of hijas) {
        vecinos.push(...((hija.attributeSchema as unknown as AttributeField[]) ?? []));
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
    const children = await this.prisma.category.findMany({
      where: { parentId: categoryId },
      select: { id: true, name: true, attributeSchema: true },
    });
    if (children.length === 0) return;

    const checks: Array<{ flag: 'cardAttribute' | 'wideCardAttribute'; limit: number }> = [
      { flag: 'cardAttribute', limit: 2 },
      { flag: 'wideCardAttribute', limit: 6 },
    ];

    for (const child of children) {
      const childSchema = (child.attributeSchema as unknown as AttributeField[]) ?? [];
      const effective = resolveEffectiveSchema(childSchema, newOwnSchema);
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
   * Hacia arriba: una política propia no puede contradecir la del padre ya
   * persistido. Árbol de 2 niveles (parentId inmutable) — la política del
   * padre es su valor propio, sin resolución recursiva. Guard explícito que
   * LANZA; no reutiliza resolveEffectivePolicy (esa función es defensiva y
   * nunca lanza, pensada para la lectura en tiempo de creación de anuncios).
   */
  private async assertPolicyConsistentWithParent(
    own: ListingTypePolicy,
    parentId: string | null | undefined,
  ): Promise<void> {
    if (!parentId || own === 'BOTH') return;
    const parent = await this.prisma.category.findUnique({
      where: { id: parentId },
      select: { allowedListingType: true },
    });
    if (parent && parent.allowedListingType !== 'BOTH' && parent.allowedListingType !== own) {
      throw new BadRequestException(
        `La política "${own}" contradice la política del padre ("${parent.allowedListingType}").`,
      );
    }
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

    const children = await this.prisma.category.findMany({
      where: { parentId: categoryId },
      select: { id: true, name: true, allowedListingType: true },
    });

    const contradictingChild = children.find(
      (c) => c.allowedListingType !== 'BOTH' && c.allowedListingType !== newPolicy,
    );
    if (contradictingChild) {
      throw new BadRequestException(
        `No se puede cambiar la política: la subcategoría "${contradictingChild.name}" ya está configurada como ${contradictingChild.allowedListingType}.`,
      );
    }

    // Incluye la propia categoría y TODOS sus hijos: un hijo BOTH hereda la
    // nueva restricción del padre, así que sus anuncios del tipo prohibido
    // quedarían igual de incoherentes que los de la propia categoría.
    const forbiddenType = newPolicy === 'PRODUCT_ONLY' ? 'SERVICE' : 'PRODUCT';
    const categoryIds = [categoryId, ...children.map((c) => c.id)];
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

    // Solo las hijas SIN config propia heredan este cambio; las que tienen la
    // suya son inmunes por el override total — sus anuncios no se ven afectados.
    const children = await this.prisma.category.findMany({
      where: { parentId: categoryId },
      select: { id: true, allowedPriceUnits: true },
    });
    const affectedIds = [
      categoryId,
      ...children.filter((c) => c.allowedPriceUnits.length === 0).map((c) => c.id),
    ];

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
   * Guarda de profundidad (auditoría de herencia de atributos, decisión: opción A,
   * la barata). `Category.parentId` es una auto-relación sin límite de
   * profundidad en el modelo — pero TODA la resolución de herencia
   * (resolveEffectiveSchema y cada consumidor: findTree, findBySlug, el wizard,
   * FilterableAttributesResolver…) asume exactamente 2 niveles (hoja → padre).
   * Antes de esta guarda, un POST con parentId = una categoría que YA tiene
   * padre creaba un nieto que desaparecía por completo de GET /categories
   * (findTree solo recorre raíces + un nivel de hijos) y perdía los atributos
   * del ABUELO en GET /categories/:slug (findBySlug solo fusiona 1 nivel hacia
   * arriba) — en silencio, sin error. La UI del admin ya lo impedía
   * estructuralmente (el botón "Nueva subcategoría" no existe en una fila de
   * hijo); esta guarda cierra el mismo hueco para cualquier llamada directa a
   * la API. Si el negocio necesita 3+ niveles algún día, la alternativa (opción
   * B: generalizar resolveEffectiveSchema a N niveles) se implementa a
   * conciencia entonces — no dejando el modelo permitir hoy lo que la lógica no
   * resuelve.
   */
  private async assertParentIsRoot(parentId: string | null | undefined): Promise<void> {
    if (!parentId) return;
    const parent = await this.prisma.category.findUnique({
      where: { id: parentId },
      select: { parentId: true, name: true },
    });
    if (parent?.parentId) {
      throw new BadRequestException(
        `No se puede crear: "${parent.name}" ya es una subcategoría — el árbol de categorías admite solo 2 niveles (padre → hija).`,
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
    await this.assertParentIsRoot(dto.parentId);
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
      await this.assertPolicyConsistentWithParent(dto.allowedListingType, dto.parentId);
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
      await this.assertPolicyConsistentWithParent(dto.allowedListingType, category.parentId);
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
          ...(dto.allowedViews !== undefined && { allowedViews: dto.allowedViews }),
          ...(defaultViewToWrite !== undefined && { defaultView: defaultViewToWrite }),
          ...(dto.allowedPriceUnits !== undefined && {
            allowedPriceUnits: dto.allowedPriceUnits,
          }),
        },
      });

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

  getSettings() {
    return this.prisma.setting.findMany({ orderBy: { key: 'asc' } });
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
