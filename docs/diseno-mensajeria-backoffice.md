# Diseño — Mensajería en el backoffice (ajuste C)

**Estado:** diseño, sin implementar. Cero código escrito.
**Encargo:** que el staff acceda, desde un anuncio y desde un usuario, a toda la
mensajería relacionada, mostrada correcta y completamente.
**Verificado contra el código** el 2026-08-28, `main` (`3aba2b9`).

---

## 0. Resumen para decidir

> **Es la única parte del backoffice que no existe, y la única que abre una
> capacidad nueva en vez de conectar una que ya estaba.** A+B fue enseñar datos
> que el backend ya servía. Esto es dar al staff la llave de la correspondencia
> privada de dos personas, que hasta hoy nadie de la casa podía leer.

| | |
|---|---|
| **Superficie hoy** | Un número en la ficha de anuncio (`_count.conversations`). Nada en la de usuario. **Cero endpoints de staff.** |
| **Modelo** | Sencillo y suficiente: `Conversation(listingId?, buyerId, sellerId, listingTitle)` + `Message(senderId, body, readAt, createdAt)` |
| **Lo que hay que decidir** | Tres preguntas de privacidad (§2). Las tres son de producto |
| **Trampas encontradas** | Dos, y una es grave: reutilizar el lector del usuario **marcaría los mensajes como leídos** (§3.1) |
| **Tamaño** | Backend mediano (3 endpoints + política), interfaz mediana (2 secciones + vista de hilo) |

**Mi recomendación en una línea, para que se lea antes que los argumentos:**
**MODERATOR** puede ver *que existen* los hilos y sus cabeceras; **abrir el
contenido es ADMIN**; **abrir se audita**; y el contenido se ve **íntegro**.
El porqué de cada una está en §2, con sus alternativas.

---

## 1. Lo verificado

### 1.1 El modelo

```prisma
// schema.prisma:1367-1417
model Conversation {
  id            String
  listingId     String?      // SetNull — B1
  listingTitle  String?      // snapshot, para sobrevivir al borrado del anuncio
  buyerId       String
  sellerId      String
  lastMessageAt DateTime
  createdAt     DateTime
  messages      Message[]
  deals         Deal[]
  @@unique([listingId, buyerId])
}

// schema.prisma:1419-1430
model Message {
  id             String
  conversationId String   // Cascade
  senderId       String
  body           String   @db.Text
  readAt         DateTime?
  createdAt      DateTime
}
```

Lo que esto responde a las preguntas del encargo:

- **Una conversación se ata a UN anuncio y a DOS personas** — comprador y
  vendedor, denormalizados los dos. `@@unique([listingId, buyerId])`: un hilo por
  (anuncio, comprador).
- **Un usuario tiene DOS CARAS**, y la ficha tiene que enseñar las dos: sus hilos
  como `buyerId` (lo que preguntó por cosas de otros) y como `sellerId` (lo que le
  preguntaron por lo suyo). Las relaciones se llaman `BuyerConversations` y
  `SellerConversations`; no hay una sola lista.
- **Un mensaje es texto y nada más.** No hay adjuntos, no hay edición, **no hay
  borrado por el usuario** (`Message` no tiene `deletedAt`). Eso simplifica la
  pregunta 3: no existe «mensajes borrados que el staff podría resucitar».
- `listingTitle` ya está y es el snapshot que mantiene legible el hilo si el
  anuncio desaparece (§6).

### 1.2 Lo que hay hoy en el backoffice: un número

`grep -rn "conversations"` en `modules/admin/`: **cinco líneas, las cinco `count`**.

