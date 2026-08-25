# Diseño — ROTACIÓN DE DESTACADOS: repartir la vitrina con justicia

**Fecha:** 2026-08-25
**Origen:** `docs/auditoria-destacados-busqueda.md` (hallazgo central H5: el bloque
«Promocionados» está congelado; quien destaca un anuncio antiguo no aparece nunca).
**Decisión de Ernest:** **rotación temporal** — todos los destacados que cumplen los filtros se
turnan en el bloque.
**Naturaleza:** diseño. **Cero código.** Todo verificado hoy contra el repositorio.
**Principio rector:** **la promesa = lo que se entrega.** Si el diálogo dice «aparece en el
bloque», el sistema tiene que hacer que aparezca; y si lo que entrega es un turno, el diálogo
tiene que decir «turno».

---

## 0. Resumen de las decisiones

| # | Decisión | En una línea |
|---|---|---|
| **D1** | **Unidad de rotación: ventana temporal de 15 min** (`FEATURED_ROTATION_WINDOW_MINUTES`, con override por entorno) | Estable dentro de la ventana, cacheable, y en un ciclo salen todos |
| **D2** | **El estado son DOS campos en el documento de Meilisearch** (`featuredStartsAt`, `featuredExpiresAt`) **y un cursor derivado del reloj**. Cero estado persistente nuevo | Es la opción barata del 10x: no hay contador por anuncio, no hay tabla, no hay Redis obligatorio |
| **D3** | **Mecánica: round-robin por página** sobre un orden estable (`featuredStartsAt:asc`), con la ventana como cursor | ≤ 2 consultas a Meili, y la segunda **solo cuando N > 4** |
| **D4** | **Sin deduplicación por vendedor en la selección** | Quien paga 10 destacados recibe 10 turnos: es equidad **por euro**, no privilegio. Y Meili v1.10 no puede hacerlo en motor (ver §6) |
| **D5** | **El bloque deja de seguir el `sort` del usuario** (sigue respetando **todos** los filtros) | Un turno no puede depender del orden pedido sin volver a congelarse |
| **D6** | **«Todas las categorías» NO necesita cuota por categoría** | El round-robin ya da a cada anuncio un turno igual, venga de donde venga |
| **D7** | **La frase del diálogo se reescribe para prometer el turno**, «Destacados primero» se renombra a lo que hace, y el badge «Destacado» llega al mapa | Las tres correcciones de honestidad, coherentes con la rotación |

---

## 1. Punto de partida — reverificado hoy

Lo que la auditoría dijo sigue siendo cierto, línea por línea:

- El bloque son **4** (`FEATURED_BLOCK_SIZE`, `search.controller.ts:17`), **solo página 1**
  (`:162`), resuelto con una **2ª consulta** a Meilisearch con `onlyBoosted: true` y el mismo
  `baseParams` (`:163-169`) → `boostScore = 1` (`search.service.ts:500`).
- Hoy los 4 son **«el orden de la lista, truncado a 4»**: `sort: dto.sort` (`:165`). Sin estado,
  sin rotación, sin memoria.
- **El documento de Meilisearch no tiene con qué rotar.** `ListingDocument`
  (`search.service.ts:14-74`) tiene `boostScore: 0 | 1` y nada más del destacado: **no hay
  `featuredAt`, no hay `featuredUntil`, no hay contador de apariciones.** Confirmado.
- **El estado sí existe en Postgres**: `Entitlement.startsAt` (`@default(now())`,
  `schema.prisma:1646`) es el momento de la concesión, y `Entitlement.expiresAt` (`:1648`) el
  final del periodo. `INDEX_INCLUDE` ya carga los entitlements del anuncio pero **solo
  selecciona `expiresAt`** (`search.service.ts:233-238`), y `toDocument` lo usa únicamente para
  colapsarlo a un 0/1 (`:659-663`). **El dato está a un `select` de distancia del índice.**
- Sin techo de N: `grantFeaturedListingTx` (`billing.service.ts:329-378`) solo impide **dos
  destacados activos sobre el mismo anuncio**. No hay límite por categoría ni global.
- Altas y bajas: el alta **reindexa al instante** (`billing.service.ts:261,296`); la baja la hace
  el cron de las 03:00 (`entitlement-expiration.service.ts:30,50-100`), con hasta ~23 h de
  retraso.

