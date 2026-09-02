# Pendientes reales del proyecto

> Lo que queda por **CONSTRUIR** (no documentación desfasada). Verificado contra código el
> 2026-08-09 (`842ea24`), repasado el 2026-08-27 (`42bd104`), y **reverificado entrada por
> entrada el 2026-09-02 sobre `aca6b21`** — cada punto se comprobó con `grep`/`git log`/lectura
> del fichero, no contra la memoria de las sesiones.
> Para el estado de lo IMPLEMENTADO, ver `estado-tecnico.md`.

Este documento nació de la auditoría de documentación de 2026-08-04, al separar dos cosas que
estaban mezcladas: **documentos que mienten sobre algo ya hecho** (se arreglan escribiendo) y
**trabajo que de verdad no se ha hecho** (no se arregla escribiendo). Aquí solo está lo segundo.

**Etiquetas de prioridad:**

| Etiqueta | Significado |
|---|---|
| `[SEGURIDAD]` | Superficie de ataque abierta. Se cierra antes de exponer el servicio a internet. |
| `[BLOQUEADO-EXTERNO]` | No depende de escribir código: falta una credencial, una cuenta o una decisión de un tercero. |
| `[DEUDA]` | Trabajo pendiente ordinario, priorizable. |
| `[COBERTURA]` | El código funciona (o eso se cree); lo que falta es la prueba que lo demuestre. |
| **⛔ PRERREQ** | **Prerrequisito del despliegue.** Se cierra ANTES de exponer el servicio, o el despliegue arrastra el defecto. Ver el resumen final. |

**Regla de mantenimiento:** cuando un punto se cierre, se borra de aquí y se documenta en
`estado-tecnico.md`. Este fichero solo contiene lo abierto — si crece indefinidamente, es que no
se está manteniendo. **Excepción declarada:** §0 conserva lo cerrado *recientemente*, porque este
documento es la base de la auditoría del despliegue y ahí importa tanto lo que queda como lo que
ya no hay que volver a mirar.

---

## 0. Cerrado desde el último repaso (2026-08-27 → 2026-09-02) — **no reabrir**

Verificado con `git log` sobre `main`. **El detalle vive en `estado-tecnico.md`; aquí sólo el qué,
el commit, y —cuando el punto estaba listado como abierto más abajo— de dónde sale.**

