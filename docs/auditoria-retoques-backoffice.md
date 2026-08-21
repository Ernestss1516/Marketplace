# Auditoría — el lote de 7 retoques del backoffice

> **Qué es esto.** Una auditoría, no un diseño y no una implementación. Verifica los
> siete puntos del enunciado **contra el código real**, los clasifica, dice en qué se
> apoya cada uno, dónde está el riesgo de romper algo ya construido, en qué orden
> conviene hacerlos y cuáles necesitan su propio documento de diseño antes de tocar
> nada.
>
> **Base construida sobre la que caen:** roles R1–R4, borrado B1–B3, ficha de anuncio
> F1–F2, etiqueta interna E1–E2 (P1), ficha de usuario U1–U3 (P2) y edición de staff
> P3a.
>
> **Método.** Todo lo que se afirma aquí está leído en el código, con fichero y línea.
> Donde el enunciado no casa con lo que hay, se dice — en este proyecto el inventario
> ha corregido el enunciado cuatro veces, y esta auditoría lo corrige **cinco más**
> (§8).

---

## 0. Resumen ejecutivo

| # | Punto | Clasificación | Estado real | ¿Diseño propio? |
|---|---|---|---|---|
| **1** | Abrir tickets desde las fichas | Retoque acotado | **Existe el 90 % — y es backend.** El modelo, el guard y el endpoint ya soportan el vínculo. Falta la UI | No |
| **2** | Atributos + imágenes desde el backoffice | Continuación **con un agujero dentro** | **A medias, y peor de lo que parece:** el DTO ya acepta `attributes` e `imageIds`, pero el backend **ignora el orden** y **se salta tres validaciones** que el dueño sí pasa | **Sí, corto** |
| **3** | Barra lateral + móvil + renombrar + ocultar del nav | Retoque acotado **con una colisión frontal** | El renombrado y el móvil son triviales. **«Quitar Motivos de contacto del menú» reintroduce exactamente el defecto que R1/R2 cerraron** | No, pero exige **una decisión** |
| **4** | Traducciones al español de las fichas | Retoque acotado | **No existe.** 12 sitios pintando el enum crudo; el molde para arreglarlo ya está escrito | No |
| **5** | Última IP + filtrar + ordenar + fecha/hora | **Sustancia** | **No existe nada.** Sin columnas, sin puntos de escritura, y con **una fuga de IP ya abierta** que nadie ha declarado | **Sí** |
| **6** | Listas de bloqueo (IP/teléfono) + sistema que avisa | **Casi un cuerpo** | **Existe un tercio, y el tercio que existe no sirve para IPs ni teléfonos** (el tokenizador los parte) | **Sí, obligatorio** |
| **7** | Valoraciones en la ficha + editar + eliminar | Visualización acotada **+ borrado de riesgo alto** | Se ven a medias; editar/eliminar de staff **no existe**, y borrar una valoración **destruye sus denuncias** (`Cascade`) | **Sí, la parte de borrado** |

**El orden propuesto (§10):** `4 → 3 → 1 → 2 → 7a → 5 → 7b → 6`.

---

## 1. Abrir tickets desde las fichas (anuncio y usuario)

### Qué hay HOY — verificado

**El modelo de `Ticket` ya lo soporta entero.** `schema.prisma:2551-2570` declara
cuatro enlaces polimórficos, todos nullable y todos `SetNull`:

```prisma
listingId String?   // → Listing,  SetNull
reviewId  String?   // → Review,   SetNull
invoiceId String?   // → Invoice,  SetNull
reportId  String?   // → Report,   SetNull
userId    String    // → User,     Cascade  ← EL USUARIO DEL HILO, siempre exactamente uno
linkedLabel String? // snapshot del título/número, derivado en el servidor
```

Y hay índice por `listingId` (`schema.prisma:2593`), así que «los tickets de este
anuncio» ya es una consulta barata — de hecho la ficha de anuncio ya la pinta
(`anuncios/[id]/page.tsx:702-717`).

**El endpoint ya existe y ya acepta los enlaces.** `POST /admin/tickets`
(`admin-tickets.controller.ts:225-241`, `@MinRole(MODERATOR)` de clase) recibe
`CreateAdminTicketDto`, que declara `userId`, `subject`, `body`, `topicId` y los tres
enlaces (`create-admin-ticket.dto.ts:44-57`).

**El vínculo ya se valida y la etiqueta ya se deriva en el servidor.**
`assertLinkable` (`tickets.service.ts:248-307`) comprueba propiedad, prohíbe dos
enlaces a la vez y construye `linkedLabel` desde el título/número real.

**Lo único que falta es la interfaz.** `/admin/tickets/nuevo` sólo envía
`userId`, `subject`, `body` y `topicId` — **no ofrece ningún campo de enlace ni lee
parámetros de la URL** (`admin/tickets/nuevo/page.tsx:69-72`). Y ninguna de las dos
fichas tiene botón de «abrir ticket».

### Clasificación

**Retoque acotado, y sorprendentemente barato.** Es el punto con mejor relación
valor/riesgo del lote: cero migraciones, cero cambios de modelo, cero backend nuevo.

### En qué se apoya

`Ticket` (R1/R2 de atención al usuario) + las dos fichas (F1, U3) + la página
`/admin/tickets/nuevo`.

### Dónde está el riesgo

**Riesgo bajo, pero hay una restricción del guard que condiciona el diseño de la UI y
conviene no descubrirla con un 422 en pantalla.**

`assertLinkable` valida el anuncio **contra el usuario destinatario del hilo**, no
contra el agente (`tickets.service.ts:366` y el comentario de `:360-365`: enlazar la
entidad de un tercero le filtraría ese dato al usuario del hilo, porque `linkedLabel`
**se le sirve a él**). Consecuencias, ya decididas por el código:

- **Desde la ficha de un anuncio**, el ticket sólo puede abrirse **con el vendedor de
  ese anuncio**. `userId = listing.sellerId` no es una comodidad: es la única
  combinación que el guard acepta. Eso responde la pregunta del enunciado
  («¿y su dueño?») — **sí, obligatoriamente**.
- **Desde la ficha de un usuario**, el vínculo es `Ticket.userId` y ya está. No hace
  falta nada más: «vinculado a ese usuario» es lo que un ticket es por construcción.
- El enunciado dice «vinculando usuario **y/o** anuncio». El código dice **un solo
  enlace**: `provided.length > 1` → 422 `MULTIPLE_LINKED_ENTITIES`
  (`tickets.service.ts:256-261`), porque `linkedLabel` es un único snapshot. No es una
  limitación que haya que levantar: usuario y anuncio **no compiten** (el usuario es
  `userId`, el anuncio es `listingId`), así que el «y» del enunciado ya se cumple.

### Qué haría falta

Un botón en cada ficha que navegue a `/admin/tickets/nuevo?userId=…[&listingId=…]`, y
que esa página lea los parámetros, precargue el destinatario (saltándose el buscador de
usuarios cuando viene dado) y pinte el contexto enlazado. Nada más.

---

## 2. Editar atributos + eliminar/reordenar imágenes (continuación de P3a)

### Qué hay HOY — verificado

Aquí el inventario corrige el enunciado en las dos direcciones: **hay más de lo que se
supone en el backend y menos de lo que parece en la práctica.**

