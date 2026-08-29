# Auditoría del sistema de notificaciones

> **Documento de diagnóstico. Cero código.** Todo lo que sigue está verificado contra
> el código a fecha 2026-08-28. Cuando una afirmación contradice una ficha previa, gana
> el código y se dice explícitamente.

---

## 0. Resumen ejecutivo — la contradicción, resuelta

La ficha decía **«solo ALERT_MATCH»**. Es **falso**. El backend crea **12 tipos de
notificación** hoy, once de ellos por el servicio tipado y uno por la puerta de atrás.

| Lo que se creía | Lo que hay |
|---|---|
| 1 tipo (`ALERT_MATCH`) | **12 tipos** |
| Sin doble canal | **8 de 12 mandan email** además de in-app |
| Moderación sin avisos | Moderación **ya avisa** de 3 cosas (denuncia, anuncio, valoración) |
| El front no pinta los tipos nuevos | **11 de 12 tienen su `case`** |

**El sistema hace mucho más de lo documentado.** Pero tiene tres defectos reales
verificados y un agujero grande de cobertura:

1. **Un tipo invisible** — `DATA_EXPORT_READY` se pinta como «Nueva notificación».
2. **Una rama muerta** — `LISTING_MODERATED` con `action: 'APPROVED'` pinta `undefined`.
3. **Un aviso que miente** — editar una valoración le dice al autor que se la han retirado.
4. **Las sanciones de cuenta no avisan a nadie** — suspender, banear y reinstaurar son
   silenciosos, y además **no tienen campo `reason`**: el motivo que Ernest quiere mostrar
   todavía no existe.
5. **La mensajería no notifica** — es tiempo real puro. Si no estás conectado, no te enteras.

Y una buena noticia para la Parte B: **el «revisado interno» ya existe** (`Listing.triage`)
y **el dashboard ya calcula con `COUNT` on-demand** en una sola `$transaction`. La Parte B
es mucho más barata de lo previsto.

---

# PARTE A — Notificaciones de usuario

## A0. El estado real: los 12 tipos que el backend crea hoy

| # | Tipo | Dónde se crea | Destinatario | Canales |
|---|---|---|---|---|
| 1 | `ALERT_MATCH` | `alerts/alert-matching.service.ts:102` | Dueño de la alerta | in-app + email |
| 2 | `CONTACT_MESSAGE` | `contact/contact.service.ts:128` | **Staff** (fan-out a cada `ADMIN`) | in-app + email por admin |
| 3 | `REVIEW_REQUEST` | `listings/listings.service.ts:929, 937` | Comprador **y** vendedor | in-app + email |
| 4 | `INVOICING_PENDING_FISCAL_DATA` | `invoicing/invoicing-schedule.service.ts:138` | Usuario facturable | **solo in-app** |
| 5 | `TICKET_MESSAGE` | `tickets/ticket-notifications.service.ts:123, 151` | Usuario | in-app + email |
| 6 | `TICKET_OPENED` | `tickets/ticket-notifications.service.ts:117` | Usuario | in-app + email |
| 7 | `TICKET_STAFF_NEW` | `tickets/ticket-notifications.service.ts:87` | **Staff** (fan-out `ADMIN`+`MODERATOR`) | in-app fan-out + **1** email al buzón de soporte |
| 8 | `REPORT_RESOLVED` | `moderation/moderation-notifications.service.ts:69` | Denunciante | **solo in-app** |
| 9 | `LISTING_MODERATED` | `moderation/moderation-notifications.service.ts:173` | Vendedor | in-app + email |
| 10 | `REVIEW_MODERATED` | `moderation/moderation-notifications.service.ts:220` | Autor de la valoración | **solo in-app** |
| 11 | `BUMP_AUTO_PAUSED` | `bump-schedule/bump-auto-notifications.service.ts:54` | Dueño del anuncio | in-app + email |
| 12 | `DATA_EXPORT_READY` | `data-export/data-export.service.ts:282` | Sujeto de la exportación | **solo in-app** |

### Dos aclaraciones sobre el inventario

**`CONTACT_MESSAGE_STATUS_CHANGE` no es un tipo de notificación.** El encargo lo
mencionaba; el código dice que es una **acción de `AuditLog`**
(`contact/contact.service.ts:205`), no una `Notification`. Nadie recibe nada cuando un
mensaje de contacto cambia de estado — ni debe, es un movimiento interno del staff.

**`DATA_EXPORT_READY` es el tipo huérfano.** Se crea con `prisma.notification.create()`
directo, saltándose `NotificationsService.createNotification()`. Consecuencia en cadena:
no está en `NotificationType`, no está en `DataByType`, no está en la unión
`NotificationItem` del front, y no tiene `case`. **Es exactamente el fallo que el
comentario de `notification-content.ts` advertía que pasaría** — y ya había pasado antes
con `INVOICING_PENDING_FISCAL_DATA`, según su propio comentario. Es la segunda
reincidencia del mismo patrón.

---

## A1 — Tabla: contenido y enlace de cada tipo

> ### ✅ ESTADO: A1 IMPLEMENTADO (rama `notificaciones-a1-defectos-causa-raiz`)
>
> Los **4 defectos** de esta sección están arreglados y sus **dos causas raíz**, cerradas.
> La tabla de abajo se conserva **como diagnóstico original**; lo que cambió:
>
> | Defecto | Estado |
> |---|---|
> | `DATA_EXPORT_READY` invisible | ✅ pasa por el servicio tipado, está en la unión, tiene `case`, enlaza a `/perfil` y dice cuándo caduca |
> | `LISTING_MODERATED` / `APPROVED` → `undefined` | ✅ el mapa es un `Record` completo de las 4 acciones |
> | `editReview` decía «hemos retirado» | ✅ `ReviewModeratedData.action` (`RETIRED`\|`EDITED`); cada una dice lo que pasó |
> | Email de `REVIEW_REQUEST` a 404 | ✅ va al deep-link de valoración, que no depende del estado del anuncio |
>
> **Causa raíz 1 — el `default` que ocultaba:** eliminado como colchón. Un tipo de
> `NotificationItem` sin `case` es **error de compilación** (`tipoNoContemplado(n: never)`),
> y los mapas por variante son `Record` exhaustivos. Verificado por mutación.
>
> **Causa raíz 2 — el `create` directo:** `DataByType` está ahora **obligado** a cubrir
> `NotificationType` (un tipo sin snapshot no compila), y
> `notifications-puerta-unica.spec.ts` falla si aparece una creación de `Notification`
> fuera del servicio.
>
> **Hallazgo nuevo, más profundo que el diagnóstico:** la causa real de `APPROVED` no era
> «un mapa con 3 claves para una unión de 4». Era que **el espejo de tipos del front
> declaraba solo 3 valores** de `action` (`apps/web/src/types/index.ts`), mientras el
> backend emitía 4. El mapa era *correcto contra un tipo equivocado* — por eso el
> compilador nunca dijo nada. El espejo se mantiene a mano y se había desalineado en
> silencio; `NotificationType` del front estaba igual, congelado en 3 valores de 12, y
> ahora se deriva de la unión.
>
> **`PrismaService` NO se pudo blindar en el tipo** (se intentó primero): `PrismaClient`
> declara `notification` como *accessor* y TypeScript rechaza redeclararlo en una subclase
> con cualquier forma de propiedad (TS2610 — probado con `declare`, con `readonly` y por
> fusión de interfaz), y un getter tampoco vale porque Prisma crea los delegates como
> propiedades **de instancia** (`super.notification` sería `undefined`). De ahí el test
> guardián: no es el compilador, pero **el olvido no se puede fusionar**.
>
> **§A1.3 — decisión: alinear, no unificar.** Los tipos que A1 toca ya dicen lo mismo en
> los dos canales (y un e2e fija que los tres campos del enlace de `REVIEW_REQUEST`
> coincidan). Unificar la *fuente* de copy queda **anotado, no hecho**: `pnpm-workspace.yaml`
> solo declara `apps/*`, así que no hay paquete compartido y crearlo es una ráfaga propia —
> y además los dos canales son legítimamente distintos de registro (el correo lleva saludo,
> cierre y «no respondas a este correo»; la campana es una línea).
>
> **Pendiente anotado para «cuenta+motivo»:** `retireReview` y `editReview` exigen `reason`
> obligatorio y **ese motivo se sigue descartando** — solo llega al `AuditLog`. Traerlo a
> `ReviewModeratedData` es el mismo patrón de `LISTING_MODERATED.reason`.

