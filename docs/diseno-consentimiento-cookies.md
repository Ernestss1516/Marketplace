# Diseño — Sistema de consentimiento de cookies

> **Documento de diseño. Cero código.** Desarrolla las 8 decisiones aprobadas en
> [`auditoria-consentimiento-cookies.md`](./auditoria-consentimiento-cookies.md) hasta
> arquitectura concreta y plan de ráfagas. Todo lo que se afirma del código está
> verificado contra fichero y línea a fecha 2026-09-11.
>
> **Las 8 decisiones son el marco: se desarrollan, no se reabren.** Las cinco marcadas
> **[legal]** (D1, D4, D5, D7, D8) las valida Ernest con asesoría antes de publicar; la
> arquitectura sigue el patrón RGPD estándar y no depende de cómo salga esa validación,
> salvo donde se dice explícitamente.
>
> **Dos categorías y ninguna más:** esenciales + contenido de terceros.

---

## 0. Lo que este diseño añade a la auditoría

La auditoría dejó el marco. Al bajar a arquitectura han aparecido **siete hechos del
código** que cambian decisiones concretas de implementación. Van aquí arriba porque son
lo que hace que este documento valga más que el anterior:

| # | Hallazgo | Verificado en | Qué cambia |
|---|---|---|---|
| 1 | **La señal de D3 ya existe.** `resolveCurrentView(viewParam, allowedViews, defaultView)` recibe el parámetro **crudo**: distinguir «el usuario pidió mapa» de «cayó al `defaultView` de la categoría» es mirar si `?view=mapa` venía en la URL | `view-mode.ts:25-32`; `CategoryListingPage.tsx:245`; `busqueda/page.tsx:84-85` | D3 se implementa **sin inventar ninguna señal nueva**. §1.5 |
| 2 | **`VideoBlock` no guarda póster.** Solo `{provider, videoId}` | `types/blocks.ts:70-74` | El placeholder **no puede llevar miniatura** sin volver a llamar al tercero — que es justo lo que se quiere evitar. §1.6 |
| 3 | **El editor del admin reusa el mismo renderer** para su previsualización | `VideoBlockEditor.tsx:72` | El gate, mal puesto, **rompería el preview del editor**. Decide dónde vive. §1.7 |
| 4 | **La portada no tiene vídeo de terceros.** Solo `videoUpload` (nuestro bucket) | `HomeBlockRenderer.tsx` (no hay `case 'video'`) | El gate de vídeo toca **dos rutas**, no toda la web. §1.3 |
| 5 | **ISR confirmado** en las dos rutas que pintan vídeo: `export const revalidate = 3600` | `paginas/[slug]/page.tsx:10`; `blog/[slug]/page.tsx:14` | Confirma empíricamente por qué el gate **tiene que ser de cliente**. §1.1 |
| 6 | **`onDelete: SetNull` resuelve D7 por construcción**, sin depender de código futuro — el molde ya existe (`ListingImage.uploadedById`) | `auditoria-borrado-cuentas.md` §3.2, fila 2 | D7 deja de ser una nota para el futuro y pasa a ser una línea de la migración. §2.3 |
| 7 | **El sitemap ya recoge toda `PAGE` publicada** | `sitemap.ts:84,148` | La página de cookies entra en el sitemap sola. §5.3 |

Y el reparto que gobierna todo el diseño, en una frase: **el texto del banner es igual
para todos, así que va en el HTML cacheado; la decisión de enseñarlo depende de la
cookie, así que va en el cliente.** De ahí salen el rendimiento (§3.5), la compatibilidad
con ISR (§1.1) y la ausencia de *flash*.

---

# PARTE 1 — EL GATE

Es el corazón. **Un banner sin gate es decorativo:** el usuario rechaza, Vimeo recibe su
IP igual, y el sitio miente con más pasos que antes. Por eso el gate es la ráfaga 1 y el
banner la 2.

## 1.1 Por qué el gate es de cliente, y por qué eso no es una concesión

Las dos rutas que pintan vídeo de terceros están cacheadas con ISR: `revalidate = 3600`
en `paginas/[slug]/page.tsx:10` y en `blog/[slug]/page.tsx:14`. **Una respuesta cacheada
es la misma para todos**, así que no puede contener la decisión de un usuario concreto.
Si el gate se resolviera en servidor, o se rompería el ISR (y con él el rendimiento y el
SEO de la plataforma, que es *read-heavy*) o se serviría a un visitante el consentimiento
de otro — que es peor que no tener gate, porque sería un incumplimiento silencioso.

**Y no se pierde nada, porque el HTML cacheado ya es el correcto por defecto.** El estado
sin consentimiento es «no se carga», así que el marcador **es** lo que va en la página
estática. El cliente no *quita* un iframe que ya estaba: lo *añade* si hay
consentimiento. El orden importa —lo contrario sería «cargar y ocultar», exactamente lo
que el encargo prohíbe—, y el efecto práctico es que **el peor caso posible del gate es
no cargar el tercero**, nunca cargarlo de más.

> **La regla, textual, para que sobreviva a futuras ráfagas:** el consentimiento **nunca**
> entra en el HTML cacheado ni en `generateMetadata`. Si algún día alguien necesita el
> estado en servidor, la ruta deja de ser cacheable — y esa es una decisión de
> rendimiento que hay que tomar a la vista, no un efecto colateral.

## 1.2 Las piezas

Tres, y ninguna más:

| Pieza | Qué es | Dónde vive |
|---|---|---|
| **`ConsentProvider`** | Contexto de cliente. Lee la cookie al montar, expone `{estado, categorías, conceder(), revocar(), versión}` y notifica a todo el árbol cuando cambia | Montado en `app/layout.tsx`, junto a `AuthProvider` (`layout.tsx:124`) |
| **`useConsent()`** | El lector. Devuelve si una categoría está consentida | — |
| **`<GateTerceros>`** | El componente que envuelve. Con consentimiento pinta a sus hijos; sin él, el marcador que se le pase | Envuelve **solo** los dos puntos de §1.3 |

