# Diseño del backoffice y la moderación — Hito 2, Fase 7

> ## ✅ ESTADO: IMPLEMENTADO — y ampliado muy por encima de este diseño
>
> **Documento de diseño de R7.1 (2026-06-24), implementado en R7.2–R7.8** y después
> **ampliado en el Hito 5.1** (separación real de roles ADMIN/MODERATOR) y en la ráfaga
> BLOG-EDITOR (rol `EDITOR`). Cabecera y secciones de cierre revisadas en la auditoría de
> documentación del **2026-08-04**.
>
> **Donde el diseño y la implementación difieran, gana la implementación.** Las desviaciones
> están marcadas en su sitio, no borradas.
>
> ### ⚠️ Lo que más ha cambiado: los ROLES
>
> Este documento se escribió cuando **había un solo rol operativo**. Su §9 cerraba la
> decisión *«rol único ADMIN por ahora; `MODERATOR` disponible en el enum»*. **Esa decisión
> está DEROGADA**: el Hito 5.1 separó los permisos de verdad y BLOG-EDITOR añadió un cuarto
> rol. Todo lo que este documento dice sobre roles hay que leerlo contra la matriz de §0.1.
>
> | | Este diseño (2026-06-24) | Hoy (2026-08-04) |
> |---|---|---|
> | Roles en el enum | `USER \| MODERATOR \| ADMIN` | `USER \| MODERATOR \| ADMIN \| EDITOR` |
> | Roles operativos | **Uno** (ADMIN); MODERATOR declarado pero sin frontera real | **Tres** en `/admin`, con matriz explícita rol×sección |
> | Secciones del backoffice | 6 previstas | **18** en el nav (19 rutas) |
>
> ### Otras desviaciones de fondo
>
> - **`GET /admin/audit-logs` nunca se construyó.** §5 lo listaba. Los registros de auditoría
>   se consultan **embebidos** en `GET /admin/users/:id`, no por un endpoint navegable propio.
>   Ver §5.
> - **`PATCH /admin/users/:id/role` acepta tres destinos, no dos:** `USER | MODERATOR |
>   EDITOR`. ADMIN sigue excluido, que era el punto. Ver §9.
> - **El alcance creció mucho** más allá de moderación + admin: facturación, facturas
>   fiscales, tickets, blog, páginas, footer, tags, campañas, cupones, banners, patrocinados
>   y mensajes de contacto. Ver §6.
>
> **Para la crónica** —cómo se ejecutó la separación de roles, con sus hallazgos— la
> referencia es `estado-tecnico.md`, secciones «Separación de roles ADMIN/MODERATOR
> (RR5.1 + RR5.1-ext)» y «Rol EDITOR — blog (BLOG-EDITOR)». Aquí está el diseño y en qué
> quedó, no el registro de ejecución.

---

## 0. Andamiaje existente (auditoría R7.1) — ESTADO PREVIO, no el actual

> ## 📌 Esta sección es la foto del 2026-06-24, antes de construir nada
>
> **Se conserva a propósito**: es el punto de partida que explica por qué el diseño es como
> es. Pero **ya no describe el estado del código.** Donde dice «Stub», «Vacío» o «6 páginas
> stub vacías», hoy hay implementación completa:
>
> | Lo que decía entonces | Hoy |
> |---|---|
> | `AdminService` — «Vacío» | ~30 métodos: stats, listings, users, categories, settings |
> | `ModerationService` — «Vacío» | Reportes, acciones sobre anuncios y retirada de reseñas |
> | `Role` enum — `USER \| MODERATOR \| ADMIN` | **`USER \| MODERATOR \| ADMIN \| EDITOR`** |
> | «6 páginas stub vacías» | **18 secciones** en el nav (19 rutas), todas funcionales |
> | «Cualquier endpoint funcional en admin o moderation» — no existe | 9 controladores de backoffice |
> | `BadWordService` — no existe | Implementado, con *fallback* silencioso |
> | Modelos `AuditLog` y `Setting` — no existen | Ambos, **tal cual se diseñaron** en §2 |

Lo que ya estaba en `main` el 2026-06-24 y sobre lo que se construyó:

**Backend (`apps/api`)**

| Elemento | Ubicación | Estado |
|---|---|---|
| `AdminController` | `modules/admin/admin.controller.ts` | Stub — guards correctos (`JwtAuthGuard + RolesGuard + @Roles(ADMIN)`) |
| `AdminService` | `modules/admin/admin.service.ts` | Vacío |
| `ModerationController` | `modules/moderation/moderation.controller.ts` | Stub — `@Roles(MODERATOR, ADMIN)` |
| `ModerationService` | `modules/moderation/moderation.service.ts` | Vacío |
| `RolesGuard` | `common/guards/roles.guard.ts` | Operativo — lee `ROLES_KEY` del reflector |
| `Role` enum | `prisma/schema.prisma` | `USER \| MODERATOR \| ADMIN` — **hoy son cuatro: `EDITOR` se añadió en BLOG-EDITOR (§0.1)** |
| `UserStatus` enum | schema | `ACTIVE \| SUSPENDED \| BANNED` |
| `ListingStatus` enum | schema | Incluye `PENDING_REVIEW` y `REJECTED` (estados de moderación ya modelados) |
| Modelo `Report` | schema | Completo: `reason`, `status`, `resolvedById`, `resolvedAt` |
| `ReportReason` enum | schema | `SPAM \| FRAUD \| INAPPROPRIATE \| PROHIBITED_ITEM \| WRONG_CATEGORY \| OTHER` |
| `ReportStatus` enum | schema | `PENDING \| REVIEWING \| RESOLVED \| DISMISSED` |

**Frontend (`apps/web`)**

