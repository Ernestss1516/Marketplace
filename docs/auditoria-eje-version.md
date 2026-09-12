# Auditoría — el eje de VERSIÓN: qué puede hoy, hasta dónde ampliarlo

**Fecha:** 2026-09-12
**Alcance:** el eje `modelo@versión` del sistema de estilo. Qué redefine una versión hoy,
las tres veces que se ha quedado corto, y **hasta dónde ampliarlo sin difuminar la
frontera versión/modelo**.
**Naturaleza:** diagnóstico + propuesta de frontera. **Cero código escrito.** No se
implementa, no se diseña la implementación y no se decide por Ernest: el §7 son las
decisiones que quedan sobre la mesa.
**Método:** todo el §1 y el §2 están **medidos contra el código** de esta sesión —
`resolverTokens`, el registro de los cinco modelos, la barrera de contraste y el test de
invariancia—. Los números de una versión oscura salen de **resolverla de verdad** con el
mecanismo actual y pasarle las barreras, no de estimarlos. Del §3 en adelante es
propuesta, y está marcada como tal.

---

## 0. Veredicto en ocho líneas

1. **El eje de versión NO se queda corto en la luminosidad.** La rampa ya permite
   invertirla: se construyó una versión oscura de Premium que **sólo redefine la rampa**
   —lo que una versión puede hacer hoy, sin tocar una línea de mecanismo— y resuelve
   perfectamente. Lienzo `220 24% 8%`, texto `220 16% 95%`. **La luz absoluta por franja,
   que es la pieza de E4a con más pensamiento detrás, ya hace este trabajo.**
2. **Lo que se queda corto es todo lo que NO gira con la luz.** De las nueve parejas
   bloqueantes, esa versión oscura falla **una**: el anillo de foco, 1,85:1 contra los 3:1
   de 1.4.11. Y arrastra dos averías más que la barrera de hoy ve sólo a medias.
3. **La tercera avería no estaba en el encargo y apareció midiendo: las ZONAS.**
   `ajustesPorZona` se declara por MODELO, no por versión. Una versión oscura hereda los
   ajustes claros: el backoffice pintaría lienzo `0 0% 100%` con el texto claro de la
   versión — **1,12:1**; el blog, 1,06:1; la cuenta, 1,11:1. Tres de las cinco zonas
   quedan ilegibles. La barrera de CI **sí lo caza** (mide por zona y por versión desde
   Premium), así que no es un agujero de seguridad: es **alcance de la ráfaga** que no
   estaba contado.
4. **El patrón de las tres veces tiene una sola forma:** una versión puede redefinir
   **REGLAS** (la rampa es una regla: desplazamientos sobre el neutro del admin; los ejes
   son valores de ambiente). El modelo guarda **LITERALES** (los cuatro colores, el
   anillo copiado de `primary`, los treinta semánticos, los cinco bloques de zona). **Las
   tres veces, la versión quiso mover un literal.**
5. **La frontera nueva, en una frase:** *el modelo ELIGE los cuatro colores y los
   literales de su identidad; la versión DERIVA de ellos — y a partir de E13, también la
   luminosidad, el foco, los semánticos y las zonas.* El modelo sigue siendo quien elige;
   la versión sigue sin elegir ni uno de los cuatro.
6. **Eso no rompe la decisión #2.** #2 dice «4 atributos configurables, semánticos fijos
   por modelo, mismo set para todas las versiones». Lo que protege es la línea
   **admin / código**: que un admin no pueda pintar los errores de verde ni elegir la
   letra que va encima de su azul. Una versión es código. Tras E13 el admin sigue
   aportando exactamente cuatro valores y ninguno de los tres `-foreground`.
7. **E13 no es el modo oscuro de la decisión #1, y la distancia es estructural**, no de
   grado: aquél es una preferencia del usuario (`prefers-color-scheme`, conmutador,
   `next-themes`, la clase `.dark` que hoy está muerta en `globals.css:251`); esto es una
   opción del catálogo que **elige el admin** y que resulta ser el tema de la instancia
   entera. Sale por el mismo `<style>` de siempre. El bloque `.dark` sigue muerto después
   de E13.
8. **El test de invariancia de E6 sigue verde, y por construcción, no por suerte**: el
   frontend no lee el modelo ni la versión en ninguna parte (verificado); el tema llega
   como un mapa de variables a un `<style>`. Invertir la luz cambia valores, no etiquetas.

**Dos cifras del encargo que la medición corrige, sin consecuencia para el razonamiento:**

