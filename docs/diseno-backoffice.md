# Diseño del backoffice y la moderación — Hito 2, Fase 7

> Documento de diseño de R7.1 (2026-06-24). Las ráfagas R7.2–R7.8 implementan lo
> aquí descrito. Lo que ya existe en `main` se indica explícitamente.

---

## 0. Andamiaje existente (auditoría R7.1)

Lo que ya está en `main` y sobre lo que construimos:

**Backend (`apps/api`)**

| Elemento | Ubicación | Estado |
|---|---|---|
| `AdminController` | `modules/admin/admin.controller.ts` | Stub — guards correctos (`JwtAuthGuard + RolesGuard + @Roles(ADMIN)`) |
| `AdminService` | `modules/admin/admin.service.ts` | Vacío |
| `ModerationController` | `modules/moderation/moderation.controller.ts` | Stub — `@Roles(MODERATOR, ADMIN)` |
| `ModerationService` | `modules/moderation/moderation.service.ts` | Vacío |
| `RolesGuard` | `common/guards/roles.guard.ts` | Operativo — lee `ROLES_KEY` del reflector |
| `Role` enum | `prisma/schema.prisma` | `USER \| MODERATOR \| ADMIN` |
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
  → middleware: ¿role === ADMIN? No → /
  → layout.tsx (Server Component — solo markup)
    → page.tsx ("use client" — fetch al backend con Bearer token)
      → NestJS: JwtAuthGuard valida token, RolesGuard verifica rol ADMIN
```

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
| `PATCH` | `/admin/users/:id/role` | Cambia `role`. Body: `{ role: "USER" \| "MODERATOR" }` + AuditLog |

**Regla innegociable sobre cambio de rol**: `PATCH /admin/users/:id/role` solo acepta
`USER` y `MODERATOR` como valores destino. Si el target ya tiene `role === ADMIN`, la
petición se rechaza con `403 Forbidden`. Un admin no puede degradar a otro admin. Esta
comprobación vive en el service (no solo en el DTO), para que no pueda bypassearse con
una llamada directa a Prisma.

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
los guards del backend; las páginas simplemente asumen que el usuario es ADMIN.

### Layout

```
(admin)/
  layout.tsx          — Server Component: estructura flex (sidebar + main)
  components/
    AdminNav.tsx      — "use client" — usa usePathname() para active state
    AdminUserBar.tsx  — "use client" — usa useSession() para nombre/avatar + logout
```

### Páginas

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
| `PATCH /admin/users/:id/role` solo acepta `USER\|MODERATOR` | Permitir cualquier rol | Un admin no puede degradar a otro admin; validación en el service (no solo en el DTO) para que no sea bypasseable |
| Backoffice client-side puro (sin SSR) | SSR como el resto del front | El backoffice es una herramienta interna sin requisitos de SEO ni de time-to-first-paint crítico; SSR añade complejidad sin beneficio |
| Vertical temprana R7.3.5 (reportes) antes de terminar todo el backend | Terminar todo el backend, luego todo el frontend | Valida el patrón completo con algo real; detecta problemas de integración antes de que el coste de cambiarlos sea alto |
| Rol único ADMIN por ahora; `MODERATOR` disponible en el enum | Ignorar MODERATOR hasta habilitar | El enum ya está en schema; los controllers ya tienen `@Roles(MODERATOR, ADMIN)` donde corresponde; separar permisos más adelante no requiere migración |
