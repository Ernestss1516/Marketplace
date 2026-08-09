/**
 * UXV.6 (M4) — no se abre un segundo checkout de Pro a quien ya está suscrito (e2e).
 *
 * EL DEFECTO: `createCheckoutSession` no miraba si el usuario ya tenía suscripción. La
 * interfaz tampoco: `/planes` enseñaba «Hazte Pro» a un suscriptor y pulsarlo creaba una
 * SEGUNDA suscripción de Stripe sobre la misma cuenta — dos cobros recurrentes por el
 * mismo plan.
 *
 * Estas pruebas van contra el BACKEND a propósito. Esconder el botón no cierra nada: lo
 * que protege de un cobro duplicado es que el servidor se niegue, y eso es lo que se fija
 * aquí. La cobertura de que el botón además no se enseñe está en `e2e/pulido.spec.ts`
 * (Playwright).
 *
 * No hace falta mockear Stripe: el guard rechaza ANTES de llegar a él. Si alguien lo
 * moviera después, estas pruebas fallarían por intentar hablar con Stripe de verdad — que
 * es exactamente la señal que se quiere.
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient, SubscriptionStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

async function loginUser(app: INestApplication, email: string, password: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password });
  return res.body.accessToken as string;
}

describe('UXV.6 (M4) — guard de suscripción duplicada (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let userId: string;
  let token: string;
  let proPriceId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    const user = await prisma.user.create({
      data: {
        email: 'uxv6-pro@example.com',
        name: 'UXV6 Pro',
        slug: 'uxv6-pro',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });
    userId = user.id;
    token = await loginUser(app, 'uxv6-pro@example.com', 'Test1234!');

    // El plan Pro mensual lo siembra seed-test.ts.
    const price = await prisma.price.findFirst({
      where: { product: { type: 'RECURRING' }, interval: 'MONTH' },
    });
    if (!price) throw new Error('Precio del plan Pro no encontrado — revisa seed-test.ts');
    proPriceId = price.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.subscription.deleteMany({ where: { userId } });
  });

  async function darSuscripcion(status: SubscriptionStatus) {
    await prisma.subscription.create({
      data: {
        userId,
        priceId: proPriceId,
        gatewaySubscriptionId: `sub_test_${status}_${Date.now()}`,
        status,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
  }

  const pedirCheckout = () =>
    request(app.getHttpServer())
      .post('/api/billing/checkout')
      .set('Authorization', `Bearer ${token}`)
      .send({ priceId: proPriceId });

  it('con una suscripción ACTIVE, rechaza el checkout con ALREADY_SUBSCRIBED', async () => {
    await darSuscripcion(SubscriptionStatus.ACTIVE);

    const res = await pedirCheckout().expect(400);
    expect(res.body.code).toBe('ALREADY_SUBSCRIBED');
    // Y NO devuelve una URL de pago, que es lo que de verdad importa.
    expect(res.body.checkoutUrl).toBeUndefined();
  });

  it('con una suscripción CANCELING también rechaza: sigue siendo Pro hasta fin de periodo', async () => {
    // Cancelar no corta el servicio al momento; volver a suscribirse ahora solaparía dos
    // cobros sobre el mismo periodo.
    await darSuscripcion(SubscriptionStatus.CANCELING);

    const res = await pedirCheckout().expect(400);
    expect(res.body.code).toBe('ALREADY_SUBSCRIBED');
  });

  it('con la suscripción CANCELED sí deja volver a suscribirse', async () => {
    // El guard NO puede dejar atrapado a quien ya no es Pro. Aquí llega hasta Stripe, que
    // en el entorno de test no está configurado: lo que se afirma es que NO se rechaza por
    // el guard, no que el checkout se complete.
    await darSuscripcion(SubscriptionStatus.CANCELED);

    const res = await pedirCheckout();
    expect(res.body.code).not.toBe('ALREADY_SUBSCRIBED');
  });

  it('con PAST_DUE NO se bloquea: el cobro falló y hay que poder rehacerlo', async () => {
    await darSuscripcion(SubscriptionStatus.PAST_DUE);

    const res = await pedirCheckout();
    expect(res.body.code).not.toBe('ALREADY_SUBSCRIBED');
  });

  it('sin ninguna suscripción tampoco lo bloquea', async () => {
    const res = await pedirCheckout();
    expect(res.body.code).not.toBe('ALREADY_SUBSCRIBED');
  });
});
