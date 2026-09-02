# Diseño — tres logos configurables (público, backoffice, blog)

> **Documento de diseño. Cero código.** Todo lo que aquí se afirma sobre el estado actual
> está verificado contra el repositorio, con fichero y línea. Lo que se propone está
> marcado como propuesta.

---

## 0. El veredicto, en una tabla

| Pregunta | Respuesta corta |
|---|---|
| ¿Qué se muestra hoy como marca? | **Texto, no imagen.** `SITE_NAME` (constante de build) en la cabecera pública y «Backoffice» escrito a mano en el shell del admin. **No hay ningún asset de logo en `apps/web/public/`.** |
| ¿Dónde viven los tres logos? | Tres filas de `Setting` (`logoPublicUrl`, `logoBackofficeUrl`, `logoBlogUrl`) con la URL pública de R2. |
| ¿Se editan por `PATCH /admin/settings/:key`? | **No.** Fuera del whitelist a propósito (§2.2). Un endpoint propio de branding es el único escritor. |
| ¿Endpoint? | `POST/DELETE /admin/branding/logos/:zone` (ADMIN) + `GET /branding` (público). Molde: `admin/homepage`. |
| ¿Prefijo en R2? | `branding/` propio (como `blocks/`, `homepage/`, `sponsored/`). |
| ¿La limpieza del logo viejo? | Enganchada al cambio, molde avatar (`purgeReleased` con `before`/`after`). **Y hace falta un parche en `laReferenciaAlguienMas`: hoy no mira `Setting` y otra superficie podría borrar el logo vivo** (§4.2). |
| ¿SVG? | **Sí**, con mapa MIME propio del módulo (no se toca el compartido) y render con `<img>`, no con `next/image` (§6). |
| ¿Fallback? | Cadena por zona; ninguna zona queda vacía (§5). |
| ¿Propagación? | `unstable_cache` con tag `branding` + `revalidateTag` en cada mutación. Molde exacto: `footer-nav` (§7). |
| ¿Multi-instancia? | El logo de backoffice es la señal; se enseña también en `/admin/instancia` (§8). |
| ¿Cuánto? | Dos ráfagas: backend (L1) y render + pantalla de admin (L2) (§9). |

---

## 1. Lo que hay hoy, verificado

### 1.1 La marca pública es TEXTO, no una imagen

