# Auditoría — El escaparate: los bloques, los CTAs y el hero contra la dirección A

> **Qué es esto.** El mapa del hueco entre la **dirección A («Escaparate»)** de
> [`docs/Mejoras de estilos de plataforma/Propuestas de estilo.dc.html`](Mejoras%20de%20estilos%20de%20plataforma/Propuestas%20de%20estilo.dc.html)
> y **lo que hay hoy en el código**. Bloque a bloque, token a token. **Cero código**: esto
> se escribe para poder diseñar después con las medidas delante.
>
> **Todo lo que sigue está verificado contra el repositorio**, no supuesto. El §11 lista
> qué se abrió y qué se comprobó en cada fichero.

---

## 0. El veredicto, en una tabla

| El encargo | ¿Cabe? | Dónde está el precio |
|---|---|---|
| **Revestir todos los bloques a la dirección A** | **Sí, y es casi todo revestir** | 21 de los 24 bloques cambian sólo clases; 3 cambian estructura (§2) |
| **CTAs espectaculares, con sabor por modelo** | **Sí, y por la puerta buena** | `CtaButton` es un solo punto (§4). El efecto es común; el sabor son `--motion-*`, `--primary`, `--radius` |
| **Hero a sangre, ambiente por modelo** | **Sí** | Faltan 2 tokens (`hero-ambiente`, `hero-patron`) y 1 nodo DOM común (§3.2) |
| **Hero a pantalla completa** | **Sí, con condiciones** | ⚠ **Esto NO está en la propuesta**: la propuesta es *a sangre*, no *100 vh* (§5.2). Hay aritmética que cerrar (cabecera, banner, preview) |
| **Hero más configurable** | **Sí** | La frontera admin/modelo hay que decidirla — son 6 campos candidatos (§5.4) |
| **Que la invariancia siga verde** | **Sí, y hay que ampliarla** | ⚠ **El test de invariancia NO mira la portada, ni el blog, ni las páginas** (§6.3). Hoy el escaparate es terreno sin barrera |
| **Que el SEO/LCP no se degrade** | **Sí, con 4 vigilancias** | El titular no se anima nunca; el patrón es CSS; el brillo es `transform`; la altura se reserva (§7) |

**Los tres hallazgos que más cambian el plan:**

1. **La propuesta no lleva hero a pantalla completa.** Su hero A mide ~500 px de alto
   (padding `84px/118px` + contenido). «A sangre» y «pantalla completa» son **dos peticiones
   distintas**; la segunda es de Ernest, no de la propuesta, y es la única que tiene riesgo
   real de LCP/CLS. Ver §5.2.
2. **Ni el test de invariancia ni la batería visual cubren la portada, el blog o las
   páginas.** Las tres superficies que el escaparate va a repintar enteras son exactamente
   las tres que hoy **no tienen ninguna barrera**. Ver §6.3 y §8.