Leyenda: ✅ correcto · ⚠️ existe pero flojo · ❌ roto o ausente.

| Tipo | ¿`case` en el front? | Enlace | ¿Existe la ruta? | Veredicto |
|---|---|---|---|---|
| `ALERT_MATCH` | ✅ | `/anuncio/{slug}` | ✅ | ✅ **Correcto.** El anuncio acaba de pasar a `ACTIVE`, la ruta pública es la buena. |
| `CONTACT_MESSAGE` | ✅ | `/admin/mensajes-contacto/{id}` | ✅ | ✅ Correcto. Enlace de staff a ruta de staff. |
| `REVIEW_REQUEST` | ✅ | `/vendedor/{slug}?valorar=…&target=…` | ✅ | ⚠️ **404 si la contraparte está suspendida/archivada.** El perfil público 404 para cuentas no activas. Poco frecuente, pero es un callejón sin salida sin degradación. |
| `INVOICING_PENDING_FISCAL_DATA` | ✅ | `/perfil/facturacion` | ✅ | ✅ Correcto. Enlace a la acción exacta que se pide. |
| `TICKET_MESSAGE` | ✅ | `/mis-tickets/{id}` | ✅ | ✅ Correcto. |
| `TICKET_OPENED` | ✅ | `/mis-tickets/{id}` | ✅ | ✅ Correcto. |
| `TICKET_STAFF_NEW` | ✅ | `/admin/tickets/{id}` | ✅ | ✅ Correcto. |
| `REPORT_RESOLVED` | ✅ | `/anuncio/{slug}` o `/notificaciones` | ✅ | ⚠️ **El fallback es un bucle.** Si lo denunciado era un usuario o una valoración, el enlace lleva a `/notificaciones` — es decir, a la lista desde la que se hizo clic. No es un 404, es un no-enlace. |
| `LISTING_MODERATED` | ⚠️ **parcial** | `/mis-anuncios` | ✅ | ❌ **ROTO en `APPROVED`.** Ver abajo. |
| `REVIEW_MODERATED` | ✅ | `/notificaciones` | ✅ | ⚠️ Mismo bucle que arriba. Y el texto miente en un caso (ver abajo). |
| `BUMP_AUTO_PAUSED` | ✅ | `/mis-creditos` o `/mis-anuncios` según `reason` | ✅ | ✅ **El mejor del conjunto.** El enlace depende de la salida que se ofrece. Es el molde a imitar. |
| `DATA_EXPORT_READY` | ❌ **no existe** | — | — | ❌ **Cae al genérico:** «Nueva notificación» → `/notificaciones`. |

### A1.1 — `LISTING_MODERATED` con `APPROVED` pinta `undefined` (defecto confirmado)

- `moderation.service.ts:346` llama a `listingModerated(listing, 'APPROVED', actorId)`.
- `ListingModeratedData.action` incluye `'APPROVED'` (`notification.types.ts:126`).
- El **email sí tiene copy para `APPROVED`** (`notification.processor.ts:240`), y su
  comentario explica que se añadió justamente en M2 porque el silencio tras aprobar era
  el problema.
- Pero el mapa del front (`notification-content.ts:64-68`) tiene **solo tres claves**:
  `REJECTED`, `DEACTIVATED`, `RESTORED`.

**Resultado:** `{...}['APPROVED']` es `undefined`. La notificación in-app de «tu anuncio
ha sido aprobado» se pinta vacía. El usuario recibe el email correcto y una entrada en
blanco en la campana. Es un objeto literal indexado por una unión de 4 valores con solo 3
claves — TypeScript no lo detecta porque el índice devuelve el tipo del valor sin
comprobar exhaustividad.

**Es el mismo defecto de clase que `DATA_EXPORT_READY`**, un nivel más abajo: allí falta
el `case` del tipo, aquí falta la rama de una variante dentro del `case`.

### A1.2 — El enlace del email de `REVIEW_REQUEST` está roto para productos

El aviso in-app lleva a `/vendedor/{slug}?valorar=…` (bien). Pero el **email** lleva a
`/anuncio/{listingSlug}` (`notification.processor.ts:279`).

`closeDeal` pone el anuncio en **`SOLD`** cuando es un producto
(`listings.service.ts:962`), y la ficha pública **404 para todo lo que no esté `ACTIVE`**
— así está documentado por escrito en la cabecera de `lib/admin-links.ts`.

**El email de «valora tu trato» lleva a un 404 en todos los tratos de producto**, que son
la mayoría. Es exactamente el defecto que `admin-links.ts` se creó para erradicar,
sobrevivido en el lado del correo porque el helper vive en el front y el processor está en
el back.

### A1.3 — Divergencia in-app / email

Los dos canales redactan el mismo hecho **dos veces, en dos ficheros, en dos idiomas de
plantilla**: `notification-content.ts` (front) y `notification.processor.ts` (back). Ya
han divergido en dos sitios verificados: `APPROVED` (existe en email, no en in-app) y el
destino de `REVIEW_REQUEST` (perfil vs. anuncio). No hay ningún mecanismo que los
mantenga alineados.

---

## A2 — Alerta → notificación: **ya funciona**

**Veredicto: funciona correctamente. Solo pulido menor, no rediseño.**

Verificado en `alerts/alert-matching.service.ts`:

- **Disparo correcto.** Se invoca tras confirmar (`waitForTask`) que el anuncio es
  consultable en Meilisearch y sigue `ACTIVE`. Hay relectura defensiva por si salió de
  `ACTIVE` entre medias (`:37`).
- **Filtrado en dos fases bien resuelto.** Prefiltro SQL como sobreaproximación segura +
  confirmación con la semántica real de `search()`. No reimplementa el filtrado de
  atributos/geo en JS — la decisión correcta.
- **Deduplicación sólida.** `AlertMatch` con `@@unique([alertId, listingId])`, y se
  captura P2002 para continuar (`:96-100`). Idempotente ante reintentos de BullMQ y ante
  republicaciones del mismo anuncio.
- **Respeta el estado de cuenta.** Filtra por `CUENTA_EN_ESCAPARATE` — no se notifica a
  cuentas archivadas, eliminadas o baneadas; sí a suspendidas (la suspensión es
  reversible). La constante compartida evita la copia suelta del predicado.
- **Doble canal independiente.** In-app y email son dos envíos separados; el fallo de uno
  no bloquea el otro.
- **Contenido y enlace correctos (A1).** Snapshot autocontenido, `/anuncio/{slug}` es la
  ruta buena porque el anuncio está `ACTIVE` por construcción.

**Único pulido detectable:** el `createNotification` in-app ocurre **después** del
`alertMatch.create()`. Si el proceso muere entre ambos, el dedup ya está escrito y la
notificación nunca se creará — el aviso se pierde en silencio y no se reintenta jamás.
Es una ventana estrechísima y de baja gravedad (se pierde un aviso, no se duplica ni se
cobra nada). **Anotarlo, no arreglarlo ahora.**

---

## A3 — Inventario exhaustivo de eventos (el corazón)

Leyenda de **¿Debería?**: **SÍ** = notificar · **NO** = no molestar · **quizá** = depende
de una decisión de producto.

### A3.1 — ANUNCIOS

