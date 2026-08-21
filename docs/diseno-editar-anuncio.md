# Diseño — Editar un anuncio desde el backoffice (P3)

> **El último de los seis puntos de la auditoría.** Se apoya en la ficha de
> anuncio (F1: secciones independientes para el modo edición), la etiqueta
> interna (P1) y roles (R1-R4), todos en `main`.
>
> **Documento de diseño. Cero código.** El apéndice lleva el inventario con
> fichero y línea.
>
> Se parte en dos porque son dos riesgos distintos: **P3a** edita los campos del
> anuncio; **P3b** le cambia el propietario.

---

## 0. El cuidado que atraviesa las dos mitades

**La edición del staff NO debe disparar `EDITED`.**

Esa etiqueta afirma un hecho muy concreto: *«el DUEÑO cambió algo después de que
lo revisaran»*. Si una edición del staff la disparara, el sistema mandaría al
staff a revisar su propio cambio — ruido que además vacía de significado la única
señal que P1 construyó.

Y el disparador **no es opcional ni configurable**: vive en el propio `data` de la
escritura de `ListingsService.update()`
([`listings.service.ts:463`](../apps/api/src/modules/listings/listings.service.ts#L463)),
como `triage: triageAfterOwnerEdit(existing.triage)`. Cualquier camino de staff
que pase por ese método **lo dispara**, sin poder evitarlo.

Eso no es un obstáculo: es la primera pista de que la edición de staff necesita su
propio camino. Y hay una segunda, más contundente — la primera línea de `update()`
es `assertOwnership(id, userId)`, que le devolvería un **403** a cualquier
moderador. El método del dueño no se puede reutilizar tal cual ni queriendo.

---

## 1. Bloque 1 — P3a: editar los campos

### 1.1 Qué hace hoy la edición del dueño

| | |
|---|---|
| **Guarda de acceso** | `assertOwnership` → 403 para quien no sea el dueño |
| **Valida** | Atributos requeridos sobre el bag COMPLETO, formato de precio permitido por la categoría, resolución de tags |
| **NO valida** | No pasa por la puerta (`assertCanBecomeActive`): *«EDITAR LIMPIA, PERO NUNCA FRENA»* |
| **NO re-modera** | Ni filtro de palabras ni moderación previa: los dos sólo corren en `publish()` |
| **Efectos** | Quita `needsRevalidation` si el anuncio vuelve a cumplir, invalida caché, encola reindexado |
| **Anota** | `REVIEWED → EDITED` |

### 1.2 Camino propio, no un `update()` con banderas

La opción de añadir un parámetro `esStaff` a `update()` para saltarse
`assertOwnership` y el triaje se descarta: sería un método cuyo comportamiento
cambia según quién llama, y el sitio donde más caro sale equivocarse — la guarda
de propiedad — pasaría a depender de un booleano.

**`AdminService.updateListing(id, actorId, dto, ip)`**, en el módulo de
administración, junto a `changeListingStatus` y `setListingTriage`. Reutiliza las
validaciones extrayéndolas, no copiándolas: `validateRequired`,
`validatePriceUnitAllowed` y `resolveTagsForListing` son las mismas reglas para
todo el mundo.

**Lo que NO se extrae es la anotación**, y ésa es la diferencia entera: el camino
de staff escribe los campos y **no toca `triage`**.

### 1.3 Qué puede editar el staff, y con qué validaciones

**Las mismas validaciones que el dueño.** La tentación de dejar al staff saltarse
la validación de atributos —«es de confianza»— produce anuncios que el propio
sistema considera inválidos: `needsRevalidation` los marcaría acto seguido y el
vendedor recibiría un aviso por un cambio que hizo el staff. La confianza no
arregla un dato incoherente.

| Campo | ¿Editable? | Nota |
|---|---|---|
| Título, descripción | Sí | El caso más frecuente: limpiar un texto en vez de rechazar el anuncio entero |
| Precio, formato de precio | Sí | Con la validación de formatos permitidos por la categoría |
| Categoría | Sí | Reclasificar es trabajo de moderación puro. Arrastra la validación de atributos de la categoría destino |
| Atributos | Sí | Con `validateRequired` sobre el bag completo |
| Fotos | Sí | Quitar una foto inapropiada sin tumbar el anuncio |
| Tags | Sí | Con la resolución contra el vocabulario de la categoría |
| **Estado** | **No** | Ya tiene su vía (`changeListingStatus` + `elegirAccionDeEstado`). Meterlo aquí reabriría el defecto de M2 |
| **Vendedor** | **No** | Es P3b |
| **Slug** | **No** | Es la URL pública: cambiarlo rompe enlaces e indexación. Si hace falta, es otro trabajo con redirección |

### 1.4 ¿Re-moderar tras una edición de staff?

**No**, y conviene decir por qué no reabre nada. El hueco que M2 cerró era que
**aprobar** desde el backoffice se saltara el registro y el aviso; no tiene que
ver con editar. Y el filtro de palabras existe para detectar lo que escribe un
vendedor: pasar por él el texto que acaba de escribir un moderador sería pedirle
a la máquina que revise a quien la opera.

Lo que sí conviene: si el staff edita un anuncio que está **en la cola**
(`PENDING_REVIEW`), la edición no lo saca de ella. Sigue esperando decisión, que
se toma por su vía.

### 1.5 El rol: MODERATOR

Editar contenido ajeno es potente, pero es **reversible** —el texto anterior está
en `AuditLog.before`— y es el trabajo diario de moderar. La regla que B2 fijó
reserva ADMIN para lo **irreversible**, y esto no lo es.

**`AuditLog` obligatorio**, acción `LISTING_EDIT`, con `before` y `after` de los
campos tocados. Sin eso, una edición de staff sería indistinguible de una del
dueño, y el vendedor no tendría forma de saber quién cambió su anuncio.

### 1.6 La interfaz: el terreno que F1 dejó

La ficha está partida en secciones independientes exactamente para esto. El modo
edición se activa **por sección** —el que corrige un título no abre un formulario
de veinte campos— y sólo sobre las secciones de campos editables (la 1, la 2 y la
7); las demás son de sólo lectura por naturaleza.

---

## 2. Bloque 2 — P3b: cambiar el propietario

### 2.1 El principio que ordena las ocho

Mirando las relaciones una a una aparece una línea que las parte limpiamente:

> **Lo que describe el ANUNCIO se reasigna. Lo que describe un HECHO PASADO entre
> personas, no.**

Una foto es del anuncio y va con él. Una valoración dice «traté con esta persona y
fue así»: moverla al nuevo dueño le atribuiría una reputación que no se ganó, y
se la quitaría a quien sí. Un cobro dice quién pagó. Esos no se mueven **nunca**,
y no por dificultad técnica sino porque moverlos sería falsificarlos.

### 2.2 Las ocho relaciones que llevan la identidad del dueño

| # | Relación | Qué guarda del dueño | Veredicto |
|---|---|---|---|
| 1 | `ListingImage.uploadedById` | Quién subió la foto | **Se reasigna.** La foto es del anuncio; el campo sólo sirve para atribuir la subida y ya es `SetNull` |
| 2 | `BumpSchedule.userId` | Quién programó los bumps… **y quién los paga** | **BLOQUEA.** El cron llama a `billing.bump(listingId, schedule.userId)`: dejarlo haría pagar al dueño anterior por un anuncio que ya no es suyo; reasignarlo haría pagar al nuevo por algo que no pidió. Se exige **cancelar la programación antes** |
| 3 | `Entitlement.userId` | Quién compró el destacado / el Pro | **NO se reasigna.** Es una compra. Y si el destacado sigue vigente, **BLOQUEA**: el anuncio pasaría a lucir algo que pagó otro |
| 4 | `Transaction.userId` | Quién pagó | **NO se reasigna, nunca.** Es contabilidad. Mover un cobro de una persona a otra falsea el registro fiscal |
| 5 | `Deal.sellerId` | Que ESTA persona cerró el trato | **NO se reasigna**, y **BLOQUEA si el nuevo dueño es el comprador** (§2.3) |
| 6 | `Conversation.sellerId` | El vendedor del hilo | **Caso a caso** (§2.3). Es el más delicado |
| 7 | `Review.targetId` | A quién se valoró | **NO se reasigna.** Mover una valoración es mover una reputación |
| 8 | `Ticket.userId` | Quién abrió el ticket | **NO se reasigna.** Es una conversación de soporte con una persona concreta |

Las que no llevan identidad del dueño —`Favorite`, `Report`, `AlertMatch`,
`ListingViewDaily`, `ListingTag`— no se tocan: siguen al anuncio sin conflicto.

### 2.3 El conflicto irresoluble: vendedor y comprador a la vez

Tres reglas del sistema son **invariantes de aplicación, no restricciones de la
base de datos**:

- *«No puedes contactar con tu propio anuncio»* — `messaging.service.ts:136`
- *«No puedes valorarte a ti mismo»* — `reviews.service.ts:52`
- *«No puedes registrar un trato contigo mismo»* — `listings.service.ts:810`

Es decir: **la base de datos aceptaría escribir filas que el resto del código da
por imposibles.** Y cambiar el propietario es justo la operación capaz de
crearlas: si el nuevo dueño ya era comprador en una conversación o parte de un
trato de ese anuncio, al reasignar queda **en los dos lados a la vez**.

Y no es sólo una incoherencia teórica: la bandeja resuelve con quién hablas como
`conv.buyerId === userId ? conv.seller : conv.buyer`
([`messaging.service.ts:106`](../apps/api/src/modules/messaging/messaging.service.ts#L106)).
Con las dos puntas en la misma persona, esa expresión responde cualquier cosa y
el hilo se pinta hablando consigo mismo.

**No hay respuesta correcta**: no se puede borrar la conversación (destruiría
mensajes de las dos partes — justo lo que B1 protegió) ni dejarla (crea el estado
imposible). Así que **se rechaza limpiamente**, con un mensaje que diga cuál es el
choque. Es el mismo criterio que el cuerpo de borrado: ante la duda, no se fuerza.

### 2.4 Los `@@unique` que el cambio puede tocar

| Restricción | ¿La rompe el cambio? |
|---|---|
| `Conversation @@unique([listingId, buyerId])` | **No directamente** — se tocaría `sellerId`, no `buyerId`. El daño es el semántico de §2.3, que ninguna restricción impide |
| `Review @@unique([authorId, targetId, listingId])` | **Sí, si se reasignara `targetId`** — otra razón para no hacerlo |
| `Favorite @@unique([userId, listingId])` | No |
| `BumpSchedule @@unique([listingId])` | No (una por anuncio, independiente del dueño) |

Conviene retener el hallazgo: **la restricción que más duele no existe en el
esquema**. El peligro real de P3b no lo para la base de datos.

### 2.5 La operación, si se hiciera

Una transacción con **comprobaciones previas** que abortan entera:

1. ¿Hay `BumpSchedule` viva? → rechazar («cancela la programación primero»).
2. ¿Hay `Entitlement` de destacado vigente? → rechazar.
3. ¿El nuevo dueño es comprador en alguna `Conversation` o parte de algún `Deal`
   de este anuncio? → rechazar (§2.3).
4. Sólo entonces: cambiar `Listing.sellerId`, reasignar `ListingImage.uploadedById`
   y actualizar `Conversation.sellerId` de los hilos que sobrevivan.
5. Recalcular las **cuotas de ambos**: el anuncio deja de contar para el tope del
   antiguo dueño y pasa a contar para el del nuevo — que puede tenerlo lleno. Es
   una cuarta comprobación previa.
6. `AuditLog` con `LISTING_OWNER_CHANGE`, los dos usuarios y el motivo.

### 2.6 El veredicto de P3b: **deuda, no ahora**

El análisis, no una preferencia:

| | |
|---|---|
| **Lo que se puede reasignar** | **Una** relación de ocho (`ListingImage.uploadedById`), y es la menos importante |
| **Lo que bloquea** | Tres (bump programado, destacado vigente, cuota del destino) |
| **Lo que no tiene solución** | El nuevo dueño como comprador/valorador/parte de un trato — se rechaza |
| **Lo que nunca se mueve** | Cinco: compras, cobros, tratos, valoraciones y tickets |

O sea: **la operación consiste, casi entera, en decidir cuándo NO se puede
hacer.** El cambio útil se reduce a un `sellerId`, una columna de atribución y el
`sellerId` denormalizado de los hilos vivos; todo lo demás son guardas.

Y del otro lado: **no hay ninguna señal de que haga falta**. No existe ni un
endpoint, ni una petición, ni una deuda anotada que pida reasignar un anuncio. El
caso que suele motivarlo —una cuenta duplicada, una empresa que cambia de
persona— tiene salidas más baratas: rechazar el anuncio y que lo republique el
dueño correcto, que además deja el historial de cada uno donde estaba.

**Se pospone**, con este análisis escrito. Si algún día se pide, esto es el mapa:
las tres guardas, el conflicto irresoluble y las cinco que no se mueven.

**Lo que sí conviene hacer ahora, y es barato:** anotar en `pendientes.md` que
tres invariantes del dominio —no auto-conversación, no auto-valoración,
no auto-trato— sólo viven en la aplicación. No es un problema hoy, porque ninguna
ruta puede crearlas; es lo que hay que saber antes de escribir cualquier operación
que mueva identidades entre las dos puntas de una relación.

---

## 3. El plan de ráfagas

Una sola, porque el veredicto de §2.6 deja P3b fuera.

### E1 — P3a: editar los campos desde el backoffice

**Backend:** `AdminService.updateListing` (MODERATOR), reutilizando las
validaciones del dueño y **sin tocar `triage`**; `LISTING_EDIT` en `AuditLog` con
`before`/`after`.
**Frontend:** el modo edición por secciones sobre la ficha F1.

**Barreras:**
1. **El staff edita el precio → cambia, y el triaje NO se mueve.** Si el anuncio
   estaba `REVIEWED`, sigue `REVIEWED`. Es el cuidado de P1 y la que más fácil se
   rompe: basta con reutilizar `update()`.
2. Y en contraste, **el DUEÑO editando ese mismo anuncio sí lo pasa a `EDITED`** —
   la señal sigue viva.
3. La edición de staff **valida igual**: atributos requeridos, formato de precio y
   tags de la categoría destino.
4. Queda registrada con su actor y el texto anterior.
5. Un usuario normal recibe 403; un EDITOR también (la sección es MODERATOR).
6. La edición **no cambia el `status`** ni saca de la cola a un `PENDING_REVIEW`.

---

## 4. Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| 1 | Reutilizar `update()` y disparar `EDITED` desde el staff | Barreras 1 y 2 de E1, en las dos direcciones |
| 2 | Dejar al staff saltarse validaciones «porque es de confianza» | Barrera 3. Un anuncio inválido se marca solo y el aviso le llega al vendedor |
| 3 | Que la edición se convierta en una segunda vía de cambio de estado | El estado no es editable aquí (§1.3); su vía es `elegirAccionDeEstado` |
| 4 | Copiar las validaciones en vez de extraerlas | Se extraen: dos copias divergen y la del backoffice sería la que nadie prueba |
| 5 | Que P3b se intente sin las guardas | §2 es el mapa; sin las cuatro comprobaciones previas produce estados que el resto del código da por imposibles |

### Lo que este cuerpo NO hace

- No cambia el propietario (§2.6, pospuesto con el análisis).
- No permite editar estado ni slug.
- No re-modera lo que escribe el staff.
- No añade restricciones de base de datos para los tres invariantes de §2.3 — sólo
  los deja anotados.

---

## 5. DECISIÓN — 2a y 2b: atributos e imágenes (la continuación de P3a)

> Esto no es un cuerpo: es la **decisión escrita antes de teclear** que la auditoría del
> lote de retoques marcó como requisito del punto 2
> (`auditoria-retoques-backoffice.md` §2). Todo lo de abajo está verificado contra el
> código; los números de línea son de `main` a fecha de escribirlo.

### 5.1 — 2a (atributos) es UI. Confirmado

| Lo que hace falta | ¿Existe? | Dónde |
|---|---|---|
| El DTO admite `attributes` | **Sí** | `update-admin-listing.dto.ts:70-72` |
| El servicio los escribe | **Sí** | `admin.service.ts:754` |
| Se validan por categoría **con profundidad N** | **Sí** | `validarEdicion` → `getAncestorChain` + `applicableSchemaFor(cadena, type)`, `listing-edit-validation.service.ts:98-130` |
| Con el grandfathering fino | **Sí** | `required` sobre el bag COMPLETO, el resto sólo sobre el DELTA (`:111-123`) |
| Es el MISMO objeto que usa el dueño | **Sí** | `AdminService.updateListing` llama a `this.editValidation.validarEdicion` (`admin.service.ts:732-736`) |

**No hay nada que reusar: ya está reusado.** 2a se reduce a activar el modo edición
sobre la sección «Atributos» de la ficha, con el molde de `StepAtributos`
(`components/publicar/steps/StepAtributos.tsx`, que ya resuelve `filterSchemaByType` y
las dependencias entre campos). Sigue por `AdminService.updateListing`, así que hereda
gratis los tres cuidados de P3a: **no toca `triage`** (no dispara `EDITED`), no toca
`status`, y escribe `LISTING_EDIT` en `AuditLog` con su `before`/`after` y su motivo.

### 5.2 — 2b (imágenes): las tres cosas, verificadas

El bloque entero, tal cual está hoy (`admin.service.ts:766-777`):

```ts
if (imageIds !== undefined) {
  await this.prisma.listingImage.updateMany({
    where: { listingId, id: { notIn: imageIds } },
    data: { listingId: null, order: 0 },
  });
  if (imageIds.length) {
    await this.prisma.listingImage.updateMany({
      where: { id: { in: imageIds } },   // ← sin `listingId`, sin `uploadedById`
      data: { listingId },               // ← sin `order`
    });
  }
}
```

Frente al camino del dueño (`listings.service.ts:396-404` → `linkImages:1574-1619`):

| | Dueño | Staff |
|---|---|---|
| Escribe el `order` por posición | **Sí** (`:1611-1618`) | **NO** |
| Aplica el tope de fotos (`PhotoLimitsService`) | **Sí** (`:1579-1584`) | **NO** |
| Comprueba que las imágenes existen | **Sí** (`:1591-1596`) | **NO** |
| Comprueba que no son de otro anuncio | **Sí** (`:1604-1608`) | **NO** |

Traducido a las tres cosas que 2b arregla:

1. **Reordenar no hace nada.** La petición responde 200 y el orden no se mueve. Es un
   *silencio*, no un error: la peor forma de fallo.
2. **Se salta tres validaciones**, contradiciendo la promesa escrita de P3a —«valida
   igual que el dueño»— y el riesgo 2 de §4. Con el mínimo de fotos activo
   (`minPhotosRuleEnabled`), el staff puede dejar un anuncio por debajo del mínimo, y
   el aviso de `needsRevalidation` **le cae al vendedor por un cambio que no hizo**.
   Además, el segundo `updateMany` **no filtra por `listingId`**: un `imageIds` con el
   id de una foto ajena **se la lleva de su anuncio**. Hoy nadie lo puede provocar
   desde la interfaz porque la UI nunca manda `imageIds` — es una bomba armada
   esperando a que 2b encienda el mecanismo, y el arreglo entra en la misma ráfaga.
3. **La limpieza de R2 no existe en ningún camino.** Grep exhaustivo de
   `mediaCleanupQueue`: los dos únicos llamadores son el borrado del anuncio entero
   (`admin.service.ts:972-981`, B2/B3) y su equivalente del dueño
   (`listings.service.ts:1009`). Quitar una foto —por cualquiera de los dos caminos—
   deja **la fila `ListingImage` y sus DOS objetos de R2** (original + miniatura)
   huérfanos para siempre. El backoffice no rompe el cuidado de B3: **hoy ya está roto
   en el camino del dueño**.

### 5.3 — La decisión de R2: **un desvinculador COMPARTIDO**

**Elegida.** Un único punto —«quitar estas fotos de este anuncio»— que **los dos
caminos usan**: borra las filas y encola sus claves en la cola de B3, resueltas con
`listingMediaKeys` (`infra/r2/media-keys.ts`), que es la única copia de la regla
`original → miniatura`.

Es el movimiento de P3a con las validaciones, por el mismo motivo: **se extrae, no se
copia.**

**Por qué no las otras dos:**

- **Limpiar sólo en el camino de staff.** Produce dos comportamientos distintos para la
  misma acción —el staff limpia, el dueño no— y deja abierta la fuente principal, que
  es la del dueño. Es exactamente la divergencia que este proyecto lleva cinco cuerpos
  cerrando.
- **Recolectar aparte (un barrido).** Es **B4, evaluado y descartado** con veredicto
  escrito (`diseno-borrado.md` §7, D-5). El motivo del descarte es concreto y sigue
  vigente: la consulta natural del barrido —`ListingImage WHERE listingId IS NULL AND
  createdAt < umbral`— **borraría la portada del blog**, porque toda la imaginería del
  blog sube por `POST /media/upload` y vive como `ListingImage` con `listingId = null`,
  indistinguible de un wizard abandonado (`pendientes.md`, verificado sobre la base
  real).

> **Y el mismo argumento que mató el barrido es el que hace SEGURO al desvinculador.**
> La ambigüedad de B4 nace de mirar filas por su estado (`listingId IS NULL`) sin saber
> de dónde vienen. El desvinculador no adivina nada: actúa sobre **las filas concretas
> que acaban de salir de un anuncio conocido**, en la misma operación que las saca. Una
> imagen del blog nunca estuvo enlazada a un anuncio, así que no puede aparecer ahí.

Y encaja con el orden que `pendientes.md` declara correcto: **«cerrar primero las
fuentes (prevención, como B3) y sólo después plantearse recoger»**. Esto cierra una
fuente.

**Hallazgo de esta decisión:** esa fuente —quitar una foto de un anuncio ya
publicado— **no está en el inventario de deuda**. `pendientes.md` lista wizard
abandonado, adjuntos de ticket, vídeo sin confirmar, avatar sustituido y las imágenes
de `blocks`/`homepage`/`sponsored`. Ésta es una sexta, y la única que se dispara en la
operación normal de un anuncio vivo. Al cerrarla hay que **añadirla y tacharla** en esa
lista, o el inventario seguirá estando incompleto en la dirección contraria.

### 5.4 — Dos consecuencias que hay que decidir con ella

**(a) Se BORRA la fila, no se desvincula.** Purgar R2 dejando la fila produciría algo
peor que hoy: una fila apuntando a un objeto que ya no existe. Verificado que es seguro:
nada más en el esquema referencia `ListingImage` (sólo las relaciones `Listing.images` y
`User.uploadedImages`), y **ningún test afirma el comportamiento actual de
desvincular** (0 coincidencias de `listingId: null` en las suites del backend).

El coste, dicho: **quitar una foto pasa a ser irreversible al guardar.** Hoy la fila
sobrevive y podría re-enlazarse por id; ninguna interfaz lo ofrece, así que no hay
regresión práctica — pero sí un cambio de naturaleza que conviene escribir.

**(b) El `AuditLog` no registra qué fotos se quitaron, y con (a) eso pasa a importar.**
En `updateListing`, `imageIds` se destructura FUERA de `fields`
(`admin.service.ts:729`) y el `before` se construye sólo sobre `fields`
(`:740-743`): **las fotos no entran ni en el `before` ni en el `after`**. Mientras
quitar era reversible daba igual; en cuanto el fichero se borra de R2, un error del
staff es irrecuperable **y además invisible**. 2b tiene que meter `imageIds` en el
registro — es una línea, y sin ella la acción destructiva no deja rastro.

*(Exposición que NO empeora y se anota: si dos filas compartieran `url` —`media-keys.ts`
lo contempla al deduplicar—, borrar una purgaría el objeto de la otra. `MediaService`
genera una clave aleatoria por subida, así que hoy no ocurre; es la misma exposición
que ya tiene el borrado de B3 y no se agranda aquí.)*

### 5.5 — El plan: **dos ráfagas**

No una. Comparten pantalla, pero no comparten naturaleza ni riesgo:

- **2a — atributos.** Sólo frontend sobre un backend ya construido y ya validado.
  Riesgo: ninguno estructural.
- **2b — imágenes.** Toca el camino del dueño (el desvinculador compartido), arregla un
  fallo de aislamiento entre anuncios, y estrena borrado real de ficheros. Riesgo: el
  más alto de lo que llevamos del lote.

Juntarlas metería un arreglo de seguridad y un borrado destructivo en la misma revisión
que un formulario, que es justo donde se cuela lo que nadie mira. Y 2a entrega valor el
primer día sin esperar a las decisiones de 2b.

### 5.6 — Las barreras

**2a**
1. El staff edita un atributo → cambia, **y el triaje no se mueve** (`REVIEWED` sigue
   `REVIEWED`).
2. El staff **no se salta** la validación: un atributo requerido que falta se rechaza,
   igual que al dueño; y la validación usa la cadena de ancestros, no sólo el padre.
3. Queda en `AuditLog` con actor, motivo y valor anterior.

**2b**
4. **Reordenar mueve de verdad**: mandar `[c,a,b]` deja ese orden al releer. *(Hoy esta
   barrera falla.)*
5. **El tope y el mínimo de fotos aplican al staff** igual que al dueño.
6. **Aislamiento entre anuncios**: mandar el `imageId` de OTRO anuncio se rechaza y —lo
   que de verdad se mide— **el otro anuncio conserva su foto**. Es el fallo de
   seguridad; la aserción va sobre la víctima, no sobre el código de error.
7. **Quitar una foto encola sus DOS claves** (original + miniatura) y **borra la fila**,
   por el camino del staff **y por el del dueño** — la misma barrera ejercida dos veces,
   que es lo único que demuestra que el desvinculador es de verdad compartido.
8. El `AuditLog` de una edición que quita fotos **dice cuáles**.

**Mutaciones que deben matar:** que el desvinculador no escriba `order` → cae (4); que
el `updateMany` pierda el filtro por `listingId` → cae (6); que sólo uno de los dos
caminos limpie → cae la mitad de (7); que se purgue R2 sin borrar la fila → queda una
fila apuntando a nada, y (7) debe comprobar las dos cosas.

---

## Apéndice — inventario verificado

| Qué | Dónde | Dato |
|---|---|---|
| El disparador de `EDITED` está DENTRO de la escritura | [`listings.service.ts:463`](../apps/api/src/modules/listings/listings.service.ts#L463) | `triage: triageAfterOwnerEdit(existing.triage)` en el `data` del `update` |
| `update()` es del dueño por su primera línea | `listings.service.ts:307` | `assertOwnership(id, userId)` → 403 para staff |
| Lo que valida la edición | mismo método | `validateRequired`, `validatePriceUnitAllowed`, `resolveTagsForListing` |
| Lo que NO valida | mismo método | No pasa por la puerta: *«EDITAR LIMPIA, PERO NUNCA FRENA»* |
| No re-modera | mismo método | 0 coincidencias de `badWord` / `preModeration`: sólo corren en `publish()` |
| Las 13 FK a `Listing` | `schema.prisma` | 8 llevan identidad del dueño (§2.2); 5 no |
| **La bandeja asume que las puntas son distintas** | [`messaging.service.ts:106`](../apps/api/src/modules/messaging/messaging.service.ts#L106) | `conv.buyerId === userId ? conv.seller : conv.buyer` |
| Invariante 1, sólo en la app | [`messaging.service.ts:136`](../apps/api/src/modules/messaging/messaging.service.ts#L136) | «No puedes contactar con tu propio anuncio» |
| Invariante 2, sólo en la app | [`reviews.service.ts:52`](../apps/api/src/modules/reviews/reviews.service.ts#L52) | «No puedes valorarte a ti mismo» |
| Invariante 3, sólo en la app | [`listings.service.ts:810`](../apps/api/src/modules/listings/listings.service.ts#L810) | «No puedes registrar un trato contigo mismo» |
| El bump programado gasta del USUARIO de la programación | [`bump-auto.processor.ts:92`](../apps/api/src/modules/bump-schedule/bump-auto.processor.ts#L92) | `billing.bump(schedule.listingId, schedule.userId)` |
| Los `@@unique` en juego | `schema.prisma` | `Conversation([listingId,buyerId])`, `Review([authorId,targetId,listingId])`, `Favorite([userId,listingId])`, `BumpSchedule([listingId])` |
| `Deal` **no** tiene `@@unique` | `schema.prisma` | Sólo índices: el auto-trato lo impide el servicio, no la base |
| No existe edición de staff hoy | `admin.controller.ts` | Sobre anuncios: `GET`, `GET :id`, `PATCH :id/status`, `PATCH :id/triage`, `DELETE :id` |
| El terreno de F1 | `anuncios/[id]/page.tsx` | *«P3a añade un modo edición sobre las mismas secciones 1, 2 y 7»* |
| La regla de qué es ADMIN | comentario de B2 en `admin.controller.ts` | ADMIN sólo para lo **irreversible** |
