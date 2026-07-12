import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma, PostStatus, PostType } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { RevalidateService } from '../../common/revalidate/revalidate.service';
import { R2Service } from '../../infra/r2/r2.service';
import { MIME_TO_EXT } from '../media/media.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { ListPublicPostsDto } from './dto/list-public-posts.dto';
import { ListAdminPostsDto } from './dto/list-admin-posts.dto';
import { BlockDto } from './dto/blocks/block.dto';
import { ListingsBlockDto } from './dto/blocks/listings-block.dto';

const MAX_LISTINGS_BLOCKS_PER_PAGE = 4;

const AUTHOR_PUBLIC = { select: { name: true } } as const;
const AUTHOR_ADMIN = { select: { id: true, name: true, email: true } } as const;

@Injectable()
export class BlogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly revalidateService: RevalidateService,
    private readonly r2: R2Service,
  ) {}

  // Molde sponsored-ads (SponsoredAdsService.uploadImage): sube directo a R2,
  // NO crea ListingImage (una imagen de bloque de contenido no es una imagen
  // de anuncio). Prefijo propio `blocks/` para distinguirla en el bucket.
  async uploadBlockImage(file: Express.Multer.File): Promise<{ url: string }> {
    const ext = MIME_TO_EXT[file.mimetype];
    if (!ext) throw new UnprocessableEntityException('File type not allowed. Use JPEG, PNG or WebP.');

    const key = `blocks/${randomBytes(16).toString('hex')}${ext}`;
    await this.r2.upload(key, file.buffer, file.mimetype);
    return { url: this.r2.getPublicUrl(key) };
  }

  // ── Public endpoints ────────────────────────────────────────────────────────
  // listPublished/findBySlug (blog, type=POST) and listPublishedPages/
  // findPageBySlug (páginas, type=PAGE) are thin type-locked wrappers around a
  // single private implementation — one source of truth for "how do we safely
  // query Post", so the two content kinds can't drift apart.

  listPublished(dto: ListPublicPostsDto) {
    return this.listPublishedByType(PostType.POST, dto);
  }

  findBySlug(slug: string) {
    return this.findByTypeAndSlug(PostType.POST, slug);
  }

  listPublishedPages(dto: ListPublicPostsDto) {
    return this.listPublishedByType(PostType.PAGE, dto);
  }

  findPageBySlug(slug: string) {
    return this.findByTypeAndSlug(PostType.PAGE, slug);
  }

  private async listPublishedByType(type: PostType, dto: ListPublicPostsDto) {
    const page = dto.page ?? 1;
    const perPage = dto.perPage ?? 10;
    const skip = (page - 1) * perPage;

    const where = {
      type,
      status: PostStatus.PUBLISHED,
      ...(dto.tag ? { tags: { has: dto.tag } } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.post.findMany({
        where,
        skip,
        take: perPage,
        orderBy: { publishedAt: 'desc' },
        select: {
          id: true,
          title: true,
          slug: true,
          excerpt: true,
          coverUrl: true,
          publishedAt: true,
          updatedAt: true,
          tags: true,
          author: AUTHOR_PUBLIC,
        },
      }),
      this.prisma.post.count({ where }),
    ]);

    return { items, total, page, perPage };
  }

  private async findByTypeAndSlug(type: PostType, slug: string) {
    const post = await this.prisma.post.findFirst({
      where: { slug, type, status: PostStatus.PUBLISHED },
      include: { author: AUTHOR_PUBLIC },
    });
    if (!post) throw new NotFoundException('Post not found');
    return post;
  }

  // ── Admin endpoints ─────────────────────────────────────────────────────────

  async adminCreate(authorId: string, dto: CreatePostDto, ip?: string) {
    const resolvedType = dto.type ?? PostType.POST;
    const slug = dto.slug ?? this.buildSlug(dto.title);
    this.assertTableBlocksValid(dto.blocks);
    await this.assertListingsBlocksValid(dto.blocks);

    const post = await this.prisma.post.create({
      data: {
        type: resolvedType,
        title: dto.title,
        slug,
        excerpt: dto.excerpt,
        blocks: (dto.blocks ?? []) as unknown as Prisma.InputJsonValue,
        coverUrl: dto.coverUrl,
        tags: dto.tags ?? [],
        metaTitle: dto.metaTitle,
        metaDescription: dto.metaDescription,
        authorId,
      },
      include: { author: AUTHOR_ADMIN },
    });

    await this.auditLog.log({
      action: 'POST_CREATE',
      actorId: authorId,
      resourceType: 'Post',
      resourceId: post.id,
      after: { title: post.title, slug: post.slug, status: post.status },
      ip,
    });

    return post;
  }

  async adminFindAll(dto: ListAdminPostsDto) {
    const page = dto.page ?? 1;
    const perPage = dto.perPage ?? 10;
    const skip = (page - 1) * perPage;
    const where = {
      ...(dto.status && { status: dto.status }),
      ...(dto.type && { type: dto.type }),
    };

    const [items, total] = await Promise.all([
      this.prisma.post.findMany({
        where,
        skip,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: { author: AUTHOR_ADMIN },
      }),
      this.prisma.post.count({ where }),
    ]);

    return { items, total, page, perPage };
  }

  async adminFindById(id: string) {
    const post = await this.prisma.post.findUnique({
      where: { id },
      include: { author: AUTHOR_ADMIN },
    });
    if (!post) throw new NotFoundException('Post not found');
    return post;
  }

  async adminUpdate(id: string, actorId: string, dto: UpdatePostDto, ip?: string) {
    const post = await this.adminFindById(id);
    const wasPublished = post.status === PostStatus.PUBLISHED;

    // Slug inmutable mientras una PAGE está PUBLISHED — la URL puede estar
    // enlazada desde el footer/emails/externamente. En DRAFT sigue editable
    // (nadie la enlaza aún); un POST siempre puede cambiar de slug (menos
    // crítico). Runtime check (no regla de DTO) porque depende del estado
    // ACTUAL de la fila, no de la forma del payload.
    if (
      post.type === PostType.PAGE &&
      wasPublished &&
      dto.slug !== undefined &&
      dto.slug !== post.slug
    ) {
      throw new BadRequestException({
        message: 'No se puede cambiar el slug de una página publicada',
        code: 'SLUG_IMMUTABLE',
      });
    }

    this.assertTableBlocksValid(dto.blocks);
    await this.assertListingsBlocksValid(dto.blocks);

    const before = { title: post.title, slug: post.slug, status: post.status };

    const updated = await this.prisma.post.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.slug !== undefined && { slug: dto.slug }),
        ...(dto.excerpt !== undefined && { excerpt: dto.excerpt }),
        ...(dto.blocks !== undefined && { blocks: dto.blocks as unknown as Prisma.InputJsonValue }),
        ...(dto.coverUrl !== undefined && { coverUrl: dto.coverUrl }),
        ...(dto.tags !== undefined && { tags: dto.tags }),
        ...(dto.metaTitle !== undefined && { metaTitle: dto.metaTitle }),
        ...(dto.metaDescription !== undefined && { metaDescription: dto.metaDescription }),
      },
      include: { author: AUTHOR_ADMIN },
    });

    await this.auditLog.log({
      action: 'POST_UPDATE',
      actorId,
      resourceType: 'Post',
      resourceId: id,
      before,
      after: { title: updated.title, slug: updated.slug },
      ip,
    });

    // Nota: el footer ya no depende de ningún campo de Post (label/orden/
    // columna viven en FooterItem) y el slug es inmutable mientras la PAGE
    // está publicada (guardado arriba) — así que un adminUpdate normal nunca
    // necesita revalidar el footer. Solo publish/unpublish/delete lo hacen
    // (revalidatePostPaths), porque cambian si el ítem que la referencia se
    // renderiza o no.
    if (wasPublished) {
      if (post.type === PostType.PAGE) {
        // Slug can't have changed here (guarded above), so there's no old-slug
        // path to bust — only the page's own route.
        this.revalidateService.revalidatePath(`/paginas/${updated.slug}`);
      } else {
        const slugChanged = updated.slug !== post.slug;
        this.revalidateService.revalidatePath(`/blog/${updated.slug}`);
        if (slugChanged) {
          // Old slug becomes a 404; bust its cache so Next.js re-checks immediately.
          this.revalidateService.revalidatePath(`/blog/${post.slug}`);
          this.revalidateService.revalidatePath('/blog');
        }
      }
    }

    return updated;
  }

  async adminPublish(id: string, actorId: string, ip?: string) {
    const post = await this.adminFindById(id);
    if (post.status === PostStatus.PUBLISHED) {
      throw new BadRequestException('Post is already published');
    }

    const before = { status: post.status };

    const updated = await this.prisma.post.update({
      where: { id },
      // Preserve original publishedAt if re-publishing after unpublish.
      data: {
        status: PostStatus.PUBLISHED,
        publishedAt: post.publishedAt ?? new Date(),
      },
      include: { author: AUTHOR_ADMIN },
    });

    await this.auditLog.log({
      action: 'POST_PUBLISH',
      actorId,
      resourceType: 'Post',
      resourceId: id,
      before,
      after: { status: PostStatus.PUBLISHED, publishedAt: updated.publishedAt },
      ip,
    });

    this.revalidatePostPaths(updated.type, updated.slug);

    return updated;
  }

  async adminUnpublish(id: string, actorId: string, ip?: string) {
    const post = await this.adminFindById(id);
    if (post.status !== PostStatus.PUBLISHED) {
      throw new BadRequestException('Post is not published');
    }

    const before = { status: post.status };

    const updated = await this.prisma.post.update({
      where: { id },
      data: { status: PostStatus.DRAFT, publishedAt: null },
      include: { author: AUTHOR_ADMIN },
    });

    await this.auditLog.log({
      action: 'POST_UNPUBLISH',
      actorId,
      resourceType: 'Post',
      resourceId: id,
      before,
      after: { status: PostStatus.DRAFT },
      ip,
    });

    this.revalidatePostPaths(updated.type, updated.slug);

    return updated;
  }

  async adminDelete(id: string, actorId: string, ip?: string) {
    const post = await this.adminFindById(id);
    const wasPublished = post.status === PostStatus.PUBLISHED;

    // Precomprobación (molde AdminService.deleteCategory): sin esto, el
    // DELETE físico chocaría con FooterItem.page (onDelete: Restrict) y
    // devolvería un 500 sin controlar en vez de este 400 legible.
    if (post.type === PostType.PAGE) {
      const footerItemCount = await this.prisma.footerItem.count({ where: { pageId: id } });
      if (footerItemCount > 0) {
        throw new BadRequestException(
          `No se puede eliminar: la página está enlazada desde ${footerItemCount} sitio(s) del footer`,
        );
      }
    }

    const before = { title: post.title, slug: post.slug, status: post.status };

    await this.prisma.post.delete({ where: { id } });

    await this.auditLog.log({
      action: 'POST_DELETE',
      actorId,
      resourceType: 'Post',
      resourceId: id,
      before,
      ip,
    });

    if (wasPublished) {
      this.revalidatePostPaths(post.type, post.slug);
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  // Regla cruzada de un bloque `table`: cada fila debe tener el mismo nº de
  // columnas que `headers`. Depende de DOS campos del mismo bloque — no
  // expresable con un decorador de un único campo — así que vive aquí, mismo
  // estilo que el resto de reglas de negocio "vive en el servicio" de este
  // proyecto (assertItemDestination en FooterService, el ya retirado
  // assertFooterFieldsAllowed).
  private assertTableBlocksValid(blocks: BlockDto[] | undefined): void {
    if (!blocks) return;
    for (const block of blocks) {
      if (block.type !== 'table') continue;
      const invalidRow = block.rows.find((row) => row.length !== block.headers.length);
      if (invalidRow) {
        throw new BadRequestException(
          `Bloque de tabla inválido: todas las filas deben tener ${block.headers.length} columna(s), como \`headers\``,
        );
      }
    }
  }

  // Reglas cruzadas de un bloque `listings` — primer bloque DINÁMICO: a
  // diferencia de assertTableBlocksValid (cruza dos campos del MISMO
  // bloque), esta cruza contra estado externo (Category en Postgres) y
  // contra el array COMPLETO de bloques (cuenta cuántos hay), así que no
  // puede vivir en un decorador de campo — mismo criterio de "regla de
  // negocio en el service" que assertItemDestination/assertPageDestination
  // de FooterService. Async por el lookup a Category (a diferencia de
  // assertTableBlocksValid, que es puramente estructural y síncrono).
  private async assertListingsBlocksValid(blocks: BlockDto[] | undefined): Promise<void> {
    if (!blocks) return;
    const listingsBlocks: ListingsBlockDto[] = [];
    for (const block of blocks) {
      if (block.type === 'listings') listingsBlocks.push(block);
    }
    if (listingsBlocks.length === 0) return;

    // Guardarraíl: una página con muchos bloques `listings` dispararía una
    // consulta a Meilisearch por bloque en cada render — limitar el número,
    // no el tamaño de cada consulta (eso ya lo hace `limit` con IsIn).
    if (listingsBlocks.length > MAX_LISTINGS_BLOCKS_PER_PAGE) {
      throw new BadRequestException(
        `Máximo ${MAX_LISTINGS_BLOCKS_PER_PAGE} bloques de "anuncios de una categoría" por página/post`,
      );
    }

    const slugs = [...new Set(listingsBlocks.map((b) => b.categorySlug))];
    const found = await this.prisma.category.findMany({
      where: { slug: { in: slugs } },
      select: { slug: true },
    });
    const foundSlugs = new Set(found.map((c) => c.slug));
    const missing = slugs.filter((s) => !foundSlugs.has(s));
    if (missing.length > 0) {
      throw new BadRequestException(`Categoría(s) no encontrada(s): ${missing.join(', ')}`);
    }
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

  // Publish/unpublish/delete always revalidate the same set of paths for a
  // given type — pages have no feed to bust, only their own route. For PAGE,
  // ALSO revalidate the footer-nav cache unconditionally: a status change or
  // deletion is exactly what can flip whether a FooterItem pointing at this
  // page renders (see FooterService's public query, which filters PAGE items
  // by status=PUBLISHED). Pages change rarely and the call is fire-and-forget,
  // so there's no cheaper-but-lossy conditional worth adding.
  private revalidatePostPaths(type: PostType, slug: string): void {
    if (type === PostType.PAGE) {
      this.revalidateService.revalidatePath(`/paginas/${slug}`);
      this.revalidateService.revalidateTag('footer-nav');
    } else {
      this.revalidateService.revalidatePath('/blog');
      this.revalidateService.revalidatePath(`/blog/${slug}`);
    }
  }
}