**Estado inicial y el parpadeo.** El provider arranca en `desconocido`, no en
`rechazado`, y **`<GateTerceros>` pinta el marcador en `desconocido` igual que en
`rechazado`**: el efecto visible es idéntico, así que no hay salto cuando la cookie se
lee (un tick después de montar). La distinción existe solo para el banner, que no debe
aparecer hasta saber si hace falta (§3.4). Como la cookie se lee con JavaScript síncrono
en el primer efecto, la ventana es de un frame y el contenido que la ocupa —el marcador—
es exactamente del mismo tamaño que el que lo sustituirá.

## 1.3 Qué se envuelve, exactamente

**Dos sitios. Verificado que no hay más.**

| # | Punto | Fichero | Tercero |
|---|---|---|---|
| 1 | El bloque de vídeo incrustado | `BlockRenderer.tsx:53` → `VideoBlockRenderer.tsx` | Vimeo / YouTube |
| 2 | El mapa de búsqueda | `MapViewClient.tsx:18-22` | MapTiler |

**Lo que NO se envuelve, y por qué no es un olvido:**

- **`VideoUploadBlockRenderer`** (`BlockRenderer.tsx:55`) — es vídeo **propio**, servido
  desde nuestro bucket. `VideoUploadBlock` y `VideoBlock` son tipos distintos que *«no
  comparten ni un campo»* (`types/blocks.ts:77-79`), así que no hay riesgo de confundirlos.
- **La portada** — `HomeBlockRenderer` tiene `videoUpload` pero **no tiene `case 'video'`**:
  no existe forma de poner un vídeo de terceros en la home. El gate de vídeo afecta a
  `/blog/[slug]` y `/paginas/[slug]`, y a nada más.
- **`AdBannerBlockRenderer`**, `ImageBlockRenderer` — imágenes de nuestro bucket.
- **La sesión, la telemetría propia, los pagos, el login con Google** — §1.2, §1.4 y §1.7
  de la auditoría. Un gate que envuelve de más acaba bloqueando el login.

**El switch exhaustivo es la red de seguridad.** `BlockRenderer.tsx:20-25` falla en build
si se añade un tipo de bloque sin su `case`. Eso significa que **un futuro bloque de
terceros no puede colarse sin que alguien toque este fichero** — y conviene dejar el aviso
escrito justo ahí, donde lo leerá quien lo añada, no solo en este documento.

## 1.4 Vimeo y YouTube

**Vimeo: retenido siempre.** `player.vimeo.com` (`VideoBlockRenderer.tsx:10`) escribe
cookies propias al cargar el iframe. Sin consentimiento de «contenido de terceros», el
iframe **no se monta**. Es el incumplimiento concreto que la ráfaga 1 cierra.

**YouTube: también retenido. [legal-a-confirmar]**

El argumento para eximirlo es real: `youtube-nocookie.com` no escribe cookies de
seguimiento hasta que se pulsa play. Pero se recomienda **retenerlo igual**, por cuatro
razones que no dependen de cómo salga la consulta legal:

1. **El dominio *nocookie* no es «sin tratamiento».** Al cargar el iframe, Google recibe
   la IP, el *referer* y el user-agent. Eso es un tratamiento de datos personales y una
   transferencia internacional, haya o no cookie. ePrivacy podría no alcanzarlo; el RGPD
   sí.
2. **El play no es interceptable.** Ocurre dentro del iframe: no hay forma fiable de
   pedir consentimiento *entre* la carga y la reproducción. «Consentir al play» es fácil
   de decir e imposible de implementar sin sustituir el reproductor por el nuestro.
3. **El mecanismo es el mismo.** Retener los dos es una rama; eximir uno son dos ramas,
   dos comportamientos que explicar en la política y dos cosas que mantener. El ahorro de
   eximir YouTube es un clic del usuario; el coste es permanente.
4. **La ambigüedad se paga una sola vez.** Si la asesoría dice que YouTube puede cargarse
   sin consentimiento, quitar la retención es cambiar una condición. Al revés —haberlo
   eximido y tener que retenerlo— es descubrir que se lleva meses incumpliendo.

**Recomendación: retener los dos. Decisión D-A (§8).**

## 1.5 MapTiler y D3: el clic en «Mapa» satisface el marcador

D3 dice que pedir el mapa **es** consentir MapTiler. La implementación no necesita
inventar nada, porque **la señal ya está en el código**: `resolveCurrentView` recibe el
parámetro crudo de la URL y lo resuelve contra `allowedViews` y `defaultView`
(`view-mode.ts:25-32`). El valor del parámetro es `mapa`, en español (`view-mode.ts:10`).

| Cómo llega el usuario | `?view=mapa` en la URL | Qué hace el gate |
|---|---|---|
| Pulsa «Mapa» en el `ViewSwitcher` | **Sí** — el switcher construye la URL con el parámetro | **Carga el mapa**, con el aviso persistente de abajo |
| Abre un enlace compartido de un mapa | **Sí** | **Carga el mapa.** Abrir un enlace a un mapa es pedir un mapa |
| Aterriza en una categoría con `defaultView = MAPA` | **No** | **Marcador.** El usuario no ha pedido nada |
| Ya tiene consentimiento de «contenido de terceros» | Da igual | Carga siempre |

**El dato que hay que pasar** es «el usuario pidió esta vista explícitamente»
(`viewParam` resuelto a `MAPA`), como *prop* desde los dos llamadores —
`CategoryListingPage.tsx:245` y `busqueda/page.tsx:85` — hasta `MapViewClient`. No es
estado de usuario, es una propiedad de la URL, así que **es cacheable y puede viajar en el
HTML sin romper el ISR**. Ésa es la razón por la que D3 es barato.

