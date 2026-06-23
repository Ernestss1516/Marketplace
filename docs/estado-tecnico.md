# Estado técnico del proyecto — Marketplace

> Fecha: 2026-06-22 · Rama: `main` · Último commit: `08d2ff9` (Fase 5) + cambios sin commitear (expiration, geocoding, perfil, búsqueda por proximidad)
> Plan vigente para la siguiente fase: `docs/Hoja_de_ruta_rafagas_Hito2.docx`.

Documento de referencia para retomar el proyecto. Recoge qué hay implementado,
qué decisiones se tomaron respecto al diseño original y qué queda pendiente.

---

## 1. Estado de implementación por módulo

### Backend (`apps/api` — puerto 3001)

| Módulo | Estado | Notas |
|---|---|---|
| **Infra: Prisma** | ✅ Completo | Schema con todos los modelos; PostGIS habilitado; 5 migraciones aplicadas: `init`, `add_auth_tokens`, `media_listing_image_nullable`, `add_price_type`, `backfill_expires_at` |
| **Infra: Redis** | ✅ Completo | `RedisService` global; caché de fichas de anuncio (TTL 5 min) |
| **Infra: BullMQ** | ✅ Colas activas | 3 colas registradas con processors reales (ver §2 para el fix de ioredis) |
| **Infra: Meilisearch** | ✅ Completo | `SearchService.onModuleInit()` crea el índice `listings` y aplica searchable/filterable/sortable attrs, ranking rules y typo tolerance al arrancar |
| **Infra: MinIO/R2** | ✅ Completo | Dev: MinIO vía docker-compose (bucket `marketplace` con lectura pública, creado por el contenedor `createbuckets`). Prod: Cloudflare R2 vía `R2Service` |
| **Auth** | ✅ Completo | register, login, verify-email, forgot-password, reset-password; `JwtAuthGuard`, `RolesGuard`, `@CurrentUser`; login devuelve `emailVerified` (fix fase 5) |
| **Users** | ✅ Completo | `GET /users/me`, `PATCH /users/me`, `GET /users/:slug` (perfil público) |
| **Categories** | ✅ Completo | `GET /categories` (árbol), `GET /categories/:slug` (con `attributeSchema`) |
| **Listings** | ✅ Completo | CRUD completo + ciclo de vida (publish, reserve, sold, delete, **renew**) + `expiresAt` fijado al publicar (publishedAt + 60 días) + caché por slug + encolado de reindexado; `GET /listings/mine/:id` para edición; `thumbnailUrl` resuelto en `findMine` y `findBySellerSlug`; geocoding automático al crear y al editar cuando cambia la ubicación |
| **Expiration** | ✅ Completo | `ExpirationService` con cron diario a las 02:00 (`@nestjs/schedule`): marca EXPIRED los anuncios ACTIVE con `expiresAt ≤ now`, invalida caché Redis y encola reindexado. Los RESERVED quedan excluidos intencionalmente |
| **Geocoding** | ✅ Completo | `GeocodingService` con proveedor configurable (`nominatim` por defecto, `maptiler`). Timeout de 1 500 ms con `AbortSignal.timeout()`; retorna `null` en cualquier fallo sin bloquear la publicación. Script `geocode-backfill` para anuncios sin coordenadas existentes (cursor-based, 1 req/s para respetar la política de Nominatim) |
| **Media** | ✅ Upload | `POST /media/upload` → R2/MinIO → crea `ListingImage` huérfana → encola procesado con sharp; **sin DELETE** |
| **Search** | ✅ Completo | `GET /search` con texto libre, filtros core, atributos variables (brand, fuel, rooms, gender, size…), **filtro por proximidad** (`lat` + `lng` + `radius` en km → `_geoRadius` en Meilisearch) y **orden por distancia** cuando no hay sort explícito, facetas, paginación y ordenación; `IndexingProcessor` real con jobs `index`/`remove` |
| **Script reindex** | ✅ Completo | `pnpm reindex` — reconstruye el índice en batches de 100; `ReindexModule` mínimo (sin BullMQ) para cierre limpio |
| **Messaging** | ✅ Completo | REST: `GET /conversations`, `POST /conversations`, `GET /conversations/:id` (cursor), `POST /conversations/:id/messages`. WebSocket gateway `/ws`: auth en handshake, rooms de conversación y de usuario, emit tras el POST REST |
| **Favorites** | ❌ Stub vacío | Ídem |
| **Reviews** | ❌ Stub vacío | Ídem |
| **Moderation** | ❌ Stub vacío | Ídem |
| **Admin** | ❌ Stub vacío | Ídem |

