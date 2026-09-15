# Diseño — El buscador de la portada: dos diálogos filtrables

> **Sobre las 6 decisiones aprobadas.** Se desarrollan, no se reabren.
>
> **Alcance:** SOLO la portada. El molde se diseña **reutilizable** para que la
> unificación de `/busqueda` lo consuma sin reescribirlo, pero esa ráfaga no es ésta.
>
> **Documento de arquitectura y plan. Cero código.** Todo lo afirmado está verificado
> contra el árbol en `main` (`86b14dc`). La auditoría previa es
> [`auditoria-buscador.md`](auditoria-buscador.md); aquí no se repite lo que allí está
> medido, se decide qué se construye con ello.

---

## 0. El marco

### 0.1 Las 6 decisiones aprobadas

| # | Decisión | Dónde se desarrolla |
|---|---|---|
| **1** | **El buscador REQUIERE JS.** La degradación sin JS ya era parcial | §8 (la corrección de `diseno-escaparate §5.2`) |
| **2** | **Móvil: los diálogos a PANTALLA COMPLETA** (sheet) | §6.2 |
| **3** | **Los niveles 3-4 de categoría, ALCANZABLES.** El diálogo cierra el agujero del `<select>` | §3 |
| **4** | El filtro de categoría busca **sobre el nombre del nodo**, con el path visible | §3.3 |
| **5** | **La primera coincidencia se resalta** de salida; sin texto, se resalta la elegida | §2.5 |
| **6** | «Todo en X» se sustituye por una **coletilla con el número de subcategorías** | §3.4 |

### 0.2 La regla de orden, heredada del escaparate

**Las barreras antes de repintar** ([`diseno-escaparate.md §0.2`](diseno-escaparate.md)).
Aquí la barrera que falta no es la invariancia —que ya cubre `/`— sino **la captura del
diálogo ABIERTO**, que hoy no existe para ninguna superficie pública. Por eso la primera
ráfaga no toca el buscador (§11).

### 0.3 Las cuatro capas, y en cuál cae cada pieza

| Capa | Quién decide | Qué cae aquí |
|---|---|---|
| **Estructura** (inviolable) | el código, igual para los cinco modelos | El disparador, el diálogo, el campo de filtro, la lista, el orden de las filas |
| **Revestimiento** | el modelo·versión, por tokens | Lienzo, tipografía, radio, tempo de la capa, color del resaltado |
| **Geometría responsive** | breakpoints CSS, iguales para todos | Popup centrado ≥ `md`, hoja a pantalla completa < `md` |
| **Contenido editorial** | el admin | Nada. **El buscador no gana un solo campo de configuración** (§9.5) |

---

## 1. La arquitectura en una página

### 1.1 Los tres componentes nuevos, y por qué son tres y no uno

```
components/busqueda/
  SearchBar.tsx                   ← EXISTE. Pierde dos <select>, gana dos disparadores.
                                    navegar(), paramsBase(), el efecto de sugerencias
                                    y el guard NO SE TOCAN.
  CategoriaDialogo.tsx            ← NUEVO. Sabe qué es una categoría. ~40 líneas.
  ProvinciaDialogo.tsx            ← NUEVO. Sabe qué es una provincia. ~25 líneas.

components/ui/
  dialogo-filtrable.tsx           ← NUEVO. El molde. NO sabe qué es ninguna de las dos.
```

