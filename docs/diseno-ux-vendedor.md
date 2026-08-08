# Diseño — Mejoras UX de la zona de gestión del vendedor

> Documento de diseño (2026-08-08). Parte de
> [`auditoria-ux-vendedor.md`](auditoria-ux-vendedor.md) (25 hallazgos priorizados + mapa de
> flujos + enganches). **Este documento no implementa nada**: define *qué* se arregla, *en qué
> tandas*, *en qué orden* y *qué decisiones* hay que cerrar antes de tocar código.
>
> **Alcance:** flujo y organización de `(account)` (mis anuncios, editar, saldo, planes,
> facturación) y las dos superficies de acciones de propietario. **Fuera de alcance:** estética
> (colores, tokens, densidad, iconografía) — decisión de Ernest, se trata aparte.
>
> **Prepara, sin diseñarlos, los dos proyectos siguientes:** bump automático y vídeo en anuncios
> PRO. Este documento solo deja la superficie lista y señala dónde encajan.
>
> Todo molde citado está verificado contra el fichero y la línea indicados.

---

## 0. La separación que ordena todo el documento

La auditoría mezcló, como toca en una auditoría, dos cosas que aquí se separan porque se tratan
distinto:

| | Qué es | Cómo se trata | Hallazgos |
|---|---|---|---|
| **BUG** | El código hace algo distinto de lo que su propia lógica dice que debe hacer. No hay nada que decidir. | **Se corrige.** No entra en rediseño ni consume decisiones de producto. | A2, A7 (la mitad mecánica) |
| **UX** | El código hace lo que se le pidió, pero lo que se le pidió organiza mal el trabajo del usuario. | **Se diseña.** Hay decisiones de organización, algunas de producto. | El resto |

A7 se parte a propósito: el **spinner que nunca resuelve** es un bug con molde ya escrito
([`planes/exito`](../apps/web/src/app/(public)/planes/exito/page.tsx) resuelve exactamente ese
problema en la otra rama de pago) → va a UXV.1. **A dónde va el usuario después de comprar** es
una decisión de flujo → va a UXV.3.

### El criterio de agrupación: raíz + síntomas

Las tandas **no** agrupan por severidad. Agrupan por **dependencia estructural**: cada tanda ataca
una raíz y los síntomas que esa raíz produce, de modo que al terminar la tanda el problema esté
cerrado y no quede nada roto a medias entre tandas.

```
        (account)/layout.tsx sin cabecera ─┬─ A1 volver al inicio
                        [RAÍZ del SHELL]   ├─ A3 móvil roto
                                           ├─ M1 dónde estoy
                                           ├─ M2 destinos huérfanos
                                           ├─ M3 /planes fuera del shell
                                           └─ transversal: NavPageType no contempla la zona

     sin infraestructura de notificación ──┬─ M5 destacar en silencio
                     [RAÍZ del FEEDBACK]   ├─ M7 factura sin confirmar ni confirmar
                                           ├─ A7 (mitad de flujo: ¿y ahora a dónde?)
                                           └─ B4 sección que se auto-sustituye

      MyListingCard, fila plana de 12 ─────┬─ A6 sin jerarquía
                      [RAÍZ de la TARJETA] ├─ A5 no se puede ver el anuncio
                                           ├─ M10 estadísticas inalcanzables por anuncio
                                           ├─ transversal 2: ListingOwnerActions diverge
                                           └─ ⇒ PREREQUISITO de bump automático

     editar reusa el wizard de alta ───────┬─ A4 5 pantallas para cambiar un precio
                       [RAÍZ del EDITOR]   ├─ sin cancelar / sin aviso de cambios
                                           └─ ⇒ PREREQUISITO de vídeo PRO
```

---

## 1. Decisiones de partida (cerradas, no se reabren)

| # | Decisión | Motivo |
|---|---|---|
| 1 | **Cero estética.** Ninguna tanda cambia paletas, tokens ni densidad. | Lo pidió Ernest explícitamente. Un rediseño de organización que además mueve el color hace imposible saber qué mejoró qué. |
| 2 | **Ninguna tanda deja la zona a medias.** Cada una es desplegable sola. | Es la propiedad que hace que el orden se pueda cambiar si hace falta. |
| 3 | **Los bugs van primero y aparte.** | Son baratos, no consumen decisiones, y A2 desbloquea el bump automático. Mezclarlos con rediseño esconde su coste real. |
| 4 | **No se diseñan bump-auto ni vídeo aquí.** Solo se deja el hueco. | Diseñarlos ahora, sobre una tarjeta y un editor que van a cambiar, sería diseñar dos veces. |
| 5 | **`MainNav` (nav dinámico) sigue siendo solo de `(public)`.** | Es la decisión #1 de [`diseno-nav-dinamico.md`](diseno-nav-dinamico.md) §1, tomada con criterio: la barra es de navegación de catálogo, no de gestión. El transversal «`NavPageType` no contempla la zona» se resuelve **documentando que es deliberado**, no añadiendo tipos. |