> ### ✅ ESTADO: N3 IMPLEMENTADO (rama `notificaciones-n3-ciclo-vida`)
>
> **El ciclo de vida del anuncio ya no es mudo.** La tabla se conserva como diagnóstico
> original; lo que cambió:
>
> | Evento | Antes | Ahora | Canal |
> |---|---|---|---|
> | Publicar → en cola | mudo | ✅ «lo hemos recibido, está en cola» | in-app |
> | **Expirar** | mudo | ✅ «no lo ha retirado nadie: caducan solos» | in-app + email |
> | **Preaviso (7 días)** | no existía | ✅ **idempotente** | in-app + email |
> | Editado por staff | motivo sólo en `AuditLog` | ✅ con su motivo | in-app + email |
> | Eliminado por staff | mudo | ✅ (sin motivo: no se captura) | in-app + email |
> | Destacado expirado | mudo | ✅ | in-app |
>
> **Un tipo con `action`, molde `LISTING_MODERATED`** — pero **tipo aparte**: aquél es «el
> equipo ha decidido algo», con su registro de moderación detrás; esto es «a tu anuncio le ha
> pasado algo», y la mitad no tiene actor humano (lo hace un cron).
>
> **N = 7 días**, constante junto a `EXPIRY_DAYS` (que tampoco es configurable). Hacer
> ajustable el aviso de algo fijo permitiría preavisar de una caducidad que aún no existe.
>
> **La idempotencia: `Listing.expiryWarnedFor` guarda EL VENCIMIENTO preavisado, no un «ya
> avisé».** Un booleano habría que limpiarlo en los **cinco** sitios que escriben `expiresAt`
> (publicar, renovar, reactivar y dos caminos de moderación), y olvidar uno deja ese anuncio
> sin preaviso para siempre, en silencio. Con la fecha, el predicado
> `expiryWarnedFor <> expiresAt` **se invalida solo**: renovar reabre el preaviso sin que
> nadie tenga que acordarse de nada. Mismo criterio que `AlertMatch`, que deduplica por el
> par y no por un flag.
>
> **El destacado no necesita marca**: la selección exige `revokedAt: null` y el `updateMany`
> los revoca antes del bucle — la idempotencia la da el modelo.
>
> **Cron hermano a las 02:30**, separado del de caducidad (02:00) por el criterio ya
> establecido: si el preaviso reventara dentro de aquél, se llevaría por delante la
> caducidad, que es lo que no puede dejar de correr.
>
> **Todos enlazan a `/mis-anuncios`, ninguno a `/anuncio/{slug}`** — la ficha pública sirve
> sólo los `ACTIVE` y aquí casi ninguno lo está. Es la lección de A1.2, aplicada por
> adelantado: el snapshot ni siquiera lleva `listingSlug`.
>
> **Correo sólo donde se pierde algo o hay algo que hacer** (§A4): expirar, preaviso, editado
> y eliminado por staff. `RECEIVED` y `FEATURED_EXPIRED` se quedan en la campana — un acuse
> por cada publicación es ruido, y un correo por cada destacado que vence se parecería a una
> oferta para volver a comprar. La unión de `SendListingLifecycleData` **excluye esas dos por
> tipo**, así que no pueden colarse por descuido.
>
> **Pendiente anotado:** `deleteListing` **no captura motivo** (su firma es
> `(listingId, actorId, ip)`), a diferencia de editar o rechazar. El aviso degrada limpio y
> apunta a soporte; capturarlo es una decisión de producto, no de esta ráfaga.

| Evento | ¿Notifica hoy? | in-app | email | ¿Debería? | ¿Motivo? |
|---|---|---|---|---|---|
| Publicar (envío a revisión) | ❌ no | — | — | **SÍ** — «lo hemos recibido, está en cola». Sin esto el silencio empieza en el minuto cero | n/a |
| **Aprobar** | ⚠️ **a medias** | ❌ pinta `undefined` | ✅ correcto | **SÍ** — ya está decidido, solo hay que arreglar el in-app | n/a |
| **Rechazar** | ✅ sí | ✅ | ✅ | **SÍ** — ya funciona | ✅ **sí, y se muestra bien** |
| **Retirar** (`DEACTIVATED`) | ✅ sí | ✅ | ✅ | **SÍ** — ya funciona | ✅ **sí, y se muestra bien** |
| **Restaurar** | ✅ sí | ✅ | ✅ | **SÍ** — ya funciona | n/a (no lleva) |
| Pausar (el dueño) | ❌ no | — | — | **NO** — lo acaba de hacer él. El toast ya lo confirma | n/a |
| Despausar (el dueño) | ❌ no | — | — | **NO** — ídem | n/a |
| Pausado **por ban** (`ListingPauseOrigin.BAN`) | ❌ no | — | — | **SÍ** — no lo hizo él. Cabe dentro del aviso de sanción de cuenta, no como aviso por anuncio | ✅ el del ban |
| Pausado por archivado voluntario | ❌ no | — | — | **NO** — efecto conocido de una acción propia | n/a |
| Marcar vendido / cerrar trato | ✅ **sí** (`REVIEW_REQUEST`) | ✅ | ✅ (enlace roto, A1.2) | **SÍ** — ya funciona, arreglar el enlace | n/a |
| Reservar | ❌ no | — | — | **NO** — acción propia del vendedor | n/a |
| **Expirar** | ❌ no | — | — | **SÍ, alto valor** — el anuncio desaparece sin que el dueño haga nada. Es el caso «desapareció y no sé por qué» | n/a |
| **Por expirar (preaviso)** | ❌ no | — | — | **quizá** — un preaviso a N días permite renovar antes de perder posición. Decidir con el plazo de expiración real | n/a |
| Renovar | ❌ no | — | — | **NO** — acción propia | n/a |
| Destacar (comprado) | ❌ no | — | — | **NO** — hay toast; es una compra confirmada en pantalla | n/a |
| **Destacado expirado** | ❌ no | — | — | **quizá** — se acabó algo que se pagó. Recomendado si el destacado es caro | n/a |
| Editar (el dueño) | ❌ no | — | — | **NO** — acción propia | n/a |
| **Editado por el staff** | ❌ no | — | — | **SÍ** — el DTO ya exige `reason` obligatorio (`update-admin-listing.dto.ts:109`) y su comentario dice literalmente que sin él «el vendedor no tendría forma de saber quién le cambió el anuncio». Hoy ese motivo **solo va al `AuditLog`** | ✅ **existe, no se muestra** |
| Eliminar (el dueño) | ❌ no | — | — | **NO** — acción propia | n/a |
| **Eliminado por el staff** (`admin.service.ts:1260`) | ❌ no | — | — | **SÍ** — es irreversible y no lo hizo él | ⚠️ comprobar si hay `reason` |
| Bump automático pausado | ✅ sí | ✅ | ✅ | **SÍ** — ya funciona, y es el mejor molde del sistema | ✅ sí, y decide el enlace |
| Bump aplicado | ❌ no | — | — | **NO** — decisión D6 ya tomada y bien argumentada: inundaría la campana | n/a |

### A3.2 — USUARIO / CUENTA — **el hueco más grave**

> ### ✅ ESTADO: N2 IMPLEMENTADO (rama `notificaciones-n2-cuenta-motivo`)
>
> **Las decisiones sobre la cuenta ya no son mudas, y el motivo se captura.** Las tablas de
> §A3.2 y §A3.3 se conservan como diagnóstico original; lo que cambió:
>
> | Evento | Antes | Ahora |
> |---|---|---|
> | Suspender | mudo, sin motivo | in-app + **email**, con motivo visible |
> | Levantar suspensión (manual **y por cron**) | mudo | in-app + email |
> | Banear | mudo, sin DTO | in-app + **email**, con motivo visible |
> | Reinstaurar | mudo | in-app + email, **diciendo que los anuncios no vuelven solos** |
> | Cambio de rol | mudo | in-app + email (avisa de la caída de sesiones) |
> | Archivar por staff | mudo | in-app + email (sólo `STAFF_ACTION`) |
> | Eliminar | mudo | **email only** — el borrado destruye las notificaciones |
> | Retirar/editar valoración | motivo **descartado** | motivo mostrado |
>
> **La migración (`20260828211109_n2_motivo_de_sancion`), aditiva y sin backfill:**
> `User.sanctionReason` (visible) y `User.sanctionNote` (interna).
>
> **Hallazgo que cambió el diseño respecto al diagnóstico.** La auditoría decía que para
> suspender el email era «el mismo razonamiento, más suave» que para el ban. **Es igual de
> fuerte:** `motivoDeBloqueoDeCuenta` rechaza a `SUSPENDED`, `BANNED` *y* `ARCHIVED` en las
> tres puertas, así que **ninguno de los tres puede abrir la campana**. Para los tres el
> correo es el único canal, y la campana es sólo constancia para cuando vuelvan.
>
> De ahí una decisión que el diagnóstico no contemplaba: **el motivo se persiste y se muestra
> en el mensaje del login**. Es la única superficie contra la que el sancionado choca seguro.
> Sin eso, el motivo viviría sólo en una notificación que no puede abrir y en un correo que
> puede perderse — y ésa es la justificación real de la migración.
>
> **Segundo añadido sobre el plan:** el cron de expiración de suspensiones también avisa. Es
> **el camino mayoritario** para recuperar una cuenta (el plazo se cumple solo), así que
> notificar sólo el levantamiento manual habría dejado mudo justamente el normal.
>
> **La frontera visible/interno** está fijada por construcción, no por cuidado: el servicio
> de avisos recibe `motivoVisible: string | null` y **no tiene parámetro para la nota**;
> `AccountModeratedData` y `SendAccountModeratedData` tampoco tienen campo donde meterla. Un
> e2e recorre notificaciones y correos buscando la nota y falla si aparece.
>
> **Pendiente que N2 NO cierra:** `unarchive` sigue sin avisar (asimetría con `ARCHIVED`), y
> las concesiones/débitos de saldo del staff siguen sin notificar pese a tener `reason`
> obligatorio. Van con N3/N5.

