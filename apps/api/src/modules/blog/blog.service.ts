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
    const slug = dto.slug ?? this.buildSlug(dto.title);

    const post = await this.prisma.post.create({
      data: {
        type: dto.type ?? PostType.POST,
        title: dto.title,
        slug,
        excerpt: dto.excerpt,
        body: dto.body ?? '',
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
    const slugBefore = post.slug;
    const slugAfter = dto.slug ?? post.slug;
    const wasPublished = post.status === PostStatus.PUBLISHED;

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
        // Pages have no feed to revalidate — only their own route.
        this.revalidate(`/paginas/${slugAfter}`);
        if (slugAfter !== slugBefore) {
          this.revalidate(`/paginas/${slugBefore}`);
        }
      } else {
        this.revalidate(`/blog/${slugAfter}`);
        if (slugAfter !== slugBefore) {
          // Old slug becomes a 404; bust its cache so Next.js re-checks immediately.
          this.revalidate(`/blog/${slugBefore}`);
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
  // type — pages have no feed to bust, only their own route.
  private revalidatePostPaths(type: PostType, slug: string): void {
    if (type === PostType.PAGE) {
      this.revalidate(`/paginas/${slug}`);
    } else {
      this.revalidate('/blog');
      this.revalidate(`/blog/${slug}`);
    }
  }

  // Fire-and-forget ISR revalidation. Failure is intentionally swallowed:
  // a slow or unavailable Next.js server must not fail the admin action.
  private revalidate(path: string): void {
    const secret = process.env.REVALIDATE_SECRET;
    if (!secret) return;
    const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
    const url =
      `${appUrl}/api/revalidate` +
      `?secret=${encodeURIComponent(secret)}` +
      `&path=${encodeURIComponent(path)}`;
    fetch(url, { method: 'POST', signal: AbortSignal.timeout(3000) }).catch(() => {});
  }
}
