# Auditoría — la inestabilidad de Playwright

> **Documento de diagnóstico. Cero código, cero arreglos.** Todo lo que sigue está medido
> contra corridas reales (`gh run`, corridas locales, el código de Next instalado) el
> 2026-08-29. Donde no hay medición, se dice.

---

## 0. El veredicto, primero

**Los rojos son LOCALES. El CI de Ernest está limpio.**

| Medición | Resultado |
|---|---|
| Corridas de CI recientes (`gh run list`, 24 últimas) | **24 de 24 `success`** |
| El paso que BLOQUEA el pipeline (`Playwright señal`) | `success` en todas |
| El paso tolerado (`Playwright @2b`) | `success` también en las 3 últimas |
| Corrida local sobre `main` (control, sin N3) | **25 fallos** / 480 pasan |
| Corrida local sobre la rama N3 | 17–20 fallos / 485–488 pasan |
| **Los 13 specs que fallaban en local, bajo condiciones de CI** | **80 de 80 pasan, en 2,2 min** |

La hipótesis central del encargo se resuelve así: **de los ~25 rojos, cero son flakes
estructurales del CI.** Son todos de la población que el CI sí ejecuta y sí aprueba. No hay
un problema del proyecto que arreglar en el código de los tests; hay un **método local** que
usa una configuración distinta —y peor— que la del CI.

**Corolario incómodo pero útil:** durante toda la sesión se ha estado verificando con una
batería local que arranca los servidores en modo desarrollo, mientras el CI —el que decide
los merges— los arranca en producción desde hace ráfagas. Los «rojos ambientales» que se
fueron arrastrando eran reales, pero no eran del producto: eran del arranque local.

---

## 1. La medición que lo decide: local vs CI

### 1.1 — El CI ejecuta Playwright, y pasa

No es un verde vacío. El job `E2E Tests` de `.github/workflows/ci.yml` corre, en este orden:
backend unit (Jest) → backend e2e (Jest) → frontend unit (Jest) → **build de producción del
front** → **Playwright en dos pasos**. Verificado con `gh run view <id> --json jobs`:

```
Lint & Typecheck   success
E2E Tests          success     (~28 min)
  ├─ Frontend e2e — Playwright (señal, sin @2b)        success
  └─ Frontend e2e — Playwright (@2b, known-issue)      success
```

Comprobado en los tres merges más recientes (`33218010011` N2, `33210692911` A1,
`33200990206` mensajería C2). Los 24 runs listados por `gh run list` son `success`.

### 1.2 — Las dos poblaciones de tests, y cuál corre cada uno

El CI **no** corre la batería entera en el paso que bloquea. La parte en dos:

| Población | Tests | Ficheros | En CI | Bloquea |
|---|---|---|---|---|
| **Señal** (`--grep-invert @2b`) | **482** | 71 | sí | **sí** |
| **`@2b`** (`--grep @2b`) | **24** | 7 | sí | **no** (`continue-on-error: true`) |
| **Total** | **506** | 71 | — | — |

Medido con `playwright test --list`. `@2b` es la carrera de navegación del App Router de
Next 15 (firma `vercel/next.js#57565`), caracterizada y mitigada hasta donde se puede en
`docs/ci-playwright-plan.md` §14, y aislada a propósito para que su residual no ensucie la
señal.

**El comentario del workflow está desactualizado:** dice «248 de los 271 tests». Hoy son
**482 de 506**. La batería casi ha doblado desde entonces. El propio comentario ya avisa de
que «el árbitro es `--list`, no este comentario» — y acierta. No cambia ninguna conducta
(el `--grep-invert` se calcula solo), pero engaña a quien lo lea para dimensionar.

### 1.3 — En local se corre TODO, incluidos los 24 conocidos como rotos

`apps/web/package.json` → `"test:e2e": "playwright test"`. Sin `--grep-invert`. Así que
`pnpm test:e2e` en local ejecuta **506** tests, es decir la señal **más** los 24 que el CI
tolera por diseño.

Esto explica una parte del ruido… pero **no la principal**, y conviene decirlo con el dato:

| Fichero con tests `@2b` | Tests `@2b` | ¿Falló en la corrida local? |
|---|---|---|
| `busqueda-unificada.spec.ts` | 12 | **no** |
| `buscador-sugerencias.spec.ts` | 6 | **no** |
| `tags-filtro.spec.ts` | 2 | sí (3 fallos: al menos 1 **no** es `@2b`) |
| `nav-publico` / `h8-d4-banners` / `filtros-schema-driven` / `busqueda-mapa` | 1 c/u | solo `h8-d4-banners` |

Los 18 `@2b` de los dos ficheros más cargados **no fallaron ni una vez**. Y los ficheros donde
sí se concentran mis fallos —`auth-friction`, `tickets-admin`, `footer-admin`, `flujo-critico`,
`paginas`, `shell-cuenta`, `blog-markdown-editor`, `block-editor-full`, `editor`,
`login-social-google`, `tarjeta`— **no contienen ni un solo test `@2b`**.

**Conclusión:** los rojos locales caen mayoritariamente en la población que el CI **sí
bloquea** y **sí aprueba**. No son el ruido conocido: son tests sanos rompiéndose por el
entorno local.

---

## 2. Por qué falla en local: cuatro causas, todas medidas

La configuración local y la de CI **no son la misma batería**. `playwright.config.ts` ramifica
en `process.env.CI` en cinco puntos:

| | Local | CI |
|---|---|---|
| Frontend | `next dev` | `next build` + `next start` |
| Backend | `nest start --watch` | `nest start` |
| `reuseExistingServer` | **`true`** | `false` |
| `retries` | **`0`** | `1` |
| `timeout` por test | 90 s | 150 s |

Las cuatro causas siguientes se derivan de esa tabla.

### 2.1 — EL MECANISMO PRINCIPAL: `next dev` se suicida a media petición

`node_modules/…/next@15.5.19/dist/server/lib/start-server.js`, líneas 233-244, dentro del
`finally` de **cada petición**:

```js
} finally {
  if (isDev) {
    if (v8.getHeapStatistics().used_heap_size > 0.8 * v8.getHeapStatistics().heap_size_limit) {
      log.warn(`Server is approaching the used memory threshold, restarting...`);
      …
      process.exit(RESTART_EXIT_CODE);
    }
  }
}
```

Tres cosas, y las tres importan:

1. **Está `if (isDev)`.** `next start` **nunca** lo evalúa. Es exclusivamente un problema
   del arranque local.
2. **Se comprueba en cada petición**, no periódicamente. Una batería de 50 minutos lo
   evalúa decenas de miles de veces.
3. **Cuando salta, hace `process.exit`.** No degrada: mata el servidor. Cualquier
   `page.goto` o `waitForURL` en vuelo muere ahí — y su firma es exactamente
   `TimeoutError: page.goto: Timeout 30000ms exceeded` o
   `Target page, context or browser has been closed`, que son **las dos firmas que se han
   estado viendo**.

Y el modo dev retiene mucha más memoria que producción (caché de módulos de HMR, source
maps), así que el umbral del 80 % se alcanza precisamente en baterías largas.

**Esto ya se diagnosticó y se arregló… solo para el CI.** El comentario de
`playwright.config.ts` (líneas 132-141) lo cuenta entero: era la causa de los
«Target page has been closed» del runner, y por eso el CI pasó a `next start`. El arranque
local se quedó en `next dev` y con él se quedó el bug.

### 2.2 — Compilación bajo demanda: coste real, pero secundario

Medido en esta máquina, **en reposo y con todo lo demás parado**, primer acceso contra
segundo:

| Ruta | 1.º (compila) | 2.º |
|---|---|---|
| `/` | **6,2 s** | 0,17 s |
| `/login` | 1,98 s | 0,07 s |
| `/blog` | 1,35 s | 0,10 s |
| `/planes` | 1,66 s | 0,13 s |

Y el log del propio `next dev` lo confirma: `✓ Compiled / in 6.2s (3680 modules)`.

