# DIAGNÓSTICO — EL HUECO QUE DEJA UN BANNER QUE NO SE PINTA

> **Estado: diagnóstico cerrado y ARREGLADO.** El documento se conserva entero porque el
> censo (§3) y la medición (§2) son lo que explica por qué el arreglo está en dos sitios y
> no en catorce, y por qué el segundo sitio —el de los bloques— parecía roto en cuatro
> casos y sólo lo estaba en uno.

---

## 0. El veredicto, antes de los detalles

**El hueco no sale del banner. Sale del `<div>` que lo envuelve, que existe aunque el banner
decida no pintarse.**

Son dos mecanismos distintos, con la misma forma:

| | Dónde | Cuánto (medido en la página real) | Cuándo |
|---|---|---|---|
| **A** | El envoltorio de `BannerList` en cada página | **16 px en la portada**; **0 px en las otras nueve** | Cuando el visitante ya descartó el banner (la ×) |
| **B** | El `<div key>` por bloque de `BlockRenderer` / `HomeBlockRenderer` | **64 px** en portada y `/paginas`, **16 px** en un post | Sólo si el bloque invisible es **el último** |

> ⚠ **Ese «0 px en las otras nueve» es una corrección a este mismo documento, y es la
> parte que más vale la pena leer.** La primera versión anunciaba 16 / 24 / 32 px en diez
> páginas, medidos en un banco sintético. Al ejercitar la mutación contra las páginas de
> verdad, dos de las tres barreras **siguieron en verde con el defecto puesto**. La causa
> está en §2.3: el banco ponía el envoltorio vacío entre dos vecinos sin margen, y en las
> páginas reales el hermano de arriba **ya trae el suyo** (`mb-6`, `mb-10`…), que se funde
> con el del envoltorio y lo absorbe. El hueco visible de hoy son los 16 px de la portada
> —la única que usa **padding**, que no colapsa— y los 64 px del bloque final.
>
> Lo que queda en las otras nueve no es un hueco: es **un envoltorio latente**. No cuesta
> píxeles mientras el vecino de arriba conserve su margen, y los cuesta el día que alguien
> se lo quite, sin que nada avise. Se arreglan igual, y por eso: el arreglo quita la
> trampa, no sólo los píxeles.

La forma compartida —y es lo que hace que esto sea **una** clase de defecto y no dos
casualidades— es:

> **El espacio vive FUERA del componente que decide si hay algo que enseñar.**
> El componente devuelve `null` y cumple su parte; el envoltorio no se entera y se queda
> ocupando sitio.

