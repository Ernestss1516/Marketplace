import { BadRequestException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { HomepageConfig, Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { RevalidateService } from '../../common/revalidate/revalidate.service';
import { R2Service } from '../../infra/r2/r2.service';
import { MediaCleanupService } from '../media-cleanup/media-cleanup.service';
import { MIME_TO_EXT } from '../media/media.service';
import { UpdateHomepageDto } from './dto/update-homepage.dto';
import { HomeBlockDto } from './dto/blocks';

/**
 * Tag de caché de la portada en el frontend (unstable_cache). UNA sola entrada
 * con clave constante —a diferencia del nav, que tiene nueve, una por
 * NavPageType— porque `GET /homepage` no filtra nada. Molde exacto del footer:
 * ver apps/web/src/lib/api/homepage.ts y footer.ts:31-35.
 */
export const HOMEPAGE_CACHE_TAG = 'homepage-config';

/**
 * ID de la fila única. TODO acceso pasa por aquí: `findUnique` en lectura,
 * `upsert` en escritura, y NUNCA se expone create ni delete. Así "exactamente
 * una fila" no depende de que nadie se equivoque.
 */
const SINGLETON_ID = 'singleton';

/** Tope de bloques `listings` por portada: cada uno es una consulta a
 *  Meilisearch en cada render. Mismo número que el blog. */
const MAX_LISTINGS_BLOCKS = 4;

/**
 * Config servida cuando la fila no existe (base sin sembrar, entorno recién
 * levantado). NO se escribe: se devuelve. Un `GET /homepage` nunca es 404 ni
 * 500 por esto — la portada es la ruta más visitada del sitio y no puede
 * depender de que alguien se acordase de correr el seed. Misma doctrina de
 * "degrada, nunca rompe" que el `.catch(() => [])` del footer y del nav.
 *
 * Reproduce el <h1> que la home pinta hoy a mano ((home)/page.tsx:51-53).
 */
export const DEFAULT_HOMEPAGE_CONFIG = {
  id: SINGLETON_ID,
  heroStaticTitle: 'Compra y vende de segunda mano',
  heroRotatingOptions: [] as string[],
  heroRotationMs: 3000,
  heroSubtitle: null as string | null,
  blocks: [] as unknown[],
} as const;

export type PublicHomepageConfig = Omit<HomepageConfig, 'updatedById'>;

@Injectable()
export class HomepageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly revalidateService: RevalidateService,
    private readonly r2: R2Service,
    private readonly mediaCleanup: MediaCleanupService,
  ) {}

  // ── Lectura ───────────────────────────────────────────────────────────────

  /**
   * Una sola query. Público y de admin leen lo MISMO: sin borrador/publicado no
   * hay nada que filtrar (a diferencia del footer y del nav, que sí tienen una
   * lectura pública podada y otra de admin sin podar).
   */
  async get(): Promise<PublicHomepageConfig> {
    const row = await this.prisma.homepageConfig.findUnique({ where: { id: SINGLETON_ID } });
    if (!row) return { ...DEFAULT_HOMEPAGE_CONFIG, updatedAt: new Date() } as PublicHomepageConfig;
    const { updatedById: _updatedById, ...rest } = row;
    return rest;
  }

  // ── Escritura ─────────────────────────────────────────────────────────────

  /**
   * Reemplazo COMPLETO de la config. `upsert`, nunca `update`: si la fila no
   * existe (base sin sembrar) el primer guardado la crea, en vez de fallar con
   * un P2025 que el admin no puede interpretar ni arreglar.
   */
  async update(dto: UpdateHomepageDto, actorId: string, ip?: string): Promise<PublicHomepageConfig> {
    const heroStaticTitle = dto.heroStaticTitle.trim();
    // @IsNotEmpty solo rechaza la cadena vacía: "   " la pasa y dejaría la
    // portada con un <h1> en blanco, que es justo lo que el campo obligatorio
    // existe para impedir.
    if (!heroStaticTitle) {
      throw new BadRequestException('El título del hero no puede estar vacío');
    }

    const heroRotatingOptions = (dto.heroRotatingOptions ?? []).map((o) => o.trim()).filter(Boolean);
    const blocks = dto.blocks ?? [];
    await this.assertBlocksValid(blocks);

    const before = await this.prisma.homepageConfig.findUnique({ where: { id: SINGLETON_ID } });

    const data = {
      heroStaticTitle,
      heroRotatingOptions,
      heroRotationMs: dto.heroRotationMs ?? DEFAULT_HOMEPAGE_CONFIG.heroRotationMs,
      // Ausente = se borra, no "se conserva": el cuerpo es un reemplazo completo
      // (ver UpdateHomepageDto).
      heroSubtitle: dto.heroSubtitle?.trim() || null,
      blocks: blocks as unknown as Prisma.InputJsonValue,
      updatedById: actorId,
    };

    const updated = await this.prisma.homepageConfig.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, ...data },
      update: data,
    });

    await this.auditLog.log({
      action: 'HOMEPAGE_CONFIG_UPDATE',
      actorId,
      resourceType: 'HomepageConfig',
      resourceId: SINGLETON_ID,
      // Solo el resumen, no el Json entero de bloques: un AuditLog no es un
      // historial de versiones y una portada con 30 bloques lo llenaría de ruido.
      before: before
        ? {
            heroStaticTitle: before.heroStaticTitle,
            heroRotatingOptions: before.heroRotatingOptions,
            heroRotationMs: before.heroRotationMs,
            blockCount: Array.isArray(before.blocks) ? before.blocks.length : 0,
          }
        : undefined,
      after: {
        heroStaticTitle: updated.heroStaticTitle,
        heroRotatingOptions: updated.heroRotatingOptions,
        heroRotationMs: updated.heroRotationMs,
        blockCount: blocks.length,
      },
      ip,
    });

    // HUÉRFANAS H1 — las imágenes que se han quedado FUERA de los bloques. Suben por
    // `uploadImage` a `homepage/` y no tienen fila propia: al guardar la portada sin
    // un bloque, su imagen quedaba suelta en el bucket. El cuerpo es un REEMPLAZO
    // COMPLETO, así que el diff entre el `Json` de antes y el de ahora es exactamente
    // «lo que ha salido». `before` ya estaba leído para el AuditLog: ninguna consulta
    // nueva.
    await this.mediaCleanup.purgeReleased({
      before: before?.blocks ?? null,
      after: updated.blocks,
      origen: 'homepage',
    });

    // Sin excepción, igual que NavService y FooterService: toda mutación
    // revalida. La PÁGINA sigue siendo dinámica (auth() del layout raíz); lo
    // único cacheado —y por tanto lo único que hay que tumbar— es la config.
    this.revalidateService.revalidateTag(HOMEPAGE_CACHE_TAG);

    const { updatedById: _updatedById, ...rest } = updated;
    return rest;
  }

  // Molde BlogService.uploadBlockImage → SponsoredAdsService.uploadImage: sube
  // directo a R2, sin crear ninguna fila. Prefijo propio `homepage/` para
  // distinguir estas imágenes de las de bloques de blog en el bucket.
  //
  // Endpoint PROPIO y no el del blog a propósito: aquel admite EDITOR/MODERATOR
  // (blog-admin.controller.ts:69) y la portada es configuración, solo ADMIN. Que
  // el rol de subir coincida con el rol de poder usar lo subido.
  async uploadImage(file: Express.Multer.File): Promise<{ url: string }> {
    const ext = MIME_TO_EXT[file.mimetype];
    if (!ext) throw new UnprocessableEntityException('File type not allowed. Use JPEG, PNG or WebP.');

    const key = `homepage/${randomBytes(16).toString('hex')}${ext}`;
    await this.r2.upload(key, file.buffer, file.mimetype);
    return { url: this.r2.getPublicUrl(key) };
  }

  // ── Reglas cruzadas (nivel 3 de la validación) ────────────────────────────
  //
  // Lo que depende del array COMPLETO o de estado externo no cabe en un
  // decorador de campo — mismo criterio que BlogService.assertListingsBlocksValid
  // (blog.service.ts:389-395).
  //
  private async assertBlocksValid(blocks: HomeBlockDto[]): Promise<void> {
    // Ids duplicados: el array se reordena y se edita por id en el editor, y
    // React los usa como key. Dos bloques con el mismo id producen ediciones
    // que saltan de un bloque a otro. El motor del blog no lo comprueba; aquí
    // sí, porque es barato y el síntoma es desconcertante.
    const ids = new Set<string>();
    for (const block of blocks) {
      if (ids.has(block.id)) {
        throw new BadRequestException(`Bloque duplicado: hay más de un bloque con id "${block.id}"`);
      }
      ids.add(block.id);
    }

    // Dos buscadores en la portada es un error de configuración, no un caso de
    // uso (docs/diseno-portada.md §2.5).
    const searchBlocks = blocks.filter((b) => b.type === 'search');
    if (searchBlocks.length > 1) {
      throw new BadRequestException('Solo puede haber un bloque de buscador en la portada');
    }

    // Guardarraíl: cada bloque `listings` es una consulta a Meilisearch en CADA
    // render de la portada. Se limita el NÚMERO de bloques, no el tamaño de cada
    // consulta (de eso ya se ocupa `limit` con su @IsIn). Mismo criterio y mismo
    // número que MAX_LISTINGS_BLOCKS_PER_PAGE del blog.
    const listingsBlocks = blocks.filter((b) => b.type === 'listings');
    if (listingsBlocks.length > MAX_LISTINGS_BLOCKS) {
      throw new BadRequestException(
        `Máximo ${MAX_LISTINGS_BLOCKS} bloques de anuncios en la portada`,
      );
    }

    // Dos tablas de búsquedas duplicarían cientos de enlaces internos: en vez de
    // sumar SEO, lo diluyen (docs/diseno-portada.md §2.5).
    const searchTables = blocks.filter((b) => b.type === 'searchTable');
    if (searchTables.length > 1) {
      throw new BadRequestException('Solo puede haber una tabla de búsquedas en la portada');
    }

    // Y dentro de una tabla, cada CLASE de pestaña una sola vez: son tres
    // fuentes distintas, repetir una no significa nada.
    for (const tabla of searchTables) {
      const kinds = tabla.tabs.map((t) => t.kind);
      if (new Set(kinds).size !== kinds.length) {
        throw new BadRequestException('La tabla de búsquedas no puede repetir una pestaña');
      }
    }

    // Toda categoría referenciada tiene que existir. Depende de estado EXTERNO
    // (la tabla Category), así que no cabe en un decorador — molde
    // BlogService.assertListingsBlocksValid. UNA sola consulta para todos los
    // slugs del array, vengan del bloque que vengan.
    const slugs = new Set<string>();
    for (const block of blocks) {
      if (block.type === 'listings' && block.categorySlug) slugs.add(block.categorySlug);
      if (block.type === 'categoryCarousel') {
        for (const item of block.items) slugs.add(item.categorySlug);
      }
      if (block.type === 'searchTable') {
        for (const tab of block.tabs) {
          if (tab.kind === 'combos') for (const c of tab.items) slugs.add(c.categorySlug);
        }
      }
    }

    if (slugs.size > 0) {
      const found = await this.prisma.category.findMany({
        where: { slug: { in: [...slugs] } },
        select: { slug: true },
      });
      const foundSlugs = new Set(found.map((c) => c.slug));
      const missing = [...slugs].filter((s) => !foundSlugs.has(s));
      if (missing.length > 0) {
        throw new BadRequestException(`Categoría(s) no encontrada(s): ${missing.join(', ')}`);
      }
    }
  }
}
