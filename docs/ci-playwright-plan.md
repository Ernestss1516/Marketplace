# Plan de ataque de los rojos de Playwright (auditoría, sin arreglos)

**Estado del documento:** clasificación completa de los rojos restantes tras cerrar el crash
del wizard (`resolvePriceUnitSelection`) y la familia 1 (drift del paso Etiquetas + conteo de
nav). **Esta ráfaga no arregla nada**: es el mapa del terreno para dejar de descubrir el
tamaño de cada capa corrida a corrida.

## 0. Alcance, fuentes y honestidad de los números

- **Fuente principal:** la última corrida completa en modo producción (`next start`):
  **32 fallos + 4 flaky + 2 skipped + 233 pasados (35,2 min)**.
- **Fuente secundaria:** la corrida dirigida de los 4 specs de familia 1 tras arreglarla
  (**36 pasados / 6 fallos**), que cambió la firma de 6 tests y por tanto su familia.
- **Confirmaciones puntuales:** una corrida suelta de `tickets-adjuntos` (2 tests) para
  resolver una firma dudosa. Nada más se ha ejecutado.
- **Los conteos "tras familia 1" son proyecciones**, no una medición nueva: no se ha vuelto a
  correr la suite completa (35 min) porque esta ráfaga lo prohíbe explícitamente. El número
  exacto solo lo dará la próxima corrida completa.

Regla de clasificación: **por FIRMA DE ERROR, no por nombre de spec.** La familia 1 ya
enseñó que el nombre engaña — `flujo-critico` y un caso de `listing-card-attrs` parecían
drift del wizard y no lo eran.

## 1. Resumen por familia

| Familia | Firma | Tests | ¿Deuda de test o bug de producto? |
|---|---|---|---|
| **2a** — Visibilidad en búsqueda | `[waitForCard] Card not found after N reload(s)` | **7** | Deuda de test (fixtures/límite), con latencia de indexación debajo |
| **2b** — Carrera del App Router | `page.waitForURL … until "commit"` / vista que no conmuta | **12** | **BUG DE PRODUCCIÓN conocido y caracterizado** |
| **2c** — Sedimentación de estado | `strict mode violation: resolved to N elements` | **1 (+2 sospechosos)** | Deuda de test (falta barrera de limpieza) |
| **3** — Sueltos | varias | **11** | Mezcla; **ningún bug de producto nuevo confirmado** |
| — Flaky (pasan al reintentar) | — | 4 | Timing; 2 de ellos son 2b a menor incidencia |

## 2. Tabla completa

### Familia 2a — `waitForCard` / visibilidad en búsqueda (7)

| Test | Causa raíz probable | Tipo | Arreglo propuesto |
|---|---|---|---|
| `categoria-meili:68`, `:80`, `:91` | ~~`freeActiveListingLimit: 5`~~ → **HIPÓTESIS REFUTADA en ráfaga A** (ver §7). El tope ya está en **100** para Playwright. La causa real está por determinar: queda latencia de indexación / frescura del SSR, igual que `listing-card-attrs`. | Deuda de test | Endurecer `waitForCard` (§5) y medir antes de tocar fixtures |
| `listing-card-attrs:70`, `:92`, `:140` | Usa `proContext` (sin tope), así que **no** es el límite: queda latencia de indexación / frescura del SSR. | Deuda de test | Endurecer `waitForCard` (ver §5) y confirmar con una corrida dirigida |
| `listing-card-attrs:154` (Móviles) | Mismo `waitForCard`; **pasó** en la corrida dirigida → intermitente. | Deuda de test | Igual que arriba |

**Sobre `waitForCard` (`e2e/helpers/wait-for-card.ts`):** deadline **fijo de 45 s**, intervalo
fijo de 1500 ms, sin backoff y **sin escalar con el CI** — exactamente el patrón que se
corrigió en el saneamiento de BullMQ. Su predicado (¿aparece la card?) sí es el estado que
importa, así que el problema no es el predicado sino el plazo. **No puede importar
`async-state.ts`**: ese helper vive en `apps/api/test/helpers/`, otro paquete del monorepo.
Unificar exige extraerlo a un sitio compartido o duplicar la política de plazos.