**Entorno verificado:** Meilisearch **servidor v1.10** (`docker-compose.yml:39`), cliente
`meilisearch@^0.47.0` (`apps/api/package.json:56`). Esto condiciona el diseño y se usa en §6 y §12.

---

## 2. La aritmética irreducible (hay que decirla antes de diseñar nada)

Hay 4 huecos y N destacados que cumplen los filtros. **La rotación no crea visibilidad: la
reparte.** La cuota de cada anuncio es, inevitablemente:

> **cuota de vitrina ≈ 4 / N del tiempo**

Lo único que el diseño puede elegir es la **granularidad** (cada cuánto cambia el turno) y la
**equidad** (que la cuota sea igual para todos en vez de 100 % para cuatro y 0 % para el resto).
Eso es exactamente lo que hoy falla: el reparto no es 4/N, es todo-o-nada.

Con ventana de 15 min (96 ventanas al día):

| N destacados | Grupos (ciclo) | Duración del ciclo | Vitrina por anuncio y día | Espera máxima del recién llegado |
|---|---|---|---|---|
| ≤ 4 | 1 | — (siempre visibles) | 24 h | 0 |
| 8 | 2 | 30 min | ~12 h | ≤ 30 min |
| 12 | 3 | 45 min | ~8 h | ≤ 45 min |
| 20 | 5 | 1 h 15 | ~4 h 45 | ≤ 1 h 15 |
| 50 | 13 | 3 h 15 | ~1 h 50 | ≤ 3 h 15 |
| 100 | 25 | 6 h 15 | ~58 min | ≤ 6 h 15 |
| 200 | 50 | 12 h 30 | ~29 min | ≤ 12 h 30 |

**Estas cifras son el producto.** Son las que hay que poder decir en voz alta en el diálogo de
compra (§10.1) sin que suenen a truco. Y son honestas: hoy, para 46 de esos 50, la cifra real es
**cero**.

---

## 3. D1 — La unidad de rotación: ventana temporal de 15 minutos

### Las opciones

| | (a) Por petición | **(b) Por ventana temporal** | (c) Híbrido |
|---|---|---|---|
| Rotación | Máxima | Alta y **predecible** | Alta |
| Estabilidad para el usuario | **Mala**: el bloque baila en cada F5 | Buena: fijo dentro de la ventana | Media |
| Cacheable | **No** | **Sí, por construcción** (la clave lleva la ventana) | Parcial |
| Reproducible / depurable | No (¿por qué salió éste?) | **Sí**: dados los filtros y la hora, la salida es única | Regular |
| Estado necesario | Ninguno (si es aleatorio) | **Ninguno**: el cursor es el reloj | Alguno |
| SSR / SEO | Contenido distinto en cada render | Estable por franja | — |

### La decisión: **(b), ventana de 15 minutos**

- **15 minutos** porque es más corto que una sesión de navegación típica (el visitante casi
  siempre ve **un** bloque estable de principio a fin) y a la vez suficientemente corto para que
  los ciclos sean humanos: con N=50 todos han salido en 3 h 15, no en día y medio.
- **Alineada al epoch UTC**: `W = floor(unixSeconds / (windowMinutes * 60))`. Sin contador en
  memoria, sin cron, sin fila en base de datos. Dos instancias del backend calculan la misma `W`
  sin hablar entre ellas. **Es el mismo patrón de "estado derivado, no almacenado" que ya usa la
  cuota Pro** (`entitlement.service.ts:170-183`: no hay contador que resetear, se cuenta desde
  `currentPeriodStart`). Coherente con la casa.
- **Configurable por entorno**, no por `Setting`: la ruta de búsqueda **no puede tocar Postgres**
  (invariante de `apps/api/CLAUDE.md`), así que leer un `Setting` por petición está descartado.
  Constante de módulo con override por variable de entorno, igual que `MEILI_INDEX_NAME`
  (`search.service.ts:12`).

**Consecuencia asumida:** un visitante que recargue 20 minutos después verá otros cuatro
anuncios. Es el comportamiento normal de cualquier vitrina publicitaria, y va a favor de quien
paga. Lo que **no** cambia entre recargas es la lista real (`hits`), que es lo que el usuario
vino a ver.

---

## 4. D2 — Dónde vive el estado: dos campos en el documento, y nada más

### Las tres opciones, y el 10x