**El aviso que acompaña al mapa cargado por D3.** Cargar sin banner no puede significar
cargar sin informar: bajo el mapa, un texto discreto y permanente — «El mapa se sirve
desde MapTiler; al usarlo se transfiere tu dirección IP» — con enlace a la página de
cookies y a las preferencias. Es lo que convierte D3 en consentimiento **informado** en
vez de en una excepción silenciosa. Sin ese aviso, D3 no se sostiene.

**Dónde va el gate: en `MapViewClient`, envolviendo el `<MapViewDynamic>`**
(`MapViewClient.tsx:18-22`), nunca dentro de `MapView`. El `dynamic()` solo dispara la
descarga cuando el componente se renderiza, así que con el gate por encima **el bundle de
MapLibre ni se descarga** si no hay consentimiento. Dentro de `MapView` sería tarde: el
bundle ya estaría bajando.

**Un detalle de CLS que conviene arreglar de paso.** El `loading` actual del `dynamic` es
`h-[520px]` fijo (`MapViewClient.tsx:12`), mientras que el mapa real es
`h-[520px] sm:h-[calc(100vh-260px)] sm:min-h-[520px] sm:max-h-[900px]`
(`MapView.tsx:217`). En pantallas `sm+` **ya hay hoy un salto** al terminar de cargar. El
marcador del gate debe usar **las clases del mapa real**, no las del *loading* actual — y
de paso conviene alinear el *loading* con ellas.

## 1.6 El marcador: qué ve quien no ha consentido

**No puede llevar la miniatura del vídeo, y ése es un hallazgo, no una decisión de
estilo.** `VideoBlock` guarda **solo** `{provider, videoId}` (`types/blocks.ts:70-74`):
no hay póster almacenado. Obtener la miniatura significaría pedírsela a
`img.youtube.com` o a la API de Vimeo — **volver a contactar al tercero, que es
exactamente lo que el gate impide**. Hacerlo desde el servidor y reproxyarla es posible,
pero es trabajo real (descarga, almacenamiento, limpieza de huérfanas) para decorar un
estado que el usuario va a resolver con un clic.

**Decisión: marcador de diseño propio, sin imagen del tercero.** Lleva:

- **El tamaño exacto** del contenido que sustituye (§1.5 para el mapa; `aspect-video
  w-full` para el vídeo, que es lo que ya usa `VideoBlockRenderer.tsx:15`). Cero CLS.
- **Quién es el tercero, por su nombre**: «Este vídeo se carga desde Vimeo» / «El mapa se
  sirve desde MapTiler». Sin nombre no hay consentimiento informado.
- **Qué implica**, en una línea: se transfiere tu dirección IP.
- **Dos acciones, y la distinción importa:**
  - **«Cargar solo esta vez»** — monta el contenido, **no escribe nada**. Vale para esa
    página y esa visita.
  - **«Permitir contenido de terceros»** — escribe la categoría en la cookie y registra la
    decisión (§2). Todos los vídeos y mapas cargan a partir de ahí.
- **Un enlace a la página de cookies** (§5).

**El marcador no puede ser un cartel triste.** Es lo que verán los usuarios que rechacen,
y si es feo el efecto práctico es presionar para aceptar — que es, con nombre y apellidos,
lo que el RGPD llama consentimiento no libre. Va con el sistema de estilo del repo, con
sus tokens, y entra en la verificación por capturas.

## 1.7 El preview del editor del admin

`VideoBlockEditor.tsx:72` monta `<VideoBlockRenderer>` directamente para previsualizar, y
`BlockEditor.tsx:126` monta el `<BlockRenderer>` completo. **Con el gate puesto sin más,
un editor que acaba de pegar una URL de Vimeo vería un marcador en vez de su vídeo**, lo
cual es absurdo: acaba de pedir ese vídeo, explícitamente, escribiendo su dirección.

Tres salidas, y la recomendada es la tercera:

| Opción | Problema |
|---|---|
| *Prop* `sinGate` en el renderer | Alguien lo olvidará, o lo copiará a una superficie pública |
| Gate en el `case` de `BlockRenderer` en vez de en el renderer | Arregla el editor de vídeo suelto pero **no** el preview completo, que sí pasa por `BlockRenderer` |
| **El layout del backoffice monta el `ConsentProvider` con «contenido de terceros» concedido** | Ninguna pieza nueva; una sola línea, en un sitio donde se ve |

La tercera es también la defendible: el backoffice **no es una superficie publicada**, no
se cachea, y quien está ahí ha solicitado expresamente ese contenido al pegarlo. Encaja
con la exención de «servicio expresamente solicitado». **[legal-a-confirmar]** — si la
asesoría lo rechaza, el admin ve marcadores con «cargar solo esta vez» y pierde un clic
por preview: molesto, no roto.

**Decisión D-B (§8).**

## 1.8 Cómo queda preparado para lo que no existe

Cuando entre un GTM, un Pixel o cualquier analítica de terceros:

1. **Se añade la categoría en la misma ráfaga que la introduce** — nunca antes («para
   dejarlo preparado»: una categoría vacía miente al usuario) ni después (sería el
   incumplimiento).
2. El script se carga **solo** a través del gate: nunca en `app/layout.tsx`, nunca con
   `<Script>` de Next fuera del gate.
3. Se actualiza la página de cookies (§5) y **se sube la versión** (§4.4).

Esa regla debe quedar escrita en **`apps/web/CLAUDE.md`**, que es donde la leerá quien
vaya a añadir el script. Este documento no lo lee nadie con un `<Script>` a medio pegar.

---

# PARTE 2 — EL MODELO DE CONSENTIMIENTO

## 2.1 El reparto: la cookie decide, el servidor prueba

Dos mitades con funciones distintas, y confundirlas es el error clásico:

- **La cookie** existe para que **el gate decida sin preguntar a nadie**. Viaja en la
  petición, se lee en el navegador, no cuesta nada.
