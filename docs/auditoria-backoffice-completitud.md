# Auditoría — Completitud y enlaces del backoffice

**Estado:** auditoría de estado real. Cero código escrito, cero cambios propuestos como hechos.
**Alcance:** tres superficies —reportes, mensajería, tickets/valoraciones— y la coherencia
de los enlaces entre ellas.
**Medido contra el código** el 2026-08-28, `main` (`5a9432b`). Todo lo que dice «no se
muestra» o «enlaza mal» está comprobado en el fichero y la línea que se cita. Lo que ya
está bien se dice también, y hay bastante.

---

## 0. El resultado, en una frase

> **El backend sirve más de lo que la interfaz pinta, y los enlaces se escriben a mano.**
> No hay ni un dato que haya que ir a buscar al servidor: los snapshots de denuncia, el
> `resolvedBy`, la valoración enlazada a un ticket y el endpoint de detalle de reporte
> **ya viajan o ya existen**, y nadie los lee. Y de los diecisiete enlaces a entidades que
> hay en el backoffice, **tres sacan al moderador fuera del backoffice** a una página
> pública que para lo que está mirando suele ser un 404.

| Parte | Veredicto | Tamaño |
|---|---|---|
| **Reportes** | **Existe e incompleto.** Contenido a medias, snapshots muertos, un tipo de denuncia sin enlace, un estado inalcanzable, la paginación sin usar | Mediano |
| **Mensajería** | **NO EXISTE.** Ni endpoint de staff, ni superficie. Sólo un contador en la ficha de anuncio | **Grande — es lo único realmente nuevo** |
| **Tickets** | **Existe e incompleto.** Dos enlaces mal, la valoración enlazada nunca se pinta, enums en crudo | Pequeño |
| **Valoraciones** | **Existe y está mejor de lo esperado.** Se moderan desde la ficha de la persona, con acciones y enlaces correctos. Le falta el enlace al anuncio | Muy pequeño |
| **Coherencia de enlaces** | **No hay helper. 17 enlaces a mano, 3 mal.** | Pequeño, y es el corazón |

**La hipótesis del encargo se confirma**: sí hay un patrón común, y sí es un helper de
enlaces. Pero **no es el arreglo más caro** — es el más barato de los cuatro. El caro es
la mensajería, que no existe.

---

## 1. Reportes

### 1.1 El modelo — lo que un `Report` sabe