| Opción | Qué implica | Coste | Veredicto |
|---|---|---|---|
| **(1) Campos temporales en el documento** + cursor derivado del reloj | 2 campos nuevos en `ListingDocument`, ya presentes en Postgres; `sortable`/`filterable`; un reindexado | **Bajo.** Cero estado nuevo que mantener, cero invalidación, cero cron | ✅ **elegida** |
| (2) Rotar fuera de Meili (pedir muchos y cortar en memoria) | El controlador pide K≫4 destacados y elige en memoria | Medio: payload grande por petición, y **si N > K la cola nunca rota** — el mismo bug con otro techo | ❌ |
| (3) Estado por anuncio (contador de apariciones) en Redis/Postgres | Escritura por petición o por ventana, expiración, coherencia multi-instancia, backfill | **Alto — el 10x de la auditoría.** Y aporta poco: reparte "por apariciones acumuladas" algo que el round-robin ya reparte por construcción | ❌ (no hace falta) |

### Los dos campos

Se añaden a `ListingDocument`, poblados en `toDocument()` desde **el entitlement vigente** (el
mismo predicado que ya decide `boostScore`):

| Campo | Tipo | De dónde sale | Para qué |
|---|---|---|---|
| `featuredStartsAt` | `number \| null` (unix **segundos**) | `Entitlement.startsAt` del vigente | **El orden estable del anillo de rotación** |
| `featuredExpiresAt` | `number \| null` (unix **segundos**; `null` = sin caducidad) | `Entitlement.expiresAt` del vigente | Que un destacado **caducado no ocupe un turno** durante ~23 h |

Coste de obtenerlos: `INDEX_INCLUDE.entitlements` ya carga la relación filtrada; **basta añadir
`startsAt: true` al `select`** (`search.service.ts:233-238`). Ni una consulta más al indexar.

**Por qué `featuredStartsAt` y no reutilizar `publishedAt` (que ya es ordenable):** cualquier
orden estable serviría para el round-robin, pero éste tiene una propiedad que ningún otro tiene:

> **las altas siempre se añaden al final del anillo.** Un destacado nuevo tiene el `startsAt` más
> grande que existe, así que **entra como último y no reordena a nadie**. El reparto de los que
> ya estaban no se altera. Con `publishedAt` (o con una clave aleatoria), cada alta se inserta en
> medio y **redistribuye los grupos de todos**.

**Por qué NO se llaman `featuredUntil`:** ese nombre **ya está ocupado** en el contrato del
frontend — `ListingSummary.featuredUntil?: string | null` (`apps/web/src/types/index.ts:274`) es
un **ISO string** que solo sirve la vista del propietario. Como `normalizeHit` hace *spread* del
documento entero (`search.controller.ts:264-269`), un campo homónimo **numérico** llegaría a la
misma propiedad con otro tipo y otro significado. Nombres distintos, colisión evitada.

---

## 5. D3 — La mecánica: round-robin por página, con la ventana como cursor

### El algoritmo, en cinco líneas

Todo ocurre **en el controlador**, en la rama que ya existe (`search.controller.ts:161-171`):

1. Se calcula la ventana: `W = floor(now / windowSeconds)`.
2. **Consulta A** — los mismos filtros de siempre + `boostScore = 1` + **vigencia**
   (`featuredExpiresAt` nulo o futuro), ordenados por `featuredStartsAt:asc`, `page: 1`,
   `hitsPerPage: 4`. Devuelve los 4 primeros **y** `totalHits` (= N) y `totalPages` (= el número
   de grupos del ciclo).
3. Si `totalPages ≤ 1` (**N ≤ 4**) → **fin**: no hay nada que rotar, todos salen siempre.
   *Este es el caso mayoritario del sitio, y cuesta exactamente lo que cuesta hoy.*
4. Si no: `p = (W mod totalPages) + 1`. Si `p === 1`, ya está servido por la consulta A.
5. Si `p ≠ 1` → **Consulta B**, idéntica pero con `page: p`. Esos son los 4 del turno.

**Coste máximo: 2 consultas a Meilisearch, y la segunda solo aparece cuando el problema
existe** (N > 4). Donde no hay competencia por la vitrina, no hay coste nuevo.

### Por qué el orden del anillo NO puede ser el `sort` del usuario (D5)

Hoy el bloque usa `sort: dto.sort`. Si la rotación se montara encima de ese orden, la partición
en grupos cambiaría con cada orden distinto **y con cada cambio de precio**, y bajo el orden por
defecto volveríamos exactamente al problema de origen: la partición la decidiría una fecha
inmutable. El anillo tiene que tener **un orden propio y estable**: `featuredStartsAt:asc`.