- **El `ConsentRecord`** existe para **demostrar** el consentimiento (art. 7.1 RGPD). Una
  cookie no demuestra nada: la escribe el propio sitio y el usuario puede borrarla.

**El gate nunca consulta al servidor.** Añadir una llamada a la API antes de decidir si se
pinta un vídeo metería latencia en el camino crítico de una plataforma *read-heavy*.

## 2.2 La cookie

| Propiedad | Valor | Por qué |
|---|---|---|
| Nombre | **`mp_consent`** | Prefijo propio, legible en la política. **Hay que declararla en la página de cookies**: es una cookie más |
| Contenido | JSON compacto: `{"v":2,"c":["terceros"],"t":1757548800,"id":"clx…"}` | Versión consentida · categorías · fecha (epoch) · id del `ConsentRecord` |
| `httpOnly` | **No** | El gate es de cliente y tiene que leerla. Es la única razón, y basta |
| `sameSite` | `Lax` | Molde del repo |
| `secure` | Sí en producción | |
| `path` | `/` | |
| Duración | **6 meses** (D4) **[legal]** | |
| Quién la escribe | El propio frontend | Es la elección del usuario, no un dato de negocio. Y así funciona aunque la API no responda (§2.4) |

**Categoría: esencial.** Guarda exclusivamente la elección del usuario; sin ella el
sistema no puede respetarla. La propia AEPD exenta esta cookie.

**Rechazar también escribe la cookie**, con `c: []`. Sin eso, «rechazar» sería
indistinguible de «no he decidido» y el banner reaparecería en cada visita — que es otra
forma de presionar para aceptar, y de las más comunes.

**Robustez:** cualquier cookie ilegible, con versión desconocida o con una categoría que
no existe se trata como **ausente** (se vuelve a preguntar). Nunca se interpreta a medias.

## 2.3 `ConsentRecord`

**Una fila por decisión. Nunca se actualiza: el historial es la prueba.**

```
model ConsentRecord
  id             String        @id @default(cuid())   // el mismo valor va en la cookie
  action         ConsentAction                        // GRANTED | REJECTED | UPDATED | WITHDRAWN
  categories     String[]                             // lo aceptado; [] en REJECTED
  policyVersion  String                               // la versión del texto consentido
  createdAt      DateTime      @default(now())
  userId         String?                              // solo si había sesión
  user           User?         @relation(..., onDelete: SetNull)
  ipHash         String?                              // sha256(ip), NUNCA la IP en claro
  userAgent      String?                              // [legal] — ver abajo
  @@index([userId, createdAt])
  @@index([createdAt])
```

**`onDelete: SetNull` resuelve D7 por construcción, y esto es lo importante:** al borrar
la cuenta, el `userId` se anula solo y la fila —la prueba— sobrevive. **No hace falta que
el futuro borrado de cuentas se acuerde de esta tabla.** Es exactamente lo que
`auditoria-borrado-cuentas.md` §3.2 describe en su fila 2 (`ListingImage.uploadedById`):
*«ya anonimiza por construcción»*. Y conviene saberlo: **hoy no existe ninguna vía que
borre un `User`** (ídem §0.1), así que sin `SetNull` esto sería una nota que alguien
tendría que recordar dentro de meses. Con `SetNull`, es una línea de la migración de la
ráfaga 1.

En la clasificación de esa auditoría, `ConsentRecord` es **CONSERVAR**: la prueba del
algodón —*¿lo echaría en falta alguien que no sea el propio usuario?*— se responde sola.
Sí: el operador, que necesita demostrar que obtuvo el consentimiento precisamente frente
a una reclamación de esa persona.

**Sobre `ipHash` y `userAgent`.** El `ipHash` sigue el molde del repo, que nunca guarda IP
en claro para esto (`visitor.ts:53`, `listings.controller.ts:314`). El `userAgent` es más
dudoso: aporta poco a la prueba y es material de huella. **Recomendación: no guardarlo.**
**[legal]** — si la asesoría lo pide para el contexto probatorio, el campo está previsto.

**Migración:** `20260911HHMMSS_add_consent_record`, molde de nombre del repo
(`20260829150000_n5_preferencias_email`). Tabla nueva, sin *backfill*, sin efecto sobre
nada existente.

## 2.4 El endpoint

**`POST /consent`** — público, con `OptionalJwtAuthGuard`. Es el molde exacto de
`trackView` (`listings.controller.ts:302-307`): *«público con auth opcional: cuenta
anónimos, pero necesita saber si hay sesión»*. Aquí la frase vale igual.

- **Cuerpo:** `{action, categories, policyVersion}`, validado por DTO (regla del repo).
- **Devuelve:** `{id}`, que el cliente guarda en la cookie.
- **Rate limit:** `RateLimitService.checkAndIncrement` (`infra/redis/rate-limit.service.ts:19`),
  por IP. Es un endpoint público que escribe filas; sin límite, es un generador de filas
  gratis. La IP real llega bien: `main.ts:29-30` documenta el `trust proxy`.
- **No hay `GET`.** El estado vive en la cookie. Un `GET` sería una vía para preguntar por
  el consentimiento de un `id` ajeno.

**Fail-open, y es deliberado.** La escritura de la cookie **no espera** a la respuesta: si
la API no responde, la cookie se escribe igual con un `id` generado en el cliente y el
usuario nunca ve un error. Es la doctrina que ya gobierna la telemetría del repo
(`impressions.service.ts:26-28`: *«el tracking nunca debe afectar la experiencia»*) y aquí
es todavía más clara: **un fallo al registrar la prueba no puede impedir que se respete la
voluntad del usuario.** Se acepta una prueba incompleta en caso de caída; lo contrario
—ignorar un rechazo porque la API no responde— sería mucho peor. **[legal]** — confirmar
que el riesgo probatorio es aceptable.

**Al iniciar sesión un usuario que ya había decidido:** la cookie lleva el `id`, así que se
escribe una fila `UPDATED` con el `userId` puesto, enlazando ambas. **La fila vieja no se
toca** — el historial no se reescribe nunca.