| Línea | Qué es |
|---|---|
| [`admin.service.ts:854`](../apps/api/src/modules/admin/admin.service.ts#L854) | `_count.conversations` del detalle de anuncio |
| [`:1280`](../apps/api/src/modules/admin/admin.service.ts#L1280) | `_count` del listado de anuncios |
| [`:3410, 3420, 3449-3450`](../apps/api/src/modules/admin/admin.service.ts#L3410) | El total global del panel de estadísticas |

En la interfaz: `<Dato etiqueta="Conversaciones" valor={data._count.conversations} />`
([`anuncios/[id]:1223`](../apps/web/src/app/(admin)/admin/anuncios/[id]/page.tsx)).
Un número sin enlace. La ficha de usuario **ni el número**.

**No hay endpoint de staff, ni servicio, ni DTO. Es superficie nueva de arriba abajo.**

### 1.3 El chat NO enmascara nada

Buscado (`mask|enmascar|censur|redact|oculta`) en `modules/messaging/`: **cero
coincidencias**. Un mensaje se guarda y se sirve tal cual.

Conviene decirlo porque la plataforma **sí** trata los datos de contacto como
sensibles en otros sitios: el teléfono de un anuncio vive detrás de un botón
(`hasPhone` + `PhoneButton`) y hay detectores que marcan teléfonos y correos **en
el texto de un anuncio** (`detections.refresh(listingId, {title, description,
phone})`). Nada de eso alcanza a los mensajes: si dos personas se intercambian un
número por el chat, ahí está en claro.

**Consecuencia para la pregunta 3:** no hay una máscara que el staff «se salte».
La pregunta no es *«¿se le quita la máscara?»* sino *«¿se le enseña lo que hay?»*.

### 1.4 No existe ningún registro de LECTURA

Las **60 acciones** distintas de `AuditLog` del repo son todas mutaciones
(`*_CREATE`, `*_UPDATE`, `*_DELETE`, `*_ASSIGN`, `*_RESOLVE`…). La más parecida a
un acceso es `USER_DATA_EXPORT_REQUESTED`, y es una **acción** (alguien pidió un
ZIP), no una lectura.

**Auditar una lectura sería un patrón nuevo en este repositorio.** No es un
argumento en contra —§2.2 recomienda hacerlo— pero sí un dato honesto: no hay
molde que copiar, hay que establecerlo.

### 1.5 El reparto de roles vigente

Dos hechos que deciden casi sola la pregunta 1:

**(a) El controlador de admin es ADMIN por defecto y baja a MODERATOR ruta por
ruta.** `@MinRole(Role.ADMIN)` a nivel de clase
([`admin.controller.ts:43`](../apps/api/src/modules/admin/admin.controller.ts#L43));
cada ruta que quiere MODERATOR lo dice. **Un endpoint nuevo que no diga nada nace
ADMIN.** El default seguro está construido.

**(b) Ya existe el precedente exacto de «acceso a datos personales de alguien»**, y
es ADMIN, con su razonamiento escrito
([`admin.controller.ts:302-314`](../apps/api/src/modules/admin/admin.controller.ts#L302-L314)):

> *«**ADMIN, y NO MODERATOR** … la ausencia de un `@MinRole(Role.MODERATOR)` aquí
> es la decisión, no un olvido. El argumento no es de jerarquía sino de contenido
> … Contraste deliberado con archivar/desarchivar, que sí son MODERATOR: aquéllos
> son reversibles y no sacan ni un dato del sistema; **éste saca todos**.»*

Y el diseño de la IP añade la doctrina que más se parece a lo que aquí se decide
([`diseno-ultima-ip.md`](diseno-ultima-ip.md)): *«no es historia del anuncio sino
rastro de seguridad de una persona, y auditar personas es otra pantalla con otro
rol»*. La casa ya distingue **el dato del recurso** del **dato de la persona**.

---

## 2. Las tres preguntas de privacidad

Son el motivo por el que esto es un diseño y no una ráfaga. Van con su recomendación
y sus alternativas; **decide Ernest**.

### 2.1 ¿Quién puede leer hilos ajenos?

**El caso de uso real importa antes que el rol.** ¿Para qué abre el staff una
conversación? Por lo que ya existe en el sistema: una denuncia de fraude o de acoso
en la que la prueba está en el chat, un ticket donde alguien dice «me prometió otra
cosa», una investigación de multicuenta. Eso lo lleva **moderación**, no
administración. Un modelo que obligue a escalar cada caso a un ADMIN convierte la
capacidad en inútil el día que hay tres moderadores y un administrador ocupado.

Pero leer una conversación privada **no es como ver una denuncia**: la denuncia se
escribió *para* que el staff la leyera. Un hilo entre dos particulares no.

| Opción | Qué implica |
|---|---|
| **P1. Todo MODERATOR** | Coherente con «moderación es quien investiga». Coste: la capacidad más invasiva del backoffice queda en el piso más poblado del staff, y el precedente del ZIP dice lo contrario para datos personales |
| **P2. Todo ADMIN** | Coherente con el precedente del export y con el default de la clase. Coste: quien de verdad investiga no puede, y la función acaba sin usarse o pidiendo favores |
| **P3. Partido: MODERATOR ve la LISTA, ADMIN abre el CONTENIDO** ⭐ | El moderador ve *que hay siete hilos, con quién y cuándo* —suficiente para casi todo su trabajo: saber si hubo contacto, cuánto y cuándo— y **el cuerpo de los mensajes exige ADMIN** |

**Recomendación: P3.** El reparto no es un término medio de compromiso: separa dos
datos que de verdad son distintos. *Que existió una conversación entre A y B sobre
el anuncio X el día D* es **metadato del recurso** —lo mismo que ya cuenta el
`_count` que hoy ve un MODERATOR en la ficha—. *Lo que se dijeron* es
**correspondencia privada**. Es exactamente la distinción que `diseno-ultima-ip.md`
ya trazó entre el dato del recurso y el rastro de la persona.

Además encaja con la escalera (`diseno-roles.md`, decisión 0.2): no hace falta una
matriz de capacidades, son dos endpoints con dos pisos.

**Si Ernest prefiere P1**, la recomendación cambia de forma pero no de fondo: con
todo en MODERATOR, la auditoría de §2.2 pasa de recomendable a **imprescindible**,
porque sería lo único que quedaría entre la capacidad y el abuso.

### 2.2 ¿Se registra el acceso?

**Recomendación: sí, y sólo al abrir el contenido.**

Un `AuditLog` con `action: 'CONVERSATION_VIEW'`, `resourceType: 'Conversation'`,
`resourceId`, el actor y la IP. **Listar cabeceras no se audita** (es metadato, y
auditar cada carga de la ficha llenaría la tabla de ruido hasta hacerla inútil
justo para lo que sirve).

**Por qué sí**, en orden de peso:

1. **Es lo único que hace revisable la capacidad.** Todo lo demás que hace el staff
   deja rastro porque cambia algo; leer no cambia nada, así que sin registro es
   **invisible por construcción**. Un moderador que abre la conversación de su
   ex-pareja no deja huella de ninguna clase.
2. **Es lo que convierte una promesa en una comprobación.** Si algún día hay que
   responder a un usuario «¿quién ha leído mis mensajes?», sin esto la respuesta
   honesta es «no lo sé».
3. Es barato: una fila por apertura, y el volumen es el de las aperturas de staff,
   no el del tráfico.

**El coste, dicho claro:** es **un patrón nuevo** (§1.4) — hasta hoy `AuditLog` es
un registro de cambios, y esto lo convierte también en registro de accesos. Hay que
aceptar que `before`/`after` quedan vacíos en estas filas, y que el historial de un
recurso pase a mezclar «qué se le hizo» con «quién lo miró». **Alternativa
razonable si eso incomoda:** un modelo propio (`SensitiveAccessLog`) en vez de
reusar `AuditLog`. Cuesta una tabla y una migración, y a cambio no ensucia la
semántica del registro existente. **No la recomiendo de entrada** —una tabla nueva
para N filas al mes es maquinaria por delante de la necesidad— pero es la salida si
se prefiere no tocar el significado de `AuditLog`.

**Y una decisión que va con ésta:** si se audita, **el usuario no se entera**. No se
le notifica que el staff ha leído su hilo. Es lo coherente con una investigación de
fraude, pero conviene que sea una decisión y no un descuido; el registro existe para
que la casa pueda responder si se le pregunta, no para avisar.

### 2.3 ¿Se ve el contenido íntegro?

**Recomendación: sí, íntegro. Y esta es la que menos margen tiene.**

- **No hay nada que desenmascarar** (§1.3): el chat no filtra ni oculta nada, así
  que «ver íntegro» no es levantar una protección, es leer lo que está guardado.
- **No hay mensajes borrados** que resucitar: `Message` no tiene borrado lógico.
- **Y un hilo parcial no sirve para lo que se pide.** Si el staff abre una
  conversación es porque una denuncia dice «me amenazó» o «me pidió el pago fuera».
  Un hilo con huecos no permite decidir ni a favor ni en contra — y decidir mal
  sobre una acusación de fraude es peor que no tener la pantalla.

Lo que **sí** cambia, y es la contrapartida de servirlo entero:

- **El acceso se cierra por arriba** (§2.1) y **se registra** (§2.2). Ésa es la
  protección, no una censura del texto.
- **La vista de staff es de SOLO LECTURA.** El staff no escribe en el hilo, no
  responde y no borra mensajes. Si hay que hablar con alguien, para eso está el
  sistema de tickets, que ya existe y deja rastro (`TICKET_OPEN_BY_ADMIN`).
- **Y no marca nada como leído** — §3.1, que es una trampa de verdad.

**La alternativa** sería enseñar sólo un fragmento alrededor de lo denunciado. Se
descarta: nadie ha denunciado «el mensaje número 14», se denuncia a una persona, y
recortar el contexto es precisamente lo que hace injusta una decisión de moderación.

---

## 3. Dos trampas encontradas en el código

### 3.1 GRAVE — reutilizar el lector del usuario marcaría los mensajes como leídos

```ts
// messaging.service.ts:163-180
async getConversation(id: string, userId: string, query: MessagesQueryDto) {
  …
  await this.prisma.message.updateMany({
    where: { conversationId: id, senderId: { not: userId }, readAt: null },
    data: { readAt: new Date() },
  });
```

`getConversation` **escribe**: marca como leídos los mensajes del otro. Si el
endpoint de staff se apoyara en él —que es lo natural, «ya está hecho»—, **un
moderador abriendo un hilo le diría al comprador que el vendedor ha leído su
mensaje**. Se alteraría el estado de dos personas ajenas, en silencio, y encima
mintiendo: el vendedor no lo ha leído.

> **El camino de staff necesita su propio lector, y esa es la mitad del argumento
> para que sea un servicio aparte y no un parámetro `esStaff` en el de usuario.**
> Un booleano que apaga una escritura es exactamente la clase de bandera que
> `ListingImagesService` documenta haber evitado a propósito.

### 3.2 El usuario eliminado sigue teniendo nombre, pero no el suyo

Eliminar una cuenta no borra su fila: la vacía. `Message.senderId` es obligatorio y
sin `onDelete` declarado, así que la fila del remitente sobrevive con `name` =
«Usuario eliminado». **A diferencia de `Report`, `Conversation` NO tiene snapshot
del nombre de los interlocutores** — sólo `listingTitle`, que es del anuncio.

Consecuencia: un hilo con una cuenta eliminada dirá «Usuario eliminado» en cada
mensaje suyo, y no habrá forma de saber quién era. **No se propone añadir el
snapshot en esta ráfaga** (sería una migración y un backfill para un caso que la
denuncia ya cubre por su lado), pero se anota: es la misma clase de hueco que C1
cerró en `Report`, y si algún día importa, el molde está escrito.

---

## 4. Los endpoints

Tres, todos nuevos, en un `AdminMessagingController` propio (no en `AdminController`,
que ya sirve cinco secciones — mismo criterio que `AdminBannersController`).

| # | Ruta | Rol | Audita | Devuelve |
|---|---|---|---|---|
| 1 | `GET /admin/conversations?listingId=…` | MODERATOR | no | cabeceras paginadas |
| 2 | `GET /admin/conversations?userId=…&rol=buyer\|seller\|ambos` | MODERATOR | no | cabeceras paginadas |
| 3 | `GET /admin/conversations/:id/messages` | **ADMIN** | **sí** | el hilo, paginado |

**Uno solo para 1 y 2** (`listingId` o `userId`, excluyentes) en vez de dos rutas:
es la misma consulta con distinto `where`, y dos rutas serían dos sitios donde
mantener la misma proyección.

**La cabecera** (lo que ve un MODERATOR): `id`, las dos personas con su `id` y
`name` —para enlazar con `adminUserHref`—, el anuncio (`id`, `title`) o su
`listingTitle` de respaldo, `createdAt`, `lastMessageAt`, **número de mensajes** y
**cuántos de cada parte**. Con eso se responde «¿hubo contacto? ¿cuánto? ¿quién
habló más?» sin abrir nada.

**Paginación obligatoria en las tres.** Un vendedor activo tiene cientos de hilos y
un hilo puede tener cientos de mensajes; y la lección de A+B está reciente: el API
de reportes paginaba y la interfaz no lo usaba, así que la denuncia 25 era
inalcanzable. Aquí la paginación entra **con controles desde el primer día**.

**El servicio es propio** (`AdminMessagingService`), por §3.1.

---

## 5. Las dos superficies

Cuelgan de las fichas que ya existen; no hay pantalla nueva de primer nivel.

### 5.1 En `/admin/anuncios/[id]`

Una sección «Conversaciones» donde hoy está el número suelto. Lista de cabeceras
—comprador, nº de mensajes, última actividad—, cada una enlazando a su hilo.
El `<Dato>` actual desaparece: el contador pasa a ser el `contador` de la
`<Seccion>`, que es el molde que ya usan «Reportes» y «Tickets» en esa misma ficha.

### 5.2 En `/admin/usuarios/[id]`

Una sección «Conversaciones» con **las dos caras separadas**, porque significan
cosas distintas: *«como comprador»* (lo que preguntó) y *«como vendedor»* (lo que le
preguntaron). Un usuario que sólo compra no debería ver una lista vacía sin
etiqueta, y mezclarlas escondería justamente el patrón que se investiga («escribe a
cincuenta vendedores y no compra nunca»).

Molde: las dos secciones de valoraciones («recibidas» / «dadas»), que ya resolvieron
exactamente esta forma.

### 5.3 El hilo

**Decisión: ruta propia, `/admin/conversaciones/[id]`.** No un modal ni un
desplegable, y por el mismo motivo por el que la ficha de anuncio es una ruta (F1,
D-1): **hace falta un destino con URL** para poder enlazarlo desde una denuncia o
desde un ticket, que es donde el staff va a querer llegar. Un panel dentro de una
tabla no se puede enlazar.

Contenido: cabecera con las dos personas (enlazadas a sus fichas con
`adminUserHref`), el anuncio (con `adminListingHref`, o su snapshot si ya no está),
y los mensajes en orden con remitente y fecha. **Sin caja de respuesta**, y con un
aviso visible de que es una vista de solo lectura y de que la apertura queda
registrada — que quien lee sepa que lo que hace deja rastro es la mitad de para qué
sirve el registro.

---

## 6. El caso del borrado

Lo que ya está resuelto en el modelo y sólo hay que **pintar**:

| Qué desapareció | Qué queda | Cómo se pinta |
|---|---|---|
| El anuncio (`SetNull`) | `listingTitle` | El título con marca «ya no existe» y **sin enlace** — el mismo `Fantasma` que `ReporteDiana` estrenó en A+B |
| Una cuenta (vaciada) | La fila con `name` = «Usuario eliminado» | Tal cual, sin inventar. Y sin enlace a su ficha si no procede — §3.2 |

**Es literalmente el mismo trabajo que en reportes, y con el componente ya escrito.**
La conversación no debe decir un guion, por la misma razón: `Conversation.listingId`
es `SetNull` **a propósito** —para que el vendedor no pueda destruir el hilo del
comprador borrando su anuncio— y sería absurdo conservar el hilo y no poder decir de
qué iba.

---

## 7. El plan

**Dos ráfagas, y la primera NO es la que parece.**

### Ráfaga C1 — la política y los dos endpoints de metadato

1. `AdminMessagingController` + `AdminMessagingService` (lector propio, §3.1).
2. `GET /admin/conversations` (por anuncio y por usuario), MODERATOR, paginado.
3. Las dos secciones en las fichas, con enlaces a un hilo **que todavía no existe**
   (o sin enlace, si se prefiere no dejar el hueco).

**Entregable por sí sola**, y esto es lo que la hace buena: con C1 un moderador ya
puede responder *«¿este comprador contactó con el vendedor? ¿cuándo? ¿cuánto?»*, que
es la mitad del valor del encargo **sin abrir ni un mensaje**. Si Ernest quisiera
parar aquí, la parte invasiva no se habría construido.

### Ráfaga C2 — el contenido

4. `GET /admin/conversations/:id/messages`, con el rol decidido y el `AuditLog`.
5. La ruta `/admin/conversaciones/[id]`, solo lectura, con el aviso.
6. El caso del borrado, con el `Fantasma` de A+B.

**Por qué en este orden y no «backend / frontend»:** porque el corte que importa no
es técnico, es **de privacidad**. C1 no da acceso a ningún contenido privado; C2 sí.
Partirlo así permite decidir C2 con C1 ya en producción y viendo cómo se usa — y si
la respuesta a §2.1 fuese P2 (ADMIN), C2 se puede retrasar sin que C1 pierda nada.

---

## 8. Las barreras

| # | Barrera | Por qué |
|---|---|---|
| 1 | Desde un anuncio se ven **TODAS** sus conversaciones, incluida la de un comprador cuya cuenta se eliminó | «Completo» es el encargo |
| 2 | Desde un usuario se ven las suyas **como comprador Y como vendedor**, separadas y etiquetadas | Es el requisito que un `where` mal escrito incumple en silencio |
| 3 | **Un hilo cuyo anuncio se borró sigue diciendo de qué iba** (`listingTitle`), con marca y sin enlace muerto | Molde de A+B, y el `SetNull` existe justo para esto |
| 4 | **ABRIR UN HILO NO MARCA NADA COMO LEÍDO** — se comprueba el `readAt` de los mensajes ANTES y DESPUÉS | §3.1. Es la barrera más importante de las técnicas: sin ella se corrompe el estado de dos personas ajenas y nadie se entera |
| 5 | El rol se respeta: con P3, un MODERATOR **lista** (200) y **no abre** (403) | La decisión de §2.1 sujeta por el código, no por un acuerdo |
| 6 | Abrir un hilo **deja una fila de `AuditLog`** con actor, hilo e IP; listar **no** la deja | §2.2, las dos mitades |
| 7 | La paginación funciona **con controles**: con más hilos que una página se llega a los de la segunda | La lección de A+B: el API paginaba y la interfaz no lo usaba |
| 8 | La vista de staff **no puede escribir**: no hay endpoint de envío por esta puerta | §2.3 |

---

## 9. Registro

### Verificado

| # | Hallazgo | § |
|---|---|---|
| 1 | No existe superficie ni endpoint de staff: cinco `count` y nada más | 1.2 |
| 2 | El chat **no enmascara** datos de contacto en ninguna parte | 1.3 |
| 3 | `Message` no tiene borrado lógico ni adjuntos ni edición | 1.1 |
| 4 | **Ninguna de las 60 acciones de `AuditLog` registra una lectura** | 1.4 |
| 5 | `AdminController` es **ADMIN por defecto**; MODERATOR se opta ruta por ruta | 1.5a |
| 6 | Existe precedente escrito de «datos personales ⇒ ADMIN» (el ZIP de C6) | 1.5b |
| 7 | **`getConversation` MARCA COMO LEÍDO**: reutilizarlo corrompería el estado de dos usuarios | 3.1 |
| 8 | `Conversation` tiene snapshot del anuncio pero **no de los interlocutores** | 3.2 |

### Recomendado (decide Ernest)

| # | Pregunta | Recomendación | § |
|---|---|---|---|
| **A** | ¿Quién lee hilos ajenos? | **P3 — MODERATOR lista, ADMIN abre.** Separa metadato del recurso de correspondencia privada, que es la distinción que la casa ya trazó con la IP | 2.1 |
| **B** | ¿Se audita el acceso? | **Sí, al abrir; no al listar.** Es lo único que hace revisable una capacidad que no deja rastro por sí misma. Coste: patrón nuevo en `AuditLog` | 2.2 |
| **C** | ¿Contenido íntegro? | **Sí.** No hay máscara que levantar, y un hilo con huecos no sirve para decidir sobre una acusación. La protección va en A y B, no en censurar el texto | 2.3 |
| **D** | ¿Se avisa al usuario de que el staff leyó? | **No**, pero que sea decisión | 2.2 |
| **E** | ¿`AuditLog` o tabla propia para los accesos? | **`AuditLog`**; la tabla propia es la salida si incomoda cambiarle el significado | 2.2 |
| **F** | ¿El corte C1/C2 (metadato / contenido)? | **Sí** — deja la parte invasiva aislada y aplazable | 7 |