Verificado: `suspendUser`, `unsuspendUser`, `banUser`, `reinstateUser` y `changeUserRole`
pasan todos por `changeUserStatus` (`admin.service.ts:3460-3515`). Ese método escribe el
estado y **escribe el `AuditLog`. No hay una sola llamada a `createNotification` en toda
la ruta.**

| Evento | ¿Notifica hoy? | ¿Debería? | in-app | email | ¿Motivo? |
|---|---|---|---|---|---|
| Verificar email | ✅ (email de verificación) | ya está | — | ✅ | n/a |
| **Suspender** | ❌ **no** | **SÍ — prioridad máxima** | ✅ | ✅ | ❌ **NO EXISTE el campo** |
| **Levantar suspensión** | ❌ **no** | **SÍ** — se le devuelve el acceso | ✅ | ✅ | n/a |
| **Banear** | ❌ **no** | **SÍ — prioridad máxima** | ⚠️ (ver nota) | ✅ | ❌ **NO EXISTE el campo** |
| **Reinstaurar** | ❌ **no** | **SÍ** — y además hay que decirle que **sus anuncios NO vuelven solos** | ✅ | ✅ | n/a |
| Archivar (voluntario) | ❌ no | **NO** — lo pidió él | — | — | n/a |
| Archivar (por el staff) | ❌ no | **SÍ** | ✅ | ✅ | ⚠️ `archiveReason` existe |
| Desarchivar | ❌ no | **quizá** | ✅ | — | n/a |
| **Cambio de rol** | ❌ no | **SÍ** — además **le invalida las sesiones** (comentario en `:2118`). Que te echen sin explicación es peor que el cambio | ✅ | ✅ | n/a |
| Eliminar cuenta (`deleteAccount`) | ❌ no | **SÍ** por email — es terminal e irreversible | ❌ (no hay buzón) | ✅ | ⚠️ comprobar |
| Exportación lista | ✅ sí | ya está | ✅ (invisible, A1) | ❌ | n/a |

**Nota sobre el in-app del ban:** un usuario baneado no puede entrar, así que la campana
es inútil para él. **El email no es opcional aquí, es el único canal que funciona.** Mismo
razonamiento, más suave, para la suspensión.

### A3.3 — EL MOTIVO NO EXISTE PARA LAS SANCIONES DE CUENTA

Esto es lo que Ernest más subraya, y el hallazgo es más duro de lo esperado:

- **`SuspendUserDto` tiene un solo campo: `days`.** No hay `reason`. Verificado íntegro en
  `admin/dto/suspend-user.dto.ts`.
- **`banUser(targetId, actorId, ip)` no recibe DTO ninguno.** No hay dónde escribir un
  motivo.
- `changeUserStatus` guarda en `AuditLog` solo `{ status, suspendedUntil }`.

**El motivo de una suspensión o un baneo no se pierde al mostrarlo: nunca llegó a
capturarse.** No es un defecto de presentación, es un campo que falta en el modelo.

Contraste con lo que sí está bien resuelto: **`ChangeListingStatusDto.reason`** existe,
viaja hasta `ListingModeratedData.reason`, y se pinta correctamente en los dos canales
(`«…no ha pasado la revisión: {reason}»` in-app y `«Motivo indicado: {reason}»` en el
email), con degradación limpia cuando es `null`. **Ese es el patrón del motivo, ya
funcionando.** Hay que replicarlo, no inventarlo.

### A3.4 — TICKETS: completo, con un matiz

| Evento | ¿Notifica? | Veredicto |
|---|---|---|
| Usuario abre ticket | ✅ `TICKET_STAFF_NEW` | ✅ |
| Usuario responde en `WAITING_USER` | ✅ `TICKET_STAFF_NEW` (`kind: 'reply'`) | ✅ |
| Staff responde | ✅ `TICKET_MESSAGE` | ✅ |
| Staff abre hilo (flujos b/c) | ✅ `TICKET_OPENED` | ✅ |
| Ticket resuelto | ✅ `TICKET_MESSAGE` con la ventana de reapertura | ⚠️ **reutiliza el tipo** |
| Nota interna | ✅ suprimido a propósito (`if (message.internal) return`) | ✅ correcto |
| Ticket cerrado definitivamente | ❌ no | **quizá** — tras la ventana de reapertura |
| Ticket reasignado a otro agente | ❌ no | **NO** al usuario; **quizá** al agente (Parte B) |

**El matiz:** `userResolved` (`:151`) emite un `TICKET_MESSAGE` cuyo `extracto` es un
texto fabricado por el servidor («Tu ticket se ha marcado como resuelto…»). Se pinta como
si fuera una **respuesta del staff**: «Respuesta nueva en tu ticket «X»: Tu ticket se ha
marcado como resuelto». No es falso, pero encaja un evento de estado en el molde de un
evento de mensaje. **Merece su propio `TICKET_RESOLVED`** — el email ya lo trata como
evento aparte (`SEND_TICKET_RESOLVED`), es solo el in-app el que no distingue.

### A3.5 — REPORTES

| Evento | ¿Notifica hoy? | ¿Debería? | Motivo |
|---|---|---|---|
| Denuncia resuelta | ✅ in-app | **SÍ** — ya funciona | Correcto: no lleva motivo a propósito (no se le explica al denunciante qué se hizo con el otro) |
| Denuncia desestimada | ✅ in-app | **SÍ** — ya funciona | ídem |
| Denuncia recibida (acuse) | ❌ no | **NO** — el formulario ya confirma | — |
| El denunciado se entera | ❌ no | **NO, rotundo** — avisar «te han denunciado» invita a represalias. Lo que se le comunica es la **decisión** (`LISTING_MODERATED`), no la denuncia | — |

La supresión de auto-aviso (`esSuPropiaAccion`) está bien pensada y bien acotada: solo
suprime al actor de su propia acción, no los solapamientos legítimos.

### A3.6 — VALORACIONES

