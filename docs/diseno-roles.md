# Diseño — El cuerpo de roles (el cimiento de los 6 puntos)

> Documento de diseño (2026-08-18). Parte de [`docs/auditoria-backoffice-administracion.md`](./auditoria-backoffice-administracion.md)
> §Bloque 1 y lo convierte en un plan.
>
> **Objetivo:** una **fuente única de verdad** de la que deriven las tres capas que hoy
> divergen, un rol que se refresque de verdad en el frontend, y el reparto de secciones que
> Ernest quiere (EDITOR / MODERATOR / ADMIN).
>
> **Alcance cerrado:** el acceso al backoffice. No entra: qué hace cada sección por dentro
> (eso son los cuerpos P1-P6), ni el rol USER (ya funciona: sin sesión → `/login`, con
> sesión y sin rol de staff → `/`).
>
> **Innegociable:** el `RolesGuard` del backend es la autorización REAL y no se debilita.
> La fuente única **no lo sustituye — lo ordena y lo pinza con un test**.
>
> Toda afirmación sobre el código está verificada contra el fichero citado, no contra la
> documentación.

---

## 0. Los cuatro hallazgos que este cuerpo cierra

| # | Hallazgo (auditoría §1.4) | Se cierra en |
|---|---|---|
| R1 | El backend lee el rol fresco de la BD en cada petición; el frontend lo tiene congelado desde el login. Un degradado entra al backoffice y todo le falla con 403 | **Pieza 2** |
| R2 | Tres listas de roles mantenidas a mano que pueden divergir | **Pieza 1** |
| R3 | `/admin/motivos-contacto` existe y no tiene entrada en el nav (R2 materializado) | **Pieza 1 + 3** |
| R4 | El acceso se decide por `startsWith`, así que una sección futura homónima se abre sola | **Pieza 1** |
| R5 | `(admin)/layout.tsx` no comprueba nada: toda la protección de ruta es el middleware | **Pieza 2** (decisión explícita, ver §2.7) |
| R6 | La frontera ADMIN/MODERATOR dentro de una sección es un `&&` ad-hoc repetido | **Pieza 1** §1.8 |
| R7 | Abrir el dashboard a EDITOR es una decisión de producto, no un cambio mecánico | **Pieza 3** §3.6 |

Y una quinta pieza que no estaba en la auditoría y que este diseño obliga a resolver porque
Pieza 2 depende de ella: **ninguno de los 74 ficheros `.tsx` de `(admin)` maneja un 401**
(§2.5).

---

## 1. Pieza 0 — La jerarquía (el prerrequisito conceptual)

