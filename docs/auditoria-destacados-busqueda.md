# Auditoría — los DESTACADOS en la búsqueda: ¿se listan justa y correctamente?

**Fecha:** 2026-08-25
**Alcance:** el bloque «Promocionados» (`featured`) de `GET /search` y sus dos superficies
públicas (`/busqueda` y `/[categoria]`), más los sitios donde la palabra «destacado» aparece
sin que haya destacados detrás (portada y blog).
**Naturaleza:** diagnóstico. **Cero código escrito.** No se diseña la solución de la equidad —
eso es una ráfaga posterior; aquí se acota el problema para que esa ráfaga tenga el terreno
claro.
**Método:** todo verificado leyendo el código actual. Donde `docs/estado-tecnico.md` afirma
algo, se ha comprobado contra el fichero; donde el comentario del código afirma algo, también
(y hay dos comentarios que hoy son falsos, §5.4).

---

## 0. Veredicto en cinco líneas

1. La **Política de ordenación C** (RÁFAGA 1) está **implementada y vigente**: `boostScore` no
   está en las ranking rules, la lista respeta el orden pedido, el bloque son 4 como máximo y
   solo en página 1, hereda **todos** los filtros, y no contamina `totalHits`. Confirmado línea
   a línea. Ese frente está cerrado.
2. La Política C resolvió el **ORDEN**. **No resolvió el REPARTO.** Es exactamente la hipótesis
   del encargo, y se confirma.
3. Qué 4 destacados salen de N lo decide **la misma ordenación que la lista, truncada a 4**.
   No hay rotación, ni azar, ni memoria, ni tope por vendedor, ni tope por categoría. En la
   superficie más transitada —una página de categoría sin tocar el selector de orden— el
   criterio es `publishedAt:desc`, y `publishedAt` **no cambia nunca** en la vida de un anuncio.
   El bloque de esa categoría está, literalmente, **congelado**.
4. Consecuencia directa y comprobable: **quien destaca un anuncio antiguo en una categoría con
   4 destacados más nuevos no entra nunca en el bloque**, ni un solo día de los que ha pagado.
   Y el diálogo de compra le promete, sin condición ninguna, que sí entrará
   (`PromocionarDialog.tsx:416-418`).
5. La deuda de transparencia P2B **sigue abierta** tal cual se inventarió: nada le dice al
   comprador que «Promocionados» es publicidad de pago.

---

## 1. El deslinde: DESTACADOS vs PATROCINADOS

Son **dos productos, dos entidades, dos consultas y dos bloques distintos**. Conviene fijarlo
antes de nada porque comparten el mismo controlador y el mismo `page === 1`, y eso invita a
confundirlos.

| | **DESTACADO** (`featured`) | **PATROCINADO** (`SponsoredAd`) |
|---|---|---|
| Qué es | Un **anuncio real** del marketplace con un `Entitlement` `FEATURED_LISTING` vigente | Una **pieza publicitaria** que no es un anuncio: título, texto, imagen y URL externa |
| Dónde vive el dato | Postgres → indexado en Meilisearch como `boostScore: 0|1` (`search.service.ts:659-663`) | Solo Postgres, tabla `SponsoredAd`; cacheado en Redis 5 min |
| Cómo se resuelve | 2ª consulta a **Meilisearch** con los mismos filtros + `boostScore = 1` (`search.controller.ts:162-171`) | Consulta a **Postgres** vía `SponsoredAdsService.resolveForSearch` (`search.controller.ts:220-228`) |
| Cuántos | Hasta **4** (`FEATURED_BLOCK_SIZE`, `search.controller.ts:17`) | **1** |
| Dónde se pinta | Bloque propio `FeaturedBlock`, **encima** de la lista | **Intercalado dentro de `hits`**, posición fija 3 (`SPONSORED_AD_POSITION`) |
| Condición | Página 1 | Página 1 **y** con categoría |
| Quién lo compra | El vendedor, desde su anuncio | El anunciante, lo configura un admin |
| Cómo se marca | Badge «Destacado» en la card (`ListingCard.tsx:44-46`) | `SponsoredCard`, componente distinto |

**Están adyacentes, no entrelazados.** Comparten el controlador y la convención «solo página 1»,
y el comentario del código llama al bloque de destacados «mismo molde que el patrocinado» — pero
ese «molde» es una analogía de diseño, no código compartido: no comparten consulta, ni fuente de
datos, ni componente, ni criterio de selección, ni entidad. Una decisión sobre la equidad de los
destacados no toca el patrocinado, y al revés.

**Por tanto: los patrocinados quedan FUERA de esta auditoría.** Se deja constancia de dos cosas
que sí conviene saber, sin desarrollarlas aquí:

