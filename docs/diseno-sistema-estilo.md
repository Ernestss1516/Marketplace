# Diseño — Sistema de estilo (modelos, versiones y tokens)

> **Qué es este documento.** La arquitectura concreta y el plan de ráfagas del sistema de
> modelos, sobre el marco aprobado en
> [`auditoria-sistema-estilo.md §12`](auditoria-sistema-estilo.md). **Documento, cero
> código. No implementa nada.**
>
> **Las 7 decisiones son el marco: este diseño las desarrolla, no las reabre.**
> **La excepción es la #3 (correos)**: el §7 desarrolla el mecanismo y **vuelve a
> Ernest** para que apruebe cruzar la invariante de seguridad. Hasta que la apruebe, los
> correos siguen en texto plano y la ráfaga E8 no existe.
>
> Todo dato del estado actual está verificado contra los ficheros en esta sesión.

---

## 0. El marco aprobado, en una tabla

| # | Decisión | Consecuencia de diseño |
|---|---|---|
| **1** | **Frontera:** un modelo reviste, nunca reorganiza. Aplicar un modelo **no edita ningún `.tsx`**. Prueba mecánica: dos modelos → **HTML idéntico**. Densidad inviolable, escala tipográfica fija, **modo oscuro fuera de v1** | §1, §2, §3, §10.4 |
| **2** | **Atributos:** 4 configurables (`primary`, `secondary`, `accent`, `neutral`). Semánticos **fijos por modelo**. Mismo set para todos | §3.3 |
| **3** | **Correos:** desarrollar el mecanismo B y **volver a Ernest** ⚠ | **§7** |
| **4** | **Backoffice:** sub-tema, sobriedad **restando**. Decidir la zona de `/admin/login` | §5 |
| **5** | **Ilustraciones:** registro cerrado + defaults del modelo + sustitución del admin. v1: vacíos + confirmaciones | §8 |
| **6** | **Iconos:** A (lucide temado). B documentada, no construida. **No se tocan los 185 ficheros** | §9 |
| **7** | **Verificación:** snapshots de Playwright + **E0 primero** | §10, §12 |

---

## 1. La arquitectura, de arriba abajo

```
   ┌─ CAPA 4 · CONFIG ────────────────────────────────────────────────┐
   │  Setting, por instancia y por zona.                              │
   │  modelo@versión + 4 colores + ilustraciones sustituidas          │
   │  ESCRITO POR: el admin, desde /admin/estilo                      │
   └────────────────────────────┬─────────────────────────────────────┘
                                │ resuelto EN SERVIDOR, en el layout raíz
   ┌─ CAPA 3 · MODELO ──────────▼─────────────────────────────────────┐
   │  Definido EN CÓDIGO. Registro de modelos y versiones.            │
   │  Aporta: tipografía, vocabulario de animación, radius, sombras,  │
   │  semánticos, defaults de ilustración, reglas de derivación       │
   └────────────────────────────┬─────────────────────────────────────┘
                                │ un <style> con las variables resueltas
   ┌─ CAPA 2 · TOKENS ──────────▼─────────────────────────────────────┐
   │  Variables CSS. T1 configurable · T2 del modelo · T3 estructural │
   │  ◄──────────── LA FRONTERA DEL §2 VIVE AQUÍ ────────────►        │
   └────────────────────────────┬─────────────────────────────────────┘
                                │ Tailwind ya las consume: hsl(var(--x))
   ┌─ CAPA 1 · COMPONENTES ─────▼─────────────────────────────────────┐
   │  Los 19 de ui/ + los 159 de features.                            │
   │  NO SE ENTERAN DE QUE EXISTEN MODELOS. No cambian nunca.         │
   └──────────────────────────────────────────────────────────────────┘
```

**La propiedad que hay que preservar por encima de todo** es la última línea. Es lo que
hace que añadir el modelo nº 7 no toque ningún componente, que el riesgo no crezca con el
número de modelos, y que la regla de oro de la decisión #1 sea cierta y no aspiracional.

**Y ya es cierta a medias hoy**, lo cual es el activo del que parte todo: los 19
componentes de [`components/ui/`](../apps/web/src/components/ui/) son 100 % tokens
(verificado en [button.tsx](../apps/web/src/components/ui/button.tsx) y
[badge.tsx](../apps/web/src/components/ui/badge.tsx)), y
[tailwind.config.ts](../apps/web/tailwind.config.ts) ya consume las 17 variables de
[globals.css](../apps/web/src/app/globals.css) vía `hsl(var(--token))`.

---

## 2. Modelos y versiones

### 2.1 Qué es cada cosa

**MODELO** = una personalidad completa. Se define **en código**, y aporta todo lo que el
admin *no* elige: familia tipográfica, vocabulario de animación (duraciones, curvas,
intensidad por zona), radius y sombras, los colores semánticos, los defaults de
ilustración y **las reglas de derivación** que convierten los 4 colores del admin en la
paleta completa.

**VERSIÓN** = una revisión del mismo modelo. Existe para poder corregir o evolucionar un
modelo **sin cambiar bajo los pies de las instancias que ya lo usan**.

