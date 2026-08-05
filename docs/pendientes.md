# Pendientes reales del proyecto

> Lo que queda por **CONSTRUIR** (no documentación desfasada). Verificado contra código el
> 2026-08-04, rama `main`, commit `ff333ab`.
> Para el estado de lo IMPLEMENTADO, ver `estado-tecnico.md`.

Este documento nació de la auditoría de documentación de 2026-08-04, al separar dos cosas que
estaban mezcladas: **documentos que mienten sobre algo ya hecho** (se arreglan escribiendo) y
**trabajo que de verdad no se ha hecho** (no se arregla escribiendo). Aquí solo está lo segundo.

**Etiquetas de prioridad:**

| Etiqueta | Significado |
|---|---|
| `[SEGURIDAD]` | Superficie de ataque abierta. Se cierra antes de exponer el servicio a internet. |
| `[BLOQUEADO-EXTERNO]` | No depende de escribir código: falta una credencial, una cuenta o una decisión de un tercero. |
| `[DEUDA]` | Trabajo pendiente ordinario, priorizable. |

**Regla de mantenimiento:** cuando un punto se cierre, se borra de aquí y se documenta en
`estado-tecnico.md`. Este fichero solo contiene lo abierto — si crece indefinidamente, es que no
se está manteniendo.

---

## 1. Despliegue (MVP R6.1–R6.3) — el proyecto NUNCA se ha desplegado `[DEUDA]`

Es el pendiente más antiguo del proyecto y el único que bloquea a varios de los demás (§4
«preparación de producción» y §6 dependen de que exista un entorno real).

**Lo que se comprobó:**

- No existe ningún `Dockerfile` en el repositorio (ni en `apps/api`, ni en `apps/web`, ni en la
  raíz).
- No existe `fly.toml`, `vercel.json`, ni ningún manifiesto de plataforma.
- `.github/workflows/` contiene **únicamente** `ci.yml` (lint/typecheck + e2e). No hay workflow
  de despliegue.
- [docker-compose.yml](../docker-compose.yml) levanta solo infraestructura **local de
  desarrollo**: `postgres`, `redis`, `meilisearch`, `minio`, `createbuckets`. No es un
  compose de producción y no incluye ni la API ni el frontend.

**Lo que haría falta, en orden de dependencia:**

1. **Contenerizar los dos paquetes.** `Dockerfile` multi-stage para `apps/api` (build de NestJS
   + `prisma generate`; el runtime necesita el cliente Prisma generado) y para `apps/web` (build
   de Next.js en modo `standalone`). Ojo: es un monorepo pnpm — el contexto de build tiene que
   incluir el lockfile de la raíz.
2. **Elegir plataforma y decidir dónde vive cada servicio gestionado.** Postgres **con PostGIS**
   (no vale un Postgres pelado: el schema lo habilita), Redis, Meilisearch y el bucket. En
   producción el almacenamiento ya está previsto como **Cloudflare R2** vía `R2Service` (MinIO es
   solo para desarrollo), así que esa pieza no hay que decidirla.
3. **Migraciones en el arranque.** `prisma migrate deploy` como paso previo al arranque de la API,
   no dentro del proceso servidor.
4. **Variables de entorno de producción.** `apps/api` valida el entorno con Joi al arrancar, así
   que un despliegue con variables incompletas falla en el arranque (deseable). Partir de los
   `.env.example` de cada paquete.
5. **Workflow de despliegue** en GitHub Actions, encadenado al `ci.yml` que ya existe y funciona.
6. **Semilla y reindexado inicial.** Tras el primer despliegue: `seed` (árbol de categorías,
   admin, settings) y `pnpm --filter @marketplace/api reindex` para poblar Meilisearch.

**Consecuencia de no tenerlo:** hay comportamiento que solo se puede validar en un entorno real y
que hoy está sin validar — §4 (preparación de producción), §6 (rate limit por IP) y la
verificación de Sentry en staging.

---

## 2. Hito 9.1 — Navegación y flujos (RN9.1–RN9.2) `[DEUDA]`