## 2.5 Cambiar y revocar

**Tres vías, un solo destino** — el panel de preferencias:

1. **Enlace permanente en el footer**, «Preferencias de cookies». Se monta con lo que ya
   existe: un `FooterItem` con `type: INTERNAL` (`schema.prisma:2938-2962`), gestionable
   desde el backoffice sin tocar código. Es lo que exige el RGPD para que retirar el
   consentimiento sea tan fácil como darlo.
2. **La página de cookies** (§5), con el panel al final.
3. **El marcador** de un vídeo o mapa retenido (§1.6).

**Qué pasa al revocar.** Se escribe `WITHDRAWN`, se reescribe la cookie y **el gate deja
de montar terceros inmediatamente**: los componentes reaccionan al contexto. Pero **lo ya
cargado en la página actual no se puede descargar** — un iframe montado ya habló con
Vimeo, y desmontarlo no borra lo que Vimeo escribió. La vía honesta es **recargar la
página al guardar**, diciéndolo: «Se recargará la página para aplicar tus preferencias».
Prometer menos que eso sería mentir; prometer más, imposible.

## 2.6 Re-consentir cuando cambia el texto (D5)

La regla es una comparación: **si `cookie.v !== versión actual`, el banner vuelve a
aparecer**, con la elección anterior como estado de partida en el detalle.

- La versión **la sube el admin a mano** (D5), con aviso explícito de que hacerlo
  re-pregunta a toda la base de usuarios. **No se deriva del texto**: si cada errata
  corregida re-preguntara a todo el mundo, o el admin dejaría de tocar el texto o los
  usuarios aprenderían a aceptar sin leer. Las dos son peores que la errata.
- **Añadir una categoría sube la versión siempre.** Eso no es criterio del admin: es
  consecuencia de que el consentimiento anterior no cubre lo nuevo. En el diseño, la
  categoría nueva llega con una ráfaga, y esa ráfaga sube la versión.
- La versión viaja en el HTML (viene con el texto, §4.5), así que la comparación es local:
  cero peticiones.

---

# PARTE 3 — EL BANNER

## 3.1 Banner, no modal

**Recomendación: banner no bloqueante.** El RGPD no exige modal, y un modal:

- **atrapa el foco** y deja el contenido inaccesible a teclado y lector de pantalla hasta
  decidir, lo que convierte una obligación de transparencia en una barrera de
  accesibilidad;
- **es un muro para el usuario y para Google** — y esta plataforma vive del SEO;
- **presiona a aceptar**, que es lo que vicia el consentimiento.

Con el gate haciendo su trabajo, el muro no aporta nada: **si el usuario ignora el banner,
no se carga ni un tercero.** El estado por defecto ya es el correcto, así que no hay que
forzar la decisión. Ésa es justamente la ventaja de haber hecho el gate primero.

**Decisión D-C (§8).**

## 3.2 Los tres botones, al mismo nivel

| Botón | Qué hace |
|---|---|
| **Aceptar** | Acepta «contenido de terceros». Escribe cookie + `GRANTED` |
| **Rechazar** | Rechaza todo lo no esencial. Escribe cookie con `c: []` + `REJECTED` |
| **Ver más información** | Lleva a la página de cookies (D6) |

**«Al mismo nivel» es literal**, y es lo que más se incumple: misma variante de botón,
mismo tamaño, mismo peso, mismo contraste. Nada de «Aceptar» en primario sólido y
«Rechazar» como enlace gris. La AEPD ha sancionado específicamente ese patrón. Si algo
distingue a uno, que sea la posición, no el peso.

**Con dos categorías, un tercer botón de «preferencias» sobra**: solo hay una cosa que
elegir. «Ver más» lleva a la página, y allí está el panel. Menos botones, misma libertad.

**Tampoco vale:** cerrar con una X equivaliendo a aceptar; seguir navegando equivaliendo a
aceptar; un banner sin forma de rechazar en el primer nivel.

## 3.3 Dónde se monta

**En `app/layout.tsx`** (el layout raíz), junto a `<Toaster />` (`layout.tsx:129`), y **no**
en `(public)/layout.tsx`. Motivo verificado: el grupo `(public)` no cubre `(auth)` ni
`(account)` (`app/` tiene los cuatro grupos), y un usuario puede aterrizar directamente en
`/login`, `/registro` o `/mis-anuncios` desde un enlace o un marcador. El banner tiene que
salir en la primera visita, sea cual sea.

`<Toaster />` es el precedente exacto: montado una vez en la raíz, **fuera** de
`AuthProvider`, porque *«no depende de la sesión y tiene que poder salir también en las
pantallas anónimas»* (`layout.tsx:125-128`). Palabra por palabra, el mismo argumento.

**En el backoffice no aparece** — es consecuencia de §1.7: allí el provider se monta con
la categoría concedida, así que no hay nada que preguntar.

## 3.4 Cuándo aparece

| Situación | Banner |
|---|---|
| Sin cookie `mp_consent` | **Sí** |
| Cookie con versión distinta de la actual (§2.6) | **Sí**, con la elección anterior de partida |
| Cookie válida, aceptó | No |
| **Cookie válida, rechazó** | **No** | 
| Cookie caducada (6 meses) | Sí — el navegador ya la borró |
| Abierto desde el footer o el marcador | Sí, como panel de preferencias con el estado actual |

**Un usuario que rechazó no vuelve a ver el banner** hasta que cambie la versión, caduque
la cookie o él lo reabra. Insistir a quien ya dijo que no es otra forma de forzar, y
además es lo que hace que la gente acabe aceptando por cansancio.

## 3.5 Accesibilidad

Esto decide si el banner es utilizable o una trampa:

- **`role="region"` con `aria-label`, no `alertdialog`.** No es modal (§3.1), así que no
  declara serlo.