> ### ✅ ESTADO: N4a IMPLEMENTADO (rama `notificaciones-n4a-reputacion`)
>
> | Evento | Antes | Ahora |
> |---|---|---|
> | **Recibir una valoración** | mudo | ✅ `REVIEW_RECEIVED`, in-app + email |
> | **Restaurar una valoración** | mudo (asimetría) | ✅ `REVIEW_MODERATED` + acción `RESTORED`, in-app |
> | Retirar / editar con motivo | ✅ (A1 + N2) | ✅ sostenido y fijado por e2e |
> | **Responder a una valoración** | — | ❌ **no se puede: la función no existe** |
>
> **🔴 Corrección a esta misma tabla.** La fila «Responder a una valoración» daba por
> supuesto que responder existe. **No existe**: barrido de `reply|respuesta|respond` en
> `apps/api/src/modules/reviews/`, en el `model Review` y en el front → **cero resultados**.
> No hay campo, ni endpoint, ni interfaz. No es un aviso que falte, es una **función de
> producto** que nunca se construyó; notificar algo que no ocurre es imposible. Queda como
> decisión de producto, no como deuda de notificaciones.
>
> **Sin migración** (`type` es `String`) y **sin servicio ni módulo nuevos**: `REVIEW_RECEIVED`
> se emite desde `ReviewsService` con inyección directa —molde de `ListingsService` con
> `REVIEW_REQUEST`—, porque un solo llamante y un solo evento no justifican el módulo neutral
> que N2 y N3 sí necesitaban (tenían tres y cuatro llamantes que no se conocían).
>
> **El correo de `REVIEW_RECEIVED` sí sale, pese al «con moderación» de §A4.** La reserva era
> por volumen, y el modelo lo acota solo: valorar exige un `Deal` cerrado y `Review` tiene
> `@@unique([authorId, targetId, listingId])` — nadie puede valorar dos veces lo mismo. No es
> un canal inundable.
>
> **La auto-valoración no necesita guard**: `create()` la rechaza en su primera línea
> (`authorId === dto.targetId`), así que el destinatario nunca puede ser el autor. Es lo que
> `esSuPropiaAccion` consigue en moderación, aquí por regla de negocio.

| Evento | ¿Notifica hoy? | ¿Debería? | ¿Motivo? |
|---|---|---|---|
| **Recibir una valoración** | ❌ **no** | **SÍ — alto valor.** Alguien ha escrito públicamente sobre ti y no te enteras. Es el evento más «notificable» que existe sin cubrir | n/a |
| Solicitud de valorar (tras trato) | ✅ `REVIEW_REQUEST` | ✅ ya funciona | n/a |
| **Retirar una valoración** | ✅ `REVIEW_MODERATED` | **SÍ** — ya avisa | ❌ **`retireReview` exige `reason` obligatorio y `ReviewModeratedData` NO tiene campo `reason`. El motivo se descarta** |
| **Editar una valoración (staff)** | ⚠️ **avisa MAL** | **SÍ, con texto propio** | ❌ ídem, se descarta |
| **Restaurar una valoración** | ❌ **no** | **SÍ** — asimetría injustificada: al retirar se avisa, al devolver no. En anuncios sí se avisa del `RESTORED`, y el comentario del código lo defiende: «avisar solo de lo malo sería la mitad de la conversación» | n/a |
| Responder a una valoración | ❌ no | **SÍ** — es una conversación pública sobre ti | n/a |

**Defecto confirmado — el aviso que miente:** `editReview` (`moderation.service.ts:612`)
llama a `reviewModerated`, el mismo método que usa `retireReview`. El texto resultante es:

> «Hemos retirado tu valoración de 4★ sobre Juan (Bicicleta) por incumplir las normas.»

Pero **la valoración no se ha retirado, se ha editado** — sigue publicada, con el texto o
las estrellas cambiados. El usuario recibe una afirmación falsa sobre el estado de su
propia valoración. Y esto ocurre en el método cuya documentación presume de no mentir al
lector sobre quién escribió qué (el cuidado con `editedAt`, `:566-570`): el mismo rigor no
llegó al aviso.

### A3.7 — MENSAJERÍA — **tiempo real puro, cero notificaciones**

Verificado: el módulo `messaging` **no importa `NotificationsService`**. No hay ninguna
llamada a `createNotification`, ni ningún job de email. Lo que hay es:

- `messaging.gateway.ts` — WebSocket (socket.io, namespace `/ws`), con salas `user:{id}`.
- `messaging.service.ts:104` — un `unreadCount` calculado por conversación.

| Evento | ¿Notifica hoy? | ¿Debería? |
|---|---|---|
| **Mensaje nuevo estando conectado** | ✅ WebSocket | ✅ ya está bien |
| **Mensaje nuevo estando desconectado** | ❌ **nada** | **SÍ — el hueco más grande de la Parte A junto con las sanciones** |
| Primer mensaje en una conversación nueva | ❌ nada | **SÍ** |
| Cada mensaje siguiente del mismo hilo | ❌ nada | **NO — y esto es crítico**: una notificación por mensaje convierte la campana en un chat. **Agrupar por conversación**: una notificación viva por hilo, que se actualiza; o un aviso solo si el destinatario lleva N minutos sin conectarse |

Este es el evento donde **no notificar por notificar** más importa. La recomendación es
una notificación **por conversación, no por mensaje**, con email solo si el usuario está
offline y ha pasado una ventana de gracia.

### A3.8 — REVISIONES INTERNAS (`triage`)

| Evento | ¿Notifica hoy? | ¿Debería? |
|---|---|---|
| Marcar `REVIEWED` | ❌ no | **NO** — es juicio interno del staff, invisible por diseño |
| Transición automática a `EDITED` | ❌ no | **NO** — ídem |
| Marcar/desmarcar `watched` | ❌ no | **NO, rotundo** — decirle a alguien «te estamos vigilando» destruye el propósito de la vigilancia |
| Detección automática (`ListingDetection`) | ❌ no | **NO** al usuario — es señal para el staff (Parte B) |

Confirmado: **todo el eje de triaje es interno y debe seguir siéndolo.** Su sitio es la
Parte B.

### A3.9 — FACTURACIÓN Y CRÉDITOS

| Evento | ¿Notifica hoy? | ¿Debería? |
|---|---|---|
| Faltan datos fiscales con movimientos facturables | ✅ in-app | ✅ ya funciona |
| Factura emitida / disponible | ❌ no | **SÍ** — es un documento que el usuario necesita |
| Créditos concedidos por el staff | ❌ no | **SÍ** — le han regalado algo, con `reason` ya obligatorio en el DTO |
| **Saldo debitado por el staff** | ❌ no | **SÍ** — le han quitado algo. `BalanceDebitDto.reason` ya es obligatorio y su comentario lo llama «salvaguarda» | 
| Pro concedido / expirado | ❌ no | **quizá** — expirado sí, concedido tiene toast |
| Compra completada | ❌ no | **NO** — toast + página de éxito |

`CreditGrantDto`, `BumpGrantDto`, `BalanceDebitDto` y `GrantProDto` **ya exigen `reason`
obligatorio (5-500 caracteres)**. Ese motivo va al `AuditLog` y **nunca al usuario**, ni
siquiera cuando le quitan saldo. Es el mismo patrón que las sanciones: el dato existe, el
canal no.

---

## A4 — Qué tipos deben ganar email

> ### ✅ ESTADO: N5 IMPLEMENTADO (rama `notificaciones-n5-email-preferencias`)
>
> **La válvula existe.** Preferencias por categoría, opt-out, baja de un clic — y una
> frontera que no es una convención: las críticas **no llegan a consultar** ninguna
> preferencia.
>
> **Los tres correos que faltaban de §A4**, los tres CRÍTICOS:
>
> | Tipo | Antes | Por qué crítico |
> |---|---|---|
> | `DATA_EXPORT_READY` | solo campana | **caduca**: un aviso perdido es un derecho perdido |
> | `INVOICING_PENDING_FISCAL_DATA` | solo campana | **el «candidato dudoso», resuelto: SÍ** — hay ventana, y si se cierra los movimientos quedan sin facturar |
> | **Saldo debitado** | **ni campana ni correo** | le quitan dinero, con un `reason` que sólo iba al `AuditLog` |
>
> 🔴 **Corrección a §A3.9 y a esta tabla:** «saldo debitado» no era «le falta el email» —
> **no tenía aviso ninguno**. `debitBalance` escribía el apunte y el registro y no se lo
> decía a nadie, pese a exigir `reason` desde siempre. N5 lo crea entero.
>
> **Las cuatro categorías silenciables** (columnas booleanas en `User`, `@default(true)`):
> `MESSAGES`, `LISTINGS`, `REVIEWS`, `ALERTS`. Booleanos y no `jsonb` porque **el defecto lo
> pone la base**: con un `jsonb`, «la clave no está» tendría que significar «sí» por convenio
> en código, y ese convenio se olvida.
>
> **La frontera, por construcción:** `email-categories.ts` clasifica cada job con un `Record`
> **exhaustivo** — un correo nuevo no compila hasta que alguien decida si se puede silenciar,
> y un job desconocido se trata como crítico. Las críticas devuelven `null`, y el `null` corta
> antes de tocar la base: no es «se consulta y se ignora».
>
> **`LISTING_LIFECYCLE` es mixto y se resuelve por acción:** caducar es silenciable,
> «el staff te lo ha borrado» no. Meter los cuatro en una categoría habría hecho silenciable
> un borrado irreversible.
>
> **El punto único:** la comprobación vive en `NotificationProcessor.process()`, el embudo por
> el que pasa **todo** correo del sistema — hay 17 sitios que encolan, en 12 ficheros, y
> comprobar en cada uno habría sido repartir la decisión y confiar en que nadie se la salte.
> Por lo mismo, los 18 envíos pasan ahora por un solo `enviar()`, así que **el pie de baja no
> se puede olvidar** en ninguno (y no aparece en las críticas: ofrecer «date de baja» al pie
> de un baneo sería ofrecer algo imposible).
>
> **La baja va por HMAC, sin tabla de tokens:** funciona sin sesión (quien se da de baja no la
> inicia), no se puede forjar, es idempotente y no caduca — un enlace de baja que caduca es un
> enlace de baja roto, y lo único que permite es dejar de recibir correo.

