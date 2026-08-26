import { INestApplication } from '@nestjs/common';
import { DataExportStatus, Prisma, PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as JSZip from 'jszip';
import * as request from 'supertest';
import { R2Service } from 'src/infra/r2/r2.service';
import { DataExportExpirationService } from 'src/modules/data-export/data-export-expiration.service';
import { DataExportService } from 'src/modules/data-export/data-export.service';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { pollUntil } from './helpers/poll';

/**
 * BORRADO DE CUENTAS — C6: LAS PUERTAS DE LA EXPORTACIÓN.
 *
 * El ZIP de la otra suite es el QUÉ; ésta es el QUIÉN y el HASTA CUÁNDO. Son las
 * tres cosas que convierten un fichero en un permiso:
 *
 * · **quién puede bajarlo** — el sujeto y un ADMIN, nadie más (§7.4);
 * · **hasta cuándo** — un ZIP con la vida entera de alguien no vive para siempre;
 * · **cuántos a la vez** — uno vivo por persona.
 *
 * Y una cuarta que las sostiene: que el trabajo va **por cola**, no en la petición.
 */
describe('Borrado de cuentas C6 — las puertas (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let dataExport: DataExportService;
  let expiracion: DataExportExpirationService;
  let r2: R2Service;

  const PASSWORD = 'Test1234!';

  let duenyo: { id: string; token: string };
  let ajeno: { id: string; token: string };
  let adminToken: string;
  let modToken: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    dataExport = app.get(DataExportService);
    expiracion = app.get(DataExportExpirationService);
    r2 = app.get(R2Service);

    const hash = await bcrypt.hash(PASSWORD, 4);
    const crear = async (marca: string, role: Role = Role.USER) =>
      prisma.user.create({
        data: {
          email: `c6p-${marca}@example.com`,
          name: `C6P ${marca}`,
          slug: `c6p-${marca}`,
          passwordHash: hash,
          emailVerified: true,
          role,
        } as Prisma.UserCreateInput,
      });

    const login = async (email: string, admin = false) =>
      (
        await request(app.getHttpServer())
          .post(admin ? '/api/auth/admin-login' : '/api/auth/login')
          .send({ email, password: PASSWORD })
          .expect(200)
      ).body.accessToken as string;

    const d = await crear('duenyo');
    duenyo = { id: d.id, token: await login(d.email) };
    const a = await crear('ajeno');
    ajeno = { id: a.id, token: await login(a.email) };

    const admin = await crear('admin', Role.ADMIN);
    adminToken = await login(admin.email, true);
    const mod = await crear('mod', Role.MODERATOR);
    modToken = await login(mod.email, true);
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  /** Una exportación ya lista, con su ZIP de verdad en el bucket. */
  async function exportacionLista(subjectUserId: string) {
    await prisma.dataExport.deleteMany({ where: { subjectUserId } });
    const fila = await prisma.dataExport.create({
      data: { subjectUserId, requestedById: subjectUserId, status: DataExportStatus.PENDING },
    });
    await dataExport.buildExport(fila.id);
    return prisma.dataExport.findUniqueOrThrow({ where: { id: fila.id } });
  }

  const descargar = (id: string, token: string) =>
    request(app.getHttpServer())
      .get(`/api/exports/${id}/download`)
      .set('Authorization', `Bearer ${token}`);

  // ── BARRERA 4 · LA DESCARGA AUTENTICADA (molde invoice PDF) ───────────────

  it('BARRERA 4 · el dueño descarga la SUYA, y lo que baja es un ZIP de verdad', async () => {
    const fila = await exportacionLista(duenyo.id);
    expect(fila.status).toBe(DataExportStatus.READY);

    // `responseType('blob')` hace que superagent acumule el cuerpo como `Buffer`
    // en vez de intentar parsearlo: sin esto, `res.body` llega vacío y el test
    // pasaría o fallaría por el motivo equivocado.
    const res = await descargar(fila.id, duenyo.token).responseType('blob').expect(200);
    expect(res.headers['content-type']).toContain('application/zip');
    expect(res.headers['content-disposition']).toContain('exportacion-c6p-duenyo-');

    // Se abre, porque un 200 con un cuerpo corrupto también sería un 200.
    const zip = await JSZip.loadAsync(res.body as Buffer);
    expect(zip.file('datos.json')).not.toBeNull();
  });

  it('BARRERA 4 · OTRO usuario no puede descargar la ajena — 403, no 404 disimulado', async () => {
    const fila = await exportacionLista(duenyo.id);
    await descargar(fila.id, ajeno.token).expect(403);
  });

  it('BARRERA 4 · un ADMIN sí puede descargar la de cualquiera (§7.4)', async () => {
    const fila = await exportacionLista(duenyo.id);
    await descargar(fila.id, adminToken).expect(200);
  });

  /**
   * EL REPARTO, POR LOS DOS LADOS.
   *
   * Un MODERATOR no puede **pedir** la exportación de otro ni **descargarla**, y
   * las dos mitades importan: dejar sólo la primera permitiría que un moderador
   * bajara la que un ADMIN generó. El argumento no es de jerarquía sino de
   * contenido — el ZIP lleva las facturas dentro, y la procedencia comercial es
   * ADMIN por decisión escrita.
   */
  it('BARRERA 4 · un MODERATOR no puede pedir la de otro: es ADMIN, y el ZIP lleva facturas', async () => {
    await request(app.getHttpServer())
      .post(`/api/admin/users/${duenyo.id}/export`)
      .set('Authorization', `Bearer ${modToken}`)
      .expect(403);
  });

  it('BARRERA 4 · un MODERATOR tampoco puede DESCARGAR la de otro', async () => {
    const fila = await exportacionLista(duenyo.id);
    await descargar(fila.id, modToken).expect(403);
  });

  it('BARRERA 4 · sin token no se baja nada — no hay URL pública a este fichero', async () => {
    const fila = await exportacionLista(duenyo.id);
    await request(app.getHttpServer()).get(`/api/exports/${fila.id}/download`).expect(401);
  });

  // ── BARRERA 5 · CADUCA ────────────────────────────────────────────────────

  it('BARRERA 5 · el cron borra el objeto del bucket y marca EXPIRED', async () => {
    const fila = await exportacionLista(duenyo.id);
    const key = fila.key as string;

    // Existe de verdad antes de la barrida.
    await expect(r2.download(key)).resolves.toBeInstanceOf(Buffer);

    await prisma.dataExport.update({
      where: { id: fila.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const borradas = await expiracion.runExpirationSweep();
    expect(borradas).toBeGreaterThanOrEqual(1);

    const tras = await prisma.dataExport.findUniqueOrThrow({ where: { id: fila.id } });
    expect(tras.status).toBe(DataExportStatus.EXPIRED);
    // La clave se vacía para que no quede apuntando a un objeto que ya no está.
    expect(tras.key).toBeNull();

    // Y el objeto ya no está en el bucket: sin esto, «caducar» sería sólo una
    // etiqueta y el ZIP seguiría ahí.
    await expect(r2.download(key)).rejects.toBeDefined();
  });

  it('BARRERA 5 · la descarga de una EXPIRED no sirve el fichero', async () => {
    const fila = await exportacionLista(duenyo.id);
    await prisma.dataExport.update({
      where: { id: fila.id },
      data: { status: DataExportStatus.EXPIRED, key: null },
    });
    await descargar(fila.id, duenyo.token).expect(404);
  });

  /**
   * LA VENTANA ENTRE LA FECHA Y EL CRON.
   *
   * El cron corre una vez al día, así que hay hasta 24 horas en las que una
   * exportación está caducada por fecha y todavía `READY` en la fila, con su
   * objeto en el bucket. Si la descarga se fiara sólo del estado, serviría un ZIP
   * que ya debería estar muerto. Mismo patrón que `suspensionYaCumplida` (C4): la
   * verdad se evalúa al decidir, no cuando el planificador se acuerda.
   */
  it('BARRERA 5 · pasada la fecha ya no se sirve, AUNQUE el cron todavía no haya pasado', async () => {
    const fila = await exportacionLista(duenyo.id);
    await prisma.dataExport.update({
      where: { id: fila.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const sigue = await prisma.dataExport.findUniqueOrThrow({ where: { id: fila.id } });
    expect(sigue.status).toBe(DataExportStatus.READY); // el cron NO ha corrido
    expect(sigue.key).not.toBeNull(); // el objeto sigue en el bucket

    await descargar(fila.id, duenyo.token).expect(404);
  });

  it('BARRERA 5 · una PENDING todavía no se descarga (no hay fichero que servir)', async () => {
    await prisma.dataExport.deleteMany({ where: { subjectUserId: duenyo.id } });
    const fila = await prisma.dataExport.create({
      data: { subjectUserId: duenyo.id, requestedById: duenyo.id, status: DataExportStatus.PENDING },
    });
    await descargar(fila.id, duenyo.token).expect(404);
  });

  // ── BARRERA 6 · UNA VIVA POR USUARIO ──────────────────────────────────────

  it('BARRERA 6 · con una PENDING en curso, la segunda solicitud se rechaza (409)', async () => {
    await prisma.dataExport.deleteMany({ where: { subjectUserId: duenyo.id } });
    await prisma.dataExport.create({
      data: { subjectUserId: duenyo.id, requestedById: duenyo.id, status: DataExportStatus.PENDING },
    });

    await request(app.getHttpServer())
      .post('/api/users/me/export')
      .set('Authorization', `Bearer ${duenyo.token}`)
      .expect(409);
  });

  it('BARRERA 6 · con una READY sin caducar, tampoco se pide otra', async () => {
    await exportacionLista(duenyo.id);
    await request(app.getHttpServer())
      .post('/api/users/me/export')
      .set('Authorization', `Bearer ${duenyo.token}`)
      .expect(409);
  });

  /**
   * LO QUE EL LÍMITE **NO** DEBE HACER, y es la mitad que se olvida.
   *
   * Si `FAILED` o `EXPIRED` contaran como vivas, un fallo del worker —o el simple
   * paso de siete días— dejaría a esa persona sin poder volver a pedir sus datos
   * **nunca**. El límite protege el bucket de acumular ZIP simultáneos; no es un
   * castigo ni una cuota vitalicia.
   */
  it('BARRERA 6 · una FAILED o una EXPIRED NO bloquean: se puede volver a pedir', async () => {
    for (const status of [DataExportStatus.FAILED, DataExportStatus.EXPIRED] as const) {
      await prisma.dataExport.deleteMany({ where: { subjectUserId: duenyo.id } });
      await prisma.dataExport.create({
        data: { subjectUserId: duenyo.id, requestedById: duenyo.id, status },
      });

      const res = await request(app.getHttpServer())
        .post('/api/users/me/export')
        .set('Authorization', `Bearer ${duenyo.token}`)
        .expect(200);
      expect(res.body.status).toBe(DataExportStatus.PENDING);
    }
  });

  it('BARRERA 6 · el límite es POR USUARIO: que uno tenga la suya no frena a otro', async () => {
    await prisma.dataExport.deleteMany({});
    await prisma.dataExport.create({
      data: { subjectUserId: duenyo.id, requestedById: duenyo.id, status: DataExportStatus.PENDING },
    });

    await request(app.getHttpServer())
      .post('/api/users/me/export')
      .set('Authorization', `Bearer ${ajeno.token}`)
      .expect(200);
  });

  // ── POR COLA, DE VERDAD ───────────────────────────────────────────────────

  /**
   * EL CAMINO COMPLETO, SIN TOCAR EL WORKER A MANO.
   *
   * Las demás suites llaman a `buildExport` para poder afirmar sin esperas; ésta
   * no llama a nada: pide por el endpoint y espera a que el ZIP aparezca solo. Es
   * lo único que demuestra que la cola está cableada — un servicio correcto con un
   * `@Processor` mal registrado dejaría todas las demás pruebas en verde y a los
   * usuarios con exportaciones `PENDING` para siempre.
   */
  it('POR COLA · se pide por el endpoint y el worker la deja READY sin ayuda', async () => {
    await prisma.dataExport.deleteMany({ where: { subjectUserId: ajeno.id } });

    const res = await request(app.getHttpServer())
      .post('/api/users/me/export')
      .set('Authorization', `Bearer ${ajeno.token}`)
      .expect(200);
    expect(res.body.status).toBe(DataExportStatus.PENDING);

    await pollUntil(async () => {
      const fila = await prisma.dataExport.findUnique({ where: { id: res.body.id as string } });
      return fila?.status === DataExportStatus.READY;
    }, 60_000);

    const fila = await prisma.dataExport.findUniqueOrThrow({ where: { id: res.body.id as string } });
    expect(fila.key).toBe(`exportaciones/${fila.id}.zip`);
    expect(fila.sizeBytes).toBeGreaterThan(0);
    expect(fila.expiresAt).not.toBeNull();

    // Y avisa: la exportación puede tardar minutos y el usuario ya cerró la pestaña.
    const aviso = await prisma.notification.findFirst({
      where: { userId: ajeno.id, type: 'DATA_EXPORT_READY' },
    });
    expect(aviso).not.toBeNull();
  }, 120_000);

  // ── UNA CUENTA VACIADA NO TIENE NADA QUE EXPORTAR ─────────────────────────

  it('una cuenta DELETED no se exporta: sería exportar el vacío (§7.4)', async () => {
    const muerto = await prisma.user.create({
      data: {
        email: 'c6p-muerto@example.com', name: 'Usuario eliminado', slug: 'c6p-muerto',
        emailVerified: true, status: 'DELETED', deletedAt: new Date(),
      },
    });
    await request(app.getHttpServer())
      .post(`/api/admin/users/${muerto.id}/export`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
  });

  /**
   * EL CABO SUELTO QUE C6 LE ABRE A C5, Y QUE C5 TIENE QUE CERRAR.
   *
   * Un ZIP de exportación lleva dentro el perfil, los hilos, las facturas y el
   * monedero **tal y como eran antes de vaciar la cuenta**. Anonimizar la fila no
   * alcanza a un fichero que ya se armó: vaciar a alguien y dejarle el ZIP en el
   * bucket sería deshacer C5 entero con un solo objeto.
   *
   * Y la cascada del schema no sirve aquí, porque C5 **no borra la fila del
   * usuario** — la vacía. Nada se dispara solo.
   */
  it('vaciar la cuenta (C5) se lleva también sus exportaciones — fila y objeto', async () => {
    const victima = await prisma.user.create({
      data: {
        email: 'c6p-victima@example.com', name: 'C6P Victima', slug: 'c6p-victima',
        emailVerified: true, status: 'ARCHIVED', archivedAt: new Date(), archiveReason: 'SELF_REQUEST',
      },
    });
    const fila = await exportacionLista(victima.id);
    const key = fila.key as string;
    await expect(r2.download(key)).resolves.toBeInstanceOf(Buffer);

    await request(app.getHttpServer())
      .delete(`/api/admin/users/${victima.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(await prisma.dataExport.count({ where: { subjectUserId: victima.id } })).toBe(0);

    // El objeto se borra por la cola de limpieza que ya existía (B3), así que se
    // espera a que pase — igual que las demás limpiezas de R2 del proyecto.
    await pollUntil(async () => {
      try {
        await r2.download(key);
        return false;
      } catch {
        return true;
      }
    }, 60_000);
  }, 120_000);
});