La prueba de que es esa la variable, y no otra: en este mismo repo hay una pieza con el
mismo problema de partida y sin el defecto. `FeaturedBlock` ([`FeaturedBlock.tsx:35-42`](../apps/web/src/components/busqueda/FeaturedBlock.tsx#L35-L42))
también puede no tener nada que enseñar, y lleva **su propio `mb-6` en su propia raíz**:

```tsx
export function FeaturedBlock({ listings }: { listings: ListingSummary[] }) {
  if (listings.length === 0) return null;
  return <section className="mb-6" …>
```

`null` se lleva el margen con él. No hay envoltorio al que olvidársele.

---

## 1. Qué quiere decir «activo pero invisible» — los cuatro caminos, y cuál es el vivo

El encargo describe «activo en admin pero su lógica decide no mostrarlo». Contra el código
hay cuatro caminos posibles y **sólo uno llega al usuario**:

| Camino | Dónde se decide | ¿Deja hueco? |
|---|---|---|
| `active = false` | **Servidor**, Postgres ([`banners.service.ts:26-34`](../apps/api/src/modules/banners/banners.service.ts#L26-L34)) | **No.** `getActiveBanners` devuelve `[]`, el guard `banners.length > 0` del punto de llamada no monta nada. |
| Fuera de ventana (`startsAt`/`endsAt`) | **Servidor**, misma consulta | **No**, por lo mismo. |
| Ubicación no marcada | **Servidor**, `placements: { has: placement }` | **No**, por lo mismo. |
| **Descartado por el visitante (la ×)** | **CLIENTE**, `localStorage` ([`BannerList.tsx:75-96`](../apps/web/src/components/banners/BannerList.tsx#L75-L96)) | **SÍ.** |

Y esto es lo que hace que el defecto sea escurridizo: **los tres caminos de servidor están
bien y siempre lo estuvieron.** El HTML nace sin el banner y sin su envoltorio. Quien mire
un banner apagado en admin y recargue la página **no ve ningún hueco** — y concluirá que no
hay nada que arreglar.

El que falla es el cuarto, y es de cliente:

1. El servidor SÍ devuelve el banner (está activo, en fecha, en esa ubicación).
2. La página monta el envoltorio con su margen, porque `banners.length > 0` es cierto.
3. `BannerList` hidrata, lee `localStorage` en un efecto, ve que ese id ya está descartado y
   devuelve `null` ([`BannerList.tsx:95-96`](../apps/web/src/components/banners/BannerList.tsx#L95-L96)).
4. **El envoltorio se queda.** Vacío, con su margen intacto.

O sea: el hueco lo ve **el visitante que ya cerró el aviso**, que es exactamente el visitante
al que se le prometió que dejaría de existir. Y lo ve **en las diez páginas a la vez**,
porque el descarte es global por id (§4.1 de `diseno-banners-ubicaciones.md`): una × en la
portada deja un hueco en la búsqueda, en la categoría, en el blog, en la ficha, en planes,
en vendedor, en contacto y en mis-anuncios.

---

## 2. Los píxeles — medidos en las páginas de verdad

Método, y **son dos**, porque el primero solo no bastó:

- **El banco** — se compila el CSS real del proyecto (`npx tailwindcss -i
  src/app/globals.css`, con `tailwind.config.ts` y sus tokens, `--ritmo-bloques: 4rem`)
  contra una página que reproduce cada envoltorio literal entre dos vecinos de altura
  conocida. Responde «¿qué hace esta clase?».
- **La inyección en la página real** — se carga la página en el navegador de la batería,
  se mira dónde cae el banner, se apaga, y se inserta en su sitio exacto un `<div>` vacío
  con la misma clase. La diferencia de posición del hermano siguiente **es el hueco**.
  Responde «¿qué hace esta clase **aquí**?», que resultó ser otra pregunta.

### 2.1 Mecanismo A — el envoltorio de `BannerList`, medido página a página

| Página | Envoltorio | Hermano siguiente | limpio | con envoltorio vacío | **hueco** |
|---|---|---|---|---|---|
| `/` | `container mx-auto px-4 pt-4` | `<section>` (la banda del hero) | 65 | **81** | **16 px** |
| `/anuncio/listing-rf11-e2e` | `mb-4` | `<div>` | 137 | 137 | 0 |
| `/busqueda` | `mb-6` | `<div>` | 137 | 137 | 0 |
| `/vehiculos/coches` | `mb-6` | `<div>` | 191 | 191 | 0 |
| `/blog` | `mb-6` | `<div>` | 233 | 233 | 0 |
| `/blog/[slug]` | `mb-6` | `<div>` | 161 | 161 | 0 |
| `/contacto` | `mb-6` | `<form>` | 209 | 209 | 0 |
| `/planes` | `mx-auto mb-8 max-w-4xl` | `<div>` | 233 | 233 | 0 |
| `/vendedor/[slug]` | `mb-8` | `<div>` | 217 | 217 | 0 |
| `/mis-anuncios` | `mb-6` | — | *no medida* (pide sesión; misma forma que las ocho de arriba) | | |
| las 6 de cuenta | *(sin envoltorio)* | — | — | — | **0** ✔ |

**Un 16 y ocho ceros.** El banco decía 16 / 24 / 32 en todas, y la diferencia está en el
vecino:

- **La portada usa PADDING** (`pt-4`), y el padding no colapsa con nada: 16 px de caja,
  siempre, pase lo que pase alrededor. Es el hueco que se ve.
- **Las demás usan MARGEN**, y el elemento que va justo encima del banner **ya trae el
  suyo** — el `<p class="mb-6">` de contacto, el `<div class="mb-10">` de planes, la
  cabecera del blog. Dos márgenes verticales adyacentes se funden en uno solo del tamaño
  del mayor: `max(24, 24) = 24`, que es lo que ya había. El envoltorio vacío **no añade
  nada**. En el banco, donde el vecino de arriba era un bloque pelado sin margen, sí
  añadía — y ésa era la diferencia entre el banco y la página.
- **Las seis páginas de cuenta ya estaban bien**, y no por suerte: §3.3 de
  `diseno-banners-ubicaciones.md` mandó no ponerles envoltorio para no doblar el hueco, y al
  no haber envoltorio, `null` no deja nada. El acierto de entonces es la demostración del
  arreglo de ahora.

**Qué son entonces esos ocho ceros.** No «no hay defecto»: **un envoltorio latente**. El
`<div>` vacío está ahí, con su margen puesto, y hoy no cuesta píxeles porque el vecino de
arriba se lo come. Lo cuesta el día que ese vecino pierda su `mb-6` —un rediseño, un
`space-y-*` que sustituya a los márgenes sueltos—, y ese día el hueco aparecerá en una
página que nadie estaba tocando. El arreglo de §4 quita la trampa; que además quite 16 px
visibles es el caso de hoy, no la razón.

### 2.2 Mecanismo B — el `<div key>` por bloque

`BlockRenderer` ([`BlockRenderer.tsx`](../apps/web/src/components/blocks/BlockRenderer.tsx)) y
`HomeBlockRenderer` ([`HomeBlockRenderer.tsx`](../apps/web/src/components/home/HomeBlockRenderer.tsx))
envuelven **cada** bloque en un `<div key={block.id}>` dentro de un
`space-y-[var(--ritmo-bloques)]`. Cuatro renderizadores editoriales pueden devolver `null`:
el bloque de publicidad con imagen de dominio no permitido ([`AdBannerBlockRenderer.tsx:24`](../apps/web/src/components/blocks/AdBannerBlockRenderer.tsx#L24)),
el de imagen ([`ImageBlockRenderer.tsx:18`](../apps/web/src/components/blocks/ImageBlockRenderer.tsx#L18)),
el de anuncios sin datos o con categoría vacía ([`ListingsBlockRenderer.tsx:45-47`](../apps/web/src/components/blocks/ListingsBlockRenderer.tsx#L45-L47)),
y en portada el carrusel sin categorías válidas, la rejilla con imagen no permitida y la
tabla de búsquedas sin enlaces.

Mismo método de inyección, sobre los contenedores de bloques reales:

| Página | Contenedor | Bloque invisible **en medio** | Bloque invisible **el último** |
|---|---|---|---|
| `/` | los dos de la portada | **+0 px** | **+64 px** |
| `/paginas/como-comprar-con-seguridad` | el del cuerpo | **+0 px** | **+64 px** |
| `/blog/[slug]` | el del artículo | **+0 px** | **+16 px** |

**Aquí la medición volvió a corregir la sospecha, en la otra dirección.** El `<div>` vacío
en medio *parece* que tiene que dejar 64 px de más, y no los deja: el `space-y-*` de
Tailwind pone `margin-top` y un `margin-bottom: 0`, así que el `<div>` vacío se auto-colapsa
y su margen se funde con el del hermano siguiente — 64 y 64 dan 64. Donde no hay hermano
siguiente con quien fundirse es **al final del contenedor**, y ahí sí: el margen se escapa
y separa los bloques de lo que venga detrás.

Los 16 px del post en vez de 64 son el mismo fenómeno de §2.1 una vez más: ahí lo que sigue
al contenedor tiene margen propio y absorbe la mayor parte.

### 2.3 Lo que el aviso del código ya prometía, y no era cierto

```
// ListingsBlockRenderer.tsx:16-18
// Estado vacío: si `data` no llega o no tiene anuncios, el bloque se OCULTA
// (return null) — no deja un hueco visible en la página.
```

Y las dos pruebas que lo defienden ([`BlockRenderer.test.tsx:296-307`](../apps/web/src/components/blocks/BlockRenderer.test.tsx#L296-L307))
comprueban `container.textContent === ''`. **Texto, no espacio.** Un `<div>` vacío con 64 px
de margen pasa esa prueba con sobresaliente. El comentario decía la verdad sobre el
componente y una mentira sobre la página; la prueba medía lo que el comentario decía, no lo
que prometía.

---

## 3. El censo — quién monta envoltorio y quién no

15 puntos de llamada de `BannerList`. **Diez montan envoltorio propio; cinco son hijos
directos de un `space-y-*`. Uno —`mis-anuncios`— monta envoltorio aunque esté en una página
de cuenta.** De los diez, **uno cuesta píxeles hoy** y nueve son latentes (§2.1).

| Página | Envoltorio | Hueco hoy |
|---|---|---|
| `(public)/(home)/page.tsx` | `container mx-auto px-4 pt-4` | **16 px** — padding, no colapsa |
| `(public)/anuncio/[slug]/page.tsx` | `mb-4` | 0 — latente |
| `(public)/busqueda/page.tsx` | `mb-6` | 0 — latente |
| `components/categorias/CategoryListingPage.tsx` | `mb-6` | 0 — latente |
| `(public)/blog/page.tsx` | `mb-6` | 0 — latente |
| `(public)/blog/[slug]/page.tsx` | `mb-6` | 0 — latente |
| `(public)/contacto/page.tsx` | `mb-6` | 0 — latente |
| `(account)/mis-anuncios/page.tsx` | `mb-6` | 0 — latente (no medida) |
| `(public)/planes/page.tsx` | `mx-auto mb-8 max-w-4xl` | 0 — latente |
| `(public)/vendedor/[slug]/page.tsx` | `mb-8` | 0 — latente |
| `(account)/perfil/page.tsx` | — (`space-y-8`) | 0 — sin envoltorio ✔ |
| `(account)/perfil/facturacion/page.tsx` | — (`space-y-8`) | 0 — sin envoltorio ✔ |
| `(account)/perfil/suscripcion/page.tsx` | — (`space-y-8`) | 0 — sin envoltorio ✔ |
| `(account)/mis-alertas/page.tsx` | — (`space-y-6`) | 0 — sin envoltorio ✔ |
| `(account)/mis-creditos/page.tsx` | — (`space-y-10`) | 0 — sin envoltorio ✔ |

### 3.1 Los que NO son de esta clase — comprobados y descartados

- **`SponsoredCard`** ([`ResultsList.tsx:45,61`](../apps/web/src/components/busqueda/ResultsList.tsx#L45)):
  no tiene envoltorio ni puede estar vacío — es un elemento más del array de resultados. Si
  no hay patrocinado, no hay elemento. Sano.
- **`FeaturedBlock`**: el modelo correcto (§0). Sano, y con su prueba
  (`toBeEmptyDOMElement()`).
- **`CampaignNotice`** ([`mis-creditos/page.tsx:150-154`](../apps/web/src/app/(account)/mis-creditos/page.tsx#L150-L154)):
  tiene la misma **forma** (`condición && <div className="mb-4">…`), pero el componente no
  puede devolver `null` — si el guard pasa, pinta. Sano **hoy**; es el primero que se
  rompería el día que decida esconderse solo.

### 3.2 La nota que ya lo había visto — y que se marcó «opcional»

§3.3 de [`diseno-banners-ubicaciones.md`](diseno-banners-ubicaciones.md) hizo este censo
antes de escribir el código, acertó con las cinco páginas de cuenta… y cerró así:

> Y como el guard `banners.length > 0` se repite 14 veces, vale la pena un componente de dos
> líneas —`<BannerSlot banners={…} className?>`— que encapsule guard + margen.
> **Opcional**; si no se hace, la regla de arriba basta.

No se hizo. El hueco de §2.1 es el precio de ese «opcional»: la regla de arriba basta para
que el espaciado sea correcto **mientras el banner se pinta**, y no dice nada del día en que
el componente decide no pintarse. **El arreglo de §4 es, literalmente, ese componente** —
con la corrección de que no hace falta uno nuevo: `BannerList` ya es el componente
compartido, sólo le faltaba quedarse con su propio espacio.

---

## 4. El arreglo — dos sitios, la clase entera

### 4.1 Mecanismo A — el espaciado se mete DENTRO de `BannerList`

`BannerList` acepta `className` y lo pone **en su propia raíz**. Los diez puntos de llamada
pierden el envoltorio y el guard: pasan su espaciado como clase.

```tsx
// antes — el margen sobrevive al null
{banners.length > 0 && (
  <div className="mb-6">
    <BannerList banners={banners} />
  </div>
)}

// después — el null se lleva el margen con él
<BannerList banners={banners} className="mb-6" />
```

El guard `banners.length > 0` se va con el envoltorio, y no por ahorrar líneas: **era la
segunda copia de una decisión que ya vive dentro del componente** (`if (visible.length === 0)
return null`). Dos sitios decidiendo lo mismo es justamente cómo se llega a que uno de ellos
—el de fuera— se quede desactualizado, que es este defecto exactamente.

Y el espaciado de cada página **no cambia ni un píxel**: la misma clase, en un elemento que
está en la misma posición del flujo. Medido en §5.

### 4.2 Mecanismo B — `empty:hidden` en el envoltorio por bloque

Aquí el envoltorio **no se puede quitar**: `TextBlockRenderer` devuelve `<MarkdownBody>`,
que rinde varios hermanos (los párrafos del artículo). Sin el `<div>`, el
`space-y-[var(--ritmo-bloques)]` metería 64 px **entre cada párrafo**. El envoltorio sostiene
la estructura y se queda.

Lo que se le añade es una condición que el propio navegador evalúa:

```tsx
<div key={block.id} className="empty:hidden">{renderBlock(…)}</div>
```

`:empty` casa con un elemento sin hijos — que es exactamente el estado de un envoltorio cuyo
bloque devolvió `null`, y sólo ése. `display: none` no genera caja, así que tampoco genera
margen, y el margen de 64 px deja de escaparse por el final del contenedor.

**Por qué el navegador y no React:** el padre no puede saber si el hijo va a devolver `null`
sin renderizarlo —`renderBlock` devuelve `<AdBannerBlockRenderer/>`, no su resultado—, y la
decisión vive dentro de cada componente. `:empty` es la única forma de preguntarlo después
de que se haya decidido, y se evalúa en el mismo pintado, no en un efecto: **sin salto**.

---

## 5. La verificación

### 5.1 Los números, después

Medidos en las páginas reales por
[`e2e/hueco-banner-invisible.spec.ts`](../apps/web/e2e/hueco-banner-invisible.spec.ts), que
compara tres estados de la misma página en la misma corrida: **SIN** banner, **CON** banner
y **DESCARTADO** (el servidor lo manda, el visitante ya le dio a la ×).

| Página | CON − SIN | DESCARTADO vs SIN |
|---|---|---|
| `/` (`pt-4`) | alto de la caja del banner, sin margen extra ✔ | **iguales** ✔ (antes: +16 px) |
| `/contacto` (`mb-6`) | alto + 24 px ✔ | **iguales** ✔ |
| `/planes` (`mb-8`) | alto + 32 px ✔ | **iguales** ✔ |

La afirmación se escribe como **igualdad, no umbral**: «como si no existiera» no admite
«casi». Y la otra mitad —`CON − SIN` es exactamente la caja del banner— es lo que impide
«arreglar» el hueco quitando el espaciado y dejando el banner pegado a lo de al lado.

Para el mecanismo B, la misma inyección de §2.2 con `empty:hidden` puesto: **+0 px** en las
tres posiciones, incluida la última, contra los +64 / +16 de antes.

### 5.2 Las barreras

- **B1 — invisible sin hueco.** En unidad: `BannerList` con todo descartado no deja
  **ningún nodo** (`toBeEmptyDOMElement`), y el envoltorio por bloque vacío lleva
  `empty:hidden`. En navegador: **DESCARTADO == SIN, al píxel**, en las tres formas de
  envoltorio.
- **B2 — visible integrado.** Dos mitades: el espaciado declarado por la página está **en
  la raíz** del componente (computado, no la clase), y la página crece **exactamente** la
  caja del banner — ni pegado ni descolgado.
- **B3 — sin CLS.** El banner nace **en el HTML del servidor** (§1): no se reserva para
  rellenar después. Instrumento el de
  [`buscador-dialogos.spec.ts`](../apps/web/e2e/buscador-dialogos.spec.ts) —guarda también
  las fuentes del salto— adaptado a `addInitScript` + `buffered: true`, porque aquí lo que
  se vigila es la carga y no una interacción posterior. **Con su propio guard:** una prueba
  inyecta un salto de 80 px y exige que el instrumento lo acuse, para que un verde no pueda
  significar «no estaba escuchando».
- **B4 — la clase.** El arreglo está en **tres ficheros compartidos** (`BannerList`,
  `BlockRenderer`, `HomeBlockRenderer`), no en los quince puntos de llamada; lo que cambia
  en los puntos de llamada es que **dejan** de decidir.

### 5.2.1 Por qué el CLS no exige un cero pelado, y cómo se decidió

La primera versión de B3 exigía `total === 0`, como hace `buscador-dialogos`. Salió
**flaky**: unas corridas daban 0 y otras 0,000053 **con la lista de fuentes vacía** —un
desplazamiento sin nodo al que atribuirlo, del orden de una centésima de píxel repartida por
la página—, y salía **igual con banner y sin él**. No es el banner: es el suelo de ruido de
la página.

Un cero pelado ahí no mediría el banner, mediría la suerte de la corrida. La barrera se
escribe entonces como las dos afirmaciones que sí son del banner: **CON no es peor que SIN**
(la misma página, las dos medidas en la misma corrida) y **ninguna fuente del salto es el
banner**. El techo, 0,001, no es un número de compromiso: un hueco de 24 px que apareciera o
desapareciera en un viewport de 720 px da un CLS del orden de 0,03 — **seiscientas veces**
el ruido medido. El defecto que la prueba persigue no cabe por debajo de ese techo.

### 5.3 Lo que este diagnóstico NO arregla, y por qué

El parpadeo del banner ya descartado —se pinta desde el servidor, y desaparece al hidratar—
**es anterior y sigue igual**. Está declarado y aceptado en el propio componente
([`BannerList.tsx:64-70`](../apps/web/src/components/banners/BannerList.tsx#L64-L70)): el
descarte vive en `localStorage`, que el servidor no puede leer, y el primer render tiene que
coincidir con el SSR o se rompe la hidratación. Quitarlo del todo pide mover el descarte a
una **cookie** —para que el servidor decida—, y eso es un cambio de modelo, no de maquetado.

Lo que sí cambia: hasta ahora ese parpadeo **dejaba un hueco detrás**; a partir de ahora la
página queda como si el banner no existiera. El salto que queda es el mismo de siempre, no
uno nuevo.