### Frontend (`apps/web` — puerto 3000)

| Página / Componente | Estado | Notas |
|---|---|---|
| **Home** `/` | ✅ Completo | Hero, buscador, grid de categorías, últimos anuncios (8); Server Component con fetch paralelo |
| **Ficha anuncio** `/anuncio/[slug]` | ✅ Completo | Galería, precio con `priceType`, atributos de categoría, ubicación, anuncios relacionados, metadata OG; `ContactButton` integrado |
| **Categoría** `/[categoria]` | ✅ Completo | Listado paginado con ordenación (fecha/precio) |
| **Publicar** `/publicar` | ✅ Completo | Wizard 5–6 pasos (categoría, fotos, datos, atributos opcionales, ubicación, preview); subida a R2/MinIO vía `POST /media/upload`; crea borrador + publica |
| **Login / Registro** | ✅ Completo | Formularios con next-auth v5 CredentialsProvider |
| **Verificar email** `/verificar-email` | ✅ Completo | Llama a `POST /auth/verify-email`; emite nuevo JWT con `emailVerified: true` |
| **Recuperar contraseña** | ✅ Completo | forgot-password + reset-password enlazado por email |
| **Mis anuncios** `/mis-anuncios` | ✅ Completo | Listado de anuncios propios + acciones de estado (publicar, reservar, vender, eliminar, **renovar**) vía `MisAnunciosClient`; muestra `expiresAt` en la tarjeta |
| **Editar anuncio** `/mis-anuncios/[id]/editar` | ✅ Completo | Wizard de edición (`EditarWizard`) precargado con datos del backend vía `GET /listings/mine/:id`; categoría bloqueada |
| **Vendedor** `/vendedor/[slug]` | ✅ Completo | Perfil del vendedor (avatar, bio, ubicación, fecha de registro) + grid paginado de anuncios activos |
| **Búsqueda** `/busqueda` | ✅ Completo | Server Component con fetch paralelo a Meilisearch; sidebar `FilterPanel` con categorías, tipo, estado, rango de precio, ordenación, facetas dinámicas, **control "cerca de mí"** (solicita `navigator.geolocation`, fija `lat`/`lng`/`radius` en la URL, selector de radio 5–50 km, orden por distancia automático); paginación; estados de error y vacío |
| **Perfil propio** `/perfil` | ✅ Completo | Ruta protegida por middleware; muestra avatar, nombre, email, ubicación y aviso de email no verificado; `PerfilForm` con campos nombre, teléfono, bio, ciudad, provincia, código postal; accesos rápidos a mis-anuncios y mensajes; botón de cerrar sesión |
| **Bandeja mensajes** `/mensajes` | ✅ Completo | `BandejaMensajesClient`: lista de conversaciones con thumbnail, contador de no leídos y tiempo relativo; actualización en vivo vía WebSocket (lastMessageAt + unreadCount) |
| **Chat** `/mensajes/[id]` | ✅ Completo | `ChatClient`: mensajes en orden cronológico, auto-scroll al fondo, carga de mensajes anteriores (cursor-based), envío vía POST REST, recepción en tiempo real vía WebSocket con deduplicación idempotente |
| **Admin** `/admin/*` | ❌ Sin implementar | Protegido por rol ADMIN en middleware; páginas vacías |

---

## 2. Decisiones técnicas y desviaciones respecto al diseño original

### Ruta `/vendedor/[slug]` en lugar de `/[vendedor]`

El diseño original situaba el perfil del vendedor en `/{slug}` directamente en la
raíz. En Next.js App Router eso colisiona con `[categoria]` (ambos serían
segmentos dinámicos en el mismo nivel). La solución adoptada fue el prefijo fijo
`/vendedor/[slug]`, que elimina la ambigüedad sin coste SEO significativo.

