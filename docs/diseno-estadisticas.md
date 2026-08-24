# Diseño — «Veces listado» (Pro) y el backoffice de estadísticas

> **Qué es esto.** El diseño de dos encargos que son **la misma telemetría vista por dos
> audiencias**: el vendedor Pro mirando SU anuncio, y el staff mirando el conjunto. Se
> diseñan juntos para no construir dos sistemas de conteo.
>
> **Parte A** — «veces listado»: cuántas veces un anuncio ha salido como resultado de una
> búsqueda. **No existe hoy**; hay que CAPTURARLO, y la ruta donde se captura es la más
> caliente del producto.
> **Parte B** — el backoffice de estadísticas: cuatro vistas (anuncio, usuario, categoría,
> plataforma) que **solo LEEN** lo que la parte A y la telemetría ya existente escriben.
>
> **Cero código.** Todo lo que se afirma está leído en el repo, con fichero y línea. Donde
> hay una cifra sin medir, se dice que es una estimación y se enseña la aritmética.

---

## 0. El veredicto, en una tabla

| | Qué se hace | Dónde | Coste en la ruta caliente |
|---|---|---|---|
| **A.1** | Definir la impresión: **el conjunto de anuncios de UNA respuesta servida por `GET /search`** | contrato | — |
| **A.2** | Acumular en **Redis** (`HINCRBY`), volcar a la BD por **cron** cada 15 min | `SearchController` + un scheduler | **~1 RTT a Redis**, sin `await` bloqueante, **cero escrituras a Postgres** |
| **A.3** | `ListingImpressionDaily` (molde `ListingViewDaily`) + `Listing.impressionCount` (molde `viewCount`) | `schema.prisma` | — |
| **A.4** | El Pro lo ve **en la pantalla que ya existe**, como una segunda serie de la gráfica que ya hay | `EstadisticasClient.tsx` | — |
| **B.1-3** | Anuncio / usuario / categoría: **consultas de agregación sobre las MISMAS dos tablas diarias**. Cero tablas nuevas por eje | `AdminStatsController` (nuevo) | — |
| **B.4** | «Monitoreo de plataforma»: el pulso por categoría. **Sección nueva**, NO una ampliación de `GET /admin/stats` | `/admin/estadisticas`, `MODERATOR` | — |

**Las tres tesis del documento:**

1. **El problema de la caché de búsqueda no está donde el encargo lo sitúa.** No hay caché
   de búsqueda en la API — `SearchService` habla con Meilisearch sin pasar por Redis. La
   única caché que se salta el conteo está en **Next**, y solo cubre portada y blog. Lo que
   sí hay que resolver, y es más grave, es la **escritura por impresión**.
2. **Una cola BullMQ para acumular sería más cara que el problema que resuelve.** Encolar es
   *también* una escritura en Redis, más un worker, más un job. La forma correcta es
   acumular en Redis directamente y **encolar solo el volcado**, que es periódico.
3. **La captura ocurre UNA vez y la leen los dos.** Pro y backoffice son dos *consultas*
   sobre las mismas dos tablas, no dos sistemas.

---

## 1. Lo que hay hoy, verificado

### 1.1 La telemetría de vistas: el molde que ya funciona

`ListingsService.trackView` (`listings.service.ts:1501-1536`) es el patrón a imitar **y a no
imitar a la vez**. Lo que hace, en orden:

```ts
// listings.service.ts:1509-1535
if (viewerId && viewerId === listing.sellerId) return;   // el dueño nunca cuenta
const visitorKey = viewerId ? `user:${viewerId}` : `anon:${visitorHash}`;
const accepted = await this.redis.client.set(dedupKey, '1', 'EX', 1800, 'NX');
if (accepted !== 'OK') return;                            // dedup de 30 min
await Promise.all([
  this.prisma.listing.update({ data: { viewCount: { increment: 1 } } }),
  this.prisma.listingViewDaily.upsert({ /* (listingId, date) → count++ */ }),
]);
```

Cuatro decisiones que esta parte A hereda literalmente:

- **`VIEW_DEDUP_TTL_SECONDS = 60 * 30`** (`:1499`) — la ventana de deduplicación.
- **La identidad del visitante es `sha256(ip:userAgent)`**, calculada en el controlador
  (`listings.controller.ts:314`), o el `userId` si hay sesión.
- **Dos destinos: el total y el diario.** El total vive en `Listing.viewCount` (columna) y la
  granularidad temporal en `ListingViewDaily` — el comentario del modelo lo dice:
  «*El total (free) sigue viviendo en `Listing.viewCount`; esta tabla solo aporta la
  granularidad temporal para la gráfica Pro*» (`schema.prisma:1089-1091`).
- **La fecha se normaliza en UTC**: `today.setUTCHours(0,0,0,0)` (`:1523`), contra una columna
  `@db.Date` con `@@unique([listingId, date])` (`schema.prisma:1096-1099`).

Y **una decisión que NO se puede heredar**, que es justo el corazón de la parte A:

> `trackView` escribe **dos filas en Postgres, síncronamente, dentro de la petición HTTP**.
> Puede permitírselo porque su ruta es fría: **una petición por ficha vista**, disparada desde
> el navegador al montar la ficha (`POST /listings/:slug/view`,
> `listings.controller.ts:305`), y con el dedup cortando las recargas. Una búsqueda sirve
> **24 anuncios de golpe** y se pide muchísimas más veces. Copiar este molde en `/search`
> multiplicaría por 24 la escritura de la ruta más caliente del producto.

**Ni `ListingViewDaily` ni ninguna otra cosa purga estas filas.** Grep exhaustivo sobre
`apps/api/src`: `listingViewDaily` aparece exactamente **dos veces**, el `upsert` de
`:1530` y el `findMany` de `:1559`. No hay retención. Es deuda existente y la parte A la
agrava (§2.6).

### 1.2 Lo que el vendedor Pro ve hoy

`getMineStats` (`listings.service.ts:1539-1571`) devuelve dos formas según el plan:

| | No Pro | Pro |
|---|---|---|
| `viewCount` | ✅ | ✅ |
| `favoritesCount` | ✅ | ✅ |
| `dailyViews` | — | ✅ (últimos **30 días**, `:1555-1563`) |
| `likeRatio` | — | ✅ (`favoritesCount / viewCount`, `:1569`) |

Y `getMineStatsSummary` (`:1574-1598`), **solo Pro** (403 si no, `:1577`): `totalViews`,
`totalFavorites`, `mostViewedListingId`.

En el frontend, `EstadisticasClient.tsx`:

- La **gráfica cronológica ya existe**: `<LineChart data={stats.dailyViews}>` con recharts,
  `XAxis dataKey="date"`, una sola `<Line dataKey="count" name="Vistas">`
  (`EstadisticasClient.tsx:124-148`). **Es el molde de gráfica que el backoffice reusa.**
- El **gate Pro ya existe** y ya está sobre el molde común: `proStatus.isPro ? (…) : <ProGate
  testId="stats-upgrade-cta" …>` (`:115`, `:176-179`).
