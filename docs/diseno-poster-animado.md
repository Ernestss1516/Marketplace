# Diseño — Póster animado (la vía C del hover-preview)

> Documento de diseño (2026-08-27). Convierte la **vía C** de
> [`docs/auditoria-pro-video.md`](./auditoria-pro-video.md) §3.3 en un plan.
> **Cero código.** No implementa nada: decide el artefacto, el modelo, el flujo de subida,
> cómo se muestra, qué garantía hay que preservar y en qué orden se hace.
>
> **Verificado contra el código en `HEAD = d422d22`**, árbol limpio. Todas las referencias
> `fichero:línea` se han vuelto a comprobar una por una. De esa verificación salen dos cosas
> que no estaban en el encargo:
>
> - **Tres hallazgos nuevos** (§1.1) que **cambian el diseño**: el póster fijo se guarda por
>   un camino que crea filas y pasa por `sharp`; quitar el vídeo **no borra su póster**; y el
>   navegador **no sabe codificar animación**. El tercero decide el artefacto entero.
> - **Dos apartados de la auditoría han quedado obsoletos, para bien** (§8): sus dos motivos
>   para aplazar el hover —la feature no se podía encender y no se anunciaba en `/planes`— ya
>   están cerrados en el código. **No hay nada por delante de este diseño.**
>
> **El principio que no se negocia**, heredado de
> [`diseno-video-pro.md`](./diseno-video-pro.md) §D5: *una tarjeta de lista no descarga
> vídeo.* La vía A (reproducir un trozo del `.mp4` en hover) está descartada por escrito y
> **este documento no la reabre**. La vía C respeta el principio **por construcción**, no por
> disciplina: lo que se sirve es una **imagen**, y una imagen no es un vídeo.

---

## 0. La idea, en una página

**El póster animado no está animado.** Es una imagen fija.

Esa frase no es un juego de palabras: es la arquitectura entera, y sale de **un hecho del
navegador** que decide todo lo demás.

> **El navegador sabe capturar fotogramas. No sabe empaquetarlos en una animación.**
>
> `canvas.toBlob()` sólo emite imágenes **fijas** — `image/jpeg`, `image/png`, `image/webp`
> estático. **No existe ninguna API nativa que produzca un WebP animado ni un GIF animado.**
> Para eso haría falta una biblioteca de codificación (`gif.js`, un WebP en WASM): una
> dependencia nueva en el cliente, entre cientos de KB y un megabyte de JavaScript, para
> generar un artefacto de decenas de KB.

