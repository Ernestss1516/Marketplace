# Estrategia y patrones de testing — Marketplace

> **Manual de estrategia y patrones**, verificado contra el código y la configuración reales el
> **2026-08-04** (rama `main`, commit `ff333ab`).
>
> **Esto no es el registro de lo que pasó.** La crónica —qué saga cerró qué, con fechas, commits
> y SHAs— vive en `estado-tecnico.md`. Este documento responde a *«cómo testeo aquí»*: qué
> patrones usar, cómo correr las baterías, qué reglas seguir. Cuando el porqué histórico importe,
> aquí va el principio y la remisión; la historia no se copia.
>
> **Donde este documento y el código difieran, gana el código.**

<details>
<summary><strong>Qué cambió en la revisión del 2026-08-04</strong> (auditoría de documentación)</summary>

La versión anterior era el entregable de RT.1 (2026-06-23) y describía el plan **antes** de
escribir la primera suite. Se corrigió:

- Se retira la autodeclaración de *«fuente de verdad del plan de testing»*: la fuente de verdad
  del estado es `estado-tecnico.md`, y la del comportamiento es el código.
- **4 suites de backend y 1 spec de Playwright** → los números reales de hoy (§4).
- **`waitForIndex` ya no es el patrón principal.** Sigue existiendo y sigue siendo correcto para
  un caso concreto, pero la cura del flaky fue otra cosa y en otra capa (§5).
- Se retira `POST /listings/:id/sold`, que ya no existe: el flujo de venta es `Deal`.
- El CI ya no es *«compatible sin cambios de código»*: tiene split señal/`@2b`, contenedores de
  servicio, MinIO arrancado como paso y `webServer` en modo producción (§7).
- Se añaden las barreras estructurales que no existían cuando se escribió: el candado
  compartido, los resets entre suites y `async-state.ts`.

</details>

---

## 1. Filosofía y alcance

El objetivo no es cobertura de líneas, sino **confianza en los flujos críticos**: que un usuario
pueda registrarse, publicar un anuncio, encontrarlo en la búsqueda, contactar con el vendedor,
cerrar el trato y pagar. Los tests son la red de seguridad que permite refactorizar sin romper lo
que ya funciona.

Esa filosofía no ha cambiado desde que se escribió. Lo que ha cambiado es la superficie: hoy hay
**29 módulos de backend** y el producto ha pasado por ocho hitos.

**Qué se prueba:**

| Ámbito | Capa | Herramienta |
|---|---|---|
| Contratos HTTP de cada módulo, incluidos permisos por rol | Backend e2e | Jest + Supertest |
| Efectos asíncronos reales (cola → worker → Meilisearch/Postgres) | Backend e2e | Jest, servicios reales |
| Lógica pura extraída a funciones (matrices de estado, parsers, periodos) | Backend unit | Jest |
| Recorridos de usuario sobre el stack levantado | Frontend e2e | Playwright |
| Componentes aislados | Frontend unit | Jest + jsdom |

**Dos criterios de diseño que conviene entender antes de escribir un test:**

1. **Servicios reales, no mocks.** No se mockean Prisma, Redis ni Meilisearch. Los mocks dan
   falsa seguridad: no detectan incompatibilidades de contrato ni bugs de integración, que es
   justo lo que estos tests existen para encontrar.
2. **La lógica difícil se extrae para poder probarla sin clics.** Cuando una regla es una matriz
   (estado × rol × asignación) o una decisión de calendario, se extrae a una función pura y se
   prueba entera con un unit test. Los dos ejemplos canónicos, uno a cada lado:
   `period.ts` en el backend (`modules/invoicing/period.spec.ts` — día de emisión, periodo que no
   toca, recuperación multi-periodo) y `resolveStaffActions()` en el frontend
   (`components/tickets/staff-actions.test.ts` — la matriz entera de acciones del backoffice de
   tickets). El e2e comprueba entonces que esa función está *conectada*, no las 40 combinaciones.

### Qué NO se prueba hoy — de verdad

Esto no es una lista de intenciones: es el hueco real, y conviene que esté escrito.

- **No hay barrido explícito de cobertura.** La batería creció **orgánicamente**: una spec por
  feature, según se construía. Nadie ha auditado qué falta. Es la parte pendiente de RD9.3
  (ver `pendientes.md` §4.2) — no la de «Playwright en CI», que sí está hecha.
- **La familia `@2b` está tolerada, no resuelta.** Son los tests que chocan con la carrera de
  navegación del App Router bajo `next start`, un bug conocido de Next 15 sin arreglo upstream.
  Corren aparte y no bloquean el pipeline (§7).