**El DTO de P3a YA acepta las dos cosas** (`update-admin-listing.dto.ts:70-83`):

```ts
@IsOptional() @IsObject()  attributes?: Record<string, unknown>;
@IsOptional() @IsArray()   imageIds?: string[];   // «Sustituye la lista completa»
```

**Los atributos ya funcionan de verdad.** `AdminService.updateListing` los escribe
(`admin.service.ts:754`) y —lo importante— la validación de atributos por categoría
**con profundidad** ya corre por el mismo camino que el dueño: el `fields` completo
pasa por `ListingEditValidationService.validarEdicion` (`admin.service.ts:732-736`),
que es el bloque extraído tal cual en P3a. **No hay que reusar nada: ya está reusado.**

**El cliente del frontend también los acepta ya** — `updateAdminListing` declara
`attributes` e `imageIds` en su firma (`lib/api/admin.ts:282-306`).

**Lo que falta es la UI**: la ficha sólo edita título, descripción y precio
(`anuncios/[id]/page.tsx:143-147`). Los atributos se pintan **de sólo lectura**
(`:621-641`) y las imágenes también (`:481-483`).

### El agujero que el enunciado no menciona, y es el hallazgo de este punto

El tratamiento de `imageIds` en el camino de staff (`admin.service.ts:766-777`) **no
es el del dueño**. Puestos uno al lado del otro:

| | Dueño (`listings.service.ts:396-404` → `linkImages:1574-1619`) | Staff (`admin.service.ts:766-777`) |
|---|---|---|
| Desvincula lo que sale (`listingId: null`) | Sí | Sí |
| **Escribe el `order` según la posición del array** | **Sí** (`:1611-1618`) | **NO** — sólo pone `listingId` |
| Aplica el tope de fotos (`PhotoLimitsService`) | Sí (`:1579-1584`) | **NO** |
| Comprueba que las imágenes existen | Sí (`:1591-1596`) | **NO** |
| Comprueba que no son de otro anuncio | Sí (`:1604-1608`) | **NO** |

**Traducción:** hoy, **reordenar desde el backoffice no hace nada** — la petición
responde 200 y el orden no se mueve. Y un `imageIds` con el id de una foto de **otro
anuncio** se la robaría en silencio, porque el `updateMany` de `:772-775` no filtra por
`listingId`.

Esto contradice de frente la promesa escrita de P3a — «**valida igual que el dueño**»
(`update-admin-listing.dto.ts:31-35`, `admin.service.ts:701-706`) — y explica por qué
nadie lo ha notado: **la promesa se verificó sobre los campos, no sobre las fotos**,
porque la UI nunca ha mandado `imageIds`.

### El riesgo B3: las huérfanas de R2 — y no es sólo del backoffice

El enunciado dice «eliminar una imagen debe limpiar su fichero R2 **y** su miniatura, y
reusar la cola de limpieza de B3». Verificado:

- La regla de la miniatura vive en un solo sitio (`infra/r2/media-keys.ts`,
  `thumbKeyFor` + `listingMediaKeys`), exactamente como el enunciado supone. **Esa
  parte es correcta.**
- **Pero la cola de limpieza sólo se usa al BORRAR EL ANUNCIO ENTERO**: los dos únicos
  llamadores son `admin.service.ts:972-981` (B2, borrado de staff) y
  `listings.service.ts:1009` (el equivalente del dueño). Grep exhaustivo de
  `mediaCleanupQueue` — no hay más.
- **Quitar una foto de un anuncio NO limpia nada, ni hoy ni por el camino del dueño.**
  Los dos caminos hacen `listingId: null` y ahí muere: quedan **la fila `ListingImage`
  huérfana** y **sus dos objetos en R2** (original + miniatura), para siempre.

> **La corrección al enunciado:** «no dejar huérfanas» no es un cuidado que el
> backoffice deba respetar — **es una función que no existe todavía en ningún sitio**.
> El backoffice no la rompería: la estrenaría.

Y eso abre la decisión de diseño que hace falta tomar antes de escribir código:

- **(a) Limpiar sólo en el camino de staff.** Barato, y crea dos comportamientos
  distintos para la misma acción — el defecto que este proyecto cierra una y otra vez.
- **(b) Limpiar en los dos caminos**, extrayendo un `desvincularImagenes(listingId,
  imageIds)` compartido (molde exacto de `ListingEditValidationService` en P3a: la
  regla se extrae, no se copia). Es lo coherente, y de paso arregla la fuga del dueño.
- **(c) No limpiar al desvincular; recolectar aparte** las `ListingImage` con
  `listingId = null` y sin uso pasado un plazo. Es lo más seguro contra el borrado
  prematuro (una imagen desvinculada por error se puede volver a enlazar), pero es un
  trabajo propio con su cron.

**Ojo con (a) y (b):** desvincular **no es** borrar. El original sigue referenciado por
`ListingImage.url` mientras la fila viva, y `keyFromPublicUrl` devuelve `null` para
URLs ajenas (`media-keys.ts:45-50`) — bien —, pero la fila desvinculada seguiría
existiendo apuntando a un objeto ya borrado. Si se elige (a) o (b), **hay que borrar la
fila, no sólo desvincularla**, o se cambia una huérfana por otra peor.

### Clasificación

**Continuación de P3a, con un arreglo de fondo dentro.** No es «añadir dos controles»:
es cerrar tres validaciones que faltan, hacer que el orden se escriba, y tomar una
decisión sobre R2 que afecta también al camino del dueño.

### En qué se apoya

P3a (`AdminService.updateListing` + `ListingEditValidationService`) · B3
(`media-keys.ts` + `QUEUE_MEDIA_CLEANUP`) · `linkImages` del dueño · y para la UI, dos
moldes ya probados: `StepAtributos` (`components/publicar/steps/StepAtributos.tsx`,
con `filterSchemaByType` y las dependencias entre campos) y `StepFotos`
(`:227-271`, que ya trae «Portada», eliminar y las flechas de reordenar).

### Dónde está el riesgo

1. **R2 (huérfanas).** El de arriba. Es el riesgo real y necesita decisión antes de
   código.
2. **P3a (sin `EDITED`).** Cualquier control nuevo debe seguir entrando por
   `AdminService.updateListing`, que es el camino sin `triage`
   (`admin.service.ts:762`). Añadir imágenes o atributos por un endpoint distinto que
   acabe llamando a `ListingsService.update()` dispararía `EDITED` y mataría la única
   señal que P1 construyó — la mutación que P3a documenta (`estado-tecnico.md:13788`)
   dice exactamente eso.
3. **La puerta de validación.** Bajar de fotos por debajo del mínimo
   (`minPhotosPerListing` + `minPhotosRuleEnabled`) o dejar atributos inválidos marca
   el anuncio con `needsRevalidation` — y **el aviso le cae al VENDEDOR por un cambio
   que hizo el staff**. Es literalmente el argumento con el que P3a justificó no
   relajar la validación. Aplicar el tope de fotos en el camino de staff no es
   opcional: es cerrar el mismo agujero.

---

## 3. Barra lateral desplegable + móvil + renombrar «Dashboard» + quitar «Motivos de contacto» del menú

Son cuatro cosas con tres niveles de riesgo distintos. Van por separado.

### 3.a — Renombrar «Dashboard» → español · **trivial**