- El patrocinado **no respeta los filtros del usuario**: se resuelve solo por categoría (y sus
  ancestros), y se inyecta en `hits` esté el usuario filtrando por precio, provincia o lo que
  sea. Es coherente con lo que es —un banner—, pero es una diferencia de comportamiento real
  frente al bloque de destacados, que sí los respeta todos.
- El patrocinado **sí tiene un criterio de reparto explícito** cuando hay varios candidatos:
  `order` ascendente que fija el admin, y a igualdad el más reciente (`sponsored-ads.service.ts`,
  `findActiveAd`). Es decir: para la publicidad que gestiona un admin hay una regla de prioridad
  deliberada; para la que compran los vendedores, no la hay. Esa asimetría es, en sí misma, el
  resumen del hallazgo central.

---

## 2. Lo que está RESUELTO (Política C) — confirmado contra el código

Todo lo de esta sección se ha verificado hoy, no se ha dado por bueno desde el documento de
estado.

### 2.1 Cuántos y dónde

- **Tamaño: 4.** `const FEATURED_BLOCK_SIZE = 4` — `search.controller.ts:17`. Es una constante de
  módulo: **no es configurable por el admin**, cambiarla exige despliegue (hallazgo menor, H10).
- **Solo página 1.** `if ((dto.page ?? 1) === 1)` — `search.controller.ts:162`. En la página 2 en
  adelante `featured` es `[]`, así que el bloque desaparece. Confirmado.
- **Dónde se pinta:** `FeaturedBlock` (`components/busqueda/FeaturedBlock.tsx`), una sección con
  icono ✨ + «Promocionados» y una rejilla de hasta 4 `ListingCard`, colocada **encima** de la
  lista. Se usa exactamente en **dos** sitios:
  - `/busqueda` — `app/(public)/busqueda/page.tsx:362`
  - `/[categoria]` (las cuatro rutas de nivel) — `components/categorias/CategoryListingPage.tsx:532`
  - **La portada NO lo usa.** Confirmado: `FeaturedBlock` solo se importa en esos dos ficheros.
    Es coherente con lo que dice la RÁFAGA 1 («no se añadió a la portada»). Pero la portada sí
    ofrece un orden llamado «Destacados primero» que hoy no destaca nada — ver §5.4.
- **Se repiten en `hits`.** El bloque no resta nada de la lista: el mismo anuncio sale arriba en
  la vitrina y abajo en su posición natural. Es deliberado y está comentado
  (`search.controller.ts:155-160`). Confirmado.

### 2.2 ¿Contamina el conteo? No

`totalHits: result.totalHits ?? 0` sale **solo de la consulta principal**
(`search.controller.ts:236`). Ni el bloque ni el patrocinado lo tocan. El estado vacío («Sin
resultados») se decide sobre `totalHits`, no sobre `hits.length`, en las dos páginas
(`busqueda/page.tsx:325,355`, `CategoryListingPage.tsx:516`). Confirmado, y bien resuelto.

Corolario útil: como `featured` es un **subconjunto estricto** del conjunto que cuenta
`totalHits` (mismos filtros + uno más), es imposible que haya bloque con `totalHits === 0`. La
condición `totalHits > 0` que envuelve al bloque en `/busqueda` no puede ocultarlo nunca.

### 2.3 ¿Hereda TODOS los filtros? Sí — verificado uno a uno

La 2ª consulta se lanza con `{ ...baseParams, sort: dto.sort, onlyBoosted: true, page: 1,
hitsPerPage: 4 }`. `baseParams` (`search.controller.ts:113-144`) contiene:

| Filtro | En `baseParams` | Llega al bloque |
|---|---|---|
| `q` (texto libre) | sí | ✅ |
| `categorySlug` | sí | ✅ |
| `type`, `condition` | sí | ✅ |
| `priceType`, `priceUnit` | sí | ✅ |
| `minPrice`, `maxPrice` | sí | ✅ |
| `province`, `city` | sí | ✅ |
| `conVideo` → `onlyWithVideo` | sí | ✅ |
| atributos de categoría (igualdad) | sí | ✅ |
| rangos de atributo (`km_min`/`km_max`) | sí | ✅ |
| etiquetas (`tags`) | sí | ✅ |
| geo (`lat`/`lng`/`radius`) | sí | ✅ |

**No falta ninguno.** Lo único que `baseParams` lleva y el bloque ignora es
`attributeFacetNames`, y su omisión es intencionada y correcta: `search.service.ts:563-565`
salta el cálculo de facetas cuando `onlyBoosted` está puesto, porque las facetas del bloque no
se le sirven a nadie. Es un ahorro, no una pérdida.

**Conclusión: el bloque nunca muestra un destacado que no cumpla lo que el usuario ha pedido.**
Este era uno de los riesgos que el encargo pedía descartar, y queda descartado.

### 2.4 ¿El orden ya no particiona? Correcto

