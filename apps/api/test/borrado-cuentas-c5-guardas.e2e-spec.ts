import { INestApplication } from '@nestjs/common';
import { PrismaClient, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

/**
 * BORRADO DE CUENTAS — C5: LAS GUARDAS EN CAPAS (§6.2).
 *
 * Vaciar una cuenta es la única operación irreversible del backoffice sobre una
 * persona. Cada capa impide una cosa distinta, y las cuatro tienen que estar:
 * quitar cualquiera deja una forma de hacerlo por accidente o sin permiso.
 */
describe('Borrado de cuentas C5 — las guardas (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminToken: string;
  let modToken: string;
  let hash: string;

  const PASSWORD = 'Test1234!';

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);
    hash = await bcrypt.hash(PASSWORD, 4);

    await prisma.user.create({
      data: { email: 'c5g-admin@example.com', name: 'C5G Admin', slug: 'c5g-admin', passwordHash: hash, emailVerified: true, role: 'ADMIN' },
    });
    adminToken = (
      await request(app.getHttpServer())
        .post('/api/auth/admin-login')
        .send({ email: 'c5g-admin@example.com', password: PASSWORD })
        .expect(200)
    ).body.accessToken as string;

    await prisma.user.create({
      data: { email: 'c5g-mod@example.com', name: 'C5G Mod', slug: 'c5g-mod', passwordHash: hash, emailVerified: true, role: 'MODERATOR' },
    });
    modToken = (
      await request(app.getHttpServer())
        .post('/api/auth/admin-login')
        .send({ email: 'c5g-mod@example.com', password: PASSWORD })
        .expect(200)
    ).body.accessToken as string;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  let n = 0;
  async function crear(marca: string, extra: Record<string, unknown> = {}) {
    n += 1;
    return prisma.user.create({
      data: {
        email: `c5g-${marca}-${n}@example.com`,
        name: `C5G ${marca}`,
        slug: `c5g-${marca}-${n}`,
        passwordHash: hash,
        emailVerified: true,
        ...extra,
      } as never,
    });
  }

  const eliminar = (id: string, token: string) =>
    request(app.getHttpServer()).delete(`/api/admin/users/${id}`).set('Authorization', `Bearer ${token}`);

  it('CAPA 1 · rol: un MODERATOR no puede eliminar (es ADMIN-only, como el borrado de anuncios)', async () => {
    const u = await crear('victima-mod', { status: UserStatus.ARCHIVED, archivedAt: new Date() });
    await eliminar(u.id, modToken).expect(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).status).toBe(UserStatus.ARCHIVED);
  });

  it('CAPA 2 · estado: no se vacía algo VIVO — los dos pasos son la salvaguarda', async () => {
    for (const status of [UserStatus.ACTIVE, UserStatus.SUSPENDED, UserStatus.BANNED] as const) {
      const u = await crear(`viva-${status.toLowerCase()}`, { status });
      const res = await eliminar(u.id, adminToken).expect(400);
      expect(String(res.body.message)).toContain('archivada');
      expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).status).toBe(status);
    }
  });

  it('CAPA 3 · rol del sujeto: no se vacía a un miembro del staff', async () => {
    // Vaciar a un moderador convertiría su rastro en «Usuario eliminado aprobó
    // este anuncio», degradando justo el registro que AuditLog.actorId sostiene.
    for (const role of ['MODERATOR', 'EDITOR', 'ADMIN'] as const) {
      const u = await crear(`staff-${role.toLowerCase()}`, { role, status: UserStatus.ARCHIVED, archivedAt: new Date() });
      const res = await eliminar(u.id, adminToken).expect(400);
      expect(String(res.body.message)).toContain('rol');
    }
  });

  it('CAPA 4 · la cuenta de sistema no se vacía ni se archiva', async () => {
    const equipo = await crear('equipo-falso', { isSystem: true, status: UserStatus.ARCHIVED, archivedAt: new Date() });
    await eliminar(equipo.id, adminToken).expect(400);
    await request(app.getHttpServer())
      .patch(`/api/admin/users/${equipo.id}/archive`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(400);
  });

  it('una cuenta ya eliminada no se puede volver a eliminar (DELETED no es ARCHIVED)', async () => {
    const u = await crear('ya-eliminada', { status: UserStatus.DELETED, deletedAt: new Date() });
    await eliminar(u.id, adminToken).expect(400);
  });

  it('el camino feliz: ARCHIVED + rol USER + ADMIN → 200', async () => {
    const u = await crear('feliz', { status: UserStatus.ARCHIVED, archivedAt: new Date(), archiveReason: 'SELF_REQUEST' });
    const res = await eliminar(u.id, adminToken).expect(200);
    expect(res.body.status).toBe('DELETED');
  });

  /**
   * §6.5 — LA TRANSACCIÓN NO SE DESHACE POR UN EFECTO EXTERNO.
   *
   * El vaciado ocurre en Postgres; la pasarela, la cola y R2 vienen después y
   * fuera. Si algo de eso falla, la persona YA está anonimizada y así debe
   * quedarse: reintentar una limpieza es trivial, resucitar a alguien no.
   *
   * Se comprueba con lo observable: tras un 200, la fila está vaciada aunque los
   * efectos externos sean asíncronos y puedan no haber terminado.
   */
  it('los efectos externos son POSTERIORES: el vaciado ya está hecho cuando responde', async () => {
    const u = await crear('externos', { status: UserStatus.ARCHIVED, archivedAt: new Date() });
    await eliminar(u.id, adminToken).expect(200);

    const tras = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(tras.status).toBe(UserStatus.DELETED);
    expect(tras.name).toBe('Usuario eliminado');
    expect(tras.passwordHash).toBeNull();
  });
});