| Elemento | Ubicación | Estado |
|---|---|---|
| Grupo `(admin)` | `app/(admin)/` | Existe — layout con sidebar, 6 páginas stub vacías |
| `layout.tsx` | `app/(admin)/layout.tsx` | Sidebar con nav estático (sin active state) |
| `middleware.ts` | `src/middleware.ts` | Operativo — redirige a `/login` si no hay sesión; a `/` si rol ≠ ADMIN |
| 6 páginas stub | `admin/{,anuncios,usuarios,reportes,categorias,ajustes}/page.tsx` | Stubs vacíos |

**Lo que NO existe y crearemos:**

- Modelo `AuditLog` (nueva migración)
- Modelo `Setting` (misma migración)
- Cualquier endpoint funcional en admin o moderation
- `BadWordService`
- Cualquier UI real en el backoffice

---

## 0.1 Los roles HOY — la matriz real (Hito 5.1 + BLOG-EDITOR)

> **Añadido en la auditoría del 2026-08-04.** Sustituye a la decisión «rol único ADMIN» de
> §9, y es la referencia para leer el resto del documento. Verificado contra
> `middleware.ts`, `AdminNav.tsx` y los decoradores `@Roles` de cada controlador.

`Role = USER | MODERATOR | ADMIN | EDITOR` (`schema.prisma`). Tres operan en `/admin`.

### Las dos capas, y por qué hacen falta las dos

| Capa | Dónde | Qué protege |
|---|---|---|
| **Middleware** (`ROLE_ALLOWED_PATHS`) | `apps/web/src/middleware.ts` | La **UI**: un rol sin permiso es redirigido a `/` antes de renderizar |
| **`RolesGuard`** (`@Roles(...)`) | Cada controlador de NestJS | Los **datos**: aunque alguien llegue a la ruta, el endpoint responde 403 |
| **`AdminNav`** (`NAV_ITEMS[].roles`) | `apps/web/src/app/(admin)/components/AdminNav.tsx` | La **visibilidad**: qué entradas se pintan |

**Las tres se tocan a la vez o la sección queda rota**: sin el path del middleware es
inaccesible; sin la entrada del nav, invisible; sin el `@Roles` correcto, desprotegida. Está
anotado en el propio código, junto a la entrada de `/admin/tickets`.

### Matriz rol × sección

| Sección | ADMIN | MODERATOR | EDITOR |
|---|:---:|:---:|:---:|
| `/admin` (dashboard) | ✅ | — | — |
| `/admin/anuncios` | ✅ | ✅ | — |
| `/admin/usuarios` | ✅ | ✅ *(sin banear ni cambiar rol)* | — |
| `/admin/reportes` | ✅ | ✅ | — |
| `/admin/tickets` | ✅ | ✅ *(salvo los que llevan factura)* | — |
| `/admin/blog` · `/admin/paginas` | ✅ | ✅ *(sin borrado permanente)* | ✅ *(sin borrado permanente)* |
| `/admin/facturacion` · `/admin/facturas` | ✅ | — | — |
| `/admin/categorias` · `/admin/tags` | ✅ | — | — |
| `/admin/footer` | ✅ | — | — |
| `/admin/campaigns` · `/admin/cupones` · `/admin/banners` · `/admin/sponsored-ads` | ✅ | — | — |
| `/admin/mensajes-contacto` (+ `motivos-contacto`) | ✅ | — | — |
| `/admin/ajustes` | ✅ | — | — |
| **Ítems visibles en el nav** | **18** | **6** | **2** |

Las tres cuentas están fijadas por `admin-roles.spec.ts` (`toHaveCount(18|6|2)`).

> **Ese test es frágil por diseño y hay que saberlo:** afirma el número **exacto** de ítems,
> y llegó a estar desactualizado en 2 sin que nadie lo notara. **Al tocar `NAV_ITEMS`, hay
> que actualizar las tres cuentas.** Se mantiene así a propósito: una aserción exacta detecta
> que alguien ha expuesto una sección de más a un rol, cosa que un `toBeGreaterThan` no haría.

### El criterio, en una frase

**MODERATOR modera contenido reversible; ADMIN toca dinero, configuración y permisos.**
De ahí se deriva todo lo demás: suspender es reversible (MODERATOR), banear no (ADMIN);
despublicar un post es reversible (EDITOR+), borrarlo físicamente no (ADMIN).

### Dos puertas ADMIN-only que el `RolesGuard` NO puede vigilar

Dependen del **contenido de la fila**, no de la ruta, así que viven en el servicio de tickets:

1. **Un ticket con `invoiceId` enlazada es ADMIN-only** (`403 TICKET_BILLING_ADMIN_ONLY`). El
   MODERATOR ni lo ve en la bandeja ni puede operarlo por ningún verbo: poder cerrar a ciegas
   lo que no puedes leer sería una puerta trasera, no una excepción menor.
2. **Reasignar el ticket de OTRO agente es ADMIN-only** (`403 TICKET_REASSIGN_ADMIN_ONLY`).
   Un MODERATOR sí puede coger uno sin asignar o mover el suyo.

Es la lección general: **cuando el permiso depende del dato y no de la ruta, el guard no
llega y la regla baja al servicio.**

---

## 1. Shell del grupo (admin)

### Decisión: client-side puro, sin SSR ni SEO

El backoffice es una herramienta interna. No necesita indexación ni hidratación en servidor.
Todas las `page.tsx` dentro de `(admin)` son `"use client"` y hacen fetch directamente al
backend desde el navegador. Sin `generateMetadata`, sin `revalidate`, sin llamadas en Server
Components.

### Encaje con el middleware

`middleware.ts` ya protege `(admin)` correctamente y no se toca. El flujo es:

```
Petición a /admin/*
  → middleware: ¿sesión? No → /login
  → middleware: ¿role === ADMIN? Sí → pasa (acceso total)
               ¿role en ROLE_ALLOWED_PATHS y la ruta empieza por uno de sus paths?
                 Sí → pasa   ·   No → /
  → layout.tsx (Server Component — solo markup)
    → AdminNav filtra NAV_ITEMS por el rol de la sesión
    → page.tsx ("use client" — fetch al backend con Bearer token)
      → NestJS: JwtAuthGuard valida token, RolesGuard verifica el rol EXIGIDO
        POR ESE ENDPOINT (no siempre ADMIN — ver §0.1)
```

> **Actualizado (2026-08-04).** El diseño original tenía un único portero (`role === ADMIN`).
> Desde el Hito 5.1 el middleware consulta `ROLE_ALLOWED_PATHS`, un mapa rol → prefijos de
> ruta; ADMIN sigue teniendo acceso total y no aparece en el mapa. Y el `RolesGuard` ya no
> comprueba «ADMIN» en todas partes: cada endpoint declara lo que exige. Ver §0.1.

El middleware es la primera línea de defensa en el frontend. El `RolesGuard` de NestJS es
la segunda línea independiente en el backend. Ambas capas son necesarias: el middleware
protege la UI, el guard protege los datos.

### Cambios al layout existente

El `layout.tsx` permanece Server Component (solo renderiza el esqueleto). Se extraen dos
client components:

- **`<AdminNav>`** — envuelve los `<Link>` y usa `usePathname()` para añadir `active`
  state visual al enlace de la sección actual.
- **`<AdminUserBar>`** — usa `useSession()` para mostrar el nombre y avatar del admin
  autenticado, con botón de cerrar sesión. Vive en el header del layout, no en el sidebar.

Ningún cambio al middleware ni a la estructura de rutas.

---

## 2. Modelos nuevos y migración

Una migración: `add_audit_log_and_settings`.

### 2.1 AuditLog

```prisma
model AuditLog {
  id           String   @id @default(cuid())

  /// Nombre de la acción realizada. Convención SCREAMING_SNAKE_CASE:
  /// LISTING_DEACTIVATE, LISTING_RESTORE, LISTING_APPROVE, LISTING_REJECT,
  /// USER_SUSPEND, USER_BAN, USER_REINSTATE, USER_ROLE_CHANGE,
  /// REPORT_RESOLVE, REPORT_DISMISS,
  /// CATEGORY_CREATE, CATEGORY_EDIT, CATEGORY_DELETE, CATEGORY_REORDER,
  /// SETTING_UPDATE
  action       String

  /// Admin o moderador que ejecutó la acción.
  actorId      String
  actor        User     @relation("AuditLogActor", fields: [actorId], references: [id])

  /// Tipo de recurso afectado: "Listing" | "User" | "Report" | "Category" | "Setting"
  resourceType String

  /// ID del recurso afectado.
  resourceId   String

  /// Snapshot JSON del estado ANTES de la mutación. Puede ser null si la acción
  /// no tiene estado previo relevante (ej. primera escritura de un Setting).
  before       Json?

  /// Snapshot JSON del estado DESPUÉS de la mutación.
  after        Json?

  /// IP del actor (extraída del request, opcional — útil para auditoría de seguridad).
  ip           String?

  createdAt    DateTime @default(now())

  @@index([actorId])
  @@index([resourceType, resourceId])
  @@index([createdAt])
}
```

Añadir la relación inversa en `User`:
```prisma
// En el modelo User, añadir:
auditLogsActed  AuditLog[] @relation("AuditLogActor")
```

### Por qué AuditLogService explícito y no un interceptor

**Decisión innegociable**: el AuditLog se captura mediante un `AuditLogService` inyectable,
llamado explícitamente dentro de cada método del service de dominio que muta un recurso
sensible. No mediante un interceptor de NestJS.

**Razón**: un interceptor de NestJS tiene acceso al `ExecutionContext` (la petición HTTP y
la respuesta) pero **no al estado interno de Prisma antes de la mutación**. Para que el
`AuditLog.before` sea útil debe capturarse en el momento exacto en que el service ya sabe
qué va a cambiar, antes de llamar a `prisma.update()`. Un interceptor que lea la respuesta
solo conoce el estado posterior; el estado anterior requeriría una query adicional
desacoplada del contexto de negocio, que sería frágil y difícil de mantener.

Nadie debe "simplificar" esto a un interceptor después: se perdería el campo `before`, que
es el motivo principal de tener un audit log.

**Patrón de uso en el service:**
```typescript
async suspendUser(adminId: string, targetId: string, ip?: string) {
  const user = await this.prisma.user.findUniqueOrThrow({ where: { id: targetId } });
  const before = { status: user.status };

  await this.prisma.user.update({
    where: { id: targetId },
    data: { status: UserStatus.SUSPENDED },
  });

  await this.auditLog.log({
    action: 'USER_SUSPEND',
    actorId: adminId,
    resourceType: 'User',
    resourceId: targetId,
    before,
    after: { status: UserStatus.SUSPENDED },
    ip,
  });
}
```

### 2.2 Setting

```prisma
model Setting {
  /// Clave única del ajuste. Fuente de verdad: ver sección 5.4.
  key          String   @id

  /// Valor serializado como JSON. El tipo concreto depende de la clave:
  /// string[], number, boolean.
  value        Json

  updatedAt    DateTime @updatedAt

  /// ID del admin que actualizó el ajuste (para AuditLog; puede ser null en seed).
  updatedById  String?
}
```

**Keys iniciales** (sembradas en `seed.ts`):

| Key | Tipo JSON | Valor por defecto | Descripción |
|---|---|---|---|
| `badWordList` | `string[]` | `[]` | Palabras prohibidas en título/descripción |
| `listingExpiryDays` | `number` | `60` | Días hasta que un anuncio caduca |
| `contactRequiresVerification` | `boolean` | `true` | Si contactar requiere email verificado |

