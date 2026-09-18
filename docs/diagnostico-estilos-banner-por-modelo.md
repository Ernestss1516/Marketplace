# DIAGNÓSTICO — LOS TRES ESTILOS DE BANNER (info / promo / aviso) ANTE EL SISTEMA DE ESTILO

> **Estado: diagnóstico cerrado.** El encargo partía de una sospecha —«hoy probablemente
> usan colores fijos que no responden al modelo»— y **la medición contra el código dice que
> no**. El defecto es otro, más pequeño de perímetro y más grande de consecuencia. Este
> documento deja las dos cosas por escrito, porque la sospecha era razonable y saber por
> qué no se cumple es lo que evita volver a perseguirla.

---

## 0. El veredicto, antes de los detalles

**Los tres estilos ya usan tokens semánticos. Ninguno tiene un color fijo.**
[`BannerList.tsx:13-17`](../apps/web/src/components/banners/BannerList.tsx#L13-L17):

```ts
const VARIANT_STYLES: Record<BannerVariant, string> = {
  INFO:    'border-info-border    bg-info    text-info-foreground',
  PROMO:   'border-success-border bg-success text-success-foreground',   // ← prestado
  WARNING: 'border-warning-border bg-warning text-warning-foreground',
};
```

Dos de los tres están bien. El tercero es el hallazgo:

| Estilo | Token que usa | Veredicto |
|---|---|---|
| **Info** | `--info` / `-border` / `-foreground` | ✔ Correcto, es el suyo |
| **Aviso** | `--warning` / `-border` / `-foreground` | ✔ Correcto, es el suyo |
| **Promo** | `--success` / `-border` / `-foreground` | ✗ **No es el suyo: es el de «ha ido bien»** |

Y hay un segundo hallazgo, en el sitio menos esperado: **el único color fijo de toda esta
historia está dentro del panel que existe para enseñar el sabor del modelo** (§4).

---

## 1. Por qué «que respondan al modelo» no significa lo que el encargo supone

Esto hay que zanjarlo antes del arreglo, porque cambia lo que el arreglo debe hacer.

El registro de modelos separa tres clases de token, y los semánticos son su propia clase
con una regla escrita ([`estilo.constants.ts:25-27`](../apps/api/src/modules/estilo/estilo.constants.ts#L25-L27)):

> `semanticos` — error, aviso, éxito, información y las convenciones. **FIJOS por modelo
> (decisión #2): que «error» sea rojo no es marca, es una convención que el usuario ya
> conoce.**

Y no es sólo la intención: es lo que hacen los cinco modelos del catálogo.

| Modelo | Qué declara en `semanticos` |
|---|---|
| `modelo-0` | El juego base |
| `calido-editorial` | `{ ...MODELO_0.semanticos, destructive: '0 84.2% 46%' }` — **sólo** el rojo |
| `fresco-confianza` | `{ ...MODELO_0.semanticos }` — idéntico |
| `premium` | `{ ...MODELO_0.semanticos }` — idéntico |
| `vibrante` | `{ ...MODELO_0.semanticos }` — idéntico |

O sea: **info y aviso no cambian con el modelo hoy, y es a propósito.** Un aviso amarillo y
una información azul son convenciones que el usuario trae aprendidas de fuera de esta
plataforma; teñirlas con la marca de cada modelo las haría más bonitas y menos legibles.

**Sí cambian con la VERSIÓN**, y ahí el sistema ya funciona: `premium@oscuro` sustituye el
juego entero por `SEMANTICOS_OSCUROS` ([`estilo.constants.ts:507-524`](../apps/api/src/modules/estilo/estilo.constants.ts#L507-L524)),
y los tres banners se dan la vuelta con él sin tocar una línea de `.tsx`. Eso es E14
funcionando exactamente como se diseñó.

**Consecuencia para el arreglo:** «que los tres reviertan el sabor del modelo» no se cumple
volviendo info y aviso dependientes del modelo —eso sería romper la decisión #2 y la
convención—. Se cumple con **promo**, que es justamente el que no es una convención.

---

## 2. El defecto: promo no tiene token y toma prestado el de «éxito»

### 2.1 Por qué es un defecto y no una economía

`--success` no está libre. Se usa en **doce sitios** para decir «ha ido bien», de verdad:

| Dónde | Qué dice |
|---|---|
| [`admin/reportes/page.tsx:216`](../apps/web/src/app/(admin)/admin/reportes/page.tsx#L216) | reporte **resuelto** |
| [`admin/blog/[id]/editar/page.tsx:243`](../apps/web/src/app/(admin)/admin/blog/[id]/editar/page.tsx#L243) | **guardado** |
| [`login/page.tsx:73`](../apps/web/src/app/(auth)/login/page.tsx#L73) | operación **completada** |
| [`ReportButton.tsx:48`](../apps/web/src/components/anuncios/ReportButton.tsx#L48) | reporte **enviado** |
| [`SellerCard.tsx:51`](../apps/web/src/components/anuncios/SellerCard.tsx#L51) | vendedor **verificado** |
| … | … |

Un banner de PROMO —«20 % de descuento esta semana»— sale pintado **exactamente igual que
un “se ha guardado”**. No es que quede feo: es que el color está diciendo otra cosa.

Y el propio registro ya trata esto como defecto cuando le toca. El token `--pending` existe
por este motivo literal ([`globals.css:172-176`](../apps/web/src/app/globals.css#L172-L176)):

> Colapsarlo en otro dejaría **dos estados distintos pintados igual, que es perder
> información** en la pantalla donde el agente decide qué hacer.

Promo y éxito son dos cosas distintas pintadas igual. Es el mismo argumento, sin aplicar.

### 2.2 El mismo préstamo, una vez más

[`CampaignNotice.tsx:32`](../apps/web/src/app/(account)/mis-creditos/_components/CampaignNotice.tsx#L32)
—el aviso de campaña de bonificación, que es una promoción de manual— también va con
`border-success-border bg-success`. Mismo préstamo, mismo motivo: no había otra cosa.

### 2.3 Por qué promo es, además, el que DEBE llevar el sabor

Info dice «entérate». Aviso dice «ojo». Las dos son señales de estado, y su color es
convención. **Promo dice «te ofrecemos algo», que es la plataforma hablando en su propia
voz** — es lo más cercano a marca que hay entre los tres. Si algo de los tres tiene que
cambiar de un modelo a otro, es éste.

---

## 3. Lo que ya está bien y no hay que tocar

Conviene decirlo para que el arreglo no se lleve por delante cosas que funcionan:

- **La estructura ya es común.** Los tres estilos comparten la misma cadena de forma
  —`flex items-start justify-between gap-3 rounded-md border px-4 py-3`— y el estilo sólo
  añade color. La frontera «reviste, no reorganiza» **ya se cumple**, y el arreglo no la
  toca: sigue siendo una tabla de tres entradas de color.
- **La validación AA ya cubre los tres**, para cada modelo y cada versión
  ([`contraste-modelos.spec.ts:59-64`](../apps/api/src/modules/estilo/contraste-modelos.spec.ts#L59-L64)):
  mide la letra sobre la superficie suave **y** sobre la plena, y para promo medirá el token
  nuevo en cuanto exista, sin tocar el test.
- **Hay dos redes que obligan a que un token nuevo sea completo**, y son las que convierten
  esto en un cambio seguro:
  - «todos los modelos declaran EXACTAMENTE los mismos tokens» — si un modelo se queda sin
    promo, CI cae;
  - «cada VERSIÓN declara exactamente los mismos tokens que su modelo» — si `premium@oscuro`
    se olvida del promo oscuro, CI cae.
- **`globals-espejo.spec.ts`** obliga a que `globals.css` y el registro no divergan: el
  token nuevo tiene que estar escrito en los dos sitios o CI cae.

---

## 4. El color fijo que sí existe, y está en el peor sitio posible

[`PreviaDelTema.tsx:105-107`](../apps/web/src/app/(admin)/admin/estilo/_components/PreviaDelTema.tsx#L105-L107)
—el panel de `/admin/estilo` cuyo trabajo entero es enseñar cómo queda el modelo elegido—
pinta su banner de muestra así:

```tsx
<div className="... border-amber-500/50 bg-amber-500/10 ...">
  <AlertTriangle className="... text-amber-600" />
  <span>Un banner de aviso, el que aparece 29 veces en el backoffice.</span>
</div>
```

**Ámbar fijo de Tailwind.** Los botones de al lado usan `bg-primary`, `bg-secondary`,
`bg-accent`, `bg-destructive`; la tarjeta usa `bg-card`. Todo el panel gira con el tema
menos el banner, que se queda ámbar en los cinco modelos y en oscuro.

Es el defecto que el encargo iba a buscar, en el único sitio donde de verdad estaba — y el
que más engaña, porque es la pantalla desde la que se juzga un modelo. Además **miente
sobre el componente que dice representar**: el aviso real (`Aviso.tsx`, las 29 copias del
backoffice) usa `--warning`, no ámbar.

---

## 5. Resumen del diagnóstico

| # | Hallazgo | Gravedad |
|---|---|---|
| 1 | Los tres banners ya usan tokens semánticos, no colores fijos | — (la sospecha del encargo no se cumple) |
| 2 | **Promo no tiene token propio: toma `--success`**, que significa «ha ido bien» y se usa así en 12 sitios | **Alta** — el color dice lo que no es |
| 3 | `CampaignNotice` repite el mismo préstamo | Media |
| 4 | Info y aviso no cambian con el modelo **por decisión #2**, y sí con la versión (E14) | — (es el diseño, no un fallo) |
| 5 | **El banner de la previa de `/admin/estilo` es ámbar fijo** y no gira con el tema | **Alta** — es la pantalla donde se juzga el modelo |

---

## 6. La propuesta para promo — y la trampa que tiene la opción obvia

El encargo deja abierto qué token debe usar promo, con tres candidatos: `primary`, `accent`
o uno propio. Medidos contra el sistema:

### Opción A — promo derivado del `primary` del admin

Lo obvio, y con precedente en el repo (`--hero-ambiente: hsl(var(--primary) / 0.05)`).
Promo giraría con la marca **y** con el modelo, que es literalmente lo que pide el encargo.

**Y tiene una trampa que la descarta: el primario por defecto del Modelo 0 es AZUL**
(`221.2 83.2% 53.3%`), y `--info` es azul (`#eff6ff` sobre `#1e40af`). Un promo derivado del
primario saldría **azul pálido al lado del info azul pálido**: los dos estilos que el
usuario tiene que distinguir quedarían casi iguales, y precisamente con la paleta de
fábrica. Choca de frente con «los tres diferenciados entre sí».

### Opción B — `accent`

Descartada por dato: en el Modelo 0, `--accent` vale `210 40% 96.1%` — **un gris**. Es el
resalte de hover de shadcn, no un color de marca. Un promo gris no es un promo.

### Opción C — token propio `--promo`, declarado por cada modelo ← **la propuesta**

Una familia `--promo` / `-surface` / `-border` / `-foreground`, con la **misma forma** que
info y aviso, y con **un valor por modelo** (como `calido-editorial` ya hace con su rojo) y
uno por versión oscura. Esto:

- lo **diferencia** de info (azul), aviso (amarillo), éxito (verde), error (rojo) y
  `pending` (morado) — queda libre la familia magenta/rosa, que además se lee como oferta;
- lo hace **responder al modelo**, que es lo que se pedía, sin romper la decisión #2 para
  info y aviso;
- entra solo en la **validación AA** existente y en las dos redes de paridad de tokens;
- mantiene la **estructura común**: sigue siendo superficie suave + trazo + texto oscuro.

El tono concreto de cada modelo es una decisión visual, y va al diff.

---

## 7. Lo aplicado

### 7.1 Los cinco magentas — medidos, no elegidos a ojo

`--promo` con cuatro roles (suave, plena, trazo, letra), la misma forma que `--info`. Sin
`-solid` ni `-solid-hover`: **no existe el «botón promo»**, y dos tokens que nadie consume
son exactamente lo que la barrera de paridad vigila en el otro sentido.

| Modelo | suave | plena | trazo | letra | letra/suave | letra/plena | H(letra) |
|---|---|---|---|---|---|---|---|
| `modelo-0` | `#fdf4ff` | `#fae8ff` | `#f5d0fe` | `#86198f` | **7,67** | **7,08** | 295° |
| `calido-editorial` | `#fdf2f8` | `#fce7f3` | `#fbcfe8` | `#9d174d` | **7,22** | **6,71** | 336° |
| `fresco-confianza` | `#fbf3fe` | `#f4e2fd` | `#e6bcfa` | `#7b1c9e` | **7,74** | **6,85** | 284° |
| `premium` | `#faf5fb` | `#f2e6f5` | `#ddc3e4` | `#6b2d6b` | **8,82** | **7,87** | 300° |
| `vibrante` | `#fff0fc` | `#fbd5f1` | `#f472c4` | `#8a1259` | **8,27** | **6,87** | 325° |
| `premium@oscuro` | `#2b0b33` | `#4a1259` | `#a21caf` | `#f5d0fe` | **12,80** | **10,08** | — |

Todos por encima del 4,5:1 que exige 1.4.3, y en el rango de lo que ya daban info
(8,01 / 7,15) y aviso (6,62 / 6,38). No es una comprobación hecha una vez: cada uno de esos
números lo vuelve a medir `contraste-modelos.spec.ts` en cada corrida, por modelo y por
versión.

**Cada modelo con su temperatura, y con el mismo criterio que usa para todo lo demás:**
cálido-editorial lo calienta hacia el rosa para convivir con su barro; fresco-confianza lo
enfría (284°, el más frío de los cinco); premium lo desatura hasta una ciruela que no
compite con su bronce; vibrante lo sube a su propio magenta de marca (su primario ya es
330°) y engorda el trazo hasta 2,38:1 contra el 1,28 del Modelo 0.

> **Corrección durante la implementación.** La primera paleta daba a tres modelos el mismo
> fondo suave (`#fdf4ff`), variando sólo trazo y letra. La barrera en navegador la tumbó
> —pedía cinco promos distintos y encontró tres—, y tenía razón: **el fondo es lo más
> visible de un banner**, y tres modelos con el mismo fondo no son tres sabores. Se
> rehicieron los de `fresco-confianza` y `vibrante`. El test estaba bien; la paleta, no.

### 7.2 Los consumidores

| Fichero | Antes | Ahora |
|---|---|---|
| [`BannerList.tsx`](../apps/web/src/components/banners/BannerList.tsx) | `PROMO` con los tokens de `success` | `--promo` |
| [`CampaignNotice.tsx`](../apps/web/src/app/(account)/mis-creditos/_components/CampaignNotice.tsx) | `bg-success` | `--promo` |
| [`PreviaDelTema.tsx`](../apps/web/src/app/(admin)/admin/estilo/_components/PreviaDelTema.tsx) | **un** banner con `bg-amber-500/10` fijo | **los tres**, con sus tokens |

La previa pasa de uno a tres a propósito: lo que hay que poder juzgar antes de guardar un
modelo es que los tres **se distingan entre sí** y que peguen con el resto del tema, y con
uno solo no se ve ni lo uno ni lo otro.

### 7.3 Lo que NO se tocó, y por qué

- **Info y aviso siguen sin cambiar con el modelo.** Es la decisión #2, y ahora está
  además *defendida*: la barrera en navegador exige que los cinco modelos claros den el
  mismo azul y el mismo amarillo. Si alguien los tiñe «para que peguen», CI cae.
- **La estructura.** La cadena de forma sigue siendo una sola para los tres, y hay un test
  que compara las tres cadenas sin su color y exige que sean idénticas.
- **`--success`** se queda donde estaba, haciendo lo suyo en sus doce sitios.