**Estado actual: 8 de 12 mandan email.** El criterio implícito del código (y es un buen
criterio, está bien argumentado en los comentarios) es:

> **Email cuando el usuario tiene algo que hacer, o pierde algo, y puede tardar días en
> entrar. In-app solo cuando es informativo y no hay acción posible.**

### Los que hoy NO mandan email y deben ganarlo

| Tipo / evento | Por qué |
|---|---|
| **Suspensión y baneo de cuenta** | **Imprescindible.** Un baneado no puede entrar a leer su campana. El email es el único canal existente |
| **Cambio de rol** | Le invalida las sesiones. Se entera de que le han echado antes que del porqué |
| **Anuncio expirado** | Perdió presencia sin hacer nada, y hay una acción clara: renovar |
| **Cuenta eliminada** | Terminal e irreversible; no queda buzón donde leer nada |
| **Anuncio eliminado por el staff** | Irreversible |
| `DATA_EXPORT_READY` | **Caduca.** Un enlace con TTL cuyo aviso solo vive en la campana se pierde por no entrar a tiempo |
| **Recibir una valoración** | ⚠️ **con moderación** — email solo la primera vez o agrupado. Una valoración no es urgente |
| **Mensaje nuevo (offline)** | ⚠️ **con ventana de gracia y agrupación.** Sin eso, es la vía más rápida a que marquen los correos como spam |
| **Saldo debitado por el staff** | Le han quitado algo que vale dinero |

### Los que deben seguir SIN email — y por qué está bien

| Tipo | Razón (ya argumentada en el código, se confirma) |
|---|---|
| `REPORT_RESOLVED` | Informativo, sin acción posible, y las denuncias son muchas más que las moderaciones |
| `REVIEW_MODERATED` | «Un correo de *hemos borrado lo que escribiste* invita a discutir algo que ya no tiene vuelta atrás» |
| `INVOICING_PENDING_FISCAL_DATA` | ⚠️ **revisable** — hay ventana temporal y acción concreta. Es el candidato dudoso: si la ventana se cierra sin facturar, el usuario pierde algo real |
| Bump aplicado | D6, y con razón |
| Marcar `REVIEWED` / `watched` | No son eventos del usuario |

### Barrera técnica del email

**No existe preferencia de notificación por usuario.** Ni un campo, ni una tabla, ni un
`unsubscribe`. Hoy son 8 tipos de correo transaccional y se sostiene. Con las
incorporaciones de arriba —especialmente mensajería y valoraciones— pasa a ser volumen
suficiente para que la ausencia de «darse de baja» sea un **problema de entregabilidad y
probablemente de cumplimiento**. Ver §Barreras.

---

# PARTE B — Backoffice: la cola de trabajo

## B0. El modelo es distinto, y hay que decirlo explícitamente

`Notification` es **estrictamente `userId` 1:1**. No existe un buzón de rol — está
documentado en el código como decisión consciente (RC.1). La consecuencia es que hoy el
trabajo del staff llega **por fan-out a la campana personal de cada agente**:
`CONTACT_MESSAGE` a cada `ADMIN`, `TICKET_STAFF_NEW` a cada `ADMIN` y `MODERATOR`.

**Esto no escala y ya se sabía.** El propio código lo dice: «multiplicar cada aviso por el
número de administradores es ruido que no escala» (§14.4, por eso el email de tickets va a
un buzón único mientras el in-app sigue siendo fan-out).

Además, la campana personal responde mal a la pregunta del staff:

- Si dos agentes atienden el mismo ticket, **la notificación del otro no desaparece**.
- Una notificación **leída** deja de contar, aunque el trabajo **siga pendiente**. Leer no
  es hacer.
- No hay forma de preguntar «¿cuánto queda?», solo «¿qué me han contado?».

**El buzón responde «qué ha pasado». El staff necesita «qué queda por hacer».** Son dos
preguntas distintas y la segunda no se contesta con un historial de eventos.

## B1. Modelo recomendado: `COUNT` on-demand — **y ya es el patrón vigente**

**Recomendación: `COUNT` on-demand. Sin contadores almacenados. Sin excepciones al
empezar.**