- El bloque básico (vistas + me gusta) se pinta para todos (`:99-113`).

Contrato en el web: `ListingStats` / `ListingStatsSummary` (`types/index.ts:375-387`).

### 1.3 `GET /admin/stats`: las 7 métricas que ya hay

`AdminService.getStats` (`admin.service.ts:2859-2914`) devuelve, en **una** `$transaction`
de siete `count()` más una llamada a Meilisearch:

```
listings: { active, pendingReview, publishedToday }
users:    { total, newToday }
moderation: { reportsPending }
conversations: { total }
search: { totalDocuments, isIndexing } | null   // tolerante a Meili caído (:2892)
```

**Son contadores de INVENTARIO, no de actividad.** Ninguna de las siete mide tráfico: no hay
una sola vista, impresión ni serie temporal. Y todas son de **hoy** o **totales**, nunca una
serie.

**Su piso es `EDITOR`**, con un override explícito sobre el `@MinRole(Role.ADMIN)` de la clase
(`admin.controller.ts:54-55`), y la razón está escrita: es el endpoint que carga el dashboard,
que es la sección de piso más bajo del backoffice (`:45-53`). Esto **decide** §3.5.

El dashboard que lo pinta es `(admin)/admin/page.tsx` — seis `KpiCard` en tres secciones más
la tarjeta del índice.

### 1.4 Lo que el backoffice ya enseña de un anuncio

`/admin/anuncios/[id]` **ya tiene una sección «Actividad»** (`page.tsx:906-913`):

```tsx
<Dato etiqueta="Vistas"          valor={data.viewCount} />
<Dato etiqueta="Días con vistas" valor={data._count.viewsDaily} />
<Dato etiqueta="Favoritos"       valor={data._count.favorites} />
<Dato etiqueta="Conversaciones"  valor={data._count.conversations} />
```

servida por el `_count` de `admin.service.ts:810-820`, que **ya incluye `viewsDaily`**. Es
decir: el backoffice ya sabe cuántos días con vistas tiene un anuncio, pero **no puede
enseñar la serie**. B.1 es, literalmente, convertir ese `_count` en la gráfica que el Pro ya
tiene al lado.

`/admin/usuarios/[id]`, en cambio, **no tiene ninguna sección de actividad**: tiene Anuncios,
Valoraciones (recibidas y hechas), Reportes (recibidos y hechos) y Tickets — todos contadores
de inventario y relación, ninguno de tráfico. B.2 estrena la sección.

**No existe `/admin/categorias/[id]`**: el inventario de páginas del backoffice tiene
`categorias/page.tsx` y nada colgando. B.3 no tiene dónde aterrizar en la sección de
Categorías — decisión en §3.3.

### 1.5 La ruta de búsqueda y sus cachés REALES

Aquí es donde el encargo parte de una premisa que hay que corregir.

**En la API no hay caché de búsqueda.** `search.service.ts` importa `MeilisearchService`,
`FilterableAttributesResolver` y `CategoryTreeService` (`:1-10`), y **no importa
`RedisService`**: grep de `cache|redis|Redis|revalidate` sobre el fichero → **cero
coincidencias**. Cada `GET /search` que llega a Nest ejecuta su consulta contra Meilisearch.

**Lo único cacheado en esa ruta es el patrocinado**, y no son los resultados:
`SponsoredAdsService.resolveForSearch` (caché Redis por categoría, TTL 5 min), solo en página
1 y solo con categoría (`search.controller.ts:163-174`). Está declarado como excepción
consciente en `apps/api/CLAUDE.md`.

**En Next, la caché existe pero NO cubre las páginas de resultados.** `apiFetch` llama a
`fetch` sin opción de caché (`lib/api/client.ts:208`), y en **Next 15** (`^15.3.3`,
`package.json:35`) el `fetch` no cacheado por defecto es `no-store`. Las páginas que sirven
resultados no pasan nada:

| Superficie | Llamada | Caché |
|---|---|---|
| `/busqueda` | `search({…})` sin `fetchOptions` (`busqueda/page.tsx:132-151`) | **ninguna** → un `GET /search` por petición |
| `/[categoria]…` | `search({…})` sin `fetchOptions` (`CategoryListingPage.tsx:275`) | **ninguna** |
| Portada, bloque `listings` | `search(…, { next: { revalidate: 180 } })` (`home-blocks/resolve-listings.ts:57`) | **180 s** |
| Blog/páginas, bloque `listings` | ídem, `LISTINGS_BLOCK_REVALIDATE_SECONDS = 180` (`blocks/resolve-listings.ts:13,56`) | **180 s** |

**Conclusión que cambia el diseño de A.2:** contar al servir la respuesta en el backend
**no pierde ninguna impresión de búsqueda ni de categoría**, porque esas dos superficies
llegan siempre. Lo que se «pierde» es en portada y blog, que son **escaparates curados, no
resultados de búsqueda**, y cuya caché produce un efecto que resulta ser *deseable* (§2.1).

**Otro detalle del controlador que el conteo tiene que respetar** (`search.controller.ts`):

- En página 1 se lanza **una SEGUNDA consulta** para el bloque «Promocionados»
  (`:141-150`, `FEATURED_BLOCK_SIZE = 4`, `:16`). Sus hits **se repiten a propósito** dentro
  de `hits` — el comentario de `:134-139` lo declara. Contar las dos listas por separado
  contaría dos veces al mismo anuncio en la misma respuesta.
- El **patrocinado** se inyecta en `hits` con `__sponsored: true` (`:169-172`). No es un
  anuncio: `SponsoredAd` (`schema.prisma:2269-2299`) no tiene `listingId` ni relación con
  `Listing`. **No se puede contar aunque se quisiera.**
- El mapa pide **200 hits** en vez de 24 (`busqueda/page.tsx:115`).

**Y `SearchService.search()` tiene llamadores que NO son usuarios**: `alerts.service.ts:55` y
`:128`, y `alert-matching.service.ts:64` (una consulta por anuncio y alerta, dentro de un
worker). **Esto obliga a que el conteo viva en el CONTROLADOR, no en el servicio**: contar en
`SearchService` convertiría cada barrido de alertas en una lluvia de impresiones falsas.

### 1.6 La navegación del backoffice y el gate de rol

`config/backoffice-sections.ts` es **la fuente única**: middleware y nav derivan de ella
(`:4-26`). Lo que importa aquí:

- Una fila tiene `id`, `route`, `label`, `minRole`, `group` (obligatorio, `| null`) y
  `exact?` (`:82-124`).
- **`canAccessAdminPath` es fail-closed** (`:335-339`): una ruta bajo `/admin` **sin fila en
  el mapa se deniega a todos, incluido ADMIN** (`:323-334`). Una sección nueva **sin su fila
  aquí no existe**.
- Los grupos son seis (`:138-145`); la pertenencia vive en la fila, nunca en el grupo
  (`:126-137`).