`backoffice-sections.ts:94` — un `label`. La fuente única funciona: cambiar ahí lo
cambia en el nav y en ningún sitio más (el middleware no lee labels).

**Lo único que rompe:** `admin-roles.spec.ts:88` afirma
`getByRole('link', { name: 'Dashboard' })`. Un test, una línea. **Sugerencia:**
«Panel» o «Inicio»; «Resumen» describe mejor lo que la pantalla es (agregados:
activos, en revisión, usuarios, cola, estado del índice — ver el comentario de
`backoffice-sections.ts:90-93`).

### 3.b — Barra lateral desplegable + móvil · **acotado, sólo UI**

El molde actual, verificado:

- `(admin)/layout.tsx:20-28` — un `<aside className="w-56 shrink-0 border-r …">` fijo
  dentro de un `flex`. **Sin `hidden`, sin `md:`, sin breakpoints.** En móvil se come
  224 px de los ~375 disponibles.
- `AdminNav.tsx` — 58 líneas, **sólo pinta**: `navSectionsFor(role).map(…)` con un
  `<Link>` por sección. No tiene estado, no tiene props.

Es el sitio más limpio del lote para trabajar: el estado de «colapsada/abierta» va en
el layout (o en un componente cliente que lo envuelva), y `AdminNav` sigue sin saber
nada. **Cuidado único:** `data-testid="admin-nav"` (`AdminNav.tsx:33`) lo usan los
tests de roles; si en móvil el nav se desmonta en vez de ocultarse con CSS,
`admin-roles.spec.ts` dejará de encontrarlo — Playwright corre en viewport de
escritorio por defecto, así que basta con no romperlo ahí.

### 3.c — Quitar «Motivos de contacto» del menú · **COLISIÓN FRONTAL con R1/R2**

**Esto no es un retoque. Es deshacer, a mano, la conclusión de dos ráfagas.**

Los hechos, leídos en el código:

1. `/admin/motivos-contacto` **era exactamente el defecto R3**: una sección
   alcanzable que no salía en el nav porque alguien añadió la ruta y olvidó la segunda
   lista (`backoffice-sections.ts:14-17`). Es el caso real que motivó la fuente única.
2. **El flag existía y se borró a propósito.** `backoffice-sections.ts:50-53`:
   > «`hiddenFromNav` ha desaparecido con esta ráfaga: existía sólo para declarar la
   > anomalía R3 mientras el inventario estaba congelado. `/admin/motivos-contacto`
   > baja a MODERATOR y **gana por fin su ítem de nav**, así que ya no hay ninguna
   > sección oculta y el concepto sobra.»
3. **La equivalencia es hoy la barrera.** `navSectionsFor` y `canAccessAdminPath` se
   reducen a la misma condición, y el comentario dice que eso es «lo que hace
   imposible, **por construcción**, el defecto R3» (`:255-258`).
4. La sección **ya es accesible desde Mensajes de contacto** — hay un `<Link
   href="/admin/motivos-contacto">` en `admin/mensajes-contacto/page.tsx:132`. La
   premisa del enunciado es correcta.

**Lo que rompe, enumerado:**

| Test | Qué afirma |
|---|---|
| `backoffice-sections.test.ts:163-170` | «R3 CERRADO: motivos-contacto ya tiene ítem de nav, y **no queda ninguna sección oculta**» |
| `backoffice-sections.test.ts:203-215` | «%s: **toda sección accesible sale en el nav — ya no hay excepciones**» (parametrizado por rol) |
| `backoffice-sections.test.ts:99-105` | «las cuentas son EDITOR 7 / MODERATOR 19 / **ADMIN 22**» |
| `admin-roles.spec.ts:79-80` | `expect(links).toHaveCount(22)` |
| `admin-roles.spec.ts:86` | `getByRole('link', { name: 'Motivos de contacto' })` visible |

**La corrección al enunciado.** El enunciado acierta al decir «hacerlo en la fuente
única, no a mano» y acierta al preguntar si el modelo lo soporta. La respuesta
verificada es: **lo soportaba, y se le quitó el soporte a conciencia**. Así que el
punto no es técnico, es una decisión que hay que tomar con los ojos abiertos:

- **(a) Reintroducir `hiddenFromNav`** como campo opcional de `BackofficeSection`.
  Barato (un campo, un filtro en `navSectionsFor`, sin tocar `canAccessAdminPath`).
  Coste: **se reabre la clase de defecto que R3 cerró** — una sección visible sólo
  para quien conozca la URL. Si se elige, la mitigación mínima es que el flag
  **obligue** a declarar desde dónde se llega (un campo `accesibleDesde: string` que
  el test compruebe que existe y apunta a una ruta real), para que «oculta» no pueda
  volver a significar «perdida».
- **(b) No ocultarla; subordinarla.** Si el problema es que el nav tiene 22 ítems
  planos y «Motivos de contacto» es configuración de «Mensajes de contacto», la
  respuesta natural cuando la barra pasa a ser **desplegable (3.b)** es **agrupar**:
  Motivos queda dentro del grupo de Contacto, plegado por defecto. Deja de estorbar
  **sin dejar de estar**, y la equivalencia nav ≡ acceso sobrevive intacta.
- **(c) Quitarla del nav a secas**, aceptando el coste y actualizando los cinco tests
  para que digan lo contrario de lo que dicen hoy.

**Recomendación:** (b). Es lo único que da lo que el enunciado quiere —que no estorbe
en el menú— sin gastar el invariante que costó dos ráfagas, y encaja de forma natural
con 3.b, que ya va a rehacer la barra. Si se descarta, (a) con la mitigación; (c) no,
porque borra la barrera sin poner nada en su sitio.

### Clasificación

3.a y 3.b: **retoque acotado**. 3.c: **decisión de arquitectura disfrazada de
retoque**.

---

## 4. Traducciones al español de las fichas

### Qué hay HOY — el inventario, sin suponer

**Existe el molde y funciona.** `admin/anuncios/listing-status.ts` (`STATUS_LABELS`,
los 9 estados) y `admin/anuncios/listing-triage.ts` (`TRIAGE_LABELS`) son ficheros
co-localizados y compartidos entre lista y ficha, escritos precisamente porque
duplicarlos ya se pagó una vez («`PAUSED` y `ARCHIVED` pintando el enum crudo hasta
B2» — `listing-triage.ts:6-8`). Y la ficha de usuario tiene los suyos inline
(`ESTADO_LABELS`, `ROL_LABELS` en `usuarios/[id]/page.tsx:34-51`).

**Lo que está sin traducir, enumerado uno a uno:**

*Ficha de anuncio* — `admin/anuncios/[id]/page.tsx`:

| Línea | Qué pinta | Enum crudo que sale |
|---|---|---|
| `:651` | «Tipo» | `PRODUCT` / `SERVICE` |
| `:652` | «Estado del artículo» | `NEW` / `LIKE_NEW` / `GOOD` / … |
| `:653` | «Formato de precio» | `FIXED · UNIT`, `NEGOTIABLE · MONTH`… (**dos enums en una línea**) |
| `:666` | Motivo del reporte | `SPAM` / `FRAUD` / `PROHIBITED` / … |
| `:667` | Estado del reporte | `PENDING` / `REVIEWING` / `RESOLVED` / `DISMISSED` |
| `:712` | Estado del ticket | `OPEN` / `IN_PROGRESS` / `WAITING_USER` / … |
| `:832` | Estado del vendedor | `ACTIVE` / `SUSPENDED` / `BANNED` |
| `:833` | Rol del vendedor | `USER` / `MODERATOR` / `EDITOR` / `ADMIN` |
| `:866` | Estado del `bumpSchedule` | `ACTIVE` / `PAUSED` / … |

