# Auditoría — VÍDEO PRO (proyecto 3)

**Tipo:** superficies y rendimiento. Inventaría dónde vive un anuncio hoy, **propone** el
tratamiento del vídeo en cada sitio con el rendimiento como eje, mapea la infraestructura
que falta y saca a la superficie las decisiones. **No diseña, no implementa y no decide.**

Verificado contra `main` (`c69bc08`). Donde se afirma que algo **no existe**, se indica la
búsqueda que lo respalda.

---

## Resumen ejecutivo

Tres cosas que cambian la forma del proyecto y conviene leer antes que nada:

**1. Ya hay vídeo en el producto, pero es de otra especie.** Existe un bloque `video` en el
CMS ([VideoBlockRenderer.tsx](../apps/web/src/components/blocks/VideoBlockRenderer.tsx)) y es un **embed de YouTube/Vimeo**: guarda `{provider, videoId}`, nunca un fichero. Cero
almacenamiento, cero transcodificación, cero pósters — los pone el proveedor. Eso convierte
«embed vs fichero propio» en **la decisión de mayor coste de todo el proyecto** (D2), y no
estaba en el guion.

**2. El anuncio se pinta en trece superficies, y once son listas.** Reproducir vídeo en una
lista es exactamente el riesgo que se pide evitar; la buena noticia es que **once de las
trece comparten un único componente de media** ([CardPhotoCarousel](../apps/web/src/components/anuncios/CardPhotoCarousel.tsx)), así que el tratamiento de listas se decide y se implementa en un sitio, no en once.

