import { PostStatus, PostType } from '@prisma/client';
import { BlogService } from './blog.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuditLogService } from '../audit-log/audit-log.service';
import type { RevalidateService } from '../../common/revalidate/revalidate.service';
import type { R2Service } from '../../infra/r2/r2.service';

// La observabilidad del fetch fire-and-forget (warn en !ok / fallo de red /
// arranque sin REVALIDATE_SECRET) vive ahora en revalidate.service.spec.ts —
// aquí solo se prueba que BlogService delega los paths/tags correctos a
// RevalidateService, no el mecanismo de red en sí.

function buildPrismaStub() {
  return {
    post: {
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    footerItem: {
      count: jest.fn().mockResolvedValue(0),
    },
  } as unknown as PrismaService;
}

function buildAuditLogStub() {
  return { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditLogService;
}

function buildRevalidateStub() {
  return {
    revalidatePath: jest.fn(),
    revalidateTag: jest.fn(),
  } as unknown as RevalidateService;
}

function buildR2Stub() {
  return {
    upload: jest.fn(),
    getPublicUrl: jest.fn(),
  } as unknown as R2Service;
}

function makePublishedPage() {
  return {
    id: 'page-1',
    type: PostType.PAGE,
    status: PostStatus.PUBLISHED,
    slug: 'ayuda',
    title: 'Ayuda',
    excerpt: null,
    blocks: [],
    coverUrl: null,
    tags: [],
    metaTitle: null,
    metaDescription: null,
    publishedAt: new Date(),
  };
}

describe('BlogService — delegación a RevalidateService', () => {
  it('adminUpdate sobre una PAGE publicada revalida solo su propia ruta (footer ya no depende de campos de Post)', async () => {
    const page = makePublishedPage();
    const prisma = buildPrismaStub();
    (prisma.post.findUnique as jest.Mock).mockResolvedValue(page);
    (prisma.post.update as jest.Mock).mockResolvedValue(page);
    const revalidate = buildRevalidateStub();

    const service = new BlogService(prisma, buildAuditLogStub(), revalidate, buildR2Stub());
    await service.adminUpdate(page.id, 'actor-1', { title: 'Ayuda actualizada' });

    expect(revalidate.revalidatePath).toHaveBeenCalledWith('/paginas/ayuda');
    expect(revalidate.revalidateTag).not.toHaveBeenCalled();
  });

  it('adminPublish sobre una PAGE revalida su ruta Y el tag footer-nav', async () => {
    const page = { ...makePublishedPage(), status: PostStatus.DRAFT, publishedAt: null };
    const prisma = buildPrismaStub();
    (prisma.post.findUnique as jest.Mock).mockResolvedValue(page);
    (prisma.post.update as jest.Mock).mockResolvedValue({ ...page, status: PostStatus.PUBLISHED, publishedAt: new Date() });
    const revalidate = buildRevalidateStub();

    const service = new BlogService(prisma, buildAuditLogStub(), revalidate, buildR2Stub());
    await service.adminPublish(page.id, 'actor-1');

    expect(revalidate.revalidatePath).toHaveBeenCalledWith('/paginas/ayuda');
    expect(revalidate.revalidateTag).toHaveBeenCalledWith('footer-nav');
  });

  it('adminUnpublish sobre una PAGE revalida su ruta Y el tag footer-nav (el ítem del footer deja de renderizarse)', async () => {
    const page = makePublishedPage();
    const prisma = buildPrismaStub();
    (prisma.post.findUnique as jest.Mock).mockResolvedValue(page);
    (prisma.post.update as jest.Mock).mockResolvedValue({ ...page, status: PostStatus.DRAFT, publishedAt: null });
    const revalidate = buildRevalidateStub();

    const service = new BlogService(prisma, buildAuditLogStub(), revalidate, buildR2Stub());
    await service.adminUnpublish(page.id, 'actor-1');

    expect(revalidate.revalidatePath).toHaveBeenCalledWith('/paginas/ayuda');
    expect(revalidate.revalidateTag).toHaveBeenCalledWith('footer-nav');
  });

  it('adminDelete sobre una PAGE publicada SIN ítems de footer revalida el tag footer-nav', async () => {
    const page = makePublishedPage();
    const prisma = buildPrismaStub();
    (prisma.post.findUnique as jest.Mock).mockResolvedValue(page);
    (prisma.footerItem.count as jest.Mock).mockResolvedValue(0);
    const revalidate = buildRevalidateStub();

    const service = new BlogService(prisma, buildAuditLogStub(), revalidate, buildR2Stub());
    await service.adminDelete(page.id, 'actor-1');

    expect(prisma.post.delete).toHaveBeenCalledWith({ where: { id: page.id } });
    expect(revalidate.revalidateTag).toHaveBeenCalledWith('footer-nav');
  });

  it('adminDelete sobre una PAGE enlazada desde el footer → BadRequest, NO borra (molde deleteCategory)', async () => {
    const page = makePublishedPage();
    const prisma = buildPrismaStub();
    (prisma.post.findUnique as jest.Mock).mockResolvedValue(page);
    (prisma.footerItem.count as jest.Mock).mockResolvedValue(2);
    const revalidate = buildRevalidateStub();

    const service = new BlogService(prisma, buildAuditLogStub(), revalidate, buildR2Stub());

    await expect(service.adminDelete(page.id, 'actor-1')).rejects.toThrow(
      'No se puede eliminar: la página está enlazada desde 2 sitio(s) del footer',
    );
    expect(prisma.post.delete).not.toHaveBeenCalled();
  });
});
