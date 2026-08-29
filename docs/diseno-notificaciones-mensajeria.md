# Diseño — notificaciones de mensajería (N4)

> **Documento de diseño. Cero código.** Todo lo que afirma sobre el estado actual está
> verificado contra el código el 2026-08-29. Las tres decisiones de Ernest son el marco: este
> documento desarrolla **el cómo**, no las reabre.

---

## 0. El marco (decidido, no se discute aquí)

1. **Agrupación por CONVERSACIÓN, con contador.** Una notificación **viva** por hilo
   («3 mensajes de Juan») que se actualiza. Nunca una por mensaje.
2. **Solo si el destinatario NO está viendo ese hilo.** Si lo tiene abierto, ya lo ve.
3. **El correo, con ventana de gracia.** El in-app es inmediato; el correo espera N minutos y
   **no sale si mientras tanto ha leído**.

---

## 1. Lo que dice el código — y los tres hallazgos que condicionan el diseño

Cuatro verificaciones y sus consecuencias.

### 1.1 — `Notification` no tiene ninguna clave única. La notificación viva exige migración

`schema.prisma:1308-1328`: `id`, `userId`, `type`, `data Json`, `read`, `readAt`, `createdAt`,
y **solo dos índices** (`[userId, createdAt]`, `[userId, read]`). **Ningún `@@unique`.**

Y el `conversationId` que haría de clave **no es una columna**: viviría dentro de `data`, que
es `Json`. No se puede poner un `@@unique` sobre un campo de un Json.

**Consecuencia:** un `upsert` por (destinatario, conversación) necesita **una columna nueva y
un índice único**. Es la única migración de N4. Ver §2.

### 1.2 — 🔴 La sala `conv:<id>` NO significa «está mirando este hilo»

Es el hallazgo que más cambia el diseño, y contradice la lectura natural del encargo.

El gateway sí da granularidad por hilo: `conversation:join` une el socket a `conv:<id>`
(`messaging.gateway.ts:176`). Pero **no existe `conversation:leave`** — ni en el gateway ni en
el cliente. Y el cliente, además, **acumula**:

```ts
// useMessagingSocket.ts:35, 47-51, 66
const joinedRoomsRef = useRef<Set<string>>(new Set());   // solo CRECE
socket.on('connect', () => {
  for (const conversationId of joinedRoomsRef.current)   // re-une TODAS
    socket.emit('conversation:join', { conversationId });
});
```

Su propio comentario lo dice: *«Recuerda todas las salas unidas en la sesión para volver a
unirlas tras una reconexión»*. Es correcto para lo que se escribió —que la bandeja siga viva
tras reconectar—, pero significa que **quien abre los hilos A, B y C está en las tres salas a
la vez** aunque solo esté leyendo C.

**Si se usara la pertenencia a la sala como test de «lo está viendo», se silenciarían los
avisos de A y B mientras lee C.** Mensajes perdidos, en silencio, y hacia el lado peligroso.

**La alternativa** está en §3.

### 1.3 — No existe ningún job diferido: la ventana de gracia es mecanismo NUEVO

Barrido completo de `delay:` en `apps/api/src`: **una sola aparición**, y es el `backoff` de
los reintentos (`queue.constants.ts:64`). Todo lo diferido del proyecto son **crones**
(`@Cron`), que corren a una hora fija sobre un barrido — no «dentro de N minutos desde este
evento».

BullMQ soporta `delay` nativamente; simplemente **aquí no se ha usado nunca**. Se dice para
que se dimensione como lo que es: no hay molde que copiar. Ver §4.

### 1.4 — Lo que sí encaja tal cual

| Pieza | Dónde | Uso en N4 |
|---|---|---|
| `unreadCount` por conversación | `messaging.service.ts:94,104` — cuenta `senderId != yo` con `readAt: null` | El contador de la notificación viva |
| **Auto-marcado de leído al abrir** | `messaging.service.ts:178-181` — `getConversation` pone `readAt` a los entrantes | **El punto de cancelación**, gratis: leer ya deja rastro en la base |
| Snapshot del interlocutor borrado | `deleteAccount` escribe `name: 'Usuario eliminado'` en la propia fila | §6: no hay que hacer nada |
| `Setting` para plazos | molde `ticketAutoCloseWindowDays` | La N de la ventana |
| Doble canal in-app + `QUEUE_NOTIFICATIONS` | N2/N3 | El correo agrupado |

