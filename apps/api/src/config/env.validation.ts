import * as Joi from 'joi';
import { REMITENTE_PLACEHOLDER } from './remitente';

/**
 * DESPLIEGUE GRUPO A — LA VALIDACIÓN DE PRODUCCIÓN. **El arranque fail-closed.**
 *
 * ── EL DEFECTO QUE CIERRA ────────────────────────────────────────────────────────────────
 *
 * Este fichero era RIGUROSÍSIMO en `test` —cuatro `Joi.when` cuyos mensajes citan el
 * incidente que los motivó— y **no exigía absolutamente nada en producción**. Ocho variables
 * que rompen producción sin dar un solo error de arranque, medidas en
 * `docs/auditoria-despliegue.md` §3.2:
 *
 *   · Sin `APP_URL`, `appOrigin()` cae a `http://localhost:3000`: el CORS rechaza al
 *     frontend real y **todos los enlaces de todos los correos** apuntan a localhost.
 *   · Sin `RESEND_FROM`, se manda desde un placeholder con pinta de dominio real.
 *   · Sin las dos de Stripe, producción arranca **con los pagos rotos** y nadie se entera
 *     hasta que alguien intenta pagar.
 *   · Sin `GOOGLE_CLIENT_ID`, el botón de «entrar con Google» sigue ahí y no funciona.
 *   · Sin `REVALIDATE_SECRET`, la revalidación es *fire-and-forget*: falla EN SILENCIO.
 *   · Sin `MEILI_INDEX_NAME`, se escribe en el índice por defecto.
 *   · Con `GEOCODING_PROVIDER=maptiler` y sin `MAPTILER_API_KEY`, el geocoding falla en
 *     tiempo de EJECUCIÓN, al publicar un anuncio.
 *
 * Ninguna de esas ocho impedía arrancar. El comentario `// required in production` que había
 * junto a las de Stripe describía una intención que el código no cumplía.
 *
 * ── EL MECANISMO NO SE INVENTA: ES EL DE `test`, APLICADO AL OTRO ENTORNO ────────────────
 *
 * `Joi.when('NODE_ENV', …)` ya estaba aquí y ya estaba probado. Lo único que faltaba era
 * usarlo para el entorno donde importa. Cada regla nueva es `is: 'production'`, así que
 * **`development` y `test` conservan su comportamiento exacto** — eso es una barrera, no una
 * intención: `env.validation.spec.ts` lo comprueba variable a variable.
 *
 * ── POR QUÉ FAIL-CLOSED, Y NO UN AVISO EN EL LOG ────────────────────────────────────────
 *
 * Porque el modo de fallo de las ocho es SILENCIOSO. Un aviso en el arranque de un
 * contenedor es un aviso que nadie lee; el síntoma llega días después y en otro sitio (un
 * correo que nadie recibe, un pago que no cuadra). Negarse a arrancar convierte ocho fallos
 * de producción difíciles de atribuir en un mensaje que dice el nombre de la variable.
 */

/**
 * «Obligatoria en producción, como estaba en los demás entornos».
 *
 * El `mensaje` se repite en los tres códigos de error porque las tres formas de estar mal
 * —ausente, cadena vacía, sólo espacios— son el mismo problema para quien despliega, y
 * distinguirlas en el texto sólo añadiría ruido a un mensaje que se lee con prisa.
 */