**Honestidad sobre este dato:** 1-6 s no agota por sí solo un `navigationTimeout` de 30 s.
Es un agravante, no la causa: suma latencia y sobre todo **presión de heap** (compilar retiene
módulos), que es lo que alimenta §2.1. Presentarlo como la causa principal sería inflarlo.

*Nota de método:* las rutas protegidas (`/publicar`, `/admin/*`, `/mis-creditos`) midieron
~10 ms porque el middleware redirige a `/login` **sin llegar a compilar la página**. En los
tests, con sesión, sí compilan. Su coste real no está medido aquí.

### 2.3 — `reuseExistingServer: true` adopta servidores viejos

En local, Playwright **no arranca servidores si el puerto responde**: reutiliza lo que haya.
Y lo que hay puede ser un `next dev` de hace horas, con el heap ya cerca del umbral y el
watchdog a punto de disparar.

**Observado en esta misma auditoría, no en teoría:** al parar un `next dev` de medición, el
proceso hijo **sobrevivió** al cierre de su envoltorio y siguió escuchando en el 3000. El
siguiente arranque murió con `EADDRINUSE`. Un Playwright local con `reuseExistingServer: true`
no habría fallado: habría **adoptado ese servidor zombi** y corrido la batería entera contra
él, sin decir nada.

### 2.4 — `retries: 0` en local

El CI absorbe con `retries: 1`; local no absorbe nada. Cualquier flake ambiental —incluido el
reinicio de §2.1— es un rojo duro a la primera. Es la diferencia entre «17 fallos» y «17
flaky», que no es la misma información.

### 2.5 — Efecto colateral: `next dev` y `next build` comparten `.next`

Hacer `pnpm build` con un `next dev` corriendo **corrompe el build**. Reproducido en esta
auditoría: el `next start` resultante murió con
`Cannot find module './vendor-chunks/@sentry+core@10.59.0.js'`. Con `rm -rf .next` y el dev
parado, el build salió limpio en 1m07s.

No es causa de los rojos, pero **es una trampa del método local recomendado abajo**: quien
construya sin parar el dev se encontrará un fallo que no tiene nada que ver con sus tests.

---

## 3. La validación: el arreglo funciona, y está medido

No se propone nada sin comprobarlo. Se tomaron **los 13 ficheros que fallaron** en la última
corrida local y se corrieron **con `CI=1`** —que es lo único que hace falta para que la
config bascule a `next start`, servidores frescos, `retries: 1` y 150 s— y con
`--grep-invert "@2b"`, que es lo que corre el paso que bloquea:

```
CI=1 npx playwright test --grep-invert "@2b" e2e/auth-friction.spec.ts … (13 ficheros)

  80 passed (2.2m)      EXIT=0
```

**80 de 80.** Los mismos ficheros que acumulaban 17 rojos. Y en 2,2 minutos.

**Límite honesto de esta validación:** son 13 ficheros (80 tests), no los 482 de la señal
entera. Confirma el mecanismo y el arreglo sobre la población afectada; **no** es una corrida
verde completa. La corrida completa bajo `CI=1` está en el plan (§6) como barrera.

### El dato de tiempo, que apunta en la misma dirección

| | Duración |
|---|---|
| Batería local completa (`next dev`) | **50–58 min** |
| Job `E2E Tests` entero del CI — que además hace backend unit + backend e2e + frontend unit + build | **~28 min** |

El CI hace **más** trabajo en **la mitad** de tiempo. La diferencia no es la máquina: es que
uno sirve un build precompilado y el otro compila bajo demanda mientras se reinicia solo.

---

## 4. Lo que NO hay que rehacer

`docs/ci-playwright-plan.md` (762 líneas) es una investigación cerrada y sigue siendo válida.
Lo que resolvió **no es la causa de estos rojos** y no debe volver a tocarse:

| Familia | Estado | ¿Es la causa hoy? |
|---|---|---|
| **2a** — `waitForCard` / visibilidad en búsqueda | **cerrada** (§11: comprobaba demasiado pronto; no era latencia ni indexación) | no |
| **2c** — sedimentación de estado | **cerrada** (ráfaga C) | no |
| **3** — sueltos | cerrada en su mayoría | no |
| **2b** — carrera del App Router (Next 15) | **known-issue**, etiquetado y aislado en CI | no (los rojos locales no son `@2b`, §1.3) |
| Bugs de producción #1 `perPage`, #3 no leídos | **arreglados** | no |