`RANKING_RULES` (`search.service.ts:190-200`) es
`[words, typo, proximity, attribute, sort, exactness, sortDate:desc]`. **`boostScore:desc` no
está.** El único uso de `boostScore` en consulta es como filtro: `if (params.onlyBoosted)
filters.push('boostScore = 1')` (`search.service.ts:500`), y para eso figura en
`CORE_FILTERABLE_ATTRIBUTES` (`search.service.ts:117-119`). La regresión de «un destacado de
333 € por delante de uno de 7 € en precio ascendente» **no puede volver** por esta vía.

El e2e lo fija: `rf8-meilisearch.e2e-spec.ts:195` — «destacado entra al bloque `featured` pero NO
reordena la lista principal (política C)», y comprueba las dos mitades (entra en `featured`, no
gana en `hits`).

### 2.5 ¿El bloque respeta el orden pedido? Sí — y ahí empieza el problema

`sort: dto.sort` — el bloque usa **exactamente la misma ordenación** que la lista. Con
`?sort=price:asc` el bloque muestra los 4 destacados más baratos; con `price:desc`, los 4 más
caros; con proximidad activa y sin sort, los 4 más cercanos (`search.service.ts:547-553`).

Esto es **correcto como coherencia** (el bloque no contradice lo que el usuario pidió) y es
**precisamente el mecanismo que produce la inequidad**: «el mismo orden, truncado a 4» es una
regla de presentación, no una regla de reparto. Se desarrolla en §3.

---

## 3. Lo que NO está resuelto: LA EQUIDAD — hallazgo central

### 3.1 Qué decide hoy los 4, exactamente

```
featured = Meili.search(
    q,
    filter: [ …los mismos filtros de la lista…, boostScore = 1 ],
    sort:   el mismo sort de la lista (o ninguno),
    page: 1, hitsPerPage: 4
)
```

Es decir: **se ordena a todos los destacados que cumplen los filtros por el mismo criterio que la
lista y se cortan los 4 primeros.** No interviene nada más. En concreto **no** interviene:

- ningún factor aleatorio (no hay `Math.random` ni semilla en ninguna parte del camino);
- ninguna noción de tiempo, turno o cuota (no se guarda quién salió la última vez — de hecho la
  consulta no tiene estado ninguno: mismas entradas ⇒ misma salida, siempre);
- ninguna diversidad por vendedor (nada agrupa ni deduplica por `sellerId`);
- ninguna diversidad por categoría (nada mira `categorySlug` al elegir los 4);
- ningún dato del propio destacado: **ni cuánto se pagó, ni cuándo se compró, ni cuánto le
  queda, ni cuántas veces ya se ha mostrado**. `boostScore` es un binario 0/1 y en el documento
  de Meilisearch no hay ningún otro campo del destacado — ni `featuredAt`, ni `featuredUntil`, ni
  contador de impresiones del bloque. **Hoy el índice no tiene con qué desempatar aunque
  quisiera.** Este es el dato más importante para la ráfaga de diseño.

### 3.2 No hay rotación. Y en la superficie principal, ni siquiera hay variación

Al no haber estado, «rotar» solo puede ocurrir si **cambia la clave de ordenación**. Repasando
las cuatro claves posibles:

| Contexto | Clave que ordena el bloque | ¿Cambia con el tiempo? |
|---|---|---|
| `/[categoria]` sin tocar el orden (**el caso por defecto**) | `publishedAt:desc` (`CategoryListingPage.tsx:187-190` fija el default) | **NO. `publishedAt` es inmutable**: el bump escribe `bumpedAt`, y el renovar conserva `publishedAt` (`search.service.ts:651-655`) |
| `/busqueda` sin orden ni texto | `sortDate:desc` (último desempate de las ranking rules) | Sí — `sortDate = max(publishedAt, bumpedAt)`, así que **un bump te mueve** |
| Cualquiera con `sort=price:*` | precio | Solo si alguien edita un precio |
| Con `?q=…` o con proximidad | relevancia / distancia | Sí, pero **varía por consulta, no por vendedor**: para *una misma búsqueda* sigue siendo fija |

De aquí salen dos hechos duros:

> **(a) En una página de categoría con el orden por defecto, el bloque «Promocionados» es una
> foto fija.** Los mismos 4 anuncios, a todas horas, para todos los visitantes, hasta que uno de
> los 4 caduque o alguien destaque un anuncio *publicado más recientemente* que ellos.

> **(b) Comprar un destacado no te acerca al bloque.** Lo que te mete en él es haber publicado
> tarde. Un anuncio publicado hace tres meses que compra un destacado hoy sigue teniendo el
> `publishedAt` de hace tres meses: entra en el conjunto candidato, se ordena por su fecha
> antigua, y **cae por debajo del corte de 4 desde el primer segundo del periodo que ha pagado**.

Y una tercera, de coherencia interna:

