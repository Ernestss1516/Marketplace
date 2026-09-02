# Auditoría — el despliegue

> **Documento de diagnóstico y decisión. Cero código, cero arreglos.**
> Verificado contra `main` en `6e327c0` el **2026-09-02**. Todo lo que sigue está medido
> (`grep`, lectura del fichero, `git check-ignore`) o se dice que no lo está.
> Base: [`pendientes.md`](./pendientes.md) `6e327c0`, los ocho prerrequisitos ⛔.

---

## 0. El veredicto, primero

**El proyecto no está lejos de desplegarse; está lejos de saber DÓNDE.** Esa es la asimetría
que ordena todo este documento.

| Dimensión | Estado |
|---|---|
| **Aplicación** | Construida y probada. 163 suites, ~2 476 tests, CI verde |
| **Empaquetado** | **No existe.** Cero `Dockerfile`, cero manifiestos, cero workflow de despliegue |
| **Configuración de producción** | **Existe la lista, no la disciplina.** Joi valida el entorno… y en producción **no exige nada** (§3.2) |
| **Operabilidad** | **Sin `/health`, sin `GIT_SHA`, sin `output: standalone`, sin runbook** (§3) |
| **Decisiones de infraestructura** | **Ninguna tomada.** Ni plataforma, ni gestionado-vs-propio, ni topología de procesos (§4) |
| **Multi-instancia** | **El código ya lo prepara y lo dice por escrito** (§6). El modelo, sin decidir |

**Los ocho prerrequisitos de `pendientes.md` son correctos y siguen abiertos.** Esta auditoría
los desarrolla (§2) y **añade nueve más** que sólo aparecen cuando se mira el despliegue como
sistema (§3) — de los cuales **cuatro son bloqueadores duros** que no estaban en ninguna lista.

**La corrección más importante a lo que ya estaba escrito.** `pendientes.md` §1 paso 4 dice:

> *«`apps/api` valida el entorno con Joi al arrancar, así que un despliegue con variables
> incompletas falla en el arranque (deseable).»*

**Eso no es cierto en producción.** Es cierto en `test`, donde hay cuatro reglas condicionales
muy rigurosas. En producción, `APP_URL`, `RESEND_FROM`, `STRIPE_SECRET_KEY` y
`MAPTILER_API_KEY` son todas `optional()`. Un despliegue **arranca perfectamente** con los pagos
apagados, los correos saliendo de un placeholder y el WebSocket rechazando al frontend real. Ver
§3.2 — es el hallazgo más rentable de esta auditoría, porque el mecanismo para arreglarlo ya
existe en el propio fichero y sólo hay que aplicarlo al otro entorno.

---

## 1. Método — qué se verificó y cómo

**Regla:** ninguna afirmación de este documento sale de la memoria de la sesión. Cada una tiene
su comprobación.

| Qué | Cómo se comprobó | Resultado |
|---|---|---|
| Empaquetado | `find . -iname "Dockerfile*"`, `ls fly.toml vercel.json render.yaml`, `ls .github/workflows/` | Cero, cero, sólo `ci.yml` |
| CORS HTTP | Lectura de `main.ts` y `test/helpers/create-app.ts` | `enableCors()` sin argumentos en **los dos** |
| Rate limit | `grep -rn "throttler\|rateLimit"` en `apps/api/src` + `package.json` | **No hay `@nestjs/throttler`.** Hay un `RateLimitService` propio sobre Redis, usado en 5 módulos |
| Colas y crones | `grep -rn "@Processor(\|@Cron(\|registerQueue"` | **13 procesadores, 10 crones, 12 colas** — todos in-process con la API |
| Multi-instancia | `grep -c "tenantId\|siteId\|organizationId"` en `schema.prisma`; lectura de `Setting`, `branding.service.ts`, `instance-info.types.ts` | **0 discriminadores.** Single-tenant confirmado. Y **el código nombra el modelo previsto por escrito** |
| Entorno | Lectura completa de `env.validation.ts`, `configuration.ts`, `app-origin.ts`, los dos `.env.example` | Ver §3.2 y §5 |
| Secretos en repo | `git ls-files \| grep env`, `git check-ignore` | Ver §5.1 — **dos hallazgos** |
| Prefijos `tmp/` | `grep pendingPrefix`, lectura de `media-keys.ts:107-133` | Cuatro, y la forma exacta de la regla |
| Empaquetado del front | Lectura de `next.config.ts`, `image-domains.ts` | **Sin `output: 'standalone'`**; `remotePatterns` no cubre el R2 real |
| Comandos de admin | Lectura de `apps/api/package.json` | **Todos por `ts-node`** — restricción real para la imagen |

---

## 2. Los ocho prerrequisitos, desarrollados

**Leyenda de bloqueo.**
**DURO** = sin él no se puede desplegar, o el despliegue queda roto/inseguro desde el minuto 1.
**BLANDO** = se puede desplegar y arreglarlo después, con el riesgo acotado y conocido.

### P1 · `app.enableCors()` sin argumentos — `[SEGURIDAD]` · **DURO**

