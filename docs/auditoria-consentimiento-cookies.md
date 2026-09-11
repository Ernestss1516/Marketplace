# Auditoría del sistema de consentimiento de cookies (RGPD / ePrivacy)

> **Documento de diagnóstico y diseño. Cero código.** Todo el inventario está
> verificado contra el código a fecha 2026-09-11, con fichero y línea. Cuando una
> afirmación no se ha podido verificar leyendo este repo (porque depende del
> comportamiento de una librería o de un tercero en el navegador), se marca como
> **[medir en navegador]** y no se presenta como hecho.
>
> **No soy abogado.** La arquitectura que se propone sigue el patrón estándar del
> RGPD y de la Guía de cookies de la AEPD. Las decisiones propiamente jurídicas
> —qué es «estrictamente necesario», qué base legitima la telemetría propia, cuánto
> dura un consentimiento— van marcadas **[legal]** y son de Ernest, con asesoría.

---

## 0. Resumen ejecutivo

**Hoy la plataforma no tiene banner de cookies, ni registro de consentimiento, ni
ningún mecanismo que impida cargar nada.** Eso es lo esperado: no se ha construido.
Lo que esta auditoría aporta es la otra mitad, la que decide cómo se construye: **qué
carga la plataforma realmente hoy.**

Y la respuesta es mucho mejor de lo habitual, con dos excepciones concretas:

| Lo que suele haber en una plataforma así | Lo que hay aquí |
|---|---|
| Google Analytics / GTM / Meta Pixel | **Cero.** Ni un solo script de analítica de terceros (§1.6) |
| Analítica propia con cookie de visitante | **Sin cookie.** Hash efímero de IP+UA en Redis, 30 min (§1.4) |
| Google Fonts en runtime | **Self-hosted** desde el repo (`layout.tsx:39`) |
| Cookie de tema/idioma | **No existe.** No hay conmutador de tema ni multi-idioma (§1.3) |
| Publicidad con medición | **Sin medición.** `SponsoredAd` no cuenta impresiones ni clics (§1.7) |

**Las dos excepciones reales — y son las que justifican todo el sistema:**

1. **El iframe de vídeo carga siempre, sin barrera** (`VideoBlockRenderer.tsx:13-24`).
   YouTube va por `youtube-nocookie.com`, que es la variante buena; **pero Vimeo va
   por `player.vimeo.com`, que no lo es.** Un bloque de vídeo de Vimeo en una página
   pública contacta a Vimeo en cuanto se pinta la página, antes de que el usuario
   haga nada.
2. **El mapa de búsqueda carga tiles de MapTiler desde el navegador**
   (`MapView.tsx:71`). Se carga solo en la vista mapa —y el componente es `dynamic()`,
   así que el bundle ni se descarga fuera de ella—, pero **`Category.defaultView`
   puede ser `MAPA`** (`schema.prisma:773`): en esa categoría el mapa carga sin que el
   usuario haya pedido nada.

De ahí sale la conclusión estructural: **este sistema no es un banner con tres
botones y un cartel. El 90 % del trabajo real es la barrera de carga sobre esos dos
componentes.** Si se construyera solo el banner, el usuario podría rechazar todo y
Vimeo seguiría recibiendo su IP igual — que es exactamente el incumplimiento que el
banner pretendía cerrar.

**Y una consecuencia agradable:** como no hay analítica de terceros que bloquear, el
gate nace **casi vacío**. Lo que lo justifica hoy son dos componentes de contenido
incrustado, no un ecosistema de tracking. El mecanismo se construye completo porque es
lo que exige el cumplimiento y porque el día que se añada un GTM tiene que existir ya
—no porque hoy haya mucho que apagar.

**Un hueco que no es de cookies pero bloquea la entrega:** no existe página de
privacidad ni de cookies. El CMS puede crearlas (`Post.type = PAGE` → `/paginas/{slug}`)
pero **no hay ninguna sembrada** — `seed-settings.ts` y `seed.ts` no crean ninguna
página legal. El «ver más» del banner no tiene hoy adónde apuntar (§7).

---

# PARTE A — EL INVENTARIO LEGAL

La base de todo. Nada de lo que viene después es válido si esta tabla está mal, así
que cada fila lleva su verificación.

## 1.1 El criterio con el que se ha clasificado

Dos normas distintas, y confundirlas es el error clásico:

- **ePrivacy (art. 5.3, en España art. 22.2 LSSI)** regula **almacenar información en
  el equipo del usuario o acceder a la ya almacenada**. Cubre cookies, `localStorage`,
  `sessionStorage`, IndexedDB y huellas de dispositivo. Exige consentimiento **salvo**
  que sea imprescindible para (a) transmitir la comunicación o (b) prestar un servicio
  **expresamente solicitado** por el usuario.
- **RGPD** regula el **tratamiento de datos personales**, haya o no almacenamiento en
  el terminal. Una IP tratada en el servidor es dato personal aunque no se escriba nada
  en el navegador; lo que cambia es que la base jurídica puede ser el interés legítimo
  en vez del consentimiento.

**La distinción decide el caso más importante de este repo:** la telemetría propia
(§1.4) **no toca el terminal**, así que ePrivacy no la alcanza y no necesita banner.
Sigue bajo el RGPD, con interés legítimo. Es la diferencia entre tener que pedir
permiso y tener que documentarlo.

## 1.2 Almacenamiento en el terminal — lo que se escribe HOY en el navegador