- **No roba el foco al montar.** Va como primer elemento tabulable del documento, de modo
  que la primera pulsación de Tab llega a él; quien esté escribiendo no pierde el cursor.
- **Recorrido de teclado completo** por los tres botones, en el orden visual.
- **`Esc` no lo cierra.** Cerrar sin decidir sería consentimiento implícito. (Sí cierra el
  panel de preferencias, que vuelve al estado anterior.)
- **Contraste AA** sobre su fondo, verificado con lo que ya existe:
  `estilo/contraste-modelos.spec.ts` es el molde y el banner debe entrar por ahí.
- **Idioma:** todo en español, coherente con `<html lang="es">` (`layout.tsx:117`).
- **En móvil reserva su espacio**: no tapa de forma permanente el último párrafo ni los
  controles inferiores.

## 3.6 SEO y rendimiento

Es una plataforma *read-heavy* que vive del SEO, así que esto no es un detalle:

- **CLS cero.** El banner va **fijo al pie, en su propia capa**: no empuja el contenido.
  Los marcadores del gate reservan el tamaño exacto del contenido que sustituyen (§1.5,
  §1.6).
- **No bloquea el render.** Nada espera al banner.
- **LCP sin tocar.** Con la región al pie y el contenido intacto, el banner nunca es el
  elemento mayor.
- **Sin petición de cliente para el texto** — viene en el HTML (§4.5). El banner no
  aparece «un segundo después»: está en la página, y solo se decide si se muestra.
- **Los buscadores ven el sitio completo.** El gate solo afecta a iframes de terceros; el
  contenido indexable no pasa por él.

---

# PARTE 4 — LA CONFIGURACIÓN DE ADMIN

## 4.1 El molde existe

No hay que inventar nada. `Setting` (`schema.prisma:1976-1987`: clave, valor JSON,
`updatedAt`, `updatedById`), editado desde `/admin/ajustes`, con `AuditLog` e invalidación
por tag. `BrandingService` es el ejemplo completo (`branding.service.ts`), y la lectura
cacheada desde el frontend es `getCachedBranding` / `getCachedEstilo`
(`lib/api/branding.ts:33`, `lib/api/estilo.ts:34`): `unstable_cache`, `revalidate: 3600`
como red y un tag que el backend tumba vía `/api/revalidate?tag=` (`api/revalidate/route.ts:13-17`).

**Esto es exactamente el norte multi-instancia**: cada instancia tiene sus filas, el
código es el mismo. Igual que los logos y la paleta.

## 4.2 Las claves

| Clave | Contenido | Tipo |
|---|---|---|
| `cookieBannerTitle` | Titular | Texto corto |
| `cookieBannerBody` | Cuerpo del mensaje | Texto largo |
| `cookieBannerAcceptLabel` | Etiqueta de «Aceptar» | Texto corto |
| `cookieBannerRejectLabel` | Etiqueta de «Rechazar» | Texto corto |
| `cookieBannerMoreLabel` | Etiqueta de «Ver más» | Texto corto |
| `cookiePolicyPageId` | La `Post` (type=PAGE) a la que apunta «ver más» | Selector entre páginas publicadas |
| `cookiePolicyVersion` | La versión vigente (§2.6) | Texto corto, con aviso |

## 4.3 Tienen que nacer en la semilla

**La lección ya está pagada en este repo.** `docs/auditoria-pro-video.md` documenta que
`videoEnabled` estaba en la whitelist del backend pero **no en la semilla**: en producción
la fila no existía y la funcionalidad era inalcanzable — nadie podía encenderla.
`seed-settings.ts:1-17` existe precisamente para que eso no se repita, y su comentario lo
dice con todas las letras.

Así que: **las siete claves nacen en `SEED_SETTINGS`**, con textos por defecto en español
que funcionen sin que nadie los toque. Y, además, **el banner debe funcionar aunque falten
todas las filas**, cayendo a textos por defecto del código — el molde es el tema, que cae
a `globals.css` cuando el backend no responde (`layout.tsx:91-97`). Un banner que
desaparece porque el backend está caído sería un incumplimiento causado por una incidencia.

**En la pantalla** van como un grupo nuevo en `GRUPOS`
(`ajustes-organizacion.ts:220`), con sus `SETTING_TITLES` y `SETTING_DESCRIPTIONS`. Los
textos largos necesitan un editor propio (molde: `PriceListEditor`,
`DetectionModesEditor`), no el campo genérico.

## 4.4 La frontera: texto sí, mecánica no

**Lo que el admin controla:** los textos, las etiquetas, a qué página enlaza «ver más», y
la versión.

**Lo que el admin no controla, y debe ser imposible desde la interfaz:**

- qué categorías existen (salen del inventario, no de una preferencia);
- qué se bloquea sin consentimiento;
- **si el banner aparece — no hay interruptor de apagado**;
- que rechazar sea tan fácil como aceptar: **los tres botones son iguales por
  construcción**. No existe, ni debe existir, un ajuste de «estilo del botón de aceptar»;
- cómo y dónde se guarda el consentimiento, ni las duraciones.

**Y las etiquetas necesitan validación**, porque el texto libre puede romper la legalidad
por la puerta de atrás: si alguien pone «Aceptar» y «Aceptar todo» en los dos botones, el
sistema es no conforme aunque la mecánica sea impecable. Mínimo: obligatorias, no vacías,
longitud máxima, y un aviso en la pantalla explicando que el botón de rechazo debe
expresar un rechazo inequívoco. **[legal]** — valorar si hace falta algo más duro que un
aviso.

**La versión (D5)** se edita con un aviso explícito: *«Al subir la versión se volverá a
preguntar a todos los usuarios. Hazlo solo si el cambio afecta a lo que consintieron.»*

## 4.5 Cómo llega el texto a la página

**`GET /cookies/config`**, público y sin guards — molde exacto de `GET /branding`
(`branding.controller.ts:15`) y `GET /estilo` (`estilo.controller.ts:18`). Devuelve los
textos y la versión vigente.

