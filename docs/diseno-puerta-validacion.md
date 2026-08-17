# Diseño — La puerta de validación del ciclo de vida del anuncio

> **Qué es este documento.** El diseño de la puerta y su plan de ráfagas. **Cero código.** No
> implementa nada.
>
> **De qué parte.** De [`docs/auditoria-puerta-validacion.md`](auditoria-puerta-validacion.md) (la
> viabilidad) y de [`docs/medicion-impacto-puerta.md`](medicion-impacto-puerta.md) (M2, la
> medición). El terreno ya está firme: la ráfaga (A) ordenó las transiciones y la profundidad dejó
> la herencia N estable, así que `resolveEffectiveSchema` ya no va a cambiar bajo los pies de la
> puerta.
>
> Fecha: 2026-08-13. Verificado sobre `main`, commit `a8e13d1`.

---

## Índice

- [Las decisiones que llegan cerradas](#las-decisiones-que-llegan-cerradas)
- [D-módulos — dónde vive la puerta sin crear un ciclo](#d-módulos--dónde-vive-la-puerta-sin-crear-un-ciclo)
- [D-motivos — uno o varios](#d-motivos--uno-o-varios)
- [A — La forma de la puerta](#a--la-forma-de-la-puerta)
- [B — Qué valida: la lista de reglas](#b--qué-valida-la-lista-de-reglas)
- [C — `needsRevalidation`](#c--needsrevalidation)
- [D — El contrato de fallo](#d--el-contrato-de-fallo)
- [E — Coexistencia con la ráfaga (A)](#e--coexistencia-con-la-ráfaga-a)
- [El plan de ráfagas](#el-plan-de-ráfagas)

---

## Las decisiones que llegan cerradas

No se reabren; se anotan aquí porque el diseño se apoya en ellas.

| Decisión | Qué implica para el diseño |
|---|---|
| **Política = `needsRevalidation`** | El anuncio se MARCA sin salir de ACTIVE ni del índice; aviso al vendedor; la puerta lo frena en la siguiente transición. §C |
| **Staff exento de cuota (D3)** | La cuota es una regla con `appliesTo: vendedor`. Staff la salta por diseño, escrito y con puntero. §B.4 |
| **Regla 4 (límite total)** | Cuenta todo menos `ARCHIVED` y `SOLD`. Es una regla **distinta** del límite de activos (solo `ACTIVE`): dos reglas separadas, no una parametrizada. §B.5 |

---

# D-módulos — dónde vive la puerta sin crear un ciclo

## El ciclo es real, y verificado

La puerta necesita `isProActive` (regla de cuota), que vive en `EntitlementService` →
`BillingModule`. Y `BillingService.bump`/`featuredByCredits` tienen que consultarla (el freno de
`needsRevalidation`, §C). Si la puerta importa `BillingModule` y `BillingModule` importa la
puerta: **ciclo**.

**Y el freno tiene que vivir DENTRO de `BillingService`, no en sus llamantes.** Verificado: hay
**tres** puntos de entrada distintos a bump/featured —
`listings.controller.ts:152`, `billing.controller.ts:95` y `bump-auto.processor.ts:92` (el cron)—
en tres módulos distintos. Ponerlo en los llamantes son tres sitios donde olvidarlo, que es
exactamente el defecto que la puerta viene a cerrar.

## La resolución: el molde que este repo ya usó dos veces

El repo tiene un patrón explícito para esto: **cuando dos módulos necesitan la misma pieza y
ninguno puede importar al otro, la pieza no vive en ninguno de los dos.**

- [`infra/redis/cache-keys.ts`](../apps/api/src/infra/redis/cache-keys.ts) — la clave de la ficha
  la escribe `ListingsService` y la invalida `BillingService`. Su comentario lo dice literalmente:
  *«Ninguno de los dos módulos puede importar del otro sin invertir la dirección
  `ListingsModule → BillingModule`, así que el formato de la clave no puede vivir en ninguno de los
  dos»*.
- `CategoryTreeModule` y `ListingActivationModule` — módulos **hoja** (11 y 18 líneas, sin ninguna
  dependencia de dominio) compartidos por varios módulos que no pueden importarse entre sí.

### Propuesta

**1. La puerta vive en su propio módulo HOJA: `ListingGateModule`.** Importa sólo cosas neutrales
(`PrismaModule` es `@Global`; `CategoryTreeModule` es hoja). No importa `BillingModule`, ni
`ListingsModule`, ni ninguno de sus consumidores. Lo importan `ListingsModule`,
`ModerationModule`, `AdminModule` y `BillingModule`, sin ciclo posible.

**2. `isProActive` se extrae a un lector neutral.** Es lo único que la puerta necesita de billing.
Verificado: `EntitlementService` **sólo depende de `PrismaService`**, así que la extracción no
arrastra nada.

- **NO se mueve `EntitlementService` entero.** Son 273 líneas de conceptos de billing —cuota de
  destacados, cuota de bumps, clientes de transacción— que no pintan nada en un módulo neutral.
- **Sí se mueve la pregunta `¿este usuario es Pro?`**, que no es una operación de billing sino la
  **lectura de un hecho sobre el usuario**. Por eso es la pieza correcta a compartir: la misma
  distinción que hace `cache-keys.ts` al mover el *formato de la clave* y no la caché.
- `EntitlementService` conserva su API pública delegando en el lector neutral, para no tocar a sus
  consumidores actuales.

**Alternativa descartada, y por qué:** pasar `isPro` a la puerta en el contexto, resuelto por cada
llamante. Reparte la resolución entre cuatro módulos y abre la puerta a que diverjan —
exactamente el problema que la puerta existe para cerrar. Un solo lector es el principio que ya
sostiene `CategoryTreeService`.

---

# D-motivos — uno o varios

## El trade-off, con el coste verificado

| | **Un motivo** (idioma actual) | **Varios motivos** |
|---|---|---|
| Idioma del repo | Es el que hay: `assert*` que lanzan al primero. `updateCategory` encadena 7 | Concepto nuevo |
| UX | El usuario corrige, reintenta, y descubre el siguiente | Ve de una vez todo lo que le falta |
| Coste en el cliente | **Cero.** `ApiError` ya transporta `code`, y hay ~15 códigos en uso con helpers que ramifican por ellos | Hay que ampliar `ApiError` y `apiFetch` para transportar una lista (`body.reasons`), hoy descartada en silencio |
| Coste en la puerta | Cortocircuita: no ejecuta las reglas caras si una barata ya falló | Ejecuta **todas** las reglas siempre, incluidas las que consultan BD |

## Recomendación: **varios motivos**, y la razón no es la UX

Es que **con un solo motivo la política `needsRevalidation` no funciona bien**. Un anuncio marcado
puede incumplir tres cosas a la vez (le falta un `required`, un `select` cambió de opciones y una
clave quedó huérfana). Decirle al vendedor «te falta *año*», que lo arregle, reintente, y entonces
decirle «ahora *combustible*»… convierte una corrección en tres viajes. Y `needsRevalidation`
existe precisamente para que el vendedor **pueda arreglarlo**, no para castigarle con un juego de
adivinanzas — es la mitigación M6 de la auditoría («sin un camino de salida, ninguna otra
mitigación basta»).

**Cómo se paga el coste sin romper nada:**

- **El payload es ADITIVO**: `{ message, code, reasons: [{ code, message, field? }] }`. `message` y
  `code` siguen exactamente como están, así que **todo el cliente actual sigue funcionando sin
  tocarlo**; `reasons` es lo único nuevo. `message` lleva el resumen («Este anuncio no se puede
  publicar: 3 cosas que corregir»), que es lo que ya se muestra hoy.
- **El corto-circuito se conserva donde importa**: las reglas se ordenan de barata a cara y se
  agrupan — si falla una regla de *entrada* (propiedad, estado), se corta ahí; sólo las reglas de
  *contenido* (atributos) acumulan motivos entre sí. No hay razón para consultar la cuota si el
  anuncio ni siquiera pertenece a quien pide.

**Lo que hay que tocar en el frontend, dicho claro:** `ApiError` gana un campo y `apiFetch` una
línea. Es trabajo real de frontend y va contado en la ráfaga 1.

---

# A — La forma de la puerta

## Hermano PREVIO de `ListingActivationService`

El repo ya tiene el hook **posterior**: `ListingActivationService.listingBecameActive` invalida
caché, encola reindexado y dispara el matching de alertas. La puerta es su **hermano previo**, y
juntos dejan el ciclo de vida legible:

```
  assertCanBecomeActive(...)   ← LA PUERTA: valida ANTES de escribir
  prisma.listing.update(...)   ← la transición
  listingBecameActive(...)     ← los efectos, DESPUÉS de escribir
```

**La puerta NO se mete en `ListingActivationService`.** Ese servicio corre después del `update` y
no inyecta Prisma; convertirlo en la puerta lo transformaría en otra cosa. Además la auditoría ya
verificó que su comentario *«Called by every path»* era **falso** en tres caminos — un aviso de que
la convención no basta.

## Forma

Una operación que **lanza** (idioma del repo) y recibe todo lo que las reglas necesitan:

- **`listing`** — el anuncio ya cargado. Los 8 caminos lo tienen: **coste cero**.
- **`context`** — quién actúa (`vendedor` | `staff`), qué transición es (`publish`, `renew`,
  `reactivate`, `undoDeal`, `approve`, `restore`, `adminStatus`, `bump`, `featured`), y el `actorId`.
  Es lo que permite que una regla se aplique o no (§B) sin que la puerta sepa de reglas concretas.

## Todos los caminos a ACTIVE — y cómo llama cada uno

⚠️ **La enumeración fiable es «toda llamada a `listing.update*` que pueda escribir el estado», no un
grep de `'status: ACTIVE'`**: verificado que **3 de los 8 escriben el estado por variable**
(`targetStatus`, `newStatus`, `dto.status`), así que el grep ingenuo no los encuentra. Hay 21
llamadas a `listing.update*` en el backend; éstas son las que tocan el estado.

| # | Camino | Actor | Llama a la puerta |
|---|---|---|---|
| 1 | `ListingsService.publish` | Vendedor | Sí — sustituye a su `checkActiveListingLimit` |
| 2 | `ListingsService.renew` | Vendedor | Sí — ídem |
| 3 | `ListingsService.reactivate` | Vendedor | Sí — ídem |
| 4 | `ListingsService.undoDeal` (SOLD→ACTIVE) | Vendedor | Sí — ya llama a la cuota desde (A) |
| 5 | `ListingsService.closeDeal` (RESERVED→ACTIVE, SERVICE) | Vendedor | **Decisión pendiente** — ver abajo |
| 6 | `ModerationService.approveListing` | Staff | Sí, con contexto `staff` |
| 7 | `ModerationService.restoreListing` | Staff | Sí, con contexto `staff` |
| 8 | `AdminService.changeListingStatus` (→ACTIVE) | Staff | Sí, con contexto `staff` |
| 9 | `BillingService.bump` | Vendedor | Sí — sólo el freno de `needsRevalidation` (§C), no las reglas de activación |
| 10 | `BillingService.grantFeaturedListingTx` / `featuredByCredits` | Vendedor | Ídem |

**El camino 5 sigue pendiente de decisión, como quedó en (A).** `closeDeal` de un servicio devuelve
un `RESERVED` a `ACTIVE` sin mirar cuota, porque `RESERVED` no cuenta como plaza ocupada. Bloquearlo
perdería un hecho ya ocurrido (el `Deal`, su conversación y los avisos de valoración) sin salida
para el vendedor. La puerta **no lo cambia por su cuenta**: hereda el `pinned` de (A) y lo deja
anotado.

**Cómo se garantiza que no falta ninguno** (no por convención, que ya falló una vez):
un caso de prueba que recorre los caminos de vendedor con una regla de prueba que siempre falla y
comprueba que **todos** son rechazados. Un camino nuevo que no llame a la puerta lo suspende.

---

# B — Qué valida: la lista de reglas

## La forma extensible

Una **lista ordenada de reglas**, cada una con:

- **`code`** — identificador estable (`ACTIVE_LIMIT_REACHED`, `ATTRIBUTES_INVALID`, …). Es lo que
  viaja en `reasons[].code` y lo que el frontend puede ramificar, igual que ya hace con
  `ALREADY_FEATURED` o `QUOTA_UNAVAILABLE`.
- **`appliesTo(context)`** — si esta regla corre en esta transición y para este actor. Aquí es donde
  el **staff exento de cuota** deja de ser un olvido y pasa a ser una línea declarativa.
- **`check(listing, context)`** — devuelve el motivo o nada.
- **`grupo`** — `entrada` (barato: propiedad, estado) o `contenido` (caro: BD, schema). Corta en el
  primer grupo que falle; acumula dentro del grupo (§D-motivos).
- **`enabled`** — interruptor por regla. **Molde verificado**: `videoEnabled` nace apagado a
  propósito y `bumpAutoEnabled` es un interruptor de emergencia. ⚠️ Con el aviso del mapa: en este
  repo hay **dos ajustes muertos** (`listingExpiryDays`, `contactRequiresVerification`), así que un
  interruptor sin lector es peor que no tenerlo — cada `enabled` nace con su lector o no nace.

**Añadir una regla = añadir una entrada.** No se tocan los 10 caminos ni la puerta.

## Las reglas de este diseño

**B.1 — Cuota de anuncios ACTIVOS (existe hoy, dispersa).** Es la que la puerta **centraliza**, no
inventa. Hoy vive en `ListingsService.checkActiveListingLimit`, es `private`, y por eso
`ModerationService` y `AdminService` no pueden usarla — que es exactamente por lo que se escapó por
cuatro caminos hasta la ráfaga (A). Al mudarse a la puerta deja de ser inalcanzable.
`appliesTo`: sólo `vendedor`.

**B.2 — Atributos contra el schema efectivo N-nivel.** Pliega la cadena con
`resolveEffectiveSchema` —ya estable tras la profundidad— y filtra por el tipo del anuncio con
`filterSchemaByType`, en el mismo orden que `create()`. Valida requeridos, valores, selects
vinculados y claves desconocidas. **La lógica ya está medida**: el comando de M2
(`gate-impact-report`) replica estos validadores y sus 11 casos de auto-comprobación discriminan.

⚠️ **Deuda que esta regla debería saldar:** los tres validadores son `private` de
`ListingsService`, y M2 tuvo que **replicarlos**, anotando que si divergen el recuento deja de ser
real. La puerta es la ocasión natural de extraerlos a un módulo puro compartido (molde
`category.types.ts`) y que `ListingsService`, la puerta y M2 lean **el mismo código**.

**B.3 — El freno de `needsRevalidation`.** §C.

**B.4 — Staff.** No es una regla: es `appliesTo`. Queda escrito en un solo sitio, con la razón (el
trabajo de moderación no puede ser rehén de la cuota de un tercero) y el puntero a D3.

**B.5 — Reglas de proyectos posteriores** (límite total, correo verificado, fotos, moderación
previa). **No entran en este diseño.** Se enchufan como entradas nuevas. Anotado de la decisión ya
tomada: el **límite total** cuenta todo menos `ARCHIVED` y `SOLD`, y es una regla **separada** de
B.1 — no la misma parametrizada, porque cuentan cosas distintas y pueden tener topes y mensajes
distintos.

---

# C — `needsRevalidation`

## El campo

Un booleano en `Listing`, con su índice para poder listar los marcados. **Aditivo**: nace `false`
para todo lo existente, sin backfill ni migración de datos.

## Cuándo se marca

Cuando un cambio de configuración de categoría deja a un anuncio fuera de norma. El sistema **ya
sabe detectarlo**: las guardas de admin ya cuentan exactamente los anuncios afectados por un cambio
(`assertPolicyChangeDoesNotBreakChildren` cuenta los del tipo prohibido;
`assertPriceUnitsChangeDoesNotBreakListings` los de formato inválido, con su corte por override).
Hoy **rechazan** el cambio; con `needsRevalidation` la política puede pasar a **marcar** — pero
**cuál de las dos cosas hace cada guarda es decisión de un proyecto posterior**, no de éste. Este
diseño aporta el mecanismo; no cambia ninguna guarda.

Lo que sí entra aquí es el caso que **hoy no tiene ninguna guarda**: renombrar, borrar o cambiar un
atributo, o quitar opciones de un `select`. El mapa (§3.1) lo documentó como silencioso, y ahí el
marcado es puro beneficio: hoy no pasa nada de nada.

## ✅ No toca la búsqueda — confirmado, no supuesto

Tres hechos verificados:

1. **El reindexado nunca es automático.** Un `prisma.listing.update` no reindexa: en este repo el
   reindexado es siempre un `indexingQueue.add('index', …)` explícito. Marcar el flag con un update
   normal cuesta **cero** en búsqueda.
2. **El flag no va al documento.** No entra en `ListingDocument`: es información para el vendedor,
   no un criterio de búsqueda. Nada que reindexar.
3. **El anuncio sigue ACTIVE**, así que sigue en el índice. Que es justo el sentido de la política:
   nada desaparece de golpe.

Esto es lo que hace a `needsRevalidation` compatible con un proyecto read-heavy: es **coste de
escritura, y de una escritura que además no propaga**.

## Qué hace la puerta con él

En la siguiente transición del anuncio —renovar, reactivar, bumpear, destacar, editar— la puerta ve
el flag, **revalida a fondo** y:

- si ya cumple → **limpia el flag** y deja pasar. La corrección se premia sola, sin que el vendedor
  tenga que hacer nada más.
- si sigue sin cumplir → **frena**, con los motivos (§D). El anuncio **no sale de ACTIVE**: sigue
  visible, sólo que su dueño no puede hacer nada nuevo con él hasta arreglarlo.

## El aviso al vendedor

En «Mis anuncios», sobre la tarjeta del anuncio afectado. El molde existe: `MyListingCard` ya pinta
`Badge` de estado. Y el aviso tiene que **llevar a la solución**, no sólo anunciar el problema — es
la mitigación M6 de la auditoría, y es también el argumento que decidió D-motivos: sin la lista de
motivos, el aviso no puede decir qué corregir.

---

# D — El contrato de fallo

**Payload aditivo:**
`{ message, code: 'LISTING_NOT_VALID', reasons: [{ code, message, field? }] }`

- `message` — el resumen, que es lo que el cliente **ya** muestra hoy sin tocar nada.
- `code` — un código estable, como los ~15 que ya existen.
- `reasons` — lo nuevo. `field` cuando el motivo apunta a un atributo concreto, para que el editor
  pueda señalarlo.

**Códigos HTTP: se PRESERVAN los actuales.** Es la mitigación M5 de la auditoría, y no es cosmética:
el cliente ramifica por `statusCode` **y** por `code`, así que cambiar un 403 por un 422 rompe el
frontend en silencio.

| Familia | Código | Hoy |
|---|---|---|
| Cuota | **403** | `ForbiddenException` en `checkActiveListingLimit` |
| Atributos / contenido | **422** | `UnprocessableEntityException` en los tres validadores |
| Estado de origen | **400** | `BadRequestException` en las guardas de transición |

---

# E — Coexistencia con la ráfaga (A)

**La máquina de estados y la puerta son ortogonales, y esto no es una observación teórica:
responden a preguntas distintas.**

| | Máquina de estados (A) | Puerta |
|---|---|---|
| Pregunta | ¿Es legal ir de X a Y? | ¿Merece este anuncio estar activo? |
| Necesita saber | Nada del contenido del anuncio | Categoría, atributos, cuota, ajustes |
| Dónde vive | `listing-status.transitions.ts` (fichero puro) | `ListingGateModule` |
| Cuándo corre | En `changeListingStatus` | En los 10 caminos |

**No se duplican ni se contradicen: se componen.** Primero la topología (¿es legal el salto?),
después la validez (¿merece estar ahí?). Un `ARCHIVED → ACTIVE` lo sigue rechazando (A) antes de
que la puerta llegue a mirar nada.

**Lo que la puerta hereda de (A), sin re-abrirlo:** la cuota en `undoDeal` (que (A) cerró) pasa a
ser la regla B.1 en ese camino, y el `pinned` de `closeDeal` sigue como está. La puerta **no
re-rompe** lo que (A) arregló: lo absorbe.

---

# El plan de ráfagas

## Ráfaga 1 — La forma, y la cuota centralizada

`ListingGateModule` (hoja) · el lector neutral de estado Pro · la lista de reglas con
`appliesTo`/grupos/`enabled` · **la cuota de activos migrada a regla** · los 10 caminos llamando a
la puerta · el contrato `reasons` (backend + `ApiError`/`apiFetch`).

- **Sin reglas nuevas.** Sólo la forma y la cuota que ya existía.
- **Efecto observable:** casi nulo. La cuota se comporta igual para el vendedor; lo que cambia es
  que deja de estar en un `private` inalcanzable. Staff sigue exento — ahora declarado.
- **Criterio de cierre:** la prueba de cobertura (una regla que siempre falla rechaza en **todos**
  los caminos de vendedor), la cuota sigue dando 403 con su mensaje, y staff sigue pasando.

## Addendum de implementación — la coherencia `enabled` / flag (ráfaga 2, cerrada)

El diseño dejaba una pregunta sin resolver que sólo aparece al implementar: **si la regla de
atributos nace apagada, ¿se marca igual?** Resuelta así, y el reparto está escrito en el código
(`RevalidationService`, cabecera):

| pieza | ¿mira `enabled`? | por qué |
|---|---|---|
| **Marcar** (`needsRevalidation = true` al cambiar el schema) | **NO** | El flag describe un HECHO, no una política: «esta categoría cambió y este anuncio ya no encaja». Marcar no le quita nada a nadie — sigue ACTIVE, en el índice y editable. Si esperara a `enabled`, el día que se encienda la regla no habría ni un anuncio marcado ni forma de saber cuáles, y el aviso llegaría DESPUÉS del frenazo. |
| **Avisar** en «Mis anuncios» | **NO** | Es información, no restricción (mitigación M6). |
| **Frenar** | **SÍ** | Es lo único que le quita capacidad al vendedor, y es lo que M2 tiene que dimensionar. Apagada no frena a nadie: ni marcado ni sin marcar. |
| **Limpiar** el flag | **NO** | Si dependiera de `enabled`, el aviso se quedaría pegado en anuncios ya corregidos y, al encender, se frenaría a gente que cumple. Limpiar sólo retira un aviso. |

Resumido: **apagada, el mecanismo observa y avisa con fidelidad, pero no bloquea.** Encenderlo es
una fila en `Setting` (`attributeRevalidationEnabled`, molde `videoEnabled`: sin fila, apagada),
y para entonces ya hay anuncios marcados, vendedores avisados y un número real que medir.

**Tres decisiones más que el diseño no anticipaba**, todas verificadas contra el código:

1. **Editar nunca frena; sólo limpia.** Es la vía de salida del vendedor: frenar la edición de un
   anuncio marcado lo dejaría encerrado (no puede publicar porque no cumple, no puede arreglarlo
   porque no le dejan editar). `update()` no pasa por la puerta — pregunta, ya guardado, si el
   anuncio volvió a cumplir, y retira el aviso.
2. **En `bump`/`featured` la regla sólo mira a los MARCADOS.** Promocionar no es publicar: revalidar
   ahí el universo entero convertiría la regla en un peaje sobre las acciones que generan ingreso.
3. **`grantFeaturedListingTx` NO se frena.** Corre también desde el webhook de pago, con el dinero
   ya cobrado; bloquear allí sería quedarse el pago sin entregar el destacado. El freno va antes de
   cobrar, en `featuredByCredits`.

## Ráfaga 2 — Atributos y `needsRevalidation`

Extraer los tres validadores a un módulo puro (y que M2 deje de replicarlos) · la regla B.2 · el
campo `needsRevalidation` con su índice · el marcado en los cambios de categoría hoy silenciosos ·
el aviso en «Mis anuncios» · el freno y la limpieza automática del flag.

- **Es la ráfaga con riesgo real**, porque toca anuncios existentes. Mitigación: la regla B.2 nace
  **apagada** (`enabled`), se enciende cuando M2 diga a cuántos afecta, y `needsRevalidation` marca
  antes de frenar.
- **Criterio de cierre:** un anuncio marcado sigue visible en búsqueda y en su ficha; frena en la
  siguiente transición con motivos accionables; al corregirlo, el flag se limpia solo.

## Después — Las reglas nuevas, una por proyecto

Límite total, correo verificado, fotos, moderación previa. Cada una es **una entrada en la lista**,
y cada una debería **medirse con M2 justo antes de encenderse** — no una vez y para siempre: lo que
decide la política es el número del día que se enciende.

### Addendum — el molde real, medido con la regla #1 (límite total, cerrada)

La primera regla nueva confirmó la parte fácil y corrigió una suposición.

**Lo que se cumplió.** Enchufarla fueron cuatro cosas y ninguna tocó a las reglas existentes: el
fichero de la regla, una línea en la lista de `ListingGateModule`, sus claves en `SETTING_KEYS`, y
su interruptor con lector. La cuota de activos y la de atributos no cambiaron ni de comportamiento
ni de firma.

**Lo que no se cumplió, y por qué.** El diseño decía «no se toca la puerta». Fue cierto para las
reglas sobre anuncios **que ya existen** — que es de lo que hablaba el diseño— pero **no** para
ésta: el límite total pregunta «¿puedes tener uno más?», y eso no se puede preguntar sobre el
anuncio que todavía no hay. Hizo falta que `ListingGateService` creciera:

- una tercera entrada, `assertCanCreate(sellerId, context)`;
- un gancho opcional en la regla, `checkBeforeCreate`, hermano de `check`;
- la transición `create`;
- una fila en el mapa de códigos HTTP (`TOTAL_LIMIT_REACHED` → 403, la misma familia que la cuota).

La alternativa —fabricar un anuncio de mentira con `id: ''` para reutilizar `check`— se descartó
porque habría hecho correr TODAS las reglas al crear: la cuota de activos habría bloqueado guardar
un borrador. Los dos ganchos son opcionales, así que una regla que no implementa uno no se evalúa
en ese momento y ninguna regla anterior cambia.

**La lección para las tres que faltan (escrita antes de la #2):** una regla sobre un anuncio existente se enchufa sin tocar
la puerta; una regla sobre lo que aún no existe hace crecer la puerta una vez, y sólo una — la
segunda ya encuentra el gancho hecho. De las tres pendientes, correo verificado y fotos son de
entrada (usan `checkBeforeCreate` o `check` según dónde se decida cobrarlas) y moderación previa es
sobre anuncio existente.

**Tres decisiones de la regla #1 que sientan precedente:**

1. **Cada límite cobra donde se consume lo que limita.** El total cuenta EXISTENCIAS, así que cobra
   al crear; la cuota de activos cuenta ESCAPARATE, así que cobra al activar. Publicar un borrador
   no paga el total (ya contaba); crear no paga la cuota de activos (un `DRAFT` no ocupa plaza).
2. **Un tope necesita una salida, y la salida va en el mensaje.** `ARCHIVED` y `SOLD` no cuentan —los
   dos son terminales, así que el hueco no se recupera dos veces— y el texto del rechazo dice
   exactamente eso: «archiva o marca como vendido alguno».
3. **Los límites que se relacionan viven juntos** (`listing-gate/listing-limits.ts`) y su invariante
   (`total > activos`) se comprueba en las dos direcciones al editar el ajuste, además de un test
   sobre los valores por defecto. El precedente es la cicatriz de `/planes`, donde el límite
   gratuito podía superar al Pro y nadie se enteraba.

### Addendum — la regla #2 (correo verificado) y el TERCER desenlace

La regla #1 ya obligó a la puerta a crecer una vez, para poder preguntar por un anuncio que aún no
existe. La #2 trajo la otra pregunta pendiente: **qué hacer cuando el «no» no es un error.**

Publicar sin el correo verificado no es un fallo del anuncio —está perfecto— sino un paso que le
falta a su dueño. Rechazarlo con un 4xx le dejaría preguntándose dónde ha quedado su trabajo. Así
que el desenlace es un tercero: **el anuncio se queda en `DRAFT`, sin tocar un solo campo, y viaja
un aviso con la salida.**

**Dónde vive ese tercer desenlace — se evaluaron las dos opciones:**

| | (a) Tercer veredicto en la puerta | (b) El camino lo interpreta ← **elegida** |
|---|---|---|
| Contrato de la puerta | deja de ser binario | **intacto** |
| Quién se entera | los **diez** caminos | sólo `publish` |
| Coste | nueve caminos aprenden a manejar un veredicto que nunca reciben | un `try/catch` en `publish` |

Se eligió **(b)**, y lo que la hace segura no es una cuestión de estilo: la regla declara
`appliesTo` = sólo `publish`, así que el motivo `EMAIL_NOT_VERIFIED` **no puede aparecer en ningún
otro camino**. Ninguno de los otros nueve necesita saber que existe. Con (a) todos habrían tenido
que decidir qué hacen con algo que no les llega nunca.

El coste de (b) es usar una excepción como decisión, y se acota con `unicoMotivo(err, code)`: sólo
degrada si ese es el **único** motivo del rechazo. Si el vendedor además está en el tope de su plan,
el rechazo se propaga entero con los dos motivos — degradar en silencio le escondería el segundo,
verificaría el correo y volvería a chocar.

**Dos invariantes que sostienen todo esto, y que están fijadas en tests unitarios** porque
ampliarlas rompería la degradación sin que nada fallara a la vista: la lista de transiciones de
`appliesTo`, y que el reconocimiento del motivo sea exacto.

**Para las dos reglas que faltan:** ya hay molde para los tres desenlaces —pasar, rechazar y
degradar—. «Fotos requeridas» es la candidata natural a reutilizar la degradación (el anuncio existe
y sólo le falta algo al usuario); «moderación previa» no, porque ahí el destino ya tiene su propio
estado (`PENDING_REVIEW`) y el camino de publicación ya sabe llegar a él.

## Lo que este plan NO hace

No implementa ninguna regla nueva, no cambia ninguna guarda de admin, no toca la máquina de
estados, no saca ningún anuncio de ACTIVE y no cambia la política de staff (la formaliza).

---

# Resumen

**Las dos decisiones técnicas, resueltas:**

- **D-módulos:** la puerta en un módulo **hoja** (`ListingGateModule`) y `isProActive` extraído a un
  lector neutral — el mismo movimiento que ya hizo `cache-keys.ts`, y por la misma razón. Verificado
  que el ciclo es real (el freno debe vivir en `BillingService`, porque bump/featured entran por
  tres módulos distintos) y que la extracción es barata (`EntitlementService` sólo depende de
  Prisma).
- **D-motivos: varios**, con payload aditivo que no rompe al cliente actual. El argumento decisivo
  no es la UX sino que **`needsRevalidation` no funciona con un solo motivo**: si el vendedor tiene
  que descubrir sus incumplimientos de uno en uno, el aviso deja de ser un camino de salida.

**Lo que sostiene el diseño:** un solo punto que todos los caminos llaman (y una prueba que lo
verifica, porque la convención ya falló una vez en este mismo repo), una lista de reglas donde
`appliesTo` convierte la política de staff en una línea declarativa, y `needsRevalidation` como
coste de escritura que no propaga — confirmado contra el código, no supuesto.

**Deuda que la ráfaga 2 salda de paso:** los tres validadores de atributos dejan de estar
`private` y duplicados en el comando de M2.