| Bloque | Qué cierra | Commits |
|---|---|---|
| **Notificaciones (A1, N2–N6)** — el sistema completo, usuario **y** backoffice | A1 los 4 defectos y las dos causas raíz; N2 las decisiones sobre la cuenta con su motivo; N3 el ciclo de vida del anuncio; N4a la reputación; N4b la mensajería (sin ser un chat roto ni spam); N5 el email y su válvula; N6 la cola de trabajo del backoffice | `e8569d7` · `85afc04` · `896edeb` · `bcf4064` · `d37959b` · `54c9fab` · `6d83119` |
| **La inestabilidad de Playwright** — diagnosticada y cerrada | El veredicto fue que **los rojos eran LOCALES y el CI estaba limpio** (24/24 `success`): el método local arrancaba los servidores en modo desarrollo y el CI en producción. Diagnóstico en [`auditoria-inestabilidad-playwright.md`](./auditoria-inestabilidad-playwright.md); arreglo: `test:e2e:ci` (`apps/web/scripts/e2e-ci.js`) y `retries: 1` en [`playwright.config.ts:51`](../apps/web/playwright.config.ts#L51), con la causa del `process.exit` del propio `next dev` anotada en el fichero | `99d7c1c` |
| **Ajustes del backoffice — ráfaga A** ⇒ **cierra «`Setting` decorativos»** | Los **dos ajustes muertos**, conectados: `listingExpiryDays` lo lee ahora `ListingExpiryService` desde `listings`, `admin`, `moderation` y `account-archive`; `contactRequiresVerification` lo lee `MessagingService`. El estático `ExpirationService.expiresAt()` con su `EXPIRY_DAYS = 60` **se eliminó** en vez de dejarse como atajo, para que la regresión sea un error de compilación ([expiration.service.ts:177-188](../apps/api/src/modules/expiration/expiration.service.ts#L177)). Barreras en [`ajustes-rafaga-a.e2e-spec.ts`](../apps/api/test/ajustes-rafaga-a.e2e-spec.ts) (se aplica de verdad, no es retroactivo, y `0`/`-5` dan 400) | `60c3fe4` · `ef0ea07` |
| **Ajustes del backoffice — ráfaga B** | El panel de «cómo está montada esta instancia» | `0af8cb4` · `9890e82` |
| **i18n T1–T3** | T1 los filtros públicos en español (`priceType` traducido, `province` duplicada fuera); T2 los seis enums crudos del backoffice; T3 la dispersión cerrada — un vocabulario único en `lib/` con puente, y la **barrera B5** que impide la copia nº 32 | `f8f6b40` · `c3b9d8b` · `774927c` · `5710fb8` · `011d1ed` |
| **Vídeo de bloque V1 + V2** | V1 el mecanismo (presign, confirm **sin copiar**, promoción fail-closed) y el modelo; V2 el editor y el render del bloque completo, con MP4 sintético en navegador contra MinIO. De paso **quitó el límite de duración a propósito** (ver §4.3) y añadió el cuarto prefijo `tmp/` (§1, paso 7) | `e71cb73` · `a2244fe` · `cdd051f` |
| **Bloque de publicidad externa** | Imagen obligatoria, enlace seguro (`noopener` siempre) | `ae5dda8` · `1b647ef` |
| **Rejilla de tarjetas de portada** | Media obligatorio, texto opcional, sin descuadre | `4920945` |
| **Tres logos por zona (L1 + L2)** | El backend de la marca con la fuga inversa cerrada, y la pantalla para subirlos + el render por zona | `0a4c155` · `83d1a75` |
| **Ficha de usuario — ajuste 1** | Las acciones de la ficha quedan con red de tests donde no la había | `91897e9` |
| **Mis-créditos — ráfagas A y B** | La campaña de bonus visible ANTES de comprar; la página organizada por tarea, con el saldo primero | `5ee9cb9` · `1079c9b` · `8bc984a` |
| **El entorno de desarrollo** | El rodeo del IPv6 de Docker Desktop fijado a `127.0.0.1` **también en `apps/web`** (`/_next/image` sufría el mismo `ECONNRESET` y devolvía 500) y documentado en `CLAUDE.md`; los `.env` fuera del repo (`.env.test` y `.env.dev.bak` dejan de rastrearse); las claves que vivían en `.env.test` movidas a `ci.yml` como valores ficticios de CI | `583140d` · `d29a639` · `4929c21` · `081a8bf` · `aca6b21` |

### 0-bis. Cerrado en repasos anteriores — la tabla que ya estaba

| Ítem | Dónde quedó |
|---|---|
| CORS del gateway WebSocket restringido a `APP_URL` | [messaging.gateway.ts:55](../apps/api/src/modules/messaging/messaging.gateway.ts#L55) — `cors: { origin: [appOrigin()] }`, en forma de **array de un elemento** (con cadena, el paquete `cors` no compara) |
| AuditLog atómico | RF.12b — `log(dto, tx?)` acepta `Prisma.TransactionClient` |
| Reintento de slug ante colisión P2002 | Resuelto (ver `estado-tecnico.md` §3) |
| Reintentos del job `geocode` | Resuelto — la causa no era la cola sino que `GeocodingService.geocode()` se tragaba los fallos transitorios como `null` |
| Playwright corriendo en CI | [ci.yml](../.github/workflows/ci.yml) — steps de señal (`--grep-invert @2b`) y `@2b` separados |
| La saga del CI | Cerrada y verificada **en el runner**: corrida `30930395538`, SHA `e4df671` |
| CI sin unit tests del backend | [ci.yml](../.github/workflows/ci.yml) — paso `Backend unit — Jest`, confirmado en el runner (corrida `31028999515`, SHA `b0c5916`) |
| `Report.reviewId` en `Cascade` | [schema.prisma](../apps/api/prisma/schema.prisma) — `SetNull` + snapshot (`reviewComment` / `reviewAuthorName`) tomado **al CREAR** la denuncia, con backfill y barrera en [`borrado-denuncia-valoracion.e2e-spec.ts`](../apps/api/test/borrado-denuncia-valoracion.e2e-spec.ts) |
| **Rotación de destacados** (auditoría + R1–R4, P2B, H9) | El bloque «Promocionados» rota por ventana de 15 min y todos los destacados tienen turno · `2cfe103` `99be311` `4f2dd4d` `9616d7d` `9c0e809` `0563d27` |
| **Borrado de cuentas** (C1–C6) | Archivar / eliminar / exportar, 6/6. Cerró de paso los **8 `Cascade`** peligrosos, el `BANNED` visible y `forgotPassword` sin gate · `5c1baef` `0ea6b7b` `e17642f` `b7de4be` `89a5910` `5616823`/`f7612ee` |
| **Deuda de test/CI** (A1–A3) | Google Fonts fuera del build, la carrera de conteo de jobs de BullMQ y el aislamiento de `Setting` · `6af69b3` `459fcc0` `195e012` |
| **Residuo `BANNED`** | Banear **pausa** los anuncios; reinstaurar devuelve el acceso, no la visibilidad · `d422d22` |
| **Póster animado** (P1 + P2) | El hover-preview resuelto como **sprite**. Cerró **H-2** y añadió el barrido de favoritos · `3e93c95` `42bd104` |
| **Paginación de categorías** ⇒ **cierra media entrada** (ver §4.2) | [CategoryListingPage.tsx:339](../apps/web/src/components/categorias/CategoryListingPage.tsx#L339) calcula `totalPages`, y las líneas 588-606 pintan «Anterior / Página N de M / Siguiente». Verificado el 2026-09-02: la mitad «categorías» del pendiente «sin paginación en el home ni en categorías» **ya no existe** |
| **Flake de `search-dynamic-attributes`** | `applyFilterableAttributes` era el único método de `SearchService` sin `waitForTask`. Cerrado en la causa, con una barrera que **le pone cola a Meili a propósito** para que la carrera sea reproducible |

---

## 1. Despliegue (MVP R6.1–R6.3) — el proyecto NUNCA se ha desplegado `[DEUDA]` ⛔ PRERREQ

Es el pendiente más antiguo del proyecto y el único que bloquea a varios de los demás (§4
«preparación de producción» y §6 dependen de que exista un entorno real).

**Reverificado el 2026-09-02, sin cambios:**

- No existe ningún `Dockerfile` en el repositorio (`find . -iname "Dockerfile*"` → vacío).
- No existe `fly.toml`, `vercel.json`, ni ningún manifiesto de plataforma.
- `.github/workflows/` contiene **únicamente** `ci.yml`. No hay workflow de despliegue.
- [docker-compose.yml](../docker-compose.yml) levanta solo infraestructura **local de
  desarrollo**: `postgres`, `redis`, `meilisearch`, `minio`, `createbuckets`. No es un
  compose de producción y no incluye ni la API ni el frontend.

**Lo que haría falta, en orden de dependencia:**

1. **Contenerizar los dos paquetes.** `Dockerfile` multi-stage para `apps/api` (build de NestJS
   + `prisma generate`; el runtime necesita el cliente Prisma generado) y para `apps/web` (build
   de Next.js en modo `standalone`). Ojo: es un monorepo pnpm — el contexto de build tiene que
   incluir el lockfile de la raíz.
2. **Elegir plataforma y decidir dónde vive cada servicio gestionado.** Postgres **con PostGIS**
   (no vale un Postgres pelado: el schema lo habilita), Redis, Meilisearch y el bucket. En
   producción el almacenamiento ya está previsto como **Cloudflare R2** vía `R2Service` (MinIO es
   solo para desarrollo), así que esa pieza no hay que decidirla.
3. **Migraciones en el arranque.** `prisma migrate deploy` como paso previo al arranque de la API,
   no dentro del proceso servidor.
4. **Variables de entorno de producción.** `apps/api` valida el entorno con Joi al arrancar, así
   que un despliegue con variables incompletas falla en el arranque (deseable). Partir de los
   `.env.example` de cada paquete. **Ojo con `S3_PUBLIC_URL`:** la URL pública se construye al
   subir y **se guarda entera en la base de datos**, así que fijarla mal el primer día deja
   URLs muertas que no se arreglan cambiando la variable (ver `CLAUDE.md`).
5. **Workflow de despliegue** en GitHub Actions, encadenado al `ci.yml` que ya existe y funciona.
6. **Semilla y reindexado inicial.** Tras el primer despliegue: `seed` (árbol de categorías,
   admin, settings) y `pnpm --filter @marketplace/api reindex` para poblar Meilisearch.
   **Antes de correr eso en producción, ver §4.2 «El `reindex` no cierra sus conexiones»** — hoy
   el comando termina su trabajo pero **el proceso no muere**.
7. **Las CUATRO reglas de ciclo de vida del bucket** (huérfanas H2 — **el código ya está puesto
   desde el 2026-08-23**: lo no confirmado vive bajo `tmp/` y lo confirmado sale de ahí; ver
   [`diseno-huerfanas-sin-fila.md`](./diseno-huerfanas-sin-fila.md) §9.5): caducar a **1 día**
   lo que quede bajo `listing-videos/tmp/`, `avatars/tmp/`, `listing-previews/tmp/` y
   `blocks-videos/tmp/`.

   > **Inventario reverificado el 2026-09-02** (`grep pendingPrefix` en `apps/api/src`): siguen
   > siendo esos **cuatro** y no hay un quinto. Los tres logos (`branding/`, `LOGO_KEY_PREFIX`)
   > **no** usan `pendingPrefix` —suben directo, sin paso temporal— así que no añaden regla.
   >
   > **Eran dos y son cuatro**, y las dos que faltaban se descubrieron al diseñar el vídeo de
   > bloque (`diseno-video-bloque.md` §4.3). `listing-previews/tmp/` lo creó el póster animado
   > P1 y nunca llegó a esta lista; `blocks-videos/tmp/` lo añadió el vídeo de bloque V1. Es
   > exactamente el modo de fallo de una lista escrita a mano — **el prefijo temporal lo pone el
   > código y la regla la pone una persona**, así que cada prefijo nuevo hay que acordarse de
   > anotarlo aquí. La forma vive en un solo sitio (`pendingPrefix`, `media-keys.ts`); el
   > inventario, sólo aquí.

   Es lo que recoge las subidas que nunca llegaron a completarse —un vídeo abandonado pesa hasta
   50 MB—, y es **seguro por construcción**: bajo `tmp/` no vive nada que esté en uso, porque lo
   que se adopta se copia fuera. Lo que adopta cambia según el prefijo —en el vídeo de anuncio y
   en el sprite es confirmar; en el avatar, guardar el perfil; en el media de bloque, **guardar
   el post o la portada**—, pero la garantía es la misma en los cuatro y está probada en CI: lo
   que se persiste no lleva `tmp/`.
   Un día es el suelo (la expiración se expresa en días enteros) y sobra: la URL prefirmada dura
   10 minutos. **No se puede probar en CI** —una caducidad se mide en días—, así que depende de
   que se aplique aquí; hasta entonces la basura se acumula confinada a esos cuatro prefijos,
   que se pueden vaciar a mano sin riesgo.

**Consecuencia de no tenerlo:** hay comportamiento que solo se puede validar en un entorno real y
que hoy está sin validar — §4 (preparación de producción), §6 (rate limit por IP), la
verificación de Sentry en staging y **la integración real de Stripe** (§4.2).

---

## 2. Hito 9.1 — Navegación y flujos (RN9.1–RN9.2) `[DEUDA]`

**Sin empezar.** Ninguna de las dos ráfagas se ha ejecutado.

- **RN9.1 (Opus):** auditar los flujos de usuario —mapa de pantallas y transiciones— y diseñar
  las correcciones de navegación: callejones sin salida, migas de pan, estados vacíos,
  coherencia entre secciones.
- **RN9.2 (Sonnet):** implementar las correcciones priorizadas.

**Insumos disponibles:** `docs/personas-y-wireframes.md` (las personas siguen siendo válidas) y
`docs/mapa-pantallas-flujos.md` (histórico del MVP — la superficie actual es mucho mayor: el nav
del backoffice va ya por **24 secciones**, frente a las 6 que documenta).

**Deuda de navegación ya inventariada en `estado-tecnico.md`** que esta fase debería recoger: los
breadcrumbs no reflejaban la categoría padre porque el dato no llegaba del backend (`H2` de la
auditoría de búsqueda) — resuelto en su parte de datos, pero la revisión de coherencia global no
se ha hecho.

---

## 3. Hito 9.2 — Interfaz, estilo y contenido (RU9.1–RU9.3) `[DEUDA]`

**Sin empezar.** Ninguna de las tres ráfagas se ha ejecutado.

- **RU9.1 (Opus):** diseñar el pase de interfaz y estilo — sistema visual coherente, design
  tokens, copys.
- **RU9.2 (Sonnet):** aplicar el refresco por áreas (1/2).
- **RU9.3 (Sonnet):** aplicar el refresco por áreas (2/2) + revisión de contenido y copys.

**Anotación de alcance que ya existe:** `estado-tecnico.md` §3 difiere aquí un «backlog de pulido
de UI» explícitamente marcado como *«no una brecha funcional»*. Esta fase es su destino natural.

**Se le suma T4 de i18n** (§4.2, accesibilidad): son literales de interfaz y caen exactamente en
este pase, aunque puedan hacerse antes y por separado.

---

## 4. Hito 9.3 — Deuda transversal

### 4.1 Seguridad

#### `app.enableCors()` sin argumentos — la API HTTP abierta a cualquier origen `[SEGURIDAD]` ⛔ PRERREQ

**Reverificado 2026-09-02: sigue igual, en los dos sitios.**

[apps/api/src/main.ts:40](../apps/api/src/main.ts#L40)

```ts
app.enableCors();   // ← sin argumentos: Access-Control-Allow-Origin para cualquiera
```

También en [test/helpers/create-app.ts:37](../apps/api/test/helpers/create-app.ts#L37) (los tests
replican el bootstrap), y ése es el detalle que hace que el arreglo tenga trabajo: si se cierra
en `main.ts` y no en el helper, los tests dejan de probar lo que corre en producción.

Es **la otra mitad** del problema de CORS que R9 cerró en el gateway WebSocket, y se dejó fuera
de aquella ráfaga **a propósito**: su radio de explosión es toda la API HTTP (no un gateway), y
meter los dos cambios juntos habría roto la lección de los dos pasos — si algo se cae, no sabes
cuál de los dos fue. Merece su propia ráfaga con su propia verificación.

Sin vender más de lo que es, con el mismo criterio que se aplicó al gateway: **el control de
acceso es el JWT, no el CORS**, y el CORS no protege frente a un cliente que no sea un navegador.
Cerrarlo es higiene — quitar el comodín del inventario — no el cierre de un exploit conocido.
**Es prerrequisito porque el comodín sólo importa cuando hay un origen que no controlas**, y eso
empieza el día del despliegue.

#### `allowedDevOrigins` ausente de la configuración de Next `[DEUDA]`

[apps/web/next.config.ts](../apps/web/next.config.ts) — la clave **no aparece** (verificado con
`grep` en todo `apps/web`). Solo afecta a desarrollo cuando se accede al dev server por IP (por
ejemplo, para probar desde el móvil en la misma red); Next avisa y bloquea recursos de dev.

**Se retira de la lista de prerrequisitos, y se dice por qué:** este ajuste **solo actúa en
`next dev`**. No toca producción, así que no bloquea el despliegue — se agrupaba con los otros
dos por llevar la palabra «origins», que no es una razón.

### 4.2 Residuos de código

#### El `reindex` no cierra sus conexiones — el origen de los `node` huérfanos `[DEUDA]` ⛔ PRERREQ

**Hallazgo de las sesiones del 2026-08-29 / 09-02, verificado en código el 2026-09-02.**

[`commands/reindex.ts:105-107`](../apps/api/src/commands/reindex.ts#L105) hace lo que su
comentario promete —cerrar la conexión de `RedisService`, que sin `app.close()` no se cierra
sola— y aun así **el proceso no termina**:

```ts
await app.get(RedisService).client.quit();   // cierra UNA conexión: la suya
```

**La mecánica exacta, que es lo que hace que el comentario del fichero se quede corto:**
`ReindexModule` importa `SearchModule` → que importa `ReviewsModule` → que hace
[`BullModule.registerQueue(retryQueue(QUEUE_NOTIFICATIONS))`](../apps/api/src/modules/reviews/reviews.module.ts#L14).
Esa `Queue` de BullMQ **abre su propia conexión ioredis**, que no es la de `RedisService` y por
tanto `client.quit()` no toca. El script nunca llama a `app.close()` —deliberadamente, por el
crash de libuv con Prisma en Windows que documenta el propio fichero— así que el hook
`OnApplicationShutdown` tampoco se dispara. Resultado: el event loop no drena y el proceso queda
vivo indefinidamente.

**Cuándo empezó:** con `bcf4064` (notificaciones N4a), que es el commit que metió la cola en
`ReviewsModule` (`git log -S` confirma que es el único). Antes de N4a el `quit()` bastaba, y por
eso el comentario que lo justifica es correcto para el mundo en que se escribió.

**Qué ha costado ya, y por eso está aquí y no en una nota:**

- Los procesos `node` huérfanos que `CLAUDE.md` manda buscar con `Get-Process node` — no son
  «sesiones anteriores» genéricas: buena parte salen de aquí.
- El ruido del episodio de despliegue (sockets muertos contra Redis quemando CPU).
- Contribuye a los flakes de `queue-retry`: un proceso huérfano sigue **consumiendo de las mismas
  colas** que la corrida en curso.

**Por qué es prerrequisito:** el paso 6 de §1 es *«tras el primer despliegue, correr `reindex`»*.
Un comando de administración que no muere no se puede meter en un job de despliegue, en un
contenedor efímero ni en un cron: se queda colgado y el despliegue no termina.

**Al arreglarlo:** el camino corto es cerrar también las colas (obtenerlas del contexto y
`queue.close()`); el limpio es que `ReindexModule` no arrastre `ReviewsModule` —el script solo usa
`SearchService`, y `ReviewsModule` entra por el `SearchController` que `createApplicationContext`
instancia igualmente—. Lo segundo es más trabajo y menos frágil.

#### Los dos hermanos de `SearchService` sin `waitForTask` `[DEUDA menor]`

Señalados al cerrar el flake de `search-dynamic-attributes` y **reverificados el 2026-09-02: los
dos siguen igual**.

| Método | Línea | Qué hace sin esperar | Alcance |
|---|---|---|---|
| `removeListing` | [search.service.ts:567](../apps/api/src/modules/search/search.service.ts#L567) | `deleteDocument` | Mismo flake en potencia para un «ya no está en la búsqueda» |
| `reindexAll` | [search.service.ts:585](../apps/api/src/modules/search/search.service.ts#L585) | `addDocuments` | Solo el comando offline `pnpm reindex` |

Sus tres hermanos (`indexListing`, `clearAll`, `applyFilterableAttributes`) sí esperan, con la
razón escrita al lado. La asimetría es el defecto: no hay ningún motivo documentado para que
estos dos no lo hagan.

#### `conversation:read` por WebSocket `[DEUDA]`

**Reverificado 2026-09-02:** el gateway sigue **sin emitir ningún evento de lectura**. Sus
emisiones son `error`, `ticket:message` y `message:new`
([messaging.gateway.ts:352-383](../apps/api/src/modules/messaging/messaging.gateway.ts#L352)). El
marcado de leído ocurre solo por REST, al abrir la conversación
([messaging.service.ts:133](../apps/api/src/modules/messaging/messaging.service.ts#L133)).

**Efecto para el usuario:** el contador de no leídos de la bandeja no baja hasta que se recarga o
se reabre la conversación.

**Nota de estado sobre el rojo asociado.** La entrada anterior emparejaba esto con un fallo de
`mensajeria-unificada.spec.ts` (~línea 241, el badge que no llegaba a `4`). **Ese emparejamiento
hay que rehacerlo antes de usarlo:** la auditoría de inestabilidad de Playwright (`99d7c1c`)
demostró que buena parte de los rojos locales de aquel periodo eran del arranque local en modo
desarrollo, no del producto, y el CI daba verde. Lo que sigue siendo cierto por lectura de código
es lo de arriba: **no hay evento de lectura**. Si al retomarlo el badge falla, entonces sí es esto.

#### `DELETE /media/:id` + recolección de huérfanas `[DEUDA]`

**Reverificado 2026-09-02:**
[media.controller.ts](../apps/api/src/modules/media/media.controller.ts) expone exactamente dos
rutas: `@Post('upload')` (línea 25) y `@Post('upload-avatar')` (línea 49). **No hay `@Delete` de
ningún tipo.**

**Efecto:** las imágenes de wizards abandonados quedan huérfanas para siempre, en el bucket y en
la tabla `ListingImage`.

**Nota de alcance al retomarlo:** los adjuntos de ticket tienen exactamente la misma deuda
(`TicketAttachment` → objeto en R2), y hoy no puede materializarse porque no existe ningún
endpoint que borre tickets, mensajes ni usuarios. Si se añade cualquiera de los tres, hay que
borrar también del bucket.

**Lo que ya está cerrado y NO hay que rehacer:** B3 (borrar anuncio y descartar borrador encolan
sus ficheros en `media-cleanup`), la sexta fuente (quitar una foto de un anuncio vivo, cerrada por
2b en la misma ráfaga que la descubrió) y **H1** (avatar sustituido, imágenes de bloque del blog y
de la portada, imagen de patrocinado — `ownUrlsDeep`/`releasedUrls` en `media-keys.ts`, barreras en
`huerfanas-h1.e2e-spec.ts`) y **H2 en su parte de código** (los cuatro prefijos `tmp/`, barreras en
`huerfanas-h2.e2e-spec.ts` contra MinIO con `r2.head`).

**Lo que sigue abierto son dos problemas distintos:**

- **Basura CON fila** (imágenes de wizard abandonado, adjuntos de ticket): el fichero **sí** está
  referenciado, así que un barrido «bucket menos base de datos» no la ve. Se detecta con una
  consulta (`ListingImage WHERE listingId IS NULL AND createdAt < umbral`), no recorriendo el
  bucket. **Ojo, y es lo importante:** esa consulta, tal cual, **borraría la portada del blog**.
  Toda la imaginería del blog sube por `POST /media/upload` y vive como `ListingImage` con
  `listingId = null` bajo `media/` — indistinguible de un wizard abandonado.
- **Basura SIN fila:** lo que queda es la **mitad no-código de H2** — las cuatro reglas de ciclo
  de vida del bucket, que son el paso 7 de §1 y sólo se pueden aplicar en el despliegue.

**Por qué no se barre ahora:** no hay basura de producción que recoger (no hay producción), el
riesgo de falso positivo está demostrado y es irreversible, y las clases que un barrido sí vería
tienen la **fuente todavía abierta** —limpiarlas hoy es fregar con el grifo abierto—. El orden
correcto es **cerrar primero las fuentes** (prevención, como B3) y sólo después plantearse recoger
un conjunto ya finito. Detalle y salvaguardas en `diseno-borrado.md` §7.6–§7.7.

#### H-1 — el póster fijo del vídeo deja fila huérfana y miniatura inútil `[DEUDA menor]`

**Reverificado 2026-09-02: abierto.** El **póster fijo** de un vídeo se sube por
`POST /media/upload`, que no está pensado para eso:
[media.service.ts:31-48](../apps/api/src/modules/media/media.service.ts#L31) crea una fila en
**`ListingImage`** —con `listingId` a `null`, porque nadie la enlaza— y encola `sharp`, que le
genera un **`-thumb.webp` que no usa nadie**. Y `listingMediaKeys` **no deriva esa miniatura** para
el póster, así que al borrar el anuncio el thumb se queda en el bucket para siempre — el propio
[`media-keys.ts:90-96`](../apps/api/src/infra/r2/media-keys.ts#L90) lo dice en un comentario.

**Lo que NO es.** El **sprite** del póster animado no las produce: va por su propio camino
prefirmado a `listing-previews/` justo para evitarlo. La ráfaga que lo introdujo **no agrandó**
esta fuga — sólo la dejó a la vista.

**Por qué no se cerró.** Arreglarlo bien es **mudar el póster fijo a su propio camino** (como se
hizo con el sprite), y eso obliga a migrar los pósters que ya están.

**Dónde vive.** [`media.service.ts:31-48`](../apps/api/src/modules/media/media.service.ts#L31) ·
[`video.ts` — `uploadPoster`](../apps/web/src/lib/api/video.ts) ·
[`media-keys.ts:70-100`](../apps/api/src/infra/r2/media-keys.ts#L70). Contexto:
`diseno-poster-animado.md` §1.1 (H-1) y §3.3.

#### El ZIP de exportación se arma **en memoria** `[DEUDA]` — residuo de C6 ⛔ PRERREQ

**Reverificado 2026-09-02: abierto.**
[`data-export.zip.ts:67-68`](../apps/api/src/modules/data-export/data-export.zip.ts#L67) sigue
construyendo el ZIP entero con `jszip` y materializándolo como **un `Buffer`**
(`generateAsync({ type: 'nodebuffer' })`) antes de subirlo a R2. Las fotos se descargan de R2 una
a una y se van metiendo dentro. Un vendedor con cientos de fotos más sus PDFs de factura produce
un `Buffer` que pesa lo que pesa todo eso junto → **riesgo de agotar la memoria del worker**.

**Por qué NO se hizo entonces**, y son dos razones que se sostienen la una a la otra:

1. Es un caso **extremo**: hoy no hay vendedores con catálogos de ese tamaño.
2. El arreglo **tiene coste real**. Streamear el ZIP a R2 obliga a cambiar de enfoque, y `jszip`
   se eligió precisamente porque **los tests abren el `Buffer` del ZIP para verificar su
   contenido** (`JSZip.loadAsync` en
   [`borrado-cuentas-c6-exportacion.e2e-spec.ts:319`](../apps/api/test/borrado-cuentas-c6-exportacion.e2e-spec.ts#L319)
   y en `…-c6-puertas.e2e-spec.ts:115`). Con streaming, esas barreras hay que rehacerlas.

**Por qué ahora sí es prerrequisito:** la razón 1 vale mientras el worker corre en una máquina de
desarrollo con toda la RAM del portátil. **En el despliegue el worker tiene un límite de memoria
concreto**, y el modo de fallo deja de ser hipotético: no es «va lento», es que el proceso muere.
Lo mínimo antes de exponer el servicio es **dimensionar el worker sabiendo esto** y, si el límite
es ajustado, hacer el cambio.

**Dónde vive.** `data-export.processor.ts` → `data-export.zip.ts`. Diseño:
`diseno-borrado-cuentas.md` §C6.

#### i18n T4 — accesibilidad y los restos `[DEUDA]`

Ráfaga **diseñada y no ejecutada**, documentada con línea exacta en
[`auditoria-i18n-espanol.md`](./auditoria-i18n-espanol.md) §9 (T4). T1, T2 y T3 sí se hicieron
(§0). **Reverificado el 2026-09-02, los tres grupos siguen en inglés:**

| Resto | Dónde | Verificado |
|---|---|---|
| **D9** — `TypeBadge` + `FieldFlag` (el editor de atributos) | [`AttributeSchemaEditor.tsx`](../apps/web/src/components/admin/AttributeSchemaEditor.tsx) | sí |
| **L1** — `Close` → «Cerrar» | [`ui/dialog.tsx:49`](../apps/web/src/components/ui/dialog.tsx#L49) (`<span className="sr-only">Close</span>`) | sí |
| **L2–L7** — `aria-label="Breadcrumb"` → «Ruta de navegación» | **7 apariciones**: `Breadcrumbs.tsx:40`, `anuncio/[slug]:154`, `blog:47`, `blog/[slug]:99`, `busqueda:270`, `paginas/[slug]:76`, `CategoryListingPage.tsx:453` | sí |

Es lo que **lee un lector de pantalla**, así que no es cosmético — pero tampoco bloquea nada.
El precedente ya existe en el repo (`StepCategoria.tsx:86` usa «Ruta de categoría»).
**Independiente del despliegue.** Encaja de forma natural en el Hito 9.2 (§3).

#### i18n T5 — los 38 mensajes de excepción del backend, en inglés `[DEUDA]`

Ráfaga diseñada y no ejecutada ([`auditoria-i18n-espanol.md`](./auditoria-i18n-espanol.md) §7.2 y
§9). **Reverificado el 2026-09-02:** `File type not allowed. Use JPEG, PNG or WebP.` aparece **7
veces** en `apps/api/src` (blog ×2, homepage ×2, media ×3) más la variante de logos en
`branding.constants.ts:75`. Llegan al backoffice y los ve una persona.

Trae además una decisión pendiente sobre `class-validator`: (a) `message:` en español en los DTOs
que un admin puede disparar, o (b) un `exceptionFactory` en `main.ts` que traduzca los 162 DTOs de
una vez — (b) es menos código pero traduce sobre los `constraints`, no sobre el texto, así que hay
que verlo antes de prometerlo.

**Es independiente de T1–T4 y del despliegue**; se puede hacer en paralelo con cualquier cosa.

#### Aviso al admin cuando la configuración de límites es incoherente `[DEUDA]`

`freeActiveListingLimit` y `proActiveListingLimit` son ajustes de admin y **pueden cruzarse**:
nada impide dejar el plan gratuito con más anuncios activos que el Pro.

`fix-planes` cerró la consecuencia visible —la página de precios ya no anuncia como ventaja algo
que el plan gratuito da mejor: la línea se omite si `pro <= libres`— pero **la barrera estructural
se dejó fuera a propósito**, porque el encargo era que la lista dijera la verdad sobre la
configuración, no cambiar los valores ni impedir configuraciones.

**Lo que falta:** que el backoffice avise al guardar («con este valor, el plan Pro ofrece menos
anuncios que el gratuito»). No debería *impedirlo* —puede ser deliberado y transitorio— sino
hacerlo visible en el momento de decidirlo.

> **Nota:** la ráfaga A de ajustes (§0) creó exactamente la misma clase de invariante para
> `listingExpiryDays` vs. `EXPIRY_WARNING_DAYS`, y **decidió no imponerla** —lo resolvió con
> descripción y rango recomendado en el backoffice ([expiration.service.ts:18-29](../apps/api/src/modules/expiration/expiration.service.ts#L18))—.
> Ese precedente es el molde barato para éste: describir y recomendar antes que validar.

### 4.3 Residuos de cobertura

#### Los tests de Stripe pasan con una clave inválida `[COBERTURA]` ⛔ PRERREQ

**Hallazgo del episodio de despliegue, verificado en código el 2026-09-02.**

[`stripe-subscription-renewal-e2e.e2e-spec.ts`](../apps/api/test/stripe-subscription-renewal-e2e.e2e-spec.ts)
**nunca llama a la API de Stripe.** Firma los webhooks en local con
`stripe.webhooks.generateTestHeaderString({ payload, secret })` y los verifica el backend con el
mismo `STRIPE_WEBHOOK_SECRET`, así que basta con que los dos lados coincidan. El CI lo dice sin
rodeos ([ci.yml:158-171](../.github/workflows/ci.yml#L158)) y usa
`STRIPE_SECRET_KEY: sk_test_ci_dummy_not_a_real_key`.

**Qué es y qué no es.** No es un defecto del test: la firma es **real**, no un mock, y es el mismo
molde que se usó con Redsys. Lo único que la clave hace falta para es que
`new Stripe(process.env.STRIPE_SECRET_KEY!)` no lance en el `beforeAll`. **Lo que sí es:** que la
suite **pasa con o sin Stripe**, así que verde aquí **no dice nada** sobre si las credenciales de
producción funcionan, si el `Price` existe en la cuenta real, o si el endpoint de webhook está
registrado en el dashboard.

**Por qué es prerrequisito:** es exactamente el tipo de fallo que aparece la primera vez que un
usuario real paga y no antes. **Acción concreta al desplegar:** una comprobación manual de humo
contra Stripe en modo test con las credenciales de producción — crear una Checkout Session real y
recibir un webhook real — y anotar el resultado. No hace falta automatizarla; hace falta hacerla
una vez y saber que se hizo.

*(Redsys sí se verificó contra el sandbox real con túnel `cloudflared`, y está en «Lo que NO está
aquí». Stripe es el canal que se quedó sin esa vuelta.)*

#### El camino feliz del vídeo **Pro** no se ejercita en navegador `[COBERTURA]`

**Reverificado el 2026-09-02: sigue abierto, y hay que reescribir el alcance porque el vídeo de
bloque V2 lo ha estrechado sin cerrarlo.**

**Qué SÍ cambió.** V2 (`a2244fe`) ejercita en navegador la coreografía entera —firma → `PUT`
directo a MinIO → confirm → guardar → render público— con un **MP4 sintético**
([`block-video-subido.spec.ts:32-36`](../apps/web/e2e/block-video-subido.spec.ts#L32)), que son
unos bytes con el `mimeType` correcto. Y puede hacerlo **porque el camino del bloque no tiene
límite de duración**, así que nada necesita decodificar el fichero.

**Qué sigue SIN cubrir, y es lo que el pendiente siempre fue:** el camino del **vídeo Pro de
anuncio**, que sí mide la duración real y captura el póster. Eso exige que el navegador
**decodifique** el fichero, y unos bytes no se decodifican. Sigue sin haber fixture MP4 en el repo
(`find . -iname "*.mp4"` → vacío) y el proyecto sigue sin ffmpeg — que fue la decisión de diseño
que evitó la pieza más cara. El propio
[`video-editor.spec.ts:9-18`](../apps/web/e2e/video-editor.spec.ts#L9) lo declara en su cabecera.
V2 lo dice también, y con precisión: **no cubre la captura del póster**, porque su fichero no es
decodificable y `captureVideoPoster` devuelve `null` (de paso queda probado ese respaldo).

**Qué SÍ está cubierto del vídeo Pro:** la coreografía a nivel HTTP (`video-infra.e2e-spec.ts`, 20
casos, con `PUT` **real** y rechazo de un cuerpo mayor que el firmado); el gate Pro y el flag (10
unitarios); los estados y el **rechazo temprano** en pantalla (`video-editor.spec.ts`, 7 casos,
escritorio y móvil); lo que se pinta en cada superficie (`video-visualizacion.test.tsx`, 9 casos).

**Al retomarlo:** basta con añadir un MP4 mínimo (unos pocos KB, un frame) como fixture. No
requiere ffmpeg en el proyecto —solo el fichero, generado una vez fuera—.

#### Ampliar la cobertura e2e (RD9.3, parte pendiente) `[COBERTURA]`

La parte de *«confirmar que Playwright corre en CI»* está **hecha**, y la de *«verificar en local
como verifica el CI»* también (§0, `99d7c1c`). Lo que no se ha hecho es la **pasada explícita de
cierre de huecos**. La cobertura creció orgánicamente (una spec por feature, según se construía),
no como barrido.

Huecos concretos, reverificados:

- **`queue-retry › "Retry real"` es flaky** por timing de indexación de Meilisearch (los 14
  estructurales de esa suite sí son fiables). Preexistente. **Y ahora tiene un sospechoso
  concreto:** los procesos `node` huérfanos del `reindex` (§4.2) consumen de las mismas colas.
  Conviene cerrar aquello **antes** de volver a diagnosticar éste.
- **`admin-roles.spec.ts` afirma el número exacto de ítems del nav** — frágil por diseño, y **ya
  está desincronizado otra vez**: `9890e82` movió el nav a **24 secciones**, pero
  [admin-roles.spec.ts:215-226](../apps/web/e2e/admin-roles.spec.ts#L215) titula el test «las 19
  secciones», comenta «20 = 23 totales» y asierta `20`. El aserto pasa; el texto que explica por
  qué, no describe la realidad. Al tocar `AdminNav`, actualizar las tres cuentas **y sus
  comentarios**.
- **Tests que publican por el wizard son frágiles**: dependen del flujo entero (datos, ubicación,
  geocoding, atributos, límite de plan, indexación) y un fallo en cualquier capa hace fallar el
  test sin indicar cuál. Para tests de *setup*, preferir `POST /listings` + `POST
  /listings/:id/publish` por API; reservar el wizard para los tests que prueban **el wizard**.
- **Familia `@2b`** (carrera de navegación del App Router): bug de producto conocido y
  caracterizado, hoy aislado del veredicto del CI con `continue-on-error`
  ([ci.yml:393](../.github/workflows/ci.yml#L393)). Está **tolerado, no resuelto**.

### 4.4 Residuos de producto

#### Página de tag del blog con URL propia `[DEUDA]` — SEO

**Reverificado 2026-09-02:** `apps/web/src/app/(public)/blog/` contiene solo `[slug]/`,
`layout.tsx` y `page.tsx`. El filtrado por etiqueta existe únicamente como query param
(`/blog?tag=…`, [blog/page.tsx:29](<../apps/web/src/app/(public)/blog/page.tsx#L29>) y los enlaces
de la línea 159), que **no genera una URL indexable por etiqueta**. Para un proyecto cuyo canal
principal de captación es el SEO, esto es una página de aterrizaje por tema que no existe.

#### Paginación en la portada `[DEUDA menor]` — **media entrada, reclasificada**

**La mitad «categorías» está CERRADA** (§0-bis): `/[categoria]` tiene paginación completa.

**Lo que queda no es lo que decía la entrada.** La portada ya no pide un `hitsPerPage: 8` fijo
escrito a mano: es un sistema de **bloques configurables** desde el backoffice, y cada bloque
`listings` trae su propio `limit`
([resolve-listings.ts:66](../apps/web/src/lib/home-blocks/resolve-listings.ts#L66)). O sea que el
tope ya no es una constante olvidada, es un ajuste del admin.

**Reclasificado, por tanto, a lo que de verdad falta:** que un bloque de anuncios de portada
ofrezca una **salida a la lista completa** («Ver más de esta categoría»), que es la necesidad real
—una portada es una página de aterrizaje, no un listado paginado—. Sigue siendo irrelevante con
poco volumen. Encaja en el Hito 9.1 (§2, navegación) mejor que aquí.

#### El snapshot de interlocutores en `Conversation` `[DEUDA]` — **nuevo**

**Verificado en el esquema el 2026-09-02.** `Conversation` tiene snapshot del **anuncio**
([schema.prisma:1553-1557](../apps/api/prisma/schema.prisma#L1553), `listingTitle`, molde
`Review.listingTitle`), pero **no de las personas**: `buyerId`/`sellerId` son relaciones vivas a
`User` y no hay ningún `buyerName`/`sellerName` congelado.

**El efecto.** Eliminar una cuenta no borra su fila, la **vacía** (`name` pasa a null y la interfaz
pinta «Usuario eliminado» — [ReporteDiana.tsx:33](../apps/web/src/components/admin/ReporteDiana.tsx#L33),
[ConversacionesPanel.tsx:49](../apps/web/src/components/admin/ConversacionesPanel.tsx#L49)). Así
que un hilo con una cuenta eliminada **conserva los mensajes pero pierde con quién eran**: para el
otro participante, y para el staff que revisa una denuncia, la conversación es anónima.

**Por qué importa y por qué es incoherente con lo que ya se decidió.** El proyecto ya resolvió
exactamente este problema tres veces y siempre igual: `Review.listingTitle`,
`Conversation.listingTitle` y —el más parecido— el snapshot de `Report` (`reviewComment` /
`reviewAuthorName`) tomado **al crear la denuncia**, precisamente para que borrar la valoración no
dejara la denuncia ilegible. Las notificaciones también congelan el nombre
(`notification-content.test.ts:435`). La conversación es la única superficie que se quedó fuera.

**Alcance del arreglo:** migración con dos columnas (`buyerName`/`sellerName`) escritas al crear,
más **backfill** de las conversaciones existentes. Es el molde B1 de `diseno-borrado.md` §2.4/§3.3,
ya conocido. **No es urgente** —hoy no hay volumen de cuentas eliminadas— pero **el backfill sólo
funciona mientras las cuentas sigan teniendo nombre**: cada cuenta que se elimine antes de la
migración es un hilo que ya no se puede reparar. Eso lo hace **caro de posponer, no urgente**.

#### «Responder a una valoración» no existe como función `[DEUDA de producto]` — **nuevo**

Lo destapó el ajuste 1 de la ficha de usuario / N4a. **Verificado el 2026-09-02:** no hay ningún
campo de respuesta en el modelo `Review` ni ninguna ruta en `reviews.service.ts` — un barrido de
`reply|respuesta|respond` en el módulo no devuelve nada. La propia
[`auditoria-notificaciones.md:424-427`](./auditoria-notificaciones.md) se corrige a sí misma sobre
esto: la tabla daba por supuesto que responder existía.

**Qué es y qué NO es.** **No es deuda de notificaciones.** El avisar ya funciona (N4a: la
reputación dejó de ser muda). Es una **decisión de producto sin tomar**: si un vendedor puede
contestar públicamente a una valoración que ha recibido. La auditoría lo señala como el caso más
claro de «conversación pública sobre ti» a la que hoy no se puede replicar.

**Al decidirlo:** si la respuesta es «sí», es una feature con modelo, moderación (una respuesta es
contenido público de usuario) y su propio aviso. Si es «no», se retira de la tabla de esa auditoría
para que no vuelva a leerse como una laguna.

#### Patrocinados con vídeo `[DEUDA]` — **feature nueva, no residuo**

**Reverificado 2026-09-02:** el modelo `SponsoredAd`
([schema.prisma:2819-2844](../apps/api/prisma/schema.prisma#L2819)) sigue teniendo solo `imageUrl`
y `targetUrl`.

**OJO CON LA CONFUSIÓN DE NOMBRES, que es la razón de que esto esté escrito aquí:** `SponsoredAd`
**no** son los destacados. Son dos entidades distintas y dos bloques distintos — los destacados son
anuncios de vendedores que pagan por subir (§0-bis, «rotación»), y `SponsoredAd` es publicidad del
admin. Quien lea «patrocinados» y piense en la rotación de destacados se pondrá a tocar el sitio
equivocado.

**Por qué NO se hizo.** Porque **no es un residuo, es una feature nueva**. Toca otra entidad, con
su propio diseño por delante: el flujo de subida (¿se reutiliza el prefirmado del vídeo de bloque,
que ya existe desde V1?), el gate (aquí no hay «Pro», lo sube el staff) y **cómo se enseña un vídeo
en un banner de publicidad** — que es la pregunta de producto de verdad.

**Nota que sí cambió:** V1 del vídeo de bloque construyó el mecanismo genérico
(`presignUpload`/`head`/`copy`/`delete` + `pendingPrefix`), así que la parte de infraestructura de
esta feature ya no habría que inventarla. Sigue faltando la decisión de producto.

### 4.5 Reclasificado — decisiones tomadas, no pendientes

#### ~~El límite de DURACIÓN del vídeo es blando~~ → **DECISIÓN TOMADA Y RATIFICADA**

Esto llevaba en la lista de pendientes desde el 2026-08-09 y **no es un pendiente**: es una
frontera evaluada, aceptada y **escrita en el código**, y desde el vídeo de bloque está además
**ratificada por una segunda decisión que va más lejos**.

**La decisión original (vídeo Pro).** El servidor valida la duración **declarada** por el cliente;
el navegador mide la **real** antes de subir. Un cliente manipulado podría subir cinco minutos a
bajo bitrate dentro de los 50 MB. El daño está acotado por el tamaño —que sí es infranqueable,
porque viaja dentro de la firma y lo impone el almacenamiento—, así que **lo que se escapa es un
límite de PRODUCTO, no de coste ni de seguridad**. Cerrarlo del todo exigiría parsear las cajas MP4
o traer `ffmpeg`, y ninguna vale lo que cuesta. Está documentado junto a la constante en
[`video-limits.ts:14-30`](../apps/api/src/modules/video/video-limits.ts#L14), no enterrado en un
commit.

**La ratificación (vídeo de bloque, V1).** Al diseñar el vídeo de bloque se decidió **quitar el
campo entero** en vez de repetir un límite que no se puede imponer: el contrato de
`POST /admin/block-media/video-url` **no tiene `durationSeconds`**, y mandarlo da 400. Hay barrera
explícita para ello, con el razonamiento en el propio test
([`video-bloque-v1.e2e-spec.ts:229-236`](../apps/api/test/video-bloque-v1.e2e-spec.ts#L229)):
*«el servidor no puede comprobar la duración sin ffmpeg… aquí no se finge: no existe el campo»*.

**Consecuencia práctica:** no hay nada que hacer. Si algún día se decide lo contrario, se decide
sobre estas dos entradas, no como si fuera un fleco olvidado. **Se retira del resumen por
prioridad.**

#### ~~Conectar `.env.test` al bucket `marketplace-test`~~ → **reclasificado: ya no es un cambio de repo**

**El hallazgo original era correcto** (evaluación B4): todos los tests escribían en el bucket de
desarrollo, con 8081 objetos de los cuales 8064 (99,8 %) sin dueño — 1815 PDFs de factura con
`Invoice` a 0 filas, 423 imágenes de patrocinado con `SponsoredAd` a 0.

**Qué cambió, verificado el 2026-09-02:**

- **CI: correcto.** [ci.yml:188](../.github/workflows/ci.yml#L188) usa `S3_BUCKET: marketplace-test`
  y `S3_PUBLIC_URL: …/marketplace-test`.
- **La plantilla: correcta.** [`apps/api/.env.test.example:34`](../apps/api/.env.test.example#L34)
  dice `S3_BUCKET="marketplace-test"`.
- **`.env.test` ya no se versiona** (`4929c21`), así que **no hay ningún fichero en el repo que
  arreglar**.
- **La máquina de desarrollo, todavía no.** El `.env.test` local sigue diciendo
  `S3_BUCKET="marketplace"` (línea 24).

**Por tanto:** deja de ser un pendiente del proyecto y pasa a ser **una línea de configuración
local**, en la misma categoría que las demás variables de máquina. No entra en la auditoría del
despliegue —producción usa R2, no MinIO— y no bloquea nada. Se anota aquí sólo para que quien vea
el bucket de desarrollo lleno de basura sepa por qué. El bucket local puede vaciarse a mano cuando
se quiera (`mc rb --force` y dejar que `createbuckets` lo recree): es local y desechable, y eso
**no** es el barrido descartado más arriba.

#### Preparación de producción `[DEUDA]` ⛔ PRERREQ — depende de §1

| Ítem | Estado real | Qué hay que hacer |
|---|---|---|
| **Geocoder MapTiler** | El código ya soporta ambos proveedores: *«para activar MapTiler en producción, solo `GEOCODING_PROVIDER=maptiler` + `MAPTILER_API_KEY`, cero cambios de código»* | Configurar las variables. Ojo: `NEXT_PUBLIC_MAPTILER_KEY` (frontend, tiles) y `MAPTILER_API_KEY` (backend, geocoding) son **claves distintas**; la del frontend viaja al navegador y hay que **restringirla por dominio** en el panel de MapTiler |
| **Dominio remitente de Resend** | Configurado para desarrollo | Verificar el dominio en el panel de Resend y actualizar `RESEND_FROM` |
| **Sentry en staging** | Implementado y verificado en desarrollo (silencioso con DSN vacío): `instrumentation-client.ts`, `global-error.tsx`, `main.ts` y los 6 processors | Confirmar la integración real con `NEXT_PUBLIC_SENTRY_DSN` activo. Ambas variables ya están en `.env.example` |
| **Stripe real** | Ver §4.3: la suite pasa con clave ficticia | Humo manual con credenciales reales en modo test: Checkout Session + webhook |
| **Swap atómico del reindex** | `reindex` hace `clearAll()` + repoblar → hay una **ventana breve de índice vacío** | Solo si el volumen lo justifica: indexar en un índice nuevo y hacer swap. **Ojo, antes:** el comando no termina su proceso (§4.2) |

---

### Nota, no deuda — tres rojos de e2e sin evidencia

En la primera tirada de la batería e2e de API de la ráfaga de UI del bump automático salieron **3
tests en rojo**. La salida se perdió —el propio comando la recortó con `tail`— así que **no se
observó qué suite era ni por qué falló**. La repetición completa salió limpia y el spec nuevo de
esa ráfaga pasó 17/17 en tres ejecuciones seguidas. **No se atribuye a nada.** Se anota para que,
si vuelven a aparecer tres rojos en esa batería, exista el precedente y no se dé por nuevo.

*(Contexto que ahora existe y entonces no: la auditoría de inestabilidad de Playwright y el
`reindex` que deja procesos huérfanos son dos explicaciones plausibles de rojos locales no
reproducibles. Ninguna está confirmada para este caso.)*

---

## 5. RX.2 — Facturación fiscal real `[BLOQUEADO-EXTERNO]`

**El sistema de emisión está COMPLETO a nivel de plataforma** (R1–R5: modelo, puerto, guard de
inmutabilidad por triggers de Postgres, emisión manual, cron trimestral con recuperación, panel
de admin) **y no factura de verdad.**

La emisión válida se delega, por diseño, en un proveedor homologado externo detrás del puerto
`InvoicingProvider`. Hoy el único implementado es `StubInvoicingProvider`, que emite números de
prueba `DEV-YYYY-NNNNNN` y **PDFs sellados «NO VÁLIDO FISCALMENTE»**.

**Qué falta, exactamente:**

1. Elegir el proveedor homologado (decisión de Ernest con su asesor).
2. Una clase que implemente `InvoicingProvider` (`emitInvoice(input) → { number, pdf, verifactu,
   providerRef }`).
3. Un `case` nuevo en `InvoicingModule` para el token DI `INVOICING_PROVIDER`.
4. Configuración de credenciales / variables de entorno.

No hay que tocar nada más: el puerto se diseñó justo para que este cambio fuera local.

**Decisión de negocio todavía abierta, anotada aparte:** qué hacer con un usuario que tiene
movimientos facturables pero **sin datos fiscales** cuando se le cierra la ventana de
autoservicio (`Setting fiscalSelfServiceWindow`, hoy 6 meses provisional — el plazo exacto
también está pendiente del asesor). Hoy recibe un aviso in-app y sus transacciones siguen
facturables manualmente; qué pasa al vencer la ventana no está decidido.

**Relación con el despliegue:** no lo bloquea, pero **sí condiciona qué se puede vender el primer
día**. Desplegar con el stub significa cobrar sin emitir factura válida.

---

## 6. RC.1 — Rate limit por IP sin verificar contra el proxy real `[SEGURIDAD]` ⛔ PRERREQ — depende de §1

El rate limit por IP del formulario de contacto público (`ContactRateLimitService`, 5/h) depende
de **dos supuestos, ninguno verificado**:

1. Que `app.set('trust proxy', 1)` (`TRUST_PROXY_HOPS=1`) coincida con la topología real de
   despliegue.
2. Que ese proxy **sobrescriba** `X-Forwarded-For` con la IP real del cliente, en vez de
   reenviar lo que el cliente le mande.

Si el proxy reenvía la cabecera del cliente sin más, un atacante rota su propia IP declarada y
evade el límite por IP sin ningún esfuerzo.

**Red de seguridad mientras tanto:** el **límite global** (200/h) no depende de la IP y sigue
protegiendo aunque el de IP resulte falsificable. Es el motivo por el que esto no es crítico hoy.

**Acción:** confirmar el comportamiento exacto de `X-Forwarded-For` en el proxy/CDN de producción
antes o justo después del primer despliegue de esta feature. **No se puede cerrar sin §1**, y por
eso es un prerrequisito *del mismo* despliegue: la elección de plataforma del paso 2 de §1 es la
que decide `TRUST_PROXY_HOPS`.

---

## 7. P3b — cambiar el propietario de un anuncio `[DEUDA]` — evaluado y pospuesto

Evaluado en [`diseno-editar-anuncio.md`](./diseno-editar-anuncio.md) §2, con las **ocho relaciones
que llevan la identidad del dueño** miradas una a una. **Veredicto: no se construye ahora.**

**Por qué.** La operación consiste, casi entera, en decidir cuándo NO se puede hacer: de las ocho,
**una** se reasigna (`ListingImage.uploadedById`), **tres** bloquean (bump programado —el cron
cobra al usuario de la programación—, destacado vigente, y la cuota del usuario destino) y
**cinco** no se mueven nunca porque describen hechos entre personas (compras, cobros, tratos,
valoraciones, tickets). Y no hay ninguna señal de que haga falta: el caso típico —una cuenta
duplicada— se resuelve más barato republicando el anuncio con el dueño correcto.

**Si algún día se pide**, ese §2 es el mapa: las cuatro comprobaciones previas, el conflicto
irresoluble y las cinco relaciones intocables.

### El hallazgo que sí conviene retener, aunque P3b no se haga

**Tres invariantes del dominio viven SÓLO en la aplicación, no en la base de datos:**

| Invariante | Dónde se impone |
|---|---|
| No contactar con tu propio anuncio | `messaging.service.ts:136` |
| No valorarte a ti mismo | `reviews.service.ts:52` |
| No registrar un trato contigo mismo | `listings.service.ts:810` |

`Deal` ni siquiera tiene un `@@unique` sobre el par: lo impide el servicio. Es decir, **la base
aceptaría filas que el resto del código da por imposibles**, y la bandeja depende de que no
existan — resuelve con quién hablas con `conv.buyerId === userId ? conv.seller : conv.buyer`
(`messaging.service.ts:106`).

Hoy no es un problema: ninguna ruta puede crear esas filas. Es lo que hay que saber **antes de
escribir cualquier operación que mueva identidades entre las dos puntas de una relación** —
cambiar el dueño de un anuncio, fusionar dos cuentas, importar datos. La restricción que más duele
**no está en el esquema**.

> **Conexión con §4.4:** el snapshot de interlocutores en `Conversation` es de esta misma familia
> —qué se congela y qué se sigue leyendo vivo— y sí conviene hacerlo, aunque P3b no.

---

## Resumen por prioridad

**Reverificado entrada por entrada el 2026-09-02 sobre `aca6b21`.** Agrupado por naturaleza, y con
la columna que alimenta la auditoría del despliegue.

### ⛔ Prerrequisitos del despliegue — se cierran ANTES de exponer el servicio

| # | Pendiente | Etiqueta | Por qué es prerrequisito |
|---|---|---|---|
| 4.1 | **`app.enableCors()` sin argumentos** (`main.ts:40` **y** `test/helpers/create-app.ts:37`) | `[SEGURIDAD]` | El comodín sólo importa cuando hay orígenes que no controlas |
| 6 | **Rate limit por IP sin verificar contra el proxy real** | `[SEGURIDAD]` | La plataforma que se elija decide `TRUST_PROXY_HOPS`; no se puede cerrar sin §1 |
| 4.2 | **El `reindex` no cierra sus conexiones** (la `Queue` de BullMQ que entra por `ReviewsModule`) | `[DEUDA]` | El paso 6 de §1 corre `reindex` en el despliegue, y hoy el proceso no muere |
| 4.2 | **El ZIP de exportación se arma en memoria** | `[DEUDA]` | En el worker de producción el límite de memoria deja de ser hipotético |
| 4.3 | **Los tests de Stripe pasan con clave inválida** — verde no dice nada de la integración real | `[COBERTURA]` | El fallo aparece la primera vez que alguien paga de verdad |
| 1 | **Despliegue** (contenerizar, plataforma, migraciones, workflow, seed+reindex) | `[DEUDA]` | Es el despliegue |
| 1 §7 | **Las CUATRO reglas de ciclo de vida `tmp/`** (`listing-videos`, `avatars`, `listing-previews`, `blocks-videos`) | `[DEUDA]` | Es la mitad no-código de H2; sólo se puede aplicar en la plataforma |
| 4.5 | **Preparación de producción** (MapTiler, Resend, Sentry, Stripe, swap del reindex) | `[DEUDA]` | Son variables y verificaciones que sólo existen contra un entorno real |

### Residuos de código — independientes del despliegue

| # | Pendiente | Etiqueta |
|---|---|---|
| 4.2 | `conversation:read` en tiempo real (el gateway no emite evento de lectura) | `[DEUDA]` |
| 4.2 | `DELETE /media/:id` + basura **con fila** (wizard abandonado, adjuntos de ticket) — el barrido retroactivo se evaluó y se **descartó** | `[DEUDA]` |
| 4.2 | **H-1** — el póster fijo deja fila `ListingImage` huérfana y un `-thumb.webp` que nadie borra | `[DEUDA menor]` |
| 4.2 | Los dos hermanos de `SearchService` sin `waitForTask` (`removeListing`, `reindexAll`) | `[DEUDA menor]` |
| 4.2 | **i18n T5** — 38 mensajes de excepción del backend en inglés (+ la decisión sobre `class-validator`) | `[DEUDA]` |
| 4.2 | **i18n T4** — accesibilidad: `Close`, ×7 `aria-label="Breadcrumb"`, `TypeBadge`/`FieldFlag` | `[DEUDA]` |
| 4.2 | Aviso al admin si `proActiveListingLimit <= freeActiveListingLimit` | `[DEUDA]` |

### Residuos de cobertura — independientes del despliegue

| # | Pendiente | Etiqueta |
|---|---|---|
| 4.3 | Camino feliz del **vídeo Pro** en navegador (falta fixture MP4 decodificable) — V2 cubrió el del **bloque**, no éste | `[COBERTURA]` |
| 4.3 | Cierre de huecos e2e: flake de `queue-retry`, conteo de nav en `admin-roles`, tests que publican por el wizard, familia `@2b` tolerada | `[COBERTURA]` |

### Residuos de producto — independientes del despliegue

| # | Pendiente | Etiqueta |
|---|---|---|
| 4.4 | **Snapshot de interlocutores en `Conversation`** (migración + backfill) — barato ahora, irreparable después | `[DEUDA]` |
| 4.4 | **«Responder a una valoración» no existe** — decisión de producto, **no** deuda de notificaciones | `[DEUDA]` |
| 4.4 | Página de tag del blog con URL propia (SEO) | `[DEUDA]` |
| 4.4 | **Patrocinados con vídeo** — feature NUEVA sobre `SponsoredAd` (**no** los destacados) | `[DEUDA]` |
| 4.4 | Salida «Ver más» desde un bloque de anuncios de la portada (media entrada, la otra mitad cerrada) | `[DEUDA menor]` |
| 7 | P3b — cambiar el propietario de un anuncio (evaluado y **pospuesto**) | `[DEUDA]` |
| 2 | Hito 9.1 — Navegación y flujos | `[DEUDA]` |
| 3 | Hito 9.2 — Interfaz, estilo y contenido (recoge T4) | `[DEUDA]` |

### Bloqueado por terceros

| # | Pendiente | Etiqueta | Bloqueado por |
|---|---|---|---|
| 5 | Facturación fiscal real (hoy `StubInvoicingProvider`, PDFs «NO VÁLIDO FISCALMENTE») | `[BLOQUEADO-EXTERNO]` | Proveedor homologado + decisión del asesor |

### Salió de la lista en este repaso

| Qué era | Qué pasó |
|---|---|
| `Setting` decorativos (`listingExpiryDays` confirmado) | **CERRADO** — ráfaga A de ajustes (`60c3fe4`); los dos muertos conectados y el estático eliminado |
| Paginación en categorías | **CERRADO** — `CategoryListingPage.tsx:339,588-606` |
| Paginación en la portada | **RECLASIFICADO** — la portada son bloques con `limit` de admin; lo que falta es la salida «Ver más» (§4.4) |
| Límite de duración del vídeo blando | **DECISIÓN TOMADA** — documentada en `video-limits.ts:14-30` y **ratificada** por V1 del vídeo de bloque, que quitó el campo entero con barrera |
| Conectar `.env.test` al bucket `marketplace-test` | **RECLASIFICADO** — CI y `.env.test.example` ya correctos, el fichero ya no se versiona; queda como configuración de máquina |
| `allowedDevOrigins` | **Sigue abierto pero NO es prerrequisito** — sólo actúa en `next dev` |

---

## Lo que NO está aquí

Para que este documento signifique algo, conviene decir qué se excluyó deliberadamente:

- **Documentación desfasada.** Describen el plan original y ya no coinciden con lo construido.
  **Reverificado el 2026-09-02 con `git log -1` por fichero**, y el estado no es uniforme:

  | Documento | Último toque | Estado |
  |---|---|---|
  | `diseno-busqueda-y-tags.md` | `269d998`, 2026-08-04 | **Sin tocar desde la auditoría** |
  | `diseno-backoffice.md` | `3115365`, 2026-08-04 | **Sin tocar** — y ya documenta 3 settings cuando el backoffice va por 24 secciones |
  | `diseno-blog.md` | `bcbbece`, 2026-08-04 | **Sin tocar** |
  | `diseno-valoraciones.md` | `60da2e3`, 2026-08-04 | **Sin tocar** — y le falta el hallazgo de §4.4 (responder no existe) |
  | `diseno-facturacion.md` §16.2 | `60da2e3`, 2026-08-04 | **Sin tocar** |
  | `contratos-api.md` | `e71cb73`, 2026-09-01 | **Parcialmente al día** (el vídeo de bloque sí entró); el resto, no auditado |
  | `estrategia-testing.md` | `99d7c1c`, 2026-08-29 | **Parcialmente al día** (`test:e2e:ci` sí entró); sigue diciendo que `.env.test` fija el bucket de test, que ya no se versiona |

  Eso **no es trabajo pendiente de producto**: se arregla escribiendo, y va en su propia tanda. Se
  conserva aquí porque el número «seis documentos» seguía citándose sin comprobar.

- **Deuda ya cerrada** que alguna vez estuvo en una lista de pendientes: Redsys E2E (verificado
  contra el sandbox real con túnel `cloudflared` — **Stripe no tuvo esa vuelta**, ver §4.3), el
  flaky de indexación de Meilisearch (cerrado en su causa raíz con `waitForTask`), el aislamiento
  de las corridas e2e (candado compartido en `apps/api/test/e2e-lock.js`), y la saga del CI.

- **Decisiones tomadas de no hacer algo.** El aislamiento de la base de test por worker de Jest se
  evaluó en el Hito 9 y **se decidió no hacerlo**, a cambio de una orquestación no trivial.
  **La decisión sigue en pie; su aritmética no.**

  Aquella cuenta —«la suite tarda 110 s en serie y el paralelismo ahorraría ~60-70 s»— es de
  cuando la batería eran 33 suites y 564 tests. **Medido el 2026-08-27 sobre `main`: 163 suites,
  2 476 tests, ~8,5 min en serie** (`--runInBand`; cuatro corridas entre 490 s y 523 s). O sea que
  lo que se está renunciando a ahorrar es del orden de **minutos, no de segundos**.

  Se actualiza **el número, no la decisión** — que es de Ernest y no se rediscute aquí. Pero quede
  escrito que el argumento «la suite es corta» ya no se sostiene solo. Y hay una alternativa a
  medio camino ya propuesta y no hecha, anotada en [`ci.yml`](../.github/workflows/ci.yml):
  repartir **Playwright** en shards de matriz, donde cada job trae sus propios contenedores de
  servicio y el estado compartido deja de obligar a `workers: 1`.

- **El límite de duración del vídeo** (§4.5) y **el bucket de tests local** (§4.5), que estaban en
  el resumen por prioridad y no eran pendientes. Se quedan documentados dentro, no en la lista.
