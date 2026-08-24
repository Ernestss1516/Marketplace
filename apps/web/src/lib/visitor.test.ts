// ESTADÍSTICAS A1 — el lado BFF de la captura: reenviar la identidad del visitante.
//
// Lo que se fija aquí es lo que hace útil al dedup de impresiones del backend: que dos
// visitantes distintos produzcan huellas distintas y el mismo visitante la misma. Si
// esto se rompe, /busqueda serviría a todo el mundo bajo una sola identidad y el dedup
// mataría todas las impresiones menos la primera cada media hora (la mutación descrita
// en docs/diseno-estadisticas.md §2.5).

import { visitorHashFrom, visitorHeaders, VISITOR_HASH_HEADER } from './visitor';

const mockHeaders = jest.fn();
jest.mock('next/headers', () => ({ headers: () => mockHeaders() }));

/** Un lector de cabeceras a partir de un objeto plano, como el de una petición real. */
const lector = (cabeceras: Record<string, string>) => (nombre: string) =>
  cabeceras[nombre] ?? null;

describe('visitorHashFrom — la huella del visitante', () => {
  it('es estable: el mismo visitante da siempre la misma huella', () => {
    const cabeceras = { 'x-forwarded-for': '81.2.3.4', 'user-agent': 'Firefox/1' };

    expect(visitorHashFrom(lector(cabeceras))).toBe(visitorHashFrom(lector(cabeceras)));
  });

  it('distingue dos IPs distintas', () => {
    const a = visitorHashFrom(lector({ 'x-forwarded-for': '81.2.3.4', 'user-agent': 'Firefox' }));
    const b = visitorHashFrom(lector({ 'x-forwarded-for': '81.2.3.5', 'user-agent': 'Firefox' }));

    expect(a).not.toBe(b);
  });

  it('distingue dos navegadores desde la misma IP (el caso del NAT compartido)', () => {
    const a = visitorHashFrom(lector({ 'x-forwarded-for': '81.2.3.4', 'user-agent': 'Firefox' }));
    const b = visitorHashFrom(lector({ 'x-forwarded-for': '81.2.3.4', 'user-agent': 'Safari' }));

    expect(a).not.toBe(b);
  });

  it('toma el PRIMER salto de una cadena de proxies: el cliente, no el proxy', () => {
    // `x-forwarded-for: cliente, proxy1, proxy2`. Quedarse con el último haría que todos
    // los visitantes tras el mismo proxy compartieran huella.
    const cadena = visitorHashFrom(
      lector({ 'x-forwarded-for': '81.2.3.4, 10.0.0.1, 10.0.0.2', 'user-agent': 'Firefox' }),
    );
    const directo = visitorHashFrom(
      lector({ 'x-forwarded-for': '81.2.3.4', 'user-agent': 'Firefox' }),
    );

    expect(cadena).toBe(directo);
  });

  it('cae a `x-real-ip` cuando no hay `x-forwarded-for`', () => {
    const conReal = visitorHashFrom(lector({ 'x-real-ip': '81.2.3.4', 'user-agent': 'Firefox' }));
    const conForwarded = visitorHashFrom(
      lector({ 'x-forwarded-for': '81.2.3.4', 'user-agent': 'Firefox' }),
    );

    expect(conReal).toBe(conForwarded);
  });

  it('sin ninguna cabecera sigue devolviendo una huella (no rompe, deduplica de más)', () => {
    expect(visitorHashFrom(lector({}))).toMatch(/^[0-9a-f]{64}$/);
  });

  it('siempre 64 hex, sea cual sea la entrada', () => {
    const huella = visitorHashFrom(
      lector({ 'x-forwarded-for': 'x'.repeat(4000), 'user-agent': ':*\n' }),
    );

    expect(huella).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('visitorHeaders — lo que se manda a Nest', () => {
  afterEach(() => jest.clearAllMocks());

  it('devuelve la cabecera que el backend lee', async () => {
    mockHeaders.mockResolvedValue({
      get: (nombre: string) =>
        ({ 'x-forwarded-for': '81.2.3.4', 'user-agent': 'Firefox' })[nombre] ?? null,
    });

    const cabeceras = await visitorHeaders();

    expect(cabeceras[VISITOR_HASH_HEADER]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('si no hay petición (render estático) devuelve {} en vez de reventar la página', async () => {
    // FAIL-OPEN, y es la regla que importa: una página NUNCA debe romperse porque no se
    // pueda identificar al visitante de una métrica de vanidad. Sin cabecera el backend
    // cae a la IP que ve, que cuenta de menos — nunca de más.
    mockHeaders.mockRejectedValue(new Error('headers() fuera de una petición'));

    await expect(visitorHeaders()).resolves.toEqual({});
  });
});
