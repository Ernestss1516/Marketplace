import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from 'src/app.module';

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

  const app = moduleRef.createNestApplication();

  // Mirrors main.ts's bootstrap() — RC.1's contact-form rate limit is IP-based
  // (@Ip()/req.ip), so e2e tests that simulate different client IPs via
  // X-Forwarded-For need the same trust-proxy behavior production has, or
  // every request resolves to the same loopback address.
  const trustProxyHops = moduleRef.get(ConfigService).get<number>('trustProxyHops') ?? 1;
  app.getHttpAdapter().getInstance().set('trust proxy', trustProxyHops);

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableCors();
  app.setGlobalPrefix('api');

  return app;
}
