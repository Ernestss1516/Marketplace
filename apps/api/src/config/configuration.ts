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
});
