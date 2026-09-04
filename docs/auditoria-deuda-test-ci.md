# Auditoría — deuda de test/CI (los rojos que no son del código)

**Fecha:** 2026-08-27 · **Alcance:** Grupo A, y sólo el Grupo A — las fuentes de **rojo de CI no
determinista**. No entran los residuos de producto (`BANNED` con anuncios, el ZIP en memoria) ni
los flecos del vídeo: ésos son deuda de producto y van en su propia lista.

**Método.** Todo lo que sigue está leído contra el código de los tests, fichero y línea. Donde el
recuerdo y el código discrepan, manda el código, y la discrepancia se dice en voz alta. No se llama
«flake» a nada que no se haya podido señalar con el dedo.

---

## 0. Veredicto en una tabla

| # | Fuente | ¿Viva? | Alcance real medido | Ráfaga |
|---|---|---|---|---|
| 1 | Conteo de jobs BullMQ con `removeOnComplete: true` | **VIVA** | **2 ficheros, 5 casos, 9 lecturas de cola** (3 ficheros más ya inmunes) | A1 |
| 2 | Aislamiento de claves `Setting` entre suites | **VIVA, y más ancha de lo anotado** | **21 ficheros escriben `Setting`; 11 tocan `freeActiveListingLimit`; 3 dejan la fila en un estado que no es el del seed** | A2 |
| 3 | `next/font/google` (Inter) en tiempo de build | **VIVA** | **1 importación, 1 fichero, 1 paso de CI** | A3 |

Y dos correcciones al recuerdo, que son el motivo de haber hecho la auditoría:

- **La fuente 1 no se arregla con jobIds deterministas**, que es lo que propone la nota del propio
  helper. Los jobId cierran *una* de las dos direcciones de la carrera; la otra sólo la cierra
  `pause()`. Detalle en §1.4. La nota del helper hay que corregirla.
- **La fuente 2 no muerde por donde se creía.** El daño de `tags-b3`/`tags-b4` (borrar en vez de
  restaurar) es hoy **latente** para `freeActiveListingLimit` —porque el valor por defecto del
  código coincide con el del seed— mientras que **sí muerde de verdad en `videoEnabled`**, en una
  suite que no estaba en la lista. Detalle en §2.3.

---

## 1. Fuente 1 — contar jobs en una cola con `removeOnComplete: true`

### 1.1 El mecanismo, confirmado