### Familia 2b — Carrera de navegación del App Router (12)

| Test | Firma |
|---|---|
| `busqueda-unificada:68, :83, :126, :172, :214, :230, :289` (7) | `waitForURL … until "commit"` 30 s |
| `tags-filtro:97, :125, :147` (3) | idem |
| `filtros-schema-driven:164` (1) | idem |
| `busqueda-mapa:57` (1) | `map-view` sigue visible → el toggle no conmutó (misma carrera, otra forma) |

**Esto ya está investigado a fondo en `estado-tecnico.md`** («Carrera de navegación del App
Router bajo `next start` — CARACTERIZADA y mitigada parcialmente»): 5 rondas de refutación
sistemática. Lo esencial para el plan:

- Bajo `next start` (**nunca** bajo `next dev`) un click sobre un `<Link>` del App Router a
  veces no completa la transición: la RSC payload responde **200 en <10 ms** y aun así el
  router no conmuta.
- **No es una ventana transitoria**: tras el primer fallo, 5 reintentos seguidos fallan
  igual — el router cliente queda **persistentemente wedged**.
- Bug conocido de Next 15 (firma de `vercel/next.js#57565`), **sin fix upstream**.
- Mitigado con `prefetch={false}` en `ListingCard`/`MyListingCard`: **53 % → 20 %** de fallo
  medido en banco (15 pasadas). Residual **no identificado**.
- El documento es explícito: **«No es un problema de test — afecta a usuarios reales»**.

**Consecuencia para el plan, y es la más importante:** **subir `navigationTimeout` NO
arregla nada aquí.** El router no está lento, está atascado; esperar 90 s en vez de 30 s da
el mismo rojo 60 s más tarde. Lo único que funciona hoy es el mitigador de test
`expect(async () => …).toPass()` (reintentar **el click**, no la espera), ya presente en
`busqueda-mapa` y `flujo-critico` y que el documento marca como **NO retirar**.

### Familia 2c — Sedimentación de estado — **CERRADA en ráfaga C** (era 1 test, no 3)

| Test | Firma | Veredicto |
|---|---|---|
| `tags-filtro:138` | `strict mode violation: … resolved to 3 elements` | **2c real — ARREGLADO** |
| `mensajeria-unificada:91` | `getByText('4')` → *element(s) not found* | **NO era 2c** (ver §8) |
| `footer-admin:175` (+`:11`, `:113`) | `indexOf → -1`, `getAttribute` timeout | **NO era 2c** (ver §8) |

**El mecanismo NO era el que suponía este plan.** No es arrastre ENTRE corridas: `globalSetup`
ejecuta `reset-test-db.js`, que hace `TRUNCATE … RESTART IDENTITY CASCADE` de todas las tablas
de dominio en cada corrida, así que eso ya estaba cerrado. Lo que ocurre es **dentro de una
misma corrida**:

> **Playwright DESCARTA el worker cuando un test falla** y arranca otro para el siguiente —
> también con `--retries=0`. Eso vuelve a ejecutar el `test.beforeAll` del fichero, que
> siembra OTRA generación de anuncios.

Medido: en una sola corrida con `--retries=0`, el error listaba tres títulos con **tres sellos
distintos separados ~38 s** — tres ejecuciones del mismo `beforeAll`. Y se autoamplifica: cada
fallo siembra otra generación, que hace más probable el siguiente fallo.

**Barrera aplicada** (`e2e/helpers/seed-listings.ts` → `limpiarAnunciosPorPrefijo`): antes de
sembrar, borra por la API los anuncios del usuario cuyo título empieza por el prefijo del
spec. Un registro en memoria no serviría —el worker descartado es otro PROCESO—, por eso
busca por prefijo en vez de recordar. Borra **por `DELETE /listings/:id`, no por Prisma**:
un anuncio vive en Postgres *y* en Meilisearch, y un borrado directo dejaría el documento
huérfano en el índice (misma lección que el flush de Meili como barrera aparte).