function obligatoriaEnProduccion(mensaje: string, enOtrosEntornos: Joi.StringSchema) {
  return Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string()
      .trim()
      .min(1)
      .required()
      .messages({
        'any.required': mensaje,
        'string.empty': mensaje,
        'string.min': mensaje,
      }),
    otherwise: enOtrosEntornos,
  });
}

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),
  DATABASE_URL: Joi.when('NODE_ENV', {
    is: 'test',
    then: Joi.string()
      .pattern(/_test/)
      .required()
      .messages({
        'string.pattern.base':
          'DATABASE_URL must contain "_test" in test env — prevents accidental writes to dev/prod DB',
      }),
    otherwise: Joi.string().required(),
  }),
  // REDIS_URL's path segment is the logical db index (default 0). Dev and test
  // share one Redis server, so test must select a non-zero db (e.g. .../1) —
  // otherwise BullMQ jobs, rate-limit counters and caches collide with dev's.
  REDIS_URL: Joi.when('NODE_ENV', {
    is: 'test',
    then: Joi.string()
      .pattern(/\/[1-9]\d*$/)
      .required()
      .messages({
        'string.pattern.base':
          'REDIS_URL must select a non-zero db (e.g. redis://localhost:6379/1) in test env — prevents colliding with the dev db (db 0)',
      }),
    otherwise: Joi.string().required(),
  }),
  MEILI_HOST: Joi.string().required(),
  MEILI_MASTER_KEY: Joi.string().required(),
  // TRES ENTORNOS, TRES REGLAS. En test debe llevar `_test`; en producción debe
  // estar, sin defecto que valga; en desarrollo sigue siendo opcional.
  //
  // POR QUÉ EN PRODUCCIÓN ES OBLIGATORIA aunque `SearchService` tenga un defecto
  // (`'listings'`) y una sola instancia funcione perfectamente sin ella: porque el
  // criterio de este fichero, escrito ya dos veces, es que **en producción no se
  // escribe en un espacio de nombres por omisión**. Es literalmente la misma regla
  // que `DATABASE_URL` («prevents accidental writes to dev/prod DB») y `REDIS_URL`
  // («prevents colliding with the dev db»), aplicada al tercer almacén. Con varias
  // instancias compartiendo Meilisearch —topología prevista, ver
  // docs/auditoria-despliegue.md §6.5— dos despliegues sin esta variable escriben
  // en el MISMO índice y se pisan los anuncios en silencio.
  MEILI_INDEX_NAME: Joi.when('NODE_ENV', {
    switch: [
      {
        is: 'test',
        then: Joi.string()
          .pattern(/_test/)
          .required()
          .messages({
            'string.pattern.base':
              'MEILI_INDEX_NAME must contain "_test" in test env — prevents polluting the dev index',
            'any.required':
              'MEILI_INDEX_NAME is required in test env — add it to .env.test',
          }),
      },
      {
        is: 'production',
        then: Joi.string()
          .trim()
          .min(1)
          .required()
          .messages({
            'any.required':
              'MEILI_INDEX_NAME es obligatoria en producción: sin ella se escribe en el índice por defecto ("listings"), y dos instancias que compartan Meilisearch se pisarían los anuncios sin dar ningún error. Nómbralo explícitamente (p. ej. "listings_<instancia>").',
            'string.empty':
              'MEILI_INDEX_NAME no puede estar vacía en producción — nombra el índice explícitamente.',
            'string.min':
              'MEILI_INDEX_NAME no puede estar vacía en producción — nombra el índice explícitamente.',
          }),
      },
    ],
    otherwise: Joi.string().optional(),
  }),
  JWT_SECRET: Joi.string().required(),
  // Login social Google — solo el client ID: el backend únicamente verifica firmas
  // de id_token, nunca intercambia código con Google. Vacío en dev/test es válido;
  // en producción es OBLIGATORIA (antes esta línea lo decía y no lo hacía).
  GOOGLE_CLIENT_ID: obligatoriaEnProduccion(
    'GOOGLE_CLIENT_ID es obligatoria en producción: sin ella el botón de «entrar con Google» sigue en la pantalla de login y falla al pulsarlo. Se obtiene en Google Cloud Console > APIs & Services > Credentials.',
    Joi.string().allow('').optional(),
  ),
  RESEND_API_KEY: Joi.string().required(),
  // El remitente. En producción no basta con que esté: se RECHAZA el placeholder,
  // porque `noreply@tudominio.es` tiene pinta de dominio real y se copia del
  // `.env.example` sin darse cuenta. Ver `config/remitente.ts`.
  RESEND_FROM: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string()
      .email()
      .invalid(REMITENTE_PLACEHOLDER)
      .required()
      .messages({
        'any.required':
          'RESEND_FROM es obligatoria en producción: sin ella se manda desde el remitente de fábrica. Usa una dirección de un dominio VERIFICADO en el panel de Resend, o los correos se rechazan o van a spam.',
        'any.invalid': `RESEND_FROM no puede ser "${REMITENTE_PLACEHOLDER}": es el placeholder del .env.example, no un dominio tuyo. Verifica tu dominio en Resend y pon una dirección real.`,
        'string.empty':
          'RESEND_FROM no puede estar vacía en producción — pon una dirección de un dominio verificado en Resend.',
      }),
    otherwise: Joi.string().email().optional(),
  }),
  // El origen del frontend. Es la variable cuya ausencia más lejos llega y de
  // forma más silenciosa: `appOrigin()` cae a `http://localhost:3000`, así que en
  // producción el CORS (HTTP y WebSocket) rechaza al frontend real y TODOS los
  // enlaces de TODOS los correos apuntan a localhost. Nada de eso da un error.
  APP_URL: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string()
      .uri()
      .required()
      .messages({
        'any.required':
          'APP_URL es obligatoria en producción: sin ella el CORS sólo autoriza http://localhost:3000 —así que el frontend real no puede hablar con la API ni con el WebSocket— y todos los enlaces de los correos apuntan a localhost.',
        'string.empty':
          'APP_URL no puede estar vacía en producción — pon el origen público del frontend.',
        'string.uri':
          'APP_URL debe ser una URI absoluta con esquema y sin barra final (p. ej. https://tudominio.es): es el valor que se compara literalmente con la cabecera Origin del navegador.',
      }),
    otherwise: Joi.string().uri().optional(),
  }),
  S3_ENDPOINT: Joi.string().uri().required(),
  S3_BUCKET: Joi.string().required(),
  S3_ACCESS_KEY_ID: Joi.string().required(),
  S3_SECRET_ACCESS_KEY: Joi.string().required(),
  S3_PUBLIC_URL: Joi.string().uri().required(),
  GEOCODING_PROVIDER: Joi.string().valid('nominatim', 'maptiler').default('nominatim'),
  // CONDICIONAL SOBRE EL PROVEEDOR, NO SOBRE EL ENTORNO, y la diferencia importa en
  // los dos sentidos: con `nominatim` la clave NO hace falta (exigirla sería pedir
  // una credencial de un servicio que no se usa, y así es como se aprende a poner
  // valores falsos para callar al validador); con `maptiler` hace falta SIEMPRE,
  // también en desarrollo, porque sin ella el geocoding no falla al arrancar sino
  // al publicar un anuncio — lejos de la causa.
  MAPTILER_API_KEY: Joi.when('GEOCODING_PROVIDER', {
    is: 'maptiler',
    then: Joi.string()
      .trim()
      .min(1)
      .required()
      .messages({
        'any.required':
          'MAPTILER_API_KEY es obligatoria cuando GEOCODING_PROVIDER=maptiler: sin ella el geocoding no falla al arrancar, falla al publicar un anuncio. Es la clave del BACKEND — distinta de NEXT_PUBLIC_MAPTILER_KEY, que es la del navegador y va restringida por dominio.',
        'string.empty':
          'MAPTILER_API_KEY no puede estar vacía con GEOCODING_PROVIDER=maptiler.',
        'string.min':
          'MAPTILER_API_KEY no puede estar vacía con GEOCODING_PROVIDER=maptiler.',
      }),
    otherwise: Joi.string().optional(),
  }),
  // Compartida con REVALIDATE_SECRET de apps/web, y los dos valores deben COINCIDIR.
  // En producción es obligatoria: la revalidación se llama fire-and-forget
  // (`fetch().catch(() => {})`), así que sin secreto el endpoint responde 401 y el
  // fallo se traga en silencio — el contenido sigue apareciendo, pero hasta una hora
  // tarde, que es un síntoma que nadie relaciona con esta variable.
  REVALIDATE_SECRET: obligatoriaEnProduccion(
    'REVALIDATE_SECRET es obligatoria en producción: sin ella POST /api/revalidate devuelve 401, y como la llamada es fire-and-forget el fallo NO se ve — el blog y el footer tardan hasta una hora en reflejar un cambio. Debe ser el MISMO valor que REVALIDATE_SECRET de apps/web.',
    Joi.string().optional(),
  ),
  // Empty string is valid — Sentry disables itself silently when DSN is absent.
  SENTRY_DSN: Joi.string().allow('').optional(),
  // Stripe — vacías en dev/test (los tests firman los webhooks en local y nunca
  // llaman a la API). En producción son OBLIGATORIAS: esta línea decía «required in
  // production» en un comentario mientras el esquema las dejaba pasar, y el
  // resultado era un despliegue que arranca con los pagos rotos.
  STRIPE_SECRET_KEY: obligatoriaEnProduccion(
    'STRIPE_SECRET_KEY es obligatoria en producción: sin ella el proceso arranca con los pagos rotos y no se nota hasta que alguien intenta pagar. Usa la clave de la cuenta real (dashboard.stripe.com > Developers > API keys).',
    Joi.string().allow('').optional(),
  ),
  STRIPE_WEBHOOK_SECRET: obligatoriaEnProduccion(
    'STRIPE_WEBHOOK_SECRET es obligatoria en producción: sin ella StripeWebhookGuard rechaza TODOS los webhooks, así que los pagos se cobran y nunca se acreditan. Es el secreto del endpoint registrado en el dashboard — NO el que imprime `stripe listen`.',
    Joi.string().allow('').optional(),
  ),
  // Redsys — optional in dev/prod; REDSYS_SECRET_KEY must be set in test (silent empty caused incident).
  REDSYS_MERCHANT_CODE: Joi.string().allow('').optional(),
  REDSYS_TERMINAL: Joi.string().allow('').optional(),
  REDSYS_SECRET_KEY: Joi.when('NODE_ENV', {
    is: 'test',
    then: Joi.string()
      .min(1)
      .required()
      .messages({
        'string.min':
          'REDSYS_SECRET_KEY must not be empty in test env — set the Redsys test key in .env.test',
        'any.required':
          'REDSYS_SECRET_KEY is required in test env — set the Redsys test key in .env.test',
      }),
    otherwise: Joi.string().allow('').optional(),
  }),
  REDSYS_ENVIRONMENT: Joi.string().allow('').optional(),
  REDSYS_NOTIFICATION_URL: Joi.string().allow('').optional(),
  // RC.1 — formulario de contacto público. Secreto dedicado para firmar el
  // token del time-trap (nunca reutilizar JWT_SECRET).
  CONTACT_FORM_SECRET: Joi.string().min(16).required(),
  TRUST_PROXY_HOPS: Joi.number().integer().min(0).default(1),
  // RF.13 — selección del proveedor de facturación. Solo "stub" por ahora (NO
  // emite facturas válidas). Al conectar un proveedor homologado, añadir su
  // nombre aquí y el case correspondiente en InvoicingModule.
  INVOICING_PROVIDER: Joi.string().valid('stub').default('stub'),
});
