# Diseño — la reorganización de la navegación del backoffice (punto 3)

> **Qué es esto.** El diseño corto del punto 3 del lote de retoques: renombrar el
> dashboard (3a), la barra desplegable y navegable en móvil (3b), y que «Motivos de
> contacto» deje de ocupar el primer nivel **sin revertir R2** (3c). Los tres van
> juntos porque son un solo problema: la barra lateral.
>
> Base: `docs/auditoria-retoques-backoffice.md` §3 · la fuente única de R1
> (`config/backoffice-sections.ts`) · el shell de la zona de cuenta (UXV.2).
>
> **Cero código.** Todo lo que se afirma está leído en el repo, con fichero y línea.

---

## 0. El veredicto, en una tabla

| | Qué se hace | Coste | Toca la fuente única |
|---|---|---|---|
| **3a** | `Dashboard` → **`Resumen`** | un `label` | sí, un campo |
| **3b** | Grupos en la barra + **drawer de móvil**, molde UXV.2 | UI + un campo en el modelo | sí, `group` + `navGroupsFor` |
| **3c** | Motivos de contacto pasa a ser **el tercer ítem del grupo «Atención al usuario»** | ninguno propio: sale gratis de 3b | no, más allá de 3b |

**La tesis del documento:** 3c no necesita ninguna mecánica nueva. En cuanto la barra
tiene grupos, «primer nivel» deja de ser el único nivel — y una sección que baja al
segundo **no está oculta**, así que los invariantes de R2 siguen siendo ciertos sin
tocar una línea de ellos.

---

## 1. Lo que hay hoy, verificado

**`AdminNav.tsx` son 58 líneas y sólo pinta.** `navSectionsFor(role).map(…)` → un
`<Link>` por sección, lista **plana**, sin estado, sin props, sin agrupar. Es
deliberado y está escrito: «Ahora este componente **solo pinta**: qué secciones
existen, cómo se llaman, en qué orden van y qué rol las ve sale de
`config/backoffice-sections.ts`» (`AdminNav.tsx:18-22`).

**El modelo NO soporta grupos.** `BackofficeSection` tiene exactamente cinco campos:
`id`, `route`, `label`, `minRole` y `exact` (`backoffice-sections.ts:56-81`). Hay que
**ampliarlo** — no hay dónde colgar un grupo hoy.

**`navSectionsFor` tiene UN solo consumidor de producción**, `AdminNav.tsx:30`. Grep
exhaustivo: no hay otro. Es la mejor situación posible para este cambio.

**En móvil el backoffice no está roto: está inutilizable, y es el defecto A3 otra
vez.** `(admin)/layout.tsx:22`:

```tsx
<aside className="w-56 shrink-0 border-r bg-muted/30 p-4">   // ← ni un breakpoint
<main className="flex-1 p-8">                                 // ← sin min-w-0
```

En 375 px el aside se lleva 224 px y deja ~151 px de contenido (con `p-8` restando 64
más: **~87 px útiles**). Y sin `min-w-0`, un hijo de flex no baja de su contenido: las
tablas de `/admin/anuncios` y `/admin/facturas` desbordan y el `<body>` scrollea en
horizontal. **Las dos mitades del defecto, las dos presentes.**

**El orden actual es plano y declarado como tal.** «EL ORDEN DE ESTA LISTA ES EL ORDEN
DE LA BARRA LATERAL. Es el mismo que tenía `NAV_ITEMS`, **conservado literalmente para
que el refactor no mueva ni un ítem de sitio**» (`backoffice-sections.ts:83-88`). Esa
restricción era de R1 —un refactor no debe mover nada— y **esta ráfaga es justo la que
viene a moverlo**: el comentario hay que reescribirlo, no respetarlo.

---

## 2. El molde ya existe, y no es una analogía

`backoffice-sections.ts:27` dice: «**Molde: `config/account-nav.ts` (UXV.2)**, la
fuente única de la zona de cuenta». Ese fichero, leído hoy:

- **ya tiene grupos** — `AccountNavGroup { title, items }`, con la razón escrita:
  «Trece entradas planas no son navegación; agrupadas se leen de un vistazo»
  (`account-nav.ts`, SHELL-D4);
