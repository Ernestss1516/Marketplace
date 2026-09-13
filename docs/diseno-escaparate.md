# Diseño — El escaparate (dirección A), sobre las 6 decisiones aprobadas

> **Qué es esto.** La auditoría ([`docs/auditoria-escaparate.md`](auditoria-escaparate.md))
> midió el hueco. Esto lo convierte en **arquitectura y plan de ráfagas**: qué token se
> declara dónde, qué barrera se extiende antes de tocar nada, qué cambia cada bloque y en
> qué orden entra todo.
>
> **Documento, cero código.** Todo lo que se afirma está verificado contra el repositorio;
> el §11 lista qué se abrió esta vez y qué se comprobó en cada sitio.
>
> **Es grande y toca el sistema de estilo.** Por eso el diseño se organiza alrededor de una
> sola regla de orden, que está en el §0.2 y de la que cuelga todo lo demás.

---

## 0. El marco

### 0.1 Las 6 decisiones aprobadas — se desarrollan, no se reabren

| # | Decisión | Dónde se desarrolla |
|---|---|---|
| **1a** | «Pantalla completa» = el hero ocupa el viewport visible y **el primer bloque asoma**. No reorganiza la portada ni rompe el SEO/motor | §5.1 |
| **2** | El hero a pantalla completa se llena con **eyebrow + buscador montado**. Sin cifras a mano, sin imagen | §5.2, §5.3 |
| **3** | El solapamiento del buscador es una **casilla del admin** | §5.2 |
| **4b** | El CTA de banda, en **los dos motores**, con caja redondeada (`h2` + `p`), mismo componente | §4.4 |
| **5** | El hero gana **`heroEyebrow`** y **`heroHeight`** (normal / alto / pantalla) | §5.5 |
| **6** | Patrones por modelo: papel (Cálido), malla (Fresco), filete (Premium), bloques (Vibrante), **Modelo 0 = none**, **`premium@oscuro` con ambiente propio** | §2.1 |

### 0.2 La regla de orden: **las barreras antes de repintar**

El hallazgo 2 de la auditoría, dicho como norma de este diseño:

> **No se toca lo que ninguna red vigila.** Ni
> [`estilo-invariancia.spec.ts:44-45`](../apps/web/e2e/estilo-invariancia.spec.ts#L44-L45) ni
> las 50 capturas miran la portada, el blog o las páginas — que es exactamente lo que el
> escaparate repinta entero. **Primero se extienden las redes a las tres superficies; después
> se repinta.**

De ahí sale el plan (§8) y, sobre todo, **de ahí sale una propiedad que conviene decir antes
de empezar**: la ráfaga B captura las tres superficies **con Modelo 0 y antes de tocar nada**,
así que ese baseline **es el «antes» del diff**. Cuando C repinte, el rojo de la batería visual
no es un fallo: **es el entregable**. El diff que Ernest aprueba sale de CI, no de una
descripción.

### 0.3 Las cuatro capas, y en cuál cae cada pieza

La frontera del sistema
([`diseno-sistema-estilo.md §3.2`](diseno-sistema-estilo.md) y el bloque T3 de
[`globals.css:178-190`](../apps/web/src/app/globals.css#L178-L190)) clasifica todo lo que
este diseño introduce:

| Capa | Quién decide | Qué mete el escaparate |
|---|---|---|
| **T1 · Configurable** | El admin | `heroEyebrow`, `heroHeight`, `overlapHero`, `title`/`description` del CTA |
| **T2 · Derivado** | El modelo calcula | — (nada nuevo) |
| **T3 · Del modelo** | El modelo fija | **`--hero-ambiente`**, **`--hero-patron`**, la escala de radio ya atada a `--radius` |
| **— · Inviolable** | Nadie | **`--ritmo-bloques`**, la altura de la cabecera, los factores de la escala de radio |

**Ninguna pieza del escaparate cae fuera de esta tabla.** Si una lo hiciera, sería la señal
de que se está reorganizando.

---

## 1. La arquitectura en una página

### 1.1 Los cuatro nodos nuevos — y por qué son comunes

El escaparate añade **exactamente cuatro** nodos al DOM. Los cuatro los pintan **los cinco
modelos por igual**; ninguno aparece o desaparece según el modelo. **Ésa es la condición
entera de que la invariancia siga verde.**

| # | Nodo | Dónde | Quién lo reviste |
|---|---|---|---|
| 1 | `<div>` del patrón, absoluto dentro de la banda del hero | `HomeHeroBanda` | `--hero-patron` (un modelo que no quiera patrón declara `none`, **no omite el nodo**) |
| 2 | `<span>` del brillo dentro del botón | `CtaButton`, botón `Buscar` | `--motion-*`, `--primary` |
| 3 | `<h2>` + `<p>` de la banda de CTA | `CtaButton` (o su envoltorio) | `--primary`, `--primary-foreground`, `--radius` |
| 4 | `<section>` envoltorio del hero, compartida página↔preview | `HomeHeroBanda` | `--hero-ambiente`, `--radius`, la altura |

> **La prueba de que algo cabe, repetida aquí porque es la que se usa en cada duda:**
> *¿si cambio de modelo, cambia el HTML? Si no, cabe.*

### 1.2 El sabor por modelo, sin una línea por modelo

Lo «espectacular por modelo» del encargo se paga entero con tokens que **ya existen**:

| Palanca | Cálido/Editorial | Fresco/Confianza | Premium |
|---|---|---|---|
| `--motion-duration` | 180 ms | 120 ms | 220 ms |
| `--motion-ease` | `cubic-bezier(.32,.72,0,1)` | `cubic-bezier(.2,0,0,1)` | `cubic-bezier(.25,.1,.25,1)` |
| `--radius` | 0.375 rem | 0.25 rem | 0.125 rem |
| `--shadow-lg` | tibia (`rgb(60 30 10/.13)`) | corta y fría | larga, 28 px |
| `--hero-patron` | papel | malla | filete |

El mismo brillo, con la curva seca de Fresco y con la larga de Premium, **no se parece**. No
hay un `if` por modelo en ninguna parte, y **no puede haberlo**: eso sería reorganizar.

---

## 2. RÁFAGA A — Los tokens y las animaciones (**cambio visual nulo**)

> **Criterio de aceptación de la ráfaga, y es el de E0:** se añade todo el vocabulario y
> **ningún bloque lo usa todavía**. Modelo 0 se ve **idéntico**, las 50 capturas siguen
> verdes sin regenerar una sola, y la batería funcional no se entera.

### 2.1 `--hero-ambiente` y `--hero-patron`

**Dónde se declaran: en `ejes` del modelo (T3).** No como un campo `ambiente: {alfa, patron}`
nuevo en `Modelo`, y la razón es que `ejes` **ya tiene toda la fontanería hecha**:

| | Campo `ambiente` nuevo | Dos entradas en `ejes` |
|---|---|---|
| Tipo `Modelo` | Campo nuevo + tipo nuevo | Nada: `ejes` es `Record<string,string>` |
| Afinable **por versión** | Habría que ampliar `AjustesDeVersion` | **Ya lo es** — [`resolverTokens:2758`](../apps/api/src/modules/estilo/estilo.constants.ts#L2758) mezcla `ejes` de la versión sobre los del modelo |
| Llega al navegador | Habría que tocar el servicio | **Ya llega** — `Object.assign(tokens, semanticos, ejes)` ([línea 2787](../apps/api/src/modules/estilo/estilo.constants.ts#L2787)) |
| Vigilado en CI | Barrera nueva | `globals-espejo.spec.ts` lo exige en `globals.css` **el mismo día** |
| Ajustable por zona | Indefinido | Sí, y `zonaSoloAjusta` lo controla |

**Forma de los valores.** Dos cadenas CSS:

- `--hero-ambiente` → el valor de `background` de la banda (tres capas: dos degradados
  radiales del primario y del acento, más un vertical de `muted` a `background`).
- `--hero-patron` → el valor de `background-image` de la capa superpuesta, o `none`.

**Se escriben con `var()`, no con el color ya resuelto.** Es decir
`hsl(var(--primary) / .20)` y no `hsl(18 68% 42% / .20)`. Así el ambiente **sigue al color
que elija el admin** sin que nada tenga que recalcularse, y los alfas quedan donde deben:
en el modelo.

**⚠ Verificado que pasan el filtro de inyección, y con una condición.**
[`estilo-css.ts:19`](../apps/web/src/lib/estilo-css.ts#L19) descarta en silencio todo valor
que no case con `/^[\w\s.,%#()/-]+$/`. Los degradados y los cuatro patrones sólo usan
letras, dígitos, espacios, comas, paréntesis, `%`, `.`, `/` y guiones: **entran tal cual,
sin tocar el filtro**. La condición: **ni una comilla**. Es la misma trampa que se tragó las
comillas de `font-heading` en Cálido y dejó los titulares en sans sin que nada avisara
([`estilo.constants.ts:1210-1228`](../apps/api/src/modules/estilo/estilo.constants.ts#L1210-L1228)).

**Los seis valores (decisión 6):**

| Modelo | `--hero-patron` | Ambiente |
|---|---|---|
| **`modelo-0`** | **`none`** | **Plano: `hsl(var(--primary) / .05)`** — literalmente el `bg-primary/5` de hoy. Es lo que hace que la ráfaga C **tampoco** mueva el hero del Modelo 0 |
| `calido-editorial` | `papel` — trama diagonal a 58°, `--foreground` al 3,5 % | alfas 0.20 / 0.16 |
| `fresco-confianza` | `malla` — retícula de 34 px, `--foreground` al 5 % | alfas 0.14 / 0.12 |
| `premium` | `filete` — una línea de acento de 3 px al pie de la banda | alfas 0.10 / 0.10 |
| `vibrante` | `bloques` — dos círculos grandes de secundario y acento | alfas 0.26 / 0.24 |
| **`premium@oscuro`** | hereda `filete` | **Ambiente propio**, vía `porVersion.oscuro.ejes` |
| `modelo-prueba-contraluz` | **`none`** | Plano. Es el modelo del test de invariancia: cuanto menos ruido, mejor |

**Por qué `premium@oscuro` lleva ambiente propio (decisión 6).** Es la única versión de
lienzo invertido del catálogo: un degradado calibrado para ir de `muted` (claro) a
`background` (claro) sobre carbón se ve sucio o directamente no se ve. **El mecanismo ya
existe** (E14 dejó que una versión redefina `ejes`), así que esto no abre nada: sólo lo usa.
Su valor concreto es una de las decisiones pendientes (§9).

**La barrera que esto activa sola.**
[`globals-espejo.spec.ts:56-64`](../apps/api/src/modules/estilo/globals-espejo.spec.ts#L56-L64)
recorre `{...MODELO_0.semanticos, ...MODELO_0.ejes}` y exige que **cada uno** esté declarado
con el mismo valor en `globals.css`. Añadir los dos tokens a `MODELO_0.ejes` **pone el test
en rojo hasta que se declaran también en la hoja de respaldo** — que es exactamente lo que
se quiere, y gratis.

### 2.2 La escala de radio, calibrada a cero

**El agujero (auditoría §3.4):**
[`tailwind.config.ts:95-99`](../apps/web/tailwind.config.ts#L95-L99) ata a `var(--radius)`
sólo `lg`, `md` y `sm`. `xl`, `2xl` y `3xl` conservan los valores de fábrica de Tailwind, así
que **no responden al modelo**: Premium pide `radius: 0.125rem` y sus tarjetas de carrusel
siguen a 0.75 rem.

**La aritmética, que es la que decide los factores:**

| Utilidad | Tailwind de fábrica | Factor propuesto | Con `--radius: 0.5rem` (Modelo 0) | ¿Se mueve? |
|---|---|---|---|---|
| `rounded-xl` | 0.75 rem (12 px) | `calc(var(--radius) * 1.5)` | 8 × 1.5 = **12 px** | **No** |
| `rounded-2xl` | 1 rem (16 px) | `calc(var(--radius) * 2)` | 8 × 2 = **16 px** | **No** |
| `rounded-3xl` | 1.5 rem (24 px) | `calc(var(--radius) * 3)` | 8 × 3 = **24 px** | **No** |

**Los tres caen exactos.** No hay redondeo que negociar: la escala entera se puede tokenizar
**sin mover un píxel del Modelo 0**, y las 50 capturas —que sí contienen `rounded-xl` en
pantallas de cuenta y backoffice, con `threshold: 0`— siguen verdes.

⚠ **Y por eso los factores son 1.5 / 2 / 3 y NO los 2.2 / 2.4 / 2.6 de la propuesta.** Los de
la propuesta son un continuo de diseñador; llevarlos literales significaría o inventar un
vocabulario paralelo de radios (`calc()` a mano en cada componente, fuera de las utilidades)
o mover el Modelo 0. **El escaparate usa la escala cuantizada**, y lo que la propuesta pinta
a ×2.4 se pinta a `rounded-2xl`. Es la decisión 2 del §9.

**Lo que sí se mueve, y hay que decirlo en el commit:** los otros cuatro modelos. Un
`rounded-xl` en Premium pasa de 12 px a 3 px — **hacia** lo que ese modelo pide. Ninguna
captura lo ve (las 50 son con Modelo 0), así que la ráfaga A sigue siendo de cambio nulo
*para lo que las redes miran*; el efecto en los demás modelos es el arreglo, no un daño
colateral.

### 2.3 Las animaciones: qué se reusa, qué se añade y qué se descarta

**Inventario verificado de lo que ya existe** (todo CSS puro, cero JS):

| Nombre | Qué hace | Dónde |
|---|---|---|
| `entrada-suave` / `.entra-escalonado` | `opacity 0→1` + `translateY(.5rem)`, con `--paso` para escalonar | [`globals.css:368-383`](../apps/web/src/app/globals.css#L368-L383) |
| `hero-rot-2…6` | La rotación del titular, 5 reglas por N | [476-520](../apps/web/src/app/globals.css#L476-L520) |
| `sprite-play` | El póster animado | [586-593](../apps/web/src/app/globals.css#L586-L593) |
| `tailwindcss-animate` | `animate-in/out`, `fade-*`, `zoom-*`, `slide-*` — **overlays de Radix**, atados a `--motion-duration` | [`tailwind.config.ts:155-172`](../apps/web/tailwind.config.ts#L155-L172) |

**El cruce con las seis de la propuesta:**

| De la propuesta | Decisión | Por qué |
|---|---|---|
| **`sube`** | **Se reusa `entrada-suave`** | Es la misma animación con más recorrido (16 px vs 8). Para que el hero pueda pedir más viaje sin duplicar el keyframe: `translateY(var(--entrada-y, 0.5rem))`. **El valor por defecto conserva el de hoy**, así que las dos piezas que ya la usan no se mueven |
| **`brillo`** | **NUEVA** | No existe nada parecido, y `tailwindcss-animate` **no la cubre**: sus utilidades son entradas/salidas de overlay, no un recorrido en bucle. Es `transform: translateX()` sobre un `<span>` absoluto → cumple la regla 2 por construcción |
| `rotDesliza` | **FUERA de este proyecto** | Nuestro `hero-rot` rota por opacidad. Convertirlo a desplazamiento son 5 `@keyframes` reescritos y el cruce de fundidos recalibrado, **sobre los hijos del elemento LCP**. Trabajo real, ganancia pequeña, riesgo en el sitio peor. Se deja anotado, no se hace |
| `entraIzq`, `reglaCrece` | **FUERA** | Son de la dirección **B** |
| `flota` | **FUERA** | Declarada en la propuesta y **no aplicada** en la dirección A |

**Dónde vive `brillo`:** en `globals.css`, **fuera de `@layer`** — por el mismo argumento ya
escrito dos veces en el fichero (una regla sin capa gana a la misma regla dentro de una capa,
y el purge no la ve) — y **dentro del bloque `@media (prefers-reduced-motion: reduce)` que ya
existe**, que es donde se apaga. Degradación: el botón entero, quieto. Un estado completo,
no uno a medias.

### 2.4 `--ritmo-bloques`: en `globals.css`, y **protegido**

El `ritmo` de la propuesta **depende de la dirección, no del modelo** (86 px en A, 64 en B):
ninguno de sus cuatro modelos lo cambia. Y no podría ser token de modelo aunque se quisiera:
es la capa inviolable.

**Se declara sólo en `globals.css`**, nunca en los `ejes` de ningún modelo. Eso le da dos
protecciones **que ya existen y no hay que construir**:

1. **Ningún modelo puede tocarlo.** Los tokens salen de `resolverTokens`, que sólo emite
   rampa + marca + semánticos + `ejes`. Un token que no está en `ejes` no existe para el
   modelo.
2. **Ninguna zona puede tocarlo.**
   [`zonaSoloAjusta`](../apps/api/src/modules/estilo/estilo.constants.ts#L2862-L2880) recorre
   las zonas de cada modelo **y de cada versión** y devuelve los nombres que no existen en la
   base. Un `--ritmo-bloques` en una zona saldría como inventado y **pondría CI en rojo**.
3. **Y no se confunde con un huérfano.** La comprobación inversa de `globals-espejo`
   ([línea 73](../apps/api/src/modules/estilo/globals-espejo.spec.ts#L73)) sólo persigue
   nombres **semánticos** (`warning|success|info|pending|neutral|rating|featured|favorite|destructive`),
   así que un token estructural declarado sólo en la hoja **no la dispara**.

**La capa inviolable ya tiene barrera. Este diseño la usa, no inventa otra.**

Mismo tratamiento para las dos constantes que necesita el hero a pantalla completa
(§5.1): la altura de la cabecera y el asomo.

### 2.5 Qué entra y qué NO en la ráfaga A

| Entra | No entra |
|---|---|
| Los 2 tokens de hero en los 6 modelos + `globals.css` | Que la banda los use |
| La escala de radio en `tailwind.config.ts` | Cambiar `rounded-lg` por `rounded-2xl` en ningún sitio |
| `@keyframes brillo` + su `reduced-motion` | Que ningún botón lo lleve |
| `--ritmo-bloques` y las dos constantes del hero | Que ningún contenedor lo use |
| `--entrada-y` con su valor por defecto | — |

**Salida esperada:** `globals-espejo` verde, `zonaSoloAjusta` verde, las 50 capturas verdes
**sin regenerar ninguna**, batería funcional intacta.

---

## 3. RÁFAGA B — Las barreras, **antes** de repintar

### 3.1 Lo que hoy no vigila nadie

| Superficie | Invariancia | Captura visual |
|---|---|---|
| `/` (portada) | ❌ | ❌ |
| `/blog/[slug]` | ❌ | ❌ |
| `/paginas/[slug]` | ❌ | ❌ |
| `/planes`, `/login`, `/registro`, `/contacto`, `/admin/login`, `/admin/anuncios` | ✅ | ✅ |

### 3.2 El obstáculo real: **no hay contenido sembrado**

Verificado: [`seed-test.ts:403-412`](../apps/api/prisma/seed-test.ts#L403-L412) siembra
categorías, etiquetas, ajustes, **la portada**, packs y planes. **No siembra ni un `Post` de
blog ni una `PAGE`.** El único `Post` que existe en algún seed es la **página de cookies**, y
nace en `DRAFT` a propósito — o sea, invisible para el público.

Y hay un segundo obstáculo, más fino: **la portada sembrada incluye un bloque `listings`**
([`portada.ts:36-42`](../apps/web/e2e/helpers/portada.ts#L36-L42)) que se resuelve contra
Meilisearch. Si entre dos capturas cambiara un anuncio indexado, el árbol —o la foto—
diferiría **por el dato, no por el modelo**: un rojo que no significa nada, que es la forma
en que una batería visual se muere.

**Las tres piezas que la ráfaga B construye, en este orden:**

1. **Contenido editorial sembrado.** Un `Post` publicado y una `PAGE` publicada en
   `seed-test.ts`, cada uno con **un bloque de cada tipo que importa** — no uno de cada uno de
   los 16, sino la muestra por **idioma visual**: texto, cita, faq, imagen+texto, pasos, tabla,
   hub, CTA. Es el mismo criterio que la batería visual ya usa para elegir pantallas
   (*«por COBERTURA DE IDIOMA VISUAL, no de rutas»*,
   [`pantallas.spec.ts:9-12`](../apps/web/e2e-snapshots/pantallas.spec.ts#L9-L12)).
2. **Una portada determinista para medir.** No se toca la sembrada: las specs **ponen la
   suya** con `PATCH /admin/homepage` y la restauran al terminar, exactamente como
   `restaurarPortada` ya hace y como el propio test de invariancia hace con el modelo. La
   portada de medida lleva `search`, `cta`, `steps`, `grid` y `searchTable` — **todo menos
   `listings`**, que es el único bloque cuyo contenido depende de un índice externo.
3. **Recién entonces**, las dos redes.

> **Por qué la portada de medida quita `listings` y no lo estabiliza:** estabilizarlo exige
> fijar un conjunto de anuncios indexados y esperar a Meilisearch en cada arranque — que es
> justo el coste (~10 s/test) que la batería de capturas evita por diseño. Y lo que estas
> redes vigilan es **el revestimiento**, no la resolución de la búsqueda, que ya tiene sus
> propias specs. Se mide lo que se quiere vigilar.

### 3.3 La invariancia extendida

`RUTAS_PUBLICAS` pasa de 5 a 8 entradas: **`/`**, **`/blog/<slug sembrado>`**,
**`/paginas/<slug sembrado>`**.

**Lo que el mecanismo ya resuelve y no hay que rehacer:** ignora `class`, `style` y los
identificadores generados por Radix; salta `<script>`/`<style>`; compara etiquetas,
anidamiento, **todo el texto** y el resto de atributos. Y activa el modelo **por la vía real**
(`PUT /api/admin/estilo`), que es lo que tumba la caché del frontend.

**Dos cuidados propios de estas rutas:**

- **La caché de la portada.** `getCachedHomepageConfig` es un `unstable_cache` con tag
  `homepage-config` y TTL de una hora
  ([`lib/api/homepage.ts`](../apps/web/src/lib/api/homepage.ts)). El `PATCH /admin/homepage`
  dispara su `revalidateTag` desde el backend, así que poner la portada de medida por la vía
  real basta. **Escribir la fila a mano no bastaría** — mismo argumento que el test ya tiene
  escrito para el estilo.
- **El segundo test, el del catálogo**, mide hoy una sola ruta pública por presupuesto.
  Recomendación: **que mida `/`** en vez de `/planes`. La portada es la superficie con más
  bloques y la que el escaparate más toca; `/planes` seguirá cubierta por el primer test, que
  recorre las ocho.

### 3.4 Las capturas: **tres nuevas, no treinta**

| Captura | Por qué ésa |
|---|---|
| `publico-portada` | Es el idioma visual entero del motor de portada: hero + 5 bloques |
| `publico-blog-articulo` | El motor del blog con su muestra de bloques, y **dentro de la zona `blog`** (la única zona pública que ajusta tokens) |
| `publico-pagina` | Misma maquinaria, **fuera** de la zona `blog` — o sea, la base. Y es donde vive el CTA en caja (§4.4) |

Tres capturas × 2 proyectos (`escritorio` 1280×720, `movil`) × 2 plataformas = **6 ficheros
nuevos por plataforma**. Las capturas cuestan segundos y corren **en su propio job de CI**
(`playwright.snapshots.config.ts`), que no compite con los ~45 minutos de la batería
funcional. **El presupuesto aguanta; no se añade nada más.**

**El índice del blog (`/blog`) se queda fuera** a propósito: su tarjeta de post es una
variante del mismo idioma que ya cubre el artículo, y cada captura que no aporta idioma
nuevo es coste sin señal.

⚠ **`preparar()` ya apaga lo que hace falta** —`prefers-reduced-motion`, `animations:
'disabled'`, recorrido para la carga diferida, `document.fonts.ready`— así que **el brillo y
las entradas no pueden hacer parpadear una captura**. A cambio, **las capturas no verifican
el brillo**: eso lo mide `estilo-animaciones.spec.ts` (§4.3).

### 3.5 El baseline es el «antes» del diff

Las seis capturas se generan **con Modelo 0 y antes de repintar**. Cuando la ráfaga C entre,
esas seis se pondrán rojas — **y ése es el entregable**: el diff que Ernest mira para decir
sí o no sale del artefacto de CI, no de una descripción en prosa.

**Salida esperada de B:** CI verde con el aspecto de hoy, tres superficies vigiladas por dos
redes distintas, y ni un píxel cambiado.

---

## 4. RÁFAGA C — Los bloques revestidos

> A partir de aquí **sí se ven cambios**. Todo lo que sigue es revestir salvo los cuatro
> nodos del §1.1, y todos ellos son comunes a los cinco modelos.

### 4.1 El hero a sangre (todavía **sin** pantalla completa)

**Qué cambia:** la banda deja de ser `bg-primary/5` y pasa a `background: var(--hero-ambiente)`,
con el `<div>` del patrón superpuesto a `opacity: .5`; el titular pasa de `text-2xl md:text-3xl`
a un `clamp` grande; el eyebrow entra (§5.3).

**Qué NO cambia, y es lo que protege el LCP:** el `<h1>` **no se anima**. Está decidido y
escrito en el repo ([`HomeHero.tsx:98-104`](../apps/web/src/components/home/HomeHero.tsx#L98-L104))
y **este diseño no lo reabre**, ni siquiera para seguir a la propuesta — que sí anima el `<h1>`
en la página informativa y en el blog (líneas 422 y siguientes). **Al trasladar, el titular se
queda quieto en las tres superficies.**

**El `clamp` no causa CLS**: se resuelve en el primer layout, no depende de red. Y la garantía
de que el titular no salta al rotar la palabra **ya está construida**: `inline-grid` con todas
las opciones en la misma celda ([`globals.css:427-444`](../apps/web/src/app/globals.css#L427-L444)).
No hay que rehacerla; hay que no romperla.

**Modelo 0 no se mueve** (§2.1): su ambiente es el `primary/5` plano de hoy y su patrón es
`none`.

### 4.2 El hover unificado de las tarjetas

Hoy hay **cuatro dialectos** (auditoría §2.5): `shadow-md` sin levantar, `-translate-y-0.5 +
shadow-sm`, `bg-muted/50` sin nada, y `shadow-md + scale-105` en la foto. Pasan a **uno**:

```
transition:  transform + box-shadow, en --motion-duration / --motion-ease
hover:       translateY(-4px) + shadow-lg
reduced:     transform-none
```

**Es revestir puro**, y tiene dos propiedades que vienen de serie: el levantamiento es
`transform` (no reflowea → regla 2 cumplida por construcción), y `shadow-lg` ya resuelve a
`var(--shadow-lg)`, así que **cada modelo levanta con su propia sombra** sin una línea por
modelo.

⚠ **El `motion-reduce` entra con el hover, no después.** Hoy sólo `CtaButton` lo declara; si
se unifican los cuatro dialectos sin él, se multiplica por cuatro un incumplimiento de la
regla 5.

### 4.3 Los CTAs con brillo

**Dónde:** `CtaButton` (los dos motores) y el botón `Buscar` de `SearchBar`. **Y en ningún
sitio más.** Los enlaces «Ver todos», el CTA de columna de `steps` y el «Publicar anuncio» de
la cabecera ganan coherencia de color y tempo, **no destellos**: pintarlos de brillo convierte
«espectacular» en «ruidoso» y, sobre todo, saca la zona de impacto de su perímetro de cuatro
sitios, que es lo que la hace defendible.

**La geometría, unificada de paso.** Hoy hay **dos alturas de CTA grande**: `CtaButton` usa
`size="lg"` (44 px) y el botón `Buscar` lleva sus propias clases `h-14 md:h-16` (56/64 px,
[`SearchBar.tsx:222`](../apps/web/src/components/busqueda/SearchBar.tsx#L222)). El escaparate
las junta en **un tamaño compartido**, con el radio de la escala nueva.

**La barrera:** `estilo-animaciones.spec.ts` ya mide que *«el CTA canónico responde al tempo
del modelo, no a uno escrito a mano»*. Se le añaden dos casos: **el brillo existe y hereda
`--motion-ease`**, y **con `reduced-motion` su `animationName` es `none`** y el botón se ve
entero.

### 4.4 El bloque CTA a banda — **los dos motores** (decisión 4b)

**Es la única parte del escaparate que toca el modelo de datos**, y por eso lleva su propia
sección.

**El esquema gana dos campos opcionales, en los dos motores:**

| Campo | Límite | Motivo del límite |
|---|---|---|
| `title?` | 120 | Simétrico con `label` del motor de portada |
| `description?` | 300 | Simétrico con `heroSubtitle` |

Los dos son **opcionales, y no por comodidad**: sin ellos, toda portada y todo artículo
guardado **dejaría de validar**. Y el renderizador hace lo que el sistema ya hace en otro
sitio: **sin `title`, pinta el botón centrado de hoy**. Mismo criterio que las celdas sin
`media` de la rejilla
([`GridHomeBlockRenderer.tsx:74-77`](../apps/web/src/components/home/blocks/GridHomeBlockRenderer.tsx#L74-L77)):
endurecer un esquema no reescribe lo guardado.

**Dos clases de DTO, no una.** `CtaBlockDto` (blog) y `CtaHomeBlockDto` (portada) son hoy
**gemelas pero independientes**, y el comentario del segundo explica por qué: *«los dos
motores comparten el COMPONENTE presentacional, nunca el tipo»*. **Este diseño respeta esa
frontera**: los dos DTO ganan los mismos dos campos, por separado, y lo que se comparte sigue
siendo el componente con props planas.

**⚠ El color del botón interior: `--primary-foreground`, NO `--background`.**

La propuesta pinta el botón de la banda como `background: var(--bg); color: var(--primary)`.
**Eso se rompe en el catálogo real**, y está escrito en el propio registro: sobre el carbón de
`premium@oscuro`, *«el marino de marca sería invisible sobre este carbón (**1,85:1**)»*
([`estilo.constants.ts:1844-1845`](../apps/api/src/modules/estilo/estilo.constants.ts#L1844-L1845)).
Un botón `--background` con letra `--primary` sobre una banda `--primary` sería, en esa
versión, invisible dos veces.

**La solución sale del sistema, no de un color nuevo:**

```
banda:            background: var(--primary);            color: var(--primary-foreground)
botón interior:   background: var(--primary-foreground); color: var(--primary)
```

Porque **`--primary-foreground` se elige por contraste contra `--primary`**
(`mejorTextoSobre`) y esa pareja **ya es bloqueante** (*«letra sobre el color principal»*,
AA texto, [línea 2910](../apps/api/src/modules/estilo/estilo.constants.ts#L2910)). O sea: el
botón contrasta con la banda ≥4,5:1 **por construcción**, su letra contrasta con su relleno
≥4,5:1 **por la misma pareja**, y **no hace falta añadir ni una comprobación nueva**. La
garantía ya está pagada.

⚠ **Y por lo mismo: nada de `opacity` sobre el texto.** La propuesta pone `opacity:.85` al
párrafo de la banda. Eso baja el contraste por debajo de lo que la pareja garantiza y **anula
la propiedad entera**. El texto secundario de la banda va con el token limpio.

**Dónde encaja `style`.** El `primary | secondary | outline` del bloque deja de describir lo
que hay cuando el bloque es una banda. Recomendación: **`style` sigue gobernando el caso sin
`title`** (el botón suelto de siempre) y **la banda ignora `style`**, porque su reparto de
colores es el de arriba y no admite variantes sin romper la garantía. Es menos flexible y es
**mucho** más seguro.

**Lo que se toca, en cuenta:** 2 DTO + 2 tipos en `apps/web` + 2 editores + el componente
compartido + los `*Defaults` de los dos editores. **Ocho sitios.** Es la parte cara de C, y es
la única con migración de esquema... salvo que no la hay: los bloques viven en un `Json`
(`Post.blocks` y `HomepageConfig.blocks`), **así que no hay migración de base**.

### 4.5 El resto de los bloques

Los 24 se revisten con el mismo vocabulario; ninguno cambia de estructura. Lo que cambia,
agrupado por gesto:

| Gesto | Bloques |
|---|---|
| **Radio de la escala nueva** (`rounded-2xl` donde hoy hay `rounded-lg`/`xl`) | `grid`, `hub`, `image`, `imageText`, `table`, `video`, `videoUpload`, `adBanner`, `cookiePreferences`, `categoryCarousel`, `faq` |
| **Tarjeta donde hoy no hay caja** | `steps` (portada: cada columna en tarjeta; blog: cada paso en tarjeta), `faq` (el acordeón dentro de una caja) |
| **Hover unificado** (§4.2) | `ListingCard`, `CategoryGrid`, `categoryCarousel`, `grid`, `hub`, tarjeta de post |
| **Pieza, no filete** | `quote`: borde macizo `--primary`, fondo `--muted`, `--font-heading` |
| **Ritmo** | Los dos contenedores (`space-y-12` y `space-y-8` → `--ritmo-bloques`) |
| **Tarjetas altas** | `categoryCarousel`: foto a sangre con proporción fija, texto debajo |

⚠ **El cuerpo del texto no entra.** Subir los artículos a 17 px es una decisión de producto
legítima, pero es **escala tipográfica**: capa inviolable, común a todos los modelos, y merece
aprobarse por separado mirándola. **Fuera de esta ráfaga.**

### 4.6 El diff a Ernest

Las seis capturas de la ráfaga B se ponen rojas. El artefacto de CI de la batería de
snapshots trae **antes / después / diff** de cada una. **Eso es lo que se enseña.** Si algo no
gusta, se ajusta antes de regenerar el baseline; regenerarlo es el acto que dice «aprobado».

---

## 5. RÁFAGA D — El hero a pantalla completa y configurable

### 5.1 `heroHeight`: los tres valores y su aritmética (decisión 1a)

| Valor | Qué es | Cómo se expresa |
|---|---|---|
| `normal` | Lo de hoy | `py-10 md:py-14` |
| `alto` | Más aire, sin comprometerse con el viewport | `py-16 md:py-24` |
| `pantalla` | **El viewport visible, con el primer bloque asomando** | `min-h-[calc(100svh - <cabecera> - <asomo>)]` |

**Las tres son clases ESTÁTICAS en un `Record`**, nunca interpoladas. Es la regla del repo,
escrita dos veces (`ROTATION_CLASS` en `HomeHero`, `COLUMN_CLASS` en la rejilla y en la
tabla): *Tailwind purga lo que no ve escrito*.

**Las cuatro decisiones técnicas de `pantalla`, y el porqué de cada una:**

1. **`svh`, no `vh` ni `dvh`.** `vh` cuenta la barra del navegador que luego se retrae: el
   hero se saldría de pantalla justo al cargar. `dvh` cambia **durante** el scroll → sería una
   fuente de CLS creada a mano. **`svh` es el único de los tres que es estable**, y esa
   estabilidad es la que hace que este hero tenga CLS cero.
2. **`min-height`, no `height`.** Si el contenido crece (móvil, buscador montado, titular de
   tres líneas), la banda **crece**; no recorta. Un `height` fijo produciría contenido cortado,
   que es peor que un hero corto.
3. **Menos la cabecera.** `Header` es `sticky top-0` con `h-16`
   ([`Header.tsx:31-37`](../apps/web/src/components/layout/Header.tsx#L31-L37)): al ser sticky
   y no fixed **ocupa flujo**, así que un `100svh` a secas empujaría el pie del hero fuera de
   pantalla.
4. **Menos el asomo — que es lo que la decisión 1a pide.** Un margen (del orden de 3 rem) que
   deja ver el borde superior de lo que viene. **Con el buscador montado (§5.2), lo que asoma
   es el buscador**, que es el elemento más invitador que hay.

**Las dos constantes (altura de cabecera y asomo) van a `globals.css` como estructura**, por
el mismo mecanismo y con la misma protección que `--ritmo-bloques` (§2.4).

**El banner.** `BannerList` se pinta **encima** del hero cuando hay banners activos
([`(home)/page.tsx:69-73`](../apps/web/src/app/(public)/(home)/page.tsx#L69-L73)) y su alto es
variable. Con banner, `calc(100svh - cabecera - asomo)` se pasa de largo. **Decisión: se
acepta.** El banner es esporádico, el efecto es que el asomo desaparece ese día, y la
alternativa —meter el banner dentro del hero— es un cambio de maquetación de la portada por un
caso que casi nunca está activo.

**Degradación:** un navegador sin `svh` ignora la declaración y el hero se queda con su altura
natural. **Un hero normal, no uno roto.**

### 5.2 El buscador montado (decisiones 2 y 3)

**La casilla:** `HomeSearchBlock` gana `overlapHero?: boolean` («montar sobre la banda del
hero»).

**Por qué una casilla y no una regla automática.** El motor tiene escrito que *«ningún bloque
conoce su índice»*
([`HomeBlockRenderer.tsx:35-36`](../apps/web/src/components/home/HomeBlockRenderer.tsx#L35-L36)),
y un margen negativo incondicional se comería el bloque anterior en cuanto el admin bajara el
buscador al tercer puesto. Con la casilla, **el bloque no deduce su posición: ejecuta una
intención declarada** — exactamente lo que ya hace con `showPopularCategories`.

**El editor debe avisar, no impedir.** Si `overlapHero` está marcado y el buscador **no** es el
primer bloque, el resultado es feo pero no roto. Un aviso junto a la casilla («esto solo se ve
bien si el buscador es el primer bloque») es honesto; una barrera sería el motor deduciendo
posiciones por la puerta de atrás.

**Y el LCP se mueve, a un sitio que también es seguro.** Con el buscador montado, el candidato
a LCP pasa a ser el `<h1>` **o** la caja del buscador. Los dos son HTML servido: `SearchBar` es
`'use client'` pero su marcado es un `<form>` nativo que viaja entero en la respuesta y
funciona sin JS. **Ninguno de los dos se anima.** Regla 4 intacta.

### 5.3 `heroEyebrow` (decisiones 2 y 5)

Un rótulo corto sobre el titular (≤80 caracteres), en `--primary` y versalitas.

⚠ **Ya existe un eyebrow, y está en otro sitio:** el del bloque `search`
([`SearchHomeBlockRenderer.tsx:40-44`](../apps/web/src/components/home/blocks/SearchHomeBlockRenderer.tsx#L40-L44)),
y la portada sembrada lo usa («Miles de anuncios cerca de ti»). Con el buscador montado bajo el
hero, **los dos rótulos quedarían a cuatro centímetros uno de otro**.

**Recomendación: se conservan los dos campos y el editor avisa.** Quitar el del bloque exigiría
una migración de datos por un problema que un aviso resuelve. Es la decisión 4 del §9.

⚠ **Y una deuda que el eyebrow hace más visible, aunque no la crea.** El rótulo va en
`text-primary` **sobre el lienzo**, y esa pareja —`primary` como TEXTO sobre `background`— **no
la mide ninguna barrera**: no está en `parejasBloqueantes` ni en `parejasDeAviso`
([líneas 2904-3002](../apps/api/src/modules/estilo/estilo.constants.ts#L2904-L3002)). En
`premium@oscuro` vale **1,85:1** según el propio registro. Hoy ya afecta a los enlaces «Ver
todos», al «Publicar anuncio» de la cabecera y al eyebrow del buscador.

**Lo que este diseño propone**, sin abrir un frente que no le toca: **añadir esa pareja como
AVISO** (se mide, se informa, no bloquea) en la ráfaga A. Cuesta una línea, pone el número
delante de quien diseñe un modelo, y **no convierte en 422 un guardado que hoy es legítimo**.
Arreglarla de verdad —que `premium@oscuro` derive un primario aclarado— es el §12 de
[`auditoria-eje-version.md`](auditoria-eje-version.md) y es otra ráfaga. Decisión 5 del §9.

### 5.4 Las cinco reglas de E6, aplicadas al hero a pantalla completa

| Regla | Cómo se cumple aquí |
|---|---|
| **1 · CSS antes que JS** | Ambiente y patrón son degradados; la altura es `min-h` con `calc`. **Cero KB de bundle**, y la banda sigue siendo Server Component |
| **2 · Nada de CLS** | `svh` es estable; `min-height` no recorta; el ambiente **no es una imagen** (nada que llegue tarde). Sólo se anima `opacity`/`transform` |
| **3 · El coste donde se disfruta** | ⚠ Es el punto a vigilar: un degradado de tres capas más un patrón repetido **a pantalla completa** es trabajo de pintura en móvil. **Nada de `will-change`** aquí — promocionaría una capa del tamaño de la pantalla. Se mide en un móvil de gama baja antes de cerrar D |
| **4 · El LCP no se anima** | El `<h1>` quieto, siempre. El buscador, HTML servido sin animación de entrada |
| **5 · `reduced-motion` degrada completo** | Ambiente y patrón **no son animación: se quedan**. Se apagan brillo, entradas y rotación. Lo que queda es la misma página, quieta |

### 5.5 La configuración: dónde se toca (decisión 5)

⚠ **Los campos del hero son columnas de Prisma**, no claves de un `Json`
([`schema.prisma:3591-3607`](../apps/api/prisma/schema.prisma#L3591-L3607)). Así que
`heroEyebrow` y `heroHeight` **sí necesitan migración**. La cuenta completa:

| # | Sitio | Qué |
|---|---|---|
| 1 | `schema.prisma` + migración | `heroEyebrow String?`, `heroHeight String @default("normal")` |
| 2 | `update-homepage.dto.ts` | `@IsOptional @MaxLength(80)` y `@IsIn(['normal','alto','pantalla'])` |
| 3 | `homepage.service.ts` | Valor por defecto y mapeo de salida ([líneas 46-49 y 117-122](../apps/api/src/modules/homepage/homepage.service.ts#L117-L122)) |
| 4 | `types/home-blocks.ts` | `HomepageConfig` |
| 5 | `FALLBACK_HOMEPAGE_CONFIG` | Sin esto, la portada servida con la API caída ignoraría la altura |
| 6 | `HeroEditor.tsx` | Un campo de texto y un `<select>` de tres valores |
| 7 | `PortadaPreview.tsx` | Pasarlos al envoltorio (§6) |
| 8 | `PORTADA_SEMILLA` + `seed-test.ts` | O la portada de los tests diverge de la que el seed promete — el fichero ya avisa: *«Si esto cambia, cambia en seed-test.ts y aquí a la vez»* |

**La frontera, dicha una vez más porque es lo que ordena esta lista:** el admin pone
**contenido y decisiones editoriales** (rótulo, altura, si el buscador monta); el modelo pone
**el ambiente** (`--hero-ambiente`, `--hero-patron`). Ninguno invade al otro: si el admin
eligiera el ambiente, los cinco modelos tendrían el mismo hero; si el modelo eligiera la
altura, estaría tocando la capa inviolable.

---

## 6. El preview del admin: el nodo que evita la mentira

**El problema, verificado.** [`(home)/page.tsx:82-88`](../apps/web/src/app/(public)/(home)/page.tsx#L82-L88)
pinta la banda; [`PortadaPreview.tsx:66-84`](../apps/web/src/app/(admin)/admin/portada/_components/PortadaPreview.tsx#L66-L84)
**la copia**, con un comentario que lo admite. `HomeHero` es sólo el **contenido** y no pinta
la `<section>` ni el fondo, por decisión escrita
([`HomeHero.tsx:7-11`](../apps/web/src/components/home/HomeHero.tsx#L7-L11)).

En cuanto la banda gane ambiente, patrón y altura, **las dos copias divergen** y el preview
—que es obligatorio porque *guardar es publicar*— empieza a mentir.

**La solución: `HomeHeroBanda`**, el cuarto nodo del §1.1. Envuelve a `HomeHero` con la
`<section>`, el ambiente, el patrón y la altura, y **lo usan los dos**. Es el mismo argumento
por el que `PortadaPreview` ya reusa `HomeHero` y `HomeBlockRenderer`: *«es lo que hace que el
preview no pueda mentir»*.

**⚠ Y por eso la altura vive en el envoltorio, no dentro de `HomeHero`.** Un hero de `100svh`
dentro de un formulario de administración es inusable: el envoltorio acepta la altura como
prop y el preview pasa una versión contenida. **Ésa es la razón técnica** de que el reparto
contenido/envoltorio se mantenga tal como está hoy, en vez de meterlo todo en `HomeHero`.

**Entra en la ráfaga C**, no en la D: la banda gana ambiente en C, así que la copia empieza a
mentir en C.

---

## 7. Lo que este diseño **no** hace

Escrito para que no se cuele por acumulación:

- **No anima el `<h1>`** en ninguna de las tres superficies, ni siquiera donde la propuesta lo
  hace.
- **No convierte `rotDesliza`**: la rotación del titular sigue siendo por opacidad.
- **No trae `entraIzq`, `reglaCrece` ni `flota`** (dirección B, o declaradas y no usadas).
- **No toca la escala tipográfica del cuerpo** de los artículos.
- **No pone brillo** fuera de `CtaButton` y el botón `Buscar`.
- **No añade cifras** al hero ni imagen de fondo (decisión 2).
- **No arregla** `primary`-sobre-lienzo en `premium@oscuro`: lo **mide** y lo deja anotado.
- **No reorganiza la portada** en pantallas: el hero ocupa el viewport, lo demás fluye
  (decisión 1a).

---

## 8. El plan de ráfagas

| | Qué hace | Entrada | Salida / barrera | Riesgo |
|---|---|---|---|---|
| **A · El vocabulario** | Los 2 tokens de hero en los 6 modelos, la escala de radio, `@keyframes brillo`, `--ritmo-bloques` y las constantes del hero, `--entrada-y`, la pareja de contraste como aviso. **Nadie los usa** | — | `globals-espejo` verde · `zonaSoloAjusta` verde · **las 50 capturas verdes sin regenerar** | **Bajo.** Es E0 otra vez |
| **B · Las redes** | Contenido editorial sembrado · portada determinista de medida · invariancia a 8 rutas · 3 capturas nuevas × 2 viewports | A | CI verde **con el aspecto de hoy** · el baseline es el «antes» | **Medio.** El riesgo es la estabilidad, no el aspecto: se resuelve quitando `listings` de la portada de medida |
| **C · El escaparate** | Hero a sangre · `HomeHeroBanda` compartido · hover unificado · brillo en los CTAs · el CTA de banda en los dos motores · los 24 bloques revestidos · el ritmo | B | Invariancia verde en las 3 superficies · **las 6 capturas rojas = el diff a Ernest** | **Medio-alto.** Es visual y toca 8 sitios del esquema del CTA |
| **D · El hero completo** | `heroHeight` + `heroEyebrow` (migración + 8 sitios) · `overlapHero` · la aritmética del viewport | C | CLS medido · preview usable · capturas regeneradas | **Alto.** Es la única que puede exigir volver atrás |

**Por qué no se combinan C y D.** Se podría —comparten el envoltorio— y **no conviene**: C es
revestir y D lleva **migración de base de datos** y un cambio de maquetación que puede no
gustar al verlo. Separarlas permite que el escaparate esté en pie y aprobado **antes** de
tocar una columna de Prisma, y que un «no me gusta la pantalla completa» no arrastre consigo
el resto del escaparate.

**Por qué A y B no se combinan tampoco.** Porque el baseline de B tiene que tomarse sobre un
estado que ya incluya A: si A moviera algo sin querer (no debería: §2.2 lo calibra a cero), se
vería como un rojo en las 50 capturas **existentes**, no escondido dentro de un baseline
nuevo.

---

## 9. Las decisiones que quedan

> Las 6 grandes están aprobadas. Estas cinco son de calibración y **no bloquean empezar la
> ráfaga A** salvo la 1 y la 2.

**1 · El ambiente de `premium@oscuro`.** Es la única versión de lienzo invertido. Opciones:
(a) el mismo degradado con alfas más altos sobre el carbón; (b) un ambiente distinto, más
sobrio, que apenas se separe del lienzo; (c) plano, como Modelo 0. *Recomendación: (b) — en un
tema oscuro, un degradado del primario navy sobre carbón añade suciedad, no profundidad.*
**Hace falta antes de cerrar A.**

**2 · Los factores del radio.** `×1.5 / ×2 / ×3` (recomendado — los tres caen **exactos** en
Modelo 0, §2.2) frente a los `×2.2 / ×2.4 / ×2.6` de la propuesta (mueven píxeles y exigen
`calc()` a mano fuera de las utilidades). **Hace falta antes de cerrar A.**

**3 · Qué animación lleva cada bloque.** La propuesta anima entradas en el hero (eyebrow,
subtítulo) y **nada más** en la dirección A. *Recomendación: ésa exactamente — entradas sólo en
el hero, hover en las tarjetas, brillo en los dos CTAs. Nada en los bloques de contenido.* Un
bloque de texto que entra deslizándose es ruido en una página que se viene a leer.

**4 · Los dos eyebrows.** Conservar los dos campos con un aviso en el editor (recomendado),
o migrar el del bloque `search` al hero.

**5 · La pareja `primary` sobre lienzo.** Añadirla como **aviso** en la ráfaga A (recomendado:
pone el número delante sin convertir en 422 un guardado legítimo de hoy), o dejarla sin medir
hasta que se ataque el §12 del eje de versión.

---

## 10. Riesgos, y cómo se apagan

| Riesgo | Cómo se apaga |
|---|---|
| **Una captura parpadea** y la batería se muere por desconfianza | La portada de medida **no lleva `listings`** (§3.2). `preparar()` ya apaga movimiento, fuentes y carga diferida. `retries: 0` es deliberado: si parpadea, se arregla la fuente, no el contador |
| **La ráfaga A mueve un píxel sin querer** | Los factores del radio caen exactos y Modelo 0 tiene ambiente plano y patrón `none`. Las 50 capturas con `threshold: 0` lo cazarían |
| **El hero a pantalla completa se ve vacío** | Decisión 2: eyebrow + buscador montado. Y D es la última ráfaga precisamente para poder no hacerla |
| **El botón de la banda es ilegible en algún modelo** | `--primary-foreground` sobre `--primary`: la garantía es una pareja **que ya bloquea** (§4.4) |
| **Un modelo empieza a tener un `if`** | La invariancia, ahora sobre las tres superficies, se pone roja |
| **La pintura del patrón cuesta en móvil** | Se mide antes de cerrar D. Si cuesta, el patrón puede quedar en `md:` — que es **la regla 3 literal**, el mismo encierro del sprite del póster |
| **El preview miente** | `HomeHeroBanda` compartido, en la misma ráfaga en que la banda cambia |

---

## 11. Lo verificado en esta sesión

| Fichero | Qué se comprobó |
|---|---|
| `estilo.constants.ts` | `resolverTokens` mezcla `ejes` por versión (2758) y los emite (2787); `zonaSoloAjusta` (2862-2880); `parejasBloqueantes`/`parejasDeAviso` (2904-3002) — **`primary` sobre `background` no se mide**; `PREMIUM_LOGIN_INVERTIDO` (1844) da **1,85:1** para el marino sobre carbón; `RAMPA_PREMIUM_OSCURO` (1802-1818) usa el mismo carbón como lienzo base |
| `globals-espejo.spec.ts` | Exige cada `eje` en `globals.css`; la comprobación inversa **sólo** persigue nombres semánticos (73) |
| `lib/estilo-css.ts` | `VALOR_SEGURO` admite degradados y patrones; **descarta comillas en silencio** |
| `tailwind.config.ts` | `borderRadius` sólo `lg/md/sm`; `xl/2xl/3xl` de fábrica (12/16/24 px) — los factores 1.5/2/3 caen exactos |
| `globals.css` | `entrada-suave`, `hero-rot-*`, `sprite-play`, los dos bloques de `reduced-motion`; **no existe `brillo`** |
| `e2e/estilo-invariancia.spec.ts` | 5 rutas públicas + 1 de backoffice; el segundo test mide **sólo `/planes`** |
| `e2e-snapshots/pantallas.spec.ts` + `preparar.ts` + `playwright.snapshots.config.ts` | 50 capturas, ninguna de las 3 superficies; **job de CI propio**; `threshold: 0`; viewports 1280×720 y móvil; el criterio «por idioma visual, no por rutas»; la deuda de la portada escrita en el propio fichero (60-65) |
| `e2e/helpers/portada.ts` | `PORTADA_SEMILLA` + `restaurarPortada` — el patrón de «pon la tuya y restaura» ya existe; la portada sembrada **incluye `listings`** |
| `prisma/seed-test.ts` | Siembra categorías, ajustes, portada, packs y planes — **ni un `Post` ni una `PAGE`** |
| `prisma/schema.prisma` | `HomepageConfig` (3577-3610): los campos del hero son **columnas**, no `Json` → `heroEyebrow`/`heroHeight` necesitan **migración**; `Post.blocks` es `Json` → el CTA de banda **no** |
| `homepage.service.ts` / `update-homepage.dto.ts` | Dónde se normalizan y se mapean los 4 campos del hero |
| `blog/dto/blocks/cta-block.dto.ts` + `homepage/dto/blocks/cta-block.dto.ts` | Dos clases gemelas e independientes, con el porqué escrito |
| `CtaHomeBlockEditor.tsx` | La forma de un editor de bloque: campos, validación de cliente, `data-testid` |
| `lib/api/homepage.ts` | `FALLBACK_HOMEPAGE_CONFIG` y el `unstable_cache` con tag `homepage-config` |
| `SearchBar.tsx:222` | El botón `Buscar` ya va a `h-14 md:h-16 rounded-xl` — **segunda altura de CTA grande** |
| `Header.tsx`, `(public)/layout.tsx`, `(home)/page.tsx`, `PortadaPreview.tsx`, `HomeHero.tsx` | La aritmética del viewport y **la banda escrita dos veces** |

---

### Una línea de cierre

El escaparate entra en **cuatro ráfagas y cuatro nodos nuevos**, y lo único que hay que
respetar para que quepa ya está escrito en el repositorio: **las redes se extienden antes de
repintar**, la estructura nueva la pintan los cinco modelos por igual, y el sabor lo pone el
token. La pieza que más se ha ganado en este diseño es la más pequeña: el botón de la banda va
en `--primary-foreground`, no en `--background`, y con eso **la garantía de contraste de la
pieza más visible del escaparate no hay que construirla — ya estaba pagada**.