---

## 3. Flujo de moderación

### 3.1 Reportes — endpoints del módulo `/moderation`

El `ModerationController` está decorado con `@Roles(Role.MODERATOR, Role.ADMIN)` excepto
el endpoint de creación, que es `@Roles(Role.USER, Role.MODERATOR, Role.ADMIN)` (cualquier
usuario autenticado puede reportar).

| Método | Ruta | Roles | Acción |
|---|---|---|---|
| `POST` | `/moderation/reports` | USER+ | Crear un reporte (apunta a `listingId` o `reportedUserId`) |
| `GET` | `/moderation/reports` | MOD/ADMIN | Lista paginada. Filtros: `?status=&reason=&page=&perPage=` |
| `GET` | `/moderation/reports/:id` | MOD/ADMIN | Detalle con relaciones (listing, reporter, reportedUser) |
| `PATCH` | `/moderation/reports/:id/start-review` | MOD/ADMIN | `PENDING → REVIEWING` |
| `PATCH` | `/moderation/reports/:id/resolve` | MOD/ADMIN | `→ RESOLVED`; fija `resolvedById` + `resolvedAt` + AuditLog |
| `PATCH` | `/moderation/reports/:id/dismiss` | MOD/ADMIN | `→ DISMISSED`; fija `resolvedById` + `resolvedAt` + AuditLog |

**DTO de creación de reporte:**
```typescript
class CreateReportDto {
  @IsEnum(ReportReason) reason: ReportReason;
  @IsString() @IsOptional() description?: string;
  @IsString() @IsOptional() listingId?: string;
  @IsString() @IsOptional() reportedUserId?: string;
  // Validación en service: al menos uno de listingId o reportedUserId debe estar presente.
}
```

### 3.2 Acciones de moderación sobre anuncios

Residen en `ModerationController` (no en `AdminController`) porque MODERATOR también puede
ejecutarlas, y el `ModerationController` ya tiene `@Roles(MODERATOR, ADMIN)`.

| Método | Ruta | Acción |
|---|---|---|
| `POST` | `/moderation/listings/:id/approve` | `PENDING_REVIEW → ACTIVE` + encolar `index` en Meilisearch + AuditLog |
| `POST` | `/moderation/listings/:id/reject` | `PENDING_REVIEW → REJECTED` + AuditLog |
| `POST` | `/moderation/listings/:id/deactivate` | `ACTIVE → REJECTED` + encolar `remove` en Meilisearch + invalidar caché Redis + AuditLog |
| `POST` | `/moderation/listings/:id/restore` | `REJECTED → ACTIVE` + encolar `index` en Meilisearch + AuditLog |

**Body de deactivate/reject:** `{ reason: string }` — texto libre que queda en el `AuditLog.after`.

### 3.3 Filtro automático de texto al publicar (BadWordService)

`BadWordService` es un servicio inyectable que se usa en `ListingsService.publish()`.

**Lógica:**
1. Leer `Setting.badWordList` de la BD (o de caché Redis con TTL corto).
2. Si la lista no existe en BD o está vacía: **no filtrar** — el anuncio pasa a `ACTIVE`
   directamente. El servicio nunca lanza excepción por ausencia de configuración.
3. Si la lista existe y no está vacía: normalizar título + descripción (minúsculas, eliminar
   acentos con NFD + regex), comprobar si alguna palabra de la lista aparece como token.
4. Si hay match: cambiar el estado de destino de `ACTIVE` a `PENDING_REVIEW` (en lugar de
   publicar directamente).
5. Si no hay match: publicar normalmente → `ACTIVE`.

**Principio de diseño (idéntico al geocoding):** el filtro de texto es una ayuda
opcional, no un bloqueante. Si el servicio falla (BD no responde, error inesperado), el
`catch` del `try/catch` que envuelve la llamada debe registrar el error con Sentry y dejar
el flujo continuar hacia `ACTIVE`. La moderación no puede tumbar la publicación.

```typescript
// En ListingsService.publish():
let targetStatus = ListingStatus.ACTIVE;
try {
  const hasBadWords = await this.badWordService.check(listing.title, listing.description);
  if (hasBadWords) targetStatus = ListingStatus.PENDING_REVIEW;
} catch (err) {
  Sentry.captureException(err);
  // targetStatus sigue siendo ACTIVE — fallback silencioso
}
```

**Nota sobre `PENDING_REVIEW`**: el estado ya existe en `ListingStatus`. Los anuncios en
`PENDING_REVIEW` no se indexan en Meilisearch (condición ya implícita: solo se indexan los
`ACTIVE`). El moderador los ve en la cola de `GET /moderation/reports` y los gestiona con
`/approve` o `/reject`.

---

## 4. Alcance de gestión — módulo Admin

### 4.1 Anuncios

| Método | Ruta | Acción |
|---|---|---|
| `GET` | `/admin/listings` | Lista todos los estados. Filtros: `?status=&categoryId=&sellerId=&page=&perPage=` |
| `GET` | `/admin/listings/:id` | Detalle completo (seller, category, images, reports, conversations count) |
| `PATCH` | `/admin/listings/:id/status` | Cambio de estado manual. Body: `{ status, reason }`. + AuditLog |

Las acciones de retirar/restaurar/aprobar/rechazar se consumen desde `/moderation/*`
(ya cubiertas en §3.2) y el frontend del backoffice las llama desde `/admin/anuncios`.

### 4.2 Usuarios

