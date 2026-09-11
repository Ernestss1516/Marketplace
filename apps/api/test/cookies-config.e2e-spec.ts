// COOKIES RÁFAGA 2 — el texto del banner y el enlace anónimo → logueado.
//
// Ver docs/diseno-consentimiento-cookies.md §2.4 y §4.
//
// Lo que se cubre, y por qué:
//   · LA FRONTERA: el admin edita TEXTO. No hay ninguna vía por la que esta API pueda
//     apagar el banner, cambiar qué se bloquea ni quitar el botón de rechazar — y la
//     única validación de contenido que existe protege justamente eso último;
//   · los DEFECTOS: sin filas, el texto sale igual. Un banner legal no puede desaparecer
//     porque a una instancia le falte un ajuste;
//   · el ENLACE con la cuenta: escribe una fila nueva, no toca la vieja, y no duplica.

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

describe('Cookies — config del banner y vinculación (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminToken: string;
  let userToken: string;
  let userId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    const passwordHash = await bcrypt.hash('Test1234!', 4);
    const [, usuario] = await Promise.all([
      prisma.user.create({
        data: {
          email: 'cookies-admin@example.com',
          name: 'Cookies Admin',
          slug: 'cookies-admin',
          passwordHash,
          emailVerified: true,
          role: 'ADMIN',
        },
      }),
      prisma.user.create({
        data: {
          email: 'cookies-user@example.com',
          name: 'Cookies User',
          slug: 'cookies-user',
          passwordHash,
          emailVerified: true,
        },
      }),
    ]);
    userId = usuario.id;

    const [adminRes, userRes] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/auth/admin-login')
        .send({ email: 'cookies-admin@example.com', password: 'Test1234!' }),
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'cookies-user@example.com', password: 'Test1234!' }),
    ]);
    adminToken = adminRes.body.accessToken as string;
    userToken = userRes.body.accessToken as string;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('GET /cookies/config — público', () => {
    it('devuelve el texto sin necesidad de credenciales', async () => {
      const res = await request(app.getHttpServer()).get('/api/cookies/config').expect(200);

      for (const campo of [
        'title',
        'body',
        'acceptLabel',
        'rejectLabel',
        'moreLabel',
        'policyUrl',
        'version',
      ]) {
        expect(res.body).toHaveProperty(campo);
      }
      expect(typeof res.body.title).toBe('string');
    });

    it('SIN FILAS devuelve los defectos — el banner nunca se queda sin texto', async () => {
      await prisma.setting.deleteMany({ where: { key: 'cookieBannerTitle' } });

      const res = await request(app.getHttpServer()).get('/api/cookies/config').expect(200);

      // Un banner que desaparece porque falta un ajuste sería un incumplimiento causado
      // por un descuido de despliegue. Es la lección de `videoEnabled`, aplicada donde
      // más duele.
      expect(res.body.title).toBe('Cookies y contenido de terceros');
    });
  });

  describe('PUT /admin/cookies-config — la frontera', () => {
    it('un ADMIN cambia el texto', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/admin/cookies-config')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Tu privacidad' })
        .expect(200);

      expect(res.body.title).toBe('Tu privacidad');
      // Parcial: lo que no se manda no se toca (por eso corregir una errata no mueve la
      // versión, que es el campo que no debe moverse por accidente).
      expect(res.body.acceptLabel).toBe('Aceptar');
    });

    it('un usuario normal NO puede tocarlo', async () => {
      await request(app.getHttpServer())
        .put('/api/admin/cookies-config')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ title: 'Intento' })
        .expect(403);
    });

    it('LA BARRERA — el botón de rechazar no puede decir «aceptar»', async () => {
      // Poner «Aceptar» en los dos botones deja el sistema NO CONFORME aunque la
      // mecánica sea impecable, y nadie lo notaría mirando el código. Se corta en el
      // servidor, no con un aviso en la pantalla: un aviso se ignora.
      const res = await request(app.getHttpServer())
        .put('/api/admin/cookies-config')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ rejectLabel: 'Aceptar también' })
        .expect(422);

      expect(res.body.message).toMatch(/rechazo inequívoco/i);
    });

    it.each([['Vale'], ['Permitir todo'], ['OK']])(
      'tampoco «%s» como etiqueta de rechazo',
      async (etiqueta) => {
        await request(app.getHttpServer())
          .put('/api/admin/cookies-config')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ rejectLabel: etiqueta })
          .expect(422);
      },
    );

    it('no acepta un enlace que no sea interno o https', async () => {
      // Un `javascript:` en un enlace que sale en TODAS las páginas sería un XSS con
      // alcance total.
      await request(app.getHttpServer())
        .put('/api/admin/cookies-config')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ policyUrl: 'javascript:alert(1)' })
        .expect(422);
    });

    it('no deja vaciar un texto obligatorio: el banner tiene que decir algo', async () => {
      await request(app.getHttpServer())
        .put('/api/admin/cookies-config')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ acceptLabel: '   ' })
        .expect(422);
    });

    it('LA FRONTERA — intentar tocar la MECÁNICA se rechaza, no se ignora', async () => {
      // El DTO sólo conoce siete campos de TEXTO, y el `ValidationPipe` global del repo
      // rechaza lo que no esté declarado. Así que la API no es que ignore un intento de
      // apagar el banner: lo rechaza con un 400, porque esa clave no existe en ninguna
      // parte. La frontera la sostiene el modelo, no un comentario en la pantalla.
      await request(app.getHttpServer())
        .put('/api/admin/cookies-config')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ bannerEnabled: false, bloquearTerceros: false, categorias: ['marketing'] })
        .expect(400);

      const claves = await prisma.setting.findMany({
        where: { key: { in: ['bannerEnabled', 'bloquearTerceros', 'categorias'] } },
      });
      expect(claves).toHaveLength(0);
    });

    it('deja rastro en la auditoría', async () => {
      await request(app.getHttpServer())
        .put('/api/admin/cookies-config')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ body: 'Otro mensaje distinto.' })
        .expect(200);

      const log = await prisma.auditLog.findFirst({
        where: { action: 'COOKIE_CONFIG_UPDATE' },
        orderBy: { createdAt: 'desc' },
      });
      expect(log).not.toBeNull();
      expect(log!.resourceId).toBe('cookies-config');
    });
  });

  describe('BARRERA — el banner legal nunca enlaza a un 404', () => {
    /**
     * La política de cookies vive en el CMS y nace EN BORRADOR, esperando el texto de
     * asesoría. Entre que alguien apunta su ruta en los ajustes y el día que la publica
     * pueden pasar semanas — y durante todas ellas el «Más información» del banner
     * llevaría a una página inexistente, desde el aviso legal, que es el peor sitio
     * posible para un enlace roto.
     *
     * Por eso la URL sólo se sirve si la página está PUBLICADA. Publicar es el único acto
     * necesario: nadie tiene que acordarse de volver a los ajustes.
     */
    async function crearPagina(status: 'DRAFT' | 'PUBLISHED') {
      const autor = await prisma.user.findUniqueOrThrow({
        where: { email: 'cookies-admin@example.com' },
      });
      return prisma.post.create({
        data: {
          type: 'PAGE',
          title: 'Política de cookies',
          slug: 'cookies',
          blocks: [],
          status,
          publishedAt: status === 'PUBLISHED' ? new Date() : null,
          authorId: autor.id,
        },
      });
    }

    beforeEach(async () => {
      await prisma.post.deleteMany({ where: { slug: 'cookies' } });
      await request(app.getHttpServer())
        .put('/api/admin/cookies-config')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ policyUrl: '/paginas/cookies' })
        .expect(200);
    });

    afterAll(async () => {
      await prisma.post.deleteMany({ where: { slug: 'cookies' } });
    });

    it('con la página en BORRADOR, la URL vuelve VACÍA (el banner usa su detalle inline)', async () => {
      await crearPagina('DRAFT');

      const res = await request(app.getHttpServer()).get('/api/cookies/config').expect(200);

      // Vacía, no la ruta: el visitante ve información en el propio banner en vez de un
      // 404. Es el respaldo que dejó montado la ráfaga 2.
      expect(res.body.policyUrl).toBe('');
    });

    it('sin página ninguna, también vuelve vacía', async () => {
      const res = await request(app.getHttpServer()).get('/api/cookies/config').expect(200);
      expect(res.body.policyUrl).toBe('');
    });

    it('al PUBLICARLA, la URL se sirve y el «ver más» pasa a navegar', async () => {
      await crearPagina('PUBLISHED');

      const res = await request(app.getHttpServer()).get('/api/cookies/config').expect(200);
      expect(res.body.policyUrl).toBe('/paginas/cookies');
    });

    it('el ajuste guardado NO cambia: lo que cambia es lo que se SIRVE', async () => {
      await crearPagina('DRAFT');

      // Quien administra sigue viendo la ruta que escribió —no se la borramos por la
      // espalda—; es el endpoint público el que la retiene mientras no haya nada que leer.
      const admin = await request(app.getHttpServer())
        .get('/api/admin/cookies-config')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(admin.body.policyUrl).toBe('');

      const fila = await prisma.setting.findUniqueOrThrow({ where: { key: 'cookiePolicyUrl' } });
      expect(fila.value).toBe('/paginas/cookies');
    });

    it('una URL externa se sirve tal cual: no somos un validador de enlaces', async () => {
      // Si la política se aloja fuera, no hay nada que comprobar aquí. La regla cubre un
      // caso concreto y conocido —nuestra propia página del CMS—, no todos los enlaces.
      await request(app.getHttpServer())
        .put('/api/admin/cookies-config')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ policyUrl: 'https://ejemplo.es/cookies' })
        .expect(200);

      const res = await request(app.getHttpServer()).get('/api/cookies/config').expect(200);
      expect(res.body.policyUrl).toBe('https://ejemplo.es/cookies');
    });
  });

  describe('POST /consent/vincular — anónimo → logueado', () => {
    it('ata la decisión anónima a la cuenta con una fila NUEVA', async () => {
      const anonima = await prisma.consentRecord.create({
        data: { action: 'GRANTED', categories: ['terceros'], policyVersion: 'v-vinc-1' },
      });

      const res = await request(app.getHttpServer())
        .post('/api/consent/vincular')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ consentRecordId: anonima.id })
        .expect(200);

      expect(res.body.id).toEqual(expect.any(String));

      const nueva = await prisma.consentRecord.findUniqueOrThrow({
        where: { id: res.body.id as string },
      });
      expect(nueva.userId).toBe(userId);
      expect(nueva.action).toBe('UPDATED');
      expect(nueva.categories).toEqual(['terceros']);

      // LA FILA VIEJA NO SE TOCA: en aquel momento no había ninguna cuenta detrás, y el
      // registro tiene que decir lo que pasó, no lo que se supo después.
      const original = await prisma.consentRecord.findUniqueOrThrow({ where: { id: anonima.id } });
      expect(original.userId).toBeNull();
      expect(original.action).toBe('GRANTED');
    });

    it('no duplica: el navegador lo llama en cada carga con sesión', async () => {
      const anonima = await prisma.consentRecord.create({
        data: { action: 'GRANTED', categories: ['terceros'], policyVersion: 'v-vinc-2' },
      });

      const primera = await request(app.getHttpServer())
        .post('/api/consent/vincular')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ consentRecordId: anonima.id })
        .expect(200);
      expect(primera.body.id).toEqual(expect.any(String));

      const segunda = await request(app.getHttpServer())
        .post('/api/consent/vincular')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ consentRecordId: anonima.id })
        .expect(200);

      // El corte vive en el servidor y no en el cliente: una marca en `sessionStorage` se
      // pierde al abrir otra pestaña y volvería a llenar la tabla de la prueba.
      expect(segunda.body.id).toBeNull();
    });

    it('un id que no existe no es un error: no hay nada que unir', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/consent/vincular')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ consentRecordId: 'noexisteenninguanparte' })
        .expect(200);
      expect(res.body.id).toBeNull();
    });

    it('sin sesión NO se puede vincular', async () => {
      // El `userId` sale del token, nunca del cuerpo: si viniera del cliente, cualquiera
      // podría atribuirle un consentimiento a otra persona.
      await request(app.getHttpServer())
        .post('/api/consent/vincular')
        .send({ consentRecordId: 'cualquiera' })
        .expect(401);
    });
  });
});