3. **`rounded-xl` / `rounded-2xl` no responden al modelo.**
   [`tailwind.config.ts:95-99`](../apps/web/tailwind.config.ts#L95-L99) sólo ata `lg`, `md`
   y `sm` a `var(--radius)`. Las tarjetas del carrusel, de la rejilla de categorías y del
   blog llevan `rounded-xl` = 0.75 rem **fijos**, así que hoy un modelo con `radius: 0.125rem`
   (Premium) tiene tarjetas tan redondeadas como uno con `0.5rem`. El
   `calc(var(--radius) * 2.2)` de la propuesta no es un capricho: es el arreglo de un
   agujero que ya existe. Ver §3.4.

---

## 1. Qué es la propuesta, y sobre qué está construida

### 1.1 Está sobre nuestro sistema — verificado token a token

La propuesta **no inventa un sistema de estilo**: consume el nuestro. Su `<style>` de
cabecera declara un `:root` con nuestros nombres y su script
([líneas 665-696](Mejoras%20de%20estilos%20de%20plataforma/Propuestas%20de%20estilo.dc.html))
dice literalmente «*Resolutor de tokens fiel a `apps/api/src/modules/estilo`*» y reimplementa
`derivar` (rampa sobre el neutral) y `mejorTexto` (letra por contraste), que es exactamente
lo que hacen [`resolverTokens`](../apps/api/src/modules/estilo/estilo.constants.ts#L2740-L2790)
y `mejorTextoSobre`.

Tokens que la propuesta usa y **que existen hoy**:

| Token de la propuesta | Existe | Dónde se declara |
|---|---|---|
| `--bg` / `--fg` / `--card` / `--muted` / `--muted-fg` / `--border` / `--input` | ✅ (con nuestros nombres: `--background`, `--foreground`, `--muted-foreground`…) | rampa del modelo |
| `--primary`, `--primary-fg`, `--secondary`, `--accent` (+ sus letras) | ✅ | los 4 configurables + letra derivada |
| `--radius` | ✅ | `ejes` del modelo |
| `--shadow-sm` / `--shadow` / `--shadow-md` / `--shadow-lg` | ✅ | `ejes` del modelo |
| `--motion-duration`, `--motion-ease` | ✅ | `ejes` del modelo |
| `--font-heading` | ✅ | `ejes` del modelo, aplicado a `h1…h6` en [`globals.css:287-294`](../apps/web/src/app/globals.css#L287-L294) |

Tokens que la propuesta usa y **que NO existen**: `heroFondo`, `heroPatron`, `ritmo`. Los
tres se analizan en §3.

**Consecuencia directa:** «para todos los modelos» no es una aspiración, es una propiedad
mecánica. Los bloques revestidos con estos tokens **se revisten solos** con los 5 modelos
del catálogo y sus 10 versiones, sin una línea por modelo. Es la razón por la que esta
dirección cabe.

### 1.2 La propuesta va un modelo por detrás del catálogo

La propuesta declara 4 modelos (`calido-editorial`, `fresco-confianza`, `premium`,
`vibrante`) con **un solo bloque `ambiente` por modelo**. El catálogo real tiene **5
modelos y 10 versiones**
([`estilo.constants.ts:2679-2685`](../apps/api/src/modules/estilo/estilo.constants.ts#L2679-L2685)):

| Modelo | Versiones | ¿La propuesta lo cubre? |
|---|---|---|
| `modelo-0` | `1` (Original) | ❌ — no aparece en la propuesta |
| `calido-editorial` | `dia`, `tarde` | Parcial: un solo `ambiente` para las dos |
| `fresco-confianza` | `claro`, `nitido` | Parcial |
| `premium` | `claro`, `claro-intenso`, **`oscuro`** | Parcial — y `oscuro` es el caso duro |
| `vibrante` | `pop`, `suave` | Parcial |

⚠ **`premium@oscuro` es el que pone a prueba el ambiente.** Es la única versión de lienzo
invertido del catálogo (carbón, texto claro). Un `heroFondo` escrito como «degradado del
primario sobre `muted → bg`» funciona en los nueve lienzos claros y **hay que mirarlo en el
oscuro antes de darlo por bueno**. La buena noticia: el mecanismo ya existe —
[`AjustesDeVersion`](../apps/api/src/modules/estilo/estilo.constants.ts#L336-L360) permite
que una versión redefina `ejes`, así que `premium@oscuro` puede traer su propio ambiente sin
tocar el modelo. **Decisión 6 del §10.**

---

## 2. EL HUECO, BLOQUE A BLOQUE

Leyenda: **R** = revestir (sólo clases/tokens; el DOM no se mueve) · **R+** = revestir con
un nodo nuevo **común a todos los modelos** · **E** = reestructurar (el DOM cambia, para
todos por igual).

### 2.1 Portada — los 8 bloques de `HomeBlockRenderer`

Registro real:
[`HomeBlockRenderer.tsx:59-87`](../apps/web/src/components/home/HomeBlockRenderer.tsx#L59-L87).
(El encargo listaba 7; hay un octavo, `videoUpload`.)

| Bloque | Hoy | La propuesta (dirección A) | Hueco |
|---|---|---|---|
| **`cta`** | Un botón suelto centrado: `<div class="flex justify-center">` + `<Button size="lg">` ([`CtaHomeBlockRenderer.tsx`](../apps/web/src/components/home/blocks/CtaHomeBlockRenderer.tsx), [`CtaButton.tsx:52-62`](../apps/web/src/components/shared/CtaButton.tsx#L52-L62)) | **Banda a sangre** en `--primary`: titular + frase + botón inverso a la derecha ([líneas 253-265](Mejoras%20de%20estilos%20de%20plataforma/Propuestas%20de%20estilo.dc.html)) | **E** — ver §2.4 |
| **`search`** | `SearchBar` + eyebrow + chips ([`SearchHomeBlockRenderer.tsx`](../apps/web/src/components/home/blocks/SearchHomeBlockRenderer.tsx)) | Mismo contenido, caja `radius*3`, `shadow-lg`, botón de 64 px con brillo, chips que levantan · **y montado −46 px sobre la banda del hero** | **R** en todo, salvo el solapamiento: **E** — ver §2.6 |
| **`grid`** | Tarjetas `rounded-lg border p-4`, hover `bg-muted/50` ([`GridHomeBlockRenderer.tsx:106-119`](../apps/web/src/components/home/blocks/GridHomeBlockRenderer.tsx#L106-L119)) | Tarjetas centradas con icono en círculo `--muted`, texto atenuado | **R** |
| **`steps`** | Dos columnas, número en círculo `bg-primary`, CTA `variant="link"` ([`StepsHomeBlockRenderer.tsx`](../apps/web/src/components/home/blocks/StepsHomeBlockRenderer.tsx)) | Cada columna dentro de **tarjeta** (`border`, `radius*2.4`, `shadow-sm`), audiencia en versalitas `--primary` | **R** (la tarjeta es un `className` en el `<div>` que ya existe) |
| **`listings`** | Rejilla 2/3/4 col. de `ListingCard` ([`ListingsHomeBlockRenderer.tsx:79-83`](../apps/web/src/components/home/blocks/ListingsHomeBlockRenderer.tsx#L79-L83)) | Rejilla de 4, tarjeta que **levanta 4 px** y sube a `shadow-lg`, precio con `--font-heading` | **R** (en `ListingCard`, ver §2.5) |
| **`categoryCarousel`** | Carril `snap-x`, tarjetas `w-32 rounded-xl`, foto `h-20` ([`CategoryCarouselHomeBlockRenderer.tsx:58-84`](../apps/web/src/components/home/blocks/CategoryCarouselHomeBlockRenderer.tsx#L58-L84)) | Tarjetas **altas** (`aspect-ratio 4/5`), foto a sangre arriba, texto abajo, hover `−4 px` + `shadow-lg` | **R** (clases; el `<a><img><span>` ya es el mismo) |
| **`searchTable`** | Pestañas + `<ul>` en 2/3/4 columnas ([`SearchTableHomeBlockRenderer.tsx`](../apps/web/src/components/home/blocks/SearchTableHomeBlockRenderer.tsx)) | Pestañas con subrayado `--primary`, enlaces en `columns:4` con más interlínea | **R** |
| **`videoUpload`** | `<figure>` + `<video>` `rounded-lg` | No aparece en la propuesta | **R** por coherencia (radio y sombra del resto) |

### 2.2 Blog y páginas — los 16 bloques de `BlockRenderer`

Registro real:
[`BlockRenderer.tsx:41-82`](../apps/web/src/components/blocks/BlockRenderer.tsx#L41-L82).
(El encargo listaba 15; falta `cookiePreferences`.)

| Bloque | Hoy | La propuesta | Hueco |
|---|---|---|---|
| **`text`** | `MarkdownBody` con `prose` | Cuerpo a 17 px / 1.72 | **R** (vía `prose`, ver ⚠ abajo) |
| **`quote`** | Filete `border-l-4 border-primary/40`, texto atenuado ([`QuoteBlockRenderer.tsx`](../apps/web/src/components/blocks/QuoteBlockRenderer.tsx)) | **Pieza**: filete macizo `--primary`, fondo `--muted`, esquinas derechas redondeadas, `--font-heading` a 22 px | **R** |
| **`faq`** | Acordeón Radix suelto ([`FaqBlockRenderer.tsx`](../apps/web/src/components/blocks/FaqBlockRenderer.tsx)) | Acordeón **dentro de una caja** con borde y `radius*2`, filas separadas | **R** |
| **`hub`** | Tarjetas `rounded-lg border p-4` hover `bg-muted/50` | Tarjetas que levantan | **R** |
| **`image`** | `<img class="w-full rounded-lg">` + `figcaption` | Igual, con radio mayor | **R** |
| **`cta`** | **El mismo `CtaButton` que la portada** | En página: **caja** `radius*3` en `--primary`, titular + frase + botón inverso | **E** — ver §2.4 |
| **`quote` / `separator` / `table` / `profile`** | Sobrios, `rounded-lg border` | Coherencia de radio, sombra y borde | **R** |
| **`imageText`** | `grid md:grid-cols-2 gap-6` | Igual, imagen con radio mayor | **R** |
| **`steps`** | Lista con círculo `bg-primary` | Cada paso en **tarjeta** con borde y sombra | **R** |
| **`listings`** | Rejilla de `ListingCard` (sin favoritos ni atributos, a propósito) | Igual que en portada | **R** |
| **`video` / `videoUpload` / `adBanner`** | `rounded-lg`, `aspect-video` | No aparecen | **R** por coherencia |
| **`cookiePreferences`** | Panel `rounded-lg border bg-muted/30 p-5` | No aparece | **R** por coherencia |

⚠ **El cuerpo del texto NO se toca desde el modelo.** La medida de línea y la escala
tipográfica son estructura, y así está escrito en el registro: la zona `blog` tiñe el lienzo
y baja el tempo, *«la tipografía de cuerpo y la medida de línea son ESTRUCTURA (…) así que
una zona no las toca»*
([`estilo.constants.ts:725-744`](../apps/api/src/modules/estilo/estilo.constants.ts#L725-L744)).
Subir el cuerpo de los artículos a 17 px es una decisión **del producto, común a todos los
modelos** — legítima, pero no un token de modelo. Ver §6.1.

### 2.3 Los contenedores — el «ritmo» y las cajas

Lo que la propuesta llama `ritmo` (86 px entre bloques) hoy son dos constantes escritas:

| Dónde | Valor de hoy | Propuesta A |
|---|---|---|
| [`HomeBlockRenderer.tsx:93`](../apps/web/src/components/home/HomeBlockRenderer.tsx#L93) | `space-y-12` (48 px) | 86 px |
| [`(home)/page.tsx:90`](../apps/web/src/app/(public)/(home)/page.tsx#L90) | `space-y-12 py-12` | ídem |
| [`BlockRenderer.tsx:99`](../apps/web/src/components/blocks/BlockRenderer.tsx#L99) | `space-y-8` (32 px) | 44 px (gap de la columna A) |
| Ancho de la portada | `container mx-auto px-4` | `max-width:1180px` |
| Ancho de un artículo | `max-w-3xl` (768 px) | 820 px |

**Es revestir en el sentido estricto** (una clase por contenedor) pero **no es un token de
modelo**: el espaciado es la capa inviolable. Ver §3.3.

### 2.4 EL BLOQUE `cta` — la pregunta que el encargo hace explícita

**Hoy:** `HomeCtaBlock` y `CtaBlock` guardan **tres campos**: `label`, `href`, `style`
(`primary | secondary | outline`)
([`home-blocks.ts:22-28`](../apps/web/src/types/home-blocks.ts#L22-L28)). Los dos motores
traducen a las mismas props planas y pintan
[`CtaButton`](../apps/web/src/components/shared/CtaButton.tsx) — un `<div class="flex
justify-center">` con un `<Button asChild size="lg">` dentro. Nada más.

**La propuesta:** una banda con **titular (`<h2>`), frase (`<p>`) y botón**, a sangre en
portada y en caja redondeada en una página.

**Veredicto: es REESTRUCTURAR, y no hay forma de fingir lo contrario.** El `<h2>` y el `<p>`
son **contenido nuevo**: no existen en el modelo de datos, no se pueden derivar del `label`
y no los puede inventar el CSS. Eso significa:

1. **Cambia el esquema** (`UpdateHomepageDto` + los DTO del blog + los dos editores): el
   bloque gana `title?` y `description?` — opcionales, o toda portada guardada dejaría de
   validar.
2. **Cambia el renderizador** (`CtaButton` o un envoltorio nuevo).
3. **La estructura nueva es COMÚN a los cinco modelos.** Todos pintan la banda; cada uno la
   reviste con su `--primary`, su `--radius` y su tempo. **Ningún modelo la añade o la
   quita.** Esa es exactamente la condición que mantiene la invariancia verde (§6.2).
4. **Sin `title` guardado, el bloque tiene que seguir pintando el botón suelto.** No por
   nostalgia: porque el `<h2>` condicional es lo que evita que una portada existente aparezca
   con una banda vacía. Mismo criterio que `GridHomeBlockRenderer` con las celdas sin `media`
   ([`GridHomeBlockRenderer.tsx:74-77`](../apps/web/src/components/home/blocks/GridHomeBlockRenderer.tsx#L74-L77)).

⚠ **El `style` del bloque se queda corto.** Con una banda a sangre, `primary | secondary |
outline` deja de describir lo que hay: el botón de dentro es **inverso** (`background:
var(--bg); color: var(--primary)`), que no es ninguna de las tres variantes de
[`button.tsx:11-21`](../apps/web/src/components/ui/button.tsx#L11-L21). O se añade una
variante `inverse` al `Button` (común a todos los modelos, se reviste sola) o el CTA de banda
deja de usar `Button`. **Decisión 4 del §10.**

⚠ **Contraste.** Un botón `--background` sobre banda `--primary` con letra `--primary`
encima: esa pareja **no la mide hoy ninguna barrera**.
[`validarContraste`](../apps/api/src/modules/estilo/estilo.constants.ts#L3011) mide
`primary/primary-foreground` y `foreground/background`, no `primary/background`. Si la banda
entra, esa pareja entra en `parejasBloqueantes` **el mismo día**, o se publica una banda
donde la letra puede no leerse en algún modelo. **Es trabajo de la misma ráfaga, no un
extra.**

### 2.5 LAS TARJETAS — hay cuatro dialectos de hover, y ninguno es el de la propuesta

Medido, uno por uno:

| Componente | Hover de hoy |
|---|---|
| [`ListingCard.tsx:36`](../apps/web/src/components/anuncios/ListingCard.tsx#L36) | `transition-shadow group-hover:shadow-md` — **sin levantar** |
| [`CategoryGrid.tsx:13`](../apps/web/src/components/categorias/CategoryGrid.tsx#L13) | `transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm` |
| [`CategoryCarouselHomeBlockRenderer.tsx:61`](../apps/web/src/components/home/blocks/CategoryCarouselHomeBlockRenderer.tsx#L61) | igual que el anterior |
| [`GridHomeBlockRenderer.tsx:109`](../apps/web/src/components/home/blocks/GridHomeBlockRenderer.tsx#L109) y `HubBlockRenderer` | `transition-colors hover:bg-muted/50` — **ni levanta ni sombrea** |
| Tarjeta de post del blog ([`blog/page.tsx:138-145`](../apps/web/src/app/(public)/blog/page.tsx#L138-L145)) | `transition-shadow hover:shadow-md` + `group-hover:scale-105` en la foto |

**La propuesta unifica los cinco en uno:** `translateY(-4px)` + `box-shadow: var(--shadow-lg)`,
con `transition` en `--motion-duration` / `--motion-ease`.

**Es revestir**, y tiene dos ventajas que conviene decir en voz alta:

- **El levantamiento es `transform`**, o sea la regla 2 del §6.2 cumplida por construcción:
  no reflowea, no causa CLS.
- **Sombra por token.** `shadow-lg` ya resuelve a `var(--shadow-lg)`
  ([`tailwind.config.ts:115-121`](../apps/web/tailwind.config.ts#L115-L121)), así que el
  modelo Cálido levanta con sombra **tibia** (`rgb(60 30 10 / .13)`) y Premium con sombra
  **fría y larga** (`rgb(10 15 30 / .12)` a 28 px) **sin una línea por modelo**. El «sabor por
  modelo» del encargo ya está pagado aquí.

⚠ **Falta `motion-reduce`.** Ninguno de los cuatro dialectos lo declara hoy (sólo
`CtaButton` lo hace, [línea 58](../apps/web/src/components/shared/CtaButton.tsx#L58)). Si se
unifica el hover, se unifica **con** su `motion-reduce:transform-none`, o se multiplica por
cinco un incumplimiento de la regla 5.

### 2.6 El solapamiento del buscador — el único sitio donde la propuesta choca con el motor

La propuesta monta el bloque `search` **−46 px sobre la banda del hero** ([línea
146](Mejoras%20de%20estilos%20de%20plataforma/Propuestas%20de%20estilo.dc.html)). Eso exige
que el bloque **sepa que va justo detrás del hero**, y el motor de portada tiene escrita la
regla contraria: *«Ningún bloque conoce su índice, y por eso el hero NO pasa por aquí»*
([`HomeBlockRenderer.tsx:35-36`](../apps/web/src/components/home/HomeBlockRenderer.tsx#L35-L36)).

Un margen negativo incondicional en `search` se ve **mal** en cuanto el admin lo baje al
tercer puesto: se comería el bloque anterior.

**Tres salidas, en orden de preferencia:**

1. **Que lo declare el admin.** Un `overlapHero?: boolean` en `HomeSearchBlock` («montar
   sobre la banda del hero»). El bloque sigue sin conocer su índice: **ejecuta una intención
   declarada**, que es lo mismo que ya hace `showPopularCategories`. Coste: un campo en el
   DTO y una casilla en el editor.
2. **Que lo decida la página.** `(home)/page.tsx` ya calcula posiciones (el `corte` de la
   rejilla de categorías, [líneas 55-59](../apps/web/src/app/(public)/(home)/page.tsx#L55-L59)),
   así que «si el primer bloque es `search`, solapa» es una regla **de la página**, no del
   motor. Es honesto, pero mete lógica de maquetación en un sitio que ya tiene una excepción
   y acumularía dos.
3. **Renunciar al solapamiento.** Se pierde un gesto bonito y no se pierde nada más.

**Recomendación: la 1.** Es la única que no miente sobre quién decide. **Decisión 3 del §10.**

---

## 3. LOS TOKENS QUE FALTAN

### 3.1 Lo que ya hay (para no inventar dos veces)

Los `ejes` que declara cada modelo
([`estilo.constants.ts:649-670`](../apps/api/src/modules/estilo/estilo.constants.ts#L649-L670)):
`font-sans`, `font-heading`, `radius`, `shadow-sm|·|md|lg|xl`, `motion-duration`,
`motion-ease`, `motion-ease-emphasis`, `motion-sprite-duration`, `icon-stroke`. **Trece.**
Más la rampa (7), la marca (6) y los semánticos (~30).

Y hay **dos mecanismos ya construidos** que el escaparate hereda gratis:

- **Una versión puede redefinir `ejes`**
  ([`resolverTokens:2758`](../apps/api/src/modules/estilo/estilo.constants.ts#L2758)), así que
  cualquier token nuevo que se meta en `ejes` es afinable **por versión**, no sólo por modelo.
- **Una zona sólo puede REDEFINIR tokens que ya existen**, y
  [`zonaSoloAjusta`](../apps/api/src/modules/estilo/estilo.constants.ts#L2862-L2880) lo pone
  rojo en CI. Es la puerta cerrada que hace segura la propuesta del §3.3.

### 3.2 `heroFondo` y `heroPatron` → **sí, como `ejes` del modelo**

**Qué son en la propuesta** (líneas 937-950): dos cadenas CSS derivadas de los tokens del
modelo.

```
heroFondo  = radial-gradient(120% 92% at 10% -12%, <primary con alfa>, transparent 62%),
             radial-gradient(96% 74% at 94% -4%,  <accent  con alfa>, transparent 58%),
             linear-gradient(180deg, <muted> 0%, <bg> 100%)

heroPatron = uno de cuatro: papel | malla | filete | bloques
```

Y el modelo declara su tratamiento: `ambiente: { alfaPrimario, alfaAcento, patron }` —
Cálido 0.20/0.16/papel, Fresco 0.14/0.12/malla, Premium 0.10/0.10/filete, Vibrante
0.26/0.24/bloques.

**Propuesta de encaje: dos tokens nuevos en `ejes`, no un campo `ambiente` nuevo.**

| | `ambiente: {alfa, patron}` (como la propuesta) | `ejes: { 'hero-ambiente', 'hero-patron' }` (recomendado) |
|---|---|---|
| Tipo del modelo | Campo **nuevo** en `Modelo` | Ninguno: `ejes` es `Record<string,string>` |
| Afinable por versión | Habría que añadirlo a `AjustesDeVersion` | **Ya lo es** (E14 mezcla `ejes` por versión) |
| Llega al navegador | Habría que resolverlo en el servicio | **Ya llega**: `Object.assign(tokens, semanticos, ejes)` |
| Vigilado por CI | Barrera nueva | `globals-espejo.spec.ts` lo exige en `globals.css` el mismo día |

**Verificado que pasa el filtro de inyección.** `bloqueDeEstilo` descarta todo valor que no
case con `/^[\w\s.,%#()/-]+$/`
([`estilo-css.ts:19`](../apps/web/src/lib/estilo-css.ts#L19)). Las cuatro cadenas de patrón y
la del ambiente sólo llevan letras, dígitos, espacios, comas, paréntesis, `%`, `.`, `/` y
guiones: **entran tal cual, sin tocar el filtro**. (Es la misma trampa que se tragó las
comillas de `font-heading` en Cálido —
[`estilo.constants.ts:1210-1228`](../apps/api/src/modules/estilo/estilo.constants.ts#L1210-L1228) —
así que conviene decirlo escrito: **ni una comilla en estos valores.**)

**Y conviene escribirlos con `var()`, no con el color resuelto:**

```
--hero-ambiente: radial-gradient(120% 92% at 10% -12%, hsl(var(--primary)/.20), transparent 62%), …
```

Así el ambiente **sigue al color que elija el admin** sin volver a resolver nada, y los
alfas quedan donde tienen que quedar: en el modelo.

**El nodo del patrón es DOM nuevo, y es común.** La propuesta pinta un `<div>` absoluto con
`background: heroPatron; opacity: .5`. Ese `<div>` **se emite siempre**, para los cinco
modelos; un modelo que no quiera patrón declara `--hero-patron: none`. **Si un modelo pudiera
omitir el nodo, la invariancia se pondría roja** — y ésa es justamente la señal correcta.

⚠ **`premium@oscuro`.** Un degradado pensado para `muted → bg` claros hay que mirarlo sobre
carbón. El mecanismo ya permite que esa versión traiga su propio `hero-ambiente`; lo que
hace falta es **mirarlo**, no un mecanismo nuevo.

### 3.3 `ritmo` → **NO es un token de modelo. Es una constante del producto.**

La propuesta lo usa como `dir === 'A' ? '86px' : '64px'`: **depende de la dirección, no del
modelo.** Ninguno de los cuatro modelos de la propuesta lo cambia.

Y no puede ser un token de modelo aunque quisiéramos: el §3.2 del diseño lo dice sin margen
— **T3 · Estructural: espaciado, breakpoints, escala tipográfica, densidad, alturas,
anchos. Cambia con… *nunca*.** Y está repetido en `globals.css:183-186`: *«NO son token y no
deben serlo: son estructura, y un modelo que los moviera estaría reorganizando en vez de
revistiendo»*.

**Recomendación:** el ritmo del escaparate se escribe **una vez, para todos** — o como clase
(`space-y-*` mayor en los dos renderizadores) o, si se quiere nombre, como
`--ritmo-bloques` declarado **sólo en `globals.css`** y **nunca en los `ejes` de ningún
modelo**.

Esa segunda vía tiene una propiedad muy buena, y está verificada: un token que no está en
`ejes` **no puede ser redefinido por ninguna zona** — `zonaSoloAjusta` lo detectaría como
inventado y pondría CI en rojo. Y `globals-espejo.spec.ts` no lo delataría como huérfano,
porque su comprobación inversa sólo mira los nombres semánticos
(`warning|success|info|pending|neutral|rating|featured|favorite|destructive`,
[línea 73](../apps/api/src/modules/estilo/globals-espejo.spec.ts#L73)). **La capa inviolable
tiene, ya hoy, una barrera que la protege.**

### 3.4 El radio multiplicado → **hay un agujero previo que esto destapa**

La propuesta usa `calc(var(--radius) * 1.4 | 2 | 2.2 | 2.4 | 2.6 | 3)` en ocho sitios.

**Lo que hay hoy** ([`tailwind.config.ts:95-99`](../apps/web/tailwind.config.ts#L95-L99)):

```
lg: var(--radius)   ·   md: calc(var(--radius) - 2px)   ·   sm: calc(var(--radius) - 4px)
```

`xl`, `2xl`, `3xl` y `full` **no están extendidos**, así que conservan los valores de fábrica
de Tailwind (0.75 rem, 1 rem, 1.5 rem, 9999 px). Consecuencia **medible hoy, sin escaparate
ninguno**: las tarjetas del carrusel, la rejilla de categorías y las del blog llevan
`rounded-xl` = **0.75 rem fijos**, mientras Premium declara `radius: 0.125rem` y Cálido
`0.375rem`. **Un modelo recto tiene tarjetas redondas.** No responde al modelo.

**Cómo se cierra, sin inventar tokens:** extender `borderRadius` en la config con la escala
que falta, atada al mismo token —

```
xl: calc(var(--radius) * 1.5)   ·   2xl: calc(var(--radius) * 2)   ·   3xl: calc(var(--radius) * 3)
```

**No es un token nuevo**: es el token de siempre multiplicado, que es exactamente lo que hace
`md` restando. El sistema **ya soporta multiplicar el radio**; lo que falta es declararlo.

⚠ **Esto sí mueve píxeles fuera del escaparate**: `rounded-xl` aparece también en pantallas
de cuenta y backoffice. Con `--radius: 0.5rem` (Modelo 0), `calc(0.5rem * 1.5)` = 0.75 rem =
**exactamente el valor de hoy**, así que el Modelo 0 no se mueve ni un píxel y la batería
visual de 50 capturas sigue verde. Los otros cuatro modelos **sí** cambian — y cambian
**hacia** lo que el modelo pide. Merece decirse en el commit, no colarse.

### 3.5 Las animaciones — qué hay y qué falta

**Lo que existe hoy** (todo en [`globals.css`](../apps/web/src/app/globals.css), todo CSS
puro, cero JS):

| Nombre | Qué hace | Dónde |
|---|---|---|
| `entrada-suave` (`.entra-escalonado`) | `opacity 0→1` + `translateY(.5rem)`, con `--paso` para escalonar | [368-383](../apps/web/src/app/globals.css#L368-L383) |
| `hero-rot-2…6` | La rotación del titular, 5 reglas por N | [476-520](../apps/web/src/app/globals.css#L476-L520) |
| `sprite-play` | El póster animado, `steps(5)` | [586-593](../apps/web/src/app/globals.css#L586-L593) |
| `accordion-down/up` | Radix, en la config | [`tailwind.config.ts:131-152`](../apps/web/tailwind.config.ts#L131-L152) |
| `tailwindcss-animate` | **Sí está instalado** (`package.json:65`, `plugins: [typography, animate]`) | Aporta `animate-in/out`, `fade-*`, `zoom-*`, `slide-*` **para overlays de Radix** |

**El cruce con la propuesta:**

| Animación de la propuesta | ¿Cubierta? | Veredicto |
|---|---|---|
| `sube` (opacity + `translateY(16px)`) | **Sí** — es `entrada-suave` con otro desplazamiento | **Reusar**, no duplicar |
| `rotDesliza` (la palabra que rota deslizando) | **Parcialmente** — `hero-rot-*` rota **por opacidad**, no por desplazamiento | Cambiarla es tocar 5 `@keyframes`; el tope de 6 opciones sigue igual (el `calc()` sigue prohibido en porcentajes) |
| `brillo` (destello que cruza el botón) | **No existe** | **Nuevo.** Es `transform: translateX()` sobre un `<span>` absoluto — cumple la regla 2 |
| `entraIzq` | **No existe** | Es de la dirección **B**, no de la A. **Fuera de alcance** |
| `reglaCrece`, `flota` | **No existen** | `reglaCrece` es de la B. `flota` no se usa en la A tampoco (declarada y no aplicada) |

**`tailwindcss-animate` NO cubre el brillo.** Sus utilidades son entradas/salidas de
overlay (`animate-in`, `fade-in-0`, `zoom-in-95`, `slide-in-from-*`), pensadas para
`data-[state=open]` de Radix; no hay nada que recorra un elemento en bucle. Y conviene no
forzarlo: el plugin entró *«como VOCABULARIO DEL MODELO»*
([`tailwind.config.ts:155-171`](../apps/web/tailwind.config.ts#L155-L171)), atado a
`--motion-duration`, y un bucle de 3,4 s no es ese vocabulario.

**Dónde va `brillo`:** en `globals.css`, **fuera de `@layer`**, con el mismo argumento ya
escrito dos veces en el fichero (una regla sin capa gana a la misma regla dentro de una capa,
y el purge no la ve). Y **dentro del `@media (prefers-reduced-motion: reduce)` que ya
existe**, que es donde se apaga.

---

## 4. LOS CTAs — el corazón del «espectacular por modelo»

### 4.1 El punto único existe, y está donde el diseño dijo

`CtaButton` es el CTA canónico de **los dos motores** (portada y blog) y así lo registra el
§6.1 del diseño: *«`CtaButton` es un hallazgo útil: ya existe un CTA canónico compartido (…)
La zona de impacto de los CTAs tiene un solo punto de entrada — no hay que ir a buscar
botones por el repo»*. **Verificado**: sólo tres ficheros lo mencionan —
`CtaBlockRenderer`, `CtaHomeBlockRenderer` y él mismo.

**Lo que ya hace** ([líneas 52-62](../apps/web/src/components/shared/CtaButton.tsx#L52-L62)):
`hover:-translate-y-0.5 hover:scale-[1.02] active:translate-y-0 active:scale-100` con
`transition-transform` **sin `duration-*`**, que es lo que lo ata a `var(--motion-duration)`
por el DEFAULT de la escala — y `motion-reduce:transform-none`.

**Y ya está probado por modelo**: `estilo-animaciones.spec.ts` mide que *«el CTA canónico
responde al tempo del modelo, no a uno escrito a mano»* y comprueba `0.15s`.

### 4.2 Lo que falta para «espectacular»

| Pieza de la propuesta | Hoy | Hueco |
|---|---|---|
| `translateY(-2px) scale(1.02)` | **Ya está** (`-translate-y-0.5` = 2 px) | ✅ ninguno |
| Vuelta a cero al pulsar | **Ya está** | ✅ ninguno |
| `overflow:hidden` + `<span>` de brillo | **No** | Nodo nuevo **común** + `@keyframes brillo` |
| Altura 64 px | `size="lg"` = `h-11` (44 px) — ⚠ y el botón **Buscar** ya va a `h-14 md:h-16` con clases propias, o sea **dos alturas distintas de CTA grande** hoy | Una clase, o un `size` nuevo compartido por los dos |
| `border-radius: calc(var(--radius) * 2.4)` | `rounded-md` = `calc(var(--radius) - 2px)` | §3.4 |
| Padding `0 40px` | `px-8` (32 px) | Una clase |

### 4.3 «Por modelo» **es revestir** — y esto es la clave de todo el encargo

La regla, dicha en una línea:

> **El EFECTO es común y está escrito una vez. El SABOR lo pone el modelo, y lo pone
> entero con tokens que ya existen.**

Qué cambia un modelo **sin tocar una línea de estructura**:

| Palanca | Cálido / Editorial | Fresco / Confianza | Premium | Vibrante |
|---|---|---|---|---|
| `--motion-duration` | **180 ms** | **120 ms** | **220 ms** | (su valor) |
| `--motion-ease` | `cubic-bezier(.32,.72,0,1)` (salida larga) | `cubic-bezier(.2,0,0,1)` (seca) | `cubic-bezier(.25,.1,.25,1)` (suave) | — |
| `--primary` | terracota | azul | azul marino | magenta |
| `--radius` | 0.375 rem | 0.25 rem | **0.125 rem** | — |
| `--shadow-lg` | tibia, `rgb(60 30 10/.13)` | corta y fría | **larga**, 28 px de difuminado | — |

Un brillo de 3,4 s con la curva de Fresco y otro con la de Premium **no se parecen**, y no ha
hecho falta una condición por modelo. Eso es lo que el encargo llama «espectacular por
modelo» y **cabe entero por la puerta de los tokens**.

⚠ **Lo que NO se puede hacer, y hay que decirlo antes de que apetezca:** que un modelo
**añada** un efecto que otro no tiene (Vibrante con brillo y Premium sin él). Eso es un
`if` por modelo en un componente, es DOM distinto o clase distinta por modelo, y es
**reorganizar**. Si un modelo quiere un brillo más sobrio, lo dice con **tempo y curva**
(la propuesta ya lo hace con los alfas del ambiente), no con estructura. Si de verdad
hiciera falta apagarlo, la vía limpia es un token de intensidad (`--brillo-alfa: 0`) que
**todos** declaran: el efecto sigue estando, se pinta transparente. El DOM no se mueve.

### 4.4 Los CTAs que **no** pasan por `CtaButton`

Si el encargo dice «los CTAs», conviene saber que hay cuatro más, y ninguno es `CtaButton`:

| Cuál | Dónde | Qué es hoy |
|---|---|---|
| El botón **Buscar** del buscador | [`SearchBar.tsx:222`](../apps/web/src/components/busqueda/SearchBar.tsx#L222) | `size="lg"` + `h-14 md:h-16 rounded-xl px-6 md:px-8` — **ya mide los 64 px de la propuesta**; le falta el brillo, y su `rounded-xl` es de los que no siguen al modelo (§3.4) |
| El CTA de cada columna de `steps` | [`StepsHomeBlockRenderer.tsx:57-59`](../apps/web/src/components/home/blocks/StepsHomeBlockRenderer.tsx#L57-L59) | `Button variant="link"` |
| **Ver todos / Ver todas** | `listings`, `categoryCarousel` | `text-sm text-primary hover:underline` |
| **Publicar anuncio** de la cabecera | [`Header.tsx:52`](../apps/web/src/components/layout/Header.tsx#L52) | `text-primary hover:text-primary/80` |

**Recomendación:** el brillo va **sólo** en `CtaButton` y en el botón del buscador — que son
zona de impacto declarada. Los otros tres son navegación secundaria; pintarlos de destellos
convierte «espectacular» en «ruidoso» y, sobre todo, **saca la zona de impacto de su
perímetro de cuatro sitios**, que es lo que la hace defendible. Los enlaces «Ver todos» sí
ganan la coherencia de color y tempo, nada más.

---

## 5. EL HERO

### 5.1 Qué mide hoy

Estructura real
([`(home)/page.tsx:82-88`](../apps/web/src/app/(public)/(home)/page.tsx#L82-L88)):

```html
<section class="border-b bg-primary/5">
  <div class="container mx-auto px-4 py-10 md:py-14">
    <div class="mx-auto max-w-4xl text-center">
      <h1 class="mb-8 text-2xl font-bold tracking-tight last:mb-0 md:text-3xl"> … </h1>
      <p class="entra-escalonado -mt-4 mb-8 text-base text-muted-foreground last:mb-0 md:text-lg"> … </p>
```

**Altura, por aritmética de las clases** (no medida en navegador): padding 112 px + titular
~36 px + `mb-8` 32 px − `-mt-4` 16 px + subtítulo ~28 px ≈ **190 px en escritorio**; con
`py-10` y el tipo menor, **≈150 px en móvil**.

Y hay un dato que explica por qué se ve pobre, escrito en el propio fichero: *«el buscador,
su eyebrow y el botón de publicar eran andamio y ahora son bloques»* — **la banda se quedó
con el titular dentro y nada más**, y el padding se bajó de `py-14 md:py-20` a `py-10
md:py-14` porque *«el mismo aire dejaba un hueco que se leía como un fallo de maquetación»*.
**El «no ocupa lo que debería» del encargo no es una impresión: es una cicatriz de RP.6.**

Fondo: `bg-primary/5`. Un 5 % del primario sobre el lienzo. Eso es exactamente lo que la
propuesta sustituye por ambiente.

### 5.2 ⚠ «A sangre» y «a pantalla completa» son dos peticiones distintas

**La propuesta NO lleva hero a pantalla completa.** Su hero A declara `padding: 84px 16px
118px` y el contenido dentro; sumado da **≈500 px**, no `100vh`. Lo que la propuesta hace es
**a sangre** (`heroFondo` + patrón cubriendo el ancho completo) y **grande** (titular
`clamp(38px, 6vw, 72px)`).

El «a pantalla completa» es petición de Ernest, **encima** de la propuesta. Y es la única
parte del encargo con riesgo real. La aritmética:

| Qué resta | Cuánto |
|---|---|
| Cabecera `sticky top-0` con `h-16` ([`Header.tsx:31-37`](../apps/web/src/components/layout/Header.tsx#L31-L37)) | 64 px — **no se solapa**: al ser sticky y no fixed, ocupa flujo |
| `BannerList`, **encima del hero** cuando hay banners activos ([`(home)/page.tsx:69-73`](../apps/web/src/app/(public)/(home)/page.tsx#L69-L73)) | variable, **y puede no existir** |
| `main class="min-h-screen"` ([`(public)/layout.tsx`](../apps/web/src/app/(public)/layout.tsx)) | un suelo, no un techo |

**Tres cosas que hay que decidir, no dar por hechas:**

1. **`100svh`, no `100vh`.** En móvil, `100vh` cuenta la barra del navegador que luego se
   retrae: un hero `100vh` se sale de pantalla justo al cargar, que es el defecto opuesto al
   que se quiere arreglar.
2. **¿Menos la cabecera?** `min-h-[calc(100svh-4rem)]` deja el hero ocupando exactamente el
   hueco visible. Con `100svh` a secas, la cabecera empuja y el pie del hero queda cortado.
3. **¿Y el banner?** Si hay banner, `calc(100svh - 4rem)` se pasa. O el banner entra **dentro**
   del hero (cambio de maquetación de la página, común a todos los modelos), o el hero acepta
   quedarse corto cuando hay banner. **La segunda es más barata y nadie lo nota.**

⚠ **Y el aviso más importante: a 190 px, el hero está casi vacío. A 900 px, está vacío del
todo.** Un titular y un subtítulo centrados en una pantalla completa se leen como una página
sin terminar. La pantalla completa **necesita contenido que la llene**: la propuesta pone
eyebrow + titular grande + subtítulo + **tres cifras** (anuncios activos, provincias,
valoración media) y el buscador montado encima. **Si sólo se estira la altura sin traer
contenido, el resultado es peor que hoy.** Esto condiciona las decisiones 1 y 2 del §10.

### 5.3 LCP y CLS — lo que se puede y lo que no

**El LCP de la portada es, casi con seguridad, el `<h1>`.** No hay imagen en el hero hoy, el
titular es el texto más grande sobre el pliegue, y el propio código lo tiene escrito:
*«el `<h1>` es el texto más grande sobre el pliegue de la ruta más visitada, o sea el
candidato a LCP, y un elemento que empieza en `opacity: 0` no cuenta como pintado»*
([`HomeHero.tsx:98-104`](../apps/web/src/components/home/HomeHero.tsx#L98-L104)).

**Las cinco reglas, aplicadas al hero de escaparate:**

| Regla | Qué implica aquí |
|---|---|
| 1 · CSS antes que JS | El ambiente son degradados; el patrón, un `background-image`; el brillo, `transform`. **Cero KB de bundle**, y sigue siendo Server Component sin `'use client'` |
| 2 · Nada de CLS | El ambiente **no es una imagen**: no hay descarga que pueda llegar tarde ni dimensiones que reservar. ⚠ Si el hero acaba llevando **foto** (decisión 2), esa foto sí necesita `aspect-ratio` o alto fijo |
| 3 · El coste donde se disfruta | Un degradado con tres capas + un patrón repetido a pantalla completa **cuesta pintura en móvil**. `will-change` aquí sería un error (promociona una capa del tamaño de la pantalla). Merece mirarse en un móvil de gama baja |
| 4 · **El LCP no se anima** | ⚠ **La propuesta incumple esta regla en dos sitios**: pone `animation: sube` sobre el `<h1>` de la página informativa (línea 422) y sobre el del blog. En la portada no lo hace — anima eyebrow, subtítulo y cifras, y deja el `<h1>` quieto, que es lo correcto. **Al trasladar: el `<h1>` no se anima nunca, en ninguna de las tres superficies.** Esto ya está decidido en el repo y no se reabre |
| 5 · `reduced-motion` degrada completo | El ambiente y el patrón **no son animación**: se quedan. Se apagan el brillo, las entradas y la rotación. Lo que queda es la misma página, quieta |

**Lo que además hay que vigilar y hoy nadie vigila:** el titular pasa de `text-3xl` (30 px) a
`clamp(38px, 6vw, 72px)`. **Un `clamp` con `vw` no causa CLS** (se resuelve en el primer
layout, no depende de red). Lo que sí hay que mirar es el **salto de dos líneas a tres** en
anchos intermedios con un titular largo — y ahí la `hero-rot` ya tiene la solución escrita:
`inline-grid` con todas las opciones en la misma celda, *«la caja mide lo que la opción más
ancha y no cambia de tamaño al rotar»*
([`globals.css:427-444`](../apps/web/src/app/globals.css#L427-L444)). **Esa garantía se
conserva; no hay que rehacerla.**

### 5.4 «Más configurable» — la frontera admin / modelo

**Lo que el admin configura hoy** (4 campos,
[`HeroEditor.tsx:25-30`](../apps/web/src/app/(admin)/admin/portada/_components/HeroEditor.tsx#L25-L30)
y [`update-homepage.dto.ts`](../apps/api/src/modules/homepage/dto/update-homepage.dto.ts)):
`heroStaticTitle` (≤120), `heroRotatingOptions` (≤6, ≤60 c/u), `heroRotationMs` (1500-10000),
`heroSubtitle` (≤300).

**La regla que ordena el reparto:**

> **El admin pone el CONTENIDO y las decisiones de negocio. El modelo pone el AMBIENTE.
> Ninguno de los dos invade al otro.**

| Pieza de la propuesta | ¿Quién? | Por qué |
|---|---|---|
| **Eyebrow** («Miles de anuncios cerca de ti») | **Admin** — campo nuevo `heroEyebrow?` | Es texto, es contenido, y es la clase de frase que cambia por campaña. Hoy existe **pero en el bloque `search`** ([`SearchHomeBlockRenderer.tsx:40-44`](../apps/web/src/components/home/blocks/SearchHomeBlockRenderer.tsx#L40-L44)): si sube al hero, **hay que decidir si se mueve o si son dos** |
| **Las tres cifras** (128.400 anuncios · 52 provincias · 4,8) | **Admin, con cuidado** | ⚠ **Escritas a mano envejecen y mienten.** Calculadas de verdad cuestan consultas en la ruta de más tráfico. Recomendación: **campos de texto libres, opcionales, con aviso en el editor** — o no ponerlas. Una cifra falsa en la portada es peor que ninguna |
| **CTA dentro del hero** | **Admin** | El bloque `cta` ya existe; si el hero lo lleva dentro, son dos sitios que hacen lo mismo. **Preferible: el hero no lleva botón**, lo lleva el bloque siguiente |
| **Altura** (normal / alta / pantalla completa) | **Admin** | Es una decisión editorial suya, no de marca. **Un enum cerrado de 3 valores**, nunca un número en píxeles: eso sería darle la capa inviolable |
| **Alineación** (centrado / izquierda) | **Admin**, si se quiere | ⚠ Cuidado: es estructura visual. Con clases estáticas y enum cerrado es aceptable |
| **Imagen de fondo** | **Admin** | Ya hay tubería: `POST /admin/homepage/upload-image` ([`homepage-admin.controller.ts:56-74`](../apps/api/src/modules/homepage/homepage-admin.controller.ts#L56-L74)) y la validación `@IsOwnStorageUrl` que usa el carrusel. ⚠ Con imagen, el LCP **deja de ser el titular y pasa a ser la foto**: `priority`, dimensiones y `aspect-ratio` dejan de ser opcionales |
| **`heroFondo` / `heroPatron`** | **Modelo** | Es el ambiente: marca, no contenido. Si el admin lo eligiera, cinco modelos tendrían el mismo hero |
| **Tamaño del titular, curva, tempo, radio** | **Modelo** (o producto) | Tokens |

⚠ **Cada campo nuevo del hero se paga tres veces**: DTO + editor + preview. Y **cuatro**, si
cuenta el `FALLBACK_HOMEPAGE_CONFIG`. Conviene elegir **pocos y buenos**. Recomendación
mínima viable: **`heroEyebrow` + `heroHeight` (enum de 3)**. Todo lo demás, después de ver
el primero funcionando.

### 5.5 Una deuda que el hero a sangre destapa: **la banda está escrita dos veces**

[`(home)/page.tsx:82-88`](../apps/web/src/app/(public)/(home)/page.tsx#L82-L88) pinta la
banda (`border-b bg-primary/5`, `py-10 md:py-14`, `max-w-4xl text-center`). Y
[`PortadaPreview.tsx:66-84`](../apps/web/src/app/(admin)/admin/portada/_components/PortadaPreview.tsx#L66-L84)
**la copia**, con un comentario que lo admite: *«Mismo envoltorio que
(public)/(home)/page.tsx (…) Sin él el preview no diría nada del resultado»*.

`HomeHero` es sólo el **contenido** — no pinta la `<section>` ni el fondo, por decisión
escrita ([`HomeHero.tsx:7-11`](../apps/web/src/components/home/HomeHero.tsx#L7-L11)).

**Consecuencia:** en cuanto la banda gane ambiente, patrón y altura, **las dos copias
divergen** y el preview del admin —que es obligatorio porque *guardar es publicar*— empieza a
mentir.

**Salida:** un componente `HomeHeroBanda` (o similar) que envuelva a `HomeHero` con la
`<section>`, el ambiente y el patrón, y que usen **los dos**. Es estructura **común a todos
los modelos**: la invariancia ni se entera.

⚠ **Y el preview no puede pintar un hero de `100svh` dentro de un formulario.** La altura
tiene que poder ser un parámetro del envoltorio (`altura="preview"`), o el preview se vuelve
inusable. Es la razón técnica por la que la altura **debe vivir en el envoltorio, no dentro
de `HomeHero`**.

### 5.6 «El primer bloque también a pantalla completa» — la lectura que cabe

El encargo dice «el hero **y el primer bloque** a pantalla completa». Hay dos lecturas:

- ❌ **«Cada bloque ocupa una pantalla»** (tipo *scroll snap* de landing). Eso es
  reorganizar la portada entera, rompe el SEO de una página que vive de tener mucho
  contenido indexable arriba, y deja fuera la mitad de los bloques (una tabla de 52 provincias
  no cabe en una pantalla).
- ✅ **«El hero ocupa la pantalla y el primer bloque asoma»** — que es lo que de verdad
  hace que un escaparate funcione: el borde superior del buscador visible al cargar invita a
  bajar. Eso es `calc(100svh - 4rem - 48px)` o el solapamiento de −46 px de la propuesta
  (§2.6), **no** una segunda pantalla.

**Recomendación: la segunda.** Y merece confirmarse con Ernest antes de diseñar, porque las
dos lecturas dan proyectos de tamaño muy distinto. **Decisión 1 del §10.**

---

## 6. LA FRONTERA — «reviste, no reorganiza»

### 6.1 La distinción que hace que todo esto quepa

Hay **dos fronteras distintas** y conviene no confundirlas, porque el encargo las toca las
dos:

| | Qué prohíbe | A quién |
|---|---|---|
| **La frontera del modelo** (decisión #1) | Un modelo no puede cambiar estructura, contenido, ni la capa inviolable (espaciado, escala tipográfica, densidad) | **A los 5 modelos** |
| **La frontera del producto** | Nada: el producto puede rediseñar lo que quiera | **A nadie** |

**El escaparate es, casi todo, una decisión del PRODUCTO**: subir el ritmo a 86 px, agrandar
el titular con un `clamp`, poner las tarjetas a levantar, convertir el `cta` en banda. Nada de
eso lo decide un modelo: se escribe **una vez, igual para los cinco**, y cada modelo lo
reviste con sus tokens.

> **La prueba de que algo cabe: ¿si cambio de modelo, cambia el HTML? Si no, cabe.**

### 6.2 La clasificación completa del escaparate

**REVESTIR (tokens y clases; el DOM no se mueve)** — la inmensa mayoría:

- El ambiente y el patrón del hero (valores de token)
- El hover unificado de todas las tarjetas
- Radios, sombras, bordes y tempos de los 24 bloques
- El brillo y el hover elaborado del CTA
- El tamaño del titular, el ritmo entre bloques, el ancho de los contenedores

**ESTRUCTURA NUEVA, COMÚN A TODOS LOS MODELOS** — cuatro cosas, y sólo cuatro:

1. El `<div>` del patrón dentro de la banda del hero (§3.2)
2. El `<span>` del brillo dentro de `CtaButton` (§4.2)
3. El `<h2>` + `<p>` del bloque `cta` convertido en banda (§2.4)
4. El envoltorio `HomeHeroBanda` compartido entre página y preview (§5.5)

**Las cuatro las pintan los cinco modelos por igual.** Ninguna aparece o desaparece según el
modelo. **Por eso la invariancia sigue verde.**

**LO QUE ROMPERÍA LA FRONTERA** (la lista de tentaciones, para tenerla escrita antes de que
apetezca):

- ❌ Un `if (modelo === 'vibrante')` en cualquier renderizador
- ❌ Que un modelo declare `ritmo`, `hero-altura`, `font-size` o cualquier espaciado
- ❌ Que un modelo **omita** el nodo del patrón o el del brillo en vez de pintarlo transparente
- ❌ Un bloque nuevo que sólo exista para un modelo
- ❌ Que una zona invente un token (ya hay CI para esto: `zonaSoloAjusta`)

### 6.3 ⚠ El test de invariancia **no cubre ninguna de las tres superficies**

Verificado en
[`estilo-invariancia.spec.ts:44-45`](../apps/web/e2e/estilo-invariancia.spec.ts#L44-L45):

```
RUTAS_PUBLICAS   = ['/planes', '/login', '/registro', '/contacto', '/admin/login']
RUTA_BACKOFFICE  = '/admin/anuncios'
```

**No está `/`. No está `/blog`. No está `/paginas/[slug]`.** Y el segundo test —el que
recorre el catálogo real— mide **una sola ruta pública: `/planes`**.

O sea: **la barrera que existe para hacer cumplir «reviste, no reorganiza» no mira las tres
superficies que el escaparate va a repintar enteras.** Hoy eso no es un fallo (esas
superficies apenas tienen estilo propio); a partir del escaparate **es el agujero central**.

**Lo que hay que hacer, y es barato:** meter `/` (portada) en `RUTAS_PUBLICAS`. Los tres
requisitos —contenido estable entre las dos cargas, dos modelos distintos, ignorar `class` y
`style`— los cumple igual que `/planes`.

⚠ **Con un cuidado medido**: la portada pinta `listings` resueltos contra Meilisearch y
banners activos. Si entre las dos capturas cambiara un anuncio, el árbol diferiría **por el
dato, no por el modelo**, y el test parpadearía. La portada de la batería de Playwright es
sembrada, así que el riesgo es bajo — pero merece una comprobación antes, no un rojo
intermitente después. (Es la misma razón por la que la batería visual dejó fuera la portada:
*«VUELVEN cuando la batería FIJE ese estado antes de disparar: escribir un `HomepageConfig`
conocido y sembrar un conjunto fijo de anuncios ya indexados»*,
[`pantallas.spec.ts:60-65`](../apps/web/e2e-snapshots/pantallas.spec.ts#L60-L65)). **Esa tarea
pendiente y ésta son la misma tarea.**

---

## 7. SEO Y RENDIMIENTO

### 7.1 Lo que el escaparate **no** toca (y por eso el SEO está a salvo)

| Señal | ¿Cambia? |
|---|---|
| El `<h1>` de la portada, del blog y de las páginas | **No.** Cambia de tamaño; el texto, la posición en el árbol y que sea uno solo, no |
| La jerarquía `h2`/`h3` de los bloques | **No** |
| Los cientos de enlaces internos de `searchTable` | **No.** Se pintan igual: *«el contenido de todas las pestañas activas está en el HTML aunque el usuario solo vea una»* ([`SearchTableHomeBlockRenderer.tsx:18-21`](../apps/web/src/components/home/blocks/SearchTableHomeBlockRenderer.tsx#L18-L21)) |
| Los `alt`, los `href`, los `aria-*` | **No** |
| SSR / Server Components | **No.** Nada de lo propuesto necesita `'use client'` |

**Esto no es opinión: es lo que mide el test de invariancia** (compara etiquetas,
anidamiento, **todo el texto** y todos los atributos menos `class` y `style`). Si el
escaparate cambiara una sola de esas señales, se pondría rojo — **en las rutas que mira**, que
es por lo que el §6.3 importa tanto.

### 7.2 Las cuatro vigilancias reales

1. **El brillo es un bucle infinito bajo el pliegue.** `animation: brillo 3.4s infinite`
   sobre un `<span>` que se mueve con `transform` compone en GPU y no repinta — pero **no se
   detiene nunca**, y en un móvil eso es batería. Dos mitigaciones baratas y compatibles:
   `@media (hover: hover) and (pointer: fine)`, que es **exactamente el precedente del
   sprite** ([`globals.css:575-581`](../apps/web/src/app/globals.css#L575-L581)); y/o un número
   de repeticiones en vez de `infinite`.
2. **El patrón a pantalla completa.** `repeating-linear-gradient` a 1 px de paso sobre 900 px
   de alto es trabajo de pintura en cada scroll si el navegador no lo cachea. Hay que mirarlo;
   la alternativa (`background-attachment`, capas promovidas) suele ser peor.
3. **La imagen del hero, si entra.** Deja de ser un hero de texto: el LCP pasa a ser la foto.
   `priority`, dimensiones explícitas y `aspect-ratio`. Y ⚠ **`remotePatterns` debe incluir
   `127.0.0.1`** o `next/image` la rechaza en desarrollo (la cicatriz de
   `CLAUDE.md`/`image-domains.ts` aplica igual aquí).
4. **`prefers-reduced-motion`.** El bloque ya existe en `globals.css:385-403` y `599-603`;
   **todo lo nuevo entra dentro**, y degradando a estado **completo** (el brillo apagado deja
   el botón entero, no a medio pintar).

---

## 8. LAS BARRERAS QUE FALTAN

Lo que hoy vigila el sistema de estilo y lo que **no** vigilará del escaparate si no se
amplía:

| Barrera | Existe | ¿Cubre el escaparate? |
|---|---|---|
| `estilo-invariancia.spec.ts` | ✅ | ❌ **No mira portada, blog ni páginas** (§6.3) |
| `estilo-animaciones.spec.ts` | ✅ mide tempo por zona y el CTA canónico | ⚠ Habría que añadir el **brillo** y el hover de tarjeta |
| Batería visual (50 capturas) | ✅ | ❌ **Cero capturas de portada, blog o páginas** (§6.3) |
| `contraste-modelos.spec.ts` | ✅ mide las 5 zonas por versión | ❌ **No mide `primary` como fondo con `background` encima** — la pareja que estrena la banda del CTA (§2.4) |
| `zonaSoloAjusta` | ✅ | ✅ protege la capa inviolable sin tocar nada |
| `globals-espejo.spec.ts` | ✅ | ✅ obliga a declarar los tokens nuevos en los dos sitios |

**Tres barreras nuevas, mínimas:**

1. `/` dentro de `RUTAS_PUBLICAS` de la invariancia (+ sembrado estable).
2. La pareja de contraste de la banda de CTA en `parejasBloqueantes`.
3. Una captura visual de portada y otra de un artículo de blog — que además cierra la deuda
   heredada de E0.

---

## 9. EL PLAN DE RÁFAGAS

Numeradas como continuación del eje de estilo (la última cerrada fue E14 + el quinto modelo).
Cada una **entra sola, deja CI verde y se puede parar ahí**.

| Ráfaga | Qué hace | Qué NO hace | Barrera que la cierra |
|---|---|---|---|
| **E15-A · El suelo** | Radios extendidos (`xl/2xl/3xl` sobre `--radius`), tokens `hero-ambiente` y `hero-patron` en los 5 modelos + `globals.css`, `@keyframes brillo`, ritmo del escaparate. **Ningún componente cambia todavía** | No toca un renderizador | `globals-espejo` verde · Modelo 0 **idéntico píxel a píxel** (las 50 capturas) |
| **E15-B · Las barreras** | `/` en la invariancia + sembrado estable; capturas de portada y blog; la pareja de contraste de la banda | No cambia aspecto | CI verde con lo de hoy — **antes** de repintar nada |
| **E15-C · El hero a sangre** | `HomeHeroBanda` compartido página↔preview, ambiente + patrón, titular `clamp`, eyebrow. **Sin pantalla completa** | Sin `100svh`, sin imagen, sin cifras | Invariancia de `/` verde · LCP sin animar |
| **E15-D · Los CTAs** | Brillo + geometría en `CtaButton` y en el botón del buscador | No toca el esquema del bloque `cta` | `estilo-animaciones` mide brillo y `reduced-motion` |
| **E15-E · Las tarjetas y los bloques** | El hover unificado en los 5 dialectos + revestido de los 24 bloques | No cambia un solo nodo | Invariancia + capturas |
| **E15-F · El CTA de banda** | `title?`/`description?` en los dos esquemas, los dos editores, el renderizador, variante inversa del `Button` | — | Contraste de la pareja nueva · portadas antiguas siguen pintando |
| **E15-G · La pantalla completa** | `heroHeight` (enum), `100svh`, la aritmética de cabecera/banner, el contenido que llena | — | CLS medido · preview usable |

**El orden importa por una razón concreta:** B va antes que C porque **una barrera que se
escribe después del cambio sólo certifica lo que ya hay**. Y G va la última porque es la
única que puede exigir volver atrás si el CLS o el vacío del hero no salen.

---

## 10. LAS DECISIONES PARA ERNEST

> Ninguna de estas seis las puede tomar el código. Las seis cambian el tamaño del proyecto.

**1 · «Pantalla completa»: ¿cuál de las dos?**
- **(a)** El hero ocupa la pantalla visible y el primer bloque **asoma** por abajo.
  *Recomendada.* No toca el SEO, no rompe el motor, se ve como un escaparate.
- **(b)** Hero y primer bloque **una pantalla cada uno**. Es otro proyecto: reorganiza la
  portada y deja fuera bloques que no caben en una pantalla.

**2 · ¿Con qué se llena el hero a pantalla completa?** Un titular solo en 900 px se lee como
página sin terminar. Opciones (combinables): eyebrow · las tres cifras · imagen de fondo · el
buscador montado. ⚠ **Las cifras escritas a mano envejecen y mienten; la imagen mueve el LCP.**
*Recomendación: eyebrow + buscador montado. Cifras sólo si alguien se compromete a
mantenerlas.*

**3 · El solapamiento del buscador: ¿casilla del admin, regla de la página o se renuncia?**
*Recomendada: casilla del admin* — es la única que no rompe «ningún bloque conoce su índice».

**4 · Hasta dónde llega el CTA de banda.**
- **(a)** Sólo en portada; en blog/páginas sigue el botón centrado.
- **(b)** En los dos motores, con la caja redondeada que propone la dirección A. *Recomendada
  — la propuesta lo hace así y el componente es el mismo.*
- **(c)** Sólo el estilo del botón, sin `<h2>` ni `<p>`. **Es la única opción que no toca el
  esquema**, y también la que menos se parece a la propuesta.

**5 · Qué gana el hero como configurable.** *Recomendación mínima:* `heroEyebrow` +
`heroHeight` (normal/alto/pantalla). Cada campo extra se paga en DTO + editor + preview +
fallback.

**6 · El patrón por modelo: ¿los cuatro de la propuesta?** `papel` (Cálido), `malla`
(Fresco), `filete` (Premium), `bloques` (Vibrante) — **y faltan dos**: qué hace **Modelo 0**
(recomendación: `none`, el Modelo 0 es sobrio por definición y además así no se mueve ni un
píxel de las 50 capturas) y qué hace **`premium@oscuro`**, que es el único lienzo invertido y
el que puede necesitar su propio ambiente.

---

## 11. Lo verificado en esta sesión

| Fichero | Qué se comprobó |
|---|---|
| `docs/Mejoras de estilos de plataforma/Propuestas de estilo.dc.html` | Dirección A completa (portada 115-283, página 416-489, blog 556-594) y el resolutor (664-975): tokens usados, `heroFondo`/`heroPatron`/`ritmo`, los 4 `ambiente` |
| `components/home/HomeBlockRenderer.tsx` | **8** tipos de bloque, `space-y-12`, ningún bloque conoce su índice |
| `components/blocks/BlockRenderer.tsx` | **16** tipos, `space-y-8` |
| Los 8 renderizadores de portada y los 16 del blog | Clases, hover, radios y estructura de cada uno |
| `components/shared/CtaButton.tsx` | Punto único (3 usos), hover actual, `motion-reduce`, tempo por token |
| `components/busqueda/SearchBar.tsx` | El botón `Buscar` ya va a `h-14 md:h-16 rounded-xl` — segunda altura de CTA grande, y un radio que no sigue al modelo |
| `components/ui/button.tsx` | Las 6 variantes y los 4 tamaños; **no existe una variante inversa** |
| `components/home/HomeHero.tsx` | Sólo contenido, sin `<section>`; el `<h1>` **no** se anima; `entra-escalonado` en el subtítulo |
| `app/(public)/(home)/page.tsx` | La banda `bg-primary/5 py-10 md:py-14`; el banner **encima**; el `corte` de la rejilla |
| `app/(public)/layout.tsx` + `Header.tsx` | `main min-h-screen`; cabecera `sticky h-16` |
| `app/globals.css` (603 líneas) | Tokens de `:root`, T3/inviolable, `entrada-suave`, `hero-rot-*`, `sprite-play`, los dos bloques de `reduced-motion`; **no existe `brillo`** |
| `tailwind.config.ts` | `borderRadius` sólo `lg/md/sm`; `boxShadow` y `transitionDuration/TimingFunction` por token; `tailwindcss-animate` **instalado** |
| `estilo.constants.ts` (3158 líneas) | 5 modelos + 1 de prueba, 10 versiones; los 13 `ejes`; `resolverTokens` mezcla `ejes` por versión; `zonaSoloAjusta`; las parejas de contraste |
| `estilo.service.ts`, `lib/estilo-css.ts`, `components/estilo/zona.tsx` | Cómo llega el token al navegador; `VALOR_SEGURO` **admite** las cadenas de degradado y patrón |
| `globals-espejo.spec.ts` | Todo `eje` nuevo hay que declararlo también en `globals.css`; la comprobación inversa **sólo** mira nombres semánticos |
| `e2e/estilo-invariancia.spec.ts` | **5 rutas públicas + 1 de backoffice; ni portada, ni blog, ni páginas** |
| `e2e/estilo-animaciones.spec.ts` | Mide tempo por zona, el CTA canónico y `reduced-motion` |
| `e2e-snapshots/pantallas.spec.ts` + `__capturas__` | **50 capturas; ninguna de portada, blog o páginas** — y la razón escrita |
| `admin/portada/page.tsx`, `HeroEditor.tsx`, `PortadaPreview.tsx` | Los 4 campos del hero; **el preview DUPLICA la banda** |
| `homepage-admin.controller.ts`, `update-homepage.dto.ts` | `POST /admin/homepage/upload-image` existe; los límites del hero |
| `types/home-blocks.ts` | `HomeCtaBlock` = `label` + `href` + `style`; **no hay `title` ni `description`** |

---

### Una línea de cierre

**La dirección A cabe entera, y cabe por la puerta buena: es revestir.** Lo que hay que
construir de estructura son **cuatro nodos**, los cuatro comunes a los cinco modelos. Lo
único que no viene en la propuesta —el hero a pantalla completa— es también lo único con
riesgo de verdad, y no por el CSS: por el **vacío**. Un hero de 900 px con un titular dentro
es peor que el de 190 px de hoy. Esa es la decisión que conviene cerrar antes de diseñar
nada.