---

## 2. El modelo de la notificación VIVA

### 2.1 — El problema

El buzón es **append-only**: cada evento es una fila nueva e inmutable, y esa inmutabilidad es
lo que hace que una notificación sea un *registro histórico*. Una notificación cuyo contador
sube 1→2→3 es otra cosa: es **estado presente**, no historia.

Meter las dos semánticas en la misma tabla sin pensarlo rompería la primera.

### 2.2 — La propuesta: una columna `groupKey`, y el `NULL` hace el reparto solo

```
Notification
  + groupKey String?                       ← NUEVA, nullable
  + @@unique([userId, type, groupKey])     ← NUEVO
```

Para mensajería, `groupKey = conversationId`. Para todo lo demás, `groupKey = NULL`.

**Y aquí está la elegancia, que no es un truco sino la semántica de SQL:** en PostgreSQL los
`NULL` **no colisionan entre sí** en un índice único. Así que:

- Las once notificaciones que ya existen (y las futuras de tipo evento) nacen con
  `groupKey = NULL` → **el único no las restringe en nada**: siguen siendo append-only,
  inmutables, tantas filas como eventos. **Cero cambios de conducta.**
- Las de mensajería llevan `groupKey` → el único **las hace únicas por (usuario, tipo, hilo)**
  y habilita un `upsert` atómico.

**Una sola tabla, dos semánticas, sin una bandera que haya que interpretar ni una tabla
paralela que mantener.** El invariante queda enunciable en una frase, que es lo que hay que
poder escribir en el `schema.prisma`:

> **Una notificación con `groupKey` es ESTADO (se actualiza mientras dure); una con
> `groupKey NULL` es HISTORIA (nace y no se toca).**

**Por qué `groupKey` genérico y no `conversationId`:** `Notification` no conoce ni una sola
entidad del dominio —su regla es el snapshot autocontenido, «NO punteros a otras entidades»—.
Una columna `conversationId` sería el primer puntero, y además una FK que obligaría a decidir
qué pasa al borrar la conversación. `groupKey` es una cadena opaca: no es una FK, no restringe
nada, y sirve igual el día que haga falta agrupar otra cosa.

### 2.3 — El tipo y su snapshot

`MESSAGE_UNREAD`, con `groupKey = conversationId`:

```
{
  conversationId: string,
  otherUserName:  string,   // resuelto y congelado — «Usuario eliminado» si procede (§6)
  otherUserSlug:  string | null,
  listingTitle:   string | null,   // de Conversation.listingTitle (ya es snapshot, C1)
  unreadCount:    number,
  extracto:       string,   // ≤140, del ÚLTIMO mensaje — molde de tickets
}
```

Texto: «**3 mensajes nuevos de Juan** sobre «Bici de carretera»: …». Enlace:
`/mensajes/{conversationId}`.

### 2.4 — Las cuatro transiciones

| Situación | Qué se hace |
|---|---|
| Primer mensaje no visto | `upsert` → crea con `unreadCount: 1`, `read: false` |
| Mensaje siguiente, aún sin leer | `upsert` → actualiza `unreadCount`, `extracto`, `createdAt` |
| El destinatario abre el hilo | La fila se marca `read: true` (§5) |
| Llega otro mensaje después de haber leído | El `upsert` **la revive**: `read: false`, `readAt: null`, contador recalculado |

**El contador se RECALCULA, no se incrementa.** En cada mensaje se hace el mismo `COUNT` que
ya usa la bandeja (`senderId != destinatario`, `readAt: null`). Un `increment` acumularía
deriva en cuanto un camino cualquiera marcara leído sin pasar por aquí; el `COUNT` no puede
mentir. Es el mismo criterio que la auditoría fijó para la Parte B: **no almacenar lo que se
puede derivar**.

**`createdAt` se refresca** en cada actualización para que el hilo suba en la campana: la
notificación es estado presente, y su fecha significa «último mensaje», no «primer mensaje».

---

## 3. «¿Está viendo ESTE hilo?» — la detección

### 3.1 — Lo que NO sirve, y por qué (§1.2)