| # | Qué | Quién lo escribe | Verificado en | Tipo | Categoría | ¿Consentimiento? |
|---|---|---|---|---|---|---|
| 1 | `authjs.session-token` | Auth.js v5 (`next-auth@beta`) | `auth.config.ts:18-20` (`maxAge: 7d`); `package.json` | Cookie `httpOnly` | **Esencial** | **No** — autenticación solicitada por el usuario |
| 2 | `authjs.csrf-token` | Auth.js, en cada flujo de login | Default de la librería, no configurado en el repo **[medir en navegador]** | Cookie `httpOnly` | **Esencial** | **No** — seguridad (CSRF) |
| 3 | `authjs.callback-url` | Auth.js, durante el login | Default de la librería **[medir]** | Cookie | **Esencial** | **No** — mecánica del login |
| 4 | `authjs.state`, `authjs.pkce.code_verifier`, `authjs.nonce` | Auth.js, **solo** en el flujo Google | `lib/auth/index.ts:39` (provider Google) — nombres por default **[medir]** | Cookies transitorias | **Esencial** | **No** — seguridad de OAuth, y solo si el usuario pulsa «entrar con Google» |
| 5 | `localStorage['dismissed-banners']` | Código propio | `BannerList.tsx:10,20,29` | `localStorage` | **Esencial / preferencia** **[legal]** | **No** *(ver abajo)* |

**Sobre la cookie de sesión (1).** El único parámetro fijado en el repo es la duración:
7 días, alineada a mano con el TTL del `accessToken` del backend, con el motivo escrito
en `auth.config.ts:12-17`. El resto —`httpOnly`, `sameSite: lax`, `path: /`, `secure` en
HTTPS, cookie *host-only*— son los defaults de Auth.js v5; **no hay bloque `cookies:` en
la configuración**, así que no se han verificado leyendo este repo. **Hay que
confirmarlos en el navegador al documentar la política**, porque la lista de cookies de
la página de información tiene que decir la verdad sobre nombres y duraciones.

> **Nota fina, sin consecuencia hoy:** la cookie lleva dentro el `accessToken` del
> backend (`auth.config.ts:65`). Eso no cambia su clasificación —sigue siendo esencial—
> pero sí significa que la cookie de sesión transporta una credencial, no un
> identificador opaco. Relevante para la descripción en la política, no para el banner.

**Sobre el descarte de banners (5).** Es almacenamiento en el terminal, así que ePrivacy
**sí** aplica: no es cookie, pero da igual, el artículo habla de «almacenar
información». La exención es defendible y la recomendación es acogerse a ella: guarda
**exclusivamente** los ids de los avisos que el propio usuario ha pulsado para
descartar, no identifica a nadie, no sale del navegador y existe para cumplir una
acción que el usuario acaba de solicitar explícitamente («no me lo vuelvas a enseñar»).
Es el mismo caso que el carrito de la compra, el ejemplo canónico de exención.
**[legal]** — decisión D2 (§9).

## 1.3 Lo que NO existe (verificado, no supuesto)

Esto importa tanto como lo que existe, porque es lo que impide inventar categorías:

| Sospecha razonable | Verificación | Resultado |
|---|---|---|
| Cookie de tema claro/oscuro | `grep next-themes` → solo dos comentarios que dicen que **no** existe (`globals.css:61`, `sonner.tsx:21`) | **No hay.** El tema se resuelve en el servidor desde la BD y se inyecta como `<style>` (`layout.tsx:110-121`) |
| Cookie de idioma | `<html lang="es">` fijo (`layout.tsx:117`); no hay i18n | **No hay.** Plataforma monolingüe |
| Cookie de preferencia de vista (lista/mapa) | `ViewSwitcher.tsx:21-27`: la vista viaja en la URL, **deliberadamente no en almacenamiento** | **No hay** |
| IndexedDB / Service Worker | `grep serviceWorker|indexedDB|navigator.storage` en `apps/web/src` | **Cero resultados** |
| Cookies puestas por el backend | `grep cookie` en `apps/api/src` → solo comentarios. La API se autentica con `Authorization: Bearer` y **`enableCors` sin `credentials`** (`main.ts:70-79`) | **El backend no escribe ni lee una sola cookie** |

## 1.4 La telemetría propia — el caso que hay que entender bien

Son dos sistemas, y **ninguno de los dos toca el navegador**:

**Vistas de anuncio** (`listings.controller.ts:305-315`, `listings.service.ts:1560-1590`):
el navegador hace `POST /listings/:slug/view` al montar la ficha. El backend calcula
`sha256(ip:userAgent)`, lo usa como clave de dedup en Redis con **TTL de 30 minutos**
(`VIEW_DEDUP_TTL_SECONDS`, línea 1558) y suma 1 a dos contadores agregados
(`Listing.viewCount` y una fila `ListingViewDaily` por anuncio y día).

**Impresiones de búsqueda** (`impressions.service.ts`): igual, con la particularidad de
que la búsqueda es Server Component, así que el BFF reenvía la identidad en una cabecera
`x-visitor-hash` (`visitor.ts:38-54`) — y el propio fichero explica por qué **no** se
usó una cookie: *«sería más precisa, pero es un identificador PERSISTENTE nuevo, con lo
que eso arrastra»* (`visitor.ts:25-30`). El dedup es el mismo, 30 minutos
(`impressions.service.ts:54`), y el resultado también son contadores agregados.

**Qué se conserva.** Nada individual. El hash vive 30 minutos en Redis como clave de
deduplicación y desaparece; **no se escribe en Postgres en ningún momento**. Lo que
persiste son sumas por anuncio y día, con purga a 180 días (`RETENTION_DAYS`, línea 57).
No hay perfil, no hay historial de navegación, no hay forma de reconstruir qué vio una
persona.

**La clasificación, y su razonamiento:**

- **ePrivacy: no aplica.** No se almacena ni se lee nada en el equipo terminal. No hay
  cookie, no hay `localStorage`, y el hash no se devuelve al navegador.
- **RGPD: sí aplica**, porque la IP y el user-agent son datos personales en el instante
  en que se tratan, aunque se hashee acto seguido y no se conserve.
