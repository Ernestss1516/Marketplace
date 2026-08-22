# Diseño — cerrar las tres fuentes de huérfanas SIN FILA

> Documento de **diseño**, no de implementación. Cero código escrito; no toca CI.
> Continúa [`diseno-borrado.md` §7.7](./diseno-borrado.md), punto 3 de «lo que sí conviene
> hacer»: *«antes de producción, cerrar las fuentes que quedan»*. Aquel apartado las **nombra**
> —el avatar sustituido, las imágenes de `blocks/`/`homepage/`/`sponsored/`, el vídeo nunca
> confirmado— y no las diseña. Esto las diseña.
>
> Todo lo que sigue está **verificado contra el código**, con fichero y línea. Donde algo se
> desvía de lo que la deuda daba por supuesto, se dice.

---

## 0. Qué se cierra, y qué NO se toca

La deuda de huérfanas mezclaba dos problemas distintos hasta que
[`pendientes.md`](./pendientes.md) los separó. Este diseño es **sólo el primero**:

| | **SIN FILA** — se cierra aquí | **CON FILA** — no se toca |
|---|---|---|
| Qué es | El objeto de R2 **no tiene ninguna fila** que lo referencie. La referencia vivía en una columna o dentro de un `Json`, y se sobreescribió o se quitó | El objeto **sí** está referenciado (`ListingImage` con `listingId = null`, `TicketAttachment`) |
| Cómo se detecta | **No se detecta: se previene.** En la operación que suelta la referencia, con la procedencia conocida | Con una consulta por estado (`listingId IS NULL AND createdAt < umbral`) |
| Por qué así | La operación sabe exactamente qué URL acaba de salir. No hay que adivinar nada | Esa consulta es **indistinguible de la portada del blog** — demostrado en `diseno-borrado.md` §7.6 sobre la base de datos real |
| Estado | Abierto → lo cierra este diseño | **Descartado a propósito.** Sigue descartado |

**La regla de oro se hereda entera** (§7.7): *ante la duda, un huérfano de más es mejor que un
fichero vivo de menos.* Todo lo que sigue se inclina hacia no borrar cuando no está seguro.

Y el criterio de fondo es el de B3 y el de 2b: **cerrar la fuente, no fregar el suelo.** Con la
fuente cerrada la basura nueva no aparece, y la vieja pasa a ser un conjunto finito y conocido
—que es cuando un barrido empieza a tener sentido, y no antes.

---

## 1. Inventario verificado — los ocho prefijos y quién los suelta

Los **ocho** sitios que escriben en R2 hoy (`r2.upload` / `presignUpload` en `apps/api/src`):