| Método | Ruta | Acción |
|---|---|---|
| `GET` | `/admin/users` | Lista paginada. Filtros: `?status=&role=&q=` (búsqueda por nombre o email) |
| `GET` | `/admin/users/:id` | Detalle: perfil + últimos 10 anuncios + reportes recibidos + AuditLogs |
| `PATCH` | `/admin/users/:id/suspend` | `status → SUSPENDED` + AuditLog |
| `PATCH` | `/admin/users/:id/ban` | `status → BANNED` + AuditLog |
| `PATCH` | `/admin/users/:id/reinstate` | `status → ACTIVE` + AuditLog |
| `PATCH` | `/admin/users/:id/role` | Cambia `role`. Body: `{ role: "USER" \| "MODERATOR" \| "EDITOR" }` + AuditLog |

**Regla innegociable sobre cambio de rol**: `PATCH /admin/users/:id/role` solo acepta
`USER`, `MODERATOR` y `EDITOR` como valores destino — **`ADMIN` nunca lo es**. Si el target
ya tiene `role === ADMIN`, la petición se rechaza con `403 Forbidden`. Un admin no puede
degradar a otro admin ni promover a nadie a admin. Esta comprobación vive en el service (no
solo en el DTO), para que no pueda bypassearse con una llamada directa a Prisma.

> **Actualizado (2026-08-04):** el diseño listaba dos destinos; hoy son tres, porque
> BLOG-EDITOR añadió `EDITOR` (`ChangeUserRoleDto`: `@IsIn([Role.USER, Role.MODERATOR,
> Role.EDITOR])`). **La regla de fondo no cambió** — `ADMIN` sigue fuera de la lista, que es
> lo que la hace innegociable. La UI refuerza lo mismo por su lado: en las filas de un
> usuario ADMIN **no se pinta el selector de rol**, solo el badge.

**Estas cuatro acciones no comparten rol** (Hito 5.1, §0.1): `suspend`/`unsuspend` son
**MODERATOR + ADMIN** por ser reversibles; `ban`, `reinstate`, `role` y `trusted` son
**ADMIN-only**. El `unsuspend` no estaba en este diseño y se añadió como reverso explícito
de `suspend`.

### 4.3 Categorías

**El endpoint público `GET /categories` NO se toca.** Sigue devolviendo el árbol completo
y es consumido por el home, el wizard de publicación, los filtros de búsqueda y las páginas
de categoría. Nada de lo que añadimos en `/admin/categories` afecta a esa ruta.

Lo que añade `/admin/categories` es la gestión (escritura), que el frontend público no
necesita:

| Método | Ruta | Acción |
|---|---|---|
| `GET` | `/admin/categories` | Árbol completo (reutiliza la query de `CategoriesService`) |
| `POST` | `/admin/categories` | Crear. Body: `{ name, slug, parentId?, order, attributeSchema }` |
| `PATCH` | `/admin/categories/:id` | Editar nombre, iconUrl, order, attributeSchema |
| `PATCH` | `/admin/categories/reorder` | Body: `[{ id, order }]` — batch update de `order` |
| `DELETE` | `/admin/categories/:id` | Eliminar — el service rechaza si tiene listings activos o subcategorías |

**`attributeSchema`**: el campo JSON ya existe en el modelo `Category`. El editor de
`attributeSchema` en el frontend del backoffice es la herramienta para gestionar los
atributos variables por categoría (brand, fuel, rooms, size…) sin tocar el código.

### 4.4 Ajustes del sistema

| Método | Ruta | Acción |
|---|---|---|
| `GET` | `/admin/settings` | Todos los settings (array de `{ key, value, updatedAt }`) |
| `PATCH` | `/admin/settings/:key` | Actualizar valor. Body: `{ value: Json }`. + AuditLog con before/after |

El service valida que `key` sea una de las keys conocidas (enum o whitelist) antes de
persistir. No se pueden crear keys arbitrarias desde la API.

### 4.5 Stats (dashboard)

`GET /admin/stats` — una sola llamada que devuelve todas las métricas:

```typescript
interface AdminStats {
  listings: {
    active: number;           // WHERE status = ACTIVE
    pendingReview: number;    // WHERE status = PENDING_REVIEW
    publishedToday: number;   // WHERE publishedAt >= startOfToday AND status = ACTIVE
    publishedThisWeek: number;
    byStatus: Record<ListingStatus, number>; // aggregate para el gráfico
  };
  users: {
    total: number;
    newToday: number;
    newThisWeek: number;
    byStatus: Record<UserStatus, number>;
  };
  moderation: {
    reportsPending: number;   // WHERE status = PENDING
    reportsReviewingNow: number;
  };
  engagement: {
    conversationsTotal: number;  // proxy de "conversión a contacto"
    conversionRate: string;      // conversationsTotal / listings.active, formateado
  };
  search: {                      // de Meilisearch /indexes/listings/stats
    totalDocuments: number;
    isIndexing: boolean;
  };
}
```

Todas las métricas de Postgres son queries simples (`count`/`groupBy`). La métrica de
Meilisearch es una llamada HTTP al endpoint de stats del índice. Si Meilisearch no
responde, el campo `search` devuelve `null` (no rompe el dashboard).

---

## 5. Endpoints de admin (resumen consolidado)