- **Base jurídica: interés legítimo (art. 6.1.f)**, no consentimiento. Sostienen esa
  ponderación: la finalidad es una métrica agregada para el vendedor y el operador; el
  tratamiento es mínimo y no reversible a efectos prácticos; no hay perfilado, ni
  cruce, ni cesión; y la alternativa menos intrusiva (no medir nada) haría inviable la
  estadística que el producto ya ofrece a los usuarios Pro.

**Conclusión: la telemetría propia NO va en el banner.** **[legal]** — es la decisión
D1 (§9), y es la más importante del documento porque decide si existe o no una
categoría «analítica». Recomendación: **no pedir consentimiento**, documentarla en la
política de privacidad con su base jurídica y su plazo, y ofrecer el derecho de
oposición por el canal ordinario.

> **Cuidado con una tentación que rompería esto.** El día que alguien quiera «mejorar»
> el dedup metiendo una cookie de visitante —que es la mejora obvia y el propio
> `visitor.ts` la contempla y la descarta—, **la telemetría cruza la frontera de
> ePrivacy y pasa a necesitar consentimiento previo**. Ese cambio, que parece un ajuste
> de precisión, es en realidad una decisión legal. Conviene que quede escrito en el
> código, no solo aquí.

## 1.5 Terceros que cargan desde el navegador — el corazón del problema

| # | Tercero | Dónde | Cuándo carga hoy | Qué pasa | Categoría |
|---|---|---|---|---|---|
| 1 | **Vimeo** (`player.vimeo.com`) | `VideoBlockRenderer.tsx:10` | **Al pintar la página**, sin barrera | El iframe contacta a Vimeo y **pone cookies propias de Vimeo** desde la carga **[medir]** | **Contenido de terceros** → **SÍ requiere consentimiento** |
| 2 | **YouTube** (`youtube-nocookie.com`) | `VideoBlockRenderer.tsx:8` | **Al pintar la página**, sin barrera | El dominio *nocookie* no escribe cookies de seguimiento al cargar, **pero sí al pulsar play**, y en ambos casos recibe IP, referer y user-agent **[medir]** | **Contenido de terceros** → **SÍ** |
| 3 | **MapTiler** (`api.maptiler.com`) | `MapView.tsx:71` | Solo en vista `MAPA`; el bundle es `dynamic()` (`MapViewClient.tsx:10`) | Descarga el JSON de estilo y las tiles: transfiere **IP + referer** a un tercero (Suiza, con decisión de adecuación). Cookies: probablemente ninguna **[medir]** | **Contenido de terceros** → **SÍ** *(matizado, ver abajo)* |

**Los tres puntos que hay que ver de esta tabla:**

**El vídeo carga sin ninguna barrera.** `VideoBlockRenderer` pinta el `<iframe>` en
cuanto se renderiza el bloque, en cualquier página del blog o del CMS que lo contenga.
No hay click-to-play. Con Vimeo eso es una transferencia a un tercero, con cookies, sin
consentimiento y sin aviso. **Es el incumplimiento más claro que hay hoy**, y el más
fácil de arreglar (§4).

**El mapa está a medio camino, y el matiz decide su tratamiento.** El `dynamic()` ya
consigue que el código de MapLibre ni se descargue fuera de la vista mapa, lo cual es
una ventaja de partida. Y cuando el usuario pulsa «Mapa» en el `ViewSwitcher`, está
solicitando expresamente ese servicio — un caso razonablemente sólido de exención. **El
problema es `Category.defaultView`** (`schema.prisma:773`): si una categoría lo tiene
en `MAPA`, el usuario aterriza en el mapa sin haber pedido nada y MapTiler recibe su IP
igual. Recomendación: tratar el mapa como contenido de terceros con gate, y que el gate
se dé por satisfecho con el clic en «Mapa» del selector de vista — así el flujo normal
no gana ni un clic extra, y el caso de `defaultView: MAPA` sí queda cubierto. **[legal]**

**Ninguno de los tres es analítica.** Son contenido incrustado que el usuario quiere
ver. Eso importa para redactar el banner: la categoría honesta se llama «contenido de
terceros», no «marketing» ni «estadística».

## 1.6 Analítica y publicidad de terceros: cero

Verificado con `grep` de `gtag`, `googletagmanager`, `google-analytics`, `fbq`,
`facebook.net`, `GTM-`, `hotjar`, `mixpanel`, `posthog`, `plausible`, `segment.com`,
`clarity.ms` sobre todo el repositorio. **Ni una sola coincidencia real** (los únicos
resultados eran la palabra «plausible» en prosa castellana dentro de la documentación).

Se verificó además el inventario completo de dominios externos citados en
`apps/web/src`. Aparte de los tres de §1.5, todo lo demás es inofensivo: `wa.me` y
`t.me` son enlaces `<a href>` de compartir que no cargan nada hasta que el usuario
pulsa y sale del sitio (`ShareButton.tsx:54-55`); `schema.org` son URIs de datos
estructurados, no peticiones; el resto son literales de test.

## 1.7 Pagos y otros terceros que NO son del banner

| Qué | Verificado | Por qué queda fuera |
|---|---|---|
| **Redsys** | `redsys.service.ts:428` `createRedirectForm`, devuelve `tpvUrl` + parámetros firmados | **Redirección POST al dominio de Redsys.** No hay script ni iframe de Redsys en nuestras páginas. Las cookies las pone Redsys en su dominio, donde es responsable él, y son imprescindibles para una transacción que el usuario acaba de solicitar |
| **Stripe Checkout** | `CheckoutButton.tsx:84` (`window.location.href = checkoutUrl`), `billing.service.ts:118-192` | Igual: **redirección** a `checkout.stripe.com`. Sin Stripe.js ni Elements incrustados |
| **Google OAuth** | `lib/auth/index.ts:39` | Navegación a `accounts.google.com` **solo** si el usuario pulsa «entrar con Google». Servicio expresamente solicitado |
| **Nominatim / MapTiler geocoding** | `geocoding.service.ts:118,152` | Llamadas **servidor a servidor** desde NestJS. El navegador del usuario no interviene; su IP no llega |
| **MinIO / R2** (imágenes, vídeos) | `image-domains.ts`, `R2Service` | Almacenamiento de objetos propio. Sirve bytes, no escribe cookies |
| **Fuente Inter** | `layout.tsx:39-43` (`next/font/local`) | **Servida desde el repo.** Fue Google Fonts y se sacó a propósito (CI); hoy no hay ninguna petición a `fonts.gstatic.com` en runtime |
| **`SponsoredAd`** | `schema.prisma:2819-2848` | Publicidad **propia**: imagen del bucket propio, servida desde la BD, enlace externo que solo se abre al clic. **No hay contador de impresiones ni de clics** — el modelo no tiene esos campos, y las impresiones de búsqueda excluyen explícitamente el patrocinado (`impressions.service.ts:122`). **No genera categoría «marketing»** |

