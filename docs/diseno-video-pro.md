# Diseño — VÍDEO PRO (proyecto 3)

Documento **aprobable**, no implementación. Base:
[`auditoria-video-pro.md`](auditoria-video-pro.md). Moldes verificados contra `main` (`8f24948`).

**D2 está tomada: FICHERO PROPIO.** El vendedor sube el vídeo; no es un embed. Eso activa
todo lo que el embed habría evaporado —límites, póster, transcodificación, entrega— y es lo
que hace que este proyecto tenga una sección de infraestructura de verdad.

Dos entregables: la **arquitectura**, y **8 decisiones con recomendación** para confirmar en
bloque (§ [Hoja de confirmación](#hoja-de-confirmación)).

---

## Principio rector

> **El vídeo se sube una vez y se ve en un sitio. En los otros doce, es un icono.**

Todo lo caro —peso, procesado, ancho de banda— se concentra en dos momentos: la subida y la
reproducción en la ficha. Las once listas no descargan **ni un byte** de vídeo, y esa no es
una optimización que se añade luego: es la forma del diseño.

---

# ENTREGABLE 1 — ARQUITECTURA

## A. La infraestructura

### A.1 — La subida: el fichero NO pasa por la memoria del API

**Hallazgo que condiciona el diseño.** El endpoint de imágenes usa `memoryStorage()`
([media.controller.ts:30](../apps/api/src/modules/media/media.controller.ts#L30)): el fichero entero vive en RAM del proceso mientras se sube. Con imágenes de ≤10 MB ([media.service.ts:17](../apps/api/src/modules/media/media.service.ts#L17)) es inocuo. Con vídeos de decenas de megas **no**: diez vendedores subiendo a la vez son cientos de megas de RAM en el proceso que además atiende toda la API.

**Propuesta: subida DIRECTA del navegador a R2 con URL prefirmada.**

1. El navegador pide permiso al API: tipo, tamaño y duración del fichero.
2. El API valida (Pro + flag + límites), reserva la fila y devuelve una **URL prefirmada** de subida y la clave del objeto.
3. El navegador sube **directamente a R2**. El API nunca ve los bytes.
4. Al terminar, el navegador confirma; el API marca el vídeo como listo y encola lo que haya que encolar.

**Qué gana:** el API deja de ser el cuello de botella y de la memoria; se puede mostrar progreso
real de subida; y un fallo a mitad no deja el proceso hinchado. **Qué cuesta:** el cliente de S3
ya está (`@aws-sdk/client-s3`, [package.json:33](../apps/api/package.json#L33)) pero **falta el paquete de firmado** (`@aws-sdk/s3-request-presigner` — verificado que no está) y `R2Service` solo expone `upload`/`download`/`delete` ([r2.service.ts:33-51](../apps/api/src/infra/r2/r2.service.ts#L33)): hay que añadirle un método de firma.

**Alternativa si se prefiere no tocar eso:** mantener el paso por el API pero con
almacenamiento **en disco** en vez de memoria. Es un cambio de una línea en el interceptor y
elimina el problema de RAM, a cambio de duplicar el tránsito (navegador→API→R2) y de no poder
dar progreso fino. Es la opción conservadora, y sirve.

**Lo que NO se debe hacer:** subir el límite de `MAX_FILE_SIZE` para que quepa vídeo. Ese
número protege también a las fotos, y ampliarlo en bloque las dejaría sin techo. Los límites de
vídeo van **por separado** (D1).

### A.2 — El póster, que es lo que permite no cargar vídeo

Sin póster, un `<video>` es un rectángulo negro. Con póster, la ficha muestra una imagen y el
usuario decide si quiere los megabytes.

**Propuesta: lo captura el CLIENTE al subir** (D3). El navegador ya tiene el fichero en local:
puede pintar un frame en un `<canvas>` y subir ese JPEG como una imagen más, por el camino de
imágenes que ya existe y funciona.

**Por qué no en el backend:** extraer un frame exige `ffmpeg`, y `ffmpeg` es exactamente la
dependencia que este diseño intenta no traer (§A.3). Si la transcodificación se descarta, traer
ffmpeg **solo** para el póster sería pagar el 90% del coste para el 10% del beneficio.

**El riesgo honesto de hacerlo en el cliente:** el póster viaja como un fichero más, así que un
cliente manipulado podría subir una imagen que no corresponde al vídeo. **No es grave** —es la
misma capacidad que ya tiene para subir cualquier foto engañosa a su anuncio, y lo cubre la
moderación—, pero conviene que quede dicho y no descubierto luego.

**Respaldo:** si la captura falla (formato que el navegador no decodifica), se guarda sin póster
y la ficha usa la **foto de portada del anuncio** como `poster`. Nunca un rectángulo negro.

### A.3 — Transcodificación: **no**, y con el argumento por delante

Es la decisión de más coste del proyecto, así que va razonada y no despachada.

**Qué compraría transcodificar:** un formato único, peso acotado de verdad, orientación
normalizada, y los metadatos `moov` al principio del fichero —que es lo que permite empezar a
reproducir sin descargarlo entero—.

**Qué costaría:** `ffmpeg` como dependencia del despliegue (no es un paquete npm cualquiera: es
un binario), CPU sostenida, una cola y un processor nuevos, un estado «procesando» que la
interfaz debe contar, y el doble de almacenamiento mientras conviven original y resultado.

**Por qué se puede evitar:** con límites estrictos (D1) el problema que la transcodificación
resuelve casi desaparece. **Un móvil actual graba MP4/H.264/AAC**, que es exactamente el
formato que todos los navegadores reproducen. Aceptando solo eso, con tope de duración y
tamaño, lo que llega ya es reproducible sin tocarlo.

**Lo que queda sin resolver, y hay que decirlo:** el asunto de los metadatos al final del
fichero (§C.3 de la auditoría). Un MP4 así **se reproduce igual**, pero el navegador puede
necesitar descargar más antes de empezar. Con vídeos cortos y acotados el efecto es de segundos,
no de minutos.

**Recomendación: empezar SIN transcodificación**, con límites estrictos, y **medir**. Si aparece
el problema —vídeos que tardan en arrancar—, la respuesta más barata no es transcodificar todo:
es un paso de **remuxeo** que solo mueve los metadatos al principio, mucho más ligero. Y el
molde para añadirlo existe y está probado: subir → encolar → procesar es literalmente lo que
hace [image.processor.ts](../apps/api/src/infra/queue/processors/image.processor.ts) con `sharp` ([:23-45](../apps/api/src/infra/queue/processors/image.processor.ts#L23)); cambiaría la herramienta, no la arquitectura.

Es el mismo criterio con el que se calibró `INDEXING_CONCURRENCY`: **se midió, no se supuso.**

### A.4 — La entrega y la protección de dominio

**Entrega:** directa desde R2 por su URL pública (`S3_PUBLIC_URL`, [configuration.ts:55](../apps/api/src/config/configuration.ts#L55)), igual que las imágenes. R2 soporta peticiones por rango de forma nativa, así que la reproducción progresiva y el salto en la barra funcionan **sin infraestructura nueva**. No hace falta HLS, DASH ni un CDN de vídeo: sobredimensionar aquí sería el error caro.

**Protección de dominio — el agujero que la auditoría destapó.** `remotePatterns`
([image-domains.ts:1-4](../apps/web/src/lib/image-domains.ts#L1)) protege `next/image`; un `<video src>` **no pasa por ahí**. Sin hacer nada, el vídeo sería la única media del producto sin restricción de origen.

**Propuesta:** la URL del vídeo se valida con `isSafeSrc` ([image-domains.ts:6-17](../apps/web/src/lib/image-domains.ts#L6)) —que ya existe y hace exactamente esto— **antes de renderizar el `<video>`**, y también en el backend al guardarla. Dos comprobaciones, no una: la del backend es la que protege, la del front evita pintar basura si algo se coló antes.

## B. Las tres superficies

### B.1 — Edición: la sección que UXV.5 dejó preparada

El seam está **escrito** en [EditarForm.tsx:74-78](../apps/web/src/components/publicar/EditarForm.tsx#L74): *«es el seam por el que el VÍDEO PRO (proyecto 3) añadirá su sección gateada … la sección siempre presente y el gate dentro con el molde de `EstadisticasClient`»*. `resolveEditSections(data, proStatus)` ([:80-89](../apps/web/src/components/publicar/EditarForm.tsx#L80)) ya recibe `proStatus` con un `eslint-disable` marcando que espera uso.

**La sección existe para todos; el gate va dentro.** Un no-Pro ve la tarjeta punteada con
candado y «Hazte Pro» (molde [EstadisticasClient.tsx:115](../apps/web/src/components/anuncios/EstadisticasClient.tsx#L115)). Esconderla haría invisible el beneficio justo a quien hay que convencer — la lección de UXV.6.

**Con el flag apagado, la sección no existe** para nadie, ni siquiera Pro. Distinto del gate
Pro: el gate *vende*, el flag *desactiva*.

**Validación de sección:** un vídeo a medio subir debe bloquear el guardado, igual que ya lo
hace una foto ([EditarForm.tsx:118-121](../apps/web/src/components/publicar/EditarForm.tsx#L118)). **Feedback:** toast al terminar (canal único de UXV.3); errores de validación inline, junto al campo.

### B.2 — Listas: cero bytes, y cómo se garantiza

Las once superficies pasan por **un** componente: `CardPhotoCarousel`
([CardPhotoCarousel.tsx](../apps/web/src/components/anuncios/CardPhotoCarousel.tsx)), usado por `ListingCard` ([:37-49](../apps/web/src/components/anuncios/ListingCard.tsx#L37)) y `ListingCardWide`.

**Qué se añade:** un icono sobre la foto de portada cuando `hasVideo` es cierto. Nada más.

**Cómo se garantiza el cero bytes** —y esto es lo que hay que poder verificar, no prometer:

1. La tarjeta recibe **un booleano**, no una URL. Si el dato que llega no incluye la dirección del vídeo, no hay forma de descargarlo aunque alguien lo intente por descuido.
2. Ningún elemento `<video>` se monta en el árbol de una lista.
3. El icono es un SVG del bundle, no una petición.

**El punto 1 es el que hace la garantía estructural en vez de disciplinaria**, y por eso el
campo que viaja a las listas debe ser `hasVideo: boolean` y no `videoUrl`. Una prueba puede
afirmar que el payload de lista no contiene la URL, y esa prueba no se puede saltar por
descuido.

### B.3 — Ficha: reproducible, pero solo si se pulsa

`ListingGallery` ([ListingGallery.tsx](../apps/web/src/components/anuncios/ListingGallery.tsx)) ya usa `aspect-video` ([:26](../apps/web/src/components/anuncios/ListingGallery.tsx#L26)) y ya tiene tira de miniaturas: el vídeo entra como una miniatura más con su icono, y al elegirla el visor principal cambia de `<Image>` a `<video>`.

**`preload="none"` + `poster`.** «Un anuncio» no es «cargar el vídeo al abrir»: la ficha es la
página de SEO y de conversión, y la mayoría de visitantes solo miran fotos. Con esto, el coste
de tener vídeo en la ficha es **una imagen más** (el póster) hasta que alguien pulsa play.

**Orden:** el vídeo va **después** de la foto de portada. Esa foto es la que el vendedor eligió
como mejor imagen y la que aparece en las listas; sustituirla rompería la continuidad entre lo
que el usuario vio en la búsqueda y lo que encuentra al entrar.

## C. El trabajo escondido, resuelto

### C.1 — Meilisearch: campo nuevo y reindexado

Las superficies 1-3 (búsqueda, categoría, destacados) **no vienen de Postgres**: vienen del
documento indexado, que hoy incluye `thumbnailUrl` e `images`
([search.service.ts:34,39,515-517](../apps/api/src/modules/search/search.service.ts#L34)) precisamente para pintar la tarjeta sin consultar la base.

**Se añade `hasVideo: boolean`** —booleano, no URL, por §B.2— a `toDocument`. Consecuencias que
el diseño asume explícitamente:

- **Reindexado necesario.** Existe el comando (`pnpm reindex`, [apps/api/CLAUDE.md](../apps/api/CLAUDE.md)) y el índice ya se reconstruye con `waitForTask` para no devolver antes de que el documento sea consultable ([search.service.ts:346-351](../apps/api/src/modules/search/search.service.ts#L346)).
- **Reindexado al cambiar el vídeo.** Subir o quitar un vídeo cambia `hasVideo`, así que hay que encolar el reindexado de ese anuncio — el mismo gesto que ya hace `bump` con `indexingQueue.add('index', { listingId })`.
- **No se hace filtrable de entrada.** Añadirlo a `filterableAttributes` ([:297-305](../apps/api/src/modules/search/search.service.ts#L297)) permitiría un filtro «solo con vídeo», pero eso es una feature de búsqueda que nadie ha pedido. Si se quiere, es una decisión aparte.

Las superficies 5-11 vienen de la API y necesitan `hasVideo` en su payload de resumen.

### C.2 — La ficha cacheada: invalidar, con el molde que ya existe

La ficha se guarda entera en Redis 5 minutos ([listings.service.ts:65,871](../apps/api/src/modules/listings/listings.service.ts#L65)). Si la URL del vídeo viaja en ese blob, un vídeo recién subido —o recién ocultado por el flag o por perder Pro— tardaría hasta cinco minutos en reflejarse.

**Se invalida `listingCacheKey(slug)` al subir, reemplazar o borrar el vídeo**, exactamente
como hace el bump. El fichero [cache-keys.ts](../apps/api/src/infra/redis/cache-keys.ts) existe justamente para esto y su comentario ya explica por qué vive fuera de los módulos de dominio.

### C.3 — Los tres requisitos, atados

| Requisito | Cómo queda atado |
|---|---|
| **Flag de admin** | `videoEnabled` como `Setting` booleano, molde [`bumpAutoEnabled`](../apps/api/src/modules/bump-schedule/bump-schedule.service.ts#L12) + whitelist en [admin.service.ts](../apps/api/src/modules/admin/admin.service.ts) |
| **Gate Pro** | Tres puntos, ver **D7** |
| **Lista de beneficios** | `if (videoEnabled) beneficios.push(...)` en [buildProBenefits](../apps/api/src/modules/billing/billing.service.ts#L1057), junto a las líneas que ya se emiten solo si el ajuste las concede |

El tercero merece una nota: al seguir ese molde, **apagar el flag retira el vídeo de `/planes`
automáticamente**. Es la lección de la ráfaga `fix-planes` aplicándose sola — no afirmar un
beneficio que la configuración puede desmentir.

---

# ENTREGABLE 2 — DECISIONES

## D1 — Límites: tamaño, duración, formato

| Opción | A favor | En contra |
|---|---|---|
| **(a) Estricta: ≤60 s, ≤50 MB, solo MP4/H.264** | Coste acotado; **permite descartar la transcodificación** (§A.3); es lo que graba un móvil | Rechaza ficheros que el usuario cree válidos |
| (b) Media: ≤3 min, ≤200 MB, +WebM/MOV | Cabe casi todo | ~4× coste; MOV obliga a transcodificar |
| (c) Laxa | Nadie se queja | Coste sin techo |

**→ Recomendación: (a).** Y el límite que más protege es el de **duración**, no el de tamaño:
acota también el tiempo de subida desde móvil, que es donde la experiencia se rompe.

**Los límites viven en su propia constante**, separada de `MAX_FILE_SIZE`
([media.service.ts:17](../apps/api/src/modules/media/media.service.ts#L17)), que seguirá protegiendo a las fotos con sus 10 MB.

**Validación en dos sitios:** el navegador comprueba duración y tamaño **antes de subir** (puede
leer los metadatos del fichero local) para no hacer esperar a nadie diez minutos para un
rechazo; el backend revalida, porque el navegador no protege nada.

## D2 — Transcodificación

*(D2 de la auditoría era fichero-vs-embed, ya tomada. Aquí es la transcodificación.)*

| Opción | A favor | En contra |
|---|---|---|
| **(a) NO transcodificar, con límites estrictos** | Sin `ffmpeg`, sin cola nueva, sin estado «procesando»: el vídeo está listo al subirse | Depende de que los límites se respeten; posible arranque algo más lento |
| (b) Transcodificar todo (ffmpeg + cola) | Formato único garantizado; arranque óptimo | Binario nuevo en despliegue, CPU, cola, estado asíncrono, doble almacenamiento |
| (c) Remuxear solo (mover metadatos) | Arregla el arranque; mucho más barato que (b) | Sigue necesitando ffmpeg |

**→ Recomendación: (a), y medir.** Con D1(a) confirmada, lo que llega ya es reproducible. Si
aparece el problema de arranque, la respuesta es **(c), no (b)**.

**El trade-off dicho sin adornos:** (a) apuesta a que los límites bastan. Si se demuestra que
no, habrá que añadir ffmpeg más tarde —y entonces el trabajo será mayor que haberlo hecho de
inicio, porque habrá vídeos ya subidos que migrar—. A cambio, si la apuesta sale bien, el
proyecto se ahorra su pieza más cara. La razón para apostar es concreta: **el formato que
producen los móviles es el que los navegadores reproducen**, y este marketplace es de
particulares grabando con el teléfono.

## D3 — El póster

| Opción | A favor | En contra |
|---|---|---|
| **(a) Capturado en el cliente al subir** | Sin ffmpeg; automático; reusa el camino de imágenes | Depende del navegador; manipulable (§A.2) |
| (b) Generado en backend con ffmpeg | Fiable y no manipulable | Trae ffmpeg, que D2 evita |
| (c) Lo sube el usuario | Control editorial | Un paso más en un flujo que ya pide fotos |
| (d) Sin póster | Nada que construir | Rectángulo negro en la ficha |

**→ Recomendación: (a), con la foto de portada como respaldo** si la captura falla. Coherente
con D2: si no se trae ffmpeg para transcodificar, no tiene sentido traerlo solo para esto.

## D4 — Uno o varios vídeos

**→ Recomendación: UNO por anuncio, reemplazable.** Encaja con lo que se pidió («un vídeo
corto»), y mantiene todo lo demás simple: un indicador, un póster, un coste. Varios obligarían a
decidir orden, galería y tope por anuncio.

**Dónde vive el dato:** campos en `Listing` (`videoUrl`, `videoPosterUrl`, `videoDurationSeconds`)
en vez de tabla propia. Con un solo vídeo, una tabla sería una relación de más; `ListingImage`
([schema.prisma](../apps/api/prisma/schema.prisma)) no sirve porque no tiene duración ni póster. Si algún día son varios, se migra — pero no se paga esa flexibilidad ahora.

## D5 — En listas

**→ Recomendación: foto de portada + icono**, confirmando la propuesta de la auditoría, y con
`hasVideo` viajando como **booleano** para que el cero-bytes sea estructural (§B.2).

Las alternativas —póster en lugar de la portada, o reproducción al pasar el ratón— se descartan:
la primera quita al vendedor el control de su mejor imagen sin ganar nada; la segunda no existe
en móvil, dispara descargas accidentales y contradice el principio del diseño.

## D6 — Qué apaga el flag

| Opción | A favor | En contra |
|---|---|---|
| (a) Solo impide subir nuevos | Poco intrusivo | No detiene el gasto de ancho de banda; inútil si se apaga por costes |
| **(b) Oculta la sección Y los vídeos existentes, sin borrar nada** | Interruptor de verdad; reversible; nada se destruye | Un vendedor ve desaparecer su vídeo sin haber hecho nada |
| (c) Oculta en listas, deja la ficha | — | Estado intermedio difícil de explicar |

**→ Recomendación: (b).** Es la lectura coherente con el precedente del bump automático, donde
apagar el flag detiene el cron pero **no toca** las programaciones: **ocultar no es borrar**.

**Consecuencia operativa:** apagar el flag cambia `hasVideo` de facto en todas las superficies,
así que exige invalidar la caché de fichas y reindexar. No es instantáneo y el diseño no debe
fingir que lo es.

## D7 — El gate Pro, y qué pasa al perder Pro

**Dónde se comprueba — tres puntos, y los tres hacen falta:**

1. **Al subir (backend).** La que de verdad protege: esconder el botón no impide un POST directo. Mismo criterio que el guard `ALREADY_SUBSCRIBED` de UXV.6.
2. **En el editor (front).** El seam de [EditarForm.tsx:83](../apps/web/src/components/publicar/EditarForm.tsx#L83), con el molde de `EstadisticasClient`: se ve, con candado.
3. **Al servir la ficha.** Decide si el vídeo de un ex-Pro se muestra.

**Si el vendedor deja de ser Pro → se OCULTA, no se borra.**

| Opción | A favor | En contra |
|---|---|---|
| (a) Se mantiene | Amable | El beneficio deja de serlo: se paga un mes y se conserva siempre |
| **(b) Se oculta, se conserva** | Coherente con «es un beneficio Pro»; vuelve al resuscribirse | Ocupa almacenamiento de quien ya no paga |
| (c) Se borra | Coste cero | Destruye contenido del usuario, irreversible |

**→ Recomendación: (b)**, y **avisar** al vendedor por el canal que ya existe. Un vídeo que deja
de verse sin decir nada es exactamente el silencio que UXV.3 vino a cerrar.

Los destacados ya caducan con la suscripción vía `EntitlementService` y las programaciones de
bump se pausan en vez de borrarse: (b) sigue esa línea.

## D8 — Procesamiento asíncrono: qué ve el usuario

**Con D2(a) confirmada, no hay procesamiento**: el vídeo está listo en cuanto termina de subir.
El único estado que la interfaz necesita contar es el de **subida** (progreso, y poder
cancelar), que es lo que de verdad tarda desde un móvil.

**→ Recomendación: sin estado «procesando».** Si algún día entra D2(c), entonces sí haría falta
—y el molde para contarlo existe: el `outcome` nullable de `BumpRun` («reclamado, sin
desenlace») resolvió el mismo problema en el proyecto 2—.

**Lo que sí hay que diseñar aunque no haya cola:** qué pasa si la subida se interrumpe a medias.
Con subida directa a R2 (§A.1) puede quedar un objeto huérfano; la fila solo se marca lista
cuando el navegador confirma, así que **un huérfano no se muestra nunca**. Limpiarlos es
mantenimiento, no corrección.

---

## Hoja de confirmación

| # | Decisión | Recomendación |
|---|---|---|
| **D1** | Límites | **≤60 s, ≤50 MB, solo MP4/H.264**; constante propia, separada de `MAX_FILE_SIZE` |
| **D2** | Transcodificación | **NO**, con límites estrictos. Medir; si hace falta, **remuxear**, no transcodificar |
| **D3** | Póster | **Capturado en el cliente** al subir; respaldo: la foto de portada |
| **D4** | Cuántos | **Uno**, reemplazable; campos en `Listing`, sin tabla nueva |
| **D5** | En listas | **Foto + icono**; `hasVideo` booleano, **nunca la URL** |
| **D6** | Flag de admin | **Oculta sección y vídeos, sin borrar** |
| **D7** | Gate Pro | Backend + editor + ficha. Al perder Pro: **se oculta, se conserva, y se avisa** |
| **D8** | Asíncrono | **Sin estado «procesando»**; solo progreso de subida |

**Qué cambia si se cambia algo:**

- **D1 → laxa**: obliga a reabrir D2, porque los límites dejan de bastar.
- **D2 → sí**: trae `ffmpeg`, cola y processor nuevos, estado «procesando» (D8), y hace a D3(b) la opción natural.
- **D3 → backend**: trae `ffmpeg` aunque D2 sea «no» — el peor de los dos mundos salvo que se valore mucho la fiabilidad del póster.
- **D4 → varios**: tabla propia, orden, tope por anuncio, y galería de vídeos en la ficha.

**D1 y D2 se sostienen mutuamente**: son las dos que conviene resolver primero, y confirmarlas
juntas o cambiarlas juntas.

---

## Orden de ráfagas sugerido

Cada una verificable sola, como en el bump automático:

1. **Infra de subida** — límites, gate Pro y flag en el backend, la firma en `R2Service`, el modelo. Sin UI. Se verifica con e2e de API: un no-Pro no sube, con el flag apagado nadie sube, un fichero fuera de límites se rechaza.
2. **Edición** — la sección del editor sobre el seam de UXV.5, con captura de póster y progreso. Se verifica en navegador: subir, ver el gate, el flag.
3. **Visualización** — la ficha (`preload="none"`) y las listas (icono), incluidos el campo de Meili y el reindexado. Se verifica que la ficha reproduce y que **el payload de lista no contiene la URL**.
4. **Los remates** — línea en `/planes`, ocultación al perder Pro con su aviso, invalidaciones.

**Por qué la infra va sola y primero:** es donde están las decisiones irreversibles (formato de
almacenamiento, límites, modelo) y se puede probar entera sin una sola pantalla. Si algo de D1
o D2 resulta equivocado, se descubre antes de haber construido nada encima.

## Lo que este diseño NO resuelve (deliberadamente)

- **Filtro «solo con vídeo»** en la búsqueda: haría falta `filterableAttributes`, y nadie lo ha pedido.
- **Limpieza de huérfanos** en R2: mantenimiento, no corrección (§D8).
- **Subtítulos, capítulos, miniaturas múltiples**: fuera del alcance de «un vídeo corto».
- **CDN de vídeo**: R2 con peticiones por rango basta para este tamaño. Sobredimensionar sería el error caro.