> ## ✅ Construido — con tres diferencias respecto a lo que lista este bloque
>
> **1. `GET /admin/audit-logs` NUNCA se construyó.** Aparece abajo y no existe: no hay
> ninguna ruta `audit-logs` en ningún controlador. Los registros de auditoría **sí se
> escriben** en todas las mutaciones, y se consultan **embebidos** en
> `GET /admin/users/:id`, que devuelve los últimos del usuario junto a su detalle. Lo que no
> hay es un explorador de auditoría navegable y filtrable por `resourceType`/`resourceId`,
> que es lo que este bloque prometía. **Sigue siendo una ausencia real**, no una decisión
> documentada.
>
> **2. Los roles de abajo están desfasados.** Este bloque marca `(ADMIN)` casi todo porque se
> escribió con un solo rol operativo. La separación real:
>
> | Endpoint | Diseño | Hoy |
> |---|---|---|
> | `GET /admin/listings`, `/listings/:id`, `PATCH /listings/:id/status` | ADMIN | **MODERATOR + ADMIN** |
> | `GET /admin/users`, `/users/:id` | ADMIN | **MODERATOR + ADMIN** |
> | `PATCH /users/:id/suspend` · `/unsuspend` | ADMIN | **MODERATOR + ADMIN** (reversible) |
> | `PATCH /users/:id/ban` · `/reinstate` · `/role` | ADMIN | **ADMIN** (irreversible o de permisos) |
> | `GET /admin/stats`, categorías, ajustes | ADMIN | **ADMIN** — sin cambios |
>
> `PATCH /users/:id/unsuspend` no estaba en el diseño; se añadió como reverso de `suspend`.
> `PATCH /users/:id/trusted` (distintivo «Vendedor de confianza», ADMIN-only) tampoco: llegó
> con el Hito 8.
>
> **3. Falta todo lo que el backoffice ganó después.** Nueve controladores más, todos
> `@Roles(ADMIN)` salvo los indicados: `admin/billing` (transacciones, wallets, acreditación
> manual, precios, packs), `admin/invoices` + `admin/fiscal-issuer`, `admin/tickets`
> (**MODERATOR + ADMIN**, con las dos puertas de §0.1), `admin/blog` (**EDITOR + MODERATOR +
> ADMIN**, salvo `DELETE` que es ADMIN), `admin/footer`, `admin/tags` (+
> `admin/categories/:id/tags`), `admin/sponsored-ads`, `admin/banners`, `admin/campaigns`,
> `admin/coupons`, `admin/contact-messages` y `admin/contact-reasons`.
>
> **El inventario completo y verificado de la API está en `docs/contratos-api.md`**, que es
> hoy la referencia operativa. Lo de abajo se conserva como el alcance que este diseño
> cubría.

```
/moderation
  POST   /reports                          — reportar (USER+)
  GET    /reports                          — cola (MOD/ADMIN)
  GET    /reports/:id                      — detalle (MOD/ADMIN)
  PATCH  /reports/:id/start-review         — (MOD/ADMIN)
  PATCH  /reports/:id/resolve              — (MOD/ADMIN)
  PATCH  /reports/:id/dismiss              — (MOD/ADMIN)
  POST   /listings/:id/approve             — PENDING_REVIEW → ACTIVE (MOD/ADMIN)
  POST   /listings/:id/reject              — PENDING_REVIEW → REJECTED (MOD/ADMIN)
  POST   /listings/:id/deactivate          — ACTIVE → REJECTED (MOD/ADMIN)
  POST   /listings/:id/restore             — REJECTED → ACTIVE (MOD/ADMIN)

/admin
  GET    /stats                            — KPIs dashboard (ADMIN)
  GET    /listings                         — todos los anuncios (ADMIN)
  GET    /listings/:id                     — detalle admin (ADMIN)
  PATCH  /listings/:id/status              — cambio de estado manual (ADMIN)
  GET    /users                            — lista usuarios (ADMIN)
  GET    /users/:id                        — detalle usuario (ADMIN)
  PATCH  /users/:id/suspend                — (ADMIN)
  PATCH  /users/:id/ban                    — (ADMIN)
  PATCH  /users/:id/reinstate              — (ADMIN)
  PATCH  /users/:id/role                   — solo USER|MODERATOR como destino (ADMIN)
  GET    /categories                       — árbol (ADMIN)
  POST   /categories                       — crear (ADMIN)
  PATCH  /categories/:id                   — editar (ADMIN)
  PATCH  /categories/reorder               — reordenar batch (ADMIN)
  DELETE /categories/:id                   — eliminar (ADMIN)
  GET    /settings                         — todos los ajustes (ADMIN)
  PATCH  /settings/:key                    — actualizar ajuste (ADMIN)

/admin/audit-logs (lectura para el backoffice)
  GET    /audit-logs                       — filtros: ?actorId=&resourceType=&resourceId=&page= (ADMIN)
```

---

## 6. Frontend del backoffice — estructura de páginas

Toda la carpeta `app/(admin)/` es client-side. La protección vive en el middleware y en
los guards del backend.

> **Corrección (2026-08-04):** decía que «las páginas simplemente asumen que el usuario es
> ADMIN». **Ya no es así**: desde el Hito 5.1 conviven tres roles, así que una página puede
> renderizarse para un MODERATOR o un EDITOR. Las páginas compartidas ocultan las acciones
> que su rol no puede ejecutar —el MODERATOR no ve «Banear» ni el selector de rol en
> `/admin/usuarios`, y ni él ni el EDITOR ven «Eliminar» en `/admin/blog`—, pero **eso es
> presentación, no seguridad**: quien rechaza es el `RolesGuard` del backend. Ver §0.1.
>
> Un caso lo deja claro: en `/admin/tickets` el MODERATOR no ve los tickets con factura
> enlazada, y **no se filtran en el cliente** — el backend simplemente no se los lista.

### Layout

```
(admin)/
  layout.tsx          — Server Component: estructura flex (sidebar + main)
  components/
    AdminNav.tsx      — "use client" — usa usePathname() para active state
    AdminUserBar.tsx  — "use client" — usa useSession() para nombre/avatar + logout
```

### Páginas