**3. La infraestructura de imágenes se reusa casi entera, salvo dos piezas que no existen y
son las caras:** el **póster** (un frame del vídeo, sin el cual las listas no pueden mostrar
nada) y la **transcodificación**. No hay `ffmpeg` en el proyecto — solo `sharp`, que es de
imágenes ([package.json:64](../apps/api/package.json#L64)).

---

# A. INVENTARIO DE SUPERFICIES

## A.1 — El mapa

Trece superficies. La columna que decide el tratamiento es **lista vs. singular**.

| # | Superficie | Fichero:línea | Lista/Singular | Datos | Caché |
|---|---|---|---|---|---|
| 1 | Resultados de búsqueda | [busqueda/page.tsx](../apps/web/src/app/(public)/busqueda/page.tsx) | **Lista** | Meilisearch | — |
| 2 | Listado de categoría | [CategoryListingPage.tsx](../apps/web/src/components/categorias/CategoryListingPage.tsx) | **Lista** | Meilisearch | — |
| 3 | Destacados de búsqueda | [FeaturedBlock.tsx:23](../apps/web/src/components/busqueda/FeaturedBlock.tsx#L23) | **Lista** | Meilisearch | — |
| 4 | Patrocinado | [SponsoredCard.tsx](../apps/web/src/components/anuncios/SponsoredCard.tsx) | **Lista** (1 ítem) | Postgres | Redis por categoría |
| 5 | Perfil de vendedor | [vendedor/[slug]/page.tsx:156](../apps/web/src/app/(public)/vendedor/[slug]/page.tsx#L156) | **Lista** | API | SSR |
| 6 | Favoritos | [FavoritosClient.tsx:64](../apps/web/src/app/(account)/favoritos/FavoritosClient.tsx#L64) | **Lista** | API | cliente |
| 7 | Portada — bloque `listings` | [ListingsHomeBlockRenderer.tsx](../apps/web/src/components/home/blocks/ListingsHomeBlockRenderer.tsx) | **Lista** | API | ISR |
| 8 | Portada — carrusel de categoría | [CategoryCarouselHomeBlockRenderer.tsx](../apps/web/src/components/home/blocks/CategoryCarouselHomeBlockRenderer.tsx) | **Lista** | API | ISR |
| 9 | Blog y páginas — bloque `listings` | [BlockRenderer.tsx:62](../apps/web/src/components/blocks/BlockRenderer.tsx#L62) → [ListingsBlockRenderer.tsx](../apps/web/src/components/blocks/ListingsBlockRenderer.tsx) | **Lista** | API | ISR |
| 10 | Mis anuncios (propietario) | [MyListingCard.tsx](../apps/web/src/components/anuncios/MyListingCard.tsx) | **Lista** | API propietario | — |
| 11 | Relacionados en la ficha | [anuncio/[slug]/page.tsx](../apps/web/src/app/(public)/anuncio/[slug]/page.tsx) | **Lista** | API | ISR |
| 12 | **La ficha** | [anuncio/[slug]/page.tsx:154](../apps/web/src/app/(public)/anuncio/[slug]/page.tsx#L154) | **SINGULAR** | API | **Redis 5 min** |
| 13 | El editor (crear/editar) | [EditarForm.tsx](../apps/web/src/components/publicar/EditarForm.tsx), [StepFotos.tsx](../apps/web/src/components/publicar/steps/StepFotos.tsx) | **SINGULAR** | cliente | — |

**Once listas contra dos singulares.** Ese desequilibrio es el proyecto entero: el vídeo se
*consume* en una superficie y se *insinúa* en once.

## A.2 — Solo hay dos componentes de media, y eso lo simplifica todo

**En listas — `CardPhotoCarousel`** ([CardPhotoCarousel.tsx](../apps/web/src/components/anuncios/CardPhotoCarousel.tsx)). Lo usan `ListingCard` ([:37-49](../apps/web/src/components/anuncios/ListingCard.tsx#L37)) y `ListingCardWide`, que a su vez cubren las superficies 1-11. Recibe `images: string[]` ([:9](../apps/web/src/components/anuncios/CardPhotoCarousel.tsx#L9)), pinta **una sola a la vez** ([:77](../apps/web/src/components/anuncios/CardPhotoCarousel.tsx#L77)) y solo la primera de la primera tarjeta lleva `priority` ([:82](../apps/web/src/components/anuncios/CardPhotoCarousel.tsx#L82)); el resto va lazy por defecto de `next/image`.

Las fotos se resuelven en un helper compartido ([listing-card-shared.tsx:76-77](../apps/web/src/components/anuncios/listing-card-shared.tsx#L76)): `images` si vienen de Meilisearch, si no `thumbnailUrl`.

**En la ficha — `ListingGallery`** ([ListingGallery.tsx](../apps/web/src/components/anuncios/ListingGallery.tsx)). Imagen principal con `priority` ([:33](../apps/web/src/components/anuncios/ListingGallery.tsx#L33)) y miniaturas debajo. Ya usa `aspect-video` ([:26](../apps/web/src/components/anuncios/ListingGallery.tsx#L26)) — el hueco tiene la proporción de un vídeo.

**Consecuencia para el diseño:** el tratamiento de listas se toca en **un** componente. El de
la ficha, en otro. Dos ficheros gobiernan trece superficies.

## A.3 — El vídeo que YA existe (y que no es este)

Bloque `video` del CMS — [blocks.ts:71-75](../apps/web/src/types/blocks.ts#L71), [VideoBlockRenderer.tsx](../apps/web/src/components/blocks/VideoBlockRenderer.tsx), editor en [VideoBlockEditor.tsx](../apps/web/src/app/(admin)/admin/blog/_components/block-editor/editors/VideoBlockEditor.tsx).

Guarda `{provider: 'youtube'|'vimeo', videoId}` y construye el `src` del iframe a partir de
esos dos campos, nunca de una URL cruda — decisión de seguridad ya escrita en el propio
fichero. **Es contenido editorial del administrador, no del vendedor**, y **no sube ficheros**.

Por qué importa: demuestra que el proyecto ya sabe mostrar vídeo sin almacenar ni transcodificar
nada. Si el vídeo Pro pudiera ser un embed, gran parte de la sección C desaparecería. Eso es
**D2**, y es la decisión que más dinero y tiempo mueve.

## A.4 — El seam que UXV.5 dejó escrito

[EditarForm.tsx:74-78](../apps/web/src/components/publicar/EditarForm.tsx#L74), literalmente: *«`proStatus` ENTRA AQUÍ Y HOY NO CAMBIA NADA, y es deliberado: es el seam por el que el VÍDEO PRO (proyecto 3) añadirá su sección gateada … la sección siempre presente y el gate dentro con el molde de `EstadisticasClient` (card punteada + Lock + "Hazte Pro")»*.

`resolveEditSections(data, proStatus)` ([:80-89](../apps/web/src/components/publicar/EditarForm.tsx#L80)) ya recibe el parámetro, con su `eslint-disable` marcando que espera uso. El gate Pro de referencia está en [EstadisticasClient.tsx:63,115](../apps/web/src/components/anuncios/EstadisticasClient.tsx#L63).

---

# B. TRATAMIENTO POR SUPERFICIE (propuesta)

**El criterio, en una frase:** en una lista **nunca se descarga un byte de vídeo**; se muestra
como mucho una imagen y un icono. El vídeo solo se carga donde el usuario ha ido a verlo.

## B.1 — Las once listas: **póster + indicador, y el vídeo NUNCA**

| Qué se muestra | Cuándo se carga |
|---|---|
| La foto de portada de siempre, **más un icono de «tiene vídeo»** | El icono no carga nada; la foto sigue lazy como hoy |

**La razón de rendimiento, con números del propio repo:** una página de resultados pinta del
orden de 20-40 tarjetas. Las imágenes ya están acotadas —el procesador las redimensiona a 800 px
webp con calidad 82 ([image.processor.ts:30-32](../apps/api/src/infra/queue/processors/image.processor.ts#L30))— y aun así solo la primera lleva `priority`. Un vídeo web modesto pesa **uno o dos órdenes de magnitud más** que una de esas imágenes. Reproducir, precargar o siquiera montar 20 elementos `<video>` con `preload="metadata"` significa 20 conexiones extra antes de que el usuario decida nada.

**Y hay un motivo de producto además del técnico:** una lista compara anuncios. Veinte vídeos
sonando o moviéndose no ayudan a comparar; estorban.

**Variante descartada — `poster` real del vídeo en vez de la foto.** Sustituir la portada por
un frame del vídeo no aporta (sigue siendo una imagen) y sí quita control al vendedor sobre su
mejor foto. El póster hace falta, pero **para la ficha** (§B.2), no para las listas.

**Variante a considerar, no recomendada de entrada — reproducción al pasar el ratón.** Da
sensación de riqueza, pero: no existe en móvil (que es donde más se navega), dispara descargas
por accidente al mover el cursor, y obliga a cargar vídeo en la superficie donde se decidió no
cargarlo. Si se quiere, debería ser una decisión posterior y medida, no de salida.

**Coste de implementación: un componente.** El indicador entra en `CardPhotoCarousel` y las
once superficies lo heredan. Lo que sí hay que propagar es **el dato** «este anuncio tiene
vídeo» hasta cada lista — ver §E.3, porque no es gratis.

## B.2 — La ficha (#12): **el vídeo reproducible, pero solo cuando se pulsa**

| Qué se muestra | Cuándo se carga |
|---|---|
| El vídeo como una pieza más de la galería, con su póster visible y un botón de play | **`preload="none"`**: al pulsar play, no antes |

**La razón:** aquí hay **un** anuncio y el usuario ha llegado a propósito. Pero «un vídeo» no
es «cargar el vídeo al abrir»: la ficha es la página de SEO y de conversión, y meterle
megabytes antes de que nadie pulse nada penalizaría a todos los visitantes —la mayoría, que
solo miran fotos— para servir a los pocos que quieren vídeo.

Con `preload="none"` + póster, el coste de tener vídeo en la ficha es **una imagen más**.

**Dónde encaja:** `ListingGallery` ya usa `aspect-video` ([:26](../apps/web/src/components/anuncios/ListingGallery.tsx#L26)) y ya tiene tira de miniaturas. El vídeo es una miniatura más con su icono; al elegirla, el visor principal cambia de `<Image>` a `<video>`. No hay que reestructurar la galería.

**Cuestión abierta que el diseño debe resolver:** si el vídeo va **primero** o **después** de
las fotos. Primero le da protagonismo (y es el beneficio Pro que se vende); después respeta que
la foto de portada es lo que el vendedor eligió como mejor imagen.

## B.3 — El editor (#13): **póster + reproducción bajo demanda, y el gate Pro visible**

| Qué se muestra | Cuándo se carga |
|---|---|
| Sección propia, con el vídeo ya subido (póster + play) y su dropzone | Igual que en la ficha: `preload="none"` |

Molde de subida: `StepFotos` ([StepFotos.tsx](../apps/web/src/components/publicar/steps/StepFotos.tsx)) con su estado `uploading` por elemento, que la validación de secciones ya vigila ([EditarForm.tsx:118-121](../apps/web/src/components/publicar/EditarForm.tsx#L118)) — un vídeo a medio subir debe bloquear el guardado igual que una foto.

**El gate se ve, no se esconde** (molde `EstadisticasClient`, y lo que el propio seam propone):
la sección existe también para un no-Pro, con la tarjeta punteada y «Hazte Pro». Esconderla
haría invisible el beneficio justo a quien hay que convencer — y es la misma lección de UXV.6
(un beneficio que no se ve no vende) y de UXV.3 (un bloqueo sin razón visible es un callejón).

**Aviso de rendimiento propio del editor:** subir vídeo desde móvil con datos es lento y falla
más que subir fotos. El diseño necesita progreso visible, poder cancelar, y un mensaje honesto
cuando el fichero excede el límite **antes** de empezar a subirlo.

## B.4 — El bloque `listings` del CMS (#9) y la portada (#7, #8)

Mismo tratamiento que el resto de listas, **con una nota**: son superficies **ISR cacheadas**
que el administrador compone. Si en el futuro alguien quisiera un bloque de portada que sí
reproduzca vídeo, sería una decisión aparte y con su propia medición; no se propone aquí.

---

# C. LA INFRAESTRUCTURA

## C.1 — Lo que se reusa tal cual

| Pieza | Dónde | Nota |
|---|---|---|
| Almacenamiento S3/R2 | [media.service.ts:34](../apps/api/src/modules/media/media.service.ts#L34) (`r2.upload`) | El vídeo va al mismo bucket |
| Endpoint de subida | [media.controller.ts](../apps/api/src/modules/media/media.controller.ts) | Molde de `FileInterceptor` con `limits` y `fileFilter` |
| Cola para trabajo pesado | [queue.constants.ts](../apps/api/src/infra/queue/queue.constants.ts) + [image.processor.ts](../apps/api/src/infra/queue/processors/image.processor.ts) | El molde exacto de «subir → encolar → procesar» |
| Allowlist de dominios | [image-domains.ts](../apps/web/src/lib/image-domains.ts) | `localhost` y `*.r2.cloudflarestorage.com`. **Ojo:** es de `next/image`; un `<video>` no pasa por ahí (§E.4) |
| Flag de admin | [bump-schedule.service.ts:12](../apps/api/src/modules/bump-schedule/bump-schedule.service.ts#L12) + whitelist en [admin.service.ts](../apps/api/src/modules/admin/admin.service.ts) | Molde booleano recién estrenado |
| Gate Pro | [EstadisticasClient.tsx:63,115](../apps/web/src/components/anuncios/EstadisticasClient.tsx#L63) | Y el seam de [EditarForm.tsx:83](../apps/web/src/components/publicar/EditarForm.tsx#L83) |
| Lista de beneficios | [billing.service.ts:1057-1074](../apps/api/src/modules/billing/billing.service.ts#L1057) | Requisito 3 — ver §C.4 |

## C.2 — Lo que NO existe y hay que construir

| Pieza | Estado | Por qué es cara |
|---|---|---|
| **Modelo de datos del vídeo** | **NO EXISTE** | `ListingImage` ([schema.prisma](../apps/api/prisma/schema.prisma)) no sirve: no tiene duración, ni póster, ni estado de procesado. Tabla nueva o campos en `Listing` |
| **Póster (frame del vídeo)** | **NO EXISTE** | Sin él no hay nada que enseñar antes de reproducir. Requiere extraer un frame |
| **Transcodificación** | **NO EXISTE** | No hay `ffmpeg` en el repo (verificado en `apps/api/package.json`: solo `sharp`) |
| **Límites de vídeo** | **NO EXISTE** | Hoy el tope es 10 MB para todo ([media.service.ts:17](../apps/api/src/modules/media/media.service.ts#L17)) y los MIME permitidos son solo JPEG/PNG/WebP ([:11-13](../apps/api/src/modules/media/media.service.ts#L11)) |
| **Entrega progresiva** | **NO EXISTE** | Ver §C.3 |
| **Estado de procesado** | **NO EXISTE** | Un vídeo recién subido no está listo; la interfaz necesita saberlo |
| **Propagación de «tiene vídeo» a las listas** | **NO EXISTE** | Ver §E.3 |

## C.3 — La entrega, que es donde se pierden los proyectos de vídeo

Hoy un fichero se sirve **directo desde el bucket** por su URL pública (`S3_PUBLIC_URL`,
[configuration.ts:55](../apps/api/src/config/configuration.ts#L55)). Para imágenes está bien. Para vídeo, lo que decide si se puede saltar al minuto 0:30 sin descargar todo es el soporte de **peticiones por rango** (`Range`): R2 y S3 lo soportan de forma nativa, MinIO también. Es decir: **la reproducción progresiva funcionaría sin infraestructura nueva**, siempre que el fichero esté bien formado.

**El matiz que sí importa y conviene medir, no suponer:** un MP4 solo permite empezar a
reproducir antes de descargarlo entero si sus metadatos (`moov`) están **al principio** del
fichero. Muchos móviles los dejan al final. Eso se arregla en la transcodificación —o con un
paso barato de reordenado— y es un argumento fuerte a favor de D2(b).

**Lo que NO hace falta de entrada:** HLS/DASH, streaming adaptativo o un CDN de vídeo. Para
un vídeo corto por anuncio, un MP4 bien formado servido por rango es suficiente. Sobredimensionar
aquí sería el error caro.

## C.4 — El requisito 3: el vídeo en la lista de beneficios Pro

`buildProBenefits` ([billing.service.ts:1057-1074](../apps/api/src/modules/billing/billing.service.ts#L1057)) ya tiene la forma correcta: cada línea se emite **solo si el ajuste la concede** (`if (destacados > 0)`, `if (pro > libres)`). La línea del vídeo encaja como `if (videoEnabled) beneficios.push(...)`, con lo que **el flag de admin y la lista de beneficios quedan atados por construcción**: apagar la feature la retira de `/planes` sin tocar nada más.

Es exactamente la lección de la ráfaga `fix-planes` (`9f8abe2`): no afirmar un beneficio que la
configuración puede desmentir. Aquí se aplica sola si se sigue el molde.

---

# D. DECISIONES DE DISEÑO — propuestas, NO tomadas

## D1 — Límites: tamaño, duración, formato

| Opción | A favor | En contra |
|---|---|---|
| **(a) Estricta**: ≤60 s, ≤50 MB, solo MP4/H.264 | Coste acotado y predecible; casi todo móvil graba así | Rechaza ficheros que el usuario considera válidos |
| (b) Media: ≤3 min, ≤200 MB, MP4/WebM/MOV | Cabe casi todo | 20× el coste de almacenamiento por anuncio |
| (c) Laxa | Nadie se queja | Coste sin techo; un vendedor puede subir 1 GB |

**Referencia:** hoy el tope global es **10 MB** ([media.service.ts:17](../apps/api/src/modules/media/media.service.ts#L17)) y los MIME son solo de imagen ([:11-13](../apps/api/src/modules/media/media.service.ts#L11)); ambos hay que separar por tipo, no ampliar en bloque —subir el tope general a 200 MB dejaría también las fotos sin protección.

**Lo que conviene tener en cuenta al decidir:** el usuario habló de *«un vídeo corto»*, y en un
marketplace C2C el vídeo útil es enseñar el objeto —30-60 segundos—. El límite **de duración**
protege más que el de tamaño, porque acota también el tiempo de subida desde móvil.

## D2 — Fichero propio o **embed** *(la decisión de mayor coste)*

Esta no estaba en el guion y la abre el hallazgo de §A.3.

| Opción | A favor | En contra |
|---|---|---|
| **(a) Fichero propio (subida a R2)** | Control total; sin marca ajena; el vendedor no necesita cuenta en ningún sitio; es lo que sugiere «subir un vídeo» | Todo lo de §C.2: póster, transcodificación, límites, estado, coste de almacenamiento y ancho de banda |
| (b) Embed YouTube/Vimeo | **Coste de infraestructura ≈ 0**: el proveedor da almacenamiento, transcodificación, póster, entrega adaptativa y CDN. El repo ya tiene el molde funcionando | Exige que el vendedor tenga cuenta y suba allí —fricción enorme para un particular—; marca y «vídeos relacionados» de terceros en tu ficha; dependencia externa |
| (c) Fichero propio ahora, embed como extra | Cubre a todos | Dos caminos que mantener |

**Sin recomendación**, porque es de producto y no técnica: (b) es incomparablemente más barato
de construir y (a) es incomparablemente mejor para el vendedor particular, que es el usuario de
este marketplace. Merece decidirse a conciencia y no por inercia.

## D3 — Transcodificación

| Opción | A favor | En contra |
|---|---|---|
| (a) Aceptar tal cual | Nada que construir | Pesos y formatos dispares; MP4 con metadatos al final = reproducción no progresiva (§C.3); un MOV de iPhone puede no reproducirse en todos los navegadores |
| **(b) Transcodificar a un perfil web único** (cola BullMQ + ffmpeg) | Un solo formato predecible; peso acotado de verdad; arregla lo de §C.3; **da el póster gratis en el mismo paso** | Dependencia nueva (`ffmpeg`), CPU, y un estado «procesando» que la interfaz debe contar |
| (c) Solo remuxear (mover metadatos al principio) | Barato; arregla la reproducción progresiva | No acota peso ni normaliza formato |

**Dato a favor de (b):** el molde ya existe y está probado — subir → encolar → procesar es
exactamente lo que hace [image.processor.ts](../apps/api/src/infra/queue/processors/image.processor.ts) con `sharp`. Cambiaría la herramienta, no la arquitectura. Y **el póster sale del mismo comando**, así que (b) resuelve D3 y D4 a la vez.

## D4 — El póster

| Opción | A favor | En contra |
|---|---|---|
| **(a) Generado en el backend** (frame del vídeo, mismo paso que D3(b)) | Automático, siempre existe, consistente | Atado a tener ffmpeg |
| (b) Extraído en el cliente al subir (`<canvas>`) | Sin ffmpeg | Depende del navegador; se puede manipular; no funciona si la subida se reintenta desde otro sitio |
| (c) Lo sube el usuario | Control editorial | Un paso más en un flujo que ya tiene fotos |
| (d) Sin póster: solo un icono | Nada que construir | La ficha enseñaría un rectángulo negro |

**Nota:** si el tratamiento de listas es «foto de portada + icono» (§B.1), el póster **solo hace
falta para la ficha y el editor**. Eso baja su urgencia, pero no lo elimina: un `<video>` sin
`poster` es un hueco negro.

## D5 — Uno o varios vídeos

**Uno** encaja con lo dicho por el usuario y con todo lo demás: un solo indicador en la tarjeta,
un solo póster, un solo coste. Varios multiplicarían almacenamiento y obligarían a decidir
orden y galería de vídeos. **Opciones:** (a) exactamente uno, reemplazable · (b) hasta N.

Si se elige (a), conviene además decidir **dónde vive el dato**: campos en `Listing` (más simple,
una relación menos) o tabla propia (más limpia si algún día son varios).

## D6 — En listas: póster, indicador o nada

Ya propuesto en §B.1: **foto de siempre + indicador**. Las alternativas —póster en lugar de la
portada, reproducción al pasar el ratón, o nada en absoluto— quedan descritas allí con su
contrapartida. La decisión es de Ernest; la recomendación técnica es no descargar vídeo en
listas **bajo ningún tratamiento**.

## D7 — Qué apaga exactamente el flag de admin

El requisito 1 fija que existe. Lo que hay que decidir es su alcance:

| Opción | A favor | En contra |
|---|---|---|
| (a) Solo impide subir nuevos | Menos destructivo | Los vídeos ya subidos siguen consumiendo ancho de banda; si se apaga por un problema de costes, no lo resuelve |
| **(b) Oculta la opción Y los vídeos existentes** | Interruptor de verdad: apagar detiene el gasto y la superficie | Un vendedor ve desaparecer su vídeo sin haber hecho nada |
| (c) Oculta en listas pero deja la ficha | A medias | Estado intermedio difícil de explicar |

**Precedente que conviene mirar:** el flag del bump automático se decidió como «detiene el cron
pero **no toca** las programaciones» — apagar no destruye configuración de usuarios. Aplicado
aquí, (b) **oculta** pero no borra, que es la lectura coherente con ese precedente.

## D8 — Dónde se comprueba el gate Pro

**No es una sola comprobación, son tres**, y conviene decidirlas juntas:

1. **Subir** — en el backend, al recibir el fichero. Es la que de verdad protege: esconder el botón no impide un POST directo. Mismo criterio que el guard `ALREADY_SUBSCRIBED` de UXV.6.
2. **Ver el editor** — el seam de [EditarForm.tsx:83](../apps/web/src/components/publicar/EditarForm.tsx#L83), con el molde de `EstadisticasClient`.
3. **Mostrar en la ficha** — que enlaza directamente con D9.

## D9 — Qué pasa con el vídeo si el vendedor deja de ser Pro

| Opción | A favor | En contra |
|---|---|---|
| (a) Se mantiene visible | Amable; nada se pierde | El beneficio Pro deja de ser un beneficio: se paga un mes y se conserva para siempre |
| **(b) Se oculta, se conserva** | Coherente con «es un beneficio Pro»; vuelve solo al resuscribirse; nada se destruye | Ocupa almacenamiento de alguien que ya no paga |
| (c) Se borra al expirar | Coste cero | Destruye contenido del usuario por dejar de pagar; irreversible |

**Precedente del repo:** los destacados caducan con la suscripción vía `EntitlementService`, y
las programaciones de bump **se pausan, no se borran**. (b) es la que sigue esa línea. Si se
elige, queda una sub-decisión: **avisar** al vendedor de que su vídeo ha dejado de verse —el
canal de notificación existe y el silencio es justo lo que UXV.3 vino a cerrar.

---

# E. RENDIMIENTO Y RIESGOS

## E.1 — Vídeo en listas 🔴 *el riesgo central*

**Cómo lo evita la propuesta:** en listas no se descarga vídeo de ninguna forma. Ni `<video>`,
ni `preload="metadata"`, ni póster que sustituya a la portada. Solo un icono, que es CSS.

**Lo que hay que vigilar en la implementación**, porque es donde se cuela el problema: montar un
`<video>` oculto «por si acaso», usar el póster del vídeo como imagen de tarjeta creyendo que es
gratis (es una imagen más que descargar, distinta de la que ya está en caché), o añadir
reproducción al pasar el ratón «solo en escritorio».

## E.2 — Almacenamiento y ancho de banda

Un anuncio con fotos ronda las decenas de KB por imagen tras el procesado ([image.processor.ts:30-32](../apps/api/src/infra/queue/processors/image.processor.ts#L30)). Un vídeo de 60 s a calidad web razonable ronda los 5-15 MB: **dos órdenes de magnitud**.

El coste no está en guardarlo, está en **servirlo**: si un anuncio popular con vídeo recibe
muchas visitas y el vídeo se cargara solo, el ancho de banda se multiplica. `preload="none"`
(§B.2) es lo que convierte ese coste en proporcional a quien *quiere* ver el vídeo.

**Riesgo de coste que el diseño debería acotar:** sin límite por usuario, N anuncios Pro × M
megabytes es una factura que crece sin techo. Un tope de vídeos activos por vendedor —o el
propio límite de anuncios activos, que ya existe— lo acota.

## E.3 — Propagar «tiene vídeo» hasta las listas *(el trabajo escondido)*

Las tarjetas de las superficies 1, 2 y 3 **no vienen de Postgres: vienen de Meilisearch**. Su
documento incluye hoy `thumbnailUrl` e `images` ([search.service.ts:34,39,515-517](../apps/api/src/modules/search/search.service.ts#L34)) precisamente para que la tarjeta se pinte sin consultar la base ([apps/api/CLAUDE.md](../apps/api/CLAUDE.md)).

Añadir el indicador exige **un campo más en el documento indexado** y, por tanto, un
**reindexado** — hay comando (`pnpm reindex`). No es difícil, pero es trabajo real que no se ve
al planificar y que atraviesa backend, índice y front.

Las superficies 5-11 vienen de la API y necesitan el campo en su payload; la 10 es la de
propietario. **Ninguna lo tiene hoy.**

## E.4 — La ficha está cacheada, y el `<video>` no pasa por `next/image`

Dos avisos distintos sobre la misma superficie:

**La caché.** La ficha se guarda entera en Redis 5 minutos ([listings.service.ts:65,871](../apps/api/src/modules/listings/listings.service.ts#L65)). Si la URL del vídeo viaja en ese blob, un vídeo recién subido —o recién ocultado por D7/D9— tarda hasta 5 minutos en reflejarse, salvo invalidación explícita. El molde existe: `bump` invalida `listingCacheKey(slug)` por esta misma razón. **Es una línea, pero hay que acordarse de ella.**

**La allowlist.** `remotePatterns` ([image-domains.ts:1-4](../apps/web/src/lib/image-domains.ts#L1)) protege `next/image`; un `<video src>` **no pasa por ahí**. La comprobación equivalente para vídeo tendría que hacerse a mano —`isSafeSrc` ([:6-17](../apps/web/src/lib/image-domains.ts#L6)) ya existe y sirve— o quedará sin la protección que las imágenes sí tienen.

## E.5 — Riesgos menores, anotados

- **Estado «procesando»**: si se transcodifica (D3(b)), hay un lapso en que el vídeo existe pero no se puede ver. La interfaz tiene que contarlo, o parecerá que se perdió.
- **Subida desde móvil**: ficheros grandes por red móvil fallan. Sin progreso visible ni reintento, el usuario cree que la web está rota.
- **Accesibilidad y reproducción automática**: si algún día se reproduce algo solo, debe ser mudo y respetar `prefers-reduced-motion`. Mejor no abrir esa puerta.
- **SEO**: la ficha es la página que posiciona. Un vídeo puede sumar (`VideoObject` en datos estructurados), pero solo si no penaliza la carga — otra razón para `preload="none"`.

---

## Para el diseño: qué decidir primero

1. **D2 (fichero propio o embed)** condiciona toda la sección C. Si sale embed, D1, D3, D4 y buena parte de E desaparecen.
2. **D3 (transcodificación)** decide si entra `ffmpeg`, y **resuelve D4 de paso**.
3. **D1 (límites)** fija el coste y depende de las dos anteriores.
4. El resto (D5-D9) afina, pero no bloquea la arquitectura.

## Alcance de esta auditoría

Todo lo verificable se verificó contra el código. Donde se afirma que algo **no existe**
—`ffmpeg`, modelo de vídeo, póster, transcodificación, límites de vídeo, el campo «tiene vídeo»
en el documento de Meilisearch y en los payloads— se indicó la búsqueda concreta que lo
respalda.

Las trece superficies salen de rastrear los usos reales de los componentes de tarjeta y de
galería, no de una lista de memoria. Las decisiones de la sección D están **propuestas, no
tomadas**; donde se ha señalado que una opción encaja mejor con el repo (D4, D7, D9) se ha
dicho con qué precedente, y en **D2 se ha evitado recomendar a propósito** porque es una
decisión de producto con implicaciones de coste que corresponde tomar a Ernest.