**Qué es.** [`main.ts:40`](../apps/api/src/main.ts#L40) llama a `enableCors()` sin argumentos:
`Access-Control-Allow-Origin` para cualquier origen. Verificado también en
[`test/helpers/create-app.ts:37`](../apps/api/test/helpers/create-app.ts#L37) — los tests
replican el bootstrap, y ése es el detalle que da trabajo al arreglo: cerrarlo sólo en `main.ts`
haría que los tests dejaran de probar lo que corre en producción.

**Qué lo bloquea.** Nada técnico. Lo que faltaba era **saber la lista de orígenes**, y esa lista
depende de una decisión que tampoco está tomada: cuántos dominios hay (§6).

**El arreglo, y su forma.** La mitad del problema ya está resuelta y da el molde: R9 cerró el
gateway WebSocket con `cors: { origin: [appOrigin()] }` — **array de un elemento, no cadena**,
porque el paquete `cors` no compara cadenas
([`messaging.gateway.ts:55`](../apps/api/src/modules/messaging/messaging.gateway.ts#L55)). La
versión HTTP es la misma idea con una lista:

- **Una instancia:** `[APP_URL]`.
- **Varias instancias (§6):** cada despliegue tiene su propio `APP_URL`, así que **sigue siendo
  una lista de uno** — no hace falta una variable nueva. Esto es un argumento a favor del modelo
  «N despliegues» y en contra del multi-tenant, donde sí haría falta una lista variable.
- **Con dominio de staging o preview:** ahí sí conviene una `CORS_ORIGINS` separada por comas,
  con `APP_URL` como valor por defecto.

**Honestidad sobre el alcance, con el mismo criterio que se aplicó al gateway:** el control de
acceso es el JWT, no el CORS, y el CORS no protege frente a un cliente que no sea un navegador.
Cerrarlo es **higiene**: quitar el comodín del inventario.

**Por qué es DURO igualmente:** el comodín sólo importa cuando existen orígenes que no controlas,
y eso empieza el día del despliegue. Además, `enableCors()` sin argumentos también responde a
`OPTIONS` con `Access-Control-Allow-Origin: *` para rutas autenticadas: no es un agujero, pero es
exactamente el tipo de línea que una revisión de seguridad externa marca en rojo y bloquea.

---

### P2 · Rate limit por IP sin verificar contra el proxy real — `[SEGURIDAD]` · **DURO (verificación), BLANDO (código)**

**Corrección de una suposición del encargo, verificada.** El encargo preguntaba *«¿existe algún
throttle? ¿por IP? ¿hay `@nestjs/throttler` o nada?»*. La respuesta medida:

- **No hay `@nestjs/throttler`** (`grep` en `apps/api/package.json`: sin resultados).
- **Sí hay rate limit**, propio, sobre Redis: `RateLimitService`
  ([`infra/redis/rate-limit.service.ts`](../apps/api/src/infra/redis/rate-limit.service.ts)),
  con `checkAndIncrement`.
- **Está usado en cinco módulos**, no sólo en contacto: `auth` (7 puntos: registro, login,
  recuperación, reenvío…), `contact` (por IP **y** global), `listings` (2 puntos), `tickets`,
  y su envoltorio `ContactRateLimitService`.

O sea: **no es «un endpoint público sin rate limit»**. Es un rate limit real y bastante extendido
cuya **entrada de datos** (la IP) no se ha verificado nunca contra un proxy de verdad.

**El defecto exacto.** [`main.ts:29-30`](../apps/api/src/main.ts#L29) hace
`app.set('trust proxy', TRUST_PROXY_HOPS)` con default `1`. Eso descansa en dos supuestos, ninguno
medido:

1. Que **haya exactamente un salto** de proxy delante de la API en la topología real.
2. Que ese proxy **sobrescriba** `X-Forwarded-For` en vez de reenviar lo que el cliente mande.

Si el proxy reenvía la cabecera del cliente, un atacante rota su IP declarada y **evade todos los
límites por IP de los cinco módulos**, no sólo el de contacto.

**Por qué el número no se puede adivinar.** `TRUST_PROXY_HOPS` es una consecuencia directa de la
decisión de §4: Cloudflare delante de un PaaS que ya tiene su propio router son **dos** saltos;
un VPS con nginx es **uno**; una plataforma sin CDN puede ser **uno** o **cero**. Elegir mal por
exceso reabre la falsificación; por defecto, limita a todo el mundo con la misma IP (la del
proxy) y tumba el servicio.

**Red de seguridad mientras tanto:** el límite **global** del formulario de contacto (200/h) no
depende de la IP y sigue protegiendo aunque el de IP resulte falsificable
([`contact.constants.ts:3`](../apps/api/src/modules/contact/contact.constants.ts#L3) lo dice
así). Es el motivo por el que esto no es crítico *hoy*.

**Clasificación doble, y es deliberada.** El **código** no hay que tocarlo (BLANDO: puede quedar
como está). La **verificación** es DURA: es un `curl` con una `X-Forwarded-For` falsificada contra
el entorno real, comprobando qué IP registra el log. Cinco minutos, y no se puede hacer antes de
que exista el entorno.

---

### P3 · El `reindex` no cierra sus conexiones — `[DEUDA]` · **DURO**

**El diagnóstico está cerrado** (`pendientes.md` §4.2) y se reverifica aquí en su detalle
operativo.

[`commands/reindex.ts:105-107`](../apps/api/src/commands/reindex.ts#L105) cierra **una**
conexión: la de `RedisService`. Pero `ReindexModule` importa `SearchModule` → que importa
`ReviewsModule` → que hace
[`BullModule.registerQueue(retryQueue(QUEUE_NOTIFICATIONS))`](../apps/api/src/modules/reviews/reviews.module.ts#L14).
Esa `Queue` abre **su propia** conexión ioredis, que `client.quit()` no toca. El script nunca
llama a `app.close()` —deliberadamente, por el crash de libuv con Prisma en Windows que el propio
fichero documenta— así que `OnApplicationShutdown` tampoco se dispara. El event loop no drena y
**el proceso queda vivo indefinidamente**.

Entró con `bcf4064` (notificaciones N4a), el commit que metió la cola en `ReviewsModule`.

**Por qué es DURO, y no «una molestia de desarrollo».** El paso 6 del propio plan de despliegue
es *«tras el primer despliegue, correr `reindex`»*. Un comando de administración que no muere:

- En un **job de despliegue de CI**: el step no termina → el despliegue se queda colgado hasta el
  timeout, y el pipeline queda en rojo aunque el reindexado haya funcionado.
- En un **contenedor efímero** (`docker run`, un job de Kubernetes, `fly ssh console -C`): el
  contenedor no sale, y la plataforma lo cuenta como fallo o lo cobra indefinidamente.
- En un **cron de plataforma**: se acumulan ejecuciones solapadas, cada una con su conexión
  Redis viva. Es el mismo cuadro que en local (`Get-Process node`, sockets muertos, CPU al
  100 %) pero facturado por horas.

**El arreglo, dos caminos.** El corto: obtener también las colas del contexto y cerrarlas
(`queue.close()`) antes del `$disconnect()`. El limpio: que `ReindexModule` **no arrastre**
`ReviewsModule` —el script sólo usa `SearchService`, y `ReviewsModule` entra porque
`createApplicationContext` instancia igualmente el `SearchController` que declara `SearchModule`—.
El segundo es más trabajo y no vuelve a romperse la próxima vez que alguien añada una cola a un
módulo transitivo.

> **Nota de método, que es la lección reutilizable:** el comentario del fichero que justifica el
> `quit()` **era correcto cuando se escribió**. Dejó de serlo por un cambio en un módulo a tres
> saltos de distancia. Un cierre de conexiones enumerado a mano tiene exactamente el mismo modo de
> fallo que la lista de prefijos `tmp/` (P7): **lo pone el código y lo mantiene una persona.**

---

### P4 · El ZIP de exportación se arma en memoria — `[DEUDA]` · **BLANDO (con condición)**

[`data-export.zip.ts:67-68`](../apps/api/src/modules/data-export/data-export.zip.ts#L67)
construye el ZIP entero con `jszip` y lo materializa como un `Buffer`
(`generateAsync({ type: 'nodebuffer' })`) antes de subirlo. Las fotos se bajan de R2 una a una y
se van metiendo dentro. **La memoria pico es aproximadamente el tamaño total del ZIP.**

**El riesgo real en producción, dicho con números que sí se conocen.** El propio proyecto tiene
las cifras: `MAX_FILE_SIZE` de foto es **10 MB** y un vídeo Pro llega a **50 MB**. No hay tope
de anuncios por vendedor Pro más allá de la cuota configurable. Un vendedor con 200 anuncios × 3
fotos de 5 MB son **~3 GB** en un `Buffer` — muy por encima de cualquier contenedor de 512 MB o
1 GB, que es lo que da por defecto un PaaS. **El modo de fallo no es «va lento»: es que el worker
muere con OOM**, y con él **todas las demás colas que comparten proceso** (§4.3).

**Por qué es BLANDO y no DURO.** La probabilidad hoy es cero: no hay vendedores con catálogos de
ese tamaño, y no los habrá el primer día. Y el arreglo tiene coste real: streamear a R2 obliga a
rehacer las barreras que abren el `Buffer` para verificar el contenido
([`borrado-cuentas-c6-exportacion.e2e-spec.ts:319`](../apps/api/test/borrado-cuentas-c6-exportacion.e2e-spec.ts#L319)
y `…-c6-puertas.e2e-spec.ts:115`) — y esas barreras son las que prueban que la exportación
contiene lo que promete.

**La condición que lo convierte en DURO.** Es BLANDO **sólo si se hace las dos cosas**:

1. **Dimensionar el worker sabiendo esto**, y anotar el número. Con la topología de §4.3 sin
   separar, un OOM aquí se lleva la API por delante.
2. **Poner un tope duro y explícito** antes del primer despliegue — un límite de tamaño estimado
   por encima del cual la exportación se rechaza con un mensaje honesto («tu catálogo excede lo
   que podemos exportar de una vez; escríbenos»). Es mucho más barato que streamear y convierte
   un OOM en un texto.

Sin (2), esto es una bomba de relojería con temporizador desconocido, y entonces sí es DURO.

---

### P5 · Los tests de Stripe pasan con clave inválida — `[COBERTURA]` · **DURO (verificación)**

**Qué se verificó.**
[`stripe-subscription-renewal-e2e.e2e-spec.ts`](../apps/api/test/stripe-subscription-renewal-e2e.e2e-spec.ts)
**nunca llama a la API de Stripe.** Firma los webhooks en local con
`stripe.webhooks.generateTestHeaderString({ payload, secret })` —firma **real**, no un mock, el
mismo molde que se usó con Redsys— y los verifica el backend con el mismo `STRIPE_WEBHOOK_SECRET`.
El CI lo dice sin rodeos ([`ci.yml:158-171`](../.github/workflows/ci.yml#L158)) y usa
`STRIPE_SECRET_KEY: sk_test_ci_dummy_not_a_real_key`. La clave sólo hace falta para que
`new Stripe(...)` no lance en el `beforeAll`.

**La decisión que el encargo pide («¿el CI debe llamar a Stripe real o mockear?»): mockear, y no
es una concesión.** Tres razones, en orden de peso:

1. **Un test que llama a un tercero no es determinista.** Introduce la red de Stripe en el
   veredicto de cada PR. Ese es exactamente el tipo de rojo fantasma que la auditoría de deuda de
   test/CI (`6af69b3`, `459fcc0`, `195e012`) se dedicó a erradicar — y la de Google Fonts, la
   única que sigue viva, enseñó lo caro que sale.
2. **Lo que el test prueba es lo correcto.** La lógica de negocio de la renovación es *nuestra*;
   la firma HMAC es *real*. Lo único que no se ejercita es la red de Stripe, que no es código de
   este proyecto.
3. **Las credenciales de producción no pueden vivir en el CI.** Meterlas para «probar de verdad»
   sería exactamente la lección de §5 al revés.

**Entonces, ¿qué es el prerrequisito?** No cambiar el test. Es **hacer una vez, a mano, lo que
ningún test va a hacer nunca**: una comprobación de humo contra Stripe con las credenciales de la
cuenta real en modo test —crear una Checkout Session, recibir un webhook real en el endpoint
público— y **anotar el resultado**. Es DURO porque es el tipo de fallo que aparece la primera vez
que alguien paga y no antes.

**Lo que esa comprobación tiene que cubrir, y sale del código:**

| Qué verificar | Por qué |
|---|---|
| Que los 5 `STRIPE_PRICE_*` de `.env.example` existen en la cuenta real | Son IDs del dashboard; en `.env.example` están como `price_...` |
| Que coinciden con `Price.gatewayPriceId` en base de datos | El propio `.env.example` lo advierte; hay un comando para ello: `pnpm sync-stripe-catalog` |
| Que el endpoint `POST /webhooks/stripe` es alcanzable desde internet y está registrado | El guard exige `rawBody`, que `main.ts` sí habilita |
| Que `STRIPE_WEBHOOK_SECRET` es el del endpoint de producción, no el de `stripe listen` | Son distintos, y el fallo es silencioso: firma inválida → 400 |

> **Y el contraste que lo justifica:** Redsys **sí** tuvo esa vuelta —verificado contra el sandbox
> real con túnel `cloudflared`—. Stripe es el único canal de dinero que se quedó sin ella.

---

### P6 · El despliegue mismo — `[DEUDA]` · **DURO por definición**

Reverificado el 2026-09-02: cero `Dockerfile`, cero manifiestos, `.github/workflows/` sólo con
`ci.yml`. `docker-compose.yml` levanta **infraestructura local** (`postgres`, `redis`,
`meilisearch`, `minio`, `createbuckets`) y no incluye ni la API ni el frontend.

Todo el contenido de este prerrequisito está en §4 (infraestructura), §7 (orden) y §8 (plan). Aquí
sólo lo que la contenerización **ya sabe** que va a encontrarse, verificado:

| Restricción verificada | Dónde | Consecuencia para el `Dockerfile` |
|---|---|---|
| **Monorepo pnpm**, `packageManager: pnpm@11.8.0` | `package.json` raíz | El contexto de build necesita el lockfile de la raíz, no sólo el del paquete |
| **Node 22** | `ci.yml:25,225` | Imagen base `node:22` |
| **PostGIS obligatorio** | `schema.prisma:16` (`extensions = [postgis]`), `docker-compose` usa `postgis/postgis:16-3.5` | **No vale un Postgres pelado.** Condiciona §4.2 |
| **Cliente Prisma generado en runtime** | `prisma generate` | Paso de build, no de arranque |
| **Todos los comandos de admin van por `ts-node`** | `apps/api/package.json`: `reindex`, `geocode-backfill`, los 3 backfills, `sync-stripe-catalog`, y **`prisma.seed`** | ⚠ **Una imagen construida sin devDependencies no puede sembrar ni reindexar.** O la imagen los conserva (más peso), o se compilan a JS, o hay una imagen de tareas aparte. **Decisión, no detalle** |
| **`apps/web` NO usa `output: 'standalone'`** | `next.config.ts` — verificado, la clave no está | El plan da por hecho el `standalone`. Hoy la imagen del front tendría que llevar `node_modules` entero. Ver §3.3 |
| **Sentry envuelve el build de Next** | `withSentryConfig(..., { silent: true })` | Ya está; no sube source maps (sin auth token) |

---

### P7 · Las cuatro reglas de ciclo de vida `tmp/` — `[DEUDA]` · **BLANDO (pero barato)**

**La lista exacta, reverificada** (`grep pendingPrefix` en `apps/api/src`, 2026-09-02):

| # | Prefijo de la regla | Raíz declarada en | Qué confina |
|---|---|---|---|
| 1 | `listing-videos/tmp/` | `video-limits.ts:50` (`VIDEO_KEY_PREFIX`) | Vídeo Pro subido y no confirmado (hasta 50 MB) |
| 2 | `listing-previews/tmp/` | `video-limits.ts:71` (`PREVIEW_KEY_PREFIX`) | Sprite del póster animado sin confirmar |
| 3 | `avatars/tmp/` | `media.service.ts:11` (`AVATAR_KEY_PREFIX`) | Avatar subido y perfil nunca guardado |
| 4 | `blocks-videos/tmp/` | `block-media-limits.ts:88` (`BLOCK_MEDIA_KEY_PREFIX`) | Media de bloque sin guardar el post/portada |

**Regla:** caducar a **1 día** todo objeto bajo cada prefijo. Un día es el **suelo** (la
expiración se expresa en días enteros) y sobra: la URL prefirmada dura 10 minutos
(`VIDEO_UPLOAD_URL_TTL_SECONDS`).

**Por qué el prefijo tiene esa forma exacta, y hay que respetarla al escribir la regla.**
[`media-keys.ts:107-118`](../apps/api/src/infra/r2/media-keys.ts#L107) lo explica: los filtros de
una regla de ciclo de vida son **prefijos literales, sin comodines**. Con la forma
`listing-videos/<listingId>/tmp/…` el `tmp` queda detrás de un id variable y haría falta *una
regla por anuncio*. Por eso el `tmp` va **arriba, justo debajo de la raíz**:
`pendingPrefix(raiz, dueño) = "<raiz>/tmp/<dueño>/"`. Basta **una regla por raíz**.

**Es seguro por construcción.** Bajo `tmp/` no vive nada en uso: lo que se adopta se **copia**
fuera con `R2Service.copy` antes de persistirse. Está probado en CI —lo que se persiste no lleva
`tmp/`, barreras en `huerfanas-h2.e2e-spec.ts` contra MinIO con `r2.head`—. Vaciar los cuatro
prefijos a mano es seguro.

**Por qué es BLANDO.** Sin la regla no se rompe nada: la basura se acumula **confinada** a cuatro
prefijos donde nada vivo puede estar. Cuesta almacenamiento, no corrección. Y en R2 se configura
en cuatro clics del panel de Cloudflare — es de lo más barato de esta lista.

**El riesgo real no es olvidar aplicarlas: es que aparezca un quinto prefijo.** Ya pasó dos
veces: `listing-previews/tmp/` lo creó el póster animado P1 y nunca llegó a la lista;
`blocks-videos/tmp/` lo añadió el vídeo de bloque V1. **El prefijo lo pone el código y la regla la
pone una persona.** Reverificado el 2026-09-02: siguen siendo cuatro (los tres logos,
`branding/`, **no** usan `pendingPrefix` — suben directo, sin paso temporal). **Recomendación
concreta:** una barrera de test que enumere las llamadas a `pendingPrefix` en `src/` y falle si
aparece una raíz que no esté en esta lista — el mismo molde que ya usa
`queue-retry.e2e-spec.ts` para vigilar `registerQueue`. Convierte «acordarse» en «no se puede
olvidar».

---

### P8 · Preparación de producción — `[DEUDA]` · **MIXTO**

| Ítem | Estado verificado | Qué hay que hacer | Bloqueo |
|---|---|---|---|
| **Geocoder MapTiler** | El código soporta ambos proveedores; `GEOCODING_PROVIDER` tiene default `nominatim` | Poner `GEOCODING_PROVIDER=maptiler` + `MAPTILER_API_KEY`. **Ojo:** `NEXT_PUBLIC_MAPTILER_KEY` (frontend, tiles) y `MAPTILER_API_KEY` (backend, geocoding) son **claves distintas**; la del frontend viaja al navegador y hay que **restringirla por dominio** en el panel de MapTiler | **DURO.** Nominatim son 1 req/s y su política de uso prohíbe el uso comercial sistemático: publicar anuncios en producción contra Nominatim es a la vez lento y contrario a los términos |
| **Dominio remitente de Resend** | `RESEND_FROM` es `optional()` y su valor de ejemplo es `noreply@tudominio.es` — **un placeholder con pinta de dominio real**. El panel de instancia ya tiene un `esPlaceholder` para avisarlo | Verificar el dominio en Resend (DNS: SPF/DKIM) y fijar `RESEND_FROM` | **DURO.** Sin dominio verificado, Resend rechaza o los correos van a spam. Y el fallo es silencioso |
| **Sentry** | Implementado y silencioso con DSN vacío (`Sentry.init` en `main.ts:11`, `withSentryConfig` en `next.config.ts`, `instrumentation-client.ts`, `global-error.tsx`, 6 processors) | Poner `SENTRY_DSN` (API), `SENTRY_DSN` y `NEXT_PUBLIC_SENTRY_DSN` (web) y confirmar que llega un evento real | **BLANDO** para arrancar; **DURO** para operar a ciegas. Sin él, el primer fallo de producción no deja rastro |
| **Stripe real** | Ver P5 | Humo manual con credenciales reales | **DURO** |
| **Swap atómico del `reindex`** | `reindex` hace `clearAll()` + repoblar → **ventana de índice vacío** | Sólo si el volumen lo justifica: indexar en índice nuevo y hacer swap | **BLANDO.** El primer día el índice ya está vacío. Antes de esto, P3 |

**Nota sobre el `reindex` que conviene no perder:** `reindexAll` usa `addDocuments` **sin
`waitForTask`** ([`search.service.ts:585`](../apps/api/src/modules/search/search.service.ts#L585)),
así que el comando puede decir «reindex complete» con documentos todavía en la cola de Meili. En
un despliegue encadenado (reindex → smoke test) eso produce un falso negativo. Es uno de los dos
hermanos anotados en `pendientes.md` §4.2.

---

## 3. Los nueve hallazgos que esta auditoría añade

Ninguno estaba en `pendientes.md`. Aparecen sólo al mirar el despliegue como sistema.

### 3.1 · No hay endpoint de salud — **DURO** · NUEVO

`grep -rn "health\|healthz\|readiness"` en `apps/api/src`: **cero resultados**. No hay
`@nestjs/terminus` en `package.json`.

**Por qué es duro.** Toda plataforma de despliegue —PaaS, contenedores, un balanceador delante de
un VPS— necesita una ruta que conteste rápido para decidir si el proceso está vivo y listo. Sin
ella:

- La plataforma marca el servicio como caído (si el healthcheck por defecto pega a `/`, que aquí
  devuelve 404 porque hay `setGlobalPrefix('api')`), o lo marca como sano **siempre** (si sólo
  comprueba que el puerto acepta TCP).
- El segundo caso es el peligroso: un despliegue con la base de datos mal configurada **pasa el
  healthcheck y recibe tráfico**, y cada petición falla.
- El despliegue sin corte (rolling / blue-green) no puede saber cuándo la instancia nueva está
  lista para recibir tráfico. Sin eso, cada despliegue es un corte.

**Alcance.** Es pequeño: un `GET /api/health` que devuelva 200, y —mejor— un `/api/ready` que
toque Postgres, Redis y Meilisearch. La distinción importa: *liveness* («¿reinicio el proceso?»)
no debe depender de terceros, o una caída de Meili provoca un bucle de reinicios.

### 3.2 · Joi no exige nada en producción — **DURO** · NUEVO · *corrige a `pendientes.md`*

Lectura completa de [`env.validation.ts`](../apps/api/src/config/env.validation.ts). El fichero
usa `Joi.when('NODE_ENV', { is: 'test', … })` **cuatro veces**, con reglas muy exigentes:
`DATABASE_URL` debe contener `_test`, `REDIS_URL` debe apuntar a una db distinta de 0,
`MEILI_INDEX_NAME` debe contener `_test`, `REDSYS_SECRET_KEY` no puede estar vacía. Cada una con
su mensaje de error explicando el incidente que la motivó.

**Ese mismo rigor no existe para `production`.** Lo verificado:

| Variable | Regla actual | Qué pasa en producción sin ella |
|---|---|---|
| `APP_URL` | `optional()` | `appOrigin()` cae a `DEFAULT_APP_ORIGIN = 'http://localhost:3000'` ([`app-origin.ts:19`](../apps/api/src/config/app-origin.ts#L19)). **El CORS del WebSocket sólo admite `localhost`**, así que el frontend real no conecta — y **todos los enlaces de todos los correos apuntan a localhost**. Arranca sin un solo error |
| `RESEND_FROM` | `optional()` | Se manda desde `noreply@tudominio.es`, un placeholder con pinta de dominio real |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | `allow('').optional()` — «required in production» **sólo en el comentario** | Producción arranca **con los pagos rotos** y nadie se entera hasta que alguien intenta pagar |
| `MAPTILER_API_KEY` | `optional()`, **sin condicional sobre `GEOCODING_PROVIDER`** | Se puede poner `GEOCODING_PROVIDER=maptiler` **sin clave**. El geocoding falla en tiempo de ejecución, no de arranque |
| `GOOGLE_CLIENT_ID` | `allow('').optional()` — «requerido en producción» en el comentario | El login con Google no funciona; el botón sigue ahí |
| `REVALIDATE_SECRET` | `optional()` | La revalidación on-demand es *fire-and-forget*: falla **en silencio**. El blog tarda hasta 1 h en reflejar cambios |
| `MEILI_INDEX_NAME` | `optional()` fuera de test | Índice por defecto — relevante si dos instancias compartieran Meilisearch (§6) |

**Por qué esto es el hallazgo más rentable de la auditoría.** El mecanismo ya existe, está
probado, y sus mensajes de error son ejemplares. Aplicar `Joi.when('NODE_ENV', { is: 'production',
then: …required() })` a esas siete es **una tarde de trabajo** y convierte siete fallos
silenciosos en un arranque que se niega a empezar y dice por qué. Es exactamente la disciplina que
el proyecto ya se aplicó a sí mismo en `test` — sólo que en el entorno donde importa menos.

### 3.3 · `apps/web` sin `output: 'standalone'` — **BLANDO** · NUEVO

`next.config.ts` sólo define `transpilePackages` e `images`. El plan de `pendientes.md` §1 paso 1
da por hecho el modo `standalone`; hoy **no está**. Sin él, la imagen del frontend tiene que
llevar `node_modules` completo (cientos de MB frente a decenas). No impide desplegar; encarece
cada build y cada arranque en frío. Es una línea.

### 3.4 · `remotePatterns` no cubre el R2 real — **DURO** · NUEVO

[`image-domains.ts`](../apps/web/src/lib/image-domains.ts) declara tres patrones:
`http://localhost`, `http://127.0.0.1` y `https://*.r2.cloudflarestorage.com`.

**El tercero es el endpoint de la API S3 de R2, que no es por donde se sirven las imágenes
públicas.** Un bucket público de R2 se sirve desde `pub-<hash>.r2.dev` o —lo recomendable— desde
un **dominio propio**. Ninguno de los dos casa con `*.r2.cloudflarestorage.com`.

**Consecuencia:** `next/image` rechaza el dominio y **todas las imágenes del sitio fallan**, con
la red funcionando perfectamente. Es el mismo modo de fallo que el episodio de IPv6 dejó
documentado en `CLAUDE.md` («sin esta entrada `next/image` rechazaría el dominio»), sólo que en
producción y con el dominio definitivo.

**Y se agrava con lo que ya sabemos de `S3_PUBLIC_URL`:** la URL pública **se guarda entera en la
base de datos** al subir (`ListingImage.url`, `Listing.video*Url`, `SponsoredAd.imageUrl`,
`HomepageConfig.blocks`). Cambiar el dominio después **no reescribe lo ya guardado**. Por eso esto
es DURO y va **antes** de la primera subida de producción, no después.

*(Los dos patrones de `localhost`/`127.0.0.1` no son un agujero — `next/image` sólo hace fetch de
servidor — pero son entradas muertas en producción y conviene que sean condicionales.)*

### 3.5 · Swagger montado sin condición — **BLANDO** · NUEVO

[`main.ts:43-56`](../apps/api/src/main.ts#L43) monta `/api/docs` **siempre**, sin mirar
`NODE_ENV`. En producción eso publica el inventario completo de rutas, DTOs y esquemas, con
`persistAuthorization` activado.

No es una vulnerabilidad —los endpoints están protegidos por guards— pero es **reconocimiento
gratis** para quien busque superficie, y una decisión que conviene tomar a propósito y no por
omisión. Dos opciones legítimas: apagarlo con `NODE_ENV === 'production'`, o dejarlo detrás de
autenticación básica. Cualquiera de las dos, escrita.

### 3.6 · No hay `GIT_SHA` — **BLANDO** · NUEVO

Lo dice el propio código, y es un buen ejemplo de documentación honesta:
[`instance-info.types.ts`](../apps/api/src/modules/admin/instance-info.types.ts) enumera tres
datos que el panel **no inventa** porque no existen, y uno es *«el commit desplegado (no hay
inyección de `GIT_SHA` todavía)»*.

**En producción eso significa que no se puede contestar «¿qué versión está corriendo?».** Con
varias instancias (§6) y despliegues independientes, la pregunta pasa de incómoda a diaria. Es un
`ARG`/`ENV` en el `Dockerfile` y un campo más en el panel, que **ya tiene el hueco pensado**.

### 3.7 · `.gitignore` no cubre `.env.production` ni `.env.dev` — **DURO** · NUEVO

Verificado con `git check-ignore`:

```
apps/api/.env.production -> NOT ignored
apps/api/.env.dev        -> NOT ignored
.env.production          -> NOT ignored
```

El `.gitignore` lista `.env`, `.env*.local`, `.env.test` y `*.bak` — una **enumeración**, no una
clase. Cualquier fichero de entorno con otro nombre entra al repo sin resistencia. Ver §5.1: es
la misma lección del episodio reciente, sin aplicar del todo.

### 3.8 · `.env.example` contiene claves con pinta de reales — **DURO** · NUEVO

`apps/api/.env.example` **está versionado** (`git ls-files`) y contiene, en texto plano:

- `STRIPE_SECRET_KEY=sk_test_51TmI1QAJ7uKTfFtb…` (una clave `sk_test_` completa, con estructura
  válida)
- `STRIPE_WEBHOOK_SECRET=whsec_e86dd41642bc…` (un secreto de webhook completo)

**Todas las demás variables del fichero usan placeholders** (`re_your_api_key_here`,
`change_me_in_production…`, `price_...`). Estas dos no. Sean o no de una cuenta activa,
**están en el historial de Git** y hay que tratarlas como comprometidas: rotarlas y sustituirlas
por placeholders. Es exactamente la clase de fuga que la sesión del entorno se dedicó a cerrar
(`4929c21`, `d29a639`) — cerrada en `.env.test` y `.env.dev.bak`, **abierta en `.env.example`**.

> Son claves de **modo test**, así que el daño potencial es acotado (no mueven dinero real). Eso
> lo hace menos urgente, **no menos obligatorio**: una `sk_test_` da acceso de lectura al catálogo
> y a los objetos de prueba de la cuenta, y la disciplina —«ningún secreto en el repo, sin
> excepciones por tamaño»— es precisamente lo que se erosiona con las excepciones pequeñas.

### 3.9 · La topología de procesos no está decidida y tiene una arista afilada — **DURO** · NUEVO

Ver §4.3, que lo desarrolla. Resumen: **13 procesadores, 10 crones y 12 colas viven en el mismo
proceso que la API HTTP**, y ese hecho decide por adelantado qué escalados son seguros.

---

## 4. La infraestructura — las opciones, con sus contrapartidas

> **Aquí no se decide nada.** Se plantean las opciones con el trade-off medido contra *este*
> stack, y se señala qué información falta para poder elegir. La decisión es de Ernest.

### 4.1 · Lo que hay que alojar, medido

| Pieza | Qué es | Perfil de recursos | Notas verificadas |
|---|---|---|---|
| `apps/web` | Next.js App Router, SSR/ISR | CPU en ráfagas, poca RAM | Sin `standalone` (§3.3). SEO crítico ⇒ SSR de verdad, no estático |
| `apps/api` | NestJS + **13 procesadores + 10 crones** | RAM sostenida; picos por ZIP (P4) e imágenes (`sharp`) | Hoy es **un solo proceso** (§4.3) |
| **PostgreSQL** | Fuente de verdad | El componente con estado que más importa | **Con PostGIS 3.5** — no negociable (`schema.prisma:16`) |
| **Redis** | Caché + **12 colas BullMQ** + contadores de rate limit | Poca RAM, mucha latencia sensible | BullMQ exige `maxRetriesPerRequest: null` y conexiones persistentes ⇒ **descarta Redis serverless por HTTP** |
| **Meilisearch** | Búsqueda | Disco + RAM proporcional al índice | v1.10. Reconstruible desde Postgres ⇒ **no es dato crítico** |
| **Almacenamiento** | Imágenes, vídeos, PDFs, ZIPs | Crece sin techo | **Ya decidido: Cloudflare R2** vía `R2Service`. MinIO es sólo desarrollo |
| **Email** | Resend | — | **Ya decidido.** Falta verificar el dominio |

**Dos consecuencias que acotan el abanico antes de mirar plataformas:**

1. **PostGIS descarta varios «Postgres de un clic».** Un Postgres gestionado que no permita
   `CREATE EXTENSION postgis` no sirve, y el fallo aparece en la primera migración. Hay que
   **verificarlo en la plataforma concreta antes de elegirla**, no darlo por hecho.
2. **BullMQ descarta el Redis serverless de protocolo HTTP.** BullMQ usa comandos bloqueantes
   (`BRPOPLPUSH`) sobre una conexión TCP persistente. Hace falta Redis por TCP.

### 4.2 · Gestionado vs. autohospedado, pieza a pieza

**El criterio, y conviene decirlo antes que las opciones:** aquí opera **una persona**. Cada
servicio autohospedado es una copia de seguridad que hay que probar, una actualización de
seguridad que hay que aplicar y una alarma que hay que atender. El coste real de lo autohospedado
no es el servidor: es la atención.

| Pieza | Gestionado — a favor | Propio — a favor | Comentario específico de este proyecto |
|---|---|---|---|
| **Postgres** | Copias de seguridad y restauración probadas, actualizaciones, alta disponibilidad. Es **la única pieza cuya pérdida es irreversible** | Más barato a volumen; control total de extensiones | **Recomendable gestionado**, casi sin discusión. **Único requisito eliminatorio: PostGIS.** Verificar en la plataforma candidata |
| **Redis** | Cero operación | Trivial de levantar; muy barato | Su pérdida **no es catastrófica**: caché reconstruible y colas rehacibles. Pero **con matiz**: un job en vuelo se pierde. Requisito: **TCP, no HTTP** |
| **Meilisearch** | Meilisearch Cloud existe y es sencillo | Un contenedor y un volumen. **Reconstruible** con `pnpm reindex` | **La pieza donde lo propio duele menos**, precisamente porque el dato es derivado… **pero eso depende de P3**: hoy `reindex` no termina |
| **R2** | Ya elegido | — | Falta: bucket, dominio público (§3.4) y las **cuatro reglas de ciclo de vida** (P7) |
| **Resend** | Ya elegido | — | Falta: verificar dominio y `RESEND_FROM` |

### 4.3 · La topología de procesos — **la decisión más consecuente, y la menos evidente**

**Lo medido:** `grep -rn "@Processor(\|@Cron("` en `apps/api/src` →

- **13 procesadores**: `image`, `indexing`, `notifications`, `alert-matching`, `media-cleanup`
  (los cinco en `QueueModule`), más `account-cleanup`, `billing`, `bump-auto`, `data-export`,
  `invoicing`, `revalidation`, `message-digest` y `redsys` en sus módulos.
- **10 crones**: bump horario (`10 * * * *`), impresiones (`*/15`), caducidad (02:00), preaviso
  (02:30), entitlements (03:00), facturación (04:00), tickets (05:00), impresiones diarias
  (06:00), suspensiones (07:00), caducidad de exportaciones (08:00).
- **12 colas** declaradas en `queue.constants.ts`.

**Todo eso vive dentro del mismo `AppModule` que sirve HTTP.** Un proceso lo hace todo.

**Las tres opciones:**

| Modelo | A favor | En contra |
|---|---|---|
| **A — Un proceso** (lo que hay) | Cero trabajo. Un despliegue, una imagen, un log | Un OOM del ZIP (P4) o un pico de `sharp` **tumban la API**. No se puede escalar la API sin duplicar workers y crones. La latencia HTTP compite con el trabajo pesado |
| **B — API + worker, misma imagen, distinto arranque** | Aísla el trabajo pesado. Permite dimensionar distinto (worker con más RAM). **No exige reescribir nada**: es un `main` alternativo | Dos servicios que desplegar. Hay que decidir **dónde viven los crones** |
| **C — API + worker + scheduler** | Los 10 crones en **un solo proceso, uno solo** | Un servicio más. Sólo merece la pena si B resulta insuficiente |

**El hallazgo que hace esto interesante, y que corrige la alarma fácil.** Lo primero que uno teme
es *«si escalo la API a N réplicas, tengo N copias de cada cron»*. Verificado uno a uno, **el
código ya se defendió de eso, y a propósito**:

- **Bump automático** (cobra dinero): reclama cada turno con una clave única, y el comentario dice
  literalmente *«de eso depende que dos instancias que miran la misma fila obtengan el mismo valor
  y choquen en la clave única»*
  ([`bump-schedule.service.ts:114`](../apps/api/src/modules/bump-schedule/bump-schedule.service.ts#L114)).
  Cuenta los `alreadyClaimed` como éxito, no como error.
- **Facturación** (emite facturas): encola con `jobId` estable
  (`inv-emit-${periodKey}-${userId}`), así que BullMQ deduplica entre instancias, y además hay
  `Invoice.idempotencyKey @unique` y `transactionId @unique`.
- **Alert matching**: idempotente por `AlertMatch @@unique`, y el comentario lo dice.

O sea: **los dos crones que tocan dinero son seguros con varias réplicas.** Eso es notable y hay
que reconocerlo.

**Pero no todos se verificaron con ese cuidado, y hay que decirlo con precisión.** El preaviso de
caducidad (`warnExpiringListings`, 02:30) tiene una forma **leer-decidir-escribir sin transacción
ni bloqueo**: lee los anuncios con `expiryWarnedFor` distinto de `expiresAt`, envía el aviso, y
**después** marca. Dos instancias que arranquen el cron en el mismo minuto pueden leer las mismas
filas antes de que ninguna marque, y **mandar el aviso dos veces**. No es un fallo hoy —hay un
solo proceso— y no es dinero, es un correo duplicado. Pero **es exactamente la clase de defecto
que aparece el día que se escala y que nadie relaciona con el escalado.**

**Conclusión operativa, sin decidir la topología:** mientras la API corra en **una sola
réplica**, nada de esto importa. **El día que se escale a dos, hay que revisar los 10 crones con
el criterio del bump** (¿reclama? ¿es idempotente? ¿tiene `jobId` estable?), no confiar en que
todos se escribieran igual. Y la opción C —los crones en un proceso único— es la que hace
innecesaria esa revisión.

### 4.4 · Las familias de plataforma

| Familia | Qué encaja bien | Qué hay que comprobar antes | Perfil |
|---|---|---|---|
| **PaaS de contenedores** (Fly, Railway, Render y equivalentes) | Todo el stack en una cuenta; separar API/worker es declarar otro proceso (§4.3 opción B); Postgres y Redis gestionados al lado | **PostGIS** en su Postgres; **Redis por TCP**; que haya **volumen persistente** para Meilisearch; el número real de saltos de proxy (P2) | Menos operación, coste medio, techo de control |
| **VPS con Docker Compose** | Control total, coste plano y predecible, PostGIS y Meilisearch sin preguntar a nadie | **Todo** es tuyo: copias de seguridad **probadas**, TLS y renovación, actualizaciones, alarmas | Coste mínimo, operación máxima. **La copia de seguridad de Postgres es el punto de fallo real** |
| **Cloud grande** (AWS/GCP) | Todo existe y escala | Complejidad muy por encima de lo que este proyecto necesita hoy | Sólo justificable si ya hay experiencia |
| **Híbrido** — front en un host de Next, resto en PaaS/VPS | El front es lo más fácil de alojar bien (SSR/ISR, CDN, dominios) | Dos proveedores; **el CORS y `APP_URL` pasan a ser críticos**; `/_next/image` hace fetch de servidor contra R2 | Suele ser lo más barato de operar para el frontend |

**Lo que falta para poder elegir, y no está en el código:** presupuesto mensual aceptable, cuánta
operación quiere asumir Ernest, y **cuántas instancias se prevén** (§6) — porque el coste de un
VPS bien aprovechado se reparte entre N instancias, mientras que un PaaS por servicio se multiplica
por N.

---

## 5. Los secretos en producción

### 5.1 · El estado real, medido

**Lo que ya está bien** (y es reciente): `.env.test` dejó de versionarse (`4929c21`), `.env.dev.bak`
también (`d29a639`), `*.bak` está ignorado, y las claves que vivían en `.env.test` se movieron a
`ci.yml` como **valores ficticios de CI** con un comentario que explica por qué existen
(`081a8bf`, `aca6b21`). El panel de instancia se construye **campo a campo** y publica de cada
credencial sólo `configurado: true|false`, con un test que lo vigila sobre la respuesta real
(`test/instance-info.e2e-spec.ts`). Eso es disciplina de buena calidad.

**Los dos agujeros que quedan, verificados:**

| # | Hallazgo | Comprobación | Gravedad |
|---|---|---|---|
| 1 | **`.env.example` lleva una `sk_test_` y un `whsec_` completos** | Lectura de `apps/api/.env.example:54,56`; `git ls-files` confirma que está versionado | **Rotar y sustituir por placeholders.** Están en el historial |
| 2 | **`.gitignore` enumera nombres en vez de cubrir la clase** | `git check-ignore` → `.env.production`, `.env.dev` y `apps/api/.env.production` **NO ignorados** | Cambiar a `.env*` con `!.env*.example`. Una línea |

> **La lección, dicha una vez:** el episodio reciente se cerró **caso a caso** (`.env.test`,
> `.env.dev.bak`). Ninguno de los dos arreglos impide el siguiente fichero con otro nombre. **La
> clase se cierra con el patrón, no con la enumeración** — el mismo criterio que el proyecto ya
> aplica en `retryQueue()` y en `pendingPrefix()`.

### 5.2 · Qué necesita producción, y de qué naturaleza es cada cosa

De `env.validation.ts` y los dos `.env.example`. **La columna de la derecha es la que importa
para elegir gestor**: no todo es un secreto.

| Grupo | Variables | Naturaleza |
|---|---|---|
| **Datos** | `DATABASE_URL`, `REDIS_URL` | 🔴 Secreto — la de Postgres **lleva la contraseña dentro de la cadena** |
| **Búsqueda** | `MEILI_HOST`, `MEILI_MASTER_KEY`, `MEILI_INDEX_NAME` | 🔴 Secreto (la master key) |
| **Sesión / firma** | `JWT_SECRET`, `CONTACT_FORM_SECRET` (mín. 16), `REVALIDATE_SECRET`, `AUTH_SECRET` (web) | 🔴 Secreto. `CONTACT_FORM_SECRET` es **dedicado**: el código prohíbe reutilizar `JWT_SECRET` |
| **Almacenamiento** | `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_URL` | 🔴 Las dos claves. ⚠ **`S3_PUBLIC_URL` es de sólo-una-vez**: se persiste en la base al subir |
| **Pagos** | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, 5× `STRIPE_PRICE_*`, `REDSYS_MERCHANT_CODE`, `REDSYS_TERMINAL`, `REDSYS_SECRET_KEY`, `REDSYS_ENVIRONMENT`, `REDSYS_NOTIFICATION_URL` | 🔴 Secretos + 🟡 config. `REDSYS_ENVIRONMENT=test` **cobra contra el TPV de pruebas** y el panel de instancia ya lo avisa en ámbar |
| **Email** | `RESEND_API_KEY`, `RESEND_FROM` | 🔴 + 🟡 |
| **Mapas** | `MAPTILER_API_KEY` (backend), `NEXT_PUBLIC_MAPTILER_KEY` (navegador) | 🔴 + 🟢 **pública por diseño** — restringir por dominio |
| **Social** | `GOOGLE_CLIENT_ID` (API), `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` (web) | 🟢 + 🔴 |
| **Observabilidad** | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | 🟢 **Un DSN no es un secreto** — el propio `.env.example` de web lo explica bien |
| **Topología** | `APP_URL`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL`, `AUTH_URL`, `PORT`, `NODE_ENV`, `TRUST_PROXY_HOPS`, `GEOCODING_PROVIDER`, `INVOICING_PROVIDER` | 🟡 Config, no secretos. Pero `TRUST_PROXY_HOPS` **no se publica nunca** en ninguna respuesta: le diría a un atacante cuántos `X-Forwarded-For` puede falsificar (ya está así en el panel de instancia) |

**≈ 38 variables**, de las cuales **~15 son secretos de verdad**. Es un número que cabe en las
variables de entorno de cualquier plataforma; **no hace falta un gestor de secretos dedicado para
una instancia**. Empieza a hacer falta con varias (§6): 3 instancias × 15 secretos son 45 valores
que hay que rotar sin equivocarse de sitio.

### 5.3 · La rotación

**Estado: no hay plan.** Y el episodio reciente demuestra que hace falta, porque la pregunta ya se
ha planteado en la práctica.

**El criterio que hace la rotación posible es uno solo: que ningún secreto esté horneado en la
imagen.** Todos deben llegar como variables de entorno en el arranque. Si es así, rotar es cambiar
el valor y reiniciar — sin reconstruir ni volver a desplegar. Verificado: el código lee todo por
`process.env` a través de `configuration.ts`, así que **esto ya se cumple**. Lo único que podría
romperlo es un `Dockerfile` que meta un `.env` dentro de la imagen. **Que no lo haga es un
requisito del paso de contenerización, y conviene escribirlo antes de escribirlo mal.**

**Lo que sí tiene coste real de rotar, y hay que saberlo de antemano:**

| Secreto | Efecto de rotarlo |
|---|---|
| `JWT_SECRET` | **Invalida todas las sesiones.** Todo el mundo tiene que volver a entrar |
| `AUTH_SECRET` (web) | Ídem para las cookies de Next-Auth |
| `S3_*` | Rotable sin drama — **pero `S3_PUBLIC_URL` no**: cambiar el dominio deja muertas todas las URLs ya guardadas en la base |
| `STRIPE_WEBHOOK_SECRET` | Hay que rotarlo **en el dashboard y en el entorno a la vez**; en medio, los webhooks se rechazan con 400 |
| `REVALIDATE_SECRET` | Está en **los dos** paquetes y deben coincidir. Si divergen, la revalidación falla **en silencio** |
| `MEILI_MASTER_KEY` | Hay que reiniciar Meilisearch y la API |

**Recomendación mínima, sin comprar nada:** un documento (fuera del repo, en el gestor de
contraseñas) que diga, por cada secreto, **dónde se genera, dónde se consume y qué se rompe al
rotarlo**. La tabla de arriba es su primer borrador.

---

## 6. El multi-instancia

### 6.1 · Lo que el código ya asume — verificado, no supuesto

| Comprobación | Resultado |
|---|---|
| Discriminador de tenant en el esquema (`tenantId`/`siteId`/`organizationId`/`instanceId`) | **0 apariciones** en `schema.prisma` |
| `Setting` | `key String @id` — **la clave es la primaria**. Un valor por clave, global |
| Unicidad de identidades | `User.email @unique`, `User.slug @unique`, `Listing.slug @unique`, `Category.slug @unique`, `Post.slug @unique` — **globales, sin ámbito** |
| `SITE_NAME`, `SITE_DESCRIPTION` | **Literales en el código**, no variables: [`apps/web/src/config/index.ts:1-2`](../apps/web/src/config/index.ts#L1) |
| `SITE_URL` | `process.env.AUTH_URL ?? 'http://localhost:3000'` — configurable, pero **reutiliza la variable de auth** |
| Índice de Meilisearch | `MEILI_INDEX_NAME` existe y es configurable |

**Veredicto: el código es single-tenant, sin ambigüedad.** Convertirlo a multi-tenant exigiría un
discriminador en prácticamente cada modelo, cambiar cinco `@unique` globales a compuestos, y meter
el ámbito en cada consulta del proyecto. **Es una reescritura, no una configuración.**

### 6.2 · El modelo previsto ya está escrito en el código

Y es el hallazgo que más simplifica esta sección. Dos sitios lo dicen, sin que nadie preguntara:

> *«La marca de la plataforma era una constante de build (`SITE_NAME`)… **Con varias instancias
> del mismo código —una por nicho—** eso significa que las tres zonas son idénticas en todas y que
> entrar en el backoffice no dice EN CUÁL estás.»*
> — [`branding.service.ts:44-47`](../apps/api/src/modules/branding/branding.service.ts#L44)

> *«Ernest se plantea desplegar esto en varios nichos. Lo que difiere entre despliegues —el
> dominio, el remitente de los correos, el buzón de soporte, qué pasarela cobra y en qué entorno,
> dónde están las imágenes— hoy sólo se puede confirmar entrando en el servidor a leer un `.env`.»*
> — [`instance-info.types.ts`](../apps/api/src/modules/admin/instance-info.types.ts)

**Dos ráfagas recientes se construyeron ya para este modelo:** los tres logos por zona (`0a4c155`,
`83d1a75`) y el panel de instancia (`0af8cb4`). No son features sueltas: son **preparación de
multi-instancia por despliegue**, y confirman la dirección.

### 6.3 · Los dos modelos, con su contrapartida

| | **A — N despliegues** (una instancia por nicho) | **B — Multi-tenant** (un despliegue, N sitios) |
|---|---|---|
| **Cambio de código** | **Ninguno.** El código ya es esto | **Reescritura del acceso a datos entero** |
| **Aislamiento** | Total. Un nicho no puede ver ni tumbar a otro | Una consulta sin filtro filtra datos entre nichos. **El fallo es silencioso y grave** |
| **Coste de infraestructura** | ×N (o compartiendo un VPS bien aprovechado, bastante menos de ×N) | ~×1 |
| **Coste de operación** | ×N despliegues, ×N juegos de secretos, ×N migraciones | ×1 |
| **Riesgo del despliegue** | Un fallo afecta a un nicho | Un fallo afecta a todos |
| **SEO** | Dominios independientes, sin canonical cruzado | Requiere resolución por dominio en cada capa |
| **Encaja con lo construido** | **Sí, y ya se está construyendo así** | No |

**Lo que se puede decir sin decidir por Ernest:** B no es «la otra opción», es **otro proyecto**.
A es lo que el código ya es y lo que dos ráfagas recientes están preparando. La pregunta real no
es A o B — es **cuánto de A conviene compartir** entre instancias (§6.5).

### 6.4 · Qué difiere por instancia — el inventario

| Qué | Hoy | Estado |
|---|---|---|
| Dominio (`APP_URL`, `AUTH_URL`, `NEXT_PUBLIC_*`) | Variables | ✅ Configurable |
| **Origen de CORS** | `enableCors()` sin argumentos | ⛔ P1 — al cerrarlo, será `[APP_URL]`: sale gratis |
| Los tres logos (público, backoffice, correos) | `Setting`, editable por el admin de cada instancia | ✅ Cerrado por L1+L2 |
| Remitente de correo, buzón de soporte | `RESEND_FROM` + `Setting supportEmail` | ✅ |
| Pasarela y entorno de cobro | `STRIPE_*`, `REDSYS_*` | ✅ Y el panel avisa en ámbar si Redsys está en `test` |
| Facturación | `INVOICING_PROVIDER` | ✅ (aunque sólo existe `stub` — `pendientes.md` §5) |
| Bucket / dominio de imágenes | `S3_*` | ✅ ⚠ `S3_PUBLIC_URL` es de sólo-una-vez |
| Índice de búsqueda | `MEILI_INDEX_NAME` | ✅ Existe. Relevante sólo si se comparte Meilisearch |
| Categorías, ajustes, contenido | Base de datos por instancia | ✅ Aislado por construcción |
| **`SITE_NAME` / `SITE_DESCRIPTION`** | **Literales en `config/index.ts`** | ⛔ **Único hueco real.** Ver abajo |

**`SITE_NAME`: el único punto donde el multi-instancia tropieza con el código.** Está en 9
ficheros del frontend, y no es decorativo — construye **cada `<title>`, cada Open Graph y la
imagen OG de cada anuncio**. Con dos instancias, la segunda se anuncia en Google con el nombre de
la primera.

**Y hay un detalle de forma que conviene respetar.** El panel de instancia documenta, a propósito,
que `SITE_NAME`, `SITE_DESCRIPTION`, `NEXT_PUBLIC_API_URL` y `DEFAULT_CURRENCY` son **constantes de
build del frontend** y que *«el backend no las conoce y no debe conocerlas: copiarlas allí crearía
dos fuentes para el mismo valor»*. Esa decisión es buena y no hay que romperla. Convertirlas en
variables de entorno del frontend (`NEXT_PUBLIC_SITE_NAME`, con el valor actual como defecto) las
mantiene del lado del frontend y las hace por-instancia. **Es un cambio pequeño y bien delimitado**
— pero es cambio de código, así que no entra en esta auditoría; entra en el plan (§8).

> **Fleco encontrado de paso, que no es del despliegue pero es de la misma familia.**
> `config/index.ts:8` exporta `LISTING_EXPIRY_DAYS = 60`, una constante que **no la usa nadie**
> (`grep` en `apps/web/src`: sólo su propia declaración). Es el gemelo frontend de la constante que
> la ráfaga A de ajustes acaba de eliminar del backend por mentir cuando el admin cambia
> `listingExpiryDays`. Está muerta hoy; borrarla evita que alguien la use mañana. Anotarlo en
> `pendientes.md`, no aquí.

### 6.5 · Lo que se puede compartir entre instancias — y lo que no

Si se va a por A, la pregunta que decide el coste es qué se comparte:

| Pieza | ¿Compartible? | Por qué |
|---|---|---|
| **Postgres** | Una **base por instancia**, mismo servidor | Aislamiento total con una sola factura. Migraciones: N ejecuciones del mismo `migrate deploy` |
| **Redis** | Sí, **db distinta por instancia** | El proyecto **ya sabe hacerlo**: `parseRedisConnection` resuelve el índice de db desde la ruta de `REDIS_URL`, y es justamente lo que aísla dev de test hoy. ⚠ Sin eso, **las 12 colas de dos instancias se mezclan** |
| **Meilisearch** | Sí, **índice distinto** vía `MEILI_INDEX_NAME` | La variable ya existe |
| **R2** | Bucket por instancia, o prefijo por instancia | Bucket separado es más limpio: **las cuatro reglas de ciclo de vida (P7) se aplican por bucket** |
| **Resend** | Un dominio remitente por instancia | Cada nicho manda desde lo suyo |
| **Stripe** | **Depende de si son negocios distintos** | Cuenta compartida ⇒ facturación mezclada. Es decisión fiscal, no técnica |
| **El worker de colas** | **NO** | Un worker apunta a un Redis y a una base. Compartirlo es multi-tenant por la puerta de atrás |

**El aviso que más caro sale si se olvida:** si dos instancias comparten Redis **sin separar la
db**, comparten las 12 colas de BullMQ. Los jobs de una los procesa el worker de la otra —contra
**otra base de datos**—. El mecanismo para evitarlo ya existe y está probado; lo único que hace
falta es **usarlo**, igual que se usa entre dev y test.

---

## 7. Lo que el entorno enseñó, aplicado a producción

Tres lecciones de la sesión del entorno, cada una con su traducción.

### 7.1 · El IPv6 y `127.0.0.1` — **no se hereda, pero deja dos trampas**

La lección de `CLAUDE.md` es **específica de Docker Desktop en Windows**: el reenvío IPv6 acepta
el `connect` y corta al primer byte. **En producción los servicios tienen host y puerto reales
sobre una red que funciona, así que el problema no existe.** No hay que arrastrar `127.0.0.1` a
ninguna configuración de producción.

**Pero deja dos residuos verificados que sí llegan a producción:**

1. **`remotePatterns`** lleva `http://localhost` y `http://127.0.0.1` fijos
   ([`image-domains.ts`](../apps/web/src/lib/image-domains.ts)) — puestos por ese episodio. En
   producción son entradas muertas, y lo que **falta** es la de verdad (§3.4).
2. **`.env.example` sugiere `127.0.0.1` para todo** con un comentario que dice por qué. Es
   correcto para desarrollo, pero es la plantilla de la que alguien partirá para producción. **Un
   `.env.production.example` con hosts reales evitaría el copia-pega.**

**Y la lección de fondo, que sí se transfiere entera:** aquello duró tres episodios porque el
síntoma (`ECONNRESET` en el `sendCommand` de ioredis) **señalaba al código y la causa era de red**.
En producción esa distancia entre síntoma y causa es mayor, no menor. Por eso §3.1 (health checks
que distingan liveness de readiness) y §8 (Sentry activo desde el primer día) no son adornos: son
lo que impide repetir tres días de diagnóstico.

### 7.2 · El `reindex` que no cierra — ya desarrollado en P3

En producción es peor que en local por una razón concreta que en local no se nota: **es un proceso
long-running en un entorno que cobra por tiempo y que reintenta lo que no termina.**

### 7.3 · Los `.env` fuera del repo — **cerrado en los casos, abierto en la clase**

Verificado: ningún `.env` real está versionado; sólo `.env.example` y `.env.test.example`. **Y
producción no depende de ningún `.env` versionado** — todo se lee de `process.env`. ✅

Las dos grietas que quedan están en §5.1: el `.gitignore` enumera nombres en vez de cubrir la
clase, y `.env.example` lleva dos claves reales dentro.

---

## 8. El orden de ataque

### 8.1 · El principio: un despliegue mínimo viable primero

**Una instancia, un nicho, con el único objetivo de que el stack levante y se pueda hablar con
él.** Antes de multi-instancia, antes de optimizar, antes incluso de tener contenido.

**Por qué, y es la lección de esta misma sesión aplicada al despliegue.** El episodio del entorno
enseñó que **el método de verificación importa más que el arreglo**: se estuvo depurando contra
una batería local que arrancaba los servidores de forma distinta a como lo hace el CI, y los
«rojos» eran del método, no del producto. Un primer despliegue tiene exactamente ese riesgo,
multiplicado: si se despliega todo a la vez y algo falla, **no hay forma de saber qué de las
quince cosas nuevas fue**. Es la misma «lección de los dos pasos» que hizo que P1 se separara del
CORS del gateway.

**Además hay una razón dura y verificada:** varios prerrequisitos **no se pueden cerrar sin un
entorno real** — P2 (el proxy), P5 (el webhook de Stripe), P8 (Sentry, Resend). El despliegue
mínimo no es un lujo previo: es **el instrumento de medida** de la mitad de esta lista.

### 8.2 · Antes del primer despliegue — bloqueadores duros

| Orden | Qué | Ref | Por qué no puede esperar |
|---|---|---|---|
| 1 | **Rotar las claves de `.env.example` y arreglar el `.gitignore`** | §3.7, §3.8 | Cuesta minutos y se hace peor con el tiempo |
| 2 | **Cerrar `enableCors()`** (los dos sitios) | P1 | Se despliega con la lista o se despliega con comodín |
| 3 | **Hacer que Joi exija en producción** | §3.2 | Es lo que convierte 7 fallos silenciosos en un arranque que se niega. **Multiplica el valor de todo lo demás** |
| 4 | **Endpoint de salud** | §3.1 | La plataforma lo necesita para saber si el despliegue funcionó |
| 5 | **Arreglar el `reindex`** | P3 | El paso 6 del despliegue lo ejecuta |
| 6 | **Decidir la infraestructura** | §4 | Todo lo de abajo depende de esto |
| 7 | **`Dockerfile` ×2 + `output: standalone` + `GIT_SHA`** | P6, §3.3, §3.6 | Es el despliegue. Resolver aquí lo de `ts-node` (§2/P6) |
| 8 | **Fijar `S3_PUBLIC_URL` y `remotePatterns` DEFINITIVOS** | §3.4 | ⚠ **Antes de la primera subida.** La URL se persiste en la base |
| 9 | **Migraciones + seed en el arranque** | P6 | `prisma migrate deploy` como paso previo, no dentro del servidor |
| 10 | **MapTiler y Resend configurados** | P8 | Nominatim no vale para producción; sin dominio verificado no salen correos |
| 11 | **Tope de tamaño en la exportación** | P4 | Convierte un OOM en un mensaje. Barato |

### 8.3 · Durante el primer despliegue — sólo se pueden hacer aquí

| Qué | Ref | Cómo se cierra |
|---|---|---|
| **Verificar `X-Forwarded-For` y fijar `TRUST_PROXY_HOPS`** | P2 | `curl` con cabecera falsificada; mirar qué IP registra el log |
| **Humo de Stripe con credenciales reales** | P5 | Checkout Session + webhook real. Y `pnpm sync-stripe-catalog` |
| **Las cuatro reglas de ciclo de vida en R2** | P7 | Cuatro reglas de prefijo, caducidad 1 día |
| **Confirmar que Sentry recibe un evento real** | P8 | Provocar un error a propósito |
| **`reindex` + comprobar que la búsqueda responde** | P6/P8 | Ojo con el `waitForTask` que falta en `reindexAll` |

### 8.4 · Después — se puede desplegar sin ello

| Qué | Ref | Cuándo |
|---|---|---|
| Swagger detrás de una condición | §3.5 | Primera semana |
| Separar API y worker | §4.3 | Cuando la carga o un susto de memoria lo pidan |
| Streamear el ZIP | P4 | Cuando haya vendedores grandes de verdad |
| Swap atómico del reindex | P8 | Cuando el índice sea grande |
| `waitForTask` en los dos hermanos | `pendientes.md` §4.2 | Con cualquier otra cosa de búsqueda |
| **Revisar los 10 crones** con el criterio del bump | §4.3 | ⚠ **Obligatorio ANTES de escalar la API a 2 réplicas** |
| **`SITE_NAME` configurable** | §6.4 | ⚠ **Obligatorio antes de la SEGUNDA instancia**, no de la primera |

---

## 9. El plan de ráfagas

Cinco ráfagas antes de desplegar y una de despliegue. Cada una **verificable por separado** — la
lección de los dos pasos.

| # | Ráfaga | Contenido | Verificación |
|---|---|---|---|
| **D0** | **Higiene de secretos** | Rotar las claves de `.env.example` → placeholders; `.gitignore` a `.env*` + `!.env*.example` | `git check-ignore` sobre los cuatro nombres; el fichero sin `sk_`/`whsec_` |
| **D1** | **El arranque dice la verdad** | Joi exigente en `production` (las 7 de §3.2, incluida la condicional MapTiler↔provider); `GET /api/health` + `/api/ready`; Swagger condicionado | Arrancar con `NODE_ENV=production` y variables incompletas → **falla con el nombre de la que falta**. `/api/health` responde 200 |
| **D2** | **CORS y el `reindex`** | `enableCors` con lista (y `create-app.ts` igual); cerrar las colas del `reindex`. **Los dos juntos porque los dos son «cerrar lo que quedó abierto» y ninguno toca al otro** | Petición desde un origen ajeno → sin cabecera CORS; suite e2e verde. `pnpm reindex` **termina y el proceso sale con 0** |
| **D3** | **Empaquetado** | `Dockerfile` API + web; `output: 'standalone'`; `GIT_SHA` inyectado y en el panel; resolver `ts-node` en la imagen | `docker run` local levanta los dos contra el `docker-compose` de siempre. El panel muestra el commit |
| **D4** | **Red de seguridad** | Tope de tamaño en la exportación con mensaje honesto | Un usuario sintético por encima del tope recibe el mensaje, no un OOM |
| **D5** | **El primer despliegue** | Infraestructura elegida; migraciones + seed; variables; workflow; **§8.3 entero** | Publicar un anuncio de punta a punta: registro → publicar con foto → aparece en búsqueda → contactar → correo recibido → pago de prueba |

**Nota sobre D5:** ese último criterio no es ceremonial. Recorre Postgres, Redis, las colas,
`sharp`, Meilisearch, R2, el WebSocket, Resend y Stripe **en una sola pasada**. Si pasa, el stack
está montado. Es el equivalente de despliegue al `test:e2e:ci` que cerró la inestabilidad de
Playwright: **una verificación que se parece a lo real, en vez de N verificaciones parciales.**

---

## 10. Las decisiones que Ernest tiene que tomar

Ninguna la toma este documento. Ordenadas por lo que bloquean.

| # | Decisión | Opciones | Qué desbloquea | Qué falta para decidir |
|---|---|---|---|---|
| **1** | **Dónde se despliega** | PaaS de contenedores · VPS con Compose · Cloud grande · Híbrido | **Todo.** Es la raíz | Presupuesto mensual; cuánta operación asumir; y la nº 2 |
| **2** | **Cuántas instancias, y cuándo** | Una y ya se verá · Una ahora + N previstas · N desde el principio | El diseño de la nº 1: el coste de un VPS se reparte, el de un PaaS por servicio se multiplica | Si hay ya un segundo nicho concreto |
| **3** | **Gestionado vs. propio, pieza a pieza** | Postgres 🔴 · Redis 🟡 · Meilisearch 🟢 (por orden de lo que duele perder) | El presupuesto y el plan de copias | **Verificar PostGIS** en el Postgres gestionado candidato |
| **4** | **Topología de procesos** | A: un proceso (hoy) · B: API + worker · C: + scheduler | Si se puede escalar la API sin revisar los 10 crones | Se puede empezar con A y pasar a B sin reescribir |
| **5** | **Los comandos de admin en la imagen** | Conservar devDeps · Compilarlos a JS · Imagen de tareas aparte | El `Dockerfile` (D3) | Ninguna: es elección de forma. **Pero sin decidirla, D5 no puede sembrar** |
| **6** | **Una cuenta de Stripe o varias** | Compartida · Una por instancia | La facturación de cada nicho | Es decisión fiscal, con el asesor — la misma conversación que `pendientes.md` §5 |
| **7** | **Swagger en producción** | Apagado · Detrás de auth · Público | Nada, pero conviene que sea a propósito | — |
| **8** | **Qué se puede vender el primer día** | Con `stub` no hay factura válida | Si se cobra desde el día 1 o se despliega sin cobrar | `pendientes.md` §5 — proveedor homologado |

---

## 11. Resumen — el nudo, en una tabla

| # | Qué | Bloqueo | Se cierra… | Ráfaga |
|---|---|---|---|---|
| P1 | `enableCors()` sin argumentos | **DURO** | Antes | D2 |
| P2 | Rate limit por IP sin verificar | **DURO** (verificación) | **Durante** | D5 |
| P3 | El `reindex` no cierra conexiones | **DURO** | Antes | D2 |
| P4 | ZIP de exportación en memoria | BLANDO **con tope** | Antes (el tope) | D4 |
| P5 | Stripe sin verificar de verdad | **DURO** (verificación) | **Durante** | D5 |
| P6 | El despliegue | **DURO** | Antes | D3 + D5 |
| P7 | Las 4 reglas `tmp/` | BLANDO | **Durante** | D5 |
| P8 | Preparación de producción | MIXTO | Antes / durante | D5 |
| **N1** | **Sin endpoint de salud** | **DURO** | Antes | D1 |
| **N2** | **Joi no exige en producción** | **DURO** | Antes | D1 |
| **N3** | Sin `output: 'standalone'` | BLANDO | Antes | D3 |
| **N4** | **`remotePatterns` sin el R2 real** | **DURO** ⚠ antes de la 1.ª subida | Antes | D3 |
| **N5** | Swagger sin condición | BLANDO | Antes | D1 |
| **N6** | Sin `GIT_SHA` | BLANDO | Antes | D3 |
| **N7** | **`.gitignore` enumera en vez de cubrir** | **DURO** | Antes | D0 |
| **N8** | **`.env.example` con claves reales** | **DURO** | Antes | D0 |
| **N9** | Topología de procesos sin decidir | **DURO** (la decisión) | Antes | Decisión 4 |
| **N10** | `SITE_NAME` no configurable | DURO **para la 2.ª instancia** | Después | — |

**Ocho eran. Son dieciocho.** Y la mitad de los nuevos —N1, N2, N7, N8— **cuesta menos de un día
entre los cuatro**, porque el mecanismo para arreglarlos ya existe en el repositorio: el
`Joi.when` que se usa en `test`, el patrón de `.gitignore`, y un controlador de tres líneas.

**Lo que este documento NO hace, dicho para que no se dé por hecho:** no elige plataforma, no
escribe un `Dockerfile`, no toca una línea de código y no decide el modelo de instancias. Mapea el
nudo y separa lo que bloquea de lo que no. **El siguiente paso es la decisión nº 1**, porque nueve
de las dieciocho entradas de esa tabla dependen de ella.
