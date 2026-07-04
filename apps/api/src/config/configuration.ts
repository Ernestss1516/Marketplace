export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  database: {
    url: process.env.DATABASE_URL,
  },
  redis: {
    url: process.env.REDIS_URL,
  },
  meili: {
    host: process.env.MEILI_HOST,
    masterKey: process.env.MEILI_MASTER_KEY,
  },
  jwt: {
    secret: process.env.JWT_SECRET,
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? '',
  },
  resend: {
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.RESEND_FROM ?? 'noreply@tudominio.es',
  },
  appUrl: process.env.APP_URL ?? 'http://localhost:3000',
  geocoding: {
    provider: process.env.GEOCODING_PROVIDER ?? 'nominatim',
    maptilerKey: process.env.MAPTILER_API_KEY,
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY ?? '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  },
  redsys: {
    merchantCode: process.env.REDSYS_MERCHANT_CODE ?? '',
    terminal: process.env.REDSYS_TERMINAL ?? '001',
    secretKey: process.env.REDSYS_SECRET_KEY ?? '',
    environment: process.env.REDSYS_ENVIRONMENT ?? 'test',
    notificationUrl: process.env.REDSYS_NOTIFICATION_URL ?? '',
  },
  s3: {
    endpoint: process.env.S3_ENDPOINT,
    bucket: process.env.S3_BUCKET,
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    publicUrl: process.env.S3_PUBLIC_URL,
  },
});