- **⚠️ El CI NO ejecuta los unit tests del backend.** Los 17 ficheros `*.spec.ts` de
  `apps/api/src/` existen y `pnpm --filter @marketplace/api test` los corre, pero **ningún paso de
  `ci.yml` lo invoca**: el workflow tiene «Backend e2e — Jest» y «Frontend unit — Jest», y no su
  equivalente de backend. Se quedan fuera piezas de lógica pura que nadie más cubre —
  `period.spec.ts`, `search-query.parser.spec.ts`, `spanish-tax-id.spec.ts`,
  `filterable-attributes.resolver.spec.ts`. Detectado en la auditoría del 2026-08-04; **el arreglo
  es un paso de una línea**, pero no se aplicó en esa ráfaga porque tocaba el workflow y no la
  documentación.
- **Rendimiento y carga:** nada.
- **Procesado de imágenes (sharp/MinIO):** no se afirma sobre el resultado del procesado, solo
  sobre el contrato de subida.
- **Observabilidad:** los tests no afirman nada sobre Sentry ni sobre logs. Los eventos de Sentry
  son efectos secundarios, no contratos de API; se verifican con smoke tests en staging.
- **Deuda de test viva y conocida:** el flaky de `queue-retry › "Retry real"` (timing de
  indexación; los 14 estructurales de esa suite sí son fiables) y la fragilidad de
  `admin-roles.spec.ts`, que afirma el número exacto de ítems del nav — al tocar `AdminNav` hay
  que actualizar las tres cuentas.

---

## 2. Herramientas

| Capa | Herramienta | Dónde se configura |
|---|---|---|
| Backend e2e | **Jest + Supertest** | `apps/api/test/jest-e2e.json` |
| Backend unit | **Jest** | `apps/api` (config por defecto de Nest) |
| Frontend e2e | **Playwright** | `apps/web/playwright.config.ts` |
| Frontend unit | **Jest + jsdom** | `apps/web` |
| WebSocket en tests | `socket.io-client` | — |

---

## 3. Aislamiento de servicios

Los tests usan los **mismos contenedores Docker** que el desarrollo, con **identificadores
distintos**. No hace falta levantar infraestructura adicional.

| Servicio | Dev | Test | Cómo se aísla |
|---|---|---|---|
| **PostgreSQL** | DB `marketplace` | DB `marketplace_test` | `DATABASE_URL` en `.env.test` |
| **Redis** | DB 0 | **DB 1** (`redis://localhost:6379/1`) | `REDIS_URL` en `.env.test` |
| **Meilisearch** | índice `listings` | índice `listings_test` | `MEILI_INDEX_NAME` |
| **MinIO** | bucket `marketplace` | bucket `marketplace-test` | `S3_BUCKET` en `.env.test` |

El fichero de referencia es `apps/api/.env.test`, en `.gitignore` como el `.env` de desarrollo.

### 3.1 Crear la base de datos de test (una sola vez)

```bash
pnpm --filter @marketplace/api test:setup:db
# equivale a: docker exec marketplace-postgres psql -U marketplace -c "CREATE DATABASE marketplace_test"
```

En CI la crea el contenedor de servicio. Las migraciones se aplican solas en cada ejecución
(`prisma migrate deploy` desde `globalSetup`).

### 3.2 EL CANDADO — la batería de backend y la de Playwright NO pueden correr a la vez

`apps/api/test/e2e-lock.js`. **Es la barrera más importante de todo el tooling**, y la que más
tiempo ahorra.

Las dos baterías comparten `marketplace_test` y la db 1 de Redis. Si corren a la vez, el
`cleanDb` de una trunca `User CASCADE` mientras la otra está a mitad de setup, y aparecen
síntomas que engañan: 403 donde debería haber 200, `globalSetup` que revienta sin motivo. Pasó
tres veces y las tres se diagnosticó como «regresión» antes de caer en la cuenta.

Estaba anotado como deuda de tooling —«acordarse» de no hacerlo—. **Acordarse no es un
mecanismo.** Ahora la segunda corrida **aborta al instante** diciendo qué está en marcha, con qué
PID y desde cuándo. El candado es un **directorio** (`mkdir` es atómico; «comprobar y crear» tiene
ventana de carrera) y uno huérfano se detecta por el PID y se rompe solo, así que nunca deja el
proyecto bloqueado.

Lo cogen los dos `globalSetup` (Jest y Playwright) y lo sueltan los dos `globalTeardown`. Es un
`.js` sin TypeScript a propósito: lo carga el `globalSetup` de Jest, que no pasa por `ts-jest`.