**Sin empezar.** Ninguna de las dos ráfagas se ha ejecutado.

- **RN9.1 (Opus):** auditar los flujos de usuario —mapa de pantallas y transiciones— y diseñar
  las correcciones de navegación: callejones sin salida, migas de pan, estados vacíos,
  coherencia entre secciones.
- **RN9.2 (Sonnet):** implementar las correcciones priorizadas.

**Insumos disponibles:** `docs/personas-y-wireframes.md` (las personas siguen siendo válidas) y
`docs/mapa-pantallas-flujos.md` (histórico del MVP — la superficie actual es mucho mayor: 18
secciones de backoffice y 10 rutas de área privada, frente a las 6 y 5 que documenta).

**Deuda de navegación ya inventariada en `estado-tecnico.md`** que esta fase debería recoger: los
breadcrumbs no reflejaban la categoría padre porque el dato no llegaba del backend (`H2` de la
auditoría de búsqueda) — resuelto en su parte de datos, pero la revisión de coherencia global no
se ha hecho.

---

## 3. Hito 9.2 — Interfaz, estilo y contenido (RU9.1–RU9.3) `[DEUDA]`

**Sin empezar.** Ninguna de las tres ráfagas se ha ejecutado.

- **RU9.1 (Opus):** diseñar el pase de interfaz y estilo — sistema visual coherente, design
  tokens, copys.
- **RU9.2 (Sonnet):** aplicar el refresco por áreas (1/2).
- **RU9.3 (Sonnet):** aplicar el refresco por áreas (2/2) + revisión de contenido y copys.

**Anotación de alcance que ya existe:** `estado-tecnico.md` §3 difiere aquí un «backlog de pulido
de UI» explícitamente marcado como *«no una brecha funcional»*. Esta fase es su destino natural.

---

## 4. Hito 9.3 — Deuda transversal: MIXTO (parte cerrada, parte abierta)

### 4.1 Ya cerrado — no rehacer