- `navGroupsFor` **no decide nada de visibilidad**: se apoya en `navSectionsFor` y solo
  reparte, y los grupos vacíos no se devuelven (`:367-396`).
- La escalera es `USER < EDITOR < MODERATOR < ADMIN` con `atLeast` fail-closed
  (`config/roles.ts:23-37`), espejo verificado en CI del canónico del api.

Y la deuda declarada del controlador de admin, que este encargo puede empezar a pagar:
«*este controlador sirve CINCO secciones con TRES pisos distintos […]. Partirlo en tres
controladores es lo limpio […]; mueve 22 rutas de sitio*» (`admin.controller.ts:276-280`).

### 1.7 El molde de trabajo periódico

Hay cuatro `@Cron` en producción y `ScheduleModule.forRoot()` en `app.module.ts:66`:

| Servicio | Cron |
|---|---|
| `expiration.service.ts:24` | `EVERY_DAY_AT_2AM` |
| `entitlement-expiration.service.ts:30` | `0 3 * * *` |
| `invoicing-schedule.service.ts:44` | `0 4 * * *` |
| `tickets-schedule.service.ts:47` | `0 5 * * *` |
| `bump-schedule.service.ts:73` | `10 * * * *` — **el único infra-diario**, y con `timeZone` |

La convención está escrita tres veces: **«el `@Cron` es fino y delega en el método público
testeable»** (`bump-schedule.service.ts:32`, `invoicing-schedule.service.ts:41-44`,
`tickets-schedule.service.ts:25`). El volcado de §2.4 la sigue.

---

# PARTE A — «Veces listado»

## 2.1 Qué cuenta, con precisión

> **Definición.** Una **impresión** de un anuncio es **su aparición en el conjunto de
> resultados de UNA respuesta servida por `GET /search`**. Se cuenta el conjunto (no el
> multiconjunto) de anuncios de esa respuesta: **una respuesta, como mucho una impresión por
> anuncio**.

Las cinco preguntas del encargo, respondidas:

**¿Una impresión = aparecer en una página de resultados?** Sí. Si sale en la página 1 de una
búsqueda, +1.

**¿Por página vista o por búsqueda?** **Por página servida.** Si el usuario pagina a la 2 y el
anuncio también sale allí, es otra impresión — es otra aparición, en otra pantalla que el
usuario sí ha pedido. (En la práctica un anuncio raramente sale en dos páginas de la misma
búsqueda; el caso real es paginar y volver, que el dedup de §2.5 corta.)

**¿Cuenta si el usuario no lo mira (la página 3 que abrió y no bajó)?** **Sí, cuenta.** La
métrica es **«apareció en un resultado servido»**, no «entró en el viewport». Medir scroll
real es otra liga: exige telemetría desde el navegador, un evento por tarjeta y un
`IntersectionObserver` — y produciría una métrica que no se puede reconciliar con nada de lo
que ya hay. Se dice en la UI con estas palabras exactas, para que el vendedor no lo confunda
con «lo han visto» (§2.8).

**¿El bloque «Promocionados» cuenta aparte?** **No.** Es la segunda consulta de
`search.controller.ts:142`, y sus 4 hits **ya están dentro de `hits`** por diseño declarado
(`:134-139`). Se cuenta **la unión de `hits` ∪ `featured`, deduplicada por `id`** — que es
exactamente lo que la definición de arriba dice.

**¿El patrocinado cuenta?** **No puede**: no es un `Listing` (§1.5).

**¿El mapa cuenta sus 200?** **Sí, los 200.** Son 200 marcadores servidos y pintados en un
mapa que el usuario está mirando entero — es *más* visible que la página 3 de una lista, no
menos. Se deja como constante explícita por si hay que acotarlo después
(`MAX_IMPRESSIONS_PER_RESPONSE`), pero nace sin tope.

**¿Y la portada y el blog?** **Fuera del perímetro conceptual, y la caché de Next lo hace
cumplir sola.** Un bloque de portada no es un resultado de búsqueda: es una vitrina curada
donde los mismos 8 anuncios saldrían en *cada* visita a la home. Contarlos ahogaría la señal
real — un anuncio en la portada sacaría cien veces más «veces listado» que el primero de una
búsqueda, sin que nadie lo haya buscado. Y como esas dos superficies pasan por
`revalidate: 180`, el backend recibe **a lo sumo una petición cada 3 minutos por bloque**:
el efecto de la caché no es *pérdida*, es **coalescing**, y deja esas superficies aportando
un residuo acotado (≤ 480 impresiones/día por bloque) en vez de un torrente.

> **Si más adelante se quiere segmentar** («¿cuántas de mis veces-listado vienen de la
> portada?»), el enganche es un parámetro `surface` en la query que el BFF ya sabría rellenar,
> y una columna más en la tabla diaria. **No entra en esta versión**: multiplica las filas por
> el número de superficies y no hay nadie pidiéndolo.

**Dos exclusiones más, heredadas de `trackView`:**

- **El dueño no cuenta.** `trackView` lo hace explícito y hasta se niega a marcar el dedup
  (`listings.service.ts:1508-1509`). En búsqueda hay que aplicarlo *filtrando los hits cuyo
  `sellerId` sea el del usuario autenticado* — el documento de Meilisearch lleva `sellerId`
  (`search.service.ts:53`), así que sale gratis, sin una consulta más. Un vendedor buscando
  su categoría veinte veces al día no debe inflarse las veces-listado.
- **Los llamadores máquina no cuentan**, garantizado por construcción: el conteo vive en el
  controlador HTTP, y alertas llama al servicio (§1.5).

## 2.2 Dónde se cuenta: el problema real y su forma

El encargo plantea tres opciones. Evaluadas contra el código:

**Opción 1 — contar en el backend al construir la respuesta, escribiendo en la BD.**
Descartada. Es `trackView` × 24: veinticuatro `upsert` dentro de la petición de búsqueda.
Además de la latencia, tiene un problema peor y menos visible: **contención de fila**. Los
anuncios que salen en *todas* las búsquedas de una categoría (los primeros por relevancia)
serían la misma fila actualizada por todas las peticiones concurrentes — un punto caliente de
bloqueo en la tabla más leída del producto, provocado por una métrica de vanidad.

**Opción 2 — emitir un evento a BullMQ y agregar en un worker.**
Descartada **como acumulador**, y este es el punto no obvio del diseño: **encolar un job es,
en sí, una escritura en Redis** (BullMQ vive sobre Redis). Cambiar 24 escrituras en Postgres
por 1 escritura en Redis + 1 worker + 1 job + el `add()` de la cola es más caro y más
complicado que cambiar esas 24 escrituras por **1 escritura en Redis y punto**. La cola
aportaría reintentos y aislamiento, que aquí no hacen falta: una impresión perdida no es un
cobro perdido. **BullMQ sí es candidato para el VOLCADO**, que es periódico y sí toca la BD —
pero para eso ya hay `@Cron`, que es el molde del repo para el trabajo periódico (§1.7) y no
necesita una cola nueva ni un worker más.