> **(c) La misma búsqueda reparte distinto según por qué puerta se entre.** En `/vehiculos/coches`
> el bloque lo decide `publishedAt`; en `/busqueda?category=coches` lo decide `sortDate`. El bump
> te ayuda a entrar en el bloque en una superficie y no hace nada en la otra. Nadie decidió eso:
> sale de que una página fija un default y la otra no.

### 3.3 Nada impide que **un solo vendedor** ocupe el bloque entero

No hay ninguna deduplicación por `sellerId` en la selección (ni en la consulta, ni en el
controlador, ni en el componente). Un vendedor profesional con 4 anuncios destacados y recientes
en la misma categoría **se lleva las 4 casillas** y deja fuera a todos los demás que han pagado
lo mismo. Es un caso de una línea de código de distancia respecto al hallazgo central, pero es
independiente: se puede sufrir aunque el criterio de reparto fuera otro.

Nótese el contraste con las cuotas Pro, que sí están cuidadas al detalle (§ `entitlement.service.ts`,
con lock `FOR UPDATE` para que nadie gaste dos destacados con cupo para uno): **se protege con
esmero cuántos destacados se pueden comprar, y no se protege nada de lo que pasa después.**

### 3.4 Cuántos compiten por los 4 huecos: no hay techo

Para dimensionar el problema hay que saber cuántos destacados pueden coexistir. Verificado en
`billing.service.ts:329-378` (`grantFeaturedListingTx`, **el único sitio que crea un
`FEATURED_LISTING`**, con cuatro vías: Redsys, créditos, cupón y cuota Pro):

- La única restricción es **un destacado activo por anuncio** («Listing already has an active
  featured period», `billing.service.ts:347-358`).
- **No hay límite por categoría.** No hay límite global. No hay límite por vendedor más allá de
  su capacidad de pagar (la cuota Pro limita los *gratis*, no los comprados).
- La duración la fija el canal (`durationDays`: ajuste fijo para Pro, `Price.durationDays` para
  Redsys/créditos, el valor del cupón para cupones).

**Es decir: N no tiene techo.** Si mañana 50 vendedores destacan en «Coches», habrá 50 anuncios
compitiendo por 4 huecos y **46 no verán el bloque ni una vez**, sin que nada en el sistema lo
detecte, lo avise, lo limite ni lo reparta. La venta puede crecer sin límite; la vitrina que se
vende, no.

Sobre la estabilidad del conjunto: los destacados **entran al índice al instante** (el `grant`
encola el reindexado justo después de confirmar, `billing.service.ts:261,296`) y **salen con hasta
~23 h de retraso** (el cron de las 03:00 revoca y reencola, `entitlement-expiration.service.ts:30,50-100`;
la decisión está documentada y aceptada). Para la equidad esto significa que el conjunto candidato
es **estable durante días** —la duración de los periodos—, que es justo lo que hace que una foto
fija se quede fija mucho tiempo.

### 3.5 Los casos de Ernest, uno a uno

**Caso 1 — muchos destacados en UNA categoría (50 en «Coches»).**
Salen los **4 de `publishedAt` más alto** que cumplan los filtros. Siempre los mismos. Los otros
46 no aparecen nunca en el bloque de esa categoría mientras esos 4 sigan vigentes. **No rotan.**
Los 46 conservan el badge «Destacado» en su posición natural de la lista, que es lo único que
reciben por su dinero. *Matiz honesto:* si el visitante filtra (precio, provincia, atributo) o
busca texto, el subconjunto candidato cambia y pueden entrar otros — pero eso es azar de la
consulta del comprador, no un reparto.

**Caso 2 — destacados en VARIAS categorías a la vez (búsqueda sin categoría).**
El bloque **mezcla categorías sin ningún criterio de mezcla**: es el top-4 global por `sortDate`.
Un destacado de un nicho tranquilo compite en igualdad de condiciones aparente… pero la
competencia es por **fecha**, y las categorías con más volumen publican más a menudo, así que
copan el bloque global casi por construcción. Un destacado de una categoría con 3 anuncios al mes
prácticamente **nunca** aparecerá en `/busqueda` sin filtros, por bueno que sea su anuncio.

**Caso 3 — categorías HERMANAS bajo un padre (`/vehiculos` = coches + motos + furgonetas).**
`categoryPath` contiene la cadena entera de ancestros (`search.service.ts:490,630-632`), así que
al navegar el padre **los destacados de todas las hijas caen en el mismo saco y compiten por los
mismos 4 huecos**, ordenados por fecha. La hermana con más rotación de publicaciones barre el
bloque del padre; la hermana tranquila no sale. Nada reserva cupo por rama, ni intenta
representarlas. Un vendedor de motos que paga por destacar puede quedarse fuera del bloque de
«Vehículos» **por culpa del ritmo de publicación de coches**, que es algo sobre lo que no tiene
el menor control ni conocimiento.

