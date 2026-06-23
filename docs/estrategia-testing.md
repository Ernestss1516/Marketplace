# Estrategia de testing y observabilidad — Marketplace

> Ráfaga RT.1 · Hito 2, Fase T · 2026-06-23
> Este documento es la fuente de verdad del plan de testing. Las ráfagas RT.2–RT.6
> lo ejecutan; cualquier cambio de estrategia se refleja aquí primero.

---

## 1. Filosofía y alcance

El objetivo no es cobertura de líneas, sino **confianza en los flujos críticos del
MVP**: que un usuario pueda registrarse, publicar un anuncio, encontrarlo en la
búsqueda y contactar con el vendedor. Los tests son la red de seguridad que permite
refactorizar e iterar el Hito 2 sin romper lo que ya funciona.

**Qué se prueba:**

| Flujo | Capa |
|---|---|
| Auth: register → verify-email → login | Backend e2e |
| Listings: create draft → publish → ficha pública → ciclo de vida | Backend e2e |
| Search: texto libre, filtros, proximidad (Meilisearch real) | Backend e2e |
| Messaging: conversaciones REST + recepción por WebSocket | Backend e2e |
| Recorrido completo: publicar → buscar → ver ficha → contactar | Frontend Playwright |

**Qué NO se prueba todavía:**

- Módulos stub (favoritos, valoraciones, moderación, admin).
- Procesado de imágenes (sharp/MinIO): demasiado lento e irrelevante para el flujo
  funcional; se mockea o se prueba manualmente.
- Rendimiento y carga.

---

## 2. Herramientas

| Capa | Herramienta | Versión | Razón |
|---|---|---|---|
| Backend e2e | **Jest + Supertest** | 29 + 7 | Ya instalados; patrón nativo de NestJS; HTTP sin overhead adicional |
| Frontend e2e | **Playwright** | ^1.49 | Maneja SSR, sesiones next-auth, WebSocket y navegadores reales; integración con Next.js |
| Test runner (web) | Playwright Test | — | Incluido en @playwright/test |
| WebSocket (messaging test) | socket.io-client | 4 | Ya en devDeps vía apps/web |

**No se añaden:** mocks de Jest para servicios externos (Prisma, Redis, Meilisearch).
Los tests e2e usan los servicios reales en sus variantes de test. Los mocks dan
falsa seguridad; el objetivo es detectar incompatibilidades de contrato.

---

## 3. Aislamiento de servicios

Los tests usan los **mismos contenedores Docker** que el desarrollo, pero con
**identificadores distintos** para aislar datos. No hace falta levantar
infraestructura adicional.

| Servicio | Identificador dev | Identificador test | Cómo se aísla |
|---|---|---|---|
| **PostgreSQL** | DB `marketplace` | DB `marketplace_test` | `DATABASE_URL` en `.env.test` |
| **Redis** | DB 0 (`redis://localhost:6379`) | DB 1 (`redis://localhost:6379/1`) | `REDIS_URL` en `.env.test` |
| **Meilisearch** | Índice `listings` | Índice `listings_test` | Var `MEILI_INDEX_NAME` + constante `LISTINGS_INDEX` en `search.service.ts` |
| **MinIO** | Bucket `marketplace` | Bucket `marketplace-test` | `S3_BUCKET` en `.env.test` |

El fichero de referencia es `apps/api/.env.test`. Se añade a `.gitignore` como el
`.env` de desarrollo (no contiene secretos reales, pero sigue la misma convención).

### 3.1 Creación de la base de datos de test (única vez)

La base de datos `marketplace_test` hay que crearla manualmente la primera vez.
En desarrollo local, con Docker:

```bash
docker exec marketplace-postgres psql -U marketplace -c "CREATE DATABASE marketplace_test"
```

En CI, el paso de setup del workflow crea la base de datos antes de ejecutar los
tests (ver §7 — CI).

Las migraciones se aplican automáticamente en cada ejecución vía `globalSetup`
(`prisma migrate deploy`). No hay que migrar a mano tras crear la base de datos.

---

## 4. Suites de backend (RT.2–RT.5)

Todos los ficheros viven en `apps/api/test/`.

### 4.1 `auth.e2e-spec.ts` (RT.2)