`RETRY_JOB_OPTIONS` lleva `removeOnComplete: true`
([queue.constants.ts:62-68](../apps/api/src/infra/queue/queue.constants.ts#L62-L68)), y **todas**
las colas se registran por `retryQueue(...)`, que lo aplica — 20 llamadas a `registerQueue` en
`src/`, incluidas las de `QUEUE_INDEXING`, `QUEUE_BILLING`, `QUEUE_ACCOUNT_CLEANUP` y
`QUEUE_DATA_EXPORT`.

Los workers están **vivos** en toda suite e2e: `createTestApp()` compila el `AppModule` entero
([helpers/create-app.ts:17-20](../apps/api/test/helpers/create-app.ts#L17-L20)), y los `@Processor`
vienen dentro. No hay ninguna suite que arranque un módulo parcial.

Conclusión: en cualquier suite e2e, un job completado **desaparece**, y desaparece en un instante
que el test no controla.

### 1.2 Lo que `getExistingJobs` cerró, y lo que dejó abierto

[helpers/queue.ts](../apps/api/test/helpers/queue.ts) cerró el `TypeError` (los huecos que devuelve
`getJobs` cuando el hash ya no está). Su propia nota, líneas 34-42, dice literalmente que contar
sigue siendo racy y que arreglarlo «exige cambiar lo que esas aserciones AFIRMAN (mirar jobIds
deterministas en vez de contar)». Esa nota es correcta en el diagnóstico y **incompleta en el
remedio** (§1.4).

### 1.3 El inventario, medido

Los 4 ficheros que leen una cola con `removeOnComplete`:

| Fichero | Líneas | Cola | ¿`pause()`? | Qué afirma | ¿Racy hoy? |
|---|---|---|---|---|---|
| [rf7-expiration](../apps/api/test/rf7-expiration.e2e-spec.ts#L137) | 137-139 | indexing | **no** | `find(listingId)` → `toBeDefined()` | **sí** (falso negativo) |
| [rf7-expiration](../apps/api/test/rf7-expiration.e2e-spec.ts#L147) | 147-155 | indexing | **no** | `countAfter === countBefore` | **sí** (las dos direcciones) |
| [rf7-expiration](../apps/api/test/rf7-expiration.e2e-spec.ts#L166) | 166-176 | indexing | **no** | `countAfterSecond === countAfterFirst` | **sí** |
| [rf7-expiration](../apps/api/test/rf7-expiration.e2e-spec.ts#L334) | 334-344 | indexing | **no** | `countAfter - countBefore >= 2` | **sí** |
| [h8-featured-quota](../apps/api/test/h8-featured-quota.e2e-spec.ts#L416) | 416-418, 430-431, 445 | indexing | **no** | `some(listingId)` + `some(id nuevo)` | **sí** (falso negativo) |
| [h8-featured-quota](../apps/api/test/h8-featured-quota.e2e-spec.ts#L464) | 464-465 | indexing | **no** | `some(listingId)` | **sí** |
| [borrado-cuentas-c2](../apps/api/test/borrado-cuentas-c2.e2e-spec.ts#L523) | 523-547 | billing | **sí**, por caso, con `finally` | `toHaveLength(1)` | no |
| [borrado-cuentas-c5](../apps/api/test/borrado-cuentas-c5-inventario.e2e-spec.ts#L505) | 505-517 | account-cleanup | **sí**, de suite | `toHaveLength(1)` + ausencia del ajeno | no |
| [borrado-cuentas-c6](../apps/api/test/borrado-cuentas-c6-exportacion.e2e-spec.ts#L335) | 335-337 | data-export | **sí**, de suite | `>= 1` | no |

**Total vivo: 2 ficheros, 5 casos `it`, 9 lecturas de cola.** Los tres `borrado-cuentas` ya están
cerrados por `pause()` y no hay que tocarlos — salvo un fleco cosmético: **c5 usa
`getJobs(...).filter(Boolean)` a pelo** ([línea 505](../apps/api/test/borrado-cuentas-c5-inventario.e2e-spec.ts#L505))
en vez del helper. Bajo pausa es equivalente, pero es la undécima copia del filtro que el helper
existe para no tener.

Un detalle que conviene no perder: **h8 línea 445 ya está medio arreglado**. Alguien cambió
`length > length` por «hay un id que no estaba», con la explicación escrita y la fecha del rojo de
CI (2026-08-25). Ese cambio arregló la dirección del conteo pero **no** la de la desaparición: si el
worker se lleva el job nuevo antes de la segunda lectura, `some(...)` da `false` igual.

### 1.4 La corrección al remedio propuesto

La carrera tiene **dos direcciones**, y sólo una la cierran los jobId:

- **Deriva del total** — un job *ajeno* al test se completa entre dos lecturas y el conteo baja.
  Afirmar por identidad (jobId, o `data.listingId`) lo cierra: lo que otros jobs hagan deja de
  importar.
- **Desaparición propia** — el job *del test* se completa y se borra antes de que el test lo lea.
  `getJob(jobId)` devuelve `undefined` exactamente igual que `getJobs()` lo omite. **El jobId no
  ayuda aquí.**

La segunda dirección sólo la cierra **parar al worker**: `queue.pause()` vive en Redis, así que
ningún worker consume mientras dure, y el job se queda en `waiting` esperando a que se le lea. Es
lo que ya está escrito y razonado en
[borrado-cuentas-c2:504-522](../apps/api/test/borrado-cuentas-c2.e2e-spec.ts#L504-L522), con el
repro (2,5 s de espera y el conteo cae a 0 siempre).

**Por tanto:** `pause()` es la barrera; el jobId (o el filtro por `data.listingId`) es lo que hace
que la aserción *diga lo que quiere decir*. Son complementarios, no alternativos. La nota de
`helpers/queue.ts` líneas 40-42 debe corregirse en la ráfaga.

### 1.5 El arreglo, caso por caso

Antes hay un hecho que decide el reparto: **de los dos productores implicados, sólo uno pone
jobId**.

- `feat-exp-${ent.id}-${today}` — [entitlement-expiration.service.ts:85](../apps/api/src/modules/expiration/entitlement-expiration.service.ts#L85). Determinista.
- El degradado Pro→Free encola **sin jobId**: `this.indexingQueue.add('index', { listingId: id })`
  — [línea 182](../apps/api/src/modules/expiration/entitlement-expiration.service.ts#L182). BullMQ
  le asigna un id autoincremental.

O sea: **la aserción por jobId no está disponible para la mitad de los casos sin tocar código de
producción**, y tocar producción para que un test pueda afirmar es exactamente lo que no se hace.

| Caso | Arreglo |
|---|---|
| rf7 B.1 «encola reindex» (137-139) | `pause()` de suite o de caso + `getJob('feat-exp-<entId>-<hoy>')` → definido. Aquí sí hay jobId, y es la aserción que dice la verdad. |
| rf7 B.1 «SOLD no encola» (147-155) | `pause()` + afirmar **ausencia por identidad**: ningún job con ese `listingId`. El `countBefore/countAfter` desaparece; no aportaba nada. |
| rf7 B.1 idempotencia (166-176) | `pause()` + `getJob(mismo jobId)` y comprobar que el `timestamp` **no cambió** tras la segunda pasada. Es lo que de verdad prueba el dedup; el conteo lo probaba de refilón. |
| rf7 B.2 reindex de degradados (334-344) | **Sólo `pause()`.** Sin jobId en el productor, la aserción honesta es «bajo pausa, existen jobs para estos 2 `listingId` concretos» — identidad por dato, no conteo. |
| h8 Bloque D fase 4 (416-465) | **Sólo `pause()`.** La aserción por `data.listingId` que ya tiene es la correcta; lo que le falta es que el worker no se la borre. El `idsBefore` de la línea 418 sobra una vez hay pausa. |
| c5 línea 505 | Cambiar `getJobs(...).filter(Boolean)` por `getExistingJobs`. Cosmético, un renglón. |

**Dónde va la pausa.** En rf7 y h8 la cola es `indexing`, que las propias suites usan para publicar
sus fixtures. Una pausa **de suite** dejaría los anuncios sin indexar en Meili durante toda la
corrida; ninguna de las dos suites afirma nada contra Meili, así que sería seguro — pero es una
apuesta que caduca en cuanto alguien añada un caso. **La pausa va por caso, con `try/finally`**,
como en c2. El `finally` no es opcional: la pausa vive en Redis y la batería corre `--runInBand`
bajo un candado compartido, así que una pausa fugada congela todas las suites siguientes.

**¿Hace falta un helper?** Sí, uno pequeño: `conColaPausada(queue, fn)` en `helpers/queue.ts`, que
haga `pause()`, ejecute, y `resume()` en `finally`. Cinco sitios lo usarían hoy (los tres que ya lo
hacen a mano incluidos, si se quiere unificar) y evita el `finally` olvidado, que es la única forma
de que este arreglo haga daño. No hace falta un helper de aserción por jobId: son dos sitios y cada
uno afirma algo distinto.

---

## 2. Fuente 2 — aislamiento de claves `Setting` entre suites

### 2.1 Por qué el estado se filtra

- `seed-test.ts` siembra **17 claves** y corre **una vez por corrida**, en `globalSetup`
  ([setup-e2e.js](../apps/api/test/setup-e2e.js)). No hay re-siembra entre suites.
- `cleanDb` **excluye `Setting` a propósito** — dicho en
  [setup-e2e.js:47-52](../apps/api/test/setup-e2e.js#L47-L52) y en
  [invoicing-cron.e2e-spec.ts:51](../apps/api/test/invoicing-cron.e2e-spec.ts#L51).
- La batería corre `--runInBand`, en el orden de ficheros que decida Jest — que **no es estable**
  entre máquinas ni entre corridas con y sin caché.

De ahí la forma del fallo: la suite que rompe y la suite que se pone roja no son la misma, y el rojo
se mueve al añadir cualquier suite nueva. Es el rojo que más caro sale de investigar.

Claves sembradas (las que importan aquí): `badWordList`, `videoEnabled`, `bumpAutoEnabled`,
`freeActiveListingLimit`, `proActiveListingLimit`, `proMonthlyFeaturedQuota`, `proMonthlyBumpQuota`,
`bumpCreditCost`, `proExtraCreditsPercent`, `listingExpiryDays`, `contactRequiresVerification`,
`featuredCreditCost{7,14,30}d`, `proQuotaFeaturedDurationDays`, `proExtraBumpsPercent`.

### 2.2 El inventario de `freeActiveListingLimit` — 11 suites

**Restauran bien** (leen el valor previo y lo devuelven) — 7:

| Suite | Cómo |
|---|---|
| [tags-b2](../apps/api/test/tags-b2.e2e-spec.ts#L190) | El molde: guarda `limiteFreePrevio`, restaura o borra según hubiera fila (190-196, 217-224) |
| [borrado-cuentas-c2](../apps/api/test/borrado-cuentas-c2.e2e-spec.ts#L405) | `try/finally` **por caso** (405-410, 452-461) — el molde más estricto de los dos |
| [gates-pro-explican](../apps/api/test/gates-pro-explican.e2e-spec.ts#L41) | Array `TOCADOS` de 5 claves, snapshot y restauración genérica |
| [planes-limite-anuncios](../apps/api/test/planes-limite-anuncios.e2e-spec.ts#L40) | Igual, `TOCADOS` de 4 claves, con la razón escrita en la cabecera del fichero |
| [deteccion-telefonos-marcados](../apps/api/test/deteccion-telefonos-marcados.e2e-spec.ts#L114) | `cuotaOriginal` + restauración |
| [deteccion-avisos](../apps/api/test/deteccion-avisos.e2e-spec.ts#L101) | `cuotaOriginal` + restauración |
| [listing-gate-total-limit](../apps/api/test/listing-gate-total-limit.e2e-spec.ts#L352) | Restaura por la API de admin, con la nota de que es clave compartida |

**Reponen el valor que suponen del seed** (funciona hoy; se rompe el día que el seed cambie) — 2:

- [moderacion-aprobar](../apps/api/test/moderacion-aprobar.e2e-spec.ts#L73) — `afterEach` escribe `5` a mano.
- [listing-gate-email-verified](../apps/api/test/listing-gate-email-verified.e2e-spec.ts#L79) — `afterEach` escribe `5` a mano. **Y es la que lleva escrita la historia del mordisco de H9** ([líneas 259-268](../apps/api/test/listing-gate-email-verified.e2e-spec.ts#L259-L268)): «CUATRO suites más lo suben a 500 … Si alguna no llega a restaurarlo —o si el orden de Jest cambia al añadir una suite nueva—, la cuota no salta y este caso falla con un “200 en vez de 403” que no tiene nada que ver con lo que prueba. Se vio ocurrir una vez y no volver a reproducirse».

**Borran la fila** (el defecto señalado) — 2:

- [tags-b3:168](../apps/api/test/tags-b3.e2e-spec.ts#L168)
- [tags-b4:171](../apps/api/test/tags-b4.e2e-spec.ts#L171)

### 2.3 La corrección honesta: dónde muerde de verdad

Aquí el código desmiente al recuerdo en dos sitios, y los dos importan.

**(a) Borrar `freeActiveListingLimit` es hoy inocuo, y por casualidad.** Todos los lectores caen al
mismo número que siembra el seed:
`DEFAULT_FREE_ACTIVE_LIMIT = 5` ([listing-limits.ts:25](../apps/api/src/modules/listing-gate/listing-limits.ts#L25)),
`?? 5` en [billing.service.ts:1147](../apps/api/src/modules/billing/billing.service.ts#L1147),
`: DEFAULT_FREE_LIMIT` en [entitlement-expiration.service.ts:126](../apps/api/src/modules/expiration/entitlement-expiration.service.ts#L126),
y seed `5` ([seed-test.ts:95](../apps/api/prisma/seed-test.ts#L95)). Sin fila, el tope efectivo es 5
— el mismo. Lo único que cambia es el `configured: false` que ve el backoffice.
`tags-b3`/`tags-b4` **siguen estando mal** (dejan la base distinta a como la encontraron, y el día
que alguien cambie el seed o el default se separan sin aviso), pero **no son lo que puso H9 en
rojo**.

**(b) Lo que puso H9 en rojo es el 500 que no vuelve.** El daño real no es borrar: es que una suite
suba el tope a 500 y su restauración **no llegue a correr** —porque un `afterAll` anterior lanzó, o
porque la suite murió a mitad—. Entonces el 500 sobrevive y el siguiente test de cuota recibe un
200 donde esperaba un 403. Cinco suites suben el tope a 500 hoy: `tags-b2`, `tags-b3`, `tags-b4`,
`deteccion-telefonos-marcados`, `deteccion-avisos`. Que restauren en `afterAll` **no basta**: un
`afterAll` es exactamente lo que no corre cuando algo va mal.

**(c) Y hay una suite peor que las dos `tags`, que no estaba en la lista.**
[ajustes-interruptores.e2e-spec.ts:152](../apps/api/test/ajustes-interruptores.e2e-spec.ts#L152)
borra `videoEnabled`, `bumpAutoEnabled`, `attributeRevalidationEnabled` y `maxBumpSchedulesPerUser`
**dentro del cuerpo de un test**, y su `afterAll` (116-119) sólo cierra la app: no restaura nada.
Además, la última escritura de la suite es `ponerVideo(false)` (línea 212). Resultado: cuando esa
suite termina, **`videoEnabled` vale `false` y el seed lo dejó en `true`**. Y aquí la ausencia
**no** es equivalente: sin fila la feature está **apagada** (`sinFila: false`, línea 33), mientras
que el seed de test la enciende a propósito «para que las baterías puedan ejercitar la feature»
([seed-test.ts:89-93](../apps/api/prisma/seed-test.ts#L89-L93)). El valor efectivo **se da la
vuelta**.

Hoy eso está **latente, no vivo**: de los 12 ficheros que mencionan vídeo, los 4 que dependen del
interruptor (`ajustes-interruptores`, `video-infra`, `planes-anuncia-video`, `huerfanas-h2`) lo
fijan ellos mismos; los otros 8 no llaman a ningún endpoint que pase por `assertEnabled`. Es una
mina sin pisar. Pero es la prueba más clara de por qué la regla tiene que ser «restaurar», no
«borrar»: en `freeActiveListingLimit` el default tapó el fallo, y en `videoEnabled` no lo taparía.

Efecto lateral menor, dicho para no perderlo: `planes-anuncia-video` restaura *correctamente* el
valor que encontró — así que si corre después de `ajustes-interruptores`, restaura el `false` y lo
**propaga**. Restaurar bien no salva a nadie si quien va delante ya mintió.

### 2.4 El arreglo

**El helper cierra la clase entera, y hoy no existe.** `apps/api/test/helpers/` tiene
`async-state, create-app, db, deep-category-tree, meili, poll, queue` — **ninguno de `Setting`**.
Las 21 suites que escriben `Setting` lo hacen cada una a mano, con seis dialectos distintos
(`upsert`+`deleteMany`, `upsert`+`update`, `create`+`delete`, snapshot en array `TOCADOS`,
`try/finally` por caso, y reponer un literal). Esa dispersión **es** el defecto: no es que dos
suites se equivocaran, es que no había un sitio donde acertar una vez.

Propuesta, en `helpers/settings.ts`:

```
withSetting(prisma, key, value, fn)     // uno; snapshot → fn → restaura en finally
withSettings(prisma, { k: v, ... }, fn) // varios de golpe, misma garantía
```

Con `finally`, restaurando **la fila exacta** que había (valor previo, o *borrar* si no había fila —
que es lo que hace bien `tags-b2` y lo que hay que preservar: la ausencia también es un estado).

Reparto del trabajo:

| Qué | Cuántos | Esfuerzo |
|---|---|---|
| Escribir `helpers/settings.ts` | 1 fichero nuevo | pequeño |
| **Arreglar lo que está mal**: `tags-b3`, `tags-b4`, `ajustes-interruptores` | **3 suites** | pequeño |
| **Blindar el 500 que no vuelve**: mover el snapshot/restauración de `afterAll` a `withSetting` por caso en las 5 que suben a 500 | 5 suites (2 ya en la lista de arriba) | medio |
| Migrar al helper las 7 que ya restauran bien | 7 suites | opcional, cosmético |

**Mínimo para cerrar la fuente: 6 suites** (las 3 malas + las 3 que suben a 500 y sólo restauran en
`afterAll` y no están ya cubiertas). La migración de las 7 correctas es limpieza, no arreglo, y
puede ir después o no ir.

---

## 3. Fuente 3 — Google Fonts en tiempo de build

### 3.1 Confirmado, y es tan pequeño como parecía

Una sola importación en todo el monorepo:

```
apps/web/src/app/layout.tsx:2   import { Inter } from 'next/font/google';
apps/web/src/app/layout.tsx:8   const inter = Inter({ subsets: ['latin'] });
apps/web/src/app/layout.tsx:22  <body className={inter.className}>
```

- Es `next/font/google` → **descarga en build**. No hay ningún `next/font/local` en el repo.
- **No hay otra fuente de Google.** Es la única llamada a `next/font` que existe.
- **No hay ningún `.woff2`/`.ttf` en el repo** (`apps/web/public` y `apps/web/src` barridos): no hay
  nada que reutilizar, hay que traer el fichero.
- Sin `weight` y sin `variable` → Next se trae el **variable font** de Inter, subset `latin`. Un
  solo fichero.
- `tailwind.config` **no** declara `fontFamily`, y `globals.css` no menciona `font`. La fuente entra
  únicamente por la clase del `<body>`. Eso simplifica el cambio: no hay variable CSS que mantener.

En CI se construye **una vez**, en el job `e2e`
([ci.yml:278-279](../.github/workflows/ci.yml#L278-L279), `pnpm --filter @marketplace/web build`,
necesario para el `next start` de Playwright). El job `lint` no construye. Y el workflow cachea
**sólo el store de pnpm** (`cache: 'pnpm'`, líneas 26 y 187): no se restaura `.next`, así que la
descarga se repite en cada corrida. Un `ETIMEDOUT` ahí tumba el job entero — y con él, Playwright,
que es el 80 % del reloj.

### 3.2 El arreglo

Pasar a `next/font/local`: descargar el `.woff2` variable de Inter (subset latin) una vez, meterlo
en `apps/web/src/app/fonts/` (o `public/fonts/`), y cambiar las dos líneas del layout. Detalles
verificados:

- **Ficheros necesarios: uno.** El variable `latin` cubre los pesos 100-900 que hoy sirve
  `next/font/google` con esta misma configuración. Si se quisiera ser conservador, dos (normal +
  italic); hoy nada del proyecto pide itálica de Inter por nombre.
- **Toca sólo el layout raíz.** Es la única pieza, pero es la que hereda todo — de ahí que el
  cambio sea central y a la vez mecánico.
- **Lo visible no debe cambiar.** Misma familia, mismo subset, misma clase en el `<body>`. Un punto
  a fijar explícitamente: `next/font/google` aplica `display: 'swap'` por defecto y
  `next/font/local` **no** — hay que pasarlo a mano o el primer pintado cambia de comportamiento.
  Es el único detalle donde este cambio «mecánico» puede alterar algo perceptible.

> **Corrección tras implementar A3 (2026-08-27).** Dos afirmaciones de esta sección salieron mal, y
> las dos se descubrieron **construyendo las dos versiones y comparando el CSS emitido** — no
> leyendo la configuración, que es como se escribieron:
>
> 1. **`display: 'swap'` es el valor por defecto de los DOS cargadores** (verificado en
>    `next/font` 15.5, `validate-local-font-function-call.js`). El aviso de arriba era falso. Se
>    pasa explícito igual, pero por claridad, no porque hiciera falta.
> 2. **«Un fichero cubre lo mismo» es falso, y ése sí era el riesgo real.** `subsets: ['latin']`
>    no pedía un fichero: pedía **precargar** el latin. Google devolvía **siete** `@font-face` con
>    su `unicode-range` (latin, latin-ext, cyrillic, cyrillic-ext, greek, greek-ext, vietnamese) y
>    el navegador bajaba los demás bajo demanda. Con un solo fichero, un texto de usuario en
>    cirílico o con diacríticos de latin-ext cae al fallback de Arial en vez de pintarse en Inter.
>    Se aceptó a conciencia —lo descargado en una página normal es idéntico, y las alternativas
>    cuestan más de lo que arreglan— y está razonado entero en
>    [`apps/web/src/app/fonts/README.md`](../apps/web/src/app/fonts/README.md).
>
> La lección es la de la propia auditoría, aplicada a la auditoría: leer la configuración no es
> verificar. Lo que verifica es construir y mirar la salida.
- **Licencia:** Inter es **SIL Open Font License 1.1**, redistribuible con el software siempre que
  se incluya el aviso de copyright y la licencia. Se añade el `OFL.txt` junto al fichero de la
  fuente. No hay impedimento.

### 3.3 Lo que este arreglo **no** cubre

Hay una segunda dependencia de red en el build que no se ha auditado aquí (fuera de alcance, pero se
anota para no confundir un rojo con otro): el propio `pnpm install --frozen-lockfile` y la descarga
de navegadores de Playwright. Si un build cae por red **después** de este arreglo, no es la fuente.

---

## 4. Lo que NO entra

Dicho explícitamente para que nadie lo rehaga:

**Ya cerrado** — confirmado en [pendientes.md:545-549](pendientes.md#L545):

- **El flaky de indexación de Meilisearch.** Cerrado en su causa raíz (2026-08-22) con `waitForTask`
  en `applyFilterableAttributes`, y con una barrera que le pone cola a Meili a propósito para que la
  carrera sea reproducible. No es esta deuda.
- **El aislamiento de las corridas e2e.** Cerrado con el candado compartido
  `apps/api/test/e2e-lock.js`, que `setup-e2e.js` adquiere antes de nada (verificado en el fichero,
  líneas 30-33). Jest y Playwright ya no pisan la misma base a la vez.

**Decisión tomada, no deuda** — [pendientes.md:550-553](pendientes.md#L550):

- **Aislar la base de test por worker de Jest.** Se evaluó en el Hito 9 y **se decidió no hacerlo**:
  110 s en serie, el paralelismo ahorraría 60-70 s a cambio de orquestación no trivial. **No
  proponerlo otra vez.** (Nota: si algún día se retoma, lo que lo haría rentable no es el ahorro de
  tiempo sino que mataría la fuente 2 de raíz. Hoy no compensa, y la fuente 2 se cierra más barato
  con un helper.)

  > **Dato medido al implementar A1 (2026-08-27), sin propuesta detrás.** Corriendo la batería
  > entera en local: **159 suites, 2 424 tests, 585 s**. Los «110 s» de `pendientes.md:551` y las
  > «92 suites» de la línea 305 son de otro momento del proyecto — la batería ha crecido ~73 % en
  > suites y **5×** en reloj. Eso no reabre la decisión, que es de Ernest: sólo deja constancia de
  > que su aritmética («ahorraría 60-70 s») descansa en una cifra caducada, para que si alguien la
  > revisa parta del número real y no del viejo.

**Rojos conocidos que no son de este grupo** (para no mezclarlos en el veredicto):

- `queue-retry › "Retry real"` — flaky por timing de indexación de Meili, preexistente y anotado en
  `pendientes.md:309`. Es un flake real pero de otra familia (espera de Meili, no conteo de cola).
  No entra en el Grupo A porque su arreglo es el de los otros dos hermanos sin `waitForTask`
  (`removeListing`, `reindexAll`), que ya está señalado en su sitio.

  > **CADUCADO (2026-09-04).** Medido de nuevo: **pasa, y pasa siempre**. Ni el diagnóstico de
  > «espera de Meili» ni el posterior de `attempts = 0` describen lo que hace hoy. Detalle y la
  > explicación más probable —los procesos huérfanos del `reindex`, ya cerrados— en §7.3.
- Familia `@2b` de Playwright — bug de producto conocido, aislado del veredicto con
  `continue-on-error`. **Tolerado, no resuelto**, y así consta.
- `admin-roles.spec.ts` afirma el número exacto de ítems del nav — frágil por diseño, pero
  determinista. No es un rojo fantasma.

---

## 5. Plan de ráfagas

Tres ráfagas, una por fuente. Son independientes: ninguna toca lo que tocan las otras (una toca
`test/helpers/queue.ts` + 2 specs de backend, otra toca `test/helpers/` + 6 specs, la tercera toca
`apps/web/src/app/layout.tsx`). Se pueden hacer en cualquier orden y en paralelo.

**Orden recomendado por relación coste/rescate: A3 → A1 → A2.**

### Ráfaga A3 — la fuente sale del build *(la más pequeña, y la que más rescata)*

Un fichero de fuente al repo, dos líneas de layout, un `OFL.txt`. Cierra la única dependencia de red
del build sobre la que tenemos control. Va primera porque cuando muerde no tumba un test: tumba el
job entero, y con él Playwright.

### Ráfaga A1 — la cola deja de ser un dado ✅ HECHA (2026-08-27)

`conColaPausada` en `helpers/queue.ts`; 5 casos reescritos en 2 ficheros; la nota del helper
corregida (§1.4: los jobId no bastan); c5 pasa a usar el helper. Segunda porque es acotada y el
diagnóstico está cerrado.

**Lo que las mutaciones enseñaron, y que no estaba en el plan.** Al mutar `conColaPausada` para que
no pausara (con el retardo de 2,5 s puesto) cayeron **4 de los 5** casos. El quinto —«SOLD no
encola»— pasó, y **tenía que pasar**: afirma una AUSENCIA, y quitar la pausa sólo puede hacer
desaparecer jobs, nunca aparecer uno. Que su barrera valga algo hubo que probarlo por el otro lado,
mutando **producción** (quitarle al barrido el filtro `listing: { status: 'ACTIVE' }`):

| | con pausa | sin pausa (+2,5 s) |
|---|---|---|
| producción sana | verde | **4 casos rojos** |
| producción rota (sin filtro `ACTIVE`) | **rojo — lo caza** | **verde — falso** |

Esa última casilla es el hallazgo: sin la pausa, el caso SOLD pasaba **en verde justo cuando el
defecto que vigila estaba presente**, porque el worker se llevaba el job mal encolado antes de que
el test mirara. No era un test racy: era un test **decorativo**. La pausa es lo que lo convierte en
barrera.

### Ráfaga A2 — los `Setting` dejan de contaminarse ✅ HECHA (2026-08-27)

`helpers/settings.ts` nuevo; 3 suites arregladas (`tags-b3`, `tags-b4`, `ajustes-interruptores`); 3
más blindadas (el 500 pasa de `afterAll` a `try/finally` por caso); opcionalmente 7 migradas. Va
última porque es la que más ficheros toca y la que más se beneficia de tener el CI ya estable
mientras se hace.

**Tres cosas salieron distintas del plan, y las tres se dicen enteras.**

**(a) La premisa de «por caso, porque el `afterAll` puede no correr» es más estrecha de lo que
parecía.** Comprobado con dos specs de juguete: **Jest ejecuta `afterAll` aunque el test falle y
aunque `beforeAll` lance**. Lo único que se lo salta es que el proceso muera de golpe — y ahí un
`finally` por caso tampoco corre. Así que el reparto se hizo por dónde hace falta el ajuste, no por
dogma: `withSetting` por caso donde el ajuste sólo hace falta en un tramo (`tags-b3`/`tags-b4`, que
sólo lo necesitan mientras el fixture publica: cuando arranca el primer `it` la clave ya está
restaurada), y una forma de SUITE (`ajustesDeSuite`) donde el fixture lo necesita en los veinte
casos. Envolver veinte cuerpos de test no compraba nada frente a eso y escondía el ajuste en veinte
sitios en vez de declararlo en uno.

**(b) Lo que de verdad cierra la clase es una barrera de CORRIDA, no de suite.**
`test/verificar-aislamiento-settings.ts`, lanzada desde el `globalTeardown`, compara las 17 claves
sembradas contra `SETTINGS_SEMILLA_TEST` — valor y existencia de fila. Es la única que puede ver el
defecto, porque el defecto es invisible desde dentro: con `ajustes-interruptores` devuelto a su
estado anterior, **la suite pasa 8/8 en verde y la corrida cae en el teardown** señalando
`videoEnabled: true → false` y `bumpAutoEnabled: SIN FILA`. Esa es la forma exacta del rojo que
mordió en H9, atrapada donde sí se ve.

**(b bis) Y la barrera encontró DOS suites más, que el inventario de §2 no tenía.** En su primera
corrida completa señaló cuatro claves sucias, y sólo una era de las esperadas:

| Clave | Quedaba en | Culpable | Por qué |
|---|---|---|---|
| `badWordList` | `["spam","fraude"]` | `admin` | los casos de `PATCH /admin/settings` la cambian y nadie la devuelve |
| `listingExpiryDays` | `90` | `admin` | ídem |
| `proMonthlyFeaturedQuota` | `6` | `admin` | ídem |
| `videoEnabled` | `false` | `video-infra` | su `afterAll` hacía `encender(false)` — un literal, no lo que encontró |

Las dos son variantes del mismo defecto y ninguna estaba en la lista, **porque §2 barrió
`freeActiveListingLimit` y no todas las claves**. Ese sesgo es justo lo que una barrera de corrida
corrige: no depende de que alguien se acuerde de mirar la clave correcta.

`admin` tiene además la ironía útil: su `beforeAll` fija cuatro claves «para empezar en valores
conocidos **pase lo que pase por lo que dejara una corrida anterior**, p. ej. `badWordList` puesta a
`["spam","fraude"]`». Se estaba defendiendo de su propio rastro de la corrida anterior sin saberlo.
Y `video-infra` es la tercera aparición del mismo error que `ajustes-interruptores` y `tags-b3/b4`:
**reponer un literal no es restaurar** — el `false` que escribía es el valor por defecto de
producción, mientras que la semilla de test lo pone en `true` a propósito.

**(c) Un defecto propio, encontrado al escribir la barrera.** La primera versión importaba la lista
de `seed-test.ts` — que es un script con `main()` de nivel superior. Importarlo **sembraba**: la
barrera reparaba la contaminación justo antes de ir a buscarla, y salía verde siempre. Se vio porque
el `Test seed: ... OK` aparecía por consola después de «Ran all test suites». La lista se sacó a
`prisma/settings-test.ts`, que es lo que `seed-settings.ts` ya había hecho por esta misma razón y en
su día. Segundo defecto del mismo día: `Setting.value` es `Json` NO NULABLE, así que restaurar una
fila que valía `null` exigía `Prisma.JsonNull` — sin eso el helper reventaba dentro del `finally`,
o sea limpiando un test que ya estaba fallando.

---

## 6. Las barreras — cómo se sabe que cada una cerró

Una barrera que pasa igual con el arreglo revertido es decorativa. Para las tres, la barrera tiene
que **fallar antes y pasar después**:

**A1 · La cola.** Reproducir la carrera a propósito, que es lo que ya se hizo en c2: meter una espera
(2,5 s bastó allí) entre la acción y la lectura, **sin** la pausa. El test debe caer. Con la pausa
puesta, debe pasar con la misma espera. Segunda barrera, estructural: un test que recorra
`test/*.e2e-spec.ts` y falle si alguna lectura de una cola registrada por `retryQueue` ocurre fuera
de `conColaPausada` — el mismo molde que ya usa `queue-retry.e2e-spec.ts` para vigilar los
`registerQueue` que se saltan el helper. Sin esa segunda barrera, la fuente vuelve en el siguiente
test que cuente jobs.

**A2 · Los `Setting`.** La barrera que de verdad prueba el aislamiento es **de corrida, no de
suite**: un `globalTeardown` (o un último spec) que relea las 17 claves sembradas y afirme que están
**exactamente** como las dejó `seed-test.ts` — valor y presencia de fila. Hoy esa comprobación
**falla**, y falla por al menos dos motivos ya localizados (`videoEnabled` en `false`,
`bumpAutoEnabled` sin fila). Que hoy falle es lo que la hace válida. Además, un caso puntual: un
test que suba el tope a 500, lance a propósito dentro del bloque, y compruebe que `withSetting`
restauró igual — es el escenario exacto que mordió en H9 y el que un `afterAll` no cubre.

**A3 · La fuente.** La barrera es que el build **no toque la red para la tipografía**: construir con
el acceso a `fonts.googleapis.com` / `fonts.gstatic.com` cortado (`/etc/hosts` a `127.0.0.1`, o el
runner sin salida) y que termine verde. Antes del arreglo, ese mismo build debe caer con
`ETIMEDOUT`. Y una barrera visual mínima en Playwright: que el `font-family` computado del `<body>`
siga empezando por `Inter`, para que «servida distinto» no acabe siendo «no servida».

---

# 7. Grupo B — los tres rojos de la migración de estilo (2026-09-04)

Tres ráfagas seguidas (trazo, E5, E5 sobre `main`) terminaron con un rojo de CI que se pasó
relanzando. Los tres tenían la misma **forma** —cero aserciones de producto rotas, algo que falla
alrededor del test— y de ahí la sospecha de una raíz común: colas de BullMQ que no cierran.

**La sospecha era falsa, y las raíces son dos.** Y ninguna de las dos es «una cola que no cierra».

## 7.0 Veredicto en una tabla

| Rojo | Dónde se midió | Raíz medida | ¿Cura o etiqueta? |
|---|---|---|---|
| `alert-matching › Fase 1 › cada match confirmado crea una Notification` | Run 33792790284, intento 1 (`1 failed, 2696 passed`) | **Dos ejecuciones concurrentes de `matchListing`** — la del worker y la del propio test — y la deduplicación por P2002 hace que la perdedora se salte el aviso | **Curado**: la cola parada durante el fixture |
| `comandos-standalone › Test suite failed to run` | Run 33806309062 (`2697 passed, 2697 total` **y la suite en rojo**) | **Una `Queue` cerrada mientras su conexión todavía se abría**; BullMQ emite el fallo como evento `'error'` sobre un `EventEmitter` sin oyente | **Curado**: `waitUntilReady()` antes de cerrar |
| `queue-retry › Retry real` | Medido hoy, 10+ corridas | **No es un flake vivo.** La nota de §4 está caducada | Sin etiqueta; se corrige una **inversión de plazos** que sí existía |

Nada quedó marcado `@2b`: no hizo falta, porque nada resultó irreducible.

## 7.1 `alert-matching` — dos pasadas de matching a la vez

### El mecanismo, confirmado

`publish()` no es inerte: `IndexingProcessor` encola un trabajo de `alert-matching` en cuanto el
documento es consultable en Meilisearch. Cinco tramos de la suite hacían, además, un
`matching.matchListing()` **a mano** para no depender de tiempos. Resultado: el mismo trabajo
corriendo dos veces en paralelo.

Las dos pasadas **no son intercambiables**. La deduplicación vive en el `alertMatch.create`
([alert-matching.service.ts](../apps/api/src/modules/alerts/alert-matching.service.ts)): quien
pierde la carrera recibe un P2002 y hace `continue`, **saltándose la creación del aviso**. Así que
si el worker ganaba el `create` y todavía estaba escribiendo el aviso, la pasada del test no
escribía ninguno y el test leía cero. Es exactamente el rojo de CI:
`expect(match).toBeDefined() → Received: undefined`, con los cuatro `hasMatch` de al lado en verde.

### Reproducido, no supuesto

Copia de la Fase 1 con **una** diferencia: `createNotification` retrasado 2 s, para ensanchar una
ventana que en CI dura lo que dura un `INSERT`. Resultado con el escenario de hoy: **rojo
siempre**, con la firma idéntica a la del CI (y «el match existe» en verde al lado, como en CI).

### La cura

`conColaPausada(colaDeMatching, …)` alrededor del tramo del fixture — el molde de A1, aplicado por
TRAMO y con `finally`. Con la cola parada, la pasada del test es la única, y las cinco aserciones
—presencia, ausencia y aviso— dicen lo que parecen decir. Con el mismo ensanchado de 2 s: **verde**.

Dos añadidos que salieron de escribirlo:

- Se **espera a ver el trabajo** en la cola parada antes de seguir. `waitForIndex` mira
  Meilisearch, y el encolado ocurre después de que el documento sea consultable: sin esa espera el
  test podía adelantarse al encolado. De regalo, afirma que la tubería real sigue encolándolo.
- Se **descarta** (`drain`) el trabajo duplicado. Dejarlo suelto para que se procese al soltar la
  pausa lo pondría a correr sobre un escenario que para entonces ya es otro — sembrando la
  siguiente carrera en vez de cerrar ésta. Dos casos lo necesitan de verdad: los de `renew()` y
  `reserve()/closeDeal()` crean una alerta **después** y afirman que nada la empareja.

**Por qué pausar y no esperar.** Un `pollUntil` al aviso también quitaba el rojo — es lo que se
hizo en el bloque de deduplicación cuando esto mordió por primera vez. Pero deja viva la
concurrencia: las aserciones de AUSENCIA siguen midiendo un escenario a medio hacer. La pausa quita
la causa; el poll, el síntoma.

## 7.2 `comandos-standalone` — cerrar una conexión que todavía se abría

### El mecanismo, confirmado línea a línea

El rastro de CI señala dos sitios y los dos son exactos:

```
Unhandled error. (Error: Connection is closed.
  at close (ioredis/built/redis/event_handler.js:214:25)      <- quien CREA el error
  ...
  at bullmq/dist/cjs/classes/redis-connection.js:87:45)       <- quien lo DEJA SUELTO
```

La línea 87 es, literalmente, `this.initializing.catch(err => this.emit('error', err))`, enganchada
**en el constructor** de `RedisConnection`. Una `Queue` recién creada abre su conexión en segundo
plano; si se la cierra mientras ese `init()` tiene un comando en vuelo, ioredis rompe la promesa con
«Connection is closed.» y BullMQ la emite como evento `'error'` sobre una `Queue` que nadie escucha.
Un `EventEmitter` sin oyente de `'error'` **lanza**, y Jest lo cuenta como fallo de la suite entera
— de ahí el «2697 passed, 2697 total» con la suite en rojo.

Nótese que la dirección es la **contraria** a la hipótesis: no es una conexión que no se cierra, es
una que se cierra **demasiado pronto**.

### Reproducido de forma determinista

Un proxy TCP que retrasa los bytes hacia Redis convierte una ventana de microsegundos en algo
medible. Barriendo el instante del cierre, con 200 ms por salto:

| Cierre a los… | Sin cura | Con `waitUntilReady()` |
|---|---|---|
| 0-800 ms | verde | verde |
| **900 ms** | **ROJO — Connection is closed.** | verde |
| **1000 ms** | **ROJO** | verde |
| 1200 ms | **ROJO** | verde |
| 1400 ms | verde (el `init()` ya había terminado) | verde |

Y en el spec real, sin proxy y en una máquina ociosa, `waitUntilReady()` **todavía tardaba 1-3 ms
en 4 de 5 corridas**: la ventana está abierta también aquí, sólo que es diminuta. En un runner
cargado se ensancha hasta que el cierre cae dentro.

### La cura

`await cola.waitUntilReady()` antes de cerrar el contexto. No esconde nada: el `init()` termina y ya
no queda promesa que romper. Silenciarlo con un `on('error')` de adorno sí habría sido taparlo.

### Un defecto vecino, encontrado por el camino

`ReviewsModule` levantado a pelo se queda **sin configuración de conexión**, y BullMQ cae a su
defecto: `localhost:6379`, **db 0** — la Redis de DESARROLLO. Visto en un `CLIENT LIST`: la
conexión de ese contexto aparecía en `db=0` haciendo `hset`, que es BullMQ escribiendo
`bull:<cola>:meta` al inicializarse. La batería de test escribía en la Redis de quien la ejecuta.
Cerrado dándole al contexto su propio `BullModule.forRoot` con la conexión de test — que además lo
acerca a producción, donde ese módulo siempre cuelga de `AppModule`.

## 7.3 `queue-retry` — la nota de §4 está caducada

§4 lo listaba como «flaky por timing de indexación de Meili», y
[estado-tecnico.md](estado-tecnico.md) lo daba por **determinista en rojo** con un diagnóstico
concreto: `waitForIndex` volvía en ~80 ms con `attempts = 0`, o sea que el trabajo lo procesaba algo
que no era el `IndexingProcessor` espiado.

**Medido hoy: pasa, y pasa siempre.** El caso «Retry real» tarda ~2,3 s —justo el backoff
exponencial de 2 s más el indexado—, que es la firma de un reintento que ocurre de verdad. La
explicación más probable de que ya no falle es la ráfaga `reindex-aislamiento` (2026-09-03): los
procesos huérfanos de `pnpm reindex` que seguían **consumiendo de las mismas colas** eran el
sospechoso anotado en [pendientes.md](pendientes.md) §4.3, y ese comando ya termina y cierra.

Lo que sí tenía, y se corrige, es una **inversión de plazos**: el caso llevaba `}, 20_000)` mientras
la espera de dentro (`waitForIndex`) tiene un presupuesto de **60 s en CI**
(`DEFAULT_TIMEOUT_MS`). En un runner lento, Jest mataba el test antes de que la espera pudiera
agotarse y contar lo que había visto: el rojo salía como «Exceeded timeout of 20000 ms», que no dice
nada. Quitar el plazo local **no alarga ninguna espera** —el presupuesto sigue siendo el de
`waitForIndex`— y deja que sea él quien declare el fallo, bajo el `testTimeout: 120000` de
`jest-e2e.json`, que está puesto exactamente para eso.

## 7.4 La hipótesis de raíz común: refutada

La sospecha era «cada `registerQueue` crea su propia `Queue`, y esas conexiones se quedan colgando
en el teardown». Medido:

- **La batería no deja ninguna conexión colgando.** La barrera nueva (§7.5) lo comprueba en cada
  corrida y sale verde con la batería entera.
- **Ninguno de los tres rojos era eso.** Uno era concurrencia de dominio (dos pasadas de matching),
  otro era el cierre demasiado **pronto** de una conexión, y el tercero no era un flake.
- Lo único que la hipótesis acertó es el **hecho** de partida —cada `registerQueue` tiene su propia
  `Queue`, con su propia conexión—, que es justo lo que hace que el caso de §7.2 exista.

## 7.5 La barrera — ninguna suite deja una conexión abierta

`test/verificar-conexiones-redis.ts`, lanzada desde el `globalTeardown` junto a la de aislamiento de
`Setting`. Mismo razonamiento que aquélla: el defecto es **invisible desde dentro**, así que la
comprobación tiene que ser de CORRIDA.

- Pregunta al **servidor** (`CLIENT LIST`), no al proceso: así ve la `db`, el último comando y la
  edad de cada conexión — lo que hace falta para culpar a alguien sin reproducir.
- Discrimina por **marca de agua**, no por `db`. El `globalSetup` deja escrito el id que Redis dio a
  su propia conexión (`marca-conexiones-redis.js`); los ids son crecientes, así que `id > marca` es
  «se abrió durante la batería». La primera versión filtraba por la db de test **y era ciega justo
  donde hacía falta**: la conexión colgada de §7.2 estaba en la db 0. La marca no tiene que adivinar
  la db.
- **Punto ciego declarado:** si el backend de desarrollo de la máquina reconecta mientras corre la
  batería, aparecerá señalado. Por eso el informe imprime `db`, `name`, `cmd` y `age` de cada uno.
  En CI no hay nadie más conectado.

**Mutación.** Quitándole el `await app.close()` al contexto con cola de `comandos-standalone`: la
suite sigue diciendo **`Tests: 8 passed`** y la corrida cae en el teardown con
`· id=6807 172.18.0.1:54168 db=1 name="" cmd=hset age=8s`. Esa es la forma exacta del defecto que
vigila, atrapada donde sí se ve.

**Y las dos barreras corren SIEMPRE las dos.** Si la de `Setting` cortara a la de conexiones,
arreglar la primera destaparía la segunda en la corrida siguiente — un rojo por vuelta en vez de la
foto entera. Se acumulan los fallos y se informa de todo.

**Sin `--forceExit`.** La batería no lo usa ni lo usará: un exit forzado hace que una corrida con
conexiones colgando sea indistinguible de una limpia — la lección del `reindex`, donde una `Queue`
siguió viva y con 517 MB dos minutos después de acabar el trabajo. Jest ya avisa («Jest did not exit
one second after the test run has completed») pero lo dice sin nombrar al culpable y **no pone la
corrida en rojo**. La barrera es lo que convierte «la batería termina» en «la batería termina PORQUE
todo está cerrado».