*Ficha de usuario* — `admin/usuarios/[id]/page.tsx`:

| Línea | Qué pinta | Enum crudo que sale |
|---|---|---|
| `:206` | Estado de cada anuncio | los 9 de `ListingStatus` — **y `STATUS_LABELS` ya existe, simplemente no se importa** |
| `:264`, `:288` | Motivo del reporte (recibidos y hechos) | `ReportReason` |
| `:266`, `:289` | Estado del reporte | `ReportStatus` |
| `:307` | Estado del ticket | `TicketStatus` |
| `:327` | Acción del historial | `USER_SUSPEND`, `PRO_GRANT`, `ADMIN_CREDIT_DEBIT`… — **y la ficha de anuncio SÍ tiene un `ACCION_LABELS`** (`anuncios/[id]/page.tsx:758`) que aquí no se usa |

**Dos observaciones que salen del inventario y no del enunciado:**

- **Hay dos duplicaciones a punto de nacer.** `STATUS_LABELS` (anuncios) y
  `ACCION_LABELS` (historial) ya existen y la ficha de usuario los necesita. Copiarlos
  sería el defecto exacto que `listing-status.ts` se escribió para evitar. Lo correcto
  es **subirlos a un sitio compartido** (`config/` o `admin/_labels/`) y que las dos
  fichas los importen — no crear un tercer mapa.
- **Faltan mapas que no existen en ninguna parte:** `ReportReason`, `ReportStatus`,
  `TicketStatus`, `ListingType`, `Condition`, `PriceType`, `PriceUnit`,
  `BumpScheduleStatus`. Ocho enums. Y `TicketStatus` **también** lo pinta crudo la
  bandeja `/admin/tickets`, así que el mapa nuevo tiene ya dos consumidores desde el
  primer día — otra razón para que viva compartido.

### Clasificación

**Retoque acotado, y es el mejor primer paso del lote:** cero backend, cero migración,
cero riesgo, molde ya escrito, y toca las dos pantallas que los otros seis puntos van a
modificar después — hacerlo primero evita traducir dos veces lo que el punto 7 y el
punto 2 van a añadir.

### Dónde está el riesgo

**Ninguno estructural.** El único cuidado: los mapas deben conservar el patrón
`LABELS[x] ?? x` (`listing-status.ts:52-54`, «el enum crudo como último recurso
visible»), para que un valor nuevo del enum se vea feo en vez de desaparecer.

Cuidado menor de tests: los e2e que afirman sobre texto de badges (p. ej.
`etiqueta-interna.spec.ts`, `ficha-usuario.spec.ts`) pueden depender del texto crudo.
Hay que pasarlos, no reescribir el criterio.

---

## 5. Última IP + filtrar + ordenar + fecha/hora

### Qué hay HOY — verificado, y es menos de lo que el enunciado supone

**No existe absolutamente nada de esto persistido.** Grep sobre `schema.prisma`: el
único campo `ip` de todo el esquema es **`AuditLog.ip`** (`schema.prisma:1189-1190`).

- **`User` no tiene `lastLoginAt` ni `lastLoginIp`** (`schema.prisma:317-418`, revisado
  entero). No hay «último inicio» en ninguna forma.
- **`Listing` no tiene ningún campo de actividad ni de IP.** Sus únicas fechas son
  `publishedAt`, `expiresAt`, `bumpedAt`, `createdAt`, `updatedAt`, `videoUploadedAt`.

**La IP sí llega al login — y se tira.** `auth.controller.ts:26-37` decora con `@Ip()`
y la pasa a `AuthService.login/adminLogin`, que la usa **sólo para rate limiting**
(`auth.service.ts:130-139`, `:186-192`: `auth:login:ip:${ip}`). No se persiste.

**Cómo se obtiene la IP.** `@Ip()` de Nest → `req.ip` de Express, con
`app.set('trust proxy', trustProxyHops)` en `main.ts:29-30` (`TRUST_PROXY_HOPS`, por
defecto 1). **No hay ningún acceso manual a `x-forwarded-for`** en todo el backend.

> **Y aquí hay una deuda ya escrita que este punto hereda entera.**
> `docs/pendientes.md §6` (RC.1, `[SEGURIDAD]`): el valor de `trust proxy` **no está
> verificado contra la topología real**, y si el proxy reenvía `X-Forwarded-For` del
> cliente en vez de sobrescribirlo, **la IP es falsificable a voluntad**. Hoy eso sólo
> degrada un rate limit que tiene red de seguridad global. Si se construye el punto 5,
> esa misma IP pasa a ser **un dato de moderación mostrado a personas que tomarán
> decisiones con él**, y el coste de que mienta sube mucho. La deuda depende de §1
> (el proyecto nunca se ha desplegado), así que no se puede cerrar todavía —
> **pero la pantalla tiene que decir lo que sabe y lo que no**.

**Tres huecos más en los puntos de escritura:**

- **El login social no recibe la IP.** `auth.controller.ts:61` llama a
  `loginWithGoogle(dto)` — sin `@Ip()`. Un usuario que sólo entra con Google tendría
  «última IP» perpetuamente vacía salvo que se amplíe también esa firma.
- **«Última interacción del propietario» no está definida y no se puede derivar.**
  El enunciado pregunta qué cuenta como interacción (editar, bump, renovar…) y hace
  bien: `Listing.updatedAt` **no sirve**, porque lo mueve cualquier escritura —
  incluida **la edición de staff de P3a** (`admin.service.ts:745`) y el borrado de
  `needsRevalidation`. Usarlo diría «el dueño estuvo aquí» cuando quien estuvo fue un
  moderador. Hace falta columna propia, y **el camino de staff no debe escribirla** —
  el mismo cuidado exacto que P3a aplicó a `triage`.
- **Filtrar y ordenar usuarios no tiene dónde apoyarse.** `ListAdminUsersDto` sólo
  tiene `status`, `role`, `q`, `page`, `perPage` (`list-admin-users.dto.ts`) — **no
  tiene `order` en absoluto**. La lista de usuarios **nunca** ha tenido eje de
  ordenación. El marco ampliable de F2 (DTO + una línea en el `where` + `filtros-url.ts`
  + chips) es el de **anuncios**, no el de usuarios: aquí hay que **traerlo**, no
  extenderlo.

### La fuga que ya está abierta, y nadie la ha declarado

**Hallazgo de esta auditoría.** Hay dos lectores del historial de auditoría y **no
dicen lo mismo**:

- `AuditLogService.listForResource` (F1) usa un `select` explícito que **excluye `ip`**,
  con la razón escrita: «no es historia del anuncio sino rastro de seguridad de una
  persona, y auditar personas es otra pantalla con otro rol»
  (`audit-log.service.ts:58-71` + el comentario del tipo `AuditLogEntry:74`).
- `AdminService.getUserDetail` (U3) **no lo usa**: monta su propio
  `auditLog.findMany({ …, include: { actor } })` (`admin.service.ts:1137-1144`). Un
  `include` sin `select` devuelve **todos los escalares**, `ip` incluido.