**Opción 3 — acumular en Redis y volcar en batch.** ✅ **Elegida.**

> **La regla que gobierna la parte A:** la respuesta de búsqueda **no espera** al conteo, y el
> conteo **no toca Postgres**. Lo único que la petición hace es un `pipeline` a Redis, sin
> `await` bloqueante y con el error tragado — exactamente el mismo trato que `trackView`
> recibe en el frontend, donde el llamador «*ignora el resultado y los errores, el tracking
> nunca debe afectar la experiencia*» (`lib/api/anuncios.ts:23-27`).

**Dónde, exactamente:** en `SearchController.search`, **después** de construir la respuesta y
**antes** del `return` (`search.controller.ts:176`), sobre la unión ya calculada de
`hits ∪ featured`. Es el único punto donde (a) se conocen los ids servidos, (b) hay una
petición HTTP real detrás, y (c) los llamadores máquina no llegan.

## 2.3 El acumulador: Redis

Una clave **hash por día**, campo por anuncio:

```
Clave:  imp:d:{YYYY-MM-DD}        (la fecha, en UTC, igual que ListingViewDaily)
Campo:  {listingId}
Valor:  contador (entero)

Por respuesta servida:  HINCRBY imp:d:2026-08-24 <id1> 1
                        HINCRBY imp:d:2026-08-24 <id2> 1     ← todos en UN pipeline
                        …                                       → 1 round-trip
```

**Por qué un hash por día y no una clave por anuncio:** un hash es una sola estructura que se
puede *drenar entera* de forma atómica (§2.4), y evita tener que descubrir por `SCAN` qué
anuncios tienen contador pendiente. Y por qué la fecha va **en la clave** y no se resuelve al
volcar: si el volcado cruza la medianoche UTC, un contador acumulado ayer se escribiría con la
fecha de hoy. Con la fecha en la clave, cada cubo sabe a qué día pertenece.

**Coste por búsqueda:** un `pipeline` de N `HINCRBY` = **1 round-trip**, N operaciones O(1) en
memoria. Más el `SET NX` del dedup (§2.5), que va en el mismo pipeline. **Total: 1 RTT a
Redis, sin escrituras en Postgres, sin bloqueos de fila.**

**Memoria:** un hash de 20.000 campos con claves cuid (25 bytes) y enteros pequeños son
~2-3 MB por día vivo. Con dos días vivos a la vez como mucho (hoy y el que se está drenando),
es ruido frente a lo que Redis ya sostiene (caché de fichas, dedup de vistas, colas).

## 2.4 El volcado: cron cada 15 minutos, con drenaje atómico

```
@Cron('*/15 * * * *')  →  flushImpressions()      // el @Cron fino delega; §1.7
```

El método público, testeable, hace esto:

1. **`SCAN` de `imp:d:*`** — normalmente una clave (hoy), dos al cruzar la medianoche.
2. Para cada una: **`RENAME imp:d:{fecha}` → `imp:flush:{fecha}:{n}`**. `RENAME` es atómico:
   a partir de ese instante los `HINCRBY` de las búsquedas en curso crean un hash nuevo y
   limpio, y **no se pierde ni un incremento** en la ventana del volcado.
3. **`HGETALL`** del hash renombrado → los pares `(listingId, count)`.
4. **Escritura batched** en Postgres (§2.5).
5. **`DEL`** del hash drenado.

**El fallo que este orden convierte en recuperable:** si el proceso muere entre 2 y 5, el hash
`imp:flush:*` **sigue existiendo** (Redis es persistente aquí, no una caché de usar y tirar).
El paso 1 del siguiente ciclo escanea **también** `imp:flush:*` y los reintenta antes que
nada. La única pérdida posible es un doble conteo si muere entre 4 y 5, que es la dirección
correcta del error para una métrica de vanidad.

**Por qué 15 minutos.** Es el equilibrio entre filas escritas y frescura del dato:

| Intervalo | Volcados/día | Coalescing | Retraso del número que ve el vendedor |
|---|---|---|---|
| 1 min | 1.440 | poco | ~1 min |
| **15 min** | **96** | **mucho** | **≤ 15 min** |
| 60 min | 24 | máximo | ≤ 1 h |

La gráfica es **diaria**: quince minutos de retraso en el día en curso no se ven. Y el número
redondo puede ser exacto sin bajar el intervalo — ver la nota al final de §2.5.

**Cómo se escribe, que no es un detalle.** `prisma.$transaction([...upserts])` sería **un
round-trip por anuncio**: con 5.000 anuncios distintos en un cubo, 5.000 viajes. Hay que
emitir SQL batched por trozos (~1.000 filas):

```sql
-- Trozo de N filas, un solo statement.
INSERT INTO "ListingImpressionDaily" (id, "listingId", date, count)
SELECT gen_random_uuid(), v.listing_id, v.date, v.count
  FROM (VALUES …) AS v(listing_id, date, count)
  JOIN "Listing" l ON l.id = v.listing_id          -- ← el anuncio borrado se cae solo
ON CONFLICT ("listingId", date) DO UPDATE
  SET count = "ListingImpressionDaily".count + EXCLUDED.count;
```

El `JOIN "Listing"` no es adorno: **un anuncio puede haberse borrado entre la acumulación y el
volcado**, y sin él la clave foránea abortaría el trozo entero por una fila muerta. El total
(`Listing.impressionCount`) se actualiza en el mismo trozo con un `UPDATE … FROM (VALUES …)`.

## 2.5 El modelo, el dedup y la retención

### El modelo

**Molde `ListingViewDaily` (`schema.prisma:1092-1101`), calcado:**

```prisma
/// Agregado diario de IMPRESIONES (apariciones en un resultado de búsqueda servido).
/// Molde exacto de ListingViewDaily: el total vive en Listing.impressionCount y esta
/// tabla solo aporta la granularidad temporal. Se escribe SOLO desde el volcado
/// periódico del acumulador de Redis, nunca desde la petición de búsqueda.
model ListingImpressionDaily {
  id        String   @id @default(cuid())
  listingId String
  listing   Listing  @relation(fields: [listingId], references: [id], onDelete: Cascade)
  date      DateTime @db.Date
  count     Int      @default(0)

  @@unique([listingId, date])
  @@index([listingId])
  @@index([date])          // ← NUEVO respecto al molde: lo pide el monitoreo de plataforma
}
```

Y en `Listing`, junto a `viewCount`: `impressionCount Int @default(0)`.

**Tabla nueva y no una columna más en `ListingViewDaily`.** Se evaluó fusionarlas
(`ListingActivityDaily(listingId, date, views, impressions)`), y se descarta por **dos ritmos
de escritura incompatibles**: las vistas se escriben una a una desde la petición, las
impresiones en bloque desde un cron. Fusionarlas obligaría al `upsert` síncrono de
`trackView` a competir por la misma fila que el volcado batched — reintroduciendo por la
puerta de atrás la contención que §2.2 evita. Y son dos densidades distintas: una fila de
vistas solo existe los días en que alguien entró; una de impresiones existe **casi todos los
días que el anuncio esté activo**.