[Header.tsx:30-32](../apps/web/src/components/layout/Header.tsx#L30-L32):

```tsx
<Link href="/" className="shrink-0 text-xl font-bold tracking-tight">
  {SITE_NAME}
</Link>
```

`SITE_NAME` es una constante de build: `export const SITE_NAME = 'Marketplace'`
([config/index.ts:1](../apps/web/src/config/index.ts#L1)).

**Corrección a la premisa del encargo:** no hay «un asset de build» que sustituir.
`apps/web/public/` contiene únicamente el directorio `data` — ningún `logo.svg`, ningún
`logo.png`. Esto **simplifica** el trabajo: no hay que retirar nada, sólo añadir una
imagen delante de un texto que ya existe y que pasa a ser el fallback.

Dónde aparece hoy `SITE_NAME` como marca (frente a dónde aparece como metadato de SEO,
que **no se toca**):

| Sitio | Qué es | ¿Lo toca este diseño? |
|---|---|---|
| [Header.tsx:31](../apps/web/src/components/layout/Header.tsx#L31) | La marca de la cabecera | **Sí** — es la zona PÚBLICO |
| [Footer.tsx:51](../apps/web/src/components/layout/Footer.tsx#L51) | `© 2026 Marketplace. Todos los derechos…` | **No** — es una línea legal, no una marca (§5.4) |
| `anuncio/[slug]/page.tsx`, `vendedor/`, `blog/`, `paginas/`, `opengraph-image.tsx` | `<title>` y OG | **No** — SEO, no render de marca |
| [instancia/page.tsx:246](../apps/web/src/app/(admin)/admin/instancia/page.tsx#L246) | El nombre de la instancia, en solo lectura | **No**, pero se le añade el logo (§8) |

### 1.2 Las cabeceras de las tres zonas

| Zona | Componente | Estado |
|---|---|---|
| **Público** | `Header` montado en [(public)/layout.tsx:7](../apps/web/src/app/(public)/layout.tsx#L7) | Texto `SITE_NAME` |
| **Cuenta** | **el MISMO `Header`**, montado en [(account)/layout.tsx:37](../apps/web/src/app/(account)/layout.tsx#L37) | Se reusa a propósito (SHELL-D1) |
| **Backoffice** | [(admin)/layout.tsx:46-48](../apps/web/src/app/(admin)/layout.tsx#L46-L48) — `<span>Backoffice</span>`, oculto por debajo de `md`; y el título del drawer en [AdminMobileNav.tsx:65](../apps/web/src/app/(admin)/components/AdminMobileNav.tsx#L65) | Texto escrito a mano, **dos sitios** |
| **Blog** | **NO TIENE CABECERA PROPIA.** [(public)/blog/layout.tsx](../apps/web/src/app/(public)/blog/layout.tsx) sólo monta `<MainNav pageType="BLOG" />`; la cabecera que ve el lector es la pública, heredada de `(public)/layout.tsx` | Es el único punto de verdad no trivial de este diseño (§6.3) |

Ningún e2e afirma hoy el literal «Backoffice» de la cabecera (los tres `Backoffice —` de
`admin-roles.spec.ts` son nombres de `describe`), así que cambiar ese texto no rompe la
suite.

### 1.3 El molde de subir una imagen de configuración

Tres endpoints hermanos, idénticos entre sí, y el patrón está explicitado en el propio
código ([homepage.service.ts:188-194](../apps/api/src/modules/homepage/homepage.service.ts#L188-L194)):

| Endpoint | Rol | Prefijo | ¿Crea fila? |
|---|---|---|---|
| `POST /admin/blog/upload-image` ([blog-admin.controller.ts:68](../apps/api/src/modules/blog/blog-admin.controller.ts#L68)) | EDITOR | `blocks/` | No |
| `POST /admin/homepage/upload-image` ([homepage-admin.controller.ts:55](../apps/api/src/modules/homepage/homepage-admin.controller.ts#L55)) | ADMIN | `homepage/` | No |
| `POST /admin/sponsored-ads/upload-image` ([admin-sponsored-ads.controller.ts:57](../apps/api/src/modules/sponsored-ads/admin-sponsored-ads.controller.ts#L57)) | MODERATOR | `sponsored/` | No |

Los tres comparten `FileInterceptor` + `memoryStorage()`, `limits: { fileSize: MAX_FILE_SIZE }`
(10 MB) y `ALLOWED_MIME_TYPES` ([media.service.ts:14-21](../apps/api/src/modules/media/media.service.ts#L14-L21)):

```ts
export const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
};
export const ALLOWED_MIME_TYPES = Object.keys(MIME_TO_EXT);
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
```

**SVG NO está admitido hoy en ninguno de los cuatro caminos de imagen.** Ver §6.

Del lado del frontend el molde también existe y es de tres líneas
([homepage-admin.ts:33-37](../apps/web/src/lib/api/homepage-admin.ts#L33-L37),
[admin-sponsored-ads.ts:89-93](../apps/web/src/lib/api/admin-sponsored-ads.ts#L89-L93)):
`new FormData()` + `apiFetch` (el cliente ya omite el `Content-Type` cuando el cuerpo es
`FormData`, [client.ts:201](../apps/web/src/lib/api/client.ts#L201)).

### 1.4 El molde de la limpieza

`MediaCleanupService.purgeReleased({ before, after, origen })`
([media-cleanup.service.ts:61-94](../apps/api/src/modules/media-cleanup/media-cleanup.service.ts#L61-L94)):
compara dos valores enteros, saca las URLs propias que estaban y ya no están, comprueba
que no las referencie nadie más y **encola** el borrado. Nunca lanza.

Los dos usos que son exactamente nuestro caso —*sustituir una imagen suelta*—:

- el avatar, [users.service.ts:104-108](../apps/api/src/modules/users/users.service.ts#L104-L108);
- la imagen del patrocinado, [sponsored-ads.service.ts:273-277](../apps/api/src/modules/sponsored-ads/sponsored-ads.service.ts#L273-L277).

Los dos hacen literalmente `before: { campo: viejo }, after: { campo: nuevo }` **después**
de escribir. Es el molde del logo, sin variación.

### 1.5 El molde de la propagación

`RevalidateService.revalidateTag(tag)`
([revalidate.service.ts:33-47](../apps/api/src/common/revalidate/revalidate.service.ts#L33-L47))
llama a `POST {appUrl}/api/revalidate?tag=…&secret=…`
([route.ts:13-17](../apps/web/src/app/api/revalidate/route.ts#L13-L17)), fire-and-forget.

Del lado de Next, `unstable_cache` con `tags` y `revalidate: 3600` de red de seguridad
([nav.ts:66-71](../apps/web/src/lib/api/nav.ts#L66-L71), y `getCachedFooterNav` con tag
`footer-nav`). Quien muta, revalida: `FooterService` lo hace en sus **ocho** mutaciones,
`HomepageService` en la suya ([homepage.service.ts:182](../apps/api/src/modules/homepage/homepage.service.ts#L182)).

### 1.6 Los ajustes

`Setting` es `key String @id` + `value Json` + `updatedAt` + `updatedById`
([schema.prisma:1976-1987](../apps/api/prisma/schema.prisma#L1976-L1987)).

- `GET /admin/settings` ([admin.controller.ts:523](../apps/api/src/modules/admin/admin.controller.ts#L523))
  devuelve las filas **más** las claves del whitelist sin fila, con
  `configured: false` y su default ([admin.service.ts:3442-3459](../apps/api/src/modules/admin/admin.service.ts#L3442-L3459)).
- `PATCH /admin/settings/:key` valida contra `SETTING_KEYS`
  ([admin.service.ts:183](../apps/api/src/modules/admin/admin.service.ts#L183), 40+ claves),
  aplica validaciones por clave, hace `upsert` y escribe `AuditLog`
  ([admin.service.ts:3553-3645](../apps/api/src/modules/admin/admin.service.ts#L3553-L3645)).
  El cuerpo es `{ value }` — **un valor JSON, no un fichero**.

### 1.7 El panel de instancia

`/admin/instancia` ([page.tsx](../apps/web/src/app/(admin)/admin/instancia/page.tsx)) ya
existe y ya nace del multi-instancia: «*estas instancias van a ser varias, una por nicho*».
Es solo lectura y pinta `SITE_NAME`, `SITE_DESCRIPTION`, `API_URL` y `DEFAULT_CURRENCY`
como constantes de build del frontend ([page.tsx:9-12](../apps/web/src/app/(admin)/admin/instancia/page.tsx#L9-L12)),
más `GET /admin/instance-info` (ADMIN explícito, [admin.controller.ts:542-546](../apps/api/src/modules/admin/admin.controller.ts#L542-L546)).

---

## 2. El modelo — tres `Setting`, fuera del whitelist

### 2.1 Tres claves, y nada más

```
logoPublicUrl      : string   URL pública de R2 (o sin fila)
logoBackofficeUrl  : string   URL pública de R2 (o sin fila)
logoBlogUrl        : string   URL pública de R2 (o sin fila)
```

**Por qué `Setting` y no una tabla `Branding`:** es exactamente su forma —una clave
global, un valor, quién lo tocó y cuándo—, ya trae `updatedById` y `AuditLog`, y una
tabla de una fila con tres columnas sería un modelo nuevo para no ganar nada. La decisión
de Ernest (tres imágenes independientes, sin logo base ni distintivo automático) es
justamente lo que hace que tres claves planas basten: **no hay relación entre ellas que
modelar**.

**Sin fila = sin configurar**, que es el estado inicial legítimo de toda instancia recién
desplegada y el que dispara el fallback (§5). Es el mismo patrón que `supportEmail` o
`maxTagsPerListing`, y por eso el `upsert` de `updateSetting` existe.

### 2.2 NO entran en `SETTING_KEYS`, y ésta es la decisión de diseño

Es tentador añadir las tres claves al whitelist y dejar que `PATCH /admin/settings/:key`
las escriba. **No se hace**, por tres motivos que no son de estilo:

1. **El valor sería una cadena arbitraria.** `updateSetting` valida enteros, porcentajes y
   enums, pero una clave sin validación acepta cualquier `string`. Un admin —o un error de
   copiar y pegar— dejaría la cabecera de **todas las páginas del sitio** cargando una
   imagen de un dominio ajeno. El logo tiene que ser, por construcción, un objeto de
   nuestro bucket que acabamos de subir.
2. **Saltaría la limpieza.** El `PATCH` pisa el valor y no sabe nada de R2: cada cambio
   dejaría el logo anterior huérfano para siempre. Es literalmente la fuga que
   `users.service.ts:104` cerró para el avatar.
3. **Saltaría la revalidación.** `updateSetting` no llama a `RevalidateService` (ningún
   ajuste lo necesita hoy). Un logo cambiado por ahí no se vería hasta que caducara la
   entrada de caché por la red de seguridad de una hora.

**Consecuencia práctica:** las tres claves **no aparecen** en `/admin/ajustes` (esa
pantalla se alimenta de `getSettings()`, que sólo conoce el whitelist). No es una pérdida:
un logo no se edita en una lista de valores de texto, se sube en una pantalla que lo
enseña. Ver §9, ráfaga L2.

**La barrera correspondiente:** un test que afirme que `PATCH /admin/settings/logoPublicUrl`
responde **400** — o sea, que el único escritor es el módulo de branding.

---

## 3. La subida — un módulo de branding

### 3.1 Los endpoints

```
GET    /branding                       público, sin guards
POST   /admin/branding/logos/:zone     ADMIN, multipart/form-data (campo `file`)
DELETE /admin/branding/logos/:zone     ADMIN, vuelve al fallback
```

`:zone` ∈ `{ public, backoffice, blog }`, validada contra un enum del módulo; cualquier
otra cosa es un 400. **Un endpoint con la zona como dato, no tres endpoints**: el cuerpo
es idéntico y triplicarlo es cómo divergen.

`GET /branding` es público y sin guards, molde exacto de
[footer.controller.ts:5-9](../apps/api/src/modules/footer/footer.controller.ts#L5-L9)
(«*Público, sin guards — cacheado agresivamente en el frontend*»). Devuelve las tres URLs:

```ts
{ public: string | null, backoffice: string | null, blog: string | null }
```

**Las tres en la misma respuesta, incluida la del backoffice**, por dos razones: es UNA
entrada de caché para las tres zonas en vez de tres, y el logo del backoffice **no es un
secreto** — es un objeto público de R2 y saber qué imagen usa el backoffice de `coches.x`
no revela nada que el propio dominio no diga ya. (El `DELETE` responde el mismo objeto,
con la zona borrada a `null`.)

**ADMIN, no EDITOR**, y con el `@MinRole(Role.ADMIN)` explícito: es el argumento ya escrito
en [homepage.service.ts:192-194](../apps/api/src/modules/homepage/homepage.service.ts#L192-L194)
— *que el rol de subir coincida con el rol de poder usar lo subido*. La identidad de la
plataforma no es trabajo de redacción.

### 3.2 El cuerpo del `POST`, paso a paso

1. Validar zona, MIME y tamaño (§6).
2. Subir a `branding/<hex(16)><ext>` — **prefijo propio**, como `blocks/`, `homepage/` y
   `sponsored/`. Nombre aleatorio, no `logo-public.png`: una clave estable haría que el
   navegador sirviera el logo viejo de su caché HTTP durante horas, y además impediría
   distinguir el objeto nuevo del viejo en el `purgeReleased`.
3. Leer el valor anterior (`Setting.findUnique`) — **antes** de escribir, es la única
   consulta que añade la limpieza, igual que en `updateMe`.
4. `upsert` de la clave + `AuditLog` en la misma `$transaction`, con
   `action: 'BRANDING_LOGO_UPDATE'` (`'…_DELETE'` para el borrado), `resourceType: 'Setting'`,
   `resourceId: la clave`. `AuditLog.action` es un `String` libre con convención
   SCREAMING_SNAKE_CASE ([schema.prisma:1938](../apps/api/prisma/schema.prisma#L1938)):
   no hay enum que ampliar.
5. **Después** de escribir: `purgeReleased` (§4).
6. `revalidateTag('branding')` (§7).

**Sin prefijo temporal (`tmp/`) y sin dos pasos.** El avatar y el vídeo nacen en `tmp/`
porque se suben antes de que exista la fila que los referencie y la pestaña puede cerrarse
sin guardar ([media.service.ts:51-60](../apps/api/src/modules/media/media.service.ts#L51-L60)).
Aquí **subir ES guardar**: un solo POST que sube y escribe el `Setting`. No hay ventana en
la que el objeto exista sin dueño, así que no hay nada que caducar.

**Sin cola de procesado.** `POST /media/upload` encola `QUEUE_IMAGE` porque una foto de
anuncio necesita miniaturas; un logo se sirve tal cual, como las de `blocks/`,
`homepage/` y `sponsored/`, que tampoco pasan por la cola.

---

## 4. La limpieza R2 — la fuga, en sus dos direcciones

### 4.1 Dirección 1 — el logo viejo, al cambiarlo (la fuga del encargo)

Confirmado: `purgeReleased` **no ve los `Setting`**. Nada lo recorre en busca de URLs, y
`Setting` no aparece en `laReferenciaAlguienMas`
([media-cleanup.service.ts:120-160](../apps/api/src/modules/media-cleanup/media-cleanup.service.ts#L120-L160)).
Sin enganchar nada, cada cambio de logo dejaría el anterior en el bucket para siempre.

La solución es el molde avatar, sin inventar nada — **después** del `upsert`:

```
purgeReleased({
  before: { logoUrl: anterior },      // null si no había fila
  after:  { logoUrl: nuevo },         // null en el DELETE
  origen: `branding:${zone}`,
})
```

Las dos propiedades del molde se heredan enteras: va **después** de escribir (si fuera
antes, la propia fila contaría como «otro dueño» y no se borraría nunca), y **no puede
tumbar la operación** (encola, no borra en línea; nunca lanza).

El `DELETE` de una zona es el mismo caso con `after: { logoUrl: null }`: el diff sale con
la URL entera y el objeto se limpia igual.

### 4.2 Dirección 2 — el logo VIVO, borrado por otra superficie (la trampa que el encargo no pide, y hay que cerrar)

`laReferenciaAlguienMas` es la red que impide borrar un objeto que alguien más usa.
Comprueba `ListingImage`, `User.avatarUrl`, `SponsoredAd.imageUrl`, `Invoice.pdfKey`,
`TicketAttachment.key`, el `Json` de `Post`, el de `HomepageConfig` y el vídeo del
anuncio. **No comprueba `Setting`.**

El escenario, con las reglas de hoy: los validadores de bloque exigen «URL de nuestro
almacenamiento», **no un prefijo concreto** —el propio comentario del fichero lo dice—, así
que nada impide pegar la URL del logo en un bloque de la portada o de un post. Al quitar
ese bloque, `HomepageService`/`BlogService` llaman a `purgeReleased`, la comprobación no
encuentra a nadie que la referencie… **y borra el logo que la cabecera está sirviendo.**
Las tres zonas se quedan con una imagen rota a la vez, y el `Setting` sigue apuntando a un
objeto que ya no existe.

**El parche, dentro de L1:** añadir `Setting` a `laReferenciaAlguienMas`, con el mismo
`strpos` sobre el texto del `Json` que ya usa para `Post` y `HomepageConfig` (una sola
consulta más, y el fichero ya tiene el patrón escrito). Es una línea de defensa que sigue
la regla de oro declarada en el propio servicio: *ante la duda, un huérfano de más es mejor
que un fichero vivo de menos*.

**La barrera:** un test unitario de `MediaCleanupService` que, con un `Setting` cuyo valor
es la URL X, no encole el borrado de X.

---

## 5. El fallback — ninguna zona sin marca

La cadena, por zona. Se evalúa de arriba abajo y **el último eslabón nunca puede fallar**,
porque es texto de una constante de build:

| Zona | 1.º | 2.º | 3.º (nunca falla) |
|---|---|---|---|
| **Público** (y cuenta) | `logoPublicUrl` | — | `SITE_NAME` como texto (lo de hoy, [Header.tsx:31](../apps/web/src/components/layout/Header.tsx#L31)) |
| **Backoffice** | `logoBackofficeUrl` | `logoPublicUrl` | `{SITE_NAME} · Backoffice` como texto |
| **Blog** | `logoBlogUrl` | `logoPublicUrl` | `SITE_NAME` como texto |

Tres decisiones dentro de esa tabla:

**5.1 El público no tiene segundo eslabón.** No hay de qué caer: si no hay logo público, es
el nombre. Poner una imagen genérica de fábrica sería peor —parecería la marca de otro—.

**5.2 Backoffice y blog caen al logo público antes que al texto.** Es lo correcto para la
motivación de diferenciar: una instancia que sólo sube UN logo (el caso más probable el
primer día) queda coherente en las tres zonas en vez de mostrar una imagen en una y texto
en las otras dos. La diferenciación se pierde, pero **la marca no**; y el día que suban el
segundo logo, la diferenciación aparece sola.

**5.3 El fallback del backoffice cambia de «Backoffice» a «`{SITE_NAME}` · Backoffice»**, y
es una propuesta deliberada. Hoy la cabecera del backoffice es instance-blind: dice qué
zona es, no qué instancia. Como el motivo entero del logo de backoffice es saber **en qué
instancia estás**, el fallback debe contestar la misma pregunta con lo que ya hay a mano.
Cuesta cero y hace que el multi-instancia funcione incluso **sin ningún logo subido**.
Ningún e2e afirma ese literal (§1.2). *(Decisión de Ernest en §11.)*

**5.4 El footer y los `<title>` no entran.** El `© 2026 Marketplace…` de
[Footer.tsx:51](../apps/web/src/components/layout/Footer.tsx#L51) es una línea legal —el
nombre de la sociedad, no la marca gráfica— y los `SITE_NAME` de los `<title>` y del OG son
SEO. Meter un logo ahí no aporta y sí amplía la superficie. **Fuera de alcance.**

**5.5 Nada de huecos con reserva de espacio.** El fallback es texto que se pinta en el
mismo render: no hay estado «cargando» en el que la cabecera esté vacía. En público y
cuenta la cabecera es Server Component, así que el HTML sale ya con el logo o ya con el
texto; en el backoffice, que es cliente, el estado inicial es **el texto de fallback**, y
si llega el logo, lo sustituye. Nunca al revés.

---

## 6. El formato — límites propios, y sí a SVG

### 6.1 Los límites no se heredan tal cual

Reusar `MAX_FILE_SIZE` (10 MB) sería absurdo para una imagen que se sirve en **todas** las
páginas: un PNG de 10 MB en la cabecera es un problema de rendimiento del sitio entero, no
un fichero grande. Se declara un límite propio del módulo:

```
LOGO_MAX_BYTES = 1 * 1024 * 1024   // 1 MB   (propuesta)
```

Hay precedente explícito para no compartir el número:
[video-limits.ts:5](../apps/api/src/modules/video/video-limits.ts#L5) — «*viven aparte de
`MAX_FILE_SIZE` a propósito: ese número protege otra cosa*».

### 6.2 SVG: sí, con un mapa MIME propio del módulo

Un logo suele ser SVG y hoy **ninguno** de los cuatro caminos de subida lo acepta
(`MIME_TO_EXT` sólo tiene jpeg/png/webp). La decisión:

```
LOGO_MIME_TO_EXT = { 'image/png': '.png', 'image/webp': '.webp',
                     'image/svg+xml': '.svg', 'image/jpeg': '.jpg' }   // propuesta
```

**Declarado en el módulo de branding, NO añadido a `MIME_TO_EXT`.** Ampliar el mapa
compartido metería SVG de golpe en avatares, fotos de anuncio, bloques de blog,
patrocinados y portada —cinco superficies, cuatro de ellas alimentadas por usuarios o por
EDITOR— por el precio de una necesidad de una sola. Ese es exactamente el reparto que el
propio repo hizo con los límites del vídeo.

**Por qué SVG es aceptable AQUÍ y no en las otras superficies**, con los tres hechos
verificados:

1. **Sólo ADMIN sube.** No es contenido de usuario ni de editor.
2. **Se sirve desde otro origen.** El bucket público es `*.r2.cloudflarestorage.com`
   ([image-domains.ts:3](../apps/web/src/lib/image-domains.ts#L3)), no el dominio de la
   app: un `<script>` dentro del SVG no correría en el origen que tiene las cookies de
   sesión.
3. **Renderizado como `<img>`, el script no se ejecuta nunca.** Sólo se ejecutaría si
   alguien navegase directamente a la URL del objeto, o si el SVG se incrustara *inline*
   en el DOM — y **no se incrusta inline**, es una decisión de este diseño.

### 6.3 `<img>`, no `next/image`

`next/image` **rechaza los SVG** salvo que se active `images.dangerouslyAllowSVG`, que hoy
no está y que sería una relajación global para todo el sitio
([next.config.ts:9](../apps/web/next.config.ts#L9)). Además, un logo no necesita nada de lo
que el optimizador da: es pequeño, va a tamaño fijo y no tiene variantes responsive.

**Se renderiza con un `<img>` normal**, con altura fija y anchura automática
(`h-8 w-auto max-w-[180px]` en público, `h-7` en el backoffice — números a afinar en la
implementación). Eso resuelve de paso el hueco del modelo: **no hace falta guardar ancho ni
alto**, la caja la fija el CSS y cualquier proporción entra sin desplazar la cabecera (sin
CLS). El `alt` es el nombre accesible del enlace: `SITE_NAME` en público y blog,
`Backoffice de {SITE_NAME}` en el admin — nunca `alt=""`, porque el logo **es** el enlace a
la portada.

---

## 7. El caché y la propagación

### 7.1 Público y blog (Server Components)

Molde `footer-nav`, sin desviación:

```ts
getCachedBranding() =>
  unstable_cache(getBranding, ['branding'], { revalidate: 3600, tags: ['branding'] })
```

Una sola entrada, clave constante, porque `GET /branding` no filtra nada — igual que
`getCachedFooterNav` y **a diferencia** de `getCachedNav`, que lleva `pageType` en la clave.
`revalidate: 3600` es red de seguridad, no la vía principal.

Y `.catch(() => null)` alrededor, como el footer y el nav: **un backend caído no puede
romper la cabecera**; cae al fallback de texto, que es exactamente lo que hay hoy.

### 7.2 Quien muta, revalida

`BrandingService` llama a `revalidateService.revalidateTag('branding')` en el `POST` y en el
`DELETE`. Sin excepción, que es la frase textual de
[homepage.service.ts:179-182](../apps/api/src/modules/homepage/homepage.service.ts#L179-L182).

**El límite honesto, dicho aquí y no descubierto luego:** `revalidateTag` tumba la entrada
de datos; las páginas ya prerenderizadas con ISR se rehacen en su propio ciclo. El logo
hereda **exactamente** la semántica de propagación del footer y del nav, que se pintan en
las mismas páginas: ni mejor ni peor, y sin mecanismo nuevo que mantener. Si esa
propagación resultara insuficiente al medirla, es una deuda compartida con el footer y se
cierra en un solo sitio, no en éste.

### 7.3 Backoffice (cliente)

`(admin)` es client-side y sin SSR: no hay `unstable_cache` que invalidar. La cabecera pide
`GET /branding` al montar —sin token, es público— y el cambio se ve en la siguiente carga
del panel. Para quien acaba de subir el logo, además, la propia respuesta del `POST` trae
las tres URLs, así que **su** cabecera se actualiza en el acto.

---

## 8. El multi-instancia — el logo del backoffice es la señal

La premisa está ya escrita en el repo: «*estas instancias van a ser varias, una por nicho*»
([admin.controller.ts:529-533](../apps/api/src/modules/admin/admin.controller.ts#L529-L533)).
`/admin/instancia` contesta hoy «¿desde qué dirección salen los correos? ¿está cobrando de
verdad?»; le falta la respuesta de un vistazo, sin entrar en ninguna pantalla: **¿en cuál
estoy?**

Tres piezas, y las tres son baratas:

1. **La cabecera del backoffice lleva el logo de backoffice**, visible en las 22 secciones.
   Es la señal principal: si `coches.x` y `motos.x` corren el mismo código, lo que las
   distingue en pantalla es esa imagen.
2. **El fallback del backoffice nombra la instancia** (§5.3), para que la señal exista
   también antes de que nadie suba nada.
3. **`/admin/instancia` enseña los tres logos** en solo lectura, junto a `SITE_NAME`, con un
   enlace a la pantalla donde se cambian. Es literalmente el reparto que esa página ya
   declara: «*lo que sí es configurable aparece aquí en solo lectura Y se edita en
   `/admin/ajustes`, con un enlace para ir*»
   ([page.tsx:24-29](../apps/web/src/app/(admin)/admin/instancia/page.tsx#L24-L29)). Y es
   donde se ve de un golpe que una zona está sin configurar y cayendo al fallback.

**Lo que este diseño NO hace:** derivar el logo del dominio, ni meterlo en variables de
entorno, ni en `instance-info`. Es configurable desde la interfaz, por instancia, porque
está en la base de datos de esa instancia — y cada despliegue tiene la suya. No hace falta
ningún mecanismo de «tenant».

---

## 9. El plan — dos ráfagas

### L1 — el backend del branding

- Módulo `branding`: `BrandingController` (público) + `AdminBrandingController` (ADMIN) +
  `BrandingService`. Constantes propias (`LOGO_MAX_BYTES`, `LOGO_MIME_TO_EXT`, prefijo
  `branding/`, las tres claves de `Setting`, el enum de zona) en un fichero puro
  `branding.constants.ts`, molde `listing-limits.ts` / `video-limits.ts`.
- `GET /branding`, `POST` y `DELETE /admin/branding/logos/:zone`.
- La limpieza al cambiar (§4.1) y **el parche de `laReferenciaAlguienMas`** (§4.2).
- `AuditLog` en las dos mutaciones; `revalidateTag('branding')` en las dos.
- Swagger: `@ApiConsumes('multipart/form-data')` como sus tres hermanos.

### L2 — las tres zonas y la pantalla del admin

- `lib/api/branding.ts`: `getCachedBranding()` (tag `branding`) + el `FormData` del POST y
  el DELETE, molde `homepage-admin.ts`.
- **Público:** `Header` lee el branding y pinta `<img>` o el texto. Cubre de paso la zona de
  cuenta, que monta el mismo componente.
- **Blog:** ver §6 de decisiones abiertas (§11.2) — es el único punto con dos caminos.
- **Backoffice:** la cabecera de `(admin)/layout.tsx` **y** el título del drawer de
  `AdminMobileNav` — son dos sitios y los dos deben cambiar, o el móvil seguirá diciendo
  «Backoffice» a secas.
- **La pantalla:** `/admin/marca`, sección nueva del grupo `plataforma`, junto a `Ajustes` e
  `Instancia` ([backoffice-sections.ts:256-260](../apps/web/src/config/backoffice-sections.ts#L256-L260)),
  `minRole: 'ADMIN'`. Tres tarjetas idénticas (previsualización sobre fondo claro y oscuro,
  «Subir», «Quitar», y **el aviso de qué fallback está actuando** cuando la zona está
  vacía). Feedback por `toast` vía `successMessage` de `useApiAction`, y `AlertDialog`
  antes de «Quitar» — las dos reglas del CLAUDE.md de `apps/web`.
- **`/admin/instancia`:** los tres logos en solo lectura + enlace a `/admin/marca`.

**Por qué dos y no una:** L1 es cerrable y verificable por sí sola (e2e contra la API, sin
tocar una sola pantalla), y L2 es donde vive el único punto de diseño abierto (el blog). Si
la decisión del blog se toma como «opción A» antes de empezar, L2 no se ramifica.

---

## 10. Las barreras

Lo que tiene que ser cierto al terminar, y lo que lo comprueba:

| # | Barrera | Cómo se pincha |
|---|---|---|
| B1 | **Los tres logos son independientes y configurables.** Subir el del blog no toca el del público ni el del backoffice. | e2e de API: tres POST, un `GET /branding` con las tres URLs distintas |
| B2 | **Ninguna zona queda sin marca.** Sin ninguna fila de logo, las tres cabeceras muestran su texto de fallback. | e2e con la base sembrada sin logos: la cabecera pública dice `SITE_NAME`, la del backoffice nombra la instancia, el blog dice `SITE_NAME` |
| B3 | **El fallback intermedio funciona.** Con SÓLO el logo público, backoffice y blog lo muestran a él, no texto. | e2e: un POST a `public`, comprobar las tres zonas |
| B4 | **Cambiar un logo NO deja huérfanos.** El objeto anterior se encola para borrado. | test unitario de `BrandingService`: el segundo POST llama a `purgeReleased` con `before` = la URL vieja |
| B5 | **El logo vivo NO lo borra nadie más.** Con un `Setting` que referencia la URL X, ninguna otra superficie la borra. | test unitario de `MediaCleanupService`: `laReferenciaAlguienMas` devuelve `true` para una URL en `Setting` |
| B6 | **El único escritor es el branding.** | test: `PATCH /admin/settings/logoPublicUrl` → **400** |
| B7 | **El cambio se propaga.** Toda mutación de logo revalida el tag. | test unitario: POST y DELETE llaman a `revalidateTag('branding')` (molde `footer.service.spec.ts`) |
| B8 | **El multi-instancia se ve.** La cabecera del backoffice enseña el logo de backoffice, y `/admin/instancia` los tres. | e2e de backoffice |
| B9 | **Nadie más que ADMIN sube un logo.** EDITOR y MODERATOR reciben 403. | e2e de roles, molde `admin-roles.spec.ts` |
| B10 | **El formato se respeta.** Un GIF se rechaza; un SVG se acepta; 2 MB se rechaza. | e2e de API sobre el endpoint |

---

## 11. Lo que hace falta decidir antes de empezar

### 11.1 El fallback del backoffice: ¿«Backoffice» o «`{SITE_NAME}` · Backoffice»?

Propuesto el segundo (§5.3): hace que la instancia se identifique **aunque no haya ningún
logo subido**, que es el estado del primer día de cada despliegue nuevo. Cuesta cero y no
rompe ningún test. **Decisión de Ernest.**

### 11.2 El blog no tiene cabecera propia — cómo se le da un logo distinto

Es el único punto no trivial, y viene de un hecho verificado: `(public)/blog/layout.tsx`
sólo monta `MainNav`; la cabecera del blog **es** la pública, montada un nivel más arriba.
Un layout hijo no puede cambiarle las props a la cabecera de su padre.

**Opción A — la marca es un componente cliente diminuto (recomendada).**
`Header` sigue siendo Server Component y le pasa las URLs ya resueltas a un
`<SiteBrand>` con `'use client'`, que elige por `usePathname().startsWith('/blog')`.

- **A favor:** un componente nuevo y nada más; cero cirugía de layouts; **no afecta al
  ISR** —el hook es de cliente, el HTML prerenderizado ya sale con el logo correcto porque
  la ruta se conoce al renderizar—; ~1 KB de JS en las páginas públicas.
- **En contra:** el repo tiene una decisión escrita de que **la zona la declara el layout y
  no se deriva del pathname** ([MainNav.tsx:62-65](../apps/web/src/components/layout/MainNav.tsx#L62-L65),
  `diseno-nav-dinamico.md` §4.1-4.2). Conviene decirlo con precisión: **el motivo de aquella
  regla era proteger el ISR** —derivarla en el servidor obligaba a `headers()` en el layout—
  y esta opción lo protege igual. Rompe la forma de la regla, no su razón. Aun así, es una
  segunda manera de saber en qué zona estás, y eso es deuda.

**Opción B — un grupo de rutas, y cada layout declara su zona.**
`(public)/layout.tsx` se queda con el `Footer`; el `Header` baja a dos layouts: uno para el
blog (`zone="BLOG"`) y otro para el resto, agrupando los nueve subárboles restantes en un
`(public)/(sitio)/`.

- **A favor:** declarativo, exactamente como `pageType`; cero JS de cliente; respeta la
  regla en la forma y en el fondo.
- **En contra:** mueve nueve directorios de páginas. Las URLs no cambian (un grupo de rutas
  no aparece en la ruta) y los imports son absolutos (`@/…`), así que es mecánico — pero es
  un diff grande y ruidoso para poner un logo.

**Recomendación: A**, con la razón dicha arriba, y B como camino si Ernest prefiere pagar
el movimiento a cambio de la coherencia declarativa.

### 11.3 ¿Se acepta SVG?

Propuesto sí (§6.2), con mapa MIME propio del módulo, sólo ADMIN, render con `<img>` y sin
tocar `dangerouslyAllowSVG`. Si Ernest prefiere no abrir SVG en absoluto, el diseño no
cambia en nada más: se cae el `image/svg+xml` del mapa y ya está — pero conviene saber que
los logos de marca casi siempre llegan en SVG y que pedirle al admin que convierta a PNG
es la clase de fricción que acaba en una imagen borrosa en la cabecera.

### 11.4 El límite de tamaño

Propuesto 1 MB (§6.1). Es holgado para PNG/SVG de logo y sigue siendo diez veces menos que
el límite general, que protege otra cosa.
