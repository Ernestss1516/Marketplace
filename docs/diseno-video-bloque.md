# Diseño — BLOQUE DE VÍDEO SUBIDO (`videoUpload`)

> Documento de **diseño**, no de implementación. Cero código escrito.
> Encargo: un tipo de bloque **nuevo** que permite al editor **subir** un vídeo a R2, distinto
> del bloque `video` de embed (YouTube/Vimeo) que ya existe y **se queda**. Va en blog,
> páginas y portada.
>
> Todo lo que sigue está **verificado contra el código**, con fichero y línea. Donde la
> premisa del encargo se desvía de lo que el código dice, se corrige y se señala.

---

## 0. Resumen ejecutivo — las cinco respuestas

| Pregunta | Respuesta |
|---|---|
| **El mecanismo** | **Camino propio, sobre la infraestructura genérica que YA está compartida.** No hay nada que extraer de `VideoService`: la parte genérica no vive dentro de él, vive **un piso más abajo** (`R2Service`, `media-keys.ts`) y ya es común. Ver §2 |
| **El modelo** | `videoUpload { url, poster?, caption? }`, prefijo `blocks-videos/`, registrado en **dos** listas (no tres) |
| **La limpieza** | **La mitad ya está resuelta y sale gratis** (`ownUrlsDeep` no enumera campos). La otra mitad —lo subido y nunca guardado— se cierra con el mecanismo `tmp/` de H2, **promocionando al guardar**. Ver §4 |
| **La reproducción** | `VideoPlayer` se reutiliza **literal**: ya es genérico, ya es `preload="none"`, ya no conoce anuncios. Se muda a un sitio neutral |
| **Los límites** | **Los mismos duros** (50 MB, sólo MP4). **Se cae el blando**: la duración. Su motivo era el vendedor subiendo con datos móviles, y no aplica a un editor en el backoffice. Ver §6 |

**El plan:** dos ráfagas (§9). **La trampa que había que resolver** —la fuga de R2— está en §4, y la conclusión es que el repo ya tiene las dos piezas que hacen falta; lo que falta es **un pase**, no un mecanismo.

---

## 1. Lo verificado — el punto de partida real

### 1.1 El bloque `video` de EMBED existe y no se toca

