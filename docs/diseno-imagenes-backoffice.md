# Diseño — Edición de imágenes en el backoffice (reordenar y eliminar)

**Estado:** diseño, sin implementar. Cero código escrito.
**Encargo:** que un MODERATOR o ADMIN pueda, desde `/admin/anuncios/:id`, cambiar el
orden de las fotos de un anuncio y eliminarlas, respetando el mínimo.
**Verificado contra el código** el 2026-08-28, `main` (`f098f34`). Cada afirmación
lleva fichero y línea; lo que no se ha podido comprobar se dice.

---

## 0. Resumen para decidir — el encargo no es lo que parecía

> **El backend ya lo hace todo.** Reordenar, eliminar, escribir el `order`, borrar
> los DOS objetos de R2 por cola, validar el tope, aislar entre anuncios y dejar
> rastro en `AuditLog` con la URL de lo retirado. Existe, está probado y **lo
> comparten el dueño y el staff por el mismo camino**.
>
> Lo que falta es **la interfaz**: `/admin/anuncios/:id` pinta la galería en modo
> lectura y nunca manda `imageIds`. El endpoint acepta el campo; nadie se lo envía.

| Pregunta del encargo | Lo que dice el código |
|---|---|
| ¿Hay columna de orden? | **Sí.** `ListingImage.order Int @default(0)` ([schema.prisma:1201](../apps/api/prisma/schema.prisma#L1201)). Sin migración, sin backfill. |
| ¿Reordenar no existe? | **Existe en el backend, para los dos caminos.** `ListingImagesService.sync` escribe el `order` por posición del array ([listing-images.service.ts:155-166](../apps/api/src/modules/listings/listing-images.service.ts#L155-L166)). |
| ¿`media/upload` no tiene DELETE? | Cierto, pero **la eliminación de fotos no pasa por ahí**: `sync` borra la fila y encola las dos claves R2 ([:131-179](../apps/api/src/modules/listings/listing-images.service.ts#L131-L179)) usando `listingMediaKeys`, el lector único. Ya está hecho, y con el comentario que explica por qué. |
| ¿Hay ficha de detalle en el backoffice? | **Sí**, `/admin/anuncios/[id]`, 1160 líneas, con modo edición por secciones y la galería ya pintada ([page.tsx:593-611](../apps/web/src/app/(admin)/admin/anuncios/[id]/page.tsx#L593-L611)). |
| ¿Eliminar respeta el mínimo? | **NO, y el mínimo no es lo que el encargo supone** (§1.4). No hay ningún invariante de «mínimo de fotos»: hay una **regla de puerta, apagada por defecto, que solo mira al publicar y al aprobar**. Ésta es la única decisión de producto real del encargo. |
| ¿Hay que diseñar el backend reutilizable? | **Ya lo es.** `sync` es el camino único: lo llaman la creación del dueño, la edición del dueño y la edición de staff (§1.2). No hay puerta que dejar abierta: está abierta. |

**Consecuencia sobre el plan:** esto no son dos ráfagas (modelo+backend / UI). Es
**una ráfaga de frontend** más, si Ernest lo decide, **una regla de treinta líneas**
en el backend para el mínimo. Ver §8.

---

## 1. El punto de partida — verificado

### 1.1 El orden ya existe, y la cadena entera lo respeta

```prisma
// apps/api/prisma/schema.prisma:1195-1211
model ListingImage {
  id     String  @id @default(cuid())
  url    String
  alt    String?
  width  Int?
  height Int?
  order  Int     @default(0)
  listingId String?
  …
}
```

Y no es una columna muerta: **los cuatro consumidores la usan**.

| Superficie | Dónde | Ordena |
|---|---|---|
| Ficha pública `GET /listings/:slug` | [`listing-summary.ts:177-180`](../apps/api/src/modules/listings/listing-summary.ts#L177-L180) (`RELACIONES_DE_FICHA`) | `orderBy: { order: 'asc' }` |
| Tarjeta de listado (la miniatura) | [`listing-summary.ts:91`](../apps/api/src/modules/listings/listing-summary.ts#L91) | `orderBy: { order: 'asc' }, take: 1` |
| Documento de Meilisearch | [`search.service.ts:313`](../apps/api/src/modules/search/search.service.ts#L313) y `:805-806` | `orderBy: { order: 'asc' }` |
| Ficha del backoffice | [`admin.service.ts:770`](../apps/api/src/modules/admin/admin.service.ts#L770) | `orderBy: { order: 'asc' }` |
| Exportación de datos (RGPD) | [`data-export.collector.ts:333`](../apps/api/src/modules/data-export/data-export.collector.ts#L333) | `orderBy: { order: 'asc' }` |

**Lo que esto significa para el encargo:** reordenar en el backoffice se refleja
**solo** en la ficha pública, la miniatura de las tarjetas y el índice de búsqueda,
sin tocar una línea de esos cinco sitios. Y `take: 1` sobre el orden es lo que
convierte «mover una foto al primer puesto» en «cambiar la foto de portada» —el uso
real de reordenar—, sin que exista ningún concepto de «portada» que mantener.

> **Comprobación que sí hacía falta y salió limpia:** el único `images: { select: …
> }` sin `orderBy` del repo ([`listings.service.ts:1143`](../apps/api/src/modules/listings/listings.service.ts#L1143))
> es la recogida de claves para borrar un borrador entero. Ahí el orden da igual: se
> van todas.

### 1.2 Reordenar y eliminar ya están implementados, y en un solo sitio

[`ListingImagesService.sync`](../apps/api/src/modules/listings/listing-images.service.ts)
recibe `{ listingId, sellerId, imageIds }` y **deja el anuncio con exactamente esas
fotos, en ese orden**. `imageIds` es la lista final, no un delta. Hace, en este orden:

1. **El tope** (`photoLimits.getMax()`, 422 si se pasa) — línea 97-102.
2. **Existencia** de todas las ids (422 con la lista de las que faltan) — 109-112.
3. **Aislamiento entre anuncios**: una foto ya vinculada a otro anuncio se rechaza — 114-119.
4. **Propiedad**, solo sobre las que entran: una imagen suelta debe ser del vendedor — 121-123.
5. **Calcula las claves R2 ANTES de borrar la fila**, con `listingMediaKeys` — 131-139.
6. En transacción: **borra las filas** que salen (`deleteMany` acotado a `listingId`) y **escribe el `order` por posición del array** — 141-167.
7. **Tras el commit**, encola `purge` en `QUEUE_MEDIA_CLEANUP` con las claves — 174-179.
8. Devuelve `retiradas: {id, url}[]` para que quien llame lo registre.

**Y lo llaman los tres caminos:**

| Camino | Dónde |
|---|---|
| Crear (dueño) | [`listings.service.ts:303`](../apps/api/src/modules/listings/listings.service.ts#L303) |
| Editar (dueño) | [`listings.service.ts:412`](../apps/api/src/modules/listings/listings.service.ts#L412) |
| **Editar (staff)** | [`admin.service.ts:1076`](../apps/api/src/modules/admin/admin.service.ts#L1076) |

> **El requisito de «backend reutilizable» del encargo ya está cumplido, y no por
> casualidad.** La cabecera del fichero documenta que había dos implementaciones
> divergentes y que la del staff «no escribía el `order` — reordenar desde el
> backoffice respondía 200 y no movía nada. Un silencio, que es la peor forma de
> fallo». Se unificaron en la ráfaga 2b. El día que se quiera el reordenar del
> dueño, no hay nada que construir: su camino ya pasa por aquí.

### 1.3 La limpieza de los dos objetos ya está resuelta

`sync` usa [`listingMediaKeys`](../apps/api/src/infra/r2/media-keys.ts), que por cada
URL de imagen devuelve **el original y su miniatura** (`thumbKeyFor`, la única copia
de la regla `media/abc.jpg → media/abc-thumb.webp`). La cola
([`media-cleanup.processor.ts`](../apps/api/src/infra/queue/processors/media-cleanup.processor.ts))
borra clave a clave, tolera fallos sueltos y reporta a Sentry si el job entero falla.

**Nada que diseñar aquí.** El encargo pedía «reutilizar `listingMediaKeys`, no
derivar la clave a mano»: ya se reutiliza, y en el único punto por el que una foto
puede salir de un anuncio.

### 1.4 EL MÍNIMO NO ES UN INVARIANTE — y esto cambia el encargo

El encargo parte de que «el mínimo ya es regla» y de que «eliminar NO puede bajar del
mínimo». **Lo verificado dice otra cosa**, y conviene leerlo entero porque es la
única decisión de producto que queda abierta.

```ts
// apps/api/src/modules/listing-gate/photo-limits.ts:35-39
export const DEFAULT_MIN_PHOTOS = 1;
export const MIN_PHOTOS_SETTING = 'minPhotosPerListing';
/** El interruptor SÓLO del mínimo. El máximo no lo necesita: ya se aplicaba. */
export const MIN_PHOTOS_RULE_ENABLED_SETTING = 'minPhotosRuleEnabled';
```

Tres hechos:

1. **Nace apagada.** `minPhotosRuleEnabled` por defecto `false`
   ([`admin.service.ts:353`](../apps/api/src/modules/admin/admin.service.ts#L353)), y
   `isMinEnforced()` devuelve `false` sin fila
   ([`photo-limits.service.ts:47-53`](../apps/api/src/modules/listing-gate/photo-limits.service.ts#L47-L53)).
   El fichero explica por qué: *«puede haber anuncios publicados con cero fotos… y
   encenderla sin ese número delante es justo lo que el informe existe para evitar»*.
2. **No es un invariante, es una PUERTA.** `MinPhotosRule.appliesTo` devuelve `true`
   **solo** en dos transiciones ([`min-photos.rule.ts:66-72`](../apps/api/src/modules/listing-gate/rules/min-photos.rule.ts#L66-L72)):
   el vendedor **publica**, o el staff **aprueba**. Su propio spec fija que **no**
   aplica a `renew`, `reactivate`, `restore`, `adminStatus`, `create`, `bump` ni
   `featured`.
3. **`sync` solo aplica el MÁXIMO.** No hay ninguna comprobación de mínimo en el
   camino por el que se quitan fotos — ni para el dueño ni para el staff. **Hoy,
   editando, cualquiera de los dos puede dejar un anuncio ACTIVO con cero fotos.**

**Y la tensión que el encargo señalaba ya está resuelta en el código, en dirección
contraria a lo que suponía.** La cabecera de `MinPhotosRule` la aborda de frente
([:38-49](../apps/api/src/modules/listing-gate/rules/min-photos.rule.ts#L38-L49)):

> *«El argumento de entonces era que aplicarla al aprobar dejaría al moderador
> atrapado —no puede añadirle fotos a un anuncio ajeno— … **El moderador ya no está
> atrapado**, porque tiene una tercera salida: devolver el anuncio a borrador
> (`PENDING_REVIEW → DRAFT`) para que su dueño lo complete.»*

O sea: **bloquear la eliminación no hace falta para desatascar al moderador**. Ya
tiene salida. La pregunta que queda es otra, y es de producto: §4.2.

### 1.5 La ficha del backoffice existe y ya pinta la galería

[`/admin/anuncios/[id]/page.tsx`](../apps/web/src/app/(admin)/admin/anuncios/[id]/page.tsx),
1160 líneas, Client Component. Estructura relevante:

- **Galería en modo lectura** (líneas 593-611): rejilla `grid-cols-3 sm:grid-cols-4`
  de cuadrados con `next/image`, `data-testid="ficha-imagen"`. Sin controles.
- **Modo edición por sección** (614+): el patrón de P3a — *«quien viene a corregir un
  título no debe encontrarse un formulario de veinte campos»*. La galería está
  **fuera** del formulario de edición, encima.
- El guardado (`guardarEdicion`, línea 345-370) llama a `updateAdminListing` con
  título, descripción, precio, motivo y atributos. **`imageIds` no se envía nunca**,
  aunque el cliente HTTP lo acepta ([`lib/api/admin.ts:378`](../apps/web/src/lib/api/admin.ts#L378)).

Esto último está anotado en el backend como bomba desactivada: *«Nadie podía
provocarlo porque la interfaz nunca mandaba `imageIds`»*
([listing-images.service.ts:30-32](../apps/api/src/modules/listings/listing-images.service.ts#L30-L32)).
Encender el mecanismo es exactamente lo que hace esta ráfaga — y por eso importa que
las validaciones que 2b puso ya estén ahí.

---

## 2. El modelo del orden — no hay nada que hacer

**Sin migración, sin columna nueva, sin backfill.** `order` existe, tiene `@default(0)`
y `sync` lo reescribe entero en cada guardado (por posición del array, de 0 a n-1).

Un matiz que conviene tener presente y **no arreglar**: los anuncios creados antes de
2b por el camino de staff pueden tener todas sus fotos con `order = 0`. Con empate,
Postgres no garantiza orden estable, así que su galería puede verse en un orden
arbitrario. **Se corrige solo en cuanto alguien guarde el orden una vez** — que es
justamente lo que esta ráfaga permite hacer. Un backfill sería trabajo para algo que
la propia función arregla al usarse.

---

## 3. Reordenar

### 3.1 El mecanismo: flechas ↑↓ con guardado explícito

**Recomendación: flechas, no drag & drop.** Tres motivos, en orden de peso:

1. **El molde existe y está probado** — `/admin/categorias`
   ([page.tsx:872-913](../apps/web/src/app/(admin)/admin/categorias/page.tsx#L872-L913)),
   `/admin/motivos-contacto`, `/admin/footer`, `/admin/nav`. Cinco pantallas del
   backoffice reordenan con flechas; ninguna con drag & drop.
2. **El backoffice se usa con teclado y en pantallas de trabajo**, no con el pulgar.
3. Drag & drop exige una dependencia nueva o ~200 líneas de manejo de punteros, más
   accesibilidad propia. Es la clase de lujo que se paga en mantenimiento.

**Pero con una diferencia respecto al molde de categorías**, y es importante:

| | Categorías | Fotos (propuesta) |
|---|---|---|
| Cada clic de flecha | `PATCH …/reorder` + recarga | **solo estado local** |
| Guardar | implícito, uno por clic | **explícito, un botón** |

**Por qué diverge.** En categorías, reordenar es un `PATCH` diminuto sobre dos filas.
Aquí no: la única puerta es `PATCH /admin/listings/:id`, que en cada llamada
**refresca las detecciones de texto, invalida la caché de la ficha en Redis y encola
un reindexado** ([admin.service.ts:1134-1147](../apps/api/src/modules/admin/admin.service.ts#L1134-L1147)).
Mover una foto cuatro puestos serían cuatro reindexados. Y hay una segunda razón, aún
más concreta: **`reason` es obligatorio** (§3.3).

Con el guardado explícito, la semántica encaja con `sync` sin forzar nada: `sync`
**ya espera la lista final, no un delta**. El cliente reordena en local y manda el
array completo una vez.

### 3.2 El endpoint: el que ya hay

`PATCH /admin/listings/:id` con `{ imageIds: [...], reason: "..." }`.
`@MinRole(Role.MODERATOR)` ([admin.controller.ts:97-106](../apps/api/src/modules/admin/admin.controller.ts#L97-L106)).

**No se crea `PATCH /admin/listings/:id/images/reorder`.** Sería un segundo camino
por el que las fotos de un anuncio cambian, y la cabecera de `ListingImagesService`
existe precisamente porque haber tenido dos costó tres defectos, uno de ellos
explotable. El campo ya está en el DTO
([`update-admin-listing.dto.ts:79-83`](../apps/api/src/modules/admin/dto/update-admin-listing.dto.ts#L79-L83))
y en el cliente HTTP del frontend.

### 3.3 `reason` es obligatorio — y es una decisión de UX, no un detalle

```ts
// update-admin-listing.dto.ts:100-109
/**
 * El motivo del cambio. Va al `AuditLog`, no al anuncio: sin él, una edición de
 * staff sería indistinguible de una del dueño…
 */
@IsString() @IsNotEmpty() @MinLength(5) @MaxLength(500)
reason!: string;
```

Cinco caracteres mínimos. Y hay un e2e que lo fija: *«el motivo es obligatorio: sin
él, no se puede guardar»* ([`admin-editar-anuncio.spec.ts:104`](../apps/web/e2e/admin-editar-anuncio.spec.ts)).

| Opción | Qué implica |
|---|---|
| **R1. Reutilizar el motivo del bloque de edición** | La galería entra en el mismo modo edición que el título y la descripción: se toca lo que sea, se escribe un motivo, se guarda todo junto. **Cero código nuevo de motivo**, coherente con P3a. Coste: para mover una foto hay que abrir «Editar» y escribir algo. |
| **R2. Bloque de fotos con su propio modo edición y su propio motivo** | Más quirúrgico (P3a partió la ficha en secciones justamente para esto). Coste: un segundo formulario y un segundo motivo. |
| **R3. Motivo automático** («Reordenar fotos») | Sin fricción. Coste: vacía de sentido el campo — un `AuditLog` lleno de motivos que nadie escribió es peor que ninguno, y contradice el porqué escrito en el DTO. |

**Recomendación: R2.** P3a ya estableció la sección como unidad de edición, y las
fotos son una sección. R1 obligaría a que tocar una foto arrastre título y
descripción en el mismo `PATCH`, lo que ensucia el `before/after` del `AuditLog`.
**R3 se descarta**: falsifica el registro.

### 3.4 El reindexado: automático

`updateListing` ya invalida `cacheKey(slug)` en Redis y encola `index`. El orden
nuevo llega al documento de Meilisearch por `INDEX_INCLUDE.images.orderBy`
([search.service.ts:313, 805-806](../apps/api/src/modules/search/search.service.ts#L313)).
**Nada que añadir.**

---

## 4. Eliminar

### 4.1 El mecanismo: quitar de la lista y guardar

Eliminar **no es una operación aparte**: es enviar `imageIds` sin esa id. `sync`
borra la fila, encola las dos claves y devuelve `retiradas`. El mismo botón de
guardar que el orden, la misma llamada.

**El `AuditLog` ya lo registra bien**, y con la justificación escrita
([admin.service.ts:1096-1105](../apps/api/src/modules/admin/admin.service.ts#L1096-L1105)):

> *«desde que el fichero se borra de R2, un error del staff es IRRECUPERABLE, y sin
> esto sería además INVISIBLE. No devuelve la foto: hace que se pueda saber cuál era.»*

Guarda `imageIds` y `imagenesRetiradas: {id, url}[]`. **Nada que añadir.**

### 4.2 LA REGLA DEL MÍNIMO — la decisión de producto

Recordando §1.4: hoy **no hay mínimo** en el camino de edición, la regla de puerta
nace apagada, y solo mira al publicar y al aprobar.

**Formular «no bajar del mínimo» exige responder tres preguntas, no una:**

**(a) ¿Qué mínimo?** `PhotoLimitsService.getMin()` → `minPhotosPerListing`, por
defecto **1**. Es el único número que existe; inventar otro sería una tercera copia
de un límite, que es exactamente lo que `photo-limits.ts` vino a eliminar.

**(b) ¿Respetando el interruptor, o siempre?**

| Opción | Qué implica |
|---|---|
| **M1. Solo si `minPhotosRuleEnabled` está encendido** | Coherente con todo el sistema: el mínimo es opt-in y quien lo enciende sabe lo que hace. Coste: **hoy no haría nada** (nace apagado), así que el encargo se entrega sin efecto visible hasta que alguien encienda el ajuste. |
| **M2. Siempre, con `getMin()`** | El encargo se cumple literalmente desde el primer día. Coste: **contradice la decisión escrita** de que el mínimo no se aplica hacia atrás sobre anuncios publicados cuando no se exigía — y lo haría por la puerta de atrás, en una pantalla de moderación. |
| **M3. Sin mínimo** (como hoy) | Cero código. La puerta ya frena el anuncio sin fotos cuando intenta volver al mercado. Coste: un moderador puede dejar un ACTIVO con cero fotos y nada lo avisa hasta la próxima transición. |

**(c) ¿Dónde vive la regla?** Y aquí hay una trampa concreta:

> **NO puede ir en `sync` sin acotar, aunque `sync` sea el sitio «reutilizable».**
> El asistente de publicación **crea el borrador y luego sube las fotos**: un
> `DRAFT` con cero fotos es el estado normal de todo anuncio recién empezado. Un
> mínimo incondicional en `sync` **rompería la creación de borradores para todos los
> vendedores** — y lo haría desde el camino compartido, es decir, en producción, por
> una ráfaga de backoffice.

La formulación que sí se sostiene: **el mínimo protege a los anuncios que ya están en
el mercado**, porque son los únicos donde la puerta ya no puede intervenir. Un
`DRAFT` o un `PENDING_REVIEW` sin fotos lo frena `MinPhotosRule` cuando intente
publicarse o aprobarse; un `ACTIVE` al que le quitan la última foto **no pasa por
ninguna puerta**.

**Recomendación: M1 acotado a `status === 'ACTIVE'`.** Es decir, en `sync`:

- si el anuncio está `ACTIVE`, **y** `isMinEnforced()`, **y** `imageIds.length < getMin()` → 422 con el código y el mensaje de `NOT_ENOUGH_PHOTOS_CODE`;
- en cualquier otro caso, como hoy.

Eso hereda el interruptor, el número y el código de motivo de la regla existente; no
inventa un cuarto límite; no rompe los borradores; y beneficia **también al dueño**,
que hoy puede vaciar de fotos su propio anuncio publicado. Sigue siendo una decisión
de Ernest, y la alternativa legítima es **M3** (no tocar el backend en absoluto y
entregar solo la interfaz).

**El mensaje**, reutilizando el de la regla:
`«Este anuncio está publicado y no puede quedarse con menos de N foto(s).»`

**Y la interfaz lo dice antes de dejar intentarlo:** el botón de eliminar de la
última foto sale deshabilitado con el motivo escrito al lado, no un 422 tras pulsar.
El 422 es la red, no el camino.

### 4.3 La limpieza y el reindexado: automáticos

Ya descritos (§1.3, §3.4). El único punto que el diseño **no** puede dar por cerrado
es la fuga estrecha de §7.3.

### 4.4 Irreversible ⇒ confirmación

Regla del proyecto, en `apps/web/CLAUDE.md`: *«Acción irreversible ⇒ `AlertDialog`
antes y aviso después»*. Quitar una foto **borra el fichero de R2** en cuanto se
guarda. Molde: `MyListingCard` (archivar/eliminar) y `FacturasPanel`.

La confirmación va **en el guardado**, no en el clic de la papelera: mientras no se
guarde, quitar una foto de la lista es reversible (basta con cancelar). El
`AlertDialog` debe decir **cuántas** fotos se van a borrar y que es irreversible.

---

## 5. La interfaz

### 5.1 Dónde

En la sección «El anuncio» de `/admin/anuncios/[id]`, **donde ya está la galería**
(líneas 593-611), con su propio modo edición (§3.3, opción R2). No hace falta ni una
pantalla nueva ni un modal.

### 5.2 Qué

```
El anuncio                                    [Editar fotos]
┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐
│  1   │ │  2   │ │  3   │ │  4   │        ← modo lectura (hoy)
└──────┘ └──────┘ └──────┘ └──────┘

--- en modo edición ---

┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐
│  1   │ │  2   │ │  3   │ │  4   │
│ Port.│ │      │ │      │ │      │        ← «Portada» en la primera
│ →  🗑│ │← → 🗑│ │← → 🗑│ │←   🗑│
└──────┘ └──────┘ └──────┘ └──────┘
Motivo: [_______________________]
                      [Cancelar] [Guardar fotos]
```

- **Flechas ← →**, no ↑↓: la galería es una rejilla que se lee en horizontal, a
  diferencia de las listas verticales de categorías/footer. La primera no lleva ←, la
  última no lleva →.
- **«Portada» sobre la primera.** Es lo que de verdad se está decidiendo: la tarjeta
  de listado toma `take: 1` sobre el orden (§1.1). Decirlo convierte una operación
  abstracta en una con propósito.
- **Papelera por foto**, deshabilitada con motivo visible si se está en el mínimo
  (§4.2) — nunca un botón que falla al pulsarlo.
- **Motivo + Guardar/Cancelar**, molde del formulario de edición ya existente.
- Todo el reordenar es **estado local** hasta Guardar (§3.1).

### 5.3 Detalles que el molde ya resuelve

- El guardado recarga con `cargar()` (el molde de `guardarEdicion`), no muta el estado
  a mano — mismo criterio que categorías: *«reconstruir el árbol en el cliente solo
  para adelantar el repintado duplicaría la lógica del servidor»*.
- `data.images` ya trae `id`, `url`, `alt` y `order` (el include del backoffice es la
  fila entera, [admin.service.ts:770](../apps/api/src/modules/admin/admin.service.ts#L770)).
- El `data-testid="ficha-imagen"` ya existe; los controles nuevos necesitan los suyos.

---

## 6. Los permisos

**Nada que diseñar: ya están.** `PATCH /admin/listings/:id` es `@MinRole(Role.MODERATOR)`
([admin.controller.ts:99](../apps/api/src/modules/admin/admin.controller.ts#L99)), y
la cabecera del endpoint hermano explica el criterio de la casa: MODERATOR+ para el
trabajo diario reversible, **ADMIN para lo irreversible** (excepción de B2).

> **Y aquí hay una pregunta que el encargo no hace y conviene hacerse:** borrar una
> foto **es irreversible** —el fichero se va de R2— y sin embargo entraría por un
> endpoint MODERATOR+. ¿Es coherente con la excepción de B2, que reserva ADMIN para
> lo irreversible?
>
> **Argumento a favor de dejarlo en MODERATOR+ (recomendado):** el moderador ya puede
> hoy, por este mismo endpoint, reescribir el título y la descripción de cualquier
> anuncio, que tampoco se deshace. Y `AuditLog` guarda la URL de lo retirado, que es
> la mitigación que B2 pide. Subirlo a ADMIN dejaría a los moderadores sin poder
> quitar una foto inapropiada —el caso de uso principal— y les obligaría a escalar.
>
> **Se señala para que la decisión sea explícita**, no para cambiarla.

`AuditLog`: **no hacen falta acciones nuevas**. `LISTING_EDIT` ya cubre esto y ya
guarda `imageIds` + `imagenesRetiradas` (§4.1). Inventar `LISTING_IMAGE_REORDER` /
`LISTING_IMAGE_DELETE` partiría en dos el rastro de una misma edición.

---

## 7. Tensiones y cabos — lo que el encargo pedía señalar

### 7.1 El mínimo no existía (§1.4) — la grande

Ya desarrollada. Es la única decisión de producto real, y la respuesta honesta es que
**el encargo pedía respetar una regla que no está escrita en ninguna parte**.

### 7.2 El moderador no puede añadir fotos — resuelto, pero conviene decirlo en la UI

`sync` exige que una imagen suelta sea del vendedor
([:121-123](../apps/api/src/modules/listings/listing-images.service.ts#L121-L123)), y
no hay subida de staff. **Es deliberado**, y la salida del moderador es devolver a
`DRAFT` (§1.4). Pero la interfaz de esta ráfaga no debe *sugerir* que se pueden
añadir: sin botón de «añadir foto», y —si se implementa el mínimo— el texto del botón
deshabilitado puede nombrar la salida real: *«Devuélvelo a borrador para que su dueño
añada fotos»*.

### 7.3 Dos filas con la misma URL — fuga estrecha, preexistente

`listingMediaKeys` deduplica **dentro de una llamada**, pero si dos `ListingImage`
del mismo anuncio comparten `url` y solo se quita una, `sync` encolaría el borrado de
un objeto que **la fila superviviente sigue referenciando** → una foto rota. El
propio fichero admite el caso (*«dos `ListingImage` con la misma URL —posible si
alguien reenlaza una imagen—»*) y el procesador de limpieza **no comprueba si la
clave sigue referenciada**.

**No lo abre esta ráfaga** (existe desde 2b), pero **sí lo hace más alcanzable**: hoy
nadie manda `imageIds` desde el backoffice, y a partir de aquí sí. **Recomendación:
una comprobación de una línea en `sync` —no encolar la clave de una URL que siga
presente entre las que se quedan— y un caso que lo fije.** Es barato y cierra la
única forma de romper una foto viva.

### 7.4 Cada guardado de fotos refresca detecciones y reindexa

`updateListing` llama siempre a `detections.refresh(...)` con el texto del anuncio,
aunque solo hayan cambiado las fotos. Es trabajo de más, **no un defecto**: la
operación es idempotente y el volumen de ediciones de staff es bajo. Se anota para
que nadie lo lea como un descuido. Es también el argumento de §3.1 contra guardar en
cada clic de flecha.

### 7.5 El `order = 0` heredado

Anuncios editados por staff antes de 2b pueden tener todas sus fotos con `order = 0`
(§2). No se hace backfill: se arregla al primer guardado.

---

## 8. El plan — una ráfaga, dos pasos

El encargo anticipaba «modelo+backend en una, UI en otra». **El modelo no existe como
trabajo y el backend está hecho**, así que eso se colapsa.

### Ráfaga única

**Paso 1 — backend (solo si Ernest elige M1; ~30 líneas + casos).**
1. `ListingImagesService.sync` recibe el `status` del anuncio (o lo consulta) y aplica
   el mínimo cuando `ACTIVE` **y** `isMinEnforced()` (§4.2). Reutiliza
   `PhotoLimitsService` y `NOT_ENOUGH_PHOTOS_CODE`; no inventa constantes.
2. La comprobación de §7.3: no encolar la clave de una URL que siga entre las que se
   quedan. **Este paso se recomienda hagan lo que hagan con el mínimo.**
3. `GET /listings/photo-limits` ya sirve `{max, min, minEnforced}`
   ([`photo-limits.service.ts:56-63`](../apps/api/src/modules/listing-gate/photo-limits.service.ts#L56-L63)),
   así que la interfaz puede saber el mínimo sin una copia propia. **Verificar si el
   backoffice puede consumirlo tal cual o necesita el dato en la respuesta de la
   ficha** — es la única incógnita de implementación que este diseño deja abierta.

**Paso 2 — la interfaz (el grueso).**
4. Modo edición de fotos en la sección «El anuncio», con estado local.
5. Flechas ← →, papelera, «Portada» en la primera.
6. Motivo + `AlertDialog` de confirmación al guardar si hay eliminaciones.
7. Enviar `imageIds` (lista final) por `updateAdminListing`, recargar.

**Por qué no dos ráfagas:** el paso 1 es media hora y el 2 no depende de él salvo en
el estado deshabilitado del botón. Partirlas dejaría una ráfaga de treinta líneas y
otra que necesita la primera para su caso de borde.

**Si se elige M3** (sin mínimo), el paso 1 se reduce al punto 2 y la ráfaga es
prácticamente solo frontend.

---

## 9. Las barreras

| # | Barrera | Cómo se comprueba |
|---|---|---|
| 1 | **Reordenar se refleja de verdad** | Mover la 3.ª al primer puesto y guardar; `GET /listings/:slug` devuelve ese orden y **la tarjeta de listado cambia de miniatura** (es el `take: 1`). Cubre ficha, tarjeta y —con el reindexado— Meili |
| 2 | **Eliminar quita la fila Y los dos objetos** | Tras guardar, la fila no está y la cola recibió `key` **y** `thumbKeyFor(key)`. Es la fuga que ya se cerró dos veces: se comprueban **las dos claves**, no una |
| 3 | **El mínimo** (si M1) | Un ACTIVE en el mínimo con la regla encendida: la papelera sale deshabilitada, y el `PATCH` directo devuelve **422** con `NOT_ENOUGH_PHOTOS`. Y el negativo, que es el que protege a los vendedores: **un DRAFT sin fotos se sigue pudiendo crear y guardar** |
| 4 | **Aislamiento entre anuncios** | Un `imageIds` con la id de una foto de OTRO anuncio → 422, y esa foto **sigue en su anuncio**. Ya lo garantiza `sync`; el caso lo fija ahora que la interfaz manda el campo |
| 5 | **Permisos** | MODERATOR puede; un USER no (403). Molde de `admin-roles.spec.ts` |
| 6 | **El rastro** | `AuditLog` `LISTING_EDIT` con `imagenesRetiradas` incluyendo la **URL** de lo borrado — lo único que sobrevive al fichero |
| 7 | **La misma URL en dos filas** (§7.3) | Dos filas con la misma `url`, se quita una: el objeto **no** se encola para borrar y la foto superviviente sigue viéndose |
| 8 | **El motivo sigue siendo obligatorio** | Guardar fotos sin motivo no se puede — el e2e existente no debe poder pasar por el hueco nuevo |

---

## 10. Registro de decisiones

### Cerradas por el encargo

Solo backoffice (no el editor del dueño) · backend reutilizable · reutilizar
`listingMediaKeys` · MODERATOR+ · documento sin código.

### Lo que la verificación DESMINTIÓ del encargo

| # | El encargo suponía | El código dice |
|---|---|---|
| 1 | «Reordenar no existe» | Existe en el backend desde 2b, y lo comparten dueño y staff |
| 2 | «¿Hay columna de orden?» | Sí, `ListingImage.order`, usada por las cinco superficies |
| 3 | «Eliminar = borrar fila + los dos objetos R2» (por construir) | Ya lo hace `sync`, con la cola y el lector único |
| 4 | «El mínimo ya es regla; eliminar no puede bajar de él» | **No hay mínimo en edición.** Es una puerta opt-in que solo mira al publicar y aprobar |
| 5 | «Hay que diseñar el backend reutilizable» | Ya lo es; no hay puerta que dejar abierta |
| 6 | «El moderador quedaría atrapado sin poder añadir fotos» | Resuelto en M2: su salida es devolver a `DRAFT`, y está escrito |

### Tomadas en este diseño

| # | Decisión | § |
|---|---|---|
| 1 | **Sin migración ni backfill**: `order` existe y se arregla solo al primer guardado | 2 |
| 2 | **Flechas ← →**, no drag & drop — cinco pantallas del backoffice ya lo hacen así | 3.1 |
| 3 | **Guardado explícito**, no un `PATCH` por clic: cada llamada reindexa y exige motivo | 3.1 |
| 4 | **El endpoint que ya hay**, no uno nuevo de imágenes: dos caminos costaron tres defectos | 3.2 |
| 5 | **Sección de fotos con su propio motivo** (R2), y **motivo automático descartado** (falsifica el `AuditLog`) | 3.3 |
| 6 | **Sin acciones de `AuditLog` nuevas**: `LISTING_EDIT` ya guarda `imagenesRetiradas` con URL | 6 |
| 7 | **`AlertDialog` al guardar** si hay borrados, no al quitar de la lista (hasta guardar es reversible) | 4.4 |
| 8 | **«Portada» sobre la primera foto**: es lo que de verdad se decide al reordenar | 5.2 |
| 9 | **La comprobación de §7.3 entra hagan lo que hagan con el mínimo** | 7.3, 8 |
| 10 | **El mínimo NO va en `sync` sin acotar**: rompería la creación de borradores de todos los vendedores | 4.2 |

### Abiertas — decide Ernest

| # | Pregunta | Recomendación | § |
|---|---|---|---|
| A | ¿Se implementa el mínimo, y cómo? | **M1 acotado a `ACTIVE`**: hereda interruptor, número y código de la regla existente. Alternativa legítima: **M3**, no tocar el backend | 4.2 |
| B | Borrar una foto es irreversible y entraría por MODERATOR+. ¿Coherente con «ADMIN para lo irreversible» (B2)? | **Dejarlo en MODERATOR+**: ya pueden reescribir el texto, el `AuditLog` guarda la URL, y subirlo les quitaría el caso de uso principal | 6 |
| C | ¿El backoffice consume `GET /listings/photo-limits` o el mínimo viaja en la respuesta de la ficha? | Sin recomendación — es la única incógnita de implementación que queda | 8 |