Preguntar por la sala (`server.in('conv:X').fetchSockets()`) responde **«¿ha abierto X en
algún momento de esta sesión?»**, no «¿lo está mirando?». Con el `Set` que solo crece, un
usuario con tres hilos abiertos se comería los avisos de dos.

### 3.2 — La propuesta: el hilo ACTIVO, explícito, uno por socket

Un evento nuevo, `conversation:active`, que el cliente emite **al cambiar de hilo** y con
`null` al salir de la vista de conversación. El gateway guarda un solo campo:

```
socket.data.activeConversationId = <id> | null
```

Y el test pasa a ser: **¿existe algún socket de este usuario cuyo `activeConversationId` sea
esta conversación?** Si sí → no se notifica. Si no → se notifica.

**Por qué esto y no añadir `conversation:leave`:** un `leave` obliga a mantener la simetría
join/leave en el cliente, y olvidar un `leave` falla **hacia el lado peligroso** (silencia
avisos) sin que se note. Un único campo «qué estoy mirando» no tiene simetría que romper: se
sobrescribe, y el peor caso de un fallo es notificar de más. **Las salas no se tocan** —siguen
haciendo su trabajo de entrega en tiempo real—; se añade una señal de presencia al lado.

### 3.3 — Los bordes, decididos

| Borde | Decisión | Por qué |
|---|---|---|
| Conectado pero en OTRO hilo | **Notificar** | No está viendo éste. Es el caso que §1.2 rompía |
| En la bandeja, sin hilo abierto | **Notificar** | La lista se mueve sola, sí — pero si se va sin abrir, la campana es su único rastro. Redundancia leve frente a un mensaje perdido |
| Varias pestañas, una con el hilo abierto | **No notificar** | Basta con que **algún** socket suyo lo tenga activo |
| Pestaña abierta pero minimizada | **No notificar** (aceptado) | Distinguirlo exige `visibilitychange`; se puede afinar después sin cambiar el modelo |
| Desconectado del gateway | **Notificar** | El socket vive solo en `/mensajes`: fuera de esa página no hay presencia y eso es correcto |

### 3.4 — El límite que hay que decir: la presencia es de UNA instancia

**No hay adaptador de Redis para socket.io** (verificado: solo `socket.io` y
`@nestjs/platform-socket.io`). Las salas y `socket.data` viven **en memoria del proceso**.

Si algún día la API corre en más de una instancia, un usuario conectado a otro nodo se vería
como ausente. **El fallo cae del lado seguro** —se notifica de más, nunca de menos—, así que
no bloquea N4. Pero conviene dejarlo escrito: el día que se escale horizontalmente hace falta
`@socket.io/redis-adapter`, y entonces esta detección funciona sin cambios de diseño.

---

## 4. La ventana de gracia del correo

### 4.1 — El mecanismo

Al crear o actualizar la notificación viva, se encola en `QUEUE_NOTIFICATIONS` un job
**con `delay` de N minutos** y con:

```
jobId: `msg-mail:${destinatarioId}:${conversationId}`
```

**El `jobId` es lo que hace que no haya un correo por mensaje.** BullMQ rechaza un job cuyo id
ya existe, así que el segundo, tercero y décimo mensaje de la ventana **no encolan nada**: el
primero ya dejó el temporizador puesto. Es exactamente el mecanismo de deduplicación que
`expireFeaturedListings` ya usa (`jobId: feat-exp-${id}-${fecha}`) — hay molde para el
*patrón*, aunque no para el `delay`.

### 4.2 — La cancelación: NO se cancela nada, se comprueba al disparar

La tentación es borrar el job cuando el usuario lee. **Se descarta**: obliga a acordarse de
cancelar en cada camino que marque leído, y olvidar uno manda un correo mentiroso.

En su lugar, **el job comprueba al dispararse**:

> ¿Sigue habiendo mensajes sin leer de esta conversación para este usuario?
> **No → no se manda nada** (y no es un error: es el caso bueno).
> Sí → se manda un correo con el total acumulado.

Es autocancelante y sin carreras, porque el dato que consulta —`readAt` de los mensajes— ya lo
escribe `getConversation` al abrir el hilo (§1.4). **No hay que añadir ni una línea al camino
de lectura.** Mismo criterio que el resto del sistema: derivar el estado en vez de mantener un
segundo registro que puede desincronizarse.

