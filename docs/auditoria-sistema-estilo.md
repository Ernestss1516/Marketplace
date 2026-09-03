# Auditoría — Sistema de estilo (modelos/temas configurables)

> **Qué es este documento.** Una medición del estado real de la capa de estilo y una
> **propuesta de arquitectura** para el sistema de modelos. **No implementa nada, no
> diseña la implementación y no decide por Ernest.** Todo lo del §1 está verificado
> contra los ficheros; lo del §3 en adelante es propuesta, y está marcado como tal.
>
> **La decisión #1 es el §2 — la frontera aspecto/estructura.** Sin ella, «un modelo
> cambia el estilo» es una frase ambigua en un sistema que toca las 81 pantallas. Todo
> lo demás cuelga de ahí.

---

## 0. El encargo, en una frase

Un sistema de **modelos** (temas completos: color, tipografía, iconos, animaciones,
ilustraciones), cada uno con **versiones**, configurable por admin, con **alcance total
incluidos los correos**, respetando al máximo la interfaz y los flujos existentes, con
**diferenciación sutil por zona** (blog / backoffice / resto) y una **jerarquía de
prioridad**: impacto visual en portada, CTAs y logins; rendimiento y SEO en todo lo
demás. El norte es **multi-instancia**: cada nicho, su configuración.

Los modelos se añadirán después. **Ahora se construye el sistema que los soporta.**

---

## 1. EL ESTADO ACTUAL (medido)

### 1.1 El titular: medio camino ya está hecho, y está bien hecho

