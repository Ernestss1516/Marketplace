# Diseño — La etiqueta interna de moderación (P1)

> **Segundo cuerpo de administración.** Se apoya en roles (R1-R4), borrado (B1-B3)
> y la ficha (F1+F2), todos en `main`. Origen:
> [`auditoria-backoffice-administracion.md`](./auditoria-backoffice-administracion.md).
>
> **Documento de diseño. Cero código.** Todo lo que sigue está verificado contra el
> código real; el apéndice lleva la lista con fichero y línea.
>
> Qué resuelve: una anotación interna, **sólo staff**, para gestionar el trabajo de
> moderación — sin cambiar nada de lo que le pasa al anuncio.

---

## 0. El eje del documento: ortogonalidad

La etiqueta interna **no es** el estado del anuncio (`DRAFT`, `ACTIVE`,
`ARCHIVED`…) ni el estado de moderación (`PENDING_REVIEW`). Son ejes
independientes, y hay que poder decir las dos cosas a la vez:

- un anuncio `ACTIVE` —visible para todo el mundo— y **en observación**;
- un anuncio `PENDING_REVIEW` y **nuevo**;
- un anuncio `ACTIVE` y **editado** (alguien revisó, el dueño cambió algo después).

Conflacionarlos rompería los dos: el estado dejaría de significar «qué le pasa al
anuncio» y la etiqueta dejaría de significar «cómo lo lleva el staff».

**Este proyecto ya tomó exactamente esta decisión una vez, y la escribió.** El
comentario de `needsRevalidation` en el esquema dice, literalmente:

> *MARCA, NO EXPULSA: el anuncio sigue ACTIVE, sigue en el índice y sigue siendo
> editable […] Es información para el vendedor y una señal para la puerta, **no un
> estado del ciclo de vida (ése es `status`, y son ejes ortogonales)**.*

La etiqueta interna es la misma figura, con el destinatario cambiado: `status` es
para el mundo, `needsRevalidation` es para el vendedor, y esto es para el staff.

---

## 1. Bloque 1 — El modelo

### 1.1 El análisis: cuáles son excluyentes y cuál no

Los cuatro ejemplos no son de la misma clase. Puestos en una tabla de «¿pueden ser
verdad a la vez?»:

| | nuevo | revisado | editado | en observación |
|---|---|---|---|---|
| **nuevo** | — | **no** | **no** ¹ | **sí** |
| **revisado** | no | — | **no** | **sí** |
| **editado** | no | no | — | **sí** |
| **en observación** | sí | sí | sí | — |

¹ Y ésta es la que hay que argumentar, no dar por hecha — ver §1.2.

La columna de la derecha es distinta de las otras tres: **«en observación» convive
con cualquiera de ellas**. Las otras tres se excluyen entre sí.

Eso son **dos ejes, no uno**:

- un **ciclo de vida** con tres valores excluyentes: `nuevo → revisado → editado`;
- una **bandera suelta** que no mueve nada en el ciclo: `en observación`.

### 1.2 Por qué «editado» pertenece al ciclo y no es «cualquier edición»

«Editado» **no** significa «alguien tocó este anuncio». Significa **«algo que el
staff ya había dado por bueno ha cambiado»**. Sin esa segunda mitad no es una
señal, es ruido:

- Si nadie lo ha revisado (**nuevo**) y el dueño lo edita, no hay información
  nueva que dar: sigue estando sin revisar. Marcarlo «editado» destruiría el
  dato útil (que nadie lo ha mirado) para poner uno vacío.
- Si estaba **revisado** y el dueño lo edita, el juicio del staff ha caducado. Eso
  sí es información, y es exactamente la que hoy **no llega a nadie** (§2.3).
- Si ya está **editado** y el dueño edita otra vez, ya está señalado. Volver a
  marcarlo no añade nada.

Así que «editado» es un estado del mismo eje —el punto del ciclo en que está el
juicio del staff— y se alcanza por **una sola transición**: `revisado → editado`.