Es decir: **`GET /admin/users/:id` ya sirve IPs de auditoría a MODERATOR hoy**, por una
segunda verdad no declarada. La UI no las pinta (`usuarios/[id]/page.tsx:325-335`), así
que nadie lo ha visto — pero están en la respuesta.

Esto no invalida el punto 5; **lo enmarca**. La decisión de privacidad que el enunciado
quiere anotar ya está tomada de hecho, sin haberse escrito. El punto 5 es la ocasión de
escribirla y de **unificar los dos lectores**, en vez de dejar uno explícito y otro
accidental.

### DECISIÓN DE PRIVACIDAD — anotada como consciente

> **Decisión (tomada, no propuesta): la última IP es visible a MODERATOR+.**
>
> **No** lleva el gate ADMIN del saldo (U3/D-3). Es deliberado y se anota aquí para que
> quede escrito el porqué, aunque suponga exponer un dato personal a un piso más ancho:
>
> - **Base legal:** interés legítimo en la prevención del fraude y del abuso en una
>   plataforma C2C (multicuenta, evasión de baneo, denunciantes en serie).
> - **Finalidad, única:** moderación. No marketing, no analítica, no perfilado.
> - **Acceso:** MODERATOR y ADMIN. **Nunca** el usuario final, nunca el perfil público,
>   nunca un endpoint no-`/admin`.
> - **Por qué no ADMIN-only:** quien investiga el fraude es el moderador. Un dato
>   antifraude que sólo ve quien no modera no protege a nadie y empuja a pedirlo por
>   otro canal. El gate de U3 protege una **relación comercial** (saldo, pagos,
>   procedencia del Pro), que es otra categoría de dato y otro oficio.
> - **Contrapartidas que la decisión exige** (no son opcionales si se acepta el
>   argumento): **(i)** conservar sólo la última, no un historial —el enunciado ya lo
>   pide así, y es la versión mínima suficiente—; **(ii)** que consultarla deje rastro,
>   o al menos que la pantalla lo diga; **(iii)** que la IP **no salga por ningún
>   endpoint público ni por la respuesta del propio usuario**; **(iv)** que la ficha
>   advierta de RC.1 mientras la topología del proxy no esté verificada, porque una IP
>   que puede estar falsificada y se presenta como hecho es peor que no tenerla.

### Clasificación

**Sustancia.** Migración de esquema, puntos de escritura nuevos en un camino caliente
(el login), un eje de ordenación que la lista de usuarios no tiene, una decisión de
privacidad, una fuga preexistente que reconciliar y una deuda de seguridad heredada.
**No es un retoque.** → **Necesita diseño propio** (más corto que el del punto 6, pero
propio).

### Dónde está el riesgo

- **El login es el camino más caliente y menos perdonable.** Escribir en `User` en cada
  login añade un `UPDATE` a cada autenticación. Hay que decidir si es síncrono, si se
  hace fuera de la transacción, y qué pasa si falla — **el login no puede fallar por no
  poder anotar una IP** (mismo criterio fail-open que `BadWordService`).
- **P3a:** la «última interacción del propietario» no puede escribirla el camino de
  staff.
- **F2:** el índice, si hace falta, se mide con `EXPLAIN` antes de crearlo — y el
  precedente completo es el de E2 (`estado-tecnico.md:13499-13524`), que **midió y
  decidió NO añadirlo**. Ordenar por `lastLoginAt` sobre `User` sí es la consulta por
  defecto de una pantalla, que es justo el criterio con el que F2 sí justificó los
  suyos.

---

## 6. Ampliar las listas de bloqueo a IPs y teléfonos + un sistema paralelo que sólo avisa

### Qué hay HOY — verificado, y el enunciado se queda corto al llamarlo «ampliar»

**El sistema actual, entero:**

- **Modelo:** una clave de `Setting`, `badWordList`, con un `string[]` en un `Json`
  opaco (`schema.prisma:1204`, `bad-word.service.ts:19-24`). **No hay tabla.** Añadir
  claves obliga a tocar el whitelist `SETTING_KEYS` (`admin.service.ts:106-…`), los
  mapas `SETTING_TITLES` / `SETTING_DESCRIPTIONS` y el `ORDER` de la pantalla de
  ajustes (`admin/ajustes/page.tsx:392-…`, `:560-…`).
- **Dónde bloquea:** **sólo en `publish()`** (`listings.service.ts:480-491`), y no
  «bloquea»: **desvía** a `PENDING_REVIEW`. Es uno de los cuatro caminos a la cola —
  el filtro de palabras primero, y los tres niveles de `reviewTriggerFor` después
  (`:513-515`; la ficha F1 los pinta como cuatro señales separadas,
  `admin.service.ts:590-615`).
- **Qué mira:** `hasBadWords(title, description)`. **Sólo esos dos campos.** No mira
  `Listing.phone`, ni los atributos, ni las etiquetas.
- **Fail-OPEN por contrato:** si la lista falta o el servicio revienta, devuelve
  `false` y la publicación sigue (`bad-word.service.ts:5-10`, `:31-34`). Deliberado,
  y documentado como la diferencia con la premoderación, que es fail-CLOSED.

### El hallazgo que cambia el tamaño del punto

**El mecanismo de detección actual NO PUEDE detectar ni una IP ni un teléfono.**
`hasBadWords` normaliza, **tokeniza partiendo por todo lo que no sea `[a-z0-9]`**, y
compara por **igualdad exacta contra el conjunto de tokens** (`bad-word.service.ts:29-30`
y `:45-51`):

```
"192.168.1.1"   → tokens {192, 168, 1}      → nunca casa con "192.168.1.1"
"600 123 456"   → tokens {600, 123, 456}    → nunca casa con "600123456"
"+34 600123456" → tokens {34, 600123456}    → casa sólo si la lista trae ese formato exacto
```

Un puerto de la lista de palabras a IPs/teléfonos **casaría cero veces**, en silencio,
y con el fail-open puesto **nadie se enteraría**. Es decir: el punto 6 no es «meter más
valores en la misma lista». Es **un mecanismo de detección distinto** —extracción por
patrón y normalización canónica (E.164 para teléfonos, forma canónica y quizá rangos
CIDR para IPs)— conviviendo con el de tokens.

Y trae preguntas que sólo un diseño puede cerrar:

- ¿La IP **de qué**? El anuncio no tiene IP (§5). ¿Se busca una IP **escrita en el
  texto** (raro) o se bloquea **al publicador cuya IP está en la lista**? Son dos
  funciones completamente distintas, y **la segunda depende del punto 5**, porque hoy
  no hay ninguna IP asociada a un usuario ni a un anuncio.
- ¿Teléfono en el texto, en `Listing.phone`, o en los dos? Hoy `phone` **no pasa por
  el filtro** en ningún caso.

### El hueco de la edición — confirmado, y es de los dos lados

El enunciado pregunta si hay hueco. Sí, y está **triplemente** documentado:

- **E1:** «verificado en `update()`: la edición del dueño no cambia `status`, **no
  vuelve a pasar por el filtro de palabras** y no consulta la moderación previa —los
  dos sólo corren en `publish()`—. Es decir: **hoy el dueño de un ACTIVE puede
  reescribirlo entero sin que se entere nadie.** `EDITED` es la única señal que el
  staff va a recibir» (`estado-tecnico.md:13421-13426`).