| Caso | Qué verifica |
|---|---|
| `POST /api/auth/register` | 201, usuario en DB, email de verificación encolado |
| `POST /api/auth/register` (email duplicado) | 409 |
| `POST /api/auth/verify-email` (token válido) | `{ verified: true, accessToken }` con `emailVerified: true` en el JWT |
| `POST /api/auth/verify-email` (token inválido) | 400 |
| `POST /api/auth/login` (credenciales correctas, no verificado) | 200, `emailVerified: false` |
| `POST /api/auth/login` (credenciales correctas, verificado) | 200, `emailVerified: true` |
| `POST /api/auth/login` (contraseña errónea) | 401 |
| `POST /api/auth/forgot-password` | Siempre 200 (no revela existencia de cuenta) |
| `POST /api/auth/reset-password` (token válido) | 200; token marcado como usado |
| `POST /api/auth/reset-password` (token ya usado) | 400 |
| `GET /api/users/me` sin token | 401 |
| `GET /api/users/me` con token válido | 200, perfil del usuario |

### 4.2 `listings.e2e-spec.ts` (RT.3)

| Caso | Qué verifica |
|---|---|
| `POST /api/listings` (draft) | 201, `status: DRAFT`, no indexado |
| `POST /api/listings/:id/publish` | 200, `status: ACTIVE`, `expiresAt` = publishedAt + 60d |
| `GET /api/listings/:slug` | 200, ficha pública; caché Redis activa |
| `GET /api/listings/:slug` (no ACTIVE) | 404 |
| `PATCH /api/listings/:id` (propietario) | 200 |
| `PATCH /api/listings/:id` (otro usuario) | 403 |
| `POST /api/listings/:id/reserve` | 200, `status: RESERVED` |
| `POST /api/listings/:id/sold` | 200, `status: SOLD`, retirado del índice |
| `DELETE /api/listings/:id` | 204, retirado del índice |
| `POST /api/listings/:id/renew` (EXPIRED) | 200, `expiresAt` reiniciado |

### 4.3 `search.e2e-spec.ts` (RT.4)

Esta suite depende de Meilisearch real. Tras publicar un anuncio, usa
`waitForIndex()` antes de buscar (ver §5 — Meilisearch async).

| Caso | Qué verifica |
|---|---|
| `GET /api/search?q=texto` | Hits que contengan el texto |
| `GET /api/search?category=moviles` | Solo hits de la categoría |
| `GET /api/search?minPrice=100&maxPrice=500` | Hits dentro del rango |
| `GET /api/search?lat=&lng=&radius=` | Solo hits con coordenadas en el radio |
| `GET /api/search` (anuncio no ACTIVE) | No aparece en resultados |
| Paginación `?page=2&hitsPerPage=5` | `page: 2`, `hits.length ≤ 5` |
| Facetas | Respuesta incluye `facets` |

### 4.4 `messaging.e2e-spec.ts` (RT.5)

Esta suite arranca el NestJS app en un puerto real (`.listen(0)`) para poder
conectar socket.io-client.

| Caso | Qué verifica |
|---|---|
| `POST /api/conversations` (primer mensaje) | 201, conversación creada |
| `POST /api/conversations` (misma pareja, mismo anuncio) | Devuelve conversación existente |
| `GET /api/conversations` | Lista de conversaciones del usuario |
| `GET /api/conversations/:id` | Mensajes en orden, marca leída |
| `POST /api/conversations/:id/messages` | Persiste mensaje |
| WebSocket: `message:new` | El comprador recibe el evento en tiempo real tras el POST REST del vendedor |
| WebSocket: `conversation:join` con conversación ajena | El gateway rechaza (no se une a la room) |

---

## 5. Asincronía de Meilisearch — solución definitiva

### El problema

`POST /api/listings/:id/publish` encola un job BullMQ (`index`). El
`IndexingProcessor` lo procesa de forma asíncrona. En un test que publique y
luego busque, `GET /api/search` puede ejecutarse antes de que el worker haya
indexado el documento → **test intermitente**.

Esta es la causa nº1 de flakiness en suites que involucran búsqueda y es
precisamente por eso que se documenta aquí antes de escribir RT.4.

### Decisión: helper `waitForIndex` (poll con timeout)

Se descarta la indexación síncrona en entorno de test porque:
- Requeriría cambios en la arquitectura (bypass de BullMQ), alejándose del
  comportamiento real de producción.