### 1.3 El modelo propuesto

Dos columnas en `Listing`:

```
triage   ListingTriage @default(NEW)      // el ciclo: NEW | REVIEWED | EDITED
watched  Boolean       @default(false)    // la bandera ortogonal
```

**Por qué un enum y no una tabla de etiquetas.** Porque tres de los cuatro valores
son excluyentes, y una tabla de etiquetas puede representar «nuevo Y revisado a la
vez», que no significa nada. El esquema debe hacer **irrepresentables** los estados
imposibles. El proyecto ya reparte así: `ListingStatus` es un enum porque un
anuncio está en un sitio; `ListingTag` es una tabla porque las etiquetas públicas
sí son varias a la vez.

**Por qué la bandera va fuera del enum.** Meterla dentro obligaría a valores
combinados (`REVISADO_EN_OBSERVACION`, `NUEVO_EN_OBSERVACION`…): el número de
valores se multiplica en vez de sumarse, que es la señal clásica de dos ejes
metidos en uno. El proyecto ya separó dos ejes por este motivo al menos dos veces
(`priceType` vs `priceUnit` — *«eje independiente»*; `status` vs
`needsRevalidation`).

**Por qué `triage` y no `reviewState`.** El nombre es una salvaguarda: cualquier
cosa que se llame «review» va a acabar confundida con `PENDING_REVIEW`, que es el
eje del que hay que mantenerla separada. `triage` dice lo que es —cómo el staff
reparte su atención— y no colisiona con nada. En la interfaz, en español: **Nuevo
/ Revisado / Editado** y **En observación**.

**Conjunto fijo, no configurable.** Los tres valores llevan **automatización y
reglas de transición** detrás; hacerlos configurables obligaría a configurar
también las reglas, que es otro producto. Mismo criterio que `ListingStatus`.
Ampliar el enum más adelante es una migración de una línea.

### 1.4 «Nace nuevo» no necesita código

`@default(NEW)` en la columna. `ListingsService.create()` **no fija `status`**
tampoco: se apoya en el `@default(DRAFT)` del esquema. La automatización más
obvia del enunciado se resuelve, literalmente, con el valor por defecto — y de
paso da a **todas las filas existentes** el valor correcto sin backfill, igual
que hicieron `needsRevalidation @default(false)` y `priceUnit @default(ONE_TIME)`.

¿Es `NEW` correcto para lo que ya existe? Sí, y es lo honesto: la etiqueta
significa «triado bajo este sistema», y nadie ha triado nada todavía. Se podría
sembrar `REVIEWED` en los que tengan un `LISTING_APPROVE` en `AuditLog`, pero
**aprobar no es triar**: aprobar es dejar publicar; triar es decidir a qué presta
atención el staff. Ver §6, **D-1**.

---

## 2. Bloque 2 — La automatización

### 2.1 El reparto

| Transición | Quién | Cuándo |
|---|---|---|
| → `NEW` | **automática** | Al crear. Es el `@default`, no un enganche (§1.4) |
| `REVIEWED` → `EDITED` | **automática** | El dueño edita el contenido (§2.2) |
| `*` → `REVIEWED` | **manual** | El staff lo marca desde la ficha |
| `watched` on/off | **manual** | El staff la pone y la quita. No mueve el ciclo |

Nótese lo pequeña que es la parte automática: **una transición**, con una guarda.
Todo lo demás lo decide una persona, que es lo que hace que la etiqueta signifique
algo.

### 2.2 La regla de «editado», en una línea

> Al terminar una edición del dueño: **si `triage === REVIEWED`, pasa a `EDITED`.
> En cualquier otro caso, no se toca.**

`NEW` se queda `NEW`; `EDITED` se queda `EDITED` (§1.2).

**Qué cuenta como «edición del dueño».** Sólo `ListingsService.update()`, que es
la que cambia el **contenido**. No las transiciones de estado que el dueño provoca
(`pause`, `reactivate`, `archive`, `closeDeal`): pausar un anuncio no cambia ni una
palabra de lo que el staff revisó, así que no caduca su juicio.