- **P3a:** el camino de staff **tampoco** re-modera, y ahí es **correcto** y
  deliberado («pasarle el texto de un moderador sería pedirle a la máquina que revise a
  quien la opera», `admin.service.ts:714-716`).

Así que si el bloqueo se extiende a la edición, **debe extenderse a la del dueño y NO a
la del staff**. Y eso reabre una decisión que E1 ya rozó: hoy la única consecuencia de
que el dueño reescriba un `ACTIVE` es la etiqueta `EDITED`. Meter ahí un desvío a
`PENDING_REVIEW` **saca un anuncio del escaparate por editarlo** — que es un cambio de
política de producto, no un retoque.

### El sistema que avisa, y cómo encaja con P1

El eje candidato existe y es exactamente el que el enunciado sospecha: **`watched`**,
el segundo eje de P1 (`schema.prisma`, `Listing.watched Boolean @default(false)` con
índice). Su semántica —«en observación», convive con los tres valores de `triage`— es
literalmente «esto merece un vistazo, sin afirmar nada sobre el estado ni sobre el
triaje». Encaja **sin romper la ortogonalidad**: no toca `triage` ni `status`.

Pero hay tres frenos verificados que un diseño tiene que resolver:

1. **`watched` es hoy una anotación 100 % humana.** El único escritor es
   `PATCH /admin/listings/:id/triage` (`admin.service.ts:635-689`), y **escribe
   `AuditLog` con el actor real**. Un `watched` automático sería **el primer escritor
   no humano** de ese eje, y choca con la regla de E1: no hay actor «sistema» porque
   `AuditLog.actorId` es **NOT NULL con FK a `User`** y las 65 escrituras del proyecto
   pasan una persona (`estado-tecnico.md:13438-13444`). E1 resolvió el caso análogo
   —la transición automática `REVIEWED → EDITED`— **no registrando**. La solución
   probablemente sea la misma; hay que decidirlo, no heredarlo por inercia.
2. **`watched` no dice POR QUÉ.** Es un booleano. Un aviso útil necesita motivo («la
   IP 1.2.3.4 está en la lista de vigilancia»). Si eso se mete dentro de `watched`,
   `watched` deja de ser un eje y se convierte en un contenedor — el defecto que E1
   evitó al partir los cuatro conceptos en dos ejes. Las salidas razonables:
   una **columna hermana** (`watchedReason`), una **notificación** a staff, o una
   **tabla de señales** propia. Es diseño, no implementación.
3. **Si `watched` se pone y se quita solo, un moderador ya no puede confiar en él**
   como lista de vigilancia propia. Distinguir «lo marqué yo» de «lo marcó el sistema»
   puede exigir un tercer valor donde hoy hay un booleano — y eso **sí** toca el
   modelo de P1.

**Para el canal de aviso hay precedente construido y probado:**
`TicketNotificationsService.staffNewActivity` (`ticket-notifications.service.ts:61-91`)
hace fan-out de `Notification` a **todos los ADMIN/MODERATOR** más un correo al
`supportEmail` configurable. Es el molde exacto de «avisar a staff sin bloquear».

### Clasificación

**Casi un cuerpo, y el enunciado lo dice bien.** Son dos sistemas (bloquear / avisar),
tres tipos de valor con **dos mecanismos de detección distintos**, dos puntos de
enganche (`publish()` y la edición del dueño), una decisión de modelo (¿`Setting` o
tabla?), una decisión de política de producto (¿editar re-modera?) y una integración
con P1 que puede tocar su modelo. → **Diseño propio, obligatorio, y probablemente
partido en ráfagas.**

### Dónde está el riesgo

- **P1 (ortogonalidad).** El riesgo mayor del punto. Ver arriba.
- **El camino de publicación.** `publish()` es el flujo crítico del producto. El nuevo
  filtro debe mantener el contrato **fail-open** —si la detección revienta, se publica—
  o se convierte en un solo punto de fallo para todas las altas.
- **Falsos positivos.** Un patrón de teléfono casa con muchísimo texto legítimo
  (referencias, medidas, códigos postales). Un filtro que manda a la cola el 30 % de
  las altas no es una mejora de moderación, es una avería de negocio. **La lista que
  AVISA es el sitio correcto para estrenar cada patrón nuevo** antes de que bloquee —
  y esa es, probablemente, la mejor razón para construir «avisar» **antes** que
  «bloquear», al revés del orden del enunciado.
- **§5 es prerrequisito parcial:** «bloquear por IP del publicador» no se puede
  construir sin que exista una IP asociada a alguien.

---

## 7. Valoraciones en la ficha de usuario + editar texto/estrellas + eliminar

Son dos cosas con riesgos incomparables. Van separadas: **7a** (ver) y **7b** (borrar).

### Qué hay HOY — verificado

**El backend ya devuelve más de lo que la ficha pinta.** `getUserDetail` incluye
`reviewsReceived` **y** `reviewsAuthored`, las dos con `id`, `rating`, **`comment`**,
`createdAt` y la contraparte (`admin.service.ts:1088-1109`), `take: 10` cada una.

**La ficha desperdicia la mitad.** `usuarios/[id]/page.tsx:222-254` pinta sólo las
estrellas y el nombre: **no muestra el comentario** (que sí viene), ni la fecha, ni
`editedAt`, ni `verified`, ni enlace al anuncio. Y «Valoraciones dadas» **no lleva
contador** (`:241`, sin `contador=`) porque `_count` no incluye `reviewsAuthored`
(`admin.service.ts:1116`).

**Editar y eliminar como staff no existe.** Los únicos endpoints son
`PATCH /reviews/:id` y `DELETE /reviews/:id` (`reviews.controller.ts:48-61`), y ambos
son **del autor y sólo dentro de 72 h**:

```ts
if (review.authorId !== authorId) throw new ForbiddenException(…);   // reviews.service.ts:180, :197
if (Date.now() > review.createdAt.getTime() + EDIT_WINDOW_MS) throw …; // :183, :200  (72 h)
await this.prisma.review.delete({ where: { id } });                   // :204 — BORRADO DURO
```

Sin `AuditLog`, sin rol de staff, sin borrado lógico.

**La reputación se calcula al vuelo, y eso es una buena noticia.** `average`, `count` y
`distribution` son un `aggregate` sobre `verified: true` en cada lectura
(`reviews.service.ts:143-174`, y `getRatingSummaries:227-235` para los listados). **No
hay nada desnormalizado.** Respuesta directa a la pregunta del enunciado: **borrar una
valoración cambia la reputación al instante y no hay nada que recalcular.** El riesgo
no es la desincronización — es que el cambio es **inmediato e invisible**.

### El riesgo de 7b, que B1 ya había escrito

El enunciado plantea bien la tensión, pero **el peligro concreto es otro y ya está
documentado**:

- Lo que B1 protegió fue `Review.listingId` → `SetNull` + `listingTitle`: la valoración
  **sobrevive al borrado del anuncio**, «la reputación no es borrable por el vendedor»
  (`schema.prisma:1038-1045`). Ese cuidado va del **anuncio**, no del staff.