Y de ahí sale la decisión del artefacto sin necesidad de sopesar preferencias: **un sprite**
—los 5 fotogramas dibujados uno al lado del otro sobre un único `<canvas>`, emitido como
**una sola imagen fija**— se produce con **exactamente las mismas tres llamadas** que
`captureVideoPoster` ya usa hoy para un fotograma
([`video.ts:138-179`](../apps/web/src/lib/api/video.ts#L138)): `seek` → `drawImage` →
`toBlob`. Cero dependencias nuevas. La animación la pone **el CSS**, moviendo la ventana
sobre esa imagen.

Las tres consecuencias, y son las que hacen que la vía C valga la pena:

| | Sprite (imagen fija) | WebP/GIF animado |
|---|---|---|
| Producirlo en el navegador | **Ya se sabe** — es el bucle de `captureVideoPoster` | Biblioteca de codificación nueva |
| Animar sólo en hover | **Gratis** — si el CSS no anima, no anima | Hay que pararlo: un `<img>` animado **anima solo, siempre** |
| Qué llega si algo falla | El primer fotograma: una imagen legítima | Un fichero roto |

La segunda fila es la que resuelve de paso **la mitad de la pregunta del móvil** (§5): un
WebP animado empieza a animarse **en cuanto se pinta**, así que en móvil habría que evitar
montarlo; un sprite montado sin la clase de animación es, literalmente, una foto quieta.

**Lo que este diseño cuesta:** una columna en `Listing`, un tercer objeto en R2 por vídeo
**con su limpieza**, un tramo más en el flujo de subida y un componente de tarjeta. Todo en
terreno conocido. **Lo que NO cuesta:** ni `ffmpeg`, ni tocar el `.mp4`, ni un `<video>` en
ninguna lista, ni reabrir ninguna decisión de arquitectura.

---

## 1. El cimiento verificado

Lo que ya existe y en lo que este diseño se apoya. **Verificado en `HEAD`, no heredado de la
auditoría.**

| Pieza | Dónde | Qué aporta |
|---|---|---|
| Captura de **un** fotograma en `<canvas>` | [`video.ts:138-179`](../apps/web/src/lib/api/video.ts#L138) | **El molde exacto.** `<video>` oculto → `currentTime` → `onseeked` → `drawImage` → `toBlob` |
| Lectura de la duración real | [`video.ts:96-125`](../apps/web/src/lib/api/video.ts#L96) | Los instantes de captura se reparten sobre ESTE número, ya medido antes de subir |
| El flujo de dos tiempos | [`video.service.ts:78-239`](../apps/api/src/modules/video/video.service.ts#L78) | Firmar → PUT directo → confirmar. El sitio donde encaja el tercer objeto |
| El prefijo temporal `tmp/` | [`media-keys.ts:103-120`](../apps/api/src/infra/r2/media-keys.ts#L103) | Lo no confirmado caduca solo, sin código de recolección |
| Los campos de vídeo en `Listing` | [`schema.prisma:876-897`](../apps/api/prisma/schema.prisma#L876) | `videoUrl`, `videoPosterUrl`, `videoDurationSeconds`, `videoUploadedAt`. Aquí va el quinto |
| El documento indexado lleva **todas** las URLs de foto | [`search.service.ts:38-44`](../apps/api/src/modules/search/search.service.ts#L38) | **El precedente exacto** de «URL en el payload, bytes en el montaje» (§5.3) |
| `SELECT_SUMMARY` + `toSummary` | [`listing-summary.ts:64-145`](../apps/api/src/modules/listings/listing-summary.ts#L64) | **Un solo lector** de lo que ve una tarjeta. `videoUrl` entra y **no sale**: sólo `hasVideo` |
| El documento indexado | [`search.service.ts:787-790`](../apps/api/src/modules/search/search.service.ts#L787) | Las tarjetas de búsqueda salen de Meilisearch, **no de Postgres**. Lleva `thumbnailUrl` y `hasVideo` |
| El barrido de la URL de vídeo | [`video-visualizacion.e2e-spec.ts:111-122`](../apps/api/test/video-visualizacion.e2e-spec.ts#L111) | `expect(JSON.stringify(res.body)).not.toContain('listing-videos/')` |
| `VideoIndicator` | [`VideoIndicator.tsx`](../apps/web/src/components/anuncios/VideoIndicator.tsx) | **Un** indicador para las cuatro superficies. Recibe un booleano, nunca una URL |
| `CardPhotoCarousel` | [`CardPhotoCarousel.tsx:78-105`](../apps/web/src/components/anuncios/CardPhotoCarousel.tsx#L78) | El contenedor `relative` de la tarjeta y **el precedente de la pereza**: sólo monta el `<Image>` del índice actual |
| `isSafeSrc` | [`image-domains.ts:6-17`](../apps/web/src/lib/image-domains.ts#L6) | La validación de dominio para lo que **no** pasa por `next/image` |
| El gate Pro al subir | [`video.service.ts:298-305`](../apps/api/src/modules/video/video.service.ts#L298) | `assertPro`, en el servidor |
| `listingMediaKeys` + la cola | [`media-keys.ts:70-90`](../apps/api/src/infra/r2/media-keys.ts#L70) · [`admin.service.ts:1327-1337`](../apps/api/src/modules/admin/admin.service.ts#L1327) | La limpieza de R2 al borrar un anuncio |

### 1.1 Tres hallazgos nuevos, verificados, que cambian el diseño

Ninguno estaba en la auditoría. Los tres salieron al verificar **cómo se guarda hoy el
póster fijo**, que es el precedente que la vía C iba a copiar — y **es el precedente que no
hay que copiar**.

**H-1 · El póster fijo se sube por `POST /media/upload`, y eso crea una fila.**
[`video.ts:218-232`](../apps/web/src/lib/api/video.ts#L218) manda el póster al camino de
imágenes, y [`media.service.ts:31-48`](../apps/api/src/modules/media/media.service.ts#L31)
**crea un `ListingImage`** (con `listingId` a `null`, porque nadie lo enlaza) **y encola un
trabajo de `sharp`**. Consecuencias, las tres verificadas:

- Cada póster deja una **fila huérfana** en `ListingImage` que nadie borra nunca.
- `ImageProcessor` genera además un `-thumb.webp`
  ([`image.processor.ts:29-42`](../apps/api/src/infra/queue/processors/image.processor.ts#L29))
  que **nadie usa**, y que `listingMediaKeys` **no incluye** para el póster
  ([`media-keys.ts:83-87`](../apps/api/src/infra/r2/media-keys.ts#L83): la miniatura sólo se
  deriva para `imageUrls`) → se queda en el bucket para siempre.
- Y lo peor para nosotros: **`sharp` aplanaría un sprite**. No destruiría el original —el
  procesador sólo escribe un derivado—, pero produciría una miniatura de 800 px de un
  artefacto que no es una foto. Trabajo y bytes por nada.

**H-2 · `removeVideo` no borra el póster.**
[`video.service.ts:245-262`](../apps/api/src/modules/video/video.service.ts#L245) pone
`videoPosterUrl: null` en la fila y llama a `deleteObjectByUrl(listing.videoUrl)` — **sólo el
vídeo**. El objeto del póster se queda huérfano en R2 en cuanto alguien quita su vídeo.
Añadir un tercer objeto sin arreglar esto sería **triplicar la fuga**.

**H-3 · El navegador no puede codificar animación.** Ya está en §0, y es el hallazgo que
decide el artefacto. `canvas.toBlob` emite imágenes fijas y no hay alternativa nativa.

> **Los tres apuntan al mismo sitio:** el póster animado **no** debe ir por
> `POST /media/upload`. Necesita su propio camino — que además ya existe como molde, porque
> es el mismo de dos tiempos que usa el vídeo.

---

## 2. El artefacto

### 2.1 La decisión: **sprite**, no WebP animado

| | **(a) Sprite (fijo)** ✅ | (b) WebP animado | (c) GIF animado |
|---|---|---|---|
| ¿Se puede producir hoy en el navegador? | **Sí** — `toBlob` | No sin WASM | No sin biblioteca |
| Dependencia nueva en el cliente | **Ninguna** | Codificador WebP | `gif.js` o similar |
| Peso (5 fotogramas, ver §2.3) | **~25-45 KB** | ~30-60 KB | 150-400 KB (256 colores) |
| Animar **sólo** en hover | **Por defecto** — sin CSS no se mueve | Hay que impedirlo | Hay que impedirlo |
| Si algo falla a medias | Un fotograma: **imagen válida** | Fichero roto | Fichero roto |
| Control (velocidad, pausa, sentido) | **Total, desde CSS** | Ninguno | Ninguno |
| `next/image` | Se evita a propósito (§5.2) | Lo detecta como animado y **no** lo optimiza | Ídem |

**→ (a), el sprite.** La fila decisiva es la primera: (b) y (c) exigen una dependencia nueva
en el cliente para producir el mismo efecto, y el proyecto ya ha rechazado por escrito **dos
veces** traer un codificador —`ffmpeg`— para una tarea de este tamaño
([`video-limits.ts:21-29`](../apps/api/src/modules/video/video-limits.ts#L21) ·
[`video.ts:127-137`](../apps/web/src/lib/api/video.ts#L127)). Traerlo al navegador en vez de
al servidor no cambia el argumento: sigue siendo cientos de KB de código para fabricar
decenas de KB de dato.

La segunda razón, y no es menor: **un sprite es una imagen fija, así que la garantía se
explica en una frase**. «Lo que viaja a las listas es un JPEG» es una afirmación que
cualquiera puede comprobar mirando la respuesta. «Lo que viaja es un WebP animado que hemos
configurado para no animarse en móvil» ya es una condición que puede fallar.

### 2.2 La geometría

**Cinco fotogramas, en tira HORIZONTAL, con relación de aspecto 16:9.**

- **Cinco y no cuatro ni seis.** Cuatro se lee como un parpadeo; seis paga un 20 % más de
  peso por un fotograma que a 5 fps nadie distingue. Con cinco fotogramas a ~4 fps el bucle
  dura **1,25 s**, que es aproximadamente lo que un ratón se queda quieto sobre una tarjeta
  antes de decidir.
- **Los instantes**: repartidos por el intervalo `[10 %, 90 %]` de la duración —es decir,
  `d × {0.10, 0.30, 0.50, 0.70, 0.90}`— y **no** por `[0, d]`. Los extremos de un vídeo de
  móvil son casi siempre negro, la mano moviéndose o el suelo. El 10 % inicial también evita
  el fotograma en negro que muchos `.mp4` traen antes del primer keyframe.
- **Horizontal y no rejilla.** Una tira se anima con **una sola** coordenada
  (`background-position-x`); una rejilla necesita dos, y con ellas un `steps()` por eje. La
  vertical funcionaría igual, pero la horizontal es la convención de sprites y hace que
  `background-size: 500% 100%` se lea de un vistazo.
- **Cada fotograma a 320 × 180.** Es lo que ocupa la tarjeta más grande de las listas
  actuales sin llegar a ser un póster; el sprite completo mide entonces **1600 × 180**, muy
  por debajo de cualquier límite de dimensión de imagen.
- **Recorte a 16:9 con `object-fit: cover` hecho a mano en el `drawImage`**: los vídeos
  verticales de móvil (9:16) se recortan al centro. Es la misma decisión que ya toma la
  tarjeta con las fotos (`object-cover`, [`CardPhotoCarousel.tsx:89`](../apps/web/src/components/anuncios/CardPhotoCarousel.tsx#L89)).

### 2.3 El formato y el peso

**JPEG con calidad 0,7, y WebP si el navegador lo sabe emitir.**

`canvas.toBlob(cb, 'image/webp')` **no falla** en un navegador que no lo soporte: la
especificación dice que caiga a **PNG**, y un PNG de cinco fotogramas fotográficos pesaría
varios cientos de KB — el peor resultado posible, y silencioso. Así que el tipo **se
comprueba antes** (emitir un canvas de 1 × 1 y mirar el `type` del blob que sale) y si el
WebP no está disponible se pide `image/jpeg`, que **sí** está en todas partes.

Cálculo, para que el número de la auditoría («decenas de KB») deje de ser una intuición:

| | Por fotograma | Sprite (×5) |
|---|---|---|
| JPEG q0.7, 320 × 180 | ~6-9 KB | **~30-45 KB** |
| WebP q0.75, 320 × 180 | ~4-7 KB | **~20-35 KB** |

Como referencia: la foto de portada que **cada** tarjeta ya descarga hoy pesa del mismo
orden. **El sprite cuesta aproximadamente una foto más — y sólo en las tarjetas que alguien
llega a tocar** (§5.3).

`MIME_TO_EXT` ya contempla los dos tipos
([`media.service.ts:14-18`](../apps/api/src/modules/media/media.service.ts#L14)), así que la
extensión de la clave sale de un mapa que ya existe.

### 2.4 Qué se reutiliza y qué se añade en el cliente

`captureVideoPoster` **no se toca**: sigue haciendo lo suyo, y el póster fijo sigue
existiendo (es el fallback de todo este diseño, §3.4). Se añade al lado, en el mismo fichero:

- **`captureVideoSprite(file, { frames, width, height })`** — un `<video>` oculto, **un solo
  `<canvas>` del tamaño del sprite entero**, y un bucle que para cada instante hace
  `currentTime = t` → espera `onseeked` → `drawImage(video, i*w, 0, w, h)`. Al terminar, un
  único `toBlob`. Es literalmente `captureVideoPoster` con un bucle alrededor y un `drawImage`
  desplazado.
- **Devuelve `null` ante cualquier problema**, exactamente como `captureVideoPoster`
  ([`video.ts:145-148`](../apps/web/src/lib/api/video.ts#L145)): sin sprite se vive, con el
  póster fijo. Un vídeo que no se deja capturar **no puede impedir que se suba el vídeo**.
- **Un plazo máximo**. `captureVideoPoster` hace **un** `seek`; cinco `seek` encadenados
  sobre un fichero grande en un móvil viejo podrían no terminar nunca si el decodificador se
  atasca. Se acota (orden de 10 s en total) y al vencer se rinde con `null`. Es la única
  pieza de este diseño que no tiene precedente literal en el fichero, y por eso está escrita
  aquí.

---

## 3. El modelo

### 3.1 La columna

```
Listing.videoPreviewUrl  String?      // junto a videoUrl / videoPosterUrl / videoDurationSeconds
```

- **Un `String?` y no un `Json` con los metadatos del sprite.** El número de fotogramas y su
  geometría son **una constante del proyecto** (§2.2), no un dato por anuncio: si mañana se
  pasa a seis, se cambia la constante y los sprites viejos se siguen animando mal — no. **Se
  quedan quietos**: el fallback (§3.4) mira la columna, y un sprite de cinco animado como si
  fuera de seis es exactamente el tipo de dato que no debe poder existir. Ver la barrera B-6.
  Si algún día hicieran falta metadatos por fila, se añaden entonces; hoy serían una columna
  `Json` con el mismo valor repetido en todas las filas.
- **Nullable, sin `default`, aditiva.** Los vídeos ya subidos nacen con `null`, que es
  exactamente lo que significa: «este vídeo no tiene previsualización» (§3.4).
- **Junto a los otros cuatro y no en tabla aparte**, por el mismo motivo que ellos
  ([`schema.prisma:876-884`](../apps/api/prisma/schema.prisma#L876)): es un vídeo por anuncio.

### 3.2 El tercer objeto en R2

**Prefijo propio: `listing-previews/`.** Ni `media/` ni `listing-videos/`, y las dos
exclusiones son deliberadas:

- **No `listing-videos/`**, aunque el sprite «pertenezca» al vídeo. Ese prefijo es la
  dirección literal que el barrido e2e busca para dar por rota la garantía
  ([`video-visualizacion.e2e-spec.ts:121`](../apps/api/test/video-visualizacion.e2e-spec.ts#L121)).
  Meter ahí una imagen que **sí** debe viajar a las listas pondría el test en rojo por un
  motivo falso — y peor: invitaría a relajar el test, que es la garantía. **El prefijo es la
  frontera, y la frontera se respeta.**
- **No `media/`**, por H-1: ese prefijo lo puebla `POST /media/upload`, que crea fila y
  encola `sharp`. Un prefijo propio deja el sprite fuera de las dos cosas.
- Y un prefijo propio permite además una **regla de ciclo de vida** distinta si algún día
  hiciera falta, y hace que un `ls` del bucket sea legible.

La clave, con el mismo molde de dos tiempos que el vídeo:

```
firma  →  listing-previews/tmp/<listingId>/<uuid>.webp     (pendingPrefix, caduca solo)
confirma → listing-previews/<listingId>/<uuid>.webp
```

`pendingPrefix` ya existe y ya está pensado para esto
([`media-keys.ts:113-115`](../apps/api/src/infra/r2/media-keys.ts#L113)).

### 3.3 La limpieza — y las dos fugas que arrastra

**Este diseño no puede añadir un tercer objeto sin cerrar antes H-2.** Los tres sitios donde
hay que tocar:

| Camino | Hoy | Con el sprite |
|---|---|---|
| **Se borra el anuncio** (`deleteListing`) | `listingMediaKeys` incluye vídeo y póster ([`media-keys.ts:83-87`](../apps/api/src/infra/r2/media-keys.ts#L83)) | Añadir `videoPreviewUrl` a `ListingMediaRefs`. **Un solo lector**: el mismo sitio |
| **Se quita el vídeo** (`removeVideo`) | **Sólo borra el `.mp4`** — H-2 | Borrar los **tres** objetos. Se arregla el póster de paso |
| **Se sustituye el vídeo** (`confirmUpload`) | Borra el `.mp4` anterior ([`video.service.ts:234`](../apps/api/src/modules/video/video.service.ts#L234)) | Borrar también el póster y el sprite anteriores |

El gesto ya existe y es uno: `deleteObjectByUrl`
([`video.service.ts:327-333`](../apps/api/src/modules/video/video.service.ts#L327)), que
valida el origen antes de borrar y **no rompe nada si falla** («no dejar limpiar no debe
romper nada»). Lo que hay que evitar es escribirlo tres veces: la forma correcta es **una
lista de las URLs que un vídeo arrastra** —vídeo, póster, sprite— y un solo bucle sobre ella,
igual que `listingMediaKeys` hace para el anuncio entero.

> **Deuda que este diseño deja anotada y NO cierra:** la fila huérfana de `ListingImage` que
> deja cada póster (H-1) y su `-thumb.webp` no usado. El sprite **no** las produce, porque no
> pasa por `/media/upload`. Cerrarlas para el póster es otro cuerpo: hay que decidir si el
> póster fijo también se muda a `listing-previews/`, y eso obliga a migrar los que ya están.

### 3.4 Los vídeos ya subidos: **no se regeneran, y hay que decirlo así**

**No se pueden regenerar en el servidor.** No es una decisión: es que para capturar un
fotograma hay que **decodificar el vídeo**, y decodificar es exactamente lo que este proyecto
no tiene (`ffmpeg`, rechazado dos veces). Descargar el `.mp4` desde R2 no cambia nada: el
problema no es tener los bytes, es entenderlos.

**El fallback, y es el diseño entero de la migración:** `videoPreviewUrl = null` → la tarjeta
se comporta **exactamente como hoy** (foto de portada + `VideoIndicator`, sin hover). Nada
se rompe, nada se degrada, y el vendedor no ve un hueco.

Que ese fallback exista de todos modos —no sólo para los vídeos viejos— es lo que hace este
diseño seguro: **la captura del sprite puede fallar en cualquier navegador y en cualquier
momento** (§2.4), así que «sin sprite» tiene que ser un estado normal y bien pintado, no una
excepción.

Las tres formas de que un vídeo viejo acabe teniendo sprite, en orden de coste:

| | Cómo | Coste | ¿En este diseño? |
|---|---|---|---|
| **(i) Al volver a subir** | El vendedor sustituye su vídeo → el flujo nuevo captura el sprite | **Cero** — sale gratis | **Sí.** Es lo que pasa sin hacer nada |
| (ii) Botón «regenerar» en el editor | El navegador del vendedor descarga su `.mp4` desde R2 (`fetch` → `Blob`) y lo pasa por el mismo `captureVideoSprite` | **Hasta 50 MB de descarga** en el dispositivo del vendedor, que puede ser un móvil con datos | **No** en la primera ráfaga. Ver §10, P-2 |
| (iii) `ffmpeg` en el servidor | — | Reabre una decisión de arquitectura | **No** |

> La honestidad concreta: **con este diseño, el catálogo de vídeos existentes se queda sin
> previsualización, y se irá poblando sólo a medida que la gente vuelva a subir.** Si eso no
> se considera aceptable, la respuesta es (ii) y hay que decidirla como producto — no hay una
> tercera vía barata.

---

## 4. El flujo de subida, extendido

### 4.1 Lo que hay hoy

[`StepVideo.tsx:95-135`](../apps/web/src/components/publicar/steps/StepVideo.tsx#L95), en
cinco pasos:

```
1. validar el fichero (tipo, tamaño)          — cliente, barato, rechazo temprano
2. leer la duración real                       — cliente (readVideoFileInfo)
3. capturar el PÓSTER                          — cliente (captureVideoPoster)
4. FIRMAR → PUT del .mp4 a tmp/ → subir póster — red
5. CONFIRMAR                                   — el anuncio queda marcado
```

### 4.2 Lo que cambia

**Dos añadidos y ni un paso nuevo en la coreografía.**

```
3. capturar el póster  Y  capturar el SPRITE   ← (A) misma fase, mismo fichero ya en memoria
4. FIRMAR → PUT del .mp4 → subir póster
                       → subir el SPRITE       ← (B) por su propio camino prefirmado
5. CONFIRMAR (…, posterUrl, previewUrl)        ← el sprite viaja en el MISMO confirm
```

**(A) La captura va donde ya está la del póster**, y no es comodidad: es el único momento en
que el fichero está en memoria del navegador. Después de subir, el `File` sigue existiendo
en esa sesión, pero si el vendedor recarga ya no. **El sprite se captura antes de subir o no
se captura.**

Coste añadido para el vendedor: cinco `seek` sobre un fichero local, del orden de
**décimas de segundo a un par de segundos**. Va **antes** de `setFase('subiendo')`, donde ya
hay una espera sin barra — así que no añade ninguna pantalla nueva. Si tarda, se rinde
(§2.4) y se sigue.

**(B) La subida: un camino prefirmado propio, no `/media/upload`.**
Por H-1 (fila huérfana + `sharp`), y por simetría con el `.mp4`. Concretamente:

- **`POST /video/preview-url`** — mismo gate que `createUploadUrl` (**flag + Pro + anuncio
  propio y ACTIVE**), valida `contentType ∈ {image/webp, image/jpeg}` y un
  **`MAX_PREVIEW_BYTES`** propio, del orden de **512 KB**: es dos órdenes por debajo del
  límite de vídeo y uno por debajo del de fotos (10 MB), porque un sprite que pese más de
  eso es un sprite mal hecho. Firma contra `listing-previews/tmp/<listingId>/`.
- El **PUT** va directo a R2, con `putToStorage`, que ya existe
  ([`video.ts:188-215`](../apps/web/src/lib/api/video.ts#L188)).
- **La confirmación NO es un endpoint nuevo.** `ConfirmVideoDto` gana un `previewKey?`
  opcional, y `confirmUpload` hace con él **lo mismo que ya hace con el `.mp4`**: comprueba
  que la clave es la temporal **de este anuncio**, `HEAD` contra el almacenamiento, copia
  fuera de `tmp/`, valida `isOwnStorageUrl` y escribe la columna. Todo el razonamiento de
  [`video.service.ts:141-191`](../apps/api/src/modules/video/video.service.ts#L141) aplica
  palabra por palabra.

**Por qué el mismo `confirm` y no uno propio.** Porque el sprite **no tiene vida sin su
vídeo**: confirmar uno sin el otro produce un anuncio con previsualización y sin vídeo, que
no significa nada. Un solo `confirm` hace ese estado irrepresentable, exactamente como el
orden firmar→subir→confirmar hace irrepresentable el anuncio a medias
([`video.ts:14-16`](../apps/web/src/lib/api/video.ts#L14)).

**Y el sprite nunca puede tumbar la subida del vídeo.** Si la captura devuelve `null`, si la
firma falla o si el PUT del sprite se cae, `previewKey` viaja `undefined` y el vídeo se
confirma igual — con `videoPreviewUrl = null`, que es el estado normal de §3.4. La asimetría
es la misma que el póster ya tiene hoy: «sin póster se puede vivir; sin vídeo no»
([`video.ts:229-231`](../apps/web/src/lib/api/video.ts#L229)).

---

## 5. Cómo se muestra

### 5.1 Dónde entra en la tarjeta

Las superficies que pintan `VideoIndicator` hoy son **cuatro**: `CardPhotoCarousel` (las
listas y la búsqueda), `MyListingCard`, las dos del mapa y la tabla del backoffice.

**El hover entra SÓLO en `CardPhotoCarousel`.** Las demás no:

- **El mapa** (`MapCards`) — miniaturas de 56 px donde ni el texto del indicador cabe
  ([`VideoIndicator.tsx:27-32`](../apps/web/src/components/anuncios/VideoIndicator.tsx#L27)).
- **«Mis anuncios»** — es el panel del vendedor, no descubrimiento. Ya sabe lo que subió.
- **El backoffice** — es una tabla de texto, sin foto
  ([`VideoIndicator.tsx:34-46`](../apps/web/src/components/anuncios/VideoIndicator.tsx#L34)).

Es la misma lógica que llevó a extraer `VideoIndicator`: **una** pieza, usada donde tiene
sentido, en vez de cuatro copias.

### 5.2 El mecanismo, y por qué no `next/image`

Un `<div>` con `background-image` sobre la foto, **montado sólo al entrar el ratón**, con la
animación en CSS:

```
background-size: 500% 100%            /* cinco fotogramas de ancho */
animation: sprite 1.25s steps(5) infinite
@keyframes sprite { to { background-position-x: -500% } }
```

- **`steps(5)` y no una transición continua**: sin `steps()` el navegador interpolaría entre
  fotogramas y se vería un barrido, no una animación.
- **`background-image` y no `next/image`.** `next/image` está para redimensionar y servir
  formatos según el viewport; el sprite **ya viene en su tamaño final** y redimensionarlo
  rompería la aritmética del `background-size`. Es la misma excepción que ya se toma con el
  `<video src>` de la ficha — y por eso arrastra **la misma obligación**: una `url()` de CSS
  **no pasa por `remotePatterns`**, así que la URL se valida con **`isSafeSrc`**
  ([`image-domains.ts:6-17`](../apps/web/src/lib/image-domains.ts#L6)) antes de pintarla,
  exactamente como hace `ListingGallery`
  ([`ListingGallery.tsx:39-40`](../apps/web/src/components/anuncios/ListingGallery.tsx#L39)).
- **`@media (hover: hover) and (pointer: fine)`** envuelve la regla. Hoy **no hay ninguna
  detección de puntero en el proyecto** (verificado: cero coincidencias en `apps/web/src`),
  así que ésta es la primera y conviene que viva en **un solo sitio**.
- **`prefers-reduced-motion: reduce` la desactiva.** Una animación en bucle bajo el cursor es
  exactamente el caso que esa consulta existe para cubrir, y sale gratis: sin animación, el
  sprite se queda en su primer fotograma, que es una imagen perfectamente válida.

### 5.3 Lazy vs. payload: **las dos cosas, y no es una componenda**

La pregunta del encargo («¿viaja en el payload de lista o se pide en hover?») tiene una
respuesta que sólo se ve al separar **dos costes distintos**:

| | Coste de la URL en el JSON | Coste de los bytes de la imagen |
|---|---|---|
| URL en el payload + `<img>` siempre | ~100 B × 24 tarjetas ≈ **2,4 KB** | **~35 KB × 24 = 840 KB** ❌ |
| URL en el payload + **montar en hover** ✅ | ~2,4 KB | **~35 KB × las que se tocan** |
| Pedir la URL en hover (endpoint nuevo) | 0 | ~35 KB × las que se tocan, **+ una petición a la API por hover** ❌ |

**Una URL en un JSON no descarga nada.** Los bytes se piden cuando se monta el elemento que
la referencia.

**Y esto no hay que argumentarlo: ya está decidido, escrito y en producción en este mismo
proyecto, para este mismo problema.** El documento indexado lleva `images: string[]` —**todas**
las fotos del anuncio, no sólo la portada— y el porqué está escrito al lado, palabra por
palabra ([`search.service.ts:38-44`](../apps/api/src/modules/search/search.service.ts#L38)):

> *«cheap to carry in the payload (a URL is ~100 bytes vs. the image bytes themselves), and
> the frontend only ever mounts an `<Image>` for the one currently visible — so this does NOT
> mean the browser fetches every photo».*

Y el otro lado del mismo trato está en la tarjeta, que sólo monta el `<Image>` del índice
actual: *«la pereza sale gratis de renderizar por índice»*
([`CardPhotoCarousel.tsx:34-41`](../apps/web/src/components/anuncios/CardPhotoCarousel.tsx#L34)).

**El sprite es una URL más en ese mismo array de decisiones ya tomadas.** No inaugura un
patrón: usa el que la búsqueda lleva usando desde la ráfaga del carrusel.

**→ La URL viaja en el payload; el elemento se monta al entrar el ratón.** Se consigue el
peso de la opción perezosa **sin** una petición a la API por cada hover, que en una lista de
búsqueda serían decenas de peticiones para pasear el cursor.

Dónde hay que ponerla, y son **dos** sitios, porque las tarjetas salen de dos fuentes:

1. **`SELECT_SUMMARY` + `toSummary`** — el `select` y el mapeo
   ([`listing-summary.ts:64-145`](../apps/api/src/modules/listings/listing-summary.ts#L64)).
   Aquí `videoPreviewUrl` **sí sale** en el resultado, al contrario que `videoUrl` — y esa
   diferencia hay que dejarla escrita justo al lado de la desestructuración que existe para
   lo contrario, o el siguiente lector pensará que es un descuido.
2. **El documento de Meilisearch** — `toDocument` y el tipo del hit
   ([`search.service.ts:39-52`, `:787-790`](../apps/api/src/modules/search/search.service.ts#L787)).
   **Las tarjetas de búsqueda no pasan por Postgres**, así que sin esto la superficie de más
   tráfico sería la única sin previsualización. Exige **reindexar** — y el gesto ya está:
   `refrescarSuperficies` ([`video.service.ts:356-360`](../apps/api/src/modules/video/video.service.ts#L356)).

### 5.4 El móvil — **decisión de producto** (§10, P-1)

No hay hover en táctil. Las tres salidas, con su coste real:

| | Qué ve el móvil | Coste | Riesgo |
|---|---|---|---|
| **(b) El póster fijo — nada cambia** ✅ *recomendada* | Foto de portada + indicador, como hoy | **Cero bytes** | El beneficio Pro no lo ve la mitad del tráfico |
| (a) El sprite anima solo, siempre | La animación, sin tocar nada | **~35 KB × cada tarjeta** de la vista de más tráfico, en la red más cara | Es, en peso, lo que el diseño del vídeo se construyó para evitar |
| (c) Un toque lo activa | La animación, al pedirla | ~35 KB por toque | En una tarjeta que **es un enlace**, el primer toque ya navega. Habría que robarle el toque al enlace — o poner un botón, y entonces son dos toques para ver 1,25 s de animación |

**→ Recomendación: (b).** Tres razones, en orden de peso:

1. **(a) contradice el principio del propio diseño.** «No descargar media pesada en listas»
   no deja de aplicar porque el fichero sea un JPEG: 24 tarjetas × 35 KB son **840 KB** en
   una vista que hoy carga las fotos y poco más, y en móvil son datos de alguien.
2. **(c) choca con el gesto.** La tarjeta entera es un enlace al anuncio, y el indicador es
   `pointer-events-none` a propósito para no robarle el clic
   ([`CardPhotoCarousel.tsx:54-55`](../apps/web/src/components/anuncios/CardPhotoCarousel.tsx#L54)).
   Meter ahí un gesto de activación es pelearse con la interacción principal.
3. **El beneficio Pro en móvil ya existe, y es otro.** El vendedor Pro tiene en móvil el
   `VideoIndicator` en la lista **y el vídeo real, reproducible, en la ficha** —con
   `playsInline`, controles nativos y todo previsto (auditoría §2.2)—. La previsualización
   animada es **una mejora de descubrimiento en escritorio**, no *el* beneficio.

> **Lo que hay que decir en `/planes` si se elige (b).** La lista de beneficios se **deriva**,
> no se escribe a mano, y ya tiene su línea de vídeo, emitida **sólo si la feature está
> encendida** ([`billing.service.ts:1215-1228`](../apps/api/src/modules/billing/billing.service.ts#L1215)).
> Si se añade una línea de previsualización, tiene que decir **«en ordenador»** — y tiene que
> emitirse bajo la misma condición que la del vídeo, no bajo una nueva. Prometer a todo el
> mundo algo que la mitad del tráfico no ve es exactamente el tipo de línea que esa función
> entera vino a cerrar: *«lo que no se concede, no se promete»*
> ([`billing.service.ts:1215-1217`](../apps/api/src/modules/billing/billing.service.ts#L1215)).

**La puerta que (b) deja abierta:** elegir (b) hoy **no cierra** (a) ni (c) mañana. El
artefacto es el mismo, la columna es la misma y la URL ya viaja en el payload; lo único que
cambiaría es la consulta de medios que envuelve la regla CSS. Por eso la decisión del móvil
**no bloquea** este diseño: bloquea una línea de CSS.

---

## 6. La garantía, preservada

**La frase exacta, y conviene que sea exacta:**

> **La dirección del `.mp4` NUNCA viaja a una lista. La del sprite —que es una imagen— sí.**

Eso **no** debilita la garantía, y el motivo es el que la garantía siempre tuvo: no es «no
viajan URLs», es **«una tarjeta no puede descargar el vídeo»**
([`VideoIndicator.tsx:6-14`](../apps/web/src/components/anuncios/VideoIndicator.tsx#L6):
*«sin dirección no hay nada que descargar»*). Con el sprite, lo que la tarjeta puede
descargar sigue siendo **sólo imágenes**, y de un tamaño del orden de la foto que ya baja.

Tres cosas que hay que comprobar, no suponer:

1. **El barrido sigue verde tal cual está.** `expect(JSON.stringify(res.body)).not.toContain('listing-videos/')`
   ([`video-visualizacion.e2e-spec.ts:121`](../apps/api/test/video-visualizacion.e2e-spec.ts#L121))
   no se toca **ni una letra**: el sprite vive en `listing-previews/` (§3.2), así que un
   payload con previsualización **no contiene** la cadena buscada. Que el test siga escrito
   igual es la prueba de que la frontera del prefijo es real.
2. **Y hay que añadir el barrido simétrico**: que la tarjeta traiga
   `videoPreviewUrl` **y siga sin traer `videoUrl` ni `videoPosterUrl`**
   ([`video-visualizacion.e2e-spec.ts:105-109`](../apps/api/test/video-visualizacion.e2e-spec.ts#L105)).
   Sin él, el día que alguien añada `videoUrl: true` al `select` «ya que estamos», la única
   señal sería el barrido de cadena — que se puede esquivar sin querer con un prefijo
   distinto.
3. **El test unitario de la tarjeta sigue sin `<video>`.** El sprite es un `<div>` con
   `background-image`: no hay elemento de vídeo que montar, así que
   [`video-visualizacion.test.tsx`](../apps/web/src/components/anuncios/video-visualizacion.test.tsx)
   no cambia de premisa.

---

## 7. El gate Pro: **heredado, no nuevo**

**El sprite es parte del vídeo. Donde se ve el vídeo, se ve; donde no, no.** No hay un
segundo gate que mantener sincronizado, y ésa es la decisión.

En concreto:

- **Al subir** — `POST /video/preview-url` lleva `assertEnabled` + `assertPro` +
  `assertOwnActiveListing`, **los mismos tres** que `createUploadUrl`
  ([`video.service.ts:79-81`](../apps/api/src/modules/video/video.service.ts#L79)). No es
  celo: es que sin ellos, un no-Pro podría escribir objetos en el bucket por el camino nuevo
  aunque no pueda subir vídeo por el viejo.
- **Al servir** — `videoPreviewUrl` viaja **exactamente donde y cuando** viaja `hasVideo`. Si
  una superficie decide que un anuncio no muestra vídeo, tampoco muestra previsualización, y
  no porque alguien se acuerde: porque el sitio donde se decide es el mismo.

> **Nota honesta, y es importante que esté escrita.** D6 (el flag oculta los vídeos
> existentes) y D7 (al perder Pro el vídeo se oculta) están **decididos en
> [`diseno-video-pro.md`](./diseno-video-pro.md) y NO implementados en el camino de
> servicio**: verificado que `hasVideo` sale de `videoUrl != null` sin consultar ni el flag
> ni el estado Pro del vendedor
> ([`listing-summary.ts:139`](../apps/api/src/modules/listings/listing-summary.ts#L139) ·
> [`search.service.ts:790`](../apps/api/src/modules/search/search.service.ts#L790)); las
> únicas comprobaciones de Pro en el dominio de anuncios son las de estadísticas
> ([`listings.service.ts:1578`, `:1631`](../apps/api/src/modules/listings/listings.service.ts#L1578)).
>
> Eso significa que **hoy un ex-Pro conserva su vídeo visible**. El sprite hereda ese
> comportamiento — heredarlo es precisamente lo correcto: **el día que se implemente D6/D7 en
> un solo sitio, la previsualización se apagará con el vídeo sin tocar este diseño.** Lo que
> **no** hay que hacer es escribir aquí un gate Pro para el sprite que el vídeo no tiene: eso
> serían dos reglas divergentes y un ex-Pro con vídeo pero sin previsualización, un estado
> que no significa nada.

---

## 8. El plan — dos ráfagas

**Dos y no una.** No por tamaño, sino porque la frontera entre ellas es exactamente **la
decisión de producto pendiente** (§5.4): la primera es toda backend + captura y **no muestra
nada**; la segunda es sólo la tarjeta y depende de la respuesta de Ernest sobre el móvil.
Partir por ahí permite empezar sin esperar.

| | Qué entra | Por qué aquí | ¿Se ve algo? |
|---|---|---|---|
| **P1 · El artefacto y el dato** ✅ **HECHO** | Migración (`videoPreviewUrl`) · `MAX_PREVIEW_BYTES` y el prefijo en `video-limits.ts` · `captureVideoSprite` · `POST /video/preview-url` · `previewKey` en `confirmUpload` · **la limpieza de los tres objetos, con H-2 cerrado** · `StepVideo` captura y sube | Nada existe sin el dato. Y la **limpieza va con el objeto, no después**: un objeto que se crea antes de que exista quien lo borre es basura desde el primer día — el mismo criterio que puso los `Restrict` antes que cualquier borrado en C1 | **No.** El sprite se guarda y no lo pinta nadie |
| **P2 · El hover** ✅ **HECHO** | `videoPreviewUrl` en `SELECT_SUMMARY`/`toSummary` y en el documento de Meilisearch · el componente de hover en `CardPhotoCarousel` (con `isSafeSrc`, `hover:hover`, `prefers-reduced-motion`) · la línea de `/planes` | Se puede desarrollar contra sprites que P1 ya está generando. Y **es la ráfaga que la decisión del móvil condiciona** | **Sí** |

**El orden tiene una propiedad que conviene nombrar:** al acabar P1, cada vídeo nuevo ya trae
su sprite. Cuando P2 se despliegue, **no estrena con el catálogo vacío** — habrá tantas
previsualizaciones como vídeos se hayan subido entretanto. Es gratis, y sólo se consigue
partiendo en este orden.

**Y una corrección a la auditoría, verificada en `HEAD`: sus dos huecos de prioridad ya están
cerrados.** La auditoría recomendaba no hacer el hover todavía porque la feature «no se podía
ni encender» (§2.0) y «no se anunciaba en `/planes`» (§4.1). Las dos cosas se han arreglado
desde entonces:

- **`videoEnabled` está en la página de ajustes del backoffice**, con etiqueta, descripción y
  su propio control
  ([`ajustes/page.tsx:757`, `:812`, `:966`, `:1268`](../apps/web/src/app/(admin)/admin/ajustes/page.tsx#L757)).
- **`/planes` anuncia el vídeo**, y sólo si está encendido, con los 60 segundos leídos de
  `MAX_VIDEO_DURATION_SECONDS` en vez de escritos a mano
  ([`billing.service.ts:1215-1228`](../apps/api/src/modules/billing/billing.service.ts#L1215)).

**Es decir: el prerrequisito que la auditoría ponía por delante del hover ya no existe.** Esa
recomendación de prioridad —«el hover no es lo primero»— era correcta cuando se escribió y
**está cumplida**; no hay nada por delante de este diseño.

---

## 9. Las barreras

Lo que hay que poder afirmar en un test. Sin esto, el diseño es una intención.

| | Barrera | Qué mata |
|---|---|---|
| **B-1** | **El barrido, intacto**: el payload de lista de un anuncio **con** previsualización sigue sin contener `listing-videos/`. **Y la frontera comprobada en el origen** — ver la nota de abajo | Que el sprite se guarde bajo el prefijo de vídeo «porque es del vídeo» |
| **B-2** | **El barrido simétrico**: la tarjeta trae `videoPreviewUrl` y **sigue sin traer** `videoUrl` ni `videoPosterUrl` | Un `select` que se ensancha «ya que estamos» |
| **B-3** | **La limpieza de los tres**: quitar el vídeo, sustituirlo y borrar el anuncio dejan cero objetos suyos en el bucket — vídeo, póster **y** sprite | H-2, y que el tercer objeto la triplique |
| **B-4** | **El sprite no puede tumbar el vídeo**: con la captura fallando, con la firma fallando y con el PUT fallando, el vídeo se confirma igual y `videoPreviewUrl` queda `null` | Que una mejora opcional se vuelva un punto de fallo del camino que importa |
| **B-5** | **El gate del camino nuevo**: `POST /video/preview-url` rechaza a un no-Pro, con el flag apagado y sobre un anuncio ajeno — los **tres** | Una puerta trasera al bucket por el camino nuevo |
| **B-6** | **El fallback es un estado normal**: con `videoPreviewUrl = null` la tarjeta pinta exactamente lo de hoy (portada + indicador) y **no** intenta animar nada | Que los vídeos anteriores a P1 —que son todos— se vean rotos |
| **B-7** | **La confirmación rechaza una clave ajena**: un `previewKey` de otro anuncio da 400, igual que ya hace el `key` del vídeo | Confirmar en tu anuncio el objeto de otro |
| **B-8** | **El artefacto es una imagen fija**: el blob que sale de `captureVideoSprite` tiene el ancho de N fotogramas y un `type` de imagen | Que alguien «mejore» el artefacto a un formato animado y se lleve por delante el control del hover y la decisión del móvil |

**Mutaciones que deben poner algo en rojo:** guardar el sprite en `listing-videos/` → B-1 ·
añadir `videoUrl` al `select` de tarjeta → B-2 · dejar `removeVideo` como está hoy → B-3 ·
hacer que un fallo de captura aborte la subida → B-4 · omitir `assertPro` en el camino nuevo
→ B-5 · pintar el contenedor de animación sin comprobar la columna → B-6.

> **Corrección a B-1, aprendida ejecutando la mutación en P1.** El barrido de cadena **no
> caza** que el sprite se mude al prefijo de vídeo mientras la URL no viaje a ninguna lista —
> y en P1 no viaja: se pondría rojo en P2, cuando el objeto lleve ráfagas guardándose en el
> sitio equivocado. Así que B-1 tiene **dos mitades**: el barrido del payload (que en P2 es
> el que manda) y una comprobación sobre **lo que se guarda**, que muerde desde la ráfaga que
> crea el objeto. Una frontera que sólo se comprueba donde se enseña no es una frontera.

---

## 10. Lo que sigue siendo decisión de producto

Dos cosas, y ninguna se cierra con criterio técnico. El diseño **funciona con cualquiera de
las respuestas**; sólo hay que elegir.

| # | Decisión | Lo que aporta el diseño |
|---|---|---|
| **P-1** ✅ **CERRADA — (b)** | **El móvil: (a) anima siempre, (b) póster fijo, (c) un toque lo activa.** §5.4 | El coste medido de cada una (**(a) ≈ 840 KB por pantalla de búsqueda**), la recomendación **(b)** con sus tres razones, y el hecho de que **elegir (b) hoy no cierra (a) ni (c) mañana**: cambia una consulta de medios, no el modelo. **Implementada en P2** — la animación vive tras `@media (hover: hover) and (pointer: fine)`, y la tarjeta ni siquiera monta el sprite con un puntero táctil |
| **P-2** | **¿Se ofrece «regenerar previsualización» para los vídeos ya subidos?** §3.4 | Es la **única** vía honesta sin `ffmpeg`, y cuesta **hasta 50 MB de descarga en el dispositivo del vendedor**. Si no se ofrece, el catálogo existente se va poblando solo, a medida que la gente vuelve a subir. Recomendación: **no en P1** — decidirlo cuando se vea cuántos vídeos hay de verdad |

---

## Apéndice — el cimiento, y qué se apoya en cada pieza

| Qué usa el diseño | Dónde | Para qué |
|---|---|---|
| `captureVideoPoster` | [`video.ts:138-179`](../apps/web/src/lib/api/video.ts#L138) | El molde literal de `captureVideoSprite` (§2.4) |
| `readVideoFileInfo` | [`video.ts:96-125`](../apps/web/src/lib/api/video.ts#L96) | La duración sobre la que se reparten los instantes (§2.2) |
| `putToStorage` | [`video.ts:188-215`](../apps/web/src/lib/api/video.ts#L188) | El PUT del sprite, sin escribir nada nuevo (§4.2) |
| `createUploadUrl` / `confirmUpload` | [`video.service.ts:78-239`](../apps/api/src/modules/video/video.service.ts#L78) | El molde de `preview-url` y de `previewKey` (§4.2) |
| `pendingPrefix` / `isPendingKey` | [`media-keys.ts:103-120`](../apps/api/src/infra/r2/media-keys.ts#L103) | `listing-previews/tmp/` caduca solo (§3.2) |
| `listingMediaKeys` | [`media-keys.ts:70-90`](../apps/api/src/infra/r2/media-keys.ts#L70) | Un solo lector de «qué borra un anuncio» (§3.3) |
| `deleteObjectByUrl` | [`video.service.ts:327-333`](../apps/api/src/modules/video/video.service.ts#L327) | El borrado silencioso, ya razonado (§3.3) |
| `SELECT_SUMMARY` / `toSummary` | [`listing-summary.ts:64-145`](../apps/api/src/modules/listings/listing-summary.ts#L64) | Dónde entra `videoPreviewUrl` y por qué **sí** sale (§5.3) |
| `toDocument` y el tipo del hit | [`search.service.ts:38-52`, `:787-790`](../apps/api/src/modules/search/search.service.ts#L38) | La superficie de más tráfico no pasa por Postgres, y el precedente del payload (§5.3) |
| `buildProBenefits` | [`billing.service.ts:1182`, `:1215-1228`](../apps/api/src/modules/billing/billing.service.ts#L1182) | La línea de `/planes` se deriva; «lo que no se concede, no se promete» (§5.4) |
| `videoEnabled` en el backoffice | [`ajustes/page.tsx:757`, `:966`, `:1268`](../apps/web/src/app/(admin)/admin/ajustes/page.tsx#L757) | El prerrequisito de la auditoría, **ya cerrado** (§8) |
| `refrescarSuperficies` | [`video.service.ts:356-360`](../apps/api/src/modules/video/video.service.ts#L356) | Reindexar al cambiar el sprite (§5.3) |
| `isSafeSrc` | [`image-domains.ts:6-17`](../apps/web/src/lib/image-domains.ts#L6) | Una `url()` de CSS no pasa por `remotePatterns` (§5.2) |
| `CardPhotoCarousel` | [`CardPhotoCarousel.tsx:34-41`, `:78-105`](../apps/web/src/components/anuncios/CardPhotoCarousel.tsx#L34) | El contenedor del hover, y el precedente de la pereza (§5.1, §5.3) |
| `VideoIndicator` | [`VideoIndicator.tsx`](../apps/web/src/components/anuncios/VideoIndicator.tsx) | Qué superficies hay, y por qué sólo una lleva hover (§5.1) |
| El barrido e2e | [`video-visualizacion.e2e-spec.ts:105-122`](../apps/api/test/video-visualizacion.e2e-spec.ts#L105) | La garantía que no se toca (§6) |
| `MIME_TO_EXT` | [`media.service.ts:14-18`](../apps/api/src/modules/media/media.service.ts#L14) | Las extensiones de webp/jpeg, ya mapeadas (§2.3) |
| `ImageProcessor` | [`image.processor.ts:29-42`](../apps/api/src/infra/queue/processors/image.processor.ts#L29) | **Lo que hay que evitar**: `sharp` sobre el sprite (H-1) |
| El rechazo de `ffmpeg`, dos veces | [`video-limits.ts:21-29`](../apps/api/src/modules/video/video-limits.ts#L21) · [`video.ts:127-137`](../apps/web/src/lib/api/video.ts#L127) | Por qué no se regenera en servidor, y por qué tampoco un codificador en cliente (§2.1, §3.4) |
| D5 / D6 / D7 | [`diseno-video-pro.md`](./diseno-video-pro.md) | El principio que no se traiciona, y el gate que se hereda (§7) |