| Ítem | Dónde quedó |
|---|---|
| CORS del gateway WebSocket restringido a `APP_URL` | [messaging.gateway.ts:55](../apps/api/src/modules/messaging/messaging.gateway.ts#L55) — `cors: { origin: [appOrigin()] }`, en forma de **array de un elemento** (con cadena, el paquete `cors` no compara) |
| AuditLog atómico | RF.12b — `log(dto, tx?)` acepta `Prisma.TransactionClient` |
| Reintento de slug ante colisión P2002 | Resuelto (ver `estado-tecnico.md` §3) |
| Reintentos del job `geocode` | Resuelto — la causa no era la cola sino que `GeocodingService.geocode()` se tragaba los fallos transitorios como `null` |
| Playwright corriendo en CI | [ci.yml](../.github/workflows/ci.yml) — steps de señal (`--grep-invert @2b`) y `@2b` separados |
| La saga del CI | Cerrada y verificada **en el runner**: corrida `30930395538`, SHA `e4df671` |
| **CI sin unit tests del backend** | [ci.yml](../.github/workflows/ci.yml) — paso `Backend unit — Jest`. Verde en local **antes** de añadirlo (17/17 suites, 164/164 tests) y confirmado **en el runner**: corrida `31028999515`, SHA `b0c5916`, step `success` en 15 s |

### 4.2 Abierto

#### `app.enableCors()` sin argumentos — la API HTTP abierta a cualquier origen `[SEGURIDAD]`

[apps/api/src/main.ts:40](../apps/api/src/main.ts#L40)

```ts
app.enableCors();   // ← sin argumentos: Access-Control-Allow-Origin para cualquiera
```

Es **la otra mitad** del problema de CORS que R9 cerró en el gateway WebSocket, y se dejó fuera
de aquella ráfaga **a propósito**: su radio de explosión es toda la API HTTP (no un gateway), y
meter los dos cambios juntos habría roto la lección de los dos pasos — si algo se cae, no sabes
cuál de los dos fue. Merece su propia ráfaga con su propia verificación.

También presente en `createTestApp` (los tests replican el bootstrap).

Sin vender más de lo que es, con el mismo criterio que se aplicó al gateway: **el control de
acceso es el JWT, no el CORS**, y el CORS no protege frente a un cliente que no sea un navegador.
Cerrarlo es higiene — quitar el comodín del inventario — no el cierre de un exploit conocido.

#### `allowedDevOrigins` ausente de la configuración de Next `[DEUDA]`

[apps/web/next.config.ts](../apps/web/next.config.ts) — la clave no aparece. Solo afecta a
desarrollo cuando se accede al dev server por IP (por ejemplo, para probar desde el móvil en la
misma red); Next avisa y bloquea recursos de dev.

#### Sin paginación en el home ni en categorías `[DEUDA]`

[apps/web/src/app/(public)/page.tsx:23](<../apps/web/src/app/(public)/page.tsx#L23>) — la portada
pide `search({ sort: 'publishedAt:desc', hitsPerPage: 8 })`, un tope fijo sin navegación a más
resultados. Mismo patrón en el listado de categorías. Irrelevante con poco volumen; visible en
cuanto lo haya.

#### `conversation:read` por WebSocket — deuda que el Hito 7.1 declaraba cerrar y no cerró `[DEUDA]`

El gateway **no emite ningún evento de lectura**: sus emisiones son `message:new`,
`ticket:message` y `error`
([messaging.gateway.ts](../apps/api/src/modules/messaging/messaging.gateway.ts)). El marcado de
leído ocurre solo por REST, al abrir la conversación:

[apps/api/src/modules/messaging/messaging.service.ts:133](../apps/api/src/modules/messaging/messaging.service.ts#L133)

```ts
where: { conversationId: id, senderId: { not: userId }, readAt: null },
data: { readAt: new Date() },
```

**Efecto para el usuario:** el contador de no leídos de la bandeja no baja hasta que se recarga o
se reabre la conversación.

**Relacionado — un test en rojo preexistente, ya diagnosticado a medias:**
`mensajeria-unificada.spec.ts` (~línea 241) falla porque el badge de no leídos no llega a mostrar
`4` tras recibir un mensaje. Verificado en HEAD limpio: **no es regresión de R9**, y el resto del
test —incluida la llegada de mensajes por socket en tiempo real— pasa. Es decir: la conexión y el
transporte funcionan; lo que falla es la **semántica del contador**. Es muy probable que este
rojo y este pendiente sean la misma cosa, así que conviene atacarlos en la misma ráfaga.

#### `DELETE /media/:id` + recolección de huérfanas — deuda que el Hito 7.2 declaraba cerrar y no cerró `[DEUDA]`

[apps/api/src/modules/media/media.controller.ts](../apps/api/src/modules/media/media.controller.ts)
expone exactamente dos rutas: `@Post('upload')` (línea 25) y `@Post('upload-avatar')` (línea 49).
No hay `@Delete` de ningún tipo.

**Efecto:** las imágenes de wizards abandonados quedan huérfanas para siempre, en el bucket y en
la tabla `ListingImage`.

**Nota de alcance al retomarlo:** los adjuntos de ticket tienen exactamente la misma deuda
(`TicketAttachment` → objeto en R2), y hoy no puede materializarse porque no existe ningún
endpoint que borre tickets, mensajes ni usuarios. Si se añade cualquiera de los tres, hay que
borrar también del bucket. Conviene resolver las dos con el mismo mecanismo.

#### Página de tag del blog con URL propia — deuda que el Hito 7.2 declaraba cerrar y no cerró `[DEUDA]`

`apps/web/src/app/(public)/blog/` contiene solo `[slug]/` y `page.tsx`. El filtrado por etiqueta
existe únicamente como query param (`/blog?tag=…`), que **no genera una URL indexable por
etiqueta**. Para un proyecto cuyo canal principal de captación es el SEO, esto es una página de
aterrizaje por tema que no existe.

#### Preparación de producción `[DEUDA]` — depende de §1

| Ítem | Estado real | Qué hay que hacer |
|---|---|---|
| **Geocoder MapTiler** | El código ya soporta ambos proveedores. `estado-tecnico.md`: *«Para activar MapTiler en producción: solo `GEOCODING_PROVIDER=maptiler` + `MAPTILER_API_KEY`, cero cambios de código»* | Configurar las variables. Ojo: `NEXT_PUBLIC_MAPTILER_KEY` (frontend, tiles) y `MAPTILER_API_KEY` (backend, geocoding) son **claves distintas**; la del frontend viaja al navegador y hay que **restringirla por dominio** en el panel de MapTiler |
| **Dominio remitente de Resend** | Configurado para desarrollo | Verificar el dominio en el panel de Resend y actualizar `RESEND_FROM` |
| **Sentry en staging** | Implementado y verificado en desarrollo (silencioso con DSN vacío): `instrumentation-client.ts`, `global-error.tsx`, `main.ts` y los 6 processors | Confirmar la integración real con `NEXT_PUBLIC_SENTRY_DSN` activo. Ambas variables ya están en `.env.example` |
| **Swap atómico del reindex** | `reindex` hace `clearAll()` + repoblar → hay una **ventana breve de índice vacío** | Solo si el volumen lo justifica: indexar en un índice nuevo y hacer swap |

#### Ampliar la cobertura e2e (RD9.3, parte pendiente) `[DEUDA]`

La parte de *«confirmar que Playwright corre en CI»* está **hecha**. Lo que no se ha hecho es la
**pasada explícita de cierre de huecos**. La cobertura actual creció orgánicamente (una spec por
feature, según se construía), no como barrido: hay 92 suites e2e de backend y 44 specs de
Playwright, pero nadie ha auditado qué falta.

Huecos concretos ya anotados en `estado-tecnico.md`:

- **`queue-retry › "Retry real"` es flaky** por timing de indexación de Meilisearch (los 14
  estructurales de esa suite sí son fiables). Preexistente.
- **`admin-roles.spec.ts` afirma el número exacto de ítems del nav** — frágil por diseño, y llegó
  a estar desactualizado en 2 sin que nadie lo notara. Al tocar `AdminNav`, actualizar las tres
  cuentas.
- **Tests que publican por el wizard son frágiles**: dependen del flujo entero (datos, ubicación,
  geocoding, atributos, límite de plan, indexación) y un fallo en cualquier capa hace fallar el
  test sin indicar cuál. Para tests de *setup*, preferir `POST /listings` + `POST
  /listings/:id/publish` por API; reservar el wizard para los tests que prueban **el wizard**.
- **Familia `@2b`** (carrera de navegación del App Router): bug de producto conocido y
  caracterizado, hoy aislado del veredicto del CI con `continue-on-error`. Está **tolerado, no
  resuelto**.

---

## 5. RX.2 — Facturación fiscal real `[BLOQUEADO-EXTERNO]`

**El sistema de emisión está COMPLETO a nivel de plataforma** (R1–R5: modelo, puerto, guard de
inmutabilidad por triggers de Postgres, emisión manual, cron trimestral con recuperación, panel
de admin) **y no factura de verdad.**

La emisión válida se delega, por diseño, en un proveedor homologado externo detrás del puerto
`InvoicingProvider`. Hoy el único implementado es `StubInvoicingProvider`, que emite números de
prueba `DEV-YYYY-NNNNNN` y **PDFs sellados «NO VÁLIDO FISCALMENTE»**.

**Qué falta, exactamente:**

1. Elegir el proveedor homologado (decisión de Ernest con su asesor).
2. Una clase que implemente `InvoicingProvider` (`emitInvoice(input) → { number, pdf, verifactu,
   providerRef }`).
3. Un `case` nuevo en `InvoicingModule` para el token DI `INVOICING_PROVIDER`.
4. Configuración de credenciales / variables de entorno.

No hay que tocar nada más: el puerto se diseñó justo para que este cambio fuera local.

**Decisión de negocio todavía abierta, anotada aparte:** qué hacer con un usuario que tiene
movimientos facturables pero **sin datos fiscales** cuando se le cierra la ventana de
autoservicio (`Setting fiscalSelfServiceWindow`, hoy 6 meses provisional — el plazo exacto
también está pendiente del asesor). Hoy recibe un aviso in-app y sus transacciones siguen
facturables manualmente; qué pasa al vencer la ventana no está decidido.

---

## 6. RC.1 — Rate limit por IP sin verificar contra el proxy real `[SEGURIDAD]` — depende de §1

El rate limit por IP del formulario de contacto público (`ContactRateLimitService`, 5/h) depende
de **dos supuestos, ninguno verificado**:

1. Que `app.set('trust proxy', 1)` (`TRUST_PROXY_HOPS=1`) coincida con la topología real de
   despliegue.
2. Que ese proxy **sobrescriba** `X-Forwarded-For` con la IP real del cliente, en vez de
   reenviar lo que el cliente le mande.

Si el proxy reenvía la cabecera del cliente sin más, un atacante rota su propia IP declarada y
evade el límite por IP sin ningún esfuerzo.

**Red de seguridad mientras tanto:** el **límite global** (200/h) no depende de la IP y sigue
protegiendo aunque el de IP resulte falsificable. Es el motivo por el que esto no es crítico hoy.

**Acción:** confirmar el comportamiento exacto de `X-Forwarded-For` en el proxy/CDN de producción
antes o justo después del primer despliegue de esta feature. **No se puede cerrar sin §1.**

---

## Resumen por prioridad

| # | Pendiente | Etiqueta | Bloqueado por |
|---|---|---|---|
| 4.2 | `app.enableCors()` sin argumentos | `[SEGURIDAD]` | — |
| 6 | Rate limit por IP sin verificar | `[SEGURIDAD]` | §1 |
| 1 | Despliegue (nunca desplegado) | `[DEUDA]` | — |
| 4.2 | `conversation:read` en tiempo real | `[DEUDA]` | — |
| 4.2 | `DELETE /media` + huérfanas | `[DEUDA]` | — |
| 4.2 | Página de tag del blog (SEO) | `[DEUDA]` | — |
| 4.2 | Paginación home/categorías | `[DEUDA]` | — |
| 4.2 | `allowedDevOrigins` | `[DEUDA]` | — |
| 4.2 | Preparación de producción (MapTiler, Resend, Sentry, reindex) | `[DEUDA]` | §1 |
| 4.2 | Cierre de huecos de cobertura e2e | `[DEUDA]` | — |
| 2 | Hito 9.1 — Navegación | `[DEUDA]` | — |
| 3 | Hito 9.2 — Interfaz y estilo | `[DEUDA]` | — |
| 5 | Facturación fiscal real | `[BLOQUEADO-EXTERNO]` | proveedor homologado |

---

## Lo que NO está aquí

Para que este documento signifique algo, conviene decir qué se excluyó deliberadamente:

- **Documentación desfasada.** Seis documentos describen el plan original y ya no coinciden con
  lo construido (`contratos-api.md`, `estrategia-testing.md`, `diseno-busqueda-y-tags.md`,
  `diseno-backoffice.md`, `diseno-blog.md`, `diseno-valoraciones.md`, más el §16.2 de
  `diseno-facturacion.md`). Eso **no es trabajo pendiente de producto**: se arregla escribiendo,
  y va en su propia tanda.
- **Deuda ya cerrada** que alguna vez estuvo en una lista de pendientes: Redsys E2E (verificado
  contra el sandbox real con túnel cloudflared), el flaky de indexación de Meilisearch (cerrado
  en su causa raíz con `waitForTask`), el aislamiento de las corridas e2e (candado compartido en
  `apps/api/test/e2e-lock.js`), y la saga del CI.
- **Decisiones tomadas de no hacer algo.** El aislamiento de la base de test por worker de Jest
  se evaluó en el Hito 9 y **se decidió no hacerlo**: la suite tarda 110 s en serie y el
  paralelismo ahorraría ~60-70 s a cambio de una orquestación no trivial. No es deuda; es una
  decisión.
