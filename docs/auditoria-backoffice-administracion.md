# Auditoría — el backoffice y los sistemas que toca

**Fecha:** 2026-08-18 · **Rama:** `main` (último merge: moderación previa M5)
**Naturaleza:** diagnóstico puro. Inventario de lo que HAY, no diseño de lo que falta.
**Para qué:** decidir el orden de los cuerpos de los 6 puntos + el arreglo de roles, y
diseñar cada uno sobre lo real.

Todo lo que se afirma aquí está verificado leyendo el código, el `schema.prisma` y las
rutas. Donde algo no se ha podido comprobar, se dice.

---

## 0. Resumen ejecutivo

El backoffice existe y es grande: **22 secciones** bajo `/admin/*` (21 en el nav + una
huérfana), 15 controladores de API con `RolesGuard`, y un `AuditLog` que ya registra las
acciones administrativas. Lo que falta no es el andamio — es la **profundidad** en las dos
secciones que más se van a tocar (anuncios y usuarios) y una **política de borrado**
inexistente como tal.

Los cuatro hallazgos que gobiernan el plan:

1. **Los roles se comprueban en TRES sitios que se mantienen a mano** (middleware de Next,
   `NAV_ITEMS` del componente, `@Roles` del backend). No hay fuente única. El propio
   comentario del middleware lo admite: *«sin el path la sección es inaccesible; sin el ítem
   del nav, invisible»*. Y hay una **cuarta desincronización real**: el backend lee el rol
   fresco de la BD en cada petición, el frontend lo tiene congelado desde el login.
2. **`/admin/anuncios` es una tabla con un selector de estado, y nada más.** No hay ficha,
   no hay edición, no hay borrado, y de los tres filtros que el backend ofrece el cliente
   solo envía uno. El endpoint `GET /admin/listings/:id` **existe en el backend y no lo
   llama nadie** — P4 tiene ya media pieza construida y muerta.
3. **El borrado de un anuncio hoy es del USUARIO, no del staff, y es al revés de lo que
   Ernest quiere.** El dueño puede eliminar cualquier anuncio suyo desde cualquier estado;
   el staff no puede eliminar ninguno. Y el borrado **destruye los reportes** del anuncio
   (`onDelete: Cascade`) y **deja las fotos y el vídeo en el bucket para siempre**.
4. **No existe nada parecido a una etiqueta interna** (P1). El campo más cercano,
   `needsRevalidation`, es lo contrario: está pensado para que lo vea el vendedor. Y el
   *motivo* por el que un anuncio entró en revisión (`ReviewTrigger`) se calcula, se usa
   y **se tira** — nunca se persiste.

---

## Bloque 1 — Roles (el cimiento)

### 1.1 El modelo

`apps/api/prisma/schema.prisma:38`

```prisma
enum Role { USER  MODERATOR  ADMIN  EDITOR }
```

