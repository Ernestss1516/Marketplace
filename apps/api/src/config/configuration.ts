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
  // RF.13 — proveedor de emisión de facturas. "stub" (por defecto) NO emite
  // facturas fiscalmente válidas; se sustituye por el proveedor homologado real
  // cuando se elija (ver InvoicingModule).
  invoicing: {
    provider: process.env.INVOICING_PROVIDER ?? 'stub',
  },
  s3: {
    endpoint: process.env.S3_ENDPOINT,
    bucket: process.env.S3_BUCKET,
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    publicUrl: process.env.S3_PUBLIC_URL,
  },
  // Número de saltos de proxy de confianza delante de la API en producción —
  // pasado a Express vía app.set('trust proxy', N) en main.ts. Determina hasta
  // qué punto de X-Forwarded-For se confía para el rate limit por IP del
  // formulario de contacto (RC.1). Confirmado con el usuario: 1 proxy en
  // producción. Configurable por si la topología de despliegue cambia.
  trustProxyHops: parseInt(process.env.TRUST_PROXY_HOPS ?? '1', 10),
  contactForm: {
    // Firma el token del time-trap (RC.1) — dedicado, NUNCA reutilizar JWT_SECRET.
    secret: process.env.CONTACT_FORM_SECRET,
  },
});