- Los tests de búsqueda deben verificar el flujo completo: encolado → worker →
  Meilisearch.

El helper `waitForIndex` en `test/helpers/meili.ts` sondea el índice cada 200 ms
hasta que el documento aparece o se supera el timeout de 5 s:

```ts
await waitForIndex(meiliClient, process.env.MEILI_INDEX_NAME!, listing.id);
```

5 s es generoso: el worker procesa un job local en ~50–200 ms. Si el timeout
se alcanza, el test falla con un mensaje claro que identifica si el worker está
caído o el índice es inaccesible.

### Patrón obligatorio en RT.4 (y cualquier test que busque)

```ts
// 1. Crear y publicar el anuncio
const res = await request.post('/api/listings').send(draftDto);
await request.post(`/api/listings/${res.body.id}/publish`);

// 2. Esperar a que el worker lo indexe
await waitForIndex(meiliClient, process.env.MEILI_INDEX_NAME!, res.body.id);

// 3. Ahora la búsqueda encontrará el documento
const search = await request.get('/api/search?q=...').expect(200);
```

---

## 6. Regla de no-dependencia entre tests

**Con `cleanDb()` por suite (no por test), los tests dentro de una suite comparten
el estado de base de datos.** Esto es una decisión de rendimiento consciente: hacer
TRUNCATE + seed en cada test individual es demasiado lento.

La contrapartida es que los tests deben respetar esta norma:

> **Cada test es responsable de los datos que necesita. Ningún test puede asumir
> que otro test ha creado o dejado un recurso en un estado determinado.**

Guías concretas:

1. **Datos compartidos (inmutables):** Los anuncios y usuarios creados en `beforeAll`
   de la suite son de solo lectura para todos los tests. Los tests que los leen
   (GET) son seguros.

2. **Datos mutables:** Si un test necesita hacer una acción destructiva
   (`DELETE /listings/:id`, `POST /listings/:id/sold`), crea su propio anuncio
   en un `beforeEach` local, no usa el compartido de `beforeAll`.

3. **Orden de tests:** Jest ejecuta tests en el orden del fichero. Los tests no
   deben depender de ese orden. Cada test empieza asumiendo solo el estado
   establecido en `beforeAll`.

4. **Nombres únicos:** Los seeds de test usan emails y slugs deterministas
   (`seller-test@example.com`, `buyer-test@example.com`). Dentro del `beforeAll`
   de cada suite, estos usuarios se crean vía Prisma directamente (no por HTTP),
   garantizando que existen antes del primer test.

---

## 7. CI — compatibilidad sin cambios de código

`test/setup-e2e.js` es portable porque lee `DATABASE_URL`, `REDIS_URL` y
`MEILI_INDEX_NAME` desde `process.env`. En local, los obtiene de `.env.test` vía
dotenv. En CI, el runner los inyecta directamente.

**Paso de setup en el workflow de CI (RT.5):**

```yaml
services:
  postgres:
    image: postgis/postgis:16-3.5
    env:
      POSTGRES_USER: marketplace
      POSTGRES_PASSWORD: marketplace_dev
      POSTGRES_DB: marketplace_test   # ← base de datos de test directamente
  redis:
    image: redis:7-alpine
  meilisearch:
    image: getmeili/meilisearch:v1.10
    env:
      MEILI_MASTER_KEY: masterKey_ci

env:
  DATABASE_URL: postgresql://marketplace:marketplace_dev@localhost:5432/marketplace_test
  REDIS_URL: redis://localhost:6379/1
  MEILI_HOST: http://localhost:7700
  MEILI_MASTER_KEY: masterKey_ci
  MEILI_INDEX_NAME: listings_test
  JWT_SECRET: ci_jwt_secret
  # ... resto de vars de test
```

Con este esquema, `globalSetup` ejecuta `prisma migrate deploy` + seed contra
`marketplace_test` sin ningún cambio de código. La base de datos ya existe porque
la crea el service container de CI (a diferencia del entorno local, donde se crea
una sola vez con `docker exec`).

---

## 8. Datos de prueba

### 8.1 Seed estático (categories) — ejecutado en `globalSetup`

`apps/api/prisma/seed-test.ts` crea una categoría mínima:

- `electronica` (padre)
- `moviles` (hijo de electrónica, con atributos `brand` y `ram`)

