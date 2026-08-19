// NAV PRINCIPAL (RN.2) — árbol propio (NavItem auto-referencial), independiente
// del footer. Cubre: permisos ADMIN-only, el destino OPCIONAL validado en el
// servicio (incluida la regla nueva "sin destino se acepta"), las guardas del
// árbol (profundidad y ciclos), el gate recursivo servido por GET /nav filtrado
// por tipo de página, el cascade del subárbol al borrar, y el precheck de
// borrado de una página enlazada SOLO desde el nav (que sin la ampliación de
// BlogService sería un 500 en vez de un 400).

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

describe('Nav principal (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  let adminToken: string;
  let editorToken: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    const passwordHash = await bcrypt.hash('Test1234!', 4);

    await Promise.all([
      prisma.user.create({
        data: {
          email: 'nav-admin@example.com',
          name: 'Nav Admin',
          slug: 'nav-admin',
          passwordHash,
          emailVerified: true,
          role: 'ADMIN',
        },
      }),
      prisma.user.create({
        data: {
          email: 'nav-editor@example.com',
          name: 'Nav Editor',
          slug: 'nav-editor',
          passwordHash,
          emailVerified: true,
          role: 'EDITOR',
        },
      }),
    ]);

    const [adminRes, editorRes] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/auth/admin-login')
        .send({ email: 'nav-admin@example.com', password: 'Test1234!' }),
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'nav-editor@example.com', password: 'Test1234!' }),
    ]);

    adminToken = adminRes.body.accessToken as string;
    editorToken = editorRes.body.accessToken as string;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const server = () => app.getHttpServer();
  const asAdmin = (req: request.Test) => req.set('Authorization', `Bearer ${adminToken}`);

  async function createPage(overrides: { title: string; slug: string; status?: 'DRAFT' | 'PUBLISHED' }) {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'nav-admin@example.com' } });
    return prisma.post.create({
      data: {
        type: 'PAGE',
        title: overrides.title,
        slug: overrides.slug,
        blocks: [],
        status: overrides.status ?? 'PUBLISHED',
        publishedAt: overrides.status === 'DRAFT' ? null : new Date(),
        authorId: admin.id,
      },
    });
  }

  /** Deja el árbol vacío entre bloques que comprueban el render público. */
  async function clearNav() {
    await prisma.navItem.deleteMany({});
  }

  // ── Permisos ─────────────────────────────────────────────────────────────

  it('GET /api/admin/nav sin token → 401', async () => {
    await request(server()).get('/api/admin/nav').expect(401);
  });

  // ROLES R2 — este caso afirmaba `EDITOR → 403`. La navegación del sitio público
  // baja a EDITOR junto al footer, la portada y los banners: configurar por dónde
  // se mueve el visitante es el mismo oficio que escribir lo que lee. El suelo no
  // se mueve — «sin token → 401», justo arriba.
  it('EDITOR → POST /api/admin/nav/items → 201 (el nav público es su oficio desde R2)', async () => {
    const res = await request(server())
      .post('/api/admin/nav/items')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ label: 'Ayuda (editor)' })
      .expect(201);

    // Se limpia: el resto del fichero cuenta y ordena nodos del árbol.
    await prisma.navItem.delete({ where: { id: res.body.id as string } });
  });

  it('GET /api/nav es público (sin token) pero exige un pageType válido', async () => {
    await request(server()).get('/api/nav?pageType=HOME').expect(200);
    await request(server()).get('/api/nav?pageType=NO_EXISTE').expect(400);
    await request(server()).get('/api/nav').expect(400);
  });

  // ── Destino opcional (la regla que separa el nav del footer) ─────────────

  it('POST items SIN type → 201: un nodo solo-desplegable es válido al escribir', async () => {
    const res = await asAdmin(request(server()).post('/api/admin/nav/items'))
      .send({ label: 'Solo desplegable' })
      .expect(201);

    expect(res.body.type).toBeNull();
    expect(res.body.pageId).toBeNull();
    expect(res.body.url).toBeNull();
    // active y visibleOn toman sus defaults: visible y sin filtro.
    expect(res.body.active).toBe(true);
    expect(res.body.visibleOn).toEqual([]);

    await asAdmin(request(server()).delete(`/api/admin/nav/items/${res.body.id}`)).expect(204);
  });

  it('POST items sin type pero con url colada → 400 (destino fantasma)', async () => {
    await asAdmin(request(server()).post('/api/admin/nav/items'))
      .send({ label: 'Incoherente', url: '/busqueda' })
      .expect(400)
      .expect((res) => expect(res.body.message).toContain('url debe ir vacío en un nodo sin destino'));
  });

  it('POST items type=PAGE sin pageId → 400', async () => {
    await asAdmin(request(server()).post('/api/admin/nav/items'))
      .send({ label: 'Ayuda', type: 'PAGE' })
      .expect(400)
      .expect((res) => expect(res.body.message).toContain('pageId es obligatorio cuando type=PAGE'));
  });

  it('POST items type=INTERNAL con URL absoluta → 400', async () => {
    await asAdmin(request(server()).post('/api/admin/nav/items'))
      .send({ label: 'Malo', type: 'INTERNAL', url: 'https://example.com' })
      .expect(400)
      .expect((res) => expect(res.body.message).toContain('Una ruta interna debe empezar por "/"'));
  });

  it('POST items type=EXTERNAL con ruta relativa → 400', async () => {
    await asAdmin(request(server()).post('/api/admin/nav/items'))
      .send({ label: 'Malo', type: 'EXTERNAL', url: '/busqueda' })
      .expect(400)
      .expect((res) => expect(res.body.message).toContain('url debe ser una URL absoluta'));
  });

  it('POST items type=PAGE apuntando a un POST de blog → 400', async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'nav-admin@example.com' } });
    const post = await prisma.post.create({
      data: {
        type: 'POST',
        title: 'Artículo',
        slug: 'articulo-nav',
        blocks: [],
        status: 'PUBLISHED',
        publishedAt: new Date(),
        authorId: admin.id,
      },
    });

    await asAdmin(request(server()).post('/api/admin/nav/items'))
      .send({ label: 'Artículo', type: 'PAGE', pageId: post.id })
      .expect(400)
      .expect((res) => expect(res.body.message).toContain('página informativa (type=PAGE)'));
  });

  // ── Guardas del árbol ────────────────────────────────────────────────────

  it('no deja colgar un nodo de un submenú (3.er nivel) ni crear ciclos', async () => {
    const root = await asAdmin(request(server()).post('/api/admin/nav/items'))
      .send({ label: 'Raíz', type: 'INTERNAL', url: '/raiz' })
      .expect(201);

    const child = await asAdmin(request(server()).post('/api/admin/nav/items'))
      .send({ label: 'Hijo', type: 'INTERNAL', url: '/hijo', parentId: root.body.id })
      .expect(201);

    // Tercer nivel: rechazado.
    await asAdmin(request(server()).post('/api/admin/nav/items'))
      .send({ label: 'Nieto', type: 'INTERNAL', url: '/nieto', parentId: child.body.id })
      .expect(400)
      .expect((res) => expect(res.body.message).toContain('ya es un submenú'));

    // Ciclo sobre sí mismo.
    await asAdmin(request(server()).patch(`/api/admin/nav/items/${root.body.id}`))
      .send({ parentId: root.body.id })
      .expect(400)
      .expect((res) => expect(res.body.message).toContain('no puede colgar de sí mismo'));

    // Ciclo padre→hijo.
    await asAdmin(request(server()).patch(`/api/admin/nav/items/${root.body.id}`))
      .send({ parentId: child.body.id })
      .expect(400);

    await clearNav();
  });

  it('mover bajo otra raíz un nodo QUE TIENE hijos → 400 (arrastraría nietos)', async () => {
    const otraRaiz = await asAdmin(request(server()).post('/api/admin/nav/items'))
      .send({ label: 'Otra raíz', type: 'INTERNAL', url: '/otra' })
      .expect(201);
    const conHijos = await asAdmin(request(server()).post('/api/admin/nav/items'))
      .send({ label: 'Con hijos', type: 'INTERNAL', url: '/con-hijos' })
      .expect(201);
    await asAdmin(request(server()).post('/api/admin/nav/items'))
      .send({ label: 'Hijo', type: 'INTERNAL', url: '/hijo', parentId: conHijos.body.id })
      .expect(201);

    await asAdmin(request(server()).patch(`/api/admin/nav/items/${conHijos.body.id}`))
      .send({ parentId: otraRaiz.body.id })
      .expect(400)
      .expect((res) => expect(res.body.message).toContain('quedarían a un tercer nivel'));

    await clearNav();
  });

  // ── GET /nav: el gate recursivo servido ──────────────────────────────────

  it('devuelve el árbol podado y con href resuelto, filtrado por tipo de página', async () => {
    await clearNav();
    const page = await createPage({ title: 'Legal', slug: 'legal-nav' });

    const ayuda = await asAdmin(request(server()).post('/api/admin/nav/items'))
      .send({ label: 'Ayuda', order: 1 }) // sin destino: solo-desplegable
      .expect(201);

    await asAdmin(request(server()).post('/api/admin/nav/items'))
      .send({ label: 'Legal', type: 'PAGE', pageId: page.id, parentId: ayuda.body.id })
      .expect(201);

    await asAdmin(request(server()).post('/api/admin/nav/items'))
      .send({ label: 'Buscar', type: 'INTERNAL', url: '/busqueda', order: 0 })
      .expect(201);

    await asAdmin(request(server()).post('/api/admin/nav/items'))
      .send({ label: 'Solo home', type: 'EXTERNAL', url: 'https://example.com', order: 2, visibleOn: ['HOME'] })
      .expect(201);

    const home = await request(server()).get('/api/nav?pageType=HOME').expect(200);
    expect(home.body).toEqual([
      { label: 'Buscar', href: '/busqueda', external: false, children: [] },
      {
        label: 'Ayuda',
        href: null,
        external: false,
        children: [{ label: 'Legal', href: '/paginas/legal-nav', external: false, children: [] }],
      },
      { label: 'Solo home', href: 'https://example.com', external: true, children: [] },
    ]);

    // En otro tipo de página, el nodo con visibleOn=[HOME] desaparece.
    const busqueda = await request(server()).get('/api/nav?pageType=BUSQUEDA').expect(200);
    expect(busqueda.body.map((n: { label: string }) => n.label)).toEqual(['Buscar', 'Ayuda']);
  });

  it('desactivar el padre se lleva el subárbol; despublicar la página vacía el desplegable', async () => {
    const tree = await asAdmin(request(server()).get('/api/admin/nav')).expect(200);
    const ayuda = tree.body.find((n: { label: string }) => n.label === 'Ayuda');

    // Despublicar la única página del desplegable → "Ayuda" se queda sin nada
    // que abrir y desaparece, aunque el nodo siga activo.
    await prisma.post.update({ where: { slug: 'legal-nav' }, data: { status: 'DRAFT' } });
    const sinPagina = await request(server()).get('/api/nav?pageType=HOME').expect(200);
    expect(sinPagina.body.map((n: { label: string }) => n.label)).not.toContain('Ayuda');

    await prisma.post.update({ where: { slug: 'legal-nav' }, data: { status: 'PUBLISHED' } });

    // Desactivar el padre oculta también al hijo (no se promociona a raíz).
    await asAdmin(request(server()).patch(`/api/admin/nav/items/${ayuda.id}`))
      .send({ active: false })
      .expect(200);

    const inactivo = await request(server()).get('/api/nav?pageType=HOME').expect(200);
    const labels = inactivo.body.map((n: { label: string }) => n.label);
    expect(labels).not.toContain('Ayuda');
    expect(labels).not.toContain('Legal');
  });

  it('sin ningún nodo visible → [] (la barra no se renderizará)', async () => {
    await clearNav();
    const res = await request(server()).get('/api/nav?pageType=HOME').expect(200);
    expect(res.body).toEqual([]);
  });

  // ── Reorden y su gotcha de rutas ─────────────────────────────────────────

  it('PATCH items/reorder NO se captura como items/:id y reordena hermanos', async () => {
    await clearNav();
    const a = await asAdmin(request(server()).post('/api/admin/nav/items'))
      .send({ label: 'A', type: 'INTERNAL', url: '/a', order: 0 })
      .expect(201);
    const b = await asAdmin(request(server()).post('/api/admin/nav/items'))
      .send({ label: 'B', type: 'INTERNAL', url: '/b', order: 1 })
      .expect(201);

    await asAdmin(request(server()).patch('/api/admin/nav/items/reorder'))
      .send({ items: [{ id: a.body.id, order: 1 }, { id: b.body.id, order: 0 }] })
      .expect(200);

    const res = await request(server()).get('/api/nav?pageType=HOME').expect(200);
    expect(res.body.map((n: { label: string }) => n.label)).toEqual(['B', 'A']);
  });

  // ── Borrado: cascade del subárbol ────────────────────────────────────────

  it('DELETE de un menú se lleva su subárbol (cascade)', async () => {
    await clearNav();
    const padre = await asAdmin(request(server()).post('/api/admin/nav/items'))
      .send({ label: 'Padre', type: 'INTERNAL', url: '/padre' })
      .expect(201);
    await asAdmin(request(server()).post('/api/admin/nav/items'))
      .send({ label: 'Hijo', type: 'INTERNAL', url: '/hijo', parentId: padre.body.id })
      .expect(201);

    await asAdmin(request(server()).delete(`/api/admin/nav/items/${padre.body.id}`)).expect(204);

    expect(await prisma.navItem.count()).toBe(0);
  });

  // ── El precheck ampliado de BlogService (§6.2) ───────────────────────────

  it('borrar una PAGE enlazada SOLO desde el nav → 400 legible, NO un 500', async () => {
    await clearNav();
    const page = await createPage({ title: 'Enlazada', slug: 'enlazada-solo-nav' });

    await asAdmin(request(server()).post('/api/admin/nav/items'))
      .send({ label: 'Enlazada', type: 'PAGE', pageId: page.id })
      .expect(201);

    await asAdmin(request(server()).delete(`/api/admin/blog/${page.id}`))
      .expect(400)
      .expect((res) => {
        expect(res.body.message).toContain('sitio(s) del nav');
      });

    // La página sigue viva: el precheck rechazó antes de tocar nada.
    expect(await prisma.post.findUnique({ where: { id: page.id } })).not.toBeNull();
  });

  it('desenlazada del nav, la misma PAGE ya se puede borrar', async () => {
    const page = await prisma.post.findUniqueOrThrow({ where: { slug: 'enlazada-solo-nav' } });
    await clearNav();

    await asAdmin(request(server()).delete(`/api/admin/blog/${page.id}`)).expect(204);
    expect(await prisma.post.findUnique({ where: { id: page.id } })).toBeNull();
  });
});
