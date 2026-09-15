# DIAGNÓSTICO — EL RESIDUO DE 8 px AL ABRIR UN OVERLAY

> **Estado: diagnóstico cerrado y ARREGLADO con la opción A.** El documento se conserva
> entero —el mecanismo, el censo y las opciones descartadas— porque es lo que explica por
> qué el arreglo está donde está y no en la cabecera.
>
> Lo aplicado, en dos sitios:
>
> - `BannerCookies.tsx` — `padding-right: var(--removed-body-scroll-bar-size, 0px)` en su
>   envoltorio `fixed`. **Medido después del arreglo**: el contenedor se queda en 120,5 px
>   con el diálogo abierto y con él cerrado, el banner sigue a sangre (1280) y el
>   `padding-right` computado pasa de `0px` a `15px` sólo mientras hay un overlay montado.
> - `e2e/buscador-dialogos.spec.ts` — la barrera de CLS, **apretada de «menos de un tercio»
>   a CERO**: `total === 0` y `fuentes === []`. Ése es el valor de la ráfaga; el arreglo es
>   una línea.
>
> El CLS de abrir un diálogo con el banner en pantalla es ahora **0,000 con cero fuentes**,
> el mismo número que antes sólo se conseguía con el consentimiento ya decidido.

---

## 0. El veredicto, antes de los detalles

**No es la cabecera `sticky`.** El `§12.3` de `diseno-buscador.md` la señaló —«sale de la
cabecera `sticky` que comparte todo el sitio público»— y la medición dice lo contrario: la
cabecera y su `.container` **no se mueven ni una centésima** al abrir un diálogo.