**Resultado medido** (`tags-filtro`, `--repeat-each=3 --retries=0`, 15 ejecuciones):
`[seed-listings] limpiadas 3` en las 8 ejecuciones del `beforeAll` — **siempre 3, nunca 6 ni
9**. Cero `strict mode violation`. Antes: 3 elementos ya en una sola pasada.

### Familia 3 — Sueltos (11)

| Test | Causa raíz | Tipo | Confianza |
|---|---|---|---|
| `tickets-admin:135` | `POST /billing/facturas` → **400 `ISSUER_NOT_CONFIGURED`**: el Setting `fiscalIssuer` **no lo siembra ningún seed de Playwright** (los specs de backend se lo configuran ellos mismos). Descartado "sin movimientos facturables": eso es **409**, no 400. | **Deuda de test** (falta fixture). El producto se comporta bien: se niega a emitir sin emisor configurado, con código claro. | Alta (leído el código) |
| `mis-creditos:77` | El test espera `heading "Mis créditos"`; el `<h1>` real de la página es **"Mi saldo"**. "Mis créditos" solo existe como **etiqueta del nav** en `(account)/layout.tsx`. | **Deuda de test** (aserción congelada) | Alta (leído el código) |
| `mis-creditos:217` | Mismo spec, espera un enlace `/ir a mis créditos/i`. Probablemente el mismo desajuste de rótulo. | Deuda de test | Media |
| `tickets-adjuntos:43`, `:82` | **CONFIRMADO por corrida dirigida: son FLAKY** — fallan al primer intento y **pasan al reintentar** (exit 0). El picker de adjuntos **no está roto**. Carrera de hidratación: `setInputFiles` llega antes de que el componente cliente enganche su `onChange`. | Deuda de test | **Alta (ejercido)** |
| `flujo-critico:17` | `locator.click` interceptado por `<div data-testid="photo-lightbox">`. El lightbox ya está **abierto en el primer intento**. Hipótesis A: el click cae en el centro de la card, que es el overlay `absolute inset-0` de "Ampliar foto" (comportamiento **deliberado** de RÁFAGA 2) → deuda de test, hay que clicar el título. Hipótesis B: encadenado con 2b (el doc nombra a `flujo-critico` como su banco de pruebas canónico). | Deuda de test (probable) | Media — **pendiente de 1 corrida dirigida** |
| `h6-6-sponsored-ads:61`, `:102`, `:125` | `sponsored-card` no visible **en la búsqueda**. El test de creación+listado en admin **pasa**, así que crear funciona: el fallo es solo del lado búsqueda. Candidato: caché Redis de patrocinados (TTL 5 min + invalidación) o frescura del SSR de la página de categoría. | Deuda de test o caché | Media — **pendiente de 1 corrida dirigida** |
| `footer-admin:11`, `:113` | `locator.getAttribute('value')` sobre una `<option>` que nunca aparece (la página del CMS recién creada no llega al `<select>`). Agotan los 15 s de `actionTimeout`. | Deuda de test / ISR | Media |

## 3. Bugs de producción: uno, y ya conocido

**No ha aparecido ningún bug de producción NUEVO en esta auditoría.** Los dos candidatos que
el enunciado señalaba se han resuelto y **ninguno lo es**:

- **`tickets-admin` (400) → NO es bug.** El 400 es `ISSUER_NOT_CONFIGURED`: el producto se
  niega correctamente a emitir factura sin emisor fiscal configurado. Falta el fixture.
- **`tickets-adjuntos` → NO es bug.** Confirmado ejerciéndolo: flaky, pasa al reintentar.
- **`flujo-critico` (lightbox) → probablemente no es bug.** Que el centro de la foto abra el
  visor es una decisión deliberada de RÁFAGA 2, con su propio test de regresión
  (`CardPhotoCarousel.test.tsx`). Un usuario real que quiera ir a la ficha clica el título o
  cualquier zona fuera de la foto. Queda pendiente 1 confirmación.