**Por qué también la columna total** y no un `SUM()` de la tabla diaria: es el precedente
literal de `viewCount` (`schema.prisma:1089-1091`), y sobrevive a la purga de §2.5.3 — el
`SUM` diría «0 impresiones» de un anuncio de dos años cuyo detalle diario ya se limpió.

### El dedup, y el problema que el encargo no podía ver

El molde es el `SET NX` de 30 minutos de `trackView`. Pero hay una complicación **verificada**
que cambia la forma:

> **La API no ve al visitante en `/search`.** `/busqueda` y `/[categoria]` son Server
> Components: el `search()` lo ejecuta **el servidor de Next**, no el navegador
> (`busqueda/page.tsx:132-151` → `lib/api/busqueda.ts:57` → `apiFetch` → `fetch`). Para Nest,
> **todas las búsquedas del mundo vienen de la misma IP: la del servidor de Next.** El
> `sha256(ip:userAgent)` que funciona en `trackView` funciona porque **allí el llamador es el
> navegador** (`ListingViewTracker` → `POST /listings/:slug/view`).

Dos consecuencias:

1. **La identidad del visitante la tiene que reenviar el BFF.** La página de búsqueda ya está
   en el servidor y tiene acceso a las cabeceras de la petición entrante: calcula el mismo
   `sha256(ip:userAgent)` y lo manda en una cabecera (`X-Visitor-Hash`) en la llamada a
   `search()`. Es trabajo de BFF puro —transportar identidad, no decidir nada— y encaja en la
   regla del proyecto («*Next.js es solo presentación + BFF*»). El backend la usa si viene y
   cae a `@Ip()` si no.
2. **Es tan falsificable como lo que ya hay, ni más ni menos.** Una cabecera que el cliente
   podría inventarse permite a un vendedor script-ar búsquedas y engordar sus veces-listado.
   Pero `trackView` **ya** tiene exactamente esa exposición: su hash sale de IP + User-Agent,
   dos cosas que cualquiera controla, y `main.ts:25-30` ya advierte que el `trust proxy` solo
   es fiable si el proxy real sobrescribe `X-Forwarded-For`. **No es una clase de riesgo
   nueva**, y el daño es una cifra de vanidad inflada, no dinero. Se anota, no se sobre-diseña.

**La clave de dedup: por BÚSQUEDA, no por anuncio.**

```
imp:dedup:{visitorKey}:{sha1(query normalizada + página)}    SET NX EX 1800
```

Si la clave ya existe, **la respuesta entera no cuenta** y no se emite ningún `HINCRBY`.

Por qué así y no un `SET NX` por anuncio (que sería el calco de `trackView`): un dedup por
anuncio son **24 claves y 24 operaciones por búsqueda**, y ~24× la memoria en Redis, para
responder a una pregunta que el dedup por búsqueda responde con **una sola operación**. Y
responde mejor: el caso que hay que cortar es *«el mismo usuario buscando lo mismo diez veces
en un minuto»* — que es el ejemplo textual del encargo, y es exactamente una repetición de la
misma búsqueda. El coste aceptado es que un anuncio que aparece en **dos búsquedas distintas**
del mismo visitante cuenta dos veces — y eso es **correcto**: son dos apariciones distintas.

La ventana son **1.800 s**, el mismo `VIEW_DEDUP_TTL_SECONDS` que las vistas
(`listings.service.ts:1499`), para que las dos series de la gráfica compartan criterio.

### La retención, que aquí sí hace falta

`ListingViewDaily` no se purga nunca (§1.1) y aguanta porque **sus filas son escasas**: solo
existe fila los días en que alguien entró en la ficha. `ListingImpressionDaily` es lo
contrario: **un anuncio activo sale en búsquedas casi todos los días**, así que tiende a una
fila por (anuncio × día).

```
20.000 anuncios activos × 365 días ≈ 7,3 M filas/año
```

No es dramático, pero es una tabla que **crece sola y para siempre**, y nadie mira más allá
de unos meses: el Pro ve 30 días (`listings.service.ts:1555-1556`) y el backoffice propondrá
hasta 90.

> **Regla: se purgan las filas de más de 180 días**, en el cron diario. El total sobrevive en
> `Listing.impressionCount`, así que purgar no borra el número redondo. Y **la misma purga se
> aplica a `ListingViewDaily`**, cerrando de paso la deuda de §1.1 — hacerlo solo para la
> tabla nueva dejaría dos tablas gemelas con dos políticas distintas.

### Nota: el número exacto sin bajar el intervalo

Si se quiere que el vendedor vea el total **al instante** en vez de con ≤ 15 min de retraso, el
lector puede sumar lo pendiente:

```
total = Listing.impressionCount + HGET imp:d:{hoy} {listingId}
```

Un `HGET` en una pantalla fría (las estadísticas de un anuncio) es gratis. **Opcional**, no
bloqueante para la ráfaga; se anota porque es de una línea si alguien lo pide.

## 2.6 El coste, con la aritmética a la vista

**Hipótesis declarada** (no medida — el proyecto no tiene aún tráfico de producción):
60 búsquedas servidas por minuto en hora punta, 24 hits por respuesta.

| | Opción 1 (escribir por impresión) | **Elegida (Redis + volcado)** |
|---|---|---|
| Ops en la petición | **24 upserts a Postgres**, síncronos | **1 RTT a Redis** (pipeline), sin `await` bloqueante |
| Latencia añadida a `/search` | decenas de ms + espera de bloqueo | sub-ms, y fuera de la respuesta |
| Contención | **sí**: fila caliente por anuncio popular | ninguna (memoria, O(1)) |
| Escrituras a Postgres/hora | 60 × 60 × 24 = **86.400** | ≤ 4 volcados × (anuncios distintos) ≈ **20.000**, en ~20 statements batched |
| ¿Se cae si Redis se cae? | — | **no**: se pierden impresiones, la búsqueda responde igual |
| ¿Se cae si Postgres va lento? | **sí, la búsqueda se frena** | no: el cron espera, la búsqueda ni se entera |

La comparación importante no es el número de escrituras (3-4×), sino **dónde ocurren**: las
86.400 están *dentro* de la petición de búsqueda, y las ~20.000 están en un cron a las tantas
de un trozo de SQL batched. Y el número de escrituras del volcado **no crece con el tráfico**,
solo con cuántos anuncios distintos aparecen — está acotado por el catálogo activo, no por las
visitas. Es la propiedad que hace que esto escale: **al doblar el tráfico, la BD no nota
nada.**

## 2.7 Quién lo ve: el vendedor Pro

**Se AÑADE a la pantalla que ya existe, no se hace una nueva.** El gate Pro ya está
(`EstadisticasClient.tsx:115`, `:176`), la gráfica ya está (`:124-148`), el endpoint ya está
(`GET /listings/mine/:id/stats`).