El que se descoloca es **el `.container mx-auto max-w-5xl` que vive dentro del banner de
cookies**, y se descoloca porque el banner es `position: fixed`
([`BannerCookies.tsx:126-128`](../apps/web/src/components/consentimiento/BannerCookies.tsx#L126-L128)).

De ahí sale la consecuencia que más cambia la decisión: **el banner sólo existe mientras el
visitante no ha decidido**. Con la cookie de consentimiento puesta, abrir el mismo diálogo
da **CLS 0,000 y cero fuentes** — medido. El residuo no es «de todo el sitio»: es de la
primera visita, en escritorio, con barra de scroll clásica.

Que la atribución fuera errónea importa más que el residuo en sí: la nota del §12.3 mandaba
la ráfaga siguiente a tocar **la cabecera de todas las páginas** para arreglar algo que no
está ahí.

---

## 1. El mecanismo, con los números

Viewport de 1280 px con una barra de scroll clásica de 15 px.

| | Diálogo cerrado | Diálogo abierto |
|---|---|---|
| `window.innerWidth` | 1280 | 1280 |
| `html.clientWidth` (el ICB) | **1265** | **1280** |
| `body.clientWidth` | 1265 | **1265** |
| `body` margin-right | 0 | **15 px** (lo pone `react-remove-scroll`) |
| `header` (sticky) | x 0, w 1265 | x 0, w 1265 — **Δ 0** |
| `header > .container` | x 0, w 1265 | x 0, w 1265 — **Δ 0** |
| hero `.max-w-4xl` | x 184,5 | x 184,5 — **Δ 0** |
| **banner `.fixed.inset-x-0`** | w **1265** | w **1280** — **Δ +15** |
| **banner `> .container` (max-w 1024)** | x **120,5** | x **128** — **Δ +7,5** |

Los 7,5 px son **la mitad exacta de la barra**, y el 8 del §12.3 es ese 7,5 redondeado por
el informe de `layout-shift`.

### Paso a paso

1. `react-remove-scroll` bloquea el scroll poniendo `overflow: hidden` en el `body`. La
   barra desaparece y **el bloque contenedor inicial (el ICB) crece de 1265 a 1280**.
2. Para que el contenido no se ensanche de golpe, la librería **compensa el `body`**: le
   pone `margin-right: 15px`. El `body` sigue midiendo 1265, y por eso **nada de lo que
   está en el flujo se mueve** — ni el hero, ni la cabecera, ni el pie.
3. `position: sticky` **no se sale del flujo**: es un elemento normal que, al llegar a su
   umbral, se despega. Su bloque contenedor sigue siendo el `body`, así que **recibe la
   compensación como cualquier otro**. De ahí los Δ 0 de la tabla. La cabecera es inocente.
4. `position: fixed` **sí se sale**: su bloque contenedor es **el viewport**, no el `body`.
   El banner es `inset-x-0`, o sea `left: 0; right: 0` **contra el ICB**, así que pasa de
   1265 a 1280 px de ancho. La compensación del `body` no le llega ni puede llegarle.
5. Dentro del banner hay un `container mx-auto … max-w-5xl`: ancho tope **1024 px**,
   centrado con márgenes automáticos. Al crecer su padre 15 px, el margen automático pasa
   de `(1265 − 1024) / 2 = 120,5` a `(1280 − 1024) / 2 = 128`. **Se re-centra 7,5 px.**

Dicho en una línea: *la compensación es del `body`, y el que se descoloca no está en el
`body`, está en el viewport.*

---

## 2. Por qué `react-remove-scroll` no lo compensa (y qué sí ofrece)

No es un defecto de la librería: **no puede** alcanzar a un elemento fijo desde el `body`.
Lo que hace es **publicar ganchos** para que la aplicación compense los suyos. Ésta es su
hoja inyectada, leída del DOM con el diálogo abierto:

```css
.with-scroll-bars-hidden { overflow: hidden !important; padding-right: 15px !important; }
body[data-scroll-locked] { overflow: hidden !important; overscroll-behavior: contain;
  position: relative !important; padding-right: 0px; margin-right: 15px !important; }
.right-scroll-bar-position { right: 15px !important; }
.width-before-scroll-bar  { margin-right: 15px !important; }
body[data-scroll-locked]  { --removed-body-scroll-bar-size: 15px; }
```

Tres ganchos, y **ninguno se aplica solo**:

- `.right-scroll-bar-position` — para un fijo anclado a la derecha (`right: 0`).
- `.width-before-scroll-bar` — para un fijo a todo lo ancho: le resta la barra por margen.
- `--removed-body-scroll-bar-size` — **una variable CSS**, la vía general: cualquier
  elemento puede compensar con `padding-right: var(--removed-body-scroll-bar-size, 0px)`.

Las dos últimas **medidas sobre el banner, con el diálogo abierto**:

| | contenedor `.x` | ancho del banner |
|---|---|---|
| cerrado (referencia) | 120,5 | 1265 |
| abierto, sin arreglo | **128** | 1280 |
| abierto + `.width-before-scroll-bar` | **120,5** ✔ | 1265 |
| abierto + `padding-right: var(--removed-body-scroll-bar-size)` | **120,5** ✔ | **1280** |

Las dos cierran el desplazamiento. **No son equivalentes**: la clase encoge el banner a
1265, así que su fondo y su borde superior dejarían de llegar al borde de la pantalla; la
variable lo deja a sangre (1280) y mueve sólo su contenido. Bajo un velo al 80 % no se
distingue, pero la segunda es la que no cambia nada más.

---

## 3. El alcance, medido

**Qué lo dispara.** Cualquier overlay que monte `react-remove-scroll`: en este repo son
todos los `Dialog`, `AlertDialog` y hojas construidos sobre `@radix-ui/react-dialog`, o sea
los ~25 anteriores al buscador y los dos que añadió BQ-B. Confirmado con un diálogo que no
tiene nada que ver con el buscador (`/mis-anuncios`, `PromocionarDialog`): **los mismos
7,5 px, el mismo nodo**.

**Dónde.** En las seis rutas públicas censadas (`/`, `/busqueda`, `/planes`, `/contacto`,
`/anuncio/[slug]`, `/blog`) el banner es **el único** elemento `fixed` que se estira con el
viewport **y** lleva dentro algo centrado con tope de ancho. No hay un segundo caso
esperando.

**Cuándo — y esto es lo que decide la severidad.** Sólo mientras el banner está en
pantalla, o sea **antes de que el visitante decida sobre las cookies**. Con la cookie
puesta: **CLS 0,000, cero fuentes**. Y sólo en escritorio con barra clásica: a 375 px el
tope de 1024 no llega a aplicarse (el contenedor ocupa todo el ancho, los márgenes
automáticos valen 0) y además las barras superpuestas no reservan ancho.

**Cuánto.** 0,0010 de CLS medido en BQ-C, contra un umbral de «bueno» de 0,1 — dos órdenes
de magnitud por debajo. Y es un movimiento de 7,5 px en un elemento que está **bajo el velo
del diálogo**, no en el contenido que se está mirando.

---

## 4. Las opciones (alcance · riesgo · coste)

### A · Compensar el banner con la variable CSS — *recomendada*

`padding-right: var(--removed-body-scroll-bar-size, 0px)` en el envoltorio `fixed` de
`BannerCookies`.

- **Toca**: un fichero, una línea. **No toca la cabecera ni ninguna página.**
- **Alcance**: el banner, que es el único caso que existe.
- **Riesgo**: mínimo. Sin overlay abierto la variable no está definida y el `0px` de
  respaldo deja el banner exactamente como está hoy. El fondo sigue a sangre.
- **Coste**: una línea y una prueba; el instrumento de medida ya existe
  (`e2e/buscador-dialogos.spec.ts`).
- **Pega**: acopla el banner a un detalle de `react-remove-scroll`. Se paga con un
  comentario; y el nombre de la variable es parte de la API pública de la librería.

### B · La clase `.width-before-scroll-bar` en el banner

- **Toca**: lo mismo, un fichero.
- **Riesgo**: bajo, pero **encoge el banner 15 px** mientras hay un overlay abierto: su
  fondo y su borde dejan de llegar al borde derecho. Invisible bajo el velo; visible si
  algún día se abre un overlay que no lo tape (un `Popover`, un `Sheet` lateral).
- Es la opción A con un efecto secundario de más, a cambio de nada.

### C · Quitarle el `mx-auto`/`max-w-5xl` al contenedor del banner

- **Toca**: el banner. **Cambia su aspecto en todas las páginas y siempre**, no sólo con un
  overlay abierto: el texto del banner pasaría a ocupar 1265 px en vez de 1024.
- **Riesgo**: alto para lo que resuelve — es un cambio de diseño, y el tope de ancho está
  ahí para que una línea de texto legal no cruce la pantalla entera.
- **Coste**: capturas nuevas y una decisión de diseño que nadie ha pedido.

### D · Tocar la cabecera

- **Descartada por la medición.** La cabecera no se mueve. Cualquier cosa que se le haga
  cambia todas las páginas del sitio y **no cierra el mecanismo**, porque el mecanismo no
  pasa por ella. Es justamente lo que el §12.3 habría mandado hacer.

### E · Aceptarlo y dejarlo escrito

- **Toca**: nada.
- **A favor**: 0,0010 de CLS (dos órdenes bajo el umbral), 7,5 px, bajo el velo, sólo en la
  primera visita, sólo en escritorio. El hero —la preocupación original del §5.3— **no se
  mueve**, y eso ya está vigilado.
- **En contra**: la barrera de BQ-C exige «menos de un tercio de lo que se mueve sin
  compensar» en vez de un cero redondo **por culpa de este residuo**. Mientras exista, esa
  prueba mide con una tolerancia que no hace falta.

---

## 5. Recomendación

**La A**, y por un motivo que pesa más que los 7,5 px: cuesta una línea en un fichero que no
es global, no cambia nada cuando no hay overlay abierto, y **permite apretar la barrera de
BQ-C a cero**. Una prueba que exige «menos de un tercio» tolera, por construcción, que
mañana aparezca un segundo elemento fijo mal compensado; una que exige cero lo caza el
primer día.

Si se prefiere no gastar la ráfaga: **la E, pero corrigiendo el §12.3**, que es lo que de
verdad hace daño. La nota, tal como está, manda a la ráfaga siguiente a tocar la cabecera
de todas las páginas para arreglar algo que está en el banner de cookies.

---

## 6. Cómo reproducirlo

`--hide-scrollbars` es un argumento por defecto de Chromium en Playwright, así que **en el
runner no hay barra y no hay nada que medir**: hace falta un navegador propio. Es la misma
cautela que ya documenta `e2e/buscador-dialogos.spec.ts`.

```ts
const nav = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
const page = await (await nav.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
await page.goto('http://localhost:3000/');           // SIN la cookie de consentimiento
const leer = () => page.evaluate(() => {
  const c = document.querySelector('.fixed.inset-x-0.bottom-0 .container') as HTMLElement;
  return { x: c.getBoundingClientRect().x, banner: c.parentElement!.getBoundingClientRect().width,
           icb: document.documentElement.clientWidth, body: document.body.clientWidth };
});
console.log('cerrado', await leer());                 // x 120.5 · banner 1265 · icb 1265 · body 1265
await page.getByRole('button', { name: 'Categoría' }).click();
console.log('abierto', await leer());                 // x 128   · banner 1280 · icb 1280 · body 1265
```

Con la cookie `mp_consent` puesta no hay banner y el CLS de abrir el mismo diálogo es 0.

---

## 7. Lo que hay que corregir en la documentación

- `diseno-buscador.md` §12.3 — «Sale de la cabecera `sticky` que comparte todo el sitio
  público». **Falso**, y es lo que orientaba mal la ráfaga siguiente.
- `diseno-buscador.md` §15.6 — repite la atribución.
- `e2e/buscador-dialogos.spec.ts` — el comentario del §5.3·4 da por buena la misma causa al
  explicar por qué no se exige un cero.

Los tres quedan apuntados a este documento.