**El único bug de producción vivo es el de familia 2b**, y ya estaba documentado: la carrera
del App Router bajo `next start`. Merece subrayarse porque **afecta a usuarios reales**
(cualquier categoría o búsqueda con la página de resultados llena está en la misma
condición), pero **no es accionable ahora**: causa residual sin identificar, sin fix upstream,
y con la mitigación barata (`prefetch={false}`) ya aplicada.

## 4. Orden de ataque propuesto

Criterio: primero lo **determinista y barato**, y dejar para el final lo que es un bug
conocido sin arreglo limpio — para no volver a gastar corridas en algo que no va a ponerse
verde.

**Ráfaga A — Sueltos de causa conocida (caen ~5, coste bajo).**
`tickets-admin` (sembrar `fiscalIssuer`), `mis-creditos` ×2 (rótulo real de la página),
`flujo-critico` (clicar el título en vez del centro de la card). Todos con causa leída en el
código, sin dependencia de timing. **Qué destapa:** poco; son independientes.
*Decisión pendiente del usuario:* si el `<h1>` debería decir "Mis créditos" para casar con el
nav, eso es un cambio de producto, no de test.

**Ráfaga B — Familia 2a (~7). REPLANTEADA tras refutar su hipótesis (§7).**
Ya no es "cambiar el fixture del usuario": el tope de anuncios activos no era la causa. Con
esa vía cerrada, B pasa a ser **medir antes de tocar** — instrumentar una publicación real y
ver dónde se pierde el tiempo (¿el job de indexación tarda?, ¿el SSR de la categoría sirve
una respuesta cacheada?, ¿la card existe pero fuera de la página 1?) y solo después decidir
el arreglo. Sospecha principal, sin confirmar: `waitForCard` con 45 s fijos no cubre el CI
(§5), igual que pasaba con los plazos del saneamiento de BullMQ.

**Ráfaga C — Barrera de sedimentación (caen ~1-3).**
Limpieza por spec de lo que cada uno siembra. **Qué destapa:** al quitar el ruido de
`strict mode`, las aserciones de `tags-filtro` medirán lo suyo y puede que dejen ver un 2b
por debajo (3 de sus 4 rojos ya son `waitForURL`).

**Ráfaga D — Endurecer `waitForCard` (caen los residuales de 2a).**
Plazo que escale con el CI + backoff, reutilizando la política de `async-state.ts`.

**Ráfaga E — Familia 2b, la última y con expectativas ajustadas (12 tests).**
No prometer verde. Lo accionable es extender el mitigador `toPass` (reintento de click) a los
specs que no lo tienen. **No subir `navigationTimeout`**: está demostrado que no ayuda.
Decidir explícitamente cuánto se acepta como flaky conocido.

Proyección: A+B+C+D podrían dejar la suite en torno a los **12 rojos de familia 2b**, que es
el suelo real mientras el bug de Next siga abierto.

## 5. Barreras estructurales candidatas

1. **Política de espera única para los dos paquetes.** `async-state.ts` (backend) resolvió
   plazo-que-escala + backoff + error diagnóstico; `waitForCard` (web) sigue con 45 s fijos.
   Están en paquetes distintos y no se pueden importar entre sí. Candidato: extraer la
   política a un sitio compartido, o replicarla conscientemente y anotar el vínculo.
2. **Reset entre specs para Playwright.** El backend tiene barreras `setupFilesAfterEach`;
   Playwright solo tiene `globalSetup`/`globalTeardown`. Es el hueco que permite la
   sedimentación de 2c.
3. **Helper de siembra-con-limpieza.** Los specs que publican anuncios no los retiran; de ahí
   el tope de 5 activos y los `strict mode violation`. Un helper que registre lo sembrado y lo
   desactive al terminar ataca 2a y 2c a la vez.
4. **Helper de navegación del wizard.** Ya creado en familia 1 (`e2e/helpers/wizard.ts`).
   Quedan **9 specs** que navegan el wizard a mano; unificarlos evitaría el próximo drift.

## 6. Qué queda FUERA de este plan