**Lo que esto cuesta, dicho claramente:** el bloque ya **no** irá ordenado como la lista. Con
`precio: menor a mayor`, la vitrina puede mostrar un coche de 30.000 € encima de una lista que
empieza en 500 €. Es el precio de que la vitrina sea un turno y no un ranking — y es un
argumento más a favor de etiquetar el bloque como publicidad (§10.4). **Lo que no cambia: el
bloque sigue respetando TODOS los filtros** (los doce que la auditoría verificó uno a uno), que
es la parte que afecta a si el anuncio es relevante para lo que el usuario busca.

### El grupo parcial

Con N=50 hay 13 grupos: doce de 4 y uno de 2. En esa ventana el bloque muestra 2 tarjetas.

**Se acepta, y no es una injusticia:** cada anuncio sale exactamente **un grupo por ciclo**, sin
excepción. Lo único que ocurre es que una ventana de cada 13 la vitrina va menos llena — y
precisamente esa es **la ventana de los recién llegados** (que por `startsAt:asc` caen al final),
que salen con menos competencia. Sale a favor de quien acaba de pagar.

*Refinamiento opcional, si el bloque a medias molesta:* tomar los 4 con `offset` circular
(`(W*4) mod N`, envolviendo al principio). Cuesta una consulta extra ocasional y complica el
cálculo. **No se recomienda de entrada.**

### El caso que motivó todo: el anuncio antiguo que se destaca hoy

Con este mecanismo, `publishedAt` **deja de decidir nada** en el bloque. Un anuncio de hace tres
meses que compra un destacado entra en el anillo con `featuredStartsAt = ahora`, al final, y
**sale en su turno como máximo dentro de un ciclo** (≤ 3 h 15 con N=50; ≤ 30 min con N=8). El
caso pasa de «nunca» a «como mucho, unas horas». Es la afirmación que sostiene la nueva frase
del diálogo.

### El caducado ya no ocupa turno

Con `featuredExpiresAt` en el filtro, un destacado que venció a las 10:05 deja de entrar en la
rotación **en la ventana siguiente**, sin esperar al cron de las 03:00. Hoy podría estar hasta
~23 h robando un turno a alguien que sí ha pagado. El cron sigue haciendo su trabajo (revocar y
poner `boostScore` a 0 para el badge); la vitrina simplemente deja de depender de él.

**Residuo consciente:** el **badge** «Destacado» de la tarjeta seguirá saliendo de `boostScore`
y por tanto puede sobrevivir al periodo hasta ~23 h. Es una asimetría deliberada y acotada, y
cae del lado del vendedor (regalo, no perjuicio). Unificarlo exigiría cambiar el criterio del
badge en cuatro superficies; no compensa ahora.

---

## 6. D4 — Deduplicación por vendedor: no, y por qué

**Escenario:** un vendedor con 10 destacados en «Coches». ¿Puede copar el bloque?

Puede coincidir que 4 de sus anuncios caigan en el mismo grupo (si los compró en la misma
sesión, sus `startsAt` son contiguos). Sería **una ventana** de cada ciclo con un solo vendedor.

**Decisión: no se deduplica en la selección.** Razones:

1. **Es equidad por euro.** Ha pagado diez veces; recibe diez turnos. Limitarlo a uno por
   ventana significaría que sus otros nueve destacados **no salen nunca** — es decir, reintroducir
   el problema que este diseño existe para eliminar, y encima cobrándolo.
2. **Meilisearch v1.10 no puede hacerlo en motor.** El parámetro `distinct` por consulta llegó
   después de la v1.10; lo único disponible es `distinctAttribute`, un ajuste **global del
   índice** que afectaría a **toda** la búsqueda del sitio. Descartado sin discusión.
3. **Hacerlo en memoria** obligaría a pedir K≫4 y filtrar, que es la opción (2) del §4 con sus
   mismos defectos.

**Mitigación gratuita si el racimo molesta:** es un efecto de que las compras del mismo vendedor
tienen `startsAt` contiguos. Si algún día se quiere dispersar, la vía barata es un tercer campo
estable (`featuredSeed`, un número aleatorio fijado en la concesión) como orden del anillo — pero
se perdería la propiedad de «las altas no reordenan a nadie» (§4). **No se hace ahora**: es un
problema hipotético hasta que exista un vendedor así.

---

## 7. Los casos de Ernest, resueltos