**Y no las ediciones del staff.** Cuando llegue P3a (editar desde el backoffice),
esa vía **no** debe disparar `EDITED`: sería mandar al staff a revisar su propio
cambio. Anotado aquí para que P3a no lo descubra a base de ruido.

### 2.3 El hueco que esto tapa, y que es más grande de lo que parecía

Verificado en `ListingsService.update()`: la edición del dueño **no** cambia
`status`, **no** vuelve a pasar por el filtro de palabras, **no** consulta la
moderación previa, y lo único que hace con `needsRevalidation` es **quitarlo** si
el anuncio volvió a cumplir. El filtro de palabras y el disparador de revisión
sólo corren en `publish()`.

Es decir: **hoy, el dueño de un anuncio `ACTIVE` puede reescribirlo entero y no se
entera nadie.** No es un descuido — frenar ahí encerraría al vendedor, y el propio
código lo argumenta («EDITAR LIMPIA, PERO NUNCA FRENA»). Pero deja al staff sin
ninguna señal.

`EDITED` es esa señal, y es la pieza que más justifica el cuerpo entero.

### 2.4 El mecanismo y la anotación, en paralelo y sin tocarse

El mismo evento —el dueño edita— mueve dos ejes, y hay que verlos separados:

| | **El mecanismo** | **La anotación** |
|---|---|---|
| Qué es | Qué le pasa al anuncio | Cómo lo ve el staff |
| Hoy | `clearIfCompliant` (quita `needsRevalidation` si vuelve a cumplir) + reindexar | — no existe |
| Con P1 | igual, sin tocar | `REVIEWED → EDITED` |
| Destinatario | el vendedor y la puerta | el moderador |

**El contrato:** ninguno lee al otro. La etiqueta **nunca** decide el `status` ni
`needsRevalidation`; el `status` **nunca** decide la etiqueta. Se enganchan en el
mismo sitio —el final de `update()`, al lado de `clearIfCompliant`— como dos
efectos hermanos, no como uno encima del otro.

La consecuencia práctica que hay que poder afirmar en un test: **editar un anuncio
marcado como `needsRevalidation` que vuelve a cumplir deja `needsRevalidation` en
`false` Y `triage` en `EDITED`** — los dos ejes se mueven, cada uno por su cuenta.

---

## 3. Bloque 3 — La traza

### 3.1 El obstáculo, verificado

`AuditLog.actorId` es **`String` no nulo, con FK a `User`**. Y los **65** puntos
del proyecto que escriben auditoría pasan un usuario real: **no hay ni un solo
precedente de actor «sistema»**.

Además, el precedente más cercano a un cambio automático de marca —
`needsRevalidation`, que lo pone un `updateMany` del procesador de revalidación —
**no registra nada en `AuditLog`**.

### 3.2 Las tres salidas, y la recomendada

| | Qué implica | Coste |
|---|---|---|
| **(a)** `actorId` nullable | Rompe una invariante que vale: «todo registro de auditoría tiene una persona detrás». Obliga a revisar los 65 escritores y el lector que construyó F1 | Alto, y a cambio de poco |
| **(b)** Un `User` sintético «sistema» | Ensucia la tabla de usuarios: aparece en los listados del backoffice, tiene rol, tiene email, y alguien acabará preguntándose si puede iniciar sesión | Alto y turbio |
| **(c)** **Sólo se audita lo manual** | Los cambios del staff van a `AuditLog` con su autor real; el automático no genera registro | **Bajo, y es el precedente que ya hay** |

**Recomendación: (c)**, y no por comodidad. La transición automática **no lleva
información que el anuncio no tenga ya**: `REVIEWED → EDITED` la causa siempre una
edición del dueño, el «quién» es el dueño por definición, y el «cuándo» es
`Listing.updatedAt`, que la ficha ya muestra. Un registro con actor «sistema»
sería una fila que repite tres datos conocidos.