### Campo `priceType` (enum `FIXED | FREE | NEGOTIABLE`)

El diseño original modelaba solo un campo `price: Decimal`. Se añadió el enum
`PriceType` como campo separado para representar de forma explícita "Gratis" y
"A convenir" sin trucos de valor nulo o cero. La migración correspondiente es
`20260620211233_add_price_type`. El frontend expone esto como tres radio buttons
(`priceMode`) y la función `priceTypeFromMode` en `StepDatos` traduce al enum.

### Anuncios recientes y por categoría vía Postgres (no Meilisearch)

`GET /listings` (recientes) y los listados por categoría (`/[categoria]`) se
resuelven directamente contra Postgres con `prisma.listing.findMany`. Meilisearch
está operativo pero se usa exclusivamente para búsqueda de texto libre (`GET /search`).
Con los índices de `(status, publishedAt)` y `(categoryId, status)` el rendimiento
es suficiente para el volumen del MVP; si el catálogo crece y se necesitan filtros
facetados en los listados por categoría, habría que migrar esas rutas a Meilisearch.

### `categoryPath` jerárquico y sintaxis de filtro de array en Meilisearch

El campo `categoryPath` en el documento indexado es un array de slugs: `[slugHoja,
slugPadre]`. Esto permite filtrar tanto por categoría hoja como por categoría padre
con una sola expresión. La sintaxis de filtro de Meilisearch para comprobar si un
valor pertenece a un array es **`campo = valor`** (no `IN`); se usa
`categoryPath = "slug"` y Meilisearch lo evalúa como "¿contiene el array este valor?".

Limitación actual: `INDEX_INCLUDE` en `search.service.ts` solo incluye un nivel de
padre (`category.parent`), por lo que `categoryPath` soporta como máximo 2 niveles
(hoja → padre). Un árbol de 3+ niveles requeriría recorrer `parent.parent…` en el
include y adaptar `toDocument`.

### Orden del spread en `toDocument` para no pisar campos core

Los atributos variables de categoría (extraídos de `listing.attributes`) se extienden
**antes** de los campos core en la función `toDocument`. Esto garantiza que ningún
atributo del seed pueda sobreescribir campos como `type` (que en algunos seeds de
categoría colisiona con `ListingType`) o `id`. El spread de atributos tiene prioridad
de definición inferior porque los campos core van después.

### DTO explícito de atributos variables por el ValidationPipe estricto

El backend arranca con `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`.
Cualquier query parameter que no esté declarado en `SearchQueryDto` es rechazado con
400. Por eso los atributos variables de categoría (brand, fuel, rooms, gender, size…)
están **declarados explícitamente** como campos del DTO en lugar de leerse como mapa
genérico. `VARIABLE_ATTRIBUTE_KEYS` en `search.service.ts` es la fuente de verdad
compartida; el DTO y el service deben mantenerse en sync al añadir atributos nuevos.

### Fix ioredis en BullMQ

`@nestjs/bullmq` usa `ioredis@5.10.x` internamente. Pasar una instancia
`new Redis()` construida con la versión `5.11.x` del paquete raíz generaba un
error de tipos en TypeScript. Solución: en `queue.module.ts` se parsea la
`REDIS_URL` con `new URL(...)` y se pasan opciones planas
`{ host, port, maxRetriesPerRequest: null }` en lugar de una instancia Redis.
`maxRetriesPerRequest: null` es obligatorio en BullMQ v3+ para evitar que el
worker rechace jobs al primer fallo de conexión.

### Verificación de email: nuevo JWT en lugar de re-login

Al verificar el email (`POST /auth/verify-email`), el backend emite directamente
un nuevo access token con `emailVerified: true` en el payload. El cliente lo
recibe y puede actualizar la sesión de next-auth sin obligar al usuario a
volver a introducir sus credenciales. El campo `emailVerified` viaja en el JWT
para evitar una query a la base de datos en cada request autenticado.

### Imágenes: upload pre-anuncio (huérfanas temporales)

