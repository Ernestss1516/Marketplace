import * as Sentry from '@sentry/nestjs';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

// Must be called before NestFactory.create() so Sentry instruments the process
// from the start. When SENTRY_DSN is empty the SDK disables itself silently.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? 'development',
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });

  // Route all NestJS Logger calls (including existing `new Logger()` instances)
  // through pino. bufferLogs: true above holds early bootstrap messages until
  // the logger is ready, preventing them from falling back to console.
  app.useLogger(app.get(Logger));

  // Trust exactly N proxy hops (config: TRUST_PROXY_HOPS) so Express resolves
  // req.ip from X-Forwarded-For only up to that many hops — anything beyond is
  // never trusted, so a client can't spoof the header to evade the contact-form
  // rate limit (RC.1). Without this, req.ip is the raw socket peer (the proxy
  // itself in production), making per-IP rate limiting meaningless.
  const trustProxyHops = app.get(ConfigService).get<number>('trustProxyHops') ?? 1;
  app.getHttpAdapter().getInstance().set('trust proxy', trustProxyHops);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors();
  app.setGlobalPrefix('api');

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Marketplace API')
    .setDescription('API REST del marketplace C2C. Los endpoints marcados con el candado requieren un JWT en la cabecera Authorization: Bearer <token>.')
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token',
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  const config = app.get(ConfigService);
  const port = config.get<number>('port') ?? 3000;

  await app.listen(port);
  const logger = app.get(Logger);
  logger.log(`API running on http://localhost:${port}/api`, 'Bootstrap');
  logger.log(`Swagger docs: http://localhost:${port}/api/docs`, 'Bootstrap');
}

bootstrap();