- **`queue-retry` (backend)** — preexistente, determinista, verificado contra HEAD limpio.
  No es Playwright.
- **`pnpm start` / `start:prod` apuntan a `node dist/main`**, ruta que no existe (el entry
  real es `dist/src/main.js`).
- **`multer` es dependencia fantasma** — import de valor en 5 ficheros, solo `@types/multer`
  declarado; `node dist/src/main` revienta.

Los dos últimos afectan al **arranque de producción real** y son más urgentes que cualquier
rojo de test, pero no se mezclan aquí.

## 7. Correcciones sobre este mismo plan (ráfaga A)

Este documento se equivocó en un punto y conviene dejarlo escrito en vez de reescribir la
historia:

**Hipótesis REFUTADA: `categoria-meili` NO falla por el tope de anuncios activos.** El plan
daba por causa el `freeActiveListingLimit: 5` de `seed-test.ts`, apoyándose en el comentario
de cabecera del propio spec. Al ir a arreglarlo apareció que **`seed-playwright.ts` ya lo sube
a 100** —con un comentario que explica exactamente ese problema y lo da por resuelto— y que
ese seed corre **después** de `seed-test.ts` en el `globalSetup` de Playwright. O sea: durante
Playwright el tope efectivo es 100, no 5. El comentario del spec describe un riesgo real pero
**ya mitigado**; leerlo como causa fue confundir una advertencia con un diagnóstico.

Lección, la misma de familia 1 en otra forma: **un comentario en el código es una pista, no
una medición.** El plan clasificó bien por firma de error, pero para esta fila se apoyó en
prosa en vez de comprobar el estado efectivo del seed.

Consecuencia: la ráfaga B pierde su arreglo "barato" y pasa a ser una ráfaga de MEDICIÓN
(ver §4). Los 3 rojos de `categoria-meili` siguen en familia 2a, ahora con la misma causa
abierta que los de `listing-card-attrs`.

**`flujo-critico`: CLASIFICADO — eran las DOS cosas, apiladas.** El plan lo daba como overlay
con confianza media. Medido con `--repeat-each=5 --retries=0` tras clicar el título:

- **El overlay era real y está arreglado**: `photo-lightbox` aparece **0 veces** en las 5
  pasadas (antes interceptaba el click en cada fallo).
- **Debajo estaba 2b**: 1 de 5 pasadas falla con `toHaveURL` sin navegar —
  `Received: /busqueda?q=…`, sin interceptación y sin error—, y el `toPass` reintenta el
  click los 30 s sin recuperarlo. Es la firma exacta del router wedged, **al 20 %, que es
  clavado el residual documentado para este spec** tras `prefetch={false}`.

O sea: la capa de arriba (overlay, determinista) se ha quitado y ha dejado a la vista la de
abajo (2b, ~20 %). `flujo-critico` **sale de la ráfaga A y pasa a 2b**. Con `retries: 1` en
CI, un 20 % por intento deja ~4 % de que fallen los dos, así que normalmente pasará — pero
como verde no es fiable hasta que se trate 2b.

## 9. Familia 2a NO es latencia — hipótesis refutada con datos (ráfaga D)

La ráfaga D endureció `waitForCard` (plazo que escala al CI + backoff) dando por hecho que 2a
era "el plazo fijo de 45 s no cubre el CI". **Medido: no era eso.**

**El experimento.** Se subió el plazo de 45 s a **120 s** (2,7×) y se corrieron los 8 tests de
2a en producción. Resultado: **6 fallan igual, tras 43 recargas y los 120 s completos**. Entre
los 45 s y los 120 s **no apareció ni una sola card**. Si fuera lentitud, alguna habría entrado
en ese margen. No entró ninguna: lo que falla no es lento, no llega nunca.

