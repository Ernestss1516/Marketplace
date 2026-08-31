import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { withSetting } from './helpers/settings';
import { BUMP_SCHEDULE_TIMEZONE } from 'src/modules/bump-schedule/next-run';

/**
 * AJUSTES RÁFAGA B — EL PANEL DE INSTANCIA, Y SOBRE TODO LO QUE NO PUEDE LLEVAR.
 *
 * ── LA BARRERA QUE JUSTIFICA ESTA SUITE ───────────────────────────────────────────────────
 *
 * `GET /admin/instance-info` publica cómo está montada la máquina. La línea entre «útil» y
 * «filtración» es exactamente una: **de una credencial se dice si está puesta, nunca cuánto
 * vale**. El endpoint respeta esa línea porque construye su objeto campo a campo… hoy. Este
 * test es lo que hace que la siga respetando dentro de un año, cuando alguien añada un campo
 * «para depurar rápido».
 *
 * NO COMPRUEBA NOMBRES DE CAMPO, COMPRUEBA VALORES. Buscar la cadena «RESEND_API_KEY» en la
 * respuesta no serviría de nada: el peligro no es que aparezca el nombre de la variable, es que
 * aparezca su CONTENIDO, con el nombre que sea. Así que se toman los valores reales del entorno
 * de test y se busca cada uno dentro de la respuesta serializada. Da igual cómo se llame el
 * campo, si está anidado o si se colara dentro de una frase.
 *
 * MUTACIÓN QUE LO PONE ROJO: añadir `apiKey: this.config.get('resend.apiKey')` —o la
 * `DATABASE_URL`, o un «fragmento» de la clave de Redsys— al objeto del servicio.
 */