**Caso 4 — buscar en TODAS las categorías.**
Es el caso 2 llevado al extremo: los 4 destacados globales más recientes. **Las categorías
saturadas dominan el bloque global de forma estructural.** Y la asimetría es doble: el destacado
de nicho gana poco en el bloque global (no entra) y gana poco en el suyo si allí también hay 4
más nuevos.

**Caso 5 — el que no estaba en la lista y es el más grave: destacar un anuncio ANTIGUO.**
Es el caso (b) de §3.2. **Comprar el producto no cambia ninguna de las variables que deciden el
reparto.** El único momento en que un destacado tiene garantizada la entrada al bloque es cuando
se compra sobre un anuncio recién publicado *y* la categoría tiene menos de 4 destacados. Fuera
de ahí, la entrada es un accidente de calendario.

### 3.6 El riesgo de negocio, dicho sin rodeos

El destacado **es un producto de pago** por cuatro vías (tarjeta vía Redsys, créditos, cupón y
cuota Pro). El diálogo de compra dice, palabra por palabra
(`PromocionarDialog.tsx:416-418`):

> «Tu anuncio aparece resaltado y **en el bloque de promocionados** durante varios días.»

Es una **afirmación incondicional de un hecho que el sistema no garantiza**. En una categoría con
más de 4 destacados vigentes y más recientes, esa frase es **falsa para el comprador desde el
minuto uno**, durante todos los días que ha pagado. No hay aviso previo («ahora mismo hay 12
destacados en Coches»), no hay aviso posterior, y el vendedor **no tiene forma de saberlo**: en
su panel ve su destacado «activo» y su badge, y no ve que su vitrina no existe.

Consecuencias razonables, en orden de probabilidad:

1. **Reclamaciones y devoluciones individuales** en cuanto un vendedor compare lo que compró con
   lo que ve en la categoría. Es comprobable por cualquiera en diez segundos, desde el navegador,
   sin acceso al sistema.
2. **Riesgo de consumo / publicidad engañosa.** Se cobra por una prestación descrita en términos
   absolutos que no se presta. Con las estadísticas que la plataforma ya guarda —«veces listado»
   por anuncio— el propio sistema tiene la prueba de cuántas impresiones recibió realmente.
3. **Erosión del producto**: los vendedores profesionales, que son quienes más lo comprarían, son
   también los primeros en detectar que no sirve, y dejan de comprarlo.

Un matiz para no inflar: la mitad de la promesa **sí se cumple siempre** — el badge «Destacado»
en la card (`ListingCard.tsx:44-46`, `ListingCardWide.tsx:47-49`) aparece en toda la lista para
cualquier destacado vigente. Lo que no se cumple es «y en el bloque de promocionados».

Y un efecto lateral que conviene tener presente porque toca a las estadísticas recién
construidas: como el bloque suma **impresión** a quien entra en él (`search.controller.ts:197-215`,
unión deduplicada de `hits` ∪ `featured`), los 4 ganadores acumulan «veces listado» que los demás
destacados no acumulan. La métrica es correcta —refleja lo que se sirvió—, pero **amplifica la
desigualdad en los paneles**: los que ya salían salen con mejores números.

---

## 4. Los tipos de lista y las vistas

«Tipos de lista» se interpreta como las **3 vistas configurables por categoría** (RÁFAGA 2):
`LISTA`, `AMPLIADA` y `MAPA`. Verificado el comportamiento del bloque en cada una.

### 4.1 MAPA — el bloque no existe, pero la consulta se paga igual

En las dos superficies, el bloque queda **fuera** de la rama de mapa:

- `/busqueda`: `FeaturedBlock` está dentro del bloque `!searchError && totalHits > 0 && !isMapView`
  (`busqueda/page.tsx:355-362`); la rama de mapa (`:341-349`) monta solo `MapViewClient`.
- `/[categoria]`: `effectiveView === 'MAPA'` monta `MapViewClient` **sin** `FeaturedBlock`
  (`CategoryListingPage.tsx:518-532`).

Dos consecuencias, una de criterio y otra de coste:

1. **De criterio:** en la vista de mapa un destacado **no tiene absolutamente ninguna
   distinción**. No hay bloque, y las tarjetas del mapa (`MapCards.tsx`) **tampoco pintan el badge
   «Destacado»** — verificado: `boostScore` no aparece en ese fichero. Su marcador es idéntico al
   de cualquier otro. Para una categoría cuya vista por defecto sea `MAPA` (es configurable por
   categoría), **el producto que el vendedor ha pagado no se manifiesta de ninguna forma** en la
   pantalla que la mayoría de sus visitantes verá primero. *No hay que precipitarse a añadir el
   bloque*: 4 tarjetas encima de un mapa es discutible como diseño. Pero «no hay bloque» y «ni
   siquiera hay badge» son dos decisiones distintas, y la segunda parece un olvido, no una
   decisión — es exactamente el mismo tipo de hueco que el indicador de vídeo tuvo en estas dos
   tarjetas y que ya se corrigió una vez (ver la cabecera de `MapCards.tsx`).