| El encargo dice | Medido | Dónde |
|---|---|---|
| «los **14** semánticos» | **30** claves | `MODELO_0.semanticos`, [estilo.constants.ts:296-370](../apps/api/src/modules/estilo/estilo.constants.ts#L296-L370) |
| — | (el comentario del código dice 9,79 para el anillo de Premium claro; medido, **9,83**) | [estilo.constants.ts:1531](../apps/api/src/modules/estilo/estilo.constants.ts#L1531) |
| «anillo de foco **1,71:1**» | **1,73:1** con el carbón al 11 % de luz; **1,85:1** al 8 % | reproducido con `contraste()` |

El «14» viene del comentario de `MODELO_PREMIUM`
([estilo.constants.ts:1484](../apps/api/src/modules/estilo/estilo.constants.ts#L1484)),
que quedó escrito con la cuenta corta. **Conviene corregirlo en su ráfaga**: son 30, y
treinta es más del doble de trabajo que catorce para quien se ponga a escribirlos.

> ⚠ **Colisión de nombre, y hay que resolverla antes de empezar.** **`E13` ya está usado
> en el código**: es la ráfaga que hizo que la versión ENTRARA en la resolución
> ([estilo.service.ts:113](../apps/api/src/modules/estilo/estilo.service.ts#L113),
> [estilo.constants.ts:231](../apps/api/src/modules/estilo/estilo.constants.ts#L231),
> [estilo.spec.ts:424](../apps/api/src/modules/estilo/estilo.spec.ts#L424),
> [pendientes.md:776](pendientes.md#L776)). Llamar «E13» también a **ampliar** ese mecanismo
> dejaría dos ráfagas distintas con la misma etiqueta en los mismos ficheros. Este
> documento usa **E13** porque es como se pidió, pero **la ráfaga real necesita su propio
> número** (E14 en adelante; E13 es el último ocupado en código). Es un fleco de cinco
> segundos que, sin resolver, ensucia el historial para siempre.

---

# PARTE I · EL ESTADO ACTUAL (medido)

## 1. Los 60 tokens, y quién decide cada uno

`resolverTokens(modelo, colores, version)` devuelve **exactamente 60 tokens** con
cualquiera de los cinco modelos (`contraste-modelos.spec.ts:255` exige que los cinco
declaren el mismo juego de nombres). Se reparten en cinco bloques con cinco dueños
distintos:

| # | Bloque | Tokens | De dónde sale el valor | ¿Puede una versión? |
|---|---|---|---|---|
| 1 | **Rampa neutra** | **10** — `background`, `foreground`, `card`, `card-foreground`, `popover`, `popover-foreground`, `muted`, `muted-foreground`, `border`, `input` | **REGLA**: `Δh`/`Δs` sobre el neutro del admin + **luz absoluta** | ✅ **SÍ** — parcial, franja a franja |
| 2 | **Marca** | **6** — `primary`, `secondary`, `accent` + sus tres `-foreground` | Los tres primeros **copiados literalmente** del admin; las tres letras las elige `mejorTextoSobre` midiendo | ❌ NO |
| 3 | **Foco** | **1** — `ring` | `tokens.ring = colores.primary`, copia literal | ❌ NO |
| 4 | **Semánticos** | **30** | Literales del modelo (tripletes y hexadecimales) | ❌ NO |
| 5 | **Ejes T2** | **13** — `font-sans`, `font-heading`, `radius`, las 5 sombras, los 4 de movimiento, `icon-stroke` | Literales del modelo | ✅ **SÍ** — parcial, clave a clave |

**El total que una versión puede redefinir hoy: 23 de 60.** Los otros 37 son del modelo, y
una versión no tiene ninguna forma de tocarlos —
[`AjustesDeVersion`](../apps/api/src/modules/estilo/estilo.constants.ts#L262-L267) tiene
exactamente dos campos, `rampa` y `ejes`, y `resolverTokens` sólo los consulta ahí.

### 1.1 El detalle que ordena todo lo demás: el `neutral` no es un token

De los cuatro colores configurables, **tres se emiten tal cual y uno no se emite nunca**.
`--primary`, `--secondary` y `--accent` son el valor del admin copiado byte a byte;
`neutral` **no aparece en la salida**: existe únicamente como **base de derivación** de las
diez franjas.

```ts
// estilo.constants.ts:1781-1794
const neutro = parsearTriplete(colores.neutral) ?? …;
for (const [nombre, franja] of Object.entries(rampa)) {
  tokens[nombre] = aplicarFranja(neutro, franja);   // h+Δh, s+Δs, l absoluta
}
```

**Ése es el precedente exacto del que cuelga toda la propuesta del §3.** El sistema ya
tiene un color configurable que el admin elige y que nadie pinta literalmente: lo que se
pinta son diez derivados suyos, y **quién decide la derivación es la versión**. Que los
otros tres no funcionen así no es una decisión tomada: es que no hizo falta.

### 1.2 Lo que `resolverTokens` hace con la versión, hoy

```ts
// estilo.constants.ts:1787-1789 — el paso 0
const deVersion = version ? modelo.porVersion?.[version] : undefined;
const rampa = deVersion?.rampa ? { ...modelo.rampa, ...deVersion.rampa } : modelo.rampa;
const ejes  = deVersion?.ejes  ? { ...modelo.ejes,  ...deVersion.ejes  } : modelo.ejes;
```

Tres propiedades que hay que conservar en E13, porque son las que hacen que el mecanismo
sea sano:

1. **Mezcla PARCIAL.** Lo que la versión no nombra, lo hereda. Por eso `dia: {}` y
   `claro: {}` son versiones legítimas y vacías.
2. **Se mezcla ANTES de derivar, no después.** El comentario del código lo dice y es la
   frase más importante de todo el fichero para lo que viene: *«una versión cambia la
   REGLA (la franja), no el color ya calculado — si parcheara el resultado, dejaría de
   girar con el neutro que elija el admin, que es todo el sentido de la rampa»*.
3. **`version` es opcional y sin ella el resultado es el de antes de que las versiones
   existieran.** Es lo que protege al Modelo 0 y con él a las **50 capturas** de la
   batería visual (25 escritorio + 25 móvil, `apps/web/e2e-snapshots/__capturas__/`).

## 2. La decisión #2, leída con precisión

> **#2 · Atributos:** 4 configurables (`primary`, `secondary`, `accent`, `neutral`).
> Semánticos **fijos por modelo**. Mismo set para todos.
> — [diseno-sistema-estilo.md:23](diseno-sistema-estilo.md), §3.3

Lo que #2 **afirma**, verificado contra el §3.3 del diseño:

- el admin aporta **cuatro valores y sólo cuatro**;
- **nunca aporta un `-foreground`** — *«elegir “azul de marca” es una decisión de marca;
  elegir qué color de texto va encima es una decisión de contraste, y esa la toma la
  máquina»*;
- los semánticos **no son configurables** — *«dejarla configurable es invitar a que una
  instancia pinte los errores de verde»*;
- **el mismo set de cuatro para todos**, de modo que la pantalla de admin es una sola y no
  cambia de forma según el modelo elegido.

Lo que #2 **no dice en ninguna parte**: que una versión no pueda derivar de esos cuatro
más cosas de las que deriva hoy. **La frontera de #2 es admin / código.** La frontera
modelo / versión es otra, vive un nivel más abajo, y **nunca se ha escrito** — de ahí que
se haya descubierto tres veces por su borde.

## 3. La asimetría zona / versión, medida

Es lo que destapó el comentario de `MODELO_PREMIUM` y conviene ponerle números, porque es
la prueba de que el eje de versión es **el eje pobre del sistema**:

| | Puede redefinir | Comprobado por |
|---|---|---|
| **Una ZONA** | **cualquiera de los 60**, con la única regla de que el nombre ya exista | `zonaSoloAjusta`, en CI |
| **Una VERSIÓN** | **23 de 60** (10 rampa + 13 ejes) | la forma de `AjustesDeVersion` |

Y la asimetría no es teórica, se ejerce: **las cuatro zonas `login` del catálogo redefinen
exactamente los mismos 15 tokens**, y son los que hacen que un lienzo oscuro funcione:

```
background, foreground, card, card-foreground, popover, popover-foreground,
border, input, muted-foreground,
ring,                                   ← una versión NO puede
primary, primary-foreground,            ← una versión NO puede
destructive-subtle, destructive-border, destructive-strong   ← una versión NO puede
```

**De esos 15, una versión puede redefinir 9. Los 6 que no puede son exactamente los que
distinguen un oscuro que funciona de uno que no.** Medido, con el anillo de cada zona
`login` sobre su propio lienzo:

| Modelo | Lienzo del login | Anillo | Contraste |
|---|---|---|---|
| `modelo-0` | `228.6 84% 4.9%` | `212.7 26.8% 83.9%` (slate-300) | **13,59:1** |
| `calido-editorial` | `24 28% 8%` | `30 45% 72%` | **9,81:1** |
| `fresco-confianza` | `220 45% 7%` | `210 85% 68%` | **8,08:1** |
| `premium` | `220 24% 8%` | `42 62% 62%` (bronce) | **9,61:1** |

Los cuatro modelos, ante el mismo problema, tomaron la misma decisión: **sobre un lienzo
oscuro, el anillo de foco no puede ser el color de marca.** Cuatro veces. Eso ya no es un
caso particular del login: es la regla del oscuro, y el eje de versión no la puede aplicar.

---

# PARTE II · EL PATRÓN

## 4. Las tres veces que el eje se quedó corto

### 4.1 Día / Tarde — cabía, pero ya se salió una vez

**Lo que se pidió:** dos ambientes simultáneos para `calido-editorial`.

**Lo que el eje dio:** todo lo visible. `tarde` redefine las diez franjas y cuatro ejes; la
barrera de `estilo.spec.ts:446` exige que las dos versiones no resuelvan al mismo tema y
que difieran en lienzo, texto y trazo, y lo cumple. **Mecánicamente, este caso no se quedó
corto.**

**Lo que costó, y está anotado:** el §2.1 define versión como **eje TEMPORAL** («una
revisión del mismo modelo… sin cambiar bajo los pies de las instancias que ya lo usan»), y
aquí se usó como **eje de ambiente**. `pendientes.md:776` lo registra como deuda: el día
que Cálido/Editorial necesite una revisión de verdad, las versiones se llamarán `dia-2` y
`tarde-2` y cada corrección habrá que duplicarla.

**Y lo que NO estaba anotado — la fuga que sí es de este patrón.** «Tarde» **ya obligó a
mover un literal del modelo**, y no se pudo hacer desde la versión:

| Rojo `destructive` | sobre el lienzo de **Día** (`38 44% 97.5%`) | sobre el de **Tarde** (`32 38% 94%`) |
|---|---|---|
| `0 84.2% 47%` (el del Modelo 0) | 4,784 ✅ | **4,446 ❌** (1.4.3 pide 4,5) |
| `0 84.2% 46%` (el que quedó) | 4,968 ✅ | 4,617 ✅ |

El lienzo de Tarde es tres puntos y medio más oscuro, y ahí el rojo heredado **falla por
cinco centésimas**. Como una versión no puede redefinir semánticos, **la corrección se
aplicó al MODELO** —`calido-editorial` baja su rojo a 46 %, [estilo.constants.ts:918](../apps/api/src/modules/estilo/estilo.constants.ts#L918)—
**y por tanto también a Día, que no lo necesitaba.**

Es exactamente el modo de fallo que el eje de versión existe para impedir: *una versión
cambiando bajo los pies de la otra*. El daño aquí es de una centésima de luz y nadie lo ve.
**En un oscuro serían los treinta.**

> **Conclusión del caso 1:** Día/Tarde **no** es la excepción que funcionó. Es la primera
> vez que el patrón mordió, sólo que tan suavemente que se pagó sin discutirlo.

### 4.2 «`primary` más saturado» (Fresco / Nítido) — bloqueado por #2

**Lo que se pidió:** que la versión «Nítido» tuviera un primario con más presencia.

**Lo que pasó:** no se pudo, y está escrito en el código con todas las letras
([estilo.constants.ts:1102-1113](../apps/api/src/modules/estilo/estilo.constants.ts#L1102-L1113)):
*«el encargo pedía “primary más saturado” para Nítido, y eso el mecanismo no lo permite:
una versión redefine `rampa` y `ejes`, nunca los cuatro colores configurables»*.

**El apaño, que es bueno y aun así es un apaño:** la presencia se consiguió con lo que sí
es de la versión — lienzo medio punto más bajo y nueve de tinte más, texto de 12 % a 9 %,
trazo de 89 % a 82 %, borde de campo de 53 % a 46 %. Se nota, y `estilo.spec.ts` lo exige.
Pero **el primario de Nítido y el de Claro son el mismo color**, y eso es justo lo que el
desplegable no promete.

**Lo que se quería, y qué habría costado.** Medido sobre el azul de fábrica de Fresco
(`222 76% 50%`), aplicando desplazamientos como los que la rampa ya aplica al neutro:

| Derivación | Color resultante | Letra elegida | Contraste letra | Como anillo sobre el lienzo de Nítido |
|---|---|---|---|---|
| sin tocar | `222 76% 50%` | `210 40% 98%` | 5,63 ✅ | 5,74 ✅ |
| Δs +10 | `222 86% 50%` | `210 40% 98%` | 5,71 ✅ | 5,82 ✅ |
| Δs +10, Δl −4 | `222 86% 46%` | `210 40% 98%` | 6,48 ✅ | 6,61 ✅ |
| Δs +18, Δl −6 | `222 94% 44%` | `210 40% 98%` | 6,93 ✅ | 7,06 ✅ |

Las cuatro cumplen, y **no hay que fiarse de que cumplan**: `mejorTextoSobre` recalcula la
letra sobre el color derivado y `validarContraste` mide la pareja derivada, así que la
barrera funciona sola. El caso 2 es, de los tres, **el más barato de cerrar**.

### 4.3 El oscuro (Premium / «Oscuro contenido») — bloqueado, y midiendo

Se rehízo el experimento con el mecanismo de hoy: una versión `oscuro` de `premium` que
**sólo redefine la rampa**, con los valores moldeados sobre su zona `login` —que ya cumple
AA entera—. Resuelve sin pestañear: lienzo `220 24% 8%`, texto `220 16% 95%`, tarjeta
`220 20% 13%`.

**Lo que falla, exactamente:**

| # | Qué | Medida | ¿Lo caza alguna barrera de hoy? |
|---|---|---|---|
| 1 | **El anillo de foco.** `ring = primary` = marino `220 45% 30%` sobre el carbón | **1,85:1** (3:1) | ✅ `validarContraste` — 422 al guardar y rojo en CI |
| 2 | **El rojo como TEXTO** sobre el lienzo (`text-destructive`) | **3,70:1** (4,5:1) | ✅ CI, por versión — la comprobación que añadió Premium |
| 3 | **Las otras 29 superficies semánticas**, que siguen siendo claras | ver abajo | ❌ **NADIE** |
| 4 | **Las zonas heredadas**, que siguen siendo claras | ver abajo | ✅ CI, por zona y versión |

**El punto 3 es el que no estaba caracterizado.** Los semánticos se miden **entre ellos**
(`warning` contra `warning-foreground`), y entre ellos siguen cumpliendo: aviso 6,62,
éxito 6,81, info 8,01, error 5,91, pendiente 9,22, neutro 6,87. **Todos pasan.** Y sin
embargo el tema está roto, porque lo que ninguna pareja mira es cómo se ven esas
superficies **contra el lienzo**:

| Superficie semántica | Valor | Contraste con el lienzo carbón |
|---|---|---|
| `warning` | `#fefce8` | **17,98:1** |
| `success` | `#f0fdf4` | **17,77:1** |
| `info` | `#eff6ff` | **17,09:1** |
| `destructive-subtle` | `#fef2f2` | **17,00:1** |
| `neutral-surface` | `#f3f4f6` | **16,90:1** |
| `pending-surface` | `#f3e8ff` | **15,76:1** |

Seis paneles casi blancos encima de un lienzo carbón. **No es un fallo de accesibilidad —
17:1 es contraste de sobra—: es un fallo de coherencia, y WCAG no tiene nada que decir al
respecto.** Por eso no hay barrera: la que existe mide accesibilidad. Para referencia, en
los **siete pares modelo×versión del catálogo** esa misma medida va de **1,00 a 1,22**, y
en el `modelo-prueba` (oscuro entero, hecho a mano) de **1,10 a 1,88**. La separación entre
«coherente» y «roto» es de un orden de magnitud, así que es perfectamente medible (§9.2).

**El punto 4 no estaba en el encargo.** `ajustesPorZona` es del modelo. Una versión oscura
hereda los cinco bloques claros, y el resultado por zona es éste:

| Zona | Lienzo efectivo | Texto efectivo | Fallos bloqueantes |
|---|---|---|---|
| `public` | `220 24% 8%` | `220 16% 95%` | 1 — sólo el anillo |
| `backoffice` | **`0 0% 100%`** | `220 16% 95%` | 2 — texto base **1,12**, texto de tarjeta 1,12 |
| `blog` | **`220 10% 97.5%`** | `220 16% 95%` | 3 — texto base **1,06**, atenuado 2,07, tarjeta 1,06 |
| `cuenta` | **`220 8% 99.5%`** | `220 16% 95%` | 2 — texto base **1,11**, atenuado 2,18 |
| `login` | `220 24% 8%` | `220 16% 95%` | **0** ✅ |

Tres de las cinco zonas quedan con texto casi blanco sobre fondo casi blanco. **La zona
`login` es la única que sale bien, y por el motivo bonito: es la única escrita para un
lienzo oscuro.** La barrera de CI lo pone rojo —mide zona por zona y versión por versión
desde Premium— así que esto no puede llegar a producción; pero **es trabajo que E13 tiene
que hacer y que no estaba contado.**

## 5. El patrón, caracterizado

Las tres veces, la versión quiso mover algo que el modelo guarda como **literal**:

| Caso | Lo que la versión quiso mover | Cómo lo guarda el modelo | Resultado |
|---|---|---|---|
| Día/Tarde | el rojo `destructive`, porque su lienzo es más oscuro | literal (30 hexadecimales/tripletes) | **se movió en el MODELO**, y se lo comió Día también |
| Nítido | el primario, más saturado | literal (copia del color del admin) | **no se hizo** |
| Oscuro | el anillo + los 30 semánticos + las 5 zonas | literales | **no se hizo** |

Y las tres veces, lo que quiso mover **depende de algo que la versión sí controla**:

- el rojo depende de **la luz del lienzo**, que es de la versión;
- la saturación del primario depende de **cuánta presencia quiere el ambiente**, que es de
  la versión;
- el anillo, los semánticos y las zonas dependen de **la polaridad del lienzo**, que es de
  la versión.

> **EL HUECO, en una frase.** La versión manda sobre la luz y no manda sobre nada de lo
> que la luz determina. El sistema deja que una versión cambie la pregunta y no la deja
> cambiar ninguna de las respuestas.

Eso, y no «falta el oscuro», es lo que hay que cerrar. Si E13 sólo habilitara el oscuro,
el patrón mordería por cuarta vez en cuanto alguien pidiera un ambiente que no sea de
polaridad.

---

# PARTE III · LA NUEVA FRONTERA (propuesta)

## 6. El mínimo que habilita el oscuro

Cuatro piezas, y ninguna es un token nuevo ni un componente tocado.

### 6.1 El anillo de foco — una DERIVACIÓN, nunca un literal

La tentación es dejar que la versión declare `ring` como hace la zona `login`. **Es la
opción equivocada**, y el propio código ya escribió el argumento en el paso 0 de
`resolverTokens`: un valor parcheado *«dejaría de girar con el neutro que elija el
admin»*. Si una versión fija el anillo a un color, el admin cambia su primario y el foco
se queda donde estaba. La promesa «el anillo sigue al color principal» se rompe **en toda
la plataforma**, no en una pantalla de servicio.

**Lo que sí:** que la versión declare **desplazamientos sobre el primario**, con la misma
forma que las franjas de la rampa. Medido sobre el marino de Premium y el lienzo carbón:

| Derivación | Anillo | sobre el lienzo | sobre la tarjeta | sobre la capa flotante |
|---|---|---|---|---|
| sin tocar | `220 45% 30%` | 1,85 ❌ | 1,64 ❌ | — |
| Δl +20 | `220 45% 50%` | 3,64 ✅ | 3,22 ✅ | **2,96 ❌** |
| Δl +30 | `220 45% 60%` | 5,39 ✅ | 4,78 ✅ | ✅ |
| Δl +40 | `220 45% 70%` | 7,68 ✅ | 6,81 ✅ | ✅ |

⚠ **La fila de Δl +20 es la advertencia más útil de esta auditoría**: pasa
`validarContraste` —que mide el anillo **sólo contra `background`**— y está por debajo de
3:1 sobre la capa flotante. **En tema claro esto nunca podía morder** (la tarjeta y el
popover son *más claros* que el lienzo, así que un anillo oscuro contrasta *más* contra
ellos: 10,08 sobre la tarjeta contra 9,83 sobre el lienzo, en Premium claro). **En oscuro
la polaridad se invierte y la
superficie elevada pasa a ser la difícil.** Ver §9.1.

**Alternativa descartada:** que el anillo se auto-aclare hasta cumplir, como
`mejorTextoSobre` elige la letra. Es elegante y no cambiaría nada hoy —los siete pares del
catálogo ya cumplen—, pero **disuelve el 422**: un admin que elija un primario invisible
como anillo dejaría de recibir el aviso y recibiría un color que no eligió. La decisión
está en el §12.

### 6.2 Los semánticos — declarables por la versión, con molde

Es la única pieza de la propuesta que **sale de «derivar»**: 30 literales no se derivan de
nada, se escriben. Conviene decirlo claro en vez de disfrazarlo.

**Por qué es legítimo igualmente:**

1. **#2 protege la línea admin/código, y la línea sigue intacta.** El admin no elige ni
   uno. Que el literal lo escriba `MODELO_PREMIUM` o `MODELO_PREMIUM.porVersion.oscuro` es
   una diferencia dentro del código, y las dos pasan por la misma barrera de CI.
2. **El precedente existe y está ejercido cuatro veces.** Las cuatro zonas `login`
   redefinen `destructive-subtle`, `destructive-border` y `destructive-strong` como
   literales, por exactamente este motivo. La versión pide el mismo escape, sobre los mismos
   tokens, por la misma causa.
3. **La alternativa es peor.** Sin esto, la única salida al oscuro es duplicar el modelo —y
   entonces los 30 semánticos se escriben igual, más los cuatro colores, más las cinco
   zonas, más los trece ejes, más las diez ilustraciones. Se paga más y se pierde el
   parentesco entre las dos versiones.

**El molde ya existe y no hay que inventarlo.** `MODELO_PRUEBA` trae un juego oscuro
completo, medido en CI desde E6. Se le pasó por encima al lienzo carbón de Premium:

| Pareja | Con los semánticos claros heredados | Con los de `MODELO_PRUEBA` |
|---|---|---|
| rojo como texto sobre el lienzo | **3,70 ❌** | **6,19 ✅** |
| aviso / éxito / info / error / pendiente / neutro (10 parejas) | pasan, pero sobre paneles blancos | **pasan las 10** (6,01 – 13,01) |
| superficies contra el lienzo | 15,76 – 17,98 ❌ | **1,10 – 1,88 ✅** |

Sale **entero a la primera**. Lo que hay que hacer con él es extraerlo a una constante
compartida (`SEMANTICOS_OSCUROS`) que las versiones oscuras esparzan, igual que los tres
modelos claros esparcen `MODELO_0.semanticos` hoy. **Dos salvedades al extraer**, medidas:
`destructive-foreground` (`30 50% 8%`) y `featured`/`favorite` llevan el tinte cálido de
Contraluz; sobre Premium siguen cumpliendo (6,01 la letra sobre el rojo), pero son
decisiones de paleta y hay que revisarlas, no copiarlas a ciegas.

### 6.3 Las zonas — heredables por la versión

Descubierto midiendo (§4.3): sin esto, tres de las cinco zonas quedan ilegibles. La forma
es la misma que todo lo demás — **mezcla parcial**: la versión declara los bloques de zona
que sustituye; los que no nombre, los hereda del modelo.

**Y la zona `login` ya da el molde de la versión oscura entera**: es un bloque de 15 tokens
que resuelve exactamente este problema y que los cuatro modelos han escrito ya. Una versión
oscura que copie la intención de su propio `login` a las cinco zonas tiene el 90 % hecho.

### 6.4 La marca — desplazamientos sobre los tres colores (cierra el caso 2)

No hace falta para el oscuro. **Hace falta para cerrar el patrón**, que es el norte del
encargo. La forma es la que el `neutral` ya ejerce (§1.1): la versión declara `Δh/Δs/Δl`
sobre el color del admin, nunca un valor.

**Dos propiedades que hacen que esto sea seguro sin trabajo extra:**

- **sigue girando con el admin** — si cambia su azul por un rojo, el «más saturado» de
  Nítido se aplica sobre el rojo;
- **la barrera no se entera de que hay algo nuevo** — `mejorTextoSobre` recalcula la letra
  sobre el color derivado y `validarContraste` mide la pareja derivada. Medido en §4.2: las
  cuatro derivaciones probadas pasan solas.

**El coste honesto:** el admin elige `#2563eb` y en la versión «Nítido» ve un azul un poco
distinto. Hoy eso ya le pasa con el neutro (nunca ve su gris: ve diez derivados). Que le
pase con los otros tres es una ampliación real y es una **decisión** (§12).

### 6.5 Lo que NO hace falta tocar, y es una buena noticia

**`textoSobre` se queda del modelo.** Son dos candidatos en los dos extremos de la escala y
`mejorTextoSobre` elige midiendo, así que **es agnóstico a la polaridad**. Verificado sobre
el lienzo oscuro, con los dos candidatos de Premium sin tocar:

| | Color | Letra elegida | Contraste |
|---|---|---|---|
| `primary` | `220 45% 30%` | `220 20% 98%` (la clara) | **9,64** ✅ |
| `secondary` | `220 30% 45%` | `220 20% 98%` | **5,41** ✅ |
| `accent` | `42 58% 48%` | `220 40% 10%` (la oscura) | **6,67** ✅ |

La máquina elige bien en oscuro **sin que nadie se lo diga**. Es la decisión de E4a
funcionando dos ráfagas después, en un caso que no existía cuando se tomó.

## 7. LA FRONTERA, trazada

### 7.1 La línea, en una frase

> **Un MODELO ELIGE. Una VERSIÓN DERIVA.**
>
> El modelo elige los cuatro colores de fábrica, los dos candidatos a letra y la identidad
> (nombre, descripción, ilustraciones, qué versiones existen). **Una versión no elige ni
> uno de los cuatro: los hereda.** Lo que la versión decide es **qué sale de ellos** — la
> luz del lienzo, la familia de grises, el anillo, el ambiente, la polaridad de los avisos
> y el registro de cada zona.

### 7.2 El reparto, token a token

| Bloque | Tokens | Hoy | Tras E13 |
|---|---|---|---|
| Rampa | 10 | ✅ versión | ✅ versión |
| Ejes T2 | 13 | ✅ versión | ✅ versión |
| Foco (`ring`) | 1 | ❌ modelo | ✅ versión, **por derivación** de `primary` |
| Semánticos | 30 | ❌ modelo | ✅ versión, **parcial**, con molde compartido |
| Marca (3 + 3 letras) | 6 | ❌ modelo | ✅ versión, **por derivación** (opcional, §12) |
| **Total redefinible** | **60** | **23** | **54** — o 60 con la marca |
| Los 4 colores de fábrica | — | **modelo** | **modelo** — sin cambio |
| `textoSobre` | — | **modelo** | **modelo** — sin cambio (§6.5) |
| `ajustesPorZona` | 5 bloques | **modelo** | versión, **parcial** |
| Identidad, `versiones`, `ilustraciones` | — | **modelo** | **modelo** — sin cambio |

### 7.3 Qué separa AÚN una versión de un modelo

Tras E13 quedan **cuatro diferencias**, y las cuatro son de fondo, no de grado:

1. **El modelo ELIGE los cuatro colores; la versión no puede elegir ninguno.** Puede
   desplazarlos; no puede sustituirlos. Un modelo con primario terracota no tiene una
   versión con primario azul — tiene una versión con el terracota más vivo o más apagado.
   **Ésta es la diferencia principal y es la que sostiene todas las demás.**
2. **El modelo elige la LETRA CANDIDATA** (`textoSobre`). Es la única decisión de
   accesibilidad estructural de la paleta, y se queda arriba.
3. **El modelo es la unidad de IDENTIDAD**: nombre, descripción, ilustraciones, tipografía
   de partida y —sobre todo— **qué versiones existen**. Una versión no crea versiones.
4. **El modelo es la unidad de ELECCIÓN del admin.** La pantalla ofrece modelos, y dentro
   de uno, sus versiones. Elegir otra versión es afinar; elegir otro modelo es cambiar de
   plataforma.

**El contraejemplo que hace la línea operativa**, para cuando haya que decidir en caliente:

- *«Premium con el lienzo oscuro»* → **VERSIÓN**. Mismos cuatro colores, otra derivación.
- *«Premium pero en verde bosque»* → **MODELO**. Cambia un color de fábrica.
- *«Premium con el bronce más apagado»* → **VERSIÓN**, si es un desplazamiento del bronce
  del admin; **MODELO**, si es otro color.

### 7.4 Por qué esto no rompe #2

| Lo que #2 exige | ¿Sigue en pie tras E13? |
|---|---|
| El admin aporta **4 valores y sólo 4** | ✅ Sin cambio: el DTO y la pantalla no se tocan |
| El admin **nunca** aporta un `-foreground` | ✅ Sin cambio: los tres los sigue eligiendo `mejorTextoSobre` |
| Los semánticos **no son configurables por el admin** | ✅ Sin cambio: siguen siendo código, medidos en CI |
| **Mismo set de atributos para todas las versiones** | ✅ Sin cambio: son los mismos cuatro campos, sea cual sea el modelo y la versión |

**Lo que cambia es quién, dentro del código, escribe la derivación.** #2 no habla de eso —
no lo ha hablado nunca, y por eso el sistema se tropezó tres veces con su borde.

> **La formulación precisa, para que quede escrita de una vez:**
> *#2 reparte entre el ADMIN y el CÓDIGO. La frontera modelo/versión reparte DENTRO del
> código: el modelo elige los literales de su identidad, la versión elige la derivación de
> todo lo demás.*

---

# PARTE IV · EL IMPACTO

## 8. `resolverTokens`

El cambio es **una ampliación del paso 0** y dos pasos que dejan de leer del modelo para
leer de la mezcla. La forma, sin escribir la implementación:

```
0 · mezclar lo de la versión sobre lo del modelo  (rampa, ejes, semánticos, zonas, derivaciones)
1 · rampa      ← igual que hoy, pero con la rampa MEZCLADA
2 · marca      ← el color del admin, con la derivación de la versión aplicada (si la hay)
                 la letra: mejorTextoSobre sobre el color DERIVADO
3 · ring       ← primary con la derivación de foco de la versión (si la hay)
4 · semánticos ← MEZCLADOS  ·  ejes ← MEZCLADOS (ya hoy)
```

**Tres invariantes que no se pueden perder**, y que se comprueban solas si se respeta la
forma de hoy:

1. **Sin `version`, el resultado no cambia.** Es lo que protege al Modelo 0 y a las 50
   capturas. Hoy lo garantiza `version ? … : undefined`; con cuatro campos más sigue
   garantizándolo igual.
2. **Se mezcla antes de derivar.** Una derivación es una regla; parchear el resultado
   rompería el giro con el color del admin.
3. **El juego de nombres no cambia.** Siguen siendo 60. `contraste-modelos.spec.ts:255` lo
   exige a los cinco modelos y **debería exigirlo también por versión** tras E13 — una
   versión que declarase un semántico con el nombre mal escrito añadiría un token 61 que
   nadie consume, y nada lo diría hoy.

`resolverZona` no cambia de forma: ya recibe la versión y ya resuelve la base con ella
([estilo.constants.ts:1825](../apps/api/src/modules/estilo/estilo.constants.ts#L1825)).
Sólo tiene que leer el bloque de zona de la mezcla en vez del modelo.

## 9. La validación AA

### 9.1 Lo que ya cubre, y los dos huecos que el oscuro destapa

La validación **ya mide por versión** —lo añadió Premium— y **ya mide por zona**, las cinco,
para cada versión. Con el lienzo invertido eso sigue siendo cierto y sigue funcionando: en
el experimento, la barrera cazó el anillo (1,85) y cazó las tres zonas heredadas (1,06 –
1,12). **La estructura de la barrera es correcta; lo que le faltan son parejas.**

**Hueco 1 — el anillo y el borde de campo se miden sólo contra el LIENZO.** En claro daba
igual; en oscuro la superficie elevada es la difícil. Medido en Premium:

| Pareja | Premium claro | Premium oscuro | ¿Se mide hoy? |
|---|---|---|---|
| anillo sobre el **lienzo** | 9,83 | 1,85 | ✅ |
| anillo sobre la **tarjeta** | 10,08 | **1,64** | ❌ |
| anillo sobre la **capa flotante** | 10,08 | **2,96** con Δl +20 | ❌ |
| borde de campo sobre la **tarjeta** | 4,57 | 4,20 | ❌ |

**Propuesta:** añadir `ring`×`card`, `ring`×`popover` e `input`×`card` a
`parejasBloqueantes`. Comprobado: **los siete pares del catálogo actual las pasan todas**,
así que añadirlas no pone rojo nada de lo que ya existe.

**Hueco 2 — la coherencia de polaridad de los semánticos, que AA no cubre.** Seis paneles a
17:1 sobre el lienzo son perfectamente accesibles y perfectamente rotos. **No se puede
colar como regla AA** —sería inventarse una obligación normativa, exactamente lo que el
comentario de `parejasDeAviso` prohíbe hacer— así que tiene que ser **una barrera aparte y
llamarse por su nombre**: coherencia, no accesibilidad. Un umbral defendible, con los datos
medidos:

| | superficie semántica vs lienzo |
|---|---|
| los 7 pares del catálogo (claros) | **1,00 – 1,22** |
| `modelo-prueba` (oscuro entero, a mano) | **1,10 – 1,88** |
| una versión oscura con semánticos claros heredados | **15,76 – 17,98** |

Un techo de **3:1** deja holgura de sobra a todo lo que existe y caza el caso roto por un
factor de cinco. Va en CI, como los semánticos: son código, no entrada de admin, así que
nunca deben producir un 422.

### 9.2 Dónde viven las dos barreras

- **`validarContraste`** (422 al guardar + CI): lo que depende de los cuatro colores del
  admin. Ahí entran las tres parejas nuevas del hueco 1.
- **`contraste-modelos.spec.ts`** (sólo CI): lo que es fijo del modelo o de la versión. Ahí
  entra el hueco 2, y ahí debe entrar también la comprobación de que una versión no inventa
  un token 61.

## 10. El test de invariancia de E6 — sigue verde, y por qué

**Confirmado: invertir la luz no puede reorganizar nada, por construcción.**

1. **El frontend no lee el modelo ni la versión en ninguna parte.** Verificado en
   `apps/web/src`: no hay un solo componente que ramifique sobre `estilo.modelo` o
   `estilo.version`. El tema entra por una única puerta —
   [layout.tsx:114](../apps/web/src/app/layout.tsx#L114), `bloqueDeEstilo(tokens, zonas)`—
   y sale como declaraciones CSS.
2. **Una versión oscura cambia valores dentro de ese bloque.** El test ignora `<style>`
   y `class` a propósito, y compara etiquetas, anidamiento, texto y el resto de atributos.
   Ninguno de los tres depende del color.
3. **El propio test ya demuestra que un lienzo invertido pasa.** Su modelo extremo,
   `modelo-prueba-contraluz`, **ya es oscuro** (lienzo al 8 % de luz) y el test exige que
   produzca el árbol del Modelo 0 — y lo produce. Una versión oscura de Premium no le pide
   al sistema nada que Contraluz no le esté pidiendo ya.

**Lo que sí hay que añadir al test, y es de una línea:** su ayudante `ponerModelo` ya acepta
la versión (se parametrizó cuando el catálogo dejó de llamarlas «1»), así que la versión
oscura entra en la lista `DEL_CATALOGO` igual que `fresco-confianza@claro` y
`premium@claro`. **Sin eso, el catálogo tendría una versión sin barrera de invariancia.**

**El riesgo residual, medido — y es de ASPECTO, no de invariancia.** Una versión oscura
aplica a las cinco zonas, no a una pantalla de servicio, así que destapa lo que quede
escrito a mano en claro. Hay **20 ocurrencias en 7 ficheros**, y la mayoría son legítimas:

| Fichero | Qué | ¿Rompe en oscuro? |
|---|---|---|
| `anuncios/PhotoLightbox.tsx` | `bg-black/90`, `text-white` sobre la foto | **No** — el visor es negro a propósito y está documentado |
| `anuncios/CardPhotoCarousel.tsx` | puntos `bg-white` sobre la foto | **No** — van encima de una imagen |
| `admin/marca`, `admin/ilustraciones` | previsualización sobre `bg-background` **y** `bg-slate-900` | **No** — enseña el logo sobre claro y sobre oscuro, a propósito |
| `anuncios/PublicidadBadge.tsx` | `bg-slate-600 text-white` | **Probablemente no**, pero es un literal que ya no responde al tema |
| `busqueda/MapCards.tsx` | **`bg-white/95`** en la tarjeta sobre el mapa | ⚠ **Sí** — tarjeta blanca con texto claro dentro |

Es poco y está acotado. **Se mira en la ráfaga que estrene el oscuro, mirándolo**, no
dentro del mecanismo.

## 11. La distinción con el modo oscuro de la decisión #1

La decisión #1 deja **el modo oscuro fuera de v1**. E13 no lo reabre, y la distancia es
estructural:

| | **Modo oscuro** (fuera de v1, #1) | **Versión oscura** (E13) |
|---|---|---|
| **Quién lo activa** | **el visitante** | **el admin** de la instancia |
| **Alcance** | una preferencia por usuario y por dispositivo | **el tema de la instancia**, para todo el mundo |
| **Mecanismo** | `prefers-color-scheme`, conmutador, `next-themes`, la clase `.dark` | **el `<style>` de siempre** — `html:root{…}` |
| **Eje** | **un eje PARALELO**: cada tema necesita su par claro/oscuro | **un punto del eje que ya existe** |
| **Persistencia** | cookie o `localStorage` por usuario | `Setting.estiloConfig`, una fila |
| **Coste de cada modelo nuevo** | ×2 — dos paletas por modelo, para siempre | 0 — una versión más, si su autor la quiere |
| **Frontend** | conmutador, hidratación sin parpadeo, `color-scheme` | **cero `.tsx`** |

**La prueba de que son cosas distintas está en el repo:** el bloque `.dark` de
`globals.css:251` existe desde shadcn y **está muerto** — nadie pone nunca la clase, no hay
`next-themes` ni conmutador, y el propio comentario de `globals.css:60` lo dice. **E13 no lo
resucita.** Una versión oscura sale por `html:root`, igual que Contraluz hoy. Después de
E13, ese bloque sigue igual de muerto.

> **La frase que marca la frontera, para el documento de diseño:** *E13 permite que un
> MODELO tenga una VERSIÓN oscura que el admin elige. No permite que un USUARIO elija ver
> oscuro. Lo segundo sigue fuera de v1 y sigue costando lo que costaba.*

Y hay un efecto secundario que conviene decir, porque es el argumento más fuerte a favor de
seguir aplazando el modo oscuro: **cada versión oscura que se construya es el trabajo de
paleta que el modo oscuro necesitaría de todos modos.** Un `SEMANTICOS_OSCUROS` medido y
cuatro rampas oscuras son la mitad del coste de #1, hecha por otro motivo.

---

# PARTE V · LOS TRES CASOS, RESUELTOS

## 12. Qué pasa con cada uno tras E13

### Caso 3 · El oscuro — **resuelto**, y es el que estrena el mecanismo

`premium@oscuro` pasa a ser construible: rampa oscura (ya se puede hoy) + derivación de
foco + `SEMANTICOS_OSCUROS` + los cinco bloques de zona. **Las cuatro piezas están
medidas** y ninguna necesita inventarse:

- la rampa, moldeada sobre la zona `login` de Premium, que ya cumple AA entera;
- el anillo, `primary` con Δl entre +30 y +40 (5,39 / 7,68 sobre el lienzo, y por encima de
  3:1 también sobre tarjeta y capa flotante);
- los semánticos, el juego de `MODELO_PRUEBA`, que sale entero a la primera sobre el carbón
  de Premium;
- las zonas, con la intención de siempre dicha en oscuro — y el `login` de Premium ya
  escrito como plantilla.

### Caso 2 · «`primary` más saturado» — **resuelto**, si se acepta el §6.4

Con derivación de marca, «Nítido» puede llevar el azul del admin **+10 de saturación y −4
de luz** y seguir cumpliendo con holgura (letra 6,48; como anillo 6,61). Y **sigue siendo
el azul del admin**: si mañana elige un verde, Nítido lleva ese verde subido de tono.

Sin el §6.4, este caso **sigue abierto** — y es el que decide si E13 cierra el patrón o
sólo el oscuro.

### Caso 1 · Día / Tarde — **funcionaba, y pasa a funcionar bien**

Dos mejoras concretas, ninguna urgente:

- **la fuga del rojo se puede devolver a su sitio.** Hoy `calido-editorial` lleva el rojo al
  46 % **para las dos versiones** porque Tarde lo necesitaba. Tras E13, Día puede quedarse
  en el 47 % del sistema y Tarde declarar el suyo. Es una centésima de luz y es **la prueba
  de que el eje dejó de contaminar hacia los lados**;
- **el ambiente pasa a decirse entero**: si Tarde quiere sus avisos un punto más tostados,
  puede.

**Lo que E13 NO resuelve, y hay que decirlo:** la deuda de `pendientes.md:776` sigue en pie.
El eje de versión seguirá significando dos cosas —revisión temporal y ambiente— y el día que
Cálido/Editorial necesite una revisión de verdad, las versiones se llamarán `dia-2` y
`tarde-2`. **E13 hace el eje más capaz; no lo desdobla.** Las dos salidas anotadas (dos
modelos, o un eje propio de ambiente) siguen abiertas y siguen costando lo mismo.

> ⚠ **Y E13 empeora un poco esa deuda, en un aspecto:** cuanto más puede una versión, más
> tentador es usarla como ambiente, y más caro será el día que haya que duplicar
> correcciones entre `dia-2` y `tarde-2` —porque ahora cada versión puede llevar 30
> semánticos y 5 zonas propias que también habría que duplicar—. No es motivo para no
> hacerlo; es motivo para **decidir el eje de ambiente antes del tercer ambiente**, no
> después.

### El patrón, cerrado

| Lo que una versión quiso mover | Tras E13 |
|---|---|
| el rojo, porque su lienzo es más oscuro | ✅ declara sus semánticos |
| el primario, más saturado | ✅ lo deriva (si se acepta §6.4) |
| el anillo, sobre un lienzo oscuro | ✅ lo deriva |
| los avisos, sobre un lienzo oscuro | ✅ los declara |
| las zonas, sobre un lienzo oscuro | ✅ las hereda parcialmente |
| **los cuatro colores** | ❌ **y así debe seguir** — eso es un modelo |

---

# PARTE VI · EL PLAN

## 13. Las ráfagas

**Tres, en este orden, y la separación no es cosmética:** la primera no debe mover un píxel
y la segunda sí. Mezclarlas es perder el criterio de aceptación de las dos.

### Ráfaga A · El mecanismo, EN SECO

- ampliar `AjustesDeVersion` con los campos del §6 (foco, semánticos, zonas, y marca si se
  acepta);
- ampliar el paso 0 de `resolverTokens` y hacer que `resolverZona` lea de la mezcla;
- **ninguna versión del catálogo declara ninguno de los campos nuevos.**

**Criterio de aceptación, duro:** los siete pares modelo×versión resuelven **byte a byte
igual que hoy** y las **50 capturas** salen idénticas. Si alguna se mueve, es un bug del
mecanismo. Es el mismo criterio con el que entraron E4a y el propio E13 original, y funciona.

### Ráfaga B · Las barreras

- las tres parejas nuevas de `validarContraste` (§9.1, hueco 1) — comprobado que el
  catálogo actual las pasa;
- la barrera de coherencia de polaridad en CI (§9.1, hueco 2);
- extender «todos declaran los mismos tokens» a **por versión** (§8, invariante 3);
- extraer `SEMANTICOS_OSCUROS` del `MODELO_PRUEBA`, revisando las tres claves con tinte
  cálido.

**Criterio:** sigue sin moverse un píxel; lo que cambia es cuánto se mide. **Va antes que la
ráfaga C a propósito**: la versión oscura tiene que nacer con la barrera puesta, no
estrenarla.

### Ráfaga C · `premium@oscuro`, en seco

- la tercera versión de Premium, con sus cuatro piezas;
- entra en `DEL_CATALOGO` del test de invariancia (§10);
- `MODELO_POR_DEFECTO` **sigue siendo el Modelo 0**: la versión es elegible y no está
  activa, así que las 50 capturas siguen idénticas;
- se mira en pantalla —las cinco zonas— y se revisa `MapCards.tsx` (§10);
- **corregir el «catorce» del comentario de `MODELO_PREMIUM`**: son 30.

### Fuera de plan, anotado

- **el nombre de la ráfaga** (§0): E13 está ocupado;
- **el eje de ambiente** (`pendientes.md:776`): sigue sin decidirse, y E13 sube su precio.

---

## 14. Las decisiones para Ernest

**D1 · La frontera nueva.** ¿Se adopta *«el modelo ELIGE los cuatro colores y los literales
de su identidad; la versión DERIVA de ellos, incluida la luminosidad»*? Es lo que hace que
las tres veces dejen de ser tres sorpresas. **Recomendación: sí** — y que se escriba en el
§2.1 del diseño, que hoy sólo define versión como eje temporal y por eso no ha ayudado
ninguna de las tres veces.

**D2 · Hasta dónde ampliar.** Cuatro piezas, y la cuarta es opcional:

| | Pieza | ¿Necesaria para el oscuro? | ¿Necesaria para cerrar el patrón? |
|---|---|---|---|
| a | derivación del **foco** | **sí** | sí |
| b | **semánticos** por versión | **sí** | sí |
| c | **zonas** por versión | **sí** | sí |
| d | derivación de la **marca** | no | **sí** — es el caso 2 |

**Recomendación: las cuatro.** Sin (d), E13 resuelve el oscuro y deja el patrón abierto por
donde ya mordió una vez; el encargo pide cerrar el patrón. El coste de (d) es el más bajo de
los cuatro —la barrera lo cubre sola— y el que Ernest debe sopesar es el **conceptual**: que
el color que el admin elige no se pinte literalmente en todas las versiones. Hoy eso ya pasa
con el neutro.

**D3 · El anillo: derivación o auto-ajuste.** ¿La versión declara un desplazamiento sobre
`primary` (explícito, conserva el 422), o el sistema aclara el anillo hasta que cumpla
(automático, disuelve el 422)? **Recomendación: derivación explícita.** El auto-ajuste es
elegante y le quita al admin un aviso que hoy recibe; y «el foco sale de primary» es una
promesa que conviene que siga siendo visible en el registro.

**D4 · Los semánticos por versión — el único punto que sale de «derivar».** Son 30 literales
y no se derivan de nada. **Recomendación: sí, con molde compartido.** No rompe #2 (el admin
sigue sin tocarlos), el precedente existe cuatro veces en las zonas `login`, y la
alternativa —duplicar el modelo— cuesta más y pierde el parentesco. Si se rechaza, el oscuro
sólo puede ser un modelo nuevo y **E13 se queda sin caso de uso**.

**D5 · La distinción con el modo oscuro.** ¿Se confirma que E13 **no** reabre #1 — que sigue
sin haber preferencia de usuario, sin `prefers-color-scheme`, sin conmutador, y con el
bloque `.dark` muerto? **Recomendación: sí, y que quede escrito en el §2.1**, porque es la
confusión que más fácil se cuela cuando alguien vea «Premium oscuro» en el desplegable.

**D6 · El eje de ambiente, otra vez.** No es de esta ráfaga, pero E13 sube su precio (§12).
¿Se decide ahora, se decide cuando aparezca el tercer ambiente, o se deja como está?
**Recomendación: dejarlo anotado y revisarlo al tercer ambiente**, que es lo que
`pendientes.md` ya dice — pero **añadiendo ahí que E13 encareció la salida**, para que quien
lo lea dentro de seis meses lo sepa.

---

## 15. Apéndice — de dónde sale cada número

| Afirmación | Cómo se obtuvo |
|---|---|
| 60 tokens; 23 redefinibles por una versión | `Object.keys(resolverTokens(…))` sobre `MODELO_PREMIUM`; `AjustesDeVersion` tiene dos campos |
| 30 semánticos | recuento de claves de `MODELO_0.semanticos` |
| anillo 1,85 / 1,73 / 1,64 / 2,96 | `contraste()` sobre una versión oscura resuelta con `resolverTokens` |
| las tres zonas ilegibles (1,06 – 1,12) | `validarContraste({...base, ...resolverZona(…, 'oscuro')})` para las cinco zonas |
| superficies semánticas 15,76 – 17,98 vs 1,00 – 1,22 | `contraste(background, superficie)` en los 7 pares del catálogo y en la versión oscura |
| los semánticos de `MODELO_PRUEBA` sobre el carbón de Premium | las 10 parejas de `parejasSemanticasDeTexto` + rojo como texto |
| el rojo de Tarde (4,446 / 4,617) | `contraste()` sobre los lienzos resueltos de `dia` y `tarde` |
| las derivaciones de marca de Nítido | `formatearTriplete` + `mejorTextoSobre` + `contraste` |
| 20 ocurrencias en 7 ficheros | `grep` de utilidades de color literales en `apps/web/src/**/*.tsx` |
| 50 capturas | `apps/web/e2e-snapshots/__capturas__/` — 25 escritorio + 25 móvil por plataforma |