### 3.3 Los resets, en dos niveles

| Barrera | Cuándo | Qué hace |
|---|---|---|
| `reset-test-db.js` | **Entre corridas** (`globalSetup`) | TRUNCATE de todas las tablas antes de sembrar. Sin él la base solo crecía: el seed es de *upserts* y nada borraba — se llegó a 2 775 categorías donde el seed pone ~20 |
| `flush-meili-test-index.js` · `flush-redis-test-db.js` | **Entre corridas** | Vacían índice y db 1 |
| `reset-categories-between-suites.ts` | **Entre suites** (`setupFilesAfterEnv`) | Ninguna suite deja categorías detrás |
| `reset-redis-between-suites.ts` | **Entre suites** | Ídem con las claves de Redis |

Las dos capas hacen falta: sin la primera la base crece para siempre; sin la segunda, dentro de
una misma corrida un spec que crea 24 categorías se las deja a los 80 siguientes.

> **Por qué van en un `setupFilesAfterEnv` y no en un `afterAll` por spec.** La auditoría
> encontró 22 specs que crean categorías y solo 6 que borran algo. Añadir el teardown a mano en
> los 16 restantes resuelve el problema hoy y lo reabre mañana: el spec número 93 volverá a
> olvidarlo. Mismo criterio que el candado — **un mecanismo compartido, no una convención que
> cada test recuerde aplicar.**

---

## 4. Organización de las suites

**No se listan una a una** — son demasiadas y la lista quedaría obsoleta a la primera ráfaga. Lo
que hay que saber es dónde vive cada cosa y cómo se nombra.

| Batería | Ubicación | Patrón | Cuántas hoy |
|---|---|---|---|
| Backend e2e | `apps/api/test/` | `*.e2e-spec.ts` | **92 suites** (~1 476 tests) |
| Backend unit | junto al código, en `apps/api/src/` | `*.spec.ts` | **17** |
| Frontend e2e | `apps/web/e2e/` | `*.spec.ts` | **44 specs** (271 tests: 248 de señal + 23 `@2b`) |
| Frontend unit | `apps/web/src/` | `*.test.ts(x)` / `*.spec.ts(x)` | **32 suites** (378 tests) |

**Regla de nombres: una spec por feature o por módulo, con el nombre de la feature.** Los
prefijos de ráfaga (`h6-6-`, `h8-d3-`, `rc5-`) identifican de qué ráfaga salió; los descriptivos
(`favorites`, `moderation`, `tickets-adjuntos`) identifican qué cubren. Al añadir una feature, se
añade su spec — **en la misma ráfaga, no en una posterior**.

**Helpers de backend** (`apps/api/test/helpers/`):

| Helper | Para qué |
|---|---|
| `create-app.ts` | `createTestApp()` — construye el `INestApplication` de test. **Levanta también los workers de BullMQ**: sin llamarlo, ningún efecto asíncrono ocurre |
| `db.ts` | `cleanDb()`, `resetMeili()`, `buildMeiliClient()` |
| `async-state.ts` | `pollFor()`, `waitUntil()` — la política única de espera (§5) |
| `meili.ts` | `waitForDocumentWhere()`, `waitForDocumentField()`, `waitForIndex()`, `waitForRemoval()` |
| `poll.ts` | `pollUntil()` — envoltorio legado que delega en `waitUntil` |

**Helpers de Playwright** (`apps/web/e2e/helpers/`):

| Helper | Para qué |
|---|---|
| `api.ts` | `loginViaApi()`, `loginAdminViaApi()`, `authedPost/Get/Delete()`, `pollSearch()` — hablar con el backend sin pasar por la UI |
| `nav.ts` | `clicarYEsperarUrl()` — clic + espera de URL **con reintento del clic** (§10.3) |
| `wait-for-card.ts` | `waitForCard()` — esperar a que un anuncio aparezca en un listado |
| `seed-listings.ts` | `publicarAnuncio()`, `limpiarAnunciosPorPrefijo()` — sembrar sin dejar generaciones huérfanas |
| `wizard.ts` | `cruzarPasoEtiquetas()` — cruza el paso «Etiquetas», que **solo existe si la categoría tiene tags efectivos** |

---

## 5. Asincronía — cómo se espera un estado

**Es la fuente número uno de rojos que rotan, y de verdes falsos.** Casi todo lo interesante del
backend termina en un job de BullMQ: publicar encola la indexación, un webhook de pago encola la
concesión del entitlement. El test hace la petición HTTP y el efecto llega **después**.

