# Auditoría UX — zona de gestión del vendedor

> Auditoría exploratoria (2026-08-08) sobre `main`. **Objetivo:** mapear los flujos REALES
> (leídos del código, no supuestos) de la zona de gestión del vendedor y localizar la
> fricción de usabilidad con criterios explícitos.
>
> **Alcance:** `/mis-anuncios` y derivadas, editar anuncio, bumps/destacados,
> `/mis-creditos` (wallet), `/planes`, facturación. No entra estética (colores, tokens,
> densidad): esta auditoría es de **flujo y organización**.
>
> **No propone soluciones.** El diseño de las mejoras vive en
> [`diseno-ux-vendedor.md`](diseno-ux-vendedor.md).
>
> Toda afirmación está verificada contra el fichero y la línea citados.

**Heurísticas usadas** (cada hallazgo declara cuál viola):

| # | Heurística |
|---|---|
| 1 | **Orientación** — ¿sé dónde estoy y puedo volver al inicio / a mis anuncios? |
| 2 | **Callejones sin salida** — ¿hay pantallas de las que solo se sale con el botón atrás? |
| 3 | **Pasos innecesarios** — ¿más clics de los necesarios? ¿confirmaciones ausentes o de más? |
| 4 | **Consistencia** — ¿la misma acción se hace igual en toda la app? |
| 5 | **Visibilidad del estado** — ¿veo mi saldo, mi plan, el estado del anuncio, cuándo caduca? |
| 6 | **Feedback** — ¿las acciones dicen lo que han hecho? |
| 7 | **Organización** — ¿lo importante es prominente? ¿hay sobrecarga o dispersión? |

---

## 1. Mapa real de flujos

### 1.1 Tres shells distintos en el mismo producto

| Zona | Layout | Header de sitio | Nav dinámico | Footer | Sidebar |
|---|---|---|---|---|---|
| Pública | [`(public)/layout.tsx`](../apps/web/src/app/(public)/layout.tsx) | ✅ logo + Buscar + Publicar + campana + avatar | ✅ `MainNav` por `pageType` | ✅ | — |
| **Vendedor** | [`(account)/layout.tsx`](../apps/web/src/app/(account)/layout.tsx) | ❌ **ninguno** | ❌ | ❌ | ✅ 9 enlaces planos |
| Admin | [`(admin)/layout.tsx`](../apps/web/src/app/(admin)/layout.tsx) | ✅ barra "Backoffice" + `AdminUserBar` | — | — | ✅ **con estado activo** |