**Pista fuerte para la ráfaga B (hipótesis, NO confirmada).** De las 7 llamadas a
`waitForCard`, solo pasa una — y es la **primera publicación de la corrida**
(`/vehiculos/coches`, encontrada en **398 ms con 1 sola recarga**). Todas las posteriores
fallan, sea cual sea la URL (`/vehiculos`, `/coches`, `/coches?type=PRODUCT`,
`/busqueda?category=coches`, `/moviles`). O sea: **la primera indexación va instantánea y las
siguientes no llegan nunca.** Eso descarta que el problema sea la URL o la página, y apunta a
la cola.

Hipótesis a medir en B (no darla por buena sin datos, que es justo el error que este plan ya
cometió dos veces): **los jobs `geocode` starvan a los `index`.** Publicar sin coordenadas
encola `geocode` (`listings.service.ts:241`), que llama a Nominatim —externo y limitado a
~1 req/s, y según `estado-tecnico.md` inaccesible en CI—. `QUEUE_INDEXING` tiene
`concurrency: 5` y **atiende los dos tipos de job**: cinco `geocode` atascados esperando a
Nominatim ocupan las cinco plazas y los `index` posteriores no llegan a correr. Encaja con lo
observado: el primer `index` corre antes de que se acumulen los `geocode`; los siguientes se
quedan detrás. Los specs de backend esquivan esto pasando coordenadas explícitas (lección de
B2), pero estos publican **por el wizard de la UI**, que no ofrece esos campos.

**Qué se queda del endurecimiento.** El plazo escala (45 s local / **90 s** CI) y hay backoff,
pero el 90 s sale de la MEDICIÓN, no de "por si acaso": los aciertos reales bajo carga de suite
completa se agrupaban en 29-30 recargas (~45 s, justo el techo del plazo viejo), así que 2× de
margen es lo justificable. Se descartó dejarlo en 120 s precisamente porque se demostró que no
compra nada y encarece cada fallo conocido. También se subió el `timeout` de test
(90 s → 150 s en CI): era el **tope real** de estos tests —publicar por el wizard consume ~40 s
y la espera hasta 45 s más, contra un presupuesto de 90 s—, así que subir solo el helper no
habría servido de nada.

**Saldo de la ráfaga D: 0 rojos caídos.** Lo entregado es el helper honesto (escala, backoff,
error que distingue lento de roto) y, sobre todo, **el descarte con datos de la hipótesis de
latencia**, que era lo que bloqueaba el diagnóstico real.

## 10. La starvation de `geocode` NO existe — refutada con números de cola (ráfaga B)

**Hipótesis:** los jobs `geocode` (Nominatim, externo) ocupan las 5 plazas de `QUEUE_INDEXING`
y dejan sin correr a los `index` posteriores.

**Instrumento** (temporal, ya borrado): publicar 8 anuncios SIN coordenadas por la API —igual
que hace el wizard— y observar la cola por fuera (`waiting/active/delayed/failed/completed` y
el tipo de cada job activo), más un `/search` final por cada uno.

**Resultado — el mecanismo existe pero es inofensivo:**

```
t(s)  waiting active delayed failed completed | activos por tipo
   0        7      5       0      0         0 | activos={"geocode":5} esperando={"index":4,"geocode":3}
   3        0      0       0      0         0 | (cola vacía)

RESUMEN: 8/8 indexados
```

En t=0 se ve **exactamente** lo que predecía la hipótesis: las 5 plazas ocupadas por `geocode`
y 4 `index` esperando. Pero **la cola se vacía en 3 segundos y se indexan los 8**. La ventana
de bloqueo es de segundos, no de los 90-120 s que aguantan los tests. **Hipótesis REFUTADA.**
(Encaja con el código: `GEOCODING_TIMEOUT_MS = 3000` y, en los reintentos, el job queda
*delayed* — que no ocupa plaza — no *active*.)

### Y de paso se refutó que 2a sea un problema de indexación, en ningún punto

Tomando el anuncio de una ejecución REAL que falló (`waitForCard` agotado tras 33 recargas):

