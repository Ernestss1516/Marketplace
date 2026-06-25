import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),
  DATABASE_URL: Joi.string().required(),
  REDIS_URL: Joi.string().required(),
  MEILI_HOST: Joi.string().required(),
  MEILI_MASTER_KEY: Joi.string().required(),
  JWT_SECRET: Joi.string().required(),
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
});