**El contrato crece de forma aditiva** — `ListingStats` (`types/index.ts:375-380`):

```ts
export interface ListingStats {
  viewCount: number;
  favoritesCount: number;
  impressionCount?: number;                              // NUEVO — Pro
  dailyViews?: { date: string; count: number }[];
  dailyImpressions?: { date: string; count: number }[];  // NUEVO — Pro
  likeRatio?: number;
}
```

**Decisión: «veces listado» es Pro, igual que la gráfica.** Va con `dailyViews` en la rama
`isPro` de `getMineStats` (`listings.service.ts:1551-1570`), no en el bloque básico. El no-Pro
sigue viendo el mismo bloque de siempre (vistas + me gusta) y el mismo `ProGate`, cuyo texto
gana una línea: «*Disponibles con Pro: vistas por día, **veces listado**, ratio de me gusta…*».

**La gráfica pasa a tener dos líneas, no dos gráficas.** El `<LineChart>` ya acepta varias
`<Line>`; la comparación *impresiones vs. vistas* es justo la lectura útil («salgo mucho y no
me entra nadie» = el título o la foto; «salgo poco» = el precio o las etiquetas). Requiere
**fusionar las dos series por fecha** en el cliente (rellenando con 0 los días que falten en
una de ellas), porque cada serie viene con sus propios días.

**Y una métrica derivada que sale gratis:** `CTR = viewCount / impressionCount` — «de cada
100 veces que sales en una búsqueda, N personas entran». Es el hermano exacto del `likeRatio`
que ya se pinta (`:117-122`) y se pinta con el mismo molde.

**El texto importa.** La etiqueta es **«Veces listado»** y debajo, en pequeño: *«cuántas veces
tu anuncio ha aparecido en una página de resultados»*. No «impresiones» (jerga) ni
«visualizaciones» (mentira: no sabemos si lo miró). §2.1 definió la métrica; la UI tiene que
decir lo mismo.

---

# PARTE B — El backoffice de estadísticas

Todo lo de esta parte **solo LEE**. No hay una sola captura nueva: son consultas de agregación
sobre `ListingViewDaily` y `ListingImpressionDaily`.

## 3.1 B.1 — Las estadísticas de un anuncio

**Dónde: en `/admin/anuncios/[id]`, en la sección «Actividad» que ya existe**
(`page.tsx:906-913`). No una pantalla nueva: el staff ya va ahí a mirar un anuncio, y los
cuatro `<Dato>` de hoy son el resumen numérico al que le falta la serie.

- Los cuatro datos actuales se quedan; se les añade **«Veces listado»**.
- Debajo, **la gráfica cronológica** (vistas + veces-listado), con selector de rango
  **7 / 30 / 90 días** — el staff necesita más ventana que los 30 fijos del Pro, porque su
  pregunta es «¿esto lleva así mucho?».
- El `<Dato etiqueta="Días con vistas">` puede quedarse: con la gráfica al lado deja de ser el
  sustituto pobre de la serie y pasa a ser lo que es, un contador de densidad.

**Endpoint:** `GET /admin/stats/listings/:id?days=30` → `{ viewCount, impressionCount,
favoritesCount, daily: [{ date, views, impressions }] }`.

**La serie llega FUSIONADA desde el backend**, no como dos arrays: es una decisión deliberada
y distinta de lo que hace el endpoint del Pro (que devuelve `dailyViews` suelto por historia).
Fusionar en SQL/servicio y rellenar los huecos con 0 evita que **cada** consumidor del
backoffice —anuncio, usuario, categoría, plataforma— repita el mismo `zip` de series en el
cliente. El del Pro **no se toca**: cambiarle la forma a un contrato en producción por
simetría no compensa (§4.2).

## 3.2 B.2 — Las estadísticas de un usuario

**Dónde: en `/admin/usuarios/[id]`, sección «Actividad» NUEVA** (hoy no hay ninguna, §1.4),
junto a la sección «Anuncios» que ya lista sus anuncios.

Qué enseña, **agregando TODOS los anuncios del usuario**:

- **Totales**: visitas totales, veces-listado totales, anuncios contados y —derivado— el
  **CTR del vendedor**.
- **La misma gráfica**, con la suma diaria de todos sus anuncios.
- **Su anuncio más visto y el más listado**, con enlace a `/admin/anuncios/[id]` (B.1). Es lo
  que convierte la pantalla en un punto de partida y no en un callejón; y el «más visto» ya
  existe como concepto en el lado del vendedor (`mostViewedListingId`,
  `listings.service.ts:1588-1596`).

**Endpoint:** `GET /admin/stats/users/:id?days=30`.

**Qué anuncios entran: TODOS los del vendedor, sea cual sea su estado.** No solo los `ACTIVE`.
La pregunta del staff es «¿qué actividad genera esta persona?», y un anuncio archivado que
acumuló 40.000 visitas la semana pasada es *exactamente* lo que se está buscando. (En cambio
solo los `ACTIVE` generan impresiones nuevas — solo ellos se indexan, `apps/api/CLAUDE.md`.)

## 3.3 B.3 — Las estadísticas de una categoría

**Dónde: NO en `/admin/categorias`.** Esa pantalla es el editor del catálogo (crear, ordenar,
esquema de atributos, políticas) y no tiene ficha de detalle donde colgar esto (§1.4).
**Vive dentro de la sección nueva de §3.5, como el desglose de una fila del monitoreo de
plataforma** — que es donde el staff estará mirando cuando le surja la pregunta.

**La decisión de fondo: una categoría agrega su SUBÁRBOL, no solo sus anuncios directos.**
`Listing.categoryId` apunta a la hoja, así que «Vehículos» sin subárbol daría casi cero
mientras «Coches» se lo lleva todo — una lectura falsa del pulso de la plataforma. Se
resuelve con **`CategoryTreeService.getDescendantIds(categoryId)`**
(`category-tree.service.ts:156`), que ya existe, es puro sobre una foto cacheada del árbol y
ya lo usa la búsqueda para el mismo fin (`categoryPath`).

Se enseñan **las dos cifras**: «propios» y «con subcategorías». Una sola de las dos miente en
la mitad de los casos.

**Endpoint:** `GET /admin/stats/categories/:id?days=30&subtree=true`.

## 3.4 B.4 — El monitoreo de plataforma

La vista principal de la sección: **el pulso de la plataforma por categoría.** Una tabla, una
fila por categoría raíz, expandible a sus hijas:

| Categoría | Anuncios activos | Visitas (30d) | Veces listado (30d) | CTR | Δ vs. periodo anterior |
|---|---|---|---|---|---|

- **Ordenable por cualquier columna** — el «¿cuál genera más actividad?» del encargo es,
  literalmente, ordenar por visitas.