El flujo de publicación sube las fotos a R2/MinIO antes de crear el anuncio.
`ListingImage` se crea con `listingId: null`; al crear el anuncio se vincula vía
`linkImages`. Este diseño permite el wizard multistep pero deja imágenes huérfanas
si el usuario abandona el proceso (ver §3).

### Script reindex: `ReindexModule` mínimo y cierre limpio sin `process.exit()`

El script `apps/api/src/commands/reindex.ts` arranca un contexto NestJS con un
módulo propio (`ReindexModule`) que solo importa `PrismaModule` y `SearchModule`,
sin BullMQ ni Redis. Al no haber workers con handles persistentes en libuv,
`app.close()` cierra todo limpiamente. No se llama a `process.exit()` en el
camino feliz porque en Windows + Prisma 6.x el query-engine thread puede seguir
vivo y llamar a `uv_async_send()` sobre un handle ya cerrado (`UV_HANDLE_CLOSING`),
produciendo un volcado de memoria aunque el trabajo haya terminado correctamente.
En su lugar se llama a `prisma.$disconnect()` y se deja drenar el event loop.
El tsconfig dedicado (`tsconfig.scripts.json`) fuerza `"module": "CommonJS"` e
`"incremental": false` para que `ts-node` compile el script de forma portátil.
El script `geocode-backfill` sigue el mismo patrón (ver §Geocoding backfill).

### Gateway WebSocket y modelo de rooms (Fase 5)

El gateway (`MessagingGateway`) vive en el namespace `/ws` y usa socket.io vía
`@nestjs/websockets` + `@nestjs/platform-socket.io`. La autenticación se hace en
`handleConnection`: se extrae `socket.handshake.auth.token`, se verifica con
`JwtService.verify()` directamente (Passport no aplica en WebSocket), y si falla se
desconecta el socket. Si es válido, el socket se une automáticamente a la room
`user:${userId}`, que es el canal de la bandeja (`/mensajes`).

Para el chat (`/mensajes/[id]`), el cliente emite `conversation:join` con
`{ conversationId }` y el gateway verifica en Prisma que el usuario es participante
(buyerId o sellerId) antes de unirlo a la room `conv:${conversationId}`. La comprobación
de participante vive en el gateway (no en el controller) para mantener la autorización
cerca del recurso WebSocket. `socket.join` es idempotente, así que re-emitir
`conversation:join` en cada reconexión (el evento `connect` de socket.io se dispara
tanto en la conexión inicial como tras cada reconexión) no genera efectos secundarios.

El POST REST sigue siendo la única vía de persistencia y validación. Tras persistir,
el controller llama a `gateway.emitNewMessage(conversationId, message, buyerId, sellerId)`,
que emite `message:new` a tres rooms: `conv:${conversationId}` (para los ChatClients de
ambos participantes) y `user:${buyerId}` + `user:${sellerId}` (para las bandejas de
cada uno). El canal de usuario evita que la bandeja tenga que unirse a todas las rooms
de conversación del usuario.

### Deduplicación idempotente por id en el cliente (Fase 5)

Existe una condición de carrera entre la respuesta del POST REST y el evento
`message:new` del socket: el WebSocket es una conexión persistente sin el overhead
HTTP, por lo que el evento del servidor puede llegar al cliente antes de que el
navegador reciba la respuesta HTTP. Si el socket llega primero, añade el mensaje al
estado de React; si luego llega el REST también lo añade, el mensaje aparece duplicado.

La solución aplica la guarda `prev.some(m => m.id === incoming.id)` **dentro del
actualizador funcional** de `setMessages` en ambas rutas de inserción:

```ts
// En el handler del socket (onMessage en useMessagingSocket):
setMessages(prev => prev.some(m => m.id === incoming.id) ? prev : [...prev, incoming]);

// En handleSend tras la respuesta del POST REST:
setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
```

Usar el actualizador funcional es imprescindible: garantiza que la comparación se
hace contra el estado real en el momento en que React aplica la actualización, no
contra un snapshot capturado por el closure cuando se definió la función. Sin el
actualizador funcional la dedup siempre falla porque evalúa contra el estado stale
del cierre.

