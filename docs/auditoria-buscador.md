# Auditoría — El bloque buscador de la portada: de dos `<select>` a dos diálogos filtrables

> **Alcance:** SOLO la portada. `/busqueda` se unifica en otra ráfaga — pero el molde que
> sale de aquí tiene que servir para aquélla sin reescribirse.
>
> **Estado:** documento de auditoría. Cero código. Todo lo que sigue está verificado
> contra el árbol en `main` (commit `4cd31c9`), y donde una fuente del proyecto dice otra
> cosa se señala cuál y por qué.

---

## 0. El resumen en una página

El encargo son tres frases: **diálogos filtrables en vez de `<select>`**, **el buscador
integrado con el hero y consigo mismo**, **correcto en escritorio y móvil para cada modelo
y versión**.

La auditoría dice que las tres son alcanzables sin inventar nada, porque **las cuatro
piezas que hacen falta ya existen en el repo** y ninguna hay que traerla de fuera:

| Pieza | Dónde está hoy | Qué aporta |
|---|---|---|
| El diálogo con su portal y su zona | [`ui/dialog.tsx`](../apps/web/src/components/ui/dialog.tsx) | La capa, el foco atrapado, el `Esc`, el tempo del modelo |
| El combobox filtrable accesible | [`MunicipioAutocomplete.tsx`](../apps/web/src/components/municipio/MunicipioAutocomplete.tsx) | El patrón de «campo de texto que filtra una lista», con `aria-activedescendant` y teclado completo |
| El aplanado del árbol de N niveles | [`CategorySelect.tsx:93-104`](../apps/web/src/components/busqueda/CategorySelect.tsx#L93-L104) | «Vehículos › Coches › Deportivos» como etiqueta de una lista PLANA |
| Los recorridos del árbol | [`lib/category-tree.ts`](../apps/web/src/lib/category-tree.ts) | `recorrerArbol`, `cadenaHasta`, `buscarEnArbol` |

Y dice además cuatro cosas que **el encargo da por buenas y el código contradice**. Las
cuatro están en el §1; la que más pesa es ésta:

> ⚠ **El buscador de la portada funciona hoy SIN JavaScript, y está escrito que sea así.**
> `SearchHomeBlockRenderer` lo documenta (*«su marcado es un `<form>` nativo con dos
> `<select>` y un `<input type="search">`: está entero en el HTML servido y funciona sin
> JS»*), y [`diseno-escaparate.md §5.2`](diseno-escaparate.md) **se apoya en eso** para
> declarar seguro el LCP del hero montado. Un diálogo de Radix no funciona sin JS. **Esta
> es la decisión de producto más grande de la ráfaga y no la puede tomar la auditoría.**
> Va como decisión 1 del §9.

---

## 1. Lo que el encargo da por sabido, y lo que dice el código

El encargo trae un mapa del buscador que era exacto hace tres ráfagas. Cuatro puntos han
cambiado desde entonces, y **los cuatro amplían el trabajo o lo abaratan**, ninguno lo
rompe.

### 1.1 El buscador ya no compone `/busqueda?q=&category=&province=`

**El encargo dice:** «Compone `/busqueda?q=&category=&province=` (solo los no vacíos)».

**El código dice** ([`SearchBar.tsx:84-133`](../apps/web/src/components/busqueda/SearchBar.tsx#L84-L133))
que hay **tres destinos**, no uno:

| Situación | Destino real |
|---|---|
| Sin categoría, texto libre | `/busqueda?q=…&province=…` |
| **Con** categoría elegida | **`/vehiculos/coches?q=…&province=…`** — la ruta CANÓNICA (A1), no `?category=` |
| Sugerencia de etiqueta elegida (B4) | el mismo destino + `?tags=<slug>` en vez de `?q=` |

`?category=` sobrevive **sólo** como red: [`SearchBar.tsx:97`](../apps/web/src/components/busqueda/SearchBar.tsx#L97)
lo escribe cuando el slug elegido no aparece en el árbol, con el comentario de que no
debería pasar.

**Qué implica para el diálogo:** nada que tocar, y eso es lo importante. El diálogo
**sólo escribe `setCategory(slug)`**; `navegar()` y `paramsBase()` se quedan exactamente
como están. Si la ráfaga toca `navegar()`, se ha salido de su sitio.

⚠ **Y hay un acoplamiento que el diálogo sí tiene que respetar:** `category` es
dependencia del efecto de sugerencias
([`SearchBar.tsx:66`](../apps/web/src/components/busqueda/SearchBar.tsx#L66) — `[query, category]`),
que lo pasa a `suggestTags(texto, category)`. **Elegir una categoría en el diálogo vuelve
a pedir las sugerencias, ya filtradas por ella.** Es el comportamiento correcto y es
gratis; sólo hay que saber que ocurre, porque significa que cerrar el diálogo puede
repintar el desplegable de etiquetas que hay debajo.

### 1.2 El árbol NO es de dos niveles: son cuatro — y hoy la portada sólo alcanza dos

**El encargo dice:** «el árbol de categorías (jerarquía padre→hijo, 2 niveles)».

**El código dice** [`CATEGORY_MAX_DEPTH = 4`](../apps/api/src/modules/categories/category.types.ts#L38),
con su test que lo fija ([`category.types.depth.spec.ts:230-231`](../apps/api/src/modules/categories/category.types.depth.spec.ts#L230-L231)).
`GET /categories` sirve el árbol entero.

El `<select>` de la portada pinta **dos**: `categories.map` y, dentro,
`cat.children.map` ([`SearchBar.tsx:172-183`](../apps/web/src/components/busqueda/SearchBar.tsx#L172-L183)).
No es un descuido del que lo escribió: **el estándar HTML no permite anidar `<optgroup>`**,
así que un `<select>` nativo no puede expresar más de dos niveles de agrupación. Lo dejó
escrito quien se topó con lo mismo en `/busqueda`
([`CategorySelect.tsx:79-82`](../apps/web/src/components/busqueda/CategorySelect.tsx#L79-L82)).

> **Consecuencia medida: desde el buscador de la portada, una categoría de nivel 3 o 4 es
> INALCANZABLE.** No da error; simplemente no está en la lista.

Esto es exactamente el modo de fallo que [`category-tree.ts`](../apps/web/src/lib/category-tree.ts)
existe para cerrar — su cabecera enumera **seis** ficheros que hacían «las raíces y un
nivel de hijas» a mano y los migró a recorridos de N niveles. **`SearchBar` no estaba en
esos seis**, porque el `<select>` no tenía arreglo posible.

> **El diálogo lo cierra de paso, y no es alcance nuevo: es la misma lista, completa.**
> Un contenedor que no es un `<select>` no tiene el límite del `<optgroup>`.

**Y filtrar sí funciona a esa profundidad**, que era la duda razonable: `categoryPath` se
construye desde la CADENA ENTERA de ancestros
([`search.service.ts:467` y `:795`](../apps/api/src/modules/search/search.service.ts#L467) —
`ancestorChainIn`), y el filtro es contención en array
([`:640`](../apps/api/src/modules/search/search.service.ts#L640)).

⚠ **`estado-tecnico.md` (línea ~313) está desactualizado en este punto:** dice
«`categoryPath` soporta como máximo 2 niveles (hoja → padre)» y remite a un
`INDEX_INCLUDE` que ya no es el que manda. Lo corrigió PROFUNDIDAD N · RÁFAGA 2 y el
propio `search.service.ts:294-296` lo deja anotado. **Conviene corregir esa línea en la
misma ráfaga**, porque es la clase de nota vieja que hace que alguien no se atreva.

### 1.3 `shadcn Command` / `cmdk` **no existe** en el proyecto

Verificado en las dos direcciones:

- `apps/web/src/components/ui/` tiene 20 componentes y **no hay `command.tsx`**
  (`accordion, alert-dialog, avatar, badge, button, card, checkbox, dialog, dropdown-menu,
  input, label, progress, radio-group, select, separator, skeleton, sonner, table, textarea`
  + un test).
- `apps/web/package.json` lista doce paquetes `@radix-ui/*` y **`cmdk` no está entre ellos**.

**Conclusión:** la vía «reusar Command» no está disponible. Traerla sería una dependencia
nueva (cmdk + su capa de estilos) para un caso que las piezas de casa ya cubren, y el
repo tiene precedente explícito de rechazar justo eso:
[`SearchTabs.tsx:12-18`](../apps/web/src/components/home/blocks/SearchTabs.tsx#L12-L18)
(*«instalar una dependencia para luego desactivar su comportamiento principal no
compensa; esto son cuarenta líneas»*).

### 1.4 Lo que el encargo llama «integración entre los inputs» no existe hoy

El encargo lo pide como mejora. La medición dice que hoy **los cuatro controles no
comparten ni alto ni tipografía**, y que la incoherencia es visible en escritorio:

| Control | Alto (móvil) | Alto (`md:`) | Radio | Texto |
|---|---|---|---|---|
| `<select>` Categoría | `h-12` | `md:h-full` | `rounded-xl` | `text-sm` → `md:text-base` |
| `<select>` Provincia | `h-12` | `md:h-full` | `rounded-xl` | `text-sm` → `md:text-base` |
| `<input type="search">` | `h-14` | `md:h-16` | `rounded-xl` | `text-lg` → `md:text-xl` |
| `<Button>` Buscar | `h-14` | `md:h-16` | `rounded-xl` | `text-base` → `md:text-lg` |

([`SearchBar.tsx:161-242`](../apps/web/src/components/busqueda/SearchBar.tsx#L161-L242))

El `md:h-full` de los selects los estira hasta el alto de la fila —que lo fija el input a
64 px— así que en escritorio **la incoherencia se disimula**; en móvil, donde el `<form>`
es `flex-col`, quedan cuatro filas de 48/48/56/56 px. **El radio sí es coherente**
(`rounded-xl` en los cuatro, `rounded-2xl` en el `<form>`) y **ya sigue al modelo** desde
la ráfaga A del escaparate ([`tailwind.config.ts:95-110`](../apps/web/tailwind.config.ts#L95-L110):
`xl = calc(var(--radius) * 1.5)`).

---

## 2. EL MOLDE — qué se reusa y qué se extrae

### 2.1 La pregunta del encargo, contestada

> *¿Se puede extraer un componente genérico de filtrado del que `MunicipioAutocomplete`
> sea un caso, o se calca su patrón?*

**Ni una cosa ni la otra: se extrae un componente nuevo y `MunicipioAutocomplete` se
queda donde está.** Las razones son tres y las dos primeras son de forma, no de gusto.

**(a) No son la misma forma de interfaz.** `MunicipioAutocomplete` es un **combobox
inline**: un `<input>` que vive en el formulario y despliega un `<ul role="listbox">`
anclado debajo (`absolute z-50 mt-1`,
[líneas 200-229](../apps/web/src/components/municipio/MunicipioAutocomplete.tsx#L200-L229)).
Lo que pide el encargo es un **diálogo**: una capa portalada a `<body>` con velo, foco
atrapado y `Esc`. Comparten la LÓGICA (filtrar, resaltar, elegir) y no comparten la
GEOMETRÍA. Es literalmente el reparto que ya hizo `AdminMobileNav`: *«no se reusa
`DialogContent` porque aquel centra un cuadro y esto es un panel anclado al borde: mismo
primitivo, distinta geometría»*.

**(b) Su contrato es de texto libre, y el nuestro no puede serlo.** `onChange` se llama
**en cada tecla** con lo tecleado (`onChange(val)`, línea 102), porque publicar admite un
municipio que no esté en el dataset. **La provincia no admite eso**: el filtro es un `=`
exacto (§4.3). Un molde compartido tendría que llevar un interruptor «¿texto libre sí o
no?» que cambia el contrato de la salida, y eso ya no es un molde, es dos componentes con
un `if`.

**(c) Carga su propio dataset por `fetch`** (líneas 79-89). Las categorías **ya vienen con
la página** y las provincias son una constante del bundle. Extraer eso obligaría a
generalizar la carga para el único consumidor que la necesita.

> **Lo que sí se le copia, y es casi todo lo que importa:** el bloque de accesibilidad
> (`role="combobox"` + `aria-expanded` + `aria-controls` + `aria-autocomplete="list"` +
> **`aria-activedescendant`**, líneas 174-180), el `normalize()` que quita tildes por NFD
> (28-31), el orden de resultados **`startsWith` primero y desempate por longitud**
> (66-75) y el manejo de teclas (112-143). Es el único sitio del repo donde eso está
> resuelto entero, y **está probado en e2e** (`municipio-autocomplete.spec.ts`).

⚠ **Un detalle suyo que NO se copia:** `aria-activedescendant` sólo apunta a algo cuando
`activeIndex >= 0` (línea 158-159). En un diálogo donde la lista es el contenido
principal conviene que la primera opción esté resaltada de salida, para que `Enter` haga
lo evidente. Es una diferencia de comportamiento a decidir (§9, decisión 3).

### 2.2 La forma del molde: un componente, dos usos

**`DialogoFiltrable`** (nombre de trabajo) — **estructura común, sin una línea por
modelo**:

```
┌─ DialogTrigger ─────────────────────────────┐   ← vive DENTRO del <form>
│  «Categoría»  /  «Toda España»          ⌄  │     type="button" (Radix lo pone)
└─────────────────────────────────────────────┘
      ↓ clic / Enter / Espacio
┌─ DialogContent (portal a <body>) ───────────┐
│  Título + Cerrar                            │
│  ┌───────────────────────────────────────┐  │
│  │ 🔍 Filtrar…                           │  │   ← <input>, autoFocus
│  └───────────────────────────────────────┘  │
│  ─────────────────────────────────────────  │
│  role="listbox"  (scroll)                   │
│   · opción                                  │   ← role="option" + aria-selected
│   · opción                                  │
│   · «Nada coincide.»                        │   ← el vacío, siempre presente
└─────────────────────────────────────────────┘
```

**Lo que el componente sabe:** abrir/cerrar, enfocar el filtro al abrir, filtrar, resaltar,
elegir, devolver el foco al disparador. **Lo que NO sabe:** qué es una categoría ni qué es
una provincia. Recibe:

| Entrada | Categoría | Provincia |
|---|---|---|
| `opciones` | `aplanar(categories)` → `{valor, etiqueta}` | `PROVINCIAS.map(p => ({valor: p, etiqueta: p}))` |
| `valor` / `onElegir` | `category` / `setCategory` | `province` / `setProvince` |
| etiqueta del vacío | «Categoría» | «Toda España» |
| opción de limpiar | «Todas las categorías» | «Toda España» |

**Por qué sobre `ui/dialog.tsx` y no sobre `DialogPrimitive` a pelo:** porque
`DialogContent` ya resuelve tres cosas que si no habría que reescribir — el `data-zona` en
**los dos** nodos portalados (velo y contenido,
[`dialog.tsx:74` y `:93`](../apps/web/src/components/ui/dialog.tsx#L74)), el botón de
cerrar con su `sr-only` ya traducido (línea 106) y la animación **atada a
`var(--motion-duration)`** en vez de a un `duration-200` escrito a mano (el porqué, en el
comentario de las líneas 31-58). Sólo se le pasa `className` para la geometría de móvil
(§6.2), que es lo que `className` está ahí para hacer.

### 2.3 Qué NO se reusa, y por qué conviene decirlo

- **`ui/select.tsx` (Radix Select).** Es un selector, no un buscador: no tiene campo de
  filtro. Se descarta por el encargo mismo.
- **`StepCategoria`** del wizard de publicar
  ([steps/StepCategoria.tsx](../apps/web/src/components/publicar/steps/StepCategoria.tsx)) —
  es un **navegador por niveles** (mantiene un `path` y entra en los hijos). El propio
  repo tiene escrito por qué no sirve aquí:
  [`CategorySelect.tsx:84-88`](../apps/web/src/components/busqueda/CategorySelect.tsx#L84-L88) —
  *«publicar es ELEGIR una categoría explorando; filtrar aquí es SALTAR a una que ya
  conoces»*. **La portada es «saltar»**, no «explorar»: para explorar ya están los chips
  «Populares» y la rejilla de categorías, en esa misma página.

---

## 3. EL DIÁLOGO DE CATEGORÍA — filtrar un árbol sin navegarlo

### 3.1 La respuesta al «filtrar un árbol es distinto de filtrar una lista plana»

**Lo es — y por eso el árbol se aplana ANTES de filtrar, no se filtra como árbol.** La
función ya está escrita y probada en producción desde PROFUNDIDAD N · RÁFAGA 2:

```
aplanar(categories) → [
  { slug: 'vehiculos',            etiqueta: 'Vehículos' },
  { slug: 'coches',               etiqueta: 'Vehículos › Coches' },
  { slug: 'deportivos',           etiqueta: 'Vehículos › Coches › Deportivos' },
  { slug: 'inmobiliaria',         etiqueta: 'Inmobiliaria' },
  …
]
```
([`CategorySelect.tsx:93-104`](../apps/web/src/components/busqueda/CategorySelect.tsx#L93-L104);
separador `' › '`, línea 73, marcado como contenido de cara al usuario)

Con eso, **las dos preguntas del encargo se contestan solas**:

> *Al escribir «coch», ¿aparece «Coches» bajo «Vehículos»?*

Aparece **una fila que dice «Vehículos › Coches»**. El padre no es un encabezado de grupo:
es contexto dentro de la propia etiqueta. Y eso es lo que hace que el filtro funcione a
cuatro niveles sin ninguna lógica de árbol.

> *¿Se muestran los padres como grupos y los hijos filtrables?*

**No hay grupos.** Y esa ausencia es la que arregla el §1.2: en cuanto hay grupos hay un
techo de dos niveles, porque un grupo no puede contener otro grupo — ni en HTML ni,
visualmente, en un diálogo sin que se vuelva ilegible.

**Recomendación de filtrado (el detalle que decide si se siente bien):** filtrar sobre el
**`name` del nodo**, no sobre la etiqueta completa. Si se filtra sobre
«Vehículos › Coches › Deportivos», teclear «veh» devuelve **toda la rama** —decenas de
filas— y el filtro deja de filtrar. Filtrando sobre el nombre propio, «veh» devuelve
«Vehículos» y «coch» devuelve «Vehículos › Coches». El path sigue **mostrándose** entero;
sólo no se **busca** en él. Es la decisión 4 del §9, con una alternativa razonable
(buscar en el nombre y, si hay cero resultados, reintentar sobre el path).

### 3.2 Elegir padre o hijo: se mantiene, y se amplía

**Hoy** el `<select>` permite las dos cosas: la opción «Todo en {padre}»
([`SearchBar.tsx:175`](../apps/web/src/components/busqueda/SearchBar.tsx#L175)) tiene
`value={cat.slug}`, y cada hija la suya. Está bien que así sea, porque **el filtro es
jerárquico por construcción**: `categoryPath` contiene la cadena entera de ancestros, así
que elegir «Vehículos» devuelve también los coches (§1.2).

**Con `aplanar()`, TODOS los nodos son elegibles a cualquier profundidad.** La decisión de
producto no sólo se respeta: se completa.

⚠ **Lo que sí se pierde y hay que reponer con palabras:** el literal **«Todo en
Vehículos»** dice algo que «Vehículos» a secas no dice — que elegir el padre incluye a los
hijos. En la lista aplanada esa fila pasa a ser simplemente «Vehículos». **Recomendación:**
que las filas con descendencia lleven un contador o una coletilla discreta (p. ej.
`Vehículos · y sus 6 subcategorías`) en vez de recuperar el «Todo en», que en una lista
plana de cuatro niveles se leería peor.

### 3.3 El guard `{categories.length > 0}` — se mantiene, y aquí se nota más

Hoy: sin categorías (backend caído, `getCategories().catch(() => [])` en
[`page.tsx:30`](../apps/web/src/app/(public)/(home)/page.tsx#L30)), el `<select>`
**entero** no se pinta, y los chips «Populares» tampoco
([`SearchHomeBlockRenderer.tsx:34-35`](../apps/web/src/components/home/blocks/SearchHomeBlockRenderer.tsx#L34-L35)).
La portada degrada a «texto + provincia + buscar».

**El diálogo mantiene el guard tal cual: el disparador va dentro del mismo
`{categories.length > 0 && …}`.** Y hay un argumento nuevo para no relajarlo: un
disparador que abre un diálogo vacío es peor que un control ausente, porque promete una
lista y enseña un hueco. **Un `<select>` vacío se ve vacío; un diálogo vacío hay que
abrirlo para descubrirlo.**

---

## 4. EL DIÁLOGO DE UBICACIÓN — 52 provincias, cero municipios

### 4.1 Lo que se verificó

- [`lib/provincias.ts`](../apps/web/src/lib/provincias.ts) exporta **52 entradas**, lista
  plana alfabética, `as const` (tupla literal — importa para los tipos).
- **Cinco llevan grafía cooficial con barra:** `Alicante/Alacant`, `Araba/Álava`,
  `Castellón/Castelló`, `Valencia/València` y `Illes Balears` (esta última sin barra: es
  el nombre oficial único).
- Su cabecera (líneas 1-8) fija el contrato: son *«los mismos valores de `province` en
  `/data/municipios.json` … el string que queda guardado en `Listing.province` y el que
  `SearchService` filtra con match EXACTO»*.
- El match exacto, verificado en el backend:
  [`search.service.ts:645`](../apps/api/src/modules/search/search.service.ts#L645) —
  `` filters.push(`province = "${this.escape(params.province)}"`) ``.
- **Cuatro consumidores** comparten esa constante: `SearchBar`, `FilterPanel:806`,
  `SearchTableHomeBlockRenderer:62` y `SearchTableHomeBlockEditor:229`.

### 4.2 El filtro sobre las grafías cooficiales

El encargo pide que teclear «Alacant» encuentre `Alicante/Alacant`. **Sale gratis con el
`normalize()` de `MunicipioAutocomplete` y un `includes`**, porque la barra no separa
nada: `normalize('Alicante/Alacant').includes('alacant')` es `true`.

**Y el orden `startsWith`-primero se comporta bien con ellas**, que era la duda:

| Se teclea | Qué sale, y en qué orden |
|---|---|
| `bar` | `Barcelona` (startsWith) |
| `ala` | `Álava`→ **`Araba/Álava`** por `includes`; **`Alacant`** también por `includes` → desempata la longitud: `Araba/Álava` (11) antes que `Alicante/Alacant` (16) |
| `alac` | `Alicante/Alacant` |
| `valen` | `Valencia/València` (startsWith, y el acento ya no estorba por el NFD) |
| `caste` | `Castellón/Castelló` |

⚠ **Con 52 opciones, `MAX_RESULTS = 8` sobra y estorba.** En `MunicipioAutocomplete` ese
tope existe porque hay **8 132** municipios. Aquí la lista entera cabe en un diálogo con
scroll: **el diálogo de provincias se abre mostrando las 52**, y el campo de texto las va
recortando. Sin tope y **sin `MIN_QUERY_LENGTH`**: pedir dos caracteres antes de filtrar
tiene sentido cuando sin ellos habría 8 132 filas; con 52 es fricción sin motivo.

### 4.3 El valor que se envía — la invariante

> **El diálogo NUNCA envía lo tecleado. Envía la entrada exacta de `PROVINCIAS` que el
> usuario ha elegido.** El campo de texto **filtra**; no es el campo del valor.

Ésta es la diferencia de contrato del §2.1(b), y es lo que impide reusar
`MunicipioAutocomplete` tal cual: aquél llama a `onChange(val)` en cada tecla a propósito.
Aquí, **teclear no cambia `province`**; sólo elegir una fila lo hace. Si el usuario cierra
el diálogo sin elegir, `province` se queda como estaba.

La consecuencia práctica es la que el encargo teme y queda cerrada por construcción: no
hay forma de mandar `province=Alacant` ni `province=alicante`, porque el único camino que
escribe el estado es el que copia una entrada de la constante.

### 4.4 Los 8 132 municipios siguen fuera de la portada

Verificado: `apps/web/public/data/municipios.json` pesa **380 487 bytes (372 KB)**, se
sirve como estático y **la portada no lo pide ni lo pedirá** — sólo lo carga
`MunicipioAutocomplete.loadDataset()`, bajo demanda, y ese componente **no se monta en la
portada** (sus consumidores son el wizard de publicar y la edición de anuncio).

**El diálogo de ubicación no cambia nada de esto**: sus datos son la constante
`PROVINCIAS`, que ya viaja en el bundle del `SearchBar` de hoy. **Coste de datos añadido
por la ráfaga: cero bytes.**

---

## 5. LA INTEGRACIÓN — con el hero montado y entre los cuatro controles

### 5.1 Con el hero: lo que NO se puede tocar

La ráfaga D montó el buscador sobre la banda con **aritmética literal**:

```
montado = block.overlapHero ? 'relative -mt-[5.5rem] md:-mt-[6.5rem]' : ''
```
([`SearchHomeBlockRenderer.tsx:56-58`](../apps/web/src/components/home/blocks/SearchHomeBlockRenderer.tsx#L56-L58))

Su comentario dice de dónde salen esos números: *«los 48 px de `py-12` del contenedor de
bloques MÁS unos 40 de solape real»*, y que es una clase **literal** porque Tailwind purga
lo que no ve escrito.

> **La regla para esta ráfaga, en una línea: el bloque buscador, con los diálogos
> CERRADOS, tiene que ocupar exactamente la misma caja que hoy.** El solape está calibrado
> contra ese alto. Si el disparador mide distinto que el `<select>`, el solape se
> descalibra y el arreglo no es «ajustar el `-mt-`» (que además rompería la captura de
> `publico-portada-pantalla`): es no cambiar el alto.

Lo que **sí** puede hacer la ráfaga sin tocar nada del hero:

- **La banda ya manda su ambiente por token** (`var(--hero-ambiente)` /
  `var(--hero-patron)`, [`HomeHeroBanda.tsx:81-89`](../apps/web/src/components/home/HomeHeroBanda.tsx#L81-L89)).
  El buscador se monta **por encima** con `bg-background` y su `shadow-lg`
  ([`SearchBar.tsx:161`](../apps/web/src/components/busqueda/SearchBar.tsx#L161)). Ese
  contraste —caja opaca sobre ambiente— **es el montaje**, y es lo que hay que conservar:
  volver el buscador translúcido sobre la banda lo desmonta.
- **El velo del diálogo es `bg-black/80`** ([`dialog.tsx:76`](../apps/web/src/components/ui/dialog.tsx#L76)),
  un literal que **no sigue al modelo**. Sobre el hero de un modelo claro se ve bien; en
  `premium@oscuro` es negro sobre carbón. **No es alcance de esta ráfaga** (toca a los ~25
  diálogos del sitio), pero conviene anotarlo: es la clase de cosa que se ve primero en la
  captura del diálogo abierto sobre la portada. Va como deuda del §10.

### 5.2 Entre los cuatro controles: la pieza coherente

El §1.4 midió que hoy no lo son. **Lo que la ráfaga tiene que decidir es UNA escala de
alto y aplicarla a los cuatro**, y hay una restricción dura que la acota:

> ⚠ **El input de texto NO puede encoger.** Es el candidato a LCP
> ([`diseno-escaparate.md §5.2`](diseno-escaparate.md)) y es lo que da al buscador su
> peso visual sobre la banda. La coherencia se consigue **subiendo los otros tres hasta
> él**, no bajándolo a él.

| | Hoy | Propuesta |
|---|---|---|
| Alto móvil | 48 / 48 / 56 / 56 | **56 en los cuatro** (`h-14`) |
| Alto `md:` | `h-full` / `h-full` / 64 / 64 | **64 en los cuatro** (`md:h-16`), sin `md:h-full` |
| Radio | `rounded-xl` en los cuatro | igual — **ya está tokenizado** (ráfaga A) |
| Separación | `border-r` entre celdas (`md:`), `border-b` (móvil) | igual: es lo que hace que se lean como **una** pieza y no como cuatro cajas |

**Quitar el `md:h-full` es parte del arreglo, no un efecto colateral:** ese `h-full` es lo
que hoy hace que el alto del select **dependa** del alto del input. Con un valor declarado,
los cuatro controles dicen su alto y la fila deja de tener un control que manda y tres que
obedecen.

**El disparador mantiene la anchura de su celda** (`md:w-48` categoría, `md:w-44`
provincia, líneas 164 y 188) y, dentro, muestra **el valor elegido o el texto de reposo**
(«Categoría» / «Toda España») — que es exactamente lo que un `<select>` muestra hoy. Con
un chevron a la derecha, como `MunicipioAutocomplete`
([líneas 195-198](../apps/web/src/components/municipio/MunicipioAutocomplete.tsx#L195-L198)).

⚠ **Tres detalles de interacción que sólo aparecen al meter un diálogo dentro de un
`<form>`:**

1. **`type="button"` en el disparador.** Un `<button>` dentro de un `<form>` es `submit`
   por defecto: abrir el diálogo lanzaría la búsqueda. Radix ya lo pone
   (`@radix-ui/react-dialog/dist/index.mjs:67`), pero si el disparador se escribe a mano
   con `asChild`, es del autor.
2. **El velo cierra el desplegable de etiquetas.** `SearchBar` cierra sus sugerencias con
   un `mousedown` fuera del `<form>`
   ([líneas 69-75](../apps/web/src/components/busqueda/SearchBar.tsx#L69-L75)); el velo del
   diálogo se monta en `<body>`, o sea **fuera**. Abrir el diálogo cerrará el desplegable
   de sugerencias si estaba abierto. **Es el comportamiento correcto** —no deben convivir
   dos capas— pero hay que verificarlo, no descubrirlo.
3. **`Esc` tiene dos dueños.** Hoy `Esc` sobre el input cierra las sugerencias
   ([línea 137](../apps/web/src/components/busqueda/SearchBar.tsx#L137)). Con el diálogo
   abierto, Radix se lo queda y cierra el diálogo. No chocan (son estados excluyentes),
   pero es lo primero que probaría alguien con teclado.

---

## 6. POR MODELO/VERSIÓN Y RESPONSIVE

### 6.1 El sabor por tokens: en la portada, gratis — y el porqué importa

El encargo pide «verificar que el diálogo nuevo usa el mecanismo del `data-zona` en el
portal». **Verificado, y la respuesta tiene un matiz que conviene no leer al revés:**

- `ui/dialog.tsx` declara `data-zona={useZona()}` **en los dos nodos portalados** (velo,
  línea 74; contenido, línea 93). Lo prueban
  [`zona.test.tsx`](../apps/web/src/components/estilo/zona.test.tsx) (los cuatro genéricos
  lo declaran) y [`estilo-zona-overlays.spec.ts`](../apps/web/e2e/estilo-zona-overlays.spec.ts)
  (los tokens **computados** dentro de la capa son los de su zona, contrastados contra los
  del `<html>`).
- **La portada es zona PÚBLICA, y la pública es la BASE**: no tiene bloque propio,
  `useZona()` devuelve `undefined`, `data-zona` **no se emite** y la capa hereda de
  `html:root` — *«que es justamente lo que es lo público»*
  ([`zona.tsx`](../apps/web/src/components/estilo/zona.tsx), cierre del comentario).

> **O sea: en la portada un diálogo ya recibe el sabor del modelo y de la versión activos
> sin que la ráfaga monte nada.** El `<html>` lleva los tokens del modelo·versión activo,
> y el diálogo, al no declarar zona, los hereda.
>
> **La condición es construirlo sobre `ui/dialog.tsx`.** Si se construye sobre
> `DialogPrimitive` a pelo —como hizo `AdminMobileNav` por geometría— hay que declarar la
> zona a mano, y en la portada eso significaría `undefined`… hasta el día que el molde se
> reuse en `/busqueda` (también público, sin problema) o, peor, en cualquier pantalla de
> zona. **Es exactamente el defecto que E6 cerró; no conviene reabrirlo por una geometría.**

**Qué revestirá cada modelo, sin una línea por modelo:** `--background`, `--foreground`,
`--accent` (el resaltado de la fila activa), `--ring` (el anillo de foco del campo de
filtro), `--radius` vía `rounded-*` y **`--motion-duration` / `--motion-ease`** (la entrada
de la capa, `dialog.tsx:96`). Los cinco modelos del catálogo —`modelo-0`,
`fresco-confianza`, `premium@claro`, `premium@oscuro`, `vibrante@pop`— ya declaran todos
esos tokens, incluida la versión que **invierte la luz**.

### 6.2 Escritorio y móvil

**Escritorio (≥ `md`):** el `DialogContent` de casa ya es `w-full max-w-lg` centrado
(línea 95). Para una lista de 52 provincias o de N categorías hace falta **alto máximo y
scroll interno** — con el campo de filtro FIJO arriba, que si scrollea con la lista el
diálogo deja de sentirse como un buscador. Es `className`, no un componente nuevo.

**Móvil (< `md`): sí, a pantalla completa.** Y la recomendación no es estética:

- La lista de categorías a cuatro niveles puede pasar de 50 filas. Un cuadro centrado de
  `max-w-lg` en 375 px con scroll interno **y** la página scrolleando por detrás es la
  interacción que peor se lleva en un móvil.
- Al enfocar el campo de filtro **sube el teclado** y se come la mitad baja de la
  pantalla. Un cuadro centrado queda partido; una hoja a pantalla completa se recoloca.
- **Ya hay molde para esa geometría en el repo**, y hecho con este mismo primitivo:
  [`AdminMobileNav`](../apps/web/src/app/(admin)/components/AdminMobileNav.tsx) y
  `AccountMobileBar` son paneles anclados al borde sobre `DialogPrimitive`, con el velo y
  las animaciones copiadas de `dialog.tsx`. **Es una decisión ya tomada en esta casa, no
  una que haya que inventar.**

⚠ **La consecuencia estructural, y es la que hay que aceptar a conciencia:** la frontera
(«un modelo reviste, no reorganiza») **no se rompe** por esto, porque la diferencia
escritorio/móvil es un **breakpoint de CSS**, no una rama de React. El mismo árbol, dos
revestimientos. **Lo que sí sería una violación es un `useMediaQuery` que monte un árbol
en móvil y otro en escritorio** — eso pondría roja la invariancia, y con razón. **La regla:
el diálogo es un solo árbol; la pantalla completa se consigue con clases `md:`.**

### 6.3 La invariancia, ruta por ruta

| Qué mira el test | Efecto de la ráfaga |
|---|---|
| `/` está en las dos pruebas (es **la** ruta medida de la segunda) | ✅ el diálogo **cerrado** no monta contenido: el árbol gana un `<button>` y pierde un `<select>` + sus `<option>`. Común a los cinco modelos |
| Compara **todo el texto** | ✅ los nombres de provincia y de categoría salen del HTML servido **para todos los modelos por igual** → los dos árboles siguen coincidiendo |
| Ignora `id`, `aria-controls`, `aria-activedescendant`… porque «Radix los numera por orden de montaje» ([líneas 151-161](../apps/web/e2e/estilo-invariancia.spec.ts#L151-L161)) | ✅ ya cubre lo que un diálogo de Radix añade |
| Marcador de `/`: `'Búsquedas frecuentes'` ([línea 314](../apps/web/e2e/estilo-invariancia.spec.ts#L314)) | ✅ es del bloque `searchTable`, no del `search`: la ráfaga no lo toca |

> **El test pasa por construcción si el diálogo es estructura común. Y se pondría rojo —
> con razón— si a alguien se le ocurriera que un modelo sobrio muestre un `<select>` y uno
> vistoso un diálogo.** Ésa es la invariancia verde que pide el encargo, y aquí es una
> barrera real, no una intención.

---

## 7. EL SEO Y EL RENDIMIENTO — la portada es la de más tráfico

### 7.1 El peso: cero datos nuevos, algo de JS

| Concepto | Hoy | Con diálogos |
|---|---|---|
| Árbol de categorías | ya viaja (SSR, `page.tsx:30`) | **igual** |
| `PROVINCIAS` | ya en el bundle (52 strings) | **igual** |
| `municipios.json` (372 KB) | **no se carga** | **sigue sin cargarse** |
| `@radix-ui/react-dialog` | **ya en el bundle de la portada**† | igual |
| JS nuevo | — | el componente del diálogo (decenas de líneas) |

† Verificado: la cabecera pública monta `AccountMobileBar` / diálogos del layout, y
`@radix-ui/react-dialog` es dependencia directa (`package.json:21`). **Conviene medirlo
con el analizador antes de afirmarlo en el commit** — si resultara que no está en el chunk
de la portada, entra, y entonces sí hay peso nuevo que declarar.

**El diálogo no se abre en el render inicial**: su contenido sólo se monta al abrirlo
(Radix desmonta el portal cerrado). Es el mismo patrón de carga bajo demanda que
`MunicipioAutocomplete` aplica a su dataset, sin necesitar `fetch`.

### 7.2 El LCP: intacto — con una condición

`diseno-escaparate.md §5.2` deja escrito que con el buscador montado el candidato a LCP es
**el `<h1>` o la caja del buscador**, y que los dos son seguros porque **ninguno se anima**.

- **El `<h1>`** no lo toca esta ráfaga.
- **La caja del buscador** sigue siendo HTML servido: el `<form>`, el `<input>`, el botón
  y los disparadores están en la respuesta. **El diálogo no forma parte del LCP porque no
  está pintado.**
- **La condición:** que ni el disparador ni el `<form>` ganen una animación de entrada.
  La regla 4 de E6 (*«el LCP no se anima»*) sigue aplicando literalmente.

### 7.3 Lo que sí se pierde del HTML, dicho sin adornos

Hoy el HTML de la portada contiene, como texto de `<option>`, **los 52 nombres de
provincia y el nombre de cada categoría de dos niveles**. Con el diálogo, ese texto **deja
de estar en el HTML inicial**.

**Valoración honesta:** el impacto SEO es **bajo, no nulo**.

- No se pierde **ni un enlace**: un `<option>` no es un `<a>`. Los enlaces internos a
  categorías de la portada los ponen los chips «Populares»
  ([`SearchHomeBlockRenderer.tsx:70-86`](../apps/web/src/components/home/blocks/SearchHomeBlockRenderer.tsx#L70-L86))
  y el bloque `searchTable`, **y esta ráfaga no toca ninguno de los dos**. El
  `searchTable` es precisamente el bloque cuyo motivo de existir son *«cientos de enlaces
  internos a búsquedas que un crawler tiene que ver»*
  ([`SearchTabs.tsx:12-18`](../apps/web/src/components/home/blocks/SearchTabs.tsx#L12-L18)).
- Lo que se pierde es **texto de control**, no contenido. Un crawler que hoy lee «Almería»
  dentro de un `<option>` no le está dando a la portada relevancia para «Almería».

⚠ **Pero hay un coste que no es de crawler y sí es real: sin JS, la portada pierde los dos
filtros.** Es el §8.

---

## 8. LA DECISIÓN QUE ESTA AUDITORÍA NO PUEDE TOMAR: el buscador sin JavaScript

Es la única cosa del encargo que **choca de frente con algo escrito y defendido en el
repo**, y va aparte para que no se decida por inercia.

**Lo que está escrito, en dos sitios:**

> *«Su marcado es un `<form>` nativo con dos `<select>` y un `<input type="search">`:
> **está entero en el HTML servido y funciona sin JS**. El JS solo añade las sugerencias
> de etiquetas y la navegación con flechas. Es el patrón de isla sobre contenido ya
> presente que exige el diseño (§3 de las decisiones de partida).»*
> — [`SearchHomeBlockRenderer.tsx:12-18`](../apps/web/src/components/home/blocks/SearchHomeBlockRenderer.tsx#L12-L18)

> *«`SearchBar` es `'use client'` pero su marcado es un `<form>` nativo que viaja entero en
> la respuesta y funciona sin JS.»*
> — [`diseno-escaparate.md §5.2`](diseno-escaparate.md), usado como argumento de que el LCP
> del hero montado es seguro

**Lo que un diálogo de Radix hace con eso:** lo termina. Sin JS, el disparador es un botón
que no abre nada. El `<form>`, el `<input>` y el botón «Buscar» **siguen funcionando** —la
búsqueda de texto libre sobrevive entera—, pero **categoría y provincia dejan de estar
disponibles**.

**La medida de cuánto importa, verificada:** hoy ninguna de las dos afirmaciones está
respaldada por un test. No hay ninguna spec con JS desactivado en `apps/web/e2e/`. **Es
una propiedad documentada y defendida, pero no vigilada.** Eso no la hace menos cierta;
hace que romperla no ponga nada rojo, que es justamente por lo que conviene decidirlo a
conciencia y no descubrirlo.

**Las tres salidas, con su coste real:**

| Salida | Qué cuesta | Qué se pierde |
|---|---|---|
| **A. Se acepta.** El buscador pasa a exigir JS para filtrar por categoría/provincia | Actualizar los dos comentarios y el §5.2 del diseño | La degradación sin JS de los dos filtros |
| **B. `<noscript>` con los dos `<select>` de hoy** | Poco: el marcado ya existe, se mueve | Nada funcional — pero **rompería la invariancia si no se emite igual para todos los modelos** (se emite igual: es estructura común, así que no la rompe) |
| **C. `<select>` real, y el diálogo lo mejora encima** | Mucho: dos controles sincronizados, y el `<select>` nativo volvería a aparecer en la captura | Nada — pero es el diseño más caro y el más fácil de que se desincronice |

**Recomendación: A, con B si Ernest lo quiere barato.** El argumento para A es que
`SearchBar` **ya es `'use client'`** y que sus dos funciones más valiosas —las sugerencias
de etiqueta (B4) y la navegación a la URL canónica de la categoría (A1)— **ya exigen JS
hoy**. Sin JS, el `<select>` de categoría de hoy tampoco lleva a `/vehiculos/coches`:
lleva a `/busqueda`, porque `navegar()` no corre. **La degradación sin JS ya era parcial.**

Es la decisión 1 del §9.

---

## 9. LAS DECISIONES PARA ERNEST

> Seis. Las tres primeras condicionan el diseño entero; las tres últimas son de detalle y
> tienen recomendación clara.

**1. El buscador sin JavaScript (§8).** ¿Se acepta que categoría y provincia pasen a
exigir JS (**A**), se repone con un `<noscript>` (**B**), o se mantiene el `<select>` real
debajo (**C**)? → *Recomendación: **A**, y actualizar los dos comentarios que afirman lo
contrario en la misma ráfaga.*

**2. El diálogo en móvil (§6.2).** ¿Hoja a pantalla completa (molde `AdminMobileNav`) o
cuadro centrado con scroll interno? → *Recomendación: **hoja a pantalla completa**, por el
teclado y por las 50+ filas. Un solo árbol, la geometría por clases `md:`.*

**3. ¿Los niveles 3 y 4 entran (§1.2)?** El diálogo puede ofrecerlos; el `<select>` no
podía. ¿Se ofrece el árbol completo o se conserva el techo de dos niveles para no cambiar
lo que el usuario ve? → *Recomendación: **el árbol completo**. El techo era del
`<optgroup>`, no una decisión de producto, y el filtro backend ya soporta la profundidad.*

**4. Sobre qué filtra el texto en categorías (§3.1).** ¿Sólo el nombre del nodo («veh» →
`Vehículos`) o el path completo («veh» → toda la rama)? → *Recomendación: **el nombre**,
con el path visible pero no buscado. Alternativa aceptable: nombre primero y, con cero
resultados, reintento sobre el path.*

**5. La primera fila, ¿resaltada de salida (§2.1)?** `MunicipioAutocomplete` no lo hace
(`activeIndex = -1`). En un diálogo donde la lista ES el contenido, resaltarla hace que
`Enter` haga lo evidente. → *Recomendación: **sí**, resaltar la primera coincidencia en
cuanto hay texto; sin texto, resaltar la opción actualmente elegida.*

**6. Cómo se dice «Todo en Vehículos» en una lista plana (§3.2).** → *Recomendación: una
coletilla discreta con el número de subcategorías, no el literal «Todo en».*

---

## 10. LAS DEUDAS QUE ESTA RÁFAGA DESTAPA Y NO ARREGLA

Ninguna bloquea. Todas conviene que estén escritas antes de diseñar, no después.

1. **El velo `bg-black/80` no sigue al modelo** (`dialog.tsx:76`). Es un literal en el
   componente compartido por los ~25 diálogos del sitio. Sobre la portada de
   `premium@oscuro` es negro sobre carbón. **Arreglarlo aquí sería cambiar 25 pantallas en
   la ráfaga del buscador.** Va a su propia ráfaga.
2. **`estado-tecnico.md` ~L313 dice que `categoryPath` sólo soporta 2 niveles.** Es falso
   desde PROFUNDIDAD N · RÁFAGA 2 (§1.2). Corregir **en esta ráfaga**: cuesta una línea y
   es justo la nota que haría dudar sobre la decisión 3.
3. **No hay ninguna spec que corra sin JS**, y hay dos comentarios que afirman que la
   portada funciona así (§8). O se vigila o se deja de afirmar.
4. **`FilterPanel:800-808` tiene el mismo `<select>` de provincia** y el mismo problema.
   Fuera de alcance por el encargo — y es exactamente lo que la ráfaga de unificación de
   `/busqueda` recogerá, si el molde sale reusable.

---

## 11. EL PLAN DE RÁFAGAS

Cuatro, en el orden que exige la regla de la casa —**las barreras antes de repintar**
([`diseno-escaparate.md §0.2`](diseno-escaparate.md))—, porque aquí la barrera que falta
es justo la del diálogo abierto.

### BQ-A · La barrera, antes de tocar nada — **cambio visual nulo**

- Una **captura nueva del diálogo abierto** sobre la portada, en el molde de
  [`overlays.spec.ts`](../apps/web/e2e-snapshots/overlays.spec.ts) (que ya fotografía un
  `SelectContent` y un cajón abiertos): `overlay-buscador-categoria`. **Escritorio y
  móvil**, que es donde vive la decisión 2. Se toma **después** de BQ-B — en A sólo se
  escribe el andamio de la portada medible, que ya existe (`ponerPortadaEscaparate`).
- **Lo que sí se hace en A:** dejar preparado el punto de entrada de e2e. Hoy los
  disparadores se localizan con `getByLabel('Categoría')` /
  `getByLabel('Provincia')` ([`buscador-sugerencias.spec.ts:58` y `:84`](../apps/web/e2e/buscador-sugerencias.spec.ts#L58)),
  con `selectOption`. **Esas dos líneas se van a romper**, y es la única rotura de e2e que
  esta auditoría ha encontrado. Decidir en A el localizador definitivo (mantener el mismo
  `aria-label` en el disparador es lo que menos cambia).
- **Salida:** CI verde, cero píxeles movidos.

### BQ-B · El molde y los dos diálogos — **aquí cambia el aspecto**

- `DialogoFiltrable` sobre `ui/dialog.tsx` (§2.2), **sin saber qué es una categoría**.
- Los dos usos: categoría (`aplanar`, §3) y provincia (`PROVINCIAS`, §4).
- Las dos líneas de `buscador-sugerencias.spec.ts` reescritas. **El resto de esa spec no
  se toca** — es el contrato de B4 y tiene que seguir verde palabra por palabra: las
  sugerencias, el texto libre, la etiqueta con y sin categoría, la provincia que viaja con
  la etiqueta.
- **`publico-portada` (escritorio + móvil) se pondrá roja. ÉSE ES EL ENTREGABLE**: el diff
  sale del artefacto de CI, no de una descripción en prosa
  ([`diseno-escaparate.md §3.5`](diseno-escaparate.md)).
- **Barreras que tienen que seguir verdes sin tocarlas:** `estilo-invariancia` (§6.3) y
  `portada-hero` / `portada-bloques`.

### BQ-C · La integración — los cuatro controles y el montaje

- La escala de alto única (§5.2), el `md:h-full` fuera.
- Verificar a mano los tres detalles de interacción del §5.2 (el `type`, el velo contra el
  desplegable, los dos dueños de `Esc`).
- **Comprobar que el bloque montado no ha cambiado de alto** (§5.1) —
  `publico-portada-pantalla` es la captura que lo dice.

### BQ-D · La vuelta por los cinco modelos

- Los cinco del catálogo × la portada, en escritorio y móvil, **con el diálogo abierto**.
  Los cinco están ya enumerados con sus colores de fábrica en
  [`estilo-invariancia.spec.ts:358-378`](../apps/web/e2e/estilo-invariancia.spec.ts#L358-L378),
  incluida `premium@oscuro`, que es la que invierte la luz.
- Es donde se vería lo del velo (§10.1), si se decide meterlo.

---

## 12. LO VERIFICADO EN ESTA SESIÓN

Todo lo afirmado arriba sale de estas lecturas. Lo que no está aquí, no se afirmó.

| Fichero | Qué se comprobó |
|---|---|
| `components/busqueda/SearchBar.tsx` | Los dos `<select>`, el guard `categories.length > 0` (L163), el submit (L124-133), `navegar()` (L85-100), la dependencia `[query, category]` (L66), el cierre por clic fuera (L69-75), los altos y radios de los cuatro controles (L161-242) |
| `components/municipio/MunicipioAutocomplete.tsx` | `normalize` NFD (L28-31), `MAX_RESULTS=8` (L33), `MIN_QUERY_LENGTH=2` (L35), el orden `startsWith`+longitud (L66-75), `loadDataset` (L79-89), el bloque ARIA (L174-180), el teclado (L112-143) |
| `components/busqueda/CategorySelect.tsx` | `aplanar()` (L93-104), el separador `' › '` (L73), el porqué de no anidar `<optgroup>` (L79-82), «saltar vs explorar» (L84-88), `findTarget` con `cadenaHasta` (L112-128) |
| `lib/category-tree.ts` | `recorrerArbol`, `buscarEnArbol`, `cadenaHasta`, `conDescendientes`; los seis ficheros migrados de 2 niveles a N |
| `lib/provincias.ts` | **52** entradas, `as const`, cinco grafías cooficiales, el contrato de match exacto (L1-8) |
| `lib/api/categorias.ts` | `getCategories()` → `GET /categories` (árbol completo); `suggestTags(q, category, signal)` |
| `types/index.ts` | `Category.children`, `ancestorSlugs`, `parentSlug` (L159-186) |
| `components/ui/dialog.tsx` | `data-zona` en **los dos** nodos portalados (L74, L93), la animación por `--motion-duration` (L31-58), el cierre `sr-only` (L102-107), `max-w-lg` centrado (L95), el velo `bg-black/80` (L76) |
| `components/estilo/zona.tsx` | `useZona()` → `undefined` fuera de las cuatro zonas; la pública **es** la base |
| `components/home/blocks/SearchHomeBlockRenderer.tsx` | El «funciona sin JS» (L12-18), `overlapHero` / `-mt-[5.5rem]` (L39-58), los chips «Populares» (L70-86) |
| `components/home/HomeHeroBanda.tsx` | `var(--hero-ambiente)` / `var(--hero-patron)`, las tres alturas, «los dos nodos son comunes a los cinco modelos» |
| `app/(public)/(home)/page.tsx` | `getCategories().catch(() => [])` (L30); las categorías bajan por props, una sola carga |
| `e2e/estilo-invariancia.spec.ts` | `/` en las dos pruebas, los atributos ignorados (L151-161), el marcador `'Búsquedas frecuentes'` (L314), los cinco modelos del catálogo (L358-378) |
| `e2e-snapshots/pantallas.spec.ts` + `overlays.spec.ts` | `publico-portada` y `publico-portada-pantalla` existen (escritorio y móvil, `linux` y `win32`); el molde de «overlay abierto» |
| `e2e/buscador-sugerencias.spec.ts` | **L58 y L84 son las dos únicas líneas de e2e que se rompen** |
| `e2e/busqueda-unificada.spec.ts` | Su `selectOption` es del `CategorySelect` de `/busqueda`, **no** de la portada → fuera de alcance |
| `api/.../search.service.ts` | `province = "…"` exacto (L645); `categoryPath` desde la cadena entera (L467, L795); contención en array (L640) |
| `api/.../category.types.ts` | `CATEGORY_MAX_DEPTH = 4` (L38) y su test |
| `apps/web/package.json` | **No hay `cmdk`**; `@radix-ui/react-dialog` sí (L21); `tailwindcss-animate` instalado (L65) |
| `apps/web/public/data/municipios.json` | **380 487 bytes** — y la portada no lo pide |
| `tailwind.config.ts` | `xl/2xl/3xl` atados a `--radius` desde la ráfaga A (L95-110) |
| `playwright.snapshots.config.ts` | Dos proyectos: `escritorio` 1280×720, `movil` 375×667 |

---

### Una línea de cierre

El encargo pide dos diálogos filtrables y resulta que el repo ya tiene las cuatro piezas
para construirlos, una de ellas —`aplanar()`— escrita para resolver exactamente el
problema del árbol de cuatro niveles que el `<select>` de la portada no puede expresar.
**Lo que la ráfaga tiene que decidir de verdad no es cómo filtrar una lista: es si el
buscador de la portada puede dejar de funcionar sin JavaScript.** Todo lo demás ya está
medido.
