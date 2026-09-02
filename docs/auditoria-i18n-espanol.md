# Auditoría — traducción al español (i18n de enums y literales en la UI)

> **Qué es esto.** Una auditoría, no un diseño y no una implementación. **Cero código.**
> Barre los 45 enums del esquema uno por uno, mide dónde se pinta cada uno y dice si
> está traducido o crudo, con fichero y línea. Distingue lo que YA funciona (y no hay
> que tocar) de lo que está roto.
>
> **Los tres ejemplos de Ernest se verifican los tres — y los tres son ciertos, pero
> ninguno es lo que parece.** Ni ReportStatus, ni TicketStatus, ni PriceType están «sin
> traducir»: los tres TIENEN diccionario en español, completo y probado. Lo que pasa es
> que hay pantallas que **no lo llaman**. El defecto no es «falta la traducción», es
> «hay siete sitios que se saltan la traducción que ya existe». Eso cambia el arreglo
> entero (§8).
>
> **Método.** Todo lo que se afirma aquí está leído en el código. Lo que no se pudo
> verificar se dice. El inventario de enums sale de `apps/api/prisma/schema.prisma`
> (45 enums); cada uno se ha buscado en `apps/web/src` para ver si llega a una pantalla.

---

## 0. Resumen ejecutivo

| | |
|---|---|
| Enums en `schema.prisma` | **45** |
| Enums que llegan a alguna pantalla | **38** |
| Enums SIN ninguna traducción en ninguna parte | **1** (el `type` de atributo — y no es de Prisma) |
| Enums traducidos pero **pintados en crudo en algún sitio** | **4** (ListingStatus, ReportStatus, TicketStatus, PriceType) |
| Sitios concretos que pintan un enum crudo | **8** |
| Diccionarios duplicados del mismo enum | **31 copias** de 11 enums |
| Divergencias reales ya en producción | **3** (§5) |
| Literales sueltos en inglés en el front | **8** (§6) — y ninguno es texto de negocio |
| Mensajes de error en inglés en el backend | **38**, todos visibles **solo en el backoffice** (§7) |

**El veredicto sobre los tres ejemplos de Ernest:**

| # | Lo que dijo Ernest | Verificado | El matiz |
|---|---|---|---|
| **1** | Los estados de los **Reportes** salen en inglés | **CIERTO — en 1 sitio de 4** | `ESTADO_REPORTE_LABELS` existe, está completo y tiene test. `/admin/reportes` y `ReporteFila` lo usan. **`/admin/usuarios` no** (`page.tsx:279` pinta `{r.status}`) |
| **2** | Los estados de los **Tickets** salen en inglés | **CIERTO — en 2 sitios de 5** | `ticketStatusLabel` existe y está completo. Las dos bandejas y los dos hilos lo usan. **Las dos pantallas de reportes no** (`reportes/page.tsx:353`, `reportes/[id]/page.tsx:186`) |
| **3** | Los **filtros de búsqueda** salen en inglés (`priceType`, `province`) | **CIERTO — y es el peor de los tres** | Es el único que da la cara al **público**, no al staff. `FilterPanel` pinta un bloque genérico de facetas donde el TÍTULO de la sección es el nombre del campo (`priceType`, `province`) y los VALORES son el enum crudo (`FIXED`, `NEGOTIABLE`, `FREE`) |

**La forma del problema, en una frase.** No falta vocabulario: falta que se use. El
proyecto lleva escritas **31 copias** de diccionarios de enums repartidas por 24
ficheros, tres moldes distintos para hacer lo mismo, y ocho pantallas que no llaman a
ninguno. El arreglo no es «traducir»: es **consolidar y cerrar la puerta**.

---

## 1. Método — qué se barrió y cómo

1. Lista completa de enums: `awk` sobre `apps/api/prisma/schema.prisma` → 45 enums.
2. Para cada uno, `grep` de sus valores literales en `apps/web/src` (`.ts`/`.tsx`, sin
   `.test.`), separando **referencias lógicas** (`if (x === 'ACTIVE')`, props,
   parámetros de URL) de **renderizado** (nodo de texto JSX).
3. Barrido transversal de renderizado crudo:
   `grep -oE "\{[A-Za-z_.]+\.(status|type|reason|role|origin|estado|side|outcome|…)\}"`
   sobre todo `app/` y `components/` → 25 aciertos, de los que 8 son nodos de texto
   (el resto son props tipo `status={...}`, que sí pasan por un componente que traduce).
4. Barrido de literales: nodos de texto JSX en inglés, `placeholder=`, `aria-label=`,
   `sr-only`.
5. Backend: `grep` de `*Exception('…')` con texto inglés, plantillas de correo
   (`notification.processor.ts`), y mensajes de `class-validator` en los DTOs.
6. Cruce con quién surface `err.message` en el front (129 sitios) para saber qué
   mensajes del backend llegan de verdad a una pantalla.

---

## 2. LA TABLA — los 45 enums, uno por uno

Leyenda de la columna «Estado»:
**OK** = traducido en todos sus puntos de pintado · **CRUDO** = hay al menos un sitio
que pinta el valor del enum · **N/P** = no se pinta en ninguna pantalla (no es un
defecto de traducción).

### 2.1 Estados y ciclo de vida