- **El CTR por categoría es el dato con más señal de toda la pantalla**: una categoría con
  muchas veces-listado y pocas visitas es una categoría cuyos resultados **no convencen** —
  fotos, precios o títulos malos, o un `attributeSchema` que no deja filtrar lo que la gente
  busca. Es una conclusión accionable para el staff, no una cifra de vanidad.
- **La delta contra el periodo anterior** convierte la tabla en una alerta: una categoría que
  cae un 40 % en visitas es una noticia; su número absoluto, no.
- Arriba, una **fila de totales de plataforma**: visitas y veces-listado de todo el sitio en el
  periodo, con su gráfica — es el «pulso» en una línea.

**Endpoint:** `GET /admin/stats/platform?days=30`.

**Coste de esta consulta, que es la única de la parte B que da algo de miedo.** Es un
`GROUP BY` sobre `ListingImpressionDaily` de los últimos 30 días unido a `Listing` por
categoría: con la hipótesis de §2.6, ~600.000 filas en la ventana. Es una consulta de
backoffice, ejecutada por un puñado de personas, en una pantalla que nadie recarga en bucle.
El `@@index([date])` de §2.5 existe **para esto**. Si midiendo resultara lenta, la salida
obvia y barata es cachear la respuesta en Redis con TTL de 5-10 minutos — molde
`SponsoredAdsService` (`apps/api/CLAUDE.md`) — porque **nadie necesita el pulso de la
plataforma al segundo**. Se anota como plan B explícito, no se pre-optimiza.

## 3.5 Dónde vive: la sección, el rol y los endpoints

### La sección

Una fila nueva en `config/backoffice-sections.ts`, **obligatoria**: sin ella la ruta es
inaccesible **para todos, incluido ADMIN** (`canAccessAdminPath` es fail-closed, `:335-339`).

```ts
{ id: 'estadisticas', route: '/admin/estadisticas', label: 'Estadísticas',
  minRole: 'MODERATOR', group: 'plataforma' },
```

**Por qué `group: 'plataforma'`.** El encargo la llama «monitoreo de **plataforma**», y el
criterio de los grupos está escrito: es **la tarea**, no el rol —«*Que «Plataforma» coincida
con las tres secciones ADMIN es **consecuencia, no criterio***» (`:126-137`). Que sea la
primera fila `MODERATOR` de ese grupo no rompe nada: `navGroupsFor` filtra por rol y solo
reparte (`:386-396`), así que un MODERATOR verá el grupo «Plataforma» con un único ítem
dentro, y un ADMIN lo verá con cuatro.

Y **el orden importa**: las filas de un grupo tienen que ir **seguidas** en el mapa — es un
invariante con test («*agrupar no pierde, no añade y no reordena*», `:157-161`). La fila entra
**al principio** del bloque «Plataforma», antes de Facturación: es la de piso más bajo y la
única que un MODERATOR ve.

### El rol

**`MODERATOR`**, tal cual pide el encargo («moderadores y administradores»), y encaja con el
reparto de R2 sin excepciones: `/admin/anuncios` y `/admin/usuarios` —las dos pantallas donde
aterrizan B.1 y B.2— **ya son MODERATOR** (`:176`, `:183`). Las estadísticas de un anuncio son
menos sensibles que la ficha del anuncio desde la que se abren.

### Los endpoints: por qué NO se amplía `GET /admin/stats`

El encargo pregunta si esto amplía las 7 métricas o es una sección nueva. **Es una sección
nueva, y la razón está en el código, no en el gusto:**

> **`GET /admin/stats` es `EDITOR`** por un override explícito y razonado
> (`admin.controller.ts:54-55`), porque es lo que carga el dashboard, la sección de piso más
> bajo del backoffice. Colgarle ahí la telemetría —que es `MODERATOR`— dejaría dos salidas,
> las dos malas: **abrir los datos de tráfico a EDITOR**, o **devolver una respuesta de forma
> variable según el rol**. Lo segundo ya se consideró y se rechazó, con esas palabras:
> «*recortarlo por rol exigiría un `getStats` de forma variable para proteger cifras que no
> son sensibles*» (`backoffice-sections.ts:165-168`, citando `docs/diseno-roles.md` §4.5,
> D-2).

Además son cosas distintas: las 7 métricas son **inventario** (cuántos anuncios, cuántos
usuarios, cuántos reportes) y las nuevas son **tráfico**. Mezclarlas en un endpoint las obliga
a compartir cadencia, caché y piso de rol para siempre.

**Se reusa lo que sí se puede reusar:** el `KpiCard` del dashboard
(`(admin)/admin/page.tsx:17-40`) y sus estados de carga/error, que son el molde visual de las
tarjetas de la sección nueva.

**Un controlador nuevo, `AdminStatsController`**, montado en `admin/stats`, con
`@MinRole(Role.MODERATOR)` de clase:

```
GET /admin/stats/listings/:id     → B.1
GET /admin/stats/users/:id        → B.2
GET /admin/stats/categories/:id   → B.3
GET /admin/stats/platform         → B.4
```

No colisiona con el `GET /admin/stats` existente (rutas distintas y exactas). Y **empieza a
pagar la deuda declarada** en `admin.controller.ts:276-280` —partir el controlador de 22 rutas
y tres pisos— **sin mover ni una ruta existente**: nace fuera en vez de engordar el problema.

---

## 4. Lo compartido: una captura, dos consumidores

Es el requisito central del encargo, y se cumple en tres capas.

### 4.1 Una sola captura

`SearchController` acumula, el cron vuelca, y **las tablas son dos**:

```
                       ┌──────────────────────────────────────────┐
  POST /listings/      │                                          │
    :slug/view    ────►│  ListingViewDaily  +  Listing.viewCount  │
  (ya existe)          │                                          │
                       │                                          │──► getMineStats        (Pro)
  GET /search   ──HINCRBY──► Redis ──cron 15m──►                  │──► /admin/stats/…      (staff)
  (nuevo, A)           │  ListingImpressionDaily                  │
                       │  + Listing.impressionCount               │
                       └──────────────────────────────────────────┘
```

**Nadie más escribe.** El backoffice no tiene una sola escritura: si mañana se quisiera contar
otra cosa, se añade a la captura, no a los lectores.

### 4.2 Las agregaciones son consultas, no tablas

Los cuatro ejes del backoffice (anuncio, usuario, categoría, plataforma) son **la misma
consulta con distinto `where`**:

| Vista | Filtro |
|---|---|
| Anuncio | `listingId = :id` |
| Usuario | `listing: { sellerId = :id }` |
| Categoría | `listing: { categoryId IN subárbol }` |
| Plataforma | sin filtro, `GROUP BY` categoría |

**Cero tablas de agregación por eje.** Si un día una de las cuatro no aguanta, la respuesta es
cachearla en Redis (§3.4), no materializarla — materializar añade una segunda fuente de verdad
que puede desviarse de la primera, que es justo lo que este encargo pide no hacer.

