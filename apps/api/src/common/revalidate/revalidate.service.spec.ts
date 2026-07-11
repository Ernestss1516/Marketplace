import { Logger } from '@nestjs/common';
import { RevalidateService } from './revalidate.service';

// revalidatePath/revalidateTag are fire-and-forget: nothing here awaits the
// fetch() inside RevalidateService. setImmediate runs after the whole
// microtask queue (Promise jobs + process.nextTick) has drained, so this
// reliably waits out the .then/.catch chain regardless of how many hops it
// takes to settle.
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('RevalidateService — observabilidad de la revalidación fire-and-forget', () => {
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
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 404 } as Response);

    const service = new RevalidateService();
    service.revalidatePath('/paginas/ayuda');
    await flushMicrotasks();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('404'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('/paginas/ayuda'));
    // La URL real (con el secret en la query string) nunca debe aparecer en logs.
    for (const call of warnSpy.mock.calls) {
      expect(String(call[0])).not.toContain('test-secret');
    }
  });

  it('loguea un warn con el mensaje de error cuando el fetch rechaza (fallo de red)', async () => {
    fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('fetch failed: ECONNREFUSED'));

    const service = new RevalidateService();
    service.revalidatePath('/paginas/ayuda');
    await flushMicrotasks();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('/paginas/ayuda'));
  });

  it('NO loguea ningún warn cuando la revalidación responde ok (no falso positivo)', async () => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200 } as Response);

    const service = new RevalidateService();
    service.revalidatePath('/paginas/ayuda');
    await flushMicrotasks();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('revalidateTag construye la query con tag= en vez de path=, mismo manejo de errores', async () => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 500 } as Response);

    const service = new RevalidateService();
    service.revalidateTag('footer-nav');
    await flushMicrotasks();

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('tag=footer-nav'),
      expect.any(Object),
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('tag:footer-nav'));
  });

  it('loguea un warn UNA vez al construirse si falta REVALIDATE_SECRET, sin llamar a fetch', () => {
    delete process.env.REVALIDATE_SECRET;
    fetchSpy = jest.spyOn(global, 'fetch');

    new RevalidateService();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('REVALIDATE_SECRET'));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('NO loguea warn de arranque cuando REVALIDATE_SECRET está configurado', () => {
    new RevalidateService();

    expect(warnSpy).not.toHaveBeenCalled();
  });
});