2. **De coste:** el mapa fuerza `page = 1` (`busqueda/page.tsx:118`, `CategoryListingPage.tsx:243`),
   así que el backend **sí lanza la 2ª consulta de destacados** en cada carga de mapa y devuelve
   4 anuncios que nadie va a pintar. Es una consulta a Meilisearch tirada a la basura en todas las
   vistas de mapa del sitio. Barata, pero gratuita de eliminar.

### 4.2 AMPLIADA — el bloque no sigue la vista

En vista ampliada la lista se pinta con `ListingCardWide` en una columna, pero el bloque sigue
pintando **`ListingCard` compacta en rejilla de 4** (`FeaturedBlock.tsx:21-25`, sin variante).
Efectos: (a) ruptura visual —la vitrina de pago se ve *más pequeña* que los resultados
normales—, y (b) los atributos configurados como `wideCardAttribute` no se muestran en el bloque,
aunque el usuario haya elegido precisamente la vista que los enseña. El bloque conoce el modo cero.

### 4.3 LISTA — correcto

Rejilla de 4 encima de la rejilla de resultados. Coherente. (En móvil son 2 columnas: el bloque
ocupa **2 filas completas** antes del primer resultado real. Es una decisión de diseño legítima,
pero conviene saber que en móvil la vitrina de pago se come la primera pantalla entera.)

### 4.4 Modo degradado (Meilisearch caído)

`CategoryListingPage` cae a Postgres, `featured` se queda en `[]` y el bloque desaparece
(`CategoryListingPage.tsx:303-316`). Correcto y sin sorpresas.

### 4.5 «Destacados primero» en la portada y el blog: hoy no destaca nada

Fuera del alcance literal del encargo pero dentro de su pregunta («¿dónde se muestran los
destacados?»), y es un defecto real y verificado:

Los bloques `listings` de la portada y del blog ofrecen al admin un orden llamado **«Destacados
primero»** (`ListingsHomeBlockEditor.tsx:30`, `ListingsBlockEditor.tsx:25`). Ese valor se traduce
a `sortDate:desc` (`lib/home-blocks/resolve-listings.ts:18`, `lib/blocks/resolve-listings.ts:20`),
es decir **`max(publishedAt, bumpedAt)`: los más recientes o reimpulsados**. Nada que ver con
estar destacado.

Y los dos ficheros lo justifican con un comentario que **hoy es falso**:

> «boostScore:desc sigue siendo la primera rankingRule de Meilisearch en ambos casos»

**Ya no lo es** — la Política C la quitó (`search.service.ts:182-200`). Cuando ese comentario se
escribió, «Destacados primero» funcionaba de verdad, por efecto de la ranking rule. La RÁFAGA 1 la
retiró y actualizó `/busqueda` y `/[categoria]`, pero **no revisó los bloques de portada y blog**,
que se quedaron con el nombre de una función que perdieron. El resultado: un admin elige
«Destacados primero» en la portada, ve una lista de anuncios recientes, y no tiene manera de
saber que la opción no hace lo que dice. Es la misma clase de defecto que el hallazgo central
—una promesa que el sistema ya no cumple— y aquí cuesta muy poco cerrarla.

---

## 5. La transparencia (deuda P2B) — sigue abierta, confirmado

Verificado: **no existe ningún texto, tooltip o enlace** que explique al visitante que
«Promocionados» es publicidad de pago. `FeaturedBlock.tsx` es el fichero entero: un icono, la
palabra «Promocionados», y la rejilla. El `aria-label` dice «Anuncios promocionados» — informa a
un lector de pantalla igual de poco que la etiqueta visible informa a todos los demás.

- El badge **«Destacado»** de la card identifica *qué* anuncio es, pero no dice *por qué* está
  ahí ni que se ha pagado por ello.
- Junto al selector «Ordenar por» tampoco hay nada que advierta de que hay un bloque cuyo
  contenido no depende de la relevancia.
- La palabra «Promocionados» es **ambigua a propósito o por descuido**: puede leerse como
  «rebajados», «recomendados» o «destacados por la plataforma». Ninguna de esas lecturas es la
  correcta, y la correcta —«esto es publicidad, el vendedor ha pagado»— no está escrita en
  ninguna parte.

Es la deuda que ya se inventarió en RÁFAGA 0 y se dejó explícitamente fuera de RÁFAGA 1
(`estado-tecnico.md:3594-3597`). **Sigue exactamente igual.** Es honestidad con el comprador —y en
la UE, con el marco de publicidad y prácticas comerciales, un contenido patrocinado debe
identificarse como tal—. Se diagnostica, no se resuelve aquí.