**Acción nueva:** `LISTING_TRIAGE_CHANGE`, con `before`/`after` llevando `triage`
y `watched`. Encaja tal cual en el molde de `AuditLog` y **la ficha la pinta sin
tocar nada**: F1 construyó `listForResource`, y el historial ya se muestra ahí.
Sólo hay que añadir su etiqueta legible al mapa de acciones.

**El hueco que deja, dicho.** El historial tendrá un salto: «Revisado a las 10:00»
y luego la etiqueta dice «Editado», sin fila que lo explique. Se tapa en la
interfaz, no en la base de datos: la insignia de `EDITED` se pinta con la fecha —
«Editado el 19/08 a las 12:40» — leída de `updatedAt`, que es el dato exacto.

---

## 4. Bloque 4 — Dónde vive

Los tres sitios están construidos; P1 los rellena.

### 4.1 La ficha — la cabecera que F1 reservó

`/admin/anuncios/[id]`, sección 1, **junto a la insignia de estado**: es el otro
eje de clasificación y tiene que verse sin desplazarse. Ahí van la insignia de
`triage`, la de `watched` si está puesta, y los controles para cambiarlas. El
historial —sección 8— ya muestra `AuditLog`, así que la traza aparece sola.

Que las dos insignias estén **una al lado de la otra y sean visiblemente
distintas** es parte del diseño: es lo que enseña, sin explicarlo, que son ejes
distintos.

### 4.2 La lista — la insignia

Una insignia en la fila de `/admin/anuncios`, para ver el triaje sin entrar. El
`select` de `listListings` ya trae campos escalares del anuncio: añadir dos es una
línea.

### 4.3 El filtro — el sexto eje del marco de F2

F2 dejó dicho que los ejes nuevos entran «con un campo en el DTO y una línea en el
`where`». P1 es el primero que lo ejerce, en cuatro sitios ya escritos:

| Dónde | Qué se añade |
|---|---|
| `ListAdminListingsDto` | `triage?: ListingTriage[]` (múltiple, molde de `statuses`) y `watched?: boolean` (molde de `hasReports`, tres posiciones) |
| `AdminService.listListings` | dos líneas en el `where` |
| `filtros-url.ts` | leer/escribir los dos parámetros |
| `FiltrosAnuncios.tsx` | los chips de triaje y un conmutador para «en observación» |

Y se combinan con todo lo demás gratis: «los `ACTIVE` **en observación** de esta
rama del catálogo» es una consulta.

### 4.4 Permisos

Sección `anuncios` → **MODERATOR+**, heredado por segmento. **No se añade fila al
mapa**: la ficha y la lista ya pertenecen a esa sección.

**¿Algo ADMIN?** No. La regla que B2 fijó es que ADMIN se reserva para lo
**irreversible**; todo lo de este cuerpo es una etiqueta que se pone y se quita.
Marcar «revisado» por error se arregla desmarcándolo. Es trabajo de moderación
diario, que es literalmente para lo que existe el rol.

---

## 5. Bloque 5 — La relación con `reviewReason`

**No son lo mismo, y conviene decir por qué antes de que alguien los junte.**

`reviewReason` —el «por qué está en la cola», que sigue sin persistirse— pertenece
al **eje de moderación**: explica un `PENDING_REVIEW`. La etiqueta pertenece al
**eje del staff**: explica a qué presta atención. Un anuncio puede estar `EDITED`
sin haber pisado nunca la cola.

Hay un parecido que sí merece anotarse. F1 dejó la ficha mostrando **cuatro
señales calculadas en el momento** (palabra filtrada, vendedor marcado, categoría
marcada, plataforma) diciendo explícitamente que son *lo que está encendido ahora*,
no el motivo. `watched` es lo contrario y por eso lo complementa: **una opinión
humana, duradera y con autor**. Donde las señales dicen «la máquina cree que hay
que mirar esto», `watched` dice «yo, moderador, quiero seguir mirándolo».