Los cuatro roles existen. `User.role Role @default(USER)` ([schema.prisma:309](../apps/api/prisma/schema.prisma#L309)).
No hay tabla de permisos, ni jerarquía declarada, ni concepto de "staff": cada sitio que
comprueba el rol **enumera a mano los roles admitidos**. `Role` no es ordinal — `ADMIN` no
"incluye" a `MODERATOR` por construcción; se repite en cada lista.

Nota: `UserStatus { ACTIVE SUSPENDED BANNED }` es un eje aparte y sí se comprueba de forma
centralizada (`JwtStrategy` rechaza SUSPENDED/BANNED antes de que el rol importe).

### 1.2 Los tres (y medio) sitios donde se comprueba el rol

| # | Dónde | Qué protege | Fuente |
|---|---|---|---|
| 1 | `apps/web/src/middleware.ts:37` — `ROLE_ALLOWED_PATHS` | Acceso a la RUTA. `ADMIN` pasa siempre; los demás por prefijo `startsWith`. Un rol no listado se redirige a `/`. | Sesión de NextAuth |
| 2 | `apps/web/src/app/(admin)/components/AdminNav.tsx:8` — `NAV_ITEMS[].roles` | VISIBILIDAD del ítem en la barra lateral. No protege nada. | Sesión de NextAuth |
| 3 | `@Roles(...)` + `RolesGuard` en 15 controladores de API | La autorización REAL. | BD, fresca |
| 3.5 | Checks ad-hoc dentro de las páginas | Botones. Ej. `currentUserIsAdmin` en [usuarios/page.tsx:219](../apps/web/src/app/(admin)/admin/usuarios/page.tsx#L219) gobierna Banear/Rol/Confianza/Revisión | Sesión de NextAuth |

**El molde de un check de rol en el backend** (lo que se reutilizará para el arreglo):

```ts
// apps/api/src/modules/admin/admin.controller.ts
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)                       // ← default de la clase
export class AdminController {
  @Get('listings')
  @Roles(Role.MODERATOR, Role.ADMIN)     // ← override por método
  listListings(...) {}
}
```

`RolesGuard` ([roles.guard.ts](../apps/api/src/common/guards/roles.guard.ts)) es 20 líneas:
`getAllAndOverride(ROLES_KEY, [handler, class])` y `required.includes(user.role)`. Sin
metadatos → pasa. **El patrón "clase restrictiva + override permisivo por método" es el
molde establecido** y funciona bien; el problema no está en el guard.

### 1.3 Qué protege cada sección HOY vs. lo que Ernest quiere

`E` = EDITOR, `M` = MODERATOR, `A` = ADMIN. Columna "API" = el `@Roles` efectivo del
endpoint que la sección consume.

| Sección | Middleware hoy | Nav hoy | API hoy | Objetivo | Δ |
|---|---|---|---|---|---|
| `/admin` (dashboard) | A | A | A (`GET /admin/stats`) | **E M A** | **falta E, M** (ruta + nav + endpoint) |
| `/admin/anuncios` | M A | M A | M A | M A | ok |
| `/admin/moderacion` (cola) | M A | M A | M A | M A | ok |
| `/admin/usuarios` | M A | M A | M A (lista/suspender) · A (ban/rol/trusted/revisión) | M A | ok en lectura; ver §1.4-R6 |
| `/admin/reportes` | M A | M A | M A | M A | ok |
| `/admin/tickets` | M A | M A | M A | M A | ok |
| `/admin/blog` | E M A | E M A | E M A (borrado físico: A) | E M A | ok |
| `/admin/paginas` | E M A | E M A | E M A | E M A | ok |
| `/admin/portada` | A | A | A | **E M A** | **falta E, M** |
| `/admin/footer` | A | A | A | **E M A** | **falta E, M** |
| `/admin/nav` | A | A | A | **E M A** | **falta E, M** |
| `/admin/banners` | A | A | A | **E M A** | **falta E, M** |
| `/admin/categorias` | A | A | A | **M A** | **falta M** — ojo §5.1 |
| `/admin/tags` | A | A | A | **M A** | **falta M** |
| `/admin/campaigns` | A | A | A | **M A** | **falta M** |
| `/admin/cupones` | A | A | A | **M A** | **falta M** |
| `/admin/sponsored-ads` | A | A | A | **M A** | **falta M** |
| `/admin/mensajes-contacto` | A | A | A | **M A** | **falta M** |
| `/admin/motivos-contacto` | A | **(ninguno)** | A | **M A** | **falta M + el ítem del nav** |
| `/admin/facturacion` | A | A | A | A | ok |
| `/admin/facturas` | A | A | A | A | ok |
| `/admin/ajustes` | A | A | A | A | ok |

Cuenta del delta: **5 secciones nuevas para EDITOR** y **12 para MODERATOR**, cada una en
3 capas (ruta, nav, endpoint) = ~50 puntos de edición si se sigue haciendo a mano. Ése es
el argumento para unificar antes de ampliar, no después.

### 1.4 En qué «no funciona bien» — problemas concretos

**R1 — El rol del frontend está congelado en el login; el del backend, no.**
`JwtStrategy.validate` ([jwt.strategy.ts:43-49](../apps/api/src/modules/auth/strategies/jwt.strategy.ts)) lee
`role` **fresco de la BD** en cada petición, con un comentario explícito de que eso cierra
la deuda de «rol stale hasta 7 días». Pero en Next, `auth.config.ts:60-74` escribe
`token.role` **solo cuando `user` está presente** (es decir, en el login), y el
`trigger === 'update'` refresca `accessToken` y `emailVerified` — **no `role`**.
`changeUserRole` ([admin.service.ts:588](../apps/api/src/modules/admin/admin.service.ts#L588))
tampoco incrementa `tokenVersion`, que es el mecanismo que sí invalidaría la sesión.

Consecuencia verificable en las dos direcciones:
- **Degradar** a un MODERATOR no le cierra la puerta: el middleware sigue dejándole entrar
  en `/admin/anuncios` con su sesión vieja. La API le responde 403, así que no hay fuga de
  datos, pero **ve el backoffice y todo le falla** — el peor de los dos mundos.
- **Promover** a alguien no le abre nada hasta que vuelve a entrar. El propio e2e lo
  documenta: `admin-roles.spec.ts` tiene un helper `loginAs()` para forzar el re-login
  «to verify that a role change actually takes effect».

**R2 — Tres listas de roles sin fuente única.** Añadir una sección exige tocar
`ROLE_ALLOWED_PATHS`, `NAV_ITEMS` y el `@Roles` del controlador. Olvidar la primera la hace
inaccesible; olvidar la segunda, invisible; olvidar la tercera, un 403 silencioso. El
comentario del middleware (líneas 38-39) documenta este acoplamiento como algo que hay que
recordar, no como algo resuelto.

**R3 — `/admin/motivos-contacto` no tiene entrada en el nav.** La sección existe, es
alcanzable escribiendo la URL, y ningún ADMIN la encuentra navegando. Es el caso R2
materializado.

**R4 — El acceso se decide por `startsWith` sobre el prefijo.**
`ROLE_ALLOWED_PATHS[role].some(p => pathname.startsWith(p))`. Hoy no hay colisión real
(no existe `/admin/anuncios-algo`), pero cualquier sección futura cuyo nombre empiece
igual que una permitida se abre sola. Es una bomba de relojería, no un bug activo.

**R5 — El layout de `(admin)` no comprueba nada.**
[`(admin)/layout.tsx`](../apps/web/src/app/(admin)/layout.tsx) pinta el shell sin mirar la
sesión. **Toda** la protección de ruta es el middleware. No es un agujero (el `matcher`
cubre `/admin/*`), pero significa que un fallo o una exclusión en el middleware deja la
sección desnuda, sin segunda línea.

**R6 — La frontera ADMIN/MODERATOR dentro de una sección abierta es ad-hoc.** En
`/admin/usuarios`, qué puede hacer un MODERATOR se decide con `currentUserIsAdmin &&` en
6 puntos del JSX. Está correcto y coincide con el backend, pero es un patrón que no
escala: cada acción nueva es un `&&` que se puede olvidar, y el e2e solo pinza dos
(«Banear» en usuarios, «Eliminar» en blog).

**R7 — El dashboard es la única sección donde el objetivo choca con el diseño actual del
endpoint.** `GET /admin/stats` devuelve totales de anuncios, usuarios, reportes,
conversaciones y estado de Meilisearch. Abrirlo a EDITOR significa decidir si un editor de
contenidos debe ver el volumen de usuarios y la cola de moderación. Es una decisión de
producto, no un cambio mecánico de `@Roles`.

**Lo que NO está mal (verificado):** los 15 controladores `@Controller('admin*')` tienen
todos `RolesGuard`. No hay ninguna sección del backoffice sin protección en el backend.

---

## Bloque 2 — Administración de anuncios (P1, P3, P4, P6)

### 2.1 Qué es `/admin/anuncios` hoy

[357 líneas](../apps/web/src/app/(admin)/admin/anuncios/page.tsx), client-side, una tabla
paginada de 20.

- **Columnas:** Anuncio (título + categoría + contador de reportes), Vendedor (nombre +
  email), Estado, Precio, Publicado, Acciones.
- **Única acción:** «Cambiar estado» → formulario en línea con un `<select>` de
  **4 destinos** (`TARGET_STATUSES = ['ACTIVE','PENDING_REVIEW','REJECTED','DRAFT']`) y un
  campo de razón opcional.
- El envío pasa por `elegirAccionDeEstado()` (la función pura de M2): aprobar y rechazar
  van a `/moderation/listings/:id/{approve,reject}`; el resto, al genérico
  `PATCH /admin/listings/:id/status`.
- **No hay:** enlace a una ficha de administración, edición, borrado, selección múltiple,
  ni acción en lote. El título enlaza a la ficha **pública** `/anuncio/{slug}` en pestaña
  nueva.

`/admin/moderacion` (la cola de M3) es una pantalla hermana que consume el **mismo**
endpoint con `status=PENDING_REVIEW&order=oldest` y ofrece las tres salidas
(aprobar/rechazar/devolver a borrador) con el motivo del fallo en la fila.

### 2.2 P3 — Edición desde el backoffice: **NO EXISTE**

No hay ningún endpoint de administración que escriba campos de un anuncio. `PATCH
/admin/listings/:id/status` escribe **solo** `status` (+ `publishedAt`/`expiresAt` cuando
va a ACTIVE). El único escritor de contenido es `PATCH /listings/:id` →
`ListingsService.update()`, y su primera línea es
`await this.assertOwnership(id, userId)`:

```ts
// listings.service.ts
private async assertOwnership(id: string, userId: string): Promise<Listing> {
  const listing = await this.prisma.listing.findUnique({ where: { id } });
  if (!listing) throw new NotFoundException('Anuncio no encontrado');
  if (listing.sellerId !== userId) throw new ForbiddenException('No tienes permiso sobre este anuncio');
  return listing;
}
```

**No admite excepción para staff.** Mismo helper para `update`, `archive`, `remove`,
`publish`, `renew`, `pause`, `reactivate`, `closeDeal`, `getMine`.

Qué SÍ puede editar el dueño hoy (el techo de lo reutilizable para P3), en
`UpdateListingDto` vía `update()`:
`title`, `description`, `price`, `currency`, `condition`, `priceType`, `priceUnit`,
**`categoryId`**, `attributes`, `city`, `province`, `postalCode`, `latitude`, `longitude`,
`phone`, `tags`, `imageIds`.

- **La categoría SÍ se puede cambiar** — con toda su validación: cadena de ancestros,
  `applicableSchemaFor`, `validateRequired` sobre el bag completo, delta de atributos con
  *grandfathering*, `validateListingTypeAllowed`, `validatePriceUnitAllowed`, y **poda
  silenciosa de tags** que la categoría destino no ofrece. Esta lógica es densa y está bien
  razonada: P3 debe **reutilizarla**, no reimplementarla.
- **`type` (PRODUCT/SERVICE) es INMUTABLE** — no está en el DTO, a propósito.
- **`sellerId` NO se puede cambiar por ninguna vía.** No hay endpoint, no está en ningún
  DTO. P3 (cambiar propietario) es 100 % nuevo, y es el punto más delicado del conjunto
  (ver §5.3).
- **`status` no se toca al editar**, y hay un comentario largo que explica por qué: *«editar
  limpia, pero nunca frena»* — editar es la vía de salida de un anuncio marcado. Un ACTIVE
  editado sigue ACTIVE, sin volver a revisión.
- Existe un formulario reutilizable, `components/publicar/EditarForm.tsx`, que hoy consume
  `/listings/mine/:id` (owner-scope).

### 2.3 P4 — Información de un anuncio: **A MEDIAS, y la mitad está muerta**

`GET /admin/listings/:id` → `AdminService.getListingById()`
([admin.service.ts:345](../apps/api/src/modules/admin/admin.service.ts#L345)) **existe** y
devuelve: el anuncio completo, `category` completa, todas las `images` ordenadas, el
`seller` (id, nombre, email, slug, status, role, createdAt), los **10 últimos `reports`**
con su reporter, y `_count.conversations`.

**Y no lo llama nadie.** `apps/web/src/lib/api/admin.ts` no tiene función cliente para él
(grep confirmado: la única referencia a `/admin/listings/` en el web es
`/status`). Es una pieza de P4 construida, protegida (`@Roles(MODERATOR, ADMIN)`) y sin
consumidor.

Lo que ese endpoint **no** trae y P4 pide: valoraciones (`Listing.reviews`), tickets
asociados (`Listing.tickets`), favoritos, vistas (`viewCount` viene en el objeto,
`ListingViewDaily` no), entitlements/destacados, `BumpSchedule`, vídeo (los cuatro campos
vienen por estar en el modelo), y el **historial de `AuditLog` del anuncio** — que existe
en BD (`resourceType: 'Listing'`, con índice `[resourceType, resourceId]`) y no se consulta
en ningún sitio.

Relaciones disponibles en el modelo `Listing` para una ficha completa:
`images`, `favorites`, `conversations`, `deals`, `reports`, `reviews`, `entitlements`,
`transactions`, `viewsDaily`, `alertMatches`, `tickets`, `tags`, `bumpSchedule`.

### 2.4 P6 — Filtrar y ordenar: **A MEDIAS, con el cliente por detrás del backend**

`ListAdminListingsDto` (backend) acepta: `status`, `categoryId`, `sellerId`,
`order: 'recent'|'oldest'`, `page`, `perPage`. Sin búsqueda por texto.

`getAdminListings` (cliente web) **solo envía** `status`, `page`, `perPage`, `order`.
`categoryId` y `sellerId` no están ni en la firma de la función.

La UI de `/admin/anuncios` expone: **6 chips de estado** (Todos, Activos, En revisión,
Rechazados, Borrador, Caducados) y **nada más**. Sin orden, sin categoría, sin vendedor,
sin texto, sin rango de fechas ni de precio.

**Dos huecos con consecuencia visible:**
- Los chips no incluyen `PAUSED`, `ARCHIVED`, `RESERVED` ni `SOLD`. Y `STATUS_LABELS`
  tampoco tiene `PAUSED` ni `ARCHIVED`, así que en el filtro «Todos» esas filas pintan el
  **enum crudo** (`ARCHIVED`) como etiqueta. Los archivados son, en la práctica, invisibles
  y sin nombre en el backoffice.
- Los usuarios se ordenan por `createdAt desc` **fijo en el servicio**, sin parámetro.

**Comparación con `/busqueda`** (el techo de lo que el proyecto ya sabe hacer):
`SearchQueryDto` acepta `q`, `category`, `type`, `condition`, `priceType`, `priceUnit`,
`minPrice`, `maxPrice`, `province`, `city`, `tags[]`, `sort` (4 valores),
`lat`/`lng`/`radius`, paginación. **El backoffice tiene 3 filtros donde la búsqueda pública
tiene 14.** Pero atención: eso corre sobre Meilisearch, que **solo indexa ACTIVE** — un
filtrado rico del backoffice no puede apoyarse en el índice y tiene que ir a Postgres.

### 2.5 P1 — Estado interno de moderación: **NO EXISTE**

Campos de estado/moderación que hoy tiene `Listing`:

| Campo | Qué es | ¿Es lo que P1 pide? |
|---|---|---|
| `status: ListingStatus` | Ciclo de vida (9 valores), con máquina de estados explícita en [`listing-status.transitions.ts`](../apps/api/src/modules/listings/listing-status.transitions.ts) | No — P1 dice explícitamente que **complementa**, no sustituye |
| `needsRevalidation: Boolean` | Marca de la puerta de validación: «dejó de cumplir su categoría» | **No — es lo contrario.** Su comentario dice «Es información para el vendedor»; es de cara al vendedor, no interno de staff |
| `publishedAt` / `updatedAt` / `bumpedAt` | Marcas de tiempo | No |
| `videoUploadedAt` | «Informativo y útil para moderación», dice el comentario | Anecdótico |

**No hay ningún campo staff-only en `Listing`.** No hay enum de etiqueta interna, no hay
tabla de historial de moderación por anuncio.

**Cómo se relaciona P1 con la moderación previa que se acaba de construir (M1-M5):**

Son **ortogonales**, y hay un hueco que P1 encaja de forma casi exacta.
`PreModerationService.reviewTriggerFor()` devuelve `'USER' | 'CATEGORY' | 'PLATFORM' | null`
— el POR QUÉ un anuncio entró en revisión. Su propio comentario dice: *«En M1 el motivo aún
no se persiste —eso es M2»*. Verificado: **sigue sin persistirse**. `listings.service.ts:552`
lo consume como un booleano (`if (... && await this.preModeration.reviewTriggerFor(existing))`)
y descarta el valor. La cola de M3 lista `PENDING_REVIEW` y no sabe por qué está cada fila.

Así que:
- **No se solapan:** `status = PENDING_REVIEW` responde «¿está publicado?»; una etiqueta
  interna (`nuevo`/`revisado`/`en observación`/`editado`) responde «¿qué sabemos de este
  anuncio?». Un ACTIVE puede estar «en observación»; un PENDING_REVIEW puede ser «nuevo» o
  «editado» y son casos de trabajo distintos.
- **El precedente de campo ortogonal ya existe** y está bien documentado: la cabecera de
  `needsRevalidation` argumenta exactamente esto («no es un estado del ciclo de vida —ése es
  `status`, y son ejes ortogonales»). P1 debe seguir ese molde y **no** el de `status`.
- **La automatización «el dueño edita → editado» no tiene hoy dónde engancharse con traza.**
  `update()` no escribe `status`, no llama a `AuditLogService`, y el único rastro de una
  edición del dueño es `updatedAt`. `AuditLog` **solo** se escribe desde acciones de staff.
- **`ReviewTrigger` es el primer valor que la etiqueta interna debería absorber** — está
  calculado, es útil, y hoy se tira.

Para la traza («quién cambió»), el molde existe y es bueno: `AuditLogService.log({ action,
actorId, resourceType, resourceId, before, after, ip })`, con `@@index([resourceType,
resourceId])` y capaz de correr dentro de una `tx` (ver `grantCredits`). Lo que no existe es
ninguna vista que lea `AuditLog` de un `Listing`.

---

## Bloque 3 — Administración de usuarios (P2, P6)

### 3.1 `/admin/usuarios` hoy

[702 líneas](../apps/web/src/app/(admin)/admin/usuarios/page.tsx). Tabla de 20 con
**buscador** (nombre/email), chips de estado (Todos/Activos/Suspendidos/Baneados) y chips de
rol (Todos/Usuario/Moderador/Editor/Admin).

Columnas: Usuario (nombre+email), Rol (selector inline si es ADMIN quien mira y el target no
es ADMIN), Estado, Confianza, Revisión (M4), Anuncios (`_count`), Registro, Acciones.

**Hay ficha, pero es una fila expandible, no una página.** `UserDetailPanel` se despliega
bajo la fila (`<td colSpan={7}>`) y llama a `GET /admin/users/:id`.

### 3.2 Qué acciones existen sobre un usuario

| Acción | Endpoint | Rol | Registro |
|---|---|---|---|
| Suspender | `PATCH /admin/users/:id/suspend` | M A | `USER_SUSPEND` |
| Reactivar (de suspensión) | `.../unsuspend` | M A | sí |
| Banear (permanente) | `.../ban` | **A** | `USER_BAN` |
| Desbanear | `.../reinstate` | **A** | sí |
| Cambiar rol | `.../role` | **A** | `USER_ROLE_CHANGE` |
| Marcar/quitar «de confianza» | `.../trusted` | **A** | `USER_TRUST`/`USER_UNTRUST` |
| Marcar/quitar «requiere revisión» | `.../requires-review` | **A** | `USER_REQUIRE_REVIEW`/`..._UN...` |
| **Añadir créditos** | `POST /admin/billing/users/:id/credits` | **A** | `ADMIN_CREDIT_GRANT` |

Guardas notables: `changeUserRole` rechaza tocar a un ADMIN **y** rechazar asignar ADMIN
(«INNEGOCIABLE», dice el comentario); el selector de la UI ofrece solo USER/MODERATOR/EDITOR.

**Lo que NO se puede hacer:** editar ningún dato del usuario (nombre, email, teléfono,
ubicación, bio, avatar, slug, datos fiscales), forzar `emailVerified`, resetear
`failedLoginAttempts`/`lockedUntil`, invalidar sesiones (`tokenVersion`), eliminar la
cuenta, **quitar** créditos, y **tocar bumps o Pro de ninguna forma**.

### 3.3 P2 — Pro, créditos y bumps: cómo funcionan HOY

**Pro** no es un campo. Es un **`Entitlement` de tipo `PRO_SUBSCRIPTION` vigente**:

```ts
// listing-gate/pro-status.service.ts — el ÚNICO lector, por diseño
async isProActive(userId) {
  return (await this.prisma.entitlement.findFirst({
    where: { userId, type: PRO_SUBSCRIPTION, revokedAt: null,
             OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
  })) !== null;
}
```

Se crea desde `BillingProcessor.ensureProEntitlement()` a partir de una `Subscription` de
Stripe. No hay endpoint de administración que lo cree ni lo revoque. El comentario del
modelo `Entitlement` ya anticipa el caso: *«revokedAt se setea en dos casos: … 2. Un
administrador revoca manualmente un entitlement aún no caducado (futuro)»*. **Futuro = hoy
no existe.** Y `expiresAt` ya es nullable con la nota «reservado para créditos manuales de
soporte» — el modelo está preparado para el Pro manual con vencimiento que P2 pide, pero
ver el riesgo grave de §5.4.

**Créditos:** `Wallet.balance: Int` + `CreditLedger` inmutable. Dar créditos a mano
**EXISTE**: `grantCredits()` hace upsert del wallet, escribe una fila
`CreditLedgerType.ADMIN_CREDIT` y el `AuditLog`, todo en una `$transaction`. Es el molde
exacto a copiar. **Quitar créditos no existe**, aunque el enum ya tiene
`CreditLedgerType.ADMIN_DEBIT` **sin ningún escritor en el código**.

**Bumps:** `Wallet.bumpBalance: Int` + `BumpLedger`, moneda separada e intransferible. El
comentario del schema dice: *«Solo se acredita por cupón o a mano (soporte)»*.
Verificado: escritores reales de `bumpBalance` = `coupons.service.ts` (canje),
`redsys.processor.ts` (compra de BumpPack), `billing.service.ts` (consumo).
**«A mano» no existe.** `BumpLedgerType.ADMIN_CREDIT` y `ADMIN_DEBIT` están en el enum
**sin escritor**.

**Dónde vive la UI de créditos hoy:** en `/admin/facturacion/usuarios/[id]`, **no** en
`/admin/usuarios`. Son dos fichas de usuario distintas, en dos secciones con roles
distintos (facturación es ADMIN-only), y ninguna enlaza a la otra. `getUserBillingDetail`
devuelve wallet + 20 movimientos + entitlements vigentes + 10 transacciones.

### 3.4 P2 — Qué información del usuario se ve

`GET /admin/users/:id` devuelve: datos de perfil (nombre, email, slug, rol, status,
emailVerified, phone, avatarUrl, bio, city, province, postalCode, createdAt, updatedAt,
trusted, requiresReview) + **10 últimos anuncios** + **10 reportes recibidos** + **20
`AuditLog` donde el usuario es el SUJETO** (`resourceType: 'User'`).

**No trae:** valoraciones (ni emitidas ni recibidas, ni la media), tickets, conversaciones,
favoritos, wallet/créditos/bumps, entitlements, transacciones, facturas, alertas,
`BumpSchedule`, datos fiscales, `failedLoginAttempts`/`lockedUntil`/`tokenVersion`,
`stripeCustomerId`, ni las acciones que el usuario ha REALIZADO como actor
(`auditLogsActed`). El panel de la UI pinta solo 3 de los 4 bloques que llegan (anuncios,
reportes, y los 5 primeros audit logs).

`User` tiene **35 relaciones** en el schema. La ficha usa 3.

### 3.5 P6 — Filtrar y ordenar usuarios

`ListAdminUsersDto`: `status`, `role`, `q` (nombre o email, insensitive), `page`, `perPage`.
**Sin `sort`** — `orderBy: { createdAt: 'desc' }` está fijo en el servicio.

No se puede filtrar por: `trusted`, `requiresReview`, `emailVerified`, Pro,
ciudad/provincia, fecha de registro, número de anuncios, saldo, ni presencia de reportes.
Ni ordenar por nada.

---

## Bloque 4 — Borrado (P5, transversal)

### 4.1 Qué pasa HOY al eliminar un anuncio

```ts
// listings.service.ts:988
async remove(id: string, userId: string): Promise<void> {
  const existing = await this.assertOwnership(id, userId);
  await this.prisma.listing.delete({ where: { id } });
  await this.redis.client.del(cacheKey(existing.slug));
  await this.indexingQueue.add('remove', { listingId: id });
}
```

**Quién puede llamarlo:** `DELETE /listings/:id` con `@UseGuards(JwtAuthGuard)` y
`assertOwnership` → **solo el dueño**. Sin `RolesGuard`, sin excepción de staff.
**No existe ningún endpoint de borrado de anuncios para el staff.**

**Desde qué estados:** cualquiera. `remove()` no comprueba `status` — un ACTIVE con
conversaciones abiertas se borra igual que un DRAFT.

**En la UI:** el botón «Eliminar» se añade **sin condición** al menú del dueño
([use-listing-actions.tsx:272](../apps/web/src/components/anuncios/owner/use-listing-actions.tsx#L272)),
con `AlertDialog` de confirmación. Está disponible en todos los estados, incluido ARCHIVED.

Es **exactamente lo contrario de lo que Ernest quiere**: hoy el usuario elimina y el staff
no puede.

### 4.2 ¿Se limpia lo relacionado? Inventario completo

Todo se apoya en las acciones referenciales de Prisma. Lo que cuelga de un `Listing`:

| Qué | `onDelete` | Resultado del borrado |
|---|---|---|
| `ListingImage` | **Cascade** | filas borradas · **objetos en R2 NO** ⚠️ |
| `ListingTag` | Cascade | borrado, correcto |
| `Favorite` | Cascade | borrado (desaparece de los favoritos de otros, sin aviso) |
| `Conversation` (→ `Message`, `Deal`) | Cascade | **borrado — se destruye la conversación del comprador** |
| `AlertMatch` | Cascade | borrado, correcto |
| `ListingViewDaily` | Cascade | borrado (estadísticas históricas perdidas) |
| **`Report`** | **Cascade** | **borrado — se destruye el historial de denuncias** ⚠️ |
| `BumpSchedule` (→ `BumpRun`) | Cascade | borrado, correcto |
| `Deal` | SetNull | sobrevive sin anuncio |
| `Review` | SetNull | sobrevive (deliberado: «la reputación no es borrable por el vendedor»; `listingTitle` conserva el contexto) |
| `Entitlement` | SetNull | sobrevive huérfano — un destacado pagado apuntando a nada |
| `Transaction` | SetNull | sobrevive (correcto: registro contable) |
| `Ticket` | SetNull | sobrevive sin anuncio |
| Meilisearch | — | `indexingQueue.add('remove')` ✔ |
| Redis (`listing:{slug}`) | — | `del()` ✔ |
| `Notification` | — | snapshot autocontenido por diseño; el enlace apunta a un anuncio muerto |

**Los dos problemas graves, verificados:**

**(a) Los ficheros del bucket nunca se borran.** `MediaService` tiene exactamente dos
métodos: `upload()` y `uploadAvatar()`. **No hay ningún `delete`.** `R2Service` sí tiene un
borrado (`DeleteObjectCommand`, [r2.service.ts:54](../apps/api/src/infra/r2/r2.service.ts#L54)),
y el único que lo usa es `VideoService.deleteObjectByUrl()` — para sustituir o quitar un
vídeo, nunca al borrar un anuncio. Así que borrar un anuncio deja en R2 **todas sus fotos y
su vídeo (hasta 50 MB)**, para siempre. Esto ya está registrado como deuda en
[`docs/pendientes.md` §«`DELETE /media/:id` + recolección de huérfanas»](./pendientes.md),
que además nota la misma deuda en `TicketAttachment` y advierte: *«hoy no puede
materializarse porque no existe ningún endpoint que borre tickets, mensajes ni usuarios. Si
se añade cualquiera de los tres, hay que borrar también del bucket»*. **P5 es precisamente
el cuerpo que añade un borrado — así que activa esa deuda.**

**(b) `Report` está en Cascade y `Review` en SetNull.** La asimetría es deliberada para
`Review` (con comentario explícito) y **parece un descuido para `Report`**: hoy un vendedor
puede eliminar un anuncio denunciado y **el reporte desaparece con él**, resuelto o no. Es
un borrado de historial de moderación a instancia del denunciado.

### 4.3 Archivar

`ARCHIVED` existe y es **terminal, verificado en dos capas**: el schema lo declara
(«permanente, IRREVERSIBLE») y `LISTING_STATUS_TRANSITIONS.ARCHIVED = []` lo hace cumplir
(`isLegalTransition` solo admite el no-op `from === to`).

- **El usuario SÍ puede archivar:** `POST /listings/:id/archive`, `assertOwnership`, desde
  `ACTIVE | PAUSED | SOLD | EXPIRED | REJECTED` (`ARCHIVABLE_STATUSES`). Excluye
  DRAFT/PENDING_REVIEW («nada publicado aún») y RESERVED («archivar dejaría un trato
  colgado»). En la UI, con `AlertDialog` que explica bien la diferencia con eliminar.
- **Es irreversible:** sí, confirmado.
- **A diferencia de `remove()`, NO destruye** conversaciones, tratos ni valoraciones.
- **El staff puede archivar, pero no desde la UI.** `ACTIVE → ARCHIVED` es una transición
  legal, así que `PATCH /admin/listings/:id/status` la acepta. Pero el `<select>` de
  `/admin/anuncios` solo ofrece 4 destinos y ARCHIVED no está entre ellos. Es alcanzable
  por API, invisible por pantalla.

### 4.4 P5 — Qué existe y qué falta

| Pieza de la política que Ernest quiere | Estado |
|---|---|
| Usuario archiva | **EXISTE** — endpoint, estados, UI, confirmación |
| Archivar es irreversible | **EXISTE** — doble capa (schema + máquina de estados) |
| Usuario **no** elimina | **AL CONTRARIO** — hoy elimina desde cualquier estado, y es el único que puede |
| Staff archiva | **A MEDIAS** — la transición es legal, no hay botón |
| Staff elimina archivados | **NO EXISTE** — no hay endpoint de borrado para staff |
| «Eliminar limpia lo relacionado» | **NO** — BD sí (cascadas), bucket **no**; y `Report` se borra cuando no debería |
| Política aplicada «en TODO el proyecto» | **NO EXISTE** como concepto. El borrado no está centralizado en ningún sitio |

---

## Bloque 5 — Las relaciones (lo más importante)

### 5.1 Roles → todo lo demás

Cada punto de los 6 añade funciones que necesitan su permiso, en las **tres** capas de §1.2.
Si los roles se arreglan **después**, cada cuerpo paga el impuesto de R2 tres veces y la
tabla de §1.3 se desincroniza mientras crece. **Los roles van primero, no por elegancia sino
por coste.**

Dos choques concretos que el arreglo de roles crea con la moderación previa (M4/M5):

- **Abrir `/admin/categorias` a MODERATOR abre `Category.requiresReview`.** M5 puso esa
  casilla en el formulario de categoría; es el nivel CATEGORÍA del disparador de moderación
  previa. Pero M4 decidió, con argumento escrito, que marcar a un **vendedor** para revisión
  es **ADMIN-only** («decidir que alguien pasa por revisión es política de plataforma, no una
  acción de moderación del día a día»). Con categorías abiertas a MODERATOR, ese criterio se
  rompe: un moderador podría poner en revisión **una rama entera del catálogo** pero no a un
  solo vendedor. Hay que decidirlo a la vez, no por separado.
- El interruptor de plataforma (`preModerationAllListings`) vive en `/admin/ajustes`, que
  sigue ADMIN-only en el objetivo. Eso sí queda consistente.

Y un prerrequisito técnico: **R1 (rol congelado en el frontend) hay que cerrarlo antes de
ampliar permisos.** Ampliar el acceso de EDITOR/MODERATOR con sesiones que no reflejan el
rol actual multiplica el número de personas que ven «un backoffice donde todo falla».

### 5.2 La etiqueta interna (P1) → el estado + la moderación previa

- **Con `status`: ortogonal, y el proyecto ya tiene el precedente** (`needsRevalidation`, con
  su comentario justificándolo). El riesgo real no es de diseño, es de **arrastre**: si la
  etiqueta interna entra en la máquina de estados o en las condiciones de indexación
  («solo ACTIVE se indexa»), deja de ser ortogonal. Debe quedar **fuera** de
  `ListingDocument` y fuera de `LISTING_STATUS_TRANSITIONS` — igual que `needsRevalidation`,
  que explícitamente «no entra en `ListingDocument` ni dispara reindexado».
- **Con la moderación previa: encaja en un hueco abierto a propósito.** `ReviewTrigger`
  (`USER`/`CATEGORY`/`PLATFORM`) se calcula y se tira. La cola de M3 no sabe por qué está
  cada fila. P1 es el sitio natural donde ese dato se persiste. Diseñar P1 **sin** absorber
  `ReviewTrigger` sería crear un segundo canal para lo mismo.
- **El automatismo «el dueño edita → editado» toca `ListingsService.update()`**, que hoy es
  un camino que deliberadamente **no** escribe `status` ni registra nada. Añadirle una
  escritura de etiqueta + traza es el primer `AuditLog` escrito por una acción de USUARIO
  (hoy `AuditLog` es 100 % staff: `actorId` es obligatorio y apunta a quien administra).
  Hay que decidir si `AuditLog` es «acciones de staff» o «acciones sobre recursos» — es un
  cambio de significado del modelo, no un campo más.
- **P1 filtrable choca con Meilisearch:** el filtrado del backoffice no puede ir por el
  índice (solo tiene ACTIVE), así que la etiqueta necesita **columna + índice en Postgres**
  y su filtro va en `ListAdminListingsDto`. Ése es también el camino de P6.

### 5.3 Editar propietario (P3) → integridad (el punto más peligroso del conjunto)

Cambiar `Listing.sellerId` toca, verificado en el schema y el código:

| Qué se rompe | Por qué |
|---|---|
| **Cuota de anuncios activos** | `ActiveListingLimitRule` cuenta `status: ACTIVE` por `sellerId`. Mover un ACTIVE mete al nuevo dueño por encima de su cupo **en silencio** — la puerta solo se consulta en las transiciones, no en un cambio de dueño |
| **Cuota total** | `TotalListingLimitRule`, igual |
| **Conversaciones** | `Conversation.sellerId` es una columna propia; quedaría apuntando al **dueño viejo**. Y hay `@@unique([listingId, buyerId])`: si el nuevo dueño ya era comprador de ese anuncio, queda como **vendedor y comprador a la vez** |
| **Tratos** | `Deal.sellerId` — mismo problema |
| **Valoraciones** | `Review` con `@@unique([authorId, targetId, listingId])` — la reputación queda anclada al dueño viejo |
| **Entitlements / destacado** | `Entitlement.userId` ≠ nuevo `sellerId`. Un destacado que el viejo pagó pasa a beneficiar al nuevo, y `getFeaturedQuotaStatus` cuenta por `userId` |
| **`BumpSchedule`** | Tiene `userId` propio (tope por usuario) además de `listingId` |
| **Meilisearch** | El documento lleva `sellerId`, `sellerName`, `sellerSlug`, `sellerAvatarUrl` y el rating agregado del vendedor → **reindexado obligatorio** |
| **Redis** | `listing:{slug}` cachea el bloque del vendedor → invalidación obligatoria |
| **Favoritos** | Sobreviven (apuntan al listing), pero el usuario que lo guardó ve otro vendedor sin aviso |
| **Facturas / transacciones** | `Transaction.userId` es el pagador histórico; **no debe** moverse (registro contable) |

Es la operación con **más superficie de daño de los 6 puntos** y la única sin ningún
precedente en el código. Merece su propio cuerpo, al final, y probablemente restricciones
fuertes (¿solo desde DRAFT?, ¿solo si no hay conversaciones/tratos/entitlements?).

**Cambiar la categoría desde el backoffice es mucho más barato** porque la validación ya
existe en `update()` — pero ojo: hoy la poda de tags al mover de categoría es **silenciosa**
por diseño (para no bloquear al vendedor). Un staff que mueve un anuncio debería ver qué se
podó, no enterarse después.

### 5.4 Pro/créditos/bumps manual (P2) → los sistemas de billing

**El riesgo grave, verificado línea a línea.** Un `Entitlement PRO_SUBSCRIPTION` creado a
mano (sin `Subscription` de Stripe detrás) produce un **usuario Pro a medias**:

- `ProStatusService.isProActive()` solo mira el entitlement → devuelve **`true`**. Las
  cuotas de anuncios (`ActiveListingLimitRule`, `TotalListingLimitRule`) tratarán al usuario
  como Pro. ✔ lo esperado.
- `EntitlementService.getFeaturedQuotaStatus()` deriva el periodo de
  `entitlement.subscription.currentPeriodStart`, y si no hay suscripción **devuelve
  `{ isPro: false, limit: 0, used: 0, remaining: 0 }`**. Su comentario dice literalmente
  *«should not happen — ensureProEntitlement always links a Subscription»*. Con Pro manual,
  **sí pasa**.
- `hasAvailableFeaturedQuota()` y `hasAvailableBumpQuota()` hacen
  `if (!proEntitlement?.subscriptionId) return false` y además necesitan la fila de
  `Subscription` para el `SELECT … FOR UPDATE` que serializa la cuota. Con Pro manual:
  **cero cuota de destacados y cero cuota de bumps**, para siempre.

Resultado: el usuario tendría los límites de anuncios de un Pro, y su panel le diría «no
eres Pro» en las cuotas. **Diseñar P2 sin resolver esto entrega un Pro roto.** Hay tres
caminos posibles (entitlement sin suscripción + derivar el periodo de otra forma; una
`Subscription` sintética; un tipo de entitlement distinto) y elegir es trabajo de diseño de
ese cuerpo — pero el hecho es que el hueco está y hay que verlo antes.

Lo demás de P2 es de bajo riesgo:
- **Créditos:** el molde `grantCredits()` es correcto (`$transaction` con wallet + ledger +
  auditoría). Quitar créditos es el espejo, con `ADMIN_DEBIT` (ya en el enum) y una decisión
  nueva: **¿se permite saldo negativo?** El invariante declarado es
  `wallet.balance == SUM(CreditLedger.amount)`; un débito mayor que el saldo lo respeta pero
  deja el saldo en negativo.
- **Bumps:** copia literal del anterior sobre `bumpBalance`/`BumpLedger`. **Cuidado con
  `PRO_QUOTA`**, que es una fila `amount = 0` a propósito (marcador contable): un débito
  manual debe usar `ADMIN_DEBIT`, nunca tocar esas filas, o rompe el invariante
  `bumpBalance == SUM(BumpLedger.amount)`.
- **Unificar la ficha de usuario** (§3.3) significa traer datos de facturación
  (ADMIN-only) a `/admin/usuarios` (MODERATOR+). **La ficha de P2 necesita permisos por
  bloque, no por página** — otra dependencia directa del cuerpo de roles.

### 5.5 El borrado (P5) → varios módulos

- **Activa la deuda de huérfanas de R2** que `pendientes.md` ya avisa que se activaría. P5 y
  esa deuda son el mismo trabajo; la doc sugiere resolver las tres fuentes (imágenes de
  anuncio, adjuntos de ticket, vídeo) «con el mismo mecanismo».
- **Toca la asimetría `Report`/`Review`**: si el borrado pasa a ser staff-only y sobre
  archivados, `Report: Cascade` es menos peligroso (ya no lo dispara el denunciado), pero
  sigue destruyendo historial de moderación. Es una decisión de migración de schema, con
  su coste.
- **Quitar «Eliminar» al usuario cambia una UI publicada.** Hoy el botón existe en el menú
  del dueño con su `AlertDialog`. Retirarlo es un cambio de producto visible, y hay que
  decidir qué pasa con los anuncios ya archivados (¿los ve el usuario? ¿puede pedir el
  borrado?).
- **La cuota se relaja al archivar** (ARCHIVED no cuenta como activo, ya está documentado).
  El borrado no cambia nada ahí.
- **Es el cuerpo transversal**: toca `listings`, `media`, `moderation`, `search`, el schema y
  dos UIs (la del dueño y la del staff). Cuanto más tarde llegue, más cosas nuevas habrá que
  retro-encajar en la política.

### 5.6 Matriz de riesgos de relación

| # | Riesgo | Dónde nace | Qué rompe | Gravedad |
|---|---|---|---|---|
| 1 | Pro manual sin `Subscription` → cuotas a 0 | P2 | `getFeaturedQuotaStatus`, `hasAvailable*Quota` | **Alta** |
| 2 | Cambio de propietario sin recalcular cuota | P3 | `ActiveListingLimitRule`, `TotalListingLimitRule` | **Alta** |
| 3 | Cambio de propietario deja `Conversation.sellerId`/`Deal.sellerId` viejos; posible dueño=comprador | P3 | mensajería, tratos, `@@unique([listingId, buyerId])` | **Alta** |
| 4 | Borrado deja fotos y vídeo en R2 | P5 | coste y privacidad; deuda ya declarada | **Alta** |
| 5 | Borrado destruye `Report` (Cascade) | P5 (ya hoy) | historial de moderación | **Alta** |
| 6 | Rol del frontend congelado en el login | Roles (ya hoy) | acceso incoherente en ambos sentidos | **Alta** |
| 7 | `Category.requiresReview` abierto a MODERATOR contradice la decisión ADMIN-only de M4 | Roles × M4/M5 | coherencia de la política de moderación | Media |
| 8 | La etiqueta interna se cuela en `status`/índice y deja de ser ortogonal | P1 | máquina de estados, Meilisearch | Media |
| 9 | `AuditLog` escrito por acciones de usuario cambia el significado del modelo | P1 | semántica de `actorId`/auditoría | Media |
| 10 | Débito manual de créditos/bumps rompe el invariante saldo=SUM(ledger) o deja negativos | P2 | contabilidad del wallet | Media |
| 11 | Ficha unificada mezcla datos ADMIN-only en una página MODERATOR | P2 × Roles | fuga de datos de facturación | Media |
| 12 | Filtrado rico del backoffice no puede ir por Meilisearch (solo ACTIVE) | P6 | rendimiento sobre Postgres | Media |
| 13 | Los 3 e2e que pinzan el nº de ítems del nav (21/7/2) romperán | Roles | CI | Baja (deliberado) |
| 14 | `startsWith` en `ROLE_ALLOWED_PATHS` abre secciones futuras homónimas | Roles | acceso | Baja |
| 15 | Poda silenciosa de tags al mover de categoría desde el backoffice | P3 | dato perdido sin aviso | Baja |

---

## Síntesis — para planificar

### 6.1 Clasificación

| Punto | Veredicto | Qué hay | Qué falta |
|---|---|---|---|
| **Roles** | **A MEDIAS** | 4 roles en el enum, `RolesGuard` + `@Roles` sólido, 15 controladores protegidos, e2e de separación de roles | Fuente única (3 listas a mano), rol fresco en el frontend, 5 secciones para EDITOR + 12 para MODERATOR, nav de `motivos-contacto`, decidir la frontera dentro de cada sección |
| **P1 · Etiqueta interna** | **NO EXISTE** | El molde de campo ortogonal (`needsRevalidation`) y el de traza (`AuditLog`) | Enum, columna+índice, automatismos (nace «nuevo», edición→«editado»), traza por anuncio, filtro, UI, y absorber `ReviewTrigger` |
| **P2 · Ficha de usuario** | **A MEDIAS** | `GET /admin/users/:id` (3 de 35 relaciones), 8 acciones, **dar créditos completo con su molde**, `Entitlement.expiresAt` ya nullable | Ficha real (página, no fila), ~10 bloques de info, quitar créditos, dar/quitar bumps, **Pro manual (con el hueco de §5.4)**, editar datos del usuario, unificar con `/admin/facturacion/usuarios/[id]` |
| **P3 · Editar anuncio** | **NO EXISTE en admin** · **REUSABLE al 80 %** | `ListingsService.update()` con toda la validación de categoría/atributos/tags/precio; `EditarForm` | Camino staff (`assertOwnership` no admite excepción), endpoint de administración, **cambio de propietario (100 % nuevo, el más arriesgado)** |
| **P4 · Ver todo de un anuncio** | **A MEDIAS — media pieza muerta** | `GET /admin/listings/:id` construido, protegido y **sin consumidor** | Cliente + página de ficha; añadir reviews, tickets, favoritos, entitlements, bumps, vistas, `AuditLog` del anuncio |
| **P5 · Política de borrado** | **A MEDIAS, y del revés** | Archivar completo e irreversible (usuario); cascadas de BD; `R2Service.delete` existe | Quitar «Eliminar» al usuario, borrado staff-only de archivados, **limpieza de R2**, revisar `Report: Cascade`, botón de archivar para staff, y la política como concepto único |
| **P6 · Filtrar y ordenar** | **A MEDIAS** | 3 filtros en el backend de anuncios (1 expuesto), 3 en usuarios, `order` de M3, y `/busqueda` con 14 filtros como referencia | Exponer lo que ya hay, orden en ambas listas, ~10 filtros nuevos por lista, `PAUSED`/`ARCHIVED` en chips y etiquetas, y filtro por la etiqueta de P1 |

### 6.2 Orden propuesto de los cuerpos

**1 · ROLES** — el cimiento, y por coste, no por estética.
Cada punto siguiente añade permisos en 3 capas; con la fuente única hecha, cada cuerpo paga
una línea en vez de tres. Y **R1 (rol congelado)** es un prerrequisito: ampliar el acceso de
EDITOR/MODERATOR sobre sesiones desincronizadas multiplica los «todo me falla». Incluye
decidir el choque de §5.1 (categorías para MODERATOR vs. la política ADMIN-only de M4).

**2 · BORRADO (P5)** — el transversal, y cuanto antes, menos que retro-encajar.
Toca `listings`, `media`, `moderation`, `search`, el schema y dos UIs. Todo lo que se
construya después (fichas, edición, etiquetas) hereda la política; si llega al final, hay que
volver sobre cada cuerpo. Trae de regalo la deuda de huérfanas de R2, que ya está declarada
y que este cuerpo activa por definición.

**3 · P4 (ver todo) + P6 en anuncios** — el más barato con más rendimiento.
`GET /admin/listings/:id` ya existe: conectarlo es la ficha. Y la ficha es donde después
viven la etiqueta de P1 y el formulario de P3, así que construirla antes evita hacerla dos
veces. P6 en anuncios va aquí porque es la misma pantalla y el mismo DTO.

**4 · P1 (etiqueta interna)** — necesita la ficha (donde se ve y se cambia) y la lista
(donde se filtra), es decir el cuerpo 3. Cierra a la vez el hueco de `ReviewTrigger` que
M1-M5 dejó abierto a propósito.

**5 · P2 (ficha de usuario) + P6 en usuarios** — dos cuerpos si el Pro manual se complica.
Sugerencia: **P2a** (ficha + info + créditos/bumps, copiando el molde de `grantCredits`) y
**P2b** (Pro manual), porque P2b necesita antes resolver el hueco de §5.4 y eso es diseño de
billing, no de backoffice. P6 en usuarios va con P2a, misma pantalla.

**6 · P3 (editar cualquier anuncio)** — el último, y partido.
**P3a** (editar campos + categoría) es barato: reutiliza `update()` sobre la ficha del
cuerpo 3. **P3b** (cambiar propietario) es el riesgo 2/3 de la matriz y merece su propio
diseño, con la decisión explícita de qué estados y qué relaciones lo permiten.

Dos dependencias duras que fijan el orden: **3 antes de 1(P1) y de 6(P3a)** (los dos viven en
la ficha), y **roles antes de P2** (la ficha unificada mezcla bloques ADMIN-only con una
pantalla MODERATOR+).

### 6.3 Qué es Playwright y qué es backend

**Playwright (mucho — el backoffice es todo client-side y sin SEO):**
- Roles: la matriz sección × rol. Los 3 tests que pinzan el número de ítems del nav
  (21 ADMIN / 7 MODERATOR / 2 EDITOR) **romperán a propósito** y hay que reescribirlos; el
  fixture ya tiene `adminContext`/`moderatorContext`/`editorContext` y el seed ya crea los
  tres usuarios. Añadir: el caso de R1 (rol cambiado → efecto sin re-login).
- La ficha de anuncio (P4): que cada bloque se pinte, y que un MODERATOR vea lo suyo.
- Filtros y orden (P6): en anuncios y usuarios, incluidos `PAUSED`/`ARCHIVED`.
- Borrado (P5): que el dueño **ya no** vea «Eliminar»; que el staff **sí** y solo sobre
  archivados; los dos `AlertDialog`.
- P2: ficha, dar/quitar créditos y bumps, Pro manual con vencimiento, permisos por bloque.
- P3: formulario de edición desde el backoffice, cambio de categoría, y el cambio de
  propietario con sus rechazos.
- P1: la etiqueta en la ficha y en la lista, y **el automatismo edición→«editado»**, que
  cruza dos áreas (el dueño edita en `(account)`, el staff lo ve en `(admin)`) — caso de
  e2e, no de unit.

**Backend (unit/e2e de Nest):**
- La fuente única de roles: tabla pura testeable como `listing-status.transitions.ts`.
- Transiciones y guardas del borrado staff-only, y la limpieza de R2 (mockeando `R2Service`).
- El invariante `balance == SUM(ledger)` en los débitos manuales, y el de `bumpBalance`.
- `isProActive` vs. `getFeaturedQuotaStatus` con un Pro manual — **el test que hoy no existe
  y que expone el riesgo 1**.
- Las guardas del cambio de propietario (cuota del nuevo dueño, conversaciones, dueño≠comprador).
- La automatización de la etiqueta interna y su traza.
- `ListAdminListingsDto`/`ListAdminUsersDto` ampliados: cada filtro y cada orden.

---

## Apéndice — ficheros clave

| Área | Fichero |
|---|---|
| Roles (frontend, ruta) | [`apps/web/src/middleware.ts`](../apps/web/src/middleware.ts) |
| Roles (frontend, nav) | [`apps/web/src/app/(admin)/components/AdminNav.tsx`](../apps/web/src/app/(admin)/components/AdminNav.tsx) |
| Roles (frontend, sesión) | [`apps/web/src/lib/auth/auth.config.ts`](../apps/web/src/lib/auth/auth.config.ts) |
| Roles (backend) | [`common/guards/roles.guard.ts`](../apps/api/src/common/guards/roles.guard.ts) · [`common/decorators/roles.decorator.ts`](../apps/api/src/common/decorators/roles.decorator.ts) · [`modules/auth/strategies/jwt.strategy.ts`](../apps/api/src/modules/auth/strategies/jwt.strategy.ts) |
| Admin anuncios/usuarios/categorías/ajustes | [`modules/admin/admin.controller.ts`](../apps/api/src/modules/admin/admin.controller.ts) · [`admin.service.ts`](../apps/api/src/modules/admin/admin.service.ts) |
| Admin billing (créditos) | [`modules/admin/admin-billing.service.ts`](../apps/api/src/modules/admin/admin-billing.service.ts) |
| Ciclo de vida y borrado | [`modules/listings/listings.service.ts`](../apps/api/src/modules/listings/listings.service.ts) · [`listing-status.transitions.ts`](../apps/api/src/modules/listings/listing-status.transitions.ts) |
| Moderación previa | [`modules/moderation/pre-moderation.service.ts`](../apps/api/src/modules/moderation/pre-moderation.service.ts) |
| Pro | [`modules/listing-gate/pro-status.service.ts`](../apps/api/src/modules/listing-gate/pro-status.service.ts) · [`modules/billing/entitlement.service.ts`](../apps/api/src/modules/billing/entitlement.service.ts) |
| Almacenamiento | [`infra/r2/r2.service.ts`](../apps/api/src/infra/r2/r2.service.ts) · [`modules/media/media.service.ts`](../apps/api/src/modules/media/media.service.ts) |
| Modelo | [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma) |
| Deuda relacionada | [`docs/pendientes.md`](./pendientes.md) §huérfanas de R2 |
| Contexto de moderación | [`docs/auditoria-y-diseno-moderacion.md`](./auditoria-y-diseno-moderacion.md) · [`docs/estado-tecnico.md`](./estado-tecnico.md) §M1-M5 |
