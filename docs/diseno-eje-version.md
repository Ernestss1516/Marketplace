# Diseño — E14: la versión DERIVA (foco, semánticos, zonas, luminosidad)

> **Qué es este documento.** La arquitectura concreta y el plan de ráfagas para ampliar el
> eje de versión, sobre la frontera aprobada en
> [`auditoria-eje-version.md`](auditoria-eje-version.md). **Documento, cero código. No
> implementa nada.**
>
> **La frontera aprobada es el marco: este diseño la desarrolla, no la reabre.**
> «Un MODELO ELIGE, una VERSIÓN DERIVA». El alcance está acotado a **54 de los 60
> tokens**: foco, semánticos, zonas y luminosidad. **La marca queda fuera** (§8).
>
> **El número es E14 y no E13**, que está ocupado en el código por la ráfaga que hizo que
> la versión entrara en la resolución.
>
> Todo dato del estado actual está verificado contra los ficheros en esta sesión. **Cuatro
> hallazgos nuevos aparecieron al diseñar** y cambian el plan: están marcados con ⚠ y
> resumidos en el §0.2.

---

## 0. El marco, y lo que este diseño añade

### 0.1 Lo aprobado (no se reabre)

| | Decisión |
|---|---|
| **La frontera** | El modelo **elige** los 4 colores, los 2 candidatos a letra y la identidad. La versión **deriva**: qué sale de esos 4 |
| **El alcance** | La versión redefine **foco + semánticos + zonas + luminosidad** = 54 de 60 tokens |
| **Fuera** | La **marca** (`primary`/`secondary`/`accent` + sus 3 letras) sigue siendo del modelo. §8 |
| **#2 intacta** | El admin sigue aportando 4 valores y ningún `-foreground`. #2 reparte **admin/código**, no modelo/versión |
| **#1 intacta** | E14 **no** es el modo oscuro: no hay preferencia de usuario, ni `prefers-color-scheme`, ni conmutador. El admin elige una versión, y ésa es el tema de la instancia |

### 0.2 Los cuatro hallazgos que aparecieron al diseñar