`<Header/>` se monta en **un solo sitio** en todo `apps/web`:
[`(public)/layout.tsx:7`](../apps/web/src/app/(public)/layout.tsx#L7). El layout de cuenta son
34 líneas: `<div flex><aside w-56><main>`. Sin cabecera, sin logo, sin enlace a `/`.

### 1.2 Pantallas, acciones y salidas

```
/mis-anuncios ──────────── banner promocional (slot MIS_ANUNCIOS) por ENCIMA del <h1>
  ├─ h1 + [Ver estadísticas] [Publicar anuncio]
  ├─ aviso de cuota Pro (solo si remaining > 0)
  ├─ 9 pestañas de filtro (Todos/Activos/En revisión/Borradores/Reservados/
  │   Pausados/Vendidos/Caducados/Archivados) → refetch en cliente, sin recuentos
  └─ MyListingCard × N — hasta 12 botones en una fila plana:
       Editar · Publicar · Reservar · Marcar vendido · Renovar · Pausar ·
       Reactivar · Destacar · Bump · Archivar · Eliminar · ¿Necesitas ayuda?
       (NO hay «Ver anuncio»: el slug está en los datos y no se usa)

/mis-anuncios/estadisticas ── <Select> global de anuncio + vistas/me gusta
  ├─ no-Pro: card punteada + Lock + [Hazte Pro] → /planes   ← MOLDE del gate PRO
  └─ SIN enlace de vuelta y SIN entrada en el sidebar

/mis-anuncios/[id]/editar ── wizard de 5 pasos (Fotos→Datos→Atributos→Etiquetas→Ubicación)
  ├─ StepIndicator NO clicable; «Guardar cambios» SOLO en el último paso
  ├─ sin botón Cancelar, sin aviso de cambios sin guardar
  └─ al guardar → router.push('/mis-anuncios') sin confirmación de nada

/mis-anuncios/destacado-exito | destacado-error ── retorno del TPV Redsys

/mis-creditos   (nav: «Mis créditos» · <title>: «Mi saldo» · URL: /mis-creditos)
  ├─ RedeemCouponForm — al acertar, el formulario DESAPARECE hasta recargar
  ├─ §Créditos: saldo + packs → TPV + historial (SIN paginación, aunque la API pagina)
  └─ §Bumps:   saldo + packs → TPV + historial
/mis-creditos/exito | error ── retorno del TPV Redsys

/perfil ── formulario + «Mi actividad» (4 botones) + cerrar sesión
  └─ ÚNICO enlace a /perfil/facturacion en toda la app
/perfil/facturacion ── datos fiscales + facturables + [Solicitar factura] + facturas PDF
/perfil/suscripcion ── plan actual + cuota de destacados + [Cancelar]
  └─ sin plan → [Ver planes] → /planes   ← SALE del shell de cuenta

/planes   (grupo PUBLIC) ── Header + MainNav("PLANES") + Footer, sin sidebar
  └─ Stripe → /planes/exito | /planes/cancelado
```

### 1.3 Grafo de navegación — lo que falta

| Desde | ¿A dónde puedo ir? | ¿Cómo vuelvo? |
|---|---|---|
| Cualquier pantalla de cuenta | sidebar (9 destinos) | **al inicio: imposible sin URL a mano o botón atrás** |
| `/mis-anuncios/estadisticas` | ficha del más visto, `/planes` | solo sidebar |
| `/mis-anuncios/[id]/editar` | nada | solo sidebar (perdiendo cambios sin aviso) |
| `/perfil/facturacion` | `/mis-tickets/nuevo` | solo sidebar (y no está en el sidebar) |
| `/planes` | Header público completo | **el sidebar de cuenta ya no existe** |
| `/mis-creditos/exito` | enlace de texto «Ir a mi saldo» | — |

**Rutas huérfanas del sidebar:** `/mis-anuncios/estadisticas`, `/perfil/facturacion`,
`/mis-tickets`, `/planes`. Cuatro pantallas de la zona no aparecen en su propia navegación.

---

## 2. Hallazgos de fricción — priorizados por severidad

### 🔴 Alta

**A1 · `(account)/layout.tsx` — no existe cabecera: no hay «volver al inicio»**
Heur. 1 + 2. La zona entera se renderiza sin `Header`, sin logo, sin buscador, sin campana de
notificaciones y sin menú de avatar. Desde que el usuario entra en `/mis-anuncios` **no tiene
ninguna vía de UI para volver a la portada**: solo el botón atrás del navegador.

**A2 · `MyListingCard` — el cooldown del bump está mal: 24 h en el front, 1 h en el back**
Heur. 5 + 6. El front calcula `bumpedAt + 24h`
([`MyListingCard.tsx:91-94`](../apps/web/src/components/anuncios/MyListingCard.tsx#L91-L94));
el backend solo rechaza por debajo de 3600 s
([`billing.service.ts:557`](../apps/api/src/modules/billing/billing.service.ts#L557)). El botón
queda deshabilitado **23 horas de más** con «Bump (espera)» y un tooltip con fecha falsa.
Estorba al usuario y bloquea ingreso. *(Es un bug, no una decisión de diseño.)*

**A3 · `(account)/layout.tsx` — el sidebar no es responsive: la zona se rompe en móvil**
Heur. 7. `<aside className="w-56 shrink-0">` dentro de un `flex` sin un solo breakpoint. En
375 px el sidebar se lleva 224 px + 32 de gap + 32 de padding → quedan ~87 px de contenido.
Tarjetas, wizard de edición y tablas de facturas quedan inusables.

**A4 · `/mis-anuncios/[id]/editar` — cambiar un precio cuesta 5 pantallas**
Heur. 3. El editor reusa el wizard de alta:
[`StepIndicator`](../apps/web/src/components/publicar/StepIndicator.tsx) es puro display (no
clicable) y «Guardar cambios» solo aparece en el último paso (`isLast`). Para tocar el título
hay que pulsar Siguiente ×4 validando todos los pasos intermedios. Sin Cancelar y sin aviso de
cambios sin guardar: pinchar el sidebar descarta todo en silencio.

**A5 · `MyListingCard` — no hay forma de ver el anuncio publicado**
Heur. 2 + 7. Ni el título ni la foto son enlaces, y no hay botón «Ver anuncio». El `slug` viaja
en `ListingSummary` ([`types/index.ts:209`](../apps/web/src/types/index.ts#L209)) y sí se usa en
Estadísticas. El vendedor no puede comprobar cómo le queda el anuncio sin buscarlo a mano.

**A6 · `MyListingCard` — 9-12 botones planos, sin jerarquía**
Heur. 7 + 4. Un anuncio ACTIVE muestra a la vez Editar, Reservar, Marcar vendido, Renovar,
Pausar, Destacar, Bump, Archivar, Eliminar y ¿Ayuda?, **todos** `variant="outline" size="sm"` en
un `flex-wrap`: promocionar (ingreso), gestionar ciclo de vida y destruir (irreversible) al mismo
peso visual. En móvil son 3-4 filas de botones por tarjeta.

**A7 · `mis-creditos/exito` — el éxito del pago nunca se resuelve**
Heur. 6 + 2. Muestra un `Loader2` girando **indefinidamente** bajo «¡Gracias por tu compra!»:
nunca pasa a estado confirmado aunque el webhook ya haya acreditado. Hay que pulsar «Actualizar
saldo» a mano y comparar cifras. La única salida es un enlace de texto.
[`planes/exito`](../apps/web/src/app/(public)/planes/exito/page.tsx) **sí** detecta el estado
final y ofrece ✔ + dos botones: el problema ya está resuelto en la otra rama de pago.

---

### 🟡 Media

**M1 · Sidebar de cuenta — no marca dónde estás.** Heur. 1. Nueve `<Link>` idénticos, sin
`usePathname`, sin `aria-current`. El patrón existe en el mismo repo:
[`AdminNav.tsx:45-46`](../apps/web/src/app/(admin)/components/AdminNav.tsx#L45-L46). Tampoco hay
breadcrumbs, que ficha, búsqueda, blog y categorías sí tienen.

**M2 · Sidebar — cuatro destinos de la zona no están en él.** Heur. 1 + 7. Faltan Estadísticas,
Datos de facturación, Mis tickets y Planes. Facturación solo se alcanza desde un botón enterrado
en `/perfil`; Estadísticas solo desde un botón de `/mis-anuncios`.

**M3 · `/planes` vive fuera del shell de cuenta.** Heur. 4 + 1. Está en `(public)` con su propio
[`MainNav pageType="PLANES"`](../apps/web/src/app/(public)/planes/layout.tsx#L9). Desde
`/perfil/suscripcion` → «Ver planes» el sidebar desaparece y aparece la cabecera pública: el
usuario cambia de producto a mitad de una tarea de gestión y ya no tiene camino de vuelta.

**M4 · `/planes` no sabe que ya eres Pro, y no promete lo que da.** Heur. 5. `PRO_FEATURES` está
hardcodeado ([`planes/page.tsx:28-35`](../apps/web/src/app/(public)/planes/page.tsx#L28-L35)) y
**no menciona** los dos beneficios que la app sí concede y muestra por todas partes: destacados
gratis al mes y cuota mensual de bumps (+ `proExtraBumpsPercent` en packs). Además
`CheckoutButton` muestra «Hazte Pro» a quien ya lo es, sin guard: pulsarlo abre un segundo
checkout de Stripe.

**M5 · `DestacadoDialog` — destacar con créditos se completa en silencio.** Heur. 6 + 4.
`onSuccess` cierra el diálogo y refresca, sin mensaje. El bump, **en la misma tarjeta**, sí
confirma («Se han descontado N créditos» / «Bump gratis usado (cuota mensual Pro)»). Dos
operaciones gemelas con feedback opuesto.

**M6 · No existe sistema de notificación transversal.** Heur. 6 — *raíz de M5, M7 y A7*. No hay
`sonner` ni `Toaster` en el proyecto (`components/ui/` no lo incluye; tampoco está en
`package.json`) y [`use-api-action.ts`](../apps/web/src/lib/api/use-api-action.ts) solo tiene
canal de error. Cada pantalla improvisa: `<p>` verde, `<p>` roja, `router.refresh()` mudo, o nada.

**M7 · `FacturasPanel` — «Solicitar factura» es irreversible, sin confirmar y sin confirmar.**
Heur. 3 + 6. Emite un documento fiscal inmutable (triggers de BD que rechazan UPDATE/DELETE) con
un clic y sin diálogo, mientras que archivar un anuncio **sí** lo pide. Al terminar solo hace
`router.refresh()`: ninguna señal. Si `canRequest` es false teniendo datos fiscales, el botón
queda deshabilitado sin decir por qué.

**M8 · `RedeemCouponForm` — un cupón por carga de página.** Heur. 2. `success ? <mensaje> :
<formulario>` y `success` nunca se limpia: para canjear un segundo código hay que recargar.

**M9 · `/mis-creditos` — el historial no se puede pasear.** Heur. 5. La API devuelve
`page/perPage/totalPages` y la página pinta solo `items`, sin controles: el usuario ve 20
movimientos y no sabe que hay más — justo la pantalla donde se audita en qué se fue el dinero.

**M10 · `/mis-anuncios/estadisticas` — hoja sin retorno y sin acceso por anuncio.** Heur. 1 + 3.
No está en el sidebar (M2), no tiene enlace de vuelta, y desde una tarjeta concreta no se puede
saltar a sus estadísticas: hay que ir a la pantalla global y buscar en un `<Select>` de N.

**M11 · `destacado-exito` — «contacta con soporte» sin enlace a soporte.** Heur. 2. Dice «Si no
ves el cambio en 5 minutos, contacta con soporte» y no enlaza `/mis-tickets/nuevo`, que existe y
que la tarjeta de anuncio y el panel de facturas sí enlazan contextualmente.

**M12 · Las cuotas Pro solo se ven a medias.** Heur. 5. El aviso de `/mis-anuncios` se renderiza
con `proStatus.isPro && proStatus.remaining > 0`: al agotarla desaparece, y el usuario no
distingue «no soy Pro» de «ya la gasté». Simétricamente, `/perfil/suscripcion` muestra la cuota de
**destacados** pero no la de **bumps**, que solo aparece incrustada en el texto de un botón.

---

### 🟢 Baja

- **B1 · Tres nombres para el monedero** (h. 1): nav «Mis créditos» / `<title>` «Mi saldo» / URL
  `/mis-creditos`, y dentro dos monedas.
- **B2 · Dos pasarelas con dos estéticas** (h. 4): Pro → Stripe («Redirigiendo a Stripe…»),
  créditos/destacado → Redsys («Redirigiendo al TPV…»), con páginas de retorno de calidad muy
  distinta (ver A7). Decisión de negocio, pero el usuario ve dos productos.
- **B3 · Filtros sin recuento** (h. 5): 9 pestañas en `/mis-anuncios` y ninguna dice cuántos
  anuncios contiene; hay que pincharlas para descubrirlo.
- **B4 · `PackList` se sustituye a sí mismo** (h. 6): al ir al TPV, la sección «Comprar créditos»
  se reemplaza por un spinner a media página mientras el resto sigue ahí.
- **B5 · Estados vacíos desiguales** (h. 7): sin anuncios → mensaje + CTA ✅; sin créditos →
  «Compra un pack para empezar» sin botón; sin bumps → la sección **no se renderiza**; sin
  facturas → línea de texto sin CTA; sin datos fiscales → aviso que dice «(arriba)» en vez de
  enlazar.
- **B6 · Banner promocional por encima del propio contenido** (h. 7): el slot `MIS_ANUNCIOS` se
  pinta antes del `<h1>`, empujando los anuncios del usuario.

### Estético — fuera de alcance

Colores ad-hoc (`amber-50/200/800`, `green-600`, `text-destructive`) fuera del sistema de tokens;
densidad de las tarjetas; thumbnail de 96 px; iconografía mezclada. No se tocan aquí.

---

## 3. Los dos enganches futuros

### 3.1 Bump automático — no hay sitio; hay que crear la superficie

- **Hoy el bump no tiene pantalla**: es un botón dentro de `MyListingCard`, en la misma fila plana
  que Eliminar y Archivar (A6). «Programar: cada X días, a tal hora» no cabe ahí sin reestructurar.
- **El molde existe y es
  [`DestacadoDialog`](../apps/web/src/components/anuncios/DestacadoDialog.tsx)**: ya resuelve el
  problema análogo — elegir duración (radio), elegir forma de pago (cuota Pro / créditos /
  tarjeta), mostrar saldo y advertir de lo que se consume.
- **Dónde vive el estado**: la tarjeta ya tiene línea de estado promocional (`featuredUntil` →
  «Destacado hasta…»). «Próximo bump: …» al lado es el hueco natural.
- **Dónde vive la administración**: `/mis-creditos` §Bumps ya tiene saldo + historial; «Bumps
  programados» encaja como tercer bloque.
- **Bloqueante previo**: A2. Programar bumps sobre una ventana temporal que el front calcula
  distinta que el backend dará conflictos inmediatos.

### 3.2 Vídeo en anuncios PRO — hay hueco, falta el gate

- **Sitio natural**: [`StepFotos`](../apps/web/src/components/publicar/steps/StepFotos.tsx), paso 1
  de ambos wizards (`MAX_PHOTOS = 15`, dropzone + grid ya montados).
- **La maquinaria de pasos condicionales ya existe**:
  [`resolveActiveSteps`](../apps/web/src/components/publicar/PublicarWizard.tsx#L71-L79) salta
  pasos según los datos (se usa para *atributos* y *etiquetas*).
- **El molde visual del gate PRO existe, pero fuera del editor**:
  [`EstadisticasClient.tsx:164-176`](../apps/web/src/components/anuncios/EstadisticasClient.tsx#L164-L176)
  — card punteada + `Lock` + copy de lo que desbloquea + `[Hazte Pro]` → `/planes`.
- **Falta el cableado**: hoy **ni `EditarWizard` ni `PublicarWizard` reciben `proStatus`**; la
  página de editar ni siquiera llama a `getProStatus`.
- **Fricción heredada**: mientras A4 siga vivo, añadir un vídeo a un anuncio existente obliga a
  recorrer el wizard entero para guardar.

---

## 4. Transversales

1. **Tres shells incompatibles** (A1, M3). El sistema de nav dinámico ni contempla la zona:
   `NavPageType` tiene HOME, BUSQUEDA, CATEGORIA, ANUNCIO, BLOG, PAGINA_CMS, VENDEDOR, CONTACTO,
   PLANES — **ninguna de cuenta** ([`schema.prisma:1797-1807`](../apps/api/prisma/schema.prisma#L1797-L1807)).
2. **Dos superficies de acciones de propietario que divergen.**
   [`ListingOwnerActions`](../apps/web/src/components/anuncios/ListingOwnerActions.tsx) (ficha
   pública, vista del dueño) y `MyListingCard` hacen lo mismo de forma distinta: «Subir al inicio
   (bump)» vs «Bump N cr.», con coste visible en una y no en la otra, con confirmación en una y no
   en la otra, y **sin** el bloqueo cliente de 24 h en la primera — es decir, las dos superficies
   discrepan sobre A2.
3. **Patrones que ya existen y no se reusan**: `isActive` del admin (M1), breadcrumbs de la zona
   pública (M1), gate PRO de Estadísticas, página de éxito resuelta de `planes/exito` (A7), entrada
   contextual a soporte (M11), diálogo de confirmación (M7).
4. **Feedback sin infraestructura** (M6): raíz de A7, M5 y M7.
5. **Móvil** (A3): el sidebar fijo rompe la zona entera y condiciona cualquier rediseño de tarjeta
   o editor, porque ambos viven dentro de ese shell.
