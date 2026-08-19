# Diseño — El cuerpo de la ficha de anuncio (P4 + P6)

> **Primer cuerpo de administración.** Se apoya en roles (R1-R4) y borrado (B1-B3),
> los dos en `main`. Origen: [`auditoria-backoffice-administracion.md`](./auditoria-backoffice-administracion.md),
> bloque 2.
>
> **Documento de diseño. Cero código.** Todo lo que sigue está verificado contra el
> código real; el apéndice lleva la lista de comprobaciones con fichero y línea.
>
> P4 — **ver todo**: una ficha de detalle en el backoffice con toda la información
> relacionada de un anuncio.
> P6 — **filtrar y ordenar**: que el moderador encuentre cualquier anuncio, mejor
> que `/busqueda`.

---

## 0. Lo que cambia el orden de este cuerpo

Antes de diseñar nada conviene poner dos hallazgos encima de la mesa, porque
entre los dos convierten a P4 de «mejora del backoffice» en «pieza que falta».

### 0.1 El moderador no puede ver lo que aprueba

La cola de revisión ([`moderacion/page.tsx:204`](../apps/web/src/app/(admin)/admin/moderacion/page.tsx#L204))
enlaza cada anuncio a `/anuncio/{slug}`, la página **pública**. Y la página
pública sirve **sólo anuncios `ACTIVE`**:
[`listings.service.ts:1083`](../apps/api/src/modules/listings/listings.service.ts#L1083)
lanza 404 en cuanto `status !== 'ACTIVE'`, y el frontal lo convierte en
`notFound()` ([`anuncio/[slug]/page.tsx:78`](../apps/web/src/app/(public)/anuncio/[slug]/page.tsx#L78)).

La cola de revisión, por construcción (M3), contiene **exactamente**
`PENDING_REVIEW`. Es decir: **ese enlace está roto el 100 % de las veces**. No hay
ninguna ruta de vista previa para staff — se buscó y no existe.

El moderador aprueba o rechaza **a ciegas**, con el título, el vendedor, la
categoría y la fecha que caben en la fila de la cola. Nada más. No ve la
descripción, ni las fotos, ni el precio, ni los atributos — que es justamente lo
que hay que mirar para decidir si algo se publica.

`/admin/reportes` tiene el mismo enlace ([`reportes/page.tsx:202`](../apps/web/src/app/(admin)/admin/reportes/page.tsx#L202))
y el mismo problema en cuanto el anuncio denunciado no esté activo — que es el
caso habitual cuando alguien ya lo desactivó.

**Consecuencia de diseño:** la ficha no es una pantalla nueva que se añade al
backoffice. Es **el destino que a esos dos enlaces les falta**, y arreglarlos es
parte de P4, no un extra.

### 0.2 La media pieza gratis es más generosa de lo que decía la auditoría

`GET /admin/listings/:id` existe, está protegido con `@MinRole(Role.MODERATOR)`
([`admin.controller.ts:66`](../apps/api/src/modules/admin/admin.controller.ts#L66)),
y **no lo llama nadie**: el cliente web tiene funciones para listar, cambiar
estado y eliminar, pero ninguna para el detalle
([`lib/api/admin.ts`](../apps/web/src/lib/api/admin.ts)).

La auditoría lo dio por «construido». Lo está, y además trae más de lo esperado
([`admin.service.ts:354`](../apps/api/src/modules/admin/admin.service.ts#L354)):
usa `include` sin `select`, así que devuelve **todas** las columnas escalares del
anuncio, más la categoría completa, las imágenes ordenadas, el vendedor (con
`status`, `role` y `createdAt`), **los 10 últimos reportes con su denunciante**, y
el recuento de conversaciones.

De las siete cosas que P4 debe enseñar, **cuatro y media ya vienen servidas**. El
trabajo de backend en P4 es pequeño y está acotado en §1.5.

---

## 1. Bloque 1 — P4: la ficha de detalle

### 1.1 Qué devuelve hoy el endpoint, campo por campo

Verificado en [`admin.service.ts:354-383`](../apps/api/src/modules/admin/admin.service.ts#L354):

| Bloque | Qué trae hoy |
|---|---|
| **El anuncio** | Todas las columnas: `title`, `slug`, `description`, `price`, `currency`, `type`, `condition`, `priceType`, `priceUnit`, `status`, `attributes` (jsonb), ubicación (`city`, `province`, `postalCode`, `latitude`, `longitude`), `phone`, `viewCount`, vídeo (`videoUrl`, `videoPosterUrl`, `videoDurationSeconds`, `videoUploadedAt`), `needsRevalidation`, y las fechas (`publishedAt`, `expiresAt`, `bumpedAt`, `createdAt`, `updatedAt`) |
| **Categoría** | El objeto completo (incluido `attributeSchema`, que hace falta para pintar `attributes` con sus etiquetas) |
| **Imágenes** | Todas, ordenadas por `order` |
| **Vendedor** | `id`, `name`, `email`, `slug`, `status`, `role`, `createdAt` |
| **Reportes** | Los 10 últimos, con el denunciante (`id`, `name`, `slug`) |
| **Recuentos** | `_count.conversations` |

### 1.2 El inventario de P4: qué falta

| Qué debe mostrar la ficha | ¿Está? | De dónde sale |
|---|---|---|
| Campos, estado, precio, fechas, atributos | ✅ | El endpoint |
| Imágenes | ✅ | El endpoint |
| Vídeo (y si está confirmado) | ✅ | El endpoint |
| Categoría | ⚠️ parcial | Trae la categoría, **no su ruta**. Un moderador necesita «Motor › Coches › Berlinas», no «Berlinas». Ampliar con `CategoryTreeService.getAncestorChain` ([`category-tree.service.ts:138`](../apps/api/src/modules/categories/category-tree.service.ts#L138)) |
| Vendedor + enlace a su ficha | ✅ dato / ⚠️ enlace | El dato viene. El enlace es a `/admin/usuarios`, que **ya tiene** panel de detalle (`UserDetailPanel`, [`usuarios/page.tsx:660`](../apps/web/src/app/(admin)/admin/usuarios/page.tsx#L660)) — ver §1.6 |
| Reportes | ✅ | El endpoint (10 últimos) |
| **Valoraciones** | ❌ | `Listing.reviews` existe en el esquema; el endpoint no la incluye. **Ampliar** |
| **Tickets** | ❌ | `Listing.tickets` existe; no incluido. **Ampliar** |
| **Tratos (`Deal`)** | ❌ | `Listing.deals` existe; no incluido. **Ampliar** (útil: un anuncio con trato cerrado no se elimina a la ligera) |
| **Bump / destacado** | ❌ | `bumpedAt` sí viene; `bumpSchedule` (la programación) no. **Ampliar** |
| Favoritos, vistas | ❌ | `_count` sólo trae conversaciones. **Ampliar el `_count`** — es barato y da el pulso del anuncio |
| `needsRevalidation` | ✅ | El endpoint |
| **Por qué está en revisión** | ❌ | **No existe como dato en `Listing`.** Ver §1.3 |
| **Historial de estados / auditoría** | ❌ | Los datos existen en `AuditLog`, **pero no hay ningún endpoint que los lea**. Ver §1.4 |

### 1.3 «Por qué está pendiente de revisión» — el dato que no existe

`Listing` **no tiene** ningún campo de moderación. Se buscó: `requiresReview` sólo
existe en `User` (línea 330 del esquema, nivel usuario de M4) y en `Category`
(línea 458, nivel categoría de M5). El estado de moderación de un anuncio es
`status = PENDING_REVIEW` y nada más.

Así que la pregunta «¿por qué está este anuncio en la cola?» **no se puede
responder leyendo el anuncio**. Hay tres disparadores posibles (palabra
prohibida, vendedor marcado, categoría marcada) y la ficha no puede distinguirlos.

**Decisión de alcance: la ficha muestra lo que puede probar, no adivina.** Enseña
las tres señales por separado —`seller.requiresReview`, la herencia efectiva de la
categoría, y si el título/descripción dan positivo en la lista de palabras— y las
presenta como *señales*, no como *el motivo*. Recomponer el motivo real exigiría
persistirlo en el momento del disparo, y eso es una decisión del cuerpo de
moderación, no de la ficha (queda anotado en §6, **D-3**).

### 1.4 El historial: existe el dato, falta la puerta

`AuditLog` guarda seis acciones sobre anuncios —`LISTING_STATUS_CHANGE`,
`LISTING_APPROVE`, `LISTING_REJECT`, `LISTING_DEACTIVATE`, `LISTING_RESTORE`,
`LISTING_DELETE`— con actor, IP, `before`, `after` y fecha. Y tiene
`@@index([resourceType, resourceId])`, así que pedir el historial de un anuncio
es una consulta indexada y barata.

Lo que no hay es por dónde leerlo: `apps/api/src/modules/audit-log/` contiene
`module`, `service` y `dto` — **ningún controlador**. En todo el proyecto no
existe un solo endpoint que devuelva registros de auditoría.

**Decisión:** P4 añade la lectura, **acotada al recurso**, no un visor general de
auditoría. Un `GET /admin/listings/:id/historial` (o incluir los N últimos en el
propio detalle) es el alcance correcto. Un explorador de `AuditLog` completo es
otra pantalla y otra decisión — probablemente ADMIN, no MODERATOR, porque cruza
todos los recursos y expone IPs de actores. Anotado en §6, **D-4**.

### 1.5 La forma: ruta propia, no panel desplegable

El backoffice ya tiene un precedente: `/admin/usuarios` muestra el detalle como
**fila expandida** dentro de la tabla. Para la ficha de anuncio ese patrón no
sirve, y por razones concretas:

1. **No se puede enlazar.** El hallazgo §0.1 pide que la cola de revisión y los
   reportes apunten a la ficha. Una fila expandida no tiene URL.
2. **No hay sitio.** El inventario de §1.2 son ocho secciones; la fila expandida
   de usuarios cabe porque muestra siete campos.
3. **P3a no cabe.** Un modo edición dentro de una fila de tabla es un callejón.

**La ficha es `/admin/anuncios/[id]`**, ruta propia. Y por la coincidencia **por
segmento** de `sectionForPath` ([`backoffice-sections.ts`](../apps/web/src/config/backoffice-sections.ts)),
esa ruta pertenece automáticamente a la sección `anuncios` y hereda su
`minRole: 'MODERATOR'` **sin tocar el mapa** — ver §4.

### 1.6 Las secciones de la ficha

Orden deliberado: lo que decide una moderación arriba, lo que da contexto abajo.

| # | Sección | Contenido | Origen |
|---|---|---|---|
| 1 | **Cabecera** | Título, estado (badge), precio, vendedor, categoría **con su ruta**, y las acciones (§1.7) | Endpoint + `getAncestorChain` |
| 2 | **El anuncio tal cual** | Fotos (galería), descripción íntegra, atributos con sus etiquetas, vídeo, ubicación, teléfono publicado | Endpoint + `category.attributeSchema` |
| 3 | **Señales de moderación** | `needsRevalidation`, `seller.requiresReview`, herencia de categoría, positivo en palabras prohibidas | §1.3 |
| 4 | **Reportes** | Los del anuncio, con denunciante, motivo y estado; enlace a `/admin/reportes` | Endpoint (ya viene) |
| 5 | **El vendedor** | Identidad, estado de cuenta, rol, antigüedad, recuento de anuncios; **enlace a su ficha** | Endpoint + §1.6 nota |
| 6 | **Actividad** | Vistas, favoritos, conversaciones, tratos, valoraciones, tickets | `_count` ampliado + relaciones nuevas |
| 7 | **Comercial** | `publishedAt`, `expiresAt`, `bumpedAt`, programación de bump | Endpoint + `bumpSchedule` |
| 8 | **Historial** | Los movimientos de `AuditLog`, con actor y fecha | §1.4 |

**Nota sobre el enlace al vendedor.** P2 (la ficha de usuario) no existe como ruta
propia; el detalle vive dentro de `/admin/usuarios`. Hasta que P2 se haga, el
enlace apunta a `/admin/usuarios?destacado={id}` y la lista abre ese usuario ya
desplegado. Es un enlace **que funciona hoy** y que P2 podrá redirigir después sin
tocar la ficha de anuncio.

### 1.7 Las acciones desde la ficha

Todas existen ya. La ficha no inventa ninguna: las reúne donde el moderador está
mirando el anuncio, que es donde debería haberlas tenido siempre.

| Acción | Endpoint | Rol | Cuándo se muestra |
|---|---|---|---|
| Aprobar | `POST /moderation/listings/:id/approve` | MODERATOR | Sólo si `PENDING_REVIEW` |
| Rechazar | `POST /moderation/listings/:id/reject` | MODERATOR | Sólo si `PENDING_REVIEW` |
| Devolver a borrador | `PATCH /admin/listings/:id/status` | MODERATOR | Sólo si `PENDING_REVIEW` |
| Desactivar / Restaurar | `POST /moderation/listings/:id/{deactivate,restore}` | MODERATOR | Según estado |
| Cambiar de estado | `PATCH /admin/listings/:id/status` | MODERATOR | Transiciones válidas |
| **Eliminar** | `DELETE /admin/listings/:id` | **ADMIN** | Sólo si `ARCHIVED` |

**La elección del endpoint no se reimplementa.** `elegirAccionDeEstado`
([`moderacion-routing.ts`](../apps/web/src/app/(admin)/admin/anuncios/moderacion-routing.ts))
ya decide, como función pura y probada, cuándo un cambio de estado es una acción
de moderación con su aviso y su auditoría, y cuándo es un cambio genérico. La
ficha **llama a esa función**. Reescribir la regla en la ficha reabriría
exactamente el defecto que M2 cerró: aprobar sin avisar al vendedor.

### 1.8 El sitio reservado para P1 y P3a

Sin diseñarlos, pero dejándoles hueco:

- **P1 — etiqueta interna.** Va en la **cabecera** (sección 1), junto al estado:
  es un eje de clasificación del staff, hermano visual del `status`, y ahí se ve
  sin desplazarse. Su filtro correspondiente entra en P6 como un eje más (§2.2,
  fila 12). Lo que P1 necesitará y hoy no existe es una columna en `Listing` y su
  entrada en `AuditLog`.
- **P3a — editar.** La ficha nace en **modo lectura**. P3a añade un modo edición
  sobre las mismas secciones 1, 2 y 7 (que son las de campos editables); las
  demás son de sólo lectura por naturaleza. Estructurar la ficha por secciones —y
  no como una lámina única— es precisamente lo que permite que P3a active la
  edición sección a sección en vez de reescribir la pantalla.

### 1.9 Resumen del trabajo de backend en P4

1. Ampliar `getListingById`: `reviews`, `tickets`, `deals`, `bumpSchedule`, y
   `_count` con `favorites`, `viewsDaily`, `reports`.
2. Añadir la **ruta de categoría** (`getAncestorChain`).
3. Añadir la lectura del **historial** acotada al anuncio (§1.4).
4. Añadir las **señales de moderación** (§1.3).

Nada de esto cambia un contrato existente: son adiciones a la respuesta de un
endpoint que hoy **no consume nadie**, lo que hace de P4 una ráfaga con riesgo de
regresión prácticamente nulo en backend.

---

## 2. Bloque 2 — P6: filtrar y ordenar

### 2.1 El criterio: las tareas, no las columnas

Un filtro por columna produce treinta controles y ninguna respuesta. El conjunto
sale de lo que un moderador **hace**, y cada filtro se justifica por la tarea que
desbloquea.

### 2.2 Las tareas, y el filtro que cada una pide

**Núcleo** — el moderador los usa a diario; sin ellos el backoffice no encuentra:

| # | Tarea real | Filtro | ¿Backend hoy? |
|---|---|---|---|
| 1 | «Me han pasado este anuncio, encuéntramelo» | **Texto libre** sobre título (y `id`/`slug` pegados tal cual) | ❌ **No existe.** El hueco más grande |
| 2 | «Qué hay pendiente / qué hay rechazado» | **Estado, múltiple** — hoy sólo admite uno, y las preguntas reales son conjuntos («borrador o pendiente», «todo menos archivado») | ⚠️ Existe, pero de a uno |
| 3 | «Enséñame todo lo de este vendedor» — el paso siguiente a encontrar un mal actor | **Vendedor** | ✅ `sellerId`, sin UI |
| 4 | «Qué se está publicando en esta categoría» | **Categoría, con descendientes** | ⚠️ `categoryId` exacto; falta la descendencia |
| 5 | «Qué está denunciado» | **Tiene reportes** (y «reportes sin resolver») | ❌ No existe |

**Secundarios** — resuelven tareas reales, pero puntuales:

| # | Tarea | Filtro | ¿Backend hoy? |
|---|---|---|---|
| 6 | «Qué entró esta semana», «qué se movió ayer» | **Rango de fechas** sobre `createdAt` / `publishedAt` / `updatedAt` | ❌ |
| 7 | «Precios absurdos» (el 1 € de estafa, el 999 999 € de prueba) | **Rango de precio** | ❌ |
| 8 | «Anuncios que dejaron de cumplir su categoría» | **`needsRevalidation`** | ❌ (columna indexada, filtro sin exponer) |
| 9 | «Qué pasa en esta provincia» | **Provincia / ciudad** | ❌ |
| 10 | «Servicios», «productos de segunda mano» | **Tipo / condición** | ❌ |
| 11 | «Los que llevan vídeo» (más caros de moderar, y son Pro) | **Tiene vídeo** | ❌ |
| 12 | *(P1, futuro)* «Los marcados como *vigilar*» | **Etiqueta interna** | — sitio reservado |

**Recomendación de alcance:** P6 entrega **el núcleo completo (1-5) más 6 y 8**.
El 8 es casi gratis —la columna ya está indexada— y el 6 es el que más se pide en
cuanto hay volumen. Del 7 al 11 quedan como ampliación natural, sin rediseño: el
mecanismo de filtros que se construya debe admitir ejes nuevos sin tocarlo.

### 2.3 Qué soporta hoy el backend, y qué manda la UI

`ListAdminListingsDto` admite `status`, `categoryId`, `sellerId`, `order`
(`recent`|`oldest`), `page`, `perPage`
([`list-admin-listings.dto.ts`](../apps/api/src/modules/admin/dto/list-admin-listings.dto.ts)).

El cliente web manda `status`, `page`, `perPage` y `order`
([`lib/api/admin.ts:59`](../apps/web/src/lib/api/admin.ts#L59)) — y `order` lo usa
**sólo la cola de revisión**, no `/admin/anuncios`. La página de anuncios tiene un
único estado de filtro (`statusFilter`).

Confirmado el diagnóstico de la auditoría: **`categoryId` y `sellerId` están
construidos, probados y sin usar.** Igual que el detalle. Conectar lo que ya
existe es, otra vez, parte del trabajo.

### 2.4 Ordenación

Hoy: `updatedAt desc`, o `asc` con `order=oldest`
([`admin.service.ts:325`](../apps/api/src/modules/admin/admin.service.ts#L325)).

Propuesta — sólo ejes con una pregunta detrás:

| Orden | Para qué |
|---|---|
| `updatedAt` ↓ (**por defecto**) | «Qué se ha movido» — se mantiene, no cambia nada |
| `updatedAt` ↑ | La cola: lo que lleva más esperando. **Ya existe** |
| `createdAt` ↓ / ↑ | «Lo último que entró» / «lo más viejo que sigue vivo» |
| `price` ↓ / ↑ | Se combina con el filtro de precio para cazar valores absurdos |
| `nº de reportes` ↓ | Lo más denunciado primero — el orden natural de la bandeja de problemas |

Fuera: título (nadie ordena un backoffice alfabéticamente para trabajar) y
distancia geográfica (es de `/busqueda`, no de moderación).

`order=recent|oldest` se queda como está y los ejes nuevos entran por un
parámetro que lo extienda sin romperlo — la cola de revisión ya depende de él.

### 2.5 Comparación con `/busqueda`: superarlo, no copiarlo

`/busqueda` filtra por `q`, `category`, `type`, `condition`, `priceType`,
`priceUnit`, `minPrice`, `maxPrice`, `province`, `city`, `tags` y los atributos
de categoría; ordena por `price`, `publishedAt`, `sortDate` y distancia
([`search-query.dto.ts`](../apps/api/src/modules/search/dto/search-query.dto.ts)).
Es **más rico** que el backoffice en todo excepto en una cosa.

Y esa cosa lo decide todo: **`/busqueda` sólo ve anuncios `ACTIVE`**
([`search.service.ts:403`](../apps/api/src/modules/search/search.service.ts#L403)).
Un anuncio en borrador, en revisión, rechazado, pausado o archivado **no existe**
para `/busqueda`. El moderador trabaja sobre todo con esos.

De ahí que «mejor que `/busqueda`» no signifique «los mismos filtros y más», sino:

| Eje | `/busqueda` | Backoffice |
|---|---|---|
| Universo | Sólo `ACTIVE` | **Los 9 estados** |
| Vendedor | No (no es un eje público) | **Sí** — el eje más útil en moderación |
| Reportes | No (invisible al público) | **Sí** |
| Señales internas | No | **Sí** (`needsRevalidation`, y P1) |
| Atributos de categoría, geo, tags | Sí, muy rico | **No hacen falta**: son ejes de *descubrimiento*, no de moderación |

El backoffice no necesita el motor de facetas; necesita **ejes que el público no
puede ver**. Copiar `/busqueda` sería construir lo caro y seguir sin lo útil.

---

## 3. Bloque 3 — Rendimiento y escala

### 3.1 Los filtros van a Postgres, y no es una preferencia

Meilisearch indexa **sólo `ACTIVE`**: el indexador filtra explícitamente antes de
enviar y borra del índice cualquier documento que deje de estarlo
([`search.service.ts:403` y `:431`](../apps/api/src/modules/search/search.service.ts#L403)).
Un backoffice que filtra por `DRAFT`, `PENDING_REVIEW`, `REJECTED` o `ARCHIVED`
**no puede** apoyarse en Meili: el dato no está ahí. No es que sea peor idea —
es imposible.

Los filtros de P6 van a **Prisma sobre Postgres**, que además es lo que ya hace
`listListings`. Y hay un beneficio de arquitectura: el backoffice deja de
depender de que Meili esté sano. Si el índice se cae o se está reconstruyendo, la
moderación sigue trabajando.

### 3.2 Los índices: uno falta, y es el del orden por defecto

Índices actuales de `Listing`: `[categoryId, status]`, `[status, publishedAt]`,
`[sellerId]`, `[price]`, `[province, city]`, `[needsRevalidation]`.

| Filtro propuesto | ¿Cubierto? |
|---|---|
| Vendedor | ✅ `[sellerId]` |
| Categoría (con `IN` de descendientes) | ✅ `[categoryId, status]` |
| Estado | ⚠️ ver abajo |
| Precio | ✅ `[price]` |
| `needsRevalidation` | ✅ |
| Provincia/ciudad | ✅ |
| Texto sobre título | ❌ ver §3.3 |
| Tiene reportes | ❌ se resuelve con `reports: { some: {} }` (semi-join por la FK de `Report`, ya indexada) |

**El hueco.** El orden por defecto de la lista es `updatedAt`, y **no hay ningún
índice sobre `updatedAt`**. `[status, publishedAt]` no sirve para ordenar por
`updatedAt`: Postgres puede usarlo para el filtro, pero tendrá que ordenar el
resultado a mano. Con pocos miles de filas da igual; con volumen, la pantalla
principal del backoffice es la que se degrada primero. **P6 añade
`@@index([status, updatedAt])`** (y `[updatedAt]` si se permite ordenar sin
filtrar por estado), que es la combinación real de la consulta.

### 3.3 La búsqueda por texto, con su umbral dicho

El filtro #1 sobre el título será `contains` insensible a mayúsculas, es decir
`ILIKE '%texto%'`. Un comodín por delante **no usa un índice B-tree**: es un
recorrido de la tabla.

Se acepta a propósito para la primera versión, porque el volumen actual no lo
justifica y la alternativa es infraestructura nueva. Pero se deja escrito el
umbral en vez de descubrirlo en producción: **si `Listing` pasa de ~100 000 filas
o la lista tarda más de ~300 ms, la salida es un índice GIN con `pg_trgm`** sobre
`title`, que es la solución estándar y no obliga a cambiar la consulta. Alternativa
descartada: mandar el texto a Meili y cruzarlo con Postgres — reintroduce la
dependencia que §3.1 acaba de quitar, y sigue sin ver los estados no públicos.

### 3.4 Paginación y recuento

`listListings` ya pagina (`skip`/`take`, 24 por defecto) y devuelve `total`
mediante un `$transaction` con `count`. Se mantiene tal cual: es correcto y el
`count` filtrado sobre columnas indexadas no es un problema a esta escala.

`_count.reports` por fila lo resuelve Prisma con una subconsulta correlacionada —
una sola consulta, no N+1. Al ampliar los recuentos en el **detalle** (§1.9) el
coste es irrelevante: es una fila.

---

## 4. Bloque 4 — Permisos

Sobre la fuente única de roles (R2), sin excepciones nuevas.

- **La sección.** `{ id: 'anuncios', route: '/admin/anuncios', minRole: 'MODERATOR' }`
  ([`backoffice-sections.ts:96`](../apps/web/src/config/backoffice-sections.ts#L96)).
- **La ficha hereda sin tocar el mapa.** `sectionForPath` casa **por segmento** y
  elige la coincidencia más larga, así que `/admin/anuncios/{id}` pertenece a la
  sección `anuncios` y queda en MODERATOR automáticamente. No hay que añadir
  ninguna entrada — y **no se debe**: una entrada nueva para la ficha crearía una
  segunda verdad sobre el mismo permiso.
- **El backend ya está alineado.** `GET /admin/listings` y `GET /admin/listings/:id`
  son `@MinRole(Role.MODERATOR)`; el controlador de moderación es MODERATOR a
  nivel de clase; `DELETE /admin/listings/:id` es `@MinRole(Role.ADMIN)`.
- **La ficha muestra lo que el rol puede hacer.** Un MODERATOR no ve el botón de
  eliminar. Y eso es **presentación, no seguridad**: el backend lo rechaza igual.
  El precedente exacto está en `/admin/anuncios`, donde B2 dejó
  `puedeEliminar = session?.user.role === 'ADMIN'`.

**Comprobación de coherencia (INV-1).** Como la relación sección↔endpoint es
muchos-a-muchos, la alineación no se puede derivar: se verifica por comportamiento.
Un test de que un EDITOR recibe 403 en `GET /admin/listings/:id` y un MODERATOR
200 es lo que impide que ficha y endpoint se separen en silencio.

---

## 5. Bloque 5 — El plan de ráfagas

Dos ráfagas. El orden lo fija §0.1: **la ficha primero**, porque hay dos pantallas
con un enlace roto esperándola.

### F1 — La ficha (P4)

**Backend:** ampliar `getListingById` (§1.9), la ruta de categoría, el historial
acotado, las señales de moderación.
**Frontend:** la ruta `/admin/anuncios/[id]` con sus ocho secciones; las acciones
reutilizando `elegirAccionDeEstado`; **redirigir los enlaces de
`/admin/moderacion` y `/admin/reportes`** a la ficha en vez de a la página
pública; enlace «ver ficha» desde cada fila de `/admin/anuncios`.

**La barrera de esta ráfaga** es un test que hoy fallaría: un moderador abre un
anuncio `PENDING_REVIEW` desde la cola y **ve su descripción y sus fotos**. Es la
frase exacta que §0.1 dice que es imposible. Junto a él: que aprobar desde la
ficha registre `LISTING_APPROVE` y avise al vendedor (Jest), y que un EDITOR reciba
403 (INV-1).

Al terminar F1 `main` queda coherente: la ficha existe, los enlaces rotos están
arreglados, y `/admin/anuncios` sigue funcionando igual que hoy.

### F2 — Filtrar y ordenar (P6)

**Backend:** ampliar `ListAdminListingsDto` con texto, estado múltiple, categoría
con descendientes (`getDescendantIds`), tiene-reportes, rango de fechas y
`needsRevalidation`; los ejes de orden nuevos; **la migración del índice**
`[status, updatedAt]` (§3.2).
**Frontend:** los controles de filtro sobre `/admin/anuncios`, conectando de paso
`categoryId` y `sellerId`, que ya estaban construidos.

**La barrera:** Playwright encuentra un anuncio en `DRAFT` de un vendedor concreto
combinando dos filtros — algo que `/busqueda` no puede hacer por definición. Y en
Jest, que el filtro de categoría **incluye los descendientes** (un anuncio en la
nieta aparece al filtrar por la abuela), que es la parte que se implementa mal con
más facilidad.

### Después

**P1** (etiqueta interna) entra en la cabecera de la ficha y añade su eje a los
filtros de F2 — las dos piezas ya con su sitio. **P3a** (editar) convierte las
secciones 1, 2 y 7 en editables. Ninguna de las dos necesita rediseñar lo que este
documento propone; ése es el motivo de que la ficha vaya primero.

---

## 6. Decisiones abiertas

| # | Decisión | Recomendación |
|---|---|---|
| **D-1** | ¿La ficha es ruta propia o panel desplegable como en `/admin/usuarios`? | **Ruta propia** (§1.5). Sin URL no se puede arreglar el enlace roto de §0.1, que es la mitad del valor de P4 |
| **D-2** | ¿P6 entrega los 12 ejes o el núcleo? | **Núcleo (1-5) + 6 y 8** (§2.2). El resto entra después sin rediseño |
| **D-3** | ¿Se persiste *por qué* un anuncio entró en revisión? | **Fuera de este cuerpo.** La ficha enseña las tres señales por separado (§1.3). Persistir el motivo es del cuerpo de moderación |
| **D-4** | ¿La lectura de `AuditLog` es acotada al anuncio o un visor general? | **Acotada** (§1.4). Un visor general cruza recursos y expone IPs — probablemente ADMIN, y es otra pantalla |
| **D-5** | ¿A dónde enlaza el vendedor mientras P2 no existe? | **`/admin/usuarios?destacado={id}`** (§1.6). Funciona hoy y P2 lo redirige después |

### Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| 1 | La ficha reescribe la elección de endpoint de moderación y reabre el defecto de M2 (aprobar sin avisar) | Llamar a `elegirAccionDeEstado`, no reimplementarla (§1.7). Test de que aprobar desde la ficha notifica |
| 2 | El filtro de categoría se implementa exacto y el moderador no ve lo de las subcategorías | Reusar `getDescendantIds`; es la barrera explícita de F2 |
| 3 | La lista se degrada al crecer, empezando por su propia pantalla principal | El índice `[status, updatedAt]` entra en F2, no «cuando se note» (§3.2) |
| 4 | El texto libre se convierte en un escaneo lento sin que nadie lo vea venir | Umbral escrito y salida decidida de antemano (§3.3) |
| 5 | Añadir la ficha al mapa de secciones crea una segunda verdad sobre el permiso | No se añade: hereda por segmento (§4) |

### Lo que este cuerpo NO hace

- No diseña P1 (etiqueta interna) ni P3a (editar): sólo les deja el sitio.
- No construye P2 (ficha de usuario): enlaza a lo que ya existe.
- No toca `/busqueda` ni el índice de Meilisearch.
- No añade un visor general de auditoría.
- No cambia el borrado ni los roles: se apoya en los dos, tal como están.

---

## Apéndice — inventario verificado

| Qué | Dónde | Dato |
|---|---|---|
| El detalle existe y nadie lo llama | [`admin.controller.ts:66`](../apps/api/src/modules/admin/admin.controller.ts#L66) · [`lib/api/admin.ts`](../apps/web/src/lib/api/admin.ts) | `@Get('listings/:id')` `@MinRole(MODERATOR)`; el cliente web sólo tiene list, status y delete |
| Qué devuelve el detalle | [`admin.service.ts:354`](../apps/api/src/modules/admin/admin.service.ts#L354) | `include` sin `select` → todas las columnas + categoría + imágenes + vendedor + 10 reportes + `_count.conversations` |
| Filtros del backend | [`list-admin-listings.dto.ts`](../apps/api/src/modules/admin/dto/list-admin-listings.dto.ts) | `status`, `categoryId`, `sellerId`, `order`, `page`, `perPage` |
| Lo que manda la UI | [`lib/api/admin.ts:59`](../apps/web/src/lib/api/admin.ts#L59) | `status`, `page`, `perPage`, `order` — `categoryId` y `sellerId` **sin usar** |
| La página usa un solo filtro | [`anuncios/page.tsx:102`](../apps/web/src/app/(admin)/admin/anuncios/page.tsx#L102) | único estado `statusFilter` |
| **El enlace roto de la cola** | [`moderacion/page.tsx:204`](../apps/web/src/app/(admin)/admin/moderacion/page.tsx#L204) | `/anuncio/{slug}` sobre una cola que sólo tiene `PENDING_REVIEW` |
| **La pública sólo sirve ACTIVE** | [`listings.service.ts:1083`](../apps/api/src/modules/listings/listings.service.ts#L1083) · [`anuncio/[slug]/page.tsx:78`](../apps/web/src/app/(public)/anuncio/[slug]/page.tsx#L78) | `status !== 'ACTIVE'` → 404 → `notFound()` |
| No hay vista previa de staff | búsqueda en `listings.controller.ts` y `app/anuncio` | 0 coincidencias de `preview` |
| El mismo enlace en reportes | [`reportes/page.tsx:202`](../apps/web/src/app/(admin)/admin/reportes/page.tsx#L202) | `/anuncio/{slug}` |
| Meili sólo indexa ACTIVE | [`search.service.ts:403`, `:431`](../apps/api/src/modules/search/search.service.ts#L403) | `.filter((l) => l.status === 'ACTIVE')` |
| Filtros/orden de `/busqueda` | [`search-query.dto.ts`](../apps/api/src/modules/search/dto/search-query.dto.ts) · `SORTABLE_ATTRIBUTES` | 11 filtros + atributos; orden por `price`, `publishedAt`, `sortDate`, `_geo` |
| Índices de `Listing` | `schema.prisma` | `[categoryId,status]`, `[status,publishedAt]`, `[sellerId]`, `[price]`, `[province,city]`, `[needsRevalidation]` — **ninguno sobre `updatedAt`** |
| Orden por defecto de la lista | [`admin.service.ts:325`](../apps/api/src/modules/admin/admin.service.ts#L325) | `updatedAt desc` / `asc` con `order=oldest` |
| `Listing` no tiene campo de moderación | `schema.prisma` | `requiresReview` está en `User` (330) y `Category` (458), no en `Listing` |
| `AuditLog` tiene el historial y ningún lector | `schema.prisma:1078` · `apps/api/src/modules/audit-log/` | 6 acciones `LISTING_*`, `@@index([resourceType, resourceId])`; el módulo **no tiene controlador** |
| La ficha hereda el permiso | [`backoffice-sections.ts:96`](../apps/web/src/config/backoffice-sections.ts#L96) | sección `anuncios` MODERATOR; `sectionForPath` casa **por segmento**, coincidencia más larga |
| Acciones de moderación | [`moderation.controller.ts:29`](../apps/api/src/modules/moderation/moderation.controller.ts#L29) | `@MinRole(MODERATOR)` a nivel de clase; approve/reject/deactivate/restore |
| Eliminar es ADMIN | [`admin.controller.ts:93`](../apps/api/src/modules/admin/admin.controller.ts#L93) | `@MinRole(Role.ADMIN)`, sólo sobre `ARCHIVED` (B2) |
| La regla de qué endpoint usar ya existe | [`moderacion-routing.ts`](../apps/web/src/app/(admin)/admin/anuncios/moderacion-routing.ts) | `elegirAccionDeEstado`, función pura y probada (M2) |
| Precedente de detalle desplegable | [`usuarios/page.tsx:660`](../apps/web/src/app/(admin)/admin/usuarios/page.tsx#L660) | `UserDetailPanel` en fila expandida; `GET /admin/users/:id` **sí** se consume |
| Lector único de la jerarquía | [`category-tree.service.ts:138`, `:156`](../apps/api/src/modules/categories/category-tree.service.ts#L138) | `getAncestorChain` (ruta) y `getDescendantIds` (filtro con descendencia) |