La misma propiedad hace que la dedup sea segura con la estabilización del callback
mediante `onMessageRef` en el hook: aunque el callback no se recrea en cada render,
`setMessages(updater)` siempre recibe el `prev` más reciente de React.

### Fix de propagación de `emailVerified` desde login (Fase 5)

`POST /auth/login` no incluía `emailVerified` en el objeto `user` de la respuesta.
El `ContactButton` en la ficha de anuncio necesita este valor para decidir si mostrar
el formulario de contacto o el aviso de verificación pendiente (ya que `session.user.emailVerified`
se rellena desde la respuesta del login, no solo desde el token JWT).

Fix: se añadió `emailVerified: user.emailVerified` al objeto devuelto por
`AuthService.login`, y se actualizó la interfaz `LoginResponse` en `apps/web/src/lib/auth/index.ts`
para incluir el campo. El flow de next-auth ya lo propagaba hasta `session.user`
(vía `auth.config.ts`), solo faltaba que el backend lo enviara.

### Caducidad automática y renovación de anuncios

Los anuncios caducan 60 días tras su publicación (`EXPIRY_DAYS = 60` en
`ExpirationService`). El campo `expiresAt` se calcula en el momento de la
publicación con `ExpirationService.expiresAt(publishedAt)` y se persiste junto con
el cambio de estado a ACTIVE.

El cron `@Cron(CronExpression.EVERY_DAY_AT_2AM)` busca todos los anuncios ACTIVE
con `expiresAt ≤ now`, los marca EXPIRED en una sola llamada `updateMany`, y por
cada uno invalida la caché Redis y encola un job `index` para que Meilisearch los
retire del índice. Los anuncios RESERVED quedan excluidos del cron: están en
negociación activa y no deben caducar automáticamente.

El endpoint `POST /listings/:id/renew` acepta anuncios en estado ACTIVE o EXPIRED,
reinicia `publishedAt` a la fecha actual y extiende `expiresAt` otros 60 días, con
reindexado inmediato. Desde el frontend, `MisAnunciosClient` expone la acción de
renovación y la tarjeta `MyListingCard` muestra la fecha de caducidad.

### Geocoding configurable con fallback silencioso

`GeocodingService` resuelve coordenadas a partir de ciudad + provincia + código
postal. El proveedor se selecciona con la variable `GEOCODING_PROVIDER`:

- **`nominatim`** (por defecto): Nominatim de OpenStreetMap, sin API key. Requiere
  el header `User-Agent` con información de contacto del aplicativo (política de uso).
  Limitado a 1 req/s, adecuado para dev y backfill, insuficiente bajo carga de
  producción.
- **`maptiler`**: API comercial (requiere `MAPTILER_API_KEY`). Sin límite de tasa
  significativo en los planes de pago.

Ambas rutas comparten un timeout de 1 500 ms vía `AbortSignal.timeout()`. Cualquier
error o timeout devuelve `null` sin lanzar excepción, de modo que un proveedor lento
o caído nunca bloquea la publicación ni la edición de un anuncio.

La geocodificación se ejecuta en dos momentos:
- Al **crear** un anuncio: si el wizard no envía coordenadas explícitas.
- Al **editar**: si cambia algún campo de ubicación (ciudad, provincia o código
  postal) y no se proporcionan coordenadas explícitas en el DTO.

### Script `geocode-backfill` para anuncios sin coordenadas

Los anuncios publicados antes de integrar el geocoding tienen `latitude = null`. El
script `apps/api/src/commands/geocode-backfill.ts` los procesa en lotes de 50 con
cursor-based pagination (condición `WHERE latitude IS NULL AND city IS NOT NULL`),
geocodifica cada uno y actualiza Postgres + Meilisearch. Entre peticiones espera
1 000 ms para respetar la política de 1 req/s de Nominatim. Al igual que `reindex`,
el script arranca un contexto NestJS mínimo (`GeocodingBackfillModule`: solo Prisma +
Search + Geocoding, sin BullMQ) y llama a `prisma.$disconnect()` sin `process.exit()`.

### Búsqueda por proximidad: `_geoRadius` + `_geoPoint`