- **El defecto que muerde aquí es el que B1 dejó anotado y fuera de alcance a
  propósito.** `docs/diseno-borrado.md`, riesgo 5:
  > «**`Report.reviewId` sigue en `Cascade`**: borrar una valoración destruye sus
  > denuncias. Fuera de alcance (va de reseñas), **pero es el mismo defecto**. Anotado
  > aquí para no perderlo.»

  Verificado en el esquema: `schema.prisma:1124-1125`, `onDelete: Cascade`.

**Y el punto 7 es, exactamente, «va de reseñas».** Traducido a la operación que el
enunciado pide:

> Un usuario denuncia una valoración abusiva → un moderador la revisa → la elimina →
> **la denuncia que la señalaba desaparece con ella**. Se pierde la evidencia de por
> qué se borró, por el mismo mecanismo por el que antes de B1 el denunciado destruía su
> denuncia borrando su anuncio.

Es la misma clase de defecto, en la arista que B1 dejó abierta. **Arreglar
`Report.reviewId` es prerrequisito de dar a nadie el botón de borrar**, no un extra.

Y hay un segundo salto menor, éste sí ya sano: `Ticket.reviewId` es `SetNull` con
`linkedLabel` conservado (`schema.prisma:2557-2570`), así que un ticket que hablaba de
la valoración sobrevive y sigue siendo legible. Bien.

### Lo que un diseño de 7b tiene que decidir

- **¿Borrado duro o retirada lógica?** El criterio de B1 —«un registro con valor
  propio»— empuja a un `hiddenAt` + `hiddenById` + motivo: la valoración deja de contar
  para la reputación y deja de mostrarse, pero **la evidencia de qué se retiró y por
  qué sobrevive**. Un `delete()` destruye justo lo que un moderador necesitaría si el
  autor reclama. Coste: hay que excluirla en `listForUser`, en el `aggregate` de
  reputación y en `getRatingSummaries` — **tres sitios**, y olvidar uno la deja
  contando en la media.
- **¿Editar el texto de otra persona?** Es distinto de borrar y más delicado: deja en
  pie una opinión firmada por alguien **que ya no dijo eso**. Si se hace, `editedAt`
  ya existe (`schema.prisma:1050`) pero hoy significa «el autor la editó» — usarlo para
  una edición de staff mentiría al lector. Recortar (retirar el comentario, conservar
  la nota) es más defendible que reescribir. **Y `rating` es lo que mueve la
  reputación:** cambiarlo a mano es alterar una nota ajena.
- **`verified` NO se toca.** Está congelado al crear y «NUNCA recalculado (ni por
  `edit()`, ni por ningún otro endpoint)» (`schema.prisma:1052-1060`). Cualquier
  camino nuevo hereda esa regla.
- **`AuditLog` obligatorio**, con `before` completo (rating + comment). Es la única
  forma de que una retirada sea reversible en la práctica, y el molde está en todo el
  backoffice.
- **Rol.** MODERATOR encaja con el oficio (moderar contenido abusivo). ADMIN encajaría
  con la excepcionalidad. El precedente de B2 es el criterio: **ADMIN para lo
  irreversible, MODERATOR para lo reversible** — lo que hace que la elección
  «hiddenAt vs delete» **decida también el rol**, y no al revés.

### Clasificación

- **7a (ver bien: comentario, fecha, enlace, contador, `verified`)** — retoque acotado,
  **cero backend**: el dato ya viaja. Riesgo nulo.
- **7b (editar y eliminar como staff)** — **sustancia con riesgo alto**, sobre la
  arista que B1 dejó abierta. → **Diseño propio.**

---

## 8. Donde el enunciado no casa con el código

Cinco correcciones, todas verificadas:

| # | El enunciado dice | El código dice |
|---|---|---|
| 1 | «Verificar si el modelo de `Ticket` soporta el vínculo **o hay que ampliarlo**» | **Lo soporta entero**: cuatro FKs, guard de propiedad, `linkedLabel` derivado en servidor, endpoint MODERATOR y DTO con los campos. **El punto 1 es UI, no modelo.** |
| 2 | «Verificar si P3a ya cubre atributos **o solo campos simples**» | **Cubre atributos, y con la validación por profundidad ya reusada.** Lo que NO cubre —y el enunciado no menciona— es que el camino de staff **ignora el orden de las imágenes** y **se salta el tope de fotos, la existencia y la propiedad**, rompiendo la promesa «valida igual que el dueño» de P3a. |
| 3 | «¿La fuente única permite “sección accesible pero no en el nav”? ¿O hay que añadir un flag?» | **Lo permitía: `hiddenFromNav` existió y se BORRÓ en R2 a propósito**, y `/admin/motivos-contacto` es el caso que motivó borrarlo. No es añadir un flag: es **revertir una conclusión**, contra 5 tests que la afirman. |
| 4 | «Reusar la cola de limpieza de B3 al eliminar una imagen. NO dejar huérfanas» | **La cola sólo se usa al borrar el anuncio entero.** Quitar una foto —también por el camino del dueño— deja hoy la fila y **los dos objetos de R2** huérfanos. El backoffice no rompería ese cuidado: **lo estrenaría**, y la decisión afecta también al camino del dueño. |
| 5 | «Ampliar la lista de palabras prohibidas a IPs y teléfonos» | **El mecanismo actual no puede detectarlos**: tokeniza partiendo por todo lo no alfanumérico y compara por igualdad, así que `192.168.1.1` y `600 123 456` **nunca casan**. Y con el fail-open, fallaría **en silencio**. No es ampliar una lista: es **un segundo mecanismo de detección**. |

Y dos hallazgos que el enunciado no pedía pero que el lote destapa:

- **`GET /admin/users/:id` ya sirve `AuditLog.ip` a MODERATOR** por un `include` sin
  `select` (`admin.service.ts:1137-1144`), contradiciendo la exclusión explícita de
  `ip` que F1 escribió en `listForResource` (`audit-log.service.ts:58-71`). La decisión
  de privacidad del punto 5 ya está tomada de hecho, sin estar escrita. **§5 debe
  unificar los dos lectores.**
- **`Report.reviewId` sigue en `Cascade`** (`schema.prisma:1125`), el riesgo 5 que B1
  anotó y dejó fuera de alcance. **El punto 7b lo activa.**

---

## 9. El mapa de riesgo sobre lo ya construido