En el frontend, `getCachedCookieConfig` con `unstable_cache`, `revalidate: 3600` y tag
`cookies-config`, que el backend tumba al guardar. **Se lee en `app/layout.tsx` y se pasa
como prop al banner.**

**Y aquí está el reparto que hace que todo encaje:** el texto es **igual para todos**, así
que puede ir en el HTML cacheado sin romper el ISR ni filtrar nada de nadie. Lo único que
depende del usuario es **si el banner se muestra**, y eso lo decide el cliente leyendo la
cookie. Resultado: **sin fetch de cliente, sin flash, sin CLS, y compatible con la caché.**

---

# PARTE 5 — LA PÁGINA DE COOKIES

## 5.1 El hueco bloqueante

**Hoy no existe ninguna página legal.** Verificado: el CMS soporta `Post.type = PAGE` →
`/paginas/{slug}` (`schema.prisma:2858-2910`, `pages.controller.ts:12-26`), la
infraestructura está completa —editor de bloques, SEO, enlazado desde footer y nav con
protección de borrado—, pero **ni `seed.ts` ni `seed-settings.ts` crean ninguna página de
privacidad ni de cookies**.

**El «ver más» del banner no tiene hoy adónde apuntar.** Por eso el sistema no se puede
dar por entregado sin esto.

## 5.2 Dónde vive: en el CMS

**Recomendación: una `Post` con `type = PAGE`, slug `cookies`, en `/paginas/cookies`.**
No una ruta a medida. Motivos:

- **el contenido lo redacta asesoría legal (D8)**, y necesita poder editarlo sin
  despliegue;
- **cambia más que el código** — cada tercero nuevo la toca;
- es **por instancia**, como todo lo demás del molde de branding;
- ya tiene SEO, editor de bloques y protección de borrado (un `FooterItem` que la enlaza
  impide borrarla, `schema.prisma:2948-2952`);
- entra en el sitemap sola (§5.3).

**Lo único que el código fija** es el `Setting` `cookiePolicyPageId`, que apunta a ella
(§4.2). Si no está configurado, el «ver más» se oculta antes que enlazar a una página que
no existe.

**Cómo nace.** Dos vías, y se proponen las dos: la semilla crea la página **en borrador**
con la estructura y el inventario técnico (§5.4), y el admin la publica cuando el texto
legal esté. Así el hueco es visible —hay una página a medio hacer esperando— en vez de
silencioso.

## 5.3 El sitemap ya la recoge

`sitemap.ts:84,148` pagina `GET /paginas` y emite `${SITE_URL}/paginas/${p.slug}` para
cada página publicada. **La de cookies entra sola en cuanto se publique**, sin tocar nada.
Es lo correcto: una política de cookies debe ser accesible e indexable.

## 5.4 Qué lleva — y qué parte es nuestra

**El diseño no inventa el texto legal (D8).** Lo que aporta es el **insumo técnico**: el
inventario de la auditoría §1, que es lo que hace que la página no mienta.

| Sección | Quién la escribe |
|---|---|
| Qué es una cookie; que también se cubre `localStorage` | Asesoría |
| **La tabla del inventario**: nombre, quién la pone, para qué, duración, categoría | **Técnico** — auditoría §1 + los 4 [medir] de §6 |
| Las categorías y qué implica rechazar cada una | Técnico + asesoría |
| **Los terceros**: Vimeo, YouTube/Google, MapTiler — nombre, país, enlace a su política | **Técnico** |
| La telemetría propia, explicada **aunque no requiera consentimiento** (D1) | Técnico + asesoría |
| Base jurídica, responsable, derechos, plazos | **Asesoría** |
| Cómo cambiar la elección — **con el panel incrustado** | Técnico |
| Cómo borrar cookies en cada navegador | Asesoría |

**Contar la telemetría propia es una ventaja, no una carga.** «Medimos cuántas veces se ve
un anuncio, sin cookies, sin guardar tu IP y sin poder saber quién eres» es verdad
verificable (auditoría §1.4) y dice del producto algo que casi ningún competidor puede
decir. El art. 13 obliga a informar de todas formas.

## 5.5 Y falta la de privacidad

Documento mayor y en gran medida ajeno a este sistema: cubre cuentas, anuncios,
mensajería, facturación, moderación. **No es trabajo de estas ráfagas**, pero **el sistema
de cookies no se entrega apuntando a una política de privacidad que no existe** (D8).
Puede ir en paralelo desde el primer día.

---

# PARTE 6 — LOS 4 [MEDIR] EN NAVEGADOR

**No se pueden leer del repo y no se inventan.** Alimentan la tabla de §5.4 y son el
último requisito antes de publicar la política.

| # | Qué medir | Por qué no se lee del código |
|---|---|---|
| 1 | **Nombres y duraciones reales de las cookies de Auth.js v5** en producción | Solo está fijada la duración de sesión (`auth.config.ts:18-20`, 7 días). No hay bloque `cookies:`: los nombres (`authjs.session-token`, `authjs.csrf-token`, `authjs.callback-url`, y las de OAuth `state`/`pkce`/`nonce`) y sus flags son **defaults de la librería** |
| 2 | **Qué escribe `player.vimeo.com`** al cargar el iframe | Está dentro del iframe del tercero |
| 3 | **Qué escribe `youtube-nocookie.com`** al cargar, y qué añade **al pulsar play** | Ídem — y la diferencia entre ambos momentos es justo lo que decide D-A |
| 4 | **Si `api.maptiler.com` escribe algo**, o solo recibe la IP | Ídem |

**Cómo:** navegador limpio, herramientas de desarrollo, pestaña Application/Almacenamiento
y panel de red; una página con vídeo de cada proveedor y una búsqueda en vista mapa. Es
una sesión de trabajo, no una investigación. Va en la **ráfaga 3**, antes de redactar la
tabla.