---

# PARTE B — LAS CATEGORÍAS REALES

## 2. Dos categorías, y ninguna más

Con el inventario delante, las categorías que corresponden a cosas que existen de
verdad son **exactamente dos**:

| Categoría | Qué contiene | ¿Se puede rechazar? | Estado sin consentimiento |
|---|---|---|---|
| **Esenciales** | Sesión y seguridad de Auth.js (§1.2, filas 1-4). El descarte de avisos (fila 5). La propia cookie de consentimiento (§3) | **No** — se informa, no se pide | Activas |
| **Contenido de terceros** | Vídeos incrustados (YouTube, Vimeo) y mapa de búsqueda (MapTiler) | **Sí** | **No se carga nada.** En su lugar, un marcador con botón de carga |

**Las que NO se crean, y por qué:**

- **«Analítica»** — la telemetría propia no toca el terminal y va por interés legítimo
  (§1.4). Crear la categoría implicaría que rechazarla apaga algo, y no hay nada que
  apagar: el contador seguiría contando igual, con lo cual el banner mentiría. **Si la
  decisión D1 sale al revés**, entonces sí existe y el gate la cubre (§4.4).
- **«Marketing» / «Publicidad»** — no hay ningún tercero publicitario, y la publicidad
  propia no mide nada (§1.7). Un banner con esta categoría mentiría al usuario y, peor,
  le haría creer que se le está siguiendo cuando no es así.
- **«Preferencias»** — no hay cookie de tema, ni de idioma, ni de vista (§1.3). Lo
  único que se guarda es el descarte de avisos, que es esencial por la exención de
  «servicio solicitado» y no merece una categoría propia con un solo miembro.

> **La regla que conviene dejar escrita para el futuro:** una categoría existe cuando
> hay algo real que apagar. El día que entre una analítica de terceros, se añade
> «Analítica» **en la misma ráfaga** que la introduce — nunca antes «para dejarlo
> preparado», porque una categoría vacía es una mentira al usuario, y nunca después,
> porque sería un incumplimiento.

---

# PARTE C — LA ARQUITECTURA

## 3. El modelo de consentimiento: guardar, demostrar, cambiar

El RGPD exige poder **demostrar** el consentimiento (art. 7.1). Una cookie en el
navegador del usuario no demuestra nada: la escribe el propio sitio y el usuario puede
borrarla. Por eso el modelo tiene **dos mitades con funciones distintas**, y conviene
no confundirlas.

### 3.1 La cookie — para decidir qué cargar

Una cookie propia, **esencial** (la propia AEPD la exenta: es imprescindible para
recordar la elección del usuario).

| Propiedad | Valor propuesto | Por qué |
|---|---|---|
| Nombre | `mp_consent` | Prefijo propio, legible en la política |
| Contenido | JSON compacto: `{v: <versión del texto>, c: ["terceros"], t: <epoch>, id: <opaco>}` | Lo mínimo para decidir la carga **sin ir al servidor** |
| `httpOnly` | **No** | El gate de cliente tiene que leerla para el contenido dinámico (§4.2) |
| `sameSite` | `Lax` | Molde del repo |
| `secure` | Sí en producción | |
| Duración | **6 meses** **[legal]** | La Guía de la AEPD admite hasta 24 meses; 6 es un punto conservador y habitual. Decisión D4 |
| Quién la escribe | El propio frontend al pulsar un botón del banner | Es una elección del usuario, no un dato de negocio |

**Por qué la decisión de carga se toma con la cookie y no consultando al servidor:** la
plataforma es *read-heavy* y dependiente del SEO. Una llamada a la API antes de decidir
si se pinta un vídeo añadiría latencia al render en todas las páginas. La cookie viaja
en la petición, así que el **servidor ya la tiene al renderizar** (§4.1) y el coste es
cero.

### 3.2 El registro en servidor — para demostrarlo

Un modelo nuevo, `ConsentRecord`. **Se escribe una fila por decisión** (aceptar,
rechazar o cambiar), nunca se actualiza: el historial *es* la prueba.

| Campo | Contenido | Nota |
|---|---|---|
| `id` | cuid | El mismo valor va en el campo `id` de la cookie: es lo que une las dos mitades |
| `categories` | `String[]` | Qué se aceptó exactamente |
| `policyVersion` | `String` | La versión del texto consentido (§3.3) |
| `createdAt` | `DateTime` | El cuándo |
| `userId` | `String?` | Solo si había sesión. `onDelete` coherente con el borrado de cuentas |
| `ipHash` | `String?` | **`sha256` de la IP, nunca la IP en claro** — molde de §1.4 y de `visitor.ts` |
| `userAgent` | `String?` | Para el contexto del registro **[legal]**: valorar si aporta lo bastante como para guardarlo |
| `action` | `GRANTED` / `REJECTED` / `UPDATED` / `WITHDRAWN` | Para leer el historial sin interpretarlo |