- **agrupa por la TAREA, no por la forma de la URL** — por eso «Datos de facturación»,
  que cuelga de `/perfil`, vive con los pagos;
- y lo consumen **tres** superficies: el `<aside>` de escritorio, **el drawer de
  móvil** y las migas.

Y el defecto que UXV.2 cerró es, palabra por palabra, el que el backoffice tiene hoy:

> «**A3**: el `<aside>` no llevaba un solo breakpoint. En 375 px se quedaba con 224 px
> y dejaba ~87 px de contenido.» — `(account)/layout.tsx:17-18`

**Con su solución escrita:** `hidden md:block` en el aside, `min-w-0` en el `<main>`,
un `AccountMobileBar` sobre `@radix-ui/react-dialog` («YA instalado… cero dependencias
nuevas», `AccountMobileBar.tsx:22-23`), **un único componente de nav para las dos
superficies** («no pueden ofrecer destinos distintos según el tamaño de pantalla»,
`AccountNav.tsx:15-17`), y cierre del drawer al navegar vía `onNavigate`.

> **Consecuencia de método:** el punto 3 no diseña nada nuevo. **Copia UXV.2**, que ya
> resolvió este problema para trece entradas, a un sitio que tiene veintidós.

---

## 3. 3a — el renombrado

**`Dashboard` → `Resumen`.** Un campo en `backoffice-sections.ts:94`.

Por qué «Resumen» y no «Panel» ni «Inicio»:

- la pantalla **son agregados** —activos, en revisión, usuarios totales, cola, estado
  del índice—, y así lo declara el propio mapa (`backoffice-sections.ts:90-93`).
  «Resumen» dice qué hay dentro; «Panel» sólo dice que es una pantalla;
- «Inicio» compite con la portada pública del marketplace, que es *el* Inicio del
  producto;
- la cabecera del shell ya dice **«Backoffice»** (`layout.tsx:14-16`), así que el
  primer ítem no necesita repetir dónde estás.

*(Runner-up: «Panel», si se prefiere el término genérico.)*

**Rompe exactamente una aserción:** `admin-roles.spec.ts:88`,
`getByRole('link', { name: 'Dashboard' })`. Se actualiza — el hecho cambió a
propósito.

---

## 4. 3b — la estructura

### 4.1 El modelo: un campo en la fuente única, no una segunda lista

```
group: BackofficeGroupId | null      ← en cada una de las 22 filas
BACKOFFICE_GROUPS: { id, title }[]   ← sólo el ORDEN y el TÍTULO de los grupos
```

Tres decisiones dentro:

- **La pertenencia vive en la fila, no en el grupo.** Un `BACKOFFICE_GROUPS` que
  listara ids de sección sería una segunda lista de membresía que puede desincronizarse
  con la primera — exactamente las «tres listas mantenidas a mano» que R1 eliminó. Así,
  `BACKOFFICE_GROUPS` sólo aporta título y orden, y **no puede** contradecir al mapa
  sobre quién pertenece a qué.
- **`| null` explícito, no `group?:` opcional.** Sólo el dashboard va suelto (arriba de
  todo, como raíz de las demás). Con opcional, olvidarse del campo produce un huérfano
  silencioso — la forma suave del defecto R3. Con `| null`, TypeScript obliga a
  escribirlo y **un test fija que exactamente una sección lo tiene y es la raíz**.
- **El orden dentro de cada grupo sigue siendo el orden de `BACKOFFICE_SECTIONS`.** No
  hay campo `order`: una sola fuente para el orden, igual que hoy.

### 4.2 La regla que preserva R1 y R2, y es la pieza clave

**`navGroupsFor(role)` se implementa SOBRE `navSectionsFor(role)`, nunca en paralelo.**

```
navGroupsFor(role) = agrupar( navSectionsFor(role) )
```

`navSectionsFor` **no cambia**: misma firma, mismo resultado plano, mismo contrato.
Sigue siendo la respuesta a «qué ve este rol», y los cuatro invariantes de R2 siguen
midiendo lo que de verdad se pinta.