El conjunto que rota es siempre **el que cumple los filtros actuales**, que es lo natural y lo
que ya hace la 2ª consulta. De ahí salen los cuatro casos sin ninguna regla adicional:

**1 — Una categoría con muchos destacados (50 en «Coches»).**
Anillo de 50, 13 grupos, ciclo de 3 h 15. **Los 50 salen**, cada uno ~1 h 50 al día. Hoy: 4 salen
siempre y 46 nunca. Resuelto.

**2 — Varias categorías / categoría padre.**
`categoryPath` incluye la cadena de ancestros (`search.service.ts:490,630-632`), así que al
buscar «Vehículos» el anillo es **coches + motos + furgonetas juntos**, ordenados por su fecha de
concesión. Rotan juntos, con turnos iguales. Resuelto sin tocar nada: el conjunto candidato ya
era el correcto; lo que faltaba era repartirlo.

**3 — Categorías hermanas.**
Es el caso 2. Antes, la hermana que publicaba más a menudo barría el bloque del padre —y el
motivo (el ritmo de publicación de la otra rama) era invisible e incontrolable para el vendedor.
Ahora el ritmo de publicación **no interviene**: un destacado de motos y uno de coches tienen
exactamente el mismo turno. Resuelto.

**4 — Buscar en TODAS las categorías. ¿Hace falta cuota por categoría? NO.**
El anillo global son todos los destacados vigentes del sitio. Como el round-robin da **un turno
por anuncio**, una categoría con 200 destacados ocupa 200 turnos y una con 2 ocupa 2 — es decir,
**proporción exacta a lo que cada una ha pagado**. Ningún anuncio concreto sale más veces que
otro. La «dominación de las categorías saturadas» que la auditoría describió era un efecto de
ordenar por fecha; con turnos iguales desaparece.

Una **cuota por categoría** haría lo contrario: daría al destacado de nicho *más* vitrina global
por euro que al de coches. Eso es una decisión de negocio legítima (subvencionar el nicho), pero
**no es equidad** y exige estado adicional. **Recomendación: no.** Si algún día se quiere, es una
capa encima, no un requisito de ésta.

*Matiz honesto sobre el bloque global:* con N global grande, el ciclo es largo (N=500 → 31 h) y
cada visitante ve, en la práctica, 4 destacados casi al azar entre 500. Es lo correcto —y la
cuota real, 4/500, es la que es— pero conviene saberlo: **la vitrina global es un escaparate de
muestra, no un canal de tráfico significativo para nadie**. El valor del destacado se concentra
en su categoría, y así debe contarse al venderlo.

---

## 8. La caché y el coste

**Coste añadido por la rotación:**

| Situación | Consultas a Meili para el bloque | Hoy | Con rotación |
|---|---|---|---|
| N ≤ 4 (mayoría del sitio) | 1 | 1 | **1 — sin cambio** |
| N > 4, la ventana cae en el grupo 1 | 1 | 1 | **1** |
| N > 4, resto de ventanas | 2 | 1 | **2** |
| Vista MAPA | — | 1 (**desperdiciada**, el bloque no se pinta) | 0 si se cierra H9 (§10.5) |

Es decir: **una consulta extra a Meilisearch, filtrada, sin facetas** (`onlyBoosted` ya salta el
cálculo de facetas, `search.service.ts:563-565`) y devolviendo 4 documentos, **solo en las
búsquedas donde hay más de 4 destacados compitiendo**.

**Sobre la caché Redis: se diseña, no se construye todavía.** La ventana hace el bloque cacheable
por construcción — clave `featured:{W}:{sha1(filtros+categoría)}`, TTL = lo que reste de ventana,
sin invalidación (la clave caduca sola). Pero **la recomendación es salir sin ella y medir**:
el coste real es ≤1 consulta extra a un motor que ya responde en milisegundos, y añadir una capa
de caché a la ruta más caliente del sitio sin una medición que la justifique es exactamente el
tipo de complejidad que este diseño quiere evitar. La clave queda especificada para el día en que
la medición la pida.

*Nota de coherencia:* si algún día se cachea, el corte debe hacerse **antes** de
`enrichWithSellerRating` (`search.controller.ts:277-291`), porque las medias de valoración
cambian por su cuenta y no deben congelarse 15 minutos.

---

## 9. Lo que este diseño CUESTA (los tres precios, dichos por delante)