[`video-block.dto.ts:58-67`](../apps/api/src/modules/blog/dto/blocks/video-block.dto.ts#L58-L67). Sus campos son **exactamente** `id`, `type`, `provider`, `videoId` — **no tiene `caption`**, ni `title`, ni `url`. El id se revalida en el backend por proveedor
([`VIDEO_ID_PATTERNS`](../apps/api/src/modules/blog/dto/blocks/video-block.dto.ts#L20-L23): YouTube 11 caracteres, Vimeo 6-12 dígitos) y nunca se guarda la URL cruda ni un iframe libre. El parseo de la URL pegada por el editor es del cliente
([`parseVideoUrl`](../apps/web/src/lib/blocks/validation.ts#L30-L43)) y el servidor **no se fía de él**.

Renderiza [`VideoBlockRenderer.tsx`](../apps/web/src/components/blocks/VideoBlockRenderer.tsx#L6-L25) construyendo un iframe controlado (`youtube-nocookie.com/embed/…` o `player.vimeo.com/video/…`).

**Convive sin rozarse:** el tipo nuevo es otro `name` del discriminador, otro DTO, otro renderizador y otra entrada del picker. El único cambio que toca al embed es de **texto**: su etiqueta pasa de «Vídeo» a «Vídeo incrustado»
([`blockDefaults.ts:32`](../apps/web/src/app/(admin)/admin/blog/_components/block-editor/blockDefaults.ts#L32)), para que el editor pueda elegir. Ni el DTO, ni el `type`, ni los datos guardados cambian.

### 1.2 El molde del vídeo Pro — qué es genérico y qué es de anuncios

Esta es la separación que decide §2, y **no cae donde el encargo suponía**.

| Pieza | Dónde vive | ¿Genérica? |
|---|---|---|
| `presignUpload({key, contentType, contentLength, expiresInSeconds})` | [`r2.service.ts:105-121`](../apps/api/src/infra/r2/r2.service.ts#L105-L121) | **Sí, del todo.** No conoce prefijos, ni anuncios, ni `tmp/` |
| `head` / `copy` / `delete` / `getPublicUrl` | [`r2.service.ts:128`](../apps/api/src/infra/r2/r2.service.ts#L128), [`:74`](../apps/api/src/infra/r2/r2.service.ts#L74), [`:54`](../apps/api/src/infra/r2/r2.service.ts#L54), [`:84`](../apps/api/src/infra/r2/r2.service.ts#L84) | **Sí.** `R2Module` es `@Global` |
| `pendingPrefix` / `isPendingKey` / `PENDING_SEGMENT` | [`media-keys.ts:117-134`](../apps/api/src/infra/r2/media-keys.ts#L117-L134) | **Sí.** Fichero puro, sin DI, escrito para varios llamantes |
| `ownUrlsDeep` / `releasedUrls` / `keyFromPublicUrl` | [`media-keys.ts:163-209`](../apps/api/src/infra/r2/media-keys.ts#L163-L209) | **Sí** |
| `isOwnStorageUrl` / `@IsOwnStorageUrl` | [`safe-url.ts:51-111`](../apps/api/src/common/validators/safe-url.ts#L51-L111) | **Sí** |
| `assertEnabled` (Setting `videoEnabled`) | [`video.service.ts:401-408`](../apps/api/src/modules/video/video.service.ts#L401-L408) | **No** — interruptor de la feature de anuncios |
| `assertPro` (`entitlements.isProActive`) | [`video.service.ts:416-423`](../apps/api/src/modules/video/video.service.ts#L416-L423) | **No** |
| `assertOwnActiveListing` (dueño + `ACTIVE`) | [`video.service.ts:425-452`](../apps/api/src/modules/video/video.service.ts#L425-L452) | **No** |
| Escritura de `Listing.video*` + compensación | [`video.service.ts:282-312`](../apps/api/src/modules/video/video.service.ts#L282-L312) | **No** |
| `refrescarSuperficies` (caché Redis de ficha + reindexado Meili) | [`video.service.ts:574-577`](../apps/api/src/modules/video/video.service.ts#L574-L577) | **No** |
| `deleteObjectByUrl` (privado) | [`video.service.ts:544-550`](../apps/api/src/modules/video/video.service.ts#L544-L550) | **No hace falta**: su equivalente público es la cola `media-cleanup` |

### 1.3 El molde del upload de bloques, y su limpieza

`POST /admin/blog/upload-image` ([`blog-admin.controller.ts:68-88`](../apps/api/src/modules/blog/blog-admin.controller.ts#L68-L88)) → [`uploadBlockImage`](../apps/api/src/modules/blog/blog.service.ts#L40-L47): `memoryStorage`, 10 MB, JPEG/PNG/WebP, prefijo `blocks/`, devuelve `{ url }` y **no crea fila**. La portada tiene su clon con prefijo `homepage/` ([`homepage.service.ts:167-174`](../apps/api/src/modules/homepage/homepage.service.ts#L167-L174)).

**Corrección importante a la premisa del encargo: la limpieza de huérfanas SÍ existe.** No es deuda abierta. La ráfaga H1 (`diseno-huerfanas-sin-fila.md`) la cerró el 2026-08-23:

- [`MediaCleanupService.purgeReleased`](../apps/api/src/modules/media-cleanup/media-cleanup.service.ts#L61-L94) hace el diff de URLs propias entre el «antes» y el «después», comprueba que **nadie más las referencie** y **encola** el borrado en `media-cleanup`.
- Enganchada ya en **editar post/página** ([`blog.service.ts:244-248`](../apps/api/src/modules/blog/blog.service.ts#L244-L248)), **borrar post/página** ([`:382-386`](../apps/api/src/modules/blog/blog.service.ts#L382-L386)) y **guardar portada** ([`homepage.service.ts:145-149`](../apps/api/src/modules/homepage/homepage.service.ts#L145-L149)).
- Y **no enumera campos**: `ownUrlsDeep` recorre el valor entero, precisamente porque *«una lista de campos escrita a mano se queda corta el día que alguien añade un tipo de bloque nuevo, y se queda corta en silencio»* ([`media-keys.ts:144-158`](../apps/api/src/infra/r2/media-keys.ts#L144-L158)).

Ese comentario se escribió pensando en este día. Ver §4.1: **la mitad de la limpieza del vídeo ya está escrita.**

### 1.4 Quién edita bloques hoy (y el `@Roles` que ya no existe)

El repo **ya no usa `@Roles(...)`** para esto: se migró a `@MinRole(Role.X)` («ese rol o superior»), azúcar sobre la misma metadata que consume [`RolesGuard`](../apps/api/src/common/guards/roles.guard.ts#L8-L21). La jerarquía real es `ROLE_ORDER = [USER, EDITOR, MODERATOR, ADMIN]` ([`role-hierarchy.ts:51-56`](../apps/api/src/common/roles/role-hierarchy.ts#L51-L56)) — **no** el orden del enum de Prisma.

| Superficie | Gate real hoy |
|---|---|
| Blog **y páginas** (`BlogAdminController`) | Clase `@MinRole(ADMIN)` ([`:36`](../apps/api/src/modules/blog/blog-admin.controller.ts#L36)) con **override a `EDITOR`** en leer, crear, `upload-image`, editar, publicar y despublicar ([`:41,47,53,69,92,104,115`](../apps/api/src/modules/blog/blog-admin.controller.ts#L41)). **Sólo `remove` hereda ADMIN** ([`:125`](../apps/api/src/modules/blog/blog-admin.controller.ts#L125)) |
| Portada (`HomepageAdminController`) | `@MinRole(EDITOR)` a nivel de clase, sin overrides ([`:40`](../apps/api/src/modules/homepage/homepage-admin.controller.ts#L40)) |

**El gate del `videoUpload` es `@MinRole(Role.EDITOR)`**, exactamente el de `upload-image`. Nada de Pro, ni de propiedad de anuncio, ni de estado.

> **Deuda colateral detectada, fuera de alcance:** tres comentarios y documentos dicen ADMIN donde el código dice EDITOR —
> [`homepage-admin.controller.ts:27-35`](../apps/api/src/modules/homepage/homepage-admin.controller.ts#L27-L35), `docs/diseno-portada.md:759` y `docs/contratos-api.md:1146`. No cambia nada de este diseño; queda anotado.

### 1.5 Los dos motores de bloques (no tres, y no uno)

**El encargo pregunta si los tres registran en el mismo `ValidBlocksArray`. La respuesta es que no son tres superficies, son DOS motores** — y blog y páginas son **el mismo**:

| | Blog **+ páginas** | Portada |
|---|---|---|
| Modelo | `Post.blocks Json`, discriminado por `PostType {POST, PAGE}` ([`schema.prisma:2858-2910`](../apps/api/prisma/schema.prisma#L2858-L2910)) | `HomepageConfig.blocks Json`, fila **singleton** ([`:3499-3549`](../apps/api/prisma/schema.prisma#L3499-L3549)) |
| Registro | [`ValidBlocksArray()`](../apps/api/src/modules/blog/dto/blocks/block.dto.ts#L43-L70) — **13 tipos**, tope 100 | [`ValidHomeBlocksArray()`](../apps/api/src/modules/homepage/dto/blocks/home-block.dto.ts#L62-L83) — **7 tipos**, tope 30 |
| Render | [`BlockRenderer.tsx`](../apps/web/src/components/blocks/BlockRenderer.tsx) | [`HomeBlockRenderer.tsx`](../apps/web/src/components/home/HomeBlockRenderer.tsx) |
| Editor | `admin/blog/_components/block-editor/` (lo usan `/admin/blog` **y** `/admin/paginas`, vía el mismo `PostForm`) | `admin/portada/_components/` |
| Controlador admin | `BlogAdminController` — **uno solo para posts y páginas** | `HomepageAdminController` |

Los dos motores son **calcos estructurales con cero código compartido**: mismo idiom (discriminador de class-transformer con `keepDiscriminatorProperty: true`), mismo `assertUnreachable(block: never)` en los dos `switch` de cada uno, mismo `Record<BlockType, …>` en los `*Defaults.ts`. `cta`, `listings` y `steps` existen en ambos con el mismo nombre y **formas de datos distintas**.

**Consecuencia para este diseño:** el tipo `videoUpload` se registra **dos veces** en el frontal y el backend de bloques (una por motor), y **las páginas salen gratis** con el registro del blog. El upload, en cambio, se escribe **una sola vez** (§3.1).

**Precio de un tipo nuevo, por motor:** su `*-block.dto.ts`, la unión + `subTypes` del `block.dto.ts`, el espejo TS (`types/blocks.ts` o `types/home-blocks.ts`), los `*Defaults.ts` (META + ORDER + `createDefault*` + `*HasContent`), el `switch` del renderizador y el del `*EditorRow`. **Los dos `switch` rompen el build** si falta un `case`, así que olvidarse no es un modo de fallo posible.

---

## 2. LA DECISIÓN CENTRAL — desacoplar el presigned, o camino propio

### 2.1 La pregunta, planteada bien

El encargo la plantea como «extraer *subir vídeo a R2 con límites* de `VideoService`». Con el código delante, **esa extracción ya está hecha** y no la hizo este proyecto: la hizo H2 al escribir `pendingPrefix`, y la hizo el vídeo Pro al poner `presignUpload` en `R2Service` en vez de en su propio servicio.

Lo genérico **no está dentro de `VideoService` esperando a que alguien lo saque**. Está un piso más abajo, en dos ficheros que ya son compartidos (`R2Service` es `@Global`; `media-keys.ts` es un fichero puro sin DI que ya importan un procesador de cola, cuatro servicios de dominio y el propio `VideoService`).

Así que la pregunta real es otra: **¿qué quedaría de un servicio compartido entre el vídeo Pro y el bloque, una vez que la infraestructura ya es común?**

### 2.2 El inventario del acoplamiento

Ponemos los dos usos en columnas y miramos qué coincide de verdad:

| Paso | Vídeo Pro (anuncios) | Bloque `videoUpload` (editorial) | ¿Igual? |
|---|---|---|---|
| Gate | Setting `videoEnabled` + Pro + dueño del anuncio + `ACTIVE` (3 consultas) | `@MinRole(EDITOR)` (0 consultas, lo resuelve el guard) | **No** |
| Límites | 50 MB + 60 s + `video/mp4` | 50 MB + `video/mp4` (§6) | **Casi** |
| Clave | `listing-videos/tmp/<listingId>/<uuid>.mp4` | `blocks-videos/tmp/<userId>/<uuid>.mp4` | **No** (raíz y dueño distintos) |
| Firmar | `r2.presignUpload` | `r2.presignUpload` | **Sí — y ya es el mismo** |
| Confirmar: HEAD + tamaño + MIME | Sí | Sí | **Sí** |
| Confirmar: copia fuera de `tmp/` | **Sí, en el confirm** | **No: al guardar el post** (§4.2) | **No** |
| Confirmar: escritura de fila | `Listing.video*` (5 columnas) + compensación si falla | **Ninguna.** La URL viaja al editor y aterriza en el `Json` mucho después | **No** |
| Después | Invalidar caché Redis de ficha + encolar reindexado Meili | Nada | **No** |
| Sustituir / quitar | `borrarLoQueSeVa` sobre 3 columnas | `purgeReleased`, que ya existe y ya está enganchado | **No** |

**Cuatro coincidencias de nueve, y las cuatro son llamadas a código que ya es común.**

### 2.3 Lo que costaría forzar el reparto

Un `VideoUploadService` compartido tendría que recibir por parámetro: el gate (una función, porque uno son tres consultas asíncronas y el otro es un decorador), la raíz de la clave, el id del dueño, los límites, si el confirm copia o no, qué escribir en base de datos y qué invalidar después. Son **siete parámetros de configuración** para dejar en común, al final:

- validar el MIME contra una lista — 3 líneas
- validar el tamaño contra un tope — 3 líneas
- componer la clave con `pendingPrefix` + `randomUUID` — 1 línea
- llamar a `r2.presignUpload` — 1 llamada
- en el confirm, el `head` con su comprobación de tamaño y MIME — ~10 líneas

**Unas veinte líneas, a cambio de siete puntos de configuración y de un acoplamiento nuevo entre dos features que hoy no se conocen.** Y no es un acoplamiento inerte: significa que tocar el gate del vídeo Pro —añadir una cuota por usuario, cambiar el interruptor, exigir verificación— obliga a pensar en el bloque editorial, y al revés. Es exactamente *«el intento de compartir crea un acoplamiento peor que dos caminos limpios»*, y es la misma lección que este repo ya aprendió en `video-limits.ts:100-113` al negarse a publicar la geometría del sprite por la API: **un dato que viaja de un sitio que no lo mira a otro que ya lo tenía es un lector único de mentira.**

Hay además un desacople **estructural**, no de gusto: **en el bloque, el confirm no escribe ninguna fila.** El vídeo Pro confirma *y persiste* en el mismo gesto, y de ahí salen su copia, su compensación y su idempotencia. El bloque devuelve una URL que el editor mete en un array en memoria y que **sólo se persiste cuando alguien guarda el post**, quizá media hora después. Los dos «confirm» no significan lo mismo, y un servicio que los unificara tendría que hacer opcional justo la parte que da forma al del vídeo Pro.

### 2.4 La decisión

> **CAMINO PROPIO para el bloque, sobre la infraestructura genérica que ya está compartida.**
>
> No se extrae nada de `VideoService`, porque lo extraíble ya está extraído. No se duplica el
> mecanismo del presigned, porque el mecanismo **es** `R2Service.presignUpload` y ya es común:
> lo que se escribe encima son sus dos únicos parámetros propios —el gate y la clave—, que es
> precisamente lo que **no** puede ser común.

**Lo que se comparte (y no se toca):** `R2Service` entero, `pendingPrefix`/`isPendingKey`, `ownUrlsDeep`/`releasedUrls`/`keyFromPublicUrl`, `isOwnStorageUrl`, la cola `media-cleanup` y `MediaCleanupService`.

**Lo que se escribe nuevo:** un módulo pequeño con su controlador (dos rutas), su fichero de límites y el pase de promoción del §4.2.

**Lo que NO se negocia y se cumple igual:** los bytes **no pasan por la API**. El controlador nuevo **no lleva `FileInterceptor` ni `memoryStorage`** — el único camino de subida es firmar y que el navegador haga el PUT. Es la barrera B-1 de §10.

---

## 3. El modelo del bloque

### 3.1 El endpoint — uno, no dos

Las imágenes tienen un endpoint por superficie (`blocks/`, `homepage/`, `sponsored/`) porque clonar seis líneas es gratis. **Aquí no**: el presign + confirm + promoción es justo la parte cara, y el motivo por el que aquellos se separaron —que la portada era ADMIN y el blog EDITOR— **ya no existe**: hoy los dos son EDITOR (§1.4), y el comentario que dice lo contrario está obsoleto.

**Un solo par de rutas, neutrales, que sirven a los dos motores:**

| Ruta | Qué hace |
|---|---|
| `POST …/video-url` | Gate `@MinRole(EDITOR)`. Valida MIME y tamaño. Firma contra `blocks-videos/tmp/<userId>/<uuid>.mp4` con `contentLength` **dentro de la firma**. Devuelve `{ uploadUrl, key, expiresInSeconds, requiredHeaders }` — misma forma que [`createUploadUrl`](../apps/api/src/modules/video/video.service.ts#L128-L134) |
| `POST …/video-confirm` | `head` de la clave temporal, comprueba tamaño y MIME **de lo que aterrizó**, y devuelve la URL pública **temporal**. **No copia nada, no escribe nada** |

El namespace exacto (`/admin/media/…` neutral, o colgado de `/admin/blog/` como el de imágenes) es una decisión de forma sin consecuencias; lo que sí importa es que **haya uno solo** y que el módulo no dependa ni de `BlogModule` ni de `HomepageModule` — al revés que ellos de él.

**Por qué el confirm existe si no persiste nada:** es el único punto donde el servidor ve **lo que de verdad se subió** y no lo que el cliente declaró. Sin él, un fichero cortado o de otro tipo sólo se descubre al reproducirlo. Es el mismo motivo por el que lo tiene el vídeo Pro ([`video.service.ts:216-241`](../apps/api/src/modules/video/video.service.ts#L216-L241)), y su fallo devuelve un error que el editor puede mostrar antes de que el bloque parezca correcto.

### 3.2 El prefijo de R2 — `blocks-videos/`

**Ni `listing-videos/`, ni `blocks/`.** Las dos exclusiones son deliberadas, y la primera tiene precedente literal:

- **No `listing-videos/`**: esa cadena es lo que busca el barrido de `video-visualizacion.e2e-spec.ts` para dar por rota la garantía de «cero bytes de vídeo en listas». Meter ahí vídeo editorial pondría ese test en rojo por un motivo falso — e invitaría a relajarlo. Es exactamente el razonamiento con el que el sprite se ganó su propio prefijo ([`video-limits.ts:56-71`](../apps/api/src/modules/video/video-limits.ts#L56-L71)). **El prefijo es la frontera, y la frontera se respeta.**
- **No `blocks/`**: ése lo puebla `uploadBlockImage` y es de imágenes. Un `.mp4` de 50 MB dentro dejaría el prefijo sin poder tener nunca una regla pensada para imágenes, y confundiría cualquier medición del bucket.

Las claves:

```
  Al firmar     blocks-videos/tmp/<userId>/<uuid>.mp4   ← lo cubre la regla de ciclo de vida
  Al guardar    blocks-videos/<uuid>.mp4                ← promocionado (§4.2)
```

**El destino no lleva segmento de dueño, y es correcto:** un vídeo de bloque **no tiene fila propietaria** —el post que lo referencia puede cambiar de autor, y el mismo objeto puede acabar citado desde la portada— así que un `<userId>` en la clave definitiva sería una mentira que envejece. El `<uuid>` basta, igual que en `blocks/<hex><ext>`.

**En la clave temporal, el `<userId>` sí es funcional**, y no decorativo: es lo que permite rechazar la promoción de una subida ajena **sin guardar estado entre firmar y guardar** — el mismo papel que el `listingId` en el vídeo Pro y el `userId` en el avatar ([`media-keys.ts:119-129`](../apps/api/src/infra/r2/media-keys.ts#L119-L129)).

### 3.3 Los campos

```
videoUpload {
  id       string    (heredado de BaseBlockDto: @IsString @IsNotEmpty @MaxLength(64))
  type     'videoUpload'
  url      string    @IsOwnStorageUrl                    ← obligatorio
  poster   string?   @IsOptional @IsOwnStorageUrl        ← opcional
  caption  string?   @IsOptional @IsString @MaxLength(…) ← opcional
}
```

Las tres decisiones de campo, razonadas:

- **`url` con `@IsOwnStorageUrl`, no `@IsSafeContentUrl`.** Molde exacto del bloque `image` ([`image-block.dto.ts`](../apps/api/src/modules/blog/dto/blocks/image-block.dto.ts)) y de `ConfirmVideoDto.posterUrl` ([`confirm-video.dto.ts:22-25`](../apps/api/src/modules/video/dto/confirm-video.dto.ts#L22-L25)). Y aquí importa más que en las imágenes: **un `<video src>` no pasa por `remotePatterns` de `next/image`**, así que este validador es la **única** restricción de origen que tiene — el propio código lo dice, y por eso `isOwnStorageUrl` se endureció para exigir frontera de dominio y no un `startsWith` pelado ([`safe-url.ts:55-70`](../apps/api/src/common/validators/safe-url.ts#L55-L70)).
- **`poster` sí, y opcional.** Sin póster, un `<video preload="none">` es un rectángulo negro; con póster, la página muestra una imagen y quien mira decide si quiere los megabytes. Opcional porque la captura puede fallar (formato que el navegador no decodifica) y **un póster roto no debe impedir publicar** — misma asimetría que el sprite del vídeo Pro ([`video.service.ts:263-266`](../apps/api/src/modules/video/video.service.ts#L263-L266)).
- **`caption` sí, `alt` no.** El pie es la pieza editorial que el embed no tiene y que un vídeo en un artículo casi siempre quiere. `alt` **no**: `<video>` no tiene `alt` —no es un `<img>`—, y el bloque `image` lo lleva porque el suyo sí. Inventar un `alt` que no se pinta en ningún atributo sería un campo que sólo sirve para rellenarse.

**El póster viaja por `POST /admin/blog/upload-image`**, no por un presign propio y **no por `POST /media/upload`**. Es la decisión con más letra pequeña del apartado, así que va explícita:

- Se **captura en el cliente**, reutilizando [`captureVideoPoster`](../apps/web/src/lib/api/video.ts#L155-L196), que ya existe, ya funciona y ya devuelve `null` sin romper cuando no puede.
- Se sube por el camino de imágenes de bloque (`blocks/`, ~100 KB), que **no crea fila**. Esto es **estrictamente mejor que lo que hace hoy el vídeo Pro**, cuyo póster sube por `POST /media/upload` y por tanto **crea una fila `ListingImage` con `listingId = null`** — la deuda H-1 anotada en [`diseno-huerfanas-sin-fila.md` §7](./diseno-huerfanas-sin-fila.md) y §9.8, una fila que acaba apuntando a un fichero inexistente. **No se repite aquí.**
- **Lo que cuesta:** un póster subido y nunca guardado queda huérfano permanente, como cualquier imagen de bloque hoy. Se acepta a propósito: son ~100 KB, y es la misma clase de basura que el editor ya produce con cada imagen que sube y no guarda. **Darle al póster el mismo tratamiento que al vídeo** (presign propio bajo `blocks-videos/tmp/`, promocionado por el mismo pase sin una línea extra, ya que el pase recorre el `Json` entero) **es una alternativa limpia y barata**; se descarta sólo por proporción —cerrar 100 KB con la maquinaria que cierra 50 MB— y queda anotada por si se prefiere la simetría.

### 3.4 El registro

**Motor blog/páginas:** un `video-upload-block.dto.ts` nuevo y una entrada `{ value: VideoUploadBlockDto, name: 'videoUpload' }` en los `subTypes` de [`ValidBlocksArray()`](../apps/api/src/modules/blog/dto/blocks/block.dto.ts#L52-L64), más la unión TS. **Punto único de registro** — las páginas quedan cubiertas sin tocar nada más, porque comparten modelo, DTO, servicio y editor.

**Motor portada:** lo mismo en [`ValidHomeBlocksArray()`](../apps/api/src/modules/homepage/dto/blocks/home-block.dto.ts#L62-L83). El DTO es **propio, no importado del blog**: son dos uniones sin solape, y compartir un subtipo entre ellas ataría los dos motores por primera vez para ahorrar un fichero de doce líneas.

**Sin reglas cruzadas en el servicio.** El tercer nivel de validación (`assertTableBlocksValid`, `assertListingsBlocksValid`, `assertBlocksValid`) existe para invariantes entre bloques o contra la base de datos. Un `videoUpload` no tiene ninguna: no hay tope por post (el tope de bytes ya lo pone R2), ni unicidad, ni referencias a `Category`. **La excepción** es la comprobación de §4.2, que no es una regla de contenido sino la promoción.

---

## 4. LA LIMPIEZA — la trampa, y por qué está medio resuelta

Son **dos fugas distintas** con **dos mecanismos distintos**, y el repo ya tiene los dos escritos. La clasificación es la de `diseno-huerfanas-sin-fila.md` §5 y se hereda entera.

| | **Lo que se suelta** | **Lo que nunca se guarda** |
|---|---|---|
| Cuándo | Se quita el bloque, se cambia el vídeo, se borra el post, se guarda la portada sin él | Se sube el vídeo y se cierra el editor sin guardar |
| Mecanismo | Diff de URLs propias → cola `media-cleanup` (**H1**) | Prefijo `tmp/` + promoción + regla de ciclo de vida (**H2**) |
| Estado | **Ya funciona. Cero código nuevo** (§4.1) | **Un pase nuevo** (§4.2) |

### 4.1 Lo que se suelta: **sale gratis, y hay que no estropearlo**

El bloque `videoUpload` guarda su URL como una cadena dentro de `Post.blocks` / `HomepageConfig.blocks`. `ownUrlsDeep` **recorre el valor entero y no enumera campos** ([`media-keys.ts:163-188`](../apps/api/src/infra/r2/media-keys.ts#L163-L188)), así que:

- **Quitar el bloque de un post** → `adminUpdate` ya llama a `purgeReleased` con el `before` y el `after` ([`blog.service.ts:244-248`](../apps/api/src/modules/blog/blog.service.ts#L244-L248)) → la URL está en la diferencia → se encola su clave. **Sin tocar una línea.**
- **Cambiar el vídeo de un bloque** → igual: la vieja sale, la nueva no.
- **Borrar el post** → `adminDelete` llama con `after: null` ([`:382-386`](../apps/api/src/modules/blog/blog.service.ts#L382-L386)) → se sueltan todas.
- **Guardar la portada** sin el bloque → [`homepage.service.ts:145-149`](../apps/api/src/modules/homepage/homepage.service.ts#L145-L149). Igual.
- **El mismo vídeo en dos bloques del mismo documento**, quitando uno → el diff es entre conjuntos: si sigue en cualquier parte del «después», no está en la diferencia.
- **El mismo vídeo en un post y en la portada** → [`laReferenciaAlguienMas`](../apps/api/src/modules/media-cleanup/media-cleanup.service.ts#L120-L160) ya consulta `Post.blocks` y `HomepageConfig.blocks` por `strpos` sobre el texto del `Json` → **no se borra**.

**Se ha comprobado que ninguna de las consultas de dueño produce un falso positivo con este objeto:** un vídeo de bloque no tiene fila `ListingImage` (no pasa por `POST /media/upload`), no es un `avatarUrl`, no es una `SponsoredAd.imageUrl`, no es una `Invoice.pdfKey` ni una `TicketAttachment.key`, y no es un `Listing.videoUrl`. Cae limpio en el único caso que sí se mira: dentro de los dos `Json`.

> **La única obligación que esto impone al diseño** es **no romper el supuesto** del que sale gratis: la URL tiene que ser una **cadena literal completa** dentro del `Json`. Guardar en el bloque la *clave* en vez de la URL, o la URL partida en trozos, o una plantilla que se componga al renderizar, dejaría a `ownUrlsDeep` ciego **en silencio**. Por eso el campo es `url: string` y no `key: string`. Es una restricción real, y es la que la barrera B-3 de §10 vigila.

### 4.2 Lo que nunca se guarda: el pase de promoción

Aquí sí hay trabajo, y es donde el bloque **se aparta del vídeo Pro** por el motivo del §2.3: *el confirm no persiste nada*.

**Por qué no se copia en el confirm.** Si el confirm sacara el objeto de `tmp/` —como hace el vídeo Pro—, un editor que sube un vídeo y cierra la pestaña sin guardar dejaría 50 MB en `blocks-videos/`, **fuera de `tmp/`, donde la regla de ciclo de vida no llega**. Sería una huérfana **permanente**, y es exactamente el fallo que `diseno-huerfanas-sin-fila.md` §9.3 identificó y compensó. Peor aún: «subo el vídeo y no llego a guardar» no es un caso raro, es *el* caso de abandono.

**El mecanismo, que es el del avatar tal cual.** En H2, el avatar se sube a `avatars/tmp/<userId>/…` y **la confirmación es guardar el perfil**: `updateMe` copia al definitivo, guarda la URL definitiva y borra el temporal ([`diseno-huerfanas-sin-fila.md` §9.4](./diseno-huerfanas-sin-fila.md)). Aquí es idéntico, con una sola diferencia: el avatar es **un campo** y los bloques son **un `Json` con N vídeos posibles**. Así que en vez de una copia, un recorrido — y el recorrido ya existe.

> **Un pase de promoción, espejo exacto de `releasedUrls`:** antes de escribir, recorrer el valor
> **nuevo** recogiendo toda URL propia que esté bajo `blocks-videos/tmp/`; por cada una, copiar al
> destino definitivo y **reescribir esa cadena en el valor** con la URL promocionada. Lo que se
> persiste no contiene ningún `tmp/`.

Vive donde vive su gemelo: junto a `purgeReleased`, en el módulo neutral que los tres llamantes ya importan (`MediaCleanupModule`). El nombre `MediaCleanupService` se le queda corto a un método que **promociona** en vez de limpiar; si molesta, un servicio hermano en el mismo módulo. Es una decisión de nombre, no de diseño.

**Las cinco decisiones de orden y fallo** —todas heredadas de H2, ninguna nueva:

1. **Promocionar ANTES de escribir; purgar DESPUÉS.** La escritura necesita las URLs ya definitivas; la comprobación de dueño de `purgeReleased` necesita el estado nuevo ya escrito, o la fila se contaría a sí misma como otro dueño ([`media-cleanup.service.ts:29-32`](../apps/api/src/modules/media-cleanup/media-cleanup.service.ts#L29-L32)).
2. **Los dos no se pisan**, y por el mismo argumento que H2 §9.4 dio para el avatar: **una URL temporal nunca llega a guardarse**, así que nunca entra en el diff del `purgeReleased`, que compara siempre contra lo ya definitivo.
3. **Fail-closed, y ésta es la regla que sostiene todo lo demás.** Si una copia falla, **el guardado falla** con un mensaje accionable. Persistir en silencio una URL bajo `tmp/` sería lo peor que puede pasar en todo este diseño: la regla de ciclo de vida borraría, en un día, un vídeo **publicado y vivo**. Como cinturón, tras el pase se comprueba que en el valor a escribir **no queda ninguna URL propia bajo `tmp/`** — es la condición exacta que hace segura la regla, y es la barrera que H2 §9.6 ya identificó como la que hay que probar.
4. **Compensación.** Si la escritura de la fila falla después de copiar, las copias quedan en el prefijo definitivo, sin referencia y **fuera del alcance de la regla**. Se borran y se propaga el error. El original sigue en `tmp/` y lo caducará la regla, así que reintentar no pierde nada. Es el único fallo nuevo que introduce la copia, y es el mismo que [`video.service.ts:300-312`](../apps/api/src/modules/video/video.service.ts#L300-L312) ya compensa.
5. **Idempotente y barato.** Guardar un post cuyas URLs ya son definitivas encuentra cero candidatas y no hace nada: **el pase no añade ni una llamada a R2 al 99 % de los guardados**, que son los que no tocan vídeo. Y borrar el temporal tras copiar es **cortesía**: si falla, la regla lo caduca — *«no dejar limpiar no debe romper nada»*.

**El rechazo de la subida ajena.** El pase promociona una URL temporal **sólo si su segmento de dueño es el actor**. Sin esto, un EDITOR podría pegar en su bloque la clave temporal de otro. Es el papel exacto del `<userId>` en la clave (§3.2) y no necesita guardar estado entre firmar y guardar.

**La ventana que queda, dicha en voz alta.** Entre subir y guardar hay hasta un día (lo que dure la regla). Un editor que sube un vídeo, deja la pestaña abierta el fin de semana y guarda el lunes se encontrará con que la copia falla — y, por la regla 3, con que el guardado se rechaza. **Es incómodo y es correcto**: el mensaje dice que el vídeo caducó y que hay que volver a subirlo, en vez de guardar un enlace roto. Un día es holgadísimo para una sesión de edición y es el **suelo** que permite una regla de ciclo de vida (la expiración se expresa en días enteros).

### 4.3 La regla de ciclo de vida — y una deuda que aparece de paso

`blocks-videos/tmp/` se suma a la lista de [`pendientes.md`](./pendientes.md) §1, paso 7: caducar a **1 día**. Es configuración del bucket, **no código**, y **no se prueba en CI** —una caducidad se mide en días—. Lo que sí se prueba es la condición que la hace segura: que lo guardado no está en `tmp/`.

> **Deuda preexistente encontrada al verificar, y conviene arreglarla en la misma pasada:**
> ese paso 7 sigue hablando de **«las dos reglas»** (`listing-videos/tmp/` y `avatars/tmp/`),
> pero el póster animado P1 añadió un **tercer** prefijo temporal, `listing-previews/tmp/`
> ([`video.service.ts:175`](../apps/api/src/modules/video/video.service.ts#L175)), **que no está
> en la lista**. Con este diseño serían **cuatro**. No es culpa de este proyecto y no lo bloquea,
> pero es justo el modo de fallo de una lista escrita a mano — y esta vez se ha visto.

### 4.4 La alternativa evaluada y descartada

**Subir directo al prefijo definitivo, sin `tmp/` ni promoción** — o sea, tratar el vídeo como se trata hoy la imagen de bloque, que sube a `blocks/` de una vez y cuya huérfana por abandono nadie cierra.

Es **más simple**, y tiene el argumento de consistencia a favor. Se descarta por **proporción y por coste marginal**:

- Una imagen abandonada son ~200 KB; un vídeo abandonado son hasta **50 MB**. Dos órdenes de magnitud es la misma diferencia que llevó a que el vídeo Pro no compartiera límite con las fotos ([`video-limits.ts:3-8`](../apps/api/src/modules/video/video-limits.ts#L3-L8)).
- Y sobre todo: **la maquinaria ya está construida**. `pendingPrefix`, `isPendingKey`, `R2Service.copy`, el patrón de compensación y la regla documentada existen desde H2; `ownUrlsDeep` existe desde H1. Lo que este diseño añade **no es un mecanismo, es un pase** que compone dos piezas que ya están. Aceptar la fuga costaría casi lo mismo que cerrarla, y dejaría abierta la única fuente nueva de basura pesada del proyecto.

---

## 5. La reproducción

### 5.1 El reproductor se reutiliza literal

[`VideoPlayer.tsx`](../apps/web/src/components/anuncios/VideoPlayer.tsx) **ya es genérico**: es un **server component** con props `{ src, poster?, className?, testId? }` y **no sabe nada de anuncios**. Toda la disciplina que el encargo pide ya está dentro:

| | |
|---|---|
| `preload="none"` | El `.mp4` **no se descarga** hasta que alguien le da al play |
| `poster` | Con validación de origen propia; si el póster no es nuestro, se ignora en vez de pintarlo |
| `controls`, `playsInline` | Sí |
| `autoPlay`, `muted`, `loop` | **No**, y está razonado en el propio fichero: *«reproducir es siempre un acto de quien mira»* |
| `isSafeSrc(src)` | Si el `src` no es de nuestro almacenamiento, **devuelve `null`**: no pinta nada. Es la barrera que compensa que un `<video src>` no pase por `remotePatterns` |

**Esto sí es reutilización limpia** —al revés que el servicio del §2— porque el componente recibe una URL y un póster y no pregunta de dónde vienen. **Lo único que hay que hacer es mudarlo** de `components/anuncios/` a un sitio neutral (`components/media/`): en cuanto lo use el blog, su carpeta actual es una etiqueta falsa. Es un movimiento de fichero con dos importadores existentes ([`ListingGallery.tsx:63-67`](../apps/web/src/components/anuncios/ListingGallery.tsx#L63-L67) y la ficha de backoffice).

### 5.2 Los dos renderizadores

Uno por motor, porque los motores no comparten componentes (§1.5). Cada uno es una envoltura fina: `<figure>` con el `VideoPlayer` y, si hay pie, un `<figcaption>` — el mismo patrón que el bloque `image` usa para su `caption`. Aspecto y espaciado, del contenedor de cada motor (`space-y-8` en blog, `space-y-12` en portada).

**Nada de sprite ni de póster animado.** El hover animado del vídeo Pro ([`VideoHoverPreview.tsx`](../apps/web/src/components/anuncios/VideoHoverPreview.tsx) + el CSS `.sprite-hover`) existe para **tarjetas de listas**, que es un problema que el bloque no tiene: un vídeo editorial se pinta ya en su sitio, no como miniatura entre otras cien. Traerlo sería coste sin caso de uso.

### 5.3 El póster

Se **captura en el cliente**, como el del vídeo Pro y por el mismo motivo: extraer un frame en el servidor exige `ffmpeg`, y **`ffmpeg` es precisamente la dependencia que todo este dominio evita**. `captureVideoPoster` ya lo hace y ya devuelve `null` sin romper cuando el navegador no puede decodificar. **No se genera nada en cola.**

**Si no hay póster**, el `<video preload="none">` muestra su primer fotograma sólo tras cargar metadatos, o un rectángulo neutro. A diferencia de la ficha de anuncio —que cae a la foto de portada ([`ListingGallery.tsx:65`](../apps/web/src/components/anuncios/ListingGallery.tsx#L65))— **un bloque no tiene ninguna imagen de respaldo natural**, así que el editor debería ver un aviso suave de que sin póster el bloque se ve pobre. Nunca un bloqueo: publicar sin póster tiene que seguir siendo posible.

---

## 6. Los límites

**Los duros, iguales. El blando, se cae.**

| Límite | Vídeo Pro | Bloque | Por qué |
|---|---|---|---|
| **Tamaño: 50 MB** | `MAX_VIDEO_BYTES` | **Igual** | Es el **único límite realmente infranqueable**: viaja **dentro de la firma** ([`r2.service.ts:117`](../apps/api/src/infra/r2/r2.service.ts#L117)), así que lo aplica el almacenamiento y no la buena fe del cliente. Más de 50 MB en una página web pide CDN y transcodificación, que no están en este proyecto |
| **Formato: sólo `video/mp4`** | `ALLOWED_VIDEO_MIME_TYPES` | **Igual** | No es arbitrario: es **lo que hace innecesaria la transcodificación**. Ampliarlo (WebM, MOV) reabre la pieza más cara del dominio ([`video-limits.ts:33-40`](../apps/api/src/modules/video/video-limits.ts#L33-L40)) |
| **Duración: 60 s** | `MAX_VIDEO_DURATION_SECONDS` | **NO se aplica** | Ver abajo |
| **TTL de la firma: 10 min** | `VIDEO_UPLOAD_URL_TTL_SECONDS` | **Igual** | Es un permiso para subir, no un enlace |
| **Interruptor (`Setting`)** | `videoEnabled`, apagado sin fila | **No** | Ver abajo |

**Por qué se cae la duración, y por qué no se sustituye por otro número.** El propio código dice para qué existe: *«acota el tiempo de subida desde un móvil con datos, que es donde la experiencia se rompe de verdad»* ([`video-limits.ts:14-31`](../apps/api/src/modules/video/video-limits.ts#L14-L31)). **Un EDITOR en el backoffice no es ese caso.** Y hay un segundo motivo, más fuerte: la duración es una **frontera conocida y aceptada** —se valida la duración **declarada** por el cliente, porque medirla en el servidor exigiría `ffmpeg`—, así que es un límite **de producto, no de coste**: el daño ya está acotado por los 50 MB, que sí son infranqueables. **Poner otro número (120 s, 180 s) sería un número que no se puede hacer cumplir y que ya no protege de nada.** Es preferible ninguno.

Si se quiere una guía de producto («los vídeos largos aburren»), su sitio es un **aviso en el editor**, no una regla del servidor. Un servidor que finge imponer lo que no puede comprobar es peor que uno que no lo intenta.

**Por qué no hay `Setting` de interruptor.** El del vídeo Pro nace apagado porque es una feature **de usuarios** que consume ancho de banda desde el primer vídeo y hay que poder cortarla sin desplegar. El bloque es una superficie **de administración**, de volumen bajo y con el gate ya puesto en el rol. Añadir un interruptor sería una segunda puerta delante de una que ya está cerrada. (Si se quisiera, encaja sin cambiar nada más.)

**Fichero propio de constantes**, no importar de `video-limits.ts`. Dos números que hoy coinciden **no son el mismo número**: si mañana el vídeo Pro sube a 100 MB por una decisión de producto de anuncios, el bloque editorial **no** debe seguirle en silencio. Compartir la constante crearía justo el lector único de mentira que este repo evita a propósito. El fichero nuevo escribe sus valores y deja un comentario apuntando al otro: *coinciden hoy, a propósito, y no son la misma decisión.*

---

## 7. El editor

### 7.1 El picker

Blog/páginas ([`BlockTypePicker.tsx`](../apps/web/src/app/(admin)/admin/blog/_components/block-editor/BlockTypePicker.tsx) sobre `BLOCK_TYPE_META` + `BLOCK_TYPE_ORDER`) y portada ([`HomeBlockTypePicker.tsx`](../apps/web/src/app/(admin)/admin/portada/_components/HomeBlockTypePicker.tsx) sobre sus equivalentes) ganan una tarjeta cada uno.

**Las dos etiquetas, juntas y contiguas en el orden**, para que la elección sea evidente en el momento de elegir:

| Tipo | Etiqueta | Descripción |
|---|---|---|
| `video` (existente) | **Vídeo incrustado** | Un vídeo de YouTube o Vimeo |
| `videoUpload` (nuevo) | **Vídeo subido** | Un vídeo alojado en la plataforma |

El cambio en el existente es **sólo la cadena de la etiqueta**. El `type`, el DTO, el discriminador y los datos guardados no se tocan — es la barrera B-5 de §10.

*(En la portada, `video` no existe: allí el `videoUpload` entra solo.)*

### 7.2 El editor del bloque

Un componente por motor, con la misma coreografía. El molde es [`StepVideo.tsx`](../apps/web/src/components/publicar/steps/StepVideo.tsx), **recortado**: sin gate Pro, sin sprite, sin `listingId`.

1. Elegir fichero → validar MIME y tamaño en cliente (rechazo temprano, antes de gastar red).
2. Capturar el póster con `captureVideoPoster`; si devuelve `null`, seguir sin él.
3. Pedir la firma → **PUT directo a R2 con barra de progreso**.
4. Subir el póster por el camino de imágenes de bloque.
5. Confirmar → recibir la URL (temporal, §4.2) y escribirla en el bloque.
6. Campo de pie, y previsualización con el mismo renderizador público que verá el lector — como ya hacen el editor de imagen y el de vídeo embed.

**El progreso exige `XMLHttpRequest`, no `fetch`**, y ya está resuelto: [`putToStorage`](../apps/web/src/lib/api/video.ts#L418-L445) usa `xhr.upload.onprogress` precisamente porque `fetch` no informa del progreso de subida. Es **genérico** —recibe `uploadUrl`, el fichero, las cabeceras y un callback— igual que `captureVideoPoster`. **Las dos se mudan de `lib/api/video.ts` a un `lib/media/` neutral**, por el mismo motivo que el `VideoPlayer`: en cuanto las use el backoffice editorial, vivir en el cliente del vídeo Pro es una etiqueta falsa. Es reutilización limpia: funciones puras sobre un `File` y una URL.

**Lo que el editor debe dejar claro en pantalla**, porque son las dos fricciones reales: que el vídeo **no queda guardado hasta que se guarda el post** (§4.2), y el límite de 50 MB **antes** de que alguien elija un fichero de 300 MB y espere.

---

## 8. Blog, páginas y portada

| | Blog | Páginas | Portada |
|---|---|---|---|
| Registro backend | `ValidBlocksArray()` | **el mismo** | `ValidHomeBlocksArray()` |
| Espejo TS | `types/blocks.ts` | **el mismo** | `types/home-blocks.ts` |
| Renderizador | `BlockRenderer` | **el mismo** | `HomeBlockRenderer` |
| Editor | `admin/blog/_components/` | **el mismo** (vía `PostForm`) | `admin/portada/_components/` |
| Persistencia | `Post.blocks` | **la misma** (`Post`, `type=PAGE`) | `HomepageConfig.blocks` |
| Limpieza al soltar | `adminUpdate` / `adminDelete` | **la misma** | `homepage.service.update` |
| Promoción (§4.2) | `adminCreate` / `adminUpdate` | **la misma** | `homepage.service.update` |
| **Endpoint de subida** | **uno solo, neutral, compartido por los tres** (§3.1) | | |
| **Reproductor** | **uno solo, `VideoPlayer` mudado a neutral** (§5.1) | | |

**Dos registros, tres superficies.** Las páginas salen gratis en todo: mismo modelo, mismo DTO, mismo servicio, mismo formulario. Lo único que se escribe dos veces es lo que **ya** está escrito dos veces por la forma del repo: el DTO del subtipo, la entrada del `subTypes`, el renderizador y el editor de cada motor.

**Los tres sitios de promoción** son exactamente los tres que ya llaman a `purgeReleased` — no hay una cuarta superficie escondida que escriba bloques, y eso está verificado: los únicos escritores de los dos `Json` son `BlogService.adminCreate` / `adminUpdate` y `HomepageService.update`.

---

## 9. El plan — dos ráfagas

### V1 — el mecanismo y el modelo (backend)

El endpoint de firma + confirmación con gate `@MinRole(EDITOR)`; el fichero de límites propio; el DTO `videoUpload` registrado en **los dos** motores; el prefijo `blocks-videos/`; **el pase de promoción** en los tres puntos de guardado, con su comprobación fail-closed y su compensación; y la regla de ciclo de vida **documentada** en `pendientes.md` §1 (junto con la de `listing-previews/tmp/`, que falta desde P1).

Sus barreras son **e2e contra MinIO de verdad**, porque lo que se afirma es **dónde acaba el objeto** y eso espiando llamadas no se prueba. Molde: [`huerfanas-h2.e2e-spec.ts`](../apps/api/test/huerfanas-h2.e2e-spec.ts) y `video-infra.e2e-spec.ts`, que ya suben de verdad y comprueban con `r2.head`.

Al terminar V1 el sistema **acepta y limpia** bloques `videoUpload`, y **nadie puede crear uno todavía**. Es una ráfaga invisible a propósito, y no es un problema: no hay estado intermedio incoherente, porque un tipo que ningún editor puede insertar simplemente no aparece.

### V2 — el editor y el render (frontend)

Las mudanzas neutrales (`VideoPlayer`, `putToStorage`, `captureVideoPoster`); las dos entradas de picker con el renombrado del embed a «Vídeo incrustado»; los dos renderizadores; los dos editores con subida y progreso; los espejos TS y los `*Defaults.ts`.

Sus barreras son **Playwright**: elegir el tipo, subir, ver la barra, guardar, y que el vídeo se reproduzca en `/blog/{slug}`, en `/paginas/{slug}` y en la portada.

### Por qué dos y no una

Porque son **dos suites y dos riesgos**. El de V1 es *dónde aterriza el fichero* y se prueba contra un bucket real; el de V2 es *qué ve y qué hace una persona* y se prueba con un navegador. Y porque V1 sola ya es densa: toca tres servicios con un orden de operaciones que tiene compensación, idempotencia y un fallo que **hay que hacer fallar** a propósito.

**V1 antes que V2**, sin alternativa: V2 escribe URLs que sólo V1 sabe promocionar. Al revés, el editor generaría vídeos que caducan en un día.

---

## 10. Las barreras

**B-1 — Los bytes no pasan por la API.** El módulo nuevo **no importa `FileInterceptor` ni `memoryStorage`**; sus dos rutas reciben JSON, nunca `multipart`. Un fichero llega a R2 sólo por el PUT prefirmado del navegador. *Mutación que la mata:* añadir un endpoint de subida directa «para simplificar el editor».

**B-2 — Lo guardado nunca está en `tmp/`.** Tras guardar un post o la portada con un `videoUpload`, el `Json` persistido **no contiene ninguna URL bajo `blocks-videos/tmp/`**, y `head` encuentra el objeto en el destino definitivo. *Es la barrera que hace segura la regla de ciclo de vida*, y la más importante de todas: si cae, la regla borra vídeos publicados. *Mutación que la mata:* quitar el pase de promoción y guardar la URL temporal tal cual — todo seguiría pareciendo correcto **durante un día**.

**B-3 — Lo que sale, se limpia.** Quitar el bloque de un post encola su clave; borrar el post la encola; cambiar el vídeo encola **la vieja y no la nueva**; el mismo vídeo en dos bloques, quitando uno, **no encola nada**; el mismo vídeo en un post **y** en la portada, quitándolo del post, **no encola nada**. *Mutación que la mata:* guardar en el bloque la clave en vez de la URL completa — `ownUrlsDeep` dejaría de verla **en silencio**.

**B-4 — Lo que nunca se guarda queda confinado.** Firmar y subir sin guardar deja el objeto **bajo `blocks-videos/tmp/` y en ningún otro sitio**. Y promocionar la clave temporal **de otro usuario** se rechaza.

**B-5 — Convive con el embed.** Los 13 tipos existentes siguen validando; un bloque `video` guardado antes de esta ráfaga se lee, se edita y se renderiza **sin cambio alguno**; los dos aparecen en el picker con etiquetas distintas. *Mutación que la mata:* tocar el `name` del discriminador del embed.

**B-6 — Los tres contextos.** Un `videoUpload` valida y renderiza en un `POST`, en un `PAGE` y en la portada. Y un `type` desconocido **sigue rechazándose con 400** en los dos motores.

**B-7 — Compensación.** Si la escritura de la fila falla después de promocionar, las copias del prefijo definitivo se borran y el error se propaga. *Mutación que la mata:* tragarse el error de la escritura — quedaría una huérfana permanente **fuera** del alcance de la regla.

**La barrera que no se puede escribir**, y es la misma de H2: que un objeto abandonado en `tmp/` desaparezca solo. Depende de una regla configurada en el bucket y se mide en días. Queda documentada, y B-2 es lo que hace que activarla sea seguro.

---

## 11. Lo que este diseño NO hace

- **No toca el bloque `video` de embed** más allá de su etiqueta en el picker.
- **No toca `VideoService` ni el vídeo Pro.** No extrae nada de él, no lo refactoriza y no cambia su comportamiento. El único fichero suyo que se lee es `video-limits.ts`, y para **no** importarlo (§6).
- **No trae `ffmpeg`, ni transcodificación, ni cola de vídeo.** El póster lo captura el navegador; no hay procesado en servidor.
- **No trae sprite ni póster animado.** Es una solución para tarjetas de lista, y un bloque no es una tarjeta (§5.2).
- **No impone duración**, y explica por qué imponerla sería fingir (§6).
- **No recoge la basura ya acumulada**, ni la de vídeo (no la hay todavía) ni la de imágenes de bloque. Cierra fuentes, no friega el suelo — criterio heredado de `diseno-huerfanas-sin-fila.md` §0.
- **No cierra la huérfana del póster abandonado** (~100 KB), que es la misma que produce hoy cualquier imagen de bloque. La alternativa que sí la cerraría queda descrita en §3.3 por si se prefiere la simetría.
- **No arregla** los tres comentarios y documentos que dicen ADMIN donde el código dice EDITOR (§1.4), ni **añade** `listing-previews/tmp/` a `pendientes.md` (§4.3). Las dos son deudas ajenas encontradas al verificar; quedan anotadas y son de una línea cada una.
