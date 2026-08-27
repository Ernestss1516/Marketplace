# Pendientes reales del proyecto

> Lo que queda por **CONSTRUIR** (no documentación desfasada). Verificado contra código el
> 2026-08-09, rama `main`, commit `842ea24`; **repasado el 2026-08-27 sobre `42bd104`** para
> cerrar los bloques terminados y anotar los dos residuos que quedan (§4.2, «Los dos residuos
> vivos»).
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

**Regla de mantenimiento:** cuando un punto se cierre, se borra de aquí y se documenta en
`estado-tecnico.md`. Este fichero solo contiene lo abierto — si crece indefinidamente, es que no
se está manteniendo.

---

## 1. Despliegue (MVP R6.1–R6.3) — el proyecto NUNCA se ha desplegado `[DEUDA]`

Es el pendiente más antiguo del proyecto y el único que bloquea a varios de los demás (§4
«preparación de producción» y §6 dependen de que exista un entorno real).

**Lo que se comprobó:**

- No existe ningún `Dockerfile` en el repositorio (ni en `apps/api`, ni en `apps/web`, ni en la
  raíz).
- No existe `fly.toml`, `vercel.json`, ni ningún manifiesto de plataforma.
- `.github/workflows/` contiene **únicamente** `ci.yml` (lint/typecheck + e2e). No hay workflow
  de despliegue.
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
   `.env.example` de cada paquete.
5. **Workflow de despliegue** en GitHub Actions, encadenado al `ci.yml` que ya existe y funciona.
6. **Semilla y reindexado inicial.** Tras el primer despliegue: `seed` (árbol de categorías,
   admin, settings) y `pnpm --filter @marketplace/api reindex` para poblar Meilisearch.
7. **Las dos reglas de ciclo de vida del bucket** (huérfanas H2 — **el código ya está puesto
   desde el 2026-08-23**: lo no confirmado vive bajo `tmp/` y lo confirmado sale de ahí; ver
   [`diseno-huerfanas-sin-fila.md`](./diseno-huerfanas-sin-fila.md) §9.5): caducar a **1 día**
   lo que quede bajo `listing-videos/tmp/` y bajo `avatars/tmp/`. Es lo que recoge las subidas
   que nunca llegaron a confirmarse —un vídeo abandonado pesa hasta 50 MB—, y es **seguro por
   construcción**: bajo `tmp/` no vive nada confirmado, porque confirmar copia el objeto fuera.
   Un día es el suelo (la expiración se expresa en días enteros) y sobra: la URL prefirmada dura
   10 minutos. **No se puede probar en CI** —una caducidad se mide en días—, así que depende de
   que se aplique aquí; hasta entonces la basura se acumula confinada a esos dos prefijos, que
   se pueden vaciar a mano sin riesgo.

**Consecuencia de no tenerlo:** hay comportamiento que solo se puede validar en un entorno real y
que hoy está sin validar — §4 (preparación de producción), §6 (rate limit por IP) y la
verificación de Sentry en staging.

---

## 2. Hito 9.1 — Navegación y flujos (RN9.1–RN9.2) `[DEUDA]`

**Sin empezar.** Ninguna de las dos ráfagas se ha ejecutado.

- **RN9.1 (Opus):** auditar los flujos de usuario —mapa de pantallas y transiciones— y diseñar
  las correcciones de navegación: callejones sin salida, migas de pan, estados vacíos,
  coherencia entre secciones.
- **RN9.2 (Sonnet):** implementar las correcciones priorizadas.

**Insumos disponibles:** `docs/personas-y-wireframes.md` (las personas siguen siendo válidas) y
`docs/mapa-pantallas-flujos.md` (histórico del MVP — la superficie actual es mucho mayor: 18
secciones de backoffice y 10 rutas de área privada, frente a las 6 y 5 que documenta).

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

---

## 4. Hito 9.3 — Deuda transversal: MIXTO (parte cerrada, parte abierta)

### 4.1 Ya cerrado — no rehacer

