import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PostStatus, PostType } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { ListPublicPostsDto } from './dto/list-public-posts.dto';
import { ListAdminPostsDto } from './dto/list-admin-posts.dto';

const AUTHOR_PUBLIC = { select: { name: true } } as const;
const AUTHOR_ADMIN = { select: { id: true, name: true, email: true } } as const;

@Injectable()
export class BlogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

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

  // Footer dinámico: solo PAGE + PUBLISHED + showInFooter=true, ordenadas para
  // renderizar. Endpoint dedicado (no un filtro de listPublishedPages) porque el
  // orden (footerOrder) y el filtro (showInFooter) no tienen sentido para el
  // listado público genérico de páginas. select mínimo — un enlace de footer
  // solo necesita title+slug. Cacheado agresivamente en el frontend
  // (unstable_cache, tag 'footer-pages') — esta query no corre por request.
  listFooterPages() {
    return this.prisma.post.findMany({
      where: { type: PostType.PAGE, status: PostStatus.PUBLISHED, showInFooter: true },
      orderBy: { footerOrder: 'asc' },
      select: { title: true, slug: true },
    });
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
    this.assertFooterFieldsAllowed(resolvedType, dto);

    const slug = dto.slug ?? this.buildSlug(dto.title);

    const post = await this.prisma.post.create({
      data: {
        type: resolvedType,
        title: dto.title,
        slug,
        excerpt: dto.excerpt,
        body: dto.body ?? '',
        coverUrl: dto.coverUrl,
        tags: dto.tags ?? [],
        metaTitle: dto.metaTitle,
        metaDescription: dto.metaDescription,
        showInFooter: dto.showInFooter ?? false,
        footerOrder: dto.footerOrder,
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

    // Slug inmutable mientras una PAGE está PUBLISHED — la URL está enlazada en
    // el footer/emails/externamente. En DRAFT sigue editable (nadie la enlaza
    // aún); un POST siempre puede cambiar de slug (menos crítico). Runtime check
    // (no regla de DTO) porque depende del estado ACTUAL de la fila, no de la
    // forma del payload.
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

    this.assertFooterFieldsAllowed(post.type, dto);

    const before = { title: post.title, slug: post.slug, status: post.status };

    const updated = await this.prisma.post.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.slug !== undefined && { slug: dto.slug }),
        ...(dto.excerpt !== undefined && { excerpt: dto.excerpt }),
        ...(dto.body !== undefined && { body: dto.body }),
        ...(dto.coverUrl !== undefined && { coverUrl: dto.coverUrl }),
        ...(dto.tags !== undefined && { tags: dto.tags }),
        ...(dto.metaTitle !== undefined && { metaTitle: dto.metaTitle }),
        ...(dto.metaDescription !== undefined && { metaDescription: dto.metaDescription }),
        ...(dto.showInFooter !== undefined && { showInFooter: dto.showInFooter }),
        ...(dto.footerOrder !== undefined && { footerOrder: dto.footerOrder }),
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

    if (wasPublished) {
      if (post.type === PostType.PAGE) {
        // Slug can't have changed here (guarded above), so there's no old-slug
        // path to bust — only the page's own route, plus the footer cache in
        // case this update touched title/showInFooter/footerOrder.
        this.revalidate(`/paginas/${updated.slug}`);
        this.revalidateTag('footer-pages');
      } else {
        const slugChanged = updated.slug !== post.slug;
        this.revalidate(`/blog/${updated.slug}`);
        if (slugChanged) {
          // Old slug becomes a 404; bust its cache so Next.js re-checks immediately.
          this.revalidate(`/blog/${post.slug}`);
          this.revalidate('/blog');
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

  // Publish/unpublish/delete always revalidate the same set of paths for a given
  // type — pages have no feed to bust, only their own route. For PAGE, ALSO
  // revalidate the footer cache unconditionally — this fires from the same
  // wasPublished-gated call sites that already cover every state change that
  // could affect a footer-listed page (including the showInFooter toggle
  // itself), so there's no cheaper-but-lossy conditional worth adding: pages
  // change rarely, and the call is fire-and-forget.
  private revalidatePostPaths(type: PostType, slug: string): void {
    if (type === PostType.PAGE) {
      this.revalidate(`/paginas/${slug}`);
      this.revalidateTag('footer-pages');
    } else {
      this.revalidate('/blog');
      this.revalidate(`/blog/${slug}`);
    }
  }

  // Rejects showInFooter/footerOrder on anything that isn't (or won't become) a
  // PAGE. Lives in the service, not the DTO — CreatePostDto validates BEFORE the
  // `type ?? POST` default is resolved, so it can't see the final type; for
  // updates, the current row's type is only knowable after loading it.
  private assertFooterFieldsAllowed(
    resolvedType: PostType,
    dto: { showInFooter?: boolean; footerOrder?: number },
  ): void {
    if (resolvedType !== PostType.PAGE && (dto.showInFooter !== undefined || dto.footerOrder !== undefined)) {
      throw new BadRequestException('showInFooter/footerOrder solo aplican a páginas informativas');
    }
  }

  // Fire-and-forget ISR revalidation. Failure is intentionally swallowed:
  // a slow or unavailable Next.js server must not fail the admin action.
  private revalidate(path: string): void {
    this.callRevalidateEndpoint({ path });
  }

  // Same fire-and-forget shape as revalidate(), but busts a tag-based cache
  // (unstable_cache) instead of an ISR path — used for the footer, which is
  // cached independently of any single page/route's own revalidation window.
  private revalidateTag(tag: string): void {
    this.callRevalidateEndpoint({ tag });
  }

  private callRevalidateEndpoint(params: { path?: string; tag?: string }): void {
    const secret = process.env.REVALIDATE_SECRET;
    if (!secret) return;
    const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
    const qs = new URLSearchParams({ secret });
    if (params.path !== undefined) qs.set('path', params.path);
    if (params.tag !== undefined) qs.set('tag', params.tag);
    fetch(`${appUrl}/api/revalidate?${qs}`, {
      method: 'POST',
      signal: AbortSignal.timeout(3000),
    }).catch(() => {});
  }
}