| Enum | ¿Se pinta? | Dónde | Estado | Notas |
|---|---|---|---|---|
| `ListingStatus` | Sí, en 8 pantallas | `listing-status.ts:15` (9/9), `MyListingCard.tsx:21` (9/9), `listing-card-shared.tsx:10` (3/9), `anuncio/[slug]:56` (1/9), `MisAnunciosClient.tsx:18` (8 pestañas) | **CRUDO ×2** | `reportes/[id]/page.tsx:237` («Estado: ACTIVE») y `usuarios/page.tsx:249-257` (cadena de ternarios que cubre 4 de 9 y cae al crudo para SOLD/RESERVED/EXPIRED/PAUSED/ARCHIVED) |
| `ListingTriage` | Sí | `listing-triage.ts:19` — `Record<Triage,string>` **tipado** | OK | Uno de los dos moldes buenos |
| `UserStatus` | Sí | `etiquetas.ts:130` (5/5) | OK | |
| `Role` | Sí | `etiquetas.ts:148` (4/4) y `usuarios/page.tsx:86` (4/4) | OK, **divergente** | `ADMIN` = «Administrador» en la ficha, «Admin» en la lista. Ya documentado en `etiquetas.ts:144-147` |
| `ReportStatus` | Sí, en 4 sitios | `etiquetas.ts:121` (4/4), usado por `reportes/page.tsx:224`, `reportes/[id]:138`, `ReporteFila.tsx:60`, `tickets/[id]:476` | **CRUDO ×1** | `usuarios/page.tsx:279` → `{r.status}`. **Ejemplo #1 de Ernest** |
| `TicketStatus` | Sí, en 5 sitios | `TicketStatusBadge.tsx:9` — `Record<TicketStatus,{label,className}>` **tipado** (5/5) | **CRUDO ×2** | `reportes/page.tsx:353` («Hilo abierto (OPEN)») y `reportes/[id]/page.tsx:186` («Hilo OPEN»). **Ejemplo #2 de Ernest** |
| `TicketOrigin` | Sí | `tickets/page.tsx:28` — `Record<TicketOrigin,string>` (3/3) | OK | |
| `TicketAuthorSide` | Sí | `TicketThreadClient.tsx:229`, `tickets/[id]:275` | OK | Condicional, no diccionario — vale, son 2 valores con tratamiento visual distinto |
| `PostStatus` | Sí, 4 pantallas | `blog/page.tsx:26`, `blog/[id]/editar:21`, `paginas/page.tsx:26`, `paginas/[id]/editar:21` | OK | 4 copias. «Publicado» (post) vs «Publicada» (página): **no es divergencia**, es concordancia de género |
| `ContactEstado` | Sí | `mensajes-contacto/page.tsx:26` — `Record<ContactEstado,string>` (4/4) | OK | Los valores del enum ya están en español |
| `SubscriptionStatus` | Sí | `perfil/suscripcion/page.tsx:20` (4/4) | OK | |
| `TransactionStatus` | Sí, solo backoffice | `facturacion/page.tsx:23` y `facturacion/usuarios/[id]:18` (5/5 las dos) | OK | 2 copias idénticas |
| `InvoiceStatus` | Sí, solo backoffice | `facturas/page.tsx:19` (3/3) | OK | El panel del usuario (`FacturasPanel.tsx`) no pinta estado |
| `InvoiceOrigin` | Sí, solo backoffice | `facturas/page.tsx:25` (3/3) | OK | |
| `DataExportStatus` | Sí | `ExportarDatosPanel.tsx:101/111/130`, `ExportarUsuarioButton.tsx:54-96` | OK | Por ramas `if`, no por diccionario. Cubre PENDING/READY/FAILED; **EXPIRED no tiene rama** — pero tampoco pinta crudo (no renderiza nada) |
| `BumpScheduleStatus` | Sí | `etiquetas.ts:159` (4/4) y `bump-schedules.ts:157` (`estadoProgramacion`, 4/4) | OK | 2 redacciones a propósito: corta para el `Dato`, explicativa para el usuario |
| `BumpRunOutcome` | Sí | `bump-schedules.ts:185` (`turnoLabel`, 5/5) | OK | |

### 2.2 Filtros y atributos

| Enum | ¿Se pinta? | Dónde | Estado | Notas |
|---|---|---|---|---|
| `PriceType` | Sí | `etiquetas.ts:89` (3/3), `listing-status.ts:56` (`formatPrice`), `listing-card-shared.tsx:53`, `usuarios/page.tsx:126` | **CRUDO — público** | `FilterPanel.tsx:846` → `CONDITION_LABELS[value] ?? value`, y `CONDITION_LABELS` **no tiene FIXED/FREE/NEGOTIABLE**. Sección titulada `priceType` (`FilterPanel.tsx:831`). **Ejemplo #3 de Ernest** |
| `province` (no es enum) | Sí | `FilterPanel.tsx:831` | **CRUDO — público** | El bloque genérico pinta una segunda sección titulada `province`, **duplicando** el selector «Ubicación» que ya existe 60 líneas más arriba (`FilterPanel.tsx:731`). Los VALORES son nombres de provincia reales (dato, no enum): eso está bien; el TÍTULO no |
| `Condition` | Sí, en 6 sitios | `etiquetas.ts:78`, `anuncio/[slug]:60`, `FilterPanel.tsx:44`, `StepDatos.tsx:49`, `StepPrevisualizacion.tsx:25`, `alert-summary.ts:3` | OK | **6 copias idénticas.** Ninguna diverge — hoy |
| `PriceUnit` | Sí, en 5 sitios | `etiquetas.ts:97`, `StepDatos.tsx:75`, `FilterPanel.tsx:54`, `categorias/page.tsx:88`, `listing-card-shared.tsx:27` (sufijos «/mes») | OK | 5 copias |
| `ListingType` | Sí | `etiquetas.ts:70`, `StepDatos.tsx:44`, `FilterPanel.tsx:14` (plural «Productos») | OK | Singular/plural a propósito |
| `ListingTypePolicy` | Sí | `categorias/page.tsx:78` (3/3) | OK | |
| `ListingViewMode` | Sí | `categorias/page.tsx:85` | OK | Los valores ya son español (`LISTA`/`AMPLIADA`/`MAPA`) |
| Atributos variables (`brand`, `fuel`, `gender`, `size`, `itemType`…) | Sí | `FilterPanel.tsx:762` vía `AttributeFilter`, ficha vía `filterSchemaByType` | **OK — y no son enums** | El nombre técnico es inglés (`fuel`) pero **nunca se pinta**: se pinta `schema.label` («Combustible»), que el admin edita. Los VALORES ya se siembran en español (`seed.ts:87` → `['Gasolina','Diésel',…]`). **No hay defecto aquí** |

### 2.3 Dinero, promoción y contenido