> **Por qué versiones y no «editar el modelo».** Es el mismo razonamiento que hizo que
> las claves de logo lleven nombre aleatorio y no `logo-public.png`
> ([branding.constants.ts:94-102](../apps/api/src/modules/branding/branding.constants.ts#L94-L102)):
> sin versión, mejorar el Modelo 3 repinta **en silencio** todas las instancias que lo
> usan, sin que nadie lo haya pedido y sin vuelta atrás.

**Una instancia está fijada a `modelo@versión`.** Se mueve por **acto explícito del
admin**, nunca por despliegue. Desplegar una versión nueva **no cambia ninguna instancia**;
solo la pone disponible.

### 2.2 Dónde vive el registro

**En código, y compartido entre `apps/api` y `apps/web`.** Esto no es una preferencia:
son dos procesos que tienen que estar de acuerdo sobre qué modelos existen. El backend
valida que el modelo+versión que el admin elige existe; el frontend resuelve sus valores
para pintar. **Si la lista viviera solo en uno, añadir un modelo dejaría al otro
desincronizado en silencio** — que es literalmente la lección escrita en
[`branding.constants.ts:1-13`](../apps/api/src/modules/branding/branding.constants.ts#L1-L13)
sobre por qué `LOGO_ZONES` vive en un fichero puro que importan los dos que no se conocen
entre sí.

**El modelo no se edita por UI, y es deliberado** (decisión #1 + #2):

- Un modelo trae **assets** (fuentes, ilustraciones) que se despliegan con la aplicación.
- Ernest ya fijó la cadencia: «los iremos añadiendo» — despliegue, no formulario.
- Un editor visual de temas abre la puerta a que un admin cree un tema **inaccesible**
  sin barrera. Con modelos en código, el contraste se verifica **una vez, en CI**
  (§10.5), no en cada guardado.

### 2.3 Qué declara un modelo

| Bloque | Contenido | Nivel de token |
|---|---|---|
| **Identidad** | Identificador, nombre visible, descripción, versiones disponibles | — |
| **Tipografía** | Familia sans y familia de titulares; pesos; `letter-spacing`. **Nunca tamaños** | T2 |
| **Forma** | `--radius` base, escala de sombras | T2 |
| **Semánticos** | Error, éxito, aviso, informativo (+ sus `-foreground`) | T2 |
| **Derivación** | Cómo salen `background`, `card`, `popover`, `muted`, `border`, `input`, `ring` de los 4 colores del admin | T2 |
| **Animación** | Duraciones, curvas e **intensidad por zona** (§6) | T2 |
| **Ilustraciones** | Un asset por slot del registro (§8) | — |
| **Iconos** | Grosor, tamaño base y color de trazo (decisión #6: lucide temado) | T2 |

**Lo que un modelo NO declara nunca:** espaciado, breakpoints, escala tipográfica,
alturas de cabecera, anchos de contenedor, densidad. Eso es T3 (§3.2) y es de nadie.

### 2.4 MODELO 0

**Una sola versión. Es la plataforma de hoy, exactamente.**

Sus 4 colores por defecto son **los valores actuales de `globals.css`**
(`--primary: 221.2 83.2% 53.3%`, `--secondary: 210 40% 96.1%`, `--accent: 210 40% 96.1%`,
y el neutral que hoy está implícito en la escala de `--background`/`--muted`/`--border`).
Su tipografía es Inter local. Sus semánticos son los que hoy usan los componentes. Su
animación es la mínima que ya existe.

> **Modelo 0 no es «un tema sobrio que se parece al actual». Es el actual, y esa
> identidad es el criterio de aceptación de E0** (§10.2). Si un snapshot cambia con
> Modelo 0 activo, es un bug de migración: se revierte, no se justifica.

---

## 3. La capa de tokens

### 3.1 Qué se conserva y qué se añade

**Se conservan los 17 nombres de shadcn y `--radius`, sin renombrar ninguno.** Es medio
refactor ahorrado: los 19 componentes de `ui/` no se tocan en toda la migración.

Se añaden dos cosas:

**(a) Los ejes que hoy no son token.**

| Token nuevo | Qué resuelve | Estado hoy |
|---|---|---|
| `--font-sans` | La fuente base | Es `inter.className` en `<body>`, **no una variable** ([layout.tsx:57](../apps/web/src/app/layout.tsx#L57)) |
| `--font-heading` | La fuente de titulares | No existe |
| `--shadow-*` | Escala de elevación | No existe (Tailwind por defecto) |
| `--motion-duration`, `--motion-ease`, `--motion-scale` | El vocabulario de animación, ajustable por zona | No existe |
| `--icon-stroke`, `--icon-size` | Iconos temados (decisión #6) | No existe |

> **El cambio de `inter.className` a `variable: '--font-sans'` tiene una restricción
> heredada que no es negociable:** las fuentes de los modelos futuros **se sirven desde el
> repo con `next/font/local`, nunca de Google**. `next/font/google` descarga en tiempo de
> build, y cuando el runner no alcanza `fonts.gstatic.com` **el build entero se pone
> rojo** — ya mordió una vez y por eso Inter está en el repo
> ([fonts/README.md](../apps/web/src/app/fonts/README.md),
> [layout.tsx:8-37](../apps/web/src/app/layout.tsx#L8-L37)). Y `display: 'swap'` más las
> métricas de fallback se mantienen: son el mecanismo anti-CLS.

**(b) Una capa semántica encima de los 17.** Es lo que absorbe la dispersión: el banner
amarillo deja de ser `yellow-50` y pasa a ser «superficie de aviso». Se detalla en §4.

### 3.2 Los tres niveles — la frontera, hecha estructura

| Nivel | Quién decide | Ejemplos | Cambia con… |
|---|---|---|---|
| **T1 · Configurable** | El **admin** de la instancia | `primary`, `secondary`, `accent`, `neutral` | la config |
| **T2 · Del modelo** | El **modelo** (código) | Tipografía, radius, sombras, semánticos, animación, iconos, superficies derivadas | el modelo |
| **T3 · Estructural** | **Nadie** | Espaciado, breakpoints, escala tipográfica, densidad, alturas, anchos | **nunca** |

> **T3 debe existir como capa nombrada aunque su valor no cambie jamás.** Es lo que
> impide que dentro de un año alguien meta «solo por esta vez» un espaciado dentro de un
> modelo. La frontera de la decisión #1 se hace cumplir **aquí**, en la forma de los
> datos, no en la revisión de código.

### 3.3 Los 4 colores y su derivación

El admin aporta 4 valores. **Nunca aporta un `-foreground`.** Cada pareja de contraste la
**deriva el modelo y la valida el backend** contra AA (§10.5): si la combinación no
alcanza 4.5:1 (texto) o 3:1 (interfaz), el guardado se rechaza con 422.

> **Por qué el admin no elige los `-foreground`:** porque es exactamente la palanca con la
> que se rompe la accesibilidad sin darse cuenta. Elegir «azul de marca» es una decisión
> de marca; elegir qué color de texto va encima es una decisión de contraste, y esa la
> toma la máquina.

Los **semánticos son fijos por modelo** (decisión #2). Que «error» sea rojo no es marca:
es una convención que el usuario ya conoce, y dejarla configurable es invitar a que una
instancia pinte los errores de verde.

### 3.4 Cómo llegan los tokens al navegador

**Requisito duro: el tema tiene que estar en el HTML de la primera respuesta.** Si llegara
por JavaScript de cliente habría un instante con los colores por defecto y luego un
repintado — un salto visible y probablemente CLS, que la frontera prohíbe (§6).

**Mecanismo: un `<style>` con las variables resueltas, emitido por el layout raíz
(Server Component), que redefine las custom properties en `:root` y en cada ámbito de
zona.**

El molde está probado en este repo:
[`(admin)/layout.tsx`](../apps/web/src/app/(admin)/layout.tsx) ya resuelve los logos en el
layout de servidor «sin petición desde el navegador, sin estado *cargando* y sin un
instante en que la cabecera esté vacía». El tema hace lo mismo, con
[`unstable_cache`](../apps/web/src/lib/api/branding.ts) + tag, `revalidate: 3600` como red
y no como vía principal, y `.catch(() => null)` → **Modelo 0**.

Tres notas de implementación que hay que respetar:

1. **El `<style>` va antes que el CSS de Tailwind en el orden de cascada**, o los valores
   de `globals.css` ganarían. Alternativa equivalente: los valores por defecto dejan de
   estar en `globals.css` y solo existen en el registro del Modelo 0.
2. **Hoy no hay CSP** (verificado: no hay `Content-Security-Policy` en `next.config.ts`
   ni en `middleware.ts`). Si se añadiera, este `<style>` necesita `nonce`. Queda anotado
   para que no se descubra el día del despliegue.
3. **Los `NEXT_PUBLIC_*` no sirven para esto.** Se incrustan al construir, no al arrancar
   ([image-domains.ts](../apps/web/src/lib/image-domains.ts)), y el norte es
   multi-instancia: el tema tiene que venir de la base, no del bundle.

---

## 4. La consolidación de la dispersión (el corazón de E0)

Medido en esta sesión: **381 usos de escala directa en 83 de 378 ficheros, y cero hex
arbitrarios.** Pero no son 381 decisiones. Son, sobre todo, **dos idiomas copiados**.

### 4.1 El banner de aviso: 29 copias byte a byte

La cadena exacta

```
rounded border border-yellow-300 bg-yellow-50 p-4 text-yellow-800
```

aparece **29 veces idéntica**, más 5 variantes cercanas (`rounded-lg`, `border-yellow-200`,
`text-yellow-900`, con o sin `flex items-start gap-3`). En total **~34 apariciones y ~99
de los 381 usos**, y **30 de los 33 ficheros están en `(admin)`**.

Una de ellas está incluso en
[`/admin/marca`](../apps/web/src/app/(admin)/admin/marca/page.tsx), el molde que este
diseño extiende.

**Tratamiento:** un componente de aviso con variantes semánticas (`warning`, `info`,
`success`, `danger`) que consume tokens. Las 5 variantes cercanas se **unifican a la
forma dominante** — y esa es la única diferencia visual permitida en E0, porque afecta a
5 apariciones cuya divergencia es un accidente de copia, no una decisión. **Se declara
explícitamente y se acepta en los snapshots como cambio esperado, o se conservan las 5
variantes como props.** Es una de las dos únicas excepciones a «E0 no cambia nada»
(§10.2).

### 4.2 El resto

| Familia | Usos | Destino |
|---|---|---|
| `amber` | 128 | Dos cosas distintas: **avisos** → token semántico; **estrellas de valoración** (`fill-amber-400`) → token propio (`--rating`), porque una estrella dorada es convención, no aviso |
| `yellow` | 105 | El banner (§4.1) |
| `green` | 54 | Token `success` |
| `blue` | 28 | Token `info` |
| `red` | 23 | `destructive`, que **ya existe** |
| `slate` | 22 | Casi todo `/admin/login` (§5.3) |
| `gray`/`purple`/`emerald`/`orange` | 21 | Cola larga, caso a caso |

**Los ficheros de 1-5 usos son retoques mecánicos.** Los cinco con más carga
(`admin/reportes` 14, `admin/login` 10, `ReporteDiana` 8, `admin/ajustes` 8,
`MyListingCard` 5) se hacen uno a uno con su snapshot delante.

> ⚠ **CORRECCIÓN TRAS EJECUTAR E2 — esta tabla daba por consolidable algo que no lo es.**
>
> «`green` → token `success`, `blue` → token `info`, `red` → `destructive`» sólo funciona
> si cada familia se usa con UN valor. Medido: no es el caso. Tras E0 y E2 quedan
> **274 usos repartidos en 58 pares (familia, tono) distintos, con una repetición máxima
> de 4**. Esto no es el banner ×29: es variedad real.
>
> Y `red → destructive` es directamente imposible sin cambiar píxeles: `--destructive`
> resuelve a `red-500`, mientras los usos son `red-50/300/400/600/700/800/900/950`.
>
> **Lo que E2 sí migró** (30 usos, cambio nulo verificado a tolerancia cero) fue lo que
> era semántico Y de valor único: las convenciones (`--rating`, `--featured`,
> `--favorite`), el badge de estado —el único idioma repetido con valores consistentes,
> en tres ficheros— y el enlace de `ReporteDiana`, que divergía de un `text-primary` que
> ya era el idioma en otros ocho sitios.
>
> **LOS 274 RESTANTES SON TRABAJO DE E4, Y NO POR PEREZA DE E2.** Reducir 58 valores a
> los tokens de un modelo exige decidir que «superficie de aviso» es UN color y no
> `amber-50` **y** `yellow-50` a la vez. Eso cambia píxeles, o sea que es una decisión de
> ASPECTO — exactamente lo que un modelo hace y lo que una ráfaga de «nada cambia» tiene
> prohibido. E4 los absorbe al definir la semántica del Modelo 0: **fijar esos valores es
> parte de escribir el modelo, no un residuo pendiente de limpiar antes de empezar.**
>
> Quien llegue a E4 no debe dar la dispersión por cerrada. Está inventariada, no resuelta.

### 4.3 Lo que NO se toca en E0

Los **9 ficheros con `style={{…}}`** se quedan como están, y hay que declararlo para que
nadie los «arregle»:

- [`opengraph-image.tsx`](<../apps/web/src/app/(public)/anuncio/[slug]/opengraph-image.tsx>) —
  Satori genera una **imagen**, no una página: no hay variables CSS que leer.
- [`global-error.tsx`](../apps/web/src/app/global-error.tsx) — se pinta cuando el CSS de la
  app puede no haber cargado. **El estilo inline es la garantía, no la deuda.**
- `progress.tsx`, `HomeHero.tsx` (`--rot-ms`, `--i`), `VideoHoverPreview` (`--sprite`) —
  geometría y datos por fila, no color.
- `StepVideo`, `VideoUploadField`, `MapCards`, `ReviewsSection` — media y mapa.

**Los dos primeros son frontera declarada del sistema** y su tratamiento se decide en la
ráfaga E5, no se descubre: o reciben los colores resueltos por otra vía (escritos como
literales en servidor) o se quedan deliberadamente neutrales. **Si no se decide, la
imagen OG de una instancia saldrá con los colores de otra.**

---

## 5. La diferenciación por zona

### 5.1 Las zonas ya existen — no se inventan

Verificado: `LOGO_ZONES = ['public', 'backoffice', 'blog']`
([branding.constants.ts:18](../apps/api/src/modules/branding/branding.constants.ts#L18)),
con `resolveBrand(zone, logos)` y `esRutaDeBlog(pathname)` en
[brand.ts](../apps/web/src/lib/brand.ts). **Son exactamente las tres del encargo.**

Y hay un segundo anclaje ya construido: los **grupos de rutas del App Router**
(`(public)`, `(auth)`, `(account)`, `(admin)`, `(public)/blog`), **cada uno con su
`layout.tsx`** — 15 en total.

**Mecanismo: un atributo de zona en el contenedor de cada layout de grupo, y las
variables se redefinen dentro de ese ámbito.** Es el mismo movimiento que `.dark`, que
shadcn ya probó en este repo (§1.5 de la auditoría) — con la diferencia de que `.dark`
está muerto y esto sí se usará.

> **`esRutaDeBlog()` se conserva y se reusa tal cual**, incluida su cicatriz: detección
> **por segmento y no por prefijo**, para que `/blogueros` no herede la zona del blog.

### 5.2 Un solo sistema, tres afinaciones

**Regla dura: un sub-tema de zona solo puede AJUSTAR tokens existentes. Nunca añadir los
suyos.** Si el backoffice necesitara un token que el resto no tiene, eso sería un segundo
sistema de estilo — y lo mejor del estado actual es que **hoy no existe**: el shell de
`(admin)` usa los mismos `bg-background`, `bg-muted/30` y `border` que el resto
(verificado; solo 7 utilidades grises directas en todo `(admin)`).

| Zona | Qué ajusta | Animación (§6) |
|---|---|---|
| **Público** | La personalidad completa del modelo | Según el modelo |
| **Blog** | Tipografía de cuerpo, medida de línea, tono de superficie. Tiñe `prose` de `@tailwindcss/typography`; **el Markdown no se toca jamás** | Reducida |
| **Backoffice** | **Resta** (decisión #4): saturación al mínimo, contraste alto, densidad estable | **Mínima** |
| **Cuenta** | Como público, algo más sobrio | Reducida |

**La sobriedad del backoffice se consigue restando, no con un tema paralelo.** Es
literalmente lo que la decisión #4 aprobó y lo que el estado actual permite.

### 5.3 `/admin/login` — la decisión pendiente de la #4

[`app/admin/login/page.tsx`](../apps/web/src/app/admin/login/page.tsx) está **fuera del
grupo `(admin)`** y es **la única pantalla oscura del proyecto**: 10 utilidades `slate-*`
escritas a mano (`bg-slate-950`, `bg-slate-900`, `border-slate-800`, `text-slate-100`,
`focus:ring-slate-500`…).

Si el ámbito de zona se ancla en los layouts de grupo, **esta pantalla se queda sin
zona**. Tres salidas:

| | Qué implica |
|---|---|
| **A · Zona `backoffice`** | Pierde el oscuro (el backoffice es claro). Coherente, pero cambia la pantalla → **rompe «E0 idéntico»** |
| **B · Zona propia `login`** ⭐ | Los dos logins comparten zona de impacto (§6). Conserva el oscuro en E0 y le da sitio a las animaciones espectaculares que la regla 5 permite |
| **C · Fuera del sistema** | Se queda literal para siempre. Barato, pero es una pantalla de marca que ninguna instancia podría personalizar |

**Recomendación: B.** Es la única que respeta E0 y a la vez cumple la jerarquía: los
logins son zona de impacto por decisión de Ernest, y merecen un ámbito propio. Los 22
`slate-*` se convierten en tokens de esa zona en E5, no en E0.

---

## 6. La jerarquía rendimiento / impacto

### 6.1 El reparto

| | **ZONA DE IMPACTO** | **ZONA DE RENDIMIENTO** |
|---|---|---|
| Dónde | Hero de portada, CTAs principales, login de usuario, login de backoffice | **Todo lo demás** |
| Puntos de anclaje reales | [`HomeHero.tsx`](../apps/web/src/components/home/HomeHero.tsx), [`CtaButton.tsx`](../apps/web/src/components/shared/CtaButton.tsx) (compartido por los motores de portada y blog), los dos logins | Los 159 componentes restantes |
| Se permite | Animación elaborada, entradas escalonadas, ilustración grande, fondos con efecto | Transiciones de color y micro-feedback |
| Regla | Puede no maximizar el rendimiento | **Rendimiento y SEO mandan** |

**Por qué esa lista y no otra:** son superficies poco numerosas, de entrada y no
transaccionales. El hero se ve una vez por sesión; un listado se recorre cien veces. Y
las tres son sitios donde el usuario **está decidiendo**, no operando.

`CtaButton` es un hallazgo útil: **ya existe un CTA canónico compartido** (3 usos, usa
`<Button asChild variant size="lg">` con Slot de Radix). La zona de impacto de los CTAs
tiene un solo punto de entrada — no hay que ir a buscar botones por el repo.

### 6.2 Las cinco reglas — y dos ya están escritas en el repo

1. **CSS antes que JS siempre que se pueda.** La rotación del hero
   ([globals.css:61-185](../apps/web/src/app/globals.css#L61-L185)) es CSS puro: **0 KB de
   bundle en la ruta de más tráfico**, sobrevive sin hidratación y con el JS fallando.
   **Es la doctrina, y ya está escrita.**
2. **Ninguna animación puede causar CLS.** El hero lo resuelve con `inline-grid` (todas
   las opciones en la misma celda: la caja mide lo que la más ancha y no cambia al rotar).
   **Regla: solo se anima `transform` y `opacity`.** Nada que reflowee.
3. **El coste se paga donde se disfruta.** El sprite del póster
   ([globals.css:187-257](../apps/web/src/app/globals.css#L187-L257)) va encerrado en
   `@media (hover:hover) and (pointer:fine)`: **el móvil no lo paga nunca.** Cualquier
   animación de impacto que necesite JS o un asset pesado se carga **solo en su ruta**,
   jamás en el layout raíz.
4. **El LCP nunca se anima ni se retrasa.** El elemento más grande aparece en su sitio y a
   tiempo; la animación entra después o afecta a otros elementos.
5. **`prefers-reduced-motion` degrada a un estado COMPLETO, no mutilado.** El hero apagado
   muestra la primera opción — la misma frase que oye un lector de pantalla. El sprite
   apagado muestra el primer fotograma, que es una imagen válida. **Los tres modos
   degradados coinciden**, y eso es la doctrina, no una casualidad.

### 6.3 El fallo de `tailwindcss-animate` — se resuelve en E0

**Verificado en esta sesión:** el paquete **no está en
[`apps/web/package.json`](../apps/web/package.json), no está en los `plugins` de
`tailwind.config.ts` (solo `@tailwindcss/typography`) y no está en `node_modules`.** Pero
**6 ficheros usan sus clases**: `dialog.tsx`, `alert-dialog.tsx`, `dropdown-menu.tsx`,
`select.tsx`, `AdminMobileNav.tsx`, `AccountMobileBar.tsx`. Por ejemplo
[`dialog.tsx:41`](../apps/web/src/components/ui/dialog.tsx#L41) declara `animate-in`,
`zoom-in-95`, `slide-in-from-top-[48%]`, `fade-out-0`… **Ninguna genera CSS.** Los
diálogos, dropdowns y selects aparecen y desaparecen **en seco, hoy, en producción.**

**Este diseño decide: se QUITAN las clases muertas, no se instala el plugin.**

Los motivos, en orden:

1. **Instalarlo cambia la interfaz.** Ahora mismo no hay animación; instalarlo la
   añadiría en 6 componentes de golpe. **Eso rompe la barrera «E0 idéntico»** en la
   ráfaga cuyo único propósito es demostrar que nada cambió.
2. **Las animaciones de overlay son competencia del modelo** (§2.3, bloque *Animación*).
   Instalar un plugin que las fija por fuera del sistema es meter una decisión de aspecto
   donde el sistema aún no manda.
3. **Quitarlas es literalmente un cambio nulo**: son clases que no producen CSS. El
   snapshot no se mueve **ni un píxel**, y eso es comprobable.

**La animación de overlays vuelve en E6, como parte del vocabulario del modelo**, con su
duración y su curva salidas de `--motion-*` y su intensidad ajustada por zona (mínima en
backoffice). Queda registrado como deuda con destino, no como deuda a secas.

---

## 7. ⚠ LOS CORREOS — la sub-pregunta que vuelve a Ernest

> **Esto NO está aprobado.** La decisión #3 encargó desarrollar el mecanismo **para que
> Ernest decida**. Hasta que lo apruebe, los correos siguen en texto plano y la ráfaga E8
> no se planifica.

### 7.1 La invariante que hay que cruzar

Verificado: **Resend**, **18 tipos de envío**, todos por **un único método `enviar()`**
([notification.processor.ts:179-191](../apps/api/src/infra/queue/processors/notification.processor.ts#L179-L191)),
que manda **`text:`** y **nunca `html:`**. Y es una regla declarada, no un descuido
([:293-296](../apps/api/src/infra/queue/processors/notification.processor.ts#L293-L296)):

> «`text:` plano, nunca `html:` — la regla invariante de este processor. Aquí importa
> especialmente: el asunto y el extracto de un ticket los escribe un usuario cualquiera, y
> los lee un agente con sesión. **Nunca se genera HTML a partir de contenido no confiable,
> así que no hace falta sanitizado.**»

**El contenido de usuario que hoy entra en los correos** (verificado en
[notification.types.ts](../apps/api/src/infra/queue/notification.types.ts)): `name`,
`subject`, `extracto` (≤140), `motivo`, `cuerpo`, títulos de anuncio y nombres de alerta.
Casi todos escritos por un usuario cualquiera; `cuerpo` y `motivo`, por un admin.

### 7.2 El mecanismo propuesto: el contenido de usuario **no puede** ser HTML

La forma ingenua de hacer esto —añadir un campo `html` a `enviar()` y que cada uno de los
18 métodos componga su cadena— **es exactamente lo que no se debe hacer**: convierte una
invariante en dieciocho oportunidades de olvidarla.

**La propuesta invierte quién compone.** Hoy los 18 métodos componen la cadena de texto y
`enviar()` solo la despacha. En la propuesta, **los 18 métodos dejan de componer nada:
entregan datos estructurados, y `enviar()` es el único que construye el correo.**

Un correo pasa a describirse como una **secuencia de piezas tipadas**: un saludo, uno o
varios párrafos, una **cita** (el extracto), un **botón** (etiqueta + URL), un aviso, un
cierre. Cada pieza lleva **texto plano en sus campos**.

**La garantía es de tipos, no de disciplina:**

> **No existe ninguna pieza que acepte HTML.** Un método que quisiera inyectar marcado no
> tendría dónde ponerlo: el tipo no lo admite. Y en el único punto donde el texto se
> convierte en HTML —el serializador de `enviar()`— **cada campo de texto se escapa,
> siempre, por construcción**, porque el serializador no distingue entre campos
> «confiables» y «no confiables»: **los trata todos igual.**

Esto es más fuerte que «acuérdate de escapar». Es **«no puedes expresar HTML sin
escapar»**. Y es exactamente la misma propiedad que hoy hace que el pie de baja no se
pueda olvidar en ninguno de los 18 envíos
([:165-178](../apps/api/src/infra/queue/processors/notification.processor.ts#L165-L178)):
*el único sitio que manda un correo.*

**Decisión asociada: se escapa también lo que escribe un admin** (`cuerpo`, `motivo`). No
porque el admin sea la amenaza, sino porque una cuenta de admin comprometida sí lo es, y
**el escapado cuesta cero**. Un serializador con excepciones es un serializador que
alguien acabará usando mal.

### 7.3 Qué HTML exactamente

Los clientes de correo no soportan variables CSS: **el tema se resuelve a valores
literales en el servidor y se escribe inline**. Es una segunda vía de renderizado del
mismo tema, inevitable.

- **Tablas para la estructura.** Sin flexbox ni grid: Outlook de escritorio en Windows
  usa el motor de Word.
- **Estilos inline**, no `<style>` en `<head>` (Gmail lo recorta de forma inconsistente).
- **Un marco mínimo:** cabecera con el logo público de la instancia (el que ya sirve
  `BrandingService`), cuerpo, un botón de acción, pie con el aviso de baja **que ya
  existe**.
- **Del tema llegan solo `primary`, `neutral` y el logo.** La tipografía **no**: no hay
  fuentes personalizadas fiables en correo, así que se cae a una pila de respaldo. **La
  personalidad del modelo en el correo será siempre parcial, y hay que decirlo.**
- **Sin imágenes de fondo, sin `border-radius` crítico, sin SVG.** Todo lo que un cliente
  ignore debe degradar a algo legible.
- **Peso por debajo de ~100 KB** (Gmail recorta alrededor de 102 KB).

**Cobertura razonable:** Gmail (web, iOS, Android), Apple Mail, Outlook 365 y web, Yahoo,
ProtonMail. **Outlook de escritorio en Windows degrada** a un marco sin esquinas
redondeadas — legible, no idéntico. **El modo oscuro de los clientes reinvierte colores de
forma impredecible**, y no se puede controlar: se elige una paleta que sobreviva a la
inversión.

### 7.4 Las dos condiciones innegociables

1. **La parte `text:` se mantiene SIEMPRE**, en todos los envíos, junto al HTML.
   Entregabilidad, accesibilidad y clientes que no pintan HTML. No es un respaldo: es la
   mitad del correo.
2. **Los correos críticos se quedan sobrios**: verificación de cuenta, restablecimiento de
   contraseña y moderación de cuenta. **Un correo de restablecimiento muy adornado se
   parece a una suplantación**, y ahí la marca juega en contra.

### 7.5 La barrera: cómo se comprueba que la invariante sigue en pie

Tres pruebas, y la primera es la que Ernest debe exigir:

| Prueba | Qué afirma |
|---|---|
| **1 · Escapado exhaustivo** | Un payload con `<script>alert(1)</script>`, `<`, `>`, `&`, `"` y `'` **en cada campo de usuario de los 18 tipos** produce un HTML donde esos caracteres salen como **entidades**, y donde **no aparece ninguna etiqueta nueva**. Se ejecuta sobre los 18, no sobre una muestra |
| **2 · Ausencia de vía de escape** | Ninguno de los 18 métodos puede entregar marcado: se comprueba que **`enviar()` es el único que serializa HTML** y que ninguna pieza acepta un campo crudo |
| **3 · Doble parte** | Todo envío lleva `text:` **además** de `html:`. Un correo solo-HTML es un fallo de test |

**La invariante no se elimina: se traslada.** Pasa de *«nunca hay HTML»* a *«el HTML se
compone en un solo sitio, y todo dato entra escapado, siempre»* — verificable por máquina
y que ningún desarrollador futuro pueda rodear sin que el test se ponga rojo.

### 7.6 Lo que Ernest tiene que aprobar

> **¿Se cruza la invariante con este mecanismo y estas tres pruebas, o los correos se
> quedan en texto plano?**

**Lo que se gana:** los correos dejan de ser la única superficie sin marca. Logo, color
primario y un botón reconocible — que es lo que hace que un correo parezca de la
plataforma y no de un servidor cualquiera.

**Lo que se paga, dicho sin adornos:**
- Se sustituye una garantía **absoluta** («no hay HTML, punto») por una **garantía
  fuerte y verificada** («el HTML se compone en un sitio y todo va escapado»).
- Trabajo real de pruebas en varios clientes de correo, que no se puede automatizar del
  todo.
- La personalidad del modelo llegará **parcial** al correo, siempre.

**Si Ernest dice que no**, este §7 se archiva, la ráfaga E8 desaparece del plan y **no
pasa nada más**: el resto del sistema no depende de esta decisión en ningún punto.

---

## 8. Las ilustraciones

### 8.1 El principio

> **La ilustración es un asset intercambiable. El hueco donde va, no.**

Un modelo cambia **qué imagen** ocupa el slot «favoritos vacío». No decide si esa pantalla
tiene ilustración, dónde va, ni qué texto la acompaña. Eso es estructura.

### 8.2 El registro cerrado (decisión #5)

**En código, compartido entre back y front**, molde literal de `LOGO_ZONES` y **por el
motivo escrito allí**: quien sube la imagen y quien la pinta no se conocen entre sí, y si
la lista viviera dentro de uno, añadir un slot dejaría al otro desincronizado en
silencio.

Cada slot declara: **identificador estable**, descripción (para que el admin sepa qué está
cambiando), proporción recomendada y **texto alternativo por defecto**.

> **El `alt` por defecto va en el registro y no lo escribe el admin.** La accesibilidad no
> puede depender de que alguien rellene un campo. Si el admin quiere afinarlo, puede; si
> no, hay uno correcto.

**Familias de v1** (decisión #5 — errores y transversales en 2ª pasada):

| Familia | Slots previstos |
|---|---|
| **Estados vacíos** | `empty-favorites`, `empty-my-listings`, `empty-search`, `empty-messages`, `empty-tickets`, `empty-notifications` |
| **Confirmaciones** | `success-payment`, `success-review`, `success-listing-published`, `success-ticket-sent` |

**Cada slot tiene siempre valor**: si el admin no sustituye nada, se sirve el default del
modelo activo. **Nunca un hueco.** Es la misma doctrina de «degrada, nunca rompe» que
`BrandingService` aplica cuando no hay filas.

### 8.3 Cómo se sirven — molde de logos, sin desviarse

Todo lo que hace [`BrandingService`](../apps/api/src/modules/branding/branding.service.ts),
y por los mismos motivos ya escritos allí:

- **R2/MinIO con clave aleatoria** (para que el navegador no sirva la anterior de su caché
  y para que la limpieza pueda distinguirlas).
- **Subida = guardado**, un solo POST: no hay ventana en la que el objeto exista sin dueño,
  así que no hay nada que caducar.
- **Ajuste + `AuditLog` en la misma transacción**, con **compensación** (se borra el
  objeto) si la fila no se escribe.
- **Limpieza del anterior encolada, nunca en línea**, y **nunca puede tumbar la
  operación**.
- **`revalidateTag`** al terminar.
- **Límite de peso propio**, validado en el servidor. El molde es `LOGO_MAX_BYTES = 1 MB`,
  que es 1 MB **precisamente porque un logo se sirve en todas las páginas**. Una
  ilustración se sirve en una pantalla: puede ser mayor, pero el número lo fija el
  dominio, no el criterio de quien sube.

### 8.4 Rendimiento y SEO

- **`next/image` siempre, con dimensiones explícitas → cero CLS.**
- **`loading="lazy"` por defecto.** Una ilustración de estado vacío está por definición
  bajo el pliegue o en una pantalla poco frecuente.
- **`priority` solo si es el LCP**, y solo en zona de impacto.
- **`alt` obligatorio**, del registro si el admin no lo da. Decorativa → `alt=""`
  **declarado**, no ausente.
- **SVG solo del admin y pintado con `<img>`, nunca incrustado en el DOM** — el
  razonamiento de tres puntos ya escrito en
  [`branding.constants.ts:44-65`](../apps/api/src/modules/branding/branding.constants.ts#L44-L65)
  se hereda entero.

⚠ **Tres avisos que ya han mordido en este proyecto** y que aplican igual:

1. **`S3_PUBLIC_URL` y `NEXT_PUBLIC_MEDIA_URL` deben apuntar al mismo sitio y fijarse
   ANTES de la primera subida.** La URL pública se construye al subir y **se guarda entera
   en la base**. Es el episodio `localhost:9000` → `127.0.0.1:9000` de `CLAUDE.md`, que ya
   ha pasado tres veces.
2. **`remotePatterns` se deriva de la variable de entorno**
   ([image-domains.ts](../apps/web/src/lib/image-domains.ts)): las ilustraciones van por el
   mismo origen que el resto de medios. Servirlas de otro sitio exige actualizar esa lista
   o `next/image` las rechaza **con la red funcionando**.
3. **`NEXT_PUBLIC_*` se incrusta al construir, no al arrancar.**

---

## 9. Los iconos

**Decisión #6: A.** Se usa el set actual —`lucide-react`, verificado en **185 ficheros**—
y **no se toca ninguno de los 185**.

Lo que el modelo tema son **propiedades del icono, no su identidad**: grosor de trazo
(`--icon-stroke`), tamaño base (`--icon-size`) y color, que ya hereda de `currentColor` y
por tanto del token de texto. Es mucha personalidad por cero riesgo: **no cambia la caja
óptica**, así que no mueve una sola celda.

**La puerta B queda documentada y sin construir.** Si algún día se quiere un set por
modelo, el contrato tendría que ser **estricto**:

- una capa de indirección (un registro `nombre → componente`) del que importen los 185;
- todo set alternativo **cubre el 100 % de los nombres del registro** — uno incompleto
  dejaría huecos silenciosos;
- y **respeta la caja óptica** — métricas distintas mueven el layout, y eso cruza la
  frontera de la decisión #1.

**C (set libre por modelo) sigue descartada** por ese último punto: no cabe dentro de la
frontera sin romperla.

---

## 10. La verificación visual, dimensionada

### 10.1 El presupuesto real de CI — el dato que manda

Verificado en [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) y
[`playwright.config.ts`](../apps/web/playwright.config.ts):

| Concepto | Medido |
|---|---|
| Límite del job E2E | **60 min** |
| Batería backend (Jest, `--runInBand`) | ~4,5 min |
| `next build` de producción | ~1 min |
| **Playwright: 271 tests, 1 worker** | **~45 min (~10 s/test)** |
| **Margen restante** | **≈ 5-8 min** |

Y dos restricciones que **no son palancas**:

- **`workers: 1` es un requisito, no una configuración pendiente de subir.** Las specs
  comparten una sola base, un índice de Meili y una base de Redis; **nueve specs mutan
  estado global**. Paralelizar sin aislar cambiaría cuelgues por rojos aleatorios.
- **`fullyParallel: false`**, `retries: 1`, y **un solo proyecto (`chromium`, Desktop
  Chrome)**.

> **Conclusión de dimensionado: los snapshots NO caben en el job actual.** Con ~10 s por
> test, 30 snapshots × 2 viewports son ~10 minutos: más que todo el margen. Meterlos ahí
> es volver a la situación que ya canceló el job sin veredicto una vez.

### 10.2 La propuesta: un job propio, no una ampliación del existente

**Un segundo job de CI, en paralelo, con sus propios contenedores de servicio.**

No es una idea nueva: **es exactamente la vía que el propio workflow ya propone** para
bajar el reloj (`ci.yml`, comentario del `timeout-minutes`): repartir en shards como jobs
de matriz, «cada job trae sus propios contenedores de servicio, así que cada shard tendría
SU base/Redis/Meili y el estado compartido que hoy obliga a `workers: 1` dejaría de ser un
problema».

**El job de snapshots es el caso más fácil de esa idea**, porque:

- **no muta estado**: solo navega y captura;
- **no necesita el wizard, ni Meilisearch caliente, ni esperas de indexación** — que es de
  dónde salen los ~10 s/test de la batería funcional;
- **puede reusar `global-setup` tal cual**: siembra idempotente de categorías y usuarios,
  `storageState` por rol y **un solo token de admin**, ya construidos;
- corre **en paralelo** con el job E2E: **no alarga el reloj de la señal**.

**Coste estimado por snapshot: 2-4 s** (navegación + captura, sin flujo). Con ~50
capturas: **~3 min de test**, más arranque de servicios y build. El job entra
holgadamente por debajo de 20 min.

### 10.3 Cuántas pantallas — la muestra

**No las 81. Cobertura por IDIOMA VISUAL, no por ruta.** ~25 pantallas × 2 viewports ≈ 50
capturas.

| Zona | Pantallas | Por qué |
|---|---|---|
| **Pública** | Portada, búsqueda (lista), ficha de anuncio, categoría, vendedor, blog listado, blog post | El SEO y el tráfico |
| **Impacto** | Hero aislado, login de usuario, login de admin, un CTA | Zona de impacto (§6) |
| **Cuenta** | Mis anuncios, mensajes, perfil, favoritos | Los estados con datos |
| **Backoffice** | Tabla (anuncios), formulario (ajustes), cola de moderación, marca | Los idiomas del backoffice |
| **Estados** | Vacío, cargando, error, 404 | Donde irán las ilustraciones |
| **Componentes** | Diálogo abierto, dropdown abierto, toast, banner de aviso | Los overlays de §6.3 y el banner de §4.1 |

**Cada una en escritorio (1280) y móvil (375).** El responsive es inviolable y hay
cicatrices concretas que proteger: `hidden md:block` del aside y `min-w-0` del `<main>` en
[`(admin)/layout.tsx`](../apps/web/src/app/(admin)/layout.tsx).

> **El móvil no necesita un proyecto nuevo de Playwright.** El patrón ya existe en 6 specs:
> `test.use({ viewport: { width: 375, height: 667 } })`
> ([`nav-backoffice.spec.ts:133`](../apps/web/e2e/nav-backoffice.spec.ts#L133),
> [`shell-cuenta.spec.ts:106`](../apps/web/e2e/shell-cuenta.spec.ts#L106)) y
> `page.setViewportSize()` en otras cuatro. Se reusa.

> ⚠ **CORRECCIÓN TRAS EJECUTAR E0 — tres pantallas de esta tabla no eran capturables.**
>
> Portada, búsqueda y listado de blog entraron en el catálogo y hubo que sacarlas, con la
> medición delante: la portada esperaba 4311 px de alto y devolvía 1339 en dos corridas
> seguidas, y búsqueda devolvió **1027 px en una corrida y 990 en la siguiente con el mismo
> árbol de fuentes**. Dos alturas distintas del mismo código no es una regresión: es que la
> pantalla no es determinista.
>
> La causa no la cubría el §10.4 y conviene añadirla a su lista: esas tres páginas pintan
> **estado global mutable que otras specs escriben** — la portada monta
> `HomeBlockRenderer` con los bloques de `HomepageConfig`, que las specs de
> `/admin/portada` reescriben; los listados salen del índice de Meilisearch, que unas
> specs llenan y el teardown vacía; los artículos del blog los crean las specs de blog.
>
> **Vuelven cuando la batería fije ese estado antes de disparar** (escribir un
> `HomepageConfig` conocido y sembrar un conjunto fijo de anuncios ya indexados). No entró
> en E0 porque es infraestructura que no se compromete sin medirla, y porque no deja sin
> vigilar nada de lo que E0 cambió: los 29 avisos están todos en el backoffice, cubierto
> entero, y las clases muertas en los overlays, que tienen captura propia.
>
> **Una cuarta cayó por otro motivo, y su lección corrige el §10.4.** `/admin/ajustes`
> pinta 49 marcas «Actualizado: …», una por ajuste, cuyo texto cambia cada vez que se
> escribe uno. A 1280 px eso sólo mueve unos dígitos; a **375 px un carácter de más
> reajusta el salto de línea de una fila y desplaza la página entera 24 px**, con lo que
> el 7 % de los píxeles difiere.
>
> De ahí sale un matiz que el §10.4 daba por resuelto: **enmascarar no basta**. La máscara
> se pinta DESPUÉS del maquetado, así que tapa el texto variable pero no el
> desplazamiento que ese texto provoca. Cuando el dato variable puede cambiar el salto de
> línea, la única salida es no fotografiar esa pantalla o fotografiar otra del mismo
> idioma visual. Se cambió por `/admin/facturas/emisor` — mismo idioma (etiquetas, campos,
> guardar), cero fechas.
>
> **Y un aviso de método, porque costó caro:** esa captura falló dos veces seguidas con un
> cambio en el árbol y pasó dos veces sin él. Parecía causalidad concluyente y no lo era —
> con el mismo código volvió a medir la altura del baseline. Lo que lo delató fue que dos
> corridas idénticas dieran 608394 y 608550 píxeles distintos. **Ante una captura
> sospechosa, la primera pregunta no es «¿qué cambié?» sino «¿mide lo mismo dos veces?»**
>
> El catálogo real de E0 quedó en **24 pantallas y 49 capturas**, dentro del orden de
> magnitud que esta sección planificaba.

### 10.4 Estabilidad de los snapshots — lo que hay que congelar

Un snapshot inestable es peor que ninguno: enseña a ignorar el rojo.

| Fuente de ruido | Cómo se apaga |
|---|---|
| **Animación** (156 `animate-spin`, 22 `animate-pulse`, el hero, el sprite) | `prefers-reduced-motion` forzado + animaciones deshabilitadas en la captura |
| **Datos variables** (fechas, contadores, orden de Meili) | Siembra fija de `global-setup` + enmascarar las regiones con fecha/hora |
| **Fuentes** | Inter es **local** — ya es determinista, y por eso el CI no depende de la red aquí |
| **Imágenes remotas** (R2/MinIO) | Assets fijos del seed |
| **Scroll y lazy loading** | Captura de página completa con espera de imágenes |

**Tolerancia calibrada, no cero.** El antialiasing varía entre plataformas; los snapshots
se generan **en el runner de CI**, no en la máquina de nadie, y esa es la referencia.

### 10.5 Las otras dos capas

**Capa de contraste (automática, por modelo).** Cada modelo+versión, con cada combinación
válida de los 4 colores, se verifica contra AA (4.5:1 texto, 3:1 interfaz) **en CI**. Y el
mismo cálculo vive en el DTO del backend: un guardado que no cumple **se rechaza con 422**
(§3.3). Es barato —aritmética de color, sin navegador— y cierra la puerta a que una
instancia se vuelva ilegible.

**Capa de invariancia del HTML — la que convierte la decisión #1 en un test.**

> Se carga la **misma ruta** con **dos modelos distintos** y se compara el **árbol DOM**,
> ignorando por completo atributos de estilo y clases. **Si difiere en algo más que en
> estilo, el modelo reorganizó en lugar de revestir, y el test se pone rojo.**

Es, probablemente, la pieza más valiosa de este diseño: **hace la frontera cumplible por
máquina en vez de por disciplina.** Y es barata: dos navegaciones y una comparación de
estructura, sin captura de imagen.

Requiere que exista un **segundo modelo de prueba** — no uno de producto, sino uno
deliberadamente extremo (colores opuestos, otra tipografía, otro radius) cuyo único
propósito es que este test tenga con qué comparar. Se crea en E6.

### 10.6 Riesgos residuales

| Riesgo | Mitigación |
|---|---|
| Los snapshots se vuelven ruidosos y la gente los ignora | §10.4 + tolerancia calibrada + **el job no bloquea hasta que se demuestre estable** |
| El catálogo no cubre una pantalla y ahí se cuela la regresión | Cobertura por idioma visual; se amplía cuando aparece un idioma nuevo |
| Un modelo cumple AA pero es feo o ilegible | **Ninguna automatización sustituye la revisión humana** de cada modelo antes de publicarlo |
| El job de snapshots duplica el consumo de CI | Corre en paralelo; se puede limitar a cambios que toquen estilo |

---

## 11. La pantalla de admin

**`/admin/estilo`, grupo `plataforma`, `minRole: 'ADMIN'`**, junto a `marca` e
`instancia`.

**Añadirla es tocar un solo fichero.** Verificado:
[`config/backoffice-sections.ts`](../apps/web/src/config/backoffice-sections.ts) es hoy la
**fuente única** — el middleware y `AdminNav` derivan de ahí. El acoplamiento de tres
listas (con su divergencia real: `/admin/motivos-contacto` existía y no aparecía en el
nav) **ya se cerró**. Solo queda añadir los `@Roles`/`@MinRole` del controlador nuevo, que
es la autorización real y sigue viviendo en el backend a propósito.

**Molde: [`/admin/marca`](../apps/web/src/app/(admin)/admin/marca/page.tsx)**, y se
heredan sus dos decisiones de forma:

1. **Una tarjeta por zona** (público, backoffice, blog), como las tres de marca.
2. **Sin botón de «Guardar»** para lo que es una operación completa en servidor: cada
   cambio sube, escribe el ajuste, limpia lo anterior y revalida. «Un botón de guardar
   solo podría mentir sobre cuándo pasan las cosas.» **Excepción: los 4 colores sí
   necesitan confirmación explícita** — se eligen juntos, se previsualizan juntos y se
   validan juntos contra AA. Guardar en cada tecleo dispararía una validación por
   pulsación y repintaría el sitio con estados intermedios.

**Qué ofrece la pantalla:**

| Sección | Contenido |
|---|---|
| **Modelo** | Selector de modelo + versión, con descripción y **previsualización** |
| **Colores** | Los 4 (`primary`, `secondary`, `accent`, `neutral`), con **el contraste calculado y mostrado en vivo**, y guardado bloqueado si no cumple AA |
| **Por zona** | Las tres tarjetas: qué ajusta cada zona sobre el modelo base |
| **Ilustraciones** | Los slots del registro, con el default del modelo y el botón de sustituir |

**La previsualización es lo que hace la pantalla honesta.** Cambiar el tema afecta a las
81 pantallas: elegir a ciegas y descubrirlo navegando es exactamente el error que este
sistema debería impedir. Mínimo viable: los componentes representativos —un botón de cada
variante, una tarjeta, un banner de aviso, un campo con error— pintados con la selección
en curso, **igual que `ZonaDeMarca` previsualiza el logo con la cabecera de verdad**.

---

## 12. El plan de ráfagas

**El principio que lo ordena: separar lo invisible de lo nuevo.** Mover a tokens es
invisible y verificable por comparación → primero, con red. El sistema de modelos es una
feature visible → después, sobre terreno verificado. Mezclarlos hace el refactor
irrevisable, porque cualquier diferencia se puede justificar como «será el tema nuevo».

| Ráfaga | Contenido | Visible | Tamaño |
|---|---|---|---|
| **E0** | **LA RED.** Job de snapshots propio (§10.2), ~25 pantallas × 2 viewports, congelado de ruido (§10.4). **Sin tocar una sola línea de estilo.** El job informa, no bloquea, hasta demostrarse estable | ❌ | M |
| **E1** | **EL BANNER + EL PLUGIN MUERTO.** El componente de aviso (29 copias idénticas + 5 variantes, ~99 usos). **Quitar las clases de `tailwindcss-animate`** (§6.3). Los dos son cambio nulo en snapshot | ❌ | M |
| **E2** | **LA COLA LARGA.** Los ~280 usos restantes → tokens semánticos, empezando por los 5 ficheros con más carga. Mecánico, snapshot delante | ❌ | L |
| **E3** | **LOS EJES NUEVOS.** `--font-sans`/`--font-heading` (Inter a variable), `--shadow-*`, `--motion-*`, `--icon-*`. **Capa T3 nombrada.** Valores idénticos a los actuales | ❌ | M |
| | **━━ BARRERA: MODELO 0 IDÉNTICO. Escritorio y móvil. ━━** | | |
| **E4** | **EL SISTEMA.** Registro de modelos+versiones (solo Modelo 0), `Setting` propio fuera del PATCH genérico, servicio con `AuditLog` + `revalidateTag`, DTO con validación AA, resolución en el layout raíz. **+ ABSORBE LOS 274 USOS DE ESCALA QUE QUEDAN** (58 valores distintos): reducirlos a los tokens del Modelo 0 cambia píxeles, así que es trabajo de modelo y no de refactor — ver el aviso del §4.2 | ❌ | XL |
| **E5** | **ZONAS Y ADMIN.** Ámbitos por zona sobre los layouts de grupo, `/admin/estilo` (§11), zona de `/admin/login` (§5.3), decisión sobre OG y `global-error` (§4.3) | ❌ | L |
| | **━━ BARRERA: el sistema funciona y NADA cambia visualmente ━━** | | |
| **E6** | **VERIFICACIÓN + MODELO DE PRUEBA.** Test de invariancia del HTML (§10.5), test de contraste en CI, modelo extremo de prueba. **Vuelve la animación de overlays**, ya como vocabulario del modelo | ❌ | M |
| **E7** | **ILUSTRACIONES.** Registro cerrado, subsistema R2, slots de v1, admin | ✅ | L |
| **E8** | **CORREOS.** ⚠ **Solo si Ernest aprueba el §7.** Si no, esta ráfaga no existe | ✅ | L |
| **E9+** | **MODELOS CON PERSONALIDAD.** Uno por ráfaga | ✅ | M c/u |

**E0-E3 es la fase segura.** Nada cambia visualmente y todo es verificable contra la red
de E0. **Es la mayor parte del trabajo, y es la parte sin riesgo de producto.**

**E4-E6 es el sistema con solo Modelo 0.** Punto de parada natural: el sistema entero en
producción, un único modelo idéntico a lo de hoy. **Si nada cambia visualmente, el sistema
funciona.** Se puede parar ahí indefinidamente sin haber roto nada.

> **E9+ no tiene número, y eso es la prueba de la arquitectura.** Si añadir el modelo nº 5
> obliga a tocar algo fuera de su propia definición, **la frontera se rompió en alguna
> ráfaga anterior** y hay que volver, no seguir.

---

## 13. Lo que vuelve a Ernest

### 13.1 ⚠ La aprobación pendiente — correos (decisión #3)

**¿Se cruza la invariante de texto plano, con el mecanismo del §7 y sus tres pruebas?**

- **El mecanismo:** los 18 métodos dejan de componer y entregan **datos tipados**;
  `enviar()` es el único que serializa; **ninguna pieza acepta HTML**, así que el
  contenido de usuario no puede expresarlo; **todo campo se escapa siempre**, incluido el
  del admin.
- **La garantía:** tres pruebas (§7.5), la principal sobre **los 18 tipos**, no sobre una
  muestra.
- **Lo que se paga:** una garantía absoluta pasa a ser una garantía fuerte y verificada;
  pruebas manuales en varios clientes; y la personalidad del modelo llegará **parcial** al
  correo, siempre.

**Si la respuesta es no, se archiva el §7, desaparece E8 y no cambia nada más del plan.**

### 13.2 Las dos decisiones menores que este diseño propone

| | Propuesta | Motivo |
|---|---|---|
| **Zona de `/admin/login`** (pendiente de #4) | **Zona propia `login`**, compartida con el login de usuario | Es la única que respeta «E0 idéntico» y a la vez le da sitio a las animaciones de impacto que la regla 5 permite |
| **`tailwindcss-animate`** | **Quitar las clases muertas, no instalar el plugin.** La animación de overlays vuelve en E6, ya como vocabulario del modelo | Instalarlo **añadiría** animación en 6 componentes justo en la ráfaga cuyo propósito es demostrar que nada cambió |

### 13.3 La confirmación de coste que conviene dar antes de empezar

**E0 propone un segundo job de CI con sus propios contenedores** (§10.2). Es la única
pieza de infraestructura nueva del plan, y se propone así porque **está medido que no
cabe en el job actual**: Playwright ya consume ~45 min de un presupuesto de 60, con
`workers: 1` que es un requisito y no una palanca.

Es además la vía que el propio workflow ya dejaba propuesta para el sharding. **Pero es
consumo de CI real y conviene confirmarlo, no asumirlo.**

---

## 14. Resumen de lo verificado en esta sesión

1. **17 tokens + `--radius`** en `globals.css`, consumidos por `tailwind.config.ts` vía
   `hsl(var(--x))`. Los 19 componentes de `ui/` son 100 % tokens.
2. **El banner amarillo son 29 copias byte a byte** de la misma cadena, más 5 variantes
   cercanas; **30 de los 33 ficheros están en `(admin)`**.
3. **`tailwindcss-animate` no está** en `package.json`, ni en los `plugins`, ni en
   `node_modules` — con **6 ficheros usando sus clases**.
4. **`LOGO_ZONES`, `resolveBrand()` y `esRutaDeBlog()`** son el molde de zonas, ya
   construido y con sus cicatrices documentadas.
5. **`enviar()` es el único punto de envío**, `text:` siempre, `html:` nunca, por
   invariante declarada; los campos de usuario son `name`, `subject`, `extracto`,
   `motivo`, `cuerpo`.
6. **CI: 60 min de límite; Playwright 271 tests / ~45 min / `workers: 1` obligatorio**;
   backend Jest ~4,5 min; build ~1 min. Un solo proyecto `chromium`; el patrón de viewport
   móvil ya existe en 6 specs. **Cero snapshots visuales hoy.**
7. **`backoffice-sections.ts` es fuente única** de nav y middleware: añadir
   `/admin/estilo` es un fichero.
8. **`/admin/marca`** es el molde de la pantalla: una tarjeta por zona, sin botón de
   guardar, repoblada con la respuesta del servidor.
9. **No hay CSP** hoy — el `<style>` del tema funciona; si se añade, necesitará `nonce`.
10. **`CtaButton`** es el CTA canónico compartido: la zona de impacto de los CTAs tiene un
    único punto de entrada.

**Nada de esto está implementado, y esa es la idea.** El §13.1 primero.