**Nota sobre el 2 y el 3:** si la medición mostrara que Vimeo no escribe nada al cargar,
**no cambia nada del diseño** — sigue recibiendo la IP, que es el motivo principal (§1.4).
Y si mostrara que `youtube-nocookie` escribe algo ya al cargar, **cierra D-A** en el
sentido de retenerlo.

---

# PARTE 7 — EL PLAN DE RÁFAGAS

**El gate primero.** Es lo que cumple; el banner sin gate es decorativo.

## Ráfaga 1 — El gate y el modelo *(cierra el incumplimiento)*

**Backend:** `ConsentRecord` + enum + migración (§2.3) · `POST /consent` con
`OptionalJwtAuthGuard` y rate limit (§2.4).

**Frontend:** `ConsentProvider` + `useConsent` + `<GateTerceros>` (§1.2) · el marcador
(§1.6) · gate en `VideoBlockRenderer` (§1.4) · gate en `MapViewClient` con el *prop* de
vista explícita para D3 (§1.5) · el aviso permanente bajo el mapa (§1.5) · provider
concedido en el layout del backoffice (§1.7) · la cookie `mp_consent` (§2.2).

**Sin banner todavía**, y funciona: sin cookie no hay consentimiento, así que el estado
por defecto es «no se carga», y cada marcador ofrece cargarlo. **Al terminar esta ráfaga,
Vimeo y MapTiler dejan de recibir la IP de nadie que no lo haya pedido.** Es la ráfaga que
más vale por sí sola, y la que se podría entregar aislada si hiciera falta.

**Verificación —** el test que de verdad comprueba la ley: Playwright interceptando red,
sin cookie de consentimiento → **cero peticiones** a `player.vimeo.com`,
`youtube-nocookie.com` y `api.maptiler.com`; con consentimiento → sí. Más el caso D3:
`?view=mapa` carga, `defaultView=MAPA` sin parámetro no. Más capturas de los marcadores.

**Dimensión:** la mayor de las tres. Es la que tiene modelo de datos, endpoint, contexto y
dos puntos de integración.

## Ráfaga 2 — El banner y su configuración

**Backend:** las 7 `Setting` en `SETTING_KEYS` **y en `SEED_SETTINGS`** (§4.3) ·
`GET /cookies/config` público (§4.5) · invalidación por tag al guardar.

**Frontend:** el banner con los tres botones al mismo nivel (§3.2) · montado en el layout
raíz (§3.3) · accesibilidad (§3.5) y CLS (§3.6) · lectura cacheada del texto y paso por
*prop* (§4.5) · el grupo y los editores en `/admin/ajustes` (§4.3) · la validación de
etiquetas (§4.4) · el aviso de la versión (§2.6).

**Verificación:** test de que rechazar es alcanzable por teclado y tiene el mismo peso
visual; que el banner no reaparece tras decidir; que reaparece al subir la versión;
capturas en claro y oscuro; comprobación de CLS.

**Dimensión:** media.

## Ráfaga 3 — La página, el footer y el inventario

**Los 4 [medir]** (§6) · la página `PAGE` en borrador con la estructura y el inventario
técnico (§5.2, §5.4) · el panel de preferencias incrustado (§2.5) · el `FooterItem`
«Preferencias de cookies» · el enlace «ver más» del banner conectado vía
`cookiePolicyPageId`.

**Cierra el sistema.** Publicar la página requiere el texto de asesoría (D8), que es
externo a la ráfaga.

**Dimensión:** la menor en código; la mayor en dependencia externa.

## Fuera de ráfaga, bloqueante para producción

- **La política de privacidad** (§5.5) — asesoría, en paralelo desde ya.
- **La regla del gate en `apps/web/CLAUDE.md`** (§1.8) — dos líneas, ráfaga 1.

---

# PARTE 8 — LAS DECISIONES QUE QUEDAN

Las 8 de la auditoría están cerradas. Estas son las que abre bajar a diseño:

| # | Decisión | Recomendación | Por qué importa |
|---|---|---|---|
| **D-A** | **YouTube: ¿retener o eximir?** | **Retener**, igual que Vimeo (§1.4). **[legal-a-confirmar]** | El *nocookie* no escribe cookies de tracking al cargar, pero sí transfiere la IP a Google, y **el play no es interceptable**. Eximirlo son dos comportamientos que mantener y explicar, para ahorrar un clic |
| **D-B** | **El preview del editor del admin: ¿pasa por el gate?** | **No**: el layout del backoffice monta el provider con la categoría concedida (§1.7). **[legal-a-confirmar]** | Sin esto, un editor que acaba de pegar una URL de Vimeo ve un marcador. Si la asesoría lo rechaza, cuesta un clic por preview |
| **D-C** | **¿Banner o modal?** | **Banner no bloqueante** (§3.1) | Con el gate en pie, el muro no aporta: ignorar el banner ya significa no cargar nada. El modal daña accesibilidad y SEO, y presiona a aceptar |
| **D-D** | **¿Dónde vive la página de cookies?** | **CMS, `Post type=PAGE`, `/paginas/cookies`**, sembrada en borrador (§5.2) | La redacta asesoría y cambia más que el código: tiene que ser editable sin despliegue |
| **D-E** | **¿Se guarda el `userAgent` en `ConsentRecord`?** | **No** (§2.3). **[legal]** | Aporta poco a la prueba y es material de huella. El campo queda previsto por si la asesoría lo pide |

**Y las cinco [legal] de la auditoría siguen abiertas hasta la validación de asesoría:**
D1 (la telemetría no pide consentimiento), D4 (6 meses), D5 (versión a mano), D7
(conservar el `ConsentRecord` anonimizado), D8 (quién redacta). **La arquitectura no
depende de cómo salgan**, con una excepción que conviene tener presente: **si D1 saliera
al revés**, aparece una tercera categoría («analítica») y el gate tiene que poder apagar
`trackView` y el reenvío de `x-visitor-hash` — trabajo real, no una casilla más en el
banner.