**La única asimetría consciente:** el endpoint del Pro devuelve `dailyViews` y
`dailyImpressions` **por separado** (es su forma histórica, `types/index.ts:375-380`) y los del
backoffice devuelven la serie **ya fusionada**. Cambiarle la forma al contrato del Pro por
simetría movería tipos, cliente y tests para no ganar nada. La fusión de series vive en un
helper compartido del servicio y la usan los dos; lo que difiere es solo dónde se aplica.

### 4.3 La gráfica se escribe una vez

`EstadisticasClient.tsx:124-148` tiene hoy la gráfica **incrustada** en el componente del
vendedor. Se **extrae** a un componente propio —`components/stats/SerieTemporal.tsx`— que
recibe `{ date, …series }[]` y una lista de series a pintar, y lo usan:

- la pantalla Pro (2 líneas: vistas, veces listado),
- las cuatro vistas del backoffice (las mismas 2 líneas, distinto agregado).

Es una **extracción, no una reescritura**: el `formatDay` con `Intl.DateTimeFormat('es-ES')`
(`:35-39`), los ejes, el tooltip y el estado vacío («*Aún no hay datos suficientes*», `:143`)
se mueven tal cual. Molde del repo: la misma operación que hizo `ProGate` con los gates
duplicados (`:174-176`).

---

## 5. El plan: orden y ráfagas

### 5.1 El orden: A antes que B, con un matiz

El encargo pregunta si el backoffice de lo ya existente podría ir primero. **Puede, y no
debe.** Las visitas ya están capturadas, así que un backoffice de solo-visitas es construible
hoy — pero **habría que volver a tocar las cuatro vistas** para añadirles la segunda serie, la
columna, el CTR y las deltas. Son cuatro pantallas retocadas dos veces para adelantar un dato
que ya se ve en `/admin/anuncios/[id]` como número suelto.

**A primero.** Es además la parte con riesgo técnico real: si algo del acumulador no cuadra
(coste, dedup, la identidad del visitante en SSR), es mejor descubrirlo **antes** de haber
construido cuatro pantallas que lo dan por hecho.

### 5.2 Las ráfagas

**Ráfaga A1 — la captura.** *(la única con enjundia técnica)*
`ListingImpressionDaily` + `Listing.impressionCount` + migración · el acumulador Redis en
`SearchController` (unión `hits ∪ featured`, sin patrocinado, sin el dueño) · el dedup por
búsqueda · la cabecera `X-Visitor-Hash` desde el BFF · el `@Cron` de volcado con drenaje por
`RENAME` y escritura batched · la purga a 180 días (también de `ListingViewDaily`).
**Nada visible para nadie todavía.**

- **Barrera:** una búsqueda incrementa los contadores de Redis de sus N anuncios y **no toca
  Postgres**; el volcado los pasa a la tabla diaria con la fecha UTC correcta; repetir la
  misma búsqueda dentro de 30 min **no suma**; el dueño no se cuenta a sí mismo; el barrido de
  alertas no genera ni una impresión; matar el proceso a mitad del volcado no pierde el cubo.

**Ráfaga A2 — el vendedor Pro lo ve.**
`getMineStats` devuelve `impressionCount`/`dailyImpressions` en la rama Pro ·
`EstadisticasClient` pinta la segunda línea y el CTR · el texto del `ProGate` · la extracción de
`SerieTemporal.tsx` (§4.3), **que se hace aquí porque es el primer sitio donde se usa dos
veces**.

- **Barrera:** un Pro ve «veces listado» y las dos líneas en la gráfica; un no-Pro sigue viendo
  exactamente lo de siempre y el mismo `ProGate`.

**Ráfaga B1 — la sección, el anuncio y el usuario.**
La fila en `backoffice-sections.ts` · `AdminStatsController` con `MODERATOR` · los endpoints de
anuncio y usuario · la gráfica en la «Actividad» de `/admin/anuncios/[id]` · la «Actividad»
nueva en `/admin/usuarios/[id]`.

- **Barrera:** un MODERATOR ve la sección en el nav y puede abrir las dos pantallas; un EDITOR
  no ve el ítem **y** recibe 403 si va a la URL a mano (los dos lados del gate, que es como
  `admin-roles.spec.ts` ya comprueba el resto).

**Ráfaga B2 — plataforma y categoría.**
`GET /admin/stats/platform` con el `GROUP BY` por categoría · la tabla ordenable con CTR y
deltas · el desglose por categoría (subárbol vía `getDescendantIds`) · los totales de
plataforma con su gráfica.

- **Barrera:** la tabla suma lo mismo que la suma de sus filas; una categoría padre con el
  subárbol incluye lo de sus hijas y sin él no; la pantalla responde en un tiempo razonable con
  datos de un mes (y si no, entra la caché Redis del plan B de §3.4).

**Cuatro ráfagas: dos de A, dos de B.** A1 es la grande.

### 5.3 Las barreras clave, en una línea cada una

| | Lo que hay que poder demostrar |
|---|---|
| **A** | Una impresión se cuenta **sin añadir una escritura a Postgres ni un `await` a la búsqueda** |
| **A** | El dedup corta la repetición y **no** corta dos búsquedas distintas |
| **A** | El Pro lo ve; el no-Pro, no |
| **B** | El staff ve las series correctas, agregadas por usuario y por categoría |
| **B** | El monitoreo de plataforma se lee de un vistazo y **ordena por actividad** |
| **∀** | **Una sola captura**: nadie más escribe telemetría, y las dos audiencias leen las mismas tablas |

---

## 6. Riesgos, deuda y lo que queda fuera

1. **La cifra es falsificable, igual que las vistas.** Un vendedor con un script puede inflar
   sus veces-listado. Es la **misma** exposición que `viewCount` tiene hoy (§2.5), no una
   nueva, y el daño es una cifra de vanidad. Si algún día las veces-listado influyeran en algo
   que reparte dinero o posiciones, **habría que rediseñar el dedup antes**, no después.
2. **Redis pasa a guardar un dato que no es caché.** Un `FLUSHALL` o una caída sin
   persistencia pierde hasta 15 minutos de impresiones. Es aceptable para una métrica de
   vanidad —y se dice aquí para que la decisión sea explícita— pero conviene comprobar que la
   instancia de Redis del despliegue **no** está configurada como caché volátil con
   `maxmemory-policy: allkeys-lru`, que expulsaría el hash bajo presión de memoria.
3. **Portada y blog quedan medio dentro.** Aportan un residuo acotado por su `revalidate: 180`
   (§2.1). Es una decisión, no un descuido; si molesta, el arreglo es el parámetro `surface`
   ya descrito.
4. **`ListingViewDaily` no se purgaba.** Esta parte A lo arregla de paso, y es un cambio de
   comportamiento sobre datos existentes: **180 días es una elección**, no un estándar, y
   conviene confirmarla antes de ejecutar la primera purga.
5. **Fuera del encargo, a propósito:** el scroll real / viewport (§2.1), los clics desde el
   resultado (que sería la otra mitad del embudo: impresión → clic → ficha), la exportación a
   CSV del monitoreo, y las series por superficie.
