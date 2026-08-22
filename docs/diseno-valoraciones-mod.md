# Diseño — moderar valoraciones: editar y retirar (punto 7b)

> El diseño corto del punto 7b: el staff **edita** (texto y estrellas) y **retira** una
> valoración, con retirada **lógica** — la fila sobrevive, deja de contar y se puede
> restaurar.
>
> Base: `docs/auditoria-retoques-backoffice.md` §7 · 7a (las valoraciones ya se ven) ·
> B1 (la valoración es un registro con valor propio) · B2 (reversible → MODERATOR).
>
> **Cero código.** Todo verificado en el repo, con fichero y línea.

---

## 0. El hallazgo que reformula el punto

La auditoría dijo: «editar y eliminar como staff **no existe**». **Eso era falso para
eliminar, y el error fue mío**: miré `reviews.controller.ts` y no
`moderation.controller.ts`.

```
DELETE /moderation/reviews/:id        moderation.controller.ts:137
  → MinRole(MODERATOR) de clase       moderation.controller.ts:29
  → prisma.review.delete(...)          moderation.service.ts:426   ← BORRADO FÍSICO
  → AuditLog REVIEW_DELETE + aviso al autor
```

**Existe, está expuesto, es MODERATOR, y la interfaz ya lo ofrece** desde la cola de
denuncias (`admin/reportes/page.tsx:311`).

> **Por tanto 7b no es «añadir un borrado». Es SUSTITUIR uno que está vivo y que destruye
> la prueba que lo motivó.**

### Y el riesgo 5 de B1 no es hipotético: está ardiendo

`Report.reviewId` es `Cascade` (`schema.prisma:1125`). B1 lo anotó y lo dejó fuera de
alcance —«va de reseñas, no de anuncios»— para no perderlo. Pues bien: el botón de la cola
de denuncias hace exactamente esto:

```ts
await deleteReview(r.review!.id, token);   // borra la valoración → Cascade DESTRUYE el Report
await resolveReport(r.id, token);          // ...y resuelve ESE MISMO Report, que ya no existe
```

`resolveReport` lanza `NotFoundException('Reporte no encontrado')`
(`moderation.service.ts:162`) y `handleAction` lo pinta en un `alert`
(`reportes/page.tsx:111-116`).

> **Hoy, cada vez que un moderador usa ese botón: destruye la denuncia, y recibe un
> «Error 404: Reporte no encontrado».** La acción se hace a medias y encima informa de
> fallo. Es la misma clase de defecto que F1 encontró en la cola de revisión: roto el
> 100 % de las veces, y nadie lo había dicho.

---

## 1. El modelo de la retirada

### El molde existe: `Entitlement.revokedAt`

No se inventa un patrón. El repo ya tiene el de «el registro sobrevive pero deja de
contar»: `Entitlement.revokedAt` —«revokedAt se setea en dos casos… un entitlement con
revokedAt [ya no vale]»— con su `@@index([revokedAt])` (`schema.prisma:1364-1419`). Y
`ContactReason.activo`, que documenta el mismo criterio en palabras: «de todos modos no hay
endpoint DELETE; se desactiva».

```
Review.retiredAt     DateTime?   // null = vigente. La marca.
Review.retiredById   String?     // quién. FK a User, SetNull (molde Report.resolvedById)
Review.retiredReason String?     // por qué. Obligatorio en el DTO, como el `reason` de P3a
```

Tres campos y no un booleano: «quién y por qué» es lo que hace la retirada auditable **en
el propio registro**, y no sólo en el `AuditLog`. Restaurar los pone a `null`.

**Por qué lógica y no física**, en una línea: el criterio de B1 es que una valoración es un
registro con valor propio que no debe poder destruirse por la vía fácil. La retirada lógica
lo respeta **y además** hace reversible una acción que hoy no lo es — que es lo que la
mantiene en MODERATOR según B2 (ADMIN queda para lo irreversible).

---

## 2. El inventario de lectores — EXHAUSTIVO

Ésta es la parte que puede salir mal en silencio: **un lector que no se entere seguiría
contando una valoración retirada**. Grep completo de `prisma.review` y de las relaciones
`reviews*` en el backend:

| # | Lector | Dónde | ¿Debe excluir las retiradas? |
|---|---|---|---|
| 1 | **La media** (`_avg`) | `reviews.service.ts:142` | **Sí** — es el daño principal |
| 2 | **El recuento** (`_count`) | `:142` | **Sí** |
| 3 | **La distribución** (groupBy) | `:147` | **Sí** |
| 4 | **Las no verificadas** (count) | `:152` | **Sí** |
| 5 | **La lista pública** (findMany) | `:136` | **Sí** — el perfil del vendedor |
| 6 | **El cursor** (pivot) | `:121` | **Sí**, o paginará sobre un ancla invisible |
| 7 | **Las medias de tarjeta** (groupBy) | `:225` `getRatingSummaries` | **Sí** — la usan búsqueda, portada y ficha pública |
| 8 | **Elegibilidad** (`getEligibility`) | `:94` | **DECISIÓN** — ver abajo |
| 9 | Ficha de anuncio (staff) | `admin.service.ts:576` | **No**: el staff las ve, marcadas |
| 10 | Ficha de usuario (staff) ×2 | `admin.service.ts:1159, :1170` | **No**, ídem |
| 11 | `_count.reviewsReceived` (staff) | `admin.service.ts:1187` | **Sí** — si no, el contador dirá 12 y se listarán 11 vigentes |
| 12 | La cola de denuncias | `moderation.service.ts:108` | **No**: es justo lo que hay que poder mirar |
| 13 | Aviso de moderación | `moderation-notifications.ts:124` | **No** |
| 14 | Enlace de ticket (`linkedLabel`) | `tickets.service.ts:47, :279, :436` | **No** — el hilo sobrevive al contexto |

**Siete lectores públicos** (1-7) tienen que aprender la regla, y **cuatro de ellos viven
en el mismo método** (`listForUser`). Los de staff (9-14) **no deben excluirlas**: retirar
no es esconderle la valoración a quien la modera.

> El molde de esta cautela es U1 (P2): allí el inventario de «los siete lectores de *es
> Pro*» destapó que el problema no era donde parecía. Aquí el peligro es el simétrico —
> que uno de los siete se quede sin enterar y siga sumando una valoración retirada a la
> reputación de alguien.

### La decisión abierta: `getEligibility` (#8)

`@@unique([authorId, targetId, listingId])` sigue vigente, así que **una valoración
retirada BLOQUEA que su autor escriba otra** sobre el mismo anuncio. Dos salidas:

- **(a) Que la bloquee.** Retirar es «esto no debió publicarse»; permitir reescribirla
  invita a repetirla. Coste: si la retirada fue un error, el autor queda mudo hasta que se
  restaure.
- **(b) Que no la bloquee** — `getEligibility` ignora las retiradas. Choca con el `@@unique`
  a nivel de base: habría que crear la segunda fila, y no cabe.

**Propuesta: (a)**, que además es lo que la base ya impone. Se documenta y punto.

### La media no está desnormalizada — eso es una buena noticia

Verificado: `average`, `count` y `distribution` se calculan **al vuelo** en cada lectura
(`aggregate` + `groupBy`), y `getRatingSummaries` igual. **No hay ninguna media
materializada que recalcular**: retirar surte efecto inmediatamente y no hay nada que
desincronizar. Editar las estrellas, lo mismo.

### La nota que 7a dejó: `verified`

`verified` **no viaja** en el `select` de ninguna de las dos fichas de staff. Es el campo
que dice si esa valoración **cuenta para la media**, así que un moderador que va a retirar
una necesita verlo: retirar una `verified: false` no cambia la reputación de nadie. **Entra
en 7b**, junto a `retiredAt`.

---

## 3. Editar (texto y estrellas)

`PATCH /moderation/reviews/:id` (MODERATOR, junto a su hermana), con `reason` obligatorio y
`AuditLog` con `before`/`after` — molde exacto del `LISTING_EDIT` de P3a.

- **Recalcular no hace falta**: la media es al vuelo (§2). Cambiar 1★ por 3★ se refleja en
  la siguiente lectura.
- **`verified` NO se toca.** Está congelado al crear y «NUNCA recalculado (ni por `edit()`,
  ni por ningún otro endpoint)» (`schema.prisma:1052-1060`). Cualquier camino nuevo hereda
  esa regla.
- **`editedAt` NO se reutiliza.** Hoy significa «el autor la editó» y el frontal pinta
  «Editada» con él. Usarlo para una edición de staff **mentiría al lector**: diría que el
  autor cambió de opinión. Si hace falta señal pública, es otra columna — y probablemente
  ni eso.
- **El autor SÍ se entera, y ya hay molde**: `deleteReview` avisa hoy con
  `REVIEW_MODERATED` (`moderation-notifications.ts:209-226`), saltándose el caso de que el
  actor sea el propio autor. Editar y retirar avisan igual. Que el staff toque una opinión
  firmada por alguien sin decírselo no es defendible.

> **Y una cautela sobre el alcance de editar.** Reescribir el texto de otra persona deja en
> pie una opinión firmada por quien **ya no dijo eso**. Recortar —vaciar el comentario y
> conservar la nota— es más defendible que reescribir. Se ofrecen las dos porque el
> enunciado lo pide, pero conviene que la interfaz llame a las cosas por su nombre:
> «corregir» no es lo mismo que «reescribir».

