import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from 'src/app.module';
import { appOrigin } from 'src/config/app-origin';

/**
 * Creates a configured NestJS application for e2e tests, mirroring main.ts.
 *
 * The caller decides how to start it:
 *   - await app.init()          → use with Supertest (HTTP only)
 *   - await app.listen(0)       → use when WebSocket is needed; get the port with
 *                                  app.getHttpServer().address().port
 *
 * Always call app.close() in afterAll to avoid open handle warnings.
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  // rawBody: true mirrors main.ts's bootstrap() — StripeWebhookGuard (and any
  // future raw-body webhook) needs the exact byte buffer on req.rawBody to
  // verify HMAC signatures; without it every real-signature webhook test fails
  // with "Missing stripe-signature or body" regardless of the signature itself.
  const app = moduleRef.createNestApplication({ rawBody: true });

  // Mirrors main.ts's bootstrap() — RC.1's contact-form rate limit is IP-based
  // (@Ip()/req.ip), so e2e tests that simulate different client IPs via
  // X-Forwarded-For need the same trust-proxy behavior production has, or
  // every request resolves to the same loopback address.
  const trustProxyHops = moduleRef.get(ConfigService).get<number>('trustProxyHops') ?? 1;
  app.getHttpAdapter().getInstance().set('trust proxy', trustProxyHops);

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  // Mirrors main.ts's bootstrap() — el CORS restringido al origen del frontend.
  //
  // NO ES DECORATIVO QUE ESTÉ AQUÍ: si el helper siguiera con `enableCors()` abierto,
  // los e2e probarían un bootstrap que no es el que corre en producción, y la barrera
  // de `cors-http.e2e-spec.ts` no podría existir — mediría el helper, no el producto.
  // Misma función (`appOrigin()`) y misma forma de array de uno que main.ts.
  app.enableCors({ origin: [appOrigin()] });
  app.setGlobalPrefix('api');

  return app;
}
