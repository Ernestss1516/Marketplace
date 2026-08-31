# Auditoría — `/mis-creditos`: completitud y organización

> Fecha: 2026-08-31 · Rama: `main` · Último commit: `f8999a1`
>
> **Qué es este documento.** Un INVENTARIO del estado real de `/mis-creditos`, verificado
> contra el código, fichero a fichero y línea a línea. **No implementa nada.** Mide qué
> muestra la página hoy, en qué orden, qué datos llegan al servidor y se quedan sin pintar,
> y qué haría falta para que la campaña activa se vea ANTES de comprar. Donde una hipótesis
> del encargo era falsa, se dice que era falsa.

---

## Cómo se ha verificado

Se ha leído el código, no la documentación. Lo verificado:

- La página completa: `apps/web/src/app/(account)/mis-creditos/page.tsx` (239 líneas,
  Server Component) y sus seis componentes de `_components/`.
- Los dos endpoints que la alimentan: `BillingService.getWallet` y
  `BillingService.getCatalog` (`apps/api/src/modules/billing/billing.service.ts`), más
  `getBumpLedger`, `getProStatus` y `getBumpSchedules`.
- El motor de campañas entero: `CampaignsService` (los tres lectores derivados), su
  controlador, el modelo `Campaign` en `schema.prisma`.
- Los dos checkouts que congelan el bonus: `RedsysService.createCreditPackCheckout` y
  `createBumpPackCheckout`, y el processor que lo acredita
  (`RedsysProcessor.handlePackPurchase` / `handleBumpPackPurchase`).
- El precedente que ya existe: cómo `/mis-anuncios` y `PromocionarDialog` SÍ enseñan el
  descuento de campaña antes de actuar.
- El espejo de las fórmulas en el frontend: `lib/campaigns/effect-preview.ts`.

---

## Resumen ejecutivo — las tres preguntas rectoras