Hay dos mecanismos, **en capas distintas**, y confundirlos es el error clásico.

### 5.1 En producción: indexación determinista (`waitForTask`)

**Esta fue la cura de raíz del flaky, y no es un helper de test: es código de producción.**

`SearchService.indexListing()` llama a `waitForTask(task.taskUid)` después de `addDocuments()`.
Sin eso, `addDocuments()` es *fire-and-forget*: el job de BullMQ se daba por completado aunque
Meilisearch todavía no hubiera procesado la tarea, así que el documento no era consultable — y no
solo en los tests, también para un usuario real, durante una ventana breve e impredecible.

Con `waitForTask`, **el job no completa hasta que el documento es consultable**. Lo mismo hace
`clearAll()` antes de repoblar en el `reindex`.

> Consecuencia práctica: los tests ya no compiten contra el worker. Siguen necesitando esperar a
> que el *job* se procese, pero ya no a que Meilisearch se ponga al día por su cuenta.

### 5.2 En los tests: `async-state.ts` — una sola política de espera

`apps/api/test/helpers/async-state.ts` expone `pollFor()` y `waitUntil()`. **Todo lo demás
delega aquí** para que el deadline y el backoff no diverjan test a test.

**Las tres garantías, y por qué existe cada una:**

1. **Un probe que LANZA es «todavía no», no un fallo.** `getDocument()` de Meilisearch lanza
   *«Document not found»* si el documento aún no está. Las copias locales de `pollUntil` hacían
   `await fn()` sin `try/catch`, así que el poll moría en la **primera** iteración: subir el
   deadline no arreglaba nada porque el deadline nunca llegaba a entrar en juego.
2. **El predicado compara CONTENIDO, no existencia.** Esperar a que «el documento exista»
   devuelve la primera versión escrita, que un job posterior todavía puede reescribir (un
   `geocode` reindexa después). El test lee un documento en vuelo y la aserción sale verde o roja
   según los tiempos. El caso extremo era un predicado literal `() => true`.
3. **El deadline cubre el peor caso del CI, y es FINITO.** `DEFAULT_TIMEOUT_MS` es **60 s en CI y
   20 s en local**; `scaleForCi(ms)` multiplica ×4 para esperas de otro orden de magnitud (un
   evento de websocket). Cuesta **cero** en el camino feliz: el poll vuelve en cuanto el
   predicado se cumple. No existe ninguna vía de «esperar para siempre» — un bug real tiene que
   seguir poniendo el test en rojo, no colgarlo. El backoff va de 50 ms a 500 ms (×1,5).

### 5.3 Qué helper usar — la tabla de decisión

| Lo que vas a afirmar | Helper | Por qué |
|---|---|---|
| **El contenido** del documento indexado | `waitForDocumentWhere(...)` / `waitForDocumentField(...)` | Espera al **estado definitivo**. Es el preferente |
| **Que el documento existe** (aparece en `/search`, el worker llegó a indexar) | `waitForIndex(...)` | Correcto **solo** cuando la presencia es lo que se prueba |
| **Que el documento desapareció** | `waitForRemoval(...)` | La ausencia es aquí el estado definitivo |
| Un booleano de Postgres, un contador de cola | `waitUntil(...)` | Envoltorio de `pollFor` |
| Cualquier otro estado | `pollFor(probe, predicate, { description })` | El mecanismo base |

```ts
// MAL: espera a que exista, luego afirma sobre un campo que aún puede cambiar
await waitForIndex(meili, INDEX, id);
expect((await meili.index(INDEX).getDocument(id)).boostScore).toBe(1);

// BIEN: espera a que el campo VALGA lo esperado
const doc = await waitForDocumentWhere<{ boostScore: number }>(
  meili, INDEX, id, (d) => d.boostScore === 1, { description: 'boostScore=1' },
);
expect(doc.boostScore).toBe(1);
```

> **`waitForIndex` no se ha eliminado, y es deliberado.** Quien conozca el documento anterior
> debe entender el cambio: `waitForIndex` sigue siendo *correcto* para probar presencia, pero
> **dejó de ser el patrón por defecto** porque la mayoría de los tests afirman después sobre el
> contenido, y para eso es insuficiente. La cura del flaky, en cambio, no estuvo nunca en este
> helper sino en `waitForTask` (§5.1), en producción.
>
> La crónica —qué falló, en qué orden y qué destapó cada capa— está en `estado-tecnico.md`,
> secciones «Cómo se esperan estados asíncronos en los e2e (barrera estructural)» y
> «`alert-matching:441` — no bastaba con esperar».