> **✅ Las 6 se construyeron — y el backoffice llegó a 19 rutas (18 en el nav).** La tabla de
> abajo es el alcance de R7.x; esta es la realidad de hoy. La columna de rol sale de
> `NAV_ITEMS` y de `ROLE_ALLOWED_PATHS` (§0.1).
>
> | Ruta | Qué es | Rol | Ráfaga |
> |---|---|---|---|
> | `/admin` | Dashboard de KPIs | ADMIN | R7.8 |
> | `/admin/anuncios` | Tabla + cambio de estado inline | MOD+ | R7.7 |
> | `/admin/usuarios` | Tabla + suspend/ban/rol/trusted + panel de detalle con auditoría | MOD+ | R7.7 |
> | `/admin/reportes` | Cola de reportes (+ «Contactar al reportado» → ticket) | MOD+ | R7.3.5 |
> | `/admin/categorias` | Árbol + editor visual de atributos + panel de tags | ADMIN | R7.8 |
> | `/admin/ajustes` | Settings con controles por tipo | ADMIN | R7.8 |
> | `/admin/tickets` | Bandeja de atención al usuario + hilo con notas internas | MOD+ | R7 (tickets) |
> | `/admin/facturacion` | Transacciones, wallets, acreditación manual, catálogo | ADMIN | RF.12 |
> | `/admin/facturas` (+ `/emisor`) | Facturas fiscales y datos del emisor | ADMIN | RF.13 R5 |
> | `/admin/blog` · `/admin/paginas` | CMS por bloques (13 tipos) | **EDITOR+** | Blog |
> | `/admin/footer` | Columnas e ítems de navegación | ADMIN | Footer |
> | `/admin/tags` | Catálogo global de etiquetas | ADMIN | B1 |
> | `/admin/campaigns` · `/admin/cupones` · `/admin/banners` | Marketing | ADMIN | H8 C/D |
> | `/admin/sponsored-ads` | Anuncios patrocinados | ADMIN | H6.6 |
> | `/admin/mensajes-contacto` | Formulario público: bandeja y respuesta | ADMIN | RC.1 |
> | `/admin/motivos-contacto` | Motivos configurables — **sin entrada de nav**, se llega desde «Mensajes de contacto» | ADMIN | RC.2 |
>
> Por eso **19 rutas y 18 ítems de nav**: `motivos-contacto` es una subpágina de configuración,
> no una sección de primer nivel.
>
> **Lo que NO cambió:** sigue siendo client-side puro, con `useEffect` + `fetch` y sin
> librería de caché. La decisión de §9 aguantó 18 secciones.

**Alcance original de R7.x:**

| Ruta | Página | Fetch principal |
|---|---|---|
| `/admin` | Dashboard | `GET /admin/stats` |
| `/admin/anuncios` | Tabla de anuncios | `GET /admin/listings` + acciones de estado |
| `/admin/usuarios` | Tabla de usuarios | `GET /admin/users` + suspend/ban/reinstate |
| `/admin/reportes` | Cola de reportes | `GET /moderation/reports` + resolve/dismiss/deactivate |
| `/admin/categorias` | Árbol editable | `GET /admin/categories` + CRUD |
| `/admin/ajustes` | Formulario de settings | `GET /admin/settings` + PATCH por key |

Todas usan el mismo patrón: `useEffect` + `fetch` con el token de sesión. Sin
`react-query` ni librería de caché por ahora; un `useState` de loading/error/data es
suficiente para el volumen de un backoffice interno.

---

## 7. Orden de ejecución afinado

### Por qué R7.3.5 (vertical temprana)

Sin la vertical temprana, el riesgo es llegar a R7.6 (frontend) habiendo construido 3–4
ráfagas de backend en "vacío", sin haber validado que el patrón completo funciona:
middleware → guard → endpoint → fetch client-side → UI → respuesta real. Cualquier
problema estructural (CORS, sesión no propagada al fetch, serialización del token en el
cliente admin) aparecería tardísimo.

La vertical elegida es **moderación de reportes**: es el flujo más representativo (requiere
autenticación, guard de rol, una query con relaciones, una acción de mutación, y un
AuditLog), y es la funcionalidad de mayor valor temprano (la cola de reportes es lo primero
que un admin necesitaría en producción).

### Tabla de ráfagas

> ## ✅ Las ocho están cerradas (R7.2 → R7.8, incluida la vertical temprana R7.3.5)
>
> **La vertical temprana cumplió su propósito.** Se hizo tal cual se argumenta arriba —
> moderación de reportes como primera vertical completa— y validó el patrón
> middleware → guard → endpoint → fetch → UI antes de acumular ráfagas de backend en vacío.
>
> **Lo que estas ocho ráfagas NO cubrieron, y llegó después:**
>
> | Después de R7.8 | Qué añadió al backoffice |
> |---|---|
> | **Hito 5.1** (RR5.1–RR5.3) | La separación real de roles: matriz rol×sección, `ROLE_ALLOWED_PATHS`, guards por endpoint, filtrado del nav (§0.1) |
> | **BLOG-EDITOR** | El cuarto rol, `EDITOR`, acotado a blog y páginas |
> | **RF.12 / RF.13** | Facturación y facturas fiscales |
> | **Tickets R7** | Bandeja de atención al usuario |
> | **H6.6, B1, H8 C/D, RC.1/RC.2, Blog, Footer** | Patrocinados, tags, campañas/cupones/banners, mensajes y motivos de contacto, CMS por bloques, navegación del footer |
>
> Es decir: **estas ocho ráfagas construyeron el esqueleto y las cuatro secciones
> originales; las otras catorce llegaron con sus propios hitos.** El diseño de §1 (shell
> client-side, nav con filtrado por rol, layout) aguantó las dieciocho sin rehacerse, que es
> el mejor indicador de que la estructura era correcta.