Y la buena noticia es que **no hay que introducir el patrón: ya está ahí**.
`admin.service.ts:3399` (`getStats`) ejecuta **siete `COUNT` en una sola
`prisma.$transaction([...])** y devuelve el resultado agrupado. Los contadores de la cola
de trabajo son **más de lo mismo, en la misma llamada**.

| | `COUNT` on-demand | Contador almacenado |
|---|---|---|
| Corrección | **Siempre exacto por construcción** | Se desincroniza en cuanto un camino de escritura se olvida de decrementar |
| Coste de escritura | Cero | Cada transición de estado debe acordarse del contador |
| Coste de lectura | Un `COUNT` con índice, N veces al día | Constante |
| Volumen real | El backoffice lo abren unos pocos agentes | — |

Es el mismo criterio que ya rige en el proyecto para la rotación de destacados y para las
medias de valoraciones (`average`, `count` y `distribution` **se calculan al vuelo en cada
lectura** — `moderation.service.ts:574`, y el comentario dice explícitamente «nada que
desincronizar»). **No almacenar lo que se puede derivar.**

**Índices — la única atención real que exige.** Ya existen `@@index([status, publishedAt])`
y `@@index([watched])`, y `@@index([needsRevalidation])`. Pero el schema deja escrito
(`:1043-1046`) que **`triage` NO lleva índice todavía a propósito**, y que el índice útil
sería el compuesto, «que se mide antes de añadirlo». Los contadores de triaje son
justamente esa consulta: **hay que medir con `EXPLAIN` y decidir el índice compuesto en la
ráfaga que los introduzca.** Está anotado en el propio schema como pendiente para «E2».

## B2. Las secciones y sus contadores

### Moderación

| Contador | Fuente | ¿Existe hoy? |
|---|---|---|
| Anuncios pendientes de revisión | `Listing.status = PENDING_REVIEW` | ✅ **ya en el dashboard** |
| Denuncias abiertas | `Report.status` pendiente | ✅ **ya en el dashboard** |
| **Anuncios nuevos sin triar** | `Listing.triage = NEW` | ❌ nuevo — **el campo ya existe** |
| **Anuncios editados tras revisarse** | `Listing.triage = EDITED` | ❌ nuevo — **el campo ya existe** |
| Anuncios en observación | `Listing.watched = true` | ❌ nuevo (tiene índice ya) |
| Detecciones automáticas sin atender | `ListingDetection` | ❌ nuevo |
| Valoraciones denunciadas sin resolver | `Report` con `reviewId` | ❌ nuevo |

### Atención

| Contador | Fuente | ¿Existe hoy? |
|---|---|---|
| Tickets sin asignar | `Ticket` sin agente | ❌ nuevo |
| Tickets esperando al staff | `Ticket.status` en espera de respuesta interna | ❌ nuevo |
| Mensajes de contacto sin atender | `ContactMessage.estado` | ❌ nuevo |
| Tickets sin respuesta en > N horas | ídem + `updatedAt` | ❌ nuevo — **el que mejor mide el SLA** |

### Plataforma

| Contador | Fuente | ¿Existe hoy? |
|---|---|---|
| Índice de búsqueda desincronizado / indexando | Meilisearch | ✅ ya en el dashboard |
| Facturas pendientes de emitir | `Transaction` facturable sin `invoiceLine` | ❌ nuevo |
| Usuarios sin datos fiscales con movimientos facturables | ya calculado en `invoicing-schedule` | ❌ nuevo (la consulta existe) |
| **`supportEmail` sin configurar** | `Setting` | ❌ nuevo — **alto valor**: hoy es un `logger.warn` que nadie lee, y significa que **el correo al soporte no se está enviando** |
| Suspensiones vencidas sin levantar | `User.suspendedUntil < now` y `status = SUSPENDED` | ❌ nuevo — nada las levanta automáticamente |

**Sobre el último:** merece verificación aparte. `suspendedUntil` se escribe, pero no se ha
encontrado ningún proceso que reactive al usuario al vencer. Si no existe, un contador es
el parche barato mientras se decide si debe haber un cron.

## B3. El «revisado interno» — **ya existe, no hay que crearlo**

**`Listing.triage` (enum `ListingTriage`), `schema.prisma:181` y `:929`.** Tres valores
excluyentes:

- **`NEW`** — nadie del staff lo ha mirado. Por defecto, sin código.
- **`REVIEWED`** — alguien lo miró y lo dio por bueno. Solo a mano.
- **`EDITED`** — lo revisado **ha cambiado**: el dueño lo editó después, el juicio caducó.
  Solo automático.

Y está diseñado exactamente como la Parte B necesita: es un **eje independiente de
`status`**, documentado como tal («un anuncio puede estar `ACTIVE` y `EDITED`, o
`PENDING_REVIEW` y `NEW`»). Se llama `triage` y no `reviewState` **a propósito**, para no
confundirse con `PENDING_REVIEW`.

Existen además dos ejes hermanos, deliberadamente separados:
- **`Listing.watched`** — «el staff vigila esto». A mano, auditado, con índice.
- **`ListingDetection`** — lo que el motor automático encontró en el texto. Tabla propia.

El schema argumenta por extenso por qué son tres cosas distintas y no valores de un mismo
enum. **Ernest pedía «nuevos/editados sin marcar como revisados» y eso es literalmente
`triage IN (NEW, EDITED)`.** El modelo está hecho; lo que falta es **contarlo y
enseñarlo**.

## B4. El dashboard: dónde encajan

`/admin` (`apps/web/src/app/(admin)/admin/page.tsx`) hoy muestra **seis KPI + el estado del
índice**, en tres secciones: Anuncios, Usuarios y moderación, Índice de búsqueda. Ya
incluye «En revisión» y «Reportes pendientes» — es decir, **ya hay dos contadores de cola
de trabajo mezclados con métricas de negocio.**

Ese es precisamente el problema de encaje: **«Usuarios totales: 12.480» y «Reportes
pendientes: 3» no son la misma clase de dato.** Uno es una métrica que se mira una vez al
mes; el otro es trabajo que alguien tiene que hacer hoy.

**Recomendación:** una sección propia **arriba del todo**, «Trabajo pendiente», con los
contadores accionables agrupados por área (Moderación / Atención / Plataforma), cada uno
enlazando a **su lista ya filtrada** — y aquí los enlaces se construyen con
`lib/admin-links.ts`, no a mano (`adminListingsBySellerHref` ya demuestra el patrón del
enlace con filtro). Debajo, las métricas de negocio actuales, sin tocar.

Un contador a cero debe **verse a cero**, no desaparecer: «0 pendientes» es información
valiosa; una tarjeta ausente es ambigua.

## B5. Quién ve qué — **sin filtro por rol**

Decisión de Ernest, y **simplifica de verdad**: los contadores se muestran a **todo el
staff**, sin filtrar por permiso de sección. Un moderador sin acceso a facturación ve que
hay 4 facturas pendientes; no puede entrar, pero sabe que existen.

**Implicaciones a tener presentes:**
- El endpoint es **uno solo**, sin ramificación por rol. Mucho más simple de construir y
  de probar.
- Los contadores son **números agregados, nunca contenido**. «7 tickets sin asignar» no
  filtra nada de nadie. Esto es lo que hace que la decisión sea segura, y conviene dejarlo
  escrito como **invariante**: el día que alguien quiera poner «último ticket: *asunto*»
  en la tarjeta, la decisión de no filtrar por rol deja de ser inocua.
- El **enlace** de cada tarjeta sí puede llevar a una sección sin permiso.
  `canAccessAdminPath` es **fail-closed**, así que el usuario verá un rechazo limpio, no un
  error raro. Aceptable; mejor aún si la tarjeta no es clicable cuando no hay permiso.

---

# El patrón común: sí, es el mismo defecto

**La respuesta es sí, con un matiz importante.**

| | Backoffice-completitud (cerrado) | Notificaciones (esta auditoría) |
|---|---|---|
| Defecto | 17 plantillas de URL escritas a mano, varias a la ruta pública equivocada | Enlaces y textos escritos a mano en dos ficheros distintos |
| Síntoma | «Estaba roto el 100 % de las veces» | `APPROVED` pinta `undefined`; el email de valorar lleva a 404 |
| Detección | Ninguna: nada obliga a que estén todas bien | Ninguna: nada obliga a que cada tipo tenga `case` |
| Solución | `lib/admin-links.ts` | — |

### ¿Se puede reusar `admin-links.ts`? — Sí, en parte

**Directamente reutilizable, hoy:**
- `CONTACT_MESSAGE` → `adminListingHref`… no; → el equivalente de mensajes de contacto.
- `TICKET_STAFF_NEW` → **`adminTicketHref(id)`**. El `case` escribe
  `/admin/tickets/${n.data.ticketId}` a mano; la función ya existe y dice exactamente eso.
- Todos los contadores de la Parte B → sus enlaces filtrados.

**Lo que falta:** `admin-links.ts` cubre **rutas de staff**. Las notificaciones de usuario
necesitan el hermano que no existe: **rutas de la cuenta** (`/mis-anuncios`,
`/mis-tickets/{id}`, `/mis-creditos`, `/perfil/facturacion`, `/notificaciones`,
`/vendedor/{slug}`). Hoy están escritas a mano en once `case`, y **es donde se ha
manifestado el fallo de A1.2** (el email a `/anuncio/{slug}` de un anuncio `SOLD`).

**Recomendación: crear `lib/account-links.ts`, hermano de `admin-links.ts`, con la misma
cabecera que explique la regla** — y, crucialmente, **una función que el processor de
emails también pueda usar**, porque el helper del front no alcanza al back. Ese es el
salto que `admin-links.ts` no dio y por eso el enlace del correo se quedó roto.

### ¿Y el contenido? — El switch reinventa cada texto, dos veces

`notification-content.ts` es un `switch` de 90 líneas donde **cada `case` redacta su
propio texto desde cero**, y `notification.processor.ts` hace lo mismo por su lado para el
email. No hay estructura compartida: ni un patrón «título / cuerpo / acción», ni un sitio
donde comprobar que un tipo nuevo trae las dos versiones.

**No recomiendo un motor de plantillas.** El snapshot autocontenido y el `switch` explícito
son una decisión buena y bien argumentada — se pinta sin una sola consulta. **Lo que falta
no es abstracción, es una red de seguridad:**

1. **Exhaustividad forzada en el `switch`** — el `default` actual es un colchón que
   **oculta el fallo en vez de denunciarlo**. Con la unión discriminada `NotificationItem`
   ya existente, se puede hacer que un tipo sin `case` sea un **error de compilación**, no
   una notificación en blanco en producción. Esto habría atrapado `DATA_EXPORT_READY` el
   día que se escribió.
2. **Lo mismo para los mapas por variante** — el fallo de `APPROVED` es un objeto literal
   con 3 claves indexado por una unión de 4. Un mapa completo obligatorio lo habría
   impedido.
3. **`DATA_EXPORT_READY` debe pasar por `createNotification()`.** El tipado de `DataByType`
   es la barrera que existe justamente para esto, y se saltó escribiendo Prisma directo.

Esas tres cosas convierten «acuérdate de añadir el `case`» —que ya ha fallado dos veces—
en «no compila si te olvidas».

---

# El plan de ráfagas

Dimensionado en tamaño relativo. **A1 primero porque es lo roto**, no porque sea lo grande.

### Ráfaga N1 — A1: lo roto y la red de seguridad · **pequeña**

Lo que más valor da por línea tocada. Todo son defectos verificados, no ideas nuevas.

- `DATA_EXPORT_READY` entra en `NotificationType`, `DataByType`, `NotificationItem` y su
  `case`; su creación pasa por `createNotification()`.
- El `case` de `LISTING_MODERATED` gana la rama `APPROVED`.
- Exhaustividad forzada en el `switch` y en los mapas por variante.
- `editReview` deja de reutilizar `reviewModerated`: texto propio para «editada».
- El enlace del email de `REVIEW_REQUEST` deja de apuntar a un anuncio `SOLD`.
- Nace `lib/account-links.ts` y los `case` dejan de escribir rutas a mano.
- Los fallbacks a `/notificaciones` se sustituyen por destinos con sentido.

**Barrera:** ninguna. No toca el modelo de datos.

### Ráfaga N2 — A3 grupo 1: decisiones sobre la cuenta (con motivo) · **mediana**

**La que Ernest más subraya, y la primera que necesita migración.**

- `reason` en `SuspendUserDto`; `BanUserDto` nuevo con `reason`. Persistirlo.
- `reason` en `ReviewModeratedData` (el dato ya se captura y hoy se tira).
- Tipos nuevos: sanción de cuenta, levantamiento, cambio de rol.
- **Los dos canales**, con el email como principal para el ban.
- Se replica el patrón de `LISTING_MODERATED.reason`, ya funcionando: `reason` en el
  snapshot, degradación limpia si es `null`, mismo texto en in-app y email.

**Barreras:** decidir **qué motivo se le enseña al usuario y cuál se queda en el
`AuditLog`** — no es lo mismo la nota interna del moderador que la explicación al
sancionado. Es una decisión de producto y legal, no técnica. Y el copy de una sanción es
delicado: el molde ya está en el processor («la moderación puede equivocarse… dice QUÉ ha
pasado y CÓMO seguir, no sentencia sobre la conducta»).

### Ráfaga N3 — A3 grupo 2: ciclo de vida del anuncio · **pequeña-mediana**

- Publicado/recibido, expirado, preaviso de expiración, editado por el staff, eliminado
  por el staff, destacado expirado.
- Reutiliza en su mayoría el molde de `LISTING_MODERATED`.

**Barrera:** el preaviso de expiración necesita un cron o un enganche en el proceso de
expiración; verificar si `ExpirationService` puede alojarlo sin rediseño.

### Ráfaga N4 — A3 grupo 3: reputación y mensajería · **mediana, la de más criterio**

- Recibir valoración, restaurar valoración, responder a valoración.
- **Mensajería: agrupada por conversación, nunca por mensaje.** Es la única del plan que
  necesita una decisión de diseño de verdad (¿agrupar? ¿ventana de gracia? ¿solo si está
  offline?) antes de escribir nada.

**Barrera:** es donde el riesgo de «notificar por notificar» es máximo. Merece decidirse
por escrito antes de empezar.

### Ráfaga N5 — A4: el email y sus preferencias · **mediana**

- Los tipos que ganan email.
- **Y aquí, no antes, las preferencias por usuario** — si N4 entra sin esto, el volumen de
  correo se dispara sin válvula de escape.

**Barrera:** las preferencias son modelo nuevo (tabla o `jsonb` en `User`) y afectan a
todos los envíos existentes.

### Ráfaga N6 — Parte B: la cola de trabajo · **mediana, independiente**

**No depende de ninguna de las anteriores. Puede ir en paralelo.**

- Un endpoint de contadores, con el molde exacto de `getStats()`: `COUNT` en una
  `$transaction`.
- Sección «Trabajo pendiente» arriba de `/admin`, con enlaces vía `admin-links.ts`.
- Sin filtro por rol.
- **Medir con `EXPLAIN` el índice compuesto de `triage`** — el schema lo dejó pendiente por
  escrito.

**Barrera:** solo la del índice. El resto es sumar consultas a un patrón que ya existe.

---

# Las barreras clave

1. **El motivo de las sanciones no existe.** No es un defecto de presentación: `SuspendUserDto`
   solo tiene `days` y `banUser` no recibe DTO. **Hay que capturarlo antes de poder
   mostrarlo**, y decidir qué parte se le enseña al sancionado frente a lo que se queda en
   el `AuditLog`. Es la barrera que bloquea lo que Ernest más quiere.

2. **`Notification` es `userId` 1:1 y no hay buzón de rol.** Es una decisión consciente y
   correcta para la Parte A. Es también la razón por la que la Parte B **no puede** usar el
   buzón, y por la que el fan-out al staff ya está reconocido como no escalable en el
   propio código. **No forzar el modelo de A sobre B.**

3. **No hay preferencias de notificación ni baja de correo.** Con 8 tipos de email se
   sostiene. Si entran mensajería y valoraciones sin válvula, el riesgo pasa a ser de
   entregabilidad y probablemente de cumplimiento. **Debe ir en la misma ráfaga que la
   expansión del email, no después.**

4. **El contenido se redacta dos veces, en dos ficheros, sin nada que los alinee.** Ya han
   divergido dos veces de forma verificada. El helper de enlaces del front **no alcanza al
   processor de emails**, que es exactamente donde sobrevivió un enlace roto.

5. **`triage` no tiene índice, por decisión anotada.** Los contadores de la Parte B son la
   consulta que el schema dijo que había que medir antes de indexar. No inventarse el
   índice: medirlo.

6. **La mensajería es el riesgo de ruido.** Es el evento más frecuente del sistema con
   diferencia. Notificar por mensaje convertiría la campana en un chat roto y el correo en
   spam. La agrupación no es un refinamiento posterior, es parte del diseño.

7. **`supportEmail` sin configurar es un fallo silencioso hoy.** `getSupportEmail()` emite
   un `logger.warn` y no manda el correo. Nadie lee ese log. El aviso in-app cubre el
   hueco, pero el equipo cree que tiene un canal que no tiene. Es un contador de la Parte B
   casi gratis.

8. **Ningún proceso levanta las suspensiones vencidas** (pendiente de verificar). Si se
   confirma, `suspendedUntil` es una promesa que el sistema no cumple sola, y hay que
   decidir entre un cron o un contador que lo haga visible.

---

## Anexo — Qué está bien y no hay que tocar

Para que el rediseño no rompa lo que funciona:

- **`AlertMatchingService`** entero: dos fases, dedup por `@@unique`, respeto al estado de
  cuenta, doble canal independiente.
- **El principio del snapshot autocontenido** (`Notification.data` con nombres ya
  resueltos, nunca ids). Es lo que permite pintar sin consultas y sobrevivir al borrado de
  la entidad. Está aplicado con disciplina en los 12 tipos.
- **`esSuPropiaAccion`**: no avisar al actor de su propia acción, y **solo** de eso.
- **`if (message.internal) return`**: las notas internas nunca disparan avisos.
- **D6 del bump**: avisar solo de incidencias, nunca de cada bump aplicado.
- **`BUMP_AUTO_PAUSED`**: el mejor molde del sistema. El `reason` decide el texto **y el
  enlace**, porque la salida que se ofrece depende de la causa. Es lo que hay que imitar en
  las sanciones.
- **`text:` plano y nunca `html:`** en el processor. Contenido escrito por desconocidos que
  leen agentes con sesión.
- **El patrón `reason` de `LISTING_MODERATED`**: capturado en DTO, viajado en el snapshot,
  pintado en los dos canales, con degradación limpia a `null`. **Es el patrón del motivo, y
  ya funciona.**
- **`getStats()` con `COUNT` en `$transaction`**: el molde exacto de la Parte B.
- **`lib/admin-links.ts`**: la lección ya aprendida. Extenderla, no reinventarla.
