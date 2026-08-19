# Auditoría + diseño — La moderación previa

> **Qué es este documento.** La auditoría de la moderación que EXISTE hoy y el diseño de la
> moderación **previa** a tres niveles. **Cero código.** No implementa nada.
>
> **De qué parte.** De la puerta ya construida
> ([`docs/diseno-puerta-validacion.md`](diseno-puerta-validacion.md) y sus tres addenda), de la
> profundidad N y de `needsRevalidation`. La moderación previa es el **cuarto cuerpo** del proyecto
> de categorías y la última de las cuatro reglas previstas.
>
> Fecha: 2026-08-17. Verificado contra `main`, commit `8658ab6`. Cada afirmación de la auditoría
> lleva su fichero y su línea; lo que no se ha podido verificar se dice.

---

## Índice

- [Resumen en diez líneas](#resumen-en-diez-líneas)
- [BLOQUE 1 — Auditoría: qué moderación existe hoy](#bloque-1--auditoría-qué-moderación-existe-hoy)
- [BLOQUE 2 — Diseño: la moderación previa a tres niveles](#bloque-2--diseño-la-moderación-previa-a-tres-niveles)
- [BLOQUE 3 — Plan de ráfagas y riesgos](#bloque-3--plan-de-ráfagas-y-riesgos)

---

## Resumen en diez líneas

1. **Hay dos moderaciones y sólo una está terminada.** La *post-hoc* (denuncias) tiene modelo,
   API, backoffice y avisos. La *previa* tiene el estado (`PENDING_REVIEW`), los endpoints
   (`approve`/`reject`) y el aviso al vendedor… pero **ningún botón que los llame**.
2. El único disparador de `PENDING_REVIEW` hoy es el **filtro de palabras**, que es *fail-open* por
   contrato escrito y sólo corre **al publicar** (no al editar).
3. **Aprobar SÍ pasa por la puerta** (`moderation.service.ts:240`). Mi anotación en la regla #3
   decía lo contrario y era imprecisa: lo que ocurre es que **cuatro de las cinco reglas se
   auto-excluyen** en ese contexto. La corrección va desarrollada en §1.6.
4. El moderador que hoy quiere aprobar usa `/admin/anuncios` → cambiar estado a ACTIVE, que es
   **otro endpoint**: no registra `LISTING_APPROVE` y no avisa al vendedor.
5. La moderación previa es un **cuarto desenlace** —desviar— junto a pasar, rechazar y degradar.
6. **El disparador vive en `publish()`, no en la puerta**, y no por analogía: `publish()` **ya**
   calcula un `targetStatus` que puede ser `PENDING_REVIEW`. El sitio existe; sólo hay que
   ampliarlo.
7. **Los tres niveles** (plataforma / categoría con descendientes / usuario) son un `OR`: basta que
   uno diga «revisar».
8. La herencia de «requiere revisión» es un pliegue **monótono**: un descendiente **no puede
   aflojar** lo que un ancestro endurece. Molde: `resolveEffectivePolicy`.
9. **Nace apagada**, los tres niveles por separado. Encenderla cambia lo que le pasa a los
   anuncios, así que lleva interruptor — el criterio que fijó la regla #3.
10. La ráfaga de la UI del moderador es **Playwright puro**: es la que peor encaja mientras el CI
    esté sin minutos.

---

# BLOQUE 1 — Auditoría: qué moderación existe hoy

## 1.1 · Hay DOS moderaciones, y no están al mismo nivel

| | **Post-hoc (denuncias)** | **Previa (revisión antes de publicar)** |
|---|---|---|
| Modelo de datos | `Report` con estados `PENDING/REVIEWING/RESOLVED/DISMISSED` | El estado `PENDING_REVIEW` de `Listing` |
| API | 6 endpoints (`moderation.controller.ts:36-82`) | 4 endpoints (`:84-120`) |
| Backoffice | **Sí** — `/admin/reportes`, con acciones | **No** — ver §1.5 |
| Aviso al vendedor | Sí (`listingModerated`) | Sí, pero sólo en el rechazo |
| Disparador | Un usuario denuncia | El filtro de palabras, y nada más |

La conclusión que importa para el diseño: **la infraestructura de la moderación previa está a
medias**. No hay que construirla entera —el estado, las transiciones, los endpoints y el aviso ya
existen— pero tampoco basta con encender un interruptor.

## 1.2 · `PENDING_REVIEW`: cómo se entra y cómo se sale

**Se entra por un solo sitio**, verificado recorriendo todos los `listing.update*` del backend
(el mismo método de enumeración que usó la cobertura de la puerta, porque el grep ingenuo de
`'status: PENDING_REVIEW'` pierde los que escriben por variable):

- `ListingsService.publish` (`listings.service.ts:514-522`) — `targetStatus` arranca en `'ACTIVE'`
  y pasa a `'PENDING_REVIEW'` **sólo** si el filtro de palabras marca el texto.
- Y, como camino manual, `AdminService.changeListingStatus` a `PENDING_REVIEW`, que la máquina de
  estados admite a propósito desde `ACTIVE` (`listing-status.transitions.ts:81`, «correctiva:
  mandar a revisión un anuncio ya publicado»).

**Se sale por tres**, y la ráfaga (A) los dejó fijados en la máquina de estados
(`listing-status.transitions.ts:76`): `PENDING_REVIEW: ['ACTIVE', 'REJECTED', 'DRAFT']`.

| Salida | Quién | Qué hace |
|---|---|---|
| → `ACTIVE` | `approveListing` (`moderation.service.ts:226`) | Pasa por la puerta, fija `publishedAt`/`expiresAt`, dispara `listingBecameActive`, registra `LISTING_APPROVE` |
| → `REJECTED` | `rejectListing` (`:271`) | Registra `LISTING_REJECT` **con motivo** y avisa al vendedor (in-app + email) |
| → `DRAFT` | Sólo `changeListingStatus` | Correctiva del backoffice: devolver al vendedor sin rechazar |

⚠ **Asimetría verificada:** `approveListing` **no avisa al vendedor**. `listingModerated` sólo se
llama en `rejectListing`, `deactivateListing` y `restoreListing` (`moderation.service.ts:304, 346,
393`). Un anuncio aprobado aparece publicado sin que a su dueño le llegue nada. Con moderación
previa encendida eso pasa de ser un detalle a ser el caso normal, y el diseño lo corrige (§2.5).

## 1.3 · El filtro de palabras: qué hace y qué no

`BadWordService.hasBadWords` (`bad-word.service.ts:17`):

- Lee la lista de `Setting.badWordList` (editable en el backoffice, y **sembrada**).
- Normaliza sin tildes y **tokeniza** por no-alfanuméricos: compara **palabras completas**, no
  subcadenas. `«casa»` no marca `«casanova»`.
- **Fail-open por contrato**, y está escrito en su cabecera: *«if the list is absent, empty, or the
  service throws for any reason, hasBadWords() returns false and publication continues normally →
  ACTIVE. Moderation must never block the publish flow»*. El `catch` devuelve `false` (`:31-34`), y
  quien lo llama lo envuelve en **otro** try/catch que también sigue adelante
  (`listings.service.ts:521-523`).
- **Sólo corre al publicar.** Verificado: es su única llamada en todo el backend. Editar el título
  o la descripción de un anuncio ya ACTIVE **no** vuelve a pasar el filtro.

Las tres cosas son decisiones tomadas, no descuidos, pero las tres condicionan el diseño: el
disparador de la moderación previa **no puede ser fail-open** (§2.6).

## 1.4 · El módulo `Moderation`, por dentro

Doce métodos en `ModerationService`, repartidos así:

- **Denuncias (6):** `createReport`, `listReports`, `getReport`, `startReview`, `resolveReport`,
  `dismissReport`.
- **Acciones sobre anuncios (4):** `approveListing`, `rejectListing`, `deactivateListing`,
  `restoreListing`.
- **Reseñas (1):** `deleteReview`.
- Más `ModerationNotificationsService`, que es lo que avisa al vendedor.

Todo el controlador está bajo `@Roles(MODERATOR, ADMIN)` salvo crear denuncia, que es de usuario
(`moderation.controller.ts:29, 37`).

## 1.5 · El backoffice: la pieza que falta

**No hay ninguna cola de revisión.** Lo verificado:

- `/admin/reportes` existe y es la UI de **denuncias**: resolver, descartar y «Retirar anuncio»
  (que llama a `deactivateListing`).
- `/admin/anuncios` tiene un filtro **«En revisión»** y un selector de estado con
  `['ACTIVE','PENDING_REVIEW','REJECTED','DRAFT']`. Es la cola *de facto*.
- El panel de `/admin` muestra un contador `listingsPendingReview` (`admin.service.ts:1648`).
- **`lib/api/moderacion.ts` no tiene función para `approve` ni para `reject` ni para `restore`.**
  Los tres endpoints existen en el backend y **ninguna pantalla los llama**.

De ahí sale el hallazgo con más consecuencias de esta auditoría:

> **Hoy, un moderador que quiere aprobar un anuncio lo hace desde `/admin/anuncios` cambiando el
> estado a ACTIVE. Eso no es `approveListing`: es `AdminService.changeListingStatus`, otro
> endpoint.** No registra `LISTING_APPROVE` (registra el genérico de cambio de estado) y, si en vez
> de aprobar rechaza por esa vía, **el vendedor no recibe el aviso** que `rejectListing` sí manda.

Es decir: la vía que el producto ofrece hoy al moderador **esquiva** el camino que se construyó
para él. No es urgente mientras la moderación previa esté apagada —a `PENDING_REVIEW` sólo llegan
los anuncios que marca el filtro de palabras— pero encenderla sin cerrar esto convertiría un
detalle en el flujo principal.

## 1.6 · Cómo interactúa con la puerta — y la corrección de una anotación mía

**Aprobar SÍ pasa por la puerta.** `moderation.service.ts:240` llama a `assertCanBecomeActive` con
`{ actor: 'staff', transition: 'approve' }`. Lo que anoté en la regla #3 —«aprobar lleva a ACTIVE
sin pasar por la puerta»— era **impreciso**: el camino pasa; lo que no pasa son las reglas.

De las cinco reglas de la lista, esto es lo que ve un `approve` hoy:

| Regla | ¿Aplica a `approve`? | Por qué |
|---|---|---|
| Cuota de activos | **No** | `actor !== 'seller'` → staff exento (decisión D3) |
| Límite total | **No** | Sólo `transition === 'create'` |
| Correo verificado | **No** | Sólo `seller` + `publish` |
| Mínimo de fotos | **No** | Sólo `seller` + `publish` |
| Atributos (`needsRevalidation`) | **Sí** | `appliesTo` devuelve `true` para todos los actores |

Cada exclusión tiene su razón escrita, y ninguna es un descuido. Pero **juntas** producen un
efecto que nadie decidió: un anuncio que entra en `PENDING_REVIEW` y es aprobado llega a ACTIVE sin
haber pasado por el mínimo de fotos ni por el correo verificado, aunque las dos reglas estén
encendidas. Hoy ese hueco es estrecho (a `PENDING_REVIEW` sólo se llega por palabra prohibida); con
moderación previa **es el camino principal**, y el diseño tiene que resolverlo (§2.7).

## 1.7 · Lo que la auditoría NO ha podido verificar

- **Volumen real.** Cuántos anuncios pasan hoy por `PENDING_REVIEW` en producción. En desarrollo,
  cero. Es el mismo vacío que M2 no puede llenar sin datos reales.
- **El coste de moderar.** Cuánto tarda un moderador en revisar un anuncio, que es lo que decide si
  el nivel «plataforma» es viable o sólo lo son los otros dos.

---

# BLOQUE 2 — Diseño: la moderación previa a tres niveles

## 2.1 · El cuarto desenlace

La puerta y sus reglas han producido, en este orden, tres formas de decir que no:

| Desenlace | Quién lo estrenó | Cuándo se usa |
|---|---|---|
| **Rechazar** | La cuota (regla B.1) | El impedimento está DENTRO del anuncio y se arregla editándolo |
| **Marcar** (`needsRevalidation`) | Los atributos (ráfaga 2) | El anuncio dejó de cumplir por un cambio ajeno; sigue publicado, con aviso |
| **Degradar** a borrador | El correo (regla #2) | El impedimento está FUERA del anuncio; el trabajo se guarda y se avisa |

La moderación previa es el **cuarto**: **desviar**. No es un no —el anuncio va a publicarse— sino
un *«todavía no, y no depende de ti»*. El vendedor no tiene nada que corregir; sólo que esperar.

Esa diferencia manda en todo el diseño: **no se le pide nada al vendedor**, así que no hay motivos
accionables que devolver ni nada que arreglar. Sólo hay que **contárselo bien**.

## 2.2 · Dónde vive el disparador: en `publish()`, y el sitio ya existe

La pregunta del encargo era si el disparador debe ser una regla de la puerta que desvía, o vivir en
`publish()` como la degradación del correo. **La respuesta la da el código que ya hay:**

```ts
// listings.service.ts:514 — HOY
let targetStatus: 'ACTIVE' | 'PENDING_REVIEW' = 'ACTIVE';
try {
  if (await this.badWordService.hasBadWords(...)) targetStatus = 'PENDING_REVIEW';
} catch { /* fail-open */ }

if (targetStatus === 'ACTIVE') {
  await this.gate.assertCanBecomeActive(...);   // ← la puerta sólo corre si va a ACTIVE
}
```

`publish()` **ya** decide entre dos destinos, y **ya** llama a la puerta sólo cuando el destino es
ACTIVE. El disparador de moderación es exactamente la misma clase de decisión que el filtro de
palabras: no valida nada, **elige el destino**. Meterlo en la puerta obligaría a que la puerta
tuviera un veredicto que sólo una regla emite —lo mismo que se descartó en la regla #2, y por las
mismas razones, con el agravante de que aquí el sitio alternativo no hay que inventarlo.

**Decisión: el disparador es un servicio propio (`PreModerationService`) que `publish()` consulta al
calcular `targetStatus`.** La puerta no se toca.

Consecuencia que hay que mirar de frente: **si el destino es `PENDING_REVIEW`, la puerta no corre.**
Eso es correcto (un anuncio en revisión no ocupa plaza de escaparate ni debe consumir cuota) pero
traslada toda la responsabilidad al momento de **aprobar** — §2.7.

## 2.3 · Los tres niveles

Un `OR`: **basta que uno diga «revisar»**. No hay precedencia ni excepciones cruzadas — un nivel no
puede desactivar a otro. Es la regla más simple posible y la única que no genera preguntas del tipo
«¿el usuario de confianza se salta la revisión de su categoría?», que son decisiones de producto
que este diseño no necesita tomar.

```
requiereRevision(anuncio) =
      plataforma()                        // Setting global
   || categoria(anuncio.categoryId)       // marca heredada por la cadena
   || usuario(anuncio.sellerId)           // marca en User
```

### Nivel 1 — Plataforma

Un `Setting` booleano, `preModerationAllListings`, sin fila = apagado. Molde exacto de
`videoEnabled` y de los tres interruptores de la puerta: lector propio, registrado en
`SETTING_KEYS`, con casilla en `/admin/ajustes` y su default en `SETTING_DEFAULTS`.

**Es el más peligroso de los tres**, y conviene decirlo en su propia descripción del backoffice: lo
enciende un clic y a partir de ese instante **todo** anuncio nuevo espera a un humano. Sin saber
cuánto tarda un moderador (§1.7), encenderlo es una apuesta.

### Nivel 2 — Categoría, con herencia N

> **ENMIENDA (roles, ráfaga R2 — 2026-08-19): este nivel lo decide el MODERATOR, no el ADMIN.**
>
> Cuando se escribió esto, todo el control de moderación previa era ADMIN-only, y M4 lo
> justificó para el nivel usuario con un criterio que arrastraba también a éste: «decidir que
> alguien pasa por revisión es política de plataforma, no una acción de moderación del día a
> día». Al abrir `/admin/categorias` a MODERATOR ese criterio se partía por la mitad: un
> moderador podría marcar **una rama entera del catálogo** —N vendedores, presentes y
> futuros— pero no a **un solo vendedor**. El permiso más amplio quedaba por debajo del más
> estrecho.
>
> La enmienda no cambia la fórmula ni la herencia; cambia **el eje con el que se reparte el
> permiso**. No es «específico vs. genérico» —la marca de categoría es tan específica como la
> de usuario, y por eso ninguna de las dos la afloja la confianza— sino **una rama del
> catálogo vs. una persona**. Configurar qué entra en la propia cola de trabajo es moderar;
> señalar a alguien tiene efectos sobre esa persona y se audita nominalmente.
>
> Reparto vigente: PLATAFORMA → ADMIN (`/admin/ajustes`) · USUARIO → ADMIN
> (`PATCH /admin/users/:id/requires-review`) · **CATEGORÍA → MODERATOR**
> (`PATCH /admin/categories/:id`). Ver `docs/diseno-roles.md` §5.

Un campo nuevo en `Category`: `requiresReview Boolean @default(false)`. Migración aditiva.

**La herencia es un pliegue MONÓTONO, y ésta es la decisión de diseño con más filo del bloque:**

```ts
// Molde: resolveEffectivePolicy — donde la restricción del ancestro gana.
resolveEffectiveRequiresReview(propio, efectivoDelPadre) = propio || efectivoDelPadre
```

Un descendiente **no puede aflojar** lo que un ancestro endurece. Marcar «Vehículos» pone en
revisión también «Coches» y «Coches → Clásicos», y no hay forma de eximir una rama desde abajo.

**Por qué no se hace «override» como los formatos de precio:** porque la asimetría de riesgo es
total. Si el pliegue es monótono y alguien se equivoca, el coste es *revisar de más* — trabajo
extra para el moderador, que lo ve. Si se permite aflojar y alguien se equivoca, el coste es
*publicar sin revisar* — y eso no lo ve nadie hasta que hay un problema. Cuando una equivocación
tiene consecuencias asimétricas, el diseño se inclina hacia el lado barato.

**Coste concreto, verificado:** `CategoryNode` (`category-tree.service.ts:105`) lleva hoy cinco
campos de configuración y `loadFresh` los selecciona uno a uno (`:212-222`). Añadir el sexto es
tocar los dos sitios **y** el fixture de 4 niveles (`test/helpers/deep-category-tree.ts`), que
reparte configuración por niveles precisamente para que una resolución rota se note. **Si el campo
nuevo no entra en ese fixture, la herencia puede estar rota y ningún test lo verá** — es el riesgo
R1 de la profundidad, y ya se materializó una vez.

### Nivel 3 — Usuario («para más adelante»)

> **Sigue siendo ADMIN-only tras la enmienda R2** (ver Nivel 2). El argumento de M4 vale
> intacto AQUÍ: apunta a una persona, tiene efecto reputacional y se audita nominalmente. Lo
> que se acotó fue su alcance — dejó de arrastrar también al nivel categoría.

Un campo en `User`: `requiresReview Boolean @default(false)`. **El hueco está diseñado y el molde
existe**: `User.trusted` (`schema.prisma:322`) es su imagen especular —confianza otorgada por la
plataforma, ADMIN-only— con su endpoint `PATCH /admin/users/:id/trusted`
(`admin.controller.ts:148`) y su columna en `/admin/usuarios`. Un `requiresReview` es el mismo
patrón con el signo cambiado.

Se diseña ahora y **se implementa al final**, porque es el único de los tres que no aporta nada
mientras no haya moderadores trabajando de verdad.

> **Nota sobre `trusted`:** la tentación evidente es «un vendedor de confianza se salta la
> revisión». **No entra en este diseño.** Sería una cuarta regla —una exención— sobre un
> mecanismo que todavía no ha corrido nunca, y las exenciones son justo lo que convierte una
> política en un laberinto. Queda anotada como decisión posterior, con el dato que la haría
> defendible: cuántas revisiones se ahorrarían.

## 2.4 · Qué se guarda: por qué está en revisión

`PENDING_REVIEW` no dice **por qué**. Hoy da igual (sólo hay un motivo posible); con tres niveles,
el moderador necesita saber si este anuncio está ahí porque la plataforma revisa todo, porque su
categoría es sensible, porque su vendedor está marcado, o porque el filtro de palabras saltó — y no
es lo mismo revisar en un caso que en otro.

**Propuesta:** un campo en `Listing`, `reviewReason String?`, con valores estables
(`PLATFORM`, `CATEGORY`, `USER`, `BAD_WORD`), escrito al desviar. Aditivo, nace `null`.

- Es **informativo**, no una política: nada ramifica por él salvo la UI del moderador.
- Con varios niveles activos a la vez se guarda **el primero que dispara**, en el orden de arriba.
  Guardarlos todos sería una lista para una pregunta que nadie hace.

## 2.5 · El flujo de revisión, de punta a punta

```
  vendedor publica
        │
        ├─ requiereRevision() = false ─→ la puerta ─→ ACTIVE          (lo de siempre)
        │
        └─ requiereRevision() = true  ─→ PENDING_REVIEW + reviewReason
                                              │
                     ┌────────────────────────┼────────────────────────┐
                     ▼                        ▼                        ▼
              aprobar (moderador)      rechazar (moderador)     devolver a borrador
                     │                        │                        │
              LA PUERTA COMPLETA        REJECTED + motivo          DRAFT + motivo
                     │                   + aviso (ya existe)      + aviso (falta)
                     ▼
                  ACTIVE + aviso (falta)
```

**Lo que ya existe:** los tres endpoints, las tres transiciones, el aviso del rechazo.
**Lo que falta:** el aviso de la aprobación, el aviso del «devuelto a borrador», y **toda la UI**.

**El aviso al vendedor** se apoya en `ModerationNotificationsService.listingModerated`, que ya hace
in-app + email y ya congela el título para sobrevivir al borrado. Sólo hay que ampliar el tipo de
acción (`'APPROVED'` junto a los tres que ya soporta) y llamarlo desde `approveListing`. Y el
momento de decírselo al vendedor **por primera vez** es al publicar: la respuesta de `publish()`
tiene que poder decir «tu anuncio está en revisión», que es exactamente lo que el asistente ya sabe
pintar (`PublicarWizard.tsx:370`, la pantalla «Anuncio enviado a revisión»). Esa pantalla **ya
existe** y hoy sólo la ve quien escribe una palabra prohibida.

**La UI del moderador** es lo único que hay que construir entero. Dos piezas:

1. **La cola** — una vista de `PENDING_REVIEW` ordenada por antigüedad, con el motivo
   (`reviewReason`), el vendedor y una previsualización del anuncio. Puede ser una pestaña de
   `/admin/anuncios` o una página propia; una página propia es preferible porque la cola tiene
   acciones que el listado genérico no tiene.
2. **Las tres acciones** — aprobar, rechazar con motivo, devolver a borrador con motivo. Llamando a
   `approveListing`/`rejectListing`, **no** al cambio de estado genérico: es lo que cierra el
   hallazgo §1.5.

## 2.6 · Fail-open, fail-closed: la decisión que hereda del filtro de palabras

El filtro es fail-open por contrato: si falla, se publica. **El disparador de moderación previa no
puede serlo**, y la razón es que el fallo tiene distinto significado en cada uno:

- Si el filtro de palabras falla, se pierde una *heurística*. Nadie pidió que ese anuncio se
  revisara; sólo se ha perdido una oportunidad de sospechar.
- Si el disparador falla, se salta una *política explícita*: alguien encendió la revisión para esa
  categoría, y el anuncio se publica sin ella.

**Decisión: fail-closed.** Si la consulta del disparador falla, el anuncio va a `PENDING_REVIEW`.
El coste del error es trabajo de más para el moderador; el del contrario es publicar sin revisar lo
que se había decidido revisar. Misma asimetría que la herencia monótona, misma inclinación.

**El filtro de palabras se queda como está.** No se sustituye ni se cambia su contrato: es una
heurística útil y barata, y ahora pasa a ser sencillamente **un cuarto motivo** de desvío
(`BAD_WORD`) junto a los tres niveles. Cambiarlo a la vez que se construye la moderación previa
mezclaría dos cosas que se pueden mover por separado.

## 2.7 · Aprobar tiene que pasar la puerta ENTERA

Es la consecuencia directa de §2.2 (si el destino es `PENDING_REVIEW`, la puerta no corre) y la
corrección de §1.6.

**Qué debería aplicar en `approve`, y por qué:**

| Regla | Hoy | Propuesta | Razón |
|---|---|---|---|
| Atributos | Sí | **Sí** (sin cambio) | Es una propiedad del anuncio; ya aplica a todos los actores |
| Mínimo de fotos | No | **Sí** | Ídem. Un anuncio sin fotos no mejora por pasar por revisión |
| Correo verificado | No | **No** | Es una propiedad del VENDEDOR y su arreglo está fuera del anuncio. Frenar al moderador por algo que sólo el vendedor puede resolver es la definición de dejar la moderación en rehén |
| Cuota de activos | No | **No** | Decisión D3, ya tomada y escrita |
| Límite total | No | **No** | Es de creación; el anuncio ya existe |

El criterio, enunciable: **en `approve` aplican las reglas sobre el ANUNCIO y no las reglas sobre
el VENDEDOR.** Es la misma línea que ya separa la cuota (vendedor, exenta) de los atributos
(anuncio, no exenta) — sólo que ahora se aplica a las cinco.

Implementarlo es ampliar el `appliesTo` de **una** regla (mínimo de fotos) para que incluya
`approve`. Y trae una consecuencia que hay que aceptar: **el moderador puede encontrarse un anuncio
que no puede aprobar** porque le faltan fotos. La salida es la tercera acción del flujo —devolverlo
a borrador con un motivo— que por eso no es un adorno del diseño sino una pieza necesaria.

## 2.8 · Nace apagada — los tres niveles por separado

| Nivel | Interruptor | Sin configurar |
|---|---|---|
| Plataforma | `Setting.preModerationAllListings` | Apagado |
| Categoría | `Category.requiresReview` | `false` en todas |
| Usuario | `User.requiresReview` | `false` en todos |

**No hay un interruptor maestro** además de estos tres, y es deliberado: cada nivel ya es su propio
interruptor, y un cuarto por encima crearía la duda de qué manda. Es coherente con el criterio que
fijó la regla #3 —el interruptor lo lleva lo que **cambia lo que le pasa a alguien**— y los tres lo
cambian.

**Lo que NO cambia al desplegar:** ningún anuncio existente se mueve. Los tres niveles nacen
apagados, así que `requiereRevision()` devuelve `false` para todo el mundo y `publish()` se comporta
exactamente como hoy (incluido el filtro de palabras, que sigue siendo el único desvío real).

---

# BLOQUE 3 — Plan de ráfagas y riesgos

## 3.1 — Las ráfagas, y qué se puede verificar sin CI

> 🎭 = **necesita Playwright**, es decir, queda descubierto mientras el CI esté sin minutos.

### Ráfaga M1 — El disparador y los tres niveles (backend puro)

El campo `Category.requiresReview` + su resolución heredada + `User.requiresReview` + el `Setting`
de plataforma + `PreModerationService` + el enganche en `publish()` + `Listing.reviewReason`.
Los tres niveles en el backoffice de ajustes y en el editor de categorías.

- **Verificable en local, entero.** Batería de backend: los tres niveles por separado y combinados,
  la herencia sobre el fixture de 4 niveles, el fail-closed, y que **apagado no cambia nada**.
- **Sin Playwright.** La marca de categoría en `/admin/categorias` es una casilla más en un
  formulario que ya tiene pruebas unitarias; su Playwright puede esperar a M3.
- Es la ráfaga con **más riesgo silencioso** (la herencia) y la que más se apoya en tests que sí se
  pueden correr sin CI. Buena candidata para hacerla ya.

### Ráfaga M2 — Aprobar pasa la puerta entera + los avisos que faltan

Ampliar el `appliesTo` del mínimo de fotos a `approve`; el aviso de aprobación; el aviso de
«devuelto a borrador»; y que `publish()` devuelva a quién y por qué se ha desviado.

- **Verificable en local casi entera** (e2e de backend + unitarios de web para el aviso).
- 🎭 **sólo la pantalla del asistente**, que ya existe y sólo cambia de disparador.
- Depende de M1 pero es pequeña.

### Ráfaga M3 — La UI del moderador 🎭

La cola de revisión, la previsualización, y las tres acciones llamando a los endpoints correctos.

- **Es Playwright puro.** Lo que hay que probar es exactamente lo que un test unitario no ve: que
  el moderador entra, ve la cola, pulsa aprobar y el anuncio sale publicado.
- Los endpoints ya están cubiertos por la batería de backend, así que el riesgo no es que la API
  falle: es que la pantalla no llame a lo que debe —que es precisamente el hallazgo §1.5.
- **Recomendación: hacerla cuando vuelva el CI.** Es la única de las tres que queda mal cubierta
  sin él.

### Ráfaga M4 — El nivel de usuario

`User.requiresReview` conectado al backoffice de usuarios, molde `trusted`.

- Backend verificable en local; 🎭 la columna y el interruptor en `/admin/usuarios`.
- **La última**, por decisión del propio encargo.

## 3.2 — Riesgos, ordenados por lo que cuesta que salgan mal

| # | Riesgo | Por qué preocupa | Mitigación |
|---|---|---|---|
| **R1** | **La herencia de `requiresReview` se rompe en silencio** | Es el riesgo R1 de la profundidad, y ya se materializó una vez: una resolución que sube un nivel en vez de N no da error, simplemente el bisnieto no hereda. Aquí el fallo se traduce en **publicar sin revisar** | El campo entra en `CategoryNode`, en `loadFresh` **y en el fixture de 4 niveles**, con un caso que marque un ancestro y afirme sobre la hoja. Sin eso, la ráfaga no está terminada |
| **R2** | **Aprobar sigue esquivando la puerta** | Si M1 se hace y M2 no, la moderación previa queda encendida con el hueco de §1.6 **ampliado**: ahora todos los anuncios pasan por ahí | M2 no es opcional ni posterior: es parte de encender la moderación. Se puede implementar M1 y no encenderla hasta tener M2 |
| **R3** | **El moderador sigue usando `/admin/anuncios`** | La vía vieja seguirá existiendo y esquiva el aviso al vendedor. Una UI nueva no borra la anterior | La cola de M3 tiene que ser el camino evidente. Y conviene decidir si el cambio de estado genérico debe seguir ofreciendo `ACTIVE` sobre un `PENDING_REVIEW` — anotado como decisión, no resuelto aquí |
| **R4** | **Encender el nivel plataforma sin saber el volumen** | Todo anuncio nuevo espera a un humano. Si nadie mira la cola, el marketplace deja de publicar | El aviso en la descripción del ajuste, y la recomendación de empezar por el nivel **categoría**, que acota el volumen a una rama |
| **R5** | **Fail-closed convierte una caída en un atasco** | Si la consulta del disparador falla de forma sostenida, todo va a revisión | Es el lado barato de la asimetría (§2.6) y es visible: la cola crece. Preferible al contrario, que es invisible |
| **R6** | **`needsRevalidation` y `PENDING_REVIEW` a la vez** | Un anuncio marcado que además va a revisión: dos mecanismos sobre el mismo anuncio | No colisionan: uno decide el **destino** (publish) y el otro **frena transiciones** (la puerta). Al aprobar, la puerta corre y la regla de atributos aplica — que es lo correcto. Anotado para que se pruebe explícitamente en M2 |

## 3.3 — Lo que este diseño deja decidido, y lo que no

**Decidido:**

- El disparador vive en `publish()`, no en la puerta. La puerta no se toca.
- Los tres niveles son un `OR` sin exenciones.
- La herencia de categoría es monótona: un descendiente no puede aflojar.
- Fail-closed.
- Aprobar aplica las reglas del **anuncio** y no las del **vendedor**.
- Nace apagada, tres interruptores independientes, ningún maestro.

**No decidido, y a propósito:**

- Si `trusted` debe eximir de revisión (§2.3).
- Si el cambio de estado genérico del backoffice debe seguir permitiendo `PENDING_REVIEW → ACTIVE`
  una vez exista la cola (R3).
- Los SLA de revisión (cuánto puede esperar un anuncio), que dependen del volumen que nadie ha
  medido todavía (§1.7).
- Si el filtro de palabras debería correr también al editar. Es un hueco real, pero es **suyo**, no
  de este diseño.