Se usa `upsert` para que el script sea idempotente. Las categorías **nunca se
truncan** entre suites; son datos estáticos del sistema.

### 8.2 Seed dinámico (usuarios y anuncios) — por suite en `beforeAll`

Cada suite crea sus propios usuarios y anuncios via Prisma directamente (no por
HTTP), para que el estado sea exactamente el deseado sin depender de reglas de
negocio que pudieran cambiar:

```ts
// Patrón estándar en el beforeAll de cada suite
const prisma = new PrismaClient();

beforeAll(async () => {
  await cleanDb(prisma);               // TRUNCATE "User" CASCADE
  await resetMeili(buildMeiliClient()); // deleteAllDocuments del índice test

  seller = await prisma.user.create({
    data: {
      email: 'seller-test@example.com',
      passwordHash: await bcrypt.hash('Test1234!', 10),
      name: 'Vendedor Test',
      slug: 'vendedor-test',
      emailVerified: true,
    },
  });
  // ... más setup
});
```

### 8.3 Contraseñas en tests

`bcrypt.hash('Test1234!', 4)` — 4 rondas en vez de 12 para minimizar el tiempo
de setup. El número de rondas es una decisión de rendimiento, no de seguridad,
y solo aplica en el entorno de test.

---

## 9. Configuración base (entregables de RT.1)

Los ficheros creados en esta ráfaga son los necesarios para que RT.2 pueda
empezar a escribir tests inmediatamente.

### 9.1 Cambio en `search.service.ts`

`LISTINGS_INDEX` pasa de hardcoded `'listings'` a leer la variable de entorno:

```ts
export const LISTINGS_INDEX = process.env.MEILI_INDEX_NAME ?? 'listings';
```

Este es el único cambio en código de producción de RT.1. Es retrocompatible: en
desarrollo y producción, donde `MEILI_INDEX_NAME` no está definida, sigue usando
`'listings'`.

### 9.2 Árbol de ficheros creados

```
apps/api/
├── .env.test                          # Variables de test (no commitear)
├── test/
│   ├── jest-e2e.json                  # Configuración Jest e2e (reescrita)
│   ├── load-env.ts                    # setupFiles: carga .env.test en workers
│   ├── setup-e2e.js                   # globalSetup: migrate + seed categories
│   ├── teardown-e2e.js                # globalTeardown (vacío, extensible)
│   └── helpers/
│       ├── create-app.ts              # Factory: crea INestApplication de test
│       ├── db.ts                      # cleanDb() + resetMeili() + buildMeiliClient()
│       └── meili.ts                   # waitForIndex() — resuelve async de Meilisearch
└── prisma/
    └── seed-test.ts                   # Seed de categories (idempotente)

apps/web/
└── playwright.config.ts               # Config Playwright (completar en RT.5)
```

### 9.3 Scripts añadidos

**`apps/api/package.json`:**

```json
"test:e2e": "jest --config ./test/jest-e2e.json",
"test:setup:db": "docker exec marketplace-postgres psql -U marketplace -c \"CREATE DATABASE marketplace_test\" || true"
```

**`apps/web/package.json`:**

```json
"test:e2e": "playwright test",
"test:e2e:ui": "playwright test --ui"
```

### 9.4 Instalación de dependencias nuevas

```bash
# Backend: dotenv como devDependency directa (actualmente solo transitiva)
pnpm --filter @marketplace/api add -D dotenv

# Frontend: Playwright
pnpm --filter @marketplace/web add -D @playwright/test
pnpm --filter @marketplace/web exec playwright install --with-deps chromium
```

---

## 10. Frontend E2E con Playwright (RT.5)

Un único viaje de usuario cubre el flujo crítico completo:

```
login → publicar (wizard 5 pasos) → buscar → ver ficha → contactar
```

### 10.1 Estructura

```
apps/web/
└── e2e/
    ├── fixtures/
    │   └── auth.ts         # Fixture de sesión autenticada (next-auth)
    └── flujo-critico.spec.ts
```

### 10.2 Setup del entorno para Playwright

Playwright necesita el stack completo arrancado con datos de test:

- **Local:** Arrancar manualmente el backend con variables de `.env.test`
  (`NODE_ENV=test pnpm --filter @marketplace/api dev`) y el frontend dev. Playwright
  usa `reuseExistingServer: true` y no los relanza.
