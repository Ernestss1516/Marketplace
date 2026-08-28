# Diseño — Ampliación de ubicaciones de banners (2 → 14)

**Estado:** diseño, sin implementar. Cero código escrito.
**Encargo:** añadir 12 ubicaciones nuevas al sistema de banners, que hoy solo vive en
la portada y en `/mis-anuncios`.
**Verificado contra el código** el 2026-08-28, rama `main` (`b64622b`). Cada afirmación
lleva su fichero y su línea; lo que no se ha podido comprobar se dice.

---

## 0. Resumen para decidir

| Pregunta | Respuesta corta |
|---|---|
| ¿Cambia el backend? | Casi nada: **una migración aditiva de enum** y una línea en `schema.prisma`. Los tres DTO validan con `@IsEnum(BannerPlacement)` leído de Prisma, así que se enteran solos. `getActiveBanners` **no se toca**. |
| ¿El selector del admin los ofrece solo? | **No.** Está hardcodeado en **tres** sitios del frontend (§5). Y el contenedor actual (`flex gap-4`, sin `flex-wrap`) **revienta con 14 casillas** dentro de un `Dialog`. |
| ¿Cuántas de las 12 son «client-side»? | **Ninguna.** Las cinco páginas protegidas del encargo son Server Components `async` con `auth()` + SSR, igual que `/mis-anuncios`. La premisa de que había un camino cliente no se sostiene (§2). |
| ¿Cuántos ficheros de página hay que tocar? | **12 páginas → 12 ficheros**, pero uno de ellos (`CategoryListingPage.tsx`) cubre **4 rutas** de categoría a la vez. |
| ¿Cuál NO es mecánica? | Cuatro: `/contacto` (§2.3), `/busqueda` y la ficha (`allSettled`, no `all`), `/[categoria]` (el `try/catch` de Meilisearch, §2.4) y `/perfil` (hoy sus dos fetch son secuenciales). |
| ¿El riesgo real? | Bajo. El riesgo no está en el código: está en **dónde se pone el bloque** en tres páginas de foco (§3.3) y en si todas las 12 ubicaciones tienen sentido de producto (§4). |
| Dimensionado | **2 ráfagas** (§6). La primera es la que tiene toda la sustancia; la segunda es calco. |

---

## 1. El punto de partida — confirmado contra el código

Las cinco afirmaciones del encargo se han comprobado una a una. Las cinco son ciertas,
**con una corrección** (la quinta).

### 1.1 `placements` es un array escalar — cierto

```prisma
// apps/api/prisma/schema.prisma:2558-2561
enum BannerPlacement {
  HOME
  MIS_ANUNCIOS
}

// apps/api/prisma/schema.prisma:2586-2587
/// Ubicaciones donde se muestra. No puede quedar vacío (validado en el DTO).
placements BannerPlacement[]
```

Un banner con el mismo contenido en varias ubicaciones es **una entidad**, no una fila por
ubicación. Ampliar es, literalmente, añadir valores al enum. La columna en Postgres ya es
`"BannerPlacement"[]` ([`migrations/20260706110124_add_banners/migration.sql`](../apps/api/prisma/migrations/20260706110124_add_banners/migration.sql)), así que **no hay backfill**: los banners existentes conservan su array tal cual.

### 1.2 `getActiveBanners` no cambia — cierto

```ts
// apps/api/src/modules/banners/banners.service.ts:24-35
async getActiveBanners(placement: BannerPlacement): Promise<Banner[]> {
  const now = new Date();
  return this.prisma.banner.findMany({
    where: {
      active: true,
      startsAt: { lte: now },
      endsAt: { gte: now },
      placements: { has: placement },
    },
    orderBy: { createdAt: 'desc' },
  });
}
```

El filtro es genérico sobre el enum. Con doce valores nuevos, **este método no se toca ni
una línea**: solo recibe argumentos que antes no existían. El índice
`@@index([active, startsAt, endsAt])` (schema:2603) sigue sirviendo igual — el `has` sobre
el array no está indexado hoy y con el volumen de banners (decenas, no miles) tampoco hace
falta.

Los tres DTO validan contra el enum de Prisma, no contra listas propias:

| DTO | Fichero | Validación |
|---|---|---|
| `ActiveBannersDto` | [`dto/active-banners.dto.ts:7`](../apps/api/src/modules/banners/dto/active-banners.dto.ts#L7) | `@IsEnum(BannerPlacement)` |
| `CreateBannerDto` | [`dto/create-banner.dto.ts:37-40`](../apps/api/src/modules/banners/dto/create-banner.dto.ts#L37-L40) | `@IsArray() @ArrayNotEmpty() @IsEnum(…, { each: true })` |
| `ListBannersDto` | [`dto/list-banners.dto.ts:6-8`](../apps/api/src/modules/banners/dto/list-banners.dto.ts#L6-L8) | `@IsEnum(BannerPlacement)`, opcional |

**Consecuencia:** el backend entero (controller, service, DTO, Swagger) queda correcto con
la migración y el `schema.prisma`. No hay una segunda lista que mantener en Nest.

### 1.3 `BannerList` recibe los banners resueltos por SSR — cierto

[`components/banners/BannerList.tsx`](../apps/web/src/components/banners/BannerList.tsx):
Client Component que recibe `banners: Banner[]` ya resueltos (línea 60-62), filtra por los
descartados en `localStorage` en un `useEffect` tras montar (75-77), y pinta un bloque de
aviso por banner: título, texto, enlace opcional (validado con `isSafeContentUrl`), botón
«Compartir» opcional y una × de descarte.

Tres detalles que importan para las 12 páginas nuevas:

1. **Es texto puro, no imagen.** Un `div` con borde, fondo tintado por variante
   (`INFO` azul / `PROMO` verde / `WARNING` ámbar, líneas 12-16) y `space-y-3` entre
   banners. Ocupa el ancho de su contenedor y **no impone márgenes propios**: cada punto de
   llamada los pone (la home usa `pt-4`, mis-anuncios `mb-6`). Esto es relevante en §3.
2. **El descarte es GLOBAL por id, no por ubicación.** `DISMISSED_KEY = 'dismissed-banners'`
   guarda un `Set<string>` de ids (líneas 10, 18-33). Un usuario que cierra un banner en
   `/busqueda` **ya no lo ve en ninguna de las 14 ubicaciones**. Esto es el argumento más
   fuerte a favor de ser generoso con las ubicaciones (§4.2).
3. **El flash de hidratación se multiplica.** El propio componente documenta (líneas 64-70)
   que el primer render coincide con el SSR —nada descartado— y el filtro real corre tras
   montar: un banner ya descartado parpadea brevemente. Hoy eso pasa en 2 páginas; con 14
   pasará en 14. **No es un defecto nuevo, pero sí una superficie mayor** de un trade-off
   que se aceptó cuando afectaba a la portada. Se nombra aquí para que la decisión de
   ampliar lo tenga delante; no se propone arreglarlo en esta ampliación.

### 1.4 El molde de home / mis-anuncios — cierto, y son *dos* moldes

**Portada** ([`(public)/(home)/page.tsx:27-31, 67-73`](../apps/web/src/app/(public)/(home)/page.tsx#L27-L31)):

```tsx
const [homepage, categories, banners] = await Promise.all([
  getCachedHomepageConfig().catch(() => FALLBACK_HOMEPAGE_CONFIG),
  getCategories().catch(() => []),
  getActiveBanners('HOME').catch(() => []),
]);
…
{banners.length > 0 && (
  <div className="container mx-auto px-4 pt-4">
    <BannerList banners={banners} />
  </div>
)}
```

El banner va **encima del hero**, o sea: lo primero de la página.

**Mis anuncios** ([`(account)/mis-anuncios/page.tsx:27-48, 82-93`](../apps/web/src/app/(account)/mis-anuncios/page.tsx#L82-L93)):

```tsx
const [{ items, counts }, proStatus, catalog, wallet, banners] = await Promise.all([…,
  getActiveBanners('MIS_ANUNCIOS').catch(() => []),
]);
…
{/* UXV.6 (B6) — el banner promocional va DEBAJO de la cabecera, no encima. */}
{banners.length > 0 && (
  <div className="mb-6"><BannerList banners={banners} /></div>
)}
```

Y aquí va **debajo del `<h1>` y de los botones de acción**, con un comentario que explica
por qué se movió: *«lo primero que veía el vendedor al entrar en SU pantalla de gestión era
publicidad»*.

> **Los dos moldes discrepan en la posición, y la discrepancia está justificada en el
> código.** La portada es la excepción (su «contenido» es el hero, y el aviso lo precede a
> propósito); mis-anuncios es la regla. §3 elige cuál se replica a las 12.

Lo que **sí es idéntico** en los dos y debe replicarse tal cual:
`getActiveBanners(...).catch(() => [])` dentro del `Promise.all`, y el guard
`banners.length > 0` (que es redundante — `BannerList` ya devuelve `null` con la lista
vacía, línea 96 — pero evita pintar el `<div>` contenedor con su margen).

### 1.5 El selector del admin — **CORRECCIÓN: está hardcodeado, en tres sitios**

El encargo lo planteaba como duda («o verificar si el selector lista el enum o está
hardcodeado»). Está hardcodeado, y en más sitios de los que parece, porque **el frontend no
tiene Prisma** y declara el enum a mano:

| # | Fichero | Qué es | Línea |
|---|---|---|---|
| 1 | [`lib/api/banners.ts:3`](../apps/web/src/lib/api/banners.ts#L3) | `export type BannerPlacement = 'HOME' \| 'MIS_ANUNCIOS';` — el **tipo** del frontend | 3 |
| 2 | [`admin/banners/_components/BannerFormDialog.tsx:40-43`](../apps/web/src/app/(admin)/admin/banners/_components/BannerFormDialog.tsx#L40-L43) | `PLACEMENT_OPTIONS` — las **casillas** del formulario | 40-43 |
| 3 | [`admin/banners/page.tsx:26-29`](../apps/web/src/app/(admin)/admin/banners/page.tsx#L26-L29) | `PLACEMENT_LABELS` — las **etiquetas** de la columna «Ubicaciones» del listado | 26-29 |

Este reparto no es un descuido: es el mismo que sigue el nav
([`lib/api/nav.ts:6-21`](../apps/web/src/lib/api/nav.ts#L6-L21), *«Espejo del enum
NavPageType del backend — el frontend no tiene Prisma, igual que BannerPlacement se declara
a mano»*). Hay que mantenerlo, no combatirlo. Lo que sí se puede es **hacer que el
compilador vigile los tres** (§5.3).

---

## 2. El enum y las 12 páginas

### 2.1 Los 12 valores — nombres y convención

La convención está escrita en el schema, en el comentario de `NavPageType`
([`schema.prisma:2774-2775`](../apps/api/prisma/schema.prisma#L2774)):

> *«Nombres en español como `BannerPlacement.MIS_ANUNCIOS`: nombran rutas de cara al
> usuario, no conceptos de código.»*

Es decir: **el valor del enum nombra la RUTA**, no la pantalla. Y ya existe un enum hermano
—`NavPageType`, 9 valores— que nombra ocho de estas mismas páginas. **La propuesta reutiliza
sus nombres exactos donde coinciden**, para que los dos enums se lean juntos sin traducción
mental:

| # | Valor propuesto | Ruta(s) que cubre | Zona | ¿Existe en `NavPageType`? | Nota |
|---|---|---|---|---|---|
| 1 | `BLOG` | `/blog` y `/blog/[slug]` | pública | ✅ mismo nombre | Grueso a propósito: índice y ficha |
| 2 | `PLANES` | `/planes` (+ `/exito`, `/cancelado`) | pública | ✅ | Ver §2.2 sobre las subrutas |
| 3 | `BUSQUEDA` | `/busqueda` | pública | ✅ | |
| 4 | `CATEGORIA` | `/[categoria]` y sus 3 niveles | pública | ✅ | 4 rutas, **1 solo fichero** |
| 5 | `ANUNCIO` | `/anuncio/[slug]` | pública | ✅ | El encargo proponía `FICHA_ANUNCIO` — ver abajo |
| 6 | `VENDEDOR` | `/vendedor/[slug]` | pública | ✅ | El encargo proponía `PERFIL_VENDEDOR` — ver abajo |
| 7 | `CONTACTO` | `/contacto` | pública | ✅ | |
| 8 | `PERFIL` | `/perfil` | cuenta | ❌ | **No** cubre `/perfil/suscripcion` |
| 9 | `PERFIL_FACTURACION` | `/perfil/facturacion` | cuenta | ❌ | Molde `MIS_ANUNCIOS` |
| 10 | `NOTIFICACIONES` | `/notificaciones` | cuenta | ❌ | |
| 11 | `MIS_ALERTAS` | `/mis-alertas` | cuenta | ❌ | |
| 12 | `MIS_CREDITOS` | `/mis-creditos` | cuenta | ❌ | La ruta se llama así; el usuario lee «Mi saldo» — ver abajo |

**Dos divergencias respecto a los nombres del encargo, y el porqué:**

- **`ANUNCIO` en vez de `FICHA_ANUNCIO`** y **`VENDEDOR` en vez de `PERFIL_VENDEDOR`.**
  La regla es «nombra la ruta»: las rutas son `/anuncio/[slug]` y `/vendedor/[slug]`.
  Además `NavPageType` ya usa `ANUNCIO` y `VENDEDOR` para exactamente esas dos páginas
  ([`schema.prisma:2786, 2789`](../apps/api/prisma/schema.prisma#L2786)), y el admin del nav
  ya las etiqueta *«Ficha de anuncio»* y *«Perfil de vendedor»*
  ([`admin/nav/page.tsx:27, 30`](../apps/web/src/app/(admin)/admin/nav/page.tsx#L27)).
  **La claridad la aporta la etiqueta, no el valor.** Dos enums que nombran la misma página
  con nombres distintos es la clase de detalle que se paga tres meses después.
- **`MIS_CREDITOS` aunque la pantalla se llame «Mi saldo».** La ruta es `/mis-creditos` y se
  queda así por decisión documentada
  ([`mis-creditos/page.tsx:22-35`](../apps/web/src/app/(account)/mis-creditos/page.tsx#L22-L35):
  *«LA URL SE QUEDA, y es una decisión, no un olvido»*). El enum nombra la ruta; **la
  etiqueta del admin debe decir «Mi saldo»**, que es lo que el admin ve en su propio menú.

**Enum resultante (14 valores), agrupado como se usará en el admin:**

```prisma
/// Ubicaciones donde puede mostrarse un Banner. Nombres en español: nombran RUTAS
/// de cara al usuario, no conceptos de código (misma convención que NavPageType).
/// Los ocho primeros son páginas públicas; los seis últimos, de la zona de cuenta.
/// BLOG cubre el índice y la ficha, y CATEGORIA cubre los cuatro niveles de ruta:
/// renderizan por el mismo componente. Separarlos después es una migración aditiva
/// sin backfill (molde ContactReasonScope); fusionarlos obligaría a reescribir los
/// `placements` ya guardados — por eso se empieza grueso.
enum BannerPlacement {
  HOME
  BUSQUEDA
  CATEGORIA
  ANUNCIO
  BLOG
  VENDEDOR
  PLANES
  CONTACTO
  MIS_ANUNCIOS
  PERFIL
  PERFIL_FACTURACION
  NOTIFICACIONES
  MIS_ALERTAS
  MIS_CREDITOS
}
```

**Migración — aditiva pura, sin backfill.** Precedente exacto en el repo
([`20260706003231_add_action_discount_campaign_type/migration.sql`](../apps/api/prisma/migrations/20260706003231_add_action_discount_campaign_type/migration.sql)):

```sql
-- AlterEnum
ALTER TYPE "BannerPlacement" ADD VALUE 'BUSQUEDA';
ALTER TYPE "BannerPlacement" ADD VALUE 'CATEGORIA';
… (12 sentencias)
```

Los valores ya existentes (`HOME`, `MIS_ANUNCIOS`) no se tocan, el orden de declaración no
importa para nada del código, y ningún banner guardado cambia.

> **Nota operativa (a verificar al implementar, no aquí):** en PostgreSQL, `ALTER TYPE …
> ADD VALUE` no puede ejecutarse dentro de un bloque de transacción en versiones
> anteriores a la 12. El repo ya tiene ese precedente resuelto (la migración citada corrió
> en su día), así que lo esperable es que `prisma migrate dev` lo genere y aplique sin
> intervención. Si el runner lo rechaza, la salida es partir en 12 migraciones o marcar el
> fichero — decisión de implementación, no de diseño.

### 2.2 El grosor de cada valor — qué rutas cubre de verdad

Esto no es cosmético: decide **cuántos ficheros se tocan** y qué pasa con las subrutas.

| Valor | Ficheros de ruta que existen | Ficheros a tocar | Decisión |
|---|---|---|---|
| `CATEGORIA` | **4**: `[categoria]/`, `/[subcategoria]/`, `/[nivel3]/`, `/[nivel4]/` | **1** | Los cuatro son cáscaras de 30-40 líneas que delegan en `CategoryListingPage` ([`[categoria]/page.tsx:35`](../apps/web/src/app/(public)/[categoria]/page.tsx#L35)). El banner va **en el componente compartido**. |
| `BLOG` | **2**: `/blog`, `/blog/[slug]` | **2** | Un valor, dos inserciones. Mismo criterio que `NavPageType.BLOG`. |
| `PLANES` | **3**: `/planes`, `/planes/exito`, `/planes/cancelado` | **1** | **Solo `/planes`.** Éxito y cancelado son pantallas de retorno de Stripe; un aviso promocional ahí es ruido sobre una transacción recién cerrada. Si se quisieran, la vía limpia es el layout (§2.5), no tres copias. |
| `MIS_CREDITOS` | **3**: `/mis-creditos`, `/exito`, `/error` | **1** | Mismo criterio que `PLANES`. |
| `MIS_ANUNCIOS` (ya existe) | 5 rutas bajo `/mis-anuncios` | 1 (ya hecho) | Hoy solo la raíz. No se amplía en este trabajo. |
| `PERFIL` | `/perfil`, y además existen `/perfil/facturacion` y `/perfil/suscripcion` | 1 | **`PERFIL` = solo `/perfil`.** `facturacion` tiene su propio valor; **`/perfil/suscripcion` se queda SIN ubicación** — no está en las 12 del encargo (§7). |

### 2.3 Clasificación de las 12 — verificada una por una

**Hallazgo principal: las catorce son Server Components `async`. No hay ni una página
cliente entre las 12.** La distinción que planteaba el encargo (SSR con `Promise.all`
frente a «protegidas / client-side») no existe en este código: las cinco páginas de cuenta
resuelven sus datos en el servidor con `auth()` + `redirect()` + fetch con token, exactamente
como `/mis-anuncios`. El eje que sí discrimina es otro: **qué forma tiene hoy la resolución
de datos de cada página**.

| Página | Fichero | Forma actual de cargar datos | Inserción del fetch | Dificultad |
|---|---|---|---|---|
| `/blog` | [`(public)/blog/page.tsx:30`](../apps/web/src/app/(public)/blog/page.tsx#L30) | **un `await` suelto** (`getPostList`) con `.catch` | crear `Promise.all([getPostList…, getActiveBanners('BLOG')…])` | 🟢 trivial |
| `/blog/[slug]` | [`blog/[slug]/page.tsx:50-70`](../apps/web/src/app/(public)/blog/[slug]/page.tsx#L50-L70) | `getPost` secuencial (necesario: decide `notFound()`), luego `resolveListingsBlocksData` | meter el banner en `Promise.all` **con** `resolveListingsBlocksData`, después del `getPost` | 🟢 trivial |
| `/planes` | [`planes/page.tsx:64`](../apps/web/src/app/(public)/planes/page.tsx#L64) | **un `await` suelto** (`getCatalog`) | `Promise.all` de 2 | 🟢 trivial |
| `/busqueda` | [`busqueda/page.tsx:142-166`](../apps/web/src/app/(public)/busqueda/page.tsx#L142-L166) | **`Promise.allSettled`** de 2 (`getCategories`, `search`) | 3.er elemento del `allSettled` | 🟡 el molde cambia |
| `/[categoria]` ×4 | [`components/categorias/CategoryListingPage.tsx:276-325`](../apps/web/src/components/categorias/CategoryListingPage.tsx#L276-L325) | `categoriesPromise` lanzado suelto + `try/catch` con fallback Postgres | lanzar el promise **junto a `categoriesPromise`**, fuera del `try` | 🟡 trampa real |
| Ficha `/anuncio/[slug]` | [`anuncio/[slug]/page.tsx:83-86`](../apps/web/src/app/(public)/anuncio/[slug]/page.tsx#L83-L86) | `getListing` secuencial (`notFound()`) + **`Promise.allSettled`** de 2 | 3.er elemento del `allSettled` | 🟡 el molde cambia |
| `/vendedor/[slug]` | [`vendedor/[slug]/page.tsx:65-69`](../apps/web/src/app/(public)/vendedor/[slug]/page.tsx#L65-L69) | `getSellerProfile` secuencial + **`Promise.all` de 3 con `.catch`** | 4.º elemento | 🟢 **molde exacto de la home** |
| `/contacto` | [`contacto/page.tsx:9`](../apps/web/src/app/(public)/contacto/page.tsx#L9) | **ninguna — la función no es `async` y no pide nada** | hay que volverla `async` y darle su primer fetch | 🟡 cambia de forma |
| `/perfil` | [`(account)/perfil/page.tsx:21, 32`](../apps/web/src/app/(account)/perfil/page.tsx#L21-L32) | `getMe` y `getMyExports` **en secuencia**, dos `await` seguidos | meter el banner en paralelo con `getMyExports` (o convertir los dos en `Promise.all`) | 🟡 conviene refactor mínimo |
| `/perfil/facturacion` | [`perfil/facturacion/page.tsx:33-38`](../apps/web/src/app/(account)/perfil/facturacion/page.tsx#L33-L38) | **`Promise.all` de 4 con `.catch`** | 5.º elemento | 🟢 **molde exacto de mis-anuncios** |
| `/notificaciones` | [`notificaciones/page.tsx:23`](../apps/web/src/app/(account)/notificaciones/page.tsx#L23) | **un `await` suelto y SIN `.catch`** (si la API cae, la página revienta) | `Promise.all` de 2; el `.catch` solo en el banner | 🟢 trivial |
| `/mis-alertas` | [`mis-alertas/page.tsx:25`](../apps/web/src/app/(account)/mis-alertas/page.tsx#L25) | idem, un `await` suelto sin `.catch` | `Promise.all` de 2 | 🟢 trivial |
| `/mis-creditos` | [`mis-creditos/page.tsx:44-80`](../apps/web/src/app/(account)/mis-creditos/page.tsx#L44-L80) | **`Promise.all` de 5 con `.catch`** | 6.º elemento | 🟢 **molde exacto de mis-anuncios** |

**Recuento:** 7 trivales, 5 con algún matiz. Ninguna imposible.

**Los cuatro matices, en detalle:**

1. **`Promise.allSettled` en `/busqueda` y en la ficha.** Ahí el molde
   `getActiveBanners('X').catch(() => [])` **no vale tal cual**: `allSettled` nunca rechaza,
   y el resultado hay que leerlo con `.status === 'fulfilled' ? .value : []`. Se puede meter
   el `.catch(() => [])` igualmente (queda siempre `fulfilled`) y leer `.value` sin
   comprobar; es lo más corto y lo más difícil de leer mal. Elección de implementación —
   lo que el diseño exige es **no copiar el molde de la home sin mirar**.

2. **El `try/catch` de `/[categoria]` es una trampa.** El cuerpo del componente envuelve la
   llamada a `search()` en un `try` cuyo `catch` degrada a Postgres
   ([`CategoryListingPage.tsx:283-323`](../apps/web/src/components/categorias/CategoryListingPage.tsx#L283-L323)).
   Si el `await getActiveBanners(...)` se mete dentro de ese `try`, **un fallo del endpoint
   de banners dispararía el fallback de Meilisearch**: la categoría se pintaría sin facetas
   y con el aviso ámbar «Los filtros avanzados no están disponibles», por un banner. El
   patrón correcto ya está escrito tres líneas antes y hasta comentado: `categoriesPromise`
   se lanza **fuera** del `try` y se espera después (líneas 276 y 325). El banner va por ahí.

3. **`/contacto` es la única que no pide nada.** Hoy es una función síncrona de 11 líneas.
   Añadirle un banner la convierte en `async` con un `await`. Es un cambio pequeño pero
   **cambia la naturaleza de la página** (pasa a depender del backend para renderizar), y
   con `.catch(() => [])` esa dependencia es inocua: si la API no responde, el formulario
   sale igual. Es la única de las 12 donde la palabra «mecánico» no aplica del todo.

4. **`/perfil` encadena dos `await`.** `getMe` (línea 21) y luego `getMyExports` (línea 32).
   Añadir un tercer `await` en fila serían **tres viajes en serie** para pintar una página
   que la gente abre para cambiarse el nombre. Lo correcto es meter el banner en un
   `Promise.all` con `getMyExports` (los dos dependen solo del token, no de `getMe`). Es un
   refactor de tres líneas y **mejora la página**, no solo la deja igual.

### 2.4 La caché y el ISR — verificado, y por qué NO se cachea el banner

Dos de las páginas nuevas declaran ISR:
`export const revalidate = 3600` en [`blog/page.tsx:9`](../apps/web/src/app/(public)/blog/page.tsx#L9)
y en [`blog/[slug]/page.tsx:12`](../apps/web/src/app/(public)/blog/[slug]/page.tsx#L12).
A primera vista eso amenazaría con congelar el banner hasta una hora.

**No ocurre, y está verificado:** el layout raíz hace `await auth()`
([`app/layout.tsx:53-54`](../apps/web/src/app/layout.tsx#L53-L54)), lo que renderiza
**todo el árbol dinámicamente en cada petición**. Es exactamente lo que documenta
[`lib/api/homepage.ts:36-42`](../apps/web/src/lib/api/homepage.ts#L36-L42): *«la portada se
renderiza DINÁMICAMENTE en cada petición —el layout raíz hace `await auth()`»*. Y `apiFetch`
no pasa ninguna opción de caché ([`lib/api/client.ts:208`](../apps/web/src/lib/api/client.ts#L208)),
así que la llamada corre por petición. **El banner de `/blog` estará tan fresco como el de
la home.**

**Y por eso mismo NO debe envolverse `getActiveBanners` en `unstable_cache`.** La tentación
existe —el nav lo hace con nueve entradas y un tag
([`lib/api/nav.ts:66-71`](../apps/web/src/lib/api/nav.ts#L66-L71))— pero el nav y el banner
no son la misma clase de dato:

| | Nav | Banner |
|---|---|---|
| Cambia cuando… | un admin lo edita → `revalidateTag('main-nav')` | un admin lo edita **o llega su `startsAt`** |
| ¿Hay evento que invalidar? | Sí, el guardado | **No para la ventana temporal**: nadie dispara nada cuando el reloj entra en `[startsAt, endsAt]` |

Cachear el banner con TTL de una hora significaría que **un banner programado para las
09:00 podría no aparecer hasta las 10:00**, y uno con `endsAt` a las 18:00 podría seguir
visible después. La ventana temporal es la característica del modelo (`startsAt`/`endsAt`
son obligatorios, schema:2597-2598); una caché sin invalidación por tiempo la desactiva.
**Decisión: fetch por petición, sin `unstable_cache`, en las 14.** El coste es un `findMany`
indexado por página; el mismo que ya se paga hoy en la ruta más visitada del sitio.

> **Barrera implícita para el futuro:** si alguna vez se hace estático el árbol `(public)`
> (quitando el `await auth()` del layout raíz), esta decisión hay que revisarla entera.
> Queda escrito aquí para que quien lo intente lo encuentre.

### 2.5 La alternativa considerada: un `<PageBanners>` en layouts anidados

Existe un precedente directo y reciente para «la misma pieza en N tipos de página»: el nav
dinámico resolvió exactamente esto con **nueve layouts anidados de cinco líneas**, cada uno
declarando su tipo como literal
([`diseno-nav-dinamico.md` §4.2](diseno-nav-dinamico.md); [`(public)/blog/layout.tsx`](../apps/web/src/app/(public)/blog/layout.tsx)):

```tsx
export default function Layout({ children }) {
  return (<><MainNav pageType="BLOG" />{children}</>);
}
```

Aplicado a banners sería un `<PageBanners placement="BLOG" />`: Server Component `async` que
se hace su propio fetch y pinta `BannerList`. **Ventajas reales**: una línea por rama en vez
de tocar el `Promise.all` de cada página, y una ruta nueva bajo `/blog` heredaría el banner
sin que nadie se acuerde — que es literalmente el argumento con el que se eligió para el nav
(*«un olvido en una página nueva sería silencioso»*).

**Se descarta, y por un motivo que no es de gusto: la POSICIÓN.**

Un layout solo puede poner el banner **encima de todo el contenido de la página**. Pero la
decisión ya tomada en este proyecto —UXV.6 (B6), con su comentario en el código— es que el
banner va **debajo de la cabecera de la página**, después de que la página diga qué es. Un
layout no puede expresar eso: no sabe dónde acaba el `<h1>` de su hijo. Montarlo en layouts
obligaría a elegir entre (a) volver a poner publicidad como primera línea de cada pantalla,
revirtiendo B6 en doce sitios a la vez, o (b) mover el `<h1>` de las doce páginas al layout,
que es un refactor mucho mayor que el encargo.

Además, un componente `async` montado en el layout **espera en línea** dentro del árbol de
render, en vez de solaparse con los fetch de la página; el `Promise.all` existe justamente
para eso.

**Decisión: fetch en la página, molde `Promise.all`, posición decidida por la página.**
La vía de los layouts se deja documentada aquí por si algún día se quiere cubrir subárboles
enteros (`/planes/exito`, `/mis-creditos/exito`…), que es donde sí rendiría.

---

## 3. La posición visual

### 3.1 El patrón por defecto

> **Regla: el banner va DEBAJO de la cabecera de la página (el `<h1>` y sus acciones o su
> miga) y ENCIMA del contenido principal. A ancho completo del contenedor de la página.**

Es el molde de `/mis-anuncios`, no el de la portada. La portada se queda como la excepción
declarada: su contenido *es* el hero, y ahí el aviso lo precede a propósito. La regla se
escribe en positivo para que no haya que decidirlo doce veces: **un usuario nunca aterriza
en una pantalla cuya primera línea es publicidad**, salvo en la portada.

### 3.2 El punto exacto en cada página

Verificado contra el JSX de cada una. Lo que está marcado con ⚠ tiene una trampa de
maquetación concreta.

| Página | Va justo… | Detalle de maquetación |
|---|---|---|
| `/busqueda` | tras la miga (línea 262-266), **antes** del `<div className="flex … lg:flex-row">` de la línea 268 | ⚠ **A ancho completo, FUERA de la fila de dos columnas.** Metido dentro de `<main>` quedaría en la columna estrecha, a la derecha del sidebar de filtros. |
| `/[categoria]` | tras la miga (441-453) y la cabecera (455-476), junto al aviso ámbar de fallback (479-484), **antes** del `flex lg:flex-row` de la 486 | ⚠ Misma trampa. Y queda **pegado al aviso de fallback de Meilisearch**, que es visualmente idéntico (`border-amber-200 bg-amber-50`) a un banner `WARNING`: si coinciden, se leen como dos avisos del sistema. Es aceptable —los dos *son* avisos— pero conviene verlo antes de dar el visto bueno. |
| `/blog` | tras el `<header>` (línea 50), antes del filtro de etiqueta y la rejilla | Sin trampa. |
| `/blog/[slug]` | dentro del `<article className="mx-auto max-w-3xl">`, antes de los tags | ⚠ **Decisión: alineado con la columna de lectura (`max-w-3xl`), no a ancho de contenedor.** A ancho completo rompería la medida tipográfica del artículo. |
| `/planes` | tras el bloque centrado de título (línea 83), antes de la rejilla de planes | Sin trampa. |
| `/vendedor/[slug]` | tras la cabecera del vendedor (83-127), antes de «Anuncios activos» | Sin trampa. Ojo con no colarlo entre el `ValorarDesdePerfil` condicional y su contexto. |
| Ficha `/anuncio/[slug]` | tras la miga (150-162), antes del `grid md:grid-cols-[1fr_320px]` de la 164 | ⚠ A ancho completo, fuera del grid. **Empuja la galería hacia abajo** — ver §4.3. |
| `/contacto` | tras el `<p>` introductorio (13-15), antes de `<ContactForm />` | El contenedor es `max-w-lg`: el banner queda estrecho, que es lo correcto ahí. |
| `/perfil` | primer hijo del `<div className="space-y-8">`, antes de la cabecera con avatar | ⚠ **Excepción a la regla:** esta página no tiene `<h1>` de sección, tiene una **cabecera de identidad** (avatar + nombre + email). Poner el banner debajo lo metería entre la identidad y el aviso de email sin verificar, que es un aviso de verdad. Va **el primero**, y aquí sí precede al contenido — como en la portada, y por la misma razón: no hay cabecera textual que respetar. |
| `/perfil/facturacion` | tras el bloque `<h1>` + párrafo (42-48), antes de `FacturacionForm` | Sin trampa. |
| `/notificaciones` | tras el `<h1>` (línea 27), antes de la lista o el vacío | ⚠ Colisión visual — ver §4.3. |
| `/mis-alertas` | tras el `<h1>` (29), antes de la lista o el vacío | Sin trampa. |
| `/mis-creditos` | tras el bloque `<h1>` + párrafo (92-98), **antes** de `RedeemCouponForm` | Sin trampa, y es la mejor ubicación del lote (§4.2). |

### 3.3 El detalle de los márgenes — pequeño pero se repite 12 veces

`BannerList` no lleva márgenes propios (verificado: su raíz es `<div className="space-y-3">`,
línea 99). Cada punto de llamada los pone. Pero **cinco de las doce páginas nuevas ya viven
dentro de un `space-y-*`**:

| Página | Contenedor | ¿Necesita wrapper con margen? |
|---|---|---|
| `/perfil` | `space-y-8` | **No** — hijo directo, el espaciado ya está |
| `/perfil/facturacion` | `space-y-8` | **No** |
| `/notificaciones` | `space-y-6` | **No** |
| `/mis-alertas` | `space-y-6` | **No** |
| `/mis-creditos` | `space-y-10` | **No** |
| las 7 públicas | contenedores sueltos | **Sí**, `mb-6` como en mis-anuncios |

Meter el `<div className="mb-6">` en las cinco de cuenta produciría un hueco doble.
**Recomendación:** en las de cuenta, `<BannerList banners={banners} />` como hijo directo,
sin envoltorio; en las públicas, el envoltorio `mb-6`. Y como el guard `banners.length > 0`
se repite 14 veces, vale la pena un componente de dos líneas —`<BannerSlot banners={…}
className?>`— que encapsule guard + margen. **Opcional**; si no se hace, la regla de arriba
basta.

---

## 4. La decisión de producto — ¿las 12 tienen sentido?

**Esto no es un rechazo de ninguna ubicación. Es señalar dónde el banner compite con el
propósito de la página, para que la decisión sea informada.** Decide Ernest.

### 4.1 El dato que cambia el marco de la decisión

Antes de mirar página por página, dos hechos verificados que abaratan mucho «poner el
banner en todas partes»:

1. **El descarte es global por id** (§1.3). Un usuario que cierra el aviso una vez no lo
   vuelve a ver **en ninguna** de las 14 ubicaciones. Ampliar ubicaciones no multiplica la
   molestia: multiplica la **probabilidad de que el aviso se lea una vez**, que es lo que se
   busca.
2. **Un banner solo existe si un admin lo crea, con ventana temporal y con ubicaciones
   marcadas a mano.** Añadir `NOTIFICACIONES` al enum **no pone nada en `/notificaciones`**:
   habilita que un admin pueda hacerlo el día que tenga algo que decir ahí. El coste de
   añadir una ubicación de más es cero hasta que alguien la usa; el coste de que falte es
   una ráfaga entera.

**Consecuencia:** el sesgo razonable es **añadir las 12**, y tratar el «¿molesta?» como una
cuestión **editorial** (qué se publica dónde), no de modelo de datos. Las tres páginas de
foco de abajo no son candidatas a excluirse: son candidatas a una nota de uso.

### 4.2 Dónde el banner claramente ayuda

| Ubicación | Por qué es buena |
|---|---|
| `MIS_CREDITOS` | Es donde se compra. Un `PROMO` de un cupón o un pack con descuento está **en el sitio exacto** donde se ejecuta. La mejor del lote. |
| `PERFIL_FACTURACION` | Página de dinero, visitas deliberadas. Un aviso de «los datos fiscales son obligatorios desde X» aterriza donde se actúa. |
| `PLANES` | Página comercial por definición. Un banner de campaña ahí no compite con nada: refuerza. |
| `BUSQUEDA`, `CATEGORIA` | Las dos superficies de mayor tráfico después de la home. Un aviso de mantenimiento o una promo alcanzan a casi todo el tráfico real. |
| `BLOG` | Superficie de captación SEO: mucho visitante nuevo, poca fricción — un `PROMO` de registro encaja. |
| `MIS_ALERTAS` | Página tranquila, de gestión, sin foco crítico. Cabe sin estorbar. |
| `VENDEDOR` | Perfil público; el banner ni compite con el contenido ni interrumpe una acción. |
| `PERFIL` | Igual: pantalla de ajustes, sin tarea urgente. |

### 4.3 Las tres de foco — con las opciones sobre la mesa

**A) Ficha de anuncio (`ANUNCIO`) — la más delicada de las tres.**

Es a la vez **la superficie SEO más importante del sitio** y **la página de conversión** (el
botón «Contactar»). Un banner sobre la miga empuja hacia abajo la galería y el precio, que
es lo que la persona ha venido a ver. Y ya compite con dos sistemas publicitarios propios:
`SponsoredAd` (anuncios patrocinados, H6.6) y los destacados.

| Opción | Qué implica |
|---|---|
| **A1. Incluir, arriba (patrón por defecto)** | Coherente con las otras once. Máximo alcance. Coste: en la página que más tráfico recibe, lo primero bajo la miga puede ser un aviso. |
| **A2. Incluir, pero al final** (tras «Más anuncios en…») | No estorba nada. También: casi nadie lo ve, y **un `WARNING` de mantenimiento al pie es inútil**. |
| **A3. No añadir `ANUNCIO`** | Cero riesgo. Coste: el día que haya un aviso de servicio de verdad, la página más visitada del sitio es la única que no lo enseña. |

**Recomendación: A1**, con una nota editorial (no de código): en la ficha se publica
`WARNING` de servicio, no `PROMO`. Filtrar por variante en el frontend **no es una opción**:
sería lógica de negocio en Next, contra la regla del proyecto. Si algún día se quiere
imponer por sistema, la regla vive en Nest, no aquí. **Decide Ernest.**

**B) `/notificaciones` — la colisión visual.**

Riesgo concreto y verificable: `BannerList` pinta **tarjetas con borde y fondo de color**, y
la bandeja de notificaciones pinta **una lista de tarjetas**. Un banner encima de la bandeja
puede leerse como *«una notificación mía»*, no como *«un aviso de la plataforma»* — y ese
sería el único sitio de las 14 donde el banner se puede confundir con el contenido de la
página, no simplemente estorbarlo.

| Opción | Qué implica |
|---|---|
| **B1. Incluir, arriba** | Alcanza a quien entra a mirar sus avisos, que es un público atento. Riesgo de confusión. |
| **B2. Incluir con separación visual explícita** (un `Separator` debajo, o dentro de la sección del `<h1>`) | Mitiga la confusión con una línea. Es lo más barato. |
| **B3. No añadir `NOTIFICACIONES`** | La bandeja se queda limpia. Coste: se pierde la ubicación más natural para «hemos cambiado cómo funcionan las notificaciones». |

**Recomendación: B2.** **Decide Ernest.**

**C) `/contacto` — parece de foco, pero es la que más lo pide.**

Toda la página es un formulario de `max-w-lg`; un banner encima es lo primero que se lee.
Pero **es justo el sitio donde un aviso ahorra el mensaje**: «el soporte responde con
retraso esta semana», «para reportar un anuncio usa el botón de la ficha, es más rápido».
Un aviso ahí **desvía trabajo** en vez de estorbarlo.

**Recomendación: incluir, arriba, sin reservas.**

### 4.4 Resumen de la decisión pedida

| Ubicación | Recomendación del diseño | Decide |
|---|---|---|
| `BLOG`, `PLANES`, `BUSQUEDA`, `CATEGORIA`, `VENDEDOR`, `CONTACTO`, `PERFIL`, `PERFIL_FACTURACION`, `MIS_ALERTAS`, `MIS_CREDITOS` | **Añadir, patrón por defecto.** Sin objeciones. | — |
| `ANUNCIO` | Añadir arriba (A1) + nota editorial de solo-avisos | Ernest |
| `NOTIFICACIONES` | Añadir arriba con separador (B2) | Ernest |

---

## 5. El admin — el selector con 14 valores

### 5.1 Qué se rompe exactamente

**El formulario.** [`BannerFormDialog.tsx:193`](../apps/web/src/app/(admin)/admin/banners/_components/BannerFormDialog.tsx#L193):

```tsx
<div className="mt-1 flex gap-4">   {/* ← sin flex-wrap */}
```

Dos casillas caben. **Catorce, no**: sin `flex-wrap`, se comprimen o desbordan el ancho del
`DialogContent`. Esto sí se rompe de verdad, no es una opinión de diseño.

El precedente de cómo se resolvió el mismo problema está en el admin del nav, que ya pinta
**nueve** casillas ([`admin/nav/page.tsx:260`](../apps/web/src/app/(admin)/admin/nav/page.tsx#L260)):

```tsx
<div className="flex flex-wrap gap-x-4 gap-y-1" data-testid="node-visible-on">
```

Con `flex-wrap`, nueve etiquetas caben razonablemente. **Con catorce y etiquetas largas
(«Datos de facturación», «Perfil de vendedor», «Ficha de anuncio») un `flex-wrap` plano
produce un amasijo**: filas irregulares donde localizar «Notificaciones» es un ejercicio de
lectura.

**El listado.** [`admin/banners/page.tsx:194`](../apps/web/src/app/(admin)/admin/banners/page.tsx#L194):

```tsx
{banner.placements.map((p) => PLACEMENT_LABELS[p] ?? p).join(', ')}
```

Un banner en las 14 renderiza una celda de ~180 caracteres que revienta el ancho de la
tabla. Hoy el máximo son 22 caracteres.

### 5.2 Lo que propone el diseño

**Formulario: dos grupos etiquetados, en rejilla de dos columnas.**

```
Ubicaciones
┌─ Páginas públicas ───────────────────────────┐
│ ☐ Portada              ☐ Perfil de vendedor  │
│ ☐ Búsqueda             ☐ Planes              │
│ ☐ Categoría            ☐ Contacto            │
│ ☐ Ficha de anuncio     ☐ Blog                │
└──────────────────────────────────────────────┘
┌─ Zona de cuenta ─────────────────────────────┐
│ ☐ Mis anuncios         ☐ Notificaciones      │
│ ☐ Mi perfil            ☐ Mis alertas         │
│ ☐ Datos de facturación ☐ Mi saldo            │
└──────────────────────────────────────────────┘
```

La agrupación no es cosmética: **es la pregunta que el admin se hace**. «¿Este aviso es para
visitantes o para usuarios con cuenta?» decide la mitad de los casos de un plumazo, y hoy no
hay nada en la UI que sugiera esa división. Implementación: `sm:grid-cols-2` dentro de cada
grupo, con un `<p className="text-xs text-muted-foreground">` de encabezado por grupo — el
mismo vocabulario visual que ya usa el `NodeForm` del nav.

**Un «marcar todo el grupo» por grupo:** opcional, pero con 8 casillas en el bloque público
un banner de mantenimiento («estamos en obras») las quiere todas. Dos enlaces de texto,
`Todas` / `Ninguna`. **No se propone un valor `TODAS` en el enum**: `NavPageType` resolvió
lo equivalente con «vacío = todas», pero aquí `@ArrayNotEmpty()` prohíbe el vacío
(create-banner.dto.ts:38) y esa divergencia ya está documentada como consciente
([`diseno-nav-dinamico.md` §9, decisión 3](diseno-nav-dinamico.md)). No se toca.

**Listado: resumir en vez de enumerar.** Regla propuesta:

- `placements.length === 14` → «Todas»
- `placements.length >= 4` → «N ubicaciones» con las tres primeras en `title=`
- si no → la lista actual separada por comas

**Filtro por ubicación en el listado — hueco detectado.** El API ya soporta
`GET /admin/banners?placement=…` ([`list-banners.dto.ts:6-8`](../apps/api/src/modules/banners/dto/list-banners.dto.ts#L6-L8))
y el cliente ya lo pasa ([`admin-banners.ts:61-64`](../apps/web/src/lib/api/admin-banners.ts#L61-L64)),
pero **la UI solo ofrece el filtro `active`** (page.tsx:133-152): el filtro por ubicación
nunca se pintó. Con 2 ubicaciones no hacía falta; con 14, «enséñame qué hay publicado en la
ficha de anuncio» es la pregunta natural. **Añadir un `<select>` de 15 opciones (Todas + 14)
junto a los tres botones de estado. Coste: ~10 líneas, cero backend.** Se propone como parte
del trabajo, no como extra.

### 5.3 Que el compilador vigile los tres sitios

Hoy `PLACEMENT_LABELS` está tipado como `Record<string, string>`
([`admin/banners/page.tsx:26`](../apps/web/src/app/(admin)/admin/banners/page.tsx#L26)) y
tiene un fallback `?? p`. Traducido: **si alguien añade un valor al enum y olvida la
etiqueta, no falla nada — el admin lee `PERFIL_FACTURACION` en crudo y nadie se entera.**
Con 2 valores era inofensivo; con 14 y creciendo, es una fuga silenciosa garantizada.

**Propuesta:** una única fuente en `lib/api/banners.ts`, tipada de forma exhaustiva:

```ts
export type BannerPlacement = 'HOME' | 'BUSQUEDA' | … ;   // los 14

/** Etiqueta de cara al admin. Record<BannerPlacement, …>: si se añade un valor
 *  al enum y se olvida su etiqueta, ESTO NO COMPILA. */
export const PLACEMENT_LABELS: Record<BannerPlacement, string> = { … };

/** Los dos grupos del selector — mismo orden que se pinta. */
export const PLACEMENT_GROUPS: { label: string; values: BannerPlacement[] }[] = [ … ];
```

El formulario y el listado consumen esa fuente; el `?? p` desaparece. Con eso, **los tres
sitios hardcodeados pasan a ser uno**, y el olvido se convierte en un error de `typecheck`
en vez de en un texto feo en producción. Es la mitad del valor de esta ráfaga.

> Nota: los `data-testid` del formulario son `banner-placement-${value}` (línea 198), y el
> e2e ya mapea contra ellos ([`e2e/h8-d4-banners.spec.ts:35-38`](../apps/web/e2e/h8-d4-banners.spec.ts)).
> Ese patrón se conserva: los testids nuevos salen solos del `map`.

---

## 6. El plan de ráfagas

El trabajo es **ancho pero poco profundo**. Se parte por **dónde está la sustancia**, no por
número de ficheros: toda la decisión está en la ráfaga 1; la 2 es calco.

### Ráfaga 1 — el enum, el admin y las ocho páginas públicas

**Backend (media hora):**
1. `schema.prisma`: los 12 valores nuevos + el comentario de convención.
2. `npx prisma migrate dev` → migración `ALTER TYPE … ADD VALUE` ×12.
3. Nada más. Los DTO, el controller y Swagger se enteran solos (§1.2).

**Admin (el grueso de la ráfaga):**
4. `lib/api/banners.ts`: unión de 14 + `PLACEMENT_LABELS` exhaustivo + `PLACEMENT_GROUPS` (§5.3).
5. `BannerFormDialog`: selector agrupado en dos bloques con rejilla (§5.2).
6. `admin/banners/page.tsx`: consumir las etiquetas centralizadas, resumir la celda, añadir
   el filtro por ubicación.

**Páginas públicas (8 ficheros, diffs de 3-6 líneas):**
7. `/blog`, `/blog/[slug]`, `/planes` — trivial.
8. `/vendedor/[slug]` — molde exacto de la home.
9. `/busqueda`, `/anuncio/[slug]` — ojo `allSettled`.
10. `CategoryListingPage.tsx` — ojo el `try/catch` (§2.3, punto 2). **Cubre 4 rutas.**
11. `/contacto` — pasa a `async`.

**Barreras de la ráfaga 1:** §6.1, filas 1-4.

### Ráfaga 2 — las cinco páginas de cuenta

12. `/perfil/facturacion`, `/mis-creditos` — añadir un elemento al `Promise.all` existente.
13. `/notificaciones`, `/mis-alertas` — crear el `Promise.all`.
14. `/perfil` — paralelizar con `getMyExports` (§2.3, punto 4).
15. Los cinco sin envoltorio de margen: son hijos de `space-y-*` (§3.3).

**Barreras:** §6.1, fila 5.

**Por qué este corte y no «SSR fáciles / protegidas»:** porque la división del encargo
presuponía dos naturalezas técnicas distintas, y **no las hay** (§2.3). Lo que sí separa
limpiamente es *pública / cuenta*: son las dos zonas del selector del admin, las dos mitades
de la decisión de producto, y dos shells de layout distintos. Además la ráfaga 1 entrega
algo **utilizable por sí sola** (un admin ya puede publicar un aviso en toda la web pública);
la 2 completa la zona privada.

**Alternativa si se quiere aún más corto:** partir la 1 en `1a` (enum + admin, sin ninguna
página) y `1b` (las ocho públicas). `1a` es verificable sola: el admin puede marcar 14
ubicaciones y guardarlas aunque ninguna página las pinte todavía. Se recomienda solo si la
ráfaga 1 se ve larga al empezarla.

### 6.1 Las barreras

| # | Barrera | Cómo se comprueba | Dónde |
|---|---|---|---|
| 1 | `getActiveBanners` filtra bien por los 12 valores nuevos | Extender el caso *«devuelve solo banners active + vigentes ahora + con el placement pedido»* con un valor nuevo; y `placement` inválido sigue dando 400 | [`h8-d4-banners.e2e-spec.ts:379, 456`](../apps/api/test/h8-d4-banners.e2e-spec.ts) |
| 2 | Un banner con muchos placements aparece en todos | Extender *«banner con ambos placements aparece en HOME y en MIS_ANUNCIOS»* a tres o cuatro | ídem, línea 437 |
| 3 | El admin ofrece las 14 y las guarda | Extender el helper `placementTestId` del e2e de Playwright; crear un banner con una ubicación de cada grupo | [`e2e/h8-d4-banners.spec.ts:35-40`](../apps/web/e2e/h8-d4-banners.spec.ts) |
| 4 | **Cada página pinta su banner** | `[data-testid="banner"]` visible con un banner de su placement, **y ausente** con uno de otro. **NO 12 tests**: uno por *forma* — una pública simple (`/planes`), una de dos columnas (`/busqueda`), la ficha, y `/contacto` (la que cambió de forma) | Playwright, nuevo |
| 5 | Las de cuenta, igual | Un test sobre `/mis-creditos` (`Promise.all` existente) y otro sobre `/notificaciones` (`Promise.all` nuevo) | Playwright, nuevo |
| 6 | **El olvido no compila** | Quitar una entrada de `PLACEMENT_LABELS` debe romper `pnpm typecheck` | `pnpm --filter web typecheck` |
| 7 | La regresión de posición | Los dos banners existentes siguen donde estaban: home encima del hero, mis-anuncios debajo del `<h1>` | El e2e actual ya lo cubre (líneas 102-131) |

**Lo que explícitamente NO se pide como barrera:** un test por cada una de las 12 páginas.
Doce tests de Playwright que comprueban lo mismo cuestan más en tiempo de CI y en
mantenimiento de lo que aportan; la barrera 4 cubre las cuatro *formas* distintas, que es
donde puede fallar algo.

---

## 7. Cabos sueltos y fuera de alcance

Se dejan escritos para que la decisión de no hacerlos sea consciente.

| Cabo | Estado |
|---|---|
| **`/perfil/suscripcion`** | Página real ([`(account)/perfil/suscripcion/page.tsx`](../apps/web/src/app/(account)/perfil/suscripcion/page.tsx)) que **no está en las 12** del encargo. Es la pantalla de gestión de la suscripción Pro — ubicación con sentido comercial evidente. Añadirla después es un valor más de enum, sin backfill. **No se incluye**, pero merece la pregunta. |
| **`/favoritos`, `/mensajes`, `/mis-tickets`, `/publicar`** | Cuatro páginas más de la zona de cuenta, tampoco en el encargo. `/publicar` es un wizard (página de foco fuerte), `/mensajes` una bandeja. Fuera de alcance. |
| **`/paginas/[slug]`** (CMS) | Existe y tiene su `NavPageType.PAGINA_CMS`. No está en las 12. Fuera de alcance. |
| **Subrutas de retorno de pago** (`/planes/exito`, `/mis-creditos/exito`…) | Excluidas a propósito (§2.2). Si algún día se quieren, la vía es el layout (§2.5). |
| **`/mis-anuncios/estadisticas`, `/mis-anuncios/[id]/editar`** | Cuelgan de `MIS_ANUNCIOS` pero hoy no pintan banner. No se cambia. |
| **El flash de hidratación** | Documentado en `BannerList` (líneas 64-70) y aceptado en su día. Pasa de 2 a 14 superficies. No se arregla aquí; se nombra (§1.3). |
| **`unstable_cache` para banners** | Descartado con motivo (§2.4). Si alguien lo propone en una revisión futura, la respuesta está escrita. |
| **Filtrar por variante en páginas de foco** | Descartado: sería lógica de negocio en Next. Si se quiere, vive en Nest (§4.3). |

---

## 8. Registro de decisiones

### Cerradas por el encargo

Array escalar · `getActiveBanners` intacto · `BannerList` sin cambios · migración aditiva ·
12 ubicaciones nuevas · documento sin código.

### Tomadas en este diseño

| # | Decisión | § |
|---|---|---|
| 1 | **`ANUNCIO` y `VENDEDOR`**, no `FICHA_ANUNCIO`/`PERFIL_VENDEDOR` — alineados con `NavPageType`; la claridad la da la etiqueta | 2.1 |
| 2 | **`CATEGORIA` cubre los 4 niveles y `BLOG` el índice + la ficha** — se empieza grueso; separar después es aditivo | 2.1-2.2 |
| 3 | **Las subrutas de retorno de pago quedan fuera** de `PLANES` y `MIS_CREDITOS` | 2.2 |
| 4 | **Fetch en la página con `Promise.all`, no `<PageBanners>` en layouts** — el motivo es la posición (UXV.6 B6), no el gusto | 2.5 |
| 5 | **Sin `unstable_cache`**: la ventana temporal del banner no tiene evento de invalidación | 2.4 |
| 6 | **Posición por defecto = debajo de la cabecera** (molde mis-anuncios), con la portada y `/perfil` como excepciones declaradas | 3.1, 3.2 |
| 7 | **Sin envoltorio de margen en las cinco páginas de cuenta** (ya viven en `space-y-*`) | 3.3 |
| 8 | **Selector del admin agrupado en público / cuenta**, no un `flex-wrap` de 14 | 5.2 |
| 9 | **Una sola fuente tipada `Record<BannerPlacement, …>`**: el olvido de una etiqueta pasa a no compilar | 5.3 |
| 10 | **Se añade el filtro por ubicación al listado del admin** — el API ya lo soportaba y la UI nunca lo pintó | 5.2 |
| 11 | **Corte de ráfagas por zona (pública / cuenta)**, no por «SSR fácil / protegida»: esa distinción no existe en este código | 6 |
| 12 | **Barreras por *forma* de página, no por página** — 4 tests, no 12 | 6.1 |

### Abiertas — decide Ernest

| # | Pregunta | Recomendación del diseño | § |
|---|---|---|---|
| A | ¿Banner en la **ficha de anuncio**? | Sí, arriba, con disciplina editorial de solo-avisos | 4.3 |
| B | ¿Banner en **`/notificaciones`**, con riesgo de leerse como una notificación? | Sí, arriba, con separador visual | 4.3 |
| C | ¿Se añade también **`/perfil/suscripcion`** (13.ª ubicación)? | No decidido — tiene sentido comercial | 7 |