| Prefijo | Quién sube | Quién lo referencia | ¿Fila propia? | Cuándo queda suelto |
|---|---|---|---|---|
| `media/` | [`media.service.ts:33`](../apps/api/src/modules/media/media.service.ts#L33) | `ListingImage.url` | **Sí** | Wizard abandonado — **con fila, fuera de alcance** |
| `media/…-thumb.webp` | [`image.processor.ts:42`](../apps/api/src/infra/queue/processors/image.processor.ts#L42) | Nadie: se **deriva** con `thumbKeyFor` | Sí (la del original) | Con su original |
| `tickets/` | [`ticket-attachments.service.ts:149`](../apps/api/src/modules/tickets/ticket-attachments.service.ts#L149) | `TicketAttachment.key` | **Sí** | **Con fila, fuera de alcance** |
| `facturas/` | [`invoicing.service.ts:266`](../apps/api/src/modules/invoicing/invoicing.service.ts#L266) | `Invoice.pdfKey` | **Sí** | Nunca: la factura no se borra (conservación obligatoria) |
| `avatars/` | [`media.service.ts:53`](../apps/api/src/modules/media/media.service.ts#L53) | `User.avatarUrl` (columna) | **No** | **FUENTE 1** |
| `blocks/` | [`blog.service.ts:42`](../apps/api/src/modules/blog/blog.service.ts#L42) | Dentro de `Post.blocks` (`Json`) | **No** | **FUENTE 2** |
| `homepage/` | [`homepage.service.ts:157`](../apps/api/src/modules/homepage/homepage.service.ts#L157) | Dentro de `HomepageConfig.blocks` (`Json`) | **No** | **FUENTE 2** |
| `sponsored/` | [`sponsored-ads.service.ts:135`](../apps/api/src/modules/sponsored-ads/sponsored-ads.service.ts#L135) | `SponsoredAd.imageUrl` (columna) | **No** | **FUENTE 2** |
| `listing-videos/` | [`video.service.ts:77`](../apps/api/src/modules/video/video.service.ts#L77) (prefirmada) | `Listing.videoUrl` | **No** | **FUENTE 3** |

**Comprobado de paso:** los `Banner` (H8 D4) **no tienen imagen** —`model Banner` no declara
ninguna URL de imagen, sólo `linkUrl`—, así que no hay un cuarto prefijo escondido. Y ninguna
de las cinco fuentes sin fila genera **miniatura**: `thumbKeyFor` sólo aplica a lo que sube por
`MediaService.upload`, que es el único que encola el trabajo de imagen. Si algún día se
generan miniaturas para `blocks/` o `avatars/`, este diseño hay que revisarlo — es exactamente
el vector 2 de §7.6.

---

## 2. FUENTE 1 — el avatar

### 2.1 Lo verificado (y no es sólo lo que decía la deuda)

La subida y el guardado son **dos endpoints distintos**, y eso parte la fuente en dos:

1. [`POST /media/upload-avatar`](../apps/api/src/modules/media/media.controller.ts#L49) →
   [`uploadAvatar`](../apps/api/src/modules/media/media.service.ts#L47) sube a `avatars/` y
   **devuelve la URL. No escribe ninguna fila y ni siquiera usa el usuario** (el parámetro está
   como `_user`). El objeto nace sin dueño.
2. [`PATCH /users/me`](../apps/api/src/modules/users/users.service.ts#L46) → `updateMe` hace
   `prisma.user.update({ data: dto })`: **pisa `avatarUrl` sin leer el valor anterior**. La
   clave vieja queda suelta.

Con lo cual son dos fugas, no una:

- **1a — el avatar SUSTITUIDO.** Es la que la deuda nombra. Cada cambio de avatar guardado
  deja el anterior en el bucket.
- **1b — el avatar SUBIDO Y NUNCA GUARDADO.** El formulario sube en cuanto eliges el fichero
  ([`PerfilForm.tsx:59`](../apps/web/src/components/perfil/PerfilForm.tsx#L59)) y sólo guarda
  al enviar. Cerrar la pestaña entre las dos cosas deja el objeto huérfano — **la misma forma
  exacta que el vídeo sin confirmar**, y por eso comparte mecanismo con él (§4).

### 2.2 Cómo se cierra 1a

En `updateMe`, que es el **único** sitio que escribe `avatarUrl` de un usuario ya creado
(verificado: el otro escritor es
[`auth.service.ts:526`](../apps/api/src/modules/auth/auth.service.ts#L526), y sólo en la
**creación** por Google — un login posterior no repisa el avatar):

1. Leer el `avatarUrl` actual antes de escribir (una consulta más; hoy no hay ninguna).
2. Si cambia y el viejo es **nuestro** (`keyFromPublicUrl` ≠ `null`), encolar su clave en
   `media-cleanup`.
3. Si el viejo es una URL **ajena**, no hacer nada: es el avatar de Google, y `keyFromPublicUrl`
   ya devuelve `null` en vez de inventar una clave — para eso se escribió así.

### 2.3 Los cuidados, comprobados

- **¿Avatares compartidos?** La deuda apostaba a que no. **Hoy sí es posible**, y no por
  diseño: `UpdateMeDto.avatarUrl` es un `@IsString() @MaxLength(500)` pelado
  ([`update-me.dto.ts:19`](../apps/api/src/modules/users/dto/update-me.dto.ts#L19)) — **no**
  lleva `@IsOwnStorageUrl`, al revés que los bloques. Cualquiera puede guardar como suyo el
  `avatarUrl` de otro. Borrar al sustituir mataría entonces un avatar vivo ajeno. El guardarraíl
  es de una línea: **no borrar si otro `User` referencia esa misma URL** (`count` por
  `avatarUrl`). Poner `@IsOwnStorageUrl` en el DTO **no** vale como alternativa: rompería los
  avatares de Google, que son URLs externas legítimas.
- **¿Avatar por defecto?** No hay ninguno en el bucket: `avatarUrl` es nullable y el frontal
  cae a las iniciales (`AvatarImage` sin `src`). Nada que proteger.
- **Quitar el avatar** no es posible hoy: el formulario envía `avatarUrl: fields.avatarUrl ||
  undefined`, y `undefined` no borra. Si algún día se añade «quitar foto», entra por el mismo
  camino de 2.2 sin cambios.

---

## 3. FUENTE 2 — la imagen que sale de un bloque

### 3.1 Lo verificado

Tres superficies, un mismo patrón: **suben directo a R2 sin fila propia** y la referencia vive
en la fila de otra cosa.

| Superficie | Dónde vive la URL | Operación que la suelta | ¿Lee el estado anterior? |
|---|---|---|---|
| Blog (`blocks/`) | Dentro de `Post.blocks` (`Json`), en varios tipos de bloque | [`adminUpdate`](../apps/api/src/modules/blog/blog.service.ts#L181) (reemplazo completo del `Json`) y [`adminDelete`](../apps/api/src/modules/blog/blog.service.ts#L319) | **Sí** — `adminFindById(id)` al principio de las dos |
| Portada (`homepage/`) | Dentro de `HomepageConfig.blocks` (`Json`), fila **singleton** | [`update`](../apps/api/src/modules/homepage/homepage.service.ts#L81) (reemplazo completo) | **Sí** — `before` ya se lee para el `AuditLog` |
| Patrocinados (`sponsored/`) | `SponsoredAd.imageUrl` (columna) | [`update`](../apps/api/src/modules/sponsored-ads/sponsored-ads.service.ts#L210) al cambiar la imagen | **Sí** — `existing` ya se lee |

Dos consecuencias que ahorran trabajo: **ninguna de las tres necesita una consulta extra** (el
«antes» ya está en la mano), y **`SponsoredAd` no tiene borrado** (sólo desactivar, verificado:
no existe `sponsoredAd.delete` en `apps/api/src`), así que ahí la única fuga es la sustitución.

### 3.2 Cómo se cierra: diff de URLs propias, no lista de campos

El impulso natural es enumerar los campos que llevan imagen. **Es justo el mecanismo del falso
positivo del §7.6**, y aquí ya se ve por qué: las URLs de imagen viven en campos con **nombres
distintos** y en **tipos de bloque distintos** (`imageUrl` en el carrusel de categorías de la
portada, `url` en la rejilla, `url` en los bloques `image`, `image-text` y `profile` del blog…).
Una lista escrita a mano se queda corta el día que se añade un bloque nuevo, y se queda corta
**en silencio**.

La forma correcta es la misma que usó el script de medición de §7.1 (`row_to_json`): **no mirar
campos, mirar el valor entero**.

> **Antes de escribir**: recorrer el `Json`/columna **anterior** recogiendo toda cadena que sea
> URL propia (`isOwnStorageUrl`). **Después**: lo mismo con el nuevo valor. Las URLs que estaban
> y ya no están son las que se sueltan → sus claves van a `media-cleanup`.

Al ser conjuntos, el caso «la misma imagen en dos bloques del mismo documento» se resuelve solo:
si sigue en cualquier parte del «después», no está en la diferencia.

El sitio del helper es [`media-keys.ts`](../apps/api/src/infra/r2/media-keys.ts) —fichero puro,
sin DI, que ya existe exactamente para esto y que ya tiene `keyFromPublicUrl`—, con una función
nueva del tipo `ownUrlsDeep(value): string[]`. Una sola copia de la regla, como `thumbKeyFor`.

### 3.3 El cuidado que sí hace falta: la referencia compartida entre documentos

Dentro de un documento, el diff basta. **Entre documentos, no**: los validadores exigen «URL de
nuestro almacenamiento» (`IsOwnStorageUrl`), no un prefijo concreto, así que nada impide hoy que
una imagen de `blocks/` acabe pegada en un segundo post (duplicar un artículo copiando su
`Json`) o como `coverUrl`.

Por la regla de oro, antes de encolar una clave: **una última comprobación de que nadie más la
referencia** — `Post.blocks::text` / `Post.coverUrl`, `HomepageConfig.blocks::text`,
`SponsoredAd.imageUrl`, `User.avatarUrl`. Son cuatro consultas diminutas sobre tablas de
decenas de filas, y el número de claves candidatas por operación es normalmente 0 o 1.

**Y si la comprobación falla (error de consulta), no se borra.** Un huérfano de más.

Ojo con lo que esta comprobación **no** es: no es la «consulta de propiedad» de un barrido.
Aquí la clave candidata viene de una operación concreta que acaba de soltarla —procedencia
conocida—, y la consulta sólo descarta un segundo dueño. Es lo contrario de recorrer el bucket
preguntando «¿de quién es esto?».

---

## 4. FUENTE 3 — el vídeo que nunca se confirma

### 4.1 Lo verificado, incluida la trampa

La subida es en dos tiempos: `createUploadUrl`
([`video.service.ts:77`](../apps/api/src/modules/video/video.service.ts#L77)) firma un PUT
directo del navegador contra R2, y `confirmUpload`
([`video.service.ts:126`](../apps/api/src/modules/video/video.service.ts#L126)) comprueba con
`head` lo que aterrizó y **entonces** escribe `Listing.videoUrl`. Entre ambos pasos no hay nada
enlazado — el propio servicio lo dice en su cabecera. Interrumpirlo deja hasta 50 MB sin dueño.

Lo demás de vídeo **ya está cerrado y hay que no romperlo**: sustituir borra el anterior
([`video.service.ts:177`](../apps/api/src/modules/video/video.service.ts#L177)), quitar borra el
suyo ([`removeVideo`](../apps/api/src/modules/video/video.service.ts#L188)), y B3 borra vídeo y
póster al borrar el anuncio.

**La trampa, y es el hallazgo que cambia el diseño propuesto:** la clave es
`listing-videos/<listingId>/<uuid>.mp4` desde el primer momento y **confirmar NO la mueve** —
sólo escribe la URL en la fila. Es decir: **hoy el objeto confirmado y el objeto abandonado
viven en el mismo prefijo, indistinguibles.** Una regla de ciclo de vida sobre
`listing-videos/`, que era la opción «limpia, sin código», **borraría los vídeos vivos a los N
días**. Tal cual, no vale.

### 4.2 Lo que sí encaja: prefijo efímero + copia al confirmar + TTL

1. **Firmar contra un prefijo efímero**: `listing-videos/tmp/<listingId>/<uuid>.mp4`.
2. **Confirmar copia al definitivo** (`CopyObject`, del lado del almacenamiento: los bytes no
   pasan por la API, igual que en la subida) y borra el temporal. La URL que se guarda es la
   definitiva, con el mismo aspecto que hoy.
3. **Regla de ciclo de vida sobre `listing-videos/tmp/`**, con un plazo holgado (24 h basta: la
   URL prefirmada dura 10 minutos, `VIDEO_UPLOAD_URL_TTL_SECONDS`). El almacenamiento lo hace
   solo, sin código y sin cola.

> **Corregido en §9.2**: el `tmp/` va **arriba** (`listing-videos/tmp/<listingId>/…`), no en
> medio. Los filtros de una regla de ciclo de vida son prefijos literales, sin comodines, y
> con el `tmp/` detrás del `listingId` no hay prefijo que los capture. Lo demás se mantiene.

Por qué `tmp/` **dentro** del prefijo y no un prefijo hermano: los vídeos **ya confirmados**
siguen donde están, así que la regla nace sin poder tocarlos y **no hace falta migración
ninguna** de las filas existentes. Ese es todo el motivo, y es el que descarta la variante de
mover el confirmado a un prefijo nuevo: con las URLs actuales apuntando al prefijo viejo, la
regla habría que escribirla sobre justo donde viven los vivos.

Alternativa evaluada y **descartada**: registrar cada subida firmada (fila o clave de Redis) y
recolectar las que caduquen sin confirmar. Cierra lo mismo, pero añade tabla o entrada, un
programador periódico y un trabajo nuevo, para algo que el almacenamiento sabe hacer solo. Se
guarda por si un día hace falta contabilizar intentos, que hoy no hace falta.

Dos avisos de implantación, ninguno de código:

- La regla de ciclo de vida es **configuración del bucket**, no del repo: entra en «Preparación
  de producción» ([`pendientes.md`](./pendientes.md) §1) junto a lo demás de R2. En local
  (MinIO) puede replicarse con `mc ilm` o no ponerse: el bucket de desarrollo es desechable
  (§7.7, punto 2).
- La comprobación de `confirmUpload` que exige que la clave empiece por
  `listing-videos/<listingId>/` sigue haciendo el mismo trabajo con `tmp/` en medio; hay que
  moverla, no quitarla.

### 4.3 El mismo mecanismo cierra 1b

El avatar subido y nunca guardado es la misma figura: objeto sin dueño esperando una
confirmación que puede no llegar. Se cierra igual —`avatars/tmp/…` al subir, copia a `avatars/`
al guardar el perfil, TTL sobre `tmp/`—, con la diferencia de que aquí sube la API y no el
navegador. Como el patrón ya estaría construido para el vídeo, es incremental.

---

## 5. El mecanismo común

**Para borrar, uno solo: la cola `media-cleanup` de B3**
([`QUEUE_MEDIA_CLEANUP`](../apps/api/src/infra/queue/queue.constants.ts),
[procesador](../apps/api/src/infra/queue/processors/media-cleanup.processor.ts)). Recibe
**claves ya resueltas** —no ids—, borra una a una, se traga los fallos sueltos con log y sólo
levanta la mano si no pudo borrar ninguna. Está escrita para reutilizarse fuera del borrado de
anuncios; su propia cabecera lo dice.

**Encolar, no borrar en línea**, y es el criterio de B3 tal cual: R2 es E/S externa que no entra
en la transacción de Postgres. La escritura de negocio —el perfil, el post, la portada— no puede
fallar porque el bucket no responda, y un objeto que no se llega a borrar es basura, no
corrupción. (`VideoService` borra síncrono desde antes de que la cola existiera; no hay que
tocarlo, pero lo nuevo va por la cola.)

**Para decidir qué borrar, dos formas y no una** — y conviene no forzarlas a una sola:

| | Fuentes 1a y 2 | Fuentes 3 y 1b |
|---|---|---|
| Qué las produce | Una operación que **quita** la referencia | Una operación que **no llega a crearla** |
| Dónde se actúa | En esa operación, con el antes y el después delante | En el propio almacenamiento, por caducidad |
| Herramienta | Diff de URLs propias → `media-cleanup` | Prefijo efímero + regla de ciclo de vida |

---

## 6. El plan — dos ráfagas

> **H1 IMPLEMENTADA (2026-08-23).** Tal cual está descrita abajo, con una decisión de forma que
> el diseño no fijaba: el patrón **se escribe una sola vez** (`MediaCleanupService`, en un módulo
> neutral que importan los cuatro llamantes) en vez de repetirse cuatro veces — y así la cola se
> registra una vez, que además evita la trampa de «una `Queue` por `registerQueue()`». La
> comprobación de dueño de §3.3 creció con `ListingImage` (la frontera con la basura CON FILA) y
> con las **claves desnudas** de `Invoice.pdfKey` / `TicketAttachment.key` (vector 3 de §7.6).
> Detalle en `estado-tecnico.md`, sección «Huérfanas sin fila — RÁFAGA H1». **H2 sigue abierta.**

**H1 — lo que se suelta** (avatar sustituido, bloques de blog y portada, patrocinado). Un solo
patrón repetido cuatro veces, con el helper compartido en `media-keys.ts` y la cola de B3.

Barreras: sustituir el avatar encola la clave vieja y **no** la nueva; guardar la portada sin un
bloque de imagen encola la que salió y **no** las que siguen; borrar un post encola las de sus
bloques; cambiar la imagen de un patrocinado encola la anterior; un `avatarUrl` **ajeno** (URL
externa, molde Google) **no** se encola nunca; y una URL que sigue referenciada **en otro
documento** no se encola. Mutación que las mata: quitar el diff y encolar todas las URLs del
«antes» — la barrera de «no la nueva» cae.

**H2 — lo que nunca se confirma** (vídeo; y el avatar 1b encima del mismo patrón) — **detalle
completo en §9**, escrito aparte cuando llegó su turno. Prefijo
`tmp/`, copia al confirmar, borrado del temporal, y la regla de ciclo de vida documentada en la
preparación de producción.

Barreras: confirmar deja el objeto **fuera** de `tmp/` y la URL guardada apunta al definitivo;
el temporal ya no existe tras confirmar; sustituir y quitar siguen borrando el anterior (7b de
vídeo intacto); y la comprobación de pertenencia de la clave al anuncio sigue rechazando la
clave de otro. La regla de ciclo de vida en sí **no se prueba en CI** —es configuración del
bucket—: lo que CI puede afirmar es que un objeto confirmado **no** se queda en `tmp/`, que es
la condición que la hace segura.

**Dos y no una**, porque son dos mecanismos: mezclarlas obligaría a que la misma ráfaga tocara
cinco servicios y la configuración del bucket. Y **H1 antes que H2**: cierra tres de las cinco
fugas con un solo patrón, sin tocar infraestructura.

---

## 7. Lo que este diseño NO hace

- **No recolecta nada de lo ya acumulado.** Ni el barrido de §7 (descartado, y sigue
  descartado), ni la basura con fila. Sólo cierra fuentes.
- **No toca la basura CON fila** (wizard abandonado, adjuntos de ticket). Su nota de «por qué no
  se barre» sigue vigente entera.
- **No añade `DELETE /media/:id`.** Es otra deuda, del lado con fila.
- **Un hallazgo colateral, que cae del lado con fila y por eso queda fuera:** el **póster** del
  vídeo sube por `POST /media/upload`
  ([`video.ts:218`](../apps/web/src/lib/api/video.ts#L218)), o sea que **crea una fila**
  `ListingImage` con `listingId = null` y sólo su URL viaja a `Listing.videoPosterUrl`. Efecto:
  `removeVideo` pone el campo a `null` sin borrar nada, y cuando B3 borra el anuncio borra el
  objeto del póster pero **no** esa fila, que queda apuntando a un fichero inexistente. No es
  una huérfana sin fila —es su reverso, una fila sin fichero— y no cambia nada de lo de arriba;
  queda anotado para quien retome el lado con fila.

---

## 8. Después de esto

Con H1 y H2 aplicadas, las cinco fuentes sin fila quedan cerradas y la basura sin fila **deja de
crecer**. Lo que quede en el bucket pasa a ser un conjunto **finito y anterior a una fecha
conocida** — y ése es el estado en el que, si algún día se quiere recoger, el barrido deja de
ser una apuesta. Con las salvaguardas de §7.7 igualmente, que no dejan de hacer falta.

---

## 9. H2 al detalle — «lo que nunca se confirma»

> Escrito el 2026-08-23, con H1 ya en `main`. Diseño; cero código. Cierra las **dos fugas que
> quedan**: el vídeo subido y nunca confirmado y el avatar subido y nunca guardado. Las dos
> tienen la misma forma —un objeto que espera una confirmación que puede no llegar—, así que
> comparten mecanismo. Todo lo de aquí está verificado contra el código.

### 9.1 La doble naturaleza, y por qué hay que separarla

H2 no cabe entero en una ráfaga de código, y conviene decirlo antes que nada:

| | **CÓDIGO** — entra en la ráfaga, se prueba en CI | **INFRAESTRUCTURA** — se documenta, no se prueba |
|---|---|---|
| Qué | Firmar/subir bajo `tmp/`, **copiar fuera** al confirmar, y que la fila guarde la URL definitiva | La regla de ciclo de vida que caduca lo que se quedó en `tmp/` |
| Dónde vive | `VideoService`, `MediaService`, `UsersService`, `R2Service` | Configuración del bucket (R2 en producción) |
| Cómo se verifica | Barreras e2e reales contra MinIO — `video-infra.e2e-spec.ts` ya sube de verdad y usa `r2.head` | No se verifica en CI: **una caducidad se mide en días** y ninguna suite espera un día |

**La ráfaga de código deja la regla LISTA, no aplicada.** Con `tmp/` en su sitio, lo no
confirmado queda **confinado e identificable**; la recolección ocurre el día que el bucket
tenga la regla. Hasta entonces la basura sigue apareciendo — pero ya no mezclada con lo vivo,
que es la diferencia entre «hay que pensarlo» y «hay que borrar ese prefijo».

### 9.2 La trampa, y la restricción que decide la forma de la clave

**Verificado:** confirmar **no mueve el objeto**. La clave se genera al firmar
([`video.service.ts:99`](../apps/api/src/modules/video/video.service.ts#L99)) y
`confirmUpload` sólo escribe la URL en la fila
([`video.service.ts:154-177`](../apps/api/src/modules/video/video.service.ts#L154-L177)). El
vídeo vivo y el abandonado comparten prefijo, son indistinguibles, y una regla sobre
`listing-videos/` borraría los vivos. De ahí que haya que **copiar** al confirmar: no existe
un «renombrar» en almacenamiento de objetos.

**Y hay una segunda restricción, que corrige la forma que este documento insinuaba en §4.2:**
los filtros de una regla de ciclo de vida son **prefijos literales, sin comodines**. Con la
clave puesta como `listing-videos/<listingId>/tmp/<uuid>.mp4`, el `tmp/` queda **en medio** y
no hay prefijo que lo capture — habría que escribir una regla por anuncio. El `tmp/` tiene que
ir **arriba**:

```
  Al firmar   listing-videos/tmp/<listingId>/<uuid>.mp4     ← lo cubre la regla
  Al confirmar listing-videos/<listingId>/<uuid>.mp4        ← donde ya viven los confirmados
  Avatar       avatars/tmp/<userId>/<hex><ext>  →  avatars/<hex><ext>
```

Que el destino sea **el prefijo de siempre** es lo que evita migrar nada: los vídeos y avatares
ya confirmados están fuera de `tmp/` desde el primer día, así que la regla nace sin poder
tocarlos.

### 9.3 Bloque 1 — el vídeo

Lo que cambia, en el servicio que ya existe:

1. `createUploadUrl` firma contra `listing-videos/tmp/<listingId>/<uuid>.mp4`.
2. La comprobación de pertenencia de `confirmUpload`
   ([`video.service.ts:133`](../apps/api/src/modules/video/video.service.ts#L133)) pasa a
   exigir ese prefijo — **se mueve, no se quita**: es lo que impide confirmar en tu anuncio la
   subida de otro.
3. Confirmar, en este orden: `head` de lo subido (lo que ya hace) → **copiar** a la clave
   definitiva → escribir la fila con la URL definitiva → **borrar el temporal**.

Tres detalles que el orden obliga a decidir:

- **El borrado del temporal es de cortesía.** Si falla, la regla lo caduca igual. Criterio de
  `deleteObjectByUrl`: «no dejar limpiar no debe romper nada».
- **Si la escritura de la fila falla después de copiar**, queda un objeto en el prefijo
  definitivo que nadie referencia — y ése **no** lo cubre la regla. Hay que compensarlo:
  borrar la copia y propagar el error. Es el único fallo nuevo que introduce la copia, y por
  eso se escribe aquí en vez de descubrirse luego.
- **Confirmar dos veces** (doble clic, reintento de red) encontraría el temporal ya borrado y
  hoy respondería «No encontramos el vídeo subido». Con la copia, la respuesta correcta es
  mirar el destino: si ya existe, la confirmación **ya ocurrió** y se responde como tal.

**Coste:** una `CopyObject` de hasta 50 MB por vídeo confirmado, **del lado del
almacenamiento** — los bytes no pasan por la API, igual que no pasan al subir. Es una vez por
vídeo, no por reproducción.

**Lo que NO cambia:** sustituir y quitar el vídeo siguen borrando el anterior, y B3 sigue
llevándose vídeo y póster al borrar el anuncio. El cliente tampoco se entera: `StepVideo`
devuelve al confirmar **la misma `key` que el servidor le dio**
([`StepVideo.tsx:121-138`](../apps/web/src/components/publicar/steps/StepVideo.tsx#L121-L138)),
así que el cambio de prefijo es transparente. Y `remotePatterns` de Next filtra por **host**,
no por ruta.

### 9.4 Bloque 2 — el avatar 1b

Aquí no hay firma: sube la propia API
([`uploadAvatar`](../apps/api/src/modules/media/media.service.ts#L47) con `memoryStorage`), y
la confirmación es **guardar el perfil**. El resto es idéntico:

1. `uploadAvatar` sube a `avatars/tmp/<userId>/<hex><ext>`. Necesita el usuario, que **ya lo
   recibe y hoy ignora** (el parámetro está como `_user` en
   [`media.controller.ts:66`](../apps/api/src/modules/media/media.controller.ts#L66)).
2. `updateMe`, si el `avatarUrl` que llega es nuestro y está bajo `avatars/tmp/`: copiar al
   definitivo, guardar **la URL definitiva**, borrar el temporal.
3. Y el `<userId>` de la clave no es decorativo: es lo que permite rechazar la URL temporal
   **de otro usuario**, igual que el vídeo rechaza la clave de otro anuncio. Hoy no hay nada
   que lo impida, porque `UpdateMeDto.avatarUrl` es un `@IsString()` pelado.

**Coherencia con H1 (1a), comprobada:** son mecanismos disjuntos y en el orden correcto no se
pisan. H1 compara el avatar **anterior** con el **nuevo ya definitivo** y encola el viejo; una
URL temporal nunca llega a guardarse, así que nunca entra en ese diff. Y el `count` de dueños
de H1 sigue protegiendo al avatar compartido: la copia crea una clave nueva por guardado, así
que dos usuarios sólo comparten avatar si alguien pega la URL del otro a mano — que es
exactamente el caso que H1 ya cubre.

*(Se evaluó una alternativa más simple para el avatar: que el perfil suba el fichero al
guardar y desaparezca el endpoint intermedio. Cierra la fuga de raíz, pero cambia el contrato
del formulario —hoy sube al elegir la foto, para poder previsualizarla— por una fuga que el
mismo mecanismo del vídeo ya cierra. Descartada.)*

### 9.5 Bloque 3 — la regla, y qué pasa hasta que exista

- **Dos reglas, una por prefijo**: `listing-videos/tmp/` y `avatars/tmp/`. Caducar a **1 día**
  — la expiración de una regla de ciclo de vida se expresa en **días enteros**, así que un día
  es el suelo, y sobra: la URL prefirmada dura 10 minutos
  ([`VIDEO_UPLOAD_URL_TTL_SECONDS`](../apps/api/src/modules/video/video-limits.ts#L47)) y una
  subida legítima confirma en segundos.
- **Dónde se documenta**: [`pendientes.md`](./pendientes.md) §1, «Preparación de producción»,
  con el resto de la configuración de R2. Conviene confirmar la superficie exacta (panel o
  API) al aplicarla; lo que este diseño fija es **qué** debe caducar y **por qué es seguro**:
  bajo `tmp/` no vive nada confirmado, por construcción.
- **Mientras no exista**, la basura se acumula igual pero **confinada**: dos prefijos donde
  nada de lo vivo puede estar, así que vaciarlos a mano es una operación trivial y segura —
  justo lo contrario del barrido que §7 descartó, que necesitaba adivinar de quién era cada
  objeto.
- **En local no se pone nada**: el bucket de desarrollo es desechable (§7.7, punto 2).

### 9.6 Lo que hay que añadir, y las barreras

**Lo único que falta en la infraestructura del repo:** `R2Service` **no sabe copiar**
—verificado: tiene `upload`, `download`, `delete`, `head`, `getPublicUrl` y `presignUpload`—,
así que la ráfaga añade un `copy(origen, destino)` sobre `CopyObjectCommand`, en el mismo
sitio y con el mismo estilo que el resto.

**Barreras testeables** (molde `video-infra.e2e-spec.ts`, que ya sube de verdad contra MinIO y
comprueba con `r2.head`):

- Firmar deja la clave **dentro** de `tmp/`; confirmar deja el objeto **fuera** de `tmp/`
  (`head(definitivo)` existe) y el temporal **ya no está** (`head(tmp)` es `null`).
- La fila guarda una URL **sin `tmp/`** — que es la condición que hace segura la regla: si
  esto se rompiera, la regla borraría vídeos vivos.
- Confirmar la clave temporal **de otro anuncio** (o el avatar temporal de otro usuario) se
  rechaza.
- Confirmar dos veces no rompe: la segunda responde como confirmación ya hecha.
- Y lo de H1 sigue en pie: sustituir el avatar encola el viejo, sustituir el vídeo borra el
  anterior.

**La barrera que no se puede escribir**: que un objeto abandonado en `tmp/` desaparezca solo.
Depende de una regla configurada en el bucket y se mide en días. Queda documentada, y la
prueba de arriba —«lo confirmado no está en `tmp/`»— es la que hace que activarla sea seguro.

### 9.7 El plan

**Una ráfaga, no dos.** Vídeo y avatar comparten el mecanismo entero (prefijo temporal, copia
al confirmar, compensación, idempotencia) y el `R2Service.copy` que hay que añadir; separarlos
significaría escribir dos veces la misma discusión. La regla va **documentada en la misma
ráfaga**, no aplicada.

Con H1 (ya cerrada) y H2, **las cinco fugas sin fila quedan cerradas**: tres en código, y dos
confinadas en `tmp/` a la espera de una regla que es una línea de configuración. Y entonces —y
sólo entonces— lo que quede en el bucket es un conjunto finito y anterior a una fecha conocida.

### 9.8 Lo que H2 sigue sin tocar

El **póster** del vídeo: sube por `POST /media/upload`, así que **tiene fila** (`ListingImage`
con `listingId = null`). Es basura con fila, la clase que §0 deja fuera a propósito. Sigue
anotado en §7 y no entra aquí.