Si `navGroupsFor` volviera a filtrar por `atLeast(role, minRole)` por su cuenta,
tendríamos **dos reglas de visibilidad** y los tests de R2 pasarían a vigilar una
función que ya no alimenta al nav — el defecto de R1 reencarnado en otro sitio. No es
un detalle de estilo: es la única forma de que este cambio sea aditivo de verdad.

**Un test nuevo lo fija:** `navGroupsFor(role).flatMap(g => g.items)` es, en ids y en
orden, **idéntico** a `navSectionsFor(role)`, para los cuatro roles. Con eso, agrupar
es demostrablemente **no destructivo**: no puede perder ni añadir una sección.

Y dos guardas más: **ningún grupo se renderiza vacío** (un EDITOR ve 7 secciones; los
grupos de moderación no deben aparecer como títulos huecos), y **todo `group` declarado
existe en `BACKOFFICE_GROUPS`**.

### 4.3 Los grupos propuestos — por tarea, no por rol ni por URL

| Grupo | Secciones | n |
|---|---|---|
| *(raíz, sin grupo)* | **Resumen** | 1 |
| **Moderación** | Anuncios · Cola de revisión · Usuarios · Reportes | 4 |
| **Atención al usuario** | Tickets · Mensajes de contacto · **Motivos de contacto** | 3 |
| **Catálogo** | Categorías · Tags | 2 |
| **Contenido** | Blog · Páginas · Portada · Footer · Navegación | 5 |
| **Promoción** | Campañas · Cupones · Banners · Patrocinados | 4 |
| **Plataforma** | Facturación · Facturas · Ajustes | 3 |

**22 en total** — las mismas 22, ninguna nueva, ninguna fuera.

Notas de reparto:

- **Usuarios va en Moderación, no en Atención.** Desde ahí se suspende, se banea y se
  marca para revisión previa: es el trabajo de moderar, no el de atender.
- **Plataforma son las tres ADMIN**, y no es agrupar por rol: el propio mapa ya las
  piensa juntas — «ADMIN (22) todo **+ el dinero y la configuración** — facturación,
  facturas, ajustes» (`backoffice-sections.ts:39-40`). Que coincidan con el piso ADMIN
  es consecuencia, no criterio.
- **Sí reordena respecto a hoy** (Facturación y Facturas bajan del puesto 7-8 al final,
  Portada sube junto a Blog). Es deliberado: la restricción «no mover ni un ítem» era
  de un refactor, y esto es la reorganización.

### 4.4 Los grupos nacen ABIERTOS, y ése es el argumento del documento

Se pliegan a mano; **nunca por defecto**. Dos razones, y la primera es la que importa:

1. **Un nav que esconde destinos por defecto reabre R3 en versión suave.** El defecto
   que costó dos ráfagas era «una sección alcanzable que nadie encuentra». Un grupo
   cerrado de fábrica produce lo mismo para quien no sepa que hay que abrirlo. Que
   plegar sea **un acto del usuario** es lo que separa «lo tengo recogido» de «no sé
   que existe».
2. **Es lo que mantiene verdes las siete aserciones de DOM.** Con los grupos abiertos,
   los 22 `<Link>` siguen renderizados y visibles: los cuatro `toHaveCount` (7/19/22 y
   el de la cabecera), la visibilidad de «Motivos de contacto» y el link «Navegación»
   de `nav-admin.spec.ts:93` no se enteran del cambio.

*(Consecuencia práctica: si algún día se quiere que un grupo recuerde su estado
plegado, ese estado es del usuario —no del código— y sale del navegador, no del mapa.
Fuera de esta ráfaga.)*

### 4.5 Escritorio y móvil, con el reparto de UXV.2

- **Escritorio (`md+`):** `<aside>` sticky con scroll propio. Grupos con su título y
  sus ítems, plegables por título. `AdminNav` sigue derivando del mapa y sigue sin
  saber nada de roles más allá de `navGroupsFor`.
- **Móvil (`<md`):** `hidden md:block` en el aside + **drawer** sobre
  `@radix-ui/react-dialog`, molde literal de `AccountMobileBar`. **El mismo
  `AdminNav`** dentro, con `onNavigate` para cerrarse al saltar.
