# Auditoría y diseño — Destacados en búsqueda: de «4 fijo» a «2 filas llenas, tope 8»

**Fecha:** 2026-09-19 · **Alcance:** BÚSQUEDA / VITRINA DE PAGO · **Estado:** documento de decisión.
**Cero cambios de código.** Todo verificado contra el código de hoy — los documentos previos de
destacados (`auditoria-destacados-busqueda.md`, `diseno-rotacion-destacados.md`) se han
re-verificado, no citado.

---

## §0 — El veredicto en once líneas

1. **El «4» es una sola constante**: `FEATURED_BLOCK_SIZE = 4`
   ([featured-rotation.ts:18](../apps/api/src/modules/search/featured-rotation.ts#L18)).
2. **Pero alimenta DOS cosas, no una.** Es el `hitsPerPage` del bloque **y** el tamaño de grupo
   de la rotación **y** el divisor de `cuotaDeVitrina`, que es **la promesa de vitrina que se le
   enseña al vendedor antes de cobrarle**. Subirlo a 8 no es un cambio de maquetación: **duplica
   el tiempo de vitrina que recibe cada destacado** y cambia una cifra comercial.
3. **Hoy NO rellena, y no por disciplina sino por construcción**: los destacados salen de una
   consulta paginada a Meilisearch; si hay 3, devuelve 3. No hay `slice`, ni `concat`, ni relleno
   en ningún punto de la cadena. **Confirmado.**
4. **La sección ya se oculta con 0**: `if (listings.length === 0) return null`
   ([FeaturedBlock.tsx:35](../apps/web/src/components/busqueda/FeaturedBlock.tsx#L35)).
5. **Las columnas están medidas y son tres tramos**: `grid-cols-2 sm:grid-cols-3 md:grid-cols-4`.
   → **2 / 3 / 4 columnas**, y **nunca más de 4** por ancha que sea la pantalla.
6. **Por tanto «2 filas» son 4 / 6 / 8**, y **el tope 8 es redundante**: coincide exactamente con
   2 × 4, que es el máximo que el grid puede dar. No hay viewport en el que el tope muerda.
7. **NO varía por modelo de estilo.** Los ejes de un modelo son tipografía, radio y sombras
   ([estilo.constants.ts:787](../apps/api/src/modules/estilo/estilo.constants.ts#L787)): ninguno
   toca columnas. «2 filas» es **cálculo de viewport puro**.
8. **Las dos páginas que lo pintan son de SERVIDOR**, y el servidor no sabe el viewport. Ése es
   el problema central de implementación, no el cálculo.
9. **EL HALLAZGO QUE EL ENCARGO NO CONTEMPLA:** si el servidor manda 8 y el CSS oculta los que
   sobran, **las posiciones 5–8 de cada turno son invisibles para todo el tráfico móvil**. En un
   marketplace C2C el móvil suele ser la mayoría: media vitrina de pago no la vería casi nadie.
   Ver [§9](#9--el-problema-central-la-rotación-y-el-móvil).
10. **Segundo efecto no contemplado:** el servidor cuenta «veces listado» sobre lo que sirve, así
    que mandar 8 y enseñar 4 **infla hasta el doble una estadística que el vendedor ve**
    ([§11](#11--las-impresiones-veces-listado-se-inflarían)).
11. **Nada de esto bloquea el cambio**: los tres tienen salida, y la propuesta de
    [§14](#14--el-plan-de-ráfagas) las incorpora. Pero decidirlos es parte del encargo.

---

# PARTE A — CÓMO FUNCIONA HOY

## §1 — Dónde está el 4, y qué más gobierna

```ts
// apps/api/src/modules/search/featured-rotation.ts:18
export const FEATURED_BLOCK_SIZE = 4;
```

**Un solo sitio, y es deliberado** — el propio módulo explica por qué existe: la cifra que
reparte los turnos y la que se le promete al vendedor tienen que salir de la misma fórmula.

| Quién lo usa | Para qué | Consecuencia de subirlo |
|---|---|---|
| `search.controller.ts:218` | `hitsPerPage` del anillo → **el tamaño del bloque** | El bloque enseña más |
| `search.controller.ts:225` | vía `totalPages` → **grupos de la rotación** | **Menos grupos → cada destacado sale el doble de tiempo** |
| `entitlement.service.ts:367` (`getFeaturedCompetition`) | `cuotaDeVitrina(vigentes + 1)` → **la cifra que ve el vendedor en el diálogo de compra** | **Cambia la promesa comercial** |

**Esto es lo primero que hay que tener claro: el «4» no es un número de maquetación.** Es el
denominador de la vitrina. Ver [§10](#10--la-promesa-de-vitrina-una-cifra-comercial-que-se-mueve-sola).

## §2 — De dónde salen los destacados y cómo rotan

```
página 1 y no es vista MAPA
   → consulta A: mismos filtros + onlyBoosted + boostedActiveAt + sort=FEATURED_RING_SORT,
                 hitsPerPage = 4, page = 1   →  hits del grupo 1 + totalPages = nº de grupos
   → turno = grupoDeLaVentana(ahora, grupos)          (ventana de 15 min, cursor = el reloj)
   → consulta B (sólo si turno ≠ 1): la misma con page = turno
   → featured = hits de ese grupo
```
([search.controller.ts:203-232](../apps/api/src/modules/search/search.controller.ts#L203))

Cuatro propiedades verificadas que importan para el cambio:

- **El cursor es el reloj**, sin estado: `floor(ahora / ventana) % grupos + 1`. Dos instancias
  calculan el mismo turno sin hablarse.
- **El orden del anillo no es el del usuario** (`FEATURED_RING_SORT`, no `dto.sort`) — por eso el
  bloque lleva el aviso «No es un orden por relevancia».
- **Los destacados NO se restan de la lista**: se repiten a propósito en su posición natural.
- **Como mucho dos consultas**, y la segunda sólo cuando hay más destacados que huecos.

## §3 — Qué hace hoy con menos de 4 — **no rellena, y es estructural**

Con N destacados vigentes que cumplen los filtros:

| N | `grupos` | Qué devuelve | Qué se ve |
|---|---|---|---|
| 0 | 1 | `[]` | **Nada**: la sección no se pinta |
| 1–3 | 1 | los N que hay | **N tarjetas**, fila a medias |
| 4 | 1 | 4 | 4 |
| 5 | 2 | grupo 1 → 4 · grupo 2 → **1** | **alterna 4 y 1** cada 15 min |
| 12 | 3 | 4 / 4 / 4 | siempre 4 |

**No hay relleno en ningún punto de la cadena** — verificado: no hay `slice`, `concat`, `push`
ni bucle de completado sobre `featured` en el controlador, y `FeaturedBlock` pinta
`listings.map(...)` tal cual. La honestidad que pide el encargo **ya existe**; lo que hay que
cuidar es no perderla al subir el límite.

> **⚠ Y ya hay hoy un caso feo que conviene conocer antes de agrandar el bloque: N=5.** La
> paginación de Meilisearch llena los grupos con avidez, así que el último va corto. Con N=5 el
> bloque enseña **4 tarjetas durante 15 minutos y 1 durante los 15 siguientes**. Con bloques de 8
> esto empeora: N=9 daría **8 y luego 1**. Ver [§9.3](#93-el-último-grupo-va-corto-y-con-bloques-de-8-mucho-más).

## §4 — Dónde se renderiza

| | Ruta | Fichero |
|---|---|---|
| Búsqueda general | `/busqueda` | [busqueda/page.tsx:389](<../apps/web/src/app/(public)/busqueda/page.tsx#L389>) |
| Categoría | `/[categoria]` | [CategoryListingPage.tsx:561](../apps/web/src/components/categorias/CategoryListingPage.tsx#L561) |

Las dos son **componentes de servidor** (ni una ni otra lleva `'use client'`), pasan
`featured` al componente **sin recortar**, y las dos lo omiten en vista MAPA (`!isMapView`, más
`skipFeatured` en el DTO para no pagar la consulta).

El bloque: rótulo, etiqueta «Publicidad», la línea «No es un orden por relevancia» y

```tsx
<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
```

---

# PARTE B — EL CÁLCULO DE «2 FILAS»

## §5 — Las columnas por viewport, medidas

Tailwind sin `screens` propios → breakpoints por defecto. Con el `container` (max-width por
breakpoint), `px-4`, la barra lateral de filtros (`lg:w-64` + `gap-6`, **sólo desde 1024**) y
`gap-3` del grid:

| Viewport | Columnas | **2 filas** | Ancho de tarjeta (aprox.) |
|---|---|---|---|
| 375 (móvil) | **2** | **4** | ~165 px |
| 640–767 (`sm`) | **3** | **6** | ~194 px |
| 768–1023 (`md`, sin barra) | **4** | **8** | ~175 px |
| 1024–1279 (`lg`, con barra) | **4** | **8** | **~169 px** ← el más estrecho |
| 1280 (`xl`) | 4 | 8 | ~233 px |
| ≥1536 (`2xl`) | 4 | 8 | ~297 px |

**Dos conclusiones que cambian el diseño:**

1. **El tope 8 es redundante.** El grid nunca pasa de 4 columnas, así que 2 filas **son** 8 como
   máximo por construcción. El tope no muerde en ningún viewport: se puede escribir por claridad,
   pero no es una restricción real.
2. **A 1024 px la tarjeta es la MÁS ESTRECHA de todas (~169 px)**, porque la barra lateral entra
   justo cuando el grid ya está a 4 columnas. Ahí, dos filas son **8 tarjetas de 169 px**. Merece
   una mirada antes de decidir: es el peor caso estético del cambio, y hoy no se ve porque sólo
   hay 4.

## §6 — ¿Varía por modelo de estilo? **No, y se puede afirmar**

Un modelo declara `ejes`, y los ejes son:
`font-sans`, `font-heading`, `radius`, `shadow-sm`, `shadow`, `shadow-md`, `shadow-lg`
([estilo.constants.ts:787-800](../apps/api/src/modules/estilo/estilo.constants.ts#L787)) —
más la rampa de color, los semánticos y los ajustes por zona. **Ninguno es un ancho, un
contenedor ni un número de columnas.** Las clases del grid son utilidades estáticas de Tailwind,
no tokens.

Además, la regla del sistema de estilo es **«un modelo reviste, no reorganiza»**, y tiene barrera
propia: `estilo-invariancia.spec.ts` exige el MISMO árbol DOM con el Modelo 0 y con un modelo
deliberadamente extremo.

> **Matiz honesto, porque es una laguna real:** esa barrera cubre `/`, blog, página, `/planes`,
> login, registro, contacto y `/admin/anuncios` — **`/busqueda` no está en la lista**. Así que la
> invariancia de la rejilla de resultados está garantizada **por el mecanismo** (no hay eje que
> pueda tocarla), no por un test que la mida. Añadir `/busqueda` a esas rutas es barato y
> convierte el argumento en una comprobación. Va en el plan como paso opcional.

**Conclusión: «2 filas» es un cálculo de viewport puro.** Una tabla de tres tramos, idéntica en
los cinco modelos.

## §7 — Servidor o cliente: el problema de implementación

Las dos páginas son de servidor y **el servidor no conoce el viewport**. Tres salidas:

| | **A — CSS oculta lo que sobra** | **B — el cliente mide y recorta** | **C — el servidor manda el mínimo (4)** |
|---|---|---|---|
| Cómo | El servidor manda hasta 8; reglas por breakpoint ocultan a partir de la 5.ª / 7.ª | Un componente cliente mide el ancho y corta | No se cambia nada del servidor |
| SSR / CLS | **Correcto**: el HTML ya viene bien, cero JS, cero salto | **Salto**: se pinta 8 y se recorta al hidratar | Correcto |
| SEO | Las ocultas están en el DOM | Igual que A tras hidratar | — |
| Impresiones | **Infladas** ([§11](#11--las-impresiones-veces-listado-se-inflarían)) | Infladas salvo que el cliente reporte | Exactas |
| Rotación | **Posiciones 5–8 invisibles en móvil** ([§9](#9--el-problema-central-la-rotación-y-el-móvil)) | Igual | Sin cambio |
| Qué gana el escritorio | 8 | 8 | **nada** |

**Recomendada la A**, que es la única que da lo que el encargo pide sin CLS y sin JavaScript —
pero **sólo con las dos correcciones de §9 y §11**, porque sin ellas la A reparte mal la vitrina
de pago y miente en una estadística. La B se descarta por el salto visual, que en la pantalla
de resultados es justo donde más molesta. La C se documenta para dejar claro que «no hacer
nada» tiene un coste: el escritorio se queda como está.

La regla CSS de A, en el mismo grid y sin componentes nuevos, es del orden de:
oculta el hijo 5.º en adelante por debajo de `sm`, el 7.º en adelante entre `sm` y `md`, y
nada desde `md`.

---

# PARTE C — NUNCA RELLENAR

## §8 — La fórmula y sus tres consecuencias

> **mostrados = min( destacados que existen y cumplen los filtros , 2 × columnas del viewport )**

y como `columnas ≤ 4`, el tope de 8 sale solo.

**Lo que hay que preservar, punto por punto:**

| Situación | Qué debe pasar | ¿Hoy? |
|---|---|---|
| 0 destacados | **Sin sección** | ✔ ya (`return null`) |
| 3 destacados, caben 4 | **3 tarjetas**, la sección ocupa una fila corta | ✔ ya |
| 5 destacados, caben 8 | **5 tarjetas**: 1 fila llena + 1 fila con 1 | ✔ sería el comportamiento natural |
| 12 destacados, caben 8 | 8, y los demás **por turnos** | ✔ vía rotación |
| Nunca | Repetir una tarjeta, o colar un no-destacado | ✔ imposible por construcción |

**La fila a medias — recomendación: mostrarla.** «2 filas» es **un tope, no una obligación de
llenar**. Con 5 destacados se enseñan los 5: recortar a 4 para que la rejilla quede cuadrada
sería esconder a un vendedor que ha pagado, por estética. Y el caso ya existe hoy sin que nadie
lo haya considerado un defecto (con 3 destacados se ven 3).

**Riesgo del relleno, y de dónde vendría.** El peligro no es que alguien escriba un bucle de
relleno: es **pedir 8 a una consulta que no distingue destacados de no destacados**. Hoy no puede
pasar —el anillo lleva `onlyBoosted: true` y `boostedActiveAt`—, y **esas dos condiciones son las
que hay que dejar intactas**. Merecen un test que las fije, porque son lo único que separa «la
vitrina de pago» de «los ocho primeros resultados».

---

# PARTE D — EL EFECTO EN LO YA HECHO

## §9 — El problema central: la rotación y el móvil

### 9.1 El reparto se dobla

`grupos = ceil(N / tamaño)` y cada destacado sale **un grupo por ciclo**. Con `tamaño` de 4 → 8:

| N destacados | Grupos hoy (4) | Vitrina/día hoy | Grupos con 8 | Vitrina/día |
|---|---|---|---|---|
| 4 | 1 | 24 h | 1 | 24 h |
| 8 | 2 | 12 h | **1** | **24 h** |
| 12 | 3 | 8 h | **2** | **12 h** |
| 50 | 13 | ~1 h 51 | **7** | **~3 h 26** |

**Cada destacado pasa a recibir el doble de vitrina.** Es el efecto buscado y es bueno para quien
paga — pero es un cambio de producto, no de maquetación, y hay que decirlo así.

### 9.2 …pero sólo si alguien lo ve: **las posiciones 5–8 y el móvil**

Con la salida A (servidor manda 8, CSS oculta), en un móvil se ven **las 4 primeras del grupo**.
Las posiciones 5.ª a 8.ª **no las ve ningún visitante de móvil, nunca**, porque la posición
dentro del grupo la fija el orden del anillo, no el azar.

**En un marketplace C2C el móvil suele ser la mayoría del tráfico.** Dicho sin rodeos: **la mitad
de los huecos nuevos serían invisibles para la mayoría de los visitantes**, y quien cayera en la
segunda mitad del grupo pagaría lo mismo por mucho menos. Eso no es un detalle de
implementación: es la clase de asimetría silenciosa que el bloque lleva combatiendo desde R2.

**Dos salidas, y conviene elegir:**

| | **A1 — grupos de 4, el escritorio ve DOS grupos** (recomendada) | **A2 — grupos de 8, y se asume** |
|---|---|---|
| Cómo | La rotación no cambia (`tamaño` sigue 4). En anchos, el bloque pinta el grupo del turno **y el siguiente** | `FEATURED_BLOCK_SIZE = 8` |
| Reparto | **Justo**: todos pasan por las 4 primeras posiciones en algún turno | Injusto por posición fija |
| Vitrina | Se dobla igual (cada uno sale en dos turnos de cada ciclo, en escritorio) | Se dobla |
| Coste | La segunda consulta pasa a ser casi siempre necesaria — hoy sólo lo es con N>4 | Ninguno |
| Riesgo | Con `grupos = 1` no hay «siguiente»: se pinta lo que hay (que es todo) | — |

**A1 es más trabajo y es la correcta.** Mantiene intacta la promesa de que cada destacado sale
en cada ciclo **en un sitio visible**, y convierte «2 filas» en lo que de verdad es: el
escritorio, que tiene sitio, adelanta el turno siguiente.

### 9.3 El último grupo va corto — y con bloques de 8, mucho más

La paginación llena los grupos con avidez, así que el último recibe el resto. Hoy, N=5 → **4 y
luego 1**. Con bloques de 8, N=9 → **8 y luego 1**: el bloque cambiaría de ocho tarjetas a una
cada quince minutos.

**Se arregla repartiendo a partes iguales en vez de con avidez.**

> ### ⚠ CORRECCIÓN (2026-09-19, al implementar la ráfaga 1)
>
> Este apartado proponía `porGrupo = ceil(N / grupos)` manteniendo la paginación por página.
> **Esa fórmula es insuficiente y se ha descartado**: sigue siendo una página de tamaño fijo,
> así que **no arregla el caso peor**. Con N=13 y bloque 4 da `grupos = 4` y
> `ceil(13/4) = 4` → los grupos vuelven a ser **[4, 4, 4, 1]**, exactamente lo de antes.
>
> El reparto de verdad exige que **los grupos tengan tamaños distintos entre sí** (los `resto`
> primeros llevan uno más), y eso no se puede expresar con un número de página. Lo
> implementado pide el turno como **tramo `offset`/`limit`**:
>
> ```
> grupos = ceil(N / tamaño)      ← no cambia: sigue siendo el nº de turnos del ciclo
> base   = floor(N / grupos)
> resto  = N % grupos            ← cuántos grupos llevan uno de más
> ```
>
> Resultados: N=5, tamaño 4 → **[3, 2]** · N=13, tamaño 4 → **[4, 3, 3, 3]** ·
> N=9, tamaño 8 → **[5, 4]** · N=10, tamaño 4 → **[4, 3, 3]**.
>
> Coste: **el mismo**. El turno 1 se sirve recortando la consulta de conteo, así que sigue
> costando una sola consulta; y `grupos` no cambia, luego `cuotaDeVitrina` —la promesa al
> vendedor— vale exactamente igual que antes.

## §10 — La promesa de vitrina: una cifra comercial que se mueve sola

`getFeaturedCompetition` le dice al vendedor, **antes de pagar**, cuánta vitrina le tocará, y lo
calcula con `cuotaDeVitrina(vigentes + 1)` — la misma fórmula que reparte, a propósito.

**Si el tamaño del bloque cambia y esa llamada no lo refleja, el diálogo de compra miente** — a
la baja, prometiendo menos de lo que dará. Es menos grave que mentir al alza, pero sigue siendo
una cifra incorrecta en una pantalla de compra.

Como `cuotaDeVitrina` ya recibe `tamañoDelBloque` como parámetro (con valor por defecto), el
arreglo es pasar el tamaño efectivo. **Con la opción A1 la cifra es la del escritorio o la del
móvil según quién mire**, y eso obliga a una decisión de redacción: o se promete la conservadora
(móvil) o se explica que en pantallas anchas sale más. **Recomiendo prometer la conservadora**:
prometer poco y dar más es la única asimetría aceptable en una pantalla de cobro.

## §11 — Las impresiones («veces listado») se inflarían

El controlador cuenta una impresión por cada anuncio servido, uniendo `hits` y `featured`
([search.controller.ts:258](../apps/api/src/modules/search/search.controller.ts#L258)). Y «veces
listado» **es una estadística que el vendedor ve** en `EstadisticasClient` — una de las ventajas
que `/planes` anuncia.

**Con la opción A, un móvil recibiría 8 y vería 4: la mitad de las impresiones contadas serían
de tarjetas que nadie miró.** Hasta el doble de inflado, en la estadística que un Pro usa para
juzgar si el destacado le sale a cuenta.

| Salida | Qué implica |
|---|---|
| **Contar sólo las que caben en el peor caso (4)** | Subcuenta en escritorio; barato y conservador |
| **Que el cliente reporte lo que de verdad pintó** | Exacto; obliga a una llamada nueva desde el navegador |
| **Asumir el inflado y documentarlo** | Gratis, pero degrada un dato de pago sin decírselo a nadie |

Con **A1** el problema **se reduce solo**: si el escritorio pinta dos grupos, las ocho tarjetas
se ven de verdad, y el móvil pinta un grupo y recibe cuatro. La cuenta vuelve a cuadrar salvo
por la diferencia entre lo servido y lo pintado en el tramo `sm` (6 de 8). **Otro punto a favor
de A1.**

## §12 — La cuota de destacado (piezas 1 y 2): sin efecto, y conviene saber por qué

Un destacado concedido por cuota Pro crea un `Entitlement FEATURED_LISTING` con
`origin: PRO_QUOTA`. El anillo filtra por `onlyBoosted` + `boostedActiveAt`, que miran
**`boostScore` y la vigencia del destacado en el documento de Meilisearch — no el origen**.

**Por tanto un destacado de cuota compite exactamente igual que uno pagado con créditos o con
tarjeta**, y así debe seguir: la cuota es una forma de pagar el destacado, no un destacado de
segunda. Agrandar el bloque les beneficia a todos por igual. **Nada que cambiar.**

Sí hay una consecuencia comercial que merece constar: con el bloque a 8, **la cuota mensual de
Pro vale más** (cada destacado gratis rinde el doble de vitrina), y también la del Pro concedido
a mano si Ernest le pone número. No hay que tocar nada — pero si alguna vez se calibran esas
cantidades, éste es el cambio que movió el valor de cada unidad.

## §13 — SEO y CLS

- **CLS: no empeora.** El medio de la tarjeta lleva `aspect-square`
  ([CardPhotoCarousel.tsx:63](../apps/web/src/components/anuncios/CardPhotoCarousel.tsx#L63)),
  así que el hueco está reservado antes de cargar la imagen. Con la salida **A** el HTML llega ya
  correcto y **no hay salto**; con la **B** sí lo habría, y es su principal argumento en contra.
- **LCP: vigilar.** Pasar de 4 a 8 tarjetas **dobla las imágenes por encima del pliegue** en
  escritorio. Ninguna del bloque lleva `priority`, así que son `lazy` por defecto y el navegador
  las prioriza solo — pero conviene **medirlo** en la ráfaga, no suponerlo.
- **`sizes` se queda corto, y ya pasaba antes.** `GRID_MEDIA_SIZES` declara `33vw` hasta 1024 px
  ([card-shells.tsx:33](../apps/web/src/components/anuncios/card-shells.tsx#L33)) mientras que el
  grid ya está a 4 columnas desde 768. El navegador descarga algo más grande de lo necesario en
  ese tramo. **Es un defecto preexistente, menor**, pero si se van a duplicar las imágenes del
  bloque, es el momento barato de afinarlo.
- **SEO: sin riesgo nuevo.** Los destacados **ya se repiten** dentro de `hits`, así que el bloque
  nunca ha aportado URLs que no estuvieran en la página. Las ocultas por CSS en la salida A son
  enlaces a anuncios que ya están listados más abajo.

---

## §14 — El plan de ráfagas

**RÁFAGA 1 — El reparto justo, antes de agrandar nada** *(es la que evita el daño)* — **✅ HECHA**
1. ~~Grupos a partes iguales~~ → **hecho**, con tramos `offset`/`limit` en vez de páginas (ver la
   corrección de [§9.3](#93-el-último-grupo-va-corto-y-con-bloques-de-8-mucho-más)).
2. ~~Tests de la rotación~~ → **hecho**: las dos invariantes —grupos que no difieren en más de
   uno, y partición exacta— barridas para todo N ≤ 120 y todo tamaño ≤ 8.

**RÁFAGA 2 — Las 2 filas** — **✅ HECHA** (ver «Destacados — RÁFAGA 2» en `estado-tecnico.md`).
Se aplicaron D-1, D-2, D-3, D-5 y D-7. **D-8 se aceptó tras ver la previa a 1024 px.**
1. El tamaño deja de ser una constante suelta y pasa a ser «columnas × 2», con la tabla de
   tres tramos en **un solo sitio compartido** por el CSS y por quien calcule la promesa.
2. El servidor sirve hasta 8 (o dos grupos de 4, según A1/A2) y el CSS recorta por breakpoint.
3. `getFeaturedCompetition` pasa el tamaño efectivo a `cuotaDeVitrina`
   ([§10](#10--la-promesa-de-vitrina-una-cifra-comercial-que-se-mueve-sola)).
4. Barreras: 0 → sin sección; 3 → tres tarjetas; 5 → cinco; **jamás un no-destacado** (que
   `onlyBoosted` y `boostedActiveAt` sigan ahí).

**RÁFAGA 3 — Lo que el cambio destapa** — **✅ HECHA** (ver «Destacados — RÁFAGA 3» en
`estado-tecnico.md`). D-4 resuelta contando el peor caso. **Salvedad: el LCP no llegó a medirse
de verdad** —la semilla no trae imágenes, así que el elemento LCP fue texto— y queda sin barrera.
1. Decidir las impresiones ([§11](#11--las-impresiones-veces-listado-se-inflarían)).
2. Medir LCP con 8 tarjetas y afinar `sizes`.
3. Añadir `/busqueda` a las rutas de `estilo-invariancia.spec.ts`
   ([§6](#6--varía-por-modelo-de-estilo-no-y-se-puede-afirmar)).
4. Las capturas: el bloque cambia de tamaño, así que **hay baselines que regenerar** — el
   procedimiento está en `estado-tecnico.md` («El rojo crónico de capturas»), y el aviso de
   borrar `.next` antes de hacerlo en local aplica igual.

---

## §15 — Las decisiones para Ernest

| # | Decisión | Opciones | Recomendación | Por qué |
|---|---|---|---|---|
| **D-1** | **La fila a medias** | Mostrarla / recortar a fila llena | **Mostrarla** | «2 filas» es el tope, no la obligación de llenar. Recortar esconde a alguien que pagó, por estética |
| **D-2** | **Servidor o cliente** | **A: CSS oculta** / B: cliente mide / C: no tocar | **A**, con D-3 | Es la única sin CLS y sin JS. B salta justo en la pantalla de resultados |
| **D-3** | **El reparto con bloques grandes** | **A1: grupos de 4, el ancho ve dos** / A2: grupos de 8 | **A1** | Con A2, **las posiciones 5–8 no las ve nunca el móvil**, que suele ser la mayoría del tráfico ([§9.2](#92-pero-sólo-si-alguien-lo-ve-las-posiciones-58-y-el-móvil)) |
| **D-4** | **Las impresiones infladas** | Contar 4 / que el cliente reporte / asumirlo | **Contar el peor caso**, salvo que A1 lo resuelva | «Veces listado» es un dato que el Pro usa para decidir si repite |
| **D-5** | **Qué se promete en el diálogo de compra** | La del móvil / la del escritorio / las dos | **La del móvil** (conservadora) | Prometer poco y dar más es la única asimetría aceptable en una pantalla de cobro |
| **D-6** | **Los grupos a partes iguales** | Sí / dejarlo con avidez | **Sí, y antes del resto** | Arregla el 4-y-1 que YA existe, y sin él bloques de 8 dan 8-y-1 |
| **D-7** | **El tope 8** | Escribirlo / omitirlo | **Escribirlo, sabiendo que es redundante** | Hoy no muerde (el grid no pasa de 4 col). Es una red por si alguien añade `xl:grid-cols-5` |
| **D-8** | **¿Ocho tarjetas de 169 px a 1024 px?** | Aceptar / subir el grid a 5-6 col en anchos / 2 filas sólo desde `xl` | **Mirarlo en pantalla antes de decidir** | Es el peor caso estético y hoy no se ve porque sólo hay 4 ([§5](#5--las-columnas-por-viewport-medidas)) |

---

## §16 — Lo que NO hay que tocar

- **`onlyBoosted` + `boostedActiveAt`** en la consulta del anillo: son lo único que separa la
  vitrina de pago de «los ocho primeros resultados».
- **La repetición en `hits`**: el bloque es la vitrina, la lista es la lista.
- **`FEATURED_RING_SORT`** y el cursor-reloj: el reparto sin estado funciona.
- **El aviso de publicidad**: más tarjetas hacen su ausencia más grave, no menos.
- **La exclusión en vista MAPA** (`skipFeatured`).
- **La cuota Pro como origen del destacado**: compite igual, y debe seguir así.

---

## §17 — Resumen de verificación

| Afirmación | Veredicto | Dónde |
|---|---|---|
| «El máximo 4 está en una constante» | **CONFIRMADO** — y alimenta tres cosas, no una | [§1](#1--dónde-está-el-4-y-qué-más-gobierna) |
| «Hoy no rellena» | **CONFIRMADO**, por construcción | [§3](#3--qué-hace-hoy-con-menos-de-4--no-rellena-y-es-estructural) |
| «La sección se oculta con 0» | **CONFIRMADO** (`return null`) | [§3](#3--qué-hace-hoy-con-menos-de-4--no-rellena-y-es-estructural) |
| Columnas por breakpoint | **2 / 3 / 4**, medido; nunca más de 4 | [§5](#5--las-columnas-por-viewport-medidas) |
| «2 filas, tope 8» | 4 / 6 / 8 — **el tope es redundante** | [§5](#5--las-columnas-por-viewport-medidas) |
| «¿Varía por modelo?» | **No.** Ningún eje toca columnas (laguna: `/busqueda` no está en la barrera) | [§6](#6--varía-por-modelo-de-estilo-no-y-se-puede-afirmar) |
| Servidor o cliente | **Las dos páginas son de servidor**; no conoce el viewport | [§7](#7--servidor-o-cliente-el-problema-de-implementación) |
| La rotación hereda | Sí: **duplica la vitrina de cada destacado** | [§9.1](#91-el-reparto-se-dobla) |
| La cuota Pro | **Sin efecto**: compite por `boostScore`, no por origen | [§12](#12--la-cuota-de-destacado-piezas-1-y-2-sin-efecto-y-conviene-saber-por-qué) |
| CLS | No empeora con la salida A (`aspect-square`) | [§13](#13--seo-y-cls) |
| — *(no estaba en el encargo)* | **Las posiciones 5–8 serían invisibles en móvil** | [§9.2](#92-pero-sólo-si-alguien-lo-ve-las-posiciones-58-y-el-móvil) |
| — *(no estaba en el encargo)* | **«Veces listado» se inflaría hasta el doble** | [§11](#11--las-impresiones-veces-listado-se-inflarían) |
| — *(no estaba en el encargo)* | **La promesa de vitrina del diálogo de compra se queda corta** | [§10](#10--la-promesa-de-vitrina-una-cifra-comercial-que-se-mueve-sola) |
| — *(no estaba en el encargo)* | **El último grupo va corto YA hoy** (N=5 → 4 y 1) | [§9.3](#93-el-último-grupo-va-corto-y-con-bloques-de-8-mucho-más) |