**Lo que NO hay que hacer**, y es la tentación concreta: usar `watched` como
sustituto de `reviewReason` — marcar «en observación» al mandar algo a la cola
para saber por qué está ahí. Eso acoplaría los dos ejes por la puerta de atrás y
convertiría la bandera del staff en un campo derivado del disparador. `reviewReason`
se resuelve persistiendo el disparador en su propio eje, cuando se aborde; no es
este cuerpo.

---

## 6. El plan de ráfagas

Dos. La primera deja `main` coherente sin que cambie nada visible: la columna
existe, se rellena sola y acumula el dato correcto.

### E1 — El modelo, la automatización y la traza (backend)

Las dos columnas con sus `@default` (migración aditiva, sin backfill), la
transición `REVIEWED → EDITED` en `update()`, los endpoints para cambiar triaje y
observación, y `LISTING_TRIAGE_CHANGE` en `AuditLog`.

**Barreras:**
1. Crear un anuncio lo deja en `NEW` — sin que `create()` lo escriba.
2. El dueño edita un **`REVIEWED`** → pasa a `EDITED`.
3. El dueño edita un **`NEW`** → **sigue `NEW`** (la guarda; es la mitad de la regla
   y la que se implementa mal con más facilidad).
4. **Ortogonalidad:** cambiar el triaje no toca `status` ni `needsRevalidation`, y
   aprobar/rechazar/archivar no toca el triaje.
5. Editar un anuncio marcado que vuelve a cumplir deja `needsRevalidation=false`
   **y** `triage=EDITED` — los dos ejes, cada uno por su lado (§2.4).

### E2 — La interfaz y el filtro

La cabecera de la ficha, la insignia en la lista, los controles manuales y el eje
de filtro en los cuatro puntos de extensión de F2 (§4.3).

**Barreras:**
1. Un moderador marca «revisado» desde la ficha y **aparece en el historial** con
   su nombre.
2. Filtrar por **«en observación»** devuelve sólo los observados, y **combina** con
   estado y categoría.
3. Poner «en observación» a un `ACTIVE` **no lo saca de la lista pública** — la
   ortogonalidad, vista desde fuera.

**Por qué el filtro no es una tercera ráfaga:** F2 ya construyó el marco, así que
son unas pocas líneas en cuatro sitios; y una insignia en la lista que no se puede
filtrar es un dato que se ve y no se puede usar.

---

## 7. Decisiones abiertas

| # | Decisión | Recomendación |
|---|---|---|
| **D-1** | ¿Los anuncios existentes nacen `NEW` o se siembra `REVIEWED` en los aprobados? | **`NEW` para todos.** Aprobar es dejar publicar; triar es decidir dónde mira el staff. Además la mayoría nunca pasó por la cola (la moderación previa nace apagada), así que la siembra dejaría casi todo en `NEW` igualmente, a cambio de una migración con lógica |
| **D-2** | ¿Aprobar desde la cola marca `REVIEWED` automáticamente? | **No, en E1.** Es tentador —el moderador ha mirado el anuncio— pero acoplaría el eje del staff al de moderación en la dirección que este documento existe para evitar, y «revisado» pasaría a significar «pasó por la cola», que no es lo mismo. Reevaluable con uso real |
| **D-3** | ¿La traza de lo automático? | **No se audita** (§3.2, opción c). La transición no aporta ningún dato que el anuncio no tenga. Alternativa si algún día se quiere una línea de tiempo única: `actorId` nullable, con su coste |
| **D-4** | ¿`watched` es una bandera o admite motivo? | **Bandera a secas** en este cuerpo. Un motivo libre es una nota interna, y eso es otro producto (el molde existe: `TicketMessage.internal`). Nace booleana; añadir texto después es aditivo |
| **D-5** | ¿P3a (editar desde el backoffice) disparará `EDITED`? | **No** (§2.2). Anotado aquí para que P3a no lo redescubra |

### Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| 1 | Que la etiqueta acabe gobernando el estado (o al revés) | Es la barrera 4 de E1, y se afirma en las dos direcciones |
| 2 | Que `EDITED` se dispare en cualquier edición y se vuelva ruido de fondo | La guarda es la barrera 3 de E1: editar un `NEW` no lo mueve |
| 3 | Que las dos insignias de la ficha se lean como una sola cosa | Van juntas pero visiblemente distintas (§4.1); la barrera 3 de E2 comprueba que el efecto real también es distinto |
| 4 | Que `watched` se use como `reviewReason` por la puerta de atrás | §5 lo nombra; la revisión de la ráfaga debe rechazarlo |

### Lo que este cuerpo NO hace

- No persiste `reviewReason` (§5).
- No añade notas internas de texto libre (D-4).
- No toca `status`, `needsRevalidation`, la cola de M3 ni el borrado.
- No construye P2 (ficha de usuario) ni P3a (editar).

---

## Apéndice — inventario verificado

| Qué | Dónde | Dato |
|---|---|---|
| El precedente de ortogonalidad, ya escrito | `schema.prisma`, comentario de `needsRevalidation` | *«no es un estado del ciclo de vida (ése es `status`, y son ejes ortogonales)»* |
| Crear no fija el estado | [`listings.service.ts:263`](../apps/api/src/modules/listings/listings.service.ts#L263) | `createWithUniqueSlug` no pasa `status`: se apoya en `@default(DRAFT)` |
| **La edición del dueño no re-modera** | [`listings.service.ts:303`](../apps/api/src/modules/listings/listings.service.ts#L303) | En todo `update()`: 0 coincidencias de `badWord`, `preModeration`, `PENDING_REVIEW` o `status:` |
| Y sólo QUITA la marca | [`listings.service.ts:467`](../apps/api/src/modules/listings/listings.service.ts#L467) | `if (listing.needsRevalidation) clearIfCompliant(listing)` — *«EDITAR LIMPIA, PERO NUNCA FRENA»* |
| Dónde enganchar la anotación | mismo sitio | Junto a `clearIfCompliant`, antes de encolar el reindexado |
| `AuditLog` exige una persona | `schema.prisma:1109` | `actorId String` **no nulo**, FK a `User` |
| Sin precedente de actor «sistema» | `apps/api/src` | **65** llamadas a `auditLog.log(...)`, todas con un usuario real |
| Y lo automático no se audita hoy | [`revalidation.service.ts:105`](../apps/api/src/modules/listing-gate/revalidation.service.ts#L105) | `updateMany({ data: { needsRevalidation: true } })` — sin registro |
| La lectura del historial ya existe | `audit-log.service.ts` → `listForResource` | La construyó F1; la ficha ya la pinta |
| El molde de «sólo staff» | `schema.prisma`, `TicketMessage.internal` | `Boolean @default(false)`, servido sólo al staff |
| La cabecera reservada | [`anuncios/[id]/page.tsx`](../apps/web/src/app/(admin)/admin/anuncios/[id]/page.tsx) | Comentario de F1: *«P1 (etiqueta interna) irá aquí, junto al estado»* |
| Los cuatro puntos de extensión del filtro | `list-admin-listings.dto.ts` · `admin.service.ts` · `filtros-url.ts` · `FiltrosAnuncios.tsx` | F2: *«entran añadiendo un campo aquí y una línea en el `where`»* |
| El permiso, heredado | [`backoffice-sections.ts:96`](../apps/web/src/config/backoffice-sections.ts#L96) | Sección `anuncios` MODERATOR; `matchesSection` casa por segmento |
| La regla de qué es ADMIN | `admin.controller.ts`, comentario de B2 | ADMIN sólo para lo **irreversible**; el resto, MODERATOR |
| Las 4 señales que muestra la ficha | `admin.service.ts` → `moderationSignals` | Calculadas AHORA, no persistidas — el contraste con `watched` (§5) |