Tres hipótesis quedaron **refutadas con datos** en aquel plan y no conviene resucitarlas:
que 2a fuera latencia (§9), que hubiera *starvation* de `geocode` (§10), y que 2a fuera de
indexación (§10). Los rojos de ahora tienen otra firma (`page.goto`/`waitForURL` sobre rutas
sin relación con búsqueda) y otra causa.

**Lo único que aquel plan dejó pendiente y sigue pendiente** (§15): `footer-admin:175` (ISR:
leer el footer público sin esperar la revalidación) y la sonda de `mensajeria-unificada:91`.
Son dos rojos con causa propia, ajenos a esto.

---

## 5. La recomendación

### 5.1 — Es MÉTODO, no código

La configuración de Playwright **no está mal**: el CI está correctamente afinado y verde. Lo
que falta es que la verificación local use esa misma configuración en vez de la de
desarrollo. Concretamente, verificar en local con:

```
CI=1 pnpm --filter @marketplace/web exec playwright test --grep-invert "@2b"
```

`CI=1` bascula los cinco puntos de una vez: `next start`, `nest start` sin watch, servidores
frescos (`reuseExistingServer: false`), `retries: 1` y 150 s. `--grep-invert "@2b"` reproduce
exactamente **el paso que decide el pipeline**.

Requisitos previos, que son la parte que se pisa fácil (§2.5, §2.3):
1. **Ningún `next dev` ni `nest --watch` vivo** — y comprobar el puerto, no el envoltorio:
   `netstat -ano | grep ":3000 "`.
2. **`.next` construido sin el dev corriendo** (`rm -rf .next && pnpm --filter @marketplace/web build`).

### 5.2 — Los dos cambios de configuración que sí valen la pena

Ninguno es urgente —el CI ya está verde— y por eso esta ráfaga no los implementa. Pero los
dos convierten el método de arriba en algo que no hay que recordar:

| Cambio | Qué resuelve | Riesgo |
|---|---|---|
| **Un script `test:e2e:ci`** en `apps/web/package.json` que envuelva el comando de §5.1 | Que verificar como el CI no dependa de acordarse de dos banderas | ninguno — es un script nuevo, no toca los existentes |
| **`retries: 1` también en local** (`retries: 1` a secas) | Que un flake ambiental salga como `flaky` y no como rojo duro: distingue «se rompió» de «se rompió y se recuperó» | bajo; alarga la corrida solo cuando algo falla |

**Lo que NO se recomienda**, y conviene dejarlo escrito para no repetir la discusión:

- **`next start` en local por defecto.** Rompería el ciclo de desarrollo normal (`pnpm dev`
  es lo correcto para desarrollar). La bandera `CI=1` ya da las dos conductas sin elegir una.
- **`retries: 2`.** El encargo lo apuntaba como colchón estándar. Con la causa identificada
  —un `process.exit` del servidor— **un tercer intento no aporta**: cuando el servidor se
  reinicia, el retry no rescata más de lo que rescata el primero, y §14 del plan previo ya
  midió que subir retries en `@2b` salió *peor*. `retries: 1` es suficiente y honesto.
- **Subir `navigationTimeout`.** No es un problema de plazo: es un servidor que desaparece.
  Un plazo mayor solo tarda más en dar el mismo rojo.
- **Paralelizar (`workers > 1`).** Está prohibido por diseño y con razón escrita: las specs
  comparten una base, un índice y seis cuentas sembradas. No tiene nada que ver con esto.

---

## 5.3 — Implementado (rama `playwright-estabilidad-local`)

El plan de §6 está aplicado: `pnpm --filter @marketplace/web test:e2e:ci`
(`apps/web/scripts/e2e-ci.js`) y `retries: 1` también en local. El CI **no se tocó**.

**Y las dos trampas de §2.3 y §2.5 no se documentaron: se automatizaron** — con dos defectos
propios que solo aparecieron al probar el script con un zombi puesto a mano, y que merecen
quedar escritos porque los dos fallaban *en silencio y hacia el lado peligroso*:

| Defecto del script | Qué pasaba | Arreglo |
|---|---|---|
| La sonda de puerto hacía `listen('127.0.0.1')` | En Windows **eso convive** con un `next dev` que escucha en `0.0.0.0`: el script decía «3000: libre» con el zombi delante, Playwright chocaba con `EADDRINUSE` y la batería acababa corriendo **contra el servidor de desarrollo** — exactamente lo que el script existe para impedir | Sondar **conectando**, no escuchando |
| `rmSync` inmediato tras matar el proceso | `taskkill` vuelve cuando ha *pedido* el cierre, no cuando el proceso ha muerto; Windows aún tenía descriptores abiertos sobre `.next` → `ENOTEMPTY` | Esperar a que el puerto quede libre + `maxRetries` en el borrado |

Los dos se detectaron **armando la trampa a propósito** (arrancar un `next dev`, dejarlo vivo
y lanzar el script). Sin esa prueba, el primero habría reproducido el fallo original con una
capa más de indirección: un script que promete condiciones de CI y entrega las de desarrollo.

---

## 6. El plan

**Una ráfaga, pequeña, y opcional.** El CI está verde; esto es higiene del método local.

| # | Trabajo | Tamaño |
|---|---|---|
| 1 | Script `test:e2e:ci` + `retries: 1` en local + actualizar el comentario obsoleto del workflow (248/271 → 482/506) | **muy pequeña** |
| 2 | Documentar el método local en `docs/estrategia-testing.md` (parar servidores, build limpio, `CI=1`) | muy pequeña |

**Fuera de esta ráfaga, y ya anotado antes:** `footer-admin:175` (ISR) y la sonda de
`mensajeria-unificada:91`, que vienen de `ci-playwright-plan.md` §15.

---

## 7. Las barreras

Cómo saber que ha funcionado, en orden de coste:

1. **La corrida completa bajo condiciones de CI** — `CI=1 … --grep-invert "@2b"` sobre los
   482. **Es la barrera que esta auditoría no ha ejecutado** (validó 80 de 482) y la que
   convierte «mecanismo confirmado» en «batería verde en local». ~30 min.
2. **El CI sigue verde**, que es el estado actual: 24 de 24. Si un merge futuro lo pone en
   rojo, **eso sí es señal** — y ahora se sabe que no hay que descartarlo como ambiental.
3. **La tasa de `flaky`** con `retries: 1` en local: un test que pasa al segundo intento es
   flake; uno que falla los dos es real. Hoy esa distinción no existe en local (`retries: 0`)
   y por eso todo parecía igual de grave.
4. **El paso `@2b` del CI**, que informa sin bloquear: si su residual sube, hay que volver a
   mirarlo. En las tres últimas corridas salió `success` **entero**, que es mejor de lo que
   el plan previo esperaba («residual del 20-50 %»).

---

## 8. Lo que esta auditoría corrige de lo que se venía diciendo

Tres afirmaciones que se han repetido durante la sesión y que los datos matizan:

1. **«Son rojos ambientales, sigo adelante.»** Cierto en el diagnóstico, incompleto en la
   consecuencia: *ambiental* aquí significa **modo desarrollo**, que es una palanca que se
   puede bajar (`CI=1`), no una fatalidad de la máquina. Se podía haber verificado limpio
   desde la primera vez.

2. **«La máquina está saturada.»** Parcialmente. La saturación agrava, pero el mecanismo es
   un `process.exit` condicionado a `isDev` — no un límite de CPU. En una máquina ociosa,
   una batería larga en modo dev volvería a disparar el watchdog.

3. **«Playwright está inestable.»** No lo está donde se decide: **24 de 24 corridas verdes en
   CI**, incluido el paso tolerado. Lo inestable era el arranque con el que se verificaba en
   local.

Y una que sí se sostiene: **N3 no introdujo ninguna regresión.** La corrida de control sobre
`main` dio **25 fallos** contra 17-20 de la rama, con los mismos ficheros y las mismas firmas.
