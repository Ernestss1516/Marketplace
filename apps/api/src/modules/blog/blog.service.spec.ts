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
    // RN.2 — el precheck de adminDelete cuenta las DOS fuentes de enlaces a una
    // página (footer y nav) en un solo $transaction.
    navItem: {
      count: jest.fn().mockResolvedValue(0),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
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

// RN.2 — el nav principal es una SEGUNDA fuente de enlaces a páginas, con la
// misma FK Restrict que el footer. Estos tests son la garantía de que el
// precheck cubre las dos tablas: sin ellos, el caso "enlazada solo desde el
// nav" pasaría el chequeo y reventaría contra la constraint como un 500.
describe('BlogService — precheck de borrado ampliado al nav (RN.2)', () => {
  function buildPageWithLinks(footerCount: number, navCount: number) {
    const page = makePublishedPage();
    const prisma = buildPrismaStub();
    (prisma.post.findUnique as jest.Mock).mockResolvedValue(page);
    (prisma.footerItem.count as jest.Mock).mockResolvedValue(footerCount);
    (prisma.navItem.count as jest.Mock).mockResolvedValue(navCount);
    const revalidate = buildRevalidateStub();
    const service = new BlogService(prisma, buildAuditLogStub(), revalidate, buildR2Stub());
    return { page, prisma, revalidate, service };
  }

  it('PAGE enlazada SOLO desde el nav → 400 legible (no un 500 de la constraint)', async () => {
    const { page, prisma, service } = buildPageWithLinks(0, 3);

    await expect(service.adminDelete(page.id, 'actor-1')).rejects.toThrow(
      'No se puede eliminar: la página está enlazada desde 3 sitio(s) del nav',
    );
    expect(prisma.post.delete).not.toHaveBeenCalled();
  });

  it('PAGE enlazada desde AMBOS → 400 que nombra las dos procedencias', async () => {
    const { page, prisma, service } = buildPageWithLinks(2, 1);

    await expect(service.adminDelete(page.id, 'actor-1')).rejects.toThrow(
      'No se puede eliminar: la página está enlazada desde 2 sitio(s) del footer y 1 sitio(s) del nav',
    );
    expect(prisma.post.delete).not.toHaveBeenCalled();
  });

  it('PAGE sin enlaces en ninguna de las dos → se borra', async () => {
    const { page, prisma, service } = buildPageWithLinks(0, 0);

    await service.adminDelete(page.id, 'actor-1');

    expect(prisma.post.delete).toHaveBeenCalledWith({ where: { id: page.id } });
  });

  it('un POST de blog no consulta ninguna de las dos tablas (el precheck es solo para PAGE)', async () => {
    const prisma = buildPrismaStub();
    (prisma.post.findUnique as jest.Mock).mockResolvedValue({
      ...makePublishedPage(),
      type: PostType.POST,
      slug: 'articulo',
    });
    const service = new BlogService(prisma, buildAuditLogStub(), buildRevalidateStub(), buildR2Stub());

    await service.adminDelete('post-1', 'actor-1');

    expect(prisma.footerItem.count).not.toHaveBeenCalled();
    expect(prisma.navItem.count).not.toHaveBeenCalled();
    expect(prisma.post.delete).toHaveBeenCalled();
  });
});

// RN.2 — revalidación CRUZADA: las dos navegaciones son cachés independientes y
// las dos pueden enlazar la misma página, así que publicar/despublicar/borrar
// tiene que tumbar los dos tags. El de 'main-nav' invalida de golpe sus 9
// entradas por tipo de página (unstable_cache invalida por tag, no por clave).
describe('BlogService — revalidación de los DOS tags de navegación (RN.2)', () => {
  function buildService() {
    const page = makePublishedPage();
    const prisma = buildPrismaStub();
    (prisma.post.findUnique as jest.Mock).mockResolvedValue(page);
    (prisma.post.update as jest.Mock).mockResolvedValue(page);
    const revalidate = buildRevalidateStub();
    return {
      page,
      prisma,
      revalidate,
      service: new BlogService(prisma, buildAuditLogStub(), revalidate, buildR2Stub()),
    };
  }

  it('adminPublish de una PAGE revalida footer-nav Y main-nav', async () => {
    // adminPublish rechaza lo ya publicado, así que aquí la página parte de DRAFT.
    const draft = { ...makePublishedPage(), status: PostStatus.DRAFT, publishedAt: null };
    const prisma = buildPrismaStub();
    (prisma.post.findUnique as jest.Mock).mockResolvedValue(draft);
    (prisma.post.update as jest.Mock).mockResolvedValue({ ...draft, status: PostStatus.PUBLISHED });
    const revalidate = buildRevalidateStub();
    const service = new BlogService(prisma, buildAuditLogStub(), revalidate, buildR2Stub());

    await service.adminPublish(draft.id, 'actor-1');

    expect(revalidate.revalidateTag).toHaveBeenCalledWith('footer-nav');
    expect(revalidate.revalidateTag).toHaveBeenCalledWith('main-nav');
  });

  it('adminUnpublish de una PAGE revalida footer-nav Y main-nav', async () => {
    const { page, revalidate, service } = buildService();
    await service.adminUnpublish(page.id, 'actor-1');

    expect(revalidate.revalidateTag).toHaveBeenCalledWith('footer-nav');
    expect(revalidate.revalidateTag).toHaveBeenCalledWith('main-nav');
  });

  it('adminDelete de una PAGE publicada revalida footer-nav Y main-nav', async () => {
    const { page, revalidate, service } = buildService();
    await service.adminDelete(page.id, 'actor-1');

    expect(revalidate.revalidateTag).toHaveBeenCalledWith('footer-nav');
    expect(revalidate.revalidateTag).toHaveBeenCalledWith('main-nav');
  });

  it('un POST de blog NO toca ninguno de los dos tags de navegación', async () => {
    const prisma = buildPrismaStub();
    const post = { ...makePublishedPage(), type: PostType.POST, slug: 'articulo' };
    (prisma.post.findUnique as jest.Mock).mockResolvedValue(post);
    (prisma.post.update as jest.Mock).mockResolvedValue(post);
    const revalidate = buildRevalidateStub();
    const service = new BlogService(prisma, buildAuditLogStub(), revalidate, buildR2Stub());

    await service.adminUnpublish(post.id, 'actor-1');

    expect(revalidate.revalidateTag).not.toHaveBeenCalledWith('footer-nav');
    expect(revalidate.revalidateTag).not.toHaveBeenCalledWith('main-nav');
  });
});