| Enum | ¿Se pinta? | Dónde | Estado | Notas |
|---|---|---|---|---|
| `CreditLedgerType` | Sí | `Historiales.tsx:26` — `Record<CreditLedgerType,string>` **tipado**, 8/8 | **CRUDO ×1** | `facturacion/usuarios/[id]/page.tsx:34` es `Record<string,string>` con **7 de 8**: le falta `COUPON_REDEEM`. Un cupón canjeado se pinta «COUPON_REDEEM» en el backoffice y «Cupón canjeado» en la cuenta del mismo usuario |
| `BumpLedgerType` | Sí | `Historiales.tsx:38` — tipado, 7/7 | OK | |
| `CampaignType` | Sí | `campaigns/page.tsx:211-214` | OK | Ternario, 3/3 |
| `CouponRewardType` | Sí | `cupones/page.tsx:190-192` | OK | Ternario, 3/3 |
| `EntitlementType` | Sí | `facturacion/usuarios/[id]:44` (2/2) | OK | |
| `PriceInterval` | Sí | `perfil/suscripcion:126` («/mes», «/año») | OK | |
| `ProductType` | Sí (lógica) | `planes/page.tsx:77` | N/P | Se filtra por él, no se pinta |
| `FiscalEntityType` | Sí | `FacturacionForm.tsx:28` (3/3) | OK | |
| `ReportReason` | Sí, en 4 sitios | `etiquetas.ts:109` (**7/7**), `usuarios/page.tsx:97` (**6/7**), `ReportButton.tsx:14`, `ReviewReportButton.tsx:16` | OK, **divergente ×2** | Ver §5.1 |
| `DetectorId` | Sí | `etiquetas.ts:223` (3/3) | OK | |
| `DetectionField` | Sí | `etiquetas.ts:237` (3/3) | OK | |
| `BannerPlacement` | Sí | `lib/api/banners.ts:63` — `Record<BannerPlacement,string>` **tipado**, 14/14 | OK | **El mejor molde del repo** |
| `BannerVariant` | Solo en el formulario | `BannerFormDialog.tsx:268-270` | OK | No se pinta en el listado |
| `FooterItemType` | Sí | `footer/page.tsx:119-121` + `:231` | OK | Opciones + ternario |
| `NavItemType` | Sí | `nav/page.tsx:155-157` + `:307` | OK | |
| `NavPageType` | Sí | `nav/page.tsx:23` (`PAGE_TYPES`, 9/9) | OK | |
| `ArchiveReason` | Sí | `usuarios/page.tsx:203` | OK | Ternario, 2/2 |
| Tipos de bloque (blog / portada) | Sí | `blockDefaults.ts:27` — `Record<BlockType,{label,description,icon}>`; `HOME_BLOCK_TYPE_META` | OK | Tercer molde bueno |

### 2.4 Los que NO se pintan (no son defecto)

`PostType`, `ListingPauseOrigin`, `ContactReasonScope`, `FeaturedOrigin`, `InvoiceType`,
`ProductType`, `BumpLedgerType`⁽ᵃ⁾. Siete enums que hoy no llegan a ninguna pantalla.

> ⁽ᵃ⁾ `BumpLedgerType` sí se pinta y está en §2.3; se lista aquí solo para dejar claro
> que el barrido lo miró. Los otros seis se buscaron por sus valores literales
> (`SELF_REQUEST`, `PUBLIC`/`TICKET`/`BOTH`, `PRO_QUOTA` como origen de `Entitlement`,
> `RECTIFICATIVE`…) y no aparecen en ningún nodo de texto.
>
> **Consecuencia para el plan:** no hay que escribirles etiqueta. Pero sí hay que
> decidir si la barrera del §10 los exige de todas formas (recomendación: **no** —
> exigir etiqueta a un enum que nadie pinta es trabajo muerto que además envejece mal).

### 2.5 El único enum sin traducción de ninguna clase

| Qué | Dónde | Valores |
|---|---|---|
| El `type` de un campo del esquema de atributos | `AttributeSchemaEditor.tsx:1299` (`TypeBadge`, pinta `{type}` tal cual) y `:883-886` (el `<select>`, cuyas opciones son `text`/`number`/`select`/`boolean`) | `text`, `number`, `select`, `boolean` |

No es un enum de Prisma (vive en el JSON de `attributeSchema`), pero es el único sitio
del repo donde un valor técnico en inglés se pinta **sin que exista ningún diccionario
en ninguna parte**. Lo ve solo el admin, en la pantalla de categorías.

Al lado, `FieldFlag` (`AttributeSchemaEditor.tsx:1313`) pinta abreviaturas inglesas
—`req`, `filt`, `card`, `wcard`— con la misma característica.

---

## 3. LOS SITIOS QUE YA TRADUCEN — los tres moldes

El repo ya resolvió este problema tres veces, con tres formas distintas. **Las tres son
buenas y las tres siguen vivas.** Lo que falta no es un cuarto molde: es elegir uno.

### Molde A — `Record<Enum, string>` tipado, exhaustivo en COMPILACIÓN

```
lib/api/banners.ts:63     PLACEMENT_LABELS: Record<BannerPlacement, string>   14/14
TicketStatusBadge.tsx:9   STATUS_META:      Record<TicketStatus, {...}>        5/5
listing-triage.ts:19      TRIAGE_LABELS:    Record<Triage, string>             3/3
tickets/page.tsx:28       ORIGIN_LABELS:    Record<TicketOrigin, string>       3/3
Historiales.tsx:26/38     Record<CreditLedgerType|BumpLedgerType, string>      8/8, 7/7
blockDefaults.ts:27       BLOCK_TYPE_META:  Record<BlockType, {...}>
```

**La propiedad que importa:** añadir un valor al tipo unión y no darle etiqueta
**no compila**. Es la lección de A1/banners y es gratis — el coste es que exista el
tipo unión en el front.

### Molde B — `Record<string, string>` + un test-espejo que enumera el enum a mano

`app/(admin)/admin/etiquetas.ts` (243 líneas, 11 diccionarios) con
`etiquetas.test.ts:41-81`, que declara a mano los valores de 10 enums y falla si
un diccionario se queda corto, si le sobra una clave huérfana, o si alguien
«traduce» escribiendo `PRODUCT: 'PRODUCT'`.

