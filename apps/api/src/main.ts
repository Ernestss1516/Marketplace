import * as Sentry from '@sentry/nestjs';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { appOrigin } from './config/app-origin';

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

  /**
   * DESPLIEGUE GRUPO A — CORS DE LA API HTTP, restringido al origen del frontend.
   *
   * Era `app.enableCors()` SIN ARGUMENTOS: `Access-Control-Allow-Origin` para cualquiera. Es
   * la otra mitad del problema que R9 cerró en el gateway de WebSockets, y se dejó fuera de
   * aquella ráfaga a propósito —su radio de explosión es toda la API HTTP, y meter los dos
   * cambios juntos habría roto la lección de los dos pasos—.
   *
   * `[appOrigin()]` — UN ARRAY DE UNO, y no la cadena suelta. Es la forma que descubrió
   * `messaging-cors.e2e-spec.ts` ejerciéndola: con una CADENA, el paquete `cors` emite
   * `Access-Control-Allow-Origin: <ese valor>` SIN COMPARAR con el `Origin` de la petición
   * (protege igual, porque quien compara es el navegador, pero la respuesta es idéntica para
   * todo el mundo y por tanto no se puede observar en un test). Con un ARRAY compara en el
   * servidor y OMITE la cabecera cuando no casa, que es lo que sí se puede probar.
   *
   * MISMA FUENTE QUE EL GATEWAY, a propósito: `appOrigin()`. Dos listas de orígenes que se
   * parecen son dos listas que un día divergen. Y con `APP_URL` ya obligatoria en producción
   * (`env.validation.ts`), aquí llega el dominio real y no el `localhost` de desarrollo —las
   * dos piezas de este grupo se sostienen la una a la otra: sin la validación, esta línea
   * habría autorizado a `http://localhost:3000` en producción y no habría entrado nadie.
   *
   * MULTI-INSTANCIA: cada despliegue tiene su propio `APP_URL`, así que esto sigue siendo una
   * lista de uno y no hace falta ninguna variable nueva (docs/auditoria-despliegue.md §6.4).
   *
   * SIN `credentials: true`, y es deliberado: esta API se autentica con `Authorization:
   * Bearer` (ver `apps/web/src/lib/api/client.ts`), nunca con cookies, y el frontend no pone
   * `credentials` en ningún `fetch`. Activarlo autorizaría el envío de credenciales entre
   * orígenes sin que nada lo necesite. El gateway tampoco lo hace.
   *
   * QUÉ PROTEGE Y QUÉ NO: el control de acceso es el JWT, no el CORS, y el CORS no protege
   * frente a un cliente que no sea un navegador. Esto es higiene —quitar el comodín del
   * inventario—, no el cierre de un exploit conocido.
   */
  app.enableCors({ origin: [appOrigin()] });
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
