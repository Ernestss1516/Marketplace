/**
 * FILTRO DE `/admin/anuncios` — teléfono, municipio y provincia.
 *
 * Los cuatro que ya filtraban (título, descripción, slug, id) y la última IP **no se tocan**;
 * aquí se afirma que siguen igual y se añaden los tres que faltaban.
 *
 * Cuatro barreras:
 *
 *  1. **El teléfono casa EN CUALQUIER FORMATO.** Ni el vendedor ni el moderador tienen por
 *     qué teclearlo igual, así que se compara la forma canónica de los dos lados. Sin esto el
 *     filtro sólo encontraría al que escribió el número exactamente como el otro.
 *
 *  2. **El BACKFILL.** Los anuncios que ya existían también se encuentran. Sin él la columna
 *     nace vacía, el moderador busca un número, no sale nada, y concluye que ese teléfono no
 *     está en la plataforma — un filtro a medio poblar miente peor que uno que no existe.
 *
 *  3. **Municipio y provincia son PARÁMETROS PROPIOS.** «Anuncios DE Toledo» y «anuncios que
 *     MENCIONAN Toledo» son preguntas distintas, y cada una devuelve lo suyo.
 *
 *  4. **La IP sigue fuera del buscador de texto.** Es la barrera de 5b, reafirmada desde el
 *     otro lado: buscar una IP por `q` no puede empezar a funcionar «de regalo», porque un
 *     `contains` sobre `10.0.0.1` traería `110.0.0.10` — señalar a quien no es.
 *
 * Ver `docs/diseno-listas-ip-telefono.md` parte B.
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { normalizarTelefono } from '../src/modules/moderation/detection/phone-format';

describe('Filtro de /admin/anuncios ampliado (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  let sellerId: string;
  let sellerToken: string;
  let adminToken: string;
  let categoryId: string;

  const server = () => app.getHttpServer();

  let n = 0;
  async function crearAnuncio(datos: {
    title?: string;
    description?: string;
    phone?: string | null;
    phoneNormalized?: string | null;
    province?: string;
    city?: string;
    lastOwnerIp?: string;
  }) {
    return prisma.listing.create({
      data: {
        title: datos.title ?? `Filtro ${++n}`,
        slug: `filtro-${++n}-${Date.now()}`,
        description: datos.description ?? 'Un anuncio para probar el filtro.',
        price: 10,
        type: 'PRODUCT',
        status: 'ACTIVE',
        sellerId,
        categoryId,
        // El fixture escribe por Prisma, saltándose el servicio, así que tiene que emitir
        // los DOS campos como los emitiría él. Se usa la función REAL (`normalizarTelefono`)
        // y no una copia: una regla escrita a mano aquí probaría el test contra sí mismo.
        //
        // `phoneNormalized` explícito gana, y es lo que permite simular una fila ANTERIOR a
        // la columna (`phoneNormalized: null` con `phone` puesto) para la barrera 2.
        ...(datos.phone !== undefined && {
          phone: datos.phone,
          phoneNormalized: normalizarTelefono(datos.phone),
        }),
        ...(datos.phoneNormalized !== undefined && {
          phoneNormalized: datos.phoneNormalized,
        }),
        ...(datos.province && { province: datos.province }),
        ...(datos.city && { city: datos.city }),
        ...(datos.lastOwnerIp && { lastOwnerIp: datos.lastOwnerIp }),
      },
    });
  }

  const buscar = (qs: string) =>
    request(server())
      .get(`/api/admin/listings?perPage=100&${qs}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .then((r) => (r.body.items as { id: string }[]).map((l) => l.id));

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
    prisma = new PrismaClient();
    await cleanDb(prisma);

    const passwordHash = await bcrypt.hash('Test1234!', 10);
    const [seller] = await Promise.all([
      prisma.user.create({
        data: {
          email: 'filtro-seller@example.com', name: 'Filtro Seller', slug: 'filtro-seller',
          passwordHash, emailVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          email: 'filtro-admin@example.com', name: 'Filtro Admin', slug: 'filtro-admin',
          passwordHash, emailVerified: true, role: 'ADMIN',
        },
      }),
    ]);
    sellerId = seller.id;

    categoryId = (
      await prisma.category.create({
        data: { name: 'Filtro Cat', slug: 'filtro-cat', attributeSchema: [] },
      })
    ).id;

    [sellerToken, adminToken] = await Promise.all([
      request(server())
        .post('/api/auth/login')
        .send({ email: 'filtro-seller@example.com', password: 'Test1234!' })
        .then((r) => r.body.accessToken as string),
      request(server())
        .post('/api/auth/admin-login')
        .send({ email: 'filtro-admin@example.com', password: 'Test1234!' })
        .then((r) => r.body.accessToken as string),
    ]);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA 1 — el teléfono, en cualquier formato
  // ───────────────────────────────────────────────────────────────────────────

  it('BARRERA 1: el mismo teléfono escrito de CUATRO formas se encuentra con una sola búsqueda', async () => {
    // Cada anuncio lo guarda como le dio la gana a su vendedor. El filtro tiene que traerlos
    // todos, porque son el MISMO número — que es la única forma de que esto sirva.
    const conFormatos = await Promise.all([
      crearAnuncio({ phone: '654123456' }),
      crearAnuncio({ phone: '654 123 456' }),
      crearAnuncio({ phone: '+34 654-12-34-56' }),
      crearAnuncio({ phone: '0034654123456' }),
    ]);
    const otro = await crearAnuncio({ phone: '600999888' });

    // Se escriben las CUATRO en el buscador: también el moderador teclea como quiere, y el
    // resultado tiene que ser el mismo conjunto las cuatro veces.
    for (const escrito of ['654123456', '654 123 456', '+34 654 123 456', '0034654123456']) {
      const ids = await buscar(`phone=${encodeURIComponent(escrito)}`);
      expect(ids.sort()).toEqual(conFormatos.map((l) => l.id).sort());
      expect(ids).not.toContain(otro.id);
    }
  });

  it('el anuncio sin teléfono no aparece, y buscar una tontería devuelve VACÍO', async () => {
    // Si lo escrito no es un teléfono, `normalizarTelefono` da `null`. Filtrar por `null`
    // significaría «los que NO tienen teléfono» — la pregunta CONTRARIA, respondida con una
    // lista larga que parece un acierto. Tiene que devolver vacío.
    await crearAnuncio({ phone: null });
    expect(await buscar('phone=no-soy-un-telefono')).toEqual([]);
    expect(await buscar('phone=12345')).toEqual([]);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA 2 — el backfill
  // ───────────────────────────────────────────────────────────────────────────

  it('BARRERA 2: un anuncio ANTERIOR a la columna también se encuentra', async () => {
    // Se simula lo que había antes del despliegue: `phone` puesto y `phoneNormalized` a
    // `null`, que es exactamente como quedaron las filas existentes. La migración las
    // rellenó; aquí se comprueba que la MISMA operación las recupera.
    const viejo = await crearAnuncio({ phone: '611222333', phoneNormalized: null });
    expect(await buscar('phone=611222333')).not.toContain(viejo.id);

    // El backfill de la migración, sobre esta fila y con su misma expresión.
    await prisma.$executeRawUnsafe(`
      UPDATE "Listing" l
      SET "phoneNormalized" = (
        SELECT CASE
          WHEN t.dig ~ '^[6-9][0-9]{8}$' THEN t.dig
          WHEN t.dig ~ '^(00)?34[6-9][0-9]{8}$' THEN right(t.dig, 9)
          ELSE NULL
        END
        FROM (SELECT regexp_replace(l."phone", '[^0-9]', '', 'g') AS dig) t
      )
      WHERE l."phone" IS NOT NULL AND l."phoneNormalized" IS NULL;
    `);

    expect(await buscar('phone=611222333')).toContain(viejo.id);
  });

  it('el backfill canoniza IGUAL que el código: los cuatro formatos acaban en el mismo valor', async () => {
    // La regla vive en `phone-format.ts` y la migración la escribió una vez en SQL. Que las
    // dos coincidan no es evidente, y si no coincidieran el backfill dejaría un histórico
    // que el filtro no encuentra — el fallo que la barrera 2 existe para impedir.
    const ids = await Promise.all(
      ['677111222', '677 111 222', '+34677111222', '0034 677 111 222'].map((p) =>
        crearAnuncio({ phone: p, phoneNormalized: null }).then((l) => l.id),
      ),
    );
    await prisma.$executeRawUnsafe(`
      UPDATE "Listing" l
      SET "phoneNormalized" = (
        SELECT CASE
          WHEN t.dig ~ '^[6-9][0-9]{8}$' THEN t.dig
          WHEN t.dig ~ '^(00)?34[6-9][0-9]{8}$' THEN right(t.dig, 9)
          ELSE NULL
        END
        FROM (SELECT regexp_replace(l."phone", '[^0-9]', '', 'g') AS dig) t
      )
      WHERE l.id IN (${ids.map((i) => `'${i}'`).join(',')});
    `);

    const filas = await prisma.listing.findMany({
      where: { id: { in: ids } },
      select: { phoneNormalized: true },
    });
    expect(new Set(filas.map((f) => f.phoneNormalized))).toEqual(new Set(['677111222']));
  });

  it('y el alta por la API escribe LOS DOS campos', async () => {
    // `phone` es lo que ve el comprador; `phoneNormalized` lo único con lo que se busca.
    // Escribir uno sin el otro deja un anuncio con teléfono que el buscador no encuentra, y
    // el fallo es invisible porque la pantalla del vendedor se ve perfecta.
    const res = await request(server())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        title: 'Anuncio con teléfono por la API',
        description: 'Descripción suficientemente larga para pasar la validación.',
        price: 50,
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        categoryId,
        city: 'Getafe',
        province: 'Madrid',
        phone: '+34 622 33 44 55',
      })
      .expect(201);

    const fila = await prisma.listing.findUniqueOrThrow({ where: { id: res.body.id } });
    // El visible, TAL COMO LO ESCRIBIÓ.
    expect(fila.phone).toBe('+34 622 33 44 55');
    // Y el canónico al lado.
    expect(fila.phoneNormalized).toBe('622334455');
    expect(await buscar('phone=622334455')).toContain(fila.id);
  });

  it('editar el teléfono mueve LOS DOS, y el viejo deja de encontrarse', async () => {
    const res = await request(server())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        title: 'Anuncio que cambia de teléfono',
        description: 'Descripción suficientemente larga para pasar la validación.',
        price: 50, type: 'PRODUCT', priceType: 'FIXED', condition: 'GOOD',
        categoryId, city: 'Getafe', province: 'Madrid', phone: '633111222',
      })
      .expect(201);

    await request(server())
      .patch(`/api/listings/${res.body.id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ phone: '644 555 666' })
      .expect(200);

    expect(await buscar('phone=633111222')).not.toContain(res.body.id);
    expect(await buscar('phone=644555666')).toContain(res.body.id);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA 3 — municipio y provincia, parámetros propios
  // ───────────────────────────────────────────────────────────────────────────

  it('BARRERA 3: «DE Toledo» y «MENCIONA Toledo» son preguntas distintas', async () => {
    const deToledo = await crearAnuncio({
      title: 'Bicicleta de carretera',
      description: 'En buen estado.',
      province: 'Toledo',
      city: 'Illescas',
    });
    const mencionaToledo = await crearAnuncio({
      title: 'Mapa antiguo',
      description: 'Un mapa de Toledo del siglo XIX.',
      province: 'Madrid',
      city: 'Getafe',
    });

    // El parámetro propio trae SÓLO el que está en Toledo.
    const porProvincia = await buscar('province=Toledo');
    expect(porProvincia).toContain(deToledo.id);
    expect(porProvincia).not.toContain(mencionaToledo.id);

    // Y el buscador de texto sigue trayendo el que lo menciona, sin mezclarse.
    const porTexto = await buscar('q=Toledo');
    expect(porTexto).toContain(mencionaToledo.id);
    expect(porTexto).not.toContain(deToledo.id);
  });

  it('el municipio filtra por su cuenta y se combina con la provincia', async () => {
    const illescas = await crearAnuncio({ province: 'Toledo', city: 'Illescas' });
    const getafe = await crearAnuncio({ province: 'Madrid', city: 'Getafe' });

    expect(await buscar('city=Illescas')).toContain(illescas.id);
    expect(await buscar('city=Illescas')).not.toContain(getafe.id);

    // Combinados: los dos ejes se cruzan, como el resto de filtros de F2.
    expect(await buscar('province=Toledo&city=Illescas')).toContain(illescas.id);
    expect(await buscar('province=Madrid&city=Illescas')).toEqual([]);
  });

  it('sin acentos ni mayúsculas de más: es parcial e insensible', async () => {
    // Son texto libre que teclea el vendedor, así que exacto fallaría con cualquier
    // variante. Y parcial es más útil: «Alcalá» trae las dos Alcalás.
    const a = await crearAnuncio({ province: 'Madrid', city: 'Alcalá de Henares' });
    const b = await crearAnuncio({ province: 'Sevilla', city: 'Alcalá de Guadaíra' });

    const ids = await buscar(`city=${encodeURIComponent('alcalá')}`);
    expect(ids).toEqual(expect.arrayContaining([a.id, b.id]));
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA 4 — lo que NO cambia
  // ───────────────────────────────────────────────────────────────────────────

  it('BARRERA 4: la IP sigue FUERA del buscador de texto, y sigue siendo exacta', async () => {
    // La barrera de 5b, reafirmada desde el otro lado: al ampliar `q` no puede colarse la IP
    // «de regalo». Un `contains` sobre 10.0.0.1 traería 110.0.0.10, y en una investigación
    // de multicuenta eso es señalar a quien no es.
    const suyo = await crearAnuncio({ lastOwnerIp: '10.0.0.1' });
    const parecido = await crearAnuncio({ lastOwnerIp: '110.0.0.10' });

    // Por su parámetro: exacto, sólo el suyo.
    const porIp = await buscar('ip=10.0.0.1');
    expect(porIp).toContain(suyo.id);
    expect(porIp).not.toContain(parecido.id);

    // Y por el buscador de texto: NINGUNO. La IP no es texto del anuncio.
    const porTexto = await buscar('q=10.0.0.1');
    expect(porTexto).not.toContain(suyo.id);
    expect(porTexto).not.toContain(parecido.id);
  });

  it('los cuatro que ya filtraban siguen filtrando: título, descripción, slug e id', async () => {
    const anuncio = await crearAnuncio({
      title: 'Trombón de varas plateado',
      description: 'Con su estuche original y la boquilla.',
    });

    expect(await buscar('q=Trombón')).toContain(anuncio.id);
    expect(await buscar('q=boquilla')).toContain(anuncio.id);
    expect(await buscar(`q=${anuncio.slug}`)).toContain(anuncio.id);
    expect(await buscar(`q=${anuncio.id}`)).toEqual([anuncio.id]);
  });
});