Es el molde de **los enums que el front no tipa**: `UserStatus`, `TransactionStatus`,
`InvoiceStatus`, `PostStatus`, `SubscriptionStatus` y `InvoiceOrigin` **no tienen tipo
unión en `apps/web/src`** — llegan como `status: string` desde `lib/api/`. Para ésos el
molde A es imposible sin escribir antes el tipo.

Este fichero es también el precedente político: su cabecera explica que se creó
justamente para **no abrir la tercera copia** de `ReportReason`, y que las etiquetas no
se inventan — se copian de la pantalla donde el usuario ya las lee.

### Molde C — el `switch` exhaustivo con parámetro `never`

`components/notifications/notification-content.ts:34` (`tipoNoContemplado(n: never)`).
Un tipo de notificación sin `case` **no compila**, y a la vez la ejecución degrada a un
texto honesto para filas viejas de un tipo retirado.

Es el molde para lo que no es un mapa plano (textos con interpolación). Su cabecera
documenta que el `default` blando se tragó el fallo **dos veces** antes de que alguien
lo viera a ojo — la misma historia que este documento está contando otra vez.

### El accesorio compartido

`etiquetas.ts:59` — `etiqueta(mapa, valor)`: `null`→`'—'`, desconocido→**el valor crudo**.
Deliberado: un valor sin etiqueta tiene que verse **feo**, no desaparecer.

---

## 4. LOS DEFECTOS — los 8 sitios que pintan el enum crudo

Ordenados por a quién le duele.

### 4.1 Público (1 pantalla, 2 defectos) — el peor, y el único que no ve solo el staff

| # | Fichero:línea | Qué se ve | Por qué |
|---|---|---|---|
| **D1** | `components/busqueda/FilterPanel.tsx:831` | Un título de sección que dice **`priceType`** y otro que dice **`province`** | `FACET_SECTION_LABELS` (línea 65) tiene **una sola entrada**: `priceUnit`. El resto cae a `?? facetKey` |
| **D2** | `components/busqueda/FilterPanel.tsx:846` | Chips que dicen **`FIXED (12)`**, **`NEGOTIABLE (3)`**, **`FREE (1)`** | `CONDITION_LABELS` (línea 44) cubre Condition, ListingType y PriceUnit, pero **no PriceType** |

**Por qué llegan ahí y no a otro sitio.** El backend pide siempre siete facetas
(`search.service.ts:240` — `categorySlug`, `type`, `condition`, `priceType`,
`priceUnit`, `province`, `tags`). `FilterPanel` salta cinco (`SKIP_FACETS`, línea 79) y
pinta el resto con el bloque genérico. Quedan **`priceType`** y **`province`** — los dos
exactos que Ernest nombró.

**Y `province` tiene un defecto de más:** la sección genérica es una **segunda**
interfaz para filtrar por provincia. El selector bueno («Ubicación», con las 52
provincias de `lib/provincias.ts`) está en la línea 731. El usuario ve dos.

### 4.2 Backoffice (5 pantallas, 6 defectos)

| # | Fichero:línea | Qué se ve | El diccionario que ya existe y no se llama |
|---|---|---|---|
| **D3** | `app/(admin)/admin/usuarios/page.tsx:279` | `PENDING` / `RESOLVED` junto a cada denuncia recibida | `ESTADO_REPORTE_LABELS` (`etiquetas.ts:121`) — **la pantalla ya importa de ese fichero** (línea 37) |
| **D4** | `app/(admin)/admin/reportes/page.tsx:353` | «Hilo abierto (**OPEN**)» | `ticketStatusLabel` (`TicketStatusBadge.tsx:31`), re-exportado por `etiquetas.ts:47` |
| **D5** | `app/(admin)/admin/reportes/[id]/page.tsx:186` | «Hilo **OPEN**» | idem |
| **D6** | `app/(admin)/admin/reportes/[id]/page.tsx:237` | «Estado: **ACTIVE**» | `etiquetaDeEstado` (`listing-status.ts:51`) |
| **D7** | `app/(admin)/admin/usuarios/page.tsx:249-257` | `SOLD`, `RESERVED`, `EXPIRED`, `PAUSED`, `ARCHIVED` en los anuncios del usuario | Cadena de 4 ternarios que cubre ACTIVE/PENDING_REVIEW/REJECTED/DRAFT y cae al crudo. `STATUS_LABELS` cubre los 9 |
| **D8** | `app/(admin)/admin/facturacion/usuarios/[id]/page.tsx:338` | **`COUPON_REDEEM`** en el libro mayor | Su propio `LEDGER_TYPE_LABELS` (línea 34) tiene 7 de las 8 claves |

### 4.3 Menores (mismo mecanismo, valor no-Prisma)

| # | Fichero:línea | Qué se ve |
|---|---|---|
| **D9** | `components/admin/AttributeSchemaEditor.tsx:1299, 1313, 883-886` | `text` / `number` / `select` / `boolean`, y las banderas `req` `filt` `card` `wcard` |

---

## 5. LA DUPLICACIÓN — el defecto que todavía no ha explotado

31 diccionarios para 11 enums. Mientras coincidan no se nota. **Tres ya no coinciden.**

### 5.1 `ReportReason` — 4 copias, 2 redacciones, 1 incompleta

| Copia | Claves | Redacción de `SPAM` |
|---|---|---|
| `etiquetas.ts:109` | **7/7** | «Spam» |
| `usuarios/page.tsx:97` | **6/7** (falta `FAKE_REVIEW`) | «Spam» |
| `ReportButton.tsx:14` (público) | 7/7 | «Spam o contenido repetido» |
| `ReviewReportButton.tsx:16` (público) | subconjunto | «Spam o contenido repetido» |

La falta de `FAKE_REVIEW` en la lista de usuarios es **exactamente la divergencia que
`etiquetas.ts:10-15` dice haber arreglado** — se arregló en la ficha y en `/admin/reportes`,
y quedó viva en la lista. Que el público lea una redacción más larga es **correcto** (un
selector necesita explicar; una insignia no); que el staff lea dos cosas distintas, no.

