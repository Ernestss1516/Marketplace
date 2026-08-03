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

## 11. Familia 2a RESUELTA — ni A ni B: `waitForCard` comprueba demasiado pronto

Instrumento durante-la-corrida (`DIAG_WAITFORCARD=1` en `e2e/helpers/wait-for-card.ts`,
opt-in, solo observa): en cada vuelta sondea Meili, la API, el HTML recibido, el texto
VISIBLE y el DOM. Corrido sobre un fallo real (`listing-card-attrs`, 33 vueltas / 90 s):

```
#1 t=  351ms url=/coches loc=no meili=SI(1) api=SI(1) html=SI texto=SI anclas=1
   rectAncla=233x364 | ocultadores: (ninguno)
#2 t=  982ms url=/coches loc=no meili=SI(1) api=SI(1) html=SI texto=no anclas=1
   rectAncla=0x0 | ocultadores: <a class="group block h-full"> w=0 h=0
     <= <div class="grid grid-cols-2 …"> <= <main class="min-w-0 flex-1">
     <= … <= <div class=""> display=none
```

**Las dos explicaciones candidatas mueren en la primera línea:**

- **A (indexación tardía por la imagen del wizard): REFUTADA.** `meili=SI` y `api=SI` ya en la
  vuelta #1, a los **351 ms**. No hay nada tarde.
- **B (el navegador ve algo distinto): REFUTADA.** `html=SI`, `anclas=1` y `textContent`
  incluye el título (`incluye=true`): el navegador recibe y PINTA la card.