- **El disparador va en la cabecera del shell**, a la izquierda de «Backoffice»
  (`layout.tsx:13-18`) — y aquí se diverge un poco del molde a propósito: la zona de
  cuenta mete su botón dentro del `<main>` porque no tiene cabecera propia; el
  backoffice **sí la tiene**, y es su sitio natural.
- **`min-w-0` en el `<main>`**, que hoy falta. Es la otra mitad de A3 y sin ella las
  tablas del backoffice seguirán desbordando aunque el aside se aparte.

### 4.6 Lo que se descarta, y por qué

- **Un botón que esconde la barra entera en escritorio.** No resuelve nada: en
  escritorio sobran 224 px, y el problema real son 22 filas planas. Deja una columna en
  blanco y añade un estado más que recordar.
- **Barra inferior en móvil.** Mismo argumento que SHELL-D2: caben cuatro o cinco
  destinos de veintidós, y el resto acabaría en un «Más» que es R3 con otro nombre.
- **Barra de iconos colapsada.** Las 22 secciones **no tienen icono** en el mapa
  (`BackofficeSection` no tiene campo `icon`, a diferencia de `AccountNavItem`).
  Requeriría inventar 22 iconos y un sexto campo — mucho coste para un problema que los
  grupos ya resuelven.

---

## 5. 3c — Motivos de contacto, sin revertir R2

### El objetivo, formulado con precisión

No es «ocultarla». Es **que no ocupe una fila de primer nivel**, dado que ya se llega a
ella desde Mensajes de contacto (`admin/mensajes-contacto/page.tsx:132`, verificado).

### Las tres vías, evaluadas

| Vía | ¿Cumple? | ¿Revierte R2? | Veredicto |
|---|---|---|---|
| **A. Agrupar** — Motivos es el 3.º de «Atención al usuario» | **Sí**: deja de ser primer nivel | **No**: sigue en el nav, sigue en `navSectionsFor` | **ELEGIDA** |
| **B. Sub-ítem de Mensajes** — anidada bajo su hermana | Sí | No, pero… | Descartada (ver abajo) |
| **C. Reintroducir `hiddenFromNav`** | Sí | **Sí** | **No** |

**Por qué B no.** Anidar una sección bajo otra crea un **segundo mecanismo de jerarquía**
(nivel de grupo + nivel de sección-hija) para un solo caso en veintidós. Y afirma algo
que el mapa no dice: Motivos no *depende* de Mensajes, son hermanas —el propio mapa las
declara con el mismo piso porque comparten endpoints (`backoffice-sections.ts:139-146`,
INV-1). Un grupo que las contiene a las dos expresa esa relación con exactitud; una
madre y una hija la falsean.

**Por qué C no, y es el punto entero.** `hiddenFromNav` **existió y se borró en R2 a
conciencia**:

> «`hiddenFromNav` ha desaparecido con esta ráfaga: existía sólo para declarar la
> anomalía R3 mientras el inventario estaba congelado… ya no hay ninguna sección oculta
> y el concepto sobra.» — `backoffice-sections.ts:50-53`

Y lo que dejó en su lugar es una propiedad, no una costumbre: `navSectionsFor` y
`canAccessAdminPath` **se reducen a la misma condición**, y eso es «lo que hace
imposible, por construcción, el defecto R3» (`:255-258`). Reintroducir el flag no es
añadir un campo: es **volver a hacer posible** una sección alcanzable que no está en el
menú — y hacerlo, además, sobre la sección que fue el caso real del defecto. Pagar eso
cuando agrupar cumple el mismo objetivo sería gastar un invariante a cambio de nada.

### La verificación de que A no revierte nada

Con la vía A, «oculta» y «no está en primer nivel» dejan de ser lo mismo, y los
invariantes se siguen cumpliendo **literalmente**:

- Motivos sigue en `BACKOFFICE_SECTIONS` con su `minRole`;
- sigue en `navSectionsFor('MODERATOR')` → el test `:163` («no queda ninguna sección
  oculta») pasa **sin tocarlo**;
- sigue en el DOM del nav y visible → `admin-roles.spec.ts:86` pasa **sin tocarlo**;
- sigue alcanzable por su ruta y desde Mensajes de contacto;
- y `navGroupsFor` la contiene, porque deriva de `navSectionsFor` (§4.2).