[`schema.prisma:1614-1712`](../apps/api/prisma/schema.prisma#L1614). Una denuncia apunta a
**una de tres cosas**, y lleva de cada una un **snapshot** que sobrevive al borrado:

| Diana | FK | Snapshot que la acompaña |
|---|---|---|
| Anuncio | `listingId` (`SetNull`) | `listingTitle` |
| Usuario | `reportedUserId` | `reportedUserName` |
| Valoración | `reviewId` (`SetNull`) | `reviewComment`, `reviewAuthorName` |

Más: `reason` (enum), `description` (texto libre), `status`, `reporter`, `resolvedBy`,
`resolvedAt`, `createdAt`, y `tickets[]` (los hilos abiertos a raíz de la denuncia).

Los tres snapshots están documentados con su porqué en el propio schema: *«sin él, el
`SetNull` de arriba dejaría la denuncia sin contexto legible: la cola de moderación
mostraría un reporte de "algo" que ya no se puede nombrar»*.

### 1.2 Qué se pinta hoy — y qué no

Superficie única: [`/admin/reportes/page.tsx`](../apps/web/src/app/(admin)/admin/reportes/page.tsx),
una tabla de seis columnas. **No hay página de detalle** (`ls` sobre la carpeta: sólo
`page.tsx`).

| Campo | ¿Viaja del backend? | ¿Se pinta? | Dónde |
|---|---|---|---|
| `reason` | ✅ | ✅ traducido | `:192` |
| `description` | ✅ | ✅ | `:193-195` |
| `status` | ✅ | ✅ traducido, con color | `:238-252` |
| `createdAt` | ✅ | ✅ (sólo fecha, sin hora) | `:254-260` |
| `reporter` | ✅ (`id, name, slug`) | ⚠️ **sólo el nombre, sin enlace** | `:234-236` |
| `listing` | ✅ | ✅ con enlace correcto | `:207-213` |
| `reportedUser` | ✅ | ⚠️ enlace **a la web pública** | `:217-224` |
| `review` | ✅ | ⚠️ se pinta, **sin ningún enlace** | `:44-67, 227-228` |
| `resolvedBy` | ✅ **lo sirve el backend** | ❌ **nunca se pinta** | — |
| `resolvedAt` | ✅ (escalar) | ❌ **nunca se pinta** | — |
| `listingTitle` | ✅ (escalar) | ❌ **nunca se pinta** | — |
| `reportedUserName` | ✅ (escalar) | ❌ **nunca se pinta** | — |
| `reviewComment` / `reviewAuthorName` | ✅ (escalares) | ❌ **nunca se pintan** | — |

> **Sobre «viaja del backend»:** `listReports` usa `include`
> ([`moderation.service.ts:129-152`](../apps/api/src/modules/moderation/moderation.service.ts#L129-L152)),
> y con `include` Prisma devuelve **todos los escalares** además de las relaciones. Los
> cuatro snapshots y `resolvedAt` están en la respuesta HTTP hoy mismo. Lo que falta es que
> el tipo del frontend los declare ([`lib/api/moderacion.ts:13-43`](../apps/web/src/lib/api/moderacion.ts#L13-L43)
> no los tiene) y que la tabla los lea.

### 1.3 Los snapshots: el defecto de fondo

Es el hallazgo con más consecuencia de esta parte. La tabla decide qué enseñar así
([`reportes/page.tsx:199-231`](../apps/web/src/app/(admin)/admin/reportes/page.tsx#L199-L231)):

```tsx
{r.listing ? (…) : r.reportedUser ? (…) : r.review ? (…) : <span>—</span>}
```

**Si el anuncio denunciado se borró, `r.listing` es `null`** (por el `SetNull` que B1 puso
precisamente para que la denuncia sobreviviera) y la cadena cae hasta el `—`. Resultado: la
denuncia sigue viva, con su motivo y su descripción, pero **la columna «Recurso» dice un
guion**. El `listingTitle` que se guardó justo para este momento está en el payload y no se
mira.

Lo mismo con una valoración retirada y borrada más adelante (`reviewComment` /
`reviewAuthorName`), y lo mismo —con un matiz— con un usuario eliminado: ahí la fila de
`User` sobrevive vaciada, así que `r.reportedUser` **no** es null pero su `name` es «Usuario
eliminado»; el snapshot `reportedUserName` existe para eso y tampoco se lee.

> **Traducido a operación:** el trabajo que B1 y C1 hicieron para que una denuncia siga
> siendo legible cuando su objeto desaparece **está hecho en el dato y sin terminar en la
> pantalla**. Es la clase de defecto que no se ve hasta el día que importa.

### 1.4 Los enlaces, uno a uno

| Tipo de denuncia | ¿Hay enlace? | ¿A dónde? | Veredicto |
|---|---|---|---|
| **A un anuncio** | ✅ | `/admin/anuncios/{id}` | **Correcto.** Y con su porqué escrito: F1 lo cambió desde `/anuncio/{slug}` porque la página pública lanza 404 para todo lo que no sea `ACTIVE`, y un anuncio denunciado suele estar ya retirado |
| **A un usuario** | ⚠️ | `/vendedor/{slug}`, `target="_blank"` | **Mal, y es el mismo defecto que F1 arregló para anuncios.** Saca al moderador del backoffice, a una pantalla que no muestra nada de moderación —ni su historial, ni sus otras denuncias, ni sus tickets— y que **404 si la cuenta está suspendida o eliminada**, que es justo el caso de una denuncia |
| **A una valoración** | ❌ | ninguno | **Falta entero.** `ReviewSnippet` pinta estrellas, autor, destinatario y comentario, **todo como texto plano**. No se puede ir ni al autor, ni al destinatario, ni al anuncio de la valoración |
| **El reportante** | ❌ | ninguno | Sólo el nombre. Y el backend ya sirve su `id` y su `slug` — el «denunciante compulsivo» que la ficha de usuario sabe detectar no se puede abrir desde aquí |
| **El hilo abierto** | ✅ | `/admin/tickets/{id}` | **Correcto** |

### 1.5 Dos defectos de alcance, no de contenido

**(a) La paginación existe en el API y no en la interfaz.** `getReports` acepta `page`
([`moderacion.ts:60-67`](../apps/web/src/lib/api/moderacion.ts#L60)) y el backend pagina de
24 en 24 ([`moderation.service.ts:122`](../apps/api/src/modules/moderation/moderation.service.ts#L122)).
La página **nunca pasa `page`** y **no pinta controles**: se muestra «N total» y sólo se
puede trabajar con las 24 primeras. Con 25 denuncias, la 25.ª es inalcanzable.

**(b) El estado `REVIEWING` es inalcanzable.** Existe el endpoint
`PATCH /moderation/reports/:id/start-review`
([`moderation.controller.ts:66-68`](../apps/api/src/modules/moderation/moderation.controller.ts#L66)),
existe el filtro «En revisión» en la interfaz (`:39`) — y **ningún botón lo dispara**
(`grep startReview` en `apps/web/src`: cero resultados). Un filtro que nunca puede tener
contenido.

**(c) Y hay un endpoint de detalle sin superficie.** `GET /moderation/reports/:id`
([`moderation.service.ts:159-179`](../apps/api/src/modules/moderation/moderation.service.ts#L159))
devuelve **más** que el listado —el email del reportante, y el vendedor del anuncio
denunciado— y no lo llama nadie. Si se decide hacer ficha de detalle de reporte, el backend
ya está.

### 1.6 La otra cara: dónde se ven las denuncias además de en su cola

| Superficie | Qué muestra | Qué falta |
|---|---|---|
| Ficha de anuncio ([`anuncios/[id]:1099-1126`](../apps/web/src/app/(admin)/admin/anuncios/[id]/page.tsx#L1099)) | motivo, estado, nombre del reportante, fecha | **la `description`** (el texto de la queja, que es la sustancia), enlace al reporte concreto, enlace al reportante. El «Ir a reportes →» va a la lista **sin filtrar** |
| Ficha de usuario, «Reportes recibidos» ([`usuarios/[id]:399-416`](../apps/web/src/app/(admin)/admin/usuarios/[id]/page.tsx#L399)) | motivo + estado, y ya | **fecha, descripción, contra qué era, y cualquier enlace** |
| Ficha de usuario, «Reportes hechos» (`:418-441`) | motivo + estado | lo mismo |

---

## 2. Mensajería — **no existe**

### 2.1 El modelo

`Conversation` ([`schema.prisma:1367-1410`](../apps/api/prisma/schema.prisma#L1367)) es
**por anuncio y por comprador**: `listingId` (nullable, `SetNull`, con snapshot
`listingTitle`), `buyerId`, `sellerId`, `lastMessageAt`, y `messages[]` + `deals[]`. Una
conversación toca por tanto **un anuncio y dos personas**, que es exactamente lo que el
encargo quiere alcanzar desde las dos fichas.

### 2.2 Lo que hay hoy en el backoffice

**Nada más que un número.**

- **Endpoints de staff:** ninguno. `grep -rn "conversation"` en `modules/admin/` y
  `modules/moderation/` devuelve **cinco líneas y todas son `count`**
  ([`admin.service.ts:854, 1280, 3410-3450`](../apps/api/src/modules/admin/admin.service.ts#L854)):
  el contador de la ficha de anuncio y las cifras del panel de estadísticas.
- **Ficha de anuncio:** `<Dato etiqueta="Conversaciones" valor={data._count.conversations} />`
  ([`anuncios/[id]:1223`](../apps/web/src/app/(admin)/admin/anuncios/[id]/page.tsx#L1223)).
  Un número, sin enlace.
- **Ficha de usuario:** ni el número. Sus secciones son Actividad, Anuncios, Valoraciones
  recibidas, Valoraciones dadas, Reportes recibidos, Reportes hechos, Tickets y Datos
  ([`usuarios/[id]`](../apps/web/src/app/(admin)/admin/usuarios/[id]/page.tsx)) — **no hay
  sección de mensajería**.

### 2.3 El veredicto

> **Es superficie NUEVA, no incompleta: backend y frontend.** Hace falta al menos un
> endpoint de staff que liste conversaciones por anuncio y por usuario, otro que sirva los
> mensajes de una conversación, y la interfaz de los dos.

Y es la parte que trae **decisiones de privacidad que las otras tres no tienen**: leer la
mensajería privada de dos personas no es lo mismo que ver una denuncia que alguien escribió
para que el staff la leyera. Como mínimo hay que decidir quién puede (¿MODERATOR o sólo
ADMIN?), si queda registrado en `AuditLog` que un moderador abrió un hilo ajeno, y si se ve
el contenido íntegro o sólo la cabecera. **Esas preguntas no se responden en una auditoría**,
pero condicionan el tamaño: son las que convierten «una pantalla más» en un diseño propio.

---

## 3. Tickets

### 3.1 El modelo

`Ticket` ([`schema.prisma:3164-3210`](../apps/api/prisma/schema.prisma#L3164)) puede
enlazar con **cuatro** cosas: `listingId`, `reviewId`, `invoiceId` y `reportId` (todas
`SetNull`), más `linkedLabel` como snapshot legible. Y tiene `user` (de quién es el hilo),
`openedBy` y `assignedTo`.

### 3.2 Qué se pinta y qué se enlaza

[`tickets/[id]/page.tsx:374-422`](../apps/web/src/app/(admin)/admin/tickets/[id]/page.tsx#L374).
El panel lateral tiene tres bloques:

| Bloque | Enlace | Veredicto |
|---|---|---|
| **Usuario** | `/vendedor/{slug}` — «Ver perfil público» | ⚠️ **Mal.** Mismo defecto que en reportes: saca del backoffice. Y no hay enlace a `/admin/usuarios/{id}`, que es donde está su historial |
| **Relacionado** (anuncio) | `/anuncio/{ticket.listing.slug}` — «Ver anuncio» | ⚠️ **Mal, y es el más claro de todos.** La página pública **404 si el anuncio no está `ACTIVE`**, que es lo normal en un ticket de soporte. Y el `id` para el enlace correcto **está en el payload**: `TICKET_INCLUDE` sirve `listing: {id, title, slug}` ([`tickets.service.ts:47`](../apps/api/src/modules/tickets/tickets.service.ts#L47)) |
| **Desde una denuncia** | `/admin/reportes` (la lista entera) | ⚠️ Lo mejor posible hoy —no hay ficha de reporte— pero además **pinta los enums en crudo**: `{ticket.report.reason} · {ticket.report.status}` (`:416`) muestra `SPAM · PENDING`, mientras la cola de reportes sí los traduce |
| **Valoración enlazada** | — | ❌ **No existe el bloque**, aunque `TICKET_INCLUDE` sirve `review: {id, rating}` ([`tickets.service.ts:48`](../apps/api/src/modules/tickets/tickets.service.ts#L48)). Un ticket abierto sobre una valoración no dice cuál |

### 3.3 Lo que sí está bien

El listado (`tickets/page.tsx:255`) y la ficha de usuario (`usuarios/[id]:450`) enlazan a
`/admin/tickets/{id}` correctamente. La creación desde un usuario
(`tickets/nuevo?userId=`) y desde un reporte (`from-report/{reportId}`) funcionan y están
enlazadas en las dos direcciones.

---

## 4. Valoraciones

**Es la parte que mejor está, y conviene decirlo para no inflar el trabajo.**

- **No hay `/admin/valoraciones`, y es deliberado.** Se moderan desde la ficha de la
  persona, con el porqué escrito en el código: *«las acciones sólo aquí y en "dadas", no en
  la ficha de anuncio: se modera la valoración desde la ficha de la PERSONA, que es donde
  el moderador está mirando su reputación»* ([`usuarios/[id]:334-337`](../apps/web/src/app/(admin)/admin/usuarios/[id]/page.tsx#L334)).
- **El contenido está completo**: estrellas, comentario, fecha, la otra persona, `verified`,
  y `retiredAt` + `retiredReason` cuando está retirada.
- **El enlace a la persona es CORRECTO**: `ValoracionFila` usa
  `/admin/usuarios/{persona.id}` ([`ValoracionFila.tsx:79`](../apps/web/src/components/admin/ValoracionFila.tsx#L79)).
  **Es el único sitio del backoffice que enlaza a un usuario como debe**, y por eso los tres
  enlaces malos de §5 no admiten la excusa de «no había criterio».
- **Las acciones existen**: `AccionesValoracion` (retirar / restaurar) desde las dos listas.

**Lo único que falta**: la valoración no enlaza al **anuncio** ni al trato del que salió,
aunque `Review.listingId` y `listingTitle` existen en el modelo. Un moderador que juzga si
una reseña es falsa no puede ver la operación que la originó sin buscarla a mano.

---

## 5. La coherencia de los enlaces — el patrón

### 5.1 No hay helper. Hay diecisiete enlaces a mano

`grep -rn '/admin/anuncios/\${\|/admin/usuarios/\${\|/admin/tickets/\${\|/vendedor/\${'`
sobre `apps/web/src`: **17 plantillas escritas a mano** repartidas en 13 ficheros. Y
`grep -rn "linkToListing\|adminListingUrl\|rutaAdmin\|adminUrl"`: **cero**. No existe
ninguna función compartida.

### 5.2 Los tres que están mal

| # | Dónde | Escribe | Debería | Por qué duele |
|---|---|---|---|---|
| 1 | [`reportes/page.tsx:218`](../apps/web/src/app/(admin)/admin/reportes/page.tsx#L218) | `/vendedor/{slug}` | `/admin/usuarios/{id}` | El usuario denunciado puede estar suspendido o eliminado → **404**. Y aunque cargue, no enseña nada de moderación |
| 2 | [`tickets/[id]/page.tsx:382`](../apps/web/src/app/(admin)/admin/tickets/[id]/page.tsx#L382) | `/vendedor/{slug}` | `/admin/usuarios/{id}` | Ídem |
| 3 | [`tickets/[id]/page.tsx:398`](../apps/web/src/app/(admin)/admin/tickets/[id]/page.tsx#L398) | `/anuncio/{slug}` | `/admin/anuncios/{id}` | **404 para todo lo que no sea `ACTIVE`** — exactamente el defecto que F1 documentó y arregló en reportes, todavía vivo aquí. El `id` ya viaja en el payload |

Los tres son **la misma equivocación**: usar la ruta pública desde una pantalla de staff.
F1 ya la diagnosticó por escrito para el caso de los anuncios en la cola de moderación
(*«ese enlace estaba roto el 100 % de las veces»*); lo que la auditoría añade es que **se
arregló en un sitio y sobrevivió en tres**.

### 5.3 Por qué un helper es la respuesta, y por qué es barato

Es la misma forma que ya se ha visto dos veces en este repo: el selector de banners tenía
las ubicaciones en tres sitios, y los límites de fotos vivían en tres copias hasta que
`photo-limits.ts` los recogió. Aquí el helper sería un fichero de cuatro funciones —
`adminListingHref(id)`, `adminUserHref(id)`, `adminTicketHref(id)`, y el que hoy no puede
existir, `adminReportHref(id)` — con dos propiedades que las plantillas sueltas no tienen:

1. **Un sitio donde arreglarlo.** Si mañana la ficha de usuario cambia de ruta, hoy hay que
   encontrar tres plantillas; con el helper, una función.
2. **Un sitio donde documentar la regla**, que es la que se olvidó tres veces: *desde el
   backoffice se enlaza al backoffice; la ruta pública sólo con una etiqueta explícita
   («ver como lo ve un visitante») y sabiendo que puede dar 404*.

No elimina las 17 llamadas, pero convierte «¿esta URL es la correcta?» en «¿estoy llamando
a la función?», que es una pregunta que se responde de un vistazo.

### 5.4 El otro patrón: no hay forma común de «pintar una entidad relacionada»

Además de los enlaces, cada superficie decide por su cuenta qué campos enseña de lo mismo:

| Entidad | En su cola | En la ficha de anuncio | En la ficha de usuario |
|---|---|---|---|
| **Denuncia** | motivo, descripción, estado, reportante, fecha | motivo, estado, reportante, fecha (**sin descripción**) | motivo, estado (**sin fecha, sin descripción, sin diana**) |

Tres versiones de «una denuncia resumida», cada una con menos que la anterior, y ninguna
compartida. **Un componente `ReporteFila` resolvería las tres**, igual que `ValoracionFila`
ya resuelve las dos listas de valoraciones — el precedente existe y funciona.

---

## 6. ¿Juntas o por separado? — la decisión que el encargo dejó abierta

**Juntas las tres de «enlaces y completitud»; la mensajería, aparte.**

**Por qué juntas reportes + tickets + valoraciones:** comparten el arreglo. El helper de §5.3
y el `ReporteFila` de §5.4 tocan las tres a la vez, y los tres enlaces malos están en dos
ficheros. Separarlas obligaría a introducir el helper en una ráfaga y a adoptarlo en las
otras dos, que es la forma segura de dejar la mitad sin adoptar.

**Por qué la mensajería no:** no comparte nada con las otras tres. No es un enlace que
apunte mal ni un campo que no se pinta — es **backend nuevo, interfaz nueva y decisiones de
privacidad nuevas** (§2.3). Meterla en la misma ráfaga convertiría un arreglo acotado y
verificable en un proyecto con preguntas abiertas, y lo primero se retrasaría por lo
segundo.

---

## 7. El plan

### Ráfaga A — el helper y los tres enlaces rotos *(pequeña, alto valor)*

1. `lib/admin-links.ts`: `adminListingHref`, `adminUserHref`, `adminTicketHref`, con la
   regla escrita en la cabecera.
2. Adoptarlo en los 17 sitios.
3. Arreglar los tres de §5.2 y añadir el bloque de **valoración enlazada** al ticket (el
   dato ya viaja).
4. Traducir los enums del panel «Desde una denuncia» reutilizando las etiquetas que ya
   existen.

**Barreras:** ningún `href` a `/vendedor/` ni a `/anuncio/` dentro de `app/(admin)` (un
`grep` en un test lo fija para siempre); desde un ticket de un anuncio no-`ACTIVE` se llega
a su ficha del backoffice y **se ve**; desde una denuncia a un usuario suspendido se llega a
su ficha de staff.

### Ráfaga B — la completitud de reportes *(mediana)*

5. Declarar los cuatro snapshots + `resolvedAt` en el tipo del frontend y **usarlos como
   respaldo** cuando la relación es `null` (§1.3). Con una marca visible de «ya no existe»,
   sin enlace muerto.
6. Enlazar el **reportante** y los tres elementos del `ReviewSnippet`.
7. Pintar **quién resolvió y cuándo**.
8. **Paginación** (el API ya la sirve).
9. Decidir qué hacer con `REVIEWING`: **o se le pone botón, o se quita el filtro.** Un filtro
   que nunca tiene contenido miente.
10. `ReporteFila` compartido por las tres superficies (§5.4), con la `description` incluida.

**Barreras:** una denuncia cuyo anuncio se borró **sigue diciendo de qué era**; una denuncia
sobre un usuario eliminado sigue diciendo contra quién; con 25 denuncias se llega a la 25.ª;
desde una valoración denunciada se llega a su autor y a su destinatario.

**Opcional dentro de B** — la ficha de detalle de reporte (`/admin/reportes/[id]`). El
endpoint ya existe y sirve más datos (§1.5c), y resolvería de paso el enlace «Ir a
moderación» del ticket, que hoy va a la lista entera. **Se plantea, no se recomienda de
entrada**: la tabla con `ReporteFila` completa puede bastar, y una ficha más es una
superficie más que mantener.

### Ráfaga C — la mensajería *(grande, y necesita diseño antes)*

11. **Diseño previo**, no implementación directa: quién puede leer hilos ajenos, si queda en
    `AuditLog`, si se ve el contenido íntegro.
12. Endpoints de staff: conversaciones por anuncio, por usuario, y los mensajes de una.
13. Las dos superficies, colgando de las fichas que ya existen.

**Barreras:** desde un anuncio se ven **todas** sus conversaciones y desde un usuario las
suyas **como comprador y como vendedor**; una conversación cuyo anuncio se borró sigue
siendo legible por su `listingTitle`; el acceso queda registrado si así se decide.

---

## 8. Lo que ya está bien — para no arreglar lo que no está roto

- La cola de reportes **traduce** motivos y estados, pinta la descripción y colorea el
  estado.
- El enlace de denuncia → **anuncio** es correcto, y con el porqué escrito.
- El circuito **denuncia ⇄ ticket** funciona en las dos direcciones y evita abrir hilos
  duplicados.
- La moderación de **valoraciones** está completa: contenido, acciones, estado de retirada
  con motivo, y el enlace a la persona **bien hecho** — es el precedente que las demás no
  siguieron.
- Los snapshots **existen en el modelo** y están bien argumentados. El trabajo de datos está
  hecho; falta leerlo.
- La ficha de usuario avisa honestamente de que muestra «las 10 más recientes» en vez de
  fingir que están todas.

---

## 9. Registro

### Medido y confirmado

| # | Hallazgo | § |
|---|---|---|
| 1 | Los cuatro snapshots de `Report` viajan en la respuesta y **no se pintan nunca** | 1.2, 1.3 |
| 2 | `resolvedBy` y `resolvedAt` tampoco | 1.2 |
| 3 | Denuncia a **valoración**: sin ningún enlace | 1.4 |
| 4 | Denuncia a **usuario**: enlace a la web pública (404 si suspendido) | 1.4, 5.2 |
| 5 | El **reportante** nunca es enlazable | 1.4 |
| 6 | Sin paginación en la cola: sólo 24 denuncias alcanzables | 1.5a |
| 7 | `REVIEWING` es filtrable pero **inalcanzable** | 1.5b |
| 8 | `GET /moderation/reports/:id` existe y **no lo usa nadie** | 1.5c |
| 9 | **Mensajería: no existe** en el backoffice, sólo un contador | 2 |
| 10 | Ticket → anuncio enlaza a la página **pública** (404 si no `ACTIVE`), teniendo el `id` | 3.2, 5.2 |
| 11 | Ticket → usuario enlaza a la web pública | 3.2, 5.2 |
| 12 | La **valoración** de un ticket viaja y no se pinta | 3.2 |
| 13 | Enums en crudo en el panel «Desde una denuncia» | 3.2 |
| 14 | **17 enlaces a mano, ningún helper** | 5.1 |
| 15 | Tres versiones distintas de «denuncia resumida», ninguna compartida | 5.4 |
| 16 | La valoración no enlaza a su anuncio | 4 |

### Refutado

| # | Lo que se sospechaba | Lo que se midió |
|---|---|---|
| 1 | Que las valoraciones estuvieran incompletas o mal enlazadas | **Están bien.** Contenido completo, acciones, y el **único** enlace a usuario correcto del backoffice |
| 2 | Que faltara una superficie de moderación de valoraciones | No falta: es una decisión documentada moderarlas desde la ficha de la persona |
| 3 | Que la mensajería fuera «una superficie incompleta» | Es **inexistente**: ni endpoint de staff |
| 4 | Que el enlace denuncia → anuncio pudiera estar mal | Es correcto desde F1 |

### Abiertas — decide Ernest

| # | Pregunta | § |
|---|---|---|
| A | `REVIEWING`: ¿se le pone botón o se retira el filtro? | 1.5b |
| B | ¿Ficha de detalle de reporte, o basta la tabla completa? | 7 |
| C | Mensajería: ¿quién puede leer hilos ajenos, queda en `AuditLog`, contenido íntegro o cabecera? | 2.3, 7 |
| D | ¿Se confirma el corte A+B juntas y C aparte? | 6 |