### 5.2 `Role` — 2 copias divergentes

`ADMIN` = «Administrador» (`etiquetas.ts:152`) vs «Admin» (`usuarios/page.tsx:90`).
Ya está anotado en el código como deuda conocida.

**Y hay un tercer problema debajo, que no es de traducción:**
`types/index.ts:38` declara `Role = 'USER' | 'MODERATOR' | 'ADMIN'` — **le falta
`EDITOR`**, que sí está en `schema.prisma:38` y sí tiene etiqueta en los dos
diccionarios. Cualquier `Record<Role, string>` que se escriba hoy sería exhaustivo
sobre un tipo incompleto. **Hay que arreglar el tipo antes de apoyarse en él.**

### 5.3 `CreditLedgerType` — 2 copias, una incompleta

Ver **D8**. Es la única divergencia de las tres que **ya pinta un enum crudo**.

### 5.4 Las que hoy coinciden (pero son el mismo riesgo)

`Condition` ×6 · `PriceUnit` ×5 · `ListingStatus` ×5 · `PostStatus` ×4 ·
`TransactionStatus` ×2 · `ListingType` ×3 · `BumpScheduleStatus` ×2.

---

## 6. LOS LITERALES SUELTOS EN INGLÉS

Se barrieron nodos de texto JSX, `placeholder=`, `aria-label=` y `sr-only` en todo
`app/` y `components/`. **El grueso NO es esto**: el contenido de negocio está en
español, escrito con cuidado y sin excepciones. Lo que queda son 8 restos:

| # | Fichero:línea | Texto | Comentario |
|---|---|---|---|
| **L1** | `components/ui/dialog.tsx:49` | `<span className="sr-only">Close</span>` | Sobrante de shadcn. **Solo lo oye un lector de pantalla** — y lo oye en inglés, en TODOS los diálogos del sitio |
| **L2–L7** | `Breadcrumbs.tsx:22,40`, `anuncio/[slug]:156`, `blog/page.tsx:47`, `blog/[slug]:99`, `busqueda/page.tsx:270`, `paginas/[slug]:76` | `aria-label="Breadcrumb"` | Mismo caso: solo lector de pantalla. 7 ocurrencias |
| **L8** | `AttributeSchemaEditor.tsx:1313` | `req` / `filt` / `card` / `wcard` | Ver D9 |

**No cuentan como defecto** (y no hay que tocarlos): `Email` como etiqueta de campo
(`ContactForm.tsx:129`, `mensajes-contacto/[id]:228`) y `Total` (`facturas/page.tsx:146`)
— las dos son palabras normales del español de uso. Tampoco `Spam`, `Redsys`, `Stripe`,
`Admin`, `Pro`, `RAM`, `bump`.

---

## 7. EL BACKEND — sí manda texto en inglés, y sí se ve

### 7.1 Los correos: limpios

`infra/queue/processors/notification.processor.ts` — los 14 asuntos y cuerpos están
**en español, todos**, escritos a mano y con `text:` plano por política anti-XSS
(«Confirma tu email», «Hemos pausado los bumps programados de «…»», «Tu anuncio "…" no
ha pasado la revisión»). **Nada que hacer aquí.**

### 7.2 Los mensajes de excepción: 38 en inglés, y llegan al backoffice

El grueso del backend lanza en español («Usuario no encontrado», «El saldo ya está a
cero: no hay nada que quitar»). Los que no:

| Módulo | Ejemplos | ¿Quién lo ve? |
|---|---|---|
| `auth.service.ts:114,279,285,291,438,442` | `Email already registered`, `Invalid credentials`, `Invalid Google token` | **Nadie.** Las pantallas de auth ramifican por `statusCode` y escriben su propio texto español (`registro/page.tsx:39-43`, `restablecer:36-39`) |
| `jwt.strategy.ts:30,36` | `User not found`, `Session invalidated` | Nadie (401 → `AUTH_EXPIRED_EVENT`) |
| `billing.service.ts` ×8, `entitlement.service.ts:198`, `redsys.service.ts` ×6 | `Not your subscription`, `Listing does not exist or does not belong to you`, `Credit pack not found or inactive` | Zona de cuenta → `toUserMessage()` genérico. **No se ven** |
| `blog.service.ts:60,129,217`, `media.*` ×6, `homepage.*` ×2, `sponsored-ads.*` ×2 | `Post not found`, **`File type not allowed. Use JPEG, PNG or WebP.`** | **SÍ SE VEN.** Son endpoints de admin y el backoffice pinta `err.message` tal cual |
| `users.service.ts:54,212` | `User not found` | Según el llamante |

**El dato que ordena esto.** `err.message` se pinta en **112 sitios del backoffice** y
en **3 del resto** (y esos tres son errores de subida de vídeo, no del API). Es
deliberado: `lib/api/client.ts:51` (`toUserMessage`) devuelve siempre
«Ha ocurrido un error. Inténtalo de nuevo.» y su comentario dice *«Never exposes raw
backend text»*. El backoffice se saltó esa regla a propósito, porque al staff sí le
sirve el mensaje real.

**Conclusión:** los mensajes en inglés del backend son un defecto **acotado al
backoffice**, y el peor es `File type not allowed. Use JPEG, PNG or WebP.`, que sale
**7 veces** (subir imagen de post, de página, de portada, de banner patrocinado, de
anuncio…). El público está protegido por `toUserMessage`.

### 7.3 La validación de DTOs: inglés por omisión

`main.ts:33` monta `ValidationPipe` sin `exceptionFactory` ni mensajes propios. De 162
DTOs, **solo 11** llevan `message:` en español. El resto usa los textos por defecto de
`class-validator`: *`title should not be empty`*, *`price must not be less than 0`*,
*`email must be an email`*.