**Cómo se escribe sin estorbar.** El banner hace un `POST /consent` que devuelve el
`id`. **Fire-and-forget, fail-open**: si la API no responde, la cookie se escribe igual
con un `id` generado en el cliente y el usuario nunca ve un error. Es la misma doctrina
que ya gobierna la telemetría del repo (`impressions.service.ts:24-28`: *«el tracking
nunca debe afectar la experiencia»*) y es la correcta aquí también — un fallo al
registrar la prueba no puede impedir que se respete la voluntad del usuario. El riesgo
que se acepta es una prueba incompleta en caso de caída; el riesgo contrario sería
ignorar un rechazo, que es mucho peor. **[legal]** — confirmar que es aceptable.

**Usuarios logueados.** El `userId` en la fila es suficiente; **no hace falta un campo
en `User`**. Un campo ahí guardaría solo el último estado y perdería el historial, que
es justo lo que se necesita demostrar. La consulta «cuál es el consentimiento vigente de
este usuario» es la fila más reciente con su `userId`, y con un índice
`(userId, createdAt)` es trivial.

**Cuando un anónimo se loguea**, la cookie ya lleva el `id` de su registro: se escribe
una fila `UPDATED` con el `userId` puesto, enlazando ambas. No se reescribe la fila
vieja — el historial no se toca nunca.

**Retención del registro.** **[legal]** Propuesta: conservar mientras el consentimiento
esté vigente más el plazo de prescripción de la posible reclamación. Y una nota de
coherencia con el repo: el borrado de cuentas ya existe
(`docs/auditoria-borrado-cuentas.md`) y tendrá que decidir qué hace con estas filas
—probablemente **anonimizar el `userId` pero conservar la fila**, porque la prueba del
consentimiento es precisamente lo que protege al operador frente a una reclamación
posterior. Es una excepción que hay que justificar por escrito, no un descuido.

### 3.3 La versión del texto: qué obliga a volver a preguntar

El campo `policyVersion` es lo que hace que el sistema no se quede congelado. La regla:

- El admin edita el texto del banner (§6) → **la versión sube**.
- Al renderizar, si `cookie.v !== versión actual` → **el banner vuelve a aparecer**, con
  el consentimiento anterior como estado de partida en el detalle.
- Se añade una categoría nueva → **siempre** re-consentimiento, sin excepción.

**Qué NO debe subir la versión:** corregir una errata o reordenar una frase. Si cada
retoque de estilo re-pregunta a toda la base de usuarios, el admin dejará de tocar el
texto o los usuarios empezarán a aceptar sin leer — las dos son peores que la errata.
Propuesta: la versión es un **campo aparte que el admin sube explícitamente**, con un
aviso claro en la pantalla de administración de que hacerlo vuelve a preguntar a todo el
mundo. No derivarla de un hash del texto. **[legal]** — decisión D5.

### 3.4 Cambiarlo después

Tres vías, y las tres llevan al mismo sitio:

1. **Enlace permanente en el footer** — «Configuración de cookies». Encaja con lo que ya
   existe: `FooterItem` con `type: INTERNAL` (`schema.prisma:2938-2962`), gestionable
   desde el backoffice sin tocar código. Es la vía que exige el RGPD para que retirar el
   consentimiento sea tan fácil como darlo.
2. **La propia página de cookies** (§7) lleva el panel al final.
3. **Desde el marcador de un vídeo o mapa bloqueado** (§4.3), que ofrece cargar ese
   contenido y, con él, aceptar la categoría.

Retirar el consentimiento escribe una fila `WITHDRAWN` y reescribe la cookie. **Lo que
ya se cargó en la página actual no se puede descargar**: la vía honesta es recargar la
página al guardar el cambio, y decirlo («Se recargará la página para aplicar tus
preferencias»).

## 4. El control de cargas — el gate

Es la pieza que convierte esto en cumplimiento. **La regla, sin matices: sin
consentimiento, el recurso de terceros NO se pide.** No se carga oculto, no se pide y se
descarta, no se pinta con `display:none`. **No se pide.**

### 4.1 La decisión se toma en el servidor

La cookie viaja en cada petición, así que el layout ya la tiene al renderizar
(`cookies()` de Next). Un lector único —una función tipo `leerConsentimiento()`— la
parsea y expone el estado a todo el árbol.

Tres ventajas que importan en esta plataforma concretamente:

- **El HTML sale ya correcto.** El iframe de Vimeo no llega a estar en el marcado, no
  hay una ventana de milisegundos en la que el navegador pueda empezar a resolver el
  dominio.
- **Sin parpadeo ni CLS.** El molde ya está probado en este repo: el tema se resuelve
  igual, en el layout de servidor, y `layout.tsx:80-90` explica exactamente por qué —
  *«si el tema llegara por JavaScript de cliente habría un instante con los colores por
  defecto y después un repintado»*. Misma lógica, mismo sitio.
- **Compatible con la caché.** Cuidado aquí: las páginas públicas se cachean, y una
  respuesta cacheada no puede depender de la cookie de un usuario. **Por eso el gate
  envuelve componentes, no páginas** — el marcador es el estado por defecto del HTML
  cacheado, y el contenido se carga desde el cliente cuando hay consentimiento (§4.2).
  Sin esto, o se rompe la caché o se sirve el consentimiento de otro. **Es el punto de
  implementación más delicado de todo el sistema.**

### 4.2 Y se completa en el cliente

Un contexto de React (montado en el layout con el estado leído del servidor) permite
que:

- el banner sepa si debe aparecer;
- los componentes que se montan después de la carga inicial —el mapa por `dynamic()`—
  consulten el estado;
- al cambiar la elección, todo reaccione a la vez.

### 4.3 Qué envuelve exactamente, hoy

**Dos sitios. Nada más.** El inventario no da para más, y ahí está la buena noticia:

| Componente | Fichero | Sin consentimiento pinta… |
|---|---|---|
| Vídeo incrustado | `VideoBlockRenderer.tsx` | Un marcador con la miniatura o un fondo neutro, el nombre del proveedor («Este vídeo se carga desde Vimeo») y un botón **«Cargar el vídeo»** |
| Mapa de búsqueda | `MapViewClient.tsx` — envolver **aquí**, no en `MapView`, para que el `dynamic()` ni se dispare | Un marcador del mismo tamaño (**mismo alto exacto que el mapa**, para no mover el layout) con **«Cargar el mapa»** y un enlace a la vista lista, que ya existe |

**El botón del marcador es consentimiento válido y granular**: el usuario pide ese
contenido concreto, con información previa sobre quién es el tercero. Dos matices:

- Ofrecer **«cargar solo esta vez»** frente a **«cargar siempre este tipo de
  contenido»**. La segunda escribe la categoría en la cookie; la primera no escribe
  nada y vale solo para esa página.
- El marcador **no puede ser un cartel triste**. Es lo que verán los usuarios que
  rechacen, y si es feo el resultado práctico es presionar a aceptar — lo que el RGPD
  llama, precisamente, consentimiento no libre.

**Lo que el gate NO debe envolver**, para que no se difumine: la sesión, el descarte de
avisos, la telemetría propia, los pagos, el login con Google. Están en §1.2, §1.4 y
§1.7 con su razón. Un gate que envuelve de más acaba bloqueando el login.

### 4.4 Cómo queda preparado para lo que no existe todavía

El día que entre un GTM, un Meta Pixel o cualquier script de analítica de terceros:

1. Se añade la categoría (**en la misma ráfaga**, §2).
2. El script se carga **exclusivamente** a través del gate. Nunca en `layout.tsx`
   directamente, nunca con `<Script>` de Next fuera del gate. Conviene que esa regla
   quede escrita en `apps/web/CLAUDE.md`, donde alguien la leerá antes de añadir el
   script — no solo en este documento.
3. Se actualiza la página de cookies (§7) y **se sube la versión** (§3.3).

**Y una que va antes que todas:** si algún día se pone una **CSP** —hoy no hay, y está
verificado y escrito en `layout.tsx:101-104`—, el gate se vuelve mucho más robusto,
porque la política puede prohibir los dominios de terceros a nivel de navegador. Es
defensa en profundidad para más adelante, no un requisito de ahora.

## 5. El banner

### 5.1 Los tres botones, al mismo nivel

| Botón | Qué hace |
|---|---|
| **Aceptar** | Acepta todas las categorías |
| **Rechazar** | Rechaza todas las no esenciales |
| **Ver más información** | Abre el detalle: categorías con interruptor, y enlace a la página de cookies |

**«Al mismo nivel» es literal y es lo que más se incumple**: mismo tamaño, mismo peso
tipográfico, mismo contraste, misma jerarquía visual. Nada de «Aceptar» en primario
sólido y «Rechazar» como enlace gris en una esquina. La AEPD ha sancionado
específicamente ese patrón. Con el sistema de estilo del repo: **los tres con la misma
variante de botón**, y si acaso se distingue alguno, que sea por posición, no por peso.

Tampoco vale: cerrar con la X equivaliendo a aceptar, seguir navegando equivaliendo a
aceptar, o un muro que impida usar el sitio sin decidir. **Si el usuario ignora el
banner, no hay consentimiento, y no se carga nada de terceros.** Ese es el estado por
defecto correcto y no hay que forzarlo.

### 5.2 Cuándo aparece

- **Primera visita sin cookie válida** → aparece.
- **Con cookie de la versión actual** → no aparece, ni aceptando ni rechazando. Un
  usuario que rechazó **no debe volver a ver el banner** hasta que cambie la versión o
  él mismo lo reabra; insistir es otra forma de forzar.
- **Versión distinta** (§3.3) → reaparece.
- **Reabierto desde el footer** → aparece como panel de configuración, con el estado
  actual cargado.

### 5.3 Accesibilidad

Esto decide si el banner es utilizable o una trampa:

- **No es un `alertdialog` modal.** Un modal atrapa el foco y bloquea el contenido, lo
  que perjudica al usuario y a Google. Propuesta: una región fija al pie, con
  `role="region"` y `aria-label`, **no modal**. El detalle de «ver más» sí puede ser un
  diálogo, porque ahí el usuario ha decidido entrar.
- **El foco va al banner al aparecer** (o es el primer elemento tabulable del
  documento), sin robarle el foco a quien ya estuviera escribiendo.
- **Recorrido de teclado completo** por los tres botones, en el orden visual.
- **`Esc` no cierra el banner principal** — cerrar sin decidir sería un consentimiento
  implícito. Sí cierra el diálogo de detalle, volviendo al banner.
- **Contraste AA** sobre el fondo. El repo ya tiene verificación de contraste en el
  sistema de estilo (`estilo/contraste-modelos.spec.ts`); el banner debe entrar por ahí.
- No tapar contenido de forma permanente en móvil: reserva su espacio, no flota sobre
  el último párrafo.

### 5.4 SEO y rendimiento — crítico en esta plataforma

Es *read-heavy* y vive del SEO, así que esto no es un detalle:

- **No bloquea el render.** Nada de esperar a JavaScript para pintar la página.
- **CLS cero.** El banner **no debe empujar el contenido**. Va fijo al pie, en su propia
  capa, con su espacio reservado desde el primer pintado. Un banner que aparece a los
  400 ms y desplaza el artículo es un CLS medible y una penalización real.
- **LCP sin tocar.** El banner nunca puede ser el elemento más grande; con la región al
  pie y el contenido intacto, no lo será.
- **Los marcadores del gate reservan el tamaño exacto** del contenido que sustituyen
  (§4.3). Un marcador más bajo que el mapa provoca un salto al cargarlo.
- **Los buscadores ven el sitio completo.** El gate solo afecta a terceros incrustados;
  el contenido indexable —anuncios, fichas, blog— no pasa por él en ningún caso.