| Ítem | Dónde quedó |
|---|---|
| CORS del gateway WebSocket restringido a `APP_URL` | [messaging.gateway.ts:55](../apps/api/src/modules/messaging/messaging.gateway.ts#L55) — `cors: { origin: [appOrigin()] }`, en forma de **array de un elemento** (con cadena, el paquete `cors` no compara) |
| AuditLog atómico | RF.12b — `log(dto, tx?)` acepta `Prisma.TransactionClient` |
| Reintento de slug ante colisión P2002 | Resuelto (ver `estado-tecnico.md` §3) |
| Reintentos del job `geocode` | Resuelto — la causa no era la cola sino que `GeocodingService.geocode()` se tragaba los fallos transitorios como `null` |
| Playwright corriendo en CI | [ci.yml](../.github/workflows/ci.yml) — steps de señal (`--grep-invert @2b`) y `@2b` separados |
| La saga del CI | Cerrada y verificada **en el runner**: corrida `30930395538`, SHA `e4df671` |
| **CI sin unit tests del backend** | [ci.yml](../.github/workflows/ci.yml) — paso `Backend unit — Jest`. Verde en local **antes** de añadirlo (17/17 suites, 164/164 tests) y confirmado **en el runner**: corrida `31028999515`, SHA `b0c5916`, step `success` en 15 s |
| **`Report.reviewId` en `Cascade`** — 7b lo neutralizó, esto lo **RESUELVE** | [schema.prisma](../apps/api/prisma/schema.prisma) — `SetNull` + snapshot (`reviewComment` / `reviewAuthorName`), tomado **al CREAR** la denuncia (molde B1, `diseno-borrado.md` §2.4/§3.3), con backfill en [`20260822230000_report_sobrevive_borrado_valoracion`](../apps/api/prisma/migrations/20260822230000_report_sobrevive_borrado_valoracion/migration.sql). Barrera en [`borrado-denuncia-valoracion.e2e-spec.ts`](../apps/api/test/borrado-denuncia-valoracion.e2e-spec.ts): borrar la valoración deja la denuncia viva y legible. Cierra el riesgo 5 de B1 |

### 4.1-bis Bloques terminados desde el último repaso (2026-08-27) — **no reabrir**

Ninguno de estos estaba listado como abierto aquí (se llevaban por su propio encargo y su
propia auditoría), pero conviene que quede el rastro: son cinco cuerpos completos, y sin esta
tabla la próxima sesión no tiene forma de saber que ya están cerrados. **El detalle vive en
`estado-tecnico.md`; aquí sólo el qué y el commit.**

| Bloque | Qué cierra | Commits |
|---|---|---|
| **Rotación de destacados** (auditoría + diseño + R1–R4, P2B, H9) | El bloque «Promocionados» ya no está congelado: rota por ventana de 15 min y **todos** los destacados tienen turno. La promesa del diálogo es honesta (el turno, con la cifra real `vigentes+1`), el comprador ve «Publicidad», y el mapa deja de pagar una consulta que no usa | `2cfe103` · `99be311` · `4f2dd4d` · `9616d7d` · `9c0e809` · `0563d27` |
| **Borrado de cuentas** (auditoría + diseño + C1–C6) | Archivar / eliminar / exportar, **6/6**. El usuario se va sin perderlo todo y se lleva sus datos sin llevarse los de otros. De paso cerró tres huecos anteriores: los **8 `Cascade`** peligrosos, el **`BANNED` visible** en el escaparate y `forgotPassword` sin gate | `5c1baef` · `0ea6b7b` · `e17642f` · `b7de4be` · `89a5910` · `5616823`/`f7612ee` |
| **Deuda de test/CI** (auditoría + A1–A3) | Las tres fuentes de rojos fantasma: Google Fonts fuera del build (A3), la carrera de conteo de jobs de BullMQ (A1) y el aislamiento de `Setting` con helper y barrera de corrida (A2) | `6af69b3` · `459fcc0` · `195e012` |
| **Residuo `BANNED`** | Banear **pausa** los anuncios igual que el archivado (y reinstaurar **no** los restaura: devuelve el acceso, no la visibilidad). El enum de origen distingue ban de archivado, así que desarchivar no reactiva lo que pausó una sanción | `d422d22` |
| **Póster animado** (diseño + P1 + P2) | El hover-preview del vídeo, resuelto como **sprite** —una imagen fija, no un `<video>`—, así que no traiciona el diseño del vídeo. Cerró de paso **H-2** (`removeVideo` dejaba el póster huérfano en el bucket) y añadió el barrido de favoritos | `3e93c95` · `42bd104` |

### 4.2 Abierto

#### `app.enableCors()` sin argumentos — la API HTTP abierta a cualquier origen `[SEGURIDAD]`

[apps/api/src/main.ts:40](../apps/api/src/main.ts#L40)

```ts
app.enableCors();   // ← sin argumentos: Access-Control-Allow-Origin para cualquiera
```

Es **la otra mitad** del problema de CORS que R9 cerró en el gateway WebSocket, y se dejó fuera
de aquella ráfaga **a propósito**: su radio de explosión es toda la API HTTP (no un gateway), y
meter los dos cambios juntos habría roto la lección de los dos pasos — si algo se cae, no sabes
cuál de los dos fue. Merece su propia ráfaga con su propia verificación.

También presente en `createTestApp` (los tests replican el bootstrap).

Sin vender más de lo que es, con el mismo criterio que se aplicó al gateway: **el control de
acceso es el JWT, no el CORS**, y el CORS no protege frente a un cliente que no sea un navegador.
Cerrarlo es higiene — quitar el comodín del inventario — no el cierre de un exploit conocido.

#### `allowedDevOrigins` ausente de la configuración de Next `[DEUDA]`

[apps/web/next.config.ts](../apps/web/next.config.ts) — la clave no aparece. Solo afecta a
desarrollo cuando se accede al dev server por IP (por ejemplo, para probar desde el móvil en la
misma red); Next avisa y bloquea recursos de dev.

#### Sin paginación en el home ni en categorías `[DEUDA]`

[apps/web/src/app/(public)/page.tsx:23](<../apps/web/src/app/(public)/page.tsx#L23>) — la portada
pide `search({ sort: 'publishedAt:desc', hitsPerPage: 8 })`, un tope fijo sin navegación a más
resultados. Mismo patrón en el listado de categorías. Irrelevante con poco volumen; visible en
cuanto lo haya.

#### `conversation:read` por WebSocket — deuda que el Hito 7.1 declaraba cerrar y no cerró `[DEUDA]`

El gateway **no emite ningún evento de lectura**: sus emisiones son `message:new`,
`ticket:message` y `error`
([messaging.gateway.ts](../apps/api/src/modules/messaging/messaging.gateway.ts)). El marcado de
leído ocurre solo por REST, al abrir la conversación:

[apps/api/src/modules/messaging/messaging.service.ts:133](../apps/api/src/modules/messaging/messaging.service.ts#L133)

```ts
where: { conversationId: id, senderId: { not: userId }, readAt: null },
data: { readAt: new Date() },
```

**Efecto para el usuario:** el contador de no leídos de la bandeja no baja hasta que se recarga o
se reabre la conversación.

**Relacionado — un test en rojo preexistente, ya diagnosticado a medias:**
`mensajeria-unificada.spec.ts` (~línea 241) falla porque el badge de no leídos no llega a mostrar
`4` tras recibir un mensaje. Verificado en HEAD limpio: **no es regresión de R9**, y el resto del
test —incluida la llegada de mensajes por socket en tiempo real— pasa. Es decir: la conexión y el
transporte funcionan; lo que falla es la **semántica del contador**. Es muy probable que este
rojo y este pendiente sean la misma cosa, así que conviene atacarlos en la misma ráfaga.

#### `DELETE /media/:id` + recolección de huérfanas — deuda que el Hito 7.2 declaraba cerrar y no cerró `[DEUDA]`

[apps/api/src/modules/media/media.controller.ts](../apps/api/src/modules/media/media.controller.ts)
expone exactamente dos rutas: `@Post('upload')` (línea 25) y `@Post('upload-avatar')` (línea 49).
No hay `@Delete` de ningún tipo.

**Efecto:** las imágenes de wizards abandonados quedan huérfanas para siempre, en el bucket y en
la tabla `ListingImage`.

**Nota de alcance al retomarlo:** los adjuntos de ticket tienen exactamente la misma deuda
(`TicketAttachment` → objeto en R2), y hoy no puede materializarse porque no existe ningún
endpoint que borre tickets, mensajes ni usuarios. Si se añade cualquiera de los tres, hay que
borrar también del bucket.

**TERCERA FUENTE (2026-08-09) — el vídeo Pro.** La subida de vídeo es en dos tiempos: el
navegador sube directo a R2 con una URL prefirmada y **después** confirma, que es cuando el
anuncio queda enlazado. Una subida interrumpida entre ambos pasos —red caída, pestaña cerrada—
deja un objeto en el bucket que **nadie referencia**. Es deliberado por el lado de la
corrección: un huérfano no se muestra en ninguna parte, y `VideoService` **sí** borra el vídeo
anterior al sustituirlo y al quitarlo (`deleteObjectByUrl`). Lo que falta es la recolección de
los que nunca llegaron a confirmarse, y pesan bastante más que una foto (hasta 50 MB cada uno).

Conviene resolver las **tres** con el mismo mecanismo.

**ACTUALIZACIÓN (2026-08-19) — evaluado en `diseno-borrado.md` §7, veredicto: NO barrer.**

Lo que **ya está cerrado** por B3: al eliminar un anuncio (staff) y al descartar un borrador
(dueño) se encolan sus ficheros de R2 —originales, **miniaturas derivadas** y vídeo con su
póster— en la cola `media-cleanup`. La fuente de huérfanos *por borrado de anuncio* ya no
existe.

**~~SEXTA FUENTE (2026-08-21) — quitar una foto de un anuncio VIVO.~~ CERRADA por 2b, en la
misma ráfaga que la descubrió.** No estaba en esta lista, y era la única que se disparaba en
la **operación normal**: editar un anuncio quitando una foto la desvinculaba (`listingId:
null`) y ahí moría — la fila quedaba suelta y sus **dos** objetos de R2 sin dueño. Por los
DOS caminos, el del dueño y el del staff. Ahora quitar una foto la **borra** y encola sus
claves, desde `ListingImagesService`, que es el único sitio por el que unas fotos entran o
salen de un anuncio. Ver `diseno-editar-anuncio.md` §5.3.

*(Y no la habría visto un barrido: la fila desvinculada era indistinguible de un wizard
abandonado — el mismo problema que ya condenaba a B4. Cerrar la fuente sí funcionaba,
porque actúa sobre las filas que acaban de salir de un anuncio conocido.)*

Lo que **sigue abierto**, y son dos problemas distintos que esta entrada mezclaba:

- **Basura CON fila** (imágenes de wizard abandonado, adjuntos de ticket): el fichero **sí**
  está referenciado, así que un barrido «bucket menos base de datos» no la ve. Se detecta con
  una consulta (`ListingImage WHERE listingId IS NULL AND createdAt < umbral`), no recorriendo
  el bucket. **Ojo, y es lo importante:** esa consulta, tal cual, **borraría la portada del
  blog**. Toda la imaginería del blog sube por `POST /media/upload` (`PostForm.tsx`,
  `MarkdownEditor.tsx`) y vive como `ListingImage` con `listingId = null` bajo `media/` —
  indistinguible de un wizard abandonado. Verificado en la base de datos actual.
- **Basura SIN fila** (vídeo sin confirmar, y dos fuentes más que no estaban en esta lista):
  el **avatar sustituido** (`media.service.ts:47` sube el nuevo y nunca borra el viejo) y las
  imágenes de `blocks/`, `homepage/` y `sponsored/`, que suben directo a R2 sin fila propia y
  quedan sueltas al quitar el bloque del `Json`.
  **DISEÑADO (2026-08-22) — [`diseno-huerfanas-sin-fila.md`](./diseno-huerfanas-sin-fila.md)**.
  Al verificarlo salieron **cinco** fugas y no tres —el avatar son dos: la sustitución y la
  subida que nunca se guarda— y una trampa: confirmar un vídeo **no lo mueve de prefijo**, así
  que la regla de caducidad «obvia» habría borrado los vídeos vivos.
  - **~~H1 «lo que se suelta»~~ — CERRADA (2026-08-23).** Avatar sustituido, imágenes de bloque
    del blog y de la portada, e imagen de patrocinado: diff de URLs propias sobre el valor
    entero (`ownUrlsDeep`/`releasedUrls` en `media-keys.ts`) → comprobación de que no queda otro
    dueño → cola `media-cleanup` de B3. Tres de las cinco fugas, sin tocar infraestructura.
    Barreras en `apps/api/test/huerfanas-h1.e2e-spec.ts`.
  - **~~H2 «lo que nunca se confirma»~~ — CERRADA EN CÓDIGO (2026-08-23).** El vídeo se firma
    bajo `listing-videos/tmp/<listingId>/…` y el avatar se sube a `avatars/tmp/<userId>/…`;
    confirmar (o guardar el perfil) **copia** el objeto al prefijo de siempre con
    `R2Service.copy`, así que lo confirmado nunca se queda en `tmp/` y los ya confirmados **no
    migran**. Con las tres decisiones de orden: compensar si la fila falla tras copiar, borrado
    del temporal como cortesía, y confirmación idempotente. Barreras en
    `apps/api/test/huerfanas-h2.e2e-spec.ts` (contra MinIO, con `r2.head`).
    **Falta la mitad que no es código:** la regla de ciclo de vida sobre los dos prefijos
    `tmp/` — paso 7 de §1. Hasta que se aplique en el despliegue, la basura se acumula igual
    pero **confinada** a dos prefijos donde nada vivo puede estar (y por eso vaciarlos a mano
    es seguro).

**Por qué no se barre ahora:** no hay basura de producción que recoger (no hay producción), el
riesgo de falso positivo está demostrado y es irreversible, y las clases que un barrido sí
vería tienen la **fuente todavía abierta** —limpiarlas hoy es fregar con el grifo abierto—.
El orden correcto es **cerrar primero las fuentes** (prevención, como B3) y sólo después
plantearse recoger un conjunto ya finito. Detalle completo y las salvaguardas que necesitaría
un barrido seguro, en `diseno-borrado.md` §7.6–§7.7.

#### El bucket de tests está declarado pero no conectado `[DEUDA]` — hallazgo de la evaluación B4

[docker-compose.yml:66](../docker-compose.yml#L66) anuncia y crea `marketplace-test` como
«bucket de tests (Playwright + backend e2e con `S3_BUCKET=marketplace-test`)», pero
[apps/api/.env.test:20](../apps/api/.env.test#L20) dice `S3_BUCKET="marketplace"`. Ese fichero
lo cargan **las dos** suites (`test/load-env.ts` y `playwright.config.ts:10`), así que todos
los tests escriben en el bucket de **desarrollo**. `marketplace-test` está vacío.

**Efecto medido:** 8081 objetos en el bucket de desarrollo, de los cuales **8064 (99,8 %) sin
dueño** — entre ellos 1815 PDFs de factura con la tabla `Invoice` a 0 filas, y 423 imágenes de
patrocinado con `SponsoredAd` a 0. No es basura de la plataforma: es un mes de corridas de e2e
sobre una base de datos que sí se reinicia y un bucket que no.

**Arreglo:** una línea en `.env.test`. Es barato y devuelve significado al contenido del bucket
de desarrollo, que hoy no se puede leer para nada. El bucket de desarrollo puede vaciarse a
mano cuando se quiera (`mc rb --force` y dejar que `createbuckets` lo recree): es local y
desechable, y eso **no** es el barrido descartado arriba.

#### Página de tag del blog con URL propia — deuda que el Hito 7.2 declaraba cerrar y no cerró `[DEUDA]`

`apps/web/src/app/(public)/blog/` contiene solo `[slug]/` y `page.tsx`. El filtrado por etiqueta
existe únicamente como query param (`/blog?tag=…`), que **no genera una URL indexable por
etiqueta**. Para un proyecto cuyo canal principal de captación es el SEO, esto es una página de
aterrizaje por tema que no existe.

#### Preparación de producción `[DEUDA]` — depende de §1

| Ítem | Estado real | Qué hay que hacer |
|---|---|---|
| **Geocoder MapTiler** | El código ya soporta ambos proveedores. `estado-tecnico.md`: *«Para activar MapTiler en producción: solo `GEOCODING_PROVIDER=maptiler` + `MAPTILER_API_KEY`, cero cambios de código»* | Configurar las variables. Ojo: `NEXT_PUBLIC_MAPTILER_KEY` (frontend, tiles) y `MAPTILER_API_KEY` (backend, geocoding) son **claves distintas**; la del frontend viaja al navegador y hay que **restringirla por dominio** en el panel de MapTiler |
| **Dominio remitente de Resend** | Configurado para desarrollo | Verificar el dominio en el panel de Resend y actualizar `RESEND_FROM` |
| **Sentry en staging** | Implementado y verificado en desarrollo (silencioso con DSN vacío): `instrumentation-client.ts`, `global-error.tsx`, `main.ts` y los 6 processors | Confirmar la integración real con `NEXT_PUBLIC_SENTRY_DSN` activo. Ambas variables ya están en `.env.example` |
| **Swap atómico del reindex** | `reindex` hace `clearAll()` + repoblar → hay una **ventana breve de índice vacío** | Solo si el volumen lo justifica: indexar en un índice nuevo y hacer swap |

#### Ampliar la cobertura e2e (RD9.3, parte pendiente) `[DEUDA]`

La parte de *«confirmar que Playwright corre en CI»* está **hecha**. Lo que no se ha hecho es la
**pasada explícita de cierre de huecos**. La cobertura actual creció orgánicamente (una spec por
feature, según se construía), no como barrido: hay 92 suites e2e de backend y 44 specs de
Playwright, pero nadie ha auditado qué falta.

Huecos concretos ya anotados en `estado-tecnico.md`:

- **`queue-retry › "Retry real"` es flaky** por timing de indexación de Meilisearch (los 14
  estructurales de esa suite sí son fiables). Preexistente.
- ~~**`search-dynamic-attributes` es flaky** por los ajustes del índice de Meilisearch.~~
  **CERRADO (2026-08-22).** Puso `main` en rojo una vez y la causa era concreta:
  `updateSettings` **no aplica** los ajustes, los **encola** y devuelve un `taskUid`, así que
  el `await` sólo esperaba a que Meili aceptara el encargo. `applyFilterableAttributes` era el
  ÚNICO método de `SearchService` sin `waitForTask` — sus tres hermanos ya lo hacían, con la
  razón escrita. Arreglado con esa línea, y con una barrera que **le pone cola a Meili a
  propósito** para que la carrera sea reproducible: sin ese lastre el test pasaba igual con el
  arreglo revertido (5 de 5), o sea que habría sido decorativo.
  *(Quedan dos hermanos con la misma forma y sin tocar, señalados aquí para no perderlos:
  `SearchService.removeListing` —`deleteDocument` sin esperar, mismo flake en potencia para un
  «ya no está en la búsqueda»— y `reindexAll` —`addDocuments` sin esperar, sólo afecta al
  comando offline `pnpm reindex`—.)*
- **`admin-roles.spec.ts` afirma el número exacto de ítems del nav** — frágil por diseño, y llegó
  a estar desactualizado en 2 sin que nadie lo notara. Al tocar `AdminNav`, actualizar las tres
  cuentas.
- **Tests que publican por el wizard son frágiles**: dependen del flujo entero (datos, ubicación,
  geocoding, atributos, límite de plan, indexación) y un fallo en cualquier capa hace fallar el
  test sin indicar cuál. Para tests de *setup*, preferir `POST /listings` + `POST
  /listings/:id/publish` por API; reservar el wizard para los tests que prueban **el wizard**.
- **Familia `@2b`** (carrera de navegación del App Router): bug de producto conocido y
  caracterizado, hoy aislado del veredicto del CI con `continue-on-error`. Está **tolerado, no
  resuelto**.
- **El camino feliz del vídeo Pro no se ejercita en navegador** (2026-08-09). Ver el punto propio más abajo.

#### `Setting` decorativos: ajustes de admin que no lee nadie `[DEUDA]`

**Caso confirmado: `listingExpiryDays`.** Está sembrado con valor 60
([seed.ts](../apps/api/prisma/seed.ts), [seed-test.ts](../apps/api/prisma/seed-test.ts)),
whitelisted para edición ([admin.service.ts](../apps/api/src/modules/admin/admin.service.ts))
y **editable desde el backoffice**
([ajustes/page.tsx](../apps/web/src/app/(admin)/admin/ajustes/page.tsx)) — pero la caducidad
real sale de la constante `EXPIRY_DAYS = 60`
([expiration.service.ts:9,50-52](../apps/api/src/modules/expiration/expiration.service.ts)).
Verificado buscando `listingExpiryDays` en todo `apps/api/src` y `apps/web/src`: **ninguna
lectura**, solo la whitelist y la interfaz. Un admin puede cambiarlo, ver que se guarda, y no
cambiar nada.

**Es la misma clase de defecto que ya se ha cerrado dos veces**, y por eso se anota como patrón y
no como caso suelto:

- UXV.6/M4 — la lista de beneficios Pro de `/planes` estaba escrita a mano y **callaba** los dos beneficios que más se notan (destacados y bumps gratis), mientras un admin cambiaba esas cuotas sin efecto en la página.
- `fix-planes` — la línea de «anuncios activos» se emitía siempre, sin comparar los dos límites configurables que la sostienen.

**Propuesta, sin comprometer nada:** una auditoría acotada de «qué `Setting` de
`SETTING_KEYS` se leen de verdad y cuáles son decorativos». Es mecánica —una búsqueda por clave—
y el resultado permite decidir por cada uno si se cablea o se retira del backoffice. Dejar un
ajuste que no hace nada es peor que no tenerlo: promete un control que no existe.

#### Aviso al admin cuando la configuración de límites es incoherente `[DEUDA]`

`freeActiveListingLimit` y `proActiveListingLimit` son ajustes de admin y **pueden cruzarse**:
nada impide dejar el plan gratuito con más anuncios activos que el Pro.

`fix-planes` cerró la consecuencia visible —la página de precios ya no anuncia como ventaja algo
que el plan gratuito da mejor: la línea se omite si `pro <= libres`— pero **la barrera estructural
se dejó fuera a propósito**, porque el encargo era que la lista dijera la verdad sobre la
configuración, no cambiar los valores ni impedir configuraciones.

**Lo que falta:** que el backoffice avise al guardar («con este valor, el plan Pro ofrece menos
anuncios que el gratuito»). No debería *impedirlo* —puede ser deliberado y transitorio— sino
hacerlo visible en el momento de decidirlo. Hoy el único síntoma es una línea que desaparece de
`/planes`, y eso no lo ve quien está tocando el ajuste.

#### El camino feliz del vídeo Pro no se ejercita en navegador `[DEUDA de cobertura]`

**Qué NO está cubierto:** elegir un MP4 real en el editor, que el navegador lo decodifique, leer
su duración, capturar el póster y completar la subida. **La razón es concreta y no es pereza:**
no hay fixture de vídeo en el repo y el proyecto **no trae `ffmpeg`** —esa fue precisamente la
decisión de diseño que evitó la pieza más cara—, así que no hay forma honesta de generar uno.

**Qué SÍ está cubierto**, y es la mayor parte:

- La coreografía completa a nivel HTTP (`video-infra.e2e-spec.ts`, 20 casos), incluido un `PUT` **real** contra el almacenamiento y la comprobación de que un cuerpo mayor que el firmado se rechaza.
- El gate Pro y el flag (10 casos unitarios).
- Los estados y el **rechazo temprano** en pantalla (`video-editor.spec.ts`, 7 casos, escritorio y móvil): un PNG y un fichero de 51 MB se rechazan **sin que salga la petición de firma**.
- Lo que se pinta en cada superficie (`video-visualizacion.test.tsx`, 9 casos).

**Al retomarlo:** basta con añadir un MP4 mínimo (unos pocos KB, un frame) como fixture de test.
No requiere ffmpeg en el proyecto —solo el fichero, generado una vez fuera— y con él la batería
podría cubrir el tramo que falta. Queda anotado en la cabecera de la propia batería.

#### El límite de DURACIÓN del vídeo es blando `[DEUDA menor / conocido]`

El servidor valida la duración **declarada** por el cliente; el navegador mide la **real** antes
de subir. Ninguna de las dos es infalible sola: la del cliente la salta un cliente manipulado, y
la del servidor confía en el número.

**Un cliente modificado podría subir cinco minutos a bajo bitrate dentro de los 50 MB.** El daño
está acotado por el tamaño —que sí es infranqueable, porque viaja dentro de la firma y lo impone
el almacenamiento—, así que **lo que se escapa es un límite de PRODUCTO, no de coste ni de
seguridad**: el usuario tendría un vídeo más largo en su propio anuncio.

Cerrarlo del todo exigiría parsear las cajas MP4 del fichero subido o traer `ffmpeg`, y ninguna
de las dos vale lo que cuesta para eso. Está documentado en
[`video-limits.ts`](../apps/api/src/modules/video/video-limits.ts), junto a la constante, y no
enterrado en un commit.

---

### Los dos residuos vivos (2026-08-27)

Lo único que quedó abierto de los cinco bloques de §4.1-bis. **Se anotan con su porqué, no
sólo con su qué**: los dos se dejaron fuera por una decisión, y sin el razonamiento la próxima
sesión los redescubre y los vuelve a evaluar desde cero.

#### 1 · El ZIP de exportación se arma **en memoria** `[DEUDA]` — residuo de C6

**Qué es.** [`data-export.zip.ts:44-72`](../apps/api/src/modules/data-export/data-export.zip.ts#L44)
construye el ZIP entero con `jszip` y lo materializa como **un `Buffer`**
(`generateAsync({ type: 'nodebuffer' })`) antes de subirlo a R2. Las fotos se descargan de R2
una a una y se van metiendo dentro. Un vendedor con cientos de fotos más sus PDFs de factura
produce un `Buffer` que pesa lo que pesa todo eso junto → **riesgo de agotar la memoria del
worker** en un caso extremo.

**Por qué NO se hizo ahora**, y son dos razones que se sostienen la una a la otra:

1. Es un caso **extremo**: hoy no hay vendedores con catálogos de ese tamaño.
2. El arreglo **tiene coste real**. Streamear el ZIP a R2 en vez de armarlo en memoria obliga a
   cambiar de enfoque, y `jszip` se eligió precisamente porque **los tests abren el `Buffer`
   del ZIP para verificar su contenido** (`JSZip.loadAsync` en
   [`borrado-cuentas-c6-exportacion.e2e-spec.ts:319`](../apps/api/test/borrado-cuentas-c6-exportacion.e2e-spec.ts#L319)
   y en `…-c6-puertas.e2e-spec.ts:115`). Con streaming, esas barreras —que son las que prueban
   que la exportación contiene lo que promete— hay que rehacerlas.

**Cuándo reconsiderarlo.** Cuando haya vendedores reales con catálogos grandes, **o al preparar
el despliegue** (§1), que es donde el límite de memoria del worker deja de ser hipotético. Hoy
no es urgente.

**Dónde vive.** El worker de `data-export` (`data-export.processor.ts` → `data-export.zip.ts`).
Diseño: `diseno-borrado-cuentas.md` §C6.

#### 2 · Patrocinados con vídeo `[DEUDA]` — **feature nueva, no residuo**

**Qué es.** Que un `SponsoredAd` —la publicidad de pago que coloca el admin— pueda llevar
vídeo, como ya lo llevan los anuncios Pro. Hoy el modelo sólo tiene `imageUrl` y `targetUrl`
([`schema.prisma`, modelo `SponsoredAd`](../apps/api/prisma/schema.prisma)).

**OJO CON LA CONFUSIÓN DE NOMBRES, que es la razón de que esto esté escrito aquí:**
`SponsoredAd` **no** son los destacados. Son dos entidades distintas y dos bloques distintos —
los destacados son anuncios de vendedores que pagan por subir (§4.1-bis, «rotación»), y
`SponsoredAd` es publicidad del admin. Quien lea «patrocinados» y piense en la rotación de
destacados se pondrá a tocar el sitio equivocado.

**Por qué NO se hizo ahora.** Porque **no es un residuo, es una feature nueva**. Toca otra
entidad, con su propio diseño por delante: el flujo de subida (¿se reutiliza el prefirmado del
vídeo Pro?), el gate (aquí no hay «Pro», lo sube el staff) y **cómo se enseña un vídeo en un
banner de publicidad** — que es la pregunta de producto de verdad. Merece un encargo propio con
su diseño, no colarse en un cierre de flecos.

**Cuándo.** Cuando se quiera enriquecer la publicidad de pago del admin. No es urgente y no
bloquea nada.

**Dónde vive.** `SponsoredAd` y su bloque de portada/búsqueda — **no** el de destacados.

#### 3 · H-1 — el póster fijo del vídeo deja fila huérfana y miniatura inútil `[DEUDA menor]`

**Qué es.** El **póster fijo** de un vídeo (el frame de portada) se sube por
`POST /media/upload`, que no está pensado para eso: crea una fila en **`ListingImage`** —con
`listingId` a `null`, porque nadie la enlaza— y encola `sharp`, que le genera un
**`-thumb.webp` que no usa nadie**. Y `listingMediaKeys` **no deriva esa miniatura** para el
póster, así que al borrar el anuncio el thumb se queda en el bucket para siempre.

**Lo que NO es.** El **sprite** del póster animado no las produce: va por su propio camino
prefirmado a `listing-previews/` justo para evitarlo. O sea que la ráfaga que lo introdujo
**no agrandó** esta fuga — sólo la dejó a la vista.

**Por qué no se cerró.** Arreglarlo bien es **mudar el póster fijo a su propio camino** (como
se hizo con el sprite), y eso obliga a migrar los pósters que ya están. Es otro cuerpo, y
mezclarlo con el del hover habría sido hacer dos cosas a la vez.

**Dónde vive.** [`media.service.ts:31-48`](../apps/api/src/modules/media/media.service.ts#L31)
(el que crea la fila) · [`video.ts` — `uploadPoster`](../apps/web/src/lib/api/video.ts) (quien
lo manda por ahí) · [`media-keys.ts:70-90`](../apps/api/src/infra/r2/media-keys.ts#L70) (quien
no borra el thumb). Contexto completo: `diseno-poster-animado.md` §1.1 (H-1) y §3.3.

---

#### Tres rojos de e2e sin evidencia (nota, no deuda)

En la primera tirada de la batería e2e de API de la ráfaga de UI del bump automático salieron **3
tests en rojo**. La salida se perdió —el propio comando la recortó con `tail`— así que **no se
observó qué suite era ni por qué falló**.

La repetición completa salió limpia (mismos 101 suites / 1627 tests) y el spec nuevo de esa
ráfaga pasó 17/17 en tres ejecuciones seguidas. **No se atribuye a nada**: lo más probable es
inestabilidad de orden, pero no hay evidencia. Se anota para que, si vuelven a aparecer tres
rojos en esa batería, exista el precedente y no se dé por nuevo.

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

---

## 6. RC.1 — Rate limit por IP sin verificar contra el proxy real `[SEGURIDAD]` — depende de §1

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
antes o justo después del primer despliegue de esta feature. **No se puede cerrar sin §1.**

---

## 7. P3b — cambiar el propietario de un anuncio `[DEUDA]` — evaluado y pospuesto

Evaluado en [`diseno-editar-anuncio.md`](./diseno-editar-anuncio.md) §2, con las
**ocho relaciones que llevan la identidad del dueño** miradas una a una.
**Veredicto: no se construye ahora.**

**Por qué.** La operación consiste, casi entera, en decidir cuándo NO se puede
hacer: de las ocho, **una** se reasigna (`ListingImage.uploadedById`), **tres**
bloquean (bump programado —el cron cobra al usuario de la programación—,
destacado vigente, y la cuota del usuario destino) y **cinco** no se mueven nunca
porque describen hechos entre personas (compras, cobros, tratos, valoraciones,
tickets). Y no hay ninguna señal de que haga falta: el caso típico —una cuenta
duplicada— se resuelve más barato republicando el anuncio con el dueño correcto.

**Si algún día se pide**, ese §2 es el mapa: las cuatro comprobaciones previas, el
conflicto irresoluble y las cinco relaciones intocables.

### El hallazgo que sí conviene retener, aunque P3b no se haga

**Tres invariantes del dominio viven SÓLO en la aplicación, no en la base de
datos:**

| Invariante | Dónde se impone |
|---|---|
| No contactar con tu propio anuncio | `messaging.service.ts:136` |
| No valorarte a ti mismo | `reviews.service.ts:52` |
| No registrar un trato contigo mismo | `listings.service.ts:810` |

`Deal` ni siquiera tiene un `@@unique` sobre el par: lo impide el servicio. Es
decir, **la base aceptaría filas que el resto del código da por imposibles**, y la
bandeja depende de que no existan — resuelve con quién hablas con
`conv.buyerId === userId ? conv.seller : conv.buyer` (`messaging.service.ts:106`).

Hoy no es un problema: ninguna ruta puede crear esas filas. Es lo que hay que
saber **antes de escribir cualquier operación que mueva identidades entre las dos
puntas de una relación** — cambiar el dueño de un anuncio, fusionar dos cuentas,
importar datos. La restricción que más duele **no está en el esquema**.

---

## Resumen por prioridad

| # | Pendiente | Etiqueta | Bloqueado por |
|---|---|---|---|
| 4.2 | `app.enableCors()` sin argumentos | `[SEGURIDAD]` | — |
| 6 | Rate limit por IP sin verificar | `[SEGURIDAD]` | §1 |
| 1 | Despliegue (nunca desplegado) | `[DEUDA]` | — |
| 4.2 | `conversation:read` en tiempo real | `[DEUDA]` | — |
| 4.2 | Cerrar las **fuentes** de huérfanas que quedan (avatar sustituido, `blocks`/`homepage`/`sponsored`, vídeo sin confirmar) — el barrido retroactivo se evaluó y se **descartó** (`diseno-borrado.md` §7) | `[DEUDA]` | — |
| 4.2 | Conectar `.env.test` al bucket `marketplace-test` (una línea) | `[DEUDA]` | — |
| 4.2 | `Setting` decorativos (`listingExpiryDays` confirmado; patrón) | `[DEUDA]` | — |
| 4.2 | Aviso al admin si `proActiveListingLimit <= freeActiveListingLimit` | `[DEUDA]` | — |
| 4.2 | Camino feliz del vídeo sin cubrir en navegador (falta fixture MP4) | `[DEUDA]` | — |
| 4.2 | Límite de duración del vídeo blando (sin ffmpeg) | `[DEUDA]` | — |
| 4.2 | **El ZIP de exportación se arma en memoria** (residuo de C6) — caso extremo hoy; el arreglo obliga a rehacer las barreras que abren el `Buffer` | `[DEUDA]` | conviene antes de §1 |
| 4.2 | **Patrocinados con vídeo** — feature NUEVA sobre `SponsoredAd` (**no** los destacados), con diseño propio por delante | `[DEUDA]` | — |
| 4.2 | **H-1** — el póster fijo del vídeo deja fila `ListingImage` huérfana y un `-thumb.webp` que nadie borra | `[DEUDA]` | — |
| 4.2 | Página de tag del blog (SEO) | `[DEUDA]` | — |
| 4.2 | Paginación home/categorías | `[DEUDA]` | — |
| 4.2 | `allowedDevOrigins` | `[DEUDA]` | — |
| 4.2 | Preparación de producción (MapTiler, Resend, Sentry, reindex) | `[DEUDA]` | §1 |
| 4.2 | Cierre de huecos de cobertura e2e | `[DEUDA]` | — |
| 7 | P3b — cambiar el propietario de un anuncio (evaluado y **pospuesto**; `diseno-editar-anuncio.md` §2) | `[DEUDA]` | — |
| 2 | Hito 9.1 — Navegación | `[DEUDA]` | — |
| 3 | Hito 9.2 — Interfaz y estilo | `[DEUDA]` | — |
| 5 | Facturación fiscal real | `[BLOQUEADO-EXTERNO]` | proveedor homologado |

---

## Lo que NO está aquí

Para que este documento signifique algo, conviene decir qué se excluyó deliberadamente:

- **Documentación desfasada.** Seis documentos describen el plan original y ya no coinciden con
  lo construido (`contratos-api.md`, `estrategia-testing.md`, `diseno-busqueda-y-tags.md`,
  `diseno-backoffice.md`, `diseno-blog.md`, `diseno-valoraciones.md`, más el §16.2 de
  `diseno-facturacion.md`). Eso **no es trabajo pendiente de producto**: se arregla escribiendo,
  y va en su propia tanda.
- **Deuda ya cerrada** que alguna vez estuvo en una lista de pendientes: Redsys E2E (verificado
  contra el sandbox real con túnel cloudflared), el flaky de indexación de Meilisearch (cerrado
  en su causa raíz con `waitForTask`), el aislamiento de las corridas e2e (candado compartido en
  `apps/api/test/e2e-lock.js`), y la saga del CI.
- **Decisiones tomadas de no hacer algo.** El aislamiento de la base de test por worker de Jest
  se evaluó en el Hito 9 y **se decidió no hacerlo**, a cambio de una orquestación no trivial.
  **La decisión sigue en pie; su aritmética no.**

  Aquella cuenta —«la suite tarda 110 s en serie y el paralelismo ahorraría ~60-70 s»— es de
  cuando la batería eran 33 suites y 564 tests. **Medido el 2026-08-27 sobre `main`:
  163 suites, 2 476 tests, ~8,5 min en serie** (`--runInBand`; cuatro corridas de esta sesión
  entre 490 s y 523 s). O sea que lo que se está renunciando a ahorrar es del orden de
  **minutos, no de segundos**.

  Se actualiza **el número, no la decisión** — que es de Ernest y no se rediscute aquí. Pero
  quede escrito que el argumento «la suite es corta» ya no se sostiene solo: si algún día se
  reabre, se reabre con esta cifra, no con la de hace cuatro hitos. Y hay una alternativa a
  medio camino ya propuesta y no hecha, anotada en [`ci.yml`](../.github/workflows/ci.yml):
  repartir **Playwright** en shards de matriz, donde cada job trae sus propios contenedores de
  servicio y el estado compartido deja de obligar a `workers: 1`.