Mismo reparto que arriba: el público no los ve (`toUserMessage`), **el backoffice sí**
(`client.ts:234` hace `String(body.message)` — y cuando `message` es el array de
`class-validator`, `String([...])` lo une con comas, así que el admin lee una lista de
frases en inglés separadas por comas).

**Excepción notable:** los rechazos de la **puerta de validación** (`client.ts:76`,
`toGateMessage`) sí están escritos en español y para el usuario, y sí se pintan tal
cual. Ese camino ya está bien.

---

## 8. EL PATRÓN DEL ARREGLO

### 8.1 Lo que NO es el arreglo

- **No es un sistema de i18n** (`next-intl`, ficheros de mensajes, `t('…')`). La
  plataforma es **monolingüe en español** y el propio `CLAUDE.md` lo fija como regla
  («Contenido de cara al usuario y rutas públicas en español»). Meter un motor de i18n
  para traducir 8 sitios sería un cuerpo entero de infraestructura para un problema que
  cabe en dos ficheros. **Si algún día hay un segundo idioma, ese es el momento** — y
  llegar a él con los diccionarios ya consolidados en un sitio lo hace más fácil, no
  más difícil.
- **No es «traducir»**. De los 8 defectos, **7 tienen la traducción ya escrita**. Son
  llamadas que faltan, no textos que faltan.
- **No es un cuarto molde.** Hay tres y los tres funcionan.

### 8.2 Lo que sí es

**Un vocabulario, tres reglas.**

**Regla 1 — un enum, un diccionario, un sitio.**
Hoy `etiquetas.ts` vive en `app/(admin)/admin/`, lo cual lo hace inalcanzable —
conceptualmente — para `FilterPanel`, para la ficha pública y para `MyListingCard`. Y
el nombre («etiquetas») ya colisiona con las *etiquetas/tags* del negocio, que son otra
cosa.

**Recomendación: `apps/web/src/lib/etiquetas-enums.ts`** (o `lib/i18n/enums.ts` si se
prefiere dejar la puerta abierta al motor futuro). Un solo módulo plano, sin JSX y sin
`'use client'` — igual que `listing-status.ts`, que ya prueba que ese formato lo pueden
importar tanto Server Components como Client Components.

`app/(admin)/admin/etiquetas.ts` **no se borra**: pasa a re-exportar, exactamente como
ya hace hoy con `STATUS_LABELS` y `ticketStatusLabel` (líneas 42 y 47). Ese patrón ya
está inventado en el repo y evita tocar los 20 sitios que importan de ahí.

**Regla 2 — exhaustivo, y que lo diga el compilador cuando pueda.**

| Situación | Qué usar |
|---|---|
| El enum **tiene** tipo unión en el front (PriceType, Condition, ListingType, TicketStatus, TicketOrigin, ContactEstado, BannerPlacement, CreditLedgerType, BumpLedgerType, CouponRewardType, CampaignType, FooterItemType, NavItemType, NavPageType, FiscalEntityType, DataExportStatus, ReportStatus, ReportReason…) | **Molde A** — `Record<Enum, string>`. Falta una clave → **no compila** |
| El enum **no tiene** tipo unión (UserStatus, TransactionStatus, InvoiceStatus, InvoiceOrigin, PostStatus, SubscriptionStatus, ListingStatus⁽ᵇ⁾) | **Escribir el tipo unión primero** en `types/index.ts` y usar molde A. Si eso se descarta, **molde B**: `Record<string,string>` + entrada en el test-espejo |
| Texto con interpolación, no un mapa plano | **Molde C** — `switch` con `never` |

> ⁽ᵇ⁾ `ListingStatus` **sí** tiene tipo (`types/index.ts:7`), pero los diccionarios
> están declarados `Record<string, string>` y por eso no protegen. Es cambio de una
> línea por diccionario.
>
> **Antes de nada: arreglar `types/index.ts:38` (`Role` sin `EDITOR`)** — §5.2.

**Regla 3 — la caída sigue siendo el valor crudo, nunca la cadena vacía.**
`etiqueta()` (`etiquetas.ts:59`) ya lo hace y su razonamiento está escrito. Se sube con
el resto y se usa en todas partes. Un valor nuevo sin etiqueta tiene que **verse feo**.

### 8.3 ¿Frontend, backend o ambos?

**Frontend para los enums. Backend solo para los mensajes.** Son dos cuerpos distintos:

- Los enums se pintan en el front y **ahí se quedan**. El backend no debe mandar texto
  de presentación: hoy no lo hace y sería un retroceso.
- Los mensajes de excepción en inglés (§7.2) y los de `class-validator` (§7.3) se
  arreglan en el backend, en su propia ráfaga, y **no dependen de nada de lo anterior**.

---

## 9. EL PLAN DE RÁFAGAS

Cinco ráfagas. Las cuatro primeras son de front y encadenan; la quinta es de back y es
independiente. **T1 y T2 son las que Ernest pidió**; el resto es lo que apareció al
barrer.

### T1 — El público primero *(la más pequeña y la más visible)*
Cerrar **D1** y **D2**: `FilterPanel` deja de pintar `priceType` / `province` / `FIXED`.

- Título de sección: completar `FACET_SECTION_LABELS` con `priceType` («Formato del
  anuncio» o «Precio») y decidir qué hacer con `province`.
- **Decisión que hay que tomar aquí, no es de traducción:** `province` en el bloque
  genérico **duplica** el selector «Ubicación» de la línea 731. Lo coherente es
  **añadir `province` a `SKIP_FACETS`** (la sección genérica desaparece, el selector se
  queda) en vez de ponerle título. Traducirla dejaría dos filtros de provincia en la
  misma columna.
- Valores: `PriceType` deja de caer en `CONDITION_LABELS` y pasa a `TIPO_PRECIO_LABELS`.

Sin dependencias. Se puede hacer sola, hoy.

### T2 — Los defectos del backoffice *(los ejemplos 1 y 2 de Ernest)*
Cerrar **D3–D8**. Seis llamadas que faltan a seis diccionarios que ya existen. Sin
diccionarios nuevos salvo la clave `COUPON_REDEEM` de D8.