1. **El bloque ya no sigue el orden pedido** (§5, D5). A cambio de que el turno exista.
2. **El bloque cambia al cruzar una ventana.** Un usuario que refresque 20 min después ve otros
   cuatro. A cambio de que todos salgan.
3. **Una ventana de cada ciclo la vitrina va a medias** (grupo parcial, §5). A cambio de no
   añadir una consulta de envoltura.

Ninguno de los tres afecta a la **lista real** (`hits`), ni al conteo, ni a los filtros, ni a la
paginación. La Política C queda intacta.

---

## 10. Las correcciones de honestidad

### 10.1 La frase del diálogo de compra — **el corazón del principio rector**

**Hoy** (`PromocionarDialog.tsx:416-418`):

> «Tu anuncio aparece resaltado y en el bloque de promocionados durante varios días.»

Es una promesa **incondicional** de algo que hoy es falso para la mayoría. **Con la rotación se
vuelve casi cierta** — pero «aparece en el bloque» sigue sugiriendo permanencia, y lo que se
entrega es un **turno**. Redacción propuesta:

> **«Tu anuncio lleva la etiqueta «Destacado» en todos los resultados y entra en el turno del
> bloque «Promocionados» de su categoría: va alternándose con los demás destacados mientras dure
> el periodo.»**

Dos mitades, y **cada una es literalmente verdad**: el badge es permanente (`ListingCard.tsx:44-46`);
el bloque es rotatorio. Nada de «siempre», nada de «el primero».

**Extensión recomendada (ráfaga posterior, §11):** enseñar la cifra real en el momento de la
compra, que es lo que convierte la honestidad en confianza:

> «Ahora mismo hay **12** anuncios destacados en Coches: tu anuncio saldría en el bloque unas
> **8 h al día**.»

Necesita un endpoint que cuente destacados vigentes por categoría —dato que ya existe en
Postgres— y la aritmética del §2. **No entra en la primera ráfaga**, pero es la pieza que hace
que el vendedor compre sabiendo qué compra.

*Los toasts de éxito* («Anuncio destacado 7 días con tu cuota Pro.», `PromocionarDialog.tsx:265,301`)
**no prometen el bloque y no hay que tocarlos.**

### 10.2 «Destacados primero» en portada y blog

**Hoy:** la opción existe en los dos editores (`ListingsHomeBlockEditor.tsx:30`,
`ListingsBlockEditor.tsx:25`), se traduce a `sortDate:desc`
(`lib/home-blocks/resolve-listings.ts:18`, `lib/blocks/resolve-listings.ts:20`) y **no destaca
nada** desde la Política C. Los dos ficheros lo justifican con un comentario que afirma **en
presente** que `boostScore:desc` sigue siendo la primera ranking rule. **Es falso**
(`search.service.ts:182-200`).

**Decisión: renombrar la etiqueta a lo que la opción hace, y corregir los dos comentarios.**

- Etiqueta: `Destacados primero` → **«Recientes o reimpulsados»**.
- Comentario nuevo, en ambos ficheros: que `sortDate = max(publishedAt, bumpedAt)`, que
  **`boostScore` salió de `rankingRules` en la Política C (RÁFAGA 1)** y que por tanto este orden
  **no** privilegia a los destacados.
- **El valor almacenado (`'featured'`) NO se toca.** Está persistido en el JSON de los bloques ya
  publicados; renombrarlo obligaría a migrar contenido para no ganar nada. Se cambia la etiqueta
  que ve el admin, no el dato.

**Alternativa deliberadamente aplazada:** hacer que esa opción **destaque de verdad**, reusando
la rotación (un bloque de portada «Promocionados» que rote entre los destacados de una
categoría). Es atractiva —añade inventario de vitrina, es decir, valor al producto que se
vende— pero implica exponer `onlyBoosted` en la API pública y decidir cómo convive el ciclo con
el `revalidate: 180` de esos bloques. **Ráfaga aparte** (§11). Mientras tanto, la etiqueta no
miente.

### 10.3 El badge «Destacado» en el mapa

**Hoy:** `MapCards.tsx` no pinta el badge — `boostScore` no aparece en el fichero. En vista mapa
un destacado es indistinguible de cualquier otro anuncio, y hay categorías cuya vista por defecto
es el mapa. **Es exactamente el hueco que ya tuvo el indicador de vídeo** en estas dos mismas
tarjetas (ver la cabecera del propio fichero, que lo cuenta).

**Diseño, siguiendo el precedente de `VideoIndicator` al pie de la letra:**