---

## 4. `Report.reviewId`: NEUTRALIZADO, no arreglado

Con retirada lógica **la fila no se borra**, así que el `Cascade` no se dispara nunca y la
denuncia sobrevive apuntando a una fila que existe. El riesgo 5 de B1 **se evita**.

**Pero sigue siendo `Cascade`**, y eso hay que dejarlo escrito con todas las letras:

- **7b debe RETIRAR el borrado físico**, no dejarlo al lado. Si `DELETE
  /moderation/reviews/:id` sobrevive, el riesgo sigue vivo y además con dos vías para lo
  mismo. La ruta se sustituye por la retirada; el flujo de la cola de denuncias pasa a
  «retirar + resolver», que además **arregla el 404 de §0**.
- **Si algún día se quiere borrado físico de verdad** (RGPD, derecho de supresión), hay que
  arreglar `Report.reviewId → SetNull` **antes**. Queda anotado en `pendientes.md` junto al
  riesgo 5 original, que deja de estar «fuera de alcance» y pasa a «evitado, no resuelto».

> **YA ARREGLADO (2026-08-22), en su propia ráfaga.** `Report.reviewId` es `SetNull` +
> snapshot (`reviewComment` / `reviewAuthorName`, escritos al **crear** la denuncia), con
> backfill: molde de B1, `diseno-borrado.md` §2.4/§3.3. El riesgo 5 pasa de «evitado, no
> resuelto» a **resuelto**, y un borrado físico futuro ya no destruiría denuncias. Lo de
> arriba se conserva porque es el porqué de la retirada lógica, que sigue siendo lo correcto
> por otra razón: retirar es reversible.

*(Segundo salto, ya sano: `Ticket.reviewId` es `SetNull` con `linkedLabel` conservado
—`schema.prisma:2557-2570`—, así que un hilo que hablaba de la valoración sobrevive y sigue
siendo legible.)*

---

## 5. El plan — una ráfaga

Cabe en una: el modelo es de tres columnas, la media no está desnormalizada y los lectores
públicos son siete, cuatro de ellos en el mismo método.

**Backend:** migración · el filtro en los siete lectores · `PATCH` y `POST
/moderation/reviews/:id/retire` + `/restore` · sustituir el `DELETE` · `AuditLog`
(`REVIEW_EDIT`, `REVIEW_RETIRE`, `REVIEW_RESTORE`) · avisos al autor · `verified` y
`retiredAt` en el `select` de las dos fichas.
**Frontend:** los controles en `ValoracionFila` (7a dejó el sitio) y el arreglo del flujo
de la cola de denuncias.

### Las barreras

| | Qué fija |
|---|---|
| **B1** | Retirar **saca de la media** — se afirma sobre la media pública, no sobre el campo |
| **B2** | Retirar **la quita del perfil público**, y de las medias de tarjeta (`getRatingSummaries`) |
| **B3** | **La fila SOBREVIVE**: tras retirar, `prisma.review.findUnique` la encuentra |
| **B4** | **La denuncia sobrevive** — el `Report` que la señalaba sigue ahí *(el test que hoy fallaría)* |
| **B5** | **Restaurar la devuelve** a la media y al perfil: es reversible de verdad |
| **B6** | El **staff SÍ la ve**, marcada, en las dos fichas |
| **B7** | Editar las estrellas **cambia la media** en la siguiente lectura |
| **B8** | El **contador de staff** (`_count`) no dice 12 con 11 vigentes |
| **B9** | Editar **no toca `verified`** ni `editedAt` |
| **B10** | Desde la cola de denuncias, retirar + resolver **funciona sin 404** |

**Mutaciones que deben matar:** olvidar el filtro en `getRatingSummaries` → cae B2 (y sólo
ésa: es el lector que más fácil se olvida, porque vive lejos); olvidarlo en el `aggregate` →
cae B1; dejar el borrado físico → cae B3 **y** B4.

---

## 6. Lo que hace falta decidir antes de empezar

1. **¿Una valoración retirada bloquea que su autor escriba otra?** Propuesta: **sí** (es lo
   que el `@@unique` ya impone).
2. **¿La retirada es visible en el perfil público como hueco** («valoración retirada por el
   equipo») **o desaparece sin dejar rastro?** Propuesta: **desaparece** — un hueco invita a
   especular sobre qué decía, y la transparencia que importa es hacia el autor, que sí
   recibe aviso.
3. **¿Se ofrece reescribir el texto, o sólo recortarlo?** Propuesta: reescribir, porque el
   enunciado lo pide, pero con la interfaz llamándolo por su nombre.

Todo lo demás —el modelo, el inventario de lectores, la neutralización del `Cascade`, las
barreras— sale de lo ya construido y no depende de ninguna preferencia.