## 6. La configuración desde administración

### 6.1 El molde ya existe en el repo

No hay que inventar nada: `Setting` (`schema.prisma:1976-1987`, clave + valor JSON +
quién y cuándo), editado desde `/admin/ajustes` con auditoría en `AuditLog` e
invalidación de caché por tag. `BrandingService` (`branding.service.ts`) es el ejemplo
completo del patrón, incluida la lectura cacheada desde el frontend con
`unstable_cache` y un tag que el backend tumba al guardar (`lib/api/estilo.ts:34-37`).
Esto encaja con el norte multi-instancia exactamente igual que los logos y la paleta:
**cada instancia tiene su fila, el código es el mismo.**

### 6.2 Las claves propuestas

| Clave | Qué | Frontera |
|---|---|---|
| `cookieBannerTitle` | Titular del banner | **Texto** — admin |
| `cookieBannerBody` | Cuerpo del mensaje | **Texto** — admin |
| `cookieBannerAcceptLabel` | Etiqueta de «Aceptar» | **Texto** — admin, con validación (§6.3) |
| `cookieBannerRejectLabel` | Etiqueta de «Rechazar» | **Texto** — admin, con validación |
| `cookieBannerMoreLabel` | Etiqueta de «Ver más» | **Texto** — admin |
| `cookiePolicyPageId` | La página del CMS a la que apunta «ver más» | **Destino** — admin elige entre las páginas existentes |
| `cookiePolicyVersion` | La versión vigente del texto (§3.3) | **Admin, con aviso explícito** de que subirla re-pregunta a todos |

**Una lección del repo que aplica directamente aquí.** `docs/auditoria-pro-video.md`
documenta que `videoEnabled` estuvo en la whitelist del backend pero **no en la semilla**,
así que en producción la fila no existía y la funcionalidad era inalcanzable: nadie podía
encenderla. `seed-settings.ts:1-17` existe precisamente para que eso no se repita.
**Estas claves tienen que nacer en `SEED_SETTINGS` con textos por defecto en español que
funcionen sin que nadie los toque** — y el banner debe funcionar correctamente aunque
falten todas las filas, cayendo a textos por defecto del código, igual que el tema cae a
`globals.css` cuando el backend no responde (`layout.tsx:91-97`).

### 6.3 La frontera: el admin edita el texto, nunca la mecánica

**Lo que el admin SÍ controla:** los textos, las etiquetas de los botones, a qué página
enlaza «ver más», y la versión.

**Lo que el admin NUNCA controla, y debe ser imposible desde la interfaz:**

- Qué categorías existen (salen del inventario, §2).
- Qué se bloquea sin consentimiento (§4).
- Si el banner aparece, o si puede desactivarse. **No hay interruptor de apagado.**
- Que rechazar sea tan fácil como aceptar: los tres botones son iguales **por
  construcción**, no por configuración. No debe existir un ajuste de «estilo del botón
  de aceptar».
- Cómo y dónde se guarda el consentimiento.
- Las duraciones.

**Y las etiquetas necesitan validación**, porque el texto libre puede romper la
legalidad por la puerta de atrás: si alguien pone «Aceptar» / «Aceptar todo» en los dos
botones, el sistema es no conforme aunque la mecánica sea perfecta. Propuesta: longitud
máxima, obligatorio no vacío, y un aviso en la pantalla explicando que el botón de
rechazo debe expresar un rechazo inequívoco. **[legal]** — valorar si hace falta algo
más duro que un aviso.

## 7. La página de «más información»

**Hoy no existe ninguna página legal.** El CMS soporta `Post.type = PAGE` →
`/paginas/{slug}` (`schema.prisma:2858-2910`), la infraestructura está entera —editor de
bloques, SEO, enlazado desde footer y nav con protección de borrado— pero **ni el seed ni
el repo crean una página de privacidad ni de cookies**. Verificado.

**Propuesta: una página de cookies dedicada**, separada de la de privacidad. La AEPD lo
admite y lo habitual es separarlas: la de cookies cambia cuando cambia el inventario
técnico, la de privacidad cuando cambia el tratamiento de datos. Mezclarlas obliga a
tocar un documento largo por cada cambio técnico pequeño.

**Qué lleva** (alimentada por §1, que es lo que hace que no mienta):

1. Qué es una cookie, y la aclaración de que también se cubre `localStorage`.
2. **La tabla del inventario**: nombre, quién la pone, para qué, duración, categoría.
   Con los nombres reales y las duraciones reales — de ahí que los **[medir]** de §1.2
   haya que cerrarlos antes de publicar.
3. Las categorías y qué implica rechazar cada una.
4. Los terceros, con nombre, país y enlace a su propia política: Vimeo, YouTube/Google,
   MapTiler.
5. **La telemetría propia explicada aunque no necesite consentimiento** (§1.4). Es una
   ventaja competitiva contarlo: «medimos cuántas veces se ve un anuncio, sin cookies,
   sin guardar tu IP y sin poder saber quién eres». La transparencia del art. 13 la
   exige de todas formas.
6. Cómo cambiar la elección, con **el panel de configuración incrustado al final**.
7. Cómo borrar cookies en los navegadores principales.

**Enlazada desde:** el «ver más» del banner (vía `cookiePolicyPageId`), un `FooterItem`
permanente, y la política de privacidad.

**Y falta la de privacidad**, que es un documento mayor y en gran medida ajeno a esta
auditoría (cubre todo el tratamiento: cuentas, anuncios, mensajería, facturación,
moderación). **Hay que decir que no existe**, porque el sistema de cookies no se puede
dar por entregado apuntando a una página vacía.

---

# PARTE D — EL PLAN

## 8. Ráfagas

El orden no es arbitrario: **primero lo que cierra el incumplimiento actual**, luego el
aparato completo. Si algo se queda por el camino, que sea lo último y no lo primero.