- **CI:** Playwright lanza ambos servidores vía la sección `webServer` del config;
  las variables de entorno las inyecta el workflow.

### 10.3 Fixture de autenticación

El viaje requiere un usuario logado. La fixture crea la sesión usando el
`storageState` de Playwright (guarda cookies/localStorage de next-auth) para no
repetir el login en cada test:

```ts
// e2e/fixtures/auth.ts
import { test as base, Page } from '@playwright/test';

export const test = base.extend<{ authedPage: Page }>({
  authedPage: async ({ page }, use) => {
    await page.goto('/login');
    await page.fill('[name=email]', 'seller-e2e@example.com');
    await page.fill('[name=password]', 'Test1234!');
    await page.click('[type=submit]');
    await page.waitForURL('/');
    await use(page);
  },
});
```

---

## 11. Observabilidad (interfaz para RT.6)

RT.6 implementa; aquí se define el qué y el dónde.

### 11.1 Sentry — captura de errores

| Dónde | Cómo |
|---|---|
| Backend NestJS | `Sentry.init()` en `main.ts`, antes de `NestFactory.create()`. Integración con `@sentry/nestjs`. |
| Frontend Next.js | `instrumentation.ts` (raíz de `apps/web/src/`), usando `@sentry/nextjs`. |
| En tests | `SENTRY_DSN=` vacío en `.env.test` → Sentry se inicializa pero nunca envía eventos. |

Criterio de captura en backend: todas las excepciones no manejadas + errores en
procesadores BullMQ (envolviendo el `process()` en try/catch con
`Sentry.captureException()`).

### 11.2 Logging estructurado — pino

Reemplazar el logger por defecto de NestJS por `pino` vía `nestjs-pino`. Salida
JSON (level, timestamp, context, traceId). En test, nivel `error` para no
contaminar la salida de Jest.

```ts
// app.module.ts (RT.6)
LoggerModule.forRoot({
  pinoHttp: {
    level: process.env.NODE_ENV === 'test' ? 'error' : 'info',
    transport: process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty' }
      : undefined,
  },
}),
```

### 11.3 Lo que los tests NO verifican de observabilidad

Los tests e2e no afirman nada sobre Sentry ni sobre logs. Observabilidad se verifica
con smoke tests en staging, no con tests automatizados (los eventos de Sentry son
efectos secundarios, no contratos de API).

---

## 12. Flujo de trabajo

### Correr los tests de backend

```bash
# Una sola vez (crear la base de datos de test)
pnpm --filter @marketplace/api test:setup:db

# Ejecutar la suite e2e completa
pnpm --filter @marketplace/api test:e2e

# Ejecutar una suite específica
pnpm --filter @marketplace/api test:e2e -- --testPathPattern=auth
```

### Correr los tests de frontend

```bash
# Prerequisito: stack arrancado con env de test
pnpm --filter @marketplace/web test:e2e

# Con UI interactiva (útil para depurar)
pnpm --filter @marketplace/web test:e2e:ui
```

### Ciclo de desarrollo con tests

1. `docker compose up -d` — infraestructura
2. Editar código en `apps/api/src/` o `apps/web/src/`
3. `pnpm --filter @marketplace/api test:e2e` — feedback rápido
4. Si falla un test de búsqueda, verificar que el worker de BullMQ está arrancado
   (el `AppModule` lo levanta al inicializar el test app; si `createTestApp()` no se
   llama, el worker no existe y `waitForIndex` agotará el timeout)

---

## Apéndice — Decisiones descartadas

| Opción descartada | Por qué |
|---|---|
| Contenedores de test separados (puertos distintos) | Sin beneficio real para un entorno mono-desarrollador; añade complejidad sin aportar aislamiento adicional |
| Mocking de Prisma/Redis/Meilisearch | Da falsa seguridad; no detecta incompatibilidades de contrato ni bugs de integración |
| Indexación síncrona en test (bypass BullMQ) | Cambiaría el camino de producción; el helper `waitForIndex` es suficiente y más honesto |
| `TRUNCATE` por test individual | Demasiado lento; la norma de no-dependencia entre tests mitiga el riesgo sin coste de tiempo |
| Vitest en lugar de Jest | No es prioritario; migrar en un refactor posterior si el tiempo de suite supera 2 min |