### 4.3 — El correo, agrupado

Uno por conversación y por ventana: «**Tienes 3 mensajes de Juan**», con el extracto del
último y el enlace al hilo. Nunca uno por mensaje.

Y si tras el correo llegan más mensajes sin que lea, la ventana **se vuelve a armar** (el
`jobId` ya no existe porque el job se consumió), así que habrá como mucho **un correo cada N
minutos por hilo**. Ése es el tope, y es el que hay que dimensionar.

### 4.4 — La N

**`Setting` `messageEmailGraceMinutes`, por defecto 10.** Molde `ticketAutoCloseWindowDays`:
configurable en caliente, con el valor por defecto en código.

Configurable **y no constante** —al revés que la N del preaviso de N3— porque aquí el valor
correcto no se deduce de nada: depende del ritmo real de las conversaciones, que todavía no se
conoce. El preaviso de caducidad iba atado a `EXPIRY_DAYS`, que es fijo; esto no tiene pareja.

El compromiso, para que quien lo cambie sepa qué mueve: **corto** (≤3 min) apenas deja margen
a que el otro siga escribiendo o a que el destinatario entre → más correos, más troceados;
**largo** (≥30 min) convierte el aviso en un resumen tardío y pierde la conversación. Diez
minutos cubre la ráfaga típica de mensajes seguidos sin llegar a parecer un digest.

---

## 5. El ciclo completo

```
                        LLEGA UN MENSAJE (destinatario = el otro)
                                      │
                    ¿algún socket suyo tiene ESTE hilo activo?     (§3)
                                      │
                 ┌────────────────────┴────────────────────┐
                SÍ                                         NO
                 │                                          │
        Lo está viendo en vivo.                 1) upsert MESSAGE_UNREAD     (§2)
        NO se hace NADA:                           groupKey = conversationId
        ni notificación ni correo.                 unreadCount recalculado
        El WebSocket ya se lo entregó.             read = false (revive si estaba leída)
                                                2) encolar correo con delay N   (§4)
                                                   jobId msg-mail:<user>:<conv>
                                                   → si ya existe, NO se duplica
                                                          │
                        ┌─────────────────────────────────┴──────────────────────┐
             ABRE EL HILO antes de N                              EXPIRAN los N minutos
                        │                                                        │
        getConversation marca readAt (ya existía)              el job comprueba: ¿sigue sin leer?
        + se marca la notificación como leída                   ├─ NO → no manda nada  ✔ el caso bueno
                        │                                       └─ SÍ → UN correo agrupado
              el job, al disparar,                                      «Tienes 3 mensajes de Juan»
              no encuentra no-leídos
              y NO manda nada
```

**Los tres casos de Ernest, en una línea cada uno:** viéndolo → silencio total; no viéndolo →
campana inmediata que se actualiza; sin leer tras N minutos → un correo, agrupado.

---

## 6. El caso del borrado — no hay que hacer nada

`deleteAccount` escribe `name: 'Usuario eliminado'` **en la propia fila** del usuario
(`admin.service.ts:1481`). El snapshot de §2.3 congela `otherUserName` **tal y como esté al
crear el aviso**, así que:

- Aviso creado antes del borrado → conserva el nombre real. Correcto: eso es lo que pasó.
- Aviso creado después → dice «Usuario eliminado», sin inventar nada.

Es el residuo anotado en C1 y se pinta tal cual. La única cautela es de implementación:
`otherUserSlug` debe poder ser `null` para no enlazar al perfil de una cuenta vaciada.

---

## 7. La reputación — mapa, sin diseño

No necesita documento: son eventos dirigidos, con actor y momento claros, y encajan en el
molde `LISTING_MODERATED` sin una sola decisión nueva. Van directos a la implementación.

| Evento | Hoy | Tipo | Canal | Nota |
|---|---|---|---|---|
| **Recibir una valoración** | mudo | `REVIEW_RECEIVED` | in-app + email | El evento más notificable sin cubrir: alguien ha escrito públicamente sobre ti. §A4 lo lista para correo |
| **Restaurar una valoración** | mudo | `REVIEW_MODERATED` + acción `RESTORED` | in-app | Cierra la asimetría: hoy se avisa al retirar y no al devolver, y «avisar solo de lo malo es la mitad de la conversación» |
| ~~Responder a una valoración~~ | **la función NO EXISTE** | — | — | 🔴 Ver abajo |
| Retirar / editar | ✅ ya (A1 + N2, con motivo) | — | — | Nada que hacer |