describe('Panel de instancia — GET /admin/instance-info (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  let adminToken: string;
  let moderatorToken: string;

  const sufijo = randomUUID().slice(0, 8);
  const emails = {
    admin: `inst-admin-${sufijo}@test.local`,
    moderator: `inst-mod-${sufijo}@test.local`,
  };

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();

    const passwordHash = await bcrypt.hash('Password123!', 10);
    await prisma.user.createMany({
      data: [
        {
          email: emails.admin,
          name: 'Admin instancia',
          slug: `inst-admin-${sufijo}`,
          passwordHash,
          role: 'ADMIN',
          emailVerified: true,
        },
        {
          email: emails.moderator,
          name: 'Moderador instancia',
          slug: `inst-mod-${sufijo}`,
          passwordHash,
          role: 'MODERATOR',
          emailVerified: true,
        },
      ],
    });

    const [a, m] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/auth/admin-login')
        .send({ email: emails.admin, password: 'Password123!' }),
      request(app.getHttpServer())
        .post('/api/auth/admin-login')
        .send({ email: emails.moderator, password: 'Password123!' }),
    ]);
    adminToken = a.body.accessToken;
    moderatorToken = m.body.accessToken;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } });
    await app.close();
    await prisma.$disconnect();
  });

  const pedir = (token: string) =>
    request(app.getHttpServer()).get('/api/admin/instance-info').set('Authorization', `Bearer ${token}`);

  // ===========================================================================
  // BARRERA 1 — NINGÚN SECRETO. La crítica.
  // ===========================================================================
  describe('BARRERA 1 — de una credencial se publica el hecho, nunca el valor', () => {
    it('la respuesta NO contiene el valor de NINGÚN secreto del entorno', async () => {
      const res = await pedir(adminToken).expect(200);
      const serializada = JSON.stringify(res.body);

      /**
       * LA LISTA NEGRA de §6.3 de la auditoría, tomada del entorno REAL de este proceso — no
       * de literales escritos aquí, que envejecerían. Si una variable no está definida en el
       * entorno de test, se salta: no se puede buscar lo que no existe.
       *
       * `DATABASE_URL` y `REDIS_URL` entran aunque no sean «secretos» de nombre: la primera
       * lleva usuario y contraseña DENTRO de la cadena, y ninguna de las dos contesta ninguna
       * pregunta que un administrador se haga.
       */
      const PROHIBIDAS = [
        'DATABASE_URL',
        'REDIS_URL',
        'JWT_SECRET',
        'MEILI_MASTER_KEY',
        'RESEND_API_KEY',
        'CONTACT_FORM_SECRET',
        'STRIPE_SECRET_KEY',
        'STRIPE_WEBHOOK_SECRET',
        'REDSYS_SECRET_KEY',
        'S3_ACCESS_KEY_ID',
        'S3_SECRET_ACCESS_KEY',
        'REVALIDATE_SECRET',
        'MAPTILER_API_KEY',
      ];

      const filtradas: string[] = [];
      for (const nombre of PROHIBIDAS) {
        const valor = process.env[nombre];
        if (!valor || valor.trim().length < 4) continue;
        if (serializada.includes(valor.trim())) filtradas.push(nombre);
      }

      // El mensaje dice QUÉ se filtró: un `toEqual([])` a secas obligaría a leer el diff.
      expect(filtradas).toEqual([]);
    });

    it('tampoco un FRAGMENTO de un secreto: ni los últimos caracteres', async () => {
      const res = await pedir(adminToken).expect(200);
      const serializada = JSON.stringify(res.body);

      // Los «últimos 4» de una clave son la forma más común de colar un secreto creyendo que no
      // lo es. No lo son: no ayudan a confirmar nada que el booleano no confirme, y acercan a
      // quien no debería. Se comprueban colas de 6 para no dar falsos positivos con cadenas
      // cortas y comunes.
      const conCola = ['REDSYS_SECRET_KEY', 'STRIPE_SECRET_KEY', 'RESEND_API_KEY', 'JWT_SECRET'];
      const filtradas: string[] = [];
      for (const nombre of conCola) {
        const valor = process.env[nombre]?.trim();
        if (!valor || valor.length < 12) continue;
        if (serializada.includes(valor.slice(-6))) filtradas.push(nombre);
      }
      expect(filtradas).toEqual([]);
    });

    it('las credenciales aparecen como booleano y con nombre de hecho, no de valor', async () => {
      const res = await pedir(adminToken).expect(200);

      expect(typeof res.body.correos.proveedor.configurado).toBe('boolean');
      expect(typeof res.body.proveedores.pagoRecurrente.configurado).toBe('boolean');
      expect(typeof res.body.proveedores.pagoUnico.configurado).toBe('boolean');
      expect(typeof res.body.proveedores.loginGoogle.configurado).toBe('boolean');
      expect(typeof res.body.proveedores.observabilidad.configurado).toBe('boolean');

      // Y ninguna trae un campo con el valor al lado del booleano.
      expect(res.body.correos.proveedor).toEqual({ nombre: 'Resend', configurado: expect.any(Boolean) });
      expect(res.body.proveedores.loginGoogle).toEqual({ configurado: expect.any(Boolean) });
      expect(res.body.proveedores.observabilidad).toEqual({ configurado: expect.any(Boolean) });
    });
  });

  // ===========================================================================
  // BARRERA 2 — CAMPO A CAMPO: una env nueva NO aparece sola
  // ===========================================================================
  it('BARRERA 2 — una variable de entorno nueva no se cuela en la respuesta', async () => {
    // Si el objeto fuera un spread (o un filtro) de `process.env`, esta variable inventada
    // saldría publicada. Con una lista blanca escrita a mano, no puede.
    process.env.VARIABLE_INVENTADA_RAFAGA_B = `centinela-${sufijo}`;
    try {
      const res = await pedir(adminToken).expect(200);
      expect(JSON.stringify(res.body)).not.toContain('centinela-');
      expect(JSON.stringify(res.body)).not.toContain('VARIABLE_INVENTADA');
    } finally {
      delete process.env.VARIABLE_INVENTADA_RAFAGA_B;
    }
  });

  // ===========================================================================
  // BARRERA 3 — ADMIN-only
  // ===========================================================================
  describe('BARRERA 3 — es información de infraestructura: sólo ADMIN', () => {
    it('un MODERATOR recibe 403', async () => {
      await pedir(moderatorToken).expect(403);
    });

    it('sin token, 401', async () => {
      await request(app.getHttpServer()).get('/api/admin/instance-info').expect(401);
    });
  });

  // ===========================================================================
  // BARRERA 4 — LOS AVISOS: el panel existe para atrapar estas dos
  // ===========================================================================
  describe('BARRERA 4 — las alarmas latentes se pueden ver', () => {
    it('el proveedor de facturación dice si emite facturas VÁLIDAS (hoy, stub: no)', async () => {
      const res = await pedir(adminToken).expect(200);

      expect(res.body.proveedores.facturacion.proveedor).toBe('stub');
      // El hecho de negocio, calculado en el backend y no en la pantalla: el stub genera un PDF
      // de pega. Mientras esto sea `false`, la página tiene que pintar su aviso ámbar.
      expect(res.body.proveedores.facturacion.emiteFacturasValidas).toBe(false);
    });

    it('Redsys dice si los cobros son REALES (con REDSYS_ENVIRONMENT=test: no)', async () => {
      const res = await pedir(adminToken).expect(200);

      expect(res.body.proveedores.pagoUnico.entorno).toBe(
        process.env.REDSYS_ENVIRONMENT || 'test',
      );
      expect(res.body.proveedores.pagoUnico.cobrosReales).toBe(
        (process.env.REDSYS_ENVIRONMENT || 'test') === 'production',
      );
    });

    it('el remitente avisa si es el placeholder que trae el código de fábrica', async () => {
      const res = await pedir(adminToken).expect(200);
      const { direccion, esPlaceholder } = res.body.correos.remitente;
      expect(esPlaceholder).toBe(direccion === 'noreply@tudominio.es');
    });
  });

  // ===========================================================================
  // BARRERA 5 — NO INVENTAR lo que no existe
  // ===========================================================================
  describe('BARRERA 5 — lo que no hay se dice, no se rellena', () => {
    it('el correo de contacto público es null («no aplica»), no una dirección inventada', async () => {
      const res = await pedir(adminToken).expect(200);
      expect(res.body.correos.contactoPublico).toBeNull();
    });

    it('el IVA se declara POR LÍNEA: no hay un tipo global que enseñar', async () => {
      const res = await pedir(adminToken).expect(200);
      expect(res.body.configuracion.iva).toEqual({ modo: 'por-linea-de-factura' });
      // Y no se ha colado un 21 de ninguna forma.
      expect(JSON.stringify(res.body.configuracion.iva)).not.toContain('21');
    });

    it('el commit es null mientras nadie inyecte GIT_SHA — el hueco preparado', async () => {
      const res = await pedir(adminToken).expect(200);
      expect(res.body.configuracion.commit).toBe(process.env.GIT_SHA ?? null);
    });

    it('y se llena SOLO en cuanto el despliegue exporte GIT_SHA', async () => {
      process.env.GIT_SHA = 'abc1234';
      try {
        const res = await pedir(adminToken).expect(200);
        expect(res.body.configuracion.commit).toBe('abc1234');
      } finally {
        delete process.env.GIT_SHA;
      }
    });
  });

  // ===========================================================================
  // Lo que el panel SÍ contesta
  // ===========================================================================
  describe('los datos que difieren entre instancias', () => {
    it('las DOS zonas horarias, y si coinciden', async () => {
      const res = await pedir(adminToken).expect(200);
      const tz = res.body.configuracion.zonaHoraria;

      // Las programaciones de bump se interpretan siempre en la peninsular; los crons corren en
      // la del servidor. Enseñar sólo una escondería la discrepancia, que es el dato útil.
      expect(tz.programaciones).toBe(BUMP_SCHEDULE_TIMEZONE);
      expect(typeof tz.servidor).toBe('string');
      expect(tz.coinciden).toBe(tz.servidor === tz.programaciones);
    });

    it('el buzón de soporte sale del ajuste vigente, y `null` si no hay', async () => {
      await withSetting(prisma, 'supportEmail', 'soporte-instancia@example.com', async () => {
        const res = await pedir(adminToken).expect(200);
        expect(res.body.correos.buzonSoporte).toBe('soporte-instancia@example.com');
      });

      await withSetting(prisma, 'supportEmail', '', async () => {
        const res = await pedir(adminToken).expect(200);
        expect(res.body.correos.buzonSoporte).toBeNull();
      });
    });

    it('la periodicidad y la ventana fiscales, las vigentes de verdad', async () => {
      await withSetting(prisma, 'fiscalInvoicingPeriodicity', 'MONTHLY', async () => {
        const res = await pedir(adminToken).expect(200);
        expect(res.body.configuracion.facturacion.periodicidad).toBe('MONTHLY');
      });

      await withSetting(prisma, 'fiscalSelfServiceWindow', 9, async () => {
        const res = await pedir(adminToken).expect(200);
        expect(res.body.configuracion.facturacion.ventanaAutoservicioMeses).toBe(9);
      });
    });

    it('el emisor fiscal: el hecho de estar configurado y su razón social, nada más', async () => {
      const emisor = (await pedir(adminToken).expect(200)).body.proveedores.emisorFiscal;
      expect(Object.keys(emisor).sort()).toEqual(['configurado', 'razonSocial']);
      expect(typeof emisor.configurado).toBe('boolean');
    });

    it('el índice de búsqueda es el MISMO que usa el indexador', async () => {
      const res = await pedir(adminToken).expect(200);
      expect(res.body.proveedores.busqueda.indice).toBe(process.env.MEILI_INDEX_NAME ?? 'listings');
    });
  });
});