`SearchQueryDto` expone tres parámetros opcionales: `lat`, `lng` y `radius` (km).
Cuando los tres están presentes, `SearchController` los pasa al service como
`geo: { lat, lng, radiusMeters: radius * 1_000 }`. El servicio aplica el filtro
`_geoRadius(lat, lng, radiusMeters)` de Meilisearch, que excluye automáticamente
documentos sin campo `_geo`. Cuando se activa la proximidad y no hay `sort` explícito,
el sort se reemplaza por `_geoPoint(lat, lng):asc` para ordenar por distancia
ascendente.

En `/busqueda`, `FilterPanel` implementa el control "cerca de mí":
- Botón que invoca `navigator.geolocation.getCurrentPosition()` con timeout de 10 s.
- Al obtener posición, escribe `lat`, `lng` y `radius=10` en la URL y elimina el
  parámetro `sort` para activar el orden por distancia.
- Selector de radio (5, 10, 25, 50 km) mientras la proximidad está activa.
- Botón de desactivar que limpia `lat`, `lng`, `radius` y `sort` de la URL.
- Opción de ordenación "Más cercanos" visible solo cuando la proximidad está activa.

---

## 3. Limitaciones conocidas y deuda técnica

### CORS del gateway WebSocket: `origin: '*'` a restringir en producción

El gateway está decorado con `cors: { origin: '*' }`. En producción debe restringirse
al origen del frontend (valor de `APP_URL`). El TODO está anotado en `messaging.gateway.ts`.

### `allowedDevOrigins` en Next.js si se accede por IP en desarrollo

En Next.js 15, si el frontend se sirve por IP en lugar de `localhost` (p. ej. desde
otro dispositivo en la red local), el App Router genera advertencias de CORS para los
preloads de scripts. Se puede suprimir añadiendo la IP a `allowedDevOrigins` en
`next.config.ts`:
```ts
allowedDevOrigins: ['192.168.x.x']
```

### `conversation:read` (mark-as-read) no implementado vía WebSocket

El contrato en `contratos-api.md` define el evento `conversation:markRead` (cliente →
servidor) y `conversation:read` (servidor → cliente) para señalizar la lectura en
tiempo real. Por ahora, los mensajes se marcan como leídos de forma síncrona en
`GET /conversations/:id` (al abrir el chat), pero la contraparte en la bandeja del
otro participante no se actualiza en vivo: su contador de no leídos solo baja al
recargar. Pendiente: añadir el evento en el gateway y actualizar la bandeja.

### Nominatim en producción: límite de 1 req/s

Nominatim (OSM) impone un máximo de 1 petición por segundo y prohíbe el uso
intensivo. En producción, bajo cualquier carga real, es necesario cambiar a un
proveedor comercial (`GEOCODING_PROVIDER=maptiler` + `MAPTILER_API_KEY`) o a una
instancia propia de Nominatim. El timeout de 1 500 ms protege frente a lentitud,
pero no frente a bloqueos por rate-limit del proveedor público.

### Geolocalización del navegador solo en contexto seguro (HTTPS)

`navigator.geolocation` solo está disponible en orígenes seguros (HTTPS o
`localhost`). El botón "cerca de mí" de `FilterPanel` quedará inoperativo si el
frontend se sirve por HTTP en una IP de red local (p. ej. en un dispositivo móvil
conectado a la misma red de desarrollo). En producción esto no es problema porque
el sitio irá sobre HTTPS.

### Renombrar atributo `type` → `itemType` en el seed

Varias categorías del seed (`ordenadores`, `electrodomésticos`, `accesorios`,
`muebles`) usan un atributo llamado `type` en su `attributeSchema`. Este nombre
colisiona con el campo `type` de nivel de anuncio (`ListingType: PRODUCT | SERVICE`).
El orden del spread en `toDocument` previene la sobreescritura, pero el atributo
de categoría no se indexa bajo ese nombre. Renombrarlo a `itemType` en el seed
(y en `VARIABLE_ATTRIBUTE_KEYS` + `SearchQueryDto`) lo hará filtrable de forma
segura.

