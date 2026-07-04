import * as Joi from 'joi';

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
  REDIS_URL: Joi.string().required(),
  MEILI_HOST: Joi.string().required(),
  MEILI_MASTER_KEY: Joi.string().required(),
  MEILI_INDEX_NAME: Joi.when('NODE_ENV', {
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
    otherwise: Joi.string().optional(),
  }),
  JWT_SECRET: Joi.string().required(),
  // Login social Google — solo el client ID: el backend únicamente verifica firmas
  // de id_token, nunca intercambia código con Google. Vacío en dev/test es válido;
  // requerido en producción para que /auth/social/google funcione.
  GOOGLE_CLIENT_ID: Joi.string().allow('').optional(),
  RESEND_API_KEY: Joi.string().required(),
  RESEND_FROM: Joi.string().email().optional(),
  APP_URL: Joi.string().uri().optional(),
  S3_ENDPOINT: Joi.string().uri().required(),
  S3_BUCKET: Joi.string().required(),
  S3_ACCESS_KEY_ID: Joi.string().required(),
  S3_SECRET_ACCESS_KEY: Joi.string().required(),
  S3_PUBLIC_URL: Joi.string().uri().required(),
  GEOCODING_PROVIDER: Joi.string().valid('nominatim', 'maptiler').default('nominatim'),
  MAPTILER_API_KEY: Joi.string().optional(),
  // Shared with apps/web REVALIDATE_SECRET. Optional: revalidation is skipped if absent.
  REVALIDATE_SECRET: Joi.string().optional(),
  // Empty string is valid — Sentry disables itself silently when DSN is absent.
  SENTRY_DSN: Joi.string().allow('').optional(),
  // Stripe — optional so tests run without real keys; required in production.
  STRIPE_SECRET_KEY: Joi.string().allow('').optional(),
  STRIPE_WEBHOOK_SECRET: Joi.string().allow('').optional(),
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
});
