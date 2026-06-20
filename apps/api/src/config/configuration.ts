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
  resend: {
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.RESEND_FROM ?? 'noreply@tudominio.es',
  },
  appUrl: process.env.APP_URL ?? 'http://localhost:3000',
  s3: {
    endpoint: process.env.S3_ENDPOINT,
    bucket: process.env.S3_BUCKET,
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    publicUrl: process.env.S3_PUBLIC_URL,
  },
});