- Extraer el badge de `ListingCard.tsx:44-46` a un componente compartido (`FeaturedBadge`), con
  **variante compacta** — igual que `VideoIndicator` tiene `compact`.
- Pintarlo en las **dos** tarjetas del mapa, dentro del mismo `<span className="relative">` de la
  miniatura donde ya vive el indicador de vídeo:
  - `FloatingCard` — miniatura de 56 px (`MapCards.tsx:102-115`): **variante compacta**
    obligatoria; en 56 px no cabe la píldora con la palabra completa, exactamente el mismo
    razonamiento que ya está escrito ahí para el vídeo.
  - `SelectedListingPanel` — miniatura de 130×100 (`MapCards.tsx:157-169`): badge completo.
- **Criterio: `boostScore === 1`**, el mismo que las otras tres superficies. Un solo signo, un
  solo sitio donde cambiarlo.
- `ListingCardWide.tsx:47-49` pasa a usar el componente compartido también, para que no queden
  tres copias del mismo badge.

Esta corrección **es independiente de la rotación** y puede ir en cualquier momento.

### 10.4 Nota adyacente, fuera de alcance: la etiqueta del bloque (P2B)

La auditoría dejó abierta la deuda de transparencia: nada dice que «Promocionados» es publicidad
de pago. **La rotación la hace más necesaria**, porque a partir de ahora el bloque contendrá
anuncios que no siguen el orden pedido (§9.1) y el usuario merece saber por qué.
Micro-copia suficiente, junto al título del bloque: *«Anuncios promocionados: sus autores han
pagado por aparecer aquí»*. **No se incluye en el plan** — es decisión de Ernest si entra; se
deja escrito para que no se pierda.

### 10.5 Fleco barato que la rotación deja a mano (H9)

En vista MAPA el bloque no se pinta pero la 2ª consulta **se lanza igual** (el mapa fuerza
`page = 1`: `busqueda/page.tsx:118`, `CategoryListingPage.tsx:243`). Con la rotación esa consulta
puede ser **dos**. Cerrarlo es un parámetro que diga que esta petición no va a pintar el bloque.
Se recomienda incluirlo en la ráfaga de rotación: es donde menos cuesta.

---

## 11. El plan — cuatro ráfagas, en este orden

| Ráfaga | Qué | Por qué en este orden | Tamaño |
|---|---|---|---|
| **R1 — El dato en el índice** | `featuredStartsAt` + `featuredExpiresAt` en `toDocument`; `startsAt` al `select` de `INDEX_INCLUDE`; `sortableAttributes`/`filterableAttributes`; `pagination.maxTotalHits`; **`pnpm reindex`** | **Sin comportamiento visible.** Deja el índice listo y separa el riesgo de datos del riesgo de lógica. La rotación **no puede** activarse antes del reindexado (§12.2) | S |
| **R2 — La rotación** | Ventana, cursor, round-robin de 2 consultas, filtro de vigencia, saltarse el bloque en vista mapa. Tests | Es el producto. Debe ir **después** de R1 y **antes** de R3 | M |
| **R3 — La honestidad** | La frase del diálogo (§10.1) + «Recientes o reimpulsados» y los dos comentarios falsos (§10.2) | La frase **no puede entrar antes que R2**: prometería un turno que aún no existe. «Destacados primero» y los comentarios pueden ir cuando sea | S |
| **R3-bis — El badge del mapa** | `FeaturedBadge` compartido + las dos tarjetas del mapa (§10.3) | **Independiente de todo.** Puede ir en cualquier momento, incluso primero | S |
| **R4 — Opcional, según medición y ganas** | La cifra real en el diálogo («hay 12 destacados, ~8 h/día»); la caché Redis si la latencia la pide; «Destacados» de verdad en portada/blog | Nada de esto bloquea a nadie | M |

---

## 12. Barreras que la implementación debe cumplir

Cada una es verificable y cada una corresponde a algo comprobado en el código:

1. **`pagination.maxTotalHits` es 1000 por defecto y hoy no se fija** (`updateSettings` en
   `search.service.ts:347-356` no lo incluye). Con `hitsPerPage: 4` eso **corta el anillo en 1000
   candidatos**: el destacado nº 1001 no rotaría **nunca** y `totalHits` mentiría. Hay que fijarlo
   explícitamente por encima del N global plausible, o documentar el techo. **Es la trampa más
   fácil de pasar por alto de todo el diseño.**
