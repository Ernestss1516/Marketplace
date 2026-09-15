# AUDITORÍA — QUÉ SIEMBRA `pnpm prisma db seed`

**Fecha:** 15 de septiembre de 2026
**Alcance:** diagnóstico. Cero cambios de código. Todo verificado contra el repo.
**Pregunta que responde:** qué corre `db seed`, qué crea, qué falta para arrancar una
instancia nueva, y —lo que decide el despliegue— si hay datos de prueba que acabarían en
producción.

---

## 0. EL RESUMEN, PRIMERO

**`db seed` NO mete datos de prueba en producción.** Ese era el miedo de esta auditoría y
no se confirma: los anuncios falsos, los usuarios `@example.com`, los tags de ejemplo y los
posts del escaparate viven en `seed-test.ts` y `seed-playwright.ts`, **y a ninguno de los
dos los llama `db seed`** — los invocan los `globalSetup` de las dos baterías, por su
ruta, a mano.

Lo que sí hay son **tres hallazgos de otro tipo**:

| # | Hallazgo | Gravedad |
|---|---|---|
| 1 | **El seed crea un administrador con contraseña fija publicada en Git** (`admin@marketplace.es` / `Admin1234!`, [seed.ts:441](apps/api/prisma/seed.ts#L441)). En producción la instancia nace con una credencial de administrador que cualquiera que vea el repo conoce. | **Crítica** |
| 2 | **Faltan tres conjuntos de datos que ninguna semilla crea** en una base recién migrada: `ContactReason` (sin ella el formulario público de contacto se apaga solo), `FooterColumn`/`FooterItem` y `NavItem`. Los backfills que los crearían **no funcionan en una base nueva**: leen columnas que sus propias migraciones ya borraron. | **Alta** |
| 3 | **Las categorías son lo único del seed que PISA trabajo de un administrador.** `upsert` con `update` completo: nombre, orden, `attributeSchema` y `parentId` vuelven al valor de la semilla en cada `db seed`. Todo lo demás del fichero está protegido; esto no. | **Media** |

Y una conclusión de diseño: **no hace falta separar «seed de dev» y «seed de prod»**. Ya
están separados —el de test vive en otros ficheros que `db seed` no toca—. Lo que le falta
al de producción no es un filtro, es completitud, y quitarle la credencial.

---

## 1. QUÉ EJECUTA `pnpm prisma db seed`

El punto de entrada, en [apps/api/package.json:5-7](apps/api/package.json#L5-L7):

```json
"prisma": { "seed": "ts-node --compiler-options {\"module\":\"CommonJS\"} prisma/seed.ts" }
```

**Un solo fichero: `prisma/seed.ts`.** No hay orquestador, no hay `SEED_ENV`, no hay flag
de entorno: un `grep NODE_ENV` sobre `apps/api/prisma/` no devuelve nada. El mismo comando
hace exactamente lo mismo en tu portátil y en producción.

### Los seis ficheros de `apps/api/prisma/`, y quién ejecuta cada uno

| Fichero | ¿Lo corre `db seed`? | Quién lo ejecuta de verdad |
|---|---|---|
| `seed.ts` | **SÍ** — es el punto de entrada | `prisma db seed` |
| `seed-settings.ts` | **SÍ, como dato** — exporta `SEED_SETTINGS`, no tiene `main()` | importado por `seed.ts:5` |
| `seed-pagina-cookies.ts` | **SÍ, como dato** — exporta los bloques, no tiene `main()` | importado por `seed.ts:8-13` |
| `seed-test.ts` | **NO** | [test/setup-e2e.js:60](apps/api/test/setup-e2e.js#L60) (Jest e2e) y [e2e/global-setup.ts:96](apps/web/e2e/global-setup.ts#L96) (Playwright), por `ts-node` directo |
| `settings-test.ts` | **NO** — exporta `SETTINGS_SEMILLA_TEST` | importado por `seed-test.ts` y por la barrera de aislamiento |
| `seed-playwright.ts` | **NO** | [e2e/global-setup.ts:99](apps/web/e2e/global-setup.ts#L99) y `pnpm seed:playwright` |

Que `seed-settings.ts` y `seed-pagina-cookies.ts` sean ficheros aparte **no significa que
sean semillas distintas**: son listas de datos extraídas para que un test pueda mirarlas sin
ejecutar la semilla entera (el motivo está escrito en la cabecera de cada uno, y en el caso
de `settings-test.ts` es una cicatriz real: la barrera de aislamiento se reparaba a sí misma
el defecto que venía a medir).

`seed.ts` ejecuta ocho funciones, en este orden ([seed.ts:821-831](apps/api/prisma/seed.ts#L821-L831)):

```
seedCategories → seedAdmin → seedSettings → seedHomepageConfig
→ seedPaginaCookies → seedBillingCatalog → seedCreditPacks → seedBumpPacks
```

El orden importa en un sitio: `seedPaginaCookies` necesita que el admin exista (`Post.authorId`
es obligatorio) y por eso va después; si no lo encuentra, avisa y se salta la página
([seed.ts:791-798](apps/api/prisma/seed.ts#L791-L798)).

---

## 2. EL INVENTARIO — QUÉ CREA, Y SI ES ESENCIAL O EJEMPLO

| Qué | Cuánto | Modelo(s) | ¿Esencial? |
|---|---|---|---|
| **Árbol de categorías** | 6 padres + 18 hijas = **24** | `Category` | **ESENCIAL.** Sin categorías no se puede publicar (el wizard no tiene dónde), la rejilla de la portada no se pinta ([page.tsx:57](apps/web/src/app/(public)/(home)/page.tsx#L57), guard `categories.length > 0`) y los `filterableAttributes` de Meilisearch salen vacíos de atributos dinámicos |
| **Usuario administrador** | 1 | `User` | **ESENCIAL** (es la única puerta al backoffice la primera vez) — **y es el hallazgo nº 1**, ver §4 |
| **Ajustes** | **25 claves** | `Setting` | **Mixto.** Ninguna es imprescindible para arrancar: *todas* tienen respaldo en código. Sembrarlas las hace **visibles y conmutables** desde `/admin/ajustes`, que es el problema real que resuelven (ver §3) |
| **Configuración de portada** | 1 fila + **5 bloques** | `HomepageConfig` | **ESENCIAL en la práctica.** Sin la fila, `HomepageService.get()` devuelve `DEFAULT_HOMEPAGE_CONFIG` con `blocks: []` ([homepage.service.ts:44-56](apps/api/src/modules/homepage/homepage.service.ts#L44-L56)): la portada queda con hero + rejilla de categorías y **sin buscador**, porque el buscador ES uno de los bloques |
| **Página de política de cookies** | 1 `Post` PAGE en **DRAFT** | `Post` | **Esencial para cumplimiento, deliberadamente sin publicar.** Le faltan el texto de asesoría y la confirmación de las tablas; ver `docs/cookies-que-falta.md` |
| **Catálogo de facturación** | 2 `Product` + 5 `Price` | `Product`, `Price` | **Catálogo REAL de venta** (Destacado 2,99/4,99/7,99 €; Pro 9,99 €/mes y 89,99 €/año). No es ejemplo: son los precios que se cobrarían |
| **Packs de créditos** | 1 `Product` + 3 `CreditPack` + 3 `Price` | | Ídem — catálogo real (50/150/400 cr) |
| **Packs de bumps** | 1 `Product` + 3 `BumpPack` + 3 `Price` | | Ídem — catálogo real (5/15/40 bumps) |

**Total: 4 `Product` y 11 `Price`.** Ninguno lleva `gatewayPriceId`: el catálogo sembrado
**no existe todavía en Stripe**. Hay que correr `pnpm sync-stripe-catalog` después
(`docs/estado-tecnico.md`, «SINCRONIZACIÓN CATÁLOGO ↔ STRIPE»), y sin ese paso el checkout
del Plan Pro no funciona.

### Lo que el seed NO crea y podría esperarse

- **Provincias**: no existe modelo `Province`. La ubicación es texto libre + geocodificación
  (`pnpm geocode-backfill`). No falta nada.
- **La cuenta de sistema «Equipo»**: no la siembra `seed.ts`. No es un hueco — se resuelve
  perezosamente en `AdminService.asegurarCuentaEquipo()`
  ([admin.service.ts:1851](apps/api/src/modules/admin/admin.service.ts#L1851)) porque `cleanDb`
  la borraría en cada suite. (La cabecera de [system-account.ts:38](apps/api/src/modules/users/system-account.ts#L38)
  dice «para que el seed y la resolución perezosa no puedan divergir», pero el seed no la
  crea: el comentario se quedó viejo, no hay defecto.)
- **Anuncios, usuarios normales, mensajes, reseñas**: ninguno. Correcto.
- **Ninguna migración inserta datos**: `grep "INSERT INTO" apps/api/prisma/migrations/` no
  devuelve nada en las 89 migraciones. Todo lo que hay en una base nueva sale del seed o de
  la aplicación.

---

## 3. LO QUE FALTA PARA ARRANCAR — EL HUECO, MEDIDO

Base recién migrada + `db seed`. Qué queda sin funcionar:

### 3.1 `ContactReason` — el formulario de contacto nace apagado 🔴

Cero filas. El formulario público lo detecta y se sustituye a sí mismo por un aviso:

```tsx
{motivos !== null && motivos.length === 0 ? (
  <p ...>El formulario no está disponible en este momento. Inténtalo más tarde.</p>
) : ( ...el <select> de motivos... )}
```
— [ContactForm.tsx:106-109](apps/web/src/app/(public)/contacto/_components/ContactForm.tsx#L106-L109)

Y no es sólo la pantalla: `motivoId` es obligatorio en el DTO y el servicio rechaza cualquier
id que no exista ([contact.service.ts:89-92](apps/api/src/modules/contact/contact.service.ts#L89-L92)).
Sin filas, **no hay forma de enviar un mensaje de contacto**.

**El backfill no sirve para esto.** `pnpm contact-reason-backfill` lee la columna legacy
`motivo` por `$queryRaw`, y la migración `20260712123500_drop_contact_motivo_enum` ya la ha
borrado en una base nueva → la consulta falla. Está escrito en su propia cabecera: *«MUST run
after the add_contact_reason migration and BEFORE the follow-up migration that drops motivo»*.
Es un script de migración de una vez, no una semilla.

Se arregla a mano desde el backoffice (existe `/admin` para motivos de contacto:
`apps/web/src/lib/api/admin-contact-reasons.ts`), pero **hay que saber que hay que hacerlo**.

### 3.2 `FooterColumn` / `FooterItem` y `NavItem` — pie y barra vacíos 🟠

Mismo patrón. Cero filas tras el seed, y `pnpm footer-backfill` lee `Post."showInFooter"`,
columna que borró `20260711082727_drop_post_footer_fields`.

Consecuencia: el pie sale sin enlaces y **la barra de navegación no se renderiza en
absoluto** — *«Un array raíz vacío significa que la barra no debe renderizarse»*
([lib/api/nav.ts:30](apps/web/src/lib/api/nav.ts#L30)). Degradación limpia, no un error, pero
una instancia nueva arranca sin navegación hasta que alguien entre en `/admin/nav` y
`/admin/footer`.

### 3.3 `fiscalIssuer` — la facturación no puede emitir 🟠

Sin esta clave, `POST /billing/facturas` responde **400 `ISSUER_NOT_CONFIGURED`**
(`InvoicingService.getFrozenIssuer`). No hay defecto en código y no puede haberlo: son los
datos fiscales de la empresa. Es un paso manual obligatorio antes de facturar. Prueba de que
es real: Playwright tuvo que sembrárselo aparte ([seed-playwright.ts:256-299](apps/api/prisma/seed-playwright.ts#L256-L299))
porque la batería moría sin él.

`supportEmail` está en el mismo saco pero degrada suave: sin fila no hay buzón, se registra
un aviso y se salta sólo el correo.

### 3.4 Lo que NO falta (comprobado, para no perseguir fantasmas) ✅

- **Los textos del banner de cookies y `cookiePolicyVersion`**: tienen respaldo en código
  (`COOKIE_TEXT_DEFAULTS`, [consent.constants.ts:98-116](apps/api/src/modules/consent/consent.constants.ts#L98-L116))
  y `ConsentConfigService.get()` no devuelve `null` jamás. El `data-cookie-version` del layout
  raíz ([layout.tsx:145](apps/web/src/app/layout.tsx#L145)) llega siempre con valor, y si la API
  cae, el layout cae a `COOKIE_TEXT_FALLBACK`. **Sin ninguna fila, el banner sale correcto.**
  Esta es la lección de `videoEnabled` ya aplicada.
- **La marca (logos)**: `BrandingService` devuelve las tres zonas a `null` sin filas y cada
  render cae a su fallback. *«NUNCA 404 NI 500 POR FALTA DE DATOS»*.
- **El índice de Meilisearch**: se crea solo en cada arranque —
  `SearchService.onModuleInit()` → `createIndex` + `updateSettings` con `waitForTask`
  ([search.service.ts:475-522](apps/api/src/modules/search/search.service.ts#L475-L522)).
- **Las claves de `SETTING_DEFAULTS`** (`maxTagsPerListing`, los topes totales, los
  interruptores de la puerta, los de moderación…): **no sembradas a propósito**, cada lector
  cae a su constante y el backoffice enseña el mismo número que se aplica
  ([admin.service.ts:459-487](apps/api/src/modules/admin/admin.service.ts#L459-L487)).

---

## 4. TEST vs PRODUCCIÓN — EL FILO

### 4.1 El veredicto: `db seed` no siembra datos de prueba

Recorrido función por función de `seed.ts`: **no hay un solo anuncio falso, usuario de
prueba, tag de ejemplo ni post de relleno.** Lo que crea es catálogo, configuración y árbol de
categorías — todo apto para producción.

**Lo que se queda fuera** (y que sí sería basura en producción), enumerado para que conste:

| Fichero | Qué crearía | ¿Lo corre `db seed`? |
|---|---|---|
| `seed-test.ts` | Categorías de fixture (`Electrónica → Móviles`, `Vehículos → Coches` con esquemas mínimos), **4 tags de ejemplo** (`garantia`, `envio-incluido`, `unico-dueno`, `descatalogado`) + sus asignaciones, ajustes con **`videoEnabled: true`**, portada, packs | **NO** |
| `seed-playwright.ts` | **8 cuentas `@example.com`** (seller, buyer, pro, admin, moderator, editor, role-target, review-target) con contraseña `Test1234!` a coste bcrypt **4**; **3 anuncios** (`listing-rf11-e2e`, `listing-archivado-e2e`, `listing-pro-e2e`); una suscripción Pro + entitlement falsos; un **reporte SPAM**; datos fiscales y una **transacción SUCCEEDED** inventada; un `fiscalIssuer` ficticio (**«Marketplace S.L.», NIF B12345678**); límites subidos a 100/500; **2 posts PUBLISHED** del escaparate | **NO** |
| `seed-blocks-demo.ts` (comando aparte, `pnpm seed-blocks-demo`) | Un `Post` PAGE y un POST **PUBLISHED** con los 9 tipos de bloque rellenos de ejemplo, en `/paginas/blocks-demo` y `/blog/blocks-demo-post` | **NO** — pero es un comando que alguien podría teclear por error en producción. **Es el único seeder de relleno del repo** |

Sobre la pista de la sesión: **el bloque `listings` de la portada sembrada no es dato de
test.** Es un bloque dinámico («Recién publicados», `limit: 8`, `sort: recent`,
[seed.ts:648-655](apps/api/prisma/seed.ts#L648-L655)) que resuelve su contenido contra
Meilisearch **en cada render**. No hay ningún anuncio guardado en la fila. En una base vacía
simplemente no tiene nada que pintar (`resolveHomeListingsData` va con `.catch(() => ({}))`).
Su falta de determinismo es un problema **para las capturas de la batería visual** —por eso el
contenido editorial de Playwright lo evita a propósito— **no para producción**, donde una
portada que enseña lo último publicado es exactamente lo que se quiere.

### 4.2 El riesgo real: la credencial de administrador 🔴

No es dato de test. Es peor.

```ts
const passwordHash = await bcrypt.hash('Admin1234!', BCRYPT_ROUNDS);
await prisma.user.upsert({
  where: { email: 'admin@marketplace.es' },
  update: { role: Role.ADMIN, emailVerified: true },
  create: { email: 'admin@marketplace.es', ..., role: Role.ADMIN, emailVerified: true },
});
```
— [seed.ts:439-455](apps/api/prisma/seed.ts#L439-L455)

Correr `db seed` en el despliegue de producción crea **una cuenta ADMIN, con el correo
verificado, cuyo correo y cuya contraseña están escritos en un fichero del repositorio.**
Los 12 rounds de bcrypt no protegen nada cuando la contraseña es pública: no hay que
romperla, hay que leerla.

Dos matices, uno bueno y uno malo:

- **Bueno:** el `update` del upsert **no toca `passwordHash`**. Si alguien cambia la
  contraseña, un `db seed` posterior no la revierte. El agujero es el de la primera vez —y
  dura hasta que alguien se acuerde de cerrarlo.
- **Malo:** el `update` **sí re-fuerza `role: ADMIN` y `emailVerified: true`**. Si alguien
  degradara esa cuenta a propósito, el siguiente despliegue la vuelve a hacer administradora,
  en silencio.

---

## 5. IDEMPOTENCIA

Producción se re-despliega, así que esto importa. **Buena noticia: nada duplica.** No hay un
solo `create` sin guarda en todo `seed.ts`. Lo que varía es qué hace cada parte cuando ya hay
datos:

| Función | Mecanismo | Re-ejecutar… |
|---|---|---|
| `seedCategories` | `upsert` con **`update` completo** (name, order, attributeSchema, parentId) | **PISA** ⚠ |
| `seedAdmin` | `upsert`, `update: { role, emailVerified }` | No toca la contraseña; **re-fuerza rol y verificación** |
| `seedSettings` | `createMany` + `skipDuplicates` | **Nunca pisa** — sólo inserta claves que faltan |
| `seedHomepageConfig` | crea si no hay; actualiza **sólo si `updatedById === null`** | Nunca pisa una portada que un admin haya guardado |
| `seedPaginaCookies` | si la fila existe, **ni la mira** | Nunca pisa (protege el texto de asesoría) |
| `seedBillingCatalog` | guarda por `product.count() > 0` | No duplica |
| `seedCreditPacks` | guarda por `creditPack.count() > 0` | No duplica |
| `seedBumpPacks` | guarda por `bumpPack.count() > 0` | No duplica |

### 5.1 Las categorías son la excepción, y es una excepción rara

Todo el fichero respeta una doctrina explícita —*«un valor que un administrador ya haya
cambiado NUNCA se pisa»*, escrita en `seedSettings`, en `seedHomepageConfig` y con más énfasis
aún en `seedPaginaCookies`— **salvo las categorías**, que vuelven a los valores de la semilla
en cada `db seed`:

```ts
await prisma.category.upsert({
  where: { slug: cat.slug },
  update: { name: cat.name, order: cat.order, attributeSchema: ... },   // ← pisa
  create: { ... },
});
```
— [seed.ts:407-411](apps/api/prisma/seed.ts#L407-L411), y lo mismo para las hijas incluyendo `parentId`

Y `/admin/categorias` permite renombrar, reordenar, reparentar y editar el `attributeSchema`.
Es decir: **un administrador que renombre «Tecnología» o añada un atributo filtrable a
«Coches» pierde el cambio en el siguiente despliegue que corra el seed**, sin aviso. El
`attributeSchema` es el más caro de perder: arrastra los `filterableAttributes` de
Meilisearch.

(En el seed de test esto es a propósito y está justificado —resetea el fixture entre
corridas—. En el de producción no hay ningún comentario que lo defienda, y contradice al resto
del fichero.)

### 5.2 Un borde menor del catálogo

`seedBillingCatalog` guarda por **el total de `Product`**, no por la existencia de *sus*
productos. Como `seedCreditPacks` y `seedBumpPacks` crean un `Product` cada uno, cualquier
escenario en el que exista un `Product` antes de que corra `seedBillingCatalog` (uno creado
desde el backoffice, o una ejecución anterior que muriera a mitad) hace que el Destacado y el
Plan Pro **se salten en silencio** y no vuelvan nunca. En un arranque limpio el orden lo
evita; no es un defecto activo, es un guard que mira lo que no debe.

---

## 6. RECOMENDACIONES (sin implementar — la decisión es tuya)

Por orden de lo que cuesta si no se hace:

1. **Quitar la credencial fija del seed.** Leer `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`
   del entorno y **negarse a crear el administrador si no están y `NODE_ENV=production`**
   (fallando ruidosamente, no saltándoselo en silencio: una instancia sin admin es igual de
   inservible). En desarrollo, que siga el valor de hoy. Alternativa complementaria: marcar la
   cuenta como «contraseña por cambiar» y forzar el cambio al primer acceso.

2. **Completar el seed con lo mínimo de una instancia viva.** Los **6 motivos de contacto**
   ya están escritos en `contact-reason-backfill.ts:44-51` y sólo hay que moverlos a la
   semilla con `skipDuplicates` — es el hueco más barato de cerrar y el que más se nota
   (formulario de contacto apagado). Para footer y navegación hay que **decidir** si existe un
   conjunto mínimo razonable (Cookies, Contacto, Blog…) o se acepta que los monte el admin;
   lo que no vale es el estado actual, donde el script que los crearía ya no puede correr.
   Convendría además **borrar o marcar como caducados** `footer-backfill` y
   `contact-reason-backfill`: hoy aparecen en `package.json` como si fueran utilidades vivas,
   y no lo son.

3. **Decidir si las categorías deben seguir pisándose.** Lo coherente con el resto del
   fichero es un `update` mínimo (o ninguno) para no revertir ediciones del backoffice. Si se
   quiere conservar la capacidad de «refrescar el árbol canónico», que sea un comando aparte
   y explícito, no un efecto lateral del despliegue.

4. **`fiscalIssuer` como paso de despliegue documentado**, no como sorpresa. No puede
   sembrarse (son datos reales de la empresa), así que su sitio es la lista de arranque.

5. **NO separar dev/prod.** Ya lo están. Lo que sí hace falta es escribir la **secuencia de
   arranque de una instancia nueva** en un solo sitio:

   ```
   prisma migrate deploy
   prisma db seed
   pnpm sync-stripe-catalog          # sin esto el checkout Pro no funciona
   → backoffice: motivos de contacto, footer, navegación, fiscalIssuer, logos
   → cambiar la contraseña del administrador
   pnpm reindex                       # si ya hubiera anuncios
   ```

   Y recordar el aviso que ya dejó `docs/auditoria-despliegue.md:281`: **`db seed` corre por
   `ts-node`**, así que una imagen construida sin `devDependencies` no puede sembrar.

6. **Dejar dicho que `pnpm seed-blocks-demo` no se toca en producción.** Es el único comando
   del repo que crea contenido de relleno **publicado**, y su nombre no lo advierte.

---

## Anexo — dónde mirar

| Cosa | Fichero |
|---|---|
| Punto de entrada | [apps/api/package.json:5-7](apps/api/package.json#L5-L7) |
| La semilla | [apps/api/prisma/seed.ts](apps/api/prisma/seed.ts) |
| Las 25 claves de ajustes | [apps/api/prisma/seed-settings.ts](apps/api/prisma/seed-settings.ts) |
| La página de cookies | [apps/api/prisma/seed-pagina-cookies.ts](apps/api/prisma/seed-pagina-cookies.ts) |
| Semilla de test (Jest + Playwright) | [apps/api/prisma/seed-test.ts](apps/api/prisma/seed-test.ts), [settings-test.ts](apps/api/prisma/settings-test.ts) |
| Semilla de Playwright (usuarios y anuncios falsos) | [apps/api/prisma/seed-playwright.ts](apps/api/prisma/seed-playwright.ts) |
| Quién las invoca | [test/setup-e2e.js:43-65](apps/api/test/setup-e2e.js#L43-L65), [e2e/global-setup.ts:82-99](apps/web/e2e/global-setup.ts#L82-L99) |
| Backfills que ya no corren en base nueva | [contact-reason-backfill.ts](apps/api/src/commands/contact-reason-backfill.ts), [footer-backfill.ts](apps/api/src/commands/footer-backfill.ts) |