**Siempre pasar `description`.** Al vencer el deadline, el error incluye el último valor
observado, el último error y el número de intentos — y distingue explícitamente «lento» de
«roto». Sin `description`, el diagnóstico cuesta una reproducción entera.

---

## 6. Reglas de no-dependencia entre tests

`cleanDb()` corre **por suite**, no por test: hacer TRUNCATE + seed en cada test individual es
demasiado lento. La contrapartida es una norma:

> **Cada test es responsable de los datos que necesita. Ningún test puede asumir que otro haya
> creado o dejado un recurso en un estado determinado.**

1. **Datos compartidos.** Lo creado en el `beforeAll` de la suite es **de solo lectura** para
   todos los tests. Los que solo leen son seguros.
2. **Datos mutables.** Un test que haga algo destructivo (`DELETE /listings/:id`, cerrar un
   `Deal`) crea su propio anuncio en un `beforeEach` local, nunca usa el compartido.
3. **Orden.** Jest ejecuta en el orden del fichero, pero **ningún test debe depender de ese
   orden**.
4. **Nombres deterministas** (`seller-test@example.com`, `buyer-test@example.com`), creados vía
   Prisma directamente en el `beforeAll` —no por HTTP— para que el estado sea exactamente el
   deseado sin depender de reglas de negocio que puedan cambiar.

### 6.1 Dos trampas caras, ya diagnosticadas

**Sembrar por el wizard es frágil.** Publicar a través de la UI depende del flujo entero: datos,
ubicación, geocoding, atributos, límite de plan, indexación. Un fallo en cualquier capa hace
fallar el test **sin indicar cuál**. Para *setup*, usar `POST /listings` + `POST /listings/:id/publish`
por API (`helpers/api.ts`). **El wizard solo debe ejercerse en los tests que prueban el wizard.**

**Publicar sin coordenadas explícitas dispara un viaje externo.** Si no se pasan
`latitude`/`longitude`, se encola un job `geocode` que consulta Nominatim (externo, ~1 req/s) y
**reindexa al terminar** — la card no queda estable hasta entonces. Los specs de backend lo
esquivan pasando las coordenadas a mano. Los de Playwright que publican por el wizard no pueden,
y por eso `waitForCard` tiene el plazo que tiene.

**En Playwright, sembrar deja generaciones huérfanas.** Playwright **descarta el worker cuando un
test falla** y arranca otro — también con `--retries=0`—, lo que vuelve a ejecutar el
`beforeAll` y siembra otra generación. Con tres fallos por delante, la página acaba mostrando
tres a la vez y el siguiente test muere por *strict mode violation*. Un registro en memoria no
sirve: el worker descartado es **otro proceso**. Por eso se limpia por prefijo contra la API
(`limpiarAnunciosPorPrefijo()` en `seed-listings.ts`), no con una lista local.

---

## 7. CI

`.github/workflows/ci.yml`. Dos jobs; el segundo **depende** del primero (`needs: lint`).

**Job 1 — `Lint & Typecheck`.** Sin contenedores de servicio: instala, genera el cliente Prisma,
`tsc --noEmit` en la API, lint y `type-check` en el web.

**Job 2 — `E2E Tests`.** Contenedores de servicio para Postgres (`postgis/postgis`, no un Postgres
pelado: el schema habilita PostGIS), Redis y Meilisearch. **MinIO no es un contenedor de
servicio**: `minio/minio` necesita `server /data` como CMD de Docker, y los service containers no
pueden especificarlo — se arranca como paso con `docker run -d`.

Los pasos, en orden:

1. **Backend e2e — Jest.** `pnpm --filter @marketplace/api test:e2e`. El `globalSetup` hace
   `migrate deploy` + reset + seed.
2. **Frontend unit — Jest.** Tests de componente en jsdom, sin servicios.
   *(No hay paso equivalente para los unit del backend — ver el aviso de §1.)*
3. **Build frontend** (`next build`). Necesario porque el `webServer` arranca `next start`.
4. **Playwright — SEÑAL:** `exec playwright test --grep-invert "@2b"`.
5. **Playwright — `@2b`:** `exec playwright test --grep "@2b"`, con `continue-on-error: true` **y**
   `if: always()`.
6. **Dos artefactos de informe**, con nombres distintos.

### 7.1 El split señal / `@2b` — qué significa el color