**La causa real (tercera):** `waitForCard` hacía `page.goto(url)` y preguntaba
`card.isVisible()` **en el acto**. En ese instante el contenido de la página cuelga de un
`<div class="">` con `display:none` —estado transitorio de transición/carga del App Router,
que se ve en la cadena de ocultadores de la vuelta #2— así que la card existe, está pintada,
pero mide `0x0` y ni `innerText` ni Playwright la ven. Milisegundos después ya es visible
(vuelta #1: `rectAncla=233x364`, `texto=SI`), pero para entonces `isVisible()` ya devolvió
`false`, el helper duerme y **recarga, reiniciando exactamente el mismo transitorio**. Se
repite 33 veces. Por eso **más plazo nunca ayudó** (ráfaga D): cada vuelta vuelve a pillar la
página en el peor microsegundo.

Encaja con lo que ya sabíamos y no encajaba: el único caso que PASA usa `/vehiculos/coches`
—la URL canónica, sin redirección—, mientras que los que fallan pasan todos por un 308
(`/coches`, `/moviles`, `/busqueda?category=coches`), que alarga esa ventana.

**Es deuda de TEST, no bug de producto.** La página sirve la card correctamente: `curl` la
encuentra en las cuatro URLs y el propio navegador la pinta a los ~350 ms. Lo que está mal es
CÓMO se comprueba.

### Opciones de arreglo (para decisión de Ernest — NO implementadas)

1. **Esperar a la card en vez de preguntar por ella** (mínimo y directo): sustituir el
   `isVisible()` instantáneo por un `card.waitFor({ state: 'visible', timeout: ~2 s })` dentro
   de cada vuelta. Le da a la página el momento de asentarse; si no aparece en ese margen,
   recarga como hasta ahora. No cambia qué se verifica.
2. **Esperar a que la navegación asiente antes de comprobar**: un `waitForLoadState` tras el
   `goto` de cada vuelta. Ataca lo mismo un escalón antes.
3. **Usar la URL canónica en los specs** (`/vehiculos/coches` en vez de `/coches`): quita la
   redirección que alarga la ventana. Ataca el síntoma, no la comprobación prematura — y los
   308 son comportamiento legítimo que conviene seguir ejerciendo en otro sitio.

Recomendación: **(1)**, o (1)+(2). Cae toda la familia 2a (7 tests) si el diagnóstico se
sostiene, sin tocar producto.

### CERRADA — arreglo aplicado y verificado

Se aplicó la opción (1): el `isVisible()` instantáneo pasa a
`card.waitFor({ state: 'visible', timeout: 2 s })` dentro de cada vuelta. El predicado no
cambia (sigue siendo "aparece la card"); lo que cambia es que **espera al estado en vez de
muestrear el instante** — la misma lección de `async-state.ts` y del `pollUntil` de redsys.

| Medición | Antes | Después |
|---|---|---|
| Los 8 tests de 2a (producción) | 6 fallos, **13,4 min** | **8 pasan, 1,2 min** |
| Recargas por espera | 33 (agotando 90 s) | **1**, en ~470-570 ms |
| `--repeat-each=3` (24 ejecuciones) | — | **24/24**, las 21 esperas en 1 recarga |

**Validación por mutación:** revertir a `isVisible()` instantáneo devuelve el fallo exacto
—`Card not found after 33 reload(s) (90000ms)`—. Confirma que lo que cura es el `waitFor`.

**Un fallo real sigue siendo finito:** una card que no existe con plazo de 8 s falla en
**8044 ms** con su diagnóstico.

**Bug encontrado POR la validación (y arreglado):** el primer intento calculaba el plazo
por vuelta con `Math.max(0, …)`. En Playwright **`timeout: 0` significa esperar PARA
SIEMPRE**, así que en la última vuelta —cuando ya no queda plazo— el helper se colgaba: un
plazo global de 8 s tardaba **147 s** en rendirse. Corregido con `Math.max(1, …)`. Sin el
paso de validación por mutación/fallo-real, ese fallo habría entrado en el CI disfrazado de
arreglo.

El instrumento `DIAG_WAITFORCARD=1` se queda, opt-in y a coste cero: fue lo que cerró cinco
ráfagas de misterio.

## 13. 🔴 BUG DE PRODUCCIÓN CONFIRMADO — `perPage` por encima del tope del backend

**La reserva de la §12 sobre `footer-admin:11`/`:113` era correcta: es PRODUCTO, no test.**
La sonda lo cerró en una sola corrida.

### Lo que se observó (red del navegador, corrida real)

```
201 POST /api/admin/blog                     → página creada
200 POST /api/admin/blog/<id>/publish        → status: "PUBLISHED"   (el dato está bien)
400 GET  /api/admin/blog?type=PAGE&perPage=200
    {"message":["perPage must not be greater than 50"],"error":"Bad Request","statusCode":400}

[SONDA] select existe=1 nOpciones=1
[SONDA] opciones=["— Selecciona una página —"]
```

El `<select>` se queda **con una sola opción: el placeholder**. No es que falte la página
recién creada — **no hay NINGUNA**.

### La cadena

1. `admin/footer/page.tsx:362` pide `getAdminPosts(token, { type: 'PAGE', perPage: 200 })`.
2. El DTO del backend (`list-admin-posts.dto.ts`) tiene **`@Max(50)`** → responde **400**.
3. El `.catch(() => { /* el selector queda vacío si falla — no bloquea el resto */ })` de la
   línea 364 **se traga el error**. La UI no avisa de nada.
4. `pages` se queda en `[]` y el selector solo muestra el placeholder.

**Impacto real:** un ADMIN **nunca** puede enlazar una página del CMS en el footer — el
selector está vacío siempre, para todos. No es timing ni entorno de test: es determinista.
El comentario del `.catch` anticipaba el fallo pero no su causa, y por eso llevaba tiempo
invisible.

### Y NO es un caso aislado — el sitemap está igual (SEO)

Barriendo las llamadas con `perPage` por encima del tope, y **verificado con peticiones
reales**:

```
GET /api/blog?perPage=500     → HTTP 400      ← sitemap.ts:31
GET /api/paginas?perPage=500  → HTTP 400      ← sitemap.ts:32
GET /api/blog?perPage=50      → HTTP 200      (el tope es la causa)
```

`sitemap.ts` las envuelve en `.catch(() => ({ items: [] }))`, así que **el sitemap se genera
sin NINGÚN post del blog y sin NINGUNA página del CMS**. En un proyecto que el propio
CLAUDE.md define como "fuertemente dependiente del SEO", esto es más grave que el footer.

(Las llamadas a `getAdminTags(..., perPage: 200)` **NO** están afectadas: el DTO de tags
tiene `@Max(200)`, justo en el tope.)

### Opciones (decisión de Ernest — NO implementadas)

- **Subir el tope del backend** en los DTO de blog (p. ej. `@Max(500)`), que es lo que los
  llamantes ya asumen. Cambia el contrato público — hay que valorar el coste de una consulta
  grande.
- **Bajar lo que piden los llamantes a ≤50 y paginar** donde haga falta. Correcto pero
  obliga a paginar el selector del footer y el sitemap.
- **Dejar de tragarse el error** en los dos `.catch`: aunque se arregle el tope, un fallo
  silencioso que deja un selector vacío o un sitemap sin URLs volverá a esconderse. Esto es
  independiente de las otras dos y conviene igualmente.

**`footer-admin:11` y `:113` NO son arreglables como deuda de test**: seguirán rojos hasta
que se decida esto. Son, de hecho, los únicos tests que estaban detectando el bug.

### ARREGLADO — causa (tope) + clase (silenciador)

**Alcance elegido: A para el tope, B para el sitemap.** Los dos DTO de blog pasan de
`@Max(50)` a **`@Max(500)`**, que cubre a todos los llamantes actuales (footer pide 200,
sitemap pedía 500). Ningún test dependía del 50 (solo se probaba `perPage=1`), y el resto de
llamantes ya paginaban con un `PER_PAGE` pequeño, así que subir el techo no cambia nada de lo
que funcionaba.

**Pero el sitemap además PAGINA** (`traerTodo` en `sitemap.ts`), y no por gusto: las páginas
del CMS están acotadas por naturaleza (legal, ayuda, sobre nosotros… decenas), pero **el blog
crece sin techo**. Con un número fijo, el día que hubiera más posts que ese número el sitemap
volvería a salir incompleto — y otra vez en silencio. Recorrer el listado hasta agotar `total`
cierra esa puerta para siempre.

**El silenciador, fuera** (esto va en cualquier caso, y es la barrera real):

- `sitemap.ts`: cada fallo se registra con `console.error` diciendo QUÉ falló, en qué página y
  cuántas entradas se pierden. Se devuelve lo acumulado —un sitemap parcial le sirve más a un
  buscador que un 500— pero el fallo **queda en los logs**.
- `admin/footer/page.tsx`: el `.catch` mudo se sustituye por un estado `pagesError` que pinta
  un mensaje visible (`role="alert"`, `data-testid="item-page-select-error"`) en lugar del
  desplegable. El admin ya no ve un selector vacío sin explicación.

**Verificado ejerciendo, con peticiones reales:**

| Comprobación | Resultado |
|---|---|
| `GET /blog?perPage=500`, `/paginas?perPage=500` | **200** (antes 400) |
| `GET /blog?perPage=501` | **400** — el tope sigue existiendo, no se ha quitado |
| Sitemap generado | **1 entrada `/paginas/`**, que es exactamente cuántas páginas PUBLISHED hay en la BD (antes: 0, en silencio) |
| Sitemap con el backend CAÍDO | 3 × `[sitemap] fallo cargando … El sitemap saldrá INCOMPLETO` en los logs (antes: vacío silencioso con 200) |
| `footer-admin:11` y `:113` (centinelas) | **VERDES, sin tocar los tests** — los arregla el producto |
| Batería backend (`blog`+`footer`) | 45/45 |
| tsc api · tsc web · lint | 0 · 0 · 0 |

`footer-admin:175` sigue rojo: es el caso de ISR/revalidación, causa distinta y ya
identificada (§15), no tiene que ver con este bug.

## 14. Tratamiento de 2b: aplicado, unificado — y NO basta (medido)

Se creó `e2e/helpers/nav.ts` → `clicarYEsperarUrl(page, chip, predicado)`: reintenta **el
CLIC** (no la espera) dentro de un `toPass`, con plazo corto por intento. Es el patrón que
`busqueda-mapa` y `flujo-critico` ya usaban en línea; ahora vive en un sitio y se aplicó a los
5 puntos de clic de `tags-filtro`.

**Medido, sin adornos:**

| Condición | Resultado |
|---|---|
| `tags-filtro` con `--retries=0`, antes | 2 rojos duros |
| `tags-filtro` con `--retries=0`, después | **1 rojo duro**, 4 pasan |
| `tags-filtro` con `retries=1` (como el CI) | **2 fallos, 1 flaky, 2 pasan** |

O sea: el mitigador ayuda pero **no garantiza verde, ni siquiera con el retry del CI**. La
corrida con retry salió PEOR que la de sin retry — no es una regresión, es la varianza propia
de 2b (la investigación de `estado-tecnico.md` ya medía residuales del 20-50 % según el spec).
`tags-filtro` está en la franja alta.

Esto **confirma lo que ya decía la investigación** y conviene no olvidarlo: *"reintentar el
click no recupera el estado roto — la página queda con el router cliente persistentemente
wedged"*. El `toPass` rescata los casos en que el wedge aún no ha ocurrido; cuando ocurre, no
hay reintento que valga.

**Conclusión honesta:** 2b no se "arregla" desde el test. Lo que queda es aceptar el residual
como known-issue y **etiquetarlo** para que no ensucie la señal — el paso que esta ráfaga
**NO** llegó a dar (ver §15).

## 15. Estado al cerrar la ráfaga — lo hecho y lo NO hecho

**Hecho:**
- Sonda de `getAdminPosts` → **bug de producción confirmado** (§13). Reportado, **no
  arreglado**: es producto y requiere decisión.
- Helper `clicarYEsperarUrl` creado y aplicado a `tags-filtro` (§14), con la medición de que
  no basta.

**NO hecho (el bug de producción se llevó el presupuesto de la ráfaga):**
- **Etiquetado `@2b`** de los specs afectados + el job/grep que separe "rojo 2b conocido" de
  "rojo nuevo". Es lo que de verdad devuelve la SEÑAL al CI, más que perseguir el verde.
- **`footer-admin:175`** (ISR): esperar a que la revalidación complete en vez de leer el
  footer público al instante. Causa clara, arreglo pequeño, sin sonda pendiente.
- **`mensajeria-unificada:91`**: falta la sonda que registre qué número pinta el badge. NO
  tocar la aserción (4→1) sin ese dato — la hipótesis viene de leer código, y esta saga ha
  enterrado cinco hipótesis leídas del código.

**Suelo esperable tras lo pendiente:** 2b etiquetado aparte (5, residual conocido), `footer-
admin:11`/`:113` bloqueados por el bug de producción, y 2 sueltos con arreglo claro.

## 17. Bug de producción #3 — sobre-conteo de no leídos (ARREGLADO)

**El mecanismo.** `latestMessage` vive en el Provider (`MensajesShell`), **por encima** de
`ConversationList`, y sobrevive a navegar entre bandeja y conversación. `ConversationList`, en
cambio, se monta y desmonta en esas navegaciones — y su efecto
`useEffect(… unreadCount + 1 …, [latestMessage])` volvía a correr **con el mismo mensaje de
antes** y lo sumaba otra vez. Sin dedupe por id.

**No era una decisión de diseño, era un descuido**: `ChatClient`, el otro consumidor del mismo
`latestMessage`, ya lo hacía bien —`if (prev.some((m) => m.id === incoming.id)) return prev`,
con el comentario "the socket echo is safely ignored"—. El incremento optimista sí es
deliberado (el badge debe subir sin round-trip); lo que faltaba era no contar dos veces.

**El arreglo:** un `Set` de ids ya contados, con inicialización perezosa que marca como visto
lo que ya hubiera en el contexto al montar (eso viene reflejado en `initialConversations`, que
son datos del servidor). Un mensaje NUEVO sigue subiendo el badge al instante; un remount ya no
re-cuenta.

**Medido: 8 → 4**, estable 3/3. Y `mensajeria-unificada` pasa **6/6** con `--repeat-each=3`.

### Corrección: la aserción `4` era CORRECTA — el error fue mío

Se cambió `4` → `1` apoyándose en una sonda anterior que leyó `unreadCount = 1` del servidor.
**Estaba mal.** Esa lectura se tomó en otro instante: el `markRead` va con *debounce*, así que
la foto SSR que alimenta la bandeja tiene todavía 3 pendientes, y con `'cuatro'` son **4**. Al
arreglar el sobre-conteo el badge volvió a 4 — el valor que el test esperaba desde siempre.

La aserción se dejó como estaba. Es la misma lección de la saga, y esta vez me la salté:
**una lectura puntual no es el valor correcto; hay que observar el escenario del test.** El
test nunca estuvo mal; lo que estaba mal era el producto, y ahora está arreglado.

## 16. El filtro `@2b` NO estaba roto — verificado cuatro veces

Se sospechó que el split no filtraba (un log mostraba `Running 271 tests` donde deberían ser
261, con tests `@2b` aparentemente dentro del grupo señal). **Medido: filtra bien.**

| Forma de invocación | `--grep-invert "@2b"` | `--grep "@2b"` |
|---|---|---|
| `npx playwright test --list` | 261 | 10 |
| `pnpm --filter … test:e2e -- --list …` (la del workflow) | 261 | — |
| `pnpm --filter … test:e2e --list …` (sin `--`) | 261 | — |
| **Corrida REAL** (no `--list`) | **`Running 261 tests`** | — |

Y en esa corrida real, **cero** tests etiquetados se colaron en el grupo señal (comprobado
buscando las 10 líneas concretas: `busqueda-mapa:57`, `filtros-schema-driven:164`,
`tags-filtro:108/129`, `busqueda-unificada:68/126/172/214/230/289` → 0 coincidencias).

El `271` observado corresponde a una corrida ANTERIOR a que el etiquetado estuviera completo
(en su momento eran 6 etiquetas, no 10) o a una corrida sin filtro. `pnpm` pasa los flags a
Playwright correctamente, con `--` y sin él, y el `@` del tag no necesita escaparse.

**Conclusión: la barrera del split es sólida.** No había que arreglar nada; había que medirlo.

## 12. El suelo real, clasificado por firma (6 duros + 3 flaky)

La corrida completa midió el suelo: **6 fallos + 3 flaky + 261 pasados en 11,7 min** — muy
por debajo de los ~21 que este plan proyectaba. (Otra proyección fallida; el patrón de la
saga se mantiene hasta el final.) 2a, 2c, familia 1 y los sueltos de A **no reaparecen**.

Los 6 duros se reprodujeron en una corrida dirigida con `--retries=0` — **los mismos 6**, con
su firma exacta leída del log, no supuesta.

| # | Test | Firma exacta | Familia | Test o producto | Confianza |
|---|---|---|---|---|---|
| 1 | `footer-admin:11` | `locator.getAttribute: Timeout 15000ms` esperando `item-page-select > option` con el título de la página recién creada | **Select de admin** | Test (con matiz, ver abajo) | Media |
| 2 | `footer-admin:113` | **idéntica a la #1** | **Select de admin** | Test (mismo matiz) | Media |
| 3 | `footer-admin:175` | `expect(headings.indexOf(colA)).toBeLessThan(...)` → `-1`: la columna no está en el footer público | **ISR/revalidación** | Test | Alta |
| 4 | `mensajeria-unificada:91` | `getByText('4', {exact:true})` → *element(s) not found* | **Realtime/badge** | Test probable | Media |
| 5 | `tags-filtro:107` | `page.waitForURL: Timeout 30000ms — waiting for navigation until "commit"` | **2b** | Producto (bug de Next) | **Alta** |
| 6 | `tags-filtro:135` | idéntica a la #5 | **2b** | Producto (bug de Next) | **Alta** |
| F1 | `busqueda-unificada:172` | waitForURL/commit (pasa al reintentar) | **2b** | Producto (bug de Next) | Alta |
| F2 | `busqueda-unificada:214` | idem | **2b** | Producto (bug de Next) | Alta |
| F3 | `filtros-schema-driven:164` | idem | **2b** | Producto (bug de Next) | Alta |

### No hay ningún bug de producción NUEVO

Se investigaron los dos candidatos que el enunciado señalaba, y **ninguno lo es**:

- **Footer (¿la revalidación no ocurre?) → NO.** Está cableada y completa: las **ocho**
  mutaciones de `FooterService` llaman a `revalidateTag('footer-nav')`
  (create/update/delete/reorder de columna e ítem), y `BlogService` la llama también al
  cambiar el estado de publicación de una página —con tests unitarios que lo afirman—.
  `listPublicNav` filtra por `page.status === PUBLISHED`. Lo que falla en `:175` es que el
  test mira el footer público **inmediatamente**: la revalidación es *fire-and-forget* (el
  backend responde 200 y dispara el POST a `/api/revalidate` sin esperarlo), así que hay una
  ventana de consistencia eventual que el test no espera. Para un usuario real la
  revalidación llega en menos de un segundo. **Deuda de test.**
- **Mensajería (¿el badge no actualiza?) → probablemente NO.** `ConversationList` incrementa
  `conv.unreadCount + 1` por mensaje recibido vía socket, y el test hace `markRead` antes
  (afirma `markReadCalls === 1`), con lo que el contador queda a 0 y **un** mensaje nuevo
  daría badge **1**, no **4**. La firma es *element(s) not found* —falta el elemento— no
  "muestra otro número", así que no está probado al 100%; pero la hipótesis de aserción
  obsoleta encaja mejor que "el realtime está roto". **Confirmar con una sonda que registre
  qué número pinta el badge** antes de tocar nada.

### El matiz de `footer-admin:11` / `:113` — vigilar

Las dos comparten firma y **no son del footer público**: el `<option>` que falta está en el
**select del BACKOFFICE** (`item-page-select`), que se puebla con
`getAdminPosts(token, { type: 'PAGE', perPage: 200 })`. No es paginación (200 de tope, y la
corrida no crea tantas) ni ISR (es cliente). No se ha aislado por qué la página recién creada
no aparece en 15 s.

**Si resultara que el select NUNCA lista una página recién creada, eso SÍ sería bug de
producto** (un admin no podría enlazar en el footer una página que acaba de crear). La sonda
que lo decide es barata: registrar qué devuelve `getAdminPosts` en ese momento. Hasta tenerla,
clasificado como deuda de test **con reserva explícita**.

### Tratamiento propuesto para 2b (5 de los 9: #5, #6, F1, F2, F3)

Más de la mitad del suelo es el mismo bug conocido de Next (#57565), ya caracterizado en
`estado-tecnico.md` en 5 rondas y mitigado con `prefetch={false}` (53 % → 20 %).

1. **Extender el mitigador `toPass` (reintento del CLICK, no de la espera)** a los sitios que
   aún no lo tienen: `tags-filtro`, `busqueda-unificada`, `filtros-schema-driven`. Es lo que
   convirtió a `busqueda-mapa` y `flujo-critico` en flaky-recuperables en vez de rojos duros
   — nótese que los 3 flaky de esta corrida son exactamente eso: 2b **ya rescatado por el
   retry**. Aplicarlo debería mover #5 y #6 de "duro" a "flaky recuperable".
2. **Aceptar el residual como known-issue documentado**, no perseguirlo: la investigación ya
   marcó rendimiento decreciente y la causa residual sigue sin identificar aguas arriba.
3. **Que el CI distinga "rojo 2b conocido" de "rojo nuevo"**: la vía barata es que los specs
   afectados lleven una anotación estable (p. ej. `test.describe` con etiqueta `@2b` y un
   `--grep-invert @2b` opcional en un job aparte), para que un rojo NUEVO no se pierda entre
   los conocidos. Requiere decisión: no se toca nada sin ella.

### Orden de ataque propuesto

Como no hay bug de producción nuevo, manda el criterio de tamaño y certeza:

1. **2b (5 tests)** — extender `toPass`. Es el grupo mayor y el arreglo está probado en dos
   specs. Convierte rojos duros en flaky recuperables.
2. **`footer-admin` (3)** — primero la sonda de `getAdminPosts` (decide si #1/#2 son test o
   producto); `:175` es esperar la revalidación en vez de mirar al instante.
3. **`mensajeria-unificada` (1)** — sonda del badge; casi seguro aserción obsoleta.

Con 2b tratado, el suelo duro esperable queda en **~4**, todos con causa propia y acotada.

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