**Nota de deslinde:** el bloque de patrocinados tiene el mismo problema, y ahí el componente es
`SponsoredCard`. No se ha auditado, pero cualquier decisión sobre cómo etiquetar la publicidad
debería cubrir los dos bloques a la vez, o el sitio acabará con dos vocabularios distintos para
lo mismo.

> **CORRECCIÓN (2026-08-25, al implementar P2B).** Esa nota de deslinde **se equivocaba**, y ella
> misma avisaba de por qué: no se había auditado. `SponsoredCard` **sí** identificaba su
> contenido como **«Publicidad»** desde H6.6 —un badge gris, deliberadamente distinto del ámbar
> «Destacado»—. El problema era sólo del bloque de destacados. La consecuencia práctica fue
> buena: la palabra no hubo que elegirla, ya estaba en la casa, y P2B se limitó a usar la misma
> en las dos superficies mediante un componente compartido. **El hallazgo H3 sigue siendo válido
> tal cual está enunciado** para el bloque «Promocionados»; lo que no era cierto es que el
> patrocinado estuviera igual de mudo.

---

## 6. Hallazgos priorizados (daño ÷ coste)

Ordenados por **relación daño/coste**, no por gravedad absoluta. El hallazgo **central** es H5;
está el quinto porque es el más caro, no porque importe menos.

| # | Hallazgo | Ubicación | Daño | Coste | Ratio |
|---|---|---|---|---|---|
| **H1** | **La UI de compra promete el bloque sin condición** («aparece … en el bloque de promocionados»), y el sistema no lo garantiza. Falso desde el minuto uno para quien destaca en una categoría con ≥4 destacados más nuevos. | `PromocionarDialog.tsx:416-418` | **Alto** — reclamaciones, riesgo de consumo | **Muy bajo** — una frase | 🔴 **máximo** |
| **H2** | **«Destacados primero» de portada/blog no destaca nada** desde la Política C, y dos comentarios afirman lo contrario en presente. El admin no puede saberlo. | `lib/home-blocks/resolve-listings.ts:13-19`, `lib/blocks/resolve-listings.ts:15-21`, editores `:30`/`:25` | Medio-alto | Muy bajo | 🔴 **muy alto** |
| **H3** | **Transparencia P2B**: nada identifica «Promocionados» como publicidad de pago. | `FeaturedBlock.tsx` (y `SponsoredCard`) | Medio-alto (legal/confianza) | Bajo | 🟠 alto |
| **H4** | **Un solo vendedor puede ocupar las 4 casillas**: no hay deduplicación por `sellerId` en la selección. | `search.controller.ts:162-171` | Medio-alto | Bajo-medio | 🟠 alto |
| **H5** | **★ EQUIDAD DEL REPARTO (central).** Con N > 4 destacados, los 4 son «los primeros del mismo orden», sin rotación ni estado. En `/[categoria]` con el orden por defecto la clave es `publishedAt`, **inmutable** ⇒ bloque congelado; y **comprar un destacado no altera ninguna variable del reparto**. Agravado en padres (hermanas compiten), en el bloque global (categorías saturadas dominan) y sin techo de N (no hay límite de destacados por categoría). | `search.controller.ts:162-171` + `search.service.ts:547-575` + `CategoryListingPage.tsx:187-190` + `billing.service.ts:329-378` | **Alto** — es el producto que no se presta | **Alto** — ráfaga de diseño propia | 🔴 **el central** |
| **H6** | **En vista MAPA el destacado no se manifiesta**: ni bloque (defendible) ni **badge en las tarjetas del mapa** (parece olvido). Afecta de lleno a categorías cuya vista por defecto es el mapa. | `MapCards.tsx` (sin `boostScore`), `busqueda/page.tsx:341-362`, `CategoryListingPage.tsx:518-532` | Medio | Bajo (badge) / Medio (bloque) | 🟠 alto |
| **H7** | **Asimetría de clave entre superficies**: `/[categoria]` ordena el bloque por `publishedAt`, `/busqueda` por `sortDate`. El bump te ayuda a entrar en una y no en la otra. Nadie lo decidió. | `CategoryListingPage.tsx:187-190` vs `busqueda/page.tsx:109-112` | Medio | Bajo (pero **decidir dentro de H5**) | 🟡 medio |
| **H8** | **El bloque ignora la vista**: en AMPLIADA sigue pintando cards compactas en rejilla; la vitrina se ve más pequeña que los resultados normales y pierde los `wideCardAttribute`. | `FeaturedBlock.tsx:21-25` | Bajo-medio | Bajo | 🟡 medio |
| **H9** | **2ª consulta desperdiciada en vista MAPA**: se resuelven 4 destacados que nunca se pintan, en cada carga de mapa. | `search.controller.ts:162` (no mira la vista) | Muy bajo | Muy bajo | 🟡 medio |
| **H10** | **`FEATURED_BLOCK_SIZE` no es configurable**: cambiar el tamaño de la vitrina exige despliegue, mientras que todo lo demás de monetización se ajusta por `Setting`. | `search.controller.ts:17` | Bajo | Bajo | ⚪ bajo |
| **H11** | **Caducidad asimétrica**: se entra al índice al instante y se sale con hasta ~23 h de retraso (cron 03:00) ⇒ el bloque puede mostrar un destacado ya caducado casi un día. **Decisión ya tomada y documentada**; se reconfirma, no se reabre. | `entitlement-expiration.service.ts:30,50-100` | Bajo | Medio | ⚪ bajo (aceptado) |