**¿El bonus de campaña se ve antes de comprar?**
**No, y la hipótesis del encargo es correcta al 100%.** `getActiveCreditBonusCampaign()` se
consulta en **un solo sitio**: `RedsysService.createCreditPackCheckout`
([redsys.service.ts:129](apps/api/src/modules/redsys/redsys.service.ts#L129)), es decir, en
el instante en que se crea la Transaction — después de que el usuario ya haya pulsado
«Comprar». Ni `getCatalog` ni `getWallet` la miran. La campaña se aplica, se congela, se
acredita y se etiqueta en el historial, pero **el usuario compra a ciegas**. Y lo mismo
pasa con su gemela de bumps (`BUMP_BONUS`, `createBumpPackCheckout`).

**¿El bonus Pro tiene el mismo defecto?**
**No — el bonus Pro ya está resuelto, y es exactamente el molde a replicar.** La hipótesis
del encargo («el Pro tiene el MISMO problema potencial») es **falsa**: la ráfaga E-5 ya lo
cerró. El catálogo publica `proBonusAmount` **por cada precio de pack**
([billing.service.ts:1091](apps/api/src/modules/billing/billing.service.ts#L1091)),
calculado con la MISMA función que congela el checkout (`proBonusAmount()` de
`pro-bonus.ts`), y `PackList` lo pinta antes de pagar: al Pro como «+ N de regalo por ser
Pro», al no-Pro como «Con Pro te llevarías N créditos más (+20%)»
([PackList.tsx:124-138](apps/web/src/app/(account)/mis-creditos/_components/PackList.tsx#L124-L138)).
`BumpPackList` hace lo mismo. **Esto es una buena noticia: no hay que inventar el patrón,
hay que extenderlo.**

**¿La página está mal organizada?**
**Sí, y el defecto más grave es de orden, no de contenido.** Lo primero que ve el usuario
tras el título no es su saldo: es un **formulario de canjear cupón**
([page.tsx:111](apps/web/src/app/(account)/mis-creditos/page.tsx#L111)), colocado por
encima de las dos monedas. Una caja de texto para un código que la mayoría no tiene ocupa
el sitio de la cifra que el 100% de los visitantes viene a ver. Además hay cuatro datos que
el servidor ya trae y la página no pinta (§4).

---

## §1 — Qué muestra `/mis-creditos` HOY: el inventario

### 1.1 Lo que la página pide al servidor

`page.tsx` abre **seis** llamadas en paralelo, todas con `.catch()` que degrada en vez de
tumbar la página ([page.tsx:46-85](apps/web/src/app/(account)/mis-creditos/page.tsx#L46-L85)):

| # | Llamada | Qué devuelve | ¿Se usa entero? |
|---|---------|--------------|-----------------|
| 1 | `getWallet(token)` | `balance`, `bumpBalance`, `items[]` (pág. 1 del ledger), `total`, `page`, `perPage`, `totalPages` | Casi — el campo `note` de cada apunte se ignora (§4.1) |
| 2 | `getCatalog()` | `products[]` con precios, `bumpCreditCost` (+descuento), `proExtra*Percent`, `proMonthly*Quota`, `freeBenefits`, `proBenefits` | **No** — se usan 3 de ~10 campos (§4.2) |
| 3 | `getBumpLedger(token)` | `bumpBalance`, `items[]`, paginación | Sí |
| 4 | `getProStatus(token)` | `isPro`, `limit`, `used`, `remaining`, `bumpQuota{}`, `periodStart/End`, `quotaDurationDays`, `hasActiveSubscription` | **No** — se usa SOLO `isPro` (§4.3) |
| 5 | `getBumpSchedules(token)` | Programaciones de bump automático | Sí |
| 6 | `getActiveBanners('MIS_CREDITOS')` | Banners de la ubicación | Sí |

**Lo que NO se pide y existe:** `getMyEntitlements(token)` (destacados vigentes del usuario)
— endpoint implementado, tipado en `lib/api/billing.ts:148`, nunca llamado desde aquí.

### 1.2 El orden actual, de arriba abajo

Verificado en el JSX, en secuencia literal:

```
1.  <h1> «Mi saldo»
2.  <p>  Párrafo explicativo: «Créditos y bumps son monedas distintas…»
3.  BannerList          ← si hay banners activos de ubicación MIS_CREDITOS
4.  RedeemCouponForm    ← Card completa: título «Canjear cupón» + input + botón
5.  ── SECCIÓN «Créditos» ──────────────────────────
5a.   Card «Saldo disponible»  → wallet.balance, texto 4xl
5b.   <h3 id="comprar"> «Comprar créditos» → PackList (grid de 3 columnas)
5c.   <h3> «Historial de créditos»         → HistorialCreditos (paginado)
6.  ── SECCIÓN «Bumps» ─────────────────────────────
6a.   Card «Saldo de bumps»    → wallet.bumpBalance, texto 4xl + nota de prioridad
6b.   <h3> «Comprar bumps»                 → BumpPackList (grid de 3 columnas)
6c.   <h3> «Bumps programados»             → BumpsProgramados
6d.   <h3> «Historial de bumps»            → HistorialBumps (paginado)
```

**Lo que el usuario ve primero (por encima del pliegue, en un móvil de 375 px):** el
título, un párrafo de dos líneas sobre la diferencia entre dos monedas, posiblemente un
banner promocional, y una caja para escribir un código de cupón. **El saldo aparece
después de todo eso.**

El orden interno de cada sección **sí es correcto** (saldo → comprar → historial). El
problema está en los elementos 2, 3 y 4, que se cuelan por delante de todo, y en que la
sección de bumps repite la estructura completa creando una página de ~2.000 px de alto con
dos bloques simétricos y ninguna jerarquía entre ellos.

### 1.3 Qué pinta cada tarjeta de pack (`PackList`)

Por cada `price` con `creditPackId`, una `Card`:

- Icono `Coins` + `packName` (o el nombre del producto)
- `product.description`, si la hay
- **`creditAmount`** en 3xl, color primario, + «créditos»
- **`price.amount`** formateado en euros (`Intl.NumberFormat es-ES`)
- **Si `proBonusAmount > 0`:** al Pro, «+ N de regalo por ser Pro» (ámbar); al no-Pro, un
  `ProHint` con «Con Pro te llevarías N créditos más (+20%)» y enlace a `/planes`
- Botón «Comprar»

**Lo que NO pinta:** nada sobre la campaña activa. No hay ni un campo en el payload que se
lo permita.

---

## §2 — La campaña: el ajuste 1

### 2.1 Qué existe y funciona (verificado)

El motor de campañas está **completo en el backend**, sin agujeros:

| Pieza | Ubicación | Estado |
|-------|-----------|--------|
| Modelo `Campaign` | [schema.prisma:2632](apps/api/prisma/schema.prisma#L2632) | `name`, `type`, `active`, `startsAt`, `endsAt`, `params` Json |
| Lector de bonus de créditos | [campaigns.service.ts:46](apps/api/src/modules/campaigns/campaigns.service.ts#L46) | `getActiveCreditBonusCampaign()` — derivado por fechas, sin caché |
| Lector de bonus de bumps | [campaigns.service.ts:62](apps/api/src/modules/campaigns/campaigns.service.ts#L62) | `getActiveBumpBonusCampaign()` — espejo literal |
| Lector de descuentos | [campaigns.service.ts:83](apps/api/src/modules/campaigns/campaigns.service.ts#L83) | `getActiveActionDiscount('BUMP'\|'FEATURED')` |
| Cálculo del bonus | [redsys.service.ts:132-136](apps/api/src/modules/redsys/redsys.service.ts#L132-L136) | `PERCENT → ceil(amount * value / 100)`; `FIXED → value` |
| Congelado en la Transaction | [redsys.service.ts:158-159](apps/api/src/modules/redsys/redsys.service.ts#L158-L159) | `campaignBonusAmount` + `campaignId` |
| Acreditación | [redsys.processor.ts:178-188](apps/api/src/modules/redsys/redsys.processor.ts#L178-L188) | Fila `CreditLedgerType.CAMPAIGN_BONUS` separada |
| Etiqueta en el historial | [Historiales.tsx:33](apps/web/src/app/(account)/mis-creditos/_components/Historiales.tsx#L33) | «Bonus campaña» |
| CRUD de admin | [campaigns.controller.ts:15](apps/api/src/modules/campaigns/campaigns.controller.ts#L15) | `@Controller('admin/campaigns')`, `@MinRole(MODERATOR)` |

**Conclusión:** todo el camino del dinero funciona. Lo único que falta es **una superficie
pública que lo anuncie**.

### 2.2 Dónde se rompe la cadena, exactamente

`getActiveCreditBonusCampaign()` tiene **un único llamador en todo el repositorio**:

```
apps/api/src/modules/redsys/redsys.service.ts:129
  const activeCampaign = await this.campaigns.getActiveCreditBonusCampaign();
```

Ese punto es `createCreditPackCheckout`, que se ejecuta **cuando el usuario ya ha pulsado
«Comprar»**. `getCatalog()` no lo llama; `getWallet()` no lo llama. El único controlador de
campañas es admin-only. **No hay ninguna ruta por la que un usuario no-admin pueda saber
que hay una campaña activa antes de pagar.**

### 2.3 El precedente que ya resuelve esto para OTRO tipo de campaña

Aquí está la asimetría que da sentido a todo el ajuste. **`ACTION_DISCOUNT` (descuento en
bump/destacado) SÍ es visible antes de actuar. `CREDIT_BONUS`/`BUMP_BONUS` no.**

`getCatalog()` **ya consulta `CampaignsService`**
([billing.service.ts:1033-1036](apps/api/src/modules/billing/billing.service.ts#L1033-L1036)):

```ts
const [featuredDiscount, bumpDiscount] = await Promise.all([
  this.campaigns.getActiveActionDiscount('FEATURED'),
  this.campaigns.getActiveActionDiscount('BUMP'),
]);
```

…y publica el resultado en tres formas: `bumpCreditCost` (ya descontado),
`bumpOriginalCreditCost` + `bumpDiscountPercent` cuando hay campaña, y por cada precio de
destacado `creditCost` / `originalCreditCost` / `discountPercent`.

Y el frontend **ya los pinta**:
[promocion.ts:86-89](apps/web/src/components/anuncios/owner/promocion.ts#L86-L89) genera
`«5 créditos (antes 10, -50%)»`, y `PromocionarDialog` tacha el precio original
([PromocionarDialog.tsx:711](apps/web/src/components/anuncios/owner/PromocionarDialog.tsx#L711)).

**Es decir: `BillingModule` ya inyecta `CampaignsService`, el catálogo ya lo consulta, y el
frontend ya sabe pintar «antes/ahora» de una campaña.** El hueco no es arquitectónico, es
literalmente que a `getCatalog()` le faltan dos llamadas más (las de bonus) y a las dos
listas de packs, un bloque de texto.

### 2.4 Cómo exponerla: la opción recomendada

**Recomendación: ampliar `GET /billing/catalog`. No crear `GET /billing/active-campaign`.**

Por qué:

1. **El catálogo ya es el sitio.** Ya publica el efecto de las campañas `ACTION_DISCOUNT`.
   Poner el efecto de `CREDIT_BONUS` en otro endpoint sería tener dos verdades sobre
   campañas en dos superficies distintas.
2. **Ya tiene la dependencia inyectada.** `BillingService` recibe `CampaignsService` en el
   constructor ([billing.service.ts:76](apps/api/src/modules/billing/billing.service.ts#L76)).
   Cero fontanería nueva.
3. **Es público y sin caché por request**, exactamente igual que los descuentos que ya
   sirve. El comentario del propio código lo dice: *«El catálogo es público y sin caché por
   request, así que "en vivo" aquí es simplemente "leído en este momento"»*.
4. **Una llamada menos.** La página ya pide el catálogo; un endpoint nuevo sería una
   séptima petición en el `Promise.all` para un dato que cabe en la que ya se hace.
5. **El molde de `proBonusAmount` ya está probado.** El número se sirve **ya resuelto por
   pack**, no como parámetros para que el cliente calcule. Es la decisión que E-5 tomó
   explícitamente y por la razón correcta: *«repetir la fórmula es cómo se llega a prometer
   un número y acreditar otro»*.

**Forma concreta propuesta** (dos piezas, ambas siguiendo moldes existentes):

- **Por pack** — junto a `proBonusAmount`, un `campaignBonusAmount` calculado en el
  servidor con la misma expresión que congela `createCreditPackCheckout`. Mismo criterio,
  mismo sitio, mismo tipo. Idéntico para `bumpPack` con la campaña `BUMP_BONUS`.
- **A nivel de catálogo** — un objeto con el contexto que la tarjeta no puede deducir del
  número: al menos el **nombre** de la campaña (para poder decir *por qué* hay un regalo) y
  su **`endsAt`** (para poder decir *hasta cuándo*). Molde:
  `bumpOriginalCreditCost`/`bumpDiscountPercent`, que ya viajan así.

**Sobre extraer la fórmula a un módulo compartido:** el bonus de campaña se calcula hoy
**dos veces en el backend**, con el mismo `ceil` copiado a mano
([redsys.service.ts:134](apps/api/src/modules/redsys/redsys.service.ts#L134) y
[redsys.service.ts:238](apps/api/src/modules/redsys/redsys.service.ts#L238)). Añadir una
tercera copia en `getCatalog()` sería el escenario exacto que `pro-bonus.ts` se creó para
evitar. **La ráfaga debe extraer la función primero** (un `campaign-bonus.ts` hermano de
`pro-bonus.ts`) y hacer que los tres la llamen. Esto no es refactor opcional: es la
condición para que el número que se enseña sea el que se cobra.

> Nota sobre `lib/campaigns/effect-preview.ts`: existe una copia de la fórmula **en el
> frontend**, declarada explícitamente como «deuda de espejo» para la vista previa del
> formulario de admin. Con el catálogo sirviendo el número ya resuelto, **las listas de
> packs NO deben usarla** — seguiría siendo una segunda fuente. Su uso queda acotado al
> diálogo de admin, que es donde tiene sentido (previsualiza una campaña que aún no existe
> en la base de datos).

### 2.5 Cómo mostrarla en la tarjeta

El molde ya está escrito en `PackList` para el bonus Pro. La tarjeta pasa a tener **hasta
dos líneas de regalo**, y hay que decidir cómo se leen juntas. Lo verificado sobre la
mecánica: **los dos bonus son ADITIVOS y se calculan cada uno contra la base**, nunca uno
sobre el resultado del otro — está documentado y es lo que hace el checkout
([redsys.service.ts:125-128](apps/api/src/modules/redsys/redsys.service.ts#L125-L128)). Un
Pro comprando durante una campaña se lleva los dos.

Eso permite una lectura honesta y simple: **un total**, con el desglose debajo.

```
        Pack 100                          Pack 100
        100 créditos                      100 créditos
        9,99 €                            9,99 €
                                          ─────────────────────────
        ✦ Recibes 140                     ✦ Recibes 120
          +20 por ser Pro                   +20 por «Vuelta al cole»
          +20 por «Vuelta al cole»          Hasta el 15 de septiembre
          Hasta el 15 de septiembre
             (usuario Pro)                    (usuario no-Pro)
```

Al no-Pro se le sigue enseñando el `ProHint` con lo que se pierde — el gate que convierte,
que ya existe y funciona. Lo que cambia es que ahora **el regalo de campaña es suyo también**
(no depende del plan), así que se presenta como ganado, no como zanahoria.

**Dos detalles que la implementación no puede pasar por alto:**

- **`FIXED` da el MISMO número a todos los packs.** `params.kind === 'FIXED'` devuelve
  `value` tal cual, sin escalar con el tamaño. Un «+50 créditos» idéntico en el pack de 25
  y en el de 500 es correcto según el motor, pero se lee raro en un grid de tres tarjetas y
  hace que el pack pequeño parezca la mejor oferta (lo es, proporcionalmente). No es un
  fallo a arreglar: es una consecuencia del diseño del motor que la UI debe presentar sin
  mentir.
- **El catálogo previsualiza; el checkout congela.** Si la campaña termina entre el render
  de la página y el clic, el usuario vería un regalo que no recibe. Es **el mismo riesgo
  que ya acepta `proBonusAmount`** (un usuario podría dejar de ser Pro entre ambos
  instantes) y la ventana es de segundos. No requiere mecanismo nuevo, pero sí que el
  copy no prometa más de lo que puede: por eso la fecha de fin en la tarjeta ayuda.

---

## §3 — El bonus Pro: hipótesis refutada

El encargo planteaba que el bonus Pro «tiene el MISMO problema potencial». **No lo tiene.**
Se ve antes de comprar, para los dos tipos de usuario, y con el número que el servidor va a
congelar.

La cadena completa, verificada:

1. `pro-bonus.ts` define **una sola** `proBonusAmount(baseAmount, pct)`.
2. `getCatalog()` la llama por cada pack y publica el resultado
   ([billing.service.ts:1091](apps/api/src/modules/billing/billing.service.ts#L1091) para
   créditos, [:1108](apps/api/src/modules/billing/billing.service.ts#L1108) para bumps).
3. `RedsysService.computeProBonus` llama a la misma función al congelar.
4. `PackList` y `BumpPackList` pintan `price.proBonusAmount` con el comentario explícito de
   que **no se recalcula en cliente**.

**Esto es el molde.** El ajuste 1 consiste en hacerle a la campaña exactamente lo que E-5 le
hizo al bonus Pro. La única diferencia técnica: `proBonusAmount` no depende de quién
pregunta (por eso el catálogo es público y dice la verdad a todos), y el bonus de campaña
**tampoco** — se aplica a cualquiera que compre durante la ventana. La misma propiedad, la
misma solución.

---

## §4 — Qué existe y no se muestra

El patrón de la sesión —el backend calcula más de lo que la interfaz enseña— **se confirma**.
Cuatro casos, ordenados por gravedad.

### 4.1 `CreditLedger.note` — el porqué de un cobro, escrito y descartado

`BillingService` escribe una nota explicativa **cada vez que una campaña abarata un
consumo**:

```ts
// billing.service.ts:616 (destacado) y :855 (bump)
...(discount && { note: `Campaña "${discount.name}" (-${percent}%)` })
```

El campo viaja hasta el frontend: está en el tipo `WalletItem`
([billing.ts:24](apps/web/src/lib/api/billing.ts#L24)), llega en el payload del wallet…
y **`Fila` no lo renderiza**. El componente pinta etiqueta, fecha e importe
([Historiales.tsx:55-83](apps/web/src/app/(account)/mis-creditos/_components/Historiales.tsx#L55-L83)),
nada más.

**Consecuencia medible:** un usuario que bumpeó durante una campaña ve «Bump · −2 cr.»
donde otro día vería «Bump · −5 cr.», sin ninguna explicación de la diferencia. El texto que
la explica existe, está guardado en su fila, y se tira.

**Es «existe y no se muestra» en estado puro, y es la corrección más barata del documento:
una línea.**

### 4.2 Los costes: cuánto vale lo que el saldo compra

`getCatalog()` publica `bumpCreditCost` (con descuento ya aplicado) y, por cada precio de
destacado, `creditCost` + `durationDays`. `/mis-anuncios` los usa
([mis-anuncios/page.tsx:51-53](apps/web/src/app/(account)/mis-anuncios/page.tsx#L51-L53)).
**`/mis-creditos` los recibe en el mismo objeto `catalog` y no los toca.**

**Consecuencia:** la página que existe para responder «¿cuánto saldo tengo?» no responde
«¿y eso para cuánto me da?». Un «tienes 150 créditos» sin decir que un bump cuesta 5 y un
destacado de 7 días cuesta 30 es una cifra sin unidad de medida. Y si hay un
`ACTION_DISCOUNT` activo, el usuario tampoco se entera aquí de que ahora mismo bumpear
cuesta la mitad.

### 4.3 La cuota Pro: la tercera moneda, que no aparece

`getProStatus(token)` se pide entera y **se usa solo `isPro`**. Se descartan:
`remaining`/`limit` (destacados gratis este mes), `bumpQuota.remaining`/`limit` (bumps
gratis este mes), `periodEnd`, `quotaDurationDays`.

Esto importa más de lo que parece, porque **la cuota Pro es lo PRIMERO que se gasta al
bumpear**. El orden de consumo está codificado en `BillingService.bump()`
([billing.service.ts:779-859](apps/api/src/modules/billing/billing.service.ts#L779-L859)):

```
1º  Cuota mensual Pro     (gratis, se pierde al final del periodo)
2º  bumpBalance           (gratis, permanente, no caduca)
3º  Créditos              (de pago, con descuento de campaña si lo hay)
```

La propia página lo dice en el texto de la tarjeta de bumps: *«Al bumpear se gastan antes
que los créditos (y, si eres Pro, después de tu cuota mensual gratis)»*. **Menciona una
cuota cuyo número no enseña.** Un Pro con 4 bumps de cuota, 3 de saldo y 150 créditos ve
dos de los tres números.

Los datos sí se pintan — en `/perfil/suscripcion`
([suscripcion/page.tsx:140-150](apps/web/src/app/(account)/perfil/suscripcion/page.tsx#L140-L150)).
Están en la página del plan, no en la del saldo. **No es un dato inexistente: está en el
sitio equivocado para esta pregunta.** La recomendación (§5) no es duplicar esa pantalla,
sino traer las dos cifras de cuota al lado de los saldos que compiten con ellas.

### 4.4 La condición Pro, invisible salvo por implicación

`isPro` llega y se usa **solo para elegir qué variante del bonus pintar dentro de las
tarjetas de pack**. La página nunca dice «eres Pro». Un Pro deduce su condición porque las
tarjetas dicen «de regalo por ser Pro» en vez de «con Pro te llevarías». Si no hubiera
packs activos en el catálogo, un Pro no vería **ni una sola** señal de su plan en toda la
página.

### 4.5 Resumen de la clasificación pedida

| Dato | ¿Existe? | ¿Llega a la página? | ¿Se pinta? | Clase |
|------|----------|---------------------|-----------|-------|
| `wallet.balance` | Sí | Sí | Sí | ✔ |
| `wallet.bumpBalance` | Sí | Sí | Sí | ✔ |
| Historial de ambas monedas, paginado | Sí | Sí | Sí | ✔ |
| `proBonusAmount` por pack | Sí | Sí | Sí | ✔ |
| Descuento `ACTION_DISCOUNT` en el catálogo | Sí | Sí | **No** | **Mostrar** |
| `ledgerItem.note` (motivo del cobro) | Sí | Sí | **No** | **Mostrar** |
| `catalog.bumpCreditCost` / `creditCost` (costes) | Sí | Sí | **No** | **Mostrar** |
| `proStatus.remaining` / `bumpQuota` (cuotas) | Sí | Sí | **No** | **Mostrar** |
| Bonus de campaña `CREDIT_BONUS` por pack | Sí (en el checkout) | **No** | No | **Exponer + mostrar** |
| Bonus de campaña `BUMP_BONUS` por pack | Sí (en el checkout) | **No** | No | **Exponer + mostrar** |
| Nombre / fecha de fin de la campaña activa | Sí (en `Campaign`) | **No** | No | **Exponer + mostrar** |
| `note` en las filas `CAMPAIGN_BONUS` del ledger | **No** (nunca se escribe) | — | — | **Crear** (opcional) |
| Fórmula compartida del bonus de campaña | **No** (copiada dos veces) | — | — | **Crear** |
| Destacados vigentes (`getMyEntitlements`) | Sí (endpoint) | **No** (no se llama) | No | Fuera de alcance |

Un apunte sobre la última fila «Crear»: las filas `CAMPAIGN_BONUS` del ledger se guardan
**sin `note`**
([redsys.processor.ts:179-187](apps/api/src/modules/redsys/redsys.processor.ts#L179-L187)),
a diferencia de los débitos con descuento. El historial dice «Bonus campaña» sin decir cuál.
La `Transaction` sí guarda `campaignId`, así que el dato es recuperable — pero hoy no se
escribe donde el historial lo leería. Es coherente arreglarlo en la misma ráfaga que hace
visible la campaña.

---

## §5 — La organización propuesta

### 5.1 El criterio

La página responde a tres preguntas, y **no tienen el mismo peso**:

1. **«¿Cuánto tengo?»** — la pregunta del 100% de las visitas. Es el nombre de la página
   («Mi saldo») y el motivo de venir.
2. **«¿Me llega para lo que quiero hacer?» / «¿Cómo consigo más?»** — la pregunta de quien
   ha venido rebotado desde una acción que no pudo pagar (existe ese flujo: el parámetro
   `?volver=` que `PackList` propaga hasta el TPV).
3. **«¿En qué se me ha ido?»** — consulta ocasional, de detalle, casi siempre a posteriori.

El orden debe ser ése: **saldo → comprar → historial**. Y todo lo que no responda a ninguna
de las tres (canjear un cupón) va **después**, no antes.

### 5.2 El orden propuesto

```
1.  <h1> «Mi saldo»
    ─────────────────────────────────────────────────────────────────
2.  RESUMEN DE SALDO — una franja, las dos monedas juntas y la cuota Pro
      ┌────────────────────┬────────────────────┬──────────────────┐
      │  150 créditos      │  3 bumps gratis    │  Pro · 4 bumps + │
      │  ≈ 30 bumps o      │  no caducan        │  2 destacados de │
      │  5 destacados 7d   │                    │  cuota este mes  │
      └────────────────────┴────────────────────┴──────────────────┘
      (la tercera columna solo si isPro; ver §5.3)
    ─────────────────────────────────────────────────────────────────
3.  AVISO DE CAMPAÑA ACTIVA — si la hay, ancho completo, encima de los packs
      ✦ «Vuelta al cole»: +20% de créditos extra en cualquier pack.
        Hasta el 15 de septiembre.
    ─────────────────────────────────────────────────────────────────
4.  BannerList          ← si hay banners de la ubicación
    ─────────────────────────────────────────────────────────────────
5.  COMPRAR  (id="comprar")
5a.   Packs de créditos  → PackList, con los dos bonus visibles por tarjeta
5b.   Packs de bumps     → BumpPackList, idem
    ─────────────────────────────────────────────────────────────────
6.  BUMPS PROGRAMADOS    ← gestión, no dinero: baja de donde está hoy
    ─────────────────────────────────────────────────────────────────
7.  CANJEAR CUPÓN        ← baja del puesto 4 actual
    ─────────────────────────────────────────────────────────────────
8.  HISTORIAL
8a.   Créditos (paginado, con `note` cuando la hay)
8b.   Bumps    (paginado)
```

### 5.3 Los seis cambios, con su porqué

**(a) El saldo, arriba y junto.** Hoy las dos monedas están separadas por una lista de
packs y un historial completo de por medio; para ver los dos números hay que hacer scroll
por media página. Están relacionadas (se gastan en lo mismo, con prioridad entre ellas),
así que se leen juntas. La franja no cuesta un dato nuevo: son los dos campos que `getWallet`
ya devuelve.

**(b) El cupón baja.** El defecto de orden más claro de la página. Es una acción para quien
**ya trae un código** —una minoría—, y ocupa el sitio de la cifra que todos vienen a ver.
No se oculta ni se quita: baja a donde vive el resto de «cosas que puedo hacer aquí».

**(c) Los costes, al lado del saldo.** «150 créditos ≈ 30 bumps o 5 destacados de 7 días»
convierte una cifra abstracta en capacidad. Los números salen del catálogo que **ya se pide**
(§4.2), aplicando `bumpCreditCost` y los `creditCost` de destacado — descuento de campaña
incluido, gratis, porque el catálogo ya los sirve descontados. Es la corrección de mayor
relación valor/coste del documento.

**(d) La cuota Pro entra en la franja.** Es la primera bolsa que se gasta al bumpear (§4.3):
omitirla hace que la página mienta por omisión sobre lo que el usuario puede hacer sin
pagar. No hay que duplicar `/perfil/suscripcion`: bastan las dos cifras de `remaining`, con
enlace a la página del plan para el detalle. Y resuelve de paso §4.4 — un Pro ve que lo es.

**(e) La campaña, dos veces y sin redundancia.** Como **aviso de contexto** encima de los
packs (qué campaña, cuánto, hasta cuándo — lo que una tarjeta no puede contar) y como
**número concreto en cada tarjeta** (cuántos créditos exactos con ESE pack). El aviso
explica; la tarjeta cuantifica. Sin el primero, «+20» aparece sin causa; sin el segundo, el
usuario tiene que multiplicar.

**(f) Fusionar «Créditos» y «Bumps» como secciones de primer nivel.** Hoy la página son dos
bloques verticales simétricos, cada uno con saldo + compra + historial. La simetría es
elegante y **es lo que rompe la jerarquía**: obliga a leer el historial de créditos antes de
llegar al saldo de bumps, y presenta un historial (detalle) al mismo nivel que un saldo
(primario). Reagrupar por **tarea** (mirar / comprar / consultar) en vez de por **moneda**
mantiene toda la información y la ordena por importancia. El párrafo explicativo de la
diferencia entre monedas se conserva, pegado a la franja de saldos, que es donde se
necesita.

---

## §6 — El plan de ráfagas

**Dos ráfagas.** Se pueden separar limpiamente porque tocan cosas distintas (backend +
tarjetas vs. layout), y porque la primera es **medible y binaria** (¿se ve la campaña antes
de comprar? sí/no) mientras la segunda es de criterio. Hacerlas juntas mezclaría un cambio
verificable con uno opinable en el mismo diff.

### Ráfaga A — La campaña, visible antes de comprar

*El ajuste 1. Backend + las dos listas de packs. No toca el orden de la página.*

1. **Extraer `campaign-bonus.ts`**, hermano de `pro-bonus.ts`, con la fórmula
   (`PERCENT → ceil(base*value/100)`, `FIXED → value`) y su tope. Hacer que
   `createCreditPackCheckout` y `createBumpPackCheckout` la llamen en vez de calcularla a
   mano. **Esto va primero**: sin ello, el catálogo sería una tercera copia.
2. **Ampliar `getCatalog()`**: llamar a `getActiveCreditBonusCampaign()` y
   `getActiveBumpBonusCampaign()`, publicar `campaignBonusAmount` por pack (créditos y
   bumps) y el contexto de la campaña (nombre + `endsAt`) a nivel de respuesta. Sigue el
   molde exacto de `proBonusAmount` y de `bumpDiscountPercent`.
3. **Tipar en `lib/api/billing.ts`** — campos **opcionales**, como `proExtraCreditsPercent`,
   para que un backend anterior no rompa la página.
4. **Pintar en `PackList` y `BumpPackList`**: la línea de bonus de campaña junto a la de
   Pro, y el total cuando hay ambos. Sin recalcular nada en cliente.
5. **El aviso de campaña activa** encima de los packs, en la página.
6. **Escribir `note` en las filas `CAMPAIGN_BONUS`** del processor, con el nombre de la
   campaña — para que el historial diga cuál (cierra el «Crear» de §4.5).
7. **Tests**: unitario de la fórmula extraída (los tres tipos de campaña × PERCENT/FIXED);
   test de `getCatalog()` con campaña activa y sin ella; test de render de `PackList` con
   Pro × campaña (las cuatro combinaciones). El e2e existente
   (`apps/web/e2e/mis-creditos.spec.ts`) usa datos reales del backend en SSR, así que
   conviene mirar si hay que sembrar una campaña o cubrirlo en unitario.

### Ráfaga B — La organización

*El ajuste 2. Frontend puro. Ningún endpoint nuevo: usa lo que la ráfaga A ya expuso más lo
que ya llegaba sin pintarse.*

1. **La franja de saldo** arriba: créditos + bumps + cuota Pro (si `isPro`).
2. **Los equivalentes de coste** en la franja, derivados de `catalog.bumpCreditCost` y los
   `creditCost` de destacado.
3. **Reagrupar** las secciones por tarea (saldo / comprar / gestionar / historial) en vez de
   por moneda.
4. **Bajar** el formulario de cupón; **bajar** «Bumps programados» a la zona de gestión.
5. **Pintar `note`** en las filas del historial de créditos.
6. **Tests**: render de la franja con y sin Pro; que el historial muestre la nota cuando la
   hay.

**Dependencia:** B se apoya en el aviso de campaña que introduce A, pero no lo requiere
técnicamente. Si hubiera que invertir el orden, se puede — aunque tiene poco sentido
reorganizar una página para hacer sitio a algo que aún no existe.

---

## §7 — Las barreras

Cómo se sabe que el trabajo está terminado. Cada una es comprobable, no opinable.

**B1 — La campaña se ve antes de pagar.** Con una campaña `CREDIT_BONUS` activa, un usuario
anónimo o logueado que abre `/mis-creditos` ve, **sin pulsar nada**: el nombre de la
campaña, hasta cuándo dura, y cuántos créditos extra le da **cada pack concreto**. Lo mismo
para `BUMP_BONUS` en los packs de bumps.

**B2 — El número que se enseña es el que se acredita.** El bonus mostrado sale de la **misma
función** que congela el checkout. No existe una segunda copia de la fórmula en el camino
del catálogo. Verificable: `grep` de `ceil(` sobre campañas devuelve **un solo** sitio en
`apps/api/src`.

**B3 — El bonus Pro no se rompe.** Sigue viéndose exactamente como hoy, en las cuatro
combinaciones (Pro/no-Pro × con campaña/sin campaña). Un Pro comprando durante una campaña
ve **los dos** regalos y un total que es su suma — porque es lo que el checkout va a
congelar.

**B4 — Sin campaña, la página no cambia.** Cero campañas activas ⇒ ni aviso, ni línea en las
tarjetas, ni hueco vacío. Mismo criterio de degradación que ya aplica
`bumpOriginalCreditCost`.

**B5 — El saldo es lo primero.** En un viewport de 375×667, sin scroll, el usuario ve su
saldo de créditos y su saldo de bumps. Ninguna caja de entrada de texto aparece por encima
de ellos.

**B6 — Nada que exista se queda sin mostrar.** Los cuatro casos de §4 quedan pintados: el
`note` del ledger, los costes, las cuotas Pro, la condición Pro. Verificable recorriendo el
payload de `getWallet` + `getCatalog` + `getProStatus` campo a campo contra lo que la página
renderiza. (`getMyEntitlements` queda **explícitamente fuera de alcance**: los destacados
vigentes son estado de un anuncio, no de la cartera, y viven en `/mis-anuncios`.)

**B7 — La degradación se mantiene.** Los seis `.catch()` de `page.tsx` siguen ahí y siguen
dejando la página útil: si el catálogo falla, el saldo se ve igual; si `pro-status` falla,
la franja pinta sin la columna de cuota. Ninguna de las adiciones puede tumbar la página.

---

## Anexo — Ubicaciones verificadas

| Qué | Dónde |
|-----|-------|
| Página (Server Component, 6 fetches) | [mis-creditos/page.tsx](apps/web/src/app/(account)/mis-creditos/page.tsx) |
| Tarjetas de pack de créditos | [_components/PackList.tsx](apps/web/src/app/(account)/mis-creditos/_components/PackList.tsx) |
| Tarjetas de pack de bumps | [_components/BumpPackList.tsx](apps/web/src/app/(account)/mis-creditos/_components/BumpPackList.tsx) |
| Historiales + etiquetas del ledger | [_components/Historiales.tsx](apps/web/src/app/(account)/mis-creditos/_components/Historiales.tsx) |
| Formulario de cupón | [_components/RedeemCouponForm.tsx](apps/web/src/app/(account)/mis-creditos/_components/RedeemCouponForm.tsx) |
| `getWallet` / `getBumpLedger` | [billing.service.ts:882](apps/api/src/modules/billing/billing.service.ts#L882) / [:926](apps/api/src/modules/billing/billing.service.ts#L926) |
| `getCatalog` (y su consulta de campañas) | [billing.service.ts:959](apps/api/src/modules/billing/billing.service.ts#L959) |
| Fórmula del bonus Pro (única) | [billing/pro-bonus.ts](apps/api/src/modules/billing/pro-bonus.ts) |
| Lectores de campaña activa | [campaigns.service.ts:46-94](apps/api/src/modules/campaigns/campaigns.service.ts#L46-L94) |
| Cálculo del bonus de campaña (2 copias) | [redsys.service.ts:134](apps/api/src/modules/redsys/redsys.service.ts#L134), [:238](apps/api/src/modules/redsys/redsys.service.ts#L238) |
| Acreditación del bonus | [redsys.processor.ts:178](apps/api/src/modules/redsys/redsys.processor.ts#L178), [:269](apps/api/src/modules/redsys/redsys.processor.ts#L269) |
| Orden de consumo al bumpear | [billing.service.ts:779-859](apps/api/src/modules/billing/billing.service.ts#L779-L859) |
| `note` de campaña en débitos | [billing.service.ts:616](apps/api/src/modules/billing/billing.service.ts#L616), [:855](apps/api/src/modules/billing/billing.service.ts#L855) |
| Precedente: descuento visible | [owner/promocion.ts:86-89](apps/web/src/components/anuncios/owner/promocion.ts#L86-L89) |
| Espejo de fórmulas (solo admin) | [lib/campaigns/effect-preview.ts](apps/web/src/lib/campaigns/effect-preview.ts) |
| Cuotas Pro pintadas (otra página) | [perfil/suscripcion/page.tsx:140-150](apps/web/src/app/(account)/perfil/suscripcion/page.tsx#L140-L150) |
| CRUD de campañas (admin-only) | [campaigns.controller.ts](apps/api/src/modules/campaigns/campaigns.controller.ts) |
| E2E existente de la página | [e2e/mis-creditos.spec.ts](apps/web/e2e/mis-creditos.spec.ts) |