2. **Orden de despliegue.** El filtro de vigencia sobre `featuredExpiresAt` **excluye los
   documentos que no tengan el campo**, así que activarlo antes del reindexado deja el bloque
   vacío en todo el sitio. R1 (campos + reindex) **debe** completarse antes de R2. Y `toDocument`
   debe escribir **siempre** los dos campos (con `null` cuando no hay destacado), nunca omitirlos.
3. **Los campos salen del entitlement VIGENTE**, con el mismo predicado que ya usa `boostScore`
   (`expiresAt == null || expiresAt > now`, `search.service.ts:659-663`). Un anuncio puede
   arrastrar entitlements viejos no revocados; coger el `startsAt` del equivocado desordenaría el
   anillo en silencio. `expiresAt: null` (destacado permanente, previsto en el esquema) debe
   sobrevivir al filtro: `featuredExpiresAt IS NULL OR featuredExpiresAt > now`.
4. **`SearchService.search()` sigue siendo puro.** La ventana, el cursor y la elección de página
   viven en **el controlador**. `search()` lo llaman también las alertas (`alerts.service.ts:55,128`,
   `alert-matching.service.ts:64`, dentro de un worker): un resultado que dependa del reloj
   rompería el emparejamiento de alertas. Lo que reciba del reloj, que lo reciba como parámetro
   explícito.
5. **La ventana se deriva del reloj alineado al epoch** (`floor(now / windowSeconds)`), nunca de
   un contador en memoria ni de una fila. Dos instancias deben coincidir sin coordinarse.
6. **Nada de `Setting` en la ruta caliente.** La ventana y el tamaño del bloque son constantes
   con override por entorno. La búsqueda no toca Postgres (`apps/api/CLAUDE.md`).
7. **`totalHits` de la consulta del bloque no sale a la respuesta.** El conteo público sigue
   viniendo solo de la consulta principal (`search.controller.ts:236`). Ahora hay dos `totalHits`
   en el mismo método: no confundirlos.
8. **La unión de impresiones no cambia**: `hits ∪ featured` deduplicado por id
   (`search.controller.ts:197-204`). La rotación cambia **quién** entra, no cómo se cuenta — y de
   paso reparte las «veces listado», que era el efecto amplificador que señaló la auditoría.
9. **El e2e existente debe seguir verde sin tocarlo**: `rf8-meilisearch.e2e-spec.ts:195` monta un
   escenario con **un** destacado → `totalPages = 1` → no hay rotación → mismo resultado. Si ese
   test se pone rojo, la implementación se ha desviado del diseño.
10. **Tests nuevos que este diseño exige** (con reloj inyectable, nunca `Date.now()` suelto):
    dado `W`, la salida es determinista; **un ciclo completo cubre a todos los destacados sin
    repetir**; un destacado concedido a mitad de ciclo sale como muy tarde en el ciclo siguiente;
    un destacado caducado **no** ocupa turno aunque el cron no haya pasado; con N ≤ 4 no se lanza
    la segunda consulta.
11. **El badge del mapa comparte componente**, no copia de marcado: un solo sitio donde cambie el
    criterio (§10.3).
12. **Meilisearch v1.10**: no hay `distinct` por consulta (§6) y `IS NULL` sí está disponible
    (desde v1.2). Si algún día se sube de versión, la barrera 3 se puede simplificar; la 6, no.

---

## 13. Lo que este diseño NO hace (y por qué)

- **No pone techo al número de destacados por categoría.** Con turnos iguales, vender más
  destacados diluye la cuota de todos (4/N) pero **no excluye a nadie**, que era el daño. Un techo
  sería una decisión comercial distinta —limitar el ingreso para subir la calidad del producto—
  y merece su propia conversación, con la aritmética del §2 delante.
- **No guarda contadores de apariciones por anuncio.** El round-robin ya garantiza el reparto
  igual por construcción; un contador serviría para *auditar* el reparto, no para producirlo, y
  es el 10x de coste que la auditoría señaló.
- **No cambia la lista, ni el conteo, ni los filtros, ni la paginación, ni las ranking rules.** La
  Política C se queda exactamente como está: resolvió el orden, y este diseño se limita a añadir
  lo que le faltaba, que era el reparto.
- **No toca los patrocinados** (`SponsoredAd`): entidad distinta, consulta distinta, bloque
  distinto — el deslinde de la auditoría sigue vigente.
- **No resuelve la transparencia P2B** (§10.4): queda escrito, esperando decisión.