| Cuidado heredado | Qué protege | Puntos que lo tocan | Cómo se respeta |
|---|---|---|---|
| **R1/R2 — fuente única** (`backoffice-sections.ts`) | nav ≡ acceso, imposible por construcción | **3** (frontal) | Agrupar en vez de ocultar; si se oculta, el flag debe **obligar** a declarar desde dónde se llega |
| **B1 — los registros sobreviven** | valoraciones y denuncias no se destruyen por el camino fácil | **7b** | Arreglar `Report.reviewId` **antes** del botón; preferir retirada lógica a `delete()` |
| **B3 — nada huérfano en R2** (`media-keys.ts`) | original + miniatura, una sola regla | **2** | Extraer un desvinculador compartido (molde P3a) y borrar la **fila**, no sólo el vínculo |
| **P1 — dos ejes ortogonales** (`triage` / `watched`) | ninguno afirma lo del otro | **6** (frontal), **2** (colateral) | `watched` automático necesita motivo y necesita decidir el registro; nada nuevo escribe `triage` |
| **P3a — el staff edita sin disparar `EDITED`** | la única señal que P1 dio al staff | **2**, **5**, **6** | Todo entra por `AdminService.updateListing`; la «interacción del propietario» no la escribe el staff; la edición de staff no re-modera |
| **F1 — `ip` fuera del historial del recurso** | rastro de seguridad ≠ historia del anuncio | **5** | Unificar los dos lectores; escribir la decisión de privacidad |
| **U3 — el gate del dinero** | MODERATOR no ve saldos ni procedencia | **5**, **7** | Nada nuevo entra en `GET /admin/users/:id` que describa una relación comercial (hay un test que busca el saldo **en la respuesta entera serializada**) |
| **F2 — medir con `EXPLAIN` antes de indexar** | no pagar índices que ensucia toda escritura | **5** | Medir el orden por `lastLoginAt` antes de crear nada; E2 es el precedente de **medir y no añadir** |
| **La puerta de validación** | el aviso no le cae al vendedor por un cambio ajeno | **2** | Aplicar tope y mínimo de fotos también en el camino de staff |
| **RC.1 (`pendientes.md §6`)** | la IP puede ser falsificable tras el proxy | **5** | La pantalla dice lo que sabe y lo que no, mientras §1 siga abierto |

---

## 10. El orden propuesto

> El criterio: **primero lo que no puede romper nada y desbloquea a los demás**, luego
> las continuaciones, y lo que necesita decidir antes de teclear al final.

**1.º — Punto 4 · Traducciones.** Cero backend, cero riesgo, molde escrito. Va primero
por una razón práctica: **los puntos 7a y 2 van a añadir texto a esas mismas dos
pantallas**, y traducir después obliga a traducir dos veces. Deja de paso los mapas
compartidos (`STATUS_LABELS`, `ACCION_LABELS` y los ocho enums que faltan) donde los
siguientes los van a necesitar.

**2.º — Punto 3.a + 3.b · Renombrar y la barra desplegable/móvil.** UI acotada, un solo
fichero de layout más `AdminNav`. **3.c se decide aquí y se ejecuta aquí**, porque la
barra desplegable es lo que hace viable la opción «agrupar» — que es la única que da lo
que se quiere sin gastar el invariante de R1.

**3.º — Punto 1 · Abrir tickets desde las fichas.** El backend está hecho. Es una
navegación con parámetros y dos botones. Rendimiento inmediato y riesgo mínimo, y
aterriza sobre las fichas ya traducidas.

**4.º — Punto 2 · Atributos e imágenes.** Primera continuación de verdad. **Requiere una
decisión previa (media página, no un documento): qué se hace con R2 al desvincular.**
Se parte natural en dos: **2a** atributos (ya validados, sólo UI, reusa
`StepAtributos`) y **2b** imágenes (arreglar orden + tope + existencia + propiedad en el
camino de staff, decidir R2, reusar `StepFotos`). 2a puede ir con el punto 1; 2b es lo
que tiene sustancia.

**5.º — Punto 7a · Las valoraciones, bien vistas.** Comentario, fecha, `verified`,
enlace al anuncio y el contador que falta. Cero backend — el dato ya viaja. Cierra la
mitad barata del punto 7 y deja la ficha lista para 7b.

**6.º — Punto 5 · Última IP.** *Con diseño propio previo (corto).* Va aquí y no antes
porque es el primero que toca esquema, el login y una decisión de privacidad — y porque
el punto 6 depende de él si el bloqueo por IP va a ser «por IP del publicador». Su
diseño debe cerrar: las columnas, qué cuenta como «interacción del propietario», el
login social, el eje de ordenación de usuarios (que hay que **traer**, no extender), la
reconciliación de los dos lectores de `AuditLog.ip`, y la advertencia de RC.1.

**7.º — Punto 7b · Editar y eliminar valoraciones.** *Con diseño propio.* Va después de
5 porque no bloquea a nadie, y **empieza obligatoriamente por arreglar
`Report.reviewId` → `SetNull`** (riesgo 5 de B1) antes de que exista ningún botón. La
decisión «retirada lógica vs borrado duro» decide también el rol.

**8.º — Punto 6 · Listas de bloqueo y sistema de aviso.** *Con diseño propio,
obligatorio, y probablemente partido en ráfagas.* Va al final porque es el mayor, porque
depende parcialmente de 5, porque toca `publish()` y porque su integración con P1 puede
tocar el modelo de la etiqueta. **Recomendación que sale de la auditoría: invertir el
orden interno del enunciado y construir “AVISAR” antes que “BLOQUEAR”** — el sistema
que avisa es el banco de pruebas donde cada patrón nuevo demuestra su tasa de falsos
positivos sin sacar anuncios del escaparate.

### En una línea

```
4 (traducir) → 3ab (barra) + 3c (decisión) → 1 (tickets) → 2a (atributos) → 2b (imágenes)
  → 7a (ver valoraciones) → [diseño] 5 (IP) → [diseño] 7b (borrar valoraciones)
  → [diseño] 6 (listas + aviso)
```

---

## 11. Qué necesita diseño propio

| Punto | ¿Diseño? | Qué tiene que cerrar antes de tocar código |
|---|---|---|
| **6** | **Sí — obligatorio y grande** | El mecanismo de detección (patrones ≠ tokens) · ¿`Setting` o tabla? · ¿IP de qué? · ¿la edición re-modera? · cómo encaja «avisar» en P1 sin romper la ortogonalidad · el canal de aviso · falsos positivos · fail-open |
| **5** | **Sí — corto pero propio** | Columnas y migración · qué es «interacción del propietario» · el coste en el login · el login social · el eje de ordenación que la lista de usuarios no tiene · reconciliar los dos lectores de `AuditLog.ip` · la decisión de privacidad (ya redactada en §5) · la advertencia RC.1 |
| **7b** | **Sí — corto** | `Report.reviewId` primero · ¿retirada lógica o borrado duro? (decide el rol) · ¿editar texto ajeno, o sólo retirar? · `verified` intocable · `AuditLog` con `before` completo · los tres sitios donde excluir una valoración retirada |
| **2** | **No — pero sí una decisión escrita** | Media página: qué se hace con R2 al desvincular, y si el arreglo cubre también el camino del dueño |
| **3.c** | **No — pero sí una decisión escrita** | Agrupar / flag con mitigación / quitar a secas. Con el coste sobre R1 escrito al lado |
| **1, 3.a, 3.b, 4, 7a** | **No** | Se implementan directamente |

---

## 12. Cierre

**Lo que este lote es, de verdad:** tres retoques reales (**4**, **3.a/3.b**, **7a**),
un punto que está casi hecho y nadie ha enchufado (**1**), una continuación con un
agujero de validación dentro (**2**), y **tres cuerpos con nombre de retoque** (**5**,
**6**, **7b**).

**Los dos sitios donde el lote puede hacer daño de verdad**, si se ejecuta sin decidir
antes:

1. **El punto 3.c**, que revierte en una línea la conclusión de dos ráfagas y borra el
   invariante `nav ≡ acceso` sin poner nada en su lugar.
2. **El punto 7b**, que da un botón de borrar sobre la única arista que B1 dejó
   abierta a sabiendas — y cuyo primer uso destruiría la denuncia que justificaba el
   borrado.

Ninguno de los dos se ve mirando el enunciado. Los dos se ven mirando el código.