### T3 — Consolidar el vocabulario
Subir `etiquetas.ts` a `lib/`, re-exportar desde su sitio actual, y **colapsar las 31
copias a 11 diccionarios**. Cero cambio visible salvo las tres divergencias del §5, que
se cierran eligiendo un texto — **y eligiendo el que ya se ve en la pantalla más
importante**, que es la regla que `etiquetas.ts:21-26` ya fija.

Las dos redacciones legítimas (`ReportReason` larga en los selectores públicos,
`BumpScheduleStatus` explicativa en la cuenta) **se conservan como variantes
declaradas**, no como copias sueltas.

Riesgo: es la ráfaga que más ficheros toca (24) y la única que puede romper algo. Va
después de T1/T2 a propósito — así lo visible ya está arreglado antes de mover nada.

### T4 — Los restos
**D9** (`TypeBadge` + `FieldFlag`), **L1** (`Close` → «Cerrar») y **L2–L7**
(`aria-label="Breadcrumb"` → «Ruta de navegación» — nota: `StepCategoria.tsx:86` ya usa
«Ruta de categoría», así que el precedente existe).

### T5 — El backend *(independiente; se puede paralelizar con T1–T4)*
1. Los **38 mensajes de excepción en inglés** → español. Prioridad al
   `File type not allowed. Use JPEG, PNG or WebP.` ×7, que es el único que un humano ve
   varias veces por semana.
2. Los mensajes de `class-validator`: decidir entre (a) `message:` español en los DTOs
   que un admin puede disparar, o (b) un `exceptionFactory` en `main.ts:33` que
   traduzca. **(b) es menos código y cubre los 162 DTOs de una vez** — pero traduce
   sobre los `constraints`, no sobre el texto, así que hay que verlo antes de prometerlo.

**Orden propuesto: `T1 → T2 → T3 → T4`, con `T5` en paralelo.**

---

### ✅ EJECUTADO — las cinco ráfagas, cerradas (2026-09-02)

`T1` (`f8f6b40`), `T2` (`c3b9d8b`), `T3` (`774927c` + `011d1ed`) y ahora **`T4` + `T5`**.

**T4 — los restos de accesibilidad.** L1 (`Cerrar` en `dialog.tsx`, que se oye en todos los
diálogos del sitio), L2–L7 (las **siete** superficies con migas de pan, todas con el término
canónico «Ruta de navegación») y D9 (`TIPO_ATRIBUTO_LABELS` y `BANDERA_LABELS` en el editor
de atributos — y de paso el desplegable de tipo, que pintaba `text`/`number` crudos).
`StepCategoria.tsx` conserva su «Ruta de categoría»: es el camino de categorías del wizard,
no unas migas de pan — es el precedente de la fórmula, no un octavo caso.

**T5 — el backend.** Se tradujo **lo que un humano ve**, y se consolidó de paso: las **once**
copias a mano de `File type not allowed…` y las **seis** de `No file provided` salen ahora de
`common/mensajes-subida.ts`, con un CONSTRUCTOR (no una constante) porque los logos admiten
SVG y las imágenes de contenido no — una frase, dos listas. Traducidos también los mensajes
de negocio de la zona de cuenta, que no se ven hoy pero eran baratos.

**Y `class-validator` se cerró por la vía del `exceptionFactory`, que resultó viable.** La
auditoría avisaba de que había que verlo antes de prometerlo: se verificó que `constraints`
llega como `{ nombreDeLaRegla: mensajeInglés }`, así que se traduce **por regla** —estable—
y no por texto. El precio, dicho donde se lee: los argumentos (el `120`, el `0`) sólo viven
dentro de la frase inglesa y se extraen con un anclaje específico de cada regla; si algún día
no casan, el mensaje sale **sin** el número en vez de con uno inventado. Una regla que no esté
en el diccionario **se deja pasar tal cual**, que es lo que protege a los validadores propios
del proyecto (`IsSafeContentUrl`, `IsFiscalTaxId`…), que ya escriben en español.

**Lo que NO se tradujo, a propósito** (y no es deuda: es una decisión):

| Familia | Por qué se queda en inglés |
|---|---|
| Las firmas de webhook (`Invalid webhook signature`, `Missing stripe-signature or body`, `Invalid Redsys signature`, `Missing required Redsys notification fields`) | **No las lee una persona.** Las leen Stripe y Redsys, en sus paneles, y nosotros en los logs. Traducirlas empeora el diagnóstico sin mejorarle el día a nadie |
| `auth` y `jwt.strategy` (`Invalid credentials`, `Session invalidated`, `Invalid Google token`…) | **No se ven** — §7.2: las pantallas ramifican por `statusCode` y escriben su propio español. Y `Invalid credentials` está afirmado en **23 sitios** de la batería: cambiarlo es mover código de seguridad y sus tests para que nadie note nada |

Las dos decisiones están fijadas con test (`mensajes-subida.spec.ts`, «BARRERA 5»), así que
si alguien las traduce por celo se entera de que era deliberado.

**Dos cosas que sólo se vieron ejerciéndolo, y que la auditoría no había previsto:**

1. **La primera versión PISABA los `message:` propios.** Traducía por nombre de regla y nada
   más, así que «Cada tarjeta de la rejilla necesita una imagen o un icono.»
   (`grid-block.dto.ts`, un `@IsDefined({ message })`) se convertía en «"blocks.0.items.0.media"
   es obligatorio» — correcto, genérico y **peor**. Lo cazó `homepage.e2e-spec.ts`. Ahora cada
   regla tiene que reconocer además el **texto de fábrica**: lo que no lo sea es de alguien y
   no se toca. Traducir nunca puede empeorar un mensaje ya escrito para quien lo lee.
2. **La búsqueda no heredaba la fábrica.** `search-query.parser.ts:139` construye **su propio**
   `ValidationPipe` (parte la query en claves de DTO y claves de atributo), así que seguía
   devolviendo «hitsPerPage must not be greater than 200» mientras el resto de la API hablaba
   español. La barrera unitaria no podía verlo —el defecto no estaba en la función sino en
   quién la usa—; lo cazó el e2e atacando la ruta de verdad. De paso se alinearon los mensajes
   que ese fichero escribe a mano, que si no habrían salido en inglés **dentro del mismo array**
   que los traducidos.