| Ráfaga | Contenido | Entregable verificable |
|---|---|---|
| **R7.2** | Modelos `AuditLog` + `Setting`, migración `add_audit_log_and_settings`, `AuditLogService`, seed de settings | `prisma migrate dev` pasa; `AuditLogService` inyectable |
| **R7.3** | Backend moderation completo: `ModerationService` (reports CRUD + resolve/dismiss + approve/reject/deactivate/restore), `BadWordService` con fallback silencioso, `BadWordService` integrado en `ListingsService.publish()` | Swagger muestra los endpoints; tests e2e básicos de reports |
| **R7.3.5** *(nueva)* | Frontend `/admin/reportes`: tabla paginada de reportes PENDING, botones resolve/dismiss, botón "retirar anuncio" → llama a `/moderation/listings/:id/deactivate`. **Vertical completa end-to-end.** | Un admin puede ver y resolver un reporte real desde el navegador |
| **R7.4** | Backend admin: listings (GET list + detail + PATCH status) + users (GET list + detail + suspend/ban/reinstate/role) | Endpoints admin de usuarios y anuncios operativos |
| **R7.5** | Backend admin: categories CRUD + settings CRUD + `GET /admin/stats` | Dashboard de stats responde con datos reales |
| **R7.6** | Frontend shell: `<AdminNav>` con active state + `<AdminUserBar>` con sesión + breadcrumbs básicos | Layout del backoffice terminado |
| **R7.7** | Frontend `/admin/anuncios` (tabla + filtros + acciones de estado) + `/admin/usuarios` (tabla + filtros + suspend/ban/reinstate) | Gestión de contenido y usuarios desde la UI |
| **R7.8** | Frontend `/admin/categorias` (árbol editable + editor de `attributeSchema`) + `/admin/ajustes` (formulario de settings) + `/admin` (dashboard con KPIs renderizados) | Backoffice completo |

---

## 8. Variables de entorno y configuración

No se añaden variables de entorno nuevas. Los settings del sistema viven en la tabla
`Setting` (gestionada por el admin) en lugar de en `.env`, porque son configuración
en tiempo de ejecución que debe poder cambiar sin despliegue.

La única excepción: si en el futuro se añade integración con servicios externos de
moderación de contenido (p.ej. APIs de visión por computador para imágenes), sus API
keys irán en `.env` como el resto de credenciales.

---

## 9. Decisiones de diseño — resumen ejecutivo

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| `AuditLogService` explícito en el service de dominio | Interceptor de NestJS | El interceptor no tiene acceso al estado "before" de Prisma; el log quedaría sin el snapshot previo, que es su principal utilidad |
| `BadWordService` con fallback silencioso a `ACTIVE` | Rechazar la publicación si falla | La moderación es una capa de ayuda, no un bloqueante; mismo principio que el geocoding. Una lista vacía o un error nunca rompen el flujo del usuario |
| `GET /categories` público intacto; `/admin/categories` solo añade escritura | Mover el árbol al módulo admin | El front público (home, wizard, búsqueda) depende del endpoint público; romperlo requeriría cambios en todo el frontend existente sin ningún beneficio |
| ~~`PATCH /admin/users/:id/role` solo acepta `USER\|MODERATOR`~~ → **hoy `USER\|MODERATOR\|EDITOR`** | Permitir cualquier rol | **Sigue vigente en lo esencial**: ADMIN nunca es un destino válido, así que un admin no puede degradar a otro admin. Solo se amplió la lista al aparecer `EDITOR` (`ChangeUserRoleDto`). La UI además **no pinta el selector** en las filas de un ADMIN |
| Backoffice client-side puro (sin SSR) | SSR como el resto del front | El backoffice es una herramienta interna sin requisitos de SEO ni de time-to-first-paint crítico; SSR añade complejidad sin beneficio |
| Vertical temprana R7.3.5 (reportes) antes de terminar todo el backend | Terminar todo el backend, luego todo el frontend | Valida el patrón completo con algo real; detecta problemas de integración antes de que el coste de cambiarlos sea alto |
| ~~**Rol único ADMIN por ahora; `MODERATOR` disponible en el enum**~~ | Ignorar MODERATOR hasta habilitar | 🚫 **DEROGADA (Hito 5.1).** Ver abajo |

### 🚫 Decisión derogada — «rol único ADMIN por ahora»

**Qué decía:** que bastaba con dejar `MODERATOR` declarado en el enum y `@Roles(MODERATOR,
ADMIN)` puesto «donde corresponde», porque separar permisos más adelante no exigiría
migración.

**La predicción técnica era correcta y la conclusión operativa no.** No hizo falta ninguna
migración —eso acertó—, pero mientras tanto **un MODERATOR y un ADMIN podían hacer
exactamente lo mismo en todo `/admin`**. El enum daba la apariencia de una frontera que no
existía: `RolesGuard` estaba puesto, pero como casi todo declaraba `MODERATOR, ADMIN`, no
separaba nada. Eso se catalogó como **deuda de seguridad transversal**, no como una tarea
pendiente de producto, y es lo que abrió el Hito 5.1.

**Qué la sustituye** (detalle en §0.1):

1. Una **matriz explícita rol × sección**, decidida como decisión de producto y no derivada
   de dónde ya hubiera un decorador.
2. **Tres capas coordinadas** —middleware, `RolesGuard` y `AdminNav`— que se tocan a la vez.
3. Un **criterio** que decide los casos nuevos sin volver a discutirlos: *MODERATOR modera
   contenido reversible; ADMIN toca dinero, configuración y permisos.*
4. Un **cuarto rol**, `EDITOR`, cuando apareció un perfil —el editorial— que no encajaba en
   ninguno de los tres.

**La lección, que vale más que el caso:** declarar un rol en un enum no es separar permisos.
Mientras la frontera no esté aplicada y probada, el rol es documentación, no control de
acceso. Los 26 casos de `admin-roles.spec.ts` existen precisamente para que la frontera no
pueda volver a evaporarse en silencio.
