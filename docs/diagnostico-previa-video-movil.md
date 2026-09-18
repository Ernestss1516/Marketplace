# Diagnóstico — LA PREVISUALIZACIÓN DE VÍDEO EN MÓVIL: el coste de cada disparador

> Fecha: 2026-09-18 · Rama: `main` · Commit medido: `fa632b5`
>
> **Qué es este documento.** Una MEDICIÓN del coste de las tres formas posibles de disparar
> la previsualización de vídeo en táctil. **Cero cambios de producción.** Los pesos son
> medidos, no estimados: se han generado sprites con la geometría exacta del código
> (`PREVIEW_FRAMES = 5`, 320×180, tira 1600×180, WebP q0.75) a partir de fotos reales de
> anuncios de este proyecto. Donde un número es un cálculo geométrico y no una medición en
> dispositivo, se dice.
>
> **El eje es el rendimiento**, porque lo fue de todo el diseño del vídeo. Ninguna opción
> que se propone aquí lo traiciona; lo que cambia entre ellas es **cuánto** cuestan y
> **cuándo**.

---

## 1. El estado actual, medido

### 1.1 Qué es el sprite y cuánto pesa DE VERDAD

Una sola imagen **fija**: cinco fotogramas del vídeo en una tira horizontal de 1600×180,
capturada por el navegador del vendedor al subir ([video.ts:168-182](../apps/web/src/lib/api/video.ts#L168-L182)). No es un GIF ni un WebP animado — `canvas.toBlob()` solo emite imágenes fijas, y la
animación la pone el CSS.

**Peso medido** (sprites construidos con la geometría del código sobre fotos reales del
proyecto, WebP q75 / JPEG q70 — el fallback cuando el navegador no sabe emitir WebP):

| Escenario del vídeo | WebP q75 | JPEG q70 |
|---|---|---|
| Un solo plano con paneo leve (lo habitual en un móvil) | **36,8 KB** | 45,5 KB |
| Dos planos | **33,3 KB** | 41,8 KB |
| Cinco planos distintos (peor caso) | **41,5 KB** | 48,6 KB |

**El sprite pesa 33-42 KB.** El rango «20-45 KB» que afirman los comentarios del código es
correcto en su extremo alto; el extremo bajo (20 KB) es optimista para fotografía de anuncio
real. **Para todos los cálculos de abajo se usa 37 KB**, la mediana medida.

El tope duro del servidor son 512 KB ([video-limits.ts:82](../apps/api/src/modules/video/video-limits.ts#L82)), así que hay un factor 12 de margen: el límite
no es lo que acota el coste, lo acota la geometría.

### 1.2 Con qué hay que comparar: lo que la tarjeta YA descarga

La foto de portada de cada tarjeta, servida por `next/image` con
`sizes="(max-width: 640px) 50vw, …"` ([card-shells.tsx:33](../apps/web/src/components/anuncios/card-shells.tsx#L33)) y la rejilla de 2 columnas de móvil
([ResultsList.tsx:57](../apps/web/src/components/busqueda/ResultsList.tsx#L57)). Con un viewport de 390 px, 50vw ≈ 195 px CSS; a DPR 2 el navegador pide
~390 px físicos y Next sirve el `deviceSize` inmediatamente superior, que con la
configuración por defecto (no hay `deviceSizes` propio en `next.config.ts`) es **640 px**.

| Lo que baja una tarjeta hoy en móvil | Peso medido |
|---|---|
| Portada a 640 px (DPR 2 — el caso normal en móvil) | **60,2 KB** |
| Portada a 384 px (DPR 1) | 23,5 KB |
| Portada a 256 px | 11,0 KB |
| **El sprite, si se descargara** | **~37 KB** |

**El dato que reordena la discusión: en un móvil moderno el sprite cuesta ~61 % de lo que ya
cuesta la portada de esa misma tarjeta.** No es un artefacto caro; es más barato que la foto
que ya se baja sin discusión. Lo que lo hace caro es **multiplicarlo por N**.

### 1.3 Cuándo se carga hoy — la pereza tiene DOS cerrojos

1. **JavaScript.** `CardPhotoCarousel` solo pone `previewActivo = true` en `onPointerEnter`
   **y únicamente si `e.pointerType === 'mouse'`** ([CardPhotoCarousel.tsx:115-117](../apps/web/src/components/anuncios/CardPhotoCarousel.tsx#L115-L117)). Mientras es
   `false`, `VideoHoverPreview` devuelve `null` ([VideoHoverPreview.tsx:46](../apps/web/src/components/anuncios/VideoHoverPreview.tsx#L46)): **el elemento no existe en
   el DOM**, así que no hay `background-image` que pedir.
2. **CSS.** La animación vive bajo `@media (hover: hover) and (pointer: fine)`
   ([globals.css:893-899](../apps/web/src/app/globals.css#L893)), y la capa nace con `opacity: 0`.

En **escritorio**: hasta que el ratón entra, cero peticiones. Al entrar, se monta la capa y
**en ese momento** el navegador pide el sprite (~37 KB) — o sea, la carga es *al hover*, no
al entrar en viewport. No vuelve a `false` al salir, a propósito: ya está en caché.

### 1.4 **Confirmado: en móvil hoy el sprite NI SE CARGA**

No es que esté cargado y quieto. Los dos cerrojos son independientes y el primero es
suficiente: con un dedo, `pointerType` vale `'touch'`, la guarda lo descarta, `previewActivo`
nunca pasa a `true`, el elemento nunca se monta. **Cero bytes de sprite en táctil hoy.**

Esto importa para el coste de las opciones: **cualquier disparador móvil parte de cero, así
que todo lo que añada es coste nuevo** — ninguna opción «aprovecha» algo ya descargado.

Lo único que sí viaja hoy a móvil es la **URL** del sprite dentro del JSON de la tarjeta
(~100 bytes), que es exactamente el mismo trato que `images[]` ya recibe.

### 1.5 Cuánta superficie hay: cuántas tarjetas se ven a la vez

Cálculo geométrico (no medición en dispositivo), con viewport de 390×844 y la rejilla real
`grid-cols-2 gap-3`:

| | |
|---|---|
| Ancho de columna | (390 − 32 de margen − 12 de gap) / 2 ≈ **173 px** |
| Alto de la media (`aspect-square`) | 173 px |
| Alto del contenido (`p-3` + título 2 líneas + precio + atributos + ubicación) | ≈ 120 px |
| **Paso vertical por fila** | **≈ 305 px** |
| Alto útil de pantalla (descontando la barra del navegador) | ≈ 740 px |
| **Filas tocando el viewport** | **2 completas + 1 parcial → 6 tarjetas** |
| Resultados por página | **24** ([search-query.dto.ts:195](../apps/api/src/modules/search/dto/search-query.dto.ts#L195)) |

**6 tarjetas simultáneas, 24 por página.**

### 1.6 El caso que no es hipotético: el filtro «solo con vídeo»

El filtro `conVideo` existe y está en producción ([search.service.ts:662](../apps/api/src/modules/search/search.service.ts#L662), `/busqueda`). **Cuando
está activo, el 100 % de las tarjetas de la página tiene vídeo.** Cualquier cálculo que
suponga «solo una fracción tendrá sprite» deja de valer justo en la pantalla donde el vídeo
más se mira. Todas las tablas de abajo incluyen esa columna.

---

## 2. Las tres opciones, con sus números

Base de cálculo: sprite = 37 KB · 6 tarjetas visibles · 24 por página · animación de 1,25 s
con `steps(5)` → **4 cambios de fotograma por segundo y capa**.

Nota técnica que afecta a las tres: `background-position` **no es una propiedad compositable**
(no es `transform` ni `opacity`), así que cada paso de la animación provoca un **repaint** de
esa capa en el hilo principal. `steps(5)` es lo que hace que sean 4 repaints/s y no 60: la
animación es discreta, no continua. Es la diferencia entre «barato» y «caro» y ya está
resuelta en el CSS de hoy.

### OPCIÓN A — al entrar en viewport (se anima sola al ser visible)

| Medida | Valor |
|---|---|
| Peso al abrir la página (sin scroll) | 6 × 37 KB = **222 KB** |
| Peso al recorrer la página entera, 25 % con vídeo | 6 × 37 = **222 KB** |
| Peso al recorrer la página entera, **filtro «solo con vídeo»** | 24 × 37 = **888 KB** |
| Sprites animando a la vez | **hasta 6** |
| Repaints/s | 6 × 4 = **24/s**, regiones de 173×173 CSS (≈346×346 físicos a DPR 2) |
| Riesgo de jank en scroll | **Alto.** Los repaints caen en el hilo principal justo mientras el usuario hace scroll, que es cuando compiten con él |
| ¿Respeta el lazy-load actual? | **No lo respeta: lo sustituye.** Hoy la pereza sale gratis del `onPointerEnter`; esto exige añadir un `IntersectionObserver` que hoy **no existe** en el componente |
| Coste de implementación | Medio (observer nuevo + política de desmontaje) |

**El número que decide:** +888 KB en la pantalla del filtro de vídeo, sobre los ~1,4 MB de
portadas que esa misma página ya baja. Es un **+60 % de peso de página** para una animación
que nadie ha pedido. Y arranca **durante** el scroll.

### OPCIÓN B — al tocar (un gesto explícito)

| Medida | Valor |
|---|---|
| Peso al abrir la página | **0 KB** |
| Peso tras un toque | **37 KB** (uno) |
| Peso al recorrer la página entera sin tocar nada | **0 KB**, con filtro de vídeo o sin él |
| Sprites animando a la vez | **1** (o 2-3 si el usuario toca varias y no se desmontan) |
| Repaints/s | **4/s**, una sola región |
| Riesgo de jank en scroll | **Nulo**: el gesto y el scroll no coinciden |
| ¿Respeta el lazy-load actual? | **Lo conserva íntegro.** Es el mismo mecanismo de hoy (`previewActivo`) con otro disparador |
| Coste de implementación | **Bajo**: el estado ya existe; hace falta un objetivo tocable y un selector CSS que no dependa de `hover` |

**El número que decide:** el coste por defecto es **cero**, y el del caso de uso es **un
sprite**. En la pantalla del filtro «solo con vídeo», A cuesta 888 KB y B cuesta 37 KB por
cada vídeo que el usuario decide mirar. Son **24 veces menos** para el mismo recorrido.

### OPCIÓN C — siempre animado en móvil

| Medida | Valor |
|---|---|
| Peso al abrir la página, 25 % con vídeo | 6 × 37 KB = **222 KB**, compitiendo con las portadas de la carga inicial |
| Peso de la página entera, **filtro «solo con vídeo»** | 24 × 37 = **888 KB**, y **sin pereza**: se piden aunque el usuario no baje |
| Sprites animando a la vez | **hasta 24** (los de fuera de pantalla siguen vivos en el motor de animación) |
| Repaints/s | Hasta **96/s** repartidos, de los cuales ~24/s visibles |
| Riesgo de jank en scroll | **Muy alto**, y además daña la carga inicial: los sprites compiten por conexiones con las portadas *above the fold* |
| ¿Respeta el lazy-load actual? | **Lo elimina** |
| Coste de implementación | Bajo (borrar el media query) — y ése es justo el peligro: es la más fácil de escribir y la más cara de ejecutar |

**El número que decide:** es la única opción que empeora la métrica que más importa en una
lista — el tiempo hasta ver la primera pantalla —, porque mete 222-888 KB **antes** de que el
usuario haya pedido nada.

### Variante A-limitada (viewport, pero solo 1-2 animando)

Merece mencionarse porque suena a punto medio, y **no lo es del todo**:

- Limitar cuántas **animan** a la vez baja los repaints (4-8/s en vez de 24/s), pero **no baja
  el peso**: si el disparador sigue siendo «entrar en viewport», las 24 tarjetas de la página
  acaban descargando su sprite igual al pasar por pantalla. Siguen siendo **888 KB** en el
  peor caso.
- Para que bajara el peso habría que disparar solo sobre la tarjeta **más centrada** y con
  *debounce* (no cargar nada mientras el scroll se mueve). Eso ya es un mecanismo con estado,
  temporizadores y política de desmontaje: **más complejo que la opción B y todavía más caro
  en bytes**, porque un usuario que recorre la lista despacio carga sprites que nunca miró.

---

## 3. Recomendación: **OPCIÓN B (toque explícito)**

| | A (viewport) | **B (tap)** | C (siempre) |
|---|---|---|---|
| Peso por defecto | 222 KB | **0 KB** | 222-888 KB |
| Peor caso (filtro de vídeo) | 888 KB | **37 KB × los que se tocan** | 888 KB |
| Animaciones simultáneas | 6 | **1** | hasta 24 |
| Jank en scroll | Alto | **Nulo** | Muy alto |
| Conserva la pereza actual | No | **Sí** | No |
| Coste de implementación | Medio | **Bajo** | Bajo |

Es la única que cumple las dos cosas a la vez: **el vídeo se anuncia en móvil** (hoy no se
anuncia en absoluto más allá del icono) y **el rendimiento no se toca** — porque el coste
solo aparece cuando el usuario lo pide, que es exactamente el principio que ya gobierna el
carrusel de fotos («solo se monta un `<Image>` a la vez, el de `index`») y el hover de
escritorio.

**Una nota sobre el razonamiento que hay hoy en el CSS.** El comentario de
[globals.css:882-892](../apps/web/src/app/globals.css#L882) justifica descartar el táctil así: *«el móvil vería la animación arrancar al
tocar la tarjeta — que es justo lo que la decisión de producto (b) descarta, porque supondría
bajar el sprite en CADA tarjeta de la vista de más tráfico»*. **Ese razonamiento vale para un
`:hover` a secas, que en táctil se queda pegado tras cualquier toque — no para un disparador
deliberado.** Un `:hover` pegajoso se dispara al tocar *cualquier parte* de *cualquier*
tarjeta; un botón propio se dispara solo donde se toca. La conclusión de entonces era correcta
para el mecanismo de entonces; con un objetivo tocable acotado, el «cada tarjeta» no ocurre.
El propio comentario dejó la puerta abierta: *«cambiar de idea es cambiar ESTA consulta, no el
modelo»*.

**Si Ernest prefiere descubrimiento pasivo** (que el usuario vea el movimiento sin tocar), la
opción es A **con tope de peso**, no A a secas: disparar solo sobre la tarjeta más centrada,
con debounce de scroll y un máximo de 2 sprites por sesión de scroll. Cuesta ~74 KB por
pantalla en vez de 888 KB por página, pero es el triple de código que B y sigue gastando bytes
que el usuario no pidió.

---

## 4. El affordance: cómo sabe el usuario que puede tocar

**El indicador ya existe y ya dice lo correcto.** `VideoIndicator` pinta una píldora negra con
un icono de *play* y la palabra «Vídeo», abajo a la derecha de la foto
([VideoIndicator.tsx](../apps/web/src/components/anuncios/VideoIndicator.tsx)). Un icono de play sobre una imagen es, en un teléfono, la invitación a tocar
más reconocible que existe. No hay que inventar un affordance: hay que **hacerlo real**.

Tres cosas a tener en cuenta (medidas, no opinadas):

1. **Hoy es `pointer-events-none` a propósito**, para no robarle el clic a la tarjeta, que es
   un `<Link>` completo. Convertirlo en objetivo tocable significa quitarle eso **solo a él**.
2. **El molde de «un control dentro del enlace» ya está resuelto en el mismo fichero.** Las
   flechas y los puntos del carrusel hacen `e.preventDefault(); e.stopPropagation()` dentro
   del `<Link>` ([CardPhotoCarousel.tsx:96-106](../apps/web/src/components/anuncios/CardPhotoCarousel.tsx#L96-L106)), y `FavoriteCardButton` vive en el mismo sitio. No
   hay mecanismo nuevo que inventar.
3. **El tamaño del objetivo.** La píldora mide ~52×20 px, por debajo de los 44×44 px
   recomendados para táctil. Habría que agrandar el área tocable (padding invisible) sin
   agrandar la píldora visible — o el gesto fallará justo en el dispositivo para el que se
   hace.

Un detalle de producto, no de rendimiento: conviene decidir si el segundo toque **cierra** la
previsualización o **navega** al anuncio. Lo primero es más predecible; lo segundo ahorra un
toque. No hay diferencia de coste entre ambas.

---

## 5. La garantía se mantiene — con cualquiera de las tres

Esto hay que decirlo explícitamente porque es la pregunta que el encargo hace, y la respuesta
es **sí, y por construcción, no por disciplina**:

| | |
|---|---|
| Lo que llega a la tarjeta | `hasVideo: boolean` + `videoPreviewUrl: string \| null` |
| Lo que **NO** llega | `videoUrl` — la dirección del `.mp4` |
| Dónde se garantiza | El tipo de `CardPhotoCarousel` recibe un booleano, nunca la URL ([CardPhotoCarousel.tsx:18-26](../apps/web/src/components/anuncios/CardPhotoCarousel.tsx#L18-L26)); el documento de Meilisearch se construye con `hasVideo: listing.videoUrl != null` y **no incluye `videoUrl`** ([search.service.ts:807](../apps/api/src/modules/search/search.service.ts#L807)); `listing-summary.ts` selecciona `videoUrl` **solo para derivar el booleano** y no lo emite ([listing-summary.ts:92,162](../apps/api/src/modules/listings/listing-summary.ts#L92)) |
| Qué es el sprite | Una **imagen fija** de 33-42 KB, en un prefijo distinto del vídeo (`listing-previews/` vs `listing-videos/`), pintada como `background-image` de un `<div>` |
| Por qué eso basta | **Con una imagen no se puede montar un reproductor.** No hay `<video>`, ni `preload`, ni metadatos, ni un solo byte de `.mp4` — cambiar el disparador no cambia nada de esto |

El disparador decide **cuándo se pide una imagen**. No toca el contrato de datos, no toca el
documento indexado y no acerca la URL del vídeo a la tarjeta. La separación de prefijos está
puesta precisamente para que el e2e que busca `listing-videos/` en el tráfico de las listas
siga siendo la prueba válida de la garantía ([video-limits.ts:56-71](../apps/api/src/modules/video/video-limits.ts#L56-L71)).

**Lo único a vigilar si se implementa B:** el sprite se sirve como `background-image` con la
URL de almacenamiento directa — **no pasa por `next/image`**, así que su única restricción de
dominio es el `isSafeSrc` que `VideoHoverPreview` ya aplica ([VideoHoverPreview.tsx:46](../apps/web/src/components/anuncios/VideoHoverPreview.tsx#L46)). Esa
comprobación debe seguir en el camino táctil; es la misma línea, y basta con no saltársela.

---

## 6. Lo que decide Ernest

1. **¿Qué disparador?** → recomendado **B (toque)**. A y C cuestan 222-888 KB por página; B
   cuesta 0 por defecto y 37 KB por vídeo mirado.
2. **¿Segundo toque cierra o navega?** → sin impacto de rendimiento; recomendado **cerrar**.
3. **¿Se agranda el área tocable del indicador?** → hay que hacerlo (hoy ~52×20 px), o el
   gesto falla en el dispositivo objetivo.
4. **¿Se quiere descubrimiento pasivo?** → solo entonces vale la pena A-con-tope, y con los
   números delante: ~74 KB por pantalla y el triple de código.

Ninguna de estas decisiones toca el modelo de datos, el documento indexado ni el contrato de
la tarjeta. Todo el cambio, en cualquiera de las variantes, cabe en `CardPhotoCarousel`,
`VideoHoverPreview`, `VideoIndicator` y el bloque `.sprite-hover` de `globals.css`.

---

## Anexo — cómo se midieron los pesos

Script de solo lectura, ejecutado fuera del proyecto (scratchpad), con el `sharp` que ya
tiene `apps/api`. Reproduce la geometría exacta de
[`captureVideoSprite`](../apps/web/src/lib/api/video.ts#L236): 5 fotogramas de 320×180 compuestos en una tira de 1600×180, codificada en
WebP q75 y JPEG q70 — los mismos parámetros que el `canvas.toBlob()` del navegador
([video.ts:316-320](../apps/web/src/lib/api/video.ts#L316-L320)).

Material: fotos reales de anuncios de este proyecto, tomadas de `apps/web/.next/cache/images`
(12 candidatas de ≥400×300, entre 1080×1080 y 1920×2880). Tres escenarios —un plano con paneo,
dos planos, cinco planos distintos— para acotar el rango en vez de dar un único número.

Limitación honesta: el codificador de `sharp` es libwebp, el mismo que usa Chrome, pero no es
*bit-a-bit* el mismo camino que `canvas.toBlob()`. Y las fotos de anuncio tienen más detalle
que un fotograma de vídeo comprimido, así que **37 KB es una banda alta-realista**, no un
suelo. Los números de tarjetas visibles (§1.5) son cálculo geométrico sobre la rejilla real,
no medición en un dispositivo; una comprobación en un teléfono real los confirmaría o los
movería en ±1 tarjeta, sin cambiar ninguna conclusión.