**shadcn/Radix ya montó la capa de variables CSS.** No es una suposición: está en
[globals.css:5-50](../apps/web/src/app/globals.css#L5-L50) y en
[tailwind.config.ts:11-52](../apps/web/tailwind.config.ts#L11-L52).

`globals.css` declara **17 tokens de color + `--radius`** en `:root`, con su bloque
`.dark` espejo completo. `tailwind.config.ts` los consume vía `hsl(var(--token))`, de
modo que `bg-primary`, `text-muted-foreground` o `border-border` **ya son indirectas**,
no valores literales.

| Token | Pareja `-foreground` | Uso |
|---|---|---|
| `--background` | `--foreground` | Lienzo y texto base |
| `--card` | `--card-foreground` | Superficie elevada |
| `--popover` | `--popover-foreground` | Capas flotantes |
| `--primary` | `--primary-foreground` | Acción principal, marca |
| `--secondary` | `--secondary-foreground` | Acción secundaria |
| `--muted` | `--muted-foreground` | Fondo apagado, texto auxiliar |
| `--accent` | `--accent-foreground` | Hover, resalte |
| `--destructive` | `--destructive-foreground` | Borrado, error |
| `--border` / `--input` / `--ring` | — | Trazo, campo, foco |
| `--radius` | — | Redondeo base (`lg`/`md`/`sm` derivados por `calc()`) |

**Consecuencia directa para el encargo:** el mecanismo por el que un modelo repinta la
plataforma **ya existe y ya funciona**. Cambiar `--primary` en `:root` reviste hoy
mismo cada botón, cada badge, cada anillo de foco de las 81 pantallas. Lo que falta no
es el mecanismo: es **de dónde salen esos valores** (hoy, constantes escritas a mano) y
**los ejes que aún no son token** (tipografía, iconos, animación, ilustración).

### 1.2 Los componentes base: limpios al 100%

Los **19 componentes de [components/ui/](../apps/web/src/components/ui/)** son shadcn sin
contaminar. Verificado en
[button.tsx](../apps/web/src/components/ui/button.tsx) y
[badge.tsx](../apps/web/src/components/ui/badge.tsx): **todas** las variantes `cva`
referencian tokens (`bg-primary`, `text-primary-foreground`, `border-input`,
`ring-ring`, `bg-accent`…). **Cero colores literales.**

Esto importa mucho más de lo que parece: son la capa por la que pasa casi toda la
interfaz. Un modelo que solo reasignara los 17 tokens **ya se vería aplicado en botones,
badges, diálogos, selects, tablas, inputs, avatares, acordeones y toasts** sin tocar un
solo fichero de esos.

Inventario: `accordion`, `alert-dialog`, `avatar`, `badge`, `button`, `card`,
`checkbox`, `dialog`, `dropdown-menu`, `input`, `label`, `progress`, `radio-group`,
`select`, `separator`, `skeleton`, `sonner`, `table`, `textarea`.

### 1.3 La dispersión: pequeña, concentrada y de una sola forma

Es la medida que dimensiona el refactor, y sale **mucho mejor de lo esperable**.

| Métrica | Valor |
|---|---|
| Ficheros `.ts`/`.tsx` en `apps/web/src` | **378** |
| Componentes (sin tests) | **159** |
| Rutas `page.tsx` | **81** (16 públicas · 39 admin · 20 cuenta · 5 auth) |
| **Valores arbitrarios** (`bg-[#hex]`, `[rgba(...)]`) | **0** |
| **Escalas Tailwind directas** (`bg-amber-50`, `text-green-700`…) | **381 usos en 83 ficheros** |
| Ficheros con `style={{…}}` | **9** |

**Cero hex arbitrarios en 378 ficheros.** No hay un solo `bg-[#3b82f6]` en el repo. Eso
es disciplina real y elimina de golpe la categoría de problema más cara de un refactor
de estilo.

**Los 381 usos de escala directa no son 381 decisiones.** Desglose por familia:

| Familia | Usos | Qué es en realidad |
|---|---|---|
| `amber` | 128 | Avisos + estrellas de valoración (`fill-amber-400`) |
| `yellow` | 105 | **Un solo idioma repetido** (ver abajo) |
| `green` | 54 | Estado «correcto / activo» |
| `blue` | 28 | Informativo |
| `red` | 23 | Error (donde no se usó `destructive`) |
| `slate` | 22 | Casi todo del login de admin |
| `gray`, `purple`, `emerald`, `orange` | 21 | Cola larga |

Y el hallazgo que reduce el trabajo: **`bg-yellow-50` + `border-yellow-300` +
`text-yellow-800` aparece en 33 ficheros, 30 de ellos en `(admin)`**. Es **un banner de
aviso copiado 33 veces**, no 33 criterios distintos. Consolidarlo en un componente con
tokens semánticos cierra ~99 de los 381 usos de una vez.

**Top de ficheros por dispersión** (el resto tiene 1-2 usos):

| Fichero | Usos |
|---|---|
| [admin/reportes/page.tsx](../apps/web/src/app/(admin)/admin/reportes/page.tsx) | 14 |
| [admin/login/page.tsx](../apps/web/src/app/admin/login/page.tsx) | 10 |
| [ReporteDiana.tsx](../apps/web/src/components/admin/ReporteDiana.tsx) | 8 |
| [admin/ajustes/page.tsx](../apps/web/src/app/(admin)/admin/ajustes/page.tsx) | 8 |
| [MyListingCard.tsx](../apps/web/src/components/anuncios/MyListingCard.tsx) | 5 |

**Conclusión de dispersión: el refactor es de tamaño medio, no grande.** La deuda está
concentrada en el backoffice y tiene forma de idioma repetido. Los ficheros con 1-2 usos
(la mayoría) son retoques mecánicos.

Los **9 ficheros con `style={{…}}`** se reparten en tres grupos, y **ninguno es deuda**:

- **Entornos de render distintos**, donde las variables CSS no llegan y es correcto:
  [opengraph-image.tsx](<../apps/web/src/app/(public)/anuncio/[slug]/opengraph-image.tsx>)
  (Satori genera una imagen, no una página) y
  [global-error.tsx](../apps/web/src/app/global-error.tsx) (se pinta cuando el CSS de la
  app puede no haber cargado — el estilo inline es la garantía).
- **Geometría, no color**: `progress.tsx` (transform), `HomeHero.tsx`
  (`--rot-ms`/`--i`), `VideoHoverPreview` (`--sprite`).
- **Media y mapa**: `StepVideo`, `VideoUploadField`, `MapCards`, `ReviewsSection`.

> **Los dos primeros son frontera del sistema de temas y hay que declararlos como tal:
> la imagen OG y la pantalla de error catastrófico no pueden depender de tokens CSS.**
> Se abordan en el §7.4 y el §2.4.

### 1.4 El backoffice: **no tiene paleta propia** (corrección al supuesto)

El encargo parte de que el backoffice tiene «una paleta oscura propia». **Verificado: no
la tiene.** El shell de [(admin)/layout.tsx](../apps/web/src/app/(admin)/layout.tsx) usa
exactamente los mismos tokens que el resto del sitio: `bg-background`, `bg-muted/30`,
`border-b`, `border-r`, `text-muted-foreground`. En todo `(admin)` + `components/admin`
solo hay **7 utilidades** de escala gris directa.

La única superficie oscura del proyecto es **[/admin/login](../apps/web/src/app/admin/login/page.tsx)**,
que está **fuera del grupo `(admin)`** y se pinta con 10 utilidades `slate-*` a mano
(`bg-slate-950`, `bg-slate-900`, `border-slate-800`, `text-slate-100`…). Es una pantalla
suelta, no un tema.

**Esto es una buena noticia y hay que aprovecharla:** no hay un segundo sistema de estilo
que reconciliar. El backoffice ya es «el mismo tema»; lo que falta es darle la
**diferenciación sutil** que Ernest pide, que hoy no existe en absoluto.

### 1.5 El modo oscuro: declarado, conectado y **muerto**

- `darkMode: ['class']` en la config. ✅
- Bloque `.dark` completo en `globals.css`. ✅
- **Nadie pone jamás la clase `dark`.** No hay `next-themes` (el propio
  [sonner.tsx:21](../apps/web/src/components/ui/sonner.tsx#L21) lo dice: «hoy no hay
  `next-themes`»), no hay toggle, no hay lectura de `prefers-color-scheme`.
- Solo **12 utilidades `dark:` en 5 ficheros** — huérfanas.

**Es un hueco listo para usar.** El mecanismo de «reasignar todos los tokens bajo un
selector» ya está probado por shadcn en este mismo repo. Un modelo es, técnicamente, el
mismo movimiento que `.dark`.

> **Decisión pendiente (§12):** el modo oscuro, ¿es un eje independiente (cada modelo con
> su variante clara y oscura) o queda fuera de alcance? Duplica la superficie de
> verificación visual.

### 1.6 Tipografía: una fuente, y **no expuesta como token**

[layout.tsx:38-43](../apps/web/src/app/layout.tsx#L38-L43): Inter variable, subset latin,
`weight: '100 900'`, `display: 'swap'`, servida **desde el repo** con `next/font/local`
(decisión deliberada — `next/font/google` descargaba en build y rompía el CI).

**El detalle que importa:** se aplica como `<body className={inter.className}>`. Es una
clase, **no una variable CSS**. Hoy no existe `--font-sans` ni `--font-heading`.

**Implicación:** «cada modelo con su tipografía» exige (a) pasar a `variable:
'--font-sans'` en el cargador, (b) declarar los ejes tipográficos como tokens, y (c) que
las fuentes de los modelos futuros se sirvan **desde el repo, no de Google** — o se
reintroduce exactamente el fallo de CI que ya se cerró una vez. Está documentado en
[fonts/README.md](../apps/web/src/app/fonts/README.md) y es una restricción heredada, no
negociable.

### 1.7 Iconos: 185 ficheros, sin capa de indirección

`lucide-react` importado en **185 ficheros**, ~180 puntos de importación directa. **No
hay ninguna capa intermedia**: cada componente importa `<Trash2/>`, `<Star/>`, `<Check/>`
de la librería.

**Es el eje más caro del encargo, con diferencia.** «Cada modelo con sus iconos»
significa hoy tocar 185 ficheros, o introducir una indirección. La familia tipográfica
se cambia en un sitio; el set de iconos, no. Se desarrolla en el §3.5 y es una de las
decisiones del §12.

### 1.8 Animaciones: casi ninguna, y **un plugin ausente**

Uso real de `animate-*`:

| Clase | Usos | Qué es |
|---|---|---|
| `animate-spin` | 156 | Spinners de carga |
| `animate-pulse` | 22 | Skeletons |
| `animate-in` / `animate-out` | 11 / 11 | **Ver abajo** |
| `animate-accordion-up/down` | 2 | Los únicos keyframes de `tailwind.config.ts` |

Transiciones: 77 `transition-colors`, 8 `transition-transform`, 6 `transition-all`,
5 `transition-opacity`, 4 `transition-shadow`.

**Traducción: la plataforma hoy no tiene personalidad animada.** `spin` y `pulse` son
estados de carga, no marca. El terreno del §3.4 está **vacío**, lo cual es bueno: no hay
nada que desmontar.

Lo que sí existe son **dos sistemas escritos a mano en `globals.css`, y los dos son
ejemplares** — son el molde de cómo debe animar este proyecto:

1. **Rotación del hero** ([globals.css:61-185](../apps/web/src/app/globals.css#L61-L185)) —
   CSS puro, **0 KB de JS** en la ruta de más tráfico, sobrevive sin hidratación,
   sin salto de layout (`inline-grid`, todas las opciones en la misma celda), y con
   `prefers-reduced-motion` respetado degradando a un estado **completo, no mutilado**.
2. **Sprite del póster de vídeo** ([globals.css:187-257](../apps/web/src/app/globals.css#L187-L257)) —
   una imagen fija, la animación solo mueve la ventana; **no descarga vídeo por
   construcción**; encerrada en `@media (hover:hover) and (pointer:fine)` para que el
   móvil no la pague nunca, y con `prefers-reduced-motion` degradando al primer
   fotograma, que es una imagen válida por sí sola.

**Los dos ya cumplen la jerarquía del §6 antes de que exista.** El §3.4 debe
codificarlos como doctrina, no inventar otra.

#### 1.8.1 Defecto latente confirmado: `tailwindcss-animate` NO está instalado

- **No** está en [apps/web/package.json](../apps/web/package.json).
- **No** está en los `plugins` de `tailwind.config.ts` (solo `@tailwindcss/typography`).
- **No** está en `node_modules`.

Pero **6 ficheros usan sus clases**: `dialog.tsx`, `alert-dialog.tsx`,
`dropdown-menu.tsx`, `select.tsx`, `AdminMobileNav.tsx`, `AccountMobileBar.tsx`. Por
ejemplo [dialog.tsx:41](../apps/web/src/components/ui/dialog.tsx#L41) declara
`data-[state=open]:animate-in`, `zoom-in-95`, `slide-in-from-top-[48%]`, `fade-out-0`…

**Ninguna de esas clases genera CSS.** Los diálogos, dropdowns y selects aparecen y
desaparecen **en seco**, sin transición, hoy, en producción.

> **Este defecto es la mejor prueba disponible de por qué el §9 (verificación) es el
> riesgo central del encargo.** Es un fallo de estilo que lleva quién sabe cuánto tiempo
> en el repo, no rompe el build, no rompe ningún test de los 75 e2e, y solo se ve
> mirando. Exactamente la clase de error que un sistema de temas multiplica por el número
> de modelos.
>
> **No se arregla en esta auditoría** (es documento, cero código). Queda inventariado
> como entrada de la Ráfaga E1 del §11.

### 1.9 Los correos: **texto plano por invariante de seguridad**

Este es el hallazgo que más cambia el encargo.

- Proveedor: **Resend**
  ([notification.processor.ts](../apps/api/src/infra/queue/processors/notification.processor.ts)).
- **18 tipos de envío**, todos pasando por **un único método `enviar()`**
  ([:179-191](../apps/api/src/infra/queue/processors/notification.processor.ts#L179-L191)).
- Ese método manda **`text:`** y **nunca `html:`**.
- No es un descuido. Es una **regla invariante declarada**
  ([:293-296](../apps/api/src/infra/queue/processors/notification.processor.ts#L293-L296)):

  > «`text:` plano, nunca `html:` — la regla invariante de este processor. Aquí importa
  > especialmente: el asunto y el extracto de un ticket los escribe un usuario
  > cualquiera, y los lee un agente con sesión. **Nunca se genera HTML a partir de
  > contenido no confiable, así que no hace falta sanitizado.**»

**Las dos caras:**

- ✅ **El activo:** existe **un solo punto de estrangulamiento**. Cualquier cosa que se
  decida sobre correos se implementa en un método, no en dieciocho. La misma propiedad
  que hace que el pie de baja no se pueda olvidar hará que el tema no se pueda olvidar.
- ❌ **El obstáculo:** hoy **no hay absolutamente ninguna superficie de estilo en los
  correos**. «Alcance total incluidos correos» no es extender un tema existente: es
  **introducir HTML de email donde deliberadamente no lo hay**, cruzando una decisión de
  seguridad tomada a conciencia.

**Esta es la tensión más aguda del encargo y no se puede resolver por defecto.** Se
plantea con opciones en el §8 y es una decisión del §12.

### 1.10 El molde de branding: **ya trae las tres zonas de Ernest**

Es el hallazgo más afortunado. El sistema de logos ya resolvió, para las imágenes,
exactamente el problema que el sistema de modelos tiene que resolver para el estilo.

**Backend** ([branding.constants.ts](../apps/api/src/modules/branding/branding.constants.ts),
[branding.service.ts](../apps/api/src/modules/branding/branding.service.ts)):

- `LOGO_ZONES = ['public', 'backoffice', 'blog']` — **las tres zonas del encargo, ya
  nombradas en el código.**
- Tres filas de `Setting` (`logoPublicUrl`, `logoBackofficeUrl`, `logoBlogUrl`).
- Assets en R2 con **clave aleatoria** (para que el navegador no sirva el anterior de
  caché y para que la limpieza pueda distinguirlos).
- Escritura transaccional **ajuste + `AuditLog` juntos**; compensación (borra el objeto)
  si la fila no se escribe.
- Limpieza del asset anterior **encolada**, nunca en línea, y **nunca puede tumbar la
  operación**.
- `revalidateTag(BRANDING_CACHE_TAG)` al terminar.
- **Deliberadamente FUERA del whitelist de `PATCH /admin/settings/:key`**, con el motivo
  escrito: el PATCH genérico aceptaría cualquier cadena, no limpiaría el objeto anterior
  y no revalidaría.
- **Degrada, nunca rompe:** sin filas devuelve los tres a `null`, que es el estado
  legítimo de una instancia recién desplegada.

**Frontend** ([brand.ts](../apps/web/src/lib/brand.ts)):

- `resolveBrand(zone, logos)` con **cadena de respaldo** (`backoffice → public → texto`).
- `esRutaDeBlog(pathname)` — **detección de zona por segmento, no por prefijo**, con la
  cicatriz documentada (`/blogueros` no debe heredar el logo del blog).
- `unstable_cache` con tag, resuelto **en el layout de servidor** para que la cabecera
  nunca esté vacía.

**El sistema de modelos debe ser este mismo molde, extendido.** No hay que inventar el
mecanismo multi-instancia: hay que reusarlo. Es la recomendación más firme de esta
auditoría.

### 1.11 Configuración por instancia: el whitelist de `Setting`

[admin.service.ts:183-349](../apps/api/src/modules/admin/admin.service.ts#L183-L349):
~35 claves con guardas tipadas (`POSITIVE_INT_SETTING_KEYS`, `PERCENT_SETTING_KEYS`,
`ENUM_SETTING_VALUES`). Doctrina consistente y visible: **«sin fila» es un estado válido
y explícito** con default en código, y las claves peligrosas quedan fuera del PATCH
genérico.

Existen ya pantallas de administración de instancia
([/admin/instancia](../apps/web/src/app/(admin)/admin/instancia/page.tsx): nombre,
descripción, dominio, remitente, moneda, IVA…) y de marca
([/admin/marca](../apps/web/src/app/(admin)/admin/marca/page.tsx): los tres logos por
zona). **El selector de modelo tiene sitio natural: `/admin/marca`.**

⚠ **Límite real del norte multi-instancia:** `SITE_NAME` sigue siendo una **constante de
build** ([config/index.ts](../apps/web/src/config/index.ts)). El propio `brand.ts` lo
señala. No lo resuelve esta auditoría, pero el sistema de modelos **no debe agravarlo**:
nada del tema puede acabar en constantes de build.

### 1.12 Verificación visual: **no existe**

- **75 specs de Playwright**, todas funcionales.
- **0** `toHaveScreenshot`, **0** `toMatchSnapshot`.
- Sin Percy, Chromatic ni Argos.

**No hay ninguna red que detecte una regresión visual.** El §1.8.1 demuestra que esa
ausencia ya tiene consecuencias. Es el vacío más peligroso del proyecto de cara a este
encargo, y es el §9.

### 1.13 Resumen del estado

| Eje | Estado | Trabajo |
|---|---|---|
| Tokens de color | 🟢 Montado (17 + radius), consumido por Tailwind | Renombrar/ampliar, alimentar desde config |
| Componentes `ui/` | 🟢 100% tokens | Ninguno |
| Dispersión | 🟡 381 usos / 83 ficheros, **0 hex**, muy concentrada | Medio, mecánico |
| Backoffice | 🟢 Mismos tokens (no hay 2º sistema) | Añadir diferenciación (no existe) |
| Modo oscuro | 🟡 Declarado y muerto | Decidir si es eje |
| Tipografía | 🟡 Inter local, **no es token** | Exponer como variable |
| Iconos | 🔴 185 ficheros, sin indirección | **El eje más caro** |
| Animaciones | 🟡 Vacío + 2 sistemas ejemplares + **plugin ausente** | Terreno libre; arreglar 1.8.1 |
| Ilustraciones | 🔴 No existe el subsistema | Construir (molde de logos) |
| Correos | 🔴 Texto plano **por invariante de seguridad** | Decisión de producto, no técnica |
| Branding multi-instancia | 🟢 Molde completo, **3 zonas ya** | Extender |
| Verificación visual | 🔴 Cero | **Construir antes de tocar nada** |

---

## 2. LA FRONTERA ASPECTO / ESTRUCTURA — la decisión #1

Aquí está el núcleo. Sin esto, todo lo demás es ambiguo.

### 2.1 El principio

> **Un modelo reviste. Nunca reorganiza.**
>
> Cambiar de modelo puede cambiar **cómo se ve** un elemento. No puede cambiar **qué
> elementos hay, qué hacen, en qué orden aparecen, qué dicen, ni cómo se colocan al
> cambiar de tamaño de pantalla.**

Formulado como prueba operativa:

> **La prueba del HTML.** Si cambiar de modelo altera el árbol del DOM, el texto, el
> orden de tabulación o los puntos de ruptura responsive → **eso no es un modelo, es un
> rediseño.**
>
> Corolario verificable: **dos modelos distintos deben producir HTML idéntico y diferir
> solo en CSS y en assets.** Es una barrera comprobable automáticamente (§9.3), no una
> declaración de intenciones.

### 2.2 Lo que un modelo SÍ puede cambiar (**ASPECTO**)

| Eje | Alcance |
|---|---|
| **Color** | Los valores de los tokens: marca, superficies, semánticos, trazo, foco |
| **Redondeo** | `--radius` y su escala derivada |
| **Sombra / elevación** | Profundidad de superficies |
| **Familia tipográfica** | Qué fuente (sans/heading/mono) — **no** el tamaño estructural |
| **Peso y `letter-spacing`** | Dentro de la escala fija |
| **Set de iconos** | Qué familia se sirve — **con reservas fuertes, §3.5** |
| **Animación** | Presencia, duración, curva, intensidad — **por zona, §6** |
| **Ilustraciones** | Qué imagen ocupa cada *slot* — **no** dónde ni si hay slot |
| **Texturas/fondos decorativos** | Detrás del contenido, sin afectar contraste |

### 2.3 Lo que un modelo NUNCA puede cambiar (**INVIOLABLE**)

**Esta lista es la que Ernest tiene que aprobar palabra por palabra.**

1. **El HTML y su semántica.** El árbol de elementos, las etiquetas (`<h1>`, `<nav>`,
   `<main>`, `<article>`, `<button>` vs `<a>`), los *landmarks*. Es lo que el SEO lee.
   El proyecto ya invierte en esto (JSON-LD, breadcrumbs, metadatos por ficha): un tema
   no puede erosionarlo.
2. **Los textos.** Todo el contenido de cara al usuario, en español. Un modelo no
   redacta.
3. **La estructura del layout y el responsive.** Rejillas, columnas, breakpoints,
   sidebar del backoffice a `md`, drawer en móvil, `min-w-0` contra el desbordamiento.
   **Escritorio y móvil quedan tal como están.** Las cicatrices de A3 y UXV.2
   ([(admin)/layout.tsx](../apps/web/src/app/(admin)/layout.tsx)) son ley.
4. **El espaciado estructural.** Padding de contenedor, gaps de rejilla, alturas de
   cabecera. *(Ver el matiz de «densidad» en §2.5 — es una decisión abierta.)*
5. **Los flujos y la navegación.** Pasos del wizard de publicar, máquina de estados de
   tickets, orden de la nav, qué pantalla lleva a cuál.
6. **La función y los estados de cada elemento.** Un botón deshabilitado se ve
   deshabilitado; un campo con error se ve con error; el foco es visible; hay estado de
   carga, vacío y de error. **Un modelo puede cambiar cómo se ve cada estado; jamás
   puede eliminar un estado ni volverlo indistinguible de otro.** (Regla 6 de Ernest.)
7. **La accesibilidad, como suelo duro y no negociable:**
   - **Contraste AA** (4.5:1 texto normal, 3:1 texto grande y elementos de interfaz)
     — **verificado sobre cada modelo+versión antes de que se pueda activar.**
   - **Foco siempre visible** — ningún modelo puede anular el anillo de foco.
   - **`prefers-reduced-motion` respetado**, con degradación a un estado **completo**,
     no mutilado (la doctrina ya escrita en el hero y el sprite, §1.8).
   - **Nombres accesibles intactos** — `resolveBrand` ya garantiza que la cabecera se
     llama igual haya logo o no; los 75 e2e dependen de ello.
   - **El color nunca es el único portador de información** — siempre acompañado de
     icono, texto o forma.
8. **Los presupuestos de rendimiento y las Core Web Vitals.** LCP, CLS y INP. Ningún
   modelo puede introducir salto de layout ni bloquear el render. (§6.)
9. **El canal de feedback.** El `<Toaster/>` único, el reparto toast/inline/página y el
   `AlertDialog` antes de lo irreversible — reglas de
   [apps/web/CLAUDE.md](../apps/web/CLAUDE.md). Son **arquitectura de interacción**, no
   estilo.
10. **El comportamiento del backoffice.** Un modelo puede teñirlo; nunca puede hacerlo
    menos funcional, más lento o más difícil de escanear. (Regla 2 de Ernest.)

### 2.4 La zona gris: lo que hay que decidir explícitamente

Estos casos **no caen limpiamente a un lado** y por eso van al §12.

| Caso | Por qué es gris | Recomendación de la auditoría |
|---|---|---|
| **Densidad** (padding de botones, alturas de fila) | Es aspecto percibido, pero mueve el layout y puede cambiar cuántas filas caben | **INVIOLABLE en v1.** Es la puerta por la que la estructura se cuela disfrazada de estilo |
| **Escala tipográfica** (tamaños) | Cambiar tamaños reflowea todo y puede romper el responsive | **FIJA.** El modelo elige la *familia*, no la escala |
| **Iconos** | Distinta familia = distinta métrica óptica = celdas que se mueven | **Sí, pero con contrato estricto** (§3.5) |
| **Imagen OG y `global-error`** | No pueden leer variables CSS (§1.3) | **Fuera del sistema de tokens.** Reciben los valores resueltos por otra vía, o quedan neutrales |
| **Modo oscuro** | ¿Eje del modelo o eje independiente? | Duplica la verificación visual. **Fuera de v1** salvo que Ernest lo pida |
| **Contenido del blog** (`prose`) | Lo escribe un editor en Markdown | El modelo tiñe `prose`; **nunca** toca el Markdown |

### 2.5 La regla de oro operativa

> **Si para aplicar un modelo hay que editar un fichero `.tsx`, ese modelo se ha salido
> de la frontera.**

Un modelo debe ser **datos + CSS + assets**. Nunca código de componente. Esta regla es
la que hace el sistema seguro, verificable y escalable a N modelos sin que el riesgo
crezca con N. Es también el criterio que dice cuándo la Fase Segura (§10) ha terminado:
cuando ningún componente contiene una decisión de aspecto.

---

## 3. LA ARQUITECTURA PROPUESTA

> Todo este bloque es **propuesta**, sujeta a las decisiones del §12.

### 3.1 Las cuatro capas

```
  CAPA 4 · CONFIGURACIÓN   ¿Qué modelo, qué versión, qué colores? → Setting (por instancia)
           ↓
  CAPA 3 · MODELO          Un tema completo, definido EN CÓDIGO, versionado
           ↓
  CAPA 2 · TOKENS          Variables CSS en :root y por zona  ← LA FRONTERA VIVE AQUÍ
           ↓
  CAPA 1 · COMPONENTES     Consumen tokens. Nunca deciden aspecto. NO CAMBIAN NUNCA
```

La propiedad que hay que preservar por encima de todo: **la capa 1 no se entera de que
existen modelos.** Es lo que hace que añadir el modelo nº 7 no toque ningún componente y
que el riesgo no crezca con el número de modelos.

### 3.2 Qué es un MODELO y qué es una VERSIÓN

**Modelo** = una personalidad completa. Trae **fijos**: familia tipográfica, set de
iconos, vocabulario de animación, conjunto de ilustraciones, curva de redondeo y sombra.

**Versión** = una revisión del mismo modelo. Existe para poder **corregir o evolucionar
un modelo sin cambiar bajo los pies de las instancias que ya lo usan**. Una instancia
está fijada a `modelo@versión` y se mueve **por acto explícito del admin**, nunca por
despliegue.

> **Por qué versiones y no simplemente «editar el modelo»:** el mismo motivo por el que
> las claves de logo llevan nombre aleatorio y no `logo-public.png`. Sin versión, mejorar
> el Modelo 3 repinta en silencio todas las instancias que lo usan, sin que nadie lo haya
> pedido ni pueda volver atrás.

**Los modelos se definen en código, no en la base de datos.** Razones:

- Un modelo trae **assets** (fuentes, ilustraciones, quizá un set de iconos) que se
  despliegan con la aplicación.
- Ernest ya lo dijo: «los iremos añadiendo» — cadencia de despliegue, no de formulario.
- Un editor visual de temas es un producto entero, y abre la puerta a que un admin cree
  un tema **inaccesible** (contraste roto) sin barrera. Con modelos en código, la
  verificación de contraste (§2.3.7) se hace una vez, en CI.

**Lo que el admin configura son los colores de marca**, sobre el mismo set de atributos
para todos los modelos (requisito explícito de Ernest). El modelo **deriva** el resto de
su paleta de esos colores más sus propias reglas.

### 3.3 El set de atributos configurables — tres opciones

**Requisito de Ernest: el mismo set para TODAS las opciones.** Cuanto más pequeño, más
seguro (menos formas de romper el contraste) y más consistente entre modelos.

| | **A · Mínimo** | **B · Equilibrado** ⭐ | **C · Amplio** |
|---|---|---|---|
| Atributos | `primary`, `secondary` | `primary`, `secondary`, `accent`, `neutral` | + los 4 semánticos (éxito/aviso/error/info) |
| Deriva el modelo | Todo lo demás | Superficies y semánticos | Casi nada |
| Riesgo de contraste | Muy bajo | Bajo (validable) | **Alto** |
| Diferencia entre instancias | Baja | Suficiente | Alta |

**Recomendación: B.** `primary` + `secondary` + `accent` + `neutral` (el gris base, que
es lo que de verdad da carácter a un tema y hoy nadie puede tocar). Los **semánticos se
quedan fijos por modelo**: que «error» sea rojo no es una decisión de marca, es una
convención que el usuario ya conoce, y dejarla configurable es invitar a que una
instancia pinte los errores de verde. Cada color aportado por el admin se acompaña de su
`-foreground` **derivado automáticamente y validado a AA**, nunca elegido a mano.

### 3.4 Los tokens: los tres niveles

La clave para que la frontera sea real es que **los tokens estén tipados por quién los
controla**:

| Nivel | Quién decide | Ejemplos | Puede cambiar por modelo |
|---|---|---|---|
| **T1 · Configurable** | El **admin** de la instancia | Los 4 colores de marca | Sí, por instancia |
| **T2 · Del modelo** | El **modelo** (código) | Familia tipográfica, radius, sombras, curvas y duraciones de animación, superficies derivadas | Sí, al cambiar de modelo |
| **T3 · Estructural** | **Nadie** — es del sistema | Espaciado, breakpoints, escala tipográfica, alturas de cabecera, anchos de contenedor | **Nunca** |

> **T3 debe existir como capa nombrada aunque no cambie jamás.** Es lo que impide que
> alguien, dentro de un año, «solo por esta vez» meta un espaciado en el modelo. La
> frontera del §2 se hace cumplir aquí, no en la revisión de código.

Sobre los **tokens existentes** (§1.1): se mantienen los 17 nombres de shadcn. No se
renombran. Los componentes `ui/` no se tocan, y ése es medio refactor ahorrado. Lo que se
añade es (a) los ejes nuevos (tipografía, animación, ilustración, elevación) y (b) **una
capa semántica encima**, que es lo que absorbe la dispersión del §1.3: el banner amarillo
de 33 ficheros pasa a ser un token de «aviso», no un `yellow-50`.

### 3.5 Iconos — el eje caro

185 ficheros importan lucide directamente. Tres caminos:

| | **A · Un solo set (lucide)** | **B · Indirección con registro** | **C · Set por modelo, libre** |
|---|---|---|---|
| Qué cambia | Nada; el modelo tiñe y dimensiona | Un mapa `nombre → componente`; los 185 ficheros importan del mapa | Cada modelo trae su librería |
| Coste | 0 | Medio (mecánico, verificable) | Alto + peso de bundle |
| Riesgo | 0 | Bajo | **Alto**: métricas ópticas distintas mueven celdas → cruza la frontera del §2 |
| Cubre el encargo | Parcial | Sí, con contrato | Sí |

**Recomendación: A para v1, con la puerta abierta a B.** El *stroke width*, el tamaño y
el color de un icono ya son mucha personalidad, y son tokens puros. Si más adelante hace
falta B, el contrato tiene que ser **estricto**: todo set alternativo debe cubrir el
**100%** de los nombres del registro y respetar la caja óptica — un set incompleto
dejaría huecos silenciosos, y uno con métricas distintas movería el layout, que es
exactamente lo que el §2.3 prohíbe.

**C se desaconseja.** No cabe dentro de la frontera sin romperla.

---

## 4. EL MODELO DE DATOS

### 4.1 Dónde vive cada cosa

| Dato | Dónde | Molde existente |
|---|---|---|
| **Catálogo de modelos y versiones** | **Código** (`apps/api` + `apps/web`, fuente compartida) | `LOGO_ZONES` / `branding.constants.ts` |
| **Modelo + versión activos** | `Setting` (1 fila) | El whitelist de `admin.service.ts` |
| **Los 4 colores del admin** | `Setting` (1 fila, objeto) | `detectionModes` (ya guarda un objeto) |
| **Ajuste por zona** (§5) | `Setting` (1 fila, objeto por zona) | `LOGO_SETTING_KEYS` |
| **Ilustraciones** | `Setting` por slot **+ objetos en R2** | **`BrandingService` literal** |

**Nada de esto necesita tablas nuevas de Prisma.** Es exactamente la forma de `Setting`:
clave global, un valor, quién lo tocó y cuándo. La misma justificación escrita en
`branding.constants.ts` para los tres logos aplica aquí.

### 4.2 Las reglas heredadas del molde (no negociables)

Todas verificadas en §1.10:

1. **Fuera del `PATCH /admin/settings/:key` genérico.** Un tema mal escrito repinta las
   81 pantallas; y como las ilustraciones son objetos de R2, el PATCH genérico no
   limpiaría el anterior ni revalidaría. Servicio propio, único escritor.
2. **«Sin fila» = Modelo 0, versión 1, colores por defecto.** El estado legítimo de toda
   instancia recién desplegada. **Nunca 404, nunca 500 por falta de datos.**
3. **`AuditLog` en la misma transacción.** Cambiar el tema de una instancia es un acto
   administrativo con consecuencias en todas las pantallas: tiene que quedar registrado
   quién y cuándo.
4. **`revalidateTag` al escribir.** El tema entra en el layout de servidor (§4.3); sin
   invalidación, el cambio no se ve hasta que caduque la caché.
5. **Limpieza de assets encolada, nunca en línea, y nunca puede tumbar la operación.**
6. **Validación fuerte en el DTO**: modelo y versión existentes en el catálogo, colores
   en formato válido, **contraste AA verificado antes de aceptar**. Un tema que no cumple
   AA se rechaza con 422 — el §2.3.7 se hace cumplir en el backend, no en la revisión.

### 4.3 Cómo llega el tema al navegador

El tema debe estar **en el HTML de la primera respuesta**, resuelto en servidor. Si
llegara por JavaScript de cliente, habría un instante con los colores por defecto y luego
un repintado: **eso es un salto visible y probablemente CLS**, que el §2.3.8 prohíbe.

El molde ya existe y está probado:
[(admin)/layout.tsx](../apps/web/src/app/(admin)/layout.tsx) resuelve los logos en el
layout de servidor «sin petición desde el navegador, sin estado *cargando* y sin un
instante en que la cabecera esté vacía». **El tema hace exactamente lo mismo**, en el
layout raíz, con `unstable_cache` + tag, y con `.catch(() => null)` → Modelo 0.

---

## 5. LA DIFERENCIACIÓN POR ZONA

**Las tres zonas ya existen en el código** (`LOGO_ZONES`, `resolveBrand`,
`esRutaDeBlog`) y **coinciden exactamente** con las de Ernest. No hay que inventarlas.

Y hay una segunda coincidencia útil: los **grupos de rutas del App Router** ya separan
físicamente las zonas — `(public)`, `(auth)`, `(account)`, `(admin)`, `(public)/blog`.
Cada grupo tiene su `layout.tsx`. **Son el punto de anclaje natural del sub-tema por
zona: un atributo de zona en el contenedor de cada layout, y las variables se
reasignan dentro de ese ámbito.** Es el mismo mecanismo que `.dark` (§1.5), que shadcn ya
probó en este repo.

**Un solo sistema, tres afinaciones — no tres sistemas.** El sub-tema de una zona solo
puede **ajustar** tokens existentes, nunca añadir los suyos. Si el backoffice necesitara
un token que el resto no tiene, eso sería un segundo sistema, y es justo lo que §1.4
celebra que no exista hoy.

| Zona | Carácter | Qué ajusta | Prioridad |
|---|---|---|---|
| **Público** (resto) | La personalidad del modelo, completa | Todo lo permitido | Equilibrio |
| **Blog** | *Sutilmente* distinto: lectura | Tipografía de cuerpo, medida de línea, tono de superficie. **`prose` se tiñe; el Markdown no se toca** | SEO/lectura |
| **Backoffice** | **Sobrio y funcional** (regla 2) | Saturación reducida, animación al mínimo, contraste alto, densidad estable | **Función siempre** |
| **Logins** (usuario y admin) | Zona de impacto (§6) | Puede ir espectacular | Impacto |

> **El backoffice: ¿sub-tema o modelo aparte?** Es una decisión del §12. La auditoría
> recomienda **sub-tema**, por el §1.4: hoy comparte tokens con todo el sitio, y hacerlo
> modelo aparte crearía el segundo sistema que ahora mismo no existe. La sobriedad se
> consigue **restando** (menos saturación, menos animación), no con un tema paralelo.

⚠ **Ojo con `/admin/login`**: está **fuera del grupo `(admin)`** (§1.4). Si el ámbito de
zona se ancla en los layouts de grupo, esa pantalla se queda sin zona. Hay que decidir
conscientemente si es «backoffice» (sobria) o «login» (impacto) — y ahora mismo es la
única pantalla oscura del proyecto.

---

## 6. LA JERARQUÍA RENDIMIENTO / IMPACTO

Aquí se resuelve la tensión central. La respuesta no es un punto medio: es **repartir el
presupuesto de forma desigual y deliberada**.

### 6.1 Las dos categorías

| | **ZONA DE IMPACTO** | **ZONA DE RENDIMIENTO** |
|---|---|---|
| Dónde | Hero de portada, CTAs principales, login de usuario, login de backoffice | **Todo lo demás**: listados, búsqueda, fichas, cuenta, backoffice |
| Se permite | Animación elaborada, entradas escalonadas, ilustración grande, efectos de fondo | Transiciones de color y micro-feedback |
| Presupuesto | Generoso, **acotado y medido** | Estricto |
| Regla | Puede no maximizar el rendimiento (regla 5 de Ernest) | **Rendimiento y SEO mandan** |

**Por qué esta lista y no otra:** son superficies **poco numerosas, de entrada, y no
transaccionales**. El hero se ve una vez por sesión; un listado se recorre cien veces. Y
las tres son sitios donde el usuario **está decidiendo**, no operando.

### 6.2 Las cinco reglas que hacen que el impacto no contamine

Son la parte de ingeniería del asunto, y las dos primeras están **ya demostradas en este
repo** (§1.8):

1. **CSS antes que JS, siempre que se pueda.** El hero rotativo ya lo hace: 0 KB de
   bundle en la ruta de más tráfico, y sobrevive sin hidratación. **Es la doctrina, y
   está escrita en `globals.css`.**
2. **Ninguna animación puede causar CLS.** El hero lo resuelve con `inline-grid` (la caja
   mide lo que la opción más ancha y no cambia al rotar). **Regla: solo se anima lo que
   no reserva espacio** — `transform` y `opacity`, nunca propiedades que reflowean.
3. **El coste se paga donde se disfruta.** Si una animación de impacto necesita JS o un
   asset pesado, se carga **solo en esa ruta**, nunca en el layout raíz. El sprite ya lo
   hace con `@media (hover:hover) and (pointer:fine)`: el móvil **no lo paga nunca**.
4. **El LCP nunca se anima ni se retrasa.** El elemento más grande de la vista aparece
   en su sitio y a tiempo. La animación entra **después** o afecta a otros elementos.
5. **`prefers-reduced-motion` degrada a un estado completo, no mutilado.** Es la doctrina
   ya escrita para el hero y el sprite. Quien pide movimiento reducido **recibe la misma
   frase, no una versión recortada**.

### 6.3 El SEO, explícitamente

- **El HTML no cambia entre modelos** (§2.1). Es la garantía de raíz: un modelo no puede
  tocar lo que el buscador lee.
- **No se sacrifica el SSR/ISR.** Las fichas y listados siguen en servidor. El tema entra
  por CSS, no por JS de cliente (§4.3).
- **Las ilustraciones no se cuelan en el LCP** sin `priority` y sin dimensiones (§7.3).
- **La tipografía mantiene `display: 'swap'` y las métricas de fallback** — el mecanismo
  anti-CLS que `layout.tsx` documenta hoy es innegociable para cualquier fuente que traiga
  un modelo.

---

## 7. LAS ILUSTRACIONES

### 7.1 El principio

> **La ilustración es un asset intercambiable. El hueco donde va, no.**

Un modelo cambia **qué imagen** ocupa el slot «favoritos vacío». **No** decide si esa
pantalla tiene ilustración, dónde va, ni qué texto la acompaña. Eso es estructura (§2.3).

### 7.2 El registro de slots

Un **registro de slots con nombre estable**, definido en código, compartido entre back y
front — molde literal de `LOGO_ZONES` y por el mismo motivo escrito en
`branding.constants.ts`: quien sube la imagen y quien la pinta **no se conocen entre sí**,
y si la lista viviera dentro de uno de los dos, añadir un slot dejaría el otro
desincronizado **en silencio**.

Cada slot declara: identificador, descripción (para que el admin sepa qué está
cambiando), proporción recomendada y **texto alternativo por defecto** (accesibilidad, y
no puede depender de que el admin lo escriba).

Familias previsibles a partir de las pantallas existentes: **estados vacíos**
(favoritos, mis anuncios, búsqueda sin resultados, mensajes, tickets), **confirmaciones**
(pago, valoración enviada, anuncio publicado), **estados de error** (404, 500, sin
permiso) y **transversales** (mantenimiento, cuenta suspendida).

**Cada slot debe tener siempre un valor por defecto que venga con el modelo.** «Sin fila»
= la ilustración del modelo activo. Nunca un hueco.

### 7.3 Cómo se sirven — y las trampas que este repo ya conoce

**Molde de logos, sin desviarse** (§1.10): R2/MinIO, clave aleatoria, subida
transaccional con `AuditLog`, limpieza encolada del anterior, `revalidateTag`.

Tres avisos que **ya han mordido en este proyecto** y que aplican igual:

1. **`S3_PUBLIC_URL` / `NEXT_PUBLIC_MEDIA_URL` deben apuntar al mismo sitio y estar
   fijadas ANTES de la primera subida.** La URL pública se construye al subir y **se
   guarda entera en la base**. Es literalmente el episodio `localhost:9000` →
   `127.0.0.1:9000` de `CLAUDE.md`, que ya ha pasado tres veces.
2. **`remotePatterns` se deriva de la variable de entorno**
   ([image-domains.ts](../apps/web/src/lib/image-domains.ts)) — las ilustraciones se
   sirven del mismo origen que el resto de medios, así que no hay que tocar nada, pero
   tampoco se puede servir de otro sitio sin actualizar esa lista.
3. **`NEXT_PUBLIC_*` se incrusta al construir, no al arrancar.**

**Rendimiento y SEO (regla 4 de Ernest):**

- `next/image` **siempre**, con dimensiones explícitas → **cero CLS**.
- **`loading="lazy"` por defecto.** Una ilustración de estado vacío está por definición
  bajo el pliegue o en una pantalla poco frecuente.
- **`priority` solo si la ilustración es el LCP**, y solo en zona de impacto (§6.2.4).
- Formatos modernos con respaldo; límite de peso por slot **validado en la subida**, no
  confiado al criterio de quien sube (molde `LOGO_MAX_BYTES`, que es 1 MB **precisamente
  porque un logo se sirve en todas las páginas**).
- **`alt` obligatorio**, del registro si el admin no lo da. Una ilustración decorativa
  va con `alt=""` **declarado**, no ausente.
- **SVG solo del admin y pintado con `<img>`, nunca incrustado en el DOM** — el
  razonamiento de tres puntos ya escrito en `branding.constants.ts` sobre por qué el SVG
  se admite **solo** en la superficie de branding.

### 7.4 Los dos casos que quedan fuera

**`opengraph-image.tsx`** (Satori) y **`global-error.tsx`** no pueden leer variables CSS
(§1.3). Son **frontera declarada del sistema**: o reciben los valores del tema por otra
vía (resueltos en servidor, escritos inline) o se quedan deliberadamente neutrales. **Hay
que decidirlo, no descubrirlo cuando la OG de una instancia salga con los colores de
otra.**

---

## 8. LOS CORREOS

Aquí está la tensión más aguda, y **no se puede resolver por defecto**.

### 8.1 El hecho

Los 18 envíos son **texto plano**, por una **invariante de seguridad declarada** (§1.9):
nunca se genera HTML a partir de contenido que escribe un usuario cualquiera y que lee un
agente con sesión. **Por eso no hace falta sanitizado.**

**«Alcance total incluidos correos» exige cruzar esa decisión.** No es una extensión: es
un cambio de postura de seguridad. Hay que decirlo con claridad porque es exactamente la
clase de cosa que se implementa sin darse cuenta de lo que se está desmontando.

### 8.2 Restricciones técnicas del medio

Aunque se decidiera pasar a HTML:

- **Las variables CSS no funcionan** en la mayoría de clientes de correo. El tema tiene
  que **resolverse a valores literales** en el servidor y escribirse **inline**. Es una
  segunda vía de renderizado del mismo tema — inevitable.
- Sin flexbox ni grid fiables. Tablas.
- El modo oscuro de los clientes reinvierte colores de forma impredecible.
- El **peso** importa (Gmail recorta a ~102 KB).
- **Nada de fuentes personalizadas**: si el modelo trae tipografía propia, el correo cae
  a una pila de respaldo. **La personalidad del modelo en el correo será siempre parcial.**

### 8.3 Las tres opciones

| | **A · Texto plano** | **B · HTML mínimo con contenido escapado** ⭐ | **C · HTML completo** |
|---|---|---|---|
| Qué es | No se toca | Marco temado (cabecera con logo, colores de marca, botón CTA, pie); **todo el contenido de usuario escapado, sin excepción** | Plantillas ricas con ilustraciones |
| Alcance del tema | Ninguno | Marca reconocible: logo, `primary`, botón | Completo |
| Riesgo XSS | **Cero** | **Bajo y acotado** — el escapado se hace en **el único `enviar()`**, no en 18 sitios | Medio-alto |
| Cumple el encargo | ❌ | Sí, en lo esencial | Sí |
| Coste | 0 | Medio | Alto (+ pruebas en N clientes) |

**Recomendación: B**, y el motivo es estructural, no de gusto: **el punto de
estrangulamiento único ya existe**. La misma propiedad que hoy garantiza que el pie de
baja no se pueda olvidar en ninguno de los 18 envíos garantizaría que **el escapado no se
pueda olvidar en ninguno**. La invariante no se elimina: **se traslada de «nunca hay
HTML» a «el HTML se compone en un solo sitio, y el contenido de usuario entra escapado,
siempre»** — verificable con un test que ningún desarrollador futuro pueda rodear.

**Con dos condiciones innegociables:**
1. Se mantiene **siempre** la parte `text:` alternativa (entregabilidad, accesibilidad y
   clientes que no pintan HTML).
2. Los correos **críticos** (verificación, restablecer contraseña, moderación de cuenta)
   se quedan **lo más sobrios posible**. Un correo de restablecimiento muy adornado se
   parece a una suplantación, y ahí la marca juega en contra.

**Es una decisión de Ernest** (§12).

---

## 9. EL RIESGO Y LA VERIFICACIÓN

### 9.1 Por qué esto es lo delicado

**Un cambio de estilo no da error de compilación.** No hay tipo que lo atrape, no hay
test funcional que falle. **Se ve mal, y solo si alguien mira.** Y toca las 81 pantallas.

**No es una hipótesis: ya ha pasado en este repo.** El §1.8.1 — `tailwindcss-animate`
ausente mientras 6 ficheros usan sus clases — es exactamente eso: los diálogos aparecen
en seco, el build pasa, los 75 e2e pasan, nadie se entera.

**Y hoy no hay ninguna red**: 0 snapshots visuales (§1.12).

### 9.2 La barrera: Modelo 0 idéntico

> **MODELO 0 se ve EXACTAMENTE igual que la plataforma de hoy. Píxel a píxel.**
>
> Si algo cambia visualmente con Modelo 0 activo, **es un bug de migración**, no una
> mejora, no un retoque, no «ya que estamos». Se revierte.

Esta regla es lo que convierte un refactor de 83 ficheros —invisible por naturaleza y por
tanto imposible de revisar a ojo— en algo **con criterio binario de aceptación**. Sin
ella, el refactor a tokens es un acto de fe repetido 83 veces.

Corolario incómodo pero necesario: **la deuda visual que se encuentre por el camino no se
arregla durante la migración.** Se inventaría y se arregla después, con Modelo 0 ya
verificado. Mezclar «mover a tokens» con «además mejorarlo» destruye la barrera, porque
ya no se sabe si una diferencia es el bug o la mejora.

### 9.3 Cómo se verifica — cuatro capas

| Capa | Qué comprueba | Cuándo |
|---|---|---|
| **1 · Snapshots visuales** (Playwright `toHaveScreenshot`) | Modelo 0 = hoy, en un catálogo de pantallas, **escritorio y móvil** | Cada commit del refactor |
| **2 · Contraste automatizado** | Cada modelo+versión cumple AA en todos los pares | CI, por modelo |
| **3 · Invariancia del HTML** | **Dos modelos distintos producen el mismo DOM** — la prueba mecánica del §2.1 | CI, por modelo |
| **4 · Los 75 e2e existentes** | Flujos, nombres accesibles y textos intactos | Siempre |

**La capa 1 es prerrequisito de todo lo demás y no hay atajo.** Hay que construirla
**antes** de tocar el primer fichero, o no habrá con qué comparar. Es la Ráfaga E0 del
§11.

**La capa 3 es la que hace la frontera del §2 cumplible por máquina** en vez de por
disciplina. Es, probablemente, la idea más valiosa de esta auditoría: convierte la
decisión de Ernest en un test.

### 9.4 Qué pantallas entran en el catálogo visual

No hacen falta las 81. Hace falta **cobertura de idiomas visuales**: portada, búsqueda
(lista y mapa), ficha de anuncio, wizard de publicar, cuenta, mensajes, blog (listado y
post), backoffice (tabla, formulario, cola de moderación), los dos logins, y los estados
**vacío / cargando / error**. **Cada una en escritorio y en móvil** — el responsive es
inviolable (§2.3.3) y las cicatrices de A3 y UXV.2 hay que protegerlas explícitamente.

### 9.5 Riesgos residuales, dichos claramente

| Riesgo | Mitigación |
|---|---|
| Los snapshots son frágiles (fuentes, animación, datos) | Datos sembrados fijos, animación congelada, tolerancia calibrada |
| El catálogo no cubre una pantalla y ahí se cuela la regresión | Cobertura por **idioma visual**, no por ruta; ampliar cuando aparezca un idioma nuevo |
| Un modelo futuro cumple AA pero es feo o ilegible | **Ninguna automatización sustituye la revisión humana** de cada modelo antes de publicarlo |
| El correo se ve mal en un cliente concreto | Parte `text:` siempre presente (§8.3) |
| Alguien mete una decisión de aspecto en un `.tsx` dentro de un año | Capa T3 nombrada (§3.4) + capa 3 de verificación |

---

## 10. EL ORDEN DE ATAQUE

El principio que ordena todo: **separar lo invisible de lo nuevo.**

- **Mover a tokens** es invisible y verificable por comparación → primero, con red.
- **El sistema de modelos** es una feature nueva y visible → después, sobre terreno
  verificado.

Mezclarlos hace el refactor irrevisable: cualquier diferencia se puede justificar como
«será el tema nuevo».

```
  FASE 0 · LA RED
     Snapshots visuales de la plataforma tal como está.        [nada cambia]

  FASE 1 · LA FASE SEGURA (invisible)
     Consolidar el idioma repetido, absorber los 381 usos,
     exponer tipografía y animación como tokens.
     ── BARRERA: Modelo 0 idéntico, escritorio y móvil ──      [nada cambia]

  FASE 2 · EL SISTEMA (solo Modelo 0)
     Catálogo modelo+versión, config por instancia, sub-temas
     por zona, la pantalla de admin. UN SOLO MODELO.
     ── BARRERA: el sistema funciona y NO cambia nada ──       [nada cambia]

  FASE 3 · LAS ILUSTRACIONES
     Registro de slots, subsistema de assets, admin.           [visible, acotado]

  FASE 4 · LOS CORREOS
     Según la decisión del §8.                                 [visible, acotado]

  FASE 5 · EL PRIMER MODELO CON PERSONALIDAD
     Ahora, y solo ahora, un modelo que se ve distinto.        [visible, la feature]
```

**La Fase 2 es la clave del despliegue seguro que Ernest pide:** el sistema entero en
producción, con un único modelo que es idéntico a lo de hoy. **Si nada cambia
visualmente, el sistema funciona.** Se valida la maquinaria sin arriesgar la interfaz, y
se puede parar ahí indefinidamente sin haber roto nada.

---

## 11. EL PLAN DE RÁFAGAS

Dimensionado según la dispersión medida (§1.3): **más pequeña de lo esperado y muy
concentrada**, lo que permite ráfagas más finas.

| Ráfaga | Contenido | Visible | Depende de |
|---|---|---|---|
| **E0** | **La red visual.** Catálogo de pantallas, escritorio y móvil, datos fijos. Sin tocar estilo | ❌ | — |
| **E1** | **Los dos idiomas repetidos.** Banner de aviso (33 ficheros, ~99 usos) y badges de estado → componentes con tokens semánticos. **Incluye resolver el §1.8.1** | ❌ | E0, §12.1 |
| **E2** | **La cola larga.** Los ~280 usos restantes en ficheros de 1-5 usos. Mecánico | ❌ | E1 |
| **E3** | **Los ejes nuevos como tokens.** Tipografía a variable CSS, animación, elevación. Capa T3 nombrada | ❌ | E2 |
| **E4** | **El catálogo y la config.** Modelo+versión en código, `Setting`, servicio propio con `AuditLog`, DTO con validación AA, resolución en layout de servidor | ❌ | E3, §12.2 |
| **E5** | **Zonas y pantalla de admin.** Sub-temas por zona, selector en `/admin/marca`. **Resolver `/admin/login`** | ❌ | E4, §12.4 |
| **E6** | **Verificación de modelos.** Capas 2 y 3 del §9.3 (contraste + invariancia del HTML) | ❌ | E4 |
| **E7** | **Ilustraciones.** Registro de slots, subsistema R2, admin | ✅ | E4, §12.5 |
| **E8** | **Correos.** Según §12.3 | ✅ | E4 |
| **E9+** | **Modelos con personalidad.** Una ráfaga por modelo | ✅ | Todo |

**E0-E3 son la Fase Segura.** Nada cambia visualmente y **todo es verificable contra la
red de E0**. Es la mayor parte del trabajo, y es la parte sin riesgo de producto.

**E4-E6 es el sistema con solo Modelo 0.** Punto de parada natural y seguro.

> **E9+ no tiene número.** Los modelos se añaden con la cadencia que Ernest quiera, y
> cada uno es independiente. Esa es la prueba de que la arquitectura funciona: **si añadir
> el modelo nº 5 obliga a tocar algo fuera de su propia definición, la frontera del §2 se
> rompió en alguna ráfaga anterior.**

---

## 12. LAS DECISIONES PARA ERNEST

Ninguna se toma en esta auditoría. Cada una lleva la recomendación **y su motivo**.

### 12.1 · La frontera aspecto/estructura (§2) — **LA DECISIÓN #1**

Aprobar, corregir o ampliar el §2: la lista de lo que un modelo **puede** cambiar (§2.2)
y sobre todo la de lo **inviolable** (§2.3), incluida la regla de oro: *si para aplicar un
modelo hay que editar un `.tsx`, el modelo se salió de la frontera*.

**Sub-decisiones de la zona gris (§2.4):** ¿la **densidad** es inviolable en v1
(recomendado)? ¿La **escala tipográfica** queda fija (recomendado)? ¿El **modo oscuro**
entra como eje (recomendado: **no** en v1 — duplica la verificación visual)?

*Todo lo demás depende de esta decisión.*

### 12.2 · El set de atributos configurables (§3.3)

**A** (2 colores) · **B** (4: primary, secondary, accent, neutral) ⭐ · **C** (8, con los
semánticos).

**Recomendación: B.** Los semánticos fijos por modelo: que «error» sea rojo es una
convención que el usuario ya conoce, no una decisión de marca.

### 12.3 · Los correos (§8) — **la decisión más delicada**

**A** texto plano (no cumple el encargo) · **B** HTML mínimo con contenido escapado ⭐ ·
**C** HTML completo.

**Recomendación: B**, porque el punto de estrangulamiento único ya existe y hace el
escapado imposible de olvidar. **Ernest debe saber que esto cambia una decisión de
seguridad tomada a conciencia** (§1.9), no que extiende algo existente.

### 12.4 · El backoffice: ¿sub-tema o modelo aparte? (§5)

**Recomendación: sub-tema.** Hoy comparte tokens con todo el sitio (§1.4); hacerlo modelo
aparte crearía el segundo sistema de estilo que ahora mismo, afortunadamente, no existe.
La sobriedad se consigue **restando**.

*Incluye decidir a qué zona pertenece `/admin/login`, que está fuera del grupo `(admin)`
y es la única pantalla oscura del proyecto.*

### 12.5 · El subsistema de ilustraciones (§7)

- ¿**Registro de slots cerrado** (definido en código, recomendado) o slots libres?
- ¿El admin **sube las suyas** o solo elige entre las del modelo?
  **Recomendado: las dos** — el modelo trae defaults, el admin puede sustituir.
- ¿Qué familias de slots entran en v1? *(Recomendado: estados vacíos + confirmaciones.
  Errores y transversales en una segunda pasada.)*

### 12.6 · Los iconos (§3.5)

**A** un solo set, temado por color/grosor/tamaño ⭐ · **B** indirección con registro ·
**C** set libre por modelo.

**Recomendación: A en v1, con B como puerta abierta.** C se desaconseja: métricas ópticas
distintas mueven el layout, y eso cruza la frontera del §2.3.

### 12.7 · La verificación visual (§9)

¿Se acepta **snapshots de Playwright** como red (recomendado — ya está la infraestructura
de los 75 e2e) o se prefiere una herramienta externa? ¿Se acepta que **E0 vaya primero**,
sin cambiar nada visible, antes de tocar un solo fichero de estilo?

**Recomendación: sí a las dos.** Sin red no hay barrera de Modelo 0, y sin barrera de
Modelo 0 el refactor de la Fase Segura no es revisable.

---

## 13. Lo que esta auditoría afirma con seguridad

1. **El medio camino está hecho, y bien.** shadcn montó los 17 tokens, los 19 componentes
   base los usan sin excepción, y **no hay un solo hex arbitrario en 378 ficheros**.
2. **La dispersión es menor de lo temido y tiene forma de idioma repetido.** 381 usos en
   83 ficheros, de los cuales ~99 son **un banner copiado 33 veces**, casi todo en el
   backoffice.
3. **Las tres zonas de Ernest ya existen en el código**, nombradas igual, con su molde de
   configuración por instancia, sus assets en R2 y su invalidación de caché. **No hay que
   inventar el mecanismo multi-instancia: hay que extenderlo.**
4. **El backoffice no tiene paleta propia** — al contrario de lo supuesto. Es una buena
   noticia: no hay un segundo sistema que reconciliar.
5. **Los correos son texto plano por una invariante de seguridad deliberada.** El alcance
   total sobre correos **es una decisión de producto con implicaciones de seguridad**, no
   una extensión técnica.
6. **Los iconos son el eje caro**: 185 ficheros sin indirección.
7. **No existe ninguna verificación visual, y eso ya tiene consecuencias**:
   `tailwindcss-animate` lleva ausente quién sabe cuánto, con seis ficheros usando sus
   clases, y **ni el build ni los 75 e2e lo notan**.
8. **La frontera se puede hacer cumplir por máquina**, no solo por disciplina: si dos
   modelos deben producir el mismo HTML, eso es un test.

**Nada de esto está implementado, y esa es la idea.** El §12 primero.