**Si el paso de SEÑAL falla, el fallo es real y el pipeline cae.** El paso `@2b` contiene
únicamente la carrera de navegación del App Router bajo `next start` (bug de Next 15, firma de
`vercel/next.js#57565`, sin arreglo upstream), caracterizada y mitigada hasta donde se puede, pero
imposible de garantizar en verde: el router queda *wedged* y ni esperar más ni reintentar lo
recupera siempre.

**No es esconderlo:** el paso aparece en la UI de Actions con su resultado y su informe HTML se
sube igual. Lo que se evita es que un bug de Next tumbe un pipeline cuyo producto funciona.

Tres detalles que **no son cosméticos** y que hay que respetar al tocar esto:

- **Se invoca con `pnpm ... exec playwright test <args>`, NUNCA con `run <script> -- <args>`.** La
  frontera `--` **diverge entre shells**: PowerShell se come el token y bash lo pasa literal, con
  lo que Playwright lo trata como fin-de-opciones y **todo lo que sigue queda inerte**. El filtro
  se estuvo verificando en el shell que ya había alterado el comando. `exec` elimina la *clase* de
  bug, no solo el caso de bash.
- **`if: always()` ADEMÁS de `continue-on-error`.** Son cosas distintas y hacen falta las dos:
  `continue-on-error` impide que el fallo tumbe el job, pero **no hace que el paso corra**. Sin
  `if:`, cuando la señal fallaba este quedaba `skipped` y no informaba de nada.
- **Cada paso escribe su propio informe** (`PLAYWRIGHT_HTML_OUTPUT_DIR`). Con el directorio por
  defecto, el informe de la señal —el que decide el pipeline— quedaba pisado por el de `@2b`.

> **Etiquetar `@2b` es una decisión con consecuencias.** La etiqueta solo se pone sobre una firma
> `waitForURL … until "commit"` **confirmada**. Etiquetar un rojo de otra causa sería un
> `test.fixme` disfrazado: escondería un bug real, que es exactamente lo que esta separación
> existe para impedir.

> La crónica de la saga —cómo se llegó desde ~32 rojos rotando ilegibles hasta el veredicto verde
> leído en el runner, con corrida y SHA— está en `estado-tecnico.md`, sección «🏁 La saga del CI —
> estado final». El mapa de clasificación por familias está en `ci-playwright-plan.md` (histórico).

---

## 8. Datos de prueba

**Seed estático (`globalSetup`).** `apps/api/prisma/seed-test.ts` siembra el árbol mínimo de
categorías con `upsert` (idempotente). Playwright ejecuta además
`apps/api/prisma/seed-playwright.ts`, que crea las **seis cuentas fijas** (seller, buyer, admin,
moderator, editor, pro) y guarda su `storageState` para no repetir el login en cada test.

**Seed dinámico (`beforeAll` de cada suite).** Cada suite crea sus propios usuarios y anuncios vía
Prisma directamente.

**Contraseñas:** menos rondas de bcrypt que en producción. Es una decisión de **rendimiento**, no
de seguridad, y solo aplica en test.

> **Ojo con el seed compartido:** `tickets-admin` consume la **única** transacción facturable del
> seed. En una corrida normal el `globalSetup` resiembra y pasa; bajo `--repeat-each`, la 2ª y 3ª
> pasada dan `409 NO_INVOICEABLE_MOVEMENTS` y `429`. **No es inestabilidad** — no leerlo como
> flaky.

---

## 9. Frontend E2E con Playwright

### 9.1 Configuración que hay que conocer

| Ajuste | Valor | Por qué |
|---|---|---|
| `workers` | **1** | **No es una palanca de rendimiento pendiente de subir: es un requisito.** Las specs comparten una base, un índice y una db de Redis, y nueve **mutan estado global** (ajustes, árbol de categorías, footer) que otras leen |
| `fullyParallel` | `false` | Ídem |
| `retries` | 1 en CI, 0 en local | — |
| `timeout` | 150 s en CI, 90 s en local | Un publish por el wizard consume ~40 s y la espera de la card hasta 45 s más |
| `actionTimeout` | 15 s | **Plazos finitos por acción** |
| `navigationTimeout` | 30 s | Ídem |
| `expect.timeout` | 10 s | Ídem |

> **Por qué los plazos por acción son obligatorios.** Sin ellos, una acción que no resuelve no
> tiene plazo propio: se come los 90 s del test entero, y con `retries: 1` son 180 s por test
> colgado — varios así agotaban la ventana del job y lo dejaban **sin veredicto**. El caso
> concreto eran 105 llamadas a `waitForLoadState('networkidle')` sin plazo: si algo mantiene la
> red viva, `networkidle` no se cumple nunca. Con estos plazos, lo que colgaba 90 s **falla en
> 30 s señalando el paso exacto**.