**Por qué el molde vive en `ui/` y no en `busqueda/`:** porque su único requisito de
dominio es «una lista de cosas con etiqueta». Ponerlo en `busqueda/` lo ataría a esta
página, y la decisión de reutilizarlo en `/busqueda` —y, más adelante, en el `FilterPanel`,
que tiene el mismo `<select>` de provincia
([`FilterPanel.tsx:800-808`](../apps/web/src/components/busqueda/FilterPanel.tsx#L800-L808))—
ya está tomada.

**Por qué dos envoltorios y no un `DialogoFiltrable` parametrizado desde `SearchBar`:**
porque `SearchBar` ya es un componente de 314 líneas con cinco piezas de estado y dos
efectos. Meterle dentro `aplanar()`, el mapeo de `PROVINCIAS` y dos bloques de props lo
convierte en el sitio donde vive todo. Los dos envoltorios son **adaptadores de dominio a
molde**, y es lo que hace que el molde pueda no saber nada.

### 1.2 El sabor por modelo, sin una línea por modelo

Igual que el resto del escaparate: **ni un `if (modelo === …)` en ningún sitio**. El
diálogo recibe los tokens por herencia de CSS (§6.1) y el molde no consulta el modelo
activo en ninguna parte. Si alguna vez lo hiciera, el test de invariancia se pondría rojo
— y tendría razón.

---

## 2. EL MOLDE — `DialogoFiltrable`

### 2.1 De dónde sale cada pieza (nada es nuevo)

| Pieza | Origen verificado |
|---|---|
| La capa, el portal, el velo, el `Esc`, el foco atrapado | [`ui/dialog.tsx`](../apps/web/src/components/ui/dialog.tsx) — **se construye SOBRE él**, §2.2 |
| `data-zona` en los **dos** nodos portalados | `dialog.tsx:74` (velo) y `:93` (contenido) |
| Animación atada a `--motion-duration` / `--motion-ease` | `dialog.tsx:96`, con las dos ausencias deliberadas documentadas en `:31-58` |
| Cerrar con `sr-only` ya traducido | `dialog.tsx:102-107` |
| `normalize()` NFD (quita tildes, minúsculas) | [`MunicipioAutocomplete.tsx:28-31`](../apps/web/src/components/municipio/MunicipioAutocomplete.tsx#L28-L31) |
| Orden `startsWith` primero, desempate por longitud | `MunicipioAutocomplete.tsx:66-75` |
| `role=combobox/listbox/option` + `aria-activedescendant` | `MunicipioAutocomplete.tsx:174-180` y `:201-227` |
| Teclado `↑ ↓ Enter Esc Tab` | `MunicipioAutocomplete.tsx:112-143` |
| El aplanado del árbol a rutas «A › B › C» | [`CategorySelect.tsx:93-104`](../apps/web/src/components/busqueda/CategorySelect.tsx#L93-L104) |

### 2.2 SOBRE `ui/dialog.tsx`, NO sobre `DialogPrimitive` — y por qué es una regla, no una preferencia

`AdminMobileNav` y `AccountMobileBar` **sí** se construyeron sobre `DialogPrimitive` a
pelo, y dejaron escrito por qué: *«no se reusa `DialogContent` porque aquel centra un
cuadro (`left-1/2 top-1/2 translate`) y esto es un panel anclado al borde: mismo
primitivo, distinta geometría»*.

**Ese argumento aquí no aplica, y es importante ver la diferencia.** Aquellos dos son
paneles anclados al borde **siempre**. El `DialogoFiltrable` es un **cuadro centrado en
escritorio** (la geometría exacta de `DialogContent`) que **en móvil se estira hasta el
borde**. O sea: la geometría base es la de `DialogContent`, y lo de móvil es una
sobrescritura por breakpoint — exactamente para lo que `DialogContent` acepta `className`.

**Y el coste de bajarse al primitivo sería concreto, no teórico:** habría que reescribir a
mano el `data-zona` en los dos nodos portalados. `AdminMobileNav` pudo saltárselo porque
**pertenece a una zona por construcción y se la escribe a mano** (así lo cerró E6). Un
componente genérico no puede: es el caso exacto que
[`zona.tsx`](../apps/web/src/components/estilo/zona.tsx) describe —*«`dialog`,
`alert-dialog`, `dropdown-menu` y `select` son genéricos: el mismo componente se abre en
el backoffice, en la cuenta y en el blog, y no puede saber dónde está»*—. En la portada
saldría `undefined`, que es lo correcto… hasta el día que alguien monte el molde dentro de
una zona y descubra que hereda de la base.

> **Regla: el `DialogoFiltrable` usa `Dialog`, `DialogTrigger`, `DialogContent`,
> `DialogTitle` y `DialogDescription` de `ui/dialog.tsx`. Lo único que añade por su cuenta
> es `className`.**

### 2.3 La interfaz — qué recibe y qué devuelve

El molde recibe **datos ya normalizados**, no árboles ni constantes. Quien sabe de dominio
es el envoltorio.

| Entrada | Tipo (en prosa) | Por qué existe |
|---|---|---|
| `opciones` | Lista de `{ valor, etiqueta, contexto?, buscable }` | `valor` = lo que se guarda (slug, provincia exacta). `etiqueta` = lo que se lee. `contexto` = el path de ancestros, que se **muestra** y no se **busca** (§3.3). `buscable` = la cadena sobre la que filtra el texto |
| `valor` | El valor actualmente elegido, o vacío | Para marcar la fila activa y para pintar el disparador |
| `onElegir` | Llamado **sólo** al elegir una fila | ⚠ **No se llama al teclear.** Es la invariante del §4.3 |
| `etiquetaVacio` | Texto del disparador sin selección | «Categoría» / «Toda España» |
| `opcionLimpiar` | Etiqueta de la fila que borra la selección | «Todas las categorías» / «Toda España» |
| `titulo` | Título del diálogo (`DialogTitle`) | Obligatorio por accesibilidad — Radix avisa en consola si falta |
| `marcadorFiltro` | Placeholder del campo de filtro | «Filtrar categorías…» / «Filtrar provincias…» |
| `etiquetaDisparador` | `aria-label` del disparador | **«Categoría» / «Provincia»** — §10.2 |
| `className` | Ancho de la celda del disparador | `md:w-48` / `md:w-44`, §5.2 |

**Lo que el molde NO recibe, a propósito:** ningún `renderItem`. Una fila es
`etiqueta` + `contexto` opcional, y con eso los dos casos quedan cubiertos. Un
`renderItem` sería la puerta por la que un consumidor futuro mete estructura distinta en
un componente cuyo valor es que **todos sus usos tengan el mismo árbol** (§6.3).

**Lo que el molde NO hace, y es la mitad del diseño:** no navega, no toca la URL, no llama
a la API, no carga datos. **Escribe un valor y cierra.**

### 2.4 La forma

```
┌─ DialogTrigger ────────────────────┐   dentro del <form>, type="button"
│  Coches                         ⌄  │   ← el valor elegido, o «Categoría»
└────────────────────────────────────┘
        │ clic · Enter · Espacio
        ▼
┌─ DialogContent (portal → <body>) ──────────────┐
│  «Elige una categoría»                    ✕    │  DialogTitle + el Close de casa
│  ┌──────────────────────────────────────────┐  │
│  │ 🔍 Filtrar categorías…                   │  │  autoFocus. role=combobox.
│  └──────────────────────────────────────────┘  │  aria-activedescendant → la fila activa
│ ─────────────────────────────────────────────  │  ← el filtro NO scrollea
│  ▏ Todas las categorías                        │  la fila de limpiar, siempre la 1ª
│  ▏ Vehículos · y 6 subcategorías               │  role=listbox / role=option
│  ▏ Coches            Vehículos ›               │  ← «contexto» a la derecha, atenuado
│  ▏ Deportivos        Vehículos › Coches ›      │
│  ⋮  (scroll)                                   │
└────────────────────────────────────────────────┘
```

**Tres decisiones de forma que no son cosméticas:**

1. **El campo de filtro no scrollea con la lista.** Si scrollea, el diálogo deja de
   sentirse como un buscador en cuanto hay 50 filas.
2. **«Todas las categorías» / «Toda España» es la PRIMERA fila, no un botón aparte.** Hoy
   es `<option value="">` y es la primera del `<select>`
   ([`SearchBar.tsx:171` y `:195`](../apps/web/src/components/busqueda/SearchBar.tsx#L171)).
   Mantenerla como fila la deja alcanzable con las flechas y con el mismo gesto que las
   demás.
3. **El `contexto` va a la derecha y atenuado**, como `MunicipioAutocomplete` pinta la
   provincia junto al municipio
   ([líneas 224-225](../apps/web/src/components/municipio/MunicipioAutocomplete.tsx#L224-L225)).
   Es el mismo problema —«desambiguar una fila sin robarle protagonismo»— ya resuelto en
   esta casa.

### 2.5 El filtrado y el teclado (decisión 5)

**El filtro**, calcado de `MunicipioAutocomplete` con dos ajustes justificados:

| Aspecto | `MunicipioAutocomplete` | `DialogoFiltrable` | Por qué cambia |
|---|---|---|---|
| Normalización | NFD + minúsculas | **igual** | Es lo que hace que «alacant» y «València» funcionen |
| Coincidencia | `includes` | **igual** | |
| Orden | `startsWith` primero, luego longitud | **igual** | |
| `MIN_QUERY_LENGTH` | 2 | **ninguno** | Existe porque sin él habría 8 132 filas. Con 52 (o ~N categorías) es fricción sin motivo |
| `MAX_RESULTS` | 8 | **ninguno** | Un desplegable anclado necesita tope; un diálogo con scroll, no. Y un tope escondería coincidencias legítimas |
| Estado inicial | lista vacía hasta teclear | **la lista ENTERA** | El diálogo se abre mostrando todo: es también un explorador, no sólo un buscador |

**El teclado**, y aquí está la decisión 5:

| Tecla | Qué hace |
|---|---|
| `↓` / `↑` | Mueve el resaltado. Se **detiene** en los extremos (no cicla), como `MunicipioAutocomplete` (`Math.min`/`i <= 0`) |
| `Enter` | Elige la fila resaltada y cierra |
| `Esc` | Lo gestiona Radix: cierra el diálogo y **devuelve el foco al disparador** |
| `Tab` | Recorre el diálogo. Radix lo atrapa dentro (`react-focus-scope`) |

> **Decisión 5, aplicada:** al abrir sin texto, se resalta **la opción actualmente
> elegida** (o la primera si no hay ninguna) y se hace scroll hasta ella. En cuanto hay
> texto, se resalta **la primera coincidencia**. Así `Enter` siempre hace lo evidente.
>
> ⚠ Esto **diverge** de `MunicipioAutocomplete`, que arranca en `activeIndex = -1` (línea
> 50) para que `Enter` con el desplegable abierto haga la búsqueda de texto libre. Allí es
> correcto —hay una salida de escape que proteger—; **aquí no hay texto libre que
> proteger**, porque el valor sale siempre de la lista (§4.3).

### 2.6 Lo que el molde debe cumplir para no poner rojas las barreras que ya existen

| Barrera | Qué exige |
|---|---|
| [`anillo-de-foco.test.ts`](../apps/web/src/components/ui/anillo-de-foco.test.ts) | ⚠ **Si el campo de filtro usa `ring-offset-2`, el fichero DEBE contener `ring-offset-background`.** El test recorre todos los `.ts(x)` de `src/`, descarta comentarios y falla si un fichero pide la banda sin decir su color. Es exactamente el defecto que cazó en `badge.tsx` |
| `estilo-invariancia.spec.ts` | El árbol de `/` idéntico entre modelos → §6.3 |
| `zona.test.tsx` | Los genéricos declaran su zona → se cumple por construir sobre `ui/dialog.tsx` (§2.2) |
| `accesibilidad-en-espanol.test.ts` | Todo texto de cara al usuario en español. **`DialogTitle` es obligatorio** (Radix): «Elige una categoría» / «Elige una provincia» |

---

## 3. EL DIÁLOGO DE CATEGORÍA — el árbol de cuatro niveles

### 3.1 La fuente de datos, y por qué no cuesta nada

Las categorías **ya vienen con la página**: `getCategories()` se llama una sola vez en el
Server Component ([`(home)/page.tsx:28-32`](../apps/web/src/app/(public)/(home)/page.tsx#L28-L32))
y baja por props hasta `SearchBar`
([`SearchHomeBlockRenderer.tsx:68`](../apps/web/src/components/home/blocks/SearchHomeBlockRenderer.tsx#L68)).
El diálogo **no añade ni una petición**.

`GET /categories` sirve **el árbol entero**, hasta los cuatro niveles de
[`CATEGORY_MAX_DEPTH = 4`](../apps/api/src/modules/categories/category.types.ts#L38).

### 3.2 El aplanado: se reusa `aplanar()`, y se muda de sitio

Hoy `aplanar()` es una función privada de
[`CategorySelect.tsx:93-104`](../apps/web/src/components/busqueda/CategorySelect.tsx#L93-L104).
Produce, para cada nodo a cualquier profundidad, `{ slug, etiqueta: 'Vehículos › Coches › Deportivos' }`,
en orden de árbol (cada rama entera antes de la siguiente).

**El diseño la promueve a `lib/category-tree.ts`**, que es donde viven ya `recorrerArbol`,
`buscarEnArbol`, `cadenaHasta` y `conDescendientes`, y cuya cabecera dice literalmente que
existe para que *«subir o bajar por la jerarquía tenga UN solo sitio donde vivir»*.

⚠ **Y se le cambia la salida**, porque el diálogo necesita separado lo que el `<select>`
tenía que juntar por fuerza:

| | `<select>` (hoy) | Diálogo |
|---|---|---|
| Salida de `aplanar()` | `{ slug, etiqueta: 'Vehículos › Coches' }` | `{ slug, nombre: 'Coches', ancestros: ['Vehículos'], nDescendientes }` |
| Por qué | Un `<option>` sólo tiene texto: había que concatenar | El diálogo pinta nombre y contexto en columnas distintas, y **busca sólo en el nombre** (§3.3) |

**`CategorySelect` se migra a la función nueva en la misma ráfaga** y sigue componiendo su
etiqueta con `' › '` — es una línea, y deja una sola implementación del recorrido en vez
de dos parecidas. **Su `<select>` no se toca**: `/busqueda` es otra ráfaga.

### 3.3 El filtro sobre el árbol (decisión 4)

> **Se busca en el NOMBRE del nodo. El path se muestra, no se busca.**

Lo que ocurre al teclear, con el árbol sembrado:

| Se teclea | Qué sale |
|---|---|
| `coch` | `Coches` — contexto: `Vehículos ›` |
| `veh` | `Vehículos` (y **sólo** ése) |
| `dep` | `Deportivos` — contexto: `Vehículos › Coches ›` |

**El porqué, medido:** si se busca sobre la etiqueta completa, teclear `veh` devuelve
**toda la rama de Vehículos** —el nodo y todos sus descendientes, porque todos llevan
«Vehículos» en su path—. Con cuatro niveles eso pueden ser decenas de filas y **el filtro
deja de filtrar justo en el caso más común**, que es teclear el nombre de una categoría
raíz.

**La red de la decisión 4**, tal como quedó en la auditoría: si el filtro sobre el nombre
devuelve **cero** resultados, se reintenta sobre el path completo antes de enseñar el
vacío. Cuesta una línea y cubre al usuario que teclea «vehiculos coches».

⚠ **Sobre `startsWith`:** con NFD aplicado, `Coches` empieza por `coch`, así que el orden
es el esperado. El desempate por longitud importa donde un nombre corto y uno largo
comparten prefijo (`Moto` antes que `Motocicletas de agua`), y es el mismo criterio que ya
se aplica a 8 132 municipios.

### 3.4 Elegir padre o hoja: se mantiene, y se completa (decisión 6)

**Hoy el `<select>` permite ambos**: la opción «Todo en {padre}»
([`SearchBar.tsx:175`](../apps/web/src/components/busqueda/SearchBar.tsx#L175)) lleva
`value={cat.slug}`, y cada hija la suya.

**Con `aplanar()`, TODOS los nodos son elegibles a cualquier profundidad.** La decisión de
producto no sólo se respeta: se completa, y ésa es la decisión 3.

**Y funciona en el backend a esa profundidad**, verificado: `categoryPath` se construye
desde la **cadena entera** de ancestros
([`search.service.ts:467` y `:795`](../apps/api/src/modules/search/search.service.ts#L467),
`ancestorChainIn`) y el filtro es contención en array
([`:640`](../apps/api/src/modules/search/search.service.ts#L640)). Elegir «Vehículos»
devuelve los coches; elegir «Deportivos» devuelve sólo los deportivos.

**Decisión 6, aplicada:** el literal «Todo en Vehículos» desaparece —en una lista plana de
cuatro niveles se leería peor que el nombre— y lo sustituye una coletilla atenuada:
`Vehículos · y 6 subcategorías`, sólo en las filas con descendencia. El número sale de
`conDescendientes()`, que ya existe. **Dice lo mismo que el «Todo en» decía, y además
cuánto.**

### 3.5 Lo que el diálogo escribe, y lo que NO toca

> **El diálogo llama a `setCategory(slug)`. Punto.**

`navegar()`, `paramsBase()`, `elegirTag()`, `buscarTextoLibre()` y `handleSubmit()`
**quedan intactos** ([`SearchBar.tsx:77-133`](../apps/web/src/components/busqueda/SearchBar.tsx#L77-L133)).
Eso conserva, sin tocarlas, las dos decisiones que se ganaron en ráfagas anteriores:

- **A1:** con categoría elegida se navega a su **ruta canónica** (`/vehiculos/coches?…`),
  no a `?category=`;
- **B4:** elegir una sugerencia de etiqueta emite `?tags=<slug>` sobre ese mismo destino.

> ⚠ **Si la ráfaga toca `navegar()`, se ha salido de su sitio.**

**El acoplamiento que hay que respetar, no romper:** `category` es dependencia del efecto
de sugerencias ([`SearchBar.tsx:66`](../apps/web/src/components/busqueda/SearchBar.tsx#L66) —
`[query, category]`), que lo pasa a `suggestTags(texto, category)`. **Elegir una categoría
vuelve a pedir las sugerencias, ya filtradas por ella**, con su debounce de 250 ms y su
`AbortController`. Es el comportamiento correcto y sale gratis; lo que hay que saber es que
**cerrar el diálogo puede repintar el desplegable de etiquetas que hay debajo**, y que eso
no es un defecto.

### 3.6 El guard `{categories.length > 0}` — intacto, y aquí importa más

Sin categorías (backend caído → `getCategories().catch(() => [])`,
[`page.tsx:30`](../apps/web/src/app/(public)/(home)/page.tsx#L30)) **el disparador entero
no se pinta**, exactamente como hoy no se pinta el `<select>`
([`SearchBar.tsx:163`](../apps/web/src/components/busqueda/SearchBar.tsx#L163)). La
portada degrada a «texto + provincia + buscar», y los chips «Populares» tampoco salen.

**El argumento es más fuerte con un diálogo que con un `<select>`:** un `<select>` vacío se
ve vacío desde fuera; **un diálogo vacío hay que abrirlo para descubrir que no hay nada**.
Un disparador que promete una lista y enseña un hueco es peor que un control ausente.

---

## 4. EL DIÁLOGO DE UBICACIÓN — las 52 provincias

### 4.1 Los datos

[`lib/provincias.ts`](../apps/web/src/lib/provincias.ts): **52 entradas**, lista plana
alfabética, `as const`. Ya viaja en el bundle del `SearchBar` de hoy. **Coste de datos
añadido por la ráfaga: cero bytes.**

El envoltorio mapea cada entrada a `{ valor: p, etiqueta: p, buscable: p }` —sin
`contexto`, porque una provincia no tiene ancestros— y le antepone la fila de limpiar
(«Toda España»).

### 4.2 Las grafías cooficiales

Cinco entradas llevan grafía doble: `Alicante/Alacant`, `Araba/Álava`,
`Castellón/Castelló`, `Valencia/València`. (`Illes Balears` no lleva barra: es el nombre
oficial único.)

**El `normalize()` NFD + `includes` las cubre sin ninguna lógica especial**, porque la
barra no separa nada para un `includes`:

| Se teclea | Qué sale, y por qué en ese orden |
|---|---|
| `ali` | `Alicante/Alacant` (`startsWith`) |
| `alac` | `Alicante/Alacant` (`includes`) |
| `ala` | `Araba/Álava` (11 caracteres) antes que `Alicante/Alacant` (16) — los dos por `includes`, desempata la longitud |
| `valen` | `Valencia/València` (`startsWith`; el acento ya no estorba por el NFD) |
| `caste` | `Castellón/Castelló` |
| `bar` | `Barcelona` |

**Ninguna de las seis necesita una línea de código propia.** Ése es el motivo de reusar el
`normalize()` en vez de escribir un filtro nuevo.

### 4.3 La invariante del valor — la decisión de producto crítica

> **El diálogo NUNCA envía lo tecleado. Envía la entrada EXACTA de `PROVINCIAS` que el
> usuario ha elegido. El campo de texto FILTRA; no es el campo del valor.**

**Por qué es crítico, verificado en el backend:** el filtro es un `=` exacto —
[`search.service.ts:645`](../apps/api/src/modules/search/search.service.ts#L645):
`` filters.push(`province = "${this.escape(params.province)}"`) `` — contra el `province`
del documento, que es el mismo string guardado en `Listing.province` y el mismo que sale
de `/data/municipios.json`. Lo deja escrito la cabecera de `provincias.ts` (líneas 1-8) y
lo repite `FilterPanel:797-799` explicando por qué aquel campo dejó de ser texto libre:
*«una errata o variación de mayúsculas/tildes daba 0 resultados en silencio»*.

**Cómo lo garantiza el diseño, por construcción y no por disciplina:** el molde llama a
`onElegir(valor)` **sólo** desde el manejador de una fila, y el `valor` de esa fila es la
entrada de la constante. **No hay ningún camino desde el texto tecleado hasta
`setProvince`.**

⚠ **Ésta es exactamente la diferencia de contrato que impide reusar `MunicipioAutocomplete`
tal cual:** aquél llama a `onChange(val)` **en cada tecla** con el texto libre
([línea 102](../apps/web/src/components/municipio/MunicipioAutocomplete.tsx#L102)), y hace
bien, porque publicar admite un municipio que no esté en el dataset. **Aquí eso sería el
defecto.**

### 4.4 Provincia y no municipio: los 372 KB siguen fuera

- `apps/web/public/data/municipios.json` pesa **380 487 bytes**.
- Sólo lo carga `MunicipioAutocomplete.loadDataset()`, **bajo demanda**, y ese componente
  **no se monta en la portada** (sus consumidores son el wizard de publicar y la edición
  de anuncio).
- **El diálogo de ubicación es de PROVINCIAS.** El municipio se afina en `/busqueda`, donde
  `FilterPanel` ya tiene su campo de ciudad.

> **Regla de la ráfaga: si aparece un `import` de `municipios.json` en cualquier fichero
> que la portada monte, la ráfaga está mal.**

---

## 5. LA INTEGRACIÓN

### 5.1 Entre los cuatro controles: una pieza, no cuatro cajas

**Lo medido hoy** ([`SearchBar.tsx:161-242`](../apps/web/src/components/busqueda/SearchBar.tsx#L161-L242)):

| Control | Alto móvil | Alto `md:` | Radio | Texto |
|---|---|---|---|---|
| `<select>` Categoría | `h-12` (48) | `md:h-full` | `rounded-xl` | `text-sm` → `md:text-base` |
| `<select>` Provincia | `h-12` (48) | `md:h-full` | `rounded-xl` | `text-sm` → `md:text-base` |
| `<input type="search">` | `h-14` (56) | `md:h-16` (64) | `rounded-xl` | `text-lg` → `md:text-xl` |
| `<Button>` Buscar | `h-14` (56) | `md:h-16` (64) | `rounded-xl` | `text-base` → `md:text-lg` |

**Lo que se decide:**

| | Hoy | Diseño |
|---|---|---|
| Alto móvil | 48 / 48 / 56 / 56 | **`h-14` (56) en los cuatro** |
| Alto `md:` | `h-full` / `h-full` / 64 / 64 | **`md:h-16` (64) en los cuatro**, `md:h-full` FUERA |
| Radio | `rounded-xl` en los cuatro | **igual** — ya sigue al modelo desde la ráfaga A |
| Separación | `border-b` (móvil) / `border-r` (`md:`) entre celdas | **igual** |
| Texto del disparador | — | `text-sm` → `md:text-base`, como los selects de hoy |

**Dos razones por las que se sube y no se baja:**

1. ⚠ **El input de texto no puede encoger.** Es candidato a LCP (§7.2) y es lo que da al
   buscador su peso sobre la banda. La coherencia se consigue subiendo los otros tres.
2. **Quitar `md:h-full` es el arreglo, no un efecto colateral.** Ese `h-full` es lo que
   hoy hace que el alto del select **dependa** del alto del input: hay un control que manda
   y tres que obedecen. Con un valor declarado, los cuatro dicen su alto.

**Lo que NO cambia, y sostiene la lectura de «una pieza»:** el `<form>` sigue siendo
`rounded-2xl border bg-background p-2 shadow-lg`, `flex-col` en móvil y `md:flex-row
md:items-stretch md:gap-0`, con los bordes internos entre celdas. **Ese envoltorio es la
integración**; lo que faltaba era que los cuatro inquilinos midieran lo mismo.

### 5.2 Con el hero montado: la caja cerrada no se mueve

La ráfaga D montó el buscador sobre la banda con **aritmética literal**:
`relative -mt-[5.5rem] md:-mt-[6.5rem]`
([`SearchHomeBlockRenderer.tsx:56-58`](../apps/web/src/components/home/blocks/SearchHomeBlockRenderer.tsx#L56-L58)),
y su comentario explica de dónde salen los números: *«los 48 px de `py-12` del contenedor
de bloques MÁS unos 40 de solape real»*, con la clase **literal** porque Tailwind purga lo
que no ve escrito.

> **La regla de esta ráfaga, en una línea: con los diálogos CERRADOS, el bloque buscador
> ocupa exactamente la misma caja que hoy.**

**Y el diseño la cumple sin esfuerzo, porque el alto de la fila no cambia:** hoy lo fija el
input (`h-14` / `md:h-16`) y los selects se estiran hasta él por el `md:h-full`. Al
declarar `h-14`/`md:h-16` en los cuatro, **la fila mide lo mismo que medía**. El solape
sigue calibrado.

⚠ **El arreglo, si algún día se descalibrara, NO es ajustar el `-mt-`** — eso movería
también `publico-portada-pantalla`, que es la captura que demuestra que la ráfaga D hace lo
que promete. Es no cambiar el alto.

**El contraste que hace el montaje se conserva:** la banda manda su fondo por token
(`var(--hero-ambiente)` + `var(--hero-patron)`,
[`HomeHeroBanda.tsx:81-89`](../apps/web/src/components/home/HomeHeroBanda.tsx#L81-L89)) y el
buscador se monta **encima** con `bg-background` opaco y su `shadow-lg`. **Caja opaca sobre
ambiente: eso ES el montaje.** Volver el buscador translúcido lo desmonta, así que no se
toca.

### 5.3 Los cuatro detalles de interacción que sólo aparecen con un diálogo dentro de un `<form>`

Ninguno es un riesgo abierto: los cuatro tienen respuesta y los cuatro hay que
**verificarlos**, no descubrirlos.

1. **`type="button"` en el disparador.** Un `<button>` dentro de un `<form>` es `submit`
   por defecto: abrir el diálogo lanzaría la búsqueda. **Radix ya lo pone**
   (verificado en `@radix-ui/react-dialog/dist/index.mjs:67`). Sigue siendo del autor si
   el disparador se escribe con `asChild`.
2. ~~**El velo cierra el desplegable de etiquetas.**~~ **FALSO — corregido en BQ-C.** El
   razonamiento era: `SearchBar` cierra sus sugerencias con un `mousedown` fuera del
   `<form>`, el velo se monta en `<body>`, luego abrir un diálogo las cierra. **Tiene un
   agujero de cronología**: cuando se pulsa el disparador el velo TODAVÍA NO EXISTE, y el
   `mousedown` cae sobre un botón que está DENTRO del formulario. El desplegable **se queda
   abierto, debajo**.
   <br><br>
   Y está bien que se quede, por algo que este apartado no miró: la preocupación de fondo
   era «dos capas VIVAS», y no hay dos capas vivas. Radix marca `aria-hidden` todo lo que
   queda fuera del diálogo y le corta los eventos de puntero, así que el desplegable es
   **inerte** — no se anuncia, no se pulsa, y está bajo un velo al 80 %. Conservarlo tiene
   además una ventaja: elegir una categoría vuelve a pedir las sugerencias acotadas a ella,
   así que al cerrar están ahí ya filtradas. Cerrarlo obligaría a teclear otra vez.
   <br><br>
   Lo que se fija en e2e es la propiedad que importa —**inerte mientras el diálogo está
   abierto, viva al cerrarlo**—, no la que este apartado supuso.
3. **`Esc` tiene dos dueños.** Hoy `Esc` sobre el input cierra las sugerencias
   ([línea 137](../apps/web/src/components/busqueda/SearchBar.tsx#L137)); con el diálogo
   abierto lo atrapa Radix y cierra el diálogo. **No chocan**, pero no por lo que este
   apartado decía: los dos estados **sí coexisten** (punto 2). Lo que decide es dónde está
   el foco — dentro del diálogo, sólo hay un destino posible.
   <br><br>
   ⚠ **Y aquí apareció un defecto de verdad, que sólo se ve con teclado.** Al pulsar `Esc`
   el foco se quedaba en el `<body>`: la capa no se «cierra», se DESMONTA (el reparto por
   peso de BQ-B), así que Radix nunca ve su `open` pasar a `false` y su `FocusScope` no
   llegaba a devolverlo. Quien navega sin ratón se quedaba en el limbo en medio de un
   formulario. Lo devuelve ahora `DialogoFiltrable` a mano, en el fotograma siguiente —para
   no pelearse con las limpiezas de `react-remove-scroll` y `aria-hidden`—. **Es el coste
   escondido del reparto del §7.2, y lo encontró esta lista.**
4. ⚠ **El bloqueo de scroll y el salto horizontal.** `@radix-ui/react-dialog` depende de
   `react-remove-scroll` y `aria-hidden` (verificado en su `package.json`). Al abrir, el
   documento se bloquea y —si el navegador pinta barra de scroll con ancho— **la página se
   desplazaría 15 px** si la compensación no funcionara. `react-remove-scroll` la
   compensa con padding; **en la portada montada ese salto se vería en el hero a sangre**,
   que es lo más ancho de la página. **Se verifica en BQ-C**, en escritorio, con barra de
   scroll clásica.

> ✅ **LOS CUATRO ESTÁN VERIFICADOS DESDE BQ-C**, y no en prosa:
> [`e2e/buscador-dialogos.spec.ts`](../apps/web/e2e/buscador-dialogos.spec.ts) los mide en
> un navegador de verdad, que es el único sitio donde el `<form>`, el portal a `<body>`, el
> foco y el bloqueo de scroll existen.
>
> El cuarto necesitó **tres** decisiones, y las tres nacen de lo mismo: un instrumento que
> no mide da un verde peor que un rojo.
>
> 1. **El medidor no filtra `hadRecentInput`.** El CLS «oficial» descarta los
>    desplazamientos ocurridos en los 500 ms siguientes a una interacción, y aquí lo que se
>    mide ocurre EXACTAMENTE al pulsar: con el filtro puesto habría dado 0 siempre.
> 2. **Se valida reproduciendo el modo de fallo exacto** —bloquear el scroll sin compensar
>    el ancho de la barra—, no un movimiento cualquiera. Y la validación va **en la misma
>    prueba que la medida**, para que las dos se comparen entre sí en vez de contra un
>    umbral escrito a ojo: la primera versión exigía `> 0.01` al salto inyectado y falló con
>    **0,00418**. El instrumento sí lo veía; 15 px de desplazamiento horizontal en 1280 de
>    ancho simplemente puntúan poco. Lo que hay que afirmar no es «el fallo da más de X»,
>    sino **«el fallo se distingue del no-fallo»**.
> 3. ⚠ **Y las dos pruebas se lanzan su propio navegador.** En el Chromium de la batería,
>    `innerWidth - clientWidth` vale **0**: Playwright arranca headless con
>    `--hide-scrollbars`, que gana a cualquier CSS (la primera explicación —barras
>    superpuestas— llevó a forzar una clásica con `::-webkit-scrollbar`, y siguió valiendo
>    0). O sea que el defecto **es invisible en el runner por construcción**. Quitar esa
>    bandera del proyecto `chromium` metería 15 px de barra en los 271 casos de la batería,
>    así que se lanza un navegador aparte **sólo para estas dos pruebas**. El guard que
>    exige `ancho > 0` se negó a dar el verde dos corridas seguidas antes de llegar aquí, y
>    esa terquedad es el motivo de que ahora se mida algo.

---

## 6. POR MODELO/VERSIÓN Y RESPONSIVE

### 6.1 El sabor por zona: en la portada, gratis — con una condición

- `ui/dialog.tsx` declara `data-zona={useZona()}` **en los dos nodos portalados** (velo,
  línea 74; contenido, línea 93). Lo prueban
  [`zona.test.tsx`](../apps/web/src/components/estilo/zona.test.tsx) (los cuatro genéricos
  lo declaran, se usen donde se usen) y
  [`estilo-zona-overlays.spec.ts`](../apps/web/e2e/estilo-zona-overlays.spec.ts) (los
  tokens **computados dentro de la capa** son los de su zona, contrastados contra los del
  `<html>` para que un token que coincidiera por casualidad no cuele como verde).
- **La portada es zona PÚBLICA, y la pública es la BASE.** No tiene bloque propio,
  `useZona()` devuelve `undefined`, `data-zona` **no se emite** y la capa hereda de
  `html:root` — *«que es justamente lo que es lo público»*
  ([`zona.tsx`](../apps/web/src/components/estilo/zona.tsx)).

> **O sea: en la portada, un diálogo ya recibe el sabor del modelo y de la versión activos
> sin que esta ráfaga monte nada.** No hay mecanismo que construir: hay un mecanismo que
> **no romper**, y la forma de no romperlo es el §2.2 (construir sobre `ui/dialog.tsx`).

**Qué reviste cada modelo, sin una línea por modelo:**

| Token | Dónde se ve en el diálogo |
|---|---|
| `--background` / `--foreground` | El lienzo de la capa y su texto |
| `--accent` / `--accent-foreground` | La fila resaltada (`aria-selected`) |
| `--muted-foreground` | El `contexto` atenuado y la coletilla de subcategorías |
| `--ring` | El anillo de foco del campo de filtro |
| `--radius` (vía `rounded-*`) | La capa y el campo. **Ya tokenizado**: `xl = calc(var(--radius) * 1.5)` ([`tailwind.config.ts:95-110`](../apps/web/tailwind.config.ts#L95-L110)) |
| `--motion-duration` / `--motion-ease` | La entrada de la capa (`dialog.tsx:96`) |

Los cinco modelos del catálogo —`modelo-0`, `fresco-confianza`, `premium@claro`,
**`premium@oscuro`** (la versión que invierte la luz) y `vibrante@pop`— declaran todos
esos tokens. **El diálogo cambia de aspecto con cada uno sin saber que existen.**

### 6.2 Escritorio popup, móvil sheet (decisión 2)

**Un solo árbol de React. La diferencia es CSS.**

```
≥ md  (escritorio)                    < md  (móvil)
┌───────────────────────┐             ┌─────────────────────┐ ← borde superior
│   ░░░ velo ░░░        │             │ Elige una categoría │
│  ┌─────────────────┐  │             │ 🔍 Filtrar…         │
│  │ Elige una cat.  │  │             │ ───────────────     │
│  │ 🔍 Filtrar…     │  │             │  Todas              │
│  │ ───────────     │  │             │  Vehículos          │
│  │  filas (scroll) │  │             │  Coches             │
│  └─────────────────┘  │             │   ⋮  (scroll)       │
│   ░░░░░░░░░░░░░░░     │             │                     │
└───────────────────────┘             └─────────────────────┘ ← borde inferior
  DialogContent de casa:                inset-0, sin max-w,
  max-w-lg centrado                     sin translate, alto completo
  + max-h y scroll interno
```

**Por qué pantalla completa en móvil, y son tres razones medidas:**

1. La lista de categorías a cuatro niveles puede pasar de 50 filas. Un cuadro `max-w-lg`
   en 375 px, con scroll interno **y** la página scrolleando detrás, es la interacción que
   peor se lleva en un móvil.
2. Al enfocar el campo de filtro **sube el teclado** y se come la mitad baja de la
   pantalla. Un cuadro centrado queda partido; una hoja a pantalla completa se recoloca.
3. **Ya es la decisión de esta casa para esta situación**, y con este mismo primitivo:
   `AdminMobileNav` y `AccountMobileBar` son paneles a borde sobre `DialogPrimitive`
   porque *«en 375 px el aside se llevaba 224 px»*. Aquí el argumento es el mismo.

⚠ **Cómo se consigue sin romper la frontera, que es la parte importante:**

> **La hoja se consigue con clases `md:`, NUNCA con un `useMediaQuery` que monte un árbol
> en móvil y otro en escritorio.** Un breakpoint es revestimiento —CSS— y la invariancia lo
> ignora por definición (ignora `class` y `style`). Una rama de JS sería **estructura**, y
> pondría roja la invariancia con toda la razón.

Concretamente: el mismo `DialogContent` recibe un `className` que en móvil anula el
centrado (`inset-0`, sin `translate`, sin `max-w`, sin `rounded`) y a partir de `md:`
restaura la geometría de casa. `DialogContent` acepta `className` y lo compone con `cn()`
([`dialog.tsx:94-98`](../apps/web/src/components/ui/dialog.tsx#L94-L98)); **es exactamente
para lo que está ahí.**

**El disparador, en las dos pantallas:** mantiene la anchura de su celda (`md:w-48`
categoría, `md:w-44` provincia, líneas 164 y 188) y muestra el valor elegido o el texto de
reposo, con un chevron a la derecha — como `MunicipioAutocomplete`
([líneas 195-198](../apps/web/src/components/municipio/MunicipioAutocomplete.tsx#L195-L198)).
En móvil ocupa la fila entera, como ocupa hoy el `<select>`.

### 6.3 La invariancia: verde por construcción

`/` está en **las dos** pruebas de
[`estilo-invariancia.spec.ts`](../apps/web/e2e/estilo-invariancia.spec.ts) y es **la** ruta
medida de la segunda (la del catálogo real, los cinco modelos).

| Qué mira el test | Efecto de esta ráfaga |
|---|---|
| La sucesión de etiquetas y su anidamiento | ✅ El árbol de `/` pierde dos `<select>` + sus `<option>` y gana dos `<button>`. **Idéntico para los cinco modelos** |
| **Todo el texto** | ✅ Los nombres de provincia y categoría salen del HTML servido **para todos por igual** → los árboles siguen coincidiendo |
| `role`, `type`, `data-testid`, `href`… | ✅ Estructura común |
| Ignora `id`, `aria-controls`, `aria-activedescendant`, `aria-labelledby`, `aria-describedby` porque *«Radix los numera por orden de montaje»* ([líneas 151-161](../apps/web/e2e/estilo-invariancia.spec.ts#L151-L161)) | ✅ Ya cubre justo lo que un diálogo de Radix añade |
| El marcador de `/`: `'Búsquedas frecuentes'` ([línea 314](../apps/web/e2e/estilo-invariancia.spec.ts#L314)) | ✅ Es del bloque `searchTable`. Esta ráfaga no lo toca |
| El diálogo **cerrado** | ✅ Radix no monta el portal cerrado: no hay contenido que comparar |

> **La frontera dicha para este caso: el diálogo es estructura COMÚN —los cinco modelos lo
> tienen, con el mismo árbol— y el sabor va por tokens. Un modelo no puede decidir que él
> prefiere un `<select>`.** Si alguien lo intentara, el test se pondría rojo, y ésa es la
> garantía que pide el encargo.

---

## 7. EL SEO Y EL RENDIMIENTO

La portada es la página de más tráfico del sitio. Tres afirmaciones, cada una con su
verificación.

### 7.1 Peso: cero datos nuevos

| Concepto | Hoy | Con diálogos |
|---|---|---|
| Árbol de categorías | ya viaja (SSR, `page.tsx:30`) | **igual** |
| `PROVINCIAS` (52 strings) | ya en el bundle | **igual** |
| `municipios.json` (380 487 B) | **no se carga** | **sigue sin cargarse** |
| `@radix-ui/react-dialog` | dependencia directa (`package.json:21`) | ⚠ **medir** si ya está en el chunk de la portada |
| JS nuevo | — | el molde + dos envoltorios |

⚠ **La única incógnita de peso, y se resuelve midiendo, no opinando:** si
`@radix-ui/react-dialog` **no** estuviera ya en el chunk de la portada, entra con esta
ráfaga y hay que **declarar los KB en el commit**. Es un dato, no un riesgo: se mide con el
analizador de bundle en BQ-B, antes de dar la ráfaga por cerrada.

### 7.2 El diálogo no se paga en la carga de la portada — y el porqué no es el que este apartado decía

**El molde está partido en dos ficheros, y ésa es la razón:**
[`ui/dialogo-filtrable.tsx`](../apps/web/src/components/ui/dialogo-filtrable.tsx) lleva
**sólo el disparador** —un `<button>`, que viaja en el HTML servido como viajaba el
`<select>`— y toda la capa (Radix Dialog, el filtro, la lista) vive en
[`ui/dialogo-filtrable-capa.tsx`](../apps/web/src/components/ui/dialogo-filtrable-capa.tsx),
que llega por `next/dynamic`. **La descarga se dispara al abrir**, porque `dynamic()` sólo
la dispara cuando el componente se RENDERIZA — el mismo argumento con el que
[`MapViewClient`](../apps/web/src/components/busqueda/MapViewClient.tsx) deja MapLibre fuera
de `/busqueda` hasta que alguien pide el mapa.

**Medido con `next build`, que es lo que este apartado pedía hacer antes de afirmar nada:**

| | Ruta `/` | First Load JS |
|---|---|---|
| Antes de BQ-B | 6.29 kB | 228 kB |
| Con la capa importada a secas | 6.88 kB | **242 kB** |
| Con el reparto disparador + capa diferida | 6.67 kB | **230 kB** |

⚠ **LO QUE ESTE APARTADO DECÍA ANTES ERA FALSO, Y CONVIENE QUE QUEDE ESCRITO POR QUÉ.**
Decía que el diálogo no se pagaba en el render inicial *«porque Radix no monta el portal
mientras está cerrado»*. Eso es cierto y no demuestra nada: **«no se renderiza» no es «no
se descarga»**. El CONTENIDO no se pintaba, en efecto — pero el CÓDIGO viajaba entero en la
primera carga, y eran **14 kB en la página de más tráfico del sitio**. El diseño dio por
hecho además que `@radix-ui/react-dialog` ya estaba en ese chunk; la medición dijo que no.

Es exactamente el mismo error de razonamiento que BQ-A corrigió en
[`diseno-escaparate.md §5.2`](diseno-escaparate.md), donde «está en el HTML servido» y
«funciona sin JS» se trataban como una sola propiedad. Aquí eran «no se monta» y «no se
descarga». **Dos veces la misma trampa en dos capas distintas**, y las dos veces la
destapó medir en vez de razonar.

**Lo que sigue siendo cierto de la versión anterior:** el trabajo de PINTAR 52 filas (o N
categorías) no ocurre en la carga de la portada, sino cuando el usuario decide filtrar. Sólo
que eso es la consecuencia pequeña; la grande es el peso, y el peso necesitaba el reparto.

### 7.3 Lo que sí sale del HTML inicial, dicho sin adornos

Hoy el HTML de la portada contiene, como texto de `<option>`, **los 52 nombres de provincia
y el nombre de cada categoría de dos niveles**. Con el diálogo, ese texto deja de estar en
el HTML inicial.

**Impacto SEO: bajo, no nulo.**

- **No se pierde ni un enlace.** Un `<option>` no es un `<a>`. Los enlaces internos a
  categorías de la portada los ponen los chips «Populares»
  ([`SearchHomeBlockRenderer.tsx:70-86`](../apps/web/src/components/home/blocks/SearchHomeBlockRenderer.tsx#L70-L86))
  y el bloque `searchTable`, **y esta ráfaga no toca ninguno de los dos**. El `searchTable`
  es precisamente el bloque cuyo motivo de existir son *«cientos de enlaces internos a
  búsquedas que un crawler tiene que ver»*
  ([`SearchTabs.tsx:12-18`](../apps/web/src/components/home/blocks/SearchTabs.tsx#L12-L18)),
  y por eso sirve sus paneles inactivos con `hidden` en vez de desmontarlos.
- Lo que se pierde es **texto de control**, no contenido. Un crawler que hoy lee «Almería»
  dentro de un `<option>` no le está dando a la portada relevancia para «Almería».
- **El HTML pierde ~1,5 KB antes de comprimir** (52 nombres + las categorías). A favor del
  peso, no en contra.

---

## 8. LA CORRECCIÓN DE `diseno-escaparate.md §5.2`

### 8.1 Qué dice hoy, y por qué hay que tocarlo

> *«**Y el LCP se mueve, a un sitio que también es seguro.** Con el buscador montado, el
> candidato a LCP pasa a ser el `<h1>` **o** la caja del buscador. Los dos son HTML
> servido: `SearchBar` es `'use client'` pero su marcado es un `<form>` nativo que viaja
> entero en la respuesta **y funciona sin JS**. **Ninguno de los dos se anima.** Regla 4
> intacta.»*

La decisión 1 (§0.1) invalida **la subordinada**, no la conclusión.

### 8.2 El error del párrafo original: dos propiedades distintas tratadas como una

Esto es lo que hay que dejar escrito, porque es lo que evita que la corrección parezca un
apaño:

| Propiedad | Qué significa | ¿De qué depende el LCP? |
|---|---|---|
| **«Está en el HTML servido»** | El navegador puede **pintarlo** antes de ejecutar nada | **SÍ.** El LCP es un evento de pintura |
| **«Funciona sin JS»** | Se puede **interactuar** con ello antes de hidratar | **NO.** Un elemento inerte pinta igual de rápido |

`§5.2` usó la segunda como argumento de la primera. **Eran dos propiedades distintas, y la
que sostiene el LCP es la que no cambia.**

### 8.3 La re-justificación: el LCP sigue intacto, y es verificable

Tras la ráfaga, la caja del buscador **sigue estando entera en el HTML servido**:

- `SearchBar` es `'use client'`, pero **React renderiza los componentes cliente en el
  servidor**: su marcado viaja en la respuesta igual que hoy.
- El `<form>`, el `<input type="search">`, el `<Button>` de buscar y **los dos disparadores
  de diálogo** están en ese HTML. Lo único que cambia es que **dos nodos que eran
  `<select>` ahora son `<button>`** — mismo momento de pintura, misma caja (§5.2 de este
  documento: el alto no cambia).
- **El contenido de los diálogos no está**, porque no se pinta (§7.2): **no puede ser el
  LCP de nada.**
- **Nada de lo anterior se anima.** La regla 4 de E6 —*«El LCP no se anima: el `<h1>`
  quieto, siempre. El buscador, HTML servido sin animación de entrada»*
  ([`diseno-escaparate.md §5.4`](diseno-escaparate.md))— se cumple literalmente, y su
  propia redacción ya decía «HTML servido», no «sin JS».

**Lo que sí cambia, y es lo que la nota tiene que decir:** entre la pintura y la
hidratación, **los dos filtros no son operables**. La búsqueda de texto libre —`<form>` +
`<input>` + submit— tampoco lo era del todo: `handleSubmit` es JS y `navegar()` es el
router del cliente. **La ventana de inoperancia ya existía; ahora abarca dos controles
más.**

### 8.4 El texto de sustitución propuesto

> **Y el LCP se mueve, a un sitio que también es seguro.** Con el buscador montado, el
> candidato a LCP pasa a ser el `<h1>` **o** la caja del buscador. Los dos **están en el
> HTML servido**: `SearchBar` es `'use client'`, pero React lo renderiza en el servidor y
> su marcado —el `<form>`, el campo de texto, el botón y los disparadores de los dos
> diálogos— viaja entero en la respuesta. **Ninguno de los dos se anima.** Regla 4 intacta.
>
> ⚠ **Lo que sostiene esta conclusión es «está en el HTML servido», no «funciona sin JS»,
> y conviene no confundirlas.** El LCP es un evento de PINTURA: un elemento que aún no
> responde pinta igual de rápido que uno que sí. Este párrafo decía además que el buscador
> *«funciona sin JS»*, y **desde la ráfaga del buscador filtrable eso ya no es cierto**:
> los selectores de categoría y provincia son diálogos y requieren JS (decisión 1 de
> [`diseno-buscador.md §8`](diseno-buscador.md)). La degradación sin JS ya era parcial
> —sin JS, el `<select>` de categoría tampoco llevaba a `/vehiculos/coches`, porque
> `navegar()` no corría—, y **el LCP nunca dependió de ella**.

### 8.5 Los otros dos sitios que hay que tocar en la misma ráfaga

| Sitio | Qué dice | Qué pasa a decir |
|---|---|---|
| [`SearchHomeBlockRenderer.tsx:12-18`](../apps/web/src/components/home/blocks/SearchHomeBlockRenderer.tsx#L12-L18) | *«su marcado es un `<form>` nativo con dos `<select>` y un `<input type="search">`: está entero en el HTML servido y funciona sin JS. El JS solo añade las sugerencias…»* | El marcado sigue **entero en el HTML servido** (lo que sostiene el LCP); **los dos filtros son diálogos y requieren JS**; el `<form>` de texto libre sigue en el HTML |
| `estado-tecnico.md` ~L313 | *«`categoryPath` soporta como máximo 2 niveles (hoja → padre)»* | **Falso** desde PROFUNDIDAD N · RÁFAGA 2: se construye desde la cadena entera (`search.service.ts:467`, `:795`). **Es la nota que haría dudar de la decisión 3**, así que se corrige aquí |

---

## 9. LAS DECISIONES DE PRODUCTO, Y DÓNDE LAS GARANTIZA EL DISEÑO

No como intención: como propiedad del diseño, con el sitio donde se sostiene.

| # | Decisión | Cómo la garantiza este diseño |
|---|---|---|
| **1** | **Provincia, no municipio** | El diálogo de ubicación consume `PROVINCIAS`. **Ningún fichero que la portada monte importa `municipios.json`** (§4.4) |
| **2** | **El formato EXACTO de `province`** | `onElegir` se llama **sólo** desde el manejador de una fila, con el valor de la constante. **No hay camino del texto tecleado a `setProvince`** (§4.3) |
| **3** | **El guard `{categories.length > 0}`** | El disparador va dentro del mismo guard. Sin categorías no se pinta (§3.6) |
| **4** | **No los 8 132 municipios en la home** | §4.4, elevado a regla de revisión de la ráfaga |
| **5** | **El buscador no gana configuración** | `HomeSearchBlock` conserva sus cuatro campos (`eyebrow`, `showPopularCategories`, `popularCount`, `overlapHero`, [`home-blocks.ts:50-69`](../apps/web/src/types/home-blocks.ts#L50-L69)). **Cero migraciones, cero cambios en el editor de portada, cero cambios en `PORTADA_SEMILLA`.** Ésta es la diferencia con la ráfaga D, que sí necesitó ocho sitios |
| **6** | **A1 y B4 intactos** | El diálogo escribe `setCategory()`; `navegar()` no se toca (§3.5) |

---

## 10. LAS BARRERAS: qué se rompe, qué se añade, qué tiene que seguir verde

### 10.1 Lo que se rompe — y es poco, y está localizado

| Qué | Dónde | Por qué |
|---|---|---|
| **Dos líneas de e2e** | [`buscador-sugerencias.spec.ts:58`](../apps/web/e2e/buscador-sugerencias.spec.ts#L58) (`getByLabel('Categoría').selectOption('coches')`) y `:84` (`getByLabel('Provincia').selectOption('Madrid')`) | `selectOption` no existe sobre un botón |
| **`publico-portada`** (escritorio + móvil, `linux` + `win32` = 4 ficheros) | `e2e-snapshots/__capturas__/` | Los controles cambian de forma y de alto. **ÉSE ES EL ENTREGABLE** |
| **`publico-portada-pantalla`** (otros 4) | ídem | La variante con `overlapHero`. Es la que demuestra que el montaje sigue calibrado (§5.2) |

> **Y no hay más.** `busqueda-unificada.spec.ts:35` también usa `selectOption`, pero sobre
> el `CategorySelect` de `/busqueda` — **fuera de alcance**, verificado.

### 10.2 El localizador: la decisión que abarata la rotura

Hoy los dos controles se localizan por `aria-label` (`'Categoría'`, `'Provincia'`), que es
a la vez su etiqueta accesible y el asidero de los tests.

> **El disparador conserva el MISMO `aria-label`.** Así el localizador
> `getByLabel('Categoría')` **sigue encontrando el control**; lo único que cambia es la
> acción: de `selectOption(valor)` a «abrir, filtrar, elegir».

Eso sugiere un helper de e2e —`elegirCategoria(page, nombre)` / `elegirProvincia(page,
nombre)`— que encapsule los tres gestos. **La ráfaga de `/busqueda` lo reutilizará**, igual
que reutilizará el molde.

### 10.3 Lo que se añade

| Barrera nueva | Qué prueba |
|---|---|
| **Captura `overlay-buscador-categoria`**, escritorio **y** móvil | Es donde vive la decisión 2: en la misma corrida se ve el popup centrado y la hoja a pantalla completa. Molde: [`overlays.spec.ts`](../apps/web/e2e-snapshots/overlays.spec.ts), que ya fotografía un `SelectContent` y el cajón del backoffice abiertos |
| **Un caso funcional del valor exacto** | Elegir `Alicante/Alacant` tecleando `alac` → la URL lleva `province=Alicante%2FAlacant`, **no** `province=alac`. Es la decisión de producto 2 convertida en rojo de CI |
| **Un caso funcional de profundidad** | Elegir una categoría de nivel 3 → navega a `/vehiculos/coches/deportivos`. Es la decisión 3 convertida en rojo de CI |

⚠ **La captura del diálogo abierto necesita `preparar()`**, que apaga las cuatro fuentes de
ruido del repo ([`preparar.ts`](../apps/web/e2e-snapshots/preparar.ts)) — incluido
`prefers-reduced-motion`, que es lo que evita que la entrada de la capa haga parpadear la
foto.

### 10.4 Lo que tiene que seguir verde sin tocarlo

| Barrera | Qué vigila aquí |
|---|---|
| `estilo-invariancia.spec.ts` | `/` idéntica entre los cinco modelos (§6.3) |
| El **resto** de `buscador-sugerencias.spec.ts` | El contrato de B4, palabra por palabra: las sugerencias, el texto libre, la etiqueta con y sin categoría, **la provincia que viaja con la etiqueta** |
| `portada-hero.spec.ts`, `portada-bloques.spec.ts` | El motor de bloques y el hero |
| `anillo-de-foco.test.ts` | §2.6 — el campo de filtro y su banda |
| `accesibilidad-en-espanol.test.ts` | Los textos nuevos, en español |
| `zona.test.tsx`, `estilo-zona-overlays.spec.ts` | No se tocan; el molde los hereda por construir sobre `ui/dialog.tsx` |

---

## 11. EL PLAN DE RÁFAGAS

Cuatro. El orden lo manda la regla de la casa: **las barreras antes de repintar**.

### BQ-A · La barrera y la documentación — **cambio visual nulo**

- **La captura nueva del diálogo abierto NO se puede tomar todavía** (el diálogo no
  existe). Lo que sí entra aquí es **todo lo que no depende de él**:
  - **Las tres correcciones de documentación** (§8.4 y §8.5): `diseno-escaparate §5.2`,
    el comentario de `SearchHomeBlockRenderer` y la línea de `estado-tecnico.md`. Entran
    **antes** a propósito: son la decisión 1 escrita, y una decisión que se documenta
    después de ejecutarla se lee como una excusa.
  - **El helper de e2e** (§10.2) introducido **sobre los `<select>` de hoy**, haciendo
    `selectOption` por dentro. Las dos líneas de `buscador-sugerencias.spec.ts` pasan a
    usarlo **sin cambiar de comportamiento**.
- **La promoción de `aplanar()`** a `lib/category-tree.ts` con la salida nueva (§3.2), y
  `CategorySelect` migrado a ella. **Cambio visual nulo**: su etiqueta se compone igual.
  Con su test unitario, que hoy no existe.
- **Salida esperada:** CI verde, ni un píxel movido, y el helper ya en su sitio para que
  BQ-B sólo tenga que cambiarle las tripas.

### BQ-B · El molde y los dos diálogos — **aquí cambia el aspecto**

- `ui/dialogo-filtrable.tsx` sobre `ui/dialog.tsx` (§2), **sin saber qué es una categoría
  ni una provincia**.
- `CategoriaDialogo` (§3) y `ProvinciaDialogo` (§4).
- `SearchBar` sustituye los dos `<select>` por los dos disparadores. **`navegar()`,
  `paramsBase()`, el efecto de sugerencias y el guard no se tocan.**
- El helper de e2e cambia de tripas; **las dos líneas de la spec no se vuelven a tocar**.
- Los dos casos funcionales nuevos (§10.3).
- **Medir el bundle** (§7.1) y declarar los KB en el commit.
- ⚠ **`publico-portada` y `publico-portada-pantalla` se pondrán rojas — 8 ficheros. ÉSE ES
  EL ENTREGABLE:** el diff sale del artefacto de CI, no de una descripción en prosa
  ([`diseno-escaparate.md §3.5`](diseno-escaparate.md)).

### BQ-C · La integración — los cuatro controles y el montaje

- La escala de alto única (§5.1): `h-14` / `md:h-16` en los cuatro, `md:h-full` fuera.
- **Verificar a mano los cuatro detalles del §5.3**, con nombre y apellido: el `type` del
  disparador, el velo contra el desplegable de etiquetas, los dos dueños de `Esc` y **el
  salto horizontal del bloqueo de scroll**.
- **Comprobar que el bloque montado no ha cambiado de alto** — `publico-portada-pantalla`
  es la captura que lo dice.
- La captura `overlay-buscador-categoria`, escritorio y móvil (§10.3).

### BQ-D · La vuelta por los cinco modelos

- Los cinco del catálogo × la portada, escritorio y móvil, **con el diálogo abierto**. Ya
  están enumerados con sus colores de fábrica en
  [`estilo-invariancia.spec.ts:358-378`](../apps/web/e2e/estilo-invariancia.spec.ts#L358-L378),
  incluida `premium@oscuro`, que es la que **invierte la luz**.
- Es donde se vería la deuda del velo (§12.1), si se decide meterla.

---

## 12. LAS DEUDAS QUE ESTE DISEÑO NO ARREGLA

1. ✅ ~~**El velo `bg-black/80` no sigue al modelo.**~~ **CERRADA EN BQ-D — y el defecto de
   verdad era otro.**

   El velo sí se tokeniza (`--velo`, con el valor por defecto exactamente igual al
   `bg-black/80` que sustituye, así que tokenizarlo no mueve un píxel; un modelo o una
   versión puede sobrescribirlo desde sus `ejes` sin tocar ningún DTO). Pero al mirar la
   captura de `premium@oscuro` se vio que **el problema no era el velo**:

   > `DialogContent` se pintaba con **`bg-background`** — el token del LIENZO. Era el
   > único overlay del repo que lo hacía: `SelectContent` y `DropdownMenuContent` usan
   > `bg-popover`, que es el token de la capa flotante.

   Con los cuatro modelos claros da igual (`--popover` y `--background` valen lo mismo), y
   por eso el defecto llevaba ahí desde que shadcn generó el componente sin que nadie lo
   notara. En `premium@oscuro` no da igual: su rampa pone el lienzo al **8 %** de luz, la
   tarjeta al **13** y la capa flotante al **16**, porque —lo dice el propio modelo— *«en
   un tema oscuro la elevación la da la luz: una sombra negra sobre un lienzo carbón no se
   ve»*. El diálogo se pintaba del mismo carbón que la página y se quedaba plano.

   **El arreglo no inventa un token: usa el que el sistema ya había declarado para esto.**
   Y hereda su calibración: en Modelo 0 los dos valen `0 0% 100%`, así que el cambio es de
   cero píxeles en las capturas del catálogo — la misma propiedad que tuvo la escala de
   radio en la ráfaga A.

   `alert-dialog.tsx` arrastraba los dos defectos idénticos y se corrige con él: dejarlo
   fuera habría sido conservar la misma deuda bajo otro nombre de fichero.
2. **Ninguna spec corre sin JS**, y hasta esta ráfaga había dos comentarios que afirmaban
   que la portada funcionaba así. **La decisión 1 los retira** (§8.5), así que la deuda
   deja de ser «una afirmación sin vigilar» y pasa a ser «una propiedad que ya no se
   afirma». Es la forma barata de cerrarla.
3. ⚠ **UN RESIDUO DE 8 PX AL ABRIR CUALQUIER DIÁLOGO, Y NO ES DEL BUSCADOR.** Medido en
   BQ-C con barra de scroll real (`e2e/buscador-dialogos.spec.ts`):

   | | Desplazamiento | Qué se mueve |
   |---|---|---|
   | Abrir el diálogo | **0,0010** | UN nodo: un `.container mx-auto`, 8 px |
   | El mismo bloqueo **sin compensar** | **0,0049** | CINCO: la nav de la cabecera y sus botones (15 px), el contenedor del hero y los chips (8 px) |

   O sea: `react-remove-scroll` hace su trabajo —**el hero NO se mueve**, que era la
   preocupación del §5.3— pero queda un contenedor centrado que se descoloca 8 px. No lo
   introdujo esta ráfaga: afecta por igual a los ~25 diálogos anteriores al buscador.

   > ⚠ **LO QUE SEGUÍA AQUÍ ERA FALSO, Y LA RÁFAGA SIGUIENTE LO MIDIÓ.** Este párrafo decía
   > que el residuo «sale de la cabecera `sticky` que comparte todo el sitio público» y que
   > arreglarlo «sería cambiar la cabecera de todas las páginas». **La cabecera no se mueve
   > ni una centésima**: `position: sticky` no sale del flujo, así que recibe la
   > compensación del `body` como cualquier otro elemento. El que se descoloca es el
   > `.container mx-auto max-w-5xl` del **banner de cookies**, que es `position: fixed` y
   > por tanto se mide contra el viewport, donde la compensación del `body` no llega.
   >
   > Los 8 px son 7,5: la mitad exacta de la barra de scroll, re-centrando un contenedor de
   > 1024 px dentro de un padre que pasa de 1265 a 1280.
   >
   > Y como el banner sólo existe hasta que el visitante decide, **con el consentimiento ya
   > dado el CLS de abrir un diálogo es 0,000 y no hay ni una fuente**.
   >
   > El diagnóstico entero, con los números, el censo de elementos fijos y las opciones de
   > arreglo: [`docs/diagnostico-residuo-8px.md`](./diagnostico-residuo-8px.md).

   Para que el residuo no crezca sin que nadie lo note, la prueba exige que lo que se mueve
   al abrir sea **menos de un tercio** de lo que se mueve sin compensación, y que el hero no
   figure entre las fuentes.

4. ~~**`FilterPanel:800-808` tiene el mismo `<select>` de provincia** y el mismo problema.
   **Es el primer cliente del molde** en la ráfaga de unificación de `/busqueda`.~~
   → **CERRADO en BQ-E.** Ver §15.
5. ~~**El buscador de `/busqueda` sigue con `CategorySelect`**, que además **navega** al
   cambiar (`goTo` → `router.push`) en vez de escribir un valor. Unificar los dos no es
   sólo cambiar el control: es decidir si el de `/busqueda` deja de navegar o si el molde
   admite un modo que navegue. **No se decide aquí.**~~
   → **CERRADO en BQ-E, y por una tercera vía que esta lista no contemplaba: ninguna de
   las dos hacía falta.** Ver §15.

---

## 13. LAS DECISIONES QUE QUEDAN

Tres. Ninguna bloquea el arranque de BQ-A.

**A · El título del diálogo de categoría.** Radix exige `DialogTitle`. ¿«Elige una
categoría» (el literal que ya usa `StepCategoria` en el wizard,
[línea ~78](../apps/web/src/components/publicar/steps/StepCategoria.tsx)) o «Categoría», el
mismo texto que el `aria-label`? → *Recomendación: **«Elige una categoría»**, porque reusa
un literal que ya existe en el producto y porque un título que repite la etiqueta del
disparador no añade nada a quien lo oye.*

**B · La fila de limpiar cuando hay texto tecleado.** «Todas las categorías» no casa con
ningún filtro. ¿Desaparece al teclear, o se queda siempre fija arriba? → *Recomendación:
**se queda fija**. Es una acción, no un resultado, y esconderla obliga a borrar el texto
para poder limpiar.*

**C · El chevron del disparador.** `MunicipioAutocomplete` usa `ChevronDown`. Un diálogo
no despliega hacia abajo: se abre encima. ¿`ChevronDown` por familiaridad con un `<select>`,
o un icono de búsqueda/lista? → *Recomendación: **`ChevronDown`**. Lo que comunica es «esto
se abre», y es lo que el usuario asocia a un selector. El grosor del trazo ya lo ajusta
cada modelo por token (`--icon-stroke`, `globals.css:248` y `:361`).*

---

## 14. LO VERIFICADO EN ESTA SESIÓN

| Fichero | Qué se comprobó para este diseño |
|---|---|
| `components/busqueda/SearchBar.tsx` | Los dos `<select>` (L163-200), el guard (L163), `navegar()`/`paramsBase()` (L77-100), `handleSubmit` (L124-133), el efecto `[query, category]` (L66), el cierre por `mousedown` fuera (L69-75), `Esc` (L137), los altos/radios/textos de los cuatro controles (L161-242) |
| `components/ui/dialog.tsx` | `data-zona` en los **dos** nodos portalados (L74, L93), `cn(className)` en `DialogContent` (L94-98), `max-w-lg` centrado (L95), la animación por `--motion-duration` (L96 y el porqué en L31-58), el `sr-only` «Cerrar» (L102-107), el velo `bg-black/80` (L76) |
| `components/municipio/MunicipioAutocomplete.tsx` | `normalize()` NFD (L28-31), `MAX_RESULTS=8` (L33), `MIN_QUERY_LENGTH=2` (L35), el orden `startsWith`+longitud (L66-75), `onChange(val)` en cada tecla (L102), `loadDataset` (L79-89), el bloque ARIA (L174-180), el teclado (L112-143), el chevron (L195-198), el contexto atenuado (L224-225) |
| `components/busqueda/CategorySelect.tsx` | `aplanar()` (L93-104), el separador `' › '` (L73), el porqué de no anidar `<optgroup>` (L79-82), «saltar vs explorar» (L84-88), `goTo` navega (L40-53) |
| `lib/category-tree.ts` | `recorrerArbol`, `buscarEnArbol`, `cadenaHasta`, `conDescendientes`; la cabecera que justifica que el recorrido viva en un solo sitio |
| `lib/provincias.ts` | **52** entradas, `as const`, las cinco grafías cooficiales, el contrato de match exacto (L1-8) |
| `components/estilo/zona.tsx` + `zona.test.tsx` + `e2e/estilo-zona-overlays.spec.ts` | La pública **es** la base → `useZona()` = `undefined`; los cuatro genéricos declaran zona; los tokens computados dentro de la capa son los de su zona |
| `components/ui/anillo-de-foco.test.ts` | La barrera: todo fichero con `ring-offset-2` debe contener `ring-offset-background`; se descartan comentarios antes de mirar |
| `components/home/blocks/SearchHomeBlockRenderer.tsx` | El «funciona sin JS» a corregir (L12-18), `overlapHero` / `-mt-[5.5rem] md:-mt-[6.5rem]` (L39-58), los chips «Populares» (L70-86) |
| `components/home/HomeHeroBanda.tsx` | `var(--hero-ambiente)` / `var(--hero-patron)`, las tres alturas, «los dos nodos son comunes a los cinco modelos» |
| `types/home-blocks.ts` | `HomeSearchBlock` tiene cuatro campos y **no necesita ninguno nuevo** (L50-69) |
| `app/(public)/(home)/page.tsx` | `getCategories().catch(() => [])` (L30); una sola carga, baja por props |
| `docs/diseno-escaparate.md` | §5.2 (el párrafo del LCP, a corregir) y §5.4 (la regla 4: *«El LCP no se anima… El buscador, HTML servido sin animación de entrada»*) |
| `e2e/estilo-invariancia.spec.ts` | `/` en las dos pruebas, los atributos ignorados (L151-161), el marcador `'Búsquedas frecuentes'` (L314), los cinco modelos del catálogo (L358-378) |
| `e2e/helpers/portada.ts` | `PORTADA_ESCAPARATE` (sin `overlapHero`) y `PORTADA_ESCAPARATE_PANTALLA` (con `overlapHero: true`) → **las dos capturas de portada se ven afectadas** |
| `e2e-snapshots/overlays.spec.ts` + `preparar.ts` | El molde de «overlay abierto»; las cuatro fuentes de ruido que `preparar()` apaga |
| `e2e/buscador-sugerencias.spec.ts` | **L58 y L84: las dos únicas líneas de e2e que se rompen** |
| `e2e/busqueda-unificada.spec.ts` | Su `selectOption` es del `CategorySelect` de `/busqueda` → **fuera de alcance** |
| `api/.../search.service.ts` | `province = "…"` exacto (L645); `categoryPath` desde la cadena entera (L467, L795); contención en array (L640) |
| `api/.../category.types.ts` | `CATEGORY_MAX_DEPTH = 4` (L38) |
| `@radix-ui/react-dialog/package.json` + `dist/index.mjs` | `react-remove-scroll` + `aria-hidden` entre sus dependencias; el `type: "button"` del disparador (L67) |
| `tailwind.config.ts` | `xl/2xl/3xl` atados a `--radius` desde la ráfaga A (L95-110) |
| `playwright.snapshots.config.ts` | Dos proyectos: `escritorio` 1280×720, `movil` 375×667 |

---

### Una línea de cierre

Nada de lo que este diseño construye es nuevo: la capa es `ui/dialog.tsx`, el filtro es el
de `MunicipioAutocomplete`, la lista es la de `aplanar()` y el sabor llega solo porque la
portada es la base del modelo. **Lo único verdaderamente nuevo es lo que se retira** — el
techo de dos niveles que el `<optgroup>` imponía, y una frase del escaparate que confundía
«está en el HTML» con «funciona sin JS».

---

## 15. BQ-E — LA PRUEBA DE REUTILIZACIÓN: `/busqueda` CON EL MISMO MOLDE

El §12 dejó dos deudas abiertas (puntos 4 y 5) y una pregunta de diseño sin decidir. Esta
ráfaga las cierra montando el molde en su **segundo cliente**: el `FilterPanel` de
`/busqueda` y `/[categoria]`.

### 15.1 · El veredicto: el molde no se tocó

**Cero cambios en `ui/dialogo-filtrable.tsx` y `ui/dialogo-filtrable-capa.tsx`.** Ni una
línea, ni una prop nueva, ni un `if`. La reutilización queda probada, y con ella la
afirmación de la cabecera del molde —«no sabe de dominio»— deja de ser una intención para
pasar a ser un hecho medido contra un caso de uso que no existía cuando se escribió.

Los dos adaptadores de dominio (`CategoriaDialogo`, `ProvinciaDialogo`) tampoco cambiaron
de comportamiento: sólo se les corrigió la documentación, que decía «escribe el valor en el
estado del buscador» cuando ahora tienen dos clientes que hacen cosas distintas con él.

### 15.2 · La pregunta del §12.5, contestada por un tercer camino

El §12 la planteó como un dilema: *«decidir si el de `/busqueda` deja de navegar o si el
molde admite un modo que navegue»*. **No hacía falta ninguna de las dos.**

El molde recibe `onElegir` y lo llama. Qué hace esa función —escribir estado en la portada,
`router.push` en el panel— nunca fue asunto suyo. La navegación estaba ya donde tenía que
estar:

| | Qué hace `onElegir` | Quién lo pone |
|---|---|---|
| Portada | `setCategory(slug)` · `setProvince(p)` | `SearchBar` |
| `/busqueda` y `/[categoria]` | `goTo(slug)` → `router.push` | `CategorySelect` |
| | `update({ province })` → `router.push` | `FilterPanel` |

`goTo` —con el carry de filtros de A2, la ruta canónica de A1 y el descarte de `page`— **no
se tocó una línea al cambiar el control**. Ése es el detalle que convierte la prueba en
prueba: si el molde hubiera llevado dominio escondido, cambiar el `<select>` por el diálogo
habría obligado a mover algo de ahí dentro.

Lo vigila `ui/dialogo-filtrable.molde.test.ts`, que lee el fuente del molde y exige que no
nombre `next/navigation`, `router.`, `window.location`, `lib/provincias`,
`lib/category-tree`, `@/types` ni `fetch`. La mutación que mata: meter un `useRouter` en la
capa funcionaría en `/busqueda` y rompería la portada sólo cuando alguien mirase.

### 15.3 · Un hallazgo: el guard no significaba lo que parecía

El encargo daba por supuesto que `/[categoria]` monta el panel con `categories={[]}` y que
por eso el diálogo de categoría no aparece allí. **No es así, y el guard sigue donde
estaba pero cubre otra cosa.**

Las dos rutas pasan el ÁRBOL COMPLETO
([`CategoryListingPage.tsx:522`](../apps/web/src/components/categorias/CategoryListingPage.tsx#L522),
[`busqueda/page.tsx:296`](../apps/web/src/app/(public)/busqueda/page.tsx#L296)) y el
selector de categoría se pinta en las dos — que es literalmente lo que A2 construyó: desde
`/vehiculos/coches` se puede saltar a Móviles o volver a la búsqueda global, y hay siete
casos de `e2e/busqueda-unificada.spec.ts` que lo ejercen. Un guard que lo escondiera en
`/[categoria]` desharía esa ráfaga.

Lo que `{categories.length > 0}` cubre es que **`getCategories()` haya fallado**: las dos
páginas lo piden con `.catch(() => [])` para no tumbar los resultados por culpa de un
selector, y sin árbol no hay lista que ofrecer. Se mantiene, con el porqué escrito al lado.

### 15.4 · La geometría, otra vez decidida por quien monta

El molde trae `h-10` (40 px, el alto de `ui/input.tsx`) y `md:text-base`. Los controles de
este panel miden **38 px** —`py-2` sobre una línea de 20 más el borde— y no suben de
`text-sm`, así que el disparador recibe por `className` la cadena EXACTA que llevan el
`<select>` de «Ordenar por», el de «Condición» y el campo «Ciudad», con `h-auto` para
devolverle el alto al contenido.

Se ve de un vistazo en «Ubicación», donde el disparador de provincia va pegado al campo
«Ciudad» en el mismo `flex-col`: dos píxeles de diferencia ahí se notan. Es el mismo
argumento del §2 del molde —el alto lo decide quien lo monta— ejercido por segunda vez y en
la dirección contraria a la portada, que pide `h-14 md:h-16`.

### 15.5 · Lo que `/busqueda` gana, más allá de la unificación

- **La provincia**: 52 entradas se recorren tecleando tres letras en vez de desplegando, y
  las grafías cooficiales (`Alicante/Alacant`, `Valencia/València`) se encuentran por
  cualquiera de sus dos mitades. El valor exacto lo garantiza ahora la FORMA del molde
  —`onElegir` sólo se llama desde el manejador de una fila— y no la disciplina de un
  `<select>`.
- **La categoría**: el `<select>` pintaba una `<option>` por nodo con su ruta entera
  dentro («Vehículos › Coches › Deportivos»); con cuatro niveles y un árbol real eso sólo
  se recorre a ojo. El diálogo filtra por el NOMBRE y enseña la ruta al lado.
- **Un control menos que mantener**: `CategorySelect` ya no compone etiquetas ni conoce el
  separador ` › `; las dos constantes que decían lo mismo han pasado a ser una.

### 15.6 · Lo que quedó fuera

El residuo de 8 px al abrir cualquier overlay (§12.3). Afecta por igual a los ~25 diálogos
anteriores al buscador; montar dos diálogos más en `/busqueda` no lo empeora ni lo mejora.
Es la ráfaga siguiente, y empieza por el diagnóstico.

> **El diagnóstico ya está hecho, y corrige a este párrafo y al §12.3.** No es «de la
> cabecera `sticky`»: es del banner de cookies, que es `position: fixed`. La cabecera no se
> mueve. Ver [`docs/diagnostico-residuo-8px.md`](./diagnostico-residuo-8px.md).
