# Auditoría — la sección de Ajustes del backoffice

**Fecha:** 2026-08-31 · **Alcance:** `/admin/ajustes`, el modelo `Setting` completo y las fuentes
de datos de instancia. **Cero código escrito.** Todo lo que sigue está verificado contra el
repositorio en `main` (commit `7760423`), con fichero y línea.

> **ESTADO — la RÁFAGA A está implementada.** Los §3, §4, §5 y §7-A de este documento ya son
> código, y sus barreras están pinzadas en `apps/api/test/ajustes-rafaga-a.e2e-spec.ts`.
> Las dos decisiones que este documento dejaba abiertas se resolvieron así:
> **`listingExpiryDays` se conectó** a un lector real (`ListingExpiryService`), y
> **`contactRequiresVerification` también** —tiene un punto de entrada único y limpio
> (`MessagingService.startConversation`), así que se conectó en vez de retirarse—.
> Los cuatro huérfanos de §2.2 ya tienen UI y guarda. **La ráfaga B (el panel de info de
> instancia, §6) sigue pendiente de tu aprobación de la lista.**

---

## 0. Resumen ejecutivo

**La premisa del encargo era distinta de lo que hay.** El encargo dice que `/admin/ajustes` muestra
**solo 3 settings** y que la whitelist del PATCH tiene **tres claves**. Medido:

| | Encargo | Verificado |
|---|---|---|
| Claves en la whitelist (`SETTING_KEYS`) | 3 | **33** — [admin.service.ts:170-290](../apps/api/src/modules/admin/admin.service.ts#L170-L290) |
| Settings pintados en `/admin/ajustes` | 3 | **33** (29 en el bloque principal + 4 en «Monetización») |
| Settings con descripción en la UI | — | **33 de 33** — ninguno sin describir |

La consolidación de la parte 1 del encargo **ya está hecha**: las 33 claves editables están todas
en la página, con su editor tipo-específico y su descripción. El defecto real que queda en
`/admin/ajustes` **no es de cobertura, es de organización y de veracidad**:

1. **Organización (parte 1).** Los 29 del bloque principal se pintan en **una lista plana sin
   ningún encabezado**, ordenados por un array `ORDER` que agrupa por vecindad pero no lo dice
   ([page.tsx:928-972](../apps/web/src/app/(admin)/admin/ajustes/page.tsx#L928-L972)). Un admin
   recorre 29 tarjetas iguales para encontrar una. Los grupos **existen en los comentarios del
   código** y no en la pantalla. → §4.

2. **Veracidad (parte 2) — lo grave.** **Dos de los tres ajustes que el encargo daba por seguros
   están MUERTOS**: `listingExpiryDays` y `contactRequiresVerification` están sembrados, son
   editables, tienen una descripción que promete un efecto… y **cero lectores en todo el
   backend**. El propio repo lo tiene documentado en tres sitios como deuda conocida. Un admin que
   ponga la caducidad en 30 días verá «Guardado» y los anuncios seguirán caducando a los 60. → §3.
   Hay además **dos descripciones más que mienten** (los límites de activos) y una **incompleta**
   (los detectores). → §5.

3. **Ajustes sin ninguna UI (parte 1, el trabajo real de consolidar).** Cuatro claves de
   configuración legítima **no están en la whitelist ni en ninguna pantalla**: sólo se pueden
   cambiar escribiendo en Postgres a mano. → §2.2.

4. **El panel de info (parte 3) no existe** en ninguna forma: no hay endpoint, ni página, ni
   entrada de nav. Se propone entero en §6. → 21 datos, todos marcados seguro/no-seguro.

**El núcleo de la auditoría** —la clasificación editable-aquí / en-su-página / nunca-editable de
las 39 claves reales— está en §2.

---

## 1. Cómo funciona hoy el circuito (verificado)

```
GET  /admin/settings          → AdminService.getSettings()      admin.service.ts:3330-3347
PATCH /admin/settings/:key    → AdminService.updateSetting()    admin.service.ts:3441-3520
```

Ambos heredan `@MinRole(Role.ADMIN)` de la clase
([admin.controller.ts:42-45](../apps/api/src/modules/admin/admin.controller.ts#L42-L45)): ni
MODERATOR ni EDITOR los ven.

**Cuatro cosas que hay que tener presentes para todo lo que sigue:**

- **`getSettings()` devuelve TODAS las filas de la tabla**, con `findMany` sin `where`
  ([:3331](../apps/api/src/modules/admin/admin.service.ts#L3331)), y **añade** las claves del
  whitelist que no tienen fila, con su default y `configured: false`. Es decir: la respuesta ya
  incluye hoy `fiscalIssuer`, `fiscalInvoicingLastPeriod`, `defaultSuspensionDays` y
  `messageEmailGraceMinutes`. La UI simplemente no las pinta, porque itera sobre su propio array
  `ORDER`. **La barrera de escritura es real; la de lectura no existe.**
- **La whitelist es la única puerta de escritura** ([:3447-3451](../apps/api/src/modules/admin/admin.service.ts#L3447-L3451)):
  una clave ajena da 400 con la lista de válidas. El `upsert` que viene después no puede crear una
  fila arbitraria porque la whitelist ya rechazó.
- **La validación de forma es por-clave, no genérica.** El DTO es
  `@Allow() value: unknown` ([update-setting.dto.ts](../apps/api/src/modules/admin/dto/update-setting.dto.ts)),
  y sólo hay tres guardas: `POSITIVE_INT_SETTING_KEYS` (13 claves), `PERCENT_SETTING_KEYS`
  (2 claves) y las dos invariantes cruzadas (`total > activos`, `min ≤ max` de fotos). **Todo lo
  demás —booleanos, strings, arrays, el objeto de `detectionModes`— acepta cualquier JSON.**
- **Cada escritura queda en el audit log** (`SETTING_UPDATE`, con `before`/`after`, dentro de la
  misma transacción) — [:3506-3517](../apps/api/src/modules/admin/admin.service.ts#L3506-L3517).

### 1.1 El molde de controles que hay que reutilizar

`/admin/ajustes` ya tiene los cinco editores que cualquier ajuste nuevo necesita. **Nada nuevo hay
que inventar:**

| Editor | Para | Línea |
|---|---|---|
| `NumberSettingEditor` | enteros, con `min`/`max`/`suffix` | [page.tsx:421](../apps/web/src/app/(admin)/admin/ajustes/page.tsx#L421) |
| `BooleanSettingEditor` | interruptores (parametrizado) | [page.tsx:631](../apps/web/src/app/(admin)/admin/ajustes/page.tsx#L631) |
| `TextSettingEditor` | texto libre / email | [page.tsx:505](../apps/web/src/app/(admin)/admin/ajustes/page.tsx#L505) |
| `BadWordListEditor` / `FlaggedIpsEditor` / `FlaggedPhonesEditor` | listas (textarea, una por línea) | [page.tsx:331](../apps/web/src/app/(admin)/admin/ajustes/page.tsx#L331), [:152](../apps/web/src/app/(admin)/admin/ajustes/page.tsx#L152), [:248](../apps/web/src/app/(admin)/admin/ajustes/page.tsx#L248) |
| `DetectionModesEditor` | enum por detector, con estadística al lado | [page.tsx:50](../apps/web/src/app/(admin)/admin/ajustes/page.tsx#L50) |
| `ContactVerificationEditor` | booleano, pero con clave y texto incrustados | [page.tsx:572](../apps/web/src/app/(admin)/admin/ajustes/page.tsx#L572) |

Falta uno solo para lo que se propone consolidar: **un `SelectSettingEditor`** (enum de opciones
cerradas), que hoy no existe suelto —`DetectionModesEditor` lleva su `<select>` incrustado— y que
haría falta para `fiscalInvoicingPeriodicity`.

---

## 2. EL INVENTARIO — las 39 claves `Setting` del sistema, clasificadas

Barrido: `prisma.setting.*` en todo `apps/api/src` + `SEED_SETTINGS` + los tests e2e. **39 claves
distintas**, de las cuales 33 en la whitelist y 6 fuera.

La clasificación usa tres categorías, más una cuarta que el encargo no preveía y que el código
obliga a abrir:

- **A · EDITABLE AQUÍ** — configuración legítima, ya editable en `/admin/ajustes`.
- **B · EDITABLE EN SU PÁGINA** — configuración con validación propia que no cabe en un campo suelto.
- **C · NUNCA EDITABLE** — estado interno del sistema (marcas de cron). Ni siquiera de lectura suelta.
- **D · MUERTO** — declarado, sembrado y editable, **con cero lectores**. Editarlo no hace nada.
  Es peor que C: C no engaña a nadie porque no se ofrece; D se ofrece y promete.

### 2.1 Las 33 de la whitelist

Leyenda de «Sembrado»: **S** = está en `SEED_SETTINGS`; **—** = nace sin fila a propósito, y el
default lo pone el lector (y `SETTING_DEFAULTS` lo replica para que el backoffice enseñe el valor
que de verdad se aplica).

| # | Clave | Tipo | Default | Qué hace (leído del lector) | Lector | Semb. | Clase |
|---|---|---|---|---|---|---|---|
| 1 | `badWordList` | `string[]` | `[]` | Palabras/frases que el detector WORD busca en título y descripción | [word.detector.ts:69](../apps/api/src/modules/moderation/detection/detectors/word.detector.ts#L69) | S | **A** |
| 2 | `listingExpiryDays` | número | 60 (sembrado) | **NADA. Cero lectores.** El plazo real es la constante `EXPIRY_DAYS = 60` | [expiration.service.ts:10](../apps/api/src/modules/expiration/expiration.service.ts#L10) | S | **D** |
| 3 | `contactRequiresVerification` | booleano | `true` (sembrado) | **NADA. Cero lectores.** Messaging no lo consulta | — | S | **D** |
| 4 | `freeActiveListingLimit` | número | 5 | Tope de anuncios ACTIVE simultáneos de un no-Pro. **Bloquea** la transición | [active-listing-limit.rule.ts:68](../apps/api/src/modules/listing-gate/rules/active-listing-limit.rule.ts#L68) | S | **A** |
| 5 | `proActiveListingLimit` | número | 20 | Lo mismo para un Pro. Se lee además para el mensaje «con Pro puedes tener N» | [:93](../apps/api/src/modules/listing-gate/rules/active-listing-limit.rule.ts#L93) | S | **A** |
| 6 | `freeTotalListingLimit` | número | 10 (`= activos × 2`) | Tope TOTAL (todo menos ARCHIVED y SOLD) de un no-Pro, al **crear** | [total-listing-limit.rule.ts:84](../apps/api/src/modules/listing-gate/rules/total-listing-limit.rule.ts#L84) | — | **A** |
| 7 | `proTotalListingLimit` | número | 40 | Lo mismo para un Pro | ídem | — | **A** |
| 8 | `totalListingLimitEnabled` | booleano | `false` | Interruptor de la regla #6/#7 | [:63](../apps/api/src/modules/listing-gate/rules/total-listing-limit.rule.ts#L63) | — | **A** |
| 9 | `emailVerifiedToPublishEnabled` | booleano | `false` | Interruptor: publicar sin correo verificado **degrada a DRAFT**, no rechaza | [email-verified.rule.ts:65](../apps/api/src/modules/listing-gate/rules/email-verified.rule.ts#L65) | — | **A** |
| 10 | `maxPhotosPerListing` | número ≥1 | 15 | Máximo de fotos por anuncio | [photo-limits.service.ts:66](../apps/api/src/modules/listing-gate/photo-limits.service.ts#L66) | — | **A** |
| 11 | `minPhotosPerListing` | número ≥1 | 1 | Mínimo de fotos **para publicar** | [:43](../apps/api/src/modules/listing-gate/photo-limits.service.ts#L43) | — | **A** |
| 12 | `minPhotosRuleEnabled` | booleano | `false` | Interruptor del #11 | [:48](../apps/api/src/modules/listing-gate/photo-limits.service.ts#L48) | — | **A** |
| 13 | `proMonthlyFeaturedQuota` | número ≥1 | 4 | Destacados gratis/mes de un Pro, por ciclo de suscripción | [entitlement.service.ts:380](../apps/api/src/modules/billing/entitlement.service.ts#L380) | S | **A** |
| 14 | `proQuotaFeaturedDurationDays` | número ≥1 | 7 | Duración fija del destacado pagado con cuota | [billing.service.ts:490](../apps/api/src/modules/billing/billing.service.ts#L490) | S | **A** |
| 15 | `bumpCreditCost` | número ≥1 | 5 | Créditos que cuesta un bump manual, **antes** de descuento de campaña | [billing.service.ts:709](../apps/api/src/modules/billing/billing.service.ts#L709) | S | **A** |
| 16 | `featuredCreditCost7d` | número ≥1 | 30 | Créditos del destacado de 7 días | [billing.service.ts:1384](../apps/api/src/modules/billing/billing.service.ts#L1384) | S | **A** |
| 17 | `featuredCreditCost14d` | número ≥1 | **30** (⚠ fallback compartido) | Ídem 14 días | ídem | S | **A** |
| 18 | `featuredCreditCost30d` | número ≥1 | **30** (⚠ fallback compartido) | Ídem 30 días | ídem | S | **A** |
| 19 | `proExtraCreditsPercent` | % 0-100 | 20 | Bonus de créditos de un Pro al comprar pack. Se **congela** en la compra | [redsys.service.ts:328](../apps/api/src/modules/redsys/redsys.service.ts#L328) | S | **A** |
| 20 | `proMonthlyBumpQuota` | número ≥1 | 4 | Bumps gratis/mes de un Pro | [entitlement.service.ts:426](../apps/api/src/modules/billing/entitlement.service.ts#L426) | S | **A** |
| 21 | `proExtraBumpsPercent` | % 0-100 | 20 | Bonus de bumps al comprar pack de bumps | [redsys.service.ts:328](../apps/api/src/modules/redsys/redsys.service.ts#L328) | S | **A** |
| 22 | `supportEmail` | string (email) | `null` | Buzón único de avisos de tickets. Vacío = sólo aviso in-app + warning | [ticket-notifications.service.ts:189](../apps/api/src/modules/tickets/ticket-notifications.service.ts#L189) | — | **A** |
| 23 | `ticketAutoCloseWindowDays` | número ≥1 | 14 | Ventana de reapertura **y** de cierre automático (un solo valor) | [tickets.service.ts:1229](../apps/api/src/modules/tickets/tickets.service.ts#L1229) | — | **A** |
| 24 | `maxTagsPerListing` | número ≥1 | 5 | Tope de tags por anuncio | [tags.service.ts:270](../apps/api/src/modules/tags/tags.service.ts#L270) | — | **A** |
| 25 | `bumpAutoEnabled` | booleano | **`true`** | Freno de mano del cron de bump automático | [bump-schedule.service.ts:181](../apps/api/src/modules/bump-schedule/bump-schedule.service.ts#L181) | S | **A** |
| 26 | `maxBumpSchedulesPerUser` | número ≥1 | 10 | Tope de programaciones de bump activas por usuario | [bump-schedule-crud.service.ts:241](../apps/api/src/modules/bump-schedule/bump-schedule-crud.service.ts#L241) | S | **A** |
| 27 | `videoEnabled` | booleano | `false` | Interruptor del vídeo Pro (MP4, ≤60 s, ≤50 MB) | [video.service.ts:394](../apps/api/src/modules/video/video.service.ts#L394) | S | **A** |
| 28 | `attributeRevalidationEnabled` | booleano | `false` | Interruptor de la regla de atributos (marca, no despublica) | [attribute-revalidation.rule.ts:68](../apps/api/src/modules/listing-gate/rules/attribute-revalidation.rule.ts#L68) | S | **A** |
| 29 | `preModerationAllListings` | booleano | `false` | Moderación previa, nivel plataforma | [pre-moderation.service.ts:212](../apps/api/src/modules/moderation/pre-moderation.service.ts#L212) | — | **A** |
| 30 | `preModerationTrustedExempt` | booleano | `false` | ¿La insignia de confianza exime de la revisión general? | [:218](../apps/api/src/modules/moderation/pre-moderation.service.ts#L218) | — | **A** |
| 31 | `detectionModes` | `{WORD,PHONE,PHONE_LIST}→WARN\|BLOCK` | `{WORD:BLOCK, PHONE:WARN, PHONE_LIST:WARN}` | El «ascenso» de cada detector | [detection.engine.ts:141](../apps/api/src/modules/moderation/detection/detection.engine.ts#L141) | — | **A** |
| 32 | `flaggedIps` | `string[]` | `[]` | IPs bajo vigilancia (marca, no bloquea) | [admin.service.ts:3289](../apps/api/src/modules/admin/admin.service.ts#L3289) | — | **A** |
| 33 | `flaggedPhones` | `string[]` | `[]` | Teléfonos bajo vigilancia | [phone-list.detector.ts:59](../apps/api/src/modules/moderation/detection/detectors/phone-list.detector.ts#L59) | — | **A** |

**Nota sobre #17/#18:** `getCreditCostForFeatured` cae a **30 para cualquier duración** si falta la
fila ([billing.service.ts:1386](../apps/api/src/modules/billing/billing.service.ts#L1386)). Las
tres están sembradas, así que hoy no muerde; pero si alguien borrara la fila de 30 días, un
destacado de 30 días pasaría a costar el precio del de 7. No es un defecto de esta auditoría —se
anota porque afecta a cómo se redacta la descripción de esas tres claves (§5).

**Nota sobre los defaults que la UI enseña:** `detectionModes`, `flaggedIps` y `flaggedPhones` son
las **tres únicas claves del whitelist sin entrada en `SETTING_DEFAULTS`**
([admin.service.ts:355-394](../apps/api/src/modules/admin/admin.service.ts#L355-L394)), así que
`GET` las devuelve con `value: null`. Es **benigno** y verificado: los tres editores derivan su
propio estado vacío (`DetectionModesEditor` lee los modos de `GET /admin/detection/stats`, que
resuelve los de nacimiento; los dos de lista pintan un textarea vacío). No hace falta tocarlo.

### 2.2 Las 6 claves FUERA de la whitelist — aquí está el trabajo de consolidar

| Clave | Tipo | Default | Qué hace | Editable hoy | Clase |
|---|---|---|---|---|---|
| `fiscalIssuer` | objeto JSON | — | Datos fiscales del EMISOR (NIF, razón social, domicilio). Sin `taxId` + `fiscalName` **no se puede emitir ninguna factura** — [invoicing.service.ts:353-356](../apps/api/src/modules/invoicing/invoicing.service.ts#L353-L356) | Sí, `PUT /admin/fiscal-issuer` → [/admin/facturas/emisor](../apps/web/src/app/(admin)/admin/facturas/emisor/page.tsx) | **B** |
| `fiscalInvoicingPeriodicity` | enum `MONTHLY`\|`QUARTERLY` | `QUARTERLY` | Cada cuánto factura el cron diario de las 04:00 — [invoicing-schedule.service.ts:177](../apps/api/src/modules/invoicing/invoicing-schedule.service.ts#L177) | **NO — sólo por SQL** | **A** (a consolidar) |
| `fiscalSelfServiceWindow` | número (meses) | 6 | Cuántos meses atrás puede un usuario pedirse una factura solo — [invoicing.service.ts:332](../apps/api/src/modules/invoicing/invoicing.service.ts#L332) | **NO — sólo por SQL** | **A** (a consolidar) |
| `fiscalInvoicingLastPeriod` | string (`2026-Q3`) | `null` | **Marca del cron**: último periodo ya despachado. Da idempotencia y recuperación — [:182-190](../apps/api/src/modules/invoicing/invoicing-schedule.service.ts#L182-L190) | No | **C** |
| `defaultSuspensionDays` | número >0 | `null` (= suspensión indefinida) | Duración por defecto al suspender sin `days` — [admin.service.ts:2097-2104](../apps/api/src/modules/admin/admin.service.ts#L2097-L2104) | **NO — sólo por SQL** | **A** (a consolidar) |
| `messageEmailGraceMinutes` | número >0 | 10 | Minutos de gracia antes del email de «tienes un mensaje sin leer» — [message-notifications.service.ts:164](../apps/api/src/modules/messaging/message-notifications.service.ts#L164) | **NO — sólo por SQL** | **A** (a consolidar) |

**Por qué `fiscalIssuer` se queda en su página (B), y no es pereza.** Su endpoint hace tres cosas
que un campo genérico de `/admin/ajustes` no puede hacer: valida el NIF/CIF español con su DTO,
**escribe su propio audit log** con `resourceId: 'fiscalIssuer'`
([admin-invoicing.service.ts:154-165](../apps/api/src/modules/invoicing/admin-invoicing.service.ts#L154-L165)),
y sostiene la regla de no-retroactividad (las facturas ya emitidas llevan el emisor **congelado**,
`FrozenFiscalParty`). Meterlo en el `upsert` genérico rompería las tres. **Decisión: se queda, y
`/admin/ajustes` gana un enlace a su página** (§4, grupo Facturación).

**Por qué `fiscalInvoicingLastPeriod` es C y nunca debe ser editable.** No es configuración: es la
memoria del cron. Retrasarla hace que el cron **re-despache periodos ya facturados**; adelantarla
hace que **se salte un trimestre entero sin emitir**. La idempotencia (`idempotencyKey @unique`)
protege del primer caso, **no del segundo**. Es exactamente el ejemplo que el encargo nombraba.

### 2.3 Recuento de la clasificación

| Clase | Nº | Claves |
|---|---|---|
| **A · editable aquí** | **35** | Las 31 vivas de §2.1 + las 4 huérfanas de §2.2 |
| **B · editable en su página** | 1 | `fiscalIssuer` |
| **C · nunca editable** | 1 | `fiscalInvoicingLastPeriod` |
| **D · muerto (decidir antes de describir)** | 2 | `listingExpiryDays`, `contactRequiresVerification` |

---

## 3. Los dos ajustes MUERTOS — la barrera de veracidad

Esto no es una sospecha: **el repositorio lo tiene escrito en tres sitios distintos**, cada uno
usándolo como escarmiento para no repetirlo.

> «en este repo ya hay **DOS ajustes muertos** —`listingExpiryDays` y `contactRequiresVerification`:
> declarados, sembrados, editables y con **cero lectores**»
> — [category.types.ts:19-24](../apps/api/src/modules/categories/category.types.ts#L19-L24)

> «⚠ Con su LECTOR o no nace: aquí ya hay dos ajustes muertos (`listingExpiryDays`,
> `contactRequiresVerification`), y un interruptor que nadie lee es peor que no tenerlo.»
> — [listing-gate.types.ts:139-141](../apps/api/src/modules/listing-gate/listing-gate.types.ts#L139-L141)

> «este repo ya arrastra dos ajustes muertos … y un interruptor sin lector es peor que no tenerlo.»
> — [attribute-revalidation.rule.ts:11-13](../apps/api/src/modules/listing-gate/rules/attribute-revalidation.rule.ts#L11-L13)

**Verificado independientemente:**

- `listingExpiryDays`: un `grep` en todo `apps/api/src` da **5 apariciones, todas comentarios o la
  whitelist**. Ningún `Setting.findUnique` lo consulta. La caducidad real la calcula
  `ExpirationService.expiresAt()` con `EXPIRY_DAYS = 60`, una **constante**
  ([expiration.service.ts:10,172-174](../apps/api/src/modules/expiration/expiration.service.ts#L10)).
  Y hay una **tercera copia del 60** en el frontend: `LISTING_EXPIRY_DAYS = 60`
  ([apps/web/src/config/index.ts](../apps/web/src/config/index.ts)).
- `contactRequiresVerification`: aparece en la whitelist, en el seed y en `admin.e2e-spec.ts`.
  **En ningún servicio de messaging.** Un usuario sin verificar contacta hoy igual, esté el
  interruptor como esté.

**Consecuencia sobre las descripciones actuales, que es lo que las hace peligrosas:**

| Clave | Lo que dice la UI hoy | Lo que hace |
|---|---|---|
| `listingExpiryDays` | «Número de días desde la publicación hasta que un anuncio activo caduca automáticamente» + helpText «Los anuncios en estado ACTIVE que superen este período sin renovarse pasarán a EXPIRED» | Nada. Caducan a los 60 siempre |
| `contactRequiresVerification` | «los usuarios con email no verificado no podrán iniciar conversaciones» | Nada. Contactan igual |

Son **descripciones correctas de una funcionalidad que no existe**, que es la peor combinación
posible: quien las lee no tiene forma de dudar.

**Las tres salidas, y la recomendación.** Esto es una decisión de Ernest, no de la auditoría:

| Salida | Qué implica | Valoración |
|---|---|---|
| **(a) Darles lector** | `listingExpiryDays`: cambiar `EXPIRY_DAYS` por una lectura del Setting en `ExpirationService.expiresAt()`. **Ojo:** `expiresAt` se escribe en 5 sitios y se congela por anuncio, así que el cambio **sólo afecta a lo que se publique después** — hay que decirlo en la descripción. `contactRequiresVerification`: exige una regla nueva en messaging (a quién frena, con qué mensaje, qué pasa con las conversaciones ya abiertas) | `listingExpiryDays` es **barato y valioso** (60 días es justo el tipo de número que un nicho distinto querrá tocar). `contactRequiresVerification` es una feature, no un arreglo |
| **(b) Sacarlos de la whitelist y de la UI** | Deja de mentir. Las filas sembradas quedan huérfanas (inertes, sin daño) | Honesto e inmediato. Es lo correcto para `contactRequiresVerification` si no se va a implementar |
| **(c) Marcarlos «sin efecto» en la UI** | Un aviso ámbar en la tarjeta: «Este ajuste no tiene efecto todavía» | Peor que (b): mantiene un control que no controla nada |

**Recomendación:** **(a) para `listingExpiryDays`** —es el que más gana una instalación de nicho— y
**(b) para `contactRequiresVerification`**, salvo que Ernest quiera la feature, en cuyo caso deja de
ser trabajo de esta auditoría y pasa a ser una ráfaga propia. **En ningún caso se consolida ni se
reordena la página dejando las descripciones actuales**: sería certificar la mentira.

---

## 4. LA ORGANIZACIÓN — `/admin/ajustes` por temas

Hoy: 29 tarjetas planas + un `<h2>Monetización</h2>` al final con 4 más y el editor de precios.
Los grupos ya existen en la cabeza de quien escribió el `ORDER` (los comentarios lo dicen: «van
JUSTO DEBAJO de los de activos», «junto al resto de ventajas de Pro»); sólo hay que **sacarlos a
la pantalla**.

**Propuesta: 7 grupos con encabezado visible + un índice de anclas arriba.** El criterio de orden
entre grupos es **frecuencia de uso × urgencia**: lo que se toca en una incidencia primero, lo que
se toca una vez al montar la instancia al final.

### Grupo 1 · Moderación y contenido *(lo que se toca en una incidencia)*
| Orden | Clave | Control |
|---|---|---|
| 1 | `preModerationAllListings` | booleano |
| 2 | `preModerationTrustedExempt` | booleano |
| 3 | `detectionModes` | enum × 3 detectores |
| 4 | `badWordList` | lista |
| 5 | `flaggedPhones` | lista |
| 6 | `flaggedIps` | lista |

*Por qué así:* los dos interruptores de política arriba, el ascenso de detectores en medio (es lo
que se mira antes de tocar las listas), y las tres listas juntas al final porque se mantienen a
mano y se leen igual. `contactRequiresVerification` **no aparece** — decisión §3.

### Grupo 2 · Publicación y límites de anuncios
| Orden | Clave | Control |
|---|---|---|
| 1 | `freeActiveListingLimit` | número |
| 2 | `proActiveListingLimit` | número |
| 3 | `freeTotalListingLimit` | número |
| 4 | `proTotalListingLimit` | número |
| 5 | `totalListingLimitEnabled` | booleano |
| 6 | `maxPhotosPerListing` | número |
| 7 | `minPhotosPerListing` | número |
| 8 | `minPhotosRuleEnabled` | booleano |
| 9 | `maxTagsPerListing` | número |
| 10 | `emailVerifiedToPublishEnabled` | booleano |
| 11 | `attributeRevalidationEnabled` | booleano |
| 12 | *(`listingExpiryDays`, si se le da lector)* | número |

*Por qué así:* **los cuatro límites tienen que verse juntos y en ese orden** porque el backend
valida la invariante `total > activos` en las dos direcciones
([admin.service.ts:3369-3399](../apps/api/src/modules/admin/admin.service.ts#L3369-L3399)):
separarlos invita a editar uno y comerse un 400 sin entender por qué. Igual el par de fotos
(`min ≤ max`). Los interruptores van **debajo** de los números que gobiernan, no encima.

### Grupo 3 · Ventajas Pro y cuotas
`proMonthlyFeaturedQuota` → `proQuotaFeaturedDurationDays` → `proMonthlyBumpQuota` →
`proExtraCreditsPercent` → `proExtraBumpsPercent` → `videoEnabled`

*Por qué así:* las cuotas antes que los bonus (se consultan más), y el vídeo cierra el grupo porque
es una ventaja Pro más y ahí es donde un admin va a buscarla.

### Grupo 4 · Monetización *(el bloque que ya existe, sin tocar)*
`bumpCreditCost` → `featuredCreditCost7d` → `14d` → `30d` → el `PriceListEditor` de Redsys.

*Por qué así:* ya está agrupado y titulado, y el `PriceListEditor` recibe los tres costes de
destacado como props ([page.tsx:1354-1361](../apps/web/src/app/(admin)/admin/ajustes/page.tsx#L1354-L1361))
— separarlos rompería la lectura «créditos vs. euros» que el panel ya ofrece.

### Grupo 5 · Bump automático
`bumpAutoEnabled` → `maxBumpSchedulesPerUser`

*Por qué grupo propio y no dentro de Monetización:* `bumpAutoEnabled` es el **freno de mano** de la
única función que gasta saldo de los usuarios sin que estén delante. En una incidencia hay que
encontrarlo en dos segundos, y enterrado entre precios no se encuentra. Va con su propio
encabezado y de los primeros en el índice de anclas.

### Grupo 6 · Atención al usuario
`supportEmail` → `ticketAutoCloseWindowDays` → **`messageEmailGraceMinutes`** *(nuevo)* →
**`defaultSuspensionDays`** *(nuevo)*

*Por qué:* los cuatro son «cómo trata la plataforma a la persona al otro lado». `defaultSuspensionDays`
podría discutirse en Moderación; se pone aquí porque **es un plazo**, como los otros tres, y porque
en Moderación quedaría entre interruptores de política y se leería como uno más.

### Grupo 7 · Facturación
**`fiscalInvoicingPeriodicity`** *(nuevo, select)* → **`fiscalSelfServiceWindow`** *(nuevo, número)*
→ **una tarjeta de solo lectura con enlace a `/admin/facturas/emisor`** («Emisor fiscal —
configurado / SIN CONFIGURAR», con el aviso de que sin él no se emite ninguna factura).

*Por qué así:* consolida los dos huérfanos fiscales sin tocar el emisor, y hace visible desde
Ajustes que existe una segunda página. La tarjeta de estado del emisor puede leerse de
`GET /admin/fiscal-issuer`, que ya devuelve `{ configured, issuer }`
([admin-invoicing.service.ts:131-132](../apps/api/src/modules/invoicing/admin-invoicing.service.ts#L131-L132)).

### Lo que hace falta en el backend para los grupos 6 y 7

Ampliar `SETTING_KEYS` con **4 claves**, y **cada una con su guarda**:

| Clave | Guarda que hay que añadir | Por qué |
|---|---|---|
| `messageEmailGraceMinutes` | `POSITIVE_INT_SETTING_KEYS` | Un 0 mandaría el email al instante; el lector ya trata `<= 0` como «no configurado», pero guardar un 0 dejaría el ajuste **mintiendo en la pantalla** (enseña 0, se aplica 10) |
| `defaultSuspensionDays` | `POSITIVE_INT_SETTING_KEYS` **+ nota en la descripción** | Mismo caso: `<= 0` = «no configurado» = suspensión indefinida. La UI necesita un modo explícito «sin duración por defecto» (borrar la fila), no un 0 |
| `fiscalSelfServiceWindow` | `POSITIVE_INT_SETTING_KEYS` | Igual: `<= 0` cae al default de 6 |
| `fiscalInvoicingPeriodicity` | **guarda de enum nueva** (`'MONTHLY'` \| `'QUARTERLY'`) | El lector hace `String(v) === 'MONTHLY' ? 'MONTHLY' : 'QUARTERLY'`: **cualquier basura se lee como QUARTERLY en silencio**. Sin guarda, un dedazo cambia la periodicidad fiscal sin decir nada |

**Y una barrera de proceso:** ampliar la whitelist **sólo** con estas 4. No se añaden
`fiscalInvoicingLastPeriod` (clase C) ni ninguna clave futura sin pasar por esta misma
clasificación.

---

## 5. LAS DESCRIPCIONES — verificadas una a una contra el código

Método: leer la descripción de la UI y el lector del Setting, y comparar. Resultado sobre las 33
claves pintadas hoy:

| Veredicto | Nº |
|---|---|
| **Correcta y útil** (recordatorio + explicación, con el matiz que importa) | **24** |
| **MIENTE** (dice un efecto que el código no tiene) | **4** |
| **Incompleta** (verdad a medias que induce a error) | **1** |
| **Pobre** (correcta, pero le falta lo que de verdad hay que recordar) | **4** |
| **Ausente** | **0** |

**Cobertura verificada: 33 de 33.** Cotejo mecánico de las 29 claves del array `ORDER` contra las
29 de `SETTING_DESCRIPTIONS` ([page.tsx:765-824](../apps/web/src/app/(admin)/admin/ajustes/page.tsx#L765-L824)):
**coinciden exactamente**, sin claves sin describir ni descripciones huérfanas. Las 4 de
monetización tienen las suyas en `MONETIZATION_DESCRIPTIONS`. **No hay ningún ajuste mudo en esta
página** — el problema no es de cobertura, es de exactitud en 5 de ellas.

**El nivel general es alto** — la mayoría de descripciones son mejores que la media del sector:
dicen el efecto, el no-efecto («no toca los ya publicados»), el default y la consecuencia de
encender. `preModerationAllListings`, `flaggedIps`, `videoEnabled`, `freeTotalListingLimit` y
`bumpAutoEnabled` son ejemplares y **no hay que tocarlas**. Lo que sigue es sólo lo que falla.

### 5.1 Las que MIENTEN (4) — prioridad máxima

**① `listingExpiryDays`** y **② `contactRequiresVerification`** — §3. No se reescriben: se les da
lector o se retiran.

**③ `freeActiveListingLimit`** y **④ `proActiveListingLimit`** — el helpText de las dos dice:

> «Al superar este límite, los anuncios más antiguos **pasan a borrador** al publicar uno nuevo.»
> — [page.tsx:1047 y :1058](../apps/web/src/app/(admin)/admin/ajustes/page.tsx#L1047)

**Falso en el camino normal.** `ActiveListingLimitRule` **bloquea la transición**: devuelve
`ACTIVE_LIMIT_REACHED` con «Has alcanzado el límite de N anuncios activos de tu plan» y el anuncio
**no se publica**. Nadie pasa a borrador
([active-listing-limit.rule.ts:73-116](../apps/api/src/modules/listing-gate/rules/active-listing-limit.rule.ts#L73-L116)).

El paso-a-borrador **existe**, pero en otro sitio y por otro motivo: cuando una suscripción Pro
caduca y pasa el periodo de gracia, el barrido de degradación manda a DRAFT los **más antiguos**
que excedan de `freeActiveListingLimit`
([entitlement-expiration.service.ts:168-200](../apps/api/src/modules/expiration/entitlement-expiration.service.ts#L168-L200)).
Es decir: la frase describe un efecto real, **pegado a la clave equivocada y con el disparador
equivocado**. Y es sólo de `freeActiveListingLimit`: `proActiveListingLimit` **no interviene** en
esa degradación, así que en la tarjeta de Pro la frase es falsa dos veces.

*Descripción propuesta — `freeActiveListingLimit`:*
> **Cuántos anuncios puede tener publicados (ACTIVE) a la vez un usuario del plan gratuito.**
> Al llegar al tope, publicar o reactivar otro **se rechaza** con un aviso que le ofrece Pro (sólo
> si el tope de Pro es mayor que éste). No se despublica nada de lo que ya esté activo. Cuenta
> también el propio anuncio al renovarlo, así que renovar justo en el tope falla — es el
> comportamiento de siempre. Tiene un segundo efecto: **cuando una suscripción Pro caduca**, los
> anuncios activos del ex-Pro que pasen de este número se guardan como borrador, **los más
> antiguos primero**. El staff está exento: un moderador puede aprobar por encima del cupo.
> *Rango sensato: 3-20. Debe ser menor que el límite TOTAL de Free.*

*Descripción propuesta — `proActiveListingLimit`:*
> **Lo mismo para un usuario con plan Pro.** Al llegar al tope, publicar otro se rechaza; a un Pro
> no se le ofrece nada más, así que su mensaje se queda en el aviso a secas. **Debe ser mayor que
> el de Free** o /planes acabaría anunciando como ventaja algo que el plan gratuito ya da igual o
> mejor. *Rango sensato: 20-100. Debe ser menor que el límite TOTAL de Pro.*

### 5.2 La incompleta (1)

**⑤ `detectionModes`** — la descripción empieza:

> «El motor busca **dos cosas** en el título y la descripción de cada anuncio: palabras de la lista
> de arriba y teléfonos escritos en el texto…»
> — [page.tsx:794-795](../apps/web/src/app/(admin)/admin/ajustes/page.tsx#L794)

Son **tres** detectores, y el propio editor de abajo pinta los tres:
`WORD` («Palabra de la lista»), `PHONE` («Teléfono en el texto») y `PHONE_LIST` («Teléfono
marcado») — [detection.types.ts:128-141](../apps/api/src/modules/moderation/detection/detection.types.ts#L128-L141)
y [etiquetas.ts:223-235](../apps/web/src/app/(admin)/admin/etiquetas.ts#L223-L235). El párrafo
enumera dos y luego el admin ve tres selectores. La descripción de `flaggedPhones` **sí** menciona
que su detector se asciende aquí, así que la incoherencia es sólo de este texto.

*Corrección mínima (el resto del párrafo es correcto y se conserva):*
> «El motor busca **tres cosas** en el título y la descripción de cada anuncio: palabras de la
> lista, teléfonos escritos en el texto (cualquiera) y **teléfonos de la lista de marcados** (sólo
> los que hayas puesto tú). El detector de IPs sobre texto se retiró — las IPs se vigilan por su
> propia lista y sobre la última conexión, no sobre el texto. Aquí se decide qué pasa cuando
> encuentra algo…»

### 5.3 Las ausentes: ninguna

Se comprobó una a una: **las 33 claves pintadas tienen descripción.** No hay nada que añadir por
este lado, y es un dato que conviene dejar escrito porque es lo contrario de lo que suele pasar en
una página de ajustes que ha crecido a lo largo de veinte ráfagas.

Un matiz de mantenimiento: las 4 de monetización viven en un mapa **aparte**
(`MONETIZATION_DESCRIPTIONS`, [page.tsx:842](../apps/web/src/app/(admin)/admin/ajustes/page.tsx#L842)),
no en `SETTING_DESCRIPTIONS`. Al reorganizar por grupos (§4) conviene **unificar los dos mapas en
uno**: dos sitios donde buscar una descripción es como acaban divergiendo, y el propio repo ya pagó
ese precio con las etiquetas de `ReportReason`.

### 5.4 Las pobres (4) — los costes en créditos

`bumpCreditCost` dice hoy: «Créditos que se descuentan al usuario cada vez que sube un anuncio a la
parte superior del listado.» **Correcto pero incompleto en lo que más importa**: ese número es la
**base**, no lo que se cobra. Verificado en [billing.service.ts:709-719](../apps/api/src/modules/billing/billing.service.ts#L709-L719):
una campaña activa de tipo `BUMP` aplica un descuento porcentual con `Math.floor` a favor del
usuario, y además la cuota mensual de bumps de Pro y el saldo por cupón se consumen **antes** que
los créditos.

*Descripción propuesta — `bumpCreditCost`:*
> **Créditos que cuesta un bump manual.** Es el **precio base**: si hay una campaña de descuento de
> bumps activa, se cobra menos (el redondeo es a favor del usuario), y un Pro con cuota mensual o
> con saldo de bumps por cupón **no gasta créditos en absoluto** — esas bolsas se consumen antes.
> Cambiarlo afecta desde el instante siguiente; los bumps ya cobrados no se recalculan.
> *Rango sensato: 1-20.*

*Descripción propuesta — los tres `featuredCreditCost*`:*
> **Créditos que cuesta destacar un anuncio N días pagando con saldo de créditos.** No es el precio
> en euros (ése está en «Precios (Redsys)», abajo): son dos monedas para el mismo producto y
> conviene mirarlas juntas. Los tres valores deben guardar una proporción coherente entre sí — un
> destacado de 30 días más barato que el de 7 sería comprable a trozos. *Rango sensato: 20-200.*

### 5.5 Las 4 claves nuevas (§4, grupos 6 y 7) — descripciones desde cero

| Clave | Descripción propuesta |
|---|---|
| `messageEmailGraceMinutes` | **Minutos que la plataforma espera antes de avisar por correo de un mensaje sin leer.** Si el destinatario abre la conversación dentro de esa ventana, **el correo no se manda**: sólo avisa a quien de verdad no lo ha visto. Subirlo reduce correos y retrasa el aviso; bajarlo hace lo contrario. Afecta sólo a los mensajes que lleguen a partir del cambio (los avisos ya programados salen con la ventana antigua). *Default 10. Rango sensato: 5-60.* |
| `defaultSuspensionDays` | **Días que dura una suspensión cuando el moderador no indica una duración.** Sin configurar, esa suspensión es **indefinida** —lo que ha hecho siempre el botón «Suspender»—, así que poner aquí un número **cambia el efecto de un botón que el equipo ya usa**. No toca ninguna suspensión en curso. *Sin default. Rango sensato: 3-30.* |
| `fiscalSelfServiceWindow` | **Cuántos meses atrás puede un usuario pedirse una factura por su cuenta**, contados sobre la fecha de la **operación**, no la del pago. Fuera de esa ventana la pide al soporte. Bajarlo cierra la puerta a operaciones antiguas de inmediato; no invalida ninguna factura ya emitida. *Default 6 meses. El plazo fiscalmente correcto lo confirma el asesor.* |
| `fiscalInvoicingPeriodicity` | **Cada cuánto emite facturas el proceso automático**: trimestral (por defecto) o mensual. El cron se despierta a diario a las 04:00 y pregunta si hay algún periodo **cerrado sin facturar**; con ese diseño, cambiar la periodicidad **puede disparar una emisión de los periodos del nuevo calendario que aún no se hayan facturado**. ⚠ No lo cambies a mitad de un ejercicio sin hablarlo con el asesor: la periodicidad de facturación es una decisión fiscal, no una preferencia. |

### 5.6 La regla de redacción, para que esto no se degrade

Las buenas descripciones de esta página ya siguen un patrón. Conviene escribirlo para las futuras:

1. **Primera frase: qué hace, en una línea** — el recordatorio para quien ya lo conoce.
2. **Qué NO hace** — es lo que más error de configuración evita («no toca los ya publicados»,
   «no borra nada», «no despublica»).
3. **Unidades y default explícitos.**
4. **Rango sensato**, cuando es un número.
5. **La invariante**, si el backend la valida (`total > activos`, `min ≤ max`) — antes de que la
   descubra como un 400.
6. **⚠ para lo irreversible o lo caro** (coste, efecto sobre gente ya registrada, decisión fiscal).

---

## 6. EL PANEL DE INFO NO CONFIGURABLE — la lista a aprobar

**No existe nada de esto hoy**: ni endpoint, ni página, ni entrada de nav. Se propone
`/admin/instancia` (grupo «Plataforma», `minRole: ADMIN`) alimentado por un
`GET /admin/instance-info` nuevo.

### 6.1 El criterio de seguridad (innegociable)

**El endpoint devuelve un objeto CONSTRUIDO CAMPO A CAMPO. Nunca `process.env`, ni un subconjunto
«filtrado», ni un spread.** La diferencia práctica: con una lista explícita, una variable nueva en
`.env` **no aparece sola** en la respuesta; con un filtro, un día aparece.

| ✅ Se puede exponer | ❌ NUNCA |
|---|---|
| Una **dirección de correo** (`RESEND_FROM`, `supportEmail`) | La **API key** que la manda (`RESEND_API_KEY`) |
| Un **dominio o URL pública** (`APP_URL`, `S3_PUBLIC_URL`) | Las **credenciales** de ese servicio (`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`) |
| El **nombre del proveedor** («Redsys», «stub») | La **clave de firma** (`REDSYS_SECRET_KEY` — el HMAC), `STRIPE_SECRET_KEY`, `JWT_SECRET`, `CONTACT_FORM_SECRET`, `MEILI_MASTER_KEY`, `AUTH_SECRET` |
| El **host** de un servicio interno, si el panel es ADMIN-only | La `DATABASE_URL` (lleva usuario y contraseña **dentro de la cadena**) |
| Un **booleano «está configurado»** (`configurado: sí/no`) | El valor que hace que esté configurado |
| El `SENTRY_DSN` público (`NEXT_PUBLIC_SENTRY_DSN`) — el propio `.env.example` documenta que no es secreto | El `DSN` de servidor, por prudencia: no aporta nada extra |

**Y una regla derivada, que es la que evita el accidente:** para todo lo que sea una credencial,
el panel enseña **el hecho de estar configurada, nunca un fragmento**. Nada de «`re_ab…3f9`»: los
últimos caracteres de una clave no son públicos y no ayudan a nadie a confirmar nada.

### 6.2 La lista concreta — 22 datos (para aprobar)

**Prioridad:** ⭐⭐⭐ = **difiere entre instancias y confirmarlo evita un incidente** (el porqué del
encargo) · ⭐⭐ = difiere, útil · ⭐ = igual en todas, contexto.

#### Bloque A — Identidad de la instancia

| # | Dato | Fuente | Seguro | Prior. | Por qué es útil |
|---|---|---|---|---|---|
| 1 | Nombre de la plataforma | `SITE_NAME` — [config/index.ts](../apps/web/src/config/index.ts) (constante de build) | ✅ | ⭐⭐⭐ | Es lo primero que distingue un nicho de otro. Hoy es una **constante en código**: confirmar cuál está desplegada aquí |
| 2 | Descripción / claim | `SITE_DESCRIPTION` — ídem | ✅ | ⭐⭐ | Sale en los metadatos SEO de todas las páginas |
| 3 | Dominio público (frontend) | `APP_URL` → `config.appUrl` — [app-origin.ts](../apps/api/src/config/app-origin.ts) | ✅ | ⭐⭐⭐ | **El dato más peligroso si está mal**: es el origen del CORS del WebSocket **y** la base de todos los enlaces de los correos. Un `APP_URL` de staging en producción manda a la gente al sitio equivocado |
| 4 | URL pública de la API | `NEXT_PUBLIC_API_URL` — [config/index.ts](../apps/web/src/config/index.ts) | ✅ | ⭐⭐ | Ya está incrustada en el bundle del navegador: no es secreto en ningún sentido |
| 5 | Entorno | `NODE_ENV` | ✅ | ⭐⭐⭐ | «¿estoy mirando producción?» — la pregunta que precede a cualquier cambio |

#### Bloque B — Correos (el corazón del encargo)

| # | Dato | Fuente | Seguro | Prior. | Por qué es útil |
|---|---|---|---|---|---|
| 6 | **Remitente** de todos los correos | `RESEND_FROM` → `config.resend.from` (default `noreply@tudominio.es`) — [configuration.ts:23](../apps/api/src/config/configuration.ts#L23) | ✅ | ⭐⭐⭐ | **El default es un placeholder que parece un dominio real.** Una instancia que no lo defina manda desde `noreply@tudominio.es` y no lo nota nadie. Confirmarlo aquí es exactamente el caso de uso |
| 7 | **Buzón de soporte** | `Setting.supportEmail` | ✅ | ⭐⭐⭐ | Sin configurar, los avisos de ticket **no salen por correo** y sólo queda un `logger.warn` que nadie lee ([ticket-notifications.service.ts:194](../apps/api/src/modules/tickets/ticket-notifications.service.ts#L194)). Es configurable en Ajustes, pero **pertenece también aquí**: el panel es «los correos de esta instancia, de un vistazo» |
| 8 | Proveedor de email | Literal `Resend` + `RESEND_API_KEY` **configurada: sí/no** | ✅ (el booleano) | ⭐⭐ | La clave es obligatoria por Joi, así que el booleano será siempre «sí»; se incluye por simetría con los demás y para que un fallo de arranque se explique solo |
| 9 | Correo de contacto público | **No existe como dato de instancia** — los mensajes de `/contacto` van a `ContactMessage` en BD, y los motivos (`ContactReason`) **no llevan destinatario** | — | — | **Se marca como «no aplica»** en vez de inventarlo. Si algún día hay uno, entra aquí |

#### Bloque C — Proveedores activos

| # | Dato | Fuente | Seguro | Prior. | Por qué es útil |
|---|---|---|---|---|---|
| 10 | **Facturación: proveedor** | `INVOICING_PROVIDER` → `config.invoicing.provider` — [configuration.ts:47-49](../apps/api/src/config/configuration.ts#L47-L49). Joi sólo admite `'stub'` hoy | ✅ | ⭐⭐⭐ | **El dato más valioso del panel.** Hoy es **`stub`, y el stub NO emite facturas fiscalmente válidas** — está escrito en el propio config y en el módulo. Enseñarlo con un aviso ámbar explícito («no emite facturas válidas») es lo que impide que alguien dé por buena una factura emitida |
| 11 | **Emisor fiscal configurado** | `Setting.fiscalIssuer` → `{ configured }` de `GET /admin/fiscal-issuer` | ✅ (sólo el booleano + razón social) | ⭐⭐⭐ | Sin `taxId` + `fiscalName` **no se emite ninguna factura**. Es un fallo silencioso hasta que alguien pide una |
| 12 | **Pago — recurrente** | Stripe: `STRIPE_SECRET_KEY` **configurada: sí/no** | ✅ (el booleano) | ⭐⭐⭐ | Verificado: **Stripe sólo cubre la suscripción Pro** ([billing.service.ts:96-104](../apps/api/src/modules/billing/billing.service.ts#L96)). Sin clave, el cliente lanza al primer checkout |
| 13 | **Pago — pago único** | Redsys: `REDSYS_MERCHANT_CODE` (código de comercio, **no es secreto**), `REDSYS_TERMINAL`, `REDSYS_ENVIRONMENT` (`test`\|`production`), y `REDSYS_SECRET_KEY` **configurada: sí/no** | ✅ salvo la clave, que **nunca** | ⭐⭐⭐ | Redsys cubre packs de créditos, destacados y bumps. **`REDSYS_ENVIRONMENT=test` en producción cobra en el TPV de pruebas**: es el tipo de error que un panel de confirmación existe para atrapar |
| 14 | Almacenamiento | `S3_ENDPOINT` + `S3_BUCKET` + `S3_PUBLIC_URL` | ✅ | ⭐⭐⭐ | Distingue **MinIO local de R2 de producción** de un vistazo. Las credenciales (`S3_ACCESS_KEY_ID`/`SECRET`) **no se exponen** |
| 15 | Búsqueda | `MEILI_HOST` + `MEILI_INDEX_NAME` | ✅ (host y nombre de índice; **la master key nunca**) | ⭐⭐ | El nombre del índice difiere por instancia y explica un «no encuentro nada» |
| 16 | Geocodificación | `GEOCODING_PROVIDER` (`nominatim`\|`maptiler`) | ✅ | ⭐⭐ | Nominatim va a 1 req/s: saber cuál está activo explica una cola de geocodificación lenta |
| 17 | Login social Google | `GOOGLE_CLIENT_ID` **configurado: sí/no** | ✅ (el booleano; el client ID es público, pero el booleano basta) | ⭐⭐ | Sin él, `/auth/social/google` no funciona y el botón aparece igual |
| 18 | Observabilidad | `SENTRY_DSN` **configurado: sí/no** | ✅ (el booleano) | ⭐ | «¿me estoy enterando de los errores de esta instancia?» |

#### Bloque D — Configuración con efecto, de solo lectura

| # | Dato | Fuente | Seguro | Prior. | Por qué es útil |
|---|---|---|---|---|---|
| 19 | Zona horaria de los procesos | `BUMP_SCHEDULE_TIMEZONE = 'Europe/Madrid'` — [next-run.ts:10](../apps/api/src/modules/bump-schedule/next-run.ts#L10) (constante) + la TZ del sistema (`Intl.DateTimeFormat().resolvedOptions().timeZone`) | ✅ | ⭐⭐⭐ | **Los dos, y juntos, porque pueden discrepar.** Los crons usan la hora del servidor; las programaciones de bump, `Europe/Madrid`. Un servidor en UTC hace que el cron de las 04:00 corra a las 06:00 locales. Es el dato que explica «¿por qué se facturó ayer?» |
| 20 | Moneda | `DEFAULT_CURRENCY = 'EUR'` — [config/index.ts](../apps/web/src/config/index.ts) | ✅ | ⭐ | Constante hoy; se vuelve ⭐⭐⭐ el día que haya una instancia fuera de la eurozona |
| 21 | IVA aplicado | **Por línea de factura** (`InvoiceLine.taxRate`), **no hay un tipo global** — [invoicing.types.ts:40](../apps/api/src/modules/invoicing/invoicing.types.ts#L40) | ✅ | ⭐ | Se enseña como «por línea de factura (no hay un tipo global configurado)». **No inventar un 21 %** que el código no tiene |
| 22 | Periodicidad de facturación y ventana de autoservicio | `Setting.fiscalInvoicingPeriodicity`, `Setting.fiscalSelfServiceWindow` | ✅ | ⭐⭐ | Se **repiten aquí en solo lectura** aunque sean editables en Ajustes: el panel es «cómo está montada esta instancia» y la periodicidad fiscal es de lo primero que se confirma |
| 23 | Versión | `version` de `apps/api/package.json` (`0.1.0`) y `apps/web/package.json` | ✅ | ⭐⭐ | **Hoy ambas son `0.1.0` y no se actualizan.** Útil sólo si se empieza a versionar |
| 24 | Commit / build | **NO EXISTE.** No hay `BUILD_ID`, ni `GIT_SHA`, ni Dockerfile, ni paso de CI que lo inyecte (verificado en [.github/workflows/ci.yml](../.github/workflows/ci.yml)) | — | ⭐⭐⭐ *si se añade* | **Es el dato que más falta** para «¿qué está desplegado en esta instancia?». Requiere una fuente nueva: una env `GIT_SHA` inyectada en el despliegue. **Se propone, no se da por disponible** |

**Total a aprobar: 22 datos disponibles hoy** (#1-#8 y #10-#23) **+ 1 «no aplica»** (#9, no existe
un correo de contacto público) **+ 1 que requiere una fuente nueva** (#24, el commit desplegado).
De los 22, **11 son ⭐⭐⭐**: son los que difieren entre despliegues y cuya confirmación evita un
incidente — el remitente, el dominio, el entorno, el buzón de soporte, los tres de pago/facturación,
el emisor fiscal, el almacenamiento y la zona horaria.

### 6.3 Lo que se propone DEJAR FUERA, y por qué

| Dato | Motivo |
|---|---|
| `DATABASE_URL` (aunque fuera enmascarada) | Lleva credenciales **dentro de la cadena**. Enmascarar es un mecanismo que puede fallar; no exponerla no falla nunca |
| `REDIS_URL` | Igual, y no responde ninguna pregunta que un admin se haga |
| `TRUST_PROXY_HOPS` | Es afinado de infraestructura, no confirmación de instancia. Y decir cuántos saltos de proxy se confían **le dice a un atacante cuántos `X-Forwarded-For` puede falsificar** |
| Cualquier fragmento de clave («últimos 4») | §6.1. Un fragmento no confirma nada que el booleano no confirme |
| `MEILI_MASTER_KEY`, `JWT_SECRET`, `AUTH_SECRET`, `CONTACT_FORM_SECRET`, `RESEND_API_KEY`, `STRIPE_*_KEY`, `REDSYS_SECRET_KEY`, `S3_*_KEY` | Secretos. Ni enmascarados ni parciales ni «sólo en desarrollo» |

### 6.4 Dos observaciones de seguridad encontradas de paso

Ninguna es del alcance del encargo; se anotan porque salieron al buscar las fuentes.

1. **`apps/api/.env.example` lleva claves de Stripe con pinta de reales** —una `sk_test_51TmI1Q…`
   y una `whsec_e86dd…`— en vez de `sk_test_...`. Son de test, así que el riesgo es bajo, pero un
   `.env.example` versionado no es sitio para una credencial con forma de credencial. **Sugerencia:
   sustituirlas por placeholders.** Fuera del alcance de esta auditoría: decisión de Ernest.
2. **`GET /admin/settings` ya devuelve hoy todas las filas de la tabla**, incluida `fiscalIssuer`
   (NIF y domicilio de la plataforma) y las marcas internas. Es ADMIN-only y ninguna es un secreto
   de máquina, así que **no es un fallo**; pero conviene saberlo antes de que alguien baje el piso
   de rol de ese endpoint. Si algún día `/admin/ajustes` se abre a MODERATOR, **esto hay que
   filtrarlo primero**.

---

## 7. EL PLAN — dos ráfagas

Se separa en dos porque **atacan superficies distintas** (arreglar lo que hay vs. crear algo nuevo)
y porque la primera tiene una decisión de Ernest bloqueando su primer paso.

### Ráfaga A — «Los ajustes dicen la verdad, y están ordenados»

*Toda la ráfaga vive en `/admin/ajustes` + `SETTING_KEYS`. Requiere la decisión de §3 antes de
empezar.*

1. **Los dos muertos** — aplicar la decisión de §3 (lector para `listingExpiryDays`; retirada para
   `contactRequiresVerification`). **Es lo primero: mientras estén, cualquier reordenación certifica
   la mentira.**
2. **Las descripciones que fallan** — las 2 de límites de activos (§5.1), la de detectores (§5.2),
   las 4 de costes en créditos (§5.4).
3. **Los 4 huérfanos** — ampliar `SETTING_KEYS` con `messageEmailGraceMinutes`,
   `defaultSuspensionDays`, `fiscalSelfServiceWindow`, `fiscalInvoicingPeriodicity`, **cada uno con
   su guarda** (§4), + el `SelectSettingEditor` que falta + sus 4 descripciones (§5.5).
4. **La organización** — los 7 grupos con encabezado y el índice de anclas (§4), + la tarjeta de
   solo lectura del emisor fiscal con su enlace.

*Verificación:* los e2e de `admin.e2e-spec.ts` ya afirman sobre el whitelist y sobre claves
concretas; ampliarlos a las 4 nuevas (aceptar el válido, rechazar el inválido — en especial el enum
de periodicidad) y añadir el caso que hoy no existe: **una clave fuera del whitelist da 400**.

### Ráfaga B — «Cómo está montada esta instancia»

*Superficie nueva, cero riesgo sobre lo existente. Puede ir en paralelo o después.*

1. `GET /admin/instance-info` — objeto **construido campo a campo** (§6.1), `@MinRole(ADMIN)`.
2. `/admin/instancia` — página de solo lectura, agrupada como §6.2, con **aviso ámbar** en el
   proveedor de facturación mientras sea `stub` y en `REDSYS_ENVIRONMENT` mientras sea `test`.
3. Entrada en `backoffice-sections.ts`, grupo `plataforma`, `minRole: 'ADMIN'`.
4. *(Opcional, si Ernest quiere el dato #24)* env `GIT_SHA` inyectada en el despliegue.

*Verificación:* un test que afirme que la respuesta **no contiene ninguna de las claves de la lista
negra** (§6.3) — se escribe una vez y protege de que alguien añada un campo de más dentro de un año.

---

## 8. LAS BARRERAS (lo que no se puede romper al implementar)

1. **La whitelist sigue siendo la única puerta de escritura.** Se amplía **sólo** con las 4 claves
   clasificadas A en §2.2. Nunca por comodidad, nunca sin clasificar antes.
2. **Ningún estado interno se hace editable.** `fiscalInvoicingLastPeriod` (marca del cron) **no
   entra en el whitelist ni siquiera de solo lectura en Ajustes**. Adelantarla se salta un
   trimestre de facturación en silencio, y la idempotencia no protege de eso.
3. **Cada clave nueva llega con su guarda.** Hoy el DTO acepta cualquier JSON: sin guarda,
   `fiscalInvoicingPeriodicity = "trimestral"` se guarda tan feliz y el lector lo interpreta como
   `QUARTERLY` sin decir nada. **Whitelist sin validación es media puerta.**
4. **Cada clave nueva llega con su lector verificado.** La lección que el propio repo repite tres
   veces: un ajuste sin lector es peor que no tener el ajuste. **No se añade nada a la UI sin
   señalar la línea que lo lee.**
5. **Ninguna descripción se escribe desde la ficha de diseño: se escribe leyendo el lector.** Las
   cuatro que mienten hoy nacieron todas de describir la intención en vez del código.
6. **El panel de info nunca expone un secreto.** Objeto construido campo a campo, jamás
   `process.env` ni un filtro. Booleano «configurado», nunca un fragmento. Con un test que lo
   pince.
7. **El emisor fiscal no se mueve.** Su validación de NIF, su audit log propio y la
   no-retroactividad de las facturas emitidas viven en su endpoint; consolidarlo en el `upsert`
   genérico rompería las tres.

---

## Anexo — qué se verificó y cómo

| Afirmación | Cómo se comprobó |
|---|---|
| 33 claves en el whitelist | Lectura directa de `SETTING_KEYS`, [admin.service.ts:170-290](../apps/api/src/modules/admin/admin.service.ts#L170-L290) |
| 33 pintadas en la UI | Cotejo clave a clave del array `ORDER` + `MONETIZATION_SETTING_KEYS` contra el whitelist |
| 39 claves en total | Barrido de `prisma.setting.(findUnique\|findMany\|upsert\|count)` en todo `apps/api/src` + `SEED_SETTINGS` + tests e2e |
| 18 sembradas | `SEED_SETTINGS`, [seed-settings.ts](../apps/api/prisma/seed-settings.ts), vía `createMany({ skipDuplicates: true })` |
| Los dos ajustes muertos | `grep` exhaustivo de cada clave en `apps/api/src` y `apps/web/src`: ninguna aparición fuera del whitelist, el seed, los tests y **tres comentarios que ya lo denuncian** |
| El límite de activos bloquea, no degrada | [active-listing-limit.rule.ts:73-116](../apps/api/src/modules/listing-gate/rules/active-listing-limit.rule.ts#L73-L116) frente a [entitlement-expiration.service.ts:168-200](../apps/api/src/modules/expiration/entitlement-expiration.service.ts#L168-L200) |
| Tres detectores, no dos | [detection.types.ts:128-141](../apps/api/src/modules/moderation/detection/detection.types.ts#L128-L141) + `DETECTOR_LABELS` |
| El proveedor de facturación es `stub` | [configuration.ts:47-49](../apps/api/src/config/configuration.ts#L47-L49) + Joi `.valid('stub')` en [env.validation.ts:95](../apps/api/src/config/env.validation.ts#L95) |
| Stripe = recurrente, Redsys = pago único | [billing.service.ts:96-104](../apps/api/src/modules/billing/billing.service.ts#L96) y [redsys.service.ts:105+](../apps/api/src/modules/redsys/redsys.service.ts#L105) |
| No hay BUILD_ID ni commit accesible | `grep` de `BUILD_ID\|GIT_SHA\|COMMIT_SHA` en `next.config`, `package.json` y CI: sin resultados. No hay Dockerfiles |
| Todas las fuentes de env | [configuration.ts](../apps/api/src/config/configuration.ts), [env.validation.ts](../apps/api/src/config/env.validation.ts), `apps/api/.env.example`, `apps/web/.env.example`, [apps/web/src/config/index.ts](../apps/web/src/config/index.ts) |

**Lo que esta auditoría NO hizo:** no ejecutó la aplicación ni consultó la base de datos. Todos los
valores «por defecto» son los del **código**; los valores **vigentes en la BD de Ernest** pueden
diferir si alguien los cambió desde el backoffice (`updatedById` lo diría).