`RESTORED` entra **como acción de `REVIEW_MODERATED`**, no como tipo nuevo: es la misma clase
de evento y el `Record` exhaustivo del front obliga a darle texto. `REVIEW_RECEIVED` sí es tipo
propio.

> **🔴 CORRECCIÓN (al implementar N4a): responder a una valoración NO EXISTE.**
>
> Este mapa —y la tabla §A3.6 de la auditoría— daban por supuesto que responder es una función
> del sistema a la que solo le faltaba el aviso. Verificado al ir a engancharlo: barrido de
> `reply|respuesta|respond` en `reviews/`, en el `model Review` y en el front → **cero
> resultados**. No hay campo, ni endpoint, ni interfaz.
>
> No es un aviso que falte: es una **función de producto que nunca se construyó**. Se queda
> fuera de N4a y de N4b, y su sitio es una decisión de producto («¿debe poder responderse una
> valoración?»), no la lista de notificaciones pendientes.

**N4a queda cerrado con dos eventos**, no tres. La mensajería (N4b) no se ve afectada.

---

## 8. El plan de N4

**Dos mitades muy distintas.** La reputación es rutina; la mensajería es la que trae modelo
nuevo.

| # | Trabajo | Tamaño | Riesgo |
|---|---|---|---|
| 1 | **Reputación**: 2 tipos + 1 acción, sus `case`, sus copys | pequeña | ninguno — molde conocido |
| 2 | **Migración**: `Notification.groupKey` + `@@unique([userId, type, groupKey])` | pequeña | aditiva, sin backfill; los `NULL` no colisionan |
| 3 | **Presencia**: `conversation:active` en gateway y cliente | pequeña-mediana | toca tiempo real; el fallo cae del lado seguro |
| 4 | **La notificación viva**: upsert, recálculo, revivir, marcar leída al abrir | mediana | es lo nuevo del buzón |
| 5 | **La ventana de gracia**: job con `delay` + `jobId`, comprobación al disparar, correo agrupado | mediana | primer job diferido del proyecto |

**Orden sugerido:** 1 (independiente, cierra valor rápido) → 2 → 4 → 3 → 5. La presencia va
después de la notificación viva a propósito: sin ella se notifica de más, que es un estado
tolerable e inspeccionable; al revés no se puede probar nada.

**Se puede partir en dos ráfagas** (reputación / mensajería) sin coste: no comparten nada.

---

## 9. Las barreras

Lo que hay que poder demostrar, y con qué mutación se comprueba que la barrera muerde:

| # | Barrera | Mutación que debe romperla |
|---|---|---|
| 1 | **Por conversación, no por mensaje**: 5 mensajes seguidos → **1** notificación con contador 5 | Crear en vez de upsert → 5 filas |
| 2 | **El contador se recalcula**: leer parcialmente y recibir otro deja el número exacto | Usar `increment` → deriva |
| 3 | **Viendo el hilo → silencio**: con el hilo activo, ni notificación ni correo | Quitar el test de presencia → aviso de algo que está viendo |
| 4 | 🔴 **Otro hilo abierto SÍ notifica**: con A y B abiertos y mirando B, un mensaje en A notifica | Usar la sala en vez del hilo activo → se pierde (§1.2) |
| 5 | **La ventana no duplica**: 5 mensajes en la ventana → **1** job encolado | Quitar el `jobId` → 5 correos |
| 6 | **Leer cancela**: leer antes de N → el job dispara y **no manda nada** | Quitar la comprobación → correo de algo ya leído |
| 7 | **El correo va agrupado**: un correo con el total, nunca uno por mensaje | — |
| 8 | **El buzón sigue intacto**: los tipos sin `groupKey` siguen creando una fila por evento | Poner `groupKey` a un tipo de evento → se pisarían entre sí |

La 4 es la que esta investigación añade y la que se habría escapado: es la única cuya
implementación «obvia» (preguntar por la sala) pasa las demás y falla ésta **en silencio**.