| ⚠ | Hallazgo | Dónde | Efecto en el plan |
|---|---|---|---|
| **1** | **El hueco del anillo está en otro sitio del que la auditoría supuso.** 9 de los 10 componentes con anillo llevan `ring-offset-background`: entre el elemento y el anillo hay una banda de `--background`, así que la medición de hoy **sí** mide el vecino correcto. El hueco real son **71 usos con anillo y SIN banda**, donde el anillo toca la superficie de verdad | `components/ui/*.tsx`, 71 usos en el resto | Cambia **qué parejas** se añaden y **por qué** (§3.4) |
| **2** | **`badge.tsx` lleva `ring-offset-2` sin `ring-offset-background`**: su banda es el blanco por defecto de Tailwind, escrito a fuego. Es el **único** de los diez | [badge.tsx:7](../apps/web/src/components/ui/badge.tsx#L7) | Un arreglo de una clase, **no-op en claro** (§3.5) |
| **3** | **Los ajustes de zona NO pueden girar solos con la luz.** «Restar» es aritmética distinta en cada polaridad: en claro es *aclarar y desaturar*; en oscuro, `MODELO_PRUEBA` sólo *desatura* y deja la luz quieta. Un solo juego de desplazamientos no da las dos | `MODELO_PRUEBA.ajustesPorZona` vs los 3 claros | La versión **re-declara** sus zonas; la barrera verifica que lo hizo (§5.2) |
| **4** | **Añadir una pareja bloqueante pone rojo `parejas-espejo.spec.ts`** si no se le da su campo en `COLOR_CULPABLE` del frontend | [parejas-espejo.spec.ts:84](../apps/api/src/modules/estilo/parejas-espejo.spec.ts#L84) | La ráfaga A toca **un `.ts` de `apps/web`**, y hay que contarlo (§9) |

Y un hallazgo que **quita** trabajo: **las ilustraciones se ven mejor en oscuro que en
claro** y no hace falta un juego propio (§7.3).

---

# PARTE I · EL MECANISMO

## 1. La luminosidad — ya funciona, y no se toca

**Confirmado midiendo:** una versión que sólo redefine la rampa —lo que ya puede hoy—
produce un lienzo oscuro que resuelve sin pestañear y pasa **ocho de las nueve** parejas
bloqueantes. La única que falla es el anillo.

```
premium@oscuro (sólo rampa):  background 220 24% 8% · foreground 220 16% 95%
                              card 220 20% 13% · popover 220 20% 16%
                              muted 220 18% 20% · muted-foreground 220 12% 70%
fallos: [ anillo de foco sobre el fondo → 1,85 ]
```

Lo hace posible la decisión de E4a que más pensamiento llevó: **la luz de cada franja es
absoluta, no un desplazamiento**. Por eso una rampa puede decir «lienzo al 8 %» sin que el
neutro que elija el admin lo suba.

> **E14 no cambia nada de esto.** Lo que E14 hace es que **lo que depende de la luz la
> siga**: el foco, los semánticos y las zonas.

## 2. La forma del mecanismo

### 2.1 Los tres campos nuevos de `AjustesDeVersion`

Hoy `AjustesDeVersion` tiene exactamente dos campos. Tras E14, cinco:

| Campo | Hoy | Forma | Qué gobierna |
|---|---|---|---|
| `rampa` | ✅ | mezcla parcial por franja | los 10 de la rampa |
| `ejes` | ✅ | mezcla parcial por clave | los 13 ejes T2 |
| **`foco`** | — | **una derivación** `{dh?, ds?, dl?}` sobre `primary` | `ring` |
| **`semanticos`** | — | mezcla parcial por clave | los 30 semánticos |
| **`ajustesPorZona`** | — | mezcla parcial **por token dentro de cada zona** | los 5 bloques de zona |

**Los cinco son opcionales, y eso es la garantía de que E14 no mueve un píxel:** una
versión que no declare ninguno resuelve exactamente como hoy, y las versiones actuales no
declaran ninguno.

### 2.2 La regla que gobierna los cinco: mezclar ANTES de derivar

Es la frase del paso 0 de `resolverTokens`, y se conserva literal:

> *«una versión cambia la REGLA (la franja), no el color ya calculado — si parcheara el
> resultado, dejaría de girar con el neutro que elija el admin, que es todo el sentido de
> la rampa»*
> — [estilo.constants.ts:1784-1786](../apps/api/src/modules/estilo/estilo.constants.ts#L1784-L1786)

Aplicada a los tres campos nuevos:

- **el foco** es una derivación sobre el `primary` del admin, **nunca un color**. Si el
  admin cambia su azul por un rojo, el anillo de la versión oscura es ese rojo aclarado;
- **los semánticos** sí son literales, y es la única excepción — está justificada en §4.1;
- **las zonas** son literales, como ya lo son hoy en los cuatro modelos.

### 2.3 `resolverTokens`, después

```
0 · MEZCLAR lo de la versión sobre lo del modelo
      rampa ← {…modelo.rampa,  …version.rampa}
      ejes  ← {…modelo.ejes,   …version.ejes}
      sem   ← {…modelo.semanticos, …version.semanticos}      ← NUEVO
      foco  ← version.foco                                    ← NUEVO

1 · RAMPA        ← igual que hoy, con la rampa MEZCLADA
2 · MARCA        ← igual que hoy, SIN CAMBIO (la marca no se deriva en E14)
                   los 3 colores del admin tal cual + mejorTextoSobre para sus letras
3 · FOCO         ← primary con `foco` aplicado, si la versión lo declara;
                   si no, primary tal cual — exactamente como hoy
4 · SEMÁNTICOS   ← los MEZCLADOS     ·    EJES ← los mezclados (ya hoy)
```

`resolverZona` **no cambia de forma**: ya recibe la versión y ya resuelve la base con ella
([estilo.constants.ts:1825](../apps/api/src/modules/estilo/estilo.constants.ts#L1825)).
Lo único que cambia es de dónde lee el bloque de zona — de la mezcla en vez del modelo.

### 2.4 Las cuatro invariantes que no se pueden perder

1. **Sin `version`, el resultado es idéntico al de hoy.** Es lo que protege al Modelo 0 y
   con él las **50 capturas** de la batería visual.
2. **Con una versión que no declara los campos nuevos, el resultado es idéntico al de
   hoy.** Es lo que protege a los siete pares del catálogo actual — el criterio de
   aceptación de la ráfaga A.
3. **El juego de nombres sigue siendo 60.** Hoy `contraste-modelos.spec.ts:255` lo exige a
   los cinco modelos. **Tras E14 hay que exigirlo por VERSIÓN**: una versión que escriba
   mal el nombre de un semántico añadiría un token 61 que nadie consume y que nada
   delataría. Es el gemelo de `zonaSoloAjusta` en el eje de versión (§6.4).
4. **Se mezcla antes de derivar.** §2.2.

---

# PARTE II · LAS TRES DERIVACIONES

## 3. El FOCO

### 3.1 Por qué una derivación y no un literal

Una zona `login` puede fijar `ring: '42 62% 62%'` porque afecta a **una pantalla de
servicio**. Una versión afecta a **la plataforma entera**. Si una versión fija el anillo a
un color, el admin cambia su primario y **el foco se queda donde estaba, en todas las
pantallas**: la promesa «el anillo sigue al color principal» se rompe en silencio y para
todo el mundo.

**La forma:** desplazamientos sobre `primary`. Es la misma gramática que la rampa ya usa
con el neutro, y tiene la propiedad que importa: **gira con lo que el admin elija.**

### 3.2 Los números — Premium Oscuro como caso de referencia

Medido sobre el marino de fábrica de Premium (`220 45% 30%`) y el lienzo carbón:

| Derivación | Anillo | sobre el lienzo | sobre la tarjeta | sobre la capa flotante |
|---|---|---|---|---|
| sin declarar (hoy) | `220 45% 30%` | **1,85 ❌** | **1,64 ❌** | ❌ |
| `dl: +20` | `220 45% 50%` | 3,64 ✅ | 3,22 ✅ | **2,96 ❌** |
| `dl: +30` | `220 45% 60%` | 5,39 ✅ | 4,78 ✅ | ✅ |
| **`dl: +40`** | `220 45% 70%` | **7,68 ✅** | **6,81 ✅** | ✅ |

**Recomendación: `dl: +40`.** No es el mínimo que cumple, y a propósito: el mínimo deja
al admin sin margen para mover su primario ni un punto. Es el mismo criterio con el que el
Modelo 0 puso `--input` al 60 % de luz en vez del 60,8 % que cumplía justo.

### 3.3 ⚠ El hueco del anillo: dónde está de verdad

**La auditoría dio por hecho que el anillo se dibuja contra la superficie que hay
debajo. En 9 de los 10 componentes de `ui/`, no.**

Los diez llevan `focus-visible:ring-2 ring-ring ring-offset-2`, y **nueve de ellos llevan
además `ring-offset-background`**: entre el elemento y el anillo hay una banda de 2 px
pintada con `--background`. O sea que **el vecino inmediato del anillo es `--background`**,
esté el componente donde esté — y eso es exactamente lo que
`['anillo de foco sobre el fondo', t.background, t.ring]` mide hoy. **Para esos nueve, la
barrera actual es correcta y no hay hueco.**

**El hueco está en los otros 71.** Medido en `apps/web/src`:

| Familia | Cuántos | Qué pinta | ¿La barrera de hoy la cubre? |
|---|---|---|---|
| **A** — `ring-offset-background` + `ring-offset-2` | **9 ficheros** de `ui/` + 2 de features | banda de `--background`, luego el anillo | ✅ **sí** |
| **B** — `ring-2 ring-ring` **sin banda ninguna** | **71 usos**, en 25+ ficheros: los campos a medida del backoffice, los cuatro formularios de auth, `/admin/login`, `FilterPanel`, `SearchBar`… | el anillo toca **la superficie real** — casi siempre una `Card` | ❌ **no** |
| **C** — `ring-offset-2` **sin** `ring-offset-background` | **1**: `badge.tsx` | banda del **blanco por defecto de Tailwind**, a fuego | ❌ **no**, y en oscuro es un halo blanco |

La familia B es la mayoritaria y es la que justifica ampliar la barrera. **En claro nunca
podía morder** —la tarjeta y el lienzo casi coinciden—; en oscuro la tarjeta es **más
clara** que el lienzo y pasa a ser la superficie difícil.

### 3.4 Lo que se añade a la validación AA

**Bloqueantes (nuevas):**

| Pareja | Umbral | Peor caso del catálogo actual |
|---|---|---|
| `anillo de foco sobre la tarjeta` | 3:1 | **4,85** — `calido-editorial@dia/blog` ✅ |
| `anillo de foco sobre la capa flotante` | 3:1 | **4,89** — `calido-editorial@tarde/public` ✅ |

Medido sobre **los 8 pares modelo×versión × las 5 zonas = 40 combinaciones**: ninguna baja
de 4,85. **Añadirlas no pone rojo nada de lo que existe**, que es la condición para que
entren en una ráfaga sin cambio visual.

**De AVISO, no bloqueantes:**

| Pareja | Peor caso | Por qué no bloquea |
|---|---|---|
| `borde de campo sobre la tarjeta` | **3,03** — `calido-editorial@dia/blog` | Tres centésimas de margen. Bloquearlo con ese margen convierte cualquier retoque del neutro por parte de un admin en un 422 — y `input` deriva del neutro. El propio Modelo 0 documenta que un 1 % de holgura es «demasiado fino para sostener una afirmación de conformidad»; usarlo como umbral duro es peor todavía |
| `borde de campo sobre la capa flotante` | 3,11 — `modelo-0@1/public` | ídem |

**Rechazada: `anillo sobre la superficie atenuada`.** Da **1,36** en el `login` del Modelo 0
**hoy** — y no es un fallo: esa pantalla no usa `bg-muted` en ninguna parte (verificado:
sólo `bg-background` y `bg-card`). Es un falso positivo que dejaría la barrera roja de
salida. Lo que esa medición sí destapa es otra cosa, y se trata en el §5.5.

> ⚠ **Añadir una pareja bloqueante obliga a tocar el frontend.**
> `parejas-espejo.spec.ts` saca las parejas del 422 real y exige que cada una tenga entrada
> en `COLOR_CULPABLE`
> ([estilo-admin.ts:119](../apps/web/src/lib/api/estilo-admin.ts#L119)), que es lo que
> hace que el aviso salga **junto al campo que el admin puede mover**. Las dos nuevas van a
> `primary`, como la que ya existe. Es un `.ts` sin DOM; no toca ningún `.tsx`.

### 3.5 El arreglo de `badge.tsx`

Una clase: añadir `ring-offset-background` a la cadena de
[badge.tsx:7](../apps/web/src/components/ui/badge.tsx#L7), que es lo que llevan los otros
nueve.

**Es un no-op exacto en claro:** el valor por defecto de Tailwind es `#fff` y el
`--background` del Modelo 0 es `0 0% 100%` — el mismo blanco. Y el anillo sólo aparece en
`:focus`, que las capturas no fotografían. **Cero píxeles, en la batería y en la pantalla.**

Es el mismo movimiento que hizo E5 con la pantalla de login: un valor escrito a fuego pasa
a responder al token. No reorganiza —el árbol DOM no cambia, y el test de invariancia
ignora `class` de todos modos—, así que no roza la decisión #1.

**Guarda recomendada:** un test unitario que exija que **toda cadena con `ring-offset-2`
lleve `ring-offset-background`**. Sin él, el décimo caso vuelve a colarse — y ya se coló
una vez.

## 4. Los SEMÁNTICOS

### 4.1 Qué significa «parcial», exactamente

**Mecánicamente:** la versión declara un mapa con **cualquier subconjunto de los 30
nombres**; lo que no nombra, lo hereda del modelo. Idéntico a `rampa` y a `ejes`, y por el
mismo motivo: una versión que sólo quiere mover el rojo mueve el rojo.

**Y una regla dura, comprobable:** la versión **no puede inventar un nombre**. Es la
invariante 3 del §2.4, y es el gemelo exacto de `zonaSoloAjusta` — que existe porque *«un
comentario no impide nada»*.

> **Ésta es la única pieza de E14 que sale de «derivar»**, y conviene decirlo en vez de
> disfrazarlo: 30 literales no se derivan de nada, se escriben. Lo que la hace legítima:
>
> 1. **#2 sigue intacta.** #2 protege la línea **admin/código**. El admin no toca ni uno,
>    antes ni después. Que el literal lo escriba el modelo o su versión es una diferencia
>    **dentro** del código, y las dos pasan por la misma barrera de CI.
> 2. **El precedente está ejercido cuatro veces.** Las cuatro zonas `login` del catálogo
>    redefinen `destructive-subtle`, `destructive-border` y `destructive-strong` como
>    literales, por exactamente esta causa: la polaridad del lienzo.
> 3. **La alternativa cuesta más y pierde el parentesco:** sin esto, el oscuro sólo puede
>    ser un modelo nuevo — y entonces los 30 se escriben igual, más los 4 colores, más las
>    5 zonas, más los 13 ejes, más las 10 ilustraciones.

### 4.2 Los 30, por grupos — y qué toca típicamente una versión oscura

| Grupo | Claves | ¿La versión oscura los nombra? |
|---|---|---|
| **Estados** — aviso, éxito, info, error, pendiente, neutro | **27** | **Sí, los 27.** Son superficies y letras, y la polaridad los invierte enteros |
| **Convenciones** — `rating`, `featured`, `favorite` | **3** | **Normalmente no.** Una estrella de valoración es dorada y un corazón es rojo *en todas partes*; su color es parte del significado, no del ambiente. `globals.css` lo explica y el sistema los separa desde E2 |

La distinción no es una regla del mecanismo —la versión puede nombrar los 30— sino la
**guía de autor**: un ambiente cambia estados; cambiar una convención es cambiar qué
significa un icono.

### 4.3 El molde: `SEMANTICOS_OSCUROS`, extraído de `MODELO_PRUEBA`

`MODELO_PRUEBA` («Contraluz») trae desde E6 **un juego oscuro completo y medido en CI**.
Se le pasó por encima al lienzo carbón de Premium, y sale entero:

| Pareja | Con los claros heredados | Con los de `MODELO_PRUEBA` |
|---|---|---|
| **el rojo como TEXTO sobre el lienzo** | **3,70 ❌** | **6,19 ✅** |
| aviso · suave / plena | 6,62 / — | **13,01 / 10,70 ✅** |
| éxito · suave / plena | 6,81 / — | **11,62 / 7,58 ✅** |
| info · suave / plena | 8,01 / — | **11,72 / 9,22 ✅** |
| error · suave / macizo | 5,91 / — | **8,79 / 6,01 ✅** |
| pendiente · neutro | 9,22 / 6,87 | **11,02 / 10,18 ✅** |
| **superficies contra el lienzo** | **15,76 – 17,98 ❌** | **1,10 – 1,88 ✅** |

**Las diez parejas pasan a la primera.** No hay que inventar una paleta oscura: hay que
**extraer la que ya está medida**.

**La forma de la extracción, y las tres claves que hay que mirar al hacerla:**

```
SEMANTICOS_OSCUROS  ← los 27 estados de MODELO_PRUEBA
MODELO_PRUEBA.semanticos ← { ...SEMANTICOS_OSCUROS, + sus 3 propias }
```

| Clave | Valor en Contraluz | Por qué no va tal cual al molde compartido |
|---|---|---|
| `destructive-foreground` | `30 50% 8%` | Es el **marrón cálido** de esa paleta. Sobre Premium cumple (6,01), pero es una decisión de familia: el molde debe llevar un casi-negro neutro y cada modelo lo afina |
| `featured` | `#fb923c` | Naranja cálido — es convención, y Contraluz la tiñó a su paleta |
| `favorite` | `#fb7185` | ídem |

**`MODELO_PRUEBA` tiene que resolver byte a byte igual después de la extracción.** No es
higiene: es el modelo contra el que compara el test de invariancia, y moverlo invalidaría
la comparación sin que nada lo dijera.

### 4.4 Lo que esto cierra: la fuga de Día/Tarde

El caso medido en la auditoría: el rojo `0 84.2% 47%` da **4,446:1** sobre el lienzo de
Tarde —falla 1.4.3 por cinco centésimas— y **4,784:1** sobre el de Día. Como una versión no
podía redefinir semánticos, la corrección se aplicó **al modelo** (46 %) y se la comió Día,
que no la necesitaba.

Tras E14: Día se queda en el 47 % del sistema y **Tarde declara el suyo**. Es una centésima
de luz, y es la prueba de que el eje dejó de contaminar hacia los lados.

> **No es obligatorio hacerlo en E14.** El 46 % cumple en las dos versiones y nadie lo ve.
> Se anota como el primer uso natural del mecanismo cuando `calido-editorial` se toque.

### 4.5 La barrera de coherencia de polaridad — y por qué NO es AA

Seis paneles a 17:1 sobre un lienzo carbón son **perfectamente accesibles y perfectamente
rotos**. WCAG no tiene nada que decir: 1.4.11 exige un mínimo, no un máximo. **Colarlo como
regla AA sería inventarse una obligación normativa** — exactamente lo que el comentario de
`parejasDeAviso` prohíbe hacer.

Así que es **una barrera aparte, llamada por su nombre**: coherencia, no accesibilidad.
La afirmación, con los datos:

| | superficie semántica vs lienzo |
|---|---|
| los 7 pares del catálogo (claros) | **1,00 – 1,22** |
| `MODELO_PRUEBA` (oscuro entero, hecho a mano) | **1,10 – 1,88** |
| una versión oscura con semánticos claros heredados | **15,76 – 17,98** |

**Umbral propuesto: 3:1 como techo** para las nueve superficies (`warning`,
`warning-surface`, `success`, `success-surface`, `info`, `info-surface`,
`destructive-subtle`, `pending-surface`, `neutral-surface`) contra `background`. Deja
holgura de sobra a todo lo que existe —el peor caso real está en 1,88— y caza el caso roto
por un factor de cinco.

**Va en CI, nunca en un 422.** Los semánticos son código: sólo pueden estar mal si el autor
de un modelo o de una versión los escribió mal, y eso se descubre antes de desplegar, no
cuando un admin guarda.

## 5. Las ZONAS

### 5.1 El problema, medido

`ajustesPorZona` es del modelo. Una versión oscura hereda los cinco bloques claros:

| Zona | Lienzo heredado | Texto de la versión | Fallos |
|---|---|---|---|
| `public` | `220 24% 8%` | `220 16% 95%` | 0 (no hay bloque) |
| `backoffice` | **`0 0% 100%`** | `220 16% 95%` | texto base **1,12** |
| `blog` | **`220 10% 97.5%`** | `220 16% 95%` | texto base **1,06** |
| `cuenta` | **`220 8% 99.5%`** | `220 16% 95%` | texto base **1,11** |
| `login` | `220 24% 8%` | `220 16% 95%` | **0** ✅ |

Tres de cinco, ilegibles. La barrera de CI **ya lo caza** —mide por zona y por versión
desde Premium—, así que no puede llegar a producción. Pero es trabajo que E14 tiene que
hacer.

### 5.2 ⚠ Las zonas NO pueden girar solas, y conviene saber por qué

La forma tentadora sería expresar los ajustes como desplazamientos sobre la base, de modo
que rotaran con la luz de la versión. **No funciona, y la prueba está en el registro.**

«El backoffice RESTA» (decisión #4) significa aritmética distinta en cada polaridad:

| Modelo | Base | `backoffice` | Qué hace |
|---|---|---|---|
| `premium` (claro) | `background 220 14% 99%` | `background 0 0% 100%` | **sube la luz** hasta el blanco y quita el tinte |
| `modelo-prueba` (oscuro) | `muted 30 22% 20%` | `muted 30 10% 20%` | **deja la luz quieta** y sólo desatura |

Un solo juego de desplazamientos no da las dos cosas. Y con luz **absoluta** —la otra
forma— no gira en absoluto, que es el problema de partida.

> **La conclusión honesta: «girar con la luz» lo hace el AUTOR de la versión, y la barrera
> comprueba que lo hizo.** No es automático, y prometerlo automático produciría zonas medio
> claras medio oscuras sin que nada avisara.

**La forma elegida: mezcla parcial por token dentro de cada zona.** Es coherente con
`rampa`, `ejes` y `semanticos`, y es la más económica: la versión nombra los tokens de
zona que cambia. El riesgo —dejar media zona sin girar— lo cubre la barrera de §5.5 y la
validación AA por zona que ya existe.

### 5.3 El colapso de `login`, y qué hacer con él

Medido: con una versión oscura cuyo lienzo coincide con el del `login` de Premium
(`220 24% 8%`), `resolverZona` **descarta sola** `background`, `foreground`, `card`,
`border`, `input` y `muted-foreground` —un ajuste que coincide con la base no se emite— y
deja sólo siete tokens: `popover`, `ring`, `primary`, `primary-foreground` y el trío
destructivo.

**El mecanismo se ajusta solo, y eso está bien.** Lo que desaparece es la **intención**: la
zona `login` existe para que *«la puerta de servicio se distinga de un vistazo»*, y en una
plataforma ya oscura no distingue nada.

**El molde: `MODELO_PRUEBA`, que es el único modelo oscuro que hay.** Su `login` **ahonda**
en vez de invertir: base `30 18% 8%` → login `30 30% 4%`.

**Y hay que decir que el molde es flojo:** esos dos lienzos se diferencian en **1,08:1**.
Contraluz nunca tuvo que justificarlo porque nadie lo mira. Para una versión de catálogo
hay tres salidas, y es una decisión de aspecto (§10, D4): ahondar más, girar el tono, o
**aceptar que en oscuro la puerta de servicio no se distingue por el color** y dejar
`login: {}`.

### 5.4 Qué de la zona es de la versión y qué sigue del modelo

| | Quién |
|---|---|
| **La INTENCIÓN de cada zona** — el backoffice resta, el blog tiñe, la cuenta va a medio camino, el login se distingue | **el MODELO**. Son las cinco decisiones de E5, del sistema, y un modelo las dice en sus colores |
| **Los VALORES con que esa intención se dice** | **la VERSIÓN**, si los declara; si no, los del modelo |
| **Qué zonas existen** (`ESTILO_ZONES`) | **nadie** — es estructura |
| **Que una zona no invente un token** | la regla dura de `zonaSoloAjusta`, **sin cambio** |

### 5.5 La regla de completitud de superficies

Es lo que destapó el `anillo × superficie atenuada` a **1,36** en el `login` del Modelo 0
(§3.4): **las cuatro zonas `login` redefinen 15 tokens y dejan `muted`, `secondary` y
`accent` en sus valores claros.** Hoy es inocuo —esa pantalla no pinta ninguno de los
tres—, pero es exactamente el modo de fallo que una versión oscura haría **vivo en toda la
plataforma**: `bg-muted` aparece **225 veces en 116 ficheros**.

Una versión oscura **no** sufre esto en `muted` —`muted` es parte de la rampa y la rampa se
redefine— pero sí puede sufrirlo en cualquier zona que declare medio bloque.

**La regla, en CI:** si un bloque de zona (o una versión) **invierte la polaridad** de
`background` respecto a la base, tiene que redeclarar **todas las superficies del mismo
lado** —`card`, `popover`, `muted`— o la barrera lo nombra. Es más barato y más preciso que
añadir parejas AA que producen falsos positivos.

> **Aplicable también hacia atrás**, y es una deuda que esto documenta: las cuatro zonas
> `login` del catálogo deberían declarar su `muted`. **Fuera de E14** — es un retoque de
> aspecto en cuatro modelos y se hace mirándolo.

---

# PARTE III · LAS BARRERAS

## 6. La validación AA del oscuro, completa

### 6.1 El cuadro, después de E14

| Familia | Dónde vive | Qué mide | Cambio en E14 |
|---|---|---|---|
| **Bloqueantes** | `validarContraste` → **422 al guardar** + CI por versión y por zona | lo que depende de los 4 colores del admin | **+2 parejas**: anillo sobre la tarjeta, anillo sobre la capa flotante |
| **Avisos** | `avisosContraste` → informativo | lo que se mide y no se impone | **+2 parejas**: borde de campo sobre la tarjeta y sobre la capa flotante |
| **Semánticos** | `contraste-modelos.spec.ts`, **sólo CI** | lo fijo del modelo **y ahora de la versión** | ya mide por versión; pasa a medir **los semánticos mezclados de cada versión** |
| **Coherencia de polaridad** | CI, **barrera nueva** | superficie semántica vs lienzo, techo 3:1 | **nueva** (§4.5) |
| **Completitud de superficies** | CI, **barrera nueva** | una polaridad invertida redeclara sus superficies | **nueva** (§5.5) |
| **Juego de nombres** | `contraste-modelos.spec.ts:255` | los 60 nombres, por modelo | pasa a **por modelo × versión** (§2.4) |

### 6.2 Lo que ya está bien y se aprovecha tal cual

- **la medición por versión** existe desde Premium y recorre `m.versiones` entero;
- **la medición por zona** recorre las cinco, con la versión, y compone
  `{...base, ...resolverZona(...)}` — que es el tema efectivo de verdad;
- **el rojo como TEXTO sobre el lienzo de cada versión** ya se mide, y su comentario dice
  literalmente que está ahí *«para el día que alguien vuelva a intentarlo»*. **Éste es ese
  día**, y la comprobación funciona: es la que da 3,70 con los semánticos heredados y 6,19
  con el molde oscuro.

### 6.3 Lo que la nueva versión tiene que pasar para entrar

`premium@oscuro` entra al catálogo sólo si, **para las cinco zonas**:

1. las **11 parejas bloqueantes** (9 de hoy + 2 nuevas) están en verde;
2. las **11 parejas semánticas de texto** están en verde;
3. las **9 superficies semánticas** quedan por debajo del techo de 3:1 contra su lienzo;
4. el **juego de nombres** sigue siendo exactamente 60;
5. ninguna zona inventa un token.

## 7. La invariancia (E6)

### 7.1 Confirmada — y por construcción, no por suerte

Tres hechos verificados:

1. **El frontend no lee el modelo ni la versión en ninguna parte.** Verificado en
   `apps/web/src`: no hay un solo componente que ramifique sobre ninguno de los dos. El
   tema entra por una única puerta —
   [layout.tsx:114](../apps/web/src/app/layout.tsx#L114), `bloqueDeEstilo(tokens, zonas)`—
   y sale como declaraciones CSS.
2. **El test compara etiquetas, anidamiento, texto y atributos, ignorando `class` y
   `style`.** Ninguno de esos depende de un color.
3. **El propio test ya demuestra que un lienzo invertido pasa:** su modelo extremo,
   `modelo-prueba-contraluz`, **ya es oscuro** (lienzo al 8 % de luz) y produce el árbol del
   Modelo 0. Una versión oscura de Premium no le pide al sistema nada que Contraluz no le
   esté pidiendo ya.

> **E14 no roza la decisión #1.** Revestir la luz no reorganiza. Y el arreglo de
> `badge.tsx` (§3.5) cambia una `class`, que es precisamente lo que el test ignora por ser
> el revestimiento.

### 7.2 Lo que hay que añadir al test

Una línea: `['premium', 'oscuro', COLORES_PREMIUM]` en la lista `DEL_CATALOGO`. El ayudante
`ponerModelo` **ya acepta la versión** (se parametrizó cuando el catálogo dejó de llamarlas
«1»), así que no hay que tocar nada más.

**Sin eso, el catálogo tendría una versión sin barrera de invariancia** — y sería justo la
que más lejos está del Modelo 0.

### 7.3 Las ilustraciones — mejoran, y no hace falta un juego propio

Los diez SVG son línea monocroma en `#94a3b8` (slate-400). Medido:

| | contraste con la ilustración |
|---|---|
| sobre el blanco del Modelo 0 | **2,56** |
| sobre el lienzo carbón `220 24% 8%` | **7,25** |
| sobre la tarjeta oscura `220 20% 13%` | **6,43** |

**Se ven casi tres veces mejor en oscuro.** La decisión de E7 de hacerlas neutras —*«una
ilustración por defecto que llevara el azul de marca pelearía con la primera instancia que
eligiera un primario rojo»*— resulta ser también lo que las hace sobrevivir a una inversión
de polaridad. `premium@oscuro` hereda las del modelo y no necesita nada.

*(El 2,56 sobre blanco no es un fallo: llevan `role="presentation"`, así que 1.4.11 no las
alcanza.)*

### 7.4 El riesgo residual: de ASPECTO, no de invariancia

Una versión oscura aplica a las cinco zonas, así que destapa lo que quede escrito a fuego.
**20 ocurrencias en 7 ficheros**, y la mayoría son legítimas (el visor de fotos es negro a
propósito; los puntos del carrusel van sobre una imagen; las previsualizaciones de
`/admin/marca` enseñan el logo sobre claro **y** sobre oscuro a propósito).

**Los dos que hay que mirar en la ráfaga B:**

| Fichero | Qué | Por qué |
|---|---|---|
| [MapCards.tsx:93](../apps/web/src/components/busqueda/MapCards.tsx#L93) | `bg-white/95` | Tarjeta blanca con el texto claro de la versión dentro |
| [PublicidadBadge.tsx:37](../apps/web/src/components/anuncios/PublicidadBadge.tsx#L37) | `bg-slate-600 text-white` | Probablemente sobrevive, pero ya no responde al tema |

**Se miran mirándolos**, en la ráfaga que estrena el oscuro. No dentro del mecanismo.

---

# PARTE IV · ALCANCE, PLAN Y DECISIONES

## 8. Lo que NO entra en E14

### 8.1 La marca derivable

`primary`, `secondary`, `accent` y sus tres letras **siguen siendo del modelo**. Una versión
no los desplaza.

**Consecuencia directa y hay que decirla: el «`primary` más saturado» de Fresco/Nítido NO se
resuelve en E14.** Sigue igual que hoy, con la presencia conseguida por la rampa —lienzo,
texto y trazo— y el mismo azul en las dos versiones.

**Lo que costaría, medido, para cuando se retome** (§12 de la auditoría): un campo `marca`
con la misma gramática de desplazamientos que el foco. Sobre el azul de Fresco, Δs +10 /
Δl −4 da `222 86% 46%` con letra a 6,48 y anillo a 6,61 — cumple sola, porque
`mejorTextoSobre` recalcula sobre el color derivado y `validarContraste` mide la pareja
derivada.

**Por qué no ahora:** E14 ya toca la frontera en tres sitios. Añadir el cuarto —el único que
hace que el color que el admin elige no se pinte literalmente— mezcla una decisión
conceptual con una ráfaga que, por lo demás, no mueve un píxel.

### 8.2 El resto

| | Por qué no |
|---|---|
| **El modo oscuro de #1** | Es otra cosa: preferencia de usuario, eje paralelo, ×2 paletas por modelo para siempre, conmutador e hidratación sin parpadeo. El bloque `.dark` de `globals.css:251` **sigue muerto después de E14** |
| **El `muted` de las cuatro zonas `login`** | Retoque de aspecto en cuatro modelos (§5.5). Se hace mirándolo |
| **El desdoblamiento del eje de ambiente** | La deuda de `pendientes.md:776` sigue en pie, y **E14 la encarece**: cuanto más puede una versión, más cara es la duplicación del día que haya `dia-2`/`tarde-2`. Anotarlo ahí |
| **Nombre visible para las versiones** | El desplegable pinta el **id crudo** (`{v}` como valor y como etiqueta), así que hoy ya se lee «claro-intenso». Darle nombre visible cambia la forma de `versiones` y toca el catálogo, el cliente de admin y la pantalla. §10, D3 |

## 9. El plan de ráfagas

Dos, en este orden. **La separación no es cosmética: la A no debe mover un píxel y la B
sí.** Mezclarlas es perder el criterio de aceptación de las dos.

### Ráfaga A · El mecanismo y las barreras, EN SECO

**Backend**
- `AjustesDeVersion` gana `foco`, `semanticos` y `ajustesPorZona` (§2.1);
- el paso 0 de `resolverTokens` mezcla los tres; el paso 3 aplica el foco; `resolverZona`
  lee de la mezcla (§2.3);
- extraer `SEMANTICOS_OSCUROS` de `MODELO_PRUEBA`, que tiene que seguir resolviendo **byte
  a byte igual** (§4.3);
- **2 parejas bloqueantes** (anillo × tarjeta, anillo × capa flotante) y **2 de aviso**
  (borde de campo × tarjeta, × capa flotante) (§3.4);
- **3 barreras nuevas de CI**: coherencia de polaridad, completitud de superficies, juego
  de nombres por versión (§6.1).

**Frontend** — dos ficheros, ningún componente reorganizado
- `COLOR_CULPABLE` gana las dos parejas nuevas, o `parejas-espejo.spec.ts` se pone rojo
  (⚠ hallazgo 4);
- `badge.tsx` gana `ring-offset-background` — **no-op exacto en claro** (§3.5), más la
  guarda que impide que vuelva a pasar.

**Ninguna versión del catálogo declara ninguno de los campos nuevos.**

> **Criterio de aceptación, duro:** los **7 pares modelo×versión** resuelven byte a byte
> igual que hoy, `MODELO_PRUEBA` incluido, y las **50 capturas** salen idénticas. Si alguna
> se mueve, es un bug del mecanismo — se revierte, no se justifica. Es el mismo criterio
> con el que entraron E4a y el E13 original, y funciona.

### Ráfaga B · `premium@oscuro`, en seco, con previa a Ernest

- la tercera versión de Premium: rampa oscura + `foco: { dl: +40 }` + `SEMANTICOS_OSCUROS`
  + los bloques de zona (§10, D1 y D4 antes de escribirla);
- entra en `DEL_CATALOGO` del test de invariancia (§7.2);
- `MODELO_POR_DEFECTO` **sigue siendo el Modelo 0**: la versión es elegible y no está
  activa, así que las 50 capturas siguen idénticas;
- se mira en pantalla, **las cinco zonas**, y se revisan los dos ficheros del §7.4;
- **corregir el «catorce» del comentario de `MODELO_PREMIUM`**
  ([estilo.constants.ts:1484](../apps/api/src/modules/estilo/estilo.constants.ts#L1484)):
  son 30;
- actualizar `pendientes.md:776` con lo que E14 encareció (§8.2).

> **Criterio:** las 50 capturas idénticas (está en seco) y la previa aprobada por Ernest
> antes de dejar los valores. Como en los tres modelos anteriores: **los valores son de
> partida; el aspecto es suyo.**

### Los valores de partida de `premium@oscuro`, ya medidos

Para que la ráfaga B no empiece en blanco. Todos verificados contra las barreras de §6.3:

| | Valor | Medida |
|---|---|---|
| lienzo | `220 24% 8%` | moldeado sobre su propia zona `login`, que ya cumple AA entera |
| texto | `220 16% 95%` | texto base sobre el fondo, muy por encima de 4,5 |
| tarjeta / flotante | `220 20% 13%` / `220 20% 16%` | la elevación la da la luz, no la sombra (el molde de Contraluz) |
| atenuada / su letra | `220 18% 20%` / `220 12% 70%` | 6,02 entre ellas |
| trazo / borde de campo | `220 14% 24%` / `220 10% 52%` | el de campo, 4,20 sobre la tarjeta |
| **anillo** | `primary` con **`dl: +40`** → `220 45% 70%` | 7,68 lienzo · 6,81 tarjeta |
| **semánticos** | `SEMANTICOS_OSCUROS` | las 10 parejas ✅, rojo-texto **6,19**, superficies 1,10–1,88 |
| marca | **sin tocar** — los tres del admin | letras 9,64 / 5,41 / 6,67, elegidas midiendo |
| ilustraciones | **sin tocar** | 7,25 sobre el lienzo |

## 10. Las decisiones que quedan

**D1 · Qué parte de los semánticos declara la versión oscura.** ¿Los **27 estados** y se
heredan las **3 convenciones** (`rating`, `featured`, `favorite`), o también las
convenciones? **Recomendación: sólo los 27.** Una estrella dorada y un corazón rojo son
significado, no ambiente; E2 los separó por eso. Contraluz tiñó las suyas y es coherente con
ser un modelo entero — una *versión* no debería.

**D2 · Qué parte de las zonas declara la versión oscura.** La mezcla es por token, así que
la pregunta es de disciplina: ¿la versión **redeclara el bloque completo** de cada zona que
toca, o sólo los tokens que cambian? **Recomendación: bloque completo en las tres zonas que
invierte** (`backoffice`, `blog`, `cuenta`). Es más escritura y hace imposible dejar media
zona sin girar — que es el modo de fallo del §5.5, el mismo que dejó `muted` claro en cuatro
`login` oscuros.

**D3 · El nombre de la versión.** El desplegable pinta **el id crudo**. Las salidas:
`oscuro` (lee bien en minúscula, y `claro-intenso` ya sentó el precedente),
`oscuro-contenido` (el nombre del encargo original, más largo), o darle nombre visible a las
versiones — que toca el catálogo, el cliente de admin y la pantalla. **Recomendación:
`oscuro`, y anotar el nombre visible como deuda de UI** (§8.2). No es de esta ráfaga.

**D4 · Qué hace la zona `login` en una versión oscura.** El mecanismo la colapsa solo
(§5.3) y la intención se pierde. Tres salidas: **ahondar** (el molde de Contraluz, pero da
1,08:1 y casi no se ve), **girar el tono** (un carbón con otro matiz), o **aceptar que en
oscuro la puerta de servicio no se distingue por el color** y dejar `login: {}`.
**Recomendación: ahondar de verdad**, con el lienzo del login bastante por debajo del base
—que es lo que Contraluz quiso hacer y se quedó corto—, y decidirlo **mirándolo** en la
previa de la ráfaga B. Es aspecto, no mecanismo.

**D5 · El borde de campo contra la tarjeta: aviso o bloqueante.** Recomendado **aviso**
(§3.4) porque el peor caso del catálogo está en **3,03** y `input` deriva del neutro que el
admin elige: bloquearlo convierte un retoque legítimo en un 422. **La alternativa** es
bloquearlo y subir un par de puntos el `input` del blog de `calido-editorial`, que es un
cambio visual de un trazo en una zona — y entonces ya no es una ráfaga en seco.

---

## 11. Apéndice — de dónde sale cada número

| Afirmación | Cómo se obtuvo |
|---|---|
| la versión oscura resuelve y falla 1 de 9 | `resolverTokens` con una `porVersion.oscuro` de sólo rampa + `validarContraste` |
| anillo 1,85 / 1,64 / 2,96 / 3,64 / 7,68 | `contraste()` sobre esa versión, contra `background`, `card` y `popover` |
| ring×card 4,85 y ring×popover 4,89 como peor caso | barrido de **8 modelos×versión × 5 zonas = 40** combinaciones |
| input×card 3,03 · input×popover 3,11 | el mismo barrido |
| ring×muted 1,36 en el `login` del Modelo 0 | el mismo barrido; y `grep` de `bg-` en `admin/login/page.tsx` para saber si es vivo |
| 9 de 10 con `ring-offset-background`; 71 sin banda | `grep` de `ring-offset-background` / `ring-ring` en `apps/web/src/**/*.tsx` |
| las 10 parejas de `SEMANTICOS_OSCUROS` sobre el carbón | `parejasSemanticasDeTexto` de `contraste-modelos.spec.ts` aplicada al tema mezclado |
| superficies 1,00–1,22 (catálogo) · 1,10–1,88 (Contraluz) · 15,76–17,98 (heredadas) | `contraste(background, superficie)` en los 7 pares + Contraluz + la versión oscura |
| el rojo de Tarde, 4,446 vs 4,784 | `contraste()` sobre los lienzos resueltos de `dia` y `tarde` |
| las zonas heredadas a 1,06 / 1,11 / 1,12 | `validarContraste({...base, ...resolverZona(…, 'oscuro')})` por zona |
| el colapso de `login` a 7 tokens | `resolverZona(modeloConOscuro, …, 'login', 'oscuro')` |
| ilustraciones 2,56 / 7,25 / 6,43 | `stroke="#94a3b8"` leído del SVG + `contraste()` |
| `bg-muted` 225 usos en 116 ficheros | `grep` en `apps/web/src/**/*.tsx` |
| 50 capturas | `apps/web/e2e-snapshots/__capturas__/` — 25 escritorio + 25 móvil por plataforma |