> **Si subes el plazo de un helper, sube también el del test.** Playwright mata el test antes de
> que el plazo del helper se agote: los dos suben juntos o no sube ninguno.

### 9.2 El `webServer` va en modo PRODUCCIÓN en CI, nunca en watch

```ts
command: process.env.CI
  ? 'pnpm --filter @marketplace/api exec nest start'   // sin --watch
  : 'pnpm --filter @marketplace/api dev',
```

- **Backend:** `nest start` **sin `--watch`** compila una vez y ejecuta. `--watch` deja un
  compilador residente reaccionando a cambios que en CI no van a ocurrir nunca, peleando por la
  CPU del runner con la propia batería. Fue la causa principal de que el job se comiera su ventana
  sin llegar a veredicto.
- **Frontend:** `next start` sobre un build previo, no `next dev`. `next dev` tiene un *watchdog*
  de memoria **solo de desarrollo** que reinicia el proceso al superar el 80 % del heap; el modo
  dev retiene mucho más en memoria (caché de módulos de HMR, source maps) y la suite lo cruzaba a
  media corrida, matando el test que estuviera navegando en ese momento («Target page has been
  closed»). `next start` no ejecuta esa comprobación.

> **No se usa `pnpm ... start` para el backend aunque sería lo natural:** ese script está roto
> (apunta a `node dist/main`, pero `nest build` compila también `prisma/`, así que el entry real
> queda en `dist/src/main.js`), y arrancar el `dist` con `node` a pelo revienta con
> `Cannot find module 'multer'` — una dependencia fantasma que llega por
> `@nestjs/platform-express` sin estar declarada. Las dos cosas están anotadas como deuda en
> `estado-tecnico.md`: tocan el arranque de **producción** y no deben colarse en un cambio de CI.

### 9.3 El patrón de navegación: reintentar el CLIC, no la espera

Bajo `next start`, un clic sobre un `<Link>` a veces no completa la transición: la RSC payload
responde 200 en menos de 10 ms y el router **no conmuta**. No es una ventana transitoria — la
página queda **persistentemente** *wedged*, así que **esperar más no sirve**: subir
`navigationTimeout` no arregló ni uno.

Lo único que recupera el estado es **volver a hacer el clic**. Por eso `clicarYEsperarUrl()`
(`e2e/helpers/nav.ts`) envuelve el clic entero en un `toPass`, no solo la espera. Los specs que
hacían `click()` + `waitForURL()` a pelo salían como rojos duros; los que usan el helper salen
como flaky rescatados por el retry.

**Usar siempre `clicarYEsperarUrl()` para navegar por `<Link>`. Nunca subir `navigationTimeout`
como alternativa.**

---

## 10. Observabilidad

Fuera del alcance de los tests automatizados, por decisión explícita: los eventos de Sentry son
efectos secundarios, no contratos de API.

| Dónde | Cómo |
|---|---|
| Backend | `Sentry.init()` en `main.ts` + captura en los 6 processors de BullMQ |
| Frontend | `instrumentation.ts` (servidor), `instrumentation-client.ts` (navegador), `global-error.tsx` |
| En tests | DSN vacío → Sentry se inicializa pero nunca envía |
| Logs | `nestjs-pino` (salida JSON; nivel `error` en test para no contaminar Jest) |

La validación real con DSN activo queda pendiente de un entorno de staging — que no existe todavía
(`pendientes.md` §1 y §4.2).

---

## 11. Flujo de trabajo

### Backend

```bash
# Una sola vez: crear la base de datos de test
pnpm --filter @marketplace/api test:setup:db

# Batería e2e completa (--runInBand ya va en el script; no añadirlo a mano)
pnpm --filter @marketplace/api test:e2e

# Una suite concreta
pnpm --filter @marketplace/api test:e2e -- --testPathPattern=favorites

# Unit tests del backend
pnpm --filter @marketplace/api test
```

### Frontend

```bash
# Unit (jsdom, no necesita servicios)
pnpm --filter @marketplace/web test:unit

# E2E completo — Playwright levanta backend y frontend si no están arriba
pnpm --filter @marketplace/web test:e2e

# Solo la SEÑAL, como el CI (sin el ruido conocido)
pnpm --filter @marketplace/web exec playwright test --grep-invert "@2b"

# Solo el ruido tolerado
pnpm --filter @marketplace/web exec playwright test --grep "@2b"

# Un spec concreto, con UI para depurar
pnpm --filter @marketplace/web test:e2e:ui
```