### Ráfaga 1 — El gate y los marcadores *(cierra el incumplimiento real)*
El lector de la cookie en servidor, el contexto de cliente, y los dos marcadores
(vídeo y mapa). **Sin banner todavía**: sin cookie no hay consentimiento, así que el
estado por defecto es «no se carga», con un botón por contenido que permite cargarlo.
Al terminar esta ráfaga **Vimeo ya no recibe la IP de nadie sin haberlo pedido** — que
es el problema concreto de §1.5. Es la ráfaga que más vale por sí sola.

### Ráfaga 2 — El modelo de consentimiento
`ConsentRecord`, `POST /consent` fail-open, la cookie `mp_consent`, el enlace anónimo →
logueado. Sin UI propia: la consume el botón de los marcadores de la ráfaga 1.

### Ráfaga 3 — El banner
Los tres botones al mismo nivel, el detalle por categorías, accesibilidad (§5.3), el
comportamiento de CLS (§5.4). Con textos por defecto en el código, todavía sin admin.

### Ráfaga 4 — La configuración de admin
Las `Setting` de §6.2 **sembradas en `SEED_SETTINGS`**, la pantalla en `/admin/ajustes`,
la lectura cacheada con su tag, la validación de etiquetas, y el aviso de la versión.

### Ráfaga 5 — La página de cookies y el enlace del footer
La página en el CMS con el inventario cerrado (los **[medir]** de §1.2 resueltos en
navegador), el panel de configuración incrustado, el `FooterItem`, y el enlace desde el
banner. **Aquí se cierra el sistema.**

### Fuera de ráfaga, pero bloqueante para producción
La **política de privacidad** (§7). No es trabajo de cookies, es redacción legal, y
puede ir en paralelo desde el primer día.

### Verificación, en toda ráfaga
Dos que no pueden faltar y que el repo ya sabe hacer:

- **Un test que falle si un tercero se carga sin consentimiento.** Playwright
  interceptando peticiones de red: sin cookie de consentimiento, **cero peticiones** a
  `player.vimeo.com`, `youtube-nocookie.com` y `api.maptiler.com`. Es el único test que
  comprueba de verdad lo que exige la ley, y es la red que evita que una ráfaga futura
  reintroduzca un iframe suelto sin darse cuenta.
- **Capturas** del banner y de los marcadores, que es el molde de verificación visual
  que el repo ya usa para el sistema de estilo.

---

## 9. Las decisiones para Ernest

| # | Decisión | Recomendación | Por qué importa |
|---|---|---|---|
| **D1** | **¿La telemetría propia (vistas e impresiones) requiere consentimiento?** | **No.** Interés legítimo: no toca el terminal, no persiste identificadores, solo agrega (§1.4) | **Decide si existe la categoría «analítica».** Si sale que sí, el banner gana una categoría y el gate tiene que poder apagar `trackView` — trabajo real, no una casilla |
| **D2** | ¿El `localStorage` de descarte de avisos es esencial? | **Sí**, exención de «servicio expresamente solicitado» (§1.2) | Si no lo fuera, aparecería una categoría «preferencias» con un solo miembro |
| **D3** | **El mapa: ¿basta el clic en «Mapa» como consentimiento, o hace falta el marcador siempre?** | Gate con marcador, satisfecho por el clic en el selector de vista (§1.5) | Es el equilibrio entre no estorbar el flujo normal y cubrir el caso `Category.defaultView = MAPA`, donde el usuario no pidió nada |
| **D4** | Duración de la cookie de consentimiento | **6 meses** (la AEPD admite hasta 24) | Más corta = más veces el banner; más larga = consentimiento más viejo |
| **D5** | ¿La versión del texto la sube el admin a mano, o se deriva del texto? | **A mano, con aviso** (§3.3) | Derivarla haría que una errata corregida re-preguntase a toda la base de usuarios |
| **D6** | ¿Página de cookies dedicada o dentro de la de privacidad? | **Dedicada** (§7) | El inventario técnico cambia más a menudo que la política de tratamiento |
| **D7** | ¿Se conserva el `ConsentRecord` al borrar una cuenta? | **Anonimizar el `userId`, conservar la fila** (§3.2) | Es la prueba que protege al operador. Requiere justificación escrita y encaja con `docs/auditoria-borrado-cuentas.md` |
| **D8** | ¿Quién redacta la política de privacidad y la de cookies? | Asesoría legal; el inventario de §1 es el insumo técnico | El sistema no se puede entregar apuntando a una página que no existe |

### Lo que hay que medir en navegador antes de publicar la política

Cuatro cosas que **no se pueden verificar leyendo este repo** y que la página de
cookies tiene que decir con exactitud:

1. Los nombres y duraciones reales de las cookies de Auth.js v5 en producción (§1.2).
2. Qué escribe `player.vimeo.com` exactamente al cargar el iframe.
3. Qué escribe `youtube-nocookie.com` al cargar, y qué añade al pulsar play.
4. Si `api.maptiler.com` escribe algo, o solo recibe la IP.

Se resuelven en una sesión con las herramientas de desarrollo, y son el último requisito
de la ráfaga 5.

---

## 10. Lo que esta auditoría no cubre

Para que no se dé por cerrado lo que no lo está:

- **La política de privacidad completa** (todo el tratamiento de datos de la
  plataforma). Aquí solo se cubre la parte de cookies y trazas.
- **El registro de actividades de tratamiento** (art. 30) y el análisis de
  transferencias internacionales. MapTiler (Suiza) y YouTube/Vimeo (EE. UU.) son
  transferencias que el registro debe recoger, con su base.
- **Los derechos ARCO-POL** más allá del consentimiento de cookies. La exportación de
  datos ya existe (`DataExport`) y el borrado de cuentas tiene su propia auditoría.
- **La revisión legal.** Este documento describe una arquitectura que sigue el patrón
  estándar; **no sustituye la validación de un profesional.**