---

## 2. Las tandas

### UXV.1 — BUGS (corrección, no rediseño)

| | |
|---|---|
| **Raíz** | Ninguna: son dos defectos independientes. Van juntos porque comparten tratamiento (arreglo directo, sin decisiones). |
| **Resuelve** | A2, A7 (mitad mecánica) |
| **Desbloquea** | **Bump automático** (A2) |
| **Tamaño** | **S** — dos ficheros y un contrato de API |
| **Decisiones de producto** | Ninguna |

**A2 — la ventana de cooldown tiene dos verdades.**
`MyListingCard` calcula `bumpedAt + 24h`
([`MyListingCard.tsx:91-94`](../apps/web/src/components/anuncios/MyListingCard.tsx#L91-L94)); el
backend rechaza solo por debajo de 3600 s
([`billing.service.ts:557`](../apps/api/src/modules/billing/billing.service.ts#L557)). Y una
tercera superficie, [`ListingOwnerActions`](../apps/web/src/components/anuncios/ListingOwnerActions.tsx),
no bloquea nada y deja que conteste el 429 — que es el comportamiento correcto de hoy.

**Criterio de arreglo:** la ventana la define el backend y viaja al front; el front **no la
recalcula**. Dos vías, a elegir en implementación (no es decisión de producto):
- el listado del propietario devuelve `bumpAvailableAt` junto a `bumpedAt`, o
- el front deriva el estado de `bumpedAt` + una constante servida en `GET /billing/catalog`,
  que ya viaja a esta pantalla y ya transporta `bumpCreditCost`.

La segunda encaja con lo que ya se hace y no añade campos al listado.

**A7 (mitad mecánica) — el éxito que nunca resuelve.**
[`mis-creditos/exito`](../apps/web/src/app/(account)/mis-creditos/exito/page.tsx) deja un
`Loader2` girando para siempre. El molde correcto está escrito y en producción:
[`planes/exito`](../apps/web/src/app/(public)/planes/exito/page.tsx) consulta el estado real,
detecta la condición terminal y cambia a ✔ con salidas. Aquí la condición terminal es que el saldo
suba respecto al que había al entrar. Se replica ese patrón. *(A dónde va después → UXV.3.)*

**Hecho cuando:** el botón de bump está habilitado exactamente cuando el backend lo aceptaría, y
la página de éxito de compra alcanza un estado final sin intervención del usuario.

---

### UXV.2 — SHELL de cuenta

| | |
|---|---|
| **Raíz** | [`(account)/layout.tsx`](../apps/web/src/app/(account)/layout.tsx): 34 líneas, un `<aside w-56>` fijo y nada más. Sin cabecera, sin responsive, sin estado. |
| **Resuelve** | A1, A3, M1, M2, M3 + transversal 1 |
| **Desbloquea** | Todo lo demás vive dentro de este shell (tarjeta y editor incluidos) |
| **Tamaño** | **M** — un layout, un componente de nav, un patrón de breadcrumb, revisión de anchos |
| **Decisiones de producto** | **3, todas para confirmar** |

Van juntos porque **son el mismo fichero**. Separar «poner cabecera» de «hacerlo responsive» de
«marcar el activo» obligaría a tocar el layout tres veces y a rehacer los anchos en cada una.

#### Qué se resuelve

1. **Cabecera de sitio en `(account)`** → A1. Deja de existir una zona del producto desde la que
   no se puede volver al inicio.
2. **Sidebar responsive** → A3. Por debajo de `md` deja de robar 224 px al contenido.
3. **Estado activo + orientación** → M1. Molde exacto, mismo repo:
   [`AdminNav.tsx:45-46`](../apps/web/src/app/(admin)/components/AdminNav.tsx#L45-L46) (`usePathname`
   + `startsWith`, con el caso especial de la raíz de sección). Se reusa el criterio, no el fichero.
4. **Los cuatro destinos huérfanos entran en la navegación** → M2: Estadísticas, Datos de
   facturación, Mis tickets, Planes/suscripción. Con 13 entradas, el sidebar necesita **grupos**
   (ver decisión SHELL-D4), no una lista más larga.
5. **Migas de pan en las pantallas de segundo nivel** → M1. El patrón existe en `(public)`
   (`<nav aria-label="Breadcrumb">` en búsqueda y categorías) pero **no hay componente compartido**:
   está repetido inline. Esta tanda es el momento de extraerlo. Ojo: el helper
   [`breadcrumb-json-ld.ts`](../apps/web/src/lib/breadcrumb-json-ld.ts) es para SEO y **no aplica
   aquí** — la zona de cuenta no se indexa.

#### Decisiones

**⬜ SHELL-D1 — ¿la cabecera de cuenta es la misma `Header` pública o una propia?**

| Opción | A favor | En contra |
|---|---|---|
| **Reusar `Header`** *(recomendada)* | Un solo componente que mantener; el usuario recupera **buscador, campana de notificaciones y menú de avatar**, que hoy desaparecen al entrar en su cuenta (es parte del desconcierto de A1). Coherencia total con la portada. | Es un Server Component `async` que hace dos fetches (`getUnreadNotificationsCount` + `getMe`, [`Header.tsx:10-20`](../apps/web/src/components/layout/Header.tsx#L10-L20)); pasarían a ejecutarse también en cuenta. El menú de avatar duplica destinos del sidebar. |
| **Cabecera propia de cuenta** | Se elige exactamente qué llevar; sin fetches de más. | Otro componente que diverge con el tiempo — es justo lo que produjo los tres shells de hoy. |

**Recomendación:** reusar `Header`. La duplicación avatar/sidebar es aceptable (es lo que hace
cualquier marketplace) y la campana volviendo a la zona de cuenta resuelve una pérdida real. Si
preocupa el coste, la respuesta no es un componente nuevo sino cachear esos dos fetches.

**Sub-decisión (ligada):** ¿`Footer` también? **Recomendación: no.** La zona de cuenta es una
herramienta de trabajo, no una página de navegación; el footer alarga cada pantalla sin aportar.

**⬜ SHELL-D2 — en móvil, ¿el sidebar colapsa a *drawer* o a *barra inferior*?**

| Opción | A favor | En contra |
|---|---|---|
| **Drawer (hamburguesa)** *(recomendada)* | Caben **las 13 entradas** con sus grupos. Se construye sobre `@radix-ui/react-dialog`, **ya instalado** (`package.json`) — es la misma primitiva del `dialog` actual, no una dependencia nueva. | Un toque de más para navegar. |
| **Barra inferior** | Cero toques para los destinos frecuentes; patrón nativo de móvil. | Solo caben 4-5 destinos: obliga a decidir cuáles son de primera y a esconder el resto en un «Más» — es decir, a resolver M2 a medias. Además compite con las acciones de la tarjeta. |

**Recomendación:** drawer. Con 13 destinos agrupados, la barra inferior no es viable sin
reintroducir el problema que esta tanda cierra.

**⬜ SHELL-D3 — `/planes`: ¿entra en el shell de cuenta o se queda público? (M3)**

| Opción | A favor | En contra |
|---|---|---|
| **Se queda en `(public)` + retorno explícito** *(recomendada)* | `/planes` es una página de **captación**, con `metadata` propia y su `MainNav pageType="PLANES"` ([`planes/layout.tsx:9`](../apps/web/src/app/(public)/planes/layout.tsx#L9)); tiene que seguir siendo visitable sin sesión. Cero riesgo. | El usuario logueado sigue cambiando de chrome al ir a mejorar de plan. |
| **Duplicar en `/perfil/suscripcion/mejorar`** | Comparación de planes sin salir del shell. | Dos superficies de precios que se desincronizan — el mismo defecto que M4 ya documenta en la lista hardcodeada. |
| **Mover a `(account)`** | Coherencia total. | Rompe SEO y captación anónima. **Descartada.** |

**Recomendación:** la primera. `/planes` sigue pública, pero (a) cuando llega un usuario con
sesión desde la cuenta, ofrece retorno claro a su cuenta, y (b) deja de comportarse como si no
supiera quién la mira (eso es M4 → UXV.6).

**SHELL-D4 — agrupar el sidebar (no es de producto, se propone y se cierra aquí).**
13 entradas planas no son navegación. Agrupación propuesta, derivada de las tareas reales del
vendedor y no de las URLs:

| Grupo | Entradas |
|---|---|
| **Vender** | Mis anuncios · Publicar anuncio · Estadísticas |
| **Comunicación** | Mensajes · Notificaciones · Mis alertas · Favoritos |
| **Cuenta y pagos** | Mi saldo · Mi suscripción · Datos de facturación · Mi perfil |
| **Ayuda** | Mis tickets |

**Hecho cuando:** desde cualquier pantalla de cuenta se puede volver al inicio con un clic, se ve
en qué sección se está, ninguna pantalla de la zona es inalcanzable desde la navegación, y la zona
es usable en 375 px.

---

### UXV.3 — FEEDBACK

| | |
|---|---|
| **Raíz** | M6: no hay ninguna infraestructura de notificación. `useApiAction` solo tiene canal de error ([`use-api-action.ts`](../apps/web/src/lib/api/use-api-action.ts)); no hay `sonner` ni `Toaster` en `package.json`. |
| **Resuelve** | M6, M5, M7, A7 (mitad de flujo), B4 |
| **Desbloquea** | Que tarjeta y editor no vuelvan a improvisar su propio feedback |
| **Tamaño** | **M** — una dependencia, un montaje, y tres pantallas reconvertidas |
| **Decisiones de producto** | 1 (ligera) + 1 de criterio |

Van juntos porque los tres síntomas **son el mismo agujero**: sin canal transversal, cada pantalla
inventó el suyo (o ninguno). Arreglar M5 sin montar la infraestructura sería inventar un cuarto.

#### Qué se resuelve

1. **Infraestructura de notificación** (M6): un canal único para «esto ha pasado».
2. **M5 — destacar con créditos confirma**, igual que ya hace el bump en la misma tarjeta
   («Se han descontado N créditos» / «Bump gratis usado (cuota mensual Pro)»). Las dos operaciones
   gemelas dejan de comportarse al revés.
3. **M7 — «Solicitar factura» pide confirmación y luego confirma.** El molde de confirmación ya
   está en la casa: el `AlertDialog` de Archivar/Eliminar de `MyListingCard`. Emitir un documento
   fiscal inmutable merece al menos lo mismo que archivar un anuncio. Además, cuando `canRequest`
   es false con datos fiscales completos, la pantalla debe **decir por qué** en vez de dejar un
   botón muerto.
4. **A7 (flujo) — después de comprar, ¿a dónde?** Hoy el retorno del TPV es una hoja suelta. Si el
   usuario llegó ahí porque le faltaban créditos para bumpear o destacar un anuncio concreto (los
   enlaces «Comprar créditos» de
   [`MyListingCard`](../apps/web/src/components/anuncios/MyListingCard.tsx#L381) y de
   [`DestacadoDialog`](../apps/web/src/components/anuncios/DestacadoDialog.tsx#L152)), la intención
   se pierde por el camino. **Diseño:** esos enlaces llevan de dónde vienen, y la pantalla de éxito
   ofrece volver a terminar lo que se iba a hacer. *(Requiere que el retorno del TPV conserve el
   parámetro; si no es posible con la configuración de Redsys, se degrada a «volver a mis
   anuncios», que ya es mejor que un enlace de texto.)*
5. **B4** — comprar un pack deja de sustituir la sección por un spinner: la redirección al TPV se
   anuncia sin desmontar la página.

#### Decisiones

**⬜ FEEDBACK-D1 — ¿qué librería?**

| Opción | A favor | En contra |
|---|---|---|
| **`sonner`** *(recomendada)* | Es el toast por defecto de shadcn/ui desde 2024 — el repo ya es shadcn (`components/ui/` + Radix suelto + `class-variance-authority`). Un `<Toaster/>` y una función `toast()`; sin provider ni reducer. | Una dependencia nueva (~5 kB). |
| **`@radix-ui/react-toast`** | Misma familia que las 12 primitivas Radix ya instaladas. | Es el toast *legacy* de shadcn: más aparato (provider + viewport + hook con reducer) para el mismo resultado. |

**Recomendación:** `sonner`. Es literalmente una dependencia menos de infraestructura, aunque sea
un paquete más en `package.json`.

**FEEDBACK-D2 — regla de reparto (criterio, se cierra aquí).** Sin regla, el toast se convierte en
un segundo sitio donde mirar y empeora las cosas:

| Tipo de mensaje | Dónde va | Por qué |
|---|---|---|
| Éxito de una acción puntual (bump aplicado, destacado, anuncio guardado, cupón canjeado, factura emitida) | **Toast** | Es transitorio y el usuario ya está mirando a otra parte. |
| Error de validación de un campo | **Inline, junto al campo** — sin cambios | El usuario tiene que corregir *ahí*. |
| Error de una acción con contexto (saldo insuficiente + enlace a comprar) | **Inline, donde está el botón** — sin cambios | Lleva una acción de recuperación anclada al sitio. |
| Estado persistente (cuota Pro restante, saldo, datos fiscales incompletos) | **En la página** — sin cambios | No es un evento; es estado. Un toast lo escondería. |

**Hecho cuando:** ninguna acción de la zona termina en silencio, ninguna acción irreversible se
ejecuta sin confirmar, y el usuario que sale a comprar créditos puede volver a lo que iba a hacer.

---

### UXV.4 — TARJETA de anuncio

| | |
|---|---|
| **Raíz** | `MyListingCard`: una fila `flex-wrap` con hasta 12 botones, todos `variant="outline" size="sm"`. |
| **Resuelve** | A6, A5, M10, B3, transversal 2 (`ListingOwnerActions`) |
| **Desbloquea** | **Bump automático** — es donde vivirá su estado y su punto de entrada |
| **Tamaño** | **M/L** — un componente denso, más la unificación con la segunda superficie |
| **Decisiones de producto** | **2, para confirmar** |

Van juntos porque **el problema es el reparto del espacio de la tarjeta**: no se puede añadir «Ver
anuncio» (A5) ni un acceso a estadísticas por anuncio (M10) ni el futuro estado de bump programado
a una fila que ya está desbordada. Hay que decidir la jerarquía primero, y entonces todo cabe.

#### Qué se resuelve

1. **Jerarquía de acciones** (A6) — ver decisión TARJETA-D1.
2. **«Ver anuncio»** (A5): enlace a `/anuncio/[slug]`. El `slug` ya viaja en `ListingSummary`
   ([`types/index.ts:209`](../apps/web/src/types/index.ts#L209)). Solo tiene sentido para estados
   con página pública; para `DRAFT`/`PENDING_REVIEW` no hay destino y el enlace no se ofrece.
3. **Estadísticas por anuncio** (M10): entrada desde la tarjeta a las estadísticas de *ese*
   anuncio, en lugar de la pantalla global con un `<Select>` de N.
4. **Recuentos en las pestañas de filtro** (B3), en `MisAnunciosClient`: 9 pestañas mudas obligan a
   pinchar para descubrir qué hay detrás.
5. **Unificar las dos superficies de propietario** (transversal 2): `MyListingCard` y
   [`ListingOwnerActions`](../apps/web/src/components/anuncios/ListingOwnerActions.tsx) hacen lo
   mismo con nombres distintos («Bump N cr.» vs «Subir al inicio (bump)»), con coste visible en una
   y no en la otra, y con confirmación en una y no en la otra. **Diseño:** una sola pieza de
   acciones de propietario, parametrizada por contexto (lista compacta vs ficha), no dos.

#### Decisiones

**⬜ TARJETA-D1 — la jerarquía. ¿Cuál es la acción primaria?**

Propuesta de reparto en tres niveles:

| Nivel | Contenido | Criterio |
|---|---|---|
| **Primaria** (1 botón destacado) | **Promocionar** | Es la acción que genera ingreso y la que el vendedor repite. Es también donde entra el bump automático. |
| **Secundarias** (inline, 2-3) | **Editar**, **Ver anuncio**, y **la acción de estado que toque ahora** (Publicar si `DRAFT`, Pausar si `ACTIVE`, Reactivar si `PAUSED`, Renovar si `EXPIRED`…) | Frecuentes y no destructivas. Que sea *una* según el estado, y no todas a la vez, es lo que descarga la fila. |
| **Menú** (⋯) | Reservar, Marcar vendido / Registrar cliente, Renovar, Estadísticas, ¿Necesitas ayuda?, **Archivar**, **Eliminar** | Poco frecuentes o destructivas. Las dos destructivas conservan su `AlertDialog` actual. |

**Lo que hay que confirmar:** que la primaria sea **Promocionar** y no **Editar**. Argumento a
favor de Promocionar: es la que monetiza y la que va a crecer (bump automático). Argumento a favor
de Editar: es la que más se usa en el día a día de un vendedor con pocos anuncios. **Recomendación:
Promocionar**, con Editar como primera secundaria muy visible.

**⬜ TARJETA-D2 — ¿«Destacar» y «Bump» se fusionan en un solo «Promocionar»?**

| Opción | A favor | En contra |
|---|---|---|
| **Fusionar en un diálogo de promoción** *(recomendada)* | Un solo punto de entrada; el diálogo explica la diferencia entre los dos productos (que hoy el usuario tiene que deducir de dos botones sueltos); **es donde entra «programar bump» sin volver a tocar la tarjeta**. El molde ya existe: [`DestacadoDialog`](../apps/web/src/components/anuncios/DestacadoDialog.tsx) ya elige duración, forma de pago (cuota Pro / créditos / tarjeta), muestra saldo y avisa de lo que consume. | El bump pasa de un clic a dos. Es la operación más repetida. |
| **Mantener dos botones** | El bump sigue a un clic. | La tarjeta se queda sin sitio para el estado y los controles del bump programado — es decir, no desbloquea el proyecto 2. |

**Recomendación:** fusionar, **pero** conservando el bump a un clic cuando es gratis (cuota Pro o
saldo de bumps): en ese caso el botón puede seguir ejecutando directo, porque no hay nada que
elegir ni que cobrar. Esa es la mitad del argumento en contra, neutralizada.

#### Enganche que deja preparado (no se diseña aquí)

- **Estado:** la tarjeta ya tiene una línea de estado promocional (`featuredUntil` → «Destacado
  hasta…», [`MyListingCard.tsx:160-168`](../apps/web/src/components/anuncios/MyListingCard.tsx#L160-L168)).
  Esta tanda la deja como **una zona de estado promocional**, no como un caso suelto, para que
  «Próximo bump: …» sea una línea más y no una reestructuración.
- **Entrada:** «Promocionar» es el punto de entrada del futuro diálogo con su pestaña de
  programación.

**Hecho cuando:** la tarjeta se lee de un vistazo en móvil, desde ella se llega al anuncio
publicado y a sus estadísticas, las acciones destructivas no comparten peso con las cotidianas, y
las dos superficies de propietario dicen lo mismo.

---

### UXV.5 — EDITOR de anuncio

| | |
|---|---|
| **Raíz** | Editar reusa el wizard de alta: `StepIndicator` no clicable y guardado solo en el último paso. |
| **Resuelve** | A4 (+ cancelar, + aviso de cambios sin guardar) |
| **Desbloquea** | **Vídeo PRO** (cableado de `proStatus` + un sitio donde ponerlo) |
| **Tamaño** | **M** — recomposición de una pantalla; los `Step*` se reusan tal cual |
| **Decisiones de producto** | 1 (de patrón, para confirmar) |

Va solo porque es una raíz independiente y porque es la única tanda cuyo resultado condiciona el
proyecto de vídeo.

#### Qué se resuelve

1. **Editar deja de ser un alta.** Publicar es un proceso guiado (el usuario no sabe qué falta);
   editar es una corrección puntual (el usuario sabe exactamente a qué viene). Son dos tareas
   distintas con la misma UI.
2. **Guardar siempre disponible**, no solo al final.
3. **Cancelar explícito** y **aviso de cambios sin guardar**: hoy pinchar el sidebar descarta todo
   en silencio — y a partir de UXV.2 el sidebar está *más* a mano, así que esto pasa de molestia a
   necesidad.
4. **Cableado de `proStatus`** hasta el wizard. Hoy la página de editar ni siquiera llama a
   `getProStatus`, y ninguno de los dos wizards lo recibe.

#### Decisión

**⬜ EDITOR-D1 — ¿secciones en una página, o wizard con indicador clicable?**

| Opción | A favor | En contra |
|---|---|---|
| **Una página, secciones apiladas, barra de guardado fija** *(recomendada)* | Es lo que la tarea pide: ver todo, tocar una cosa, guardar. Los cinco `Step*` ya son componentes independientes que reciben `data` / `onChange` / `errors`, así que se apilan sin reescribirlos. La validación por paso ya existe por `id` y puede ejecutarse entera al guardar. **Y da sitio natural al vídeo**: una sección más junto a Fotos. | Pantalla más larga en móvil (mitigable con secciones plegables). Cambio más visible respecto de hoy. |
| **Wizard con `StepIndicator` clicable + guardar global** | Cambio mínimo; conserva la simetría visual con publicar. | Sigue siendo un proceso lineal disfrazado: paso a paso para una tarea que no lo es. Deja A4 a medias. |

**Recomendación:** la primera. Es más trabajo, pero la segunda deja la fricción principal viva y
habría que rehacerla al meter vídeo.

#### Enganche que deja preparado (no se diseña aquí)

- **`proStatus` llega al editor.** Con eso, la sección de vídeo puede existir y gatearse.
- **El molde del gate PRO ya está escrito** y verificado:
  [`EstadisticasClient.tsx:164-176`](../apps/web/src/components/anuncios/EstadisticasClient.tsx#L164-L176)
  — card punteada + `Lock` + copy de lo que desbloquea + `[Hazte Pro]` → `/planes`. Se replica; no
  se inventa uno nuevo.
- **La maquinaria de pasos condicionales sigue disponible** si al final se prefiere sección
  separada: [`resolveActiveSteps`](../apps/web/src/components/publicar/PublicarWizard.tsx#L71-L79),
  ya usada para *atributos* y *etiquetas*.
- **`PublicarWizard` queda como está en esta tanda.** Editar y publicar son tareas distintas y
  divergen a propósito. *(Si vídeo debe existir también en el alta, se cablea `proStatus` allí en
  el proyecto de vídeo, no aquí.)*

**Hecho cuando:** cambiar el precio de un anuncio cuesta abrir, tocar y guardar; salir sin guardar
avisa; y el editor sabe si el usuario es Pro.

---

### UXV.6 — PULIDO (monetización coherente y remates)

| | |
|---|---|
| **Raíz** | Ninguna común: es lo que queda cuando las cuatro raíces están cerradas. Se agrupa por **superficie**, no por causa. |
| **Resuelve** | M4, M8, M9, M11, M12, B1, B5, B6 |
| **Desbloquea** | Nada |
| **Tamaño** | **S/M** — muchos puntos pequeños e independientes |
| **Decisiones de producto** | 1 (M4, de contenido) |

Se deja para el final a propósito: **varios de estos puntos cambian de forma según lo que se decida
antes.** Los estados vacíos (B5) dependen del shell y del feedback; la visibilidad de cuotas (M12)
depende de dónde acabe el estado promocional en la tarjeta.

| # | Qué | Nota |
|---|---|---|
| **M4** | `/planes` deja de prometer lo que no da (la lista hardcodeada omite destacados gratis y cuota de bumps, que son los beneficios que la app *sí* concede) y deja de ofrecer «Hazte Pro» a quien ya lo es. | ⬜ **Confirmar el contenido de la lista de beneficios Pro** — es copy de producto, no organización. |
| **M12** | Las dos cuotas Pro (destacados y bumps) se ven en el mismo sitio y **también cuando están agotadas** — hoy el aviso desaparece al llegar a 0 y no se distingue de «no soy Pro». | Encaja con la zona de estado promocional de UXV.4. |
| **M9** | Paginación real en los historiales de `/mis-creditos`: la API ya devuelve `page/perPage/totalPages` y la página los ignora. | |
| **M8** | El formulario de cupón se puede volver a usar sin recargar. | |
| **M11** | «Contacta con soporte» enlaza a `/mis-tickets/nuevo`, como ya hacen la tarjeta y el panel de facturas. | |
| **B1** | Un solo nombre para el monedero (hoy: nav «Mis créditos», `<title>` «Mi saldo», URL `/mis-creditos`). La URL puede quedarse; el nombre visible, no. | |
| **B5** | Estados vacíos homogéneos: los cinco de la zona dicen qué pasa y ofrecen la salida, como ya hace el de «sin anuncios». | |
| **B6** | El banner promocional deja de ir por encima del `<h1>` de los anuncios del usuario. | |

**B2** (Stripe para Pro, Redsys para créditos y destacados) se deja **anotado y sin acción**: es
una decisión de negocio, no de UX. Lo que sí se cierra es la asimetría de calidad entre sus
retornos, y eso ya lo hacen UXV.1 y UXV.3.

---

## 3. El orden, razonado

```
UXV.1 BUGS ──► UXV.2 SHELL ──► UXV.3 FEEDBACK ──► UXV.4 TARJETA ──► UXV.5 EDITOR ──► UXV.6 PULIDO
    │                                                   │                  │
    └──────────────► desbloquea ────────────────────────┴──► BUMP AUTO     └──► VÍDEO PRO
```

| Orden | Tanda | Por qué aquí |
|---|---|---|
| 1.º | **UXV.1 BUGS** | Barata, sin decisiones y sin depender de nada. A2 es además prerequisito del bump automático: programar bumps sobre una ventana temporal que el front calcula mal daría conflictos desde el primer día. Que vaya primero también evita rediseñar una tarjeta con un botón que miente. |
| 2.º | **UXV.2 SHELL** | **Todo lo demás vive dentro.** Rediseñar la tarjeta o el editor antes de decidir el shell obliga a rehacer el trabajo responsive dos veces: hoy el contenido dispone de ~87 px en 375 px, así que cualquier decisión de layout tomada ahora se toma sobre una anchura falsa. Y es la raíz de más síntomas (5 + un transversal). |
| 3.º | **UXV.3 FEEDBACK** | Es infraestructura que las dos tandas siguientes van a usar. Si va después, tarjeta y editor vuelven a inventarse su propio mensaje de éxito y hay que deshacerlo. *(Es la única tanda que podría adelantarse o paralelizarse con UXV.2 sin romper nada: el `<Toaster/>` va en el layout raíz, que UXV.2 no toca.)* |
| 4.º | **UXV.4 TARJETA** | Ya tiene shell (sabe cuánto ancho tiene) y feedback (no inventa el suyo). Al terminar, **bump automático está desbloqueado**. |
| 5.º | **UXV.5 EDITOR** | Podría ir antes que la tarjeta —no dependen entre sí—, pero va después porque desbloquea el proyecto que viene más tarde y porque la tarjeta estorba más a diario. Al terminar, **vídeo PRO está desbloqueado**. |
| 6.º | **UXV.6 PULIDO** | Al final porque varios de sus puntos cambian de forma según lo decidido en las anteriores. |

**Confirmación del criterio de la auditoría:** sí, shell y móvil van primero — pero **detrás de los
bugs**, no delante. Los bugs no dependen del shell, cuestan poco y uno de los dos desbloquea un
proyecto entero; retrasarlos detrás de una tanda de tamaño M no lo justifica nada.

**Si hubiera que parar a mitad:** el corte natural es después de UXV.4. Con UXV.1–UXV.4 la zona ya
es navegable, usable en móvil, honesta con lo que hace y lista para el bump automático. UXV.5 y
UXV.6 son mejoras acumulativas, no cierres de agujero.

---

## 4. Decisiones que necesitan confirmación de Ernest

Ninguna tanda debería empezar sin cerrar las suyas.

| # | Tanda | Decisión | Recomendación | Qué cambia según la respuesta |
|---|---|---|---|---|
| **SHELL-D1** | UXV.2 | ¿Cabecera de cuenta = `Header` pública, o cabecera propia? | **Reusar `Header`** | Si es propia: hay que decidir qué lleva (¿buscador? ¿campana?) y se asume un segundo componente que mantener. |
| **SHELL-D2** | UXV.2 | En móvil, ¿drawer o barra inferior? | **Drawer** | La barra inferior obliga a elegir 4-5 destinos de primera y a esconder el resto — reabre M2. |
| **SHELL-D3** | UXV.2 | ¿`/planes` se queda en `(public)`? | **Sí, con retorno explícito** | Si se duplica dentro del shell: dos superficies de precios que se desincronizan. |
| **TARJETA-D1** | UXV.4 | ¿La acción primaria es **Promocionar** o **Editar**? | **Promocionar** | Determina qué ve primero el vendedor en cada anuncio y dónde crece el bump automático. |
| **TARJETA-D2** | UXV.4 | ¿«Destacar» + «Bump» se fusionan en «Promocionar»? | **Sí**, manteniendo el bump a un clic cuando es gratis | Si no se fusionan, la tarjeta se queda sin sitio para el bump programado y habría que rehacerla en el proyecto 2. |
| **EDITOR-D1** | UXV.5 | ¿Secciones en una página, o wizard con indicador clicable? | **Secciones en una página** | El wizard clicable es más barato pero deja A4 a medias y habría que rehacerlo al meter vídeo. |
| **M4-copy** | UXV.6 | Contenido real de la lista de beneficios Pro | — | Es copy de producto: hoy la lista omite destacados gratis y cuota de bumps. |

---

## 5. Moldes verificados (lo que se reusa, no se inventa)

| Molde | Dónde está | Para qué |
|---|---|---|
| Estado activo en sidebar | [`AdminNav.tsx:45-46`](../apps/web/src/app/(admin)/components/AdminNav.tsx#L45-L46) | UXV.2 (M1) |
| Breadcrumb | `<nav aria-label="Breadcrumb">` inline en [`busqueda/page.tsx:240`](../apps/web/src/app/(public)/busqueda/page.tsx#L240) y [`CategoryListingPage.tsx:384`](../apps/web/src/components/categorias/CategoryListingPage.tsx#L384) — **patrón sí, componente no**: procede extraerlo | UXV.2 (M1) |
| Drawer | `@radix-ui/react-dialog`, ya instalado y ya usado por [`components/ui/dialog.tsx`](../apps/web/src/components/ui/dialog.tsx) | UXV.2 (A3) |
| Página de éxito que **resuelve** | [`planes/exito/page.tsx`](../apps/web/src/app/(public)/planes/exito/page.tsx) | UXV.1 (A7) |
| Confirmación de acción irreversible | `AlertDialog` de Archivar/Eliminar, [`MyListingCard.tsx:454-517`](../apps/web/src/components/anuncios/MyListingCard.tsx#L454-L517) | UXV.3 (M7) |
| Diálogo de compra de promoción | [`DestacadoDialog.tsx`](../apps/web/src/components/anuncios/DestacadoDialog.tsx) | UXV.4 + enganche bump-auto |
| Zona de estado promocional | [`MyListingCard.tsx:160-168`](../apps/web/src/components/anuncios/MyListingCard.tsx#L160-L168) (`featuredUntil`) | UXV.4 + enganche bump-auto |
| Gate PRO | [`EstadisticasClient.tsx:164-176`](../apps/web/src/components/anuncios/EstadisticasClient.tsx#L164-L176) | Enganche vídeo |
| Pasos condicionales | [`resolveActiveSteps`](../apps/web/src/components/publicar/PublicarWizard.tsx#L71-L79) | Enganche vídeo |
| Entrada contextual a soporte | `?listingId=` / `?invoiceId=` hacia `/mis-tickets/nuevo` | UXV.6 (M11) |

---

## 6. Qué NO entra

- **Estética** (colores, tokens, densidad, iconografía). Decisión de Ernest.
- **Bump automático y vídeo PRO.** Este documento solo deja la superficie preparada.
- **`PublicarWizard`.** Solo se toca `EditarWizard`: publicar es un proceso guiado y editar no.
- **La elección de pasarela** (Stripe vs Redsys, B2). Decisión de negocio.
- **`MainNav` en `(account)`.** Descartado por la decisión de partida #5.
