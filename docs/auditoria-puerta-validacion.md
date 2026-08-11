# Auditoría de viabilidad — La puerta de validación del ciclo de vida del anuncio

> **Qué es este documento.** Una auditoría de **viabilidad y diseño-preliminar**. No implementa,
> no diseña en detalle, no resuelve las decisiones: las saca a la superficie con opciones.
>
> **De qué parte.** De [`docs/mapa-categorias-y-ciclo-vida.md`](mapa-categorias-y-ciclo-vida.md),
> que ya inventarió el estado actual. Aquí **no se re-inventaría** — se profundiza donde el mapa
> dejó ambigüedad y donde esta auditoría necesita detalle (forma de `ListingActivationService`,
> grafo de módulos, entrada de las transiciones de staff, contrato de error del cliente).
>
> **Para qué sirve.** Para decidir (1) si la puerta va antes o después del trabajo de profundidad,
> y (2) tener el diseño-preliminar cuando se implemente.
>
> Fecha: 2026-08-11. Rama `main`, commit `1d1f462`.

---

## Preámbulo — LA SEPARACIÓN (A) / (B)

El mapa metió dos cosas distintas bajo el mismo titular «no hay puerta». Son problemas de
naturaleza, urgencia y tamaño diferentes, y **esta auditoría los mantiene separados de principio a fin**:

|  | **(A) BUG ACTIVO** | **(B) ARQUITECTURA AUSENTE** |
|---|---|---|
| **Qué es** | El límite de activos (free 5 / pro 20) se burla hoy por 4 caminos. `changeListingStatus` acepta cualquier transición sin máquina de estados | No hay un punto común donde validar un anuncio al pasar a / permanecer en ACTIVE |
| **Naturaleza** | Algo **ROTO hoy**, en producción, con una regla de negocio que ya existe y ya se cobra | Algo que **NO EXISTE** y que las features nuevas de Ernest necesitan |
| **¿Depende de las features nuevas?** | **No.** Es independiente del 2→4 niveles, de la política de validez, de los ajustes nuevos | Sí — es su cimiento |
| **Tamaño** | Pequeño y acotado (§3) | Medio-grande, transversal (§2) |
| **Urgencia** | Alta: hay una regla monetizada que no se cumple | Media: es habilitador, no un fallo |
| **Riesgo de romper flujos** | Bajo-medio (§3.4) | **Alto** — es el riesgo central (§4.5) |

Todo lo que sigue está etiquetado como **(A)** o **(B)** cuando la distinción importa.

---

# BLOQUE 1 — El mapa completo de transiciones a ACTIVE

## 1.1 Hallazgo previo: el estado se escribe por VARIABLE en 3 de los 8 escritores

Antes de enumerar, un dato que condiciona todo el bloque y que el mapa no destacó:

| Escritor | Cómo escribe el estado |
|---|---|
| `publish` | `data: { status: targetStatus, … }` — [listings.service.ts:480](apps/api/src/modules/listings/listings.service.ts#L480) — **variable** |
| `closeDeal` | `data: { status: newStatus }` — [listings.service.ts:730](apps/api/src/modules/listings/listings.service.ts#L730) — **variable** |
| `changeListingStatus` | `updateData.status = dto.status` — [admin.service.ts:270](apps/api/src/modules/admin/admin.service.ts#L270) — **del DTO** |
| `renew` / `reactivate` / `undoDeal` / `approveListing` / `restoreListing` | Literal `'ACTIVE'` |

**Consecuencia práctica:** un `grep "status: 'ACTIVE'"` **no encuentra 3 de los 8 escritores** —
verificado ejecutándolo. La enumeración fiable es «toda llamada a `prisma.listing.update`/
`updateMany` que pueda tocar `status`», y hay **20 llamadas a `listing.update*`** en el backend.

Esto es, por sí solo, el argumento más fuerte a favor de un punto de estrangulamiento: hoy la
única forma de saber quién activa un anuncio es leer los 20 sitios.

## 1.2 Los 8 caminos que ESCRIBEN `ACTIVE`

| # | Camino | Origen → destino | Entra por | Actor | Valida HOY | **NO valida** |
|---|---|---|---|---|---|---|
| 1 | `ListingsService.publish` [:452-494](apps/api/src/modules/listings/listings.service.ts#L452-L494) | `DRAFT` → `ACTIVE`\|`PENDING_REVIEW` | `POST /listings/:id/publish` (`JwtAuthGuard`) | Vendedor | Propiedad · estado origen · filtro de palabras (fail-open) · **cuota** [:472-474](apps/api/src/modules/listings/listings.service.ts#L472-L474) | Atributos vs schema · correo verificado · fotos · nada más |
| 2 | `ListingsService.renew` [:496-526](apps/api/src/modules/listings/listings.service.ts#L496-L526) | `ACTIVE`\|`EXPIRED` → `ACTIVE` | `POST /listings/:id/renew` | Vendedor | Propiedad · estado · **cuota** [:506](apps/api/src/modules/listings/listings.service.ts#L506) | Todo lo demás |
| 3 | `ListingsService.reactivate` [:575-594](apps/api/src/modules/listings/listings.service.ts#L575-L594) | `PAUSED` → `ACTIVE` | `POST /listings/:id/reactivate` | Vendedor | Propiedad · estado · **cuota** [:581](apps/api/src/modules/listings/listings.service.ts#L581) | Todo lo demás |
| 4 | `ListingsService.closeDeal` [:639-734](apps/api/src/modules/listings/listings.service.ts#L639-L734) | `RESERVED` → `ACTIVE` (solo SERVICE) | `POST /listings/:id/deals` | Vendedor | Propiedad · estado · comprador válido | **Cuota** — pero venía de RESERVED, que ya ocupaba plaza conceptualmente. Ver §1.5 |
| 5 | `ListingsService.undoDeal` [:743-763](apps/api/src/modules/listings/listings.service.ts#L743-L763) | `SOLD` → `ACTIVE` (solo PRODUCT) | `DELETE /listings/:id/deals/:dealId` | **Vendedor** | Propiedad · trato existe · ventana 72 h | **🔴 CUOTA (A)** · todo lo demás |
| 6 | `ModerationService.approveListing` [:224-258](apps/api/src/modules/moderation/moderation.service.ts#L224-L258) | `PENDING_REVIEW` → `ACTIVE` | `POST /moderation/listings/:id/approve` (`RolesGuard`, MODERATOR\|ADMIN) | Staff | Estado origen | **🔴 CUOTA (A)** · todo lo demás |
| 7 | `ModerationService.restoreListing` [:340-379](apps/api/src/modules/moderation/moderation.service.ts#L340-L379) | `REJECTED` → `ACTIVE` | `POST /moderation/listings/:id/restore` | Staff | Estado origen | **🔴 CUOTA (A)** · todo lo demás |
| 8 | `AdminService.changeListingStatus` [:256-302](apps/api/src/modules/admin/admin.service.ts#L256-L302) | **cualquiera** → **cualquiera** | `PATCH /admin/listings/:id/status` (`RolesGuard`, MODERATOR\|ADMIN) | Staff | **🔴 NADA** | **🔴 CUOTA (A) · MÁQUINA DE ESTADOS (A)** · todo lo demás |

**Verificación de las entradas de staff:** `ModerationController` lleva
`@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(MODERATOR, ADMIN)` a nivel de clase
([moderation.controller.ts:27-29](apps/api/src/modules/moderation/moderation.controller.ts#L27-L29));
`AdminController` es `@Roles(ADMIN)` de clase pero `changeListingStatus` lo **relaja** a
`@Roles(MODERATOR, ADMIN)` ([admin.controller.ts:63-70](apps/api/src/modules/admin/admin.controller.ts#L63-L70)).
El DTO acepta **cualquier valor del enum** sin restricción: `@IsEnum(ListingStatus) status`
([change-listing-status.dto.ts:4-11](apps/api/src/modules/admin/dto/change-listing-status.dto.ts#L4-L11)).

## 1.3 Los caminos que EXIGEN ACTIVE sin escribirlo (mantener activo)

Estos no activan, pero **operan sobre un anuncio activo** y cobran dinero por ello. Son
candidatos naturales a «la puerta también aquí», y por eso importan al diseño.

| Camino | Fichero:línea | Entra por | Valida HOY |
|---|---|---|---|
| `BillingService.bump` | [:580-599](apps/api/src/modules/billing/billing.service.ts#L580-L599) | `POST /listings/:id/bump` (vendedor) | Existe · es tuyo · `status === ACTIVE` · cooldown reclamado atómicamente [:616-663](apps/api/src/modules/billing/billing.service.ts#L616-L663). **No mira validez del anuncio, y cobra** |
| `BillingService.grantFeaturedListingTx` | [:311-327](apps/api/src/modules/billing/billing.service.ts#L311-L327) | Webhook de pago | Existe · es tuyo · ACTIVE · sin destacado vigente |
| `BillingService.assertFeaturable` | [:370-401](apps/api/src/modules/billing/billing.service.ts#L370-L401) | `POST /billing/featured-by-credits` | Ídem |
| `BumpScheduleService` (cron) | [:93-100](apps/api/src/modules/bump-schedule/bump-schedule.service.ts#L93-L100) | Cron, **desatendido** | Delega en `BillingService.bump` |
| `ListingsService.update` | [:261-450](apps/api/src/modules/listings/listings.service.ts#L261-L450) | `PATCH /listings/:id` | Propiedad. **No hay guarda de estado** — se puede editar un ACTIVE (y un ARCHIVED) |

## 1.4 Los caminos que SACAN de ACTIVE (contexto, no objetivo de la puerta)

`reserve` [:528-541](apps/api/src/modules/listings/listings.service.ts#L528-L541) ·
`pause` [:552-565](apps/api/src/modules/listings/listings.service.ts#L552-L565) ·
`archive` [:614-629](apps/api/src/modules/listings/listings.service.ts#L614-L629) ·
`closeDeal` (PRODUCT → SOLD) ·
`ModerationService.deactivateListing` [:298-338](apps/api/src/modules/moderation/moderation.service.ts#L298-L338) ·
`ExpirationService.expireListings` (cron 02:00) [:24-48](apps/api/src/modules/expiration/expiration.service.ts#L24-L48) ·
`EntitlementExpirationService.processProDowngrade` (cron 03:00, ACTIVE → DRAFT) [:143-193](apps/api/src/modules/expiration/entitlement-expiration.service.ts#L143-L193) ·
`remove` (borrado físico desde cualquier estado).

**Salir de ACTIVE siempre libera cuota y siempre saca del índice** — no necesitan puerta. El
comentario de `pause` ya lo razona explícitamente ([:547-548](apps/api/src/modules/listings/listings.service.ts#L547-L548)).

**Los dos crones son relevantes por otro motivo (§4.1):** son el mecanismo que ya existe para
«invalidación diferida por barrido», y `downgradeExpiredPro` es, de hecho, **la única regla de
negocio del repositorio que hoy desactiva anuncios activos en masa por incumplimiento sobrevenido**.
Es el precedente más cercano a lo que Ernest quiere.

## 1.5 El conjunto completo — y los huecos que la enumeración destapa

**Cobertura obligatoria de la puerta: los 8 caminos de §1.2.** Si deja uno fuera, es un 5.º camino
que salta la validación, exactamente como los 4 actuales.

Dos hallazgos nuevos de esta enumeración (no estaban en el mapa):

1. **No existe `unreserve`.** Verificado por grep en toda la base: no hay endpoint, ni método, ni
   nada en el cliente web. Un `RESERVED` solo vuelve a `ACTIVE` por `closeDeal` de un SERVICIO
   (camino 4) o por `changeListingStatus` de un admin (camino 8). El enunciado del encargo lo daba
   por existente; **no existe**. Un vendedor que reserva un producto por error **no puede
   deshacerlo él mismo**.
2. **`closeDeal` (camino 4) es un `RESERVED → ACTIVE` real** y no comprueba cuota. No lo cuento
   entre los 4 bugs de (A) porque el anuncio venía de `RESERVED`, un estado que sale de ACTIVE y
   **libera plaza** ([:1519-1521](apps/api/src/modules/listings/listings.service.ts#L1519-L1521)
   cuenta solo `status: 'ACTIVE'`). Es decir: reservar libera cuota, y volver de reserva la
   recupera sin comprobar. **Es un 5.º camino latente**, más sutil que los otros cuatro. Merece
   decisión propia, no arreglo automático.

## 1.6 Clasificación: ¿interceptar o llamar?

| Camino | Clasificación | Por qué |
|---|---|---|
| 1 `publish` | **LLAMAR** | Ya llama a `checkActiveListingLimit`; sustituir la llamada por la puerta es mecánico |
| 2 `renew` · 3 `reactivate` | **LLAMAR** | Ídem |
| 4 `closeDeal` | **LLAMAR, con decisión previa** (§1.5.2) | Hay que decidir antes si `RESERVED → ACTIVE` debe pasar por la puerta |
| 5 `undoDeal` | **LLAMAR** | Pero está **dentro de un `$transaction`** ([:753-759](apps/api/src/modules/listings/listings.service.ts#L753-L759)) — la puerta debe correr **antes** de abrirla o aceptar un `tx` (§2.6) |
| 6 `approveListing` · 7 `restoreListing` | **LLAMAR** — módulo distinto | `ModerationModule` ya importa `ListingActivationModule` ([moderation.module.ts:25](apps/api/src/modules/moderation/moderation.module.ts#L25)); el precedente de compartir un servicio de activación entre módulos **ya existe** |
| 8 `changeListingStatus` | **CASO APARTE** | Es «cualquiera → cualquiera». No es un camino a ACTIVE: es un *escape hatch* de staff. Necesita decisión de política (§4.3), no solo una llamada |
| bump / featured | **LLAMAR, opcional** | Riesgo de ciclo de módulos (§2.3). Puede quedar fuera de la primera versión |

**No hay ningún camino donde «interceptar» a nivel de framework sea viable** — ver §2.2.

---

# BLOQUE 2 — La forma viable de la puerta (B)

## 2.1 ¿Sirve `ListingActivationService`? — Verificado: NO, pero es el molde

**Su forma real, completa** — [listing-activation.service.ts](apps/api/src/modules/listing-activation/listing-activation.service.ts) (41 líneas, 2 métodos):

- `reindexListing(slug, listingId, opts)` [:21-31](apps/api/src/modules/listing-activation/listing-activation.service.ts#L21-L31) — `redis.del` + encolar `index`.
- `listingBecameActive(slug, listingId)` [:38-40](apps/api/src/modules/listing-activation/listing-activation.service.ts#L38-L40) — llama al anterior con `triggerAlertMatch: true`.

**Dependencias:** `RedisService` + la cola `QUEUE_INDEXING`. Nada más
([listing-activation.module.ts](apps/api/src/modules/listing-activation/listing-activation.module.ts) — 11 líneas).

**Por qué NO puede ser la puerta, verificado:**

1. **Es posterior por construcción.** Corre *después* del `prisma.listing.update`. Para validar
   tendría que correr antes, y entonces no tendría el `slug` actualizado ni el registro escrito.
2. **No tiene acceso a nada para validar.** No inyecta `PrismaService`. Convertirlo en la puerta
   significa inyectarle Prisma + `EntitlementService` + el resolver de categorías — deja de ser el
   servicio-de-efectos-mecánicos que es y se convierte en otra cosa.
3. **Su comentario miente por omisión.** Dice *"Called by every path that transitions a Listing to
   ACTIVE"* [:34-37](apps/api/src/modules/listing-activation/listing-activation.service.ts#L33-L37),
   y el mapa ya verificó que **3 caminos no lo llaman** (`closeDeal`, `undoDeal`,
   `changeListingStatus`). Es exactamente el mismo fallo que tendría la puerta si se construye por
   convención en vez de por estructura.

**Pero es el molde correcto, y eso es lo valioso:** es un módulo minúsculo, sin ciclos, importado
por `ListingsModule` **y** por `ModerationModule` — es decir, **el patrón de "un servicio
compartido por los módulos que tocan el ciclo de vida del anuncio" ya está probado en este repo**.
La puerta debe ser su hermano previo, no su reemplazo.

**Forma recomendada:** `ListingValidationModule` / `ListingGateService`, hermano de
`ListingActivationModule`. Y el par natural queda simétrico y legible:

```
  assertCanBecomeActive(...)   ← puerta, ANTES del update
  prisma.listing.update(...)
  listingBecameActive(...)     ← efectos, DESPUÉS del update
```

## 2.2 ¿Guard o interceptor de NestJS? — NO

Descartado, con tres razones verificadas contra el repo:

1. **Los guards del repo son de autorización, no de dominio.** Los tres que existen
   ([common/guards/](apps/api/src/common/guards/)) son `JwtAuthGuard`, `OptionalJwtAuthGuard`,
   `RolesGuard`. Ni uno solo toca reglas de negocio.
2. **Un guard no ve el estado del recurso.** Recibe el request. Para saber si un anuncio puede
   activarse hace falta cargarlo, cargar su categoría, contar los activos del vendedor — el guard
   duplicaría consultas que el servicio hace justo después.
3. **No cubre los caminos sin HTTP.** El cron de `BumpScheduleService` y el downgrade de Pro no
   pasan por ningún controller. Un guard dejaría un agujero por construcción — el mismo error.

**Y contradice la regla de arquitectura del proyecto:** *"NestJS es la única fuente de verdad de
la lógica de negocio"* + *"Validación de entrada siempre vía DTOs"* (CLAUDE.md). El DTO valida la
forma; **la validez de un anuncio es dominio y va en el servicio**.

## 2.3 Dónde vive — y el riesgo de ciclo de módulos (verificado)

**El grafo actual:**

```
ListingsModule ──► BillingModule ──► CampaignsModule
      │                 └─ exporta: BillingService, EntitlementService
      ├──► ModerationModule ──► AuditLogModule, ListingActivationModule, NotificationsModule
      ├──► ListingActivationModule   (BullMQ indexing)
      └──► MessagingModule, NotificationsModule, ReviewsModule, TagsModule

AdminModule ──► MeilisearchModule, AuditLogModule, SearchModule   (NO importa ListingActivationModule)
ExpirationModule ──► (solo BullMQ)
```

**Lo importante: `BillingModule` NO importa `ListingsModule`.** La dirección es
`Listings → Billing`, documentada expresamente ([listings.service.ts:31-34](apps/api/src/modules/listings/listings.service.ts#L31-L34)).

**Consecuencia para la puerta:**

- La cuota de activos necesita `EntitlementService.isProActive` → la puerta importa `BillingModule`.
- `ListingsModule`, `ModerationModule` y `AdminModule` importarían la puerta. **Sin ciclo.** ✅
- **PERO** si la puerta se llama también desde `BillingService.bump`/`featured` (§1.3), entonces
  `BillingModule → GateModule → BillingModule`. **CICLO.** 🔴

**Implicación de diseño-preliminar:** o bump/featured quedan fuera de la puerta en la primera
versión, o la cuota se resuelve sin `EntitlementService` (p. ej. la puerta recibe `isPro` como
dato de entrada en vez de resolverlo), o se acepta un `forwardRef` (que el repo **no usa hoy en
ningún sitio** — verificado). **Es una decisión de diseño real, no un detalle de implementación**,
y conviene tomarla antes de escribir la primera línea.

**Ubicación alternativa descartada:** un método privado en `ListingsService`. Es lo que hay hoy
con `checkActiveListingLimit` ([:1511](apps/api/src/modules/listings/listings.service.ts#L1511)),
y es **exactamente la causa** de que `ModerationService` y `AdminService` no puedan usarla: es
`private` de una clase de otro módulo. Repetir esa forma reproduce el bug.

## 2.4 Qué valida — la forma extensible

Ernest quiere enchufar al menos seis reglas (cuota de activos, cuota total, atributos vs schema,
correo verificado, fotos, moderación), y más adelante otras. La forma tiene que admitir reglas
nuevas **sin tocar los 8 puntos de llamada**.

### El idioma actual del repo, y su tensión con lo que hace falta

El repositorio valida con **`assert*` privados y secuenciales que lanzan al primer fallo**. El
ejemplo más desarrollado es `updateCategory`, que encadena 7
([admin.service.ts:979-1035](apps/api/src/modules/admin/admin.service.ts#L979-L1035)):
`validateCardAttributeLimit` → `validateWideCardAttributeLimit` →
`assertCardAttributeChangeDoesNotBreakChildren` → `assertNoRangeSuffixCollision` →
`assertPolicyConsistentWithParent` → `assertPolicyChangeDoesNotBreakChildren` →
`validateViewsConfig` → `assertPriceUnitsChangeDoesNotBreakListings`.

**La tensión, dicha claramente:** ese idioma da **un motivo por petición** (el primero que falla).
Ernest quiere **notificar por pantalla al usuario todo lo que le falta** — «te faltan 2 atributos,
no tienes el correo verificado y estás en el límite» — que es **una lista de motivos**. Son
contratos distintos y hay que elegir a conciencia.

### Tres formas viables, en orden de coste creciente

**Forma 1 — Cadena de `assert*` (el idioma actual).**
Coste mínimo, cero conceptos nuevos, se lee igual que `updateCategory`. Añadir una regla = añadir
un método y una línea. **Limitación: un solo motivo.** Y las reglas caras (contar activos, cargar
la categoría) se ejecutan en orden fijo aunque no hagan falta.

**Forma 2 — Lista de reglas componibles, con recolección de motivos.**

```
interface ListingRule {
  code: string;                       // 'ACTIVE_LIMIT_REACHED', 'EMAIL_NOT_VERIFIED'…
  appliesTo(ctx): boolean;            // ¿esta regla aplica a esta transición/actor?
  check(ctx): Promise<Violation|null>;
}
```

La puerta ejecuta las que aplican, **recoge todas las violaciones** y lanza una con la lista.
Permite el «avisar sin bloquear» (§4.5) con solo un flag por regla, y permite que staff y vendedor
tengan conjuntos distintos (§4.3) con `appliesTo`. **Es la forma que las features de Ernest piden.**
Coste: un concepto nuevo que el repo no tiene, y hay que resistir la tentación de sobre-abstraerlo.

**Forma 3 — Registro dinámico de reglas (DI, `@Injectable` + token multi-provider).**
Máxima extensibilidad; **desproporcionada** para 6 reglas conocidas y sin cierre de plugins. No
recomendada, pero se deja registrada para que la decisión sea explícita.

### El CONTEXTO que la puerta necesita (esto acota el coste real)

Sea cual sea la forma, la puerta necesita como entrada:

| Dato | De dónde sale | Coste |
|---|---|---|
| El anuncio (con `attributes`, `categoryId`, `sellerId`, `status`, imágenes) | 1 `findUnique` — **los 8 caminos ya lo cargan** | **0 extra** si se le pasa el que ya tienen |
| El schema efectivo de su categoría | `resolveEffectiveSchema` + 1 consulta con `parent` | 1 consulta (o 0, si viene de la caché del resolver) |
| ¿Es Pro? | `EntitlementService.isProActive` | 1 consulta — **ya se hace** en la ruta de cuota |
| Nº de activos del vendedor | `count` | 1 consulta — **ya se hace** |
| Los Settings aplicables | `setting.findUnique` por clave | 1 por clave, **sin caché** (mapa §4.2) |
| Quién actúa (vendedor/staff) y qué transición es | Del llamante | 0 |

**Coste incremental honesto:** la puerta en su forma mínima **no añade consultas** a `publish`/
`renew`/`reactivate` (ya las hacen todas). Añade ~2-3 consultas a los caminos de staff, que hoy
hacen 1. Y si se activa la revalidación de atributos (§4.2), suma la carga de la categoría, que en
`publish` **ya no se hace hoy** (solo se hace en `create`/`update`).

## 2.5 El contrato de fallo

**Lo que hay hoy, verificado.** El repo tiene una convención establecida de error accionable:
`throw new BadRequestException({ message, code })`. Hay ~15 códigos en uso: `ALREADY_FEATURED`,
`QUOTA_UNAVAILABLE`, `BUMP_AUTO_DISABLED`, `COUPON_EXHAUSTED`, `SLUG_IMMUTABLE`…

**Y el cliente ya lo lee**: `apiFetch` extrae `body.code` a `ApiError.code`
([client.ts:150-158](apps/web/src/lib/api/client.ts#L150-L158)), y hay helpers que ramifican por
código para mostrar un mensaje de dominio y una acción de recuperación
([client.ts:52-57, 96-97, 108-113](apps/web/src/lib/api/client.ts#L52-L57)).

**El hueco, verificado:** `ApiError` transporta **un** `code` (`string`), no una lista.
`body.reasons` se descartaría silenciosamente. **Una puerta multi-motivo obliga a tocar
`client.ts`** — pequeño, pero es trabajo de frontend que hay que contar.

**Decisiones del contrato (para §4, no se resuelven aquí):**

- **Código HTTP.** Hoy conviven tres criterios: `403 Forbidden` para la cuota
  ([:1524](apps/api/src/modules/listings/listings.service.ts#L1524)), `422 Unprocessable` para
  atributos ([:1335](apps/api/src/modules/listings/listings.service.ts#L1335)), `400 Bad Request`
  para estado de origen ([:455](apps/api/src/modules/listings/listings.service.ts#L455)). La puerta
  puede unificar o preservar cada uno. **Preservar los actuales es lo que no rompe nada** (§4.5).
- **Qué pasa con el anuncio al rechazar.** Tres opciones: (a) **no transiciona, se queda como
  estaba** — coherente con todo lo existente hoy; (b) pasa a `DRAFT` — precedente real en
  `downgradeExpiredPro` ([:172-175](apps/api/src/modules/expiration/entitlement-expiration.service.ts#L172-L175)),
  pero destructivo si el usuario solo quería reactivar; (c) pasa a `PENDING_REVIEW`. **(a) es el
  único que no puede romper nada**; (b) y (c) tienen sentido para la invalidación por barrido, no
  para el rechazo en línea.
- **Forma del payload.** Mínima que cubre lo que Ernest pide:
  `{ message, code: 'LISTING_NOT_VALID', reasons: [{ code, message, field? }] }` — `message` sigue
  sirviendo al cliente actual sin cambios, `reasons` es aditivo.

## 2.6 Idempotencia y transacciones

- **Idempotente por naturaleza:** la puerta solo lee y decide. No escribe.
- **⚠ Salvo la cuota, que es una condición de carrera.** `checkActiveListingLimit` hace
  `count` **fuera de transacción** y luego el `update` va aparte
  ([:1519-1527](apps/api/src/modules/listings/listings.service.ts#L1519-L1527)): dos `publish`
  concurrentes pueden leer ambos «4 de 5» y activar los dos. **Ya pasa hoy**, la puerta lo
  hereda tal cual. El repo **ya resolvió este patrón** en `bump`, con un `UPDATE` condicional que
  *reclama el turno* dentro de la transacción y cuenta filas afectadas
  ([billing.service.ts:616-663](apps/api/src/modules/billing/billing.service.ts#L616-L663), con
  una justificación de 30 líneas sobre READ COMMITTED). **Existe molde si se quiere cerrar.**
- **`undoDeal` valida dentro de `$transaction`** ([:753-759](apps/api/src/modules/listings/listings.service.ts#L753-L759)):
  o la puerta corre antes de abrirla, o debe aceptar un `Prisma.TransactionClient` opcional —
  patrón que el repo ya usa (`grantFeaturedListingTx`, `assertFeaturable`).

## 2.7 ✅ CONFIRMADO: la puerta valida en la ESCRITURA, no en la LECTURA

**Esta es la preocupación de rendimiento de Ernest, y se confirma contra el código, no por suposición.**

| Ruta de lectura | Qué toca | ¿La tocaría la puerta? |
|---|---|---|
| `GET /search` y `/[categoria]` | **`SearchService` NO tiene una sola llamada a `this.prisma`** — verificado por grep sobre el fichero entero. Sirve desde Meilisearch | **NO** |
| Excepción ya conocida | El patrocinado en página 1 con categoría consulta Postgres vía `SponsoredAdsService` ([search.controller.ts:161-168](apps/api/src/modules/search/search.controller.ts#L161-L168)), mitigado con caché Redis. Ya documentado en CLAUDE.md | **NO** — la puerta no interviene |
| Ficha `/anuncio/[slug]` | Redis 5 min, o Postgres con `status !== 'ACTIVE' → 404` ([listings.service.ts:854-856](apps/api/src/modules/listings/listings.service.ts#L854-L856)) | **NO** |
| Listados de fallback (Meili caído) | `findByCategory` — Postgres, `where status: 'ACTIVE'` | **NO** |

**La razón estructural de que esto se sostenga:** el índice **solo contiene ACTIVE, por
construcción**. `SearchService.indexListing` hace `if (listing.status !== 'ACTIVE') { removeListing(); return; }`
([search.service.ts:349-353](apps/api/src/modules/search/search.service.ts#L349-L353)). **No existe
el estado "está en el índice pero es inválido"**: o un anuncio es ACTIVE y está indexado, o no lo
está. Por tanto la búsqueda **nunca necesita preguntar si un resultado es válido** — si aparece,
es porque alguna escritura decidió que lo era.

**Conclusión: poner la puerta en las transiciones añade coste EXCLUSIVAMENTE a las escrituras**
(8 caminos, todos acciones puntuales de un usuario o de staff), **y cero a las lecturas**, que son
la ruta caliente de un proyecto read-heavy. Esto **no depende de cómo se diseñe la puerta**; se
sostiene siempre que la puerta se llame antes del `update` y nunca desde el camino de lectura.

**El corolario que sí importa (y lleva a §4.1):** como el índice solo tiene ACTIVE, **la única
forma de que un anuncio inválido salga de la búsqueda es sacarlo de ACTIVE**. No hay término
medio. Eso convierte «invalidación inmediata» en «cambiar el estado de anuncios activos en masa»,
que es una operación con consecuencias visibles para el vendedor — no un detalle técnico.

---

# BLOQUE 3 — ¿El bug activo (A) es una ráfaga independiente?

## 3.1 La respuesta corta

**Sí, y conviene que lo sea.** (A) se arregla hoy con el código que ya existe, sin construir nada
nuevo, y **no sale gratis con (B)**: (B) es un refactor grande y (A) es un fallo en producción de
una regla monetizada. Encadenarlos significa que el bug espera al refactor.

## 3.2 Por qué NO sale gratis con (B)

| | Con la puerta (B) | Sin ella, hoy (A) |
|---|---|---|
| Los 3 caminos de cuota (`approveListing`, `restoreListing`, `undoDeal`) | Se arreglan al llamar a la puerta | Se arreglan **haciendo pública `checkActiveListingLimit`** y llamándola. `ModerationModule` ya importa un servicio compartido de `ListingsModule`-adyacente ([moderation.module.ts:25](apps/api/src/modules/moderation/moderation.module.ts#L25)) — el precedente existe |
| `changeListingStatus` sin máquina de estados | **NO lo arregla.** La puerta valida *si un anuncio puede estar activo*, no *si `SOLD → DRAFT` es legal*. Son dos preguntas distintas | Se arregla con una **tabla de transiciones permitidas** — trabajo independiente en cualquier orden |
| Ambos | Llegan cuando llegue el refactor | Llegan ya |

**Punto clave que separa los dos problemas:** la máquina de estados y la puerta **responden a
preguntas diferentes**. «¿Es legal ir de X a Y?» es topología del ciclo de vida y no necesita
saber nada del contenido del anuncio. «¿Merece este anuncio estar activo?» necesita categoría,
atributos, cuota y ajustes. **Meterlas en el mismo componente las acopla sin ganancia.**

## 3.3 Contenido propuesto de la ráfaga (A) — pequeña y acotada

1. **Cerrar los 3 caminos de cuota.** `checkActiveListingLimit` deja de ser `private` (o se extrae
   a un servicio mínimo) y la llaman `approveListing`, `restoreListing`, `undoDeal`.
   ⚠ **Con una decisión previa, no automática:** ¿debe la cuota frenar a un **moderador** que
   aprueba? Ver §4.3. Es perfectamente defendible que staff la salte a propósito — pero hoy no hay
   ni un comentario que diga que sea deliberado, y eso es lo que hay que cerrar.
2. **Máquina de estados en `changeListingStatus`.** Una tabla de transiciones permitidas + 400 con
   motivo. Hoy `@IsEnum(ListingStatus)` acepta cualquier valor
   ([change-listing-status.dto.ts:5-6](apps/api/src/modules/admin/dto/change-listing-status.dto.ts#L5-L6)),
   así que un moderador puede llevar un `ARCHIVED` (**irreversible por diseño**,
   [schema.prisma:67-71](apps/api/prisma/schema.prisma#L67-L71)) de vuelta a `ACTIVE` — con lo que
   la irreversibilidad no lo es.
3. **Decidir sobre el 5.º camino latente** (`closeDeal` de servicio, `RESERVED → ACTIVE`, §1.5.2).
4. **Opcional, mismo espíritu:** `undoDeal` y `changeListingStatus` no llaman a
   `listingBecameActive`, así que **no disparan el matching de alertas**. Es una incoherencia de la
   misma familia (un camino que se salta el hook común) y cabe en la misma ráfaga.

**Sin dependencias con la profundidad, ni con la política de atributos, ni con los ajustes nuevos.**

## 3.4 Riesgo de (A) — bajo, pero no nulo

- Cerrar la cuota en `approveListing` **puede bloquear a un moderador**: si el vendedor llenó su
  cupo mientras el anuncio estaba en revisión, el moderador ya no lo puede aprobar. **Es
  exactamente el tipo de flujo que (A) podría romper** → por eso §4.3 es una decisión, no un
  arreglo mecánico.
- La máquina de estados **puede romper un uso operativo real** del backoffice que hoy dependa de
  forzar estados. Mitigación barata: derivar las transiciones permitidas del `AuditLog`
  (`LISTING_STATUS_CHANGE` guarda `before`/`after`, [admin.service.ts:291-299](apps/api/src/modules/admin/admin.service.ts#L291-L299))
  y ver qué saltos se han usado de verdad **antes** de prohibirlos.

## 3.5 El caso «`required` deja los anuncios ineditables» — NO es de la puerta

El mapa (Bloque 3) lo registró: marcar `required` un atributo nuevo deja los anuncios activos
intactos, pero **cualquier `update` posterior falla**, porque `validateRequired` corre sobre el bag
completo ([listings.service.ts:312](apps/api/src/modules/listings/listings.service.ts#L312)) mientras
el resto se acota al delta.

**No lo maneja la puerta**, y conviene decirlo alto:

- Ocurre en `update()`, no en una transición de estado. La puerta no está en ese camino.
- Es una consecuencia **deliberada** del diseño de grandfathering
  ([:310-316](apps/api/src/modules/listings/listings.service.ts#L310-L316)): `required` es un
  invariante de completitud a propósito.
- Es una decisión de **política de atributos** (proyecto posterior): ¿qué pasa con los anuncios
  vivos cuando su categoría cambia de requisitos?

**Pero sí es la señal de aviso para (B):** si la puerta empieza a exigir `required` en cada
transición, este mismo efecto se extiende de «no puedes editar» a «no puedes reactivar ni
renovar». Es el riesgo del §4.5 en concreto.

## 3.6 Recomendación de secuencia

**(A) primero, aparte y pronto.** Es pequeño, cierra un fallo real, y produce un subproducto que
(B) necesita: **la decisión staff-vs-vendedor (§4.3) tomada y escrita**, que es justo la que
bloquearía el diseño de la puerta.

**(A) también es independiente de la profundidad** — no comparte ni un fichero con el trabajo de
2→4 niveles. Puede ir en paralelo o intercalado sin coste.

---

# BLOQUE 4 — Decisiones y riesgos

> Se proponen con opciones y con su efecto verificado. **No se resuelven aquí.**

## D1 — Invalidación inmediata vs diferida

**Contexto verificado (§2.7):** el índice solo contiene ACTIVE. **No existe «indexado pero
inválido»**. Por tanto invalidar de verdad = sacar de ACTIVE.

| | **Inmediata** | **Diferida** (la que sugirió Ernest) |
|---|---|---|
| Qué pasa al cambiar la config | Un barrido busca los activos que dejan de cumplir y los saca de ACTIVE (`DRAFT`/`PENDING_REVIEW`) + reindexa | Nada. El anuncio sigue activo y visible. La puerta lo frena **la próxima vez que el dueño lo toque** |
| Efecto en la búsqueda | Desaparece al momento. Coherencia máxima | Sigue apareciendo aunque no cumpla. **Puede durar meses** (nadie obliga a tocar un anuncio) |
| Coste | Un barrido por cambio de categoría + N reindexados. **En una categoría grande es una operación masiva** | **Cero** |
| Riesgo | **Alto**: un admin que renombra un atributo desactiva anuncios ajenos sin quererlo. Necesita previsualización y probablemente confirmación | Bajo |
| Precedente en el repo | ✅ `downgradeExpiredPro` hace exactamente esto (ACTIVE → DRAFT en masa, con logging y reindexado) [:143-193](apps/api/src/modules/expiration/entitlement-expiration.service.ts#L143-L193) | ✅ El grandfathering de `update()` es diferido puro |
| Aviso al vendedor | Hay molde: `ModerationNotificationsService` avisa in-app + email al desactivar | Se avisa cuando falla su acción |

**Opción intermedia no considerada aún y que merece estar sobre la mesa:** **marcar sin
desactivar** — un campo `needsRevalidation` que no toca el estado ni el índice, alimenta un aviso
en «Mis anuncios» y hace que la puerta sea estricta con ese anuncio. Coste bajo, sin desapariciones
sorpresa, y da al vendedor la oportunidad de arreglarlo. Requiere una columna nueva.

**Lo que sí está claro:** con «inmediata» hace falta **previsualización de impacto** (cuántos
anuncios y de quién) antes de guardar el cambio de categoría. El molde existe:
`assertPolicyChangeDoesNotBreakChildren` ya cuenta los afectados y devuelve el número
([admin.service.ts:787-793](apps/api/src/modules/admin/admin.service.ts#L787-L793)).

## D2 — ¿La puerta revalida atributos en cada transición?

| | **Solo reglas nuevas** (cuota, correo, fotos, moderación) | **También atributos vs schema** |
|---|---|---|
| Cierra el «publica→pausa→reactiva sin revalidar» | ❌ No | ✅ Sí |
| Coste por transición | 0 consultas extra (§2.4) | +1 consulta de categoría **en `publish`, que hoy no la hace** |
| Riesgo de atrapar anuncios viejos | Bajo | **ALTO** — ver §4.5 |
| Consistencia con `update()` | — | ⚠️ `update()` es **deliberadamente** permisivo (grandfathering por delta). Una puerta estricta crearía **dos criterios distintos de "válido"** en el mismo sistema: podrías editar el anuncio pero no reactivarlo |

**Opción intermedia:** revalidar **solo `required`** (el invariante de completitud, el mismo que
`update()` ya exige sobre el bag completo) y no las opciones/tipos. Alinea la puerta con el
criterio que `update()` ya aplica, sin inventar un tercero.

**Segunda dimensión de la misma decisión:** ¿revalidar en **todas** las transiciones o solo en las
que **reintroducen** el anuncio al mercado (`publish`, `renew`, `reactivate`, `approve`, `restore`)
y no en las que solo lo mantienen (`bump`, `featured`)? Frenar un bump cobrado por un atributo
obsoleto es una experiencia muy distinta a frenar una reactivación.

## D3 — Staff vs vendedor

**Hoy el sistema ya distingue de facto** (verificado): staff nunca pasa por la cuota — en
`approveListing`, `restoreListing` ni `changeListingStatus`. Pero **no hay ni un comentario que
diga que sea deliberado**. Puede ser una decisión implícita o un olvido; el código no lo dice.

| Opción | Efecto |
|---|---|
| **Mismas reglas para todos** | Un moderador no puede aprobar si el vendedor llenó su cupo mientras esperaba revisión. Coherente, pero convierte al staff en rehén de la cuota del vendedor |
| **Staff exento de las reglas de negocio** (cuota, correo), sujeto a las de integridad (máquina de estados, atributos) | Refleja lo que ya ocurre. **Requiere escribirlo como decisión**, no dejarlo implícito |
| **Staff avisado pero no bloqueado** | Sale del `appliesTo`/modo-aviso de la Forma 2 (§2.4). Deja rastro en el audit log sin frenar la operación |

**Nota de alcance:** `changeListingStatus` está abierto a `MODERATOR` **y** `ADMIN`
([admin.controller.ts:63](apps/api/src/modules/admin/admin.controller.ts#L63)), mientras el resto
de `AdminController` es solo `ADMIN`. Si se decide que el escape hatch total es privilegio de
`ADMIN`, ese cambio de rol es parte de la misma decisión.

## D4 — El grandfathering: ¿a quién aplican las reglas nuevas?

| Opción | Efecto | Precedente en el repo |
|---|---|---|
| **A todos, siempre** | Máxima coherencia, **máximo riesgo de romper** | — |
| **Solo a anuncios creados después** de la regla | Cero rotura. Pero convive con anuncios de dos épocas para siempre, y `createdAt` como criterio es frágil | — |
| **Solo cuando el usuario TOCA lo relacionado** (delta) | **Es exactamente el criterio que `update()` ya usa** y que está razonado en el código | ✅ [listings.service.ts:310-376](apps/api/src/modules/listings/listings.service.ts#L310-L376) |
| **Por regla**, cada una decide | Más flexible, más superficie de decisión | ✅ Cada `assert*` de `updateCategory` ya elige su propio disparador |

**Observación:** la tercera opción es la que menos concepto nuevo introduce, porque **el sistema ya
razona así**. Y encaja con la invalidación diferida (D1): la puerta es estricta con lo que el
usuario cambia y tolerante con lo que arrastra.

## D5 — RIESGO CENTRAL: romper flujos que hoy funcionan

**El escenario concreto, no hipotético.** Un vendedor publicó en marzo. En junio un admin marcó
`required` un atributo nuevo de esa categoría. Hoy: el anuncio sigue activo, se puede pausar y
reactivar sin problema (nadie revalida), y solo falla si intenta editarlo (mapa, Bloque 3). Con una
puerta estricta: **al reactivarlo, ya no puede.** Su anuncio se queda pausado y él no entiende por
qué. Y no es un caso raro — es **el caso normal** en cuanto una categoría evolucione.

**El mismo patrón se repite con cada regla nueva:** correo verificado (miles de cuentas antiguas
sin verificar), fotos mínimas (anuncios sin foto ya publicados), cuota total (usuarios que ya la
superan).

### Mitigaciones concretas, en orden de eficacia

**M1 — Modo «avisar pero no bloquear» primero.** La puerta corre, registra las violaciones y
**deja pasar**. Se recolectan datos reales durante semanas antes de bloquear nada.
✅ **El repo ya tiene este patrón**: `BadWordService` declara un contrato fail-open explícito —
*"Moderation must never block the publish flow"*
([bad-word.service.ts:6-9](apps/api/src/modules/moderation/bad-word.service.ts#L6-L9)) — y
`FilterableAttributesResolver` degrada con un `Logger.warn` en vez de fallar
([filterable-attributes.resolver.ts:176-179](apps/api/src/modules/search/filterable-attributes.resolver.ts#L176-L179)).
**Es la mitigación más barata y la de mayor rendimiento informativo.**

**M2 — Medir antes de activar cada regla.** Antes de que una regla bloquee, una consulta responde
«¿a cuántos anuncios activos afectaría?». Con `getAttributeUsage` ya hay molde de conteo sobre
`attributes` con el operador jsonb `?` ([admin.service.ts:1118-1123](apps/api/src/modules/admin/admin.service.ts#L1118-L1123)).
**Si la respuesta es "8.000", la decisión cambia.** Sin este número, se está diseñando a ciegas.

**M3 — Un interruptor por regla, en `Setting`.** Cada regla nueva nace apagada y se enciende
cuando se ha medido.
✅ **Molde probado**: `videoEnabled` nace apagado a propósito porque cuesta dinero desde el primero
([video-limits.ts:46](apps/api/src/modules/video/video-limits.ts#L46), razonado en
[admin.service.ts:95-99](apps/api/src/modules/admin/admin.service.ts#L95-L99)), y `bumpAutoEnabled`
es un interruptor de emergencia para una feature desatendida
([admin.service.ts:87-92](apps/api/src/modules/admin/admin.service.ts#L87-L92)).
⚠️ **Aviso del mapa:** hay dos ajustes muertos (`listingExpiryDays`, `contactRequiresVerification`)
— declarados y editables, con cero lectores. Un interruptor sin lector es peor que no tenerlo.

**M4 — Grandfathering por delta** (D4, opción 3). El criterio que el sistema ya usa.

**M5 — Preservar los códigos HTTP y los mensajes actuales.** La cuota devuelve hoy `403` con un
texto concreto. Si la puerta lo convierte en `422` con otro texto, **rompe el frontend en
silencio** — el cliente ramifica por `statusCode` **y** por `code`
([client.ts:52-57](apps/web/src/lib/api/client.ts#L52-L57)). El contrato de error es una API
pública de facto.

**M6 — Un camino de salida para el atrapado.** Si un anuncio no puede reactivarse, el vendedor
tiene que poder **arreglarlo**: el motivo debe decir qué falta y llevarle al editor. Esto es
precisamente el «notificar por pantalla» de Ernest, y es lo que convierte el bloqueo en una tarea
en vez de en un muro. **Sin M6, ninguna de las otras mitigaciones basta.**

## D6 — ✅ Efecto en las búsquedas: confirmado, ninguno

Ya verificado en §2.7 contra el código, no supuesto:

- `SearchService` **no tiene ni una llamada a `this.prisma`**.
- El índice **solo contiene ACTIVE por construcción** ([search.service.ts:349-353](apps/api/src/modules/search/search.service.ts#L349-L353)).
- Las 4 rutas de lectura (búsqueda, categoría, ficha, fallback Postgres) **no invocarían la puerta
  en ningún diseño de los evaluados**.

**La puerta es coste de escritura puro.** La única forma de que afectara a la lectura sería
diseñarla como filtro sobre los resultados — y **eso está descartado explícitamente aquí**, porque
sería tanto un problema de rendimiento como una segunda fuente de verdad sobre qué anuncios son
visibles.

**El coste que sí hay que vigilar, y no es el de la puerta:** si se elige invalidación inmediata
(D1), el **barrido** de una categoría grande genera N reindexados. Eso sí toca Meilisearch — pero
es trabajo de cola en segundo plano ([`QUEUE_INDEXING`](apps/api/src/infra/queue/queue.constants.ts)),
no de la ruta de lectura. Es exactamente el patrón que `downgradeExpiredPro` ya ejecuta a diario.

---

# Resumen ejecutivo

**Viabilidad: alta.** No hay ningún obstáculo estructural. El repo ya tiene todas las piezas del
molde: un módulo hermano compartido entre `Listings` y `Moderation` (`ListingActivationModule`),
una convención de error accionable con `code` que el cliente ya lee, interruptores de feature en
`Setting`, y precedentes de fail-open y de barrido masivo.

**Cuatro cosas que decidir antes de escribir código:**

1. **Ciclo de módulos** (§2.3): si la puerta cubre `bump`/`featured`, hay ciclo con `BillingModule`.
   Resolver por diseño, no con `forwardRef` (el repo no usa ninguno hoy).
2. **Un motivo o varios** (§2.4-2.5): el idioma actual del repo da uno; Ernest pide varios. La
   segunda opción implica tocar `client.ts` en el frontend.
3. **Staff vs vendedor** (D3): hoy staff está exento **de facto y sin declararlo**. Escribirlo.
4. **Estricta o tolerante con lo preexistente** (D2, D4, D5): es la que decide si la puerta rompe
   flujos o no.

**Sobre el orden respecto a la profundidad:**

- **(A) el bug activo es independiente de todo** — no comparte fichero con el trabajo de 2→4
  niveles ni con la puerta. Es pequeño, cierra un fallo real de una regla monetizada, y su
  subproducto (la decisión staff-vs-vendedor escrita) es justo lo que desbloquea el diseño de (B).
  **Puede ir ya, en paralelo a lo que sea.**
- **(B) la puerta y la profundidad se tocan en un punto**: si la herencia pasa a 4 niveles,
  `resolveEffectiveSchema` cambia de forma — y si la puerta revalida atributos (D2), la llama. El
  orden que evita rehacer trabajo es **profundidad primero, puerta después**; el inverso obliga a
  tocar la puerta cuando cambie la herencia. Si la puerta **no** revalida atributos (D2, opción 1),
  las dos son independientes y el orden da igual.

**El riesgo central, con nombre:** la puerta puede dejar atrapados anuncios que hoy funcionan. La
mitigación de mayor rendimiento por su coste es **M1 (modo avisar-no-bloquear) + M2 (medir cuántos
anuncios afectaría cada regla antes de encenderla)**. Sin ese número, cualquier decisión de D2, D4
y D5 se toma a ciegas.