> **En una línea:** R2 prohibió que una sección accesible desapareciera del nav. Bajar
> de nivel no es desaparecer.

---

## 6. El plan — una ráfaga

Es **una sola**: el modelo, el componente y el shell se tocan a la vez, y partirlo
dejaría un `group` declarado que nadie pinta.

**Reparto:** ~30 % modelo (`backoffice-sections.ts`: `group`, `BACKOFFICE_GROUPS`,
`navGroupsFor`, el `label` de 3a) · ~70 % UI (`AdminNav` con grupos + `onNavigate`,
`AdminMobileNav` nuevo, `(admin)/layout.tsx` con los breakpoints y el `min-w-0`).
**Cero backend, cero migración, cero cambios de permiso.**

### Las barreras

| | Qué fija | Dónde |
|---|---|---|
| **B-3a** | El primer ítem del nav se llama «Resumen» | e2e (sustituye la aserción de «Dashboard») |
| **B-3b.1** | Agrupar **no pierde ni añade** nada: `flatMap(navGroupsFor) === navSectionsFor`, en ids y orden, para los 4 roles | unit, nuevo |
| **B-3b.2** | Ningún grupo vacío; todo `group` existe; exactamente una sección con `group: null` y es la raíz | unit, nuevo |
| **B-3b.3** | En 375 px el `<main>` mide **> 300 px** y el documento **no desborda en horizontal** | e2e, molde literal de `shell-cuenta.spec.ts:105-128` |
| **B-3b.4** | El drawer abre, lista los destinos del rol, navega y **se cierra al navegar** | e2e, molde de `shell-cuenta.spec.ts:130-153` |
| **B-3c** | «Motivos de contacto» **no es de primer nivel** (está dentro de un grupo) **y sigue visible en el nav** | e2e — las dos mitades en la misma aserción |

**B-3c es la barrera anti-reversión** y por eso lleva las dos mitades juntas: la
primera sola permitiría ocultarla; la segunda sola permitiría dejarla en el primer
nivel. Sólo las dos a la vez describen lo acordado.

### Las mutaciones que deben matar

1. Quitar `hidden md:block` del aside → cae **B-3b.3**.
2. Quitar `min-w-0` del `<main>` → cae la mitad del desbordamiento de **B-3b.3**.
3. Hacer que `navGroupsFor` filtre por rol **por su cuenta** en vez de derivar de
   `navSectionsFor` → debe caer **B-3b.1** (si no cae, la barrera no vale).
4. Sacar Motivos del grupo y devolverla al primer nivel → cae **B-3c**.
5. Ocultarla en vez de agruparla → cae **B-3c** por la otra mitad, y con ella los
   invariantes `:163` y `:203` sin haberlos tocado.
6. Nacer los grupos cerrados → caen los cuatro `toHaveCount` y **B-3c**.

### Lo que hay que actualizar, y no es una rebaja

**Una sola aserción:** `admin-roles.spec.ts:88` («Dashboard» → «Resumen»). El hecho
cambió a propósito.

**Y una corrección al inventario de la auditoría:** §3 hablaba de «5 tests». Contadas
una a una son **once aserciones** — cuatro invariantes de unidad
(`backoffice-sections.test.ts:99, :163, :193, :203`) y siete de DOM
(`admin-roles.spec.ts:79, :86, :88, :522, :533, :544` y `nav-admin.spec.ts:93`). Con
este diseño **diez siguen verdes sin tocarlas**, y la que se toca es de 3a, no de 3c.

---

## 7. Lo que hace falta decidir antes de empezar

1. **El nombre del dashboard.** Recomendado **«Resumen»**; alternativa «Panel».
2. **Los títulos y el reparto de los seis grupos** (§4.3). Es la única parte
   verdaderamente opinable del diseño: el mecanismo funciona con cualquier reparto, y
   éste es una propuesta razonada, no una deducción.

Todo lo demás —el modelo, la derivación de `navGroupsFor`, el drawer, los
breakpoints y las barreras— sale del molde ya construido en UXV.2 y de los invariantes
de R1/R2, y no depende de ninguna preferencia.
