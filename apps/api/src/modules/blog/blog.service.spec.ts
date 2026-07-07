import { Logger } from '@nestjs/common';
import { PostStatus, PostType } from '@prisma/client';
import { BlogService } from './blog.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuditLogService } from '../audit-log/audit-log.service';

// callRevalidateEndpoint is fire-and-forget: nothing in BlogService awaits its
// fetch(). setImmediate runs after the whole microtask queue (Promise jobs +
// process.nextTick) has drained, so this reliably waits out the .then/.catch
// chain regardless of how many hops it takes to settle.
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function buildPrismaStub() {
  return {
    post: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  } as unknown as PrismaService;
}

function buildAuditLogStub() {
  return { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditLogService;
}

function makePublishedPage() {
  return {
    id: 'page-1',
    type: PostType.PAGE,
    status: PostStatus.PUBLISHED,
    slug: 'ayuda',
    title: 'Ayuda',
    excerpt: null,
    body: '',
    coverUrl: null,
    tags: [],
    metaTitle: null,
    metaDescription: null,
    showInFooter: true,
    footerOrder: 1,
    footerGroup: null,
    publishedAt: new Date(),
  };
}

describe('BlogService — observabilidad de callRevalidateEndpoint', () => {
  const ORIGINAL_ENV = { ...process.env };
  let warnSpy: jest.SpyInstance;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env.REVALIDATE_SECRET = 'test-secret';
    process.env.APP_URL = 'http://frontend.test';
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  it('loguea un warn con el status cuando la respuesta no es ok (p. ej. 404)', async () => {
    const page = makePublishedPage();
    const prisma = buildPrismaStub();
    (prisma.post.findUnique as jest.Mock).mockResolvedValue(page);
    (prisma.post.update as jest.Mock).mockResolvedValue(page);
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 404 } as Response);

    const service = new BlogService(prisma, buildAuditLogStub());
    await service.adminUpdate(page.id, 'actor-1', { title: 'Ayuda actualizada' });
    await flushMicrotasks();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('404'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('/paginas/ayuda'));
    // La URL real (con el secret en la query string) nunca debe aparecer en logs.
    for (const call of warnSpy.mock.calls) {
      expect(String(call[0])).not.toContain('test-secret');
    }
  });

  it('loguea un warn con el mensaje de error cuando el fetch rechaza (fallo de red)', async () => {
    const page = makePublishedPage();
    const prisma = buildPrismaStub();
    (prisma.post.findUnique as jest.Mock).mockResolvedValue(page);
    (prisma.post.update as jest.Mock).mockResolvedValue(page);
    fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('fetch failed: ECONNREFUSED'));

    const service = new BlogService(prisma, buildAuditLogStub());
    await service.adminUpdate(page.id, 'actor-1', { title: 'Ayuda actualizada' });
    await flushMicrotasks();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('/paginas/ayuda'));
  });

  it('NO loguea ningún warn cuando la revalidación responde ok (no falso positivo)', async () => {
    const page = makePublishedPage();
    const prisma = buildPrismaStub();
    (prisma.post.findUnique as jest.Mock).mockResolvedValue(page);
    (prisma.post.update as jest.Mock).mockResolvedValue(page);
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200 } as Response);

    const service = new BlogService(prisma, buildAuditLogStub());
    await service.adminUpdate(page.id, 'actor-1', { title: 'Ayuda actualizada' });
    await flushMicrotasks();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('loguea un warn UNA vez al construirse si falta REVALIDATE_SECRET, sin llamar a fetch', () => {
    delete process.env.REVALIDATE_SECRET;
    fetchSpy = jest.spyOn(global, 'fetch');

    new BlogService(buildPrismaStub(), buildAuditLogStub());

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('REVALIDATE_SECRET'));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('NO loguea warn de arranque cuando REVALIDATE_SECRET está configurado', () => {
    new BlogService(buildPrismaStub(), buildAuditLogStub());

    expect(warnSpy).not.toHaveBeenCalled();
  });
});