---

## 7. Lo que NO es un problema (para no inflar la lista)

Se ha buscado y **no se ha encontrado**:

- Ningún filtro que la lista aplique y el bloque no. La herencia de `baseParams` es completa (§2.3).
- Ninguna contaminación de `totalHits`, ni del estado vacío, ni de la paginación.
- Ningún resto de `boostScore` en las ranking rules — la regresión de la Política C no puede volver.
- Ningún destacado en páginas ≥ 2 (la guarda `page === 1` es correcta).
- Ningún doble conteo de impresiones por la repetición bloque↔lista (la unión está deduplicada por
  id, `search.controller.ts:197-204`).
- Ninguna interferencia entre el patrocinado y el bloque de destacados: entidades y caminos
  distintos, sin solape posible.
- Ningún riesgo de que el bloque muestre anuncios no `ACTIVE`: solo se indexan los `ACTIVE`
  (`search.service.ts:401-405,441`).

**La Política C hizo bien su trabajo.** El hallazgo central no es un fallo de aquella ráfaga: es
la pregunta que aquella ráfaga no llegó a plantearse.

---

## 8. Terreno para la ráfaga de diseño (sin diseñar nada)

Lo que la ráfaga de equidad tendrá que decidir, enunciado como preguntas, con los datos que esta
auditoría ya deja fijados:

1. **Qué se vende exactamente.** ¿«Aparecer en el bloque» (⇒ hay que garantizarlo, y eso obliga a
   turnos o a un techo de destacados por categoría), o «entrar en el sorteo del bloque» (⇒ hay que
   decirlo así en la UI, H1)? **Esta decisión es previa a todo lo demás**; la implementación
   depende por completo de ella, y H1 se puede cerrar hoy diga lo que diga la respuesta.
2. **Con qué se reparte, si se reparte.** Hoy **el índice no tiene con qué**: `boostScore` es un
   binario y no hay en el documento ni fecha de compra, ni fin del periodo, ni contador de
   apariciones (§3.1). Cualquier reparto por antigüedad del destacado, por «cuánto le queda» o por
   «cuántas veces ha salido» **exige campos nuevos en el documento de Meilisearch** (y por tanto
   reindexado) **o** un componente con estado fuera de él (Redis). Es el mayor determinante del
   tamaño de la ráfaga.
3. **Rotación sin estado vs. con estado.** Sin estado hay opciones baratas (una clave derivada del
   tiempo, o del visitante, que reordene el conjunto candidato) pero **rompen la caché por
   definición** y hacen la vitrina no reproducible — hay que evaluarlo contra el `revalidate` y el
   SSR de estas páginas, que hoy son dinámicas. Con estado hace falta dónde guardarlo y quién lo
   limpia.
4. **Diversidad: ¿por vendedor, por categoría, ninguna?** Son tres decisiones separables (H4, casos
   3 y 4). El caso del padre con hermanas (`/vehiculos`) es el que peor se comporta hoy y el que
   más se beneficiaría de una regla explícita.
5. **Unificar la clave entre superficies** (H7) antes de construir nada encima: mientras
   `/[categoria]` y `/busqueda` repartan con claves distintas, cualquier regla nueva tendrá que
   escribirse dos veces o heredará la incoherencia.
6. **Qué se le enseña al vendedor.** Hoy compra a ciegas: no ve cuántos destacados hay ya en su
   categoría, ni cuántas veces ha salido en el bloque. La plataforma **ya mide «veces listado»**
   por anuncio (ESTADÍSTICAS A1/A2), así que el dato para cerrar ese lazo existe y no hay que
   inventarlo.

**Recomendación sobre el tamaño:** la ráfaga de diseño **hace falta**, y conviene separarla en dos.
Una **primera, pequeña y desacoplada** —H1, H2, H3 y el badge de H6— que corrige promesas falsas y
etiquetas con cambios de texto y componentes, sin tocar la selección; puede salir ya y baja de
inmediato el riesgo de reclamación. Y la **segunda, la de verdad**, que decide y construye el
reparto (H5 + H4 + H7), cuyo alcance no se puede acotar hasta responder las preguntas 1 y 2 de
esta lista — porque entre «reordenar el corte de 4» y «guardar estado de apariciones por anuncio»
hay un orden de magnitud de diferencia.