| Comprobación | Resultado |
|---|---|
| Postgres | `status: ACTIVE`, `publishedAt` puesto, categoría `coches` correcta, geocodificado (lat/lng) |
| Meilisearch | documento presente y completo |
| `GET /api/search?category=coches` | `totalHits: 1`, devuelve el anuncio |
| Página `/vehiculos/coches` | HTTP 200 y **contiene el título** |
| Páginas `/coches`, `/vehiculos`, `/busqueda?category=coches` | HTTP 200 tras seguir el 308, **las tres contienen el título** |

O sea: **la cola, el índice, la API y las cuatro páginas están bien.** El `type: "SERVICE"` y
la ciudad "Valencia" del documento, que al principio parecían anomalías, son lo que el spec
pide a propósito (`getByLabel('Servicio').click()`, `#city` = Valencia): el documento refleja
fielmente lo que el test creó.

### Lo que queda abierto (y el instrumento que hace falta)

Queda una contradicción honesta: **después** de la corrida todo está correcto y las páginas
sirven la card, pero **durante** la corrida `waitForCard` no la encuentra en 90 s y 33
recargas. Todas las comprobaciones de arriba son *post mortem*; ninguna observa el sistema en
el instante en que el test está recargando.

**Siguiente instrumento (no hecho aquí):** medir DURANTE la corrida de Playwright, no después
— registrar en cada vuelta de `waitForCard` qué devuelve `/api/search` para ese id y en qué
estado está la cola. Eso separa las dos únicas explicaciones que quedan en pie: (1) la
indexación termina más tarde de lo que el instrumento por API sugiere cuando se publica **por
el wizard con imagen** (hay un `QUEUE_IMAGE` de por medio que la medición por API no ejerce),
o (2) la página que ve el navegador durante la corrida no es la que sirve un `curl` después.

**Saldo de la ráfaga B: 0 rojos caídos, 2 hipótesis muertas** (starvation, e "indexación"
como familia). 2a deja de ser "latencia de indexación" y pasa a ser **causa desconocida, con
todo el camino de datos ya descartado**.

## 8. Reclasificación de los sospechosos de 2c (ráfaga C)

Los dos "sospechosos" de familia 2c **no lo eran**. Medidos con `--retries=0`, siguen fallando
con su firma original y ninguna es de acumulación:

- **`footer-admin` (×3) → familia propia: frescura del footer público.** Imposible que sea
  sedimentación: cada test usa sufijo `Date.now()`, así que sus nombres no colisionan jamás.
  Las firmas son `locator.getAttribute` agotando 15 s sobre una `<option>` que nunca aparece
  (la página del CMS recién creada no llega al `<select>`) y un `indexOf → -1` (la columna
  creada no sale en el footer público). Apunta a la revalidación ISR del footer
  (`revalidateTag('footer-pages')` vía `POST /api/revalidate`), no a datos acumulados.
- **`mensajeria-unificada:91` → familia propia: contador de mensajes en tiempo real.** La
  firma es `element(s) not found` sobre `getByText('4')`, es decir **falta** el elemento, no
  que haya varios. Si fuera acumulación daría strict-mode (demasiados), no ausencia. Apunta a
  la entrega en tiempo real del mensaje / el badge, no al estado sembrado.

O sea: **familia 2c era exactamente 1 test**, y está cerrado. Los otros dos suben a la lista
de sueltos con familia propia, cada uno con su hipótesis anotada para su ráfaga.

**Y lo que quedaba de `tags-filtro` es 2b, confirmado:** sus otros 3 rojos (`:97`, `:125`,
`:147`) fallan **3/3 bajo repetición** con `page.waitForURL: Timeout 30000ms exceeded`, sin
una sola firma distinta. Era exactamente lo que este plan anticipaba al quitar el ruido de
sedimentación: debajo estaba 2b.

**Nota sobre `tickets-admin`: no es idempotente entre repeticiones.** Consume la ÚNICA
transacción facturable del seed, así que en `--repeat-each=3` la 2ª y 3ª dan **409
`NO_INVOICEABLE_MOVEMENTS`** (y **429** por el límite de creación de tickets). No es
inestabilidad: en una corrida normal —que es como corre el CI— el `globalSetup` resiembra y
pasa. Anotado para que nadie lo lea como flaky.