`Role` **no es ordinal**. Es un enum plano de cuatro valores
([`schema.prisma:38`](../apps/api/prisma/schema.prisma#L38)) y el proyecto entero lo trata
como un conjunto: cada sitio que autoriza **enumera a mano los roles admitidos**.

Verificado, así se escribe hoy la misma idea en cuatro sitios distintos:

| Sitio | Cómo dice «MODERATOR o superior» |
|---|---|
| Backend | `@Roles(Role.MODERATOR, Role.ADMIN)` — 9 veces solo en `admin.controller.ts` |
| Backend (blog) | `@Roles(Role.EDITOR, Role.MODERATOR, Role.ADMIN)` — 7 veces en `blog-admin.controller.ts` |
| Middleware | una entrada por rol en `ROLE_ALLOWED_PATHS` con el path repetido |
| Nav | `roles: ['ADMIN', 'MODERATOR']` en cada ítem de `NAV_ITEMS` |

**Ése es el defecto de raíz.** Con 22 secciones × 3 capas, «enumerar» significa ~50 listas
que hay que recordar ampliar cuando entra un rol. Y la ampliación *silenciosa* es la
peligrosa: olvidar `EDITOR` en una lista no rompe nada visible — simplemente ese rol no
entra, y nadie se enterará hasta que alguien lo reporte.

**Decisión 0.1 — Se declara la jerarquía UNA vez, como orden.**

```
ROLE_ORDER (de menor a mayor):  USER  <  EDITOR  <  MODERATOR  <  ADMIN
```

De ahí se derivan las dos únicas operaciones que el sistema necesita:

- `rolesFrom(minRole)` → la lista de roles que satisfacen ese piso. Es lo que alimenta
  `@Roles(...)` sin escribirlo a mano.
- `atLeast(userRole, minRole)` → booleano. Es lo que usan el middleware, el nav y los
  checks intra-sección.

**Decisión 0.2 — La jerarquía es total y sin excepciones.** `MODERATOR` puede todo lo de
`EDITOR`; `ADMIN` todo lo de `MODERATOR`. Se descarta un modelo de permisos por capacidades
(matriz rol × acción) porque el reparto que Ernest describe **es exactamente una escalera**,
y una matriz costaría un modelo de datos, un CRUD y una pantalla para expresar lo mismo.

Consecuencia que hay que aceptar: si algún día se quiere «un EDITOR que además vea reportes
pero no usuarios», este modelo no lo expresa y habría que cambiarlo. Se acepta a propósito;
la escalera es lo pedido.

**Decisión 0.3 — `USER` entra en el orden pero no en el mapa.** `USER` es el piso cero: no
tiene ninguna sección. Está en `ROLE_ORDER` para que `atLeast` sea total (no haya un rol que
la función no sepa comparar) y para que el caso «sin rol» no dependa de un `?? ''` como hoy
([`AdminNav.tsx:42`](../apps/web/src/app/(admin)/components/AdminNav.tsx#L42)).

---

## 2. Pieza 1 — La fuente única de verdad

### 2.1 Cuál es el objeto canónico

No es «rol → paths» (lo que hay hoy) ni «path → rol». Es la **sección**: un área del
backoffice con identidad propia. Cada sección declara, en un solo sitio:

| Campo | Para qué | Lo consume |
|---|---|---|
| `id` | Clave estable, no la ruta (`anuncios`, `cola-revision`) | los tests, el backend |
| `route` | Prefijo de ruta (`/admin/anuncios`) | middleware, nav |
| `label` | Texto del nav en español | nav |
| `minRole` | El piso de la escalera | las tres capas |
| `order` (implícito) | Posición en la barra lateral | nav |

**Por qué la sección y no el path:** porque el `id` es lo que permite que el backend y los
tests hablen de la misma cosa sin conocer las rutas de Next, y porque `label`+`order` ya
viven en `NAV_ITEMS` — juntarlos con `minRole` en una sola fila es lo que elimina la segunda
lista, no una comodidad.

**Forma** (esquema, no implementación):

```
sección := { id, route, label, minRole }
mapa    := lista ordenada de secciones   ← el orden de la lista ES el orden del nav
```

> **Enmienda (ráfaga 1, al implementar).** La forma real lleva un campo más:
> `exact?: boolean`, puesto solo en `/admin`. El dashboard es sección **y** raíz de
> todas las demás, así que con la regla de pertenencia por segmento se tragaba
> cualquier `/admin/loquesea` y le prestaba su piso — incluidas las rutas
> inexistentes, que dejaban de ser fail-closed. Es el mismo caso especial, y el
> mismo nombre, que `exact` en `config/account-nav.ts`. Lo detectó el test
> estructural de §6.1, no una revisión. Y un segundo campo, `hiddenFromNav?:
> boolean`, que la ráfaga 1 usa para declarar la anomalía R3 mientras el
> inventario está congelado; la ráfaga 2 lo retira.

### 2.2 El invariante que de verdad hay que garantizar

Aquí está la parte que no es obvia y que cambia el diseño.

**Sección y endpoint NO son 1:1, y no pueden serlo.** Verificado:

- `/admin/usuarios` es **una** sección con piso MODERATOR, servida por **8 endpoints** con
  dos pisos distintos: listar/ver/suspender son `MODERATOR+`, pero banear, cambiar rol,
  `trusted` y `requires-review` son `ADMIN` ([`admin.controller.ts:76-172`](../apps/api/src/modules/admin/admin.controller.ts#L76-L172)).
- `/admin/blog` y `/admin/paginas` son **dos** secciones servidas por **un** controlador
  (`blog-admin.controller.ts`).
- `/admin/anuncios` y `/admin/moderacion` son **dos** secciones que comparten el **mismo**
  endpoint de listado (`GET /admin/listings`).

Por tanto **el backend no puede derivar sus `@Roles` del mapa de secciones**: la relación es
muchos-a-muchos y el backend tiene, a propósito, granularidad más fina que la sección (ese
es justamente el diseño de M4: banear es MODERATOR, marcar para revisión es ADMIN, dentro de
la misma pantalla).

Lo que sí es un invariante, y es el que importa:

> **INV-1.** Para toda sección `S` con piso `R`, todo endpoint que `S` necesita para
> **cargar** debe tener un piso ≤ `R`.

Ése es exactamente el fallo que se produce si se abre `/admin` a EDITOR sin tocar
`GET /admin/stats`: el middleware deja entrar, el nav pinta el ítem, y la página carga y
falla. INV-1 es lo que hay que pinzar con un test, y no la igualdad `sección = @Roles`.

Y su complemento, que es el que garantiza que no se abra nada de más:

> **INV-2.** Ningún endpoint bajo `/admin*` carece de requisito de rol.

INV-2 ya se cumple hoy (los 15 controladores tienen `RolesGuard`, verificado) — el test lo
convierte en una garantía en vez de una casualidad.

### 2.3 Dónde vive el mapa — las tres opciones

**Restricción verificada:** el workspace de pnpm es **solo `apps/*`**
([`pnpm-workspace.yaml`](../pnpm-workspace.yaml)). No existe `packages/`. Los dos apps son
`@marketplace/web` y `@marketplace/api`, no se declaran dependencia mutua, y sus tsconfig
son incompatibles de fábrica: web es `module: esnext` / `moduleResolution: bundler` /
`noEmit`, api es `module: commonjs` con `declaration` y `outDir`.

| Opción | Coste | Veredicto |
|---|---|---|
| **A. Paquete compartido** `packages/shared` | Añadir `packages/*` al workspace; crear el paquete; declararlo dependencia en los dos apps; publicar CJS + `.d.ts` para que `nest build` lo resuelva (el api no tiene `paths`); añadirlo a `transpilePackages` en Next; encajarlo en el `npx tsc --noEmit` que CI corre desde la raíz ([`ci.yml:35`](../.github/workflows/ci.yml)) y en el orden de build de CI | **Descartada para este cuerpo.** No por el coste absoluto, que es acotado, sino porque **se introduciría para un solo fichero** mientras los ~4 espejos que ya existen se quedan como están → dos convenciones a la vez. Ver §2.4 |
| **B. Espejo + test de barrera** | El mapa vive en un lado; el otro guarda solo la mitad que necesita; un test falla si divergen | **ELEGIDA.** Es la convención establecida del repo, y la parte del mapa que el backend necesita no es el mapa (ver §2.2) |
| **C. El mapa lo sirve la API** | Un endpoint que devuelve el mapa; el middleware lo consume con TTL | **Descartada.** Precedente existe ([`category-canonical.ts`](../apps/web/src/lib/category-canonical.ts) hace exactamente esto con TTL 60 s desde el middleware), pero poner la **autorización** detrás de una llamada de red en cada petición añade latencia al camino caliente y un modo de fallo nuevo: si la API no responde, o se cierra el backoffice a todo el mundo o se abre. Ninguno es aceptable para un gate |

### 2.4 Por qué el espejo es la convención de esta casa

No es una concesión: es lo que el repo ya hace, con el porqué escrito. Verificado:

- [`category-canonical.ts:44-49`](../apps/web/src/lib/category-canonical.ts#L44-L49):
  *«Espejo de `CATEGORY_MAX_DEPTH` (api, `category.types.ts`) … **Duplicado aquí por lo
  mismo que el resto de espejos api↔web: no hay paquete compartido**»*.
- [`fiscal.ts:1-5`](../apps/web/src/lib/fiscal.ts#L1-L5): *«espejo de
  `apps/api/src/common/validators/spanish-tax-id.ts`»*.
- [`attribute-schema.ts:5`](../apps/web/src/lib/attribute-schema.ts#L5): *«espejo del
  `filterSchemaByType` del backend»*.

Lo que este cuerpo **añade** a la convención, y es la mejora real: los espejos actuales se
sostienen sobre un comentario. Éste se sostiene sobre **un test que falla en CI si
divergen** (§6.1). El espejo deja de ser un acuerdo de caballeros.

### 2.5 La decisión: qué vive dónde

**Decisión 1.1 — El mapa canónico de secciones vive en el WEB.**
Un módulo nuevo en `apps/web/src/config/` (junto al resto de configuración de presentación).
Razón: cuatro de sus cinco campos son presentación y enrutado (`route`, `label`, `order`) o
sirven a la presentación, y `apps/api` no conoce —ni debe conocer— las rutas de Next ni las
etiquetas en español. Ponerlo en el api obligaría a que el backend cargara con los strings de
la barra lateral, en contra de la regla «Next es solo presentación».

Esto **no** contradice «NestJS es la única fuente de verdad de la lógica de negocio»: la
autorización real sigue siendo el `RolesGuard`, que no se mueve ni se debilita. El mapa es la
tabla de contenidos del backoffice, no la política de acceso.

**Decisión 1.2 — La jerarquía (`ROLE_ORDER`) se duplica como espejo, en dos ficheros
pequeños:** uno en `apps/api/src/common/` (canónico: lo consumen el guard y los
decoradores) y su espejo en `apps/web/src/config/`. Es una lista de cuatro strings; el test
de barrera la pinza. Canónico en el api porque la escalera **sí** es política de
autorización.

**Decisión 1.3 — El backend no importa el mapa. Declara sus pisos y se valida contra él.**
Sigue teniendo sus `@Roles`/`@MinRole` por endpoint, con su granularidad fina. El test de
INV-1 (§6.1) es el que garantiza que las dos declaraciones son compatibles.

### 2.6 Cómo deriva cada capa

**Capa 1 — El middleware.**
`ROLE_ALLOWED_PATHS` **desaparece**. El middleware pasa a resolver la sección del `pathname`
contra el mapa y comparar con `atLeast(session.role, seccion.minRole)`.

Tres cambios de comportamiento, todos deliberados:

1. **Coincidencia por segmento, no por prefijo** (cierra R4): una ruta pertenece a la
   sección `S` si `pathname === S.route` **o** `pathname` empieza por `S.route + '/'`. Hoy
   `startsWith('/admin/anuncios')` casaría con `/admin/anuncios-borrador`.
2. **Ruta bajo `/admin` que no casa con ninguna sección → se deniega.** Hoy el resultado es
   el mismo por accidente (ningún path permitido casa) pero por la razón equivocada. Con el
   mapa es una regla explícita y fail-closed: una sección nueva sin entrada en el mapa es
   inaccesible para todos, incluido ADMIN. Eso es una molestia visible en desarrollo, que es
   exactamente lo que se quiere: obliga a tocar el mapa.
3. **`ADMIN` deja de ser un caso especial.** Hoy hay una rama `if (role === 'ADMIN')` con
   acceso total; con la escalera, ADMIN pasa por la misma comparación que los demás. Menos
   código y una sola ruta de decisión.

Lo que **no** cambia: `/admin/login` sigue excluido explícitamente del gate (si cayera bajo
él, nadie podría llegar nunca — el comentario de
[`middleware.ts:27-32`](../apps/web/src/middleware.ts#L27-L32) ya lo explica y sigue siendo
válido). Ni el orden de los bloques del middleware: la canonicalización de categorías (308),
el 404 real de categorías inexistentes y el redirect de sesión van antes y no se tocan.

**Capa 2 — El nav.**
`NAV_ITEMS` **desaparece**. `AdminNav` recorre el mapa —que ya está ordenado— y filtra con
`atLeast(role, minRole)`. `label` y `order` salen del mapa. Efecto colateral inmediato:
`/admin/motivos-contacto` **aparece en el nav sin trabajo extra** (R3 se cierra por
construcción, no con un parche), porque el nav ya no es una lista aparte que se pueda olvidar.

**Capa 3 — El backend.**
Se conserva `RolesGuard` tal cual: 20 líneas, `getAllAndOverride(ROLES_KEY, [handler,
class])`, `required.includes(user.role)`. **No se toca.**

Lo que se añade es un decorador `@MinRole(rol)` que escribe la **misma** metadata
`ROLES_KEY` expandiendo la escalera con `rolesFrom()`. Es azúcar sobre el guard existente,
no un guard nuevo:

| Hoy | Con `@MinRole` |
|---|---|
| `@Roles(Role.EDITOR, Role.MODERATOR, Role.ADMIN)` | `@MinRole(Role.EDITOR)` |
| `@Roles(Role.MODERATOR, Role.ADMIN)` | `@MinRole(Role.MODERATOR)` |
| `@Roles(Role.ADMIN)` | `@MinRole(Role.ADMIN)` |

Por qué importa más de lo que parece: **elimina la clase de error «olvidé añadir el rol
nuevo a esta lista»**, que es la que provoca las divergencias silenciosas. Y como escribe la
misma metadata, el `RolesGuard`, los tests existentes y el resto del sistema no notan nada.

**Decisión 1.4 — `@Roles` no se elimina.** Se conserva para el único caso que no es una
escalera: `@Roles(Role.USER, Role.MODERATOR, Role.ADMIN)` en
[`moderation.controller.ts:37`](../apps/api/src/modules/moderation/moderation.controller.ts#L37)
(«cualquier usuario autenticado puede denunciar»), que es un `override` hacia abajo dentro de
una clase restringida y no un piso. Convivir es correcto: `@MinRole` para pisos, `@Roles`
para conjuntos.

### 2.7 Los checks intra-sección (capa 3.5, R6)

Verificado: hay exactamente **cinco** lecturas del rol en `(admin)`, y son enumerables.

| Fichero | Uso |
|---|---|
| [`usuarios/page.tsx:219`](../apps/web/src/app/(admin)/admin/usuarios/page.tsx#L219) | `currentUserIsAdmin` → gobierna 6 botones (rol, confianza, revisión, banear, desbanear) |
| [`usuarios/page.tsx:428`](../apps/web/src/app/(admin)/admin/usuarios/page.tsx#L428) | `isAdmin` del usuario **objetivo** (no del actor) — no es un check de permiso, no se toca |
| [`blog/page.tsx:48`](../apps/web/src/app/(admin)/admin/blog/page.tsx#L48) | `currentUserIsAdmin` → botón «Eliminar» |
| [`paginas/page.tsx:48`](../apps/web/src/app/(admin)/admin/paginas/page.tsx#L48) | idem |
| [`AdminUserBar.tsx:15`](../apps/web/src/app/(admin)/components/AdminUserBar.tsx#L15) | elige `/admin/login` vs `/login` al salir — ver §3.6 |

**Decisión 1.5 — Los tres `currentUserIsAdmin` pasan a `atLeast(role, ADMIN)`** vía un helper
único (un hook `useMinRole`). No cambia el comportamiento; deja de comparar literales de
string y queda enganchado a la misma escalera. Cambio pequeño y de bajo riesgo, pero es el
que hace que la escalera sea la única forma de hablar de roles en todo el frontend.

**Fuera de alcance a propósito:** convertir estos checks en declaraciones de la sección
(`section.adminOnlyActions`). Las acciones ADMIN-only dentro de una sección MODERATOR son
información de la sección, sí, pero declararlas exige un vocabulario de acciones que hoy no
existe y que los cuerpos P2/P3/P5 van a cambiar (van a añadir acciones). Se revisita cuando
esas acciones existan; ahora sería un modelo diseñado sobre un inventario que está a punto
de moverse.

### 2.8 Añadir una sección futura: el checklist

Con el mapa, el trabajo es:

1. Crear la ruta `apps/web/src/app/(admin)/admin/<X>/page.tsx`.
2. **Añadir una fila al mapa** (`id`, `route`, `label`, `minRole`, posición).
3. Poner el `@MinRole` correspondiente en su controlador.

El paso 2 alimenta middleware **y** nav. El paso 3 lo pinza el test de INV-1: si el piso del
controlador no es compatible con el de la sección, CI falla. Y si se olvida el paso 2, la
sección es inaccesible para todos (fail-closed) en vez de invisible para algunos.

**De tres listas y un olvido silencioso, a dos declaraciones y un test que grita.**

---

## 3. Pieza 2 — La frescura del rol

### 3.1 El diagnóstico exacto: hay dos credenciales, no una

| | Cookie de sesión de NextAuth | `accessToken` de la API |
|---|---|---|
| Qué lleva | `id`, `slug`, **`role`**, `emailVerified`, y el propio `accessToken` | JWT firmado por Nest con `sub`, `email`, **`tokenVersion`** |
| Quién la lee | middleware, `AdminNav`, los checks intra-sección | `JwtStrategy` en cada petición |
| Cuándo se refresca el rol | **nunca** — [`auth.config.ts:60-67`](../apps/web/src/lib/auth/auth.config.ts#L60-L67) escribe `token.role` solo cuando existe `user`, es decir en el login | no aplica: `JwtStrategy` **ignora** el rol del payload |

**Lo que ya está bien y no se toca:**
[`jwt.strategy.ts:43-49`](../apps/api/src/modules/auth/strategies/jwt.strategy.ts) lee
`role` y `emailVerified` **frescos de la BD** en cada petición, con el comentario que lo
justifica («Cierra la deuda de "rol stale hasta 7 días": un cambio de rol tiene efecto en la
siguiente request, no en el siguiente login»). Y `status` (SUSPENDED/BANNED) se comprueba
igual de fresco, ahí mismo. **El backend es correcto. Suspender o banear a alguien ya surte
efecto al instante y no necesita nada de este cuerpo.**

**El único dato caducado del sistema es la copia del rol en la cookie de NextAuth.** Y su
único escritor en la BD es uno: `changeUserRole`
([`admin.service.ts:607-611`](../apps/api/src/modules/admin/admin.service.ts#L607-L611)) es
la **única** escritura de `User.role` en todo `apps/api/src` (grep verificado). Un solo punto
de estrangulamiento, un solo sitio que arreglar.

### 3.2 Las tres opciones

**A. Incrementar `tokenVersion` en `changeUserRole`.**
El molde existe y está probado: `resetPassword`, `changePassword` y `setPassword` hacen
`data: { …, tokenVersion: { increment: 1 } }`
([`auth.service.ts:336, 519, 551`](../apps/api/src/modules/auth/auth.service.ts#L336)), y
`JwtStrategy` compara contra el payload y lanza `401 'Session invalidated'` si no cuadra.
Efecto: al cambiar el rol, el `accessToken` de esa persona muere → su siguiente llamada a la
API es un 401 → se la saca a `/login` → vuelve a entrar con una cookie que **sí** lleva el
rol nuevo.

- **A favor:** fail-closed, instantáneo, cero mecanismos nuevos, y cierra el círculo entero
  (cookie incluida) sin tocar NextAuth.
- **En contra:** es un martillo — cierra *todas* sus sesiones, en todos sus dispositivos, y
  también al promover. Y **depende de que el 401 se maneje** (§3.4).
- **Semántica:** hoy `tokenVersion` significa «la credencial cambió». Pasaría a significar
  «la sesión ya no vale». Es un ensanchamiento y hay que escribirlo en el comentario del
  campo de `schema.prisma`, no dejarlo implícito.

**B. Refrescar el rol en el callback `jwt` de NextAuth.**
Hay precedente parcial: el bloque `trigger === 'update'`
([`auth.config.ts:68-72`](../apps/web/src/lib/auth/auth.config.ts#L68-L72)) ya refresca
`accessToken` y `emailVerified`, y `verificar-email/page.tsx:28` lo invoca.
- **En contra:** el rol lo tendría que traer una llamada a la API. No existe ningún `GET`
  en [`auth.controller.ts`](../apps/api/src/modules/auth/auth.controller.ts) (los 9 endpoints
  son `@Post`), así que habría que crear un `/auth/me`. Y para que sea útil el refresco tiene
  que ser *automático*, no a petición: eso es una llamada de red en el callback `jwt`, que
  corre en el middleware, en cada petición — o un TTL, y con TTL la degradación tarda.
- **Veredicto:** descartada como mecanismo principal. Convierte el gate en algo dependiente
  de la red por un caso que ocurre unas pocas veces al año.

**C. Que el middleware deje de ser la autoridad: check fresco en el layout servidor.**
Mover el gate de rol a `(admin)/layout.tsx` como Server Component que pregunta a la API.
- **A favor:** cierra R5 (hoy el layout no comprueba nada) y elimina la copia caducada de
  raíz.
- **En contra:** una llamada por navegación; y hay un antecedente incómodo — el
  `app/loading.tsx` de la raíz envuelve toda ruta en Suspense y por eso los redirects de
  categoría **tuvieron que subirse al middleware** ([`middleware.ts:53-61`](../apps/web/src/middleware.ts#L53-L61)).
  Ahí el problema era la cabecera HTTP que ve un crawler; en el backoffice no hay SEO y un
  `redirect()` funciona. Pero es un camino con historia y merece verificarse en vivo antes de
  apostar por él.

### 3.3 Decisión

**Decisión 2.1 — Se implementa A: `changeUserRole` incrementa `tokenVersion`.**
Es el mecanismo que ya existe, es fail-closed, y el único escritor de rol es uno.

**Decisión 2.2 — Y se implementa el manejo del 401 en el backoffice, en el mismo cuerpo.**
No es opcional: sin él, A no produce un re-login limpio sino una pantalla de errores (§3.4).

**Decisión 2.3 — El efecto contratado es «re-login limpio», no «refresco transparente».**
Del par que Ernest admite («que se refleje sin re-loguear, **o al menos** que no le deje ver
puertas que le fallan»), se elige el segundo con la puerta cerrada de golpe: quien cambia de
rol se encuentra en `/login`, y al volver a entrar tiene el rol nuevo en las tres capas. Se
documenta como comportamiento esperado, no como efecto secundario — un moderador degradado a
mitad de una acción **debe** perder la sesión.

**Decisión 2.4 — `C` se aplaza, no se descarta.** Queda anotado como la segunda línea de
defensa que cierra R5, con su verificación pendiente sobre el servidor real. Razón para no
hacerlo ahora: con A + 2.2, la ventana de exposición es «desde que cambia el rol hasta la
primera llamada a la API de esa persona», y en esa ventana **no hay fuga de datos** — la API
es el gate y ya lee el rol fresco. Lo único que ocurre es que ve el armazón de una sección
que ya no le toca, durante segundos. Eso no justifica tocar el layout raíz en el mismo cuerpo
que reescribe el middleware.

### 3.4 El hueco que hay que cerrar a la vez

**Verificado: 0 de los 74 ficheros `.tsx` de `(admin)` usa `useApiAction`.** El hook
([`use-api-action.ts:74-77`](../apps/web/src/lib/api/use-api-action.ts#L74-L77)) es el único
sitio del proyecto que traduce un 401 en `signOut({ callbackUrl })`, y el backoffice no pasa
por él: `/admin/anuncios` y `/admin/usuarios` capturan el error y hacen `alert(msg)` o
`setError(...)` con el texto `Error 401: …`.

`isAuthError` ([`client.ts:47-53`](../apps/web/src/lib/api/client.ts#L47-L53)) ya existe y su
comentario dice literalmente lo que hay que hacer: *«Client components should call signOut()
and redirect to /login when this is true»*. El contrato está escrito; el backoffice no lo
cumple.

**Decisión 2.5 — El backoffice necesita UN manejador de 401, no 74.** Se diseña como una
pieza única en el shell de `(admin)` (el sitio natural: el layout ya monta `AdminNav` y
`AdminUserBar` para todas las secciones), de modo que un 401 en cualquier sección produzca
`signOut` + vuelta al login con `callbackUrl`. Alcance mínimo: **no** se migran las 74
pantallas a `useApiAction`; eso es limpieza de otro cuerpo. Aquí solo se garantiza que el
401 tenga una salida.

Nota: `isAuthError` excluye el 403 a propósito («authenticated but not allowed … must be
handled by the component»). Correcto y se respeta: un 403 en el backoffice significa «esta
acción no es para tu rol», y su sitio es el mensaje de la pantalla, no un logout.

### 3.5 Qué NO se toca

- `suspendUser` / `banUser` / `reinstateUser` **no** incrementan `tokenVersion` y no deben:
  `JwtStrategy` ya rechaza SUSPENDED y BANNED en cada petición, con su propio mensaje en
  español. Añadir el incremento sería un segundo mecanismo para lo mismo.
- `setUserTrusted` / `setUserRequiresReview` tampoco: no afectan al acceso, solo a la
  moderación de los anuncios de esa persona.
- El registro en `AuditLog` de `changeUserRole` (`USER_ROLE_CHANGE`) ya existe y es correcto.

### 3.6 La decisión que arrastra: ¿dónde aterriza un MODERATOR expulsado?

Verificado: `AuthService.adminLogin` **exige `role === ADMIN`**
([`auth.service.ts:179-180`](../apps/api/src/modules/auth/auth.service.ts#L179-L180)), así
que `/admin/login` es ADMIN-only. Y `AdminUserBar` manda a `/login` a todo el que no sea
ADMIN. Hoy eso es coherente: un MODERATOR entra por la puerta de usuario.

Pero con este cuerpo el MODERATOR pasa de 7 a 19 secciones y el EDITOR de 2 a 7 — el
backoffice deja de ser «cosa de admins con dos invitados». Y Pieza 2 hace que los expulse
más a menudo.

**Decisión abierta D-1 (§7):** ¿se abre `/admin/login` a EDITOR y MODERATOR? La
recomendación es **sí**, con el mismo piso que la sección más baja del backoffice
(`EDITOR`), porque la alternativa es que quien trabaja a diario en el backoffice tenga que
recordar que su puerta es otra. Pero cambia el contrato de un endpoint de autenticación y su
mensaje de error (`ADMIN_GOOGLE_LOGIN_BLOCKED` y compañía), así que se marca como decisión
y no como parte del diseño cerrado.

---

## 4. Pieza 3 — El delta de secciones

### 4.1 Verificación: ¿existen todas las secciones de la tabla?

**Sí, las 22.** Verificado contra los directorios de `apps/web/src/app/(admin)/admin/`:
21 subdirectorios + `page.tsx` (dashboard). Ninguna sección de la tabla de Ernest hay que
construirla: `banners`, `footer`, `nav`, `portada`, `campaigns`, `cupones`,
`sponsored-ads`, `tags`, `motivos-contacto` — todas tienen ruta y página.

Y las cuentas de Ernest cuadran exactamente: 22 totales − 3 ADMIN-only = **19 MODERATOR**;
19 − 7 = **12 de delta para MODERATOR**; y EDITOR pasa de 2 (blog, páginas) a 7 → **5 de
delta**. El «contacto» de su tabla son **dos** secciones (`mensajes-contacto` y
`motivos-contacto`), lo que confirma que `motivos-contacto` entra en el reparto — y con ello
gana por fin su entrada en el nav (R3).

### 4.2 El mapa poblado

| # | `id` | `route` | Label | `minRole` | Hoy (middleware) | Cambia |
|---|---|---|---|---|---|---|
| 1 | `dashboard` | `/admin` | Dashboard | **EDITOR** | ADMIN | ✅ |
| 2 | `blog` | `/admin/blog` | Blog | EDITOR | EDITOR | — |
| 3 | `paginas` | `/admin/paginas` | Páginas | EDITOR | EDITOR | — |
| 4 | `portada` | `/admin/portada` | Portada | **EDITOR** | ADMIN | ✅ |
| 5 | `footer` | `/admin/footer` | Footer | **EDITOR** | ADMIN | ✅ |
| 6 | `nav` | `/admin/nav` | Navegación | **EDITOR** | ADMIN | ✅ |
| 7 | `banners` | `/admin/banners` | Banners | **EDITOR** | ADMIN | ✅ |
| 8 | `anuncios` | `/admin/anuncios` | Anuncios | MODERATOR | MODERATOR | — |
| 9 | `cola-revision` | `/admin/moderacion` | Cola de revisión | MODERATOR | MODERATOR | — |
| 10 | `usuarios` | `/admin/usuarios` | Usuarios | MODERATOR | MODERATOR | — |
| 11 | `reportes` | `/admin/reportes` | Reportes | MODERATOR | MODERATOR | — |
| 12 | `tickets` | `/admin/tickets` | Tickets | MODERATOR | MODERATOR | — |
| 13 | `categorias` | `/admin/categorias` | Categorías | **MODERATOR** | ADMIN | ✅ ver §5 |
| 14 | `tags` | `/admin/tags` | Tags | **MODERATOR** | ADMIN | ✅ |
| 15 | `campanas` | `/admin/campaigns` | Campañas | **MODERATOR** | ADMIN | ✅ |
| 16 | `cupones` | `/admin/cupones` | Cupones | **MODERATOR** | ADMIN | ✅ |
| 17 | `patrocinados` | `/admin/sponsored-ads` | Patrocinados | **MODERATOR** | ADMIN | ✅ |
| 18 | `mensajes-contacto` | `/admin/mensajes-contacto` | Mensajes de contacto | **MODERATOR** | ADMIN | ✅ |
| 19 | `motivos-contacto` | `/admin/motivos-contacto` | Motivos de contacto | **MODERATOR** | ADMIN | ✅ **+ nav nuevo** |
| 20 | `facturacion` | `/admin/facturacion` | Facturación | ADMIN | ADMIN | — |
| 21 | `facturas` | `/admin/facturas` | Facturas | ADMIN | ADMIN | — |
| 22 | `ajustes` | `/admin/ajustes` | Ajustes | ADMIN | ADMIN | — |

Cuentas resultantes para los tests: **EDITOR 7 · MODERATOR 19 · ADMIN 22**.

Subrutas cubiertas por el prefijo de su sección (verificadas): `/admin/blog/nuevo`,
`/admin/blog/[id]/editar`, `/admin/paginas/nueva`, `/admin/paginas/[id]/editar`,
`/admin/facturacion/usuarios/[id]`, `/admin/facturas/emisor`,
`/admin/mensajes-contacto/[id]`, `/admin/tickets/nuevo`, `/admin/tickets/[id]`.

### 4.3 INV-1 verificado sección por sección: las dependencias cruzadas

Esto es lo que evita entregar secciones que cargan rotas. Se ha revisado qué clientes de API
importa cada sección que baja de piso:

| Sección | Endpoints propios (hay que bajar el piso) | Endpoints de OTRA sección o públicos | ¿INV-1 se cumple? |
|---|---|---|---|
| `dashboard` → EDITOR | `GET /admin/stats` (hoy hereda ADMIN de la clase) | — | ⚠️ **hay que bajarlo explícitamente** |
| `portada` → EDITOR | `homepage-admin.controller` (clase ADMIN) | `/categories`, `/search` — **públicos** ✔ | ✔ tras bajar el propio |
| `footer` → EDITOR | `footer-admin.controller` (clase ADMIN) | `/admin/blog*` — **ya EDITOR+** ✔ | ✔ |
| `nav` → EDITOR | `nav-admin.controller` (clase ADMIN) | `/admin/blog*` ✔, `/nav` público ✔ | ✔ |
| `banners` → EDITOR | `admin-banners.controller` (clase ADMIN) | `/banners` público ✔ | ✔ |
| `categorias` → MODERATOR | los **7 métodos de categorías** de `AdminController` | `/categories` público ✔ | ⚠️ ver §4.4 |
| `tags` → MODERATOR | `admin-tags.controller` — **dos clases** en el fichero, `@Roles(ADMIN)` en las líneas 35 y 91 | — | ⚠️ hay que bajar **las dos** |
| `campanas` → MODERATOR | `campaigns.controller` (clase ADMIN) | `/billing/catalog` — **sin guard, público** ✔ | ✔ |
| `cupones` → MODERATOR | `admin-coupons.controller` (clase ADMIN) | — | ✔ |
| `patrocinados` → MODERATOR | `admin-sponsored-ads.controller` (clase ADMIN) | `/categories` público ✔ | ✔ |
| `mensajes-contacto` → MODERATOR | `admin-contact-messages.controller` | **`admin-contact-reasons`** — la pantalla lo importa | ⚠️ **las dos secciones tienen que bajar juntas** |
| `motivos-contacto` → MODERATOR | `admin-contact-reasons.controller` | — | ✔ |

**Tres hallazgos que el diseño incorpora:**

1. **`mensajes-contacto` importa el cliente de `motivos-contacto`** (verificado en los
   imports de la sección). No es una suposición sobre si «contacto» son una o dos secciones:
   es una dependencia real. Bajarlas por separado deja la pantalla de mensajes rota. Van
   juntas, y eso confirma la fila 19 de la tabla.
2. **`footer` y `nav` dependen de `/admin/blog*`**, que ya es EDITOR+ desde el cuerpo del
   blog. Suerte, no diseño — pero verificada, y hay que anotarla para que nadie suba el piso
   del blog sin darse cuenta de que rompe dos secciones más.
3. **Ninguna sección que baja depende de un endpoint de facturación, facturas o ajustes.**
   El corte ADMIN es limpio y no hay que hacer excepciones.

### 4.4 El caso `AdminController`: un controlador, cinco secciones, tres pisos

Verificado: [`admin.controller.ts`](../apps/api/src/modules/admin/admin.controller.ts) tiene
`@Roles(Role.ADMIN)` a nivel de clase y sirve **cinco** secciones distintas:

| Bloque del controlador | Sección | Piso objetivo | Estado hoy |
|---|---|---|---|
| `GET stats` | `dashboard` | EDITOR | hereda ADMIN → **override nuevo** |
| `listings*` (3 métodos) | `anuncios` / `cola-revision` | MODERATOR | ya tienen override ✔ |
| `users*` (8 métodos) | `usuarios` | MODERATOR (con 5 acciones ADMIN) | ya tienen override ✔ |
| `categories*` (7 métodos) | `categorias` | MODERATOR | heredan ADMIN → **7 overrides nuevos** |
| `settings*` (2 métodos) | `ajustes` | ADMIN | correcto por herencia ✔ |

**Decisión 3.1 — No se parte el controlador en este cuerpo.** Se añaden los overrides
(`@MinRole`) que faltan. Partirlo en `AdminStatsController` / `AdminCategoriesController` /
`AdminSettingsController` sería lo limpio y **es la recomendación para más adelante**, pero
mueve 22 rutas de sitio y no puede ir en el mismo cuerpo que reescribe el middleware: dos
cambios grandes a la vez hacen indistinguible qué rompió qué. Se anota como deuda.

**Decisión 3.2 — El default de clase deja de ser el piso más alto por accidente.** Con
`@MinRole(Role.ADMIN)` en la clase y overrides por método, la lectura de un método sin
override es «ADMIN a propósito». Hoy `settings` es ADMIN por la misma razón que `categories`
lo era: nadie escribió nada. El test de INV-1 obliga a que cada método bajo `/admin*`
pertenezca a una sección con un piso declarado, lo que convierte esa herencia silenciosa en
una afirmación comprobada.

### 4.5 Las dos decisiones de producto que el delta obliga a tomar

**D-2 — El dashboard para EDITOR (R7).** `getStats()`
([`admin.service.ts:1777`](../apps/api/src/modules/admin/admin.service.ts#L1777)) devuelve:
anuncios activos / en revisión / publicados hoy, usuarios totales y nuevos hoy, reportes
pendientes, conversaciones totales, y el estado del índice de Meilisearch. La tabla de
Ernest dice que EDITOR ve el dashboard. Eso significa que un editor de contenidos ve el
volumen de usuarios y el tamaño de la cola de moderación.

Recomendación: **abrirlo tal cual**. Son agregados, no datos personales, y recortar el
dashboard por rol significa un `getStats` con forma variable — una complicación real para
proteger cifras que no son sensibles. Pero es la decisión de Ernest, y si prefiere recortar,
el sitio es `getStats` (por bloques) y hay que decirlo antes de tocar el `@MinRole`.

**D-3 — `motivos-contacto` a MODERATOR.** Es CRUD del catálogo de motivos del formulario de
contacto. Va a MODERATOR por dos razones verificadas: la pantalla de mensajes ya depende de
sus endpoints (§4.3), y las cuentas de la tabla de Ernest solo cuadran si entra. Se
recomienda aceptarlo.

---

## 5. Pieza 4 — La enmienda a M4: `requiresReview` de categoría pasa a MODERATOR+

### 5.1 Qué decía M4 y por qué

M4 decidió que marcar a un **vendedor** para revisión previa es **ADMIN-only**, y lo
argumentó por escrito en
[`admin.controller.ts:160-162`](../apps/api/src/modules/admin/admin.controller.ts#L160-L162):

> *«ADMIN-only, mismo criterio que la confianza: decidir que alguien pasa por revisión es
> política de plataforma, no una acción de moderación del día a día.»*

Y en [`pre-moderation.service.ts`](../apps/api/src/modules/moderation/pre-moderation.service.ts)
está el resto del razonamiento: los tres niveles del disparador (USUARIO, CATEGORÍA,
PLATAFORMA), y que los dos específicos —usuario y categoría— «nada los afloja».

### 5.2 El choque que crea el nuevo reparto

Abrir `/admin/categorias` a MODERATOR abre, con ella, la casilla `requiresReview` de
categoría que M5 puso en el formulario. Y entonces el criterio de M4 se parte por la mitad:

> Un MODERATOR podría poner en revisión **una rama entera del catálogo** —el nivel
> CATEGORÍA, que la fórmula trata como *específico* y que ninguna confianza afloja— pero no
> podría poner en revisión **a un solo vendedor**.

Eso es incoherente en la dirección peor: el permiso más amplio (una rama, N vendedores
futuros) queda por debajo del más estrecho (un vendedor).

### 5.3 La enmienda

**Decisión 4.1 — `Category.requiresReview` es MODERATOR+.** La razón, que sustituye a la de
M4 para el nivel categoría: **el MODERATOR es quien gestiona la moderación, así que decide
qué ramas se moderan.** Configurar la cola de trabajo propia es trabajo del moderador, no
política de plataforma. Lo que sigue siendo política de plataforma es señalar a una
*persona*.

**Decisión 4.2 — `User.requiresReview` y `User.trusted` se quedan ADMIN-only.** El argumento
de M4 sobrevive intacto para ellos: apuntan a un individuo, tienen efectos reputacionales
(`trusted` pinta una insignia pública) y son la clase de decisión que se audita nominalmente.
La asimetría deja de ser incoherente en cuanto se nombra el eje correcto: **no es
«específico vs. genérico», es «una rama del catálogo vs. una persona».**

**Decisión 4.3 — El interruptor de plataforma (`preModerationAllListings` y
`preModerationTrustedExempt`) se queda ADMIN-only** por construcción: vive en
`/admin/ajustes`, que sigue siendo ADMIN. No hay que hacer nada, pero conviene notar que el
reparto resultante es una escalera limpia:

| Nivel del disparador | Quién lo decide, tras la enmienda |
|---|---|
| PLATAFORMA (todos los anuncios) | ADMIN — `/admin/ajustes` |
| USUARIO (esta persona) | ADMIN — `PATCH /admin/users/:id/requires-review` |
| CATEGORÍA (esta rama) | **MODERATOR** — `/admin/categorias` |

### 5.4 Qué documentos hay que enmendar

Los tres, y con la razón nueva escrita, no solo con el valor cambiado:

1. **[`docs/auditoria-y-diseno-moderacion.md`](./auditoria-y-diseno-moderacion.md)** — la
   sección del nivel CATEGORÍA: añadir la enmienda y remitir a este documento.
2. **[`docs/estado-tecnico.md`](./estado-tecnico.md)** §M4 y §M5 — el estado real cambia.
3. **El comentario de `admin.controller.ts:160-162`** y el de `pre-moderation.service.ts`:
   su argumento sigue siendo válido para `User.requiresReview` y hay que **acotarlo
   explícitamente** a ese caso, o el próximo que lo lea concluirá que la categoría también
   debería ser ADMIN y lo «arreglará» de vuelta.

Esto último es lo importante: en este repo las decisiones viven en los comentarios. Cambiar
el `@MinRole` sin acotar el comentario que dice lo contrario deja una contradicción que se
revertirá sola.

---

## 6. Pieza 5 — El plan de verificación

### 6.1 El test estructural: la barrera (lo que hace real la fuente única)

Cuatro tests. Son el corazón del cuerpo: sin ellos, esto es otra convención escrita.

**T1 — «El middleware y el nav no tienen listas propias.» (web, Jest)**
Ambos derivan del mapa por construcción, así que el test afirma la propiedad observable:
para cada rol y cada sección del mapa, la decisión de acceso del middleware y la visibilidad
del ítem del nav coinciden con `atLeast(rol, minRole)`. Un futuro `if` especial —una sección
tratada aparte «solo por esta vez»— rompe el test.
Corolario que también se afirma: **el nav no muestra nada que el middleware deniegue, y el
middleware no permite nada que el nav esconda**. Ésa era exactamente la divergencia R3.

**T2 — «Ningún endpoint de `/admin*` está sin piso.» (api, Jest — INV-2)**
Recorre las clases de controlador cuyo prefijo empieza por `admin` y afirma que cada handler
tiene metadata `ROLES_KEY` resoluble (propia o heredada de la clase) y que la clase tiene
`RolesGuard`. Hoy pasaría en verde (los 15 controladores lo cumplen); su valor es que
**seguirá pasando** cuando llegue el controlador 16 — y los cuerpos P1-P6 van a añadir
varios.

**T3 — «La escalera es coherente.» (api, Jest)**
Afirma que `rolesFrom(minRole)` produce conjuntos anidados (`EDITOR ⊃ MODERATOR ⊃ ADMIN` en
número de secciones, `⊆` en roles admitidos) y que `atLeast` es reflexiva y transitiva.
Trivial de escribir y es lo que impide que alguien reordene `ROLE_ORDER` y lo rompa todo en
silencio. **Molde:** [`listing-status.transitions.ts`](../apps/api/src/modules/listings/listing-status.transitions.ts)
— un fichero puro de constantes con su test, sin DI. Es exactamente el mismo patrón.

**T4 — «Los dos espejos no han divergido.» (api + web, Jest)**
El único espejo real de este cuerpo es `ROLE_ORDER` (Decisión 1.2): cuatro strings. El test
—uno a cada lado— afirma que la lista coincide con la del otro fichero **y** con los valores
del enum `Role` de Prisma. Que incluya el enum de Prisma es lo que detecta el caso peor: se
añade un rol quinto al schema y nadie lo mete en la escalera.

**INV-1 no se verifica aquí.** Es la decisión más importante de este plan y merece
justificarse: el invariante «los endpoints que la sección necesita para cargar tienen piso
≤ el de la sección» **no es comprobable declarativamente**, porque «qué endpoints necesita
para cargar» no está declarado en ningún sitio (sale de los imports y del orden de los
`useEffect`). Intentar declararlo produciría una tercera lista que mantener a mano — el
defecto que este cuerpo viene a cerrar. **INV-1 se verifica con comportamiento**: §6.3.

### 6.2 `admin-roles.spec.ts`: qué debe afirmar tras el cambio

Es el caso legítimo de tocar tests porque el inventario cambió a propósito. Estado
verificado hoy: 22 tests, y **tres** pinzan cuentas del nav — 21 ítems para ADMIN
(`admin-roles.spec.ts:61`), 7 para MODERATOR (`:175`), 2 para EDITOR (`:316`).

| Test hoy | Qué pasa | Qué debe afirmar |
|---|---|---|
| `ADMIN … 21 ítems` | rompe | **22 ítems** (entra `motivos-contacto`) |
| `AdminNav 7 ítems para MODERATOR` | rompe | **19 ítems** |
| `AdminNav 2 ítems para EDITOR` | rompe | **7 ítems** |
| `MODERATOR → /admin redirige a /` | rompe | **carga** (dashboard es EDITOR+) |
| `MODERATOR → /admin/ajustes redirige a /` | pasa | se conserva tal cual |
| `MODERATOR → /admin/facturacion redirige a /` | pasa | se conserva tal cual |
| `EDITOR → /admin redirige a /` | rompe | **carga** |
| `EDITOR → BLOCKED_PATHS redirige` (8 casos generados de una lista: `usuarios`, `facturacion`, `categorias`, `reportes`, `cupones`, **`banners`**, `ajustes`, `anuncios`) | **rompe UNO: `banners`** | `banners` pasa a EDITOR → hay que **sacarlo de `BLOCKED_PATHS`** y comprobar que carga. Los otros 7 siguen bloqueados para EDITOR y se conservan tal cual (`categorias` y `cupones` bajan solo a MODERATOR, que está por encima de EDITOR) |
| `MODERATOR no ve «Banear»` | pasa | se conserva — pinza la frontera intra-sección |
| `EDITOR/MODERATOR no ven «Eliminar» en blog` | pasa | se conserva |
| `ADMIN cambia rol USER→EDITOR→MODERATOR→USER` con re-login | **cambia de significado** | Con Pieza 2 el re-login ya no es un truco del test: es el comportamiento. El test debe **afirmarlo** — tras el cambio de rol, la sesión vieja queda invalidada |

**Un test nuevo, el de Pieza 2:** un MODERATOR con sesión abierta en el backoffice es
degradado a USER por un ADMIN; su siguiente acción lo saca a `/login` (no lo deja en una
pantalla con `Error 401`). Es la afirmación de la Decisión 2.3 y hoy no existe nada parecido.

### 6.3 Playwright: la matriz derivada del mapa (aquí se verifica INV-1)

**Decisión 5.1 — Los casos de Playwright se generan a partir del mapa, no se escriben a
mano.** Es lo que hace que el barrido no envejezca: añadir una fila al mapa añade sus casos.

Para cada una de las 22 secciones × 3 roles de staff = **66 casos**, dos afirmaciones según
el lado de la escalera:

- **Permitido** (`atLeast(rol, minRole)`): la ruta **carga** —no redirige— **y la pantalla
  no muestra un error de autorización**. Esa segunda mitad es INV-1: es lo que detecta el
  dashboard abierto a EDITOR con `GET /admin/stats` todavía en ADMIN. Una aserción de «no
  hay 403/401 en la página» es más barata y más honesta que declarar qué endpoints llama cada
  sección.
- **Denegado**: redirige a `/` **y** el ítem no está en el nav.

Los fixtures ya existen (`adminContext` / `moderatorContext` / `editorContext`) y el
`global-setup` ya siembra `admin-e2e@`, `moderator-e2e@` y `editor-e2e@example.com`
(verificado en la cabecera de `admin-roles.spec.ts`). No hace falta infraestructura nueva.

**Coste y mitigación:** 66 navegaciones es notable para un CI que ya tiene una suite grande.
Recomendación: un solo `test` por rol que recorra sus secciones en la misma página/contexto
(3 tests, 66 aserciones) en lugar de 66 tests con 66 arranques de contexto.

### 6.4 Backend (Jest unit + e2e)

- `rolesFrom` / `atLeast`: tablas puras, molde `listing-status.transitions`.
- `@MinRole` escribe la misma metadata que `@Roles` para cada piso — el test que garantiza
  que el azúcar no cambia el comportamiento del guard.
- Por cada controlador que baja de piso: un e2e que confirma que el rol nuevo pasa (200) y
  que el rol inmediatamente inferior no (403). Doce controladores, y es la única forma de
  saber que el `@MinRole` está donde se cree.
- `changeUserRole` incrementa `tokenVersion`: unit sobre el servicio, y un e2e que use el
  token viejo después del cambio y espere **401** (no 403).
- **El caso que hoy no está pinzado y que este cuerpo debe pinzar:** las cinco acciones
  ADMIN-only dentro de `/admin/usuarios` (ban, reinstate, role, trusted, requires-review)
  siguen devolviendo 403 a un MODERATOR. Es la frontera intra-sección, y hoy solo se verifica
  desde la UI («no ve el botón»), no desde la API.

---

## 7. Riesgos y decisiones abiertas

### 7.1 Decisiones que necesitan el visto bueno de Ernest

| # | Decisión | Recomendación |
|---|---|---|
| **D-1** | ¿Se abre `/admin/login` a EDITOR y MODERATOR? Hoy `adminLogin` exige ADMIN estricto ([`auth.service.ts:179`](../apps/api/src/modules/auth/auth.service.ts#L179)) | **Sí, piso EDITOR.** Con 19 secciones para MODERATOR, obligarle a entrar por la puerta de usuario es fricción diaria. Cambia el contrato de un endpoint de auth → decisión, no diseño cerrado |
| **D-2** | El dashboard para EDITOR expone volumen de usuarios y tamaño de la cola de moderación | **Abrirlo tal cual.** Son agregados, no datos personales. Si se prefiere recortar, hay que decirlo antes: el sitio es `getStats`, por bloques |
| **D-3** | `motivos-contacto` a MODERATOR | **Sí.** Dependencia verificada de `mensajes-contacto`, y las cuentas de la tabla solo cuadran así |
| **D-4** | ¿`(admin)/layout.tsx` con check de rol servidor (R5, opción C)? | **Aplazar.** Sin fuga de datos en la ventana; y toca el layout raíz, que tiene historia con el Suspense de `loading.tsx` |
| **D-5** | ¿Partir `AdminController` (5 secciones, 3 pisos)? | **No en este cuerpo.** Mueve 22 rutas; anotarlo como deuda |

### 7.2 Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| 1 | **Abrir 17 secciones de golpe amplía la superficie de daño.** Un MODERATOR pasa a poder crear cupones y campañas (dinero) y editar el catálogo de categorías (afecta a todos los anuncios publicados) | Es lo pedido y es una decisión de confianza, no técnica. Lo que el diseño aporta: `AuditLog` ya registra `CATEGORY_*`, `COUPON_*`, `SPONSORED_AD_*`, así que **queda traza de quién hizo qué**. Merece confirmarse que la cobertura de auditoría es completa en las 12 secciones que bajan — no se ha verificado endpoint por endpoint |
| 2 | **`deleteCategory` en manos de MODERATOR.** Borrar una categoría con anuncios o patrocinados dentro | Verificado: `deleteCategory` **ya tiene guardas** (rechaza si hay hijos/anuncios/patrocinados — el comentario de `SponsoredAd.categoryId` lo documenta). El riesgo está acotado por el código, no por el rol |
| 3 | **Pieza 2 sin Decisión 2.5 empeora la experiencia**: 401 sin manejador = pantalla de errores en vez de re-login | Van en el mismo cuerpo. No se mezcla el `increment` de `tokenVersion` sin el manejador |
| 4 | **Reescribir el middleware toca el camino de TODAS las peticiones**, no solo `/admin` (el `matcher` es global y ahí viven los 308 de categoría y el 404 real) | El bloque de roles es el último del fichero y es independiente de los tres anteriores. Regla del cuerpo: **no se toca nada por encima de `isAdminRoute`.** El e2e de categorías anidadas (`categoria-urls-anidadas.spec.ts`) es la red |
| 5 | **La enmienda a M4 se revertirá sola** si se cambia el `@MinRole` sin acotar los comentarios que argumentan lo contrario | §5.4 lo hace parte del alcance, no un extra |
| 6 | El mapa vive en el web y algún día habrá un segundo consumidor (una app de soporte, un cron) | El momento de crear `packages/shared` es cuando aparezca ese consumidor. Anotado, no anticipado |
| 7 | 66 casos de Playwright encarecen el CI | §6.3: 3 tests con 66 aserciones, no 66 tests |

### 7.3 Lo que este cuerpo NO hace (para que no se cuele)

- No cambia lo que hace ninguna sección por dentro (eso es P1-P6).
- No toca `RolesGuard`, `JwtStrategy` ni el enum `Role`.
- No añade ni un permiso a `USER`.
- No migra las 74 pantallas de `(admin)` a `useApiAction` — solo garantiza que el 401 tenga
  salida.
- No parte `AdminController` ni crea `packages/shared`.

---

## 8. Orden de implementación dentro del cuerpo

Cinco pasos, cada uno con CI verde antes del siguiente. El orden está elegido para que la
frescura llegue **antes** de ampliar el acceso (si no, se amplía sobre sesiones caducadas y
se multiplica el síntoma de R1).

| # | Paso | Qué queda verde | Riesgo |
|---|---|---|---|
| 1 | **La escalera y su espejo** (`ROLE_ORDER`, `rolesFrom`, `atLeast`, `@MinRole`) + T3, T4. Sin cambiar ni un piso: `@MinRole` sustituye a `@Roles` allí donde el conjunto es idéntico | Todo el CI actual, sin cambios de comportamiento | Mínimo — es una refactorización con equivalencia comprobada |
| 2 | **Pieza 2: frescura.** `tokenVersion` en `changeUserRole` + el manejador de 401 del backoffice + su e2e | El e2e de cambio de rol pasa a afirmar la invalidación | Bajo, y aislado del middleware |
| 3 | **Pieza 1: el mapa.** Se crea con **los pisos de HOY**; middleware y nav pasan a derivar de él; T1, T2. **El comportamiento no cambia** | Los 22 tests de `admin-roles.spec.ts` siguen en verde, incluidos los 21/7/2 | Aquí está el riesgo 4. Que el inventario no cambie es lo que permite usar la suite existente como red |
| 4 | **Pieza 3: el delta.** Se cambian los 17 pisos del mapa y los `@MinRole` de los 12 controladores. Se reescriben los tests de cuentas a 22/19/7 y se añade la matriz de 66 casos | La matriz es la que descubre los INV-1 que falten | Medio — pero el paso 3 dejó la maquinaria probada, así que un fallo aquí es un piso mal puesto, no un middleware roto |
| 5 | **Pieza 4: la enmienda a M4.** El `@MinRole` de las categorías va en el paso 4; aquí van los **documentos y los comentarios** (§5.4) | — | Ninguno técnico. Es el paso que evita que el paso 4 se revierta |

**Por qué 3 antes de 4, separados:** es la decisión de proceso que más reduce el riesgo del
cuerpo. El paso 3 es la reescritura peligrosa (middleware global) **con inventario
congelado**, así que la suite de roles que ya existe funciona como red completa. El paso 4 es
el cambio de inventario **sobre maquinaria ya probada**. Juntarlos haría imposible saber si
un fallo viene de la derivación o del piso.

---

## Apéndice — inventario verificado

| Qué | Dónde | Dato verificado |
|---|---|---|
| Enum `Role` | [`schema.prisma:38`](../apps/api/prisma/schema.prisma#L38) | 4 valores, plano, no ordinal |
| Único escritor de `User.role` | [`admin.service.ts:609`](../apps/api/src/modules/admin/admin.service.ts#L609) | 1 sola coincidencia en `apps/api/src` |
| `tokenVersion`: escritores | [`auth.service.ts:336, 519, 551`](../apps/api/src/modules/auth/auth.service.ts#L336) | 3, todos de contraseña; **ninguno de rol** |
| `tokenVersion`: lector | [`jwt.strategy.ts:33`](../apps/api/src/modules/auth/strategies/jwt.strategy.ts#L33) | mismatch → `401 'Session invalidated'` |
| Rol fresco en backend | [`jwt.strategy.ts:43-49`](../apps/api/src/modules/auth/strategies/jwt.strategy.ts#L43-L49) | `role` y `emailVerified` leídos de la BD por petición |
| Rol congelado en frontend | [`auth.config.ts:60-72`](../apps/web/src/lib/auth/auth.config.ts#L60-L72) | `token.role` solo si existe `user`; `trigger:'update'` refresca `accessToken`/`emailVerified`, **no `role`** |
| Manejo de 401 | [`use-api-action.ts:74`](../apps/web/src/lib/api/use-api-action.ts#L74) → `signOut` | **0 de 74** ficheros `.tsx` de `(admin)` lo usan |
| Lista de rutas (middleware) | [`middleware.ts:37-42`](../apps/web/src/middleware.ts#L37-L42) | `ROLE_ALLOWED_PATHS`, 2 entradas, `startsWith` |
| Lista del nav | [`AdminNav.tsx:8-40`](../apps/web/src/app/(admin)/components/AdminNav.tsx#L8-L40) | 21 ítems; falta `motivos-contacto` |
| Secciones reales | `apps/web/src/app/(admin)/admin/` | 21 dirs + `page.tsx` = **22** |
| Controladores admin | 15 ficheros `@Controller('admin*')` | **todos** con `RolesGuard` (INV-2 se cumple hoy) |
| `adminLogin` | [`auth.service.ts:179`](../apps/api/src/modules/auth/auth.service.ts#L179) | `role !== ADMIN` → 403 |
| Precedente de espejo | [`category-canonical.ts:44-49`](../apps/web/src/lib/category-canonical.ts#L44-L49) · [`fiscal.ts:1`](../apps/web/src/lib/fiscal.ts#L1) · [`attribute-schema.ts:5`](../apps/web/src/lib/attribute-schema.ts#L5) | «Duplicado aquí … no hay paquete compartido» |
| Precedente de tabla pura + test | [`listing-status.transitions.ts`](../apps/api/src/modules/listings/listing-status.transitions.ts) | fichero sin DI, con e2e que lo pinza |
| Workspace | [`pnpm-workspace.yaml`](../pnpm-workspace.yaml) | solo `apps/*`; no hay `packages/` |
| Runners de test | `apps/*/package.json` | Jest en los dos + Playwright en web; los 4 pasos corren en CI |
| Fixtures de rol | `apps/web/e2e/fixtures/auth` + `global-setup.ts` | `adminContext`, `moderatorContext`, `editorContext` ya existen |