**Las barreras.** `accesibilidad-en-espanol.test.ts` barre TODO el frontend buscando palabras
inglesas en `aria-label` y `sr-only` —persigue la clase, no las ocho ocurrencias, porque
llegaron copiando—; `mensajes-subida.spec.ts` prohíbe volver a escribir la frase a mano fuera
de su dueño; `validacion-mensajes.spec.ts` cubre la traducción por regla, los anidados y la
FORMA (`message` sigue siendo un array, que es de lo que depende el frontend).

---

## 10. LAS BARRERAS

Sin barrera, esto vuelve. Lo dice el propio repo dos veces: `listing-status.ts` documenta
haber pagado ya una vez «`PAUSED` y `ARCHIVED` pintando el enum crudo hasta B2», y
`notification-content.ts:12-16` cuenta que el `default` blando se tragó **dos** tipos de
notificación sin texto hasta que alguien los vio a ojo.

| # | Barrera | Cómo | Qué mata |
|---|---|---|---|
| **B1** | **Ningún diccionario incompleto** | `Record<Enum, string>` donde haya tipo (molde A); entrada en el test-espejo de `etiquetas.test.ts:41` donde no lo haya | Añadir un valor al enum en Prisma y que salga crudo en producción |
| **B2** | **Ninguna etiqueta que sea el valor crudo** | Ya existe: `etiquetas.test.ts:100-113` rechaza `PRODUCT: 'PRODUCT'` y cualquier `^[A-Z][A-Z_ ]*$` | «Traducir» sin traducir |
| **B3** | **Ninguna clave huérfana** | Ya existe: `etiquetas.test.ts:95-99` | Etiquetas de valores retirados que nadie limpia |
| **B4** | **Ninguna pantalla que se salte el vocabulario** | Ya existe en germen: `etiquetas.test.ts` **lee el fuente de las fichas** (`readFileSync`) y comprueba que llaman al diccionario. Hay que **extenderlo a las pantallas de T2** | Exactamente D3–D7: la traducción existe y la pantalla no la llama |
| **B5** | **Un solo diccionario por enum** | Test que busque en `apps/web/src` más de una declaración con las mismas claves de enum, o —más simple y más robusto— **lint por convención**: que ningún fichero fuera de `lib/etiquetas-enums.ts` declare un `*_LABELS` con claves `SCREAMING_SNAKE` | La copia nº 32, y las divergencias del §5 |
| **B6** | **El barrido de crudos, automatizado** | Un test que recorra `.tsx` buscando nodos de texto `{x.status}` / `{x.reason}` / `{x.role}` … sobre una lista de campos-enum conocidos | Que D3 vuelva a aparecer en la pantalla nº 9 |

**B1–B4 ya existen** para los 10 enums de `etiquetas.test.ts`. El trabajo es
**extenderlas**, no inventarlas. B5 y B6 son nuevas y son las que cierran la puerta de
verdad.

**Sobre exhaustividad y enums que no se pintan (§2.4):** la barrera debe exigir etiqueta
a los enums **que alguna pantalla pinta**, no a los 45. Exigirla a `ContactReasonScope`
o `InvoiceType` obligaría a inventar textos que nadie lee y que envejecerían mal.

---

## 11. LO QUE NO HAY QUE TOCAR

Para que la implementación no rehaga trabajo bueno:

- **Los 11 diccionarios de `etiquetas.ts`** y su test. Se mueven de sitio; su contenido
  es correcto y está justificado línea a línea.
- **`PLACEMENT_LABELS`** (14/14, tipado). Es el molde, no el problema.
- **`TicketStatusBadge`**, **`listing-triage.ts`**, **`blockDefaults.ts`**,
  **`notification-content.ts`**, **`turnoLabel`**, **`estadoProgramacion`**. Todos
  completos, todos con su razonamiento escrito.
- **Los atributos variables de categoría.** `fuel`, `gender`, `itemType` son claves
  técnicas que **nunca se pintan**; lo que se pinta es el `label` que el admin edita, y
  los valores sembrados ya están en español. Aquí no hay nada roto.
- **Los correos del backend.** Los 14 están en español.
- **`toUserMessage`.** Que el público no vea texto del backend es una decisión de
  seguridad, no un defecto de traducción. Traducir los mensajes del backend (T5) **no**
  significa empezar a enseñárselos al usuario.
- **`ListingViewMode`, `ContactEstado`.** Sus valores ya están en español en el propio
  esquema.
- **Las dos redacciones legítimas** de `ReportReason` (larga en el selector público,
  corta en la insignia del staff) y de `BumpScheduleStatus`. No son duplicación: son dos
  registros para dos sitios.

---

## 12. Los cinco puntos donde este documento corrige o matiza el encargo

1. **«No hay sistema de i18n centralizado»** — cierto, y **no debe haberlo**. La
   plataforma es monolingüe por regla de `CLAUDE.md`. El arreglo es un vocabulario, no
   un motor (§8.1).
2. **«Son enums que se muestran crudos»** — en 7 de los 8 casos **la traducción ya
   existe y la pantalla no la llama**. Cambia el arreglo de «escribir textos» a
   «cerrar llamadas + consolidar» (§4).
3. **«Los atributos variables (brand, fuel, gender, size…)»** — **no son un defecto**.
   Sus claves nunca se pintan y sus valores ya están en español (§2.2).
4. **«¿el backend manda algún texto en inglés? — los emails»** — los correos están
   **limpios**. Lo que está en inglés son 38 mensajes de excepción y los defaults de
   `class-validator`, y solo se ven **en el backoffice** (§7).
5. **Aparece un defecto que no estaba en el encargo y que es de los peores:** el bloque
   genérico de `FilterPanel` pinta una **segunda** sección de provincia que duplica el
   selector «Ubicación» ya existente. No es un problema de idioma; se descubre al tirar
   del hilo del idioma, y se arregla en la misma línea de código (§9, T1).