**En local**, `reuseExistingServer: true`: si ya tienes los servidores levantados con el entorno
de test, Playwright los reutiliza; si no, los arranca en modo dev.

### Las tres cosas que hay que recordar

1. **No lanzar las dos baterías a la vez.** El candado lo impedirá y te dirá por qué, pero
   entenderlo ahorra el susto.
2. **`--runInBand` ya es canónico** en `test:e2e`. Es una **mitigación**, no la cura: las suites
   comparten `marketplace_test` y correr en paralelo produce *deadlocks* y violaciones de FK. La
   cura real —aislar por worker— se evaluó en el Hito 9 y **se decidió no hacerla** (ver el
   apéndice).
3. **Si un test de búsqueda falla siempre**, no es un problema de espera: mira si el worker de
   BullMQ está arrancado (`createTestApp()` lo levanta; si no se llama, no existe) y si
   `MEILI_INDEX_NAME` coincide con el índice al que escribe el worker. El propio mensaje de error
   de `pollFor` lo dice.

---

## Apéndice — decisiones descartadas y por qué

### Vigentes desde el diseño original

| Opción descartada | Por qué |
|---|---|
| Contenedores de test separados (puertos distintos) | Sin beneficio real para un entorno mono-desarrollador; añade complejidad sin aportar aislamiento adicional |
| Mocking de Prisma / Redis / Meilisearch | Da falsa seguridad; no detecta incompatibilidades de contrato ni bugs de integración |
| Indexación síncrona en test (bypass de BullMQ) | Cambiaría el camino de producción. La solución real fue mejor: hacer la indexación **determinista en producción** con `waitForTask` (§5.1) — beneficia también al usuario, no solo al test |
| `TRUNCATE` por test individual | Demasiado lento; la norma de no-dependencia mitiga el riesgo sin coste de tiempo |
| Vitest en lugar de Jest | No es prioritario; migrar en un refactor posterior si el tiempo de suite lo justifica |

### Añadidas después

| Opción descartada | Por qué |
|---|---|
| **Quedarse en `waitForIndex` como patrón por defecto** | Esperar a la **existencia** devuelve la primera versión escrita, que un job posterior puede reescribir → verdes falsos. Se conserva para probar presencia, pero el preferente es `waitForDocumentWhere` (§5.3) |
| **Arreglar el flaky de indexación subiendo deadlines** | No funcionaba, y el motivo importa: el probe lanzaba y el poll moría en la primera iteración, así que **el deadline nunca entraba en juego**. Subirlo era tratar el síntoma equivocado |
| **`pnpm run <script> -- <args>` para pasar filtros a Playwright** | La frontera `--` **diverge entre shells**; el filtro nunca aplicó en el runner. Se usa `exec`, que elimina la clase de bug (§7.1) |
| **`next dev` / `nest start --watch` como `webServer` en CI** | Un compilador y un *watchdog* de memoria residentes compitiendo con la propia batería; era la causa principal de que el job no llegara a veredicto (§9.2) |
| **Subir `navigationTimeout` contra la carrera del App Router** | Medido: no arregla ni un test. El router queda **persistentemente** *wedged*; lo único que lo recupera es repetir el clic (§9.3) |
| **Aislar la base de test por worker de Jest** (`JEST_WORKER_ID`) | Evaluado en el Hito 9 con el mapa real medido: la suite tarda ~110 s en serie y el paralelismo ahorraría ~60-70 s a cambio de una orquestación no trivial (`JEST_WORKER_ID` no existe en `globalSetup`). **No es deuda: es una decisión** |
| **Subir `workers` en Playwright** | Las specs comparten estado y nueve lo mutan. Paralelizar sin aislar primero cambiaría cuelgues por rojos aleatorios. El tiempo se recupera arrancando en producción, no repartiendo tests que comparten estado |
| **Un `afterAll` de limpieza en cada spec** | 22 specs crean categorías y solo 6 borraban. Resuelve hoy y reabre mañana: el spec siguiente volverá a olvidarlo. Va en un mecanismo compartido (§3.3) |
| **Extraer la política de espera a un paquete común** del monorepo | `async-state.ts` (`apps/api`) y `wait-for-card.ts` (`apps/web`) replican la misma política **a propósito**: el workspace solo declara `apps/*` y no hay paquete común. Crearlo es una decisión de estructura del monorepo, no algo que deba colarse en un arreglo de tests. **Si algún día se crea, este es el primer candidato a mudarse — y si tocas una de las dos políticas, toca la otra** |