### `size`: inconsistencia de tipo string/number entre categorías

En las categorías de ropa el atributo `size` se almacena como cadena (`"M"`,
`"XL"`); en calzado como número (`38`, `42`). Enviar `size=38` como cadena desde
el filtro no coincidirá con documentos donde `size` está guardado como número.
Necesita normalización de tipo en el seed antes de que el filtro funcione de forma
fiable en todas las categorías de moda.

### Sin `DELETE /media`

No existe endpoint para eliminar imágenes de R2/MinIO ni su registro en base de
datos. Las imágenes subidas en un wizard abandonado permanecen en almacenamiento
y en la tabla `ListingImage` con `listingId: null` indefinidamente. Pendiente:
endpoint `DELETE /media/:id` que verifique propiedad (`uploadedById`), borre del
almacenamiento y elimine el registro.

### Notificaciones de email: Resend configurado para desarrollo

`NotificationProcessor` usa la SDK de Resend y está completamente implementado.
En desarrollo es posible usar `RESEND_API_KEY=re_test_…` con el remitente de
pruebas `onboarding@resend.dev` sin necesidad de verificar ningún dominio. En
producción hay que verificar el dominio remitente en el panel de Resend y
actualizar `RESEND_FROM` en el `.env` de producción.

### Módulos stub: favoritos, valoraciones, moderación, admin

Los controllers y services existen con cuerpos vacíos. Ninguno tiene lógica real.
La estructura de base de datos para todos ellos está completa en el schema.

### Sin paginación en categorías ni en el home

`GET /categories` devuelve el árbol completo en una sola llamada. Mientras el
número de categorías sea reducido (< 200) esto es aceptable; a escala habría que
añadir paginación o cachear la respuesta en Redis.

### Slug de anuncio con sufijo aleatorio, sin reintento ante colisión

`buildSlug` en `ListingsService` genera `{base}-{6-char-hex}`. El campo
`slug` tiene `@unique` en el schema, por lo que una colisión lanzaría
`PrismaClientKnownRequestError P2002`. No hay lógica de reintento. En la práctica
la probabilidad es despreciable, pero en un volumen alto convendría añadir un
bucle de reintento similar al de `generateUniqueSlug` en auth.

---

## 4. Documentación de la API

Swagger está disponible en **`http://localhost:3001/api/docs`** cuando el backend
está corriendo. Es la fuente de verdad del contrato de endpoints: recoge todos los
DTOs con sus validaciones, los tipos de respuesta y los endpoints protegidos por
`@ApiBearerAuth`. Para el detalle de la arquitectura prevista y la hoja de ruta del
MVP, ver la carpeta `docs/` (`.docx` + `.md`).

---

## 5. Cómo arrancar el proyecto

```bash
# Infraestructura (Postgres, Redis, Meilisearch, MinIO)
docker compose up -d
# El contenedor "createbuckets" crea el bucket "marketplace" con lectura pública
# y termina solo — es normal que aparezca como "Exited" en docker compose ps.

# Backend
pnpm --filter @marketplace/api dev      # http://localhost:3001/api

# Frontend
pnpm --filter @marketplace/web dev      # http://localhost:3000

# Reconstruir el índice de búsqueda (primera vez o tras reset de Meilisearch)
pnpm --filter @marketplace/api reindex

# Rellenar coordenadas en anuncios sin geocodificar (ejecutar una sola vez o tras importar datos)
# Aviso: usa Nominatim por defecto → tarda ~1 s por anuncio. Cambiar a maptiler para lotes grandes.
pnpm --filter @marketplace/api geocode-backfill
```

Variables de entorno necesarias: `apps/api/.env` y `apps/web/.env.local`.
Ver los respectivos `.env.example` como plantilla.

Variables de entorno nuevas (`apps/api/.env`) respecto a fases anteriores:

| Variable | Valor por defecto | Descripción |
|---|---|---|
| `GEOCODING_PROVIDER` | `nominatim` | Proveedor de geocoding. `nominatim` (sin key) o `maptiler` |
| `MAPTILER_API_KEY` | — | Solo necesario si `GEOCODING_PROVIDER=maptiler` |
