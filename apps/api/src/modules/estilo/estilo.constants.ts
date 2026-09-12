/**
 * E4a — EL REGISTRO DE MODELOS. Fichero PURO, sin DI.
 *
 * ── POR QUÉ EL REGISTRO VIVE EN EL BACKEND, Y NO COMPARTIDO ───────────────────────
 *
 * El diseño (§2.2) pedía un registro «compartido entre `apps/api` y `apps/web`». No
 * hay dónde: el workspace es `apps/*`, sin paquetes comunes, y crear uno para esto
 * sería reestructurar el monorepo dentro de una ráfaga de estilo.
 *
 * Y resulta que no hace falta, porque la alternativa es mejor y además es la regla de
 * arquitectura del proyecto: **derivar una paleta de cuatro colores es lógica de
 * negocio**, y la lógica de negocio vive en Nest. El frontend no necesita el registro:
 * pide `GET /estilo` y recibe el mapa de variables YA RESUELTO. Una sola fuente de
 * verdad, y el frontend sigue siendo presentación.
 *
 * ── QUÉ ES UN MODELO ──────────────────────────────────────────────────────────────
 *
 * Los cuatro colores los elige el ADMIN. Todo lo demás lo trae el modelo:
 *
 *   · `textoSobre` — los dos colores de letra entre los que la máquina elige por
 *     contraste. El admin nunca toca esto (§3.3).
 *   · `rampa` — cómo el color NEUTRO se convierte en fondo, superficies, borde y
 *     texto base. Ver el comentario de `RAMPA_MODELO_0`, que es la pieza con más
 *     miga de este fichero.
 *   · `semanticos` — error, aviso, éxito, información y las convenciones. FIJOS por
 *     modelo (decisión #2): que «error» sea rojo no es marca, es una convención que
 *     el usuario ya conoce.
 *   · `ejes` — la capa T3 que nombró E3: tipografía, elevación, movimiento y trazo
 *     de icono.
 *
 * ── MODELO 0 = EL ESTADO ACTUAL, LITERALMENTE ─────────────────────────────────────
 *
 * Cada valor de aquí abajo está copiado de `apps/web/src/app/globals.css`. No hay
 * ninguna conversión de por medio, así que no hay redondeo que pueda mover un canal:
 * resolver el Modelo 0 con sus colores por defecto devuelve, token por token, lo que
 * el navegador ya estaba pintando. `estilo.service.spec.ts` lo comprueba valor a
 * valor, y las 47 capturas a tolerancia cero lo comprueban en píxeles.
 */
import {
  AA_INTERFAZ,
  AA_TEXTO,
  contraste,
  cumpleInterfaz,
  cumpleTexto,
  formatearTriplete,
  mejorTextoSobre,
  parsearTriplete,
  type TripleteHsl,
} from './color';

/**
 * LAS ZONAS DE ESTILO. **Ya no son el espejo de `LOGO_ZONES`, y conviene explicar por
 * qué dejaron de serlo**, porque E4a las declaró como espejo exacto.
 *
 * Una zona de MARCA es «dónde va un logo»: público, backoffice y blog, tres imágenes
 * independientes. Una zona de ESTILO es «un registro visual propio»: un sitio de la
 * plataforma que se lee distinto. Coincidían en tres porque hasta ahora no había
 * ninguna diferenciación; al montarla aparecen dos más que no tienen logo propio:
 *
 *  · `cuenta` — el área privada. Es el público, un punto más sobria.
 *  · `login` — la puerta del backoffice, la única pantalla oscura de la plataforma.
 *
 * No son dos listas que divergen: son dos conceptos que se parecían.
 *
 * `public` ESTÁ EN LA LISTA PERO NO LLEVA AJUSTES NI ATRIBUTO EN EL DOM, y es
 * deliberado: el registro público **es** la base, o sea `:root`. Darle un ajuste sería
 * declarar dos veces lo mismo, y darle un atributo, envolver media plataforma en un
 * `<div>` para no cambiar nada.
 */
export const ESTILO_ZONES = ['public', 'backoffice', 'blog', 'cuenta', 'login'] as const;
export type EstiloZone = (typeof ESTILO_ZONES)[number];

/**
 * UNA sola clave de `Setting` para toda la configuración de estilo, y no una por zona
 * como hicieron los logos.
 *
 * La diferencia con la marca es real: allí las tres zonas son INDEPENDIENTES (subir el
 * logo del blog no dice nada del público) y por eso son tres filas. Aquí la
 * configuración es UNA decisión con tres afinaciones —el mismo modelo, el mismo juego
 * de colores, y a lo sumo un ajuste por zona—, así que guardarla partida obligaría a
 * leer tres filas y a resolver qué pasa si sólo dos existen.
 *
 * **FUERA DEL WHITELIST DE `PATCH /admin/settings/:key`**, por el mismo motivo que las
 * tres claves de logo (ver `branding.constants.ts`): el PATCH genérico aceptaría
 * cualquier JSON —un modelo que no existe, cuatro colores que no cumplen AA—, no
 * validaría el contraste y no revalidaría la caché. El único escritor es
 * `EstiloService`. Barrera: `PATCH /admin/settings/estiloConfig` → 400.
 */
export const ESTILO_SETTING_KEY = 'estiloConfig';

/** Tag de caché en el frontend. Molde de `BRANDING_CACHE_TAG`. */
export const ESTILO_CACHE_TAG = 'estilo';

// ─────────────────────────────────────────────────────────────────────────────────────
// LA RAMPA NEUTRA
// ─────────────────────────────────────────────────────────────────────────────────────

/**
 * ⚠ LA PIEZA QUE MÁS PENSAMIENTO LLEVA DE E4a, Y CONVIENE LEER EL PORQUÉ.
 *
 * El problema: la paleta que hay hoy **no es derivable de cuatro colores**. Es la de
 * shadcn, hecha a mano, y sus grises no comparten tono ni saturación —
 * `background` es `0 0% 100%`, `muted` es `210 40% 96.1%`, `border` es
 * `214.3 31.8% 91.4%`, `foreground` es `222.2 84% 4.9%`—. Cualquier regla del tipo
 * «toma el tono y la saturación del neutro y cambia la luz» produciría otros colores,
 * es decir, cambiaría píxeles. Y E4a no puede.
 *
 * La salida fácil habría sido declarar la rampa como diez constantes y dejar
 * `--neutral` de adorno: un cuarto color que el admin puede cambiar y que no hace
 * nada. Es justo el token muerto que en E0 me negué a declarar.
 *
 * La salida buena: la rampa se guarda como DESPLAZAMIENTOS respecto al neutro base.
 * Cada franja dice «mi tono es el del neutro más Δh, mi saturación la del neutro más
 * Δs, y mi luz es ésta». Con el neutro por defecto del Modelo 0
 * (`210 40% 96.1%`, que es el gris de superficie que más se repite hoy) los
 * desplazamientos devuelven **exactamente** los valores actuales — porque se
 * calcularon restándolos—, y si el admin gira el neutro hacia el verde, las diez
 * franjas giran con él y siguen siendo una familia coherente.
 *
 * La luz es ABSOLUTA y no un desplazamiento, a propósito: es lo que hace que la rampa
 * siga siendo legible pase lo que pase con el neutro. Un fondo tiene que ser claro y
 * un texto oscuro; eso no es negociable ni con el color de marca más raro.
 */
interface FranjaRampa {
  /** Desplazamiento de tono respecto al neutro base, en grados. */
  dh: number;
  /** Desplazamiento de saturación respecto al neutro base, en puntos. */
  ds: number;
  /** Luz absoluta, en porcentaje. NO es un desplazamiento — ver arriba. */
  l: number;
}

const RAMPA_MODELO_0: Readonly<Record<string, FranjaRampa>> = {
  // 0 0% 100% — el lienzo. Δ −210/−40 sobre el neutro lo deja en gris puro.
  background: { dh: -210, ds: -40, l: 100 },
  // 222.2 84% 4.9% — el texto base.
  foreground: { dh: 12.2, ds: 44, l: 4.9 },
  // Tarjeta y capa flotante comparten hoy lienzo y texto con el fondo. Se declaran
  // igualmente, y no como alias: un modelo puede querer la tarjeta un tono por encima
  // del fondo, y si aquí fueran el mismo dato no podría.
  card: { dh: -210, ds: -40, l: 100 },
  'card-foreground': { dh: 12.2, ds: 44, l: 4.9 },
  popover: { dh: -210, ds: -40, l: 100 },
  'popover-foreground': { dh: 12.2, ds: 44, l: 4.9 },
  // 210 40% 96.1% — la superficie atenuada. ES EL NEUTRO BASE: sus tres
  // desplazamientos son cero, y de ahí se midieron todos los demás.
  muted: { dh: 0, ds: 0, l: 96.1 },
  // 215.4 16.3% 46.9% — el texto atenuado.
  'muted-foreground': { dh: 5.4, ds: -23.7, l: 46.9 },
  // 214.3 31.8% 91.4% — el TRAZO DECORATIVO: el contorno de una tarjeta, el separador
  // de una tabla, la línea bajo una cabecera. Da 1,23:1 sobre el fondo y se queda así
  // A PROPÓSITO — ver el comentario de `parejasDeAviso`.
  border: { dh: 4.3, ds: -8.2, l: 91.4 },

  /**
   * 214.3 31.8% 60% — EL BORDE DE UN CAMPO, y ya no vale lo mismo que el decorativo.
   *
   * Los dos slots nacieron con el mismo valor y declarados aparte «por si acaso»; éste
   * es el día en que esa separación sirve para algo.
   *
   * WCAG 1.4.11 exige 3:1 a «la información visual necesaria para identificar un
   * componente». En un campo de formulario **el borde es esa información**: sin él no
   * hay nada que diga dónde se escribe, porque el fondo del campo y el de la página
   * son el mismo blanco. A 1,23:1 ese contorno es prácticamente invisible para quien
   * tiene poca visión, y el formulario deja de tener forma.
   *
   * 60 % DE LUZ Y NO MENOS: es el mínimo redondo que cumple con margen (3,11:1; el
   * mínimo absoluto está en 60,8 % y deja sólo un 1 % de holgura, demasiado fino para
   * sostener una afirmación de conformidad). Modelo 0 es sobrio: se oscurece lo justo
   * para cumplir, no hasta donde quedaría «más marcado».
   *
   * El tono y la saturación NO se tocan — sigue siendo la misma familia que el resto
   * de la rampa, sólo que legible.
   */
  input: { dh: 4.3, ds: -8.2, l: 60 },
};

// ─────────────────────────────────────────────────────────────────────────────────────
// EL MODELO
// ─────────────────────────────────────────────────────────────────────────────────────

export interface ColoresConfigurables {
  primary: TripleteHsl;
  secondary: TripleteHsl;
  accent: TripleteHsl;
  neutral: TripleteHsl;
}

export interface Modelo {
  id: string;
  nombre: string;
  descripcion: string;
  versiones: readonly string[];
  /** Los cuatro que el admin puede cambiar; éstos son los de fábrica. */
  coloresPorDefecto: ColoresConfigurables;
  /** Los dos colores de letra entre los que la máquina elige por contraste. */
  textoSobre: readonly [claro: TripleteHsl, oscuro: TripleteHsl];
  rampa: Readonly<Record<string, FranjaRampa>>;
  /** Fijos por modelo: el admin no los toca (decisión #2). */
  semanticos: Readonly<Record<string, string>>;
  /** La capa T3 que nombró E3. */
  ejes: Readonly<Record<string, string>>;
  /**
   * E7 — LAS ILUSTRACIONES QUE ESTE MODELO TRAE, por identificador de slot.
   *
   * **Parcial a propósito.** Un modelo declara las que tiene; para las que no,
   * `IlustracionesService` cae al default del REGISTRO, que siempre existe. Esa cadena
   * —admin → modelo → registro— es lo que hace que «nunca un hueco» (§8.2) sea una
   * propiedad estructural y no una disciplina: un modelo nuevo puede olvidarse de
   * declarar las diez y aun así ninguna pantalla se queda sin imagen.
   *
   * El registro (`ilustraciones.constants.ts`) es quien decide QUÉ slots existen; esto
   * sólo dice con qué fichero los sirve este modelo.
   */
  ilustraciones: Readonly<Record<string, string>>;
  /**
   * LO QUE CADA ZONA AJUSTA. **Sólo puede REDEFINIR tokens que ya existen; nunca
   * añadir los suyos** (§5.2 del diseño), y `zonaSoloAjusta` lo comprueba en CI.
   *
   * La regla no es burocracia: si el backoffice necesitara un token que el resto no
   * tiene, eso sería un SEGUNDO SISTEMA DE ESTILO conviviendo con el primero — y lo
   * mejor del punto de partida era justamente que no existía ninguno. Un modelo
   * tendría que definir dos juegos de valores, y la mitad de la plataforma dejaría de
   * responder a la mitad de los tokens.
   *
   * Una zona ausente o vacía significa «igual que la base», que es lo que debe
   * significar: `public` está vacía a propósito porque el registro público ES la base.
   */
  ajustesPorZona: Readonly<Partial<Record<EstiloZone, Readonly<Record<string, string>>>>>;
  /**
   * E13 — LO QUE CADA VERSIÓN CAMBIA SOBRE EL MODELO. Opcional: sin esto, todas las
   * versiones de un modelo resuelven igual, que es lo que pasaba hasta ahora.
   *
   * ── EL AGUJERO QUE ESTO TAPA ────────────────────────────────────────────────────
   *
   * `versiones` existía desde E4a y era **una etiqueta y nada más**: el servicio la
   * validaba al guardar y la devolvía al leer, pero `resolverTokens` nunca la veía. Con
   * un solo modelo de una sola versión no se notaba; en cuanto un modelo ofrece dos, dos
   * versiones que se ven idénticas son una promesa incumplida en la propia pantalla.
   *
   * ── QUÉ PUEDE CAMBIAR UNA VERSIÓN, Y QUÉ NO ─────────────────────────────────────
   *
   * Puede cambiar **cómo se deriva** (`rampa`) y **los ejes T2** (sombras, tempo, trazo).
   * NO puede cambiar los cuatro colores configurables ni la estructura: son del modelo, y
   * la decisión #2 dice que el juego de atributos es el mismo para todas. Una versión
   * afina el ambiente; si necesitara otros atributos, sería otro modelo.
   *
   * ── UNA ADVERTENCIA SOBRE EL SIGNIFICADO DE «VERSIÓN» ───────────────────────────
   *
   * El §2.1 del diseño define versión como «una revisión del mismo modelo… para
   * evolucionarlo sin cambiar bajo los pies de las instancias que ya lo usan» — es decir,
   * un eje TEMPORAL. `calido-editorial` lo usa para ofrecer dos AMBIENTES a la vez (Día y
   * Tarde), que no es lo mismo. Se hace así porque es lo que se pidió y porque el
   * mecanismo lo soporta sin forzarlo, pero conviene saber el precio: el día que ese
   * modelo necesite una revisión de verdad, el eje ya está ocupado y las versiones se
   * llamarán `dia-2` / `tarde-2`. Ver la nota en `docs/pendientes.md`.
   */
  porVersion?: Readonly<Record<string, AjustesDeVersion>>;
}

/** Lo que una versión redefine sobre su modelo. Todo opcional: lo que no diga, lo hereda. */
export interface AjustesDeVersion {
  /** Franjas de la rampa que esta versión sustituye. Las que no nombre, se heredan. */
  rampa?: Readonly<Record<string, FranjaRampa>>;
  /** Ejes T2 que esta versión sustituye (sombras, tempo, radio, trazo de icono). */
  ejes?: Readonly<Record<string, string>>;
}

/**
 * MODELO 0 — «Sobrio». Una versión. Es el estado actual de la plataforma, no una
 * versión parecida de él: todos los valores están copiados de `globals.css`.
 */
export const MODELO_0: Modelo = {
  id: 'modelo-0',
  nombre: 'Sobrio',
  descripcion:
    'El punto de partida: casi sin estilo propio, para que la interfaz no compita con el contenido.',
  versiones: ['1'],

  coloresPorDefecto: {
    primary: '221.2 83.2% 53.3%',
    secondary: '210 40% 96.1%',
    accent: '210 40% 96.1%',
    // El gris de superficie que más se repite hoy, y la base de la que salen los
    // desplazamientos de `RAMPA_MODELO_0`.
    neutral: '210 40% 96.1%',
  },

  // `210 40% 98%` es el `--primary-foreground` de hoy; `222.2 47.4% 11.2%`, el
  // `--secondary-foreground`. Con los colores de fábrica, la elección por contraste
  // devuelve exactamente el que ya estaba en cada sitio.
  textoSobre: ['210 40% 98%', '222.2 47.4% 11.2%'],

  rampa: RAMPA_MODELO_0,

  semanticos: {
    /**
     * ⚠ EL ROJO BAJA DE 60,2 % A 47 % DE LUZ, Y ES UN ARREGLO DE ACCESIBILIDAD (E6).
     *
     * El comentario que había aquí decía que sobre este rojo «gana el texto oscuro
     * (4.69 contra 3.14), pero hoy el botón destructivo lleva letra clara», y dejaba la
     * decisión aparcada porque E4a tenía prohibido mover un píxel. La barrera de
     * contraste de E6 (`contraste-modelos.spec.ts`) la desaparcó midiendo:
     *
     *   · letra blanca sobre el rojo de antes ....... 3,60:1  ← 1.4.3 pide 4,5:1
     *   · `text-destructive` sobre el lienzo ......... 3,76:1  ← también texto
     *
     * O sea que el botón «Eliminar» y todos los mensajes de error en rojo llevan desde
     * siempre por debajo del mínimo para texto. No es el caso gris del trazo decorativo:
     * aquí se está leyendo, y 1.4.3 no admite matices.
     *
     * SE CORRIGE BAJANDO LA LUZ Y NADA MÁS — mismo tono, misma saturación, misma familia:
     * es exactamente el remedio que la ráfaga del trazo aplicó a `--input`. A 47 % la
     * letra blanca da 4,81:1 y el rojo como texto sobre el lienzo, 5,03:1; las dos
     * lecturas quedan con holgura en vez de rozar el mínimo (48,8 % era el límite exacto).
     *
     * La alternativa era conservar el rojo y poner letra OSCURA encima (4,74:1). Se
     * descartó: un botón destructivo con letra casi negra no se lee como destructivo, y
     * además dejaba sin arreglar el rojo como texto, que es el otro fallo.
     */
    destructive: '0 84.2% 47%',
    'destructive-foreground': '210 40% 98%',

    // ── E4b · LAS ESCALAS SEMÁNTICAS ─────────────────────────────────────────
    // Seis roles por intención (superficie suave, superficie, trazo, texto,
    // relleno macizo y su hover), con UN color por rol. Antes había dos paletas
    // para «aviso» y tres tonos para su texto. El porqué de cada elección está
    // en `apps/web/src/app/globals.css`, junto a las mismas declaraciones — y
    // `globals-espejo.spec.ts` comprueba que los dos ficheros no divergen.
    warning: '#fefce8',
    'warning-surface': '#fef9c3',
    'warning-border': '#fde047',
    'warning-foreground': '#854d0e',
    'warning-solid': '#eab308',
    'warning-solid-hover': '#ca8a04',

    success: '#f0fdf4',
    'success-surface': '#dcfce7',
    'success-border': '#86efac',
    'success-foreground': '#166534',
    'success-solid': '#16a34a',
    'success-solid-hover': '#15803d',

    // Sin `-solid`: el azul macizo de una acción principal es `--primary`.
    info: '#eff6ff',
    'info-surface': '#dbeafe',
    'info-border': '#bfdbfe',
    'info-foreground': '#1e40af',

    // Asimétrico a propósito: `destructive` y `destructive-foreground` los define
    // shadcn y los consume `Button`.
    'destructive-subtle': '#fef2f2',
    'destructive-border': '#fecaca',
    'destructive-strong': '#b91c1c',

    // El quinto estado: «esperando al usuario». Cuatro semánticos no dan cinco
    // colores, y dos estados pintados igual es perder información.
    'pending-surface': '#f3e8ff',
    'pending-foreground': '#581c87',

    'neutral-surface': '#f3f4f6',
    'neutral-foreground': '#4b5563',
    'neutral-solid': '#6b7280',
    'neutral-solid-hover': '#4b5563',

    // Convenciones (E2). No son estados; ver `globals.css`.
    rating: '#fbbf24',
    featured: '#fbbf24',
    favorite: '#ef4444',
  },

  ejes: {
    // Tipografía: el modelo apunta a la variable que declara `next/font` en el
    // frontend. Un modelo con tipografía propia tendrá que traer su fichero además
    // de su valor — la fuente se sirve del repo, nunca de Google (cicatriz de CI).
    'font-sans': 'var(--font-inter)',
    'font-heading': 'var(--font-sans)',

    radius: '0.5rem',

    'shadow-sm': '0 1px 2px 0 rgb(0 0 0 / 0.05)',
    shadow: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
    'shadow-md': '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
    'shadow-lg': '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
    'shadow-xl': '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',

    'motion-duration': '150ms',
    'motion-ease': 'cubic-bezier(0.4, 0, 0.2, 1)',
    'motion-ease-emphasis': 'ease-in-out',
    'motion-sprite-duration': '1.25s',

    'icon-stroke': '2',
  },

  /**
   * E7 — las diez del Modelo 0. Son línea monocroma en un gris medio, y eso es una
   * decisión y no una falta de tiempo: un `<img>` no hereda `currentColor`, así que el
   * color va DENTRO del fichero — y una ilustración por defecto que llevara el azul de
   * marca pelearía con la primera instancia que eligiera un primario rojo. Sobrio, que es
   * lo que este modelo es.
   */
  ilustraciones: {
    'empty-favorites': '/ilustraciones/empty-favorites.svg',
    'empty-my-listings': '/ilustraciones/empty-my-listings.svg',
    'empty-search': '/ilustraciones/empty-search.svg',
    'empty-messages': '/ilustraciones/empty-messages.svg',
    'empty-tickets': '/ilustraciones/empty-tickets.svg',
    'empty-notifications': '/ilustraciones/empty-notifications.svg',
    'success-payment': '/ilustraciones/success-payment.svg',
    'success-review': '/ilustraciones/success-review.svg',
    'success-listing-published': '/ilustraciones/success-listing-published.svg',
    'success-ticket-sent': '/ilustraciones/success-ticket-sent.svg',
  },

  /**
   * ══ E5 · LAS ZONAS DEL MODELO 0 ═══════════════════════════════════════════════
   *
   * Cada zona AJUSTA tokens que ya existen. Ninguna añade uno propio — eso sería un
   * segundo sistema de estilo, y `zonaSoloAjusta` lo comprueba en CI.
   *
   * `public` NO APARECE: el registro público es la base. Un ajuste suyo sería declarar
   * dos veces lo mismo.
   *
   * Que el Modelo 0 sea sobrio no significa que las zonas sean invisibles: significa
   * que se diferencian por lo que QUITAN, no por lo que añaden.
   */
  ajustesPorZona: {
    /**
     * BACKOFFICE — RESTA (decisión #4). Es una herramienta de trabajo: quien pasa el
     * día aquí no necesita que la interfaz le hable, necesita leer tablas.
     *
     * Se le quita SATURACIÓN a los grises —el azulado de shadcn se atenúa— y se le
     * sube el CONTRASTE del texto secundario, que es el que se lee mil veces al día.
     * La densidad no se toca: es estructura, y moverla sería reorganizar.
     *
     * El tempo baja de 150 a 100 ms. Una herramienta responde; no se luce.
     */
    backoffice: {
      secondary: '210 16% 96.1%',
      muted: '210 16% 96.1%',
      accent: '210 16% 96.1%',
      border: '214.3 13% 91.4%',
      input: '214.3 13% 58%',
      'muted-foreground': '215.4 10% 41%',
      'motion-duration': '100ms',
    },

    /**
     * BLOG — TIÑE. Es el único sitio de la plataforma donde se viene a LEER seguido,
     * y un blanco puro a pantalla completa cansa la vista en un texto largo.
     *
     * El lienzo se calienta un punto —de blanco puro a un hueso casi imperceptible— y
     * la superficie atenuada le acompaña. Nada más: la tipografía de cuerpo y la
     * medida de línea son ESTRUCTURA (la escala tipográfica es inviolable y la medida
     * la fija `prose`), así que una zona no las toca.
     *
     * ⚠ TIÑE `prose`, NUNCA EL MARKDOWN. El contenido lo escribe un editor y sale de
     * la base; lo que cambia aquí es el color del lienzo sobre el que se pinta. Un
     * modelo que quisiera reescribir el texto no estaría revistiendo, estaría
     * editando — y eso la frontera lo prohíbe.
     */
    blog: {
      background: '40 33% 99%',
      card: '40 33% 99%',
      muted: '40 25% 96.1%',
      'motion-duration': '120ms',
    },

    /**
     * CUENTA — el público, un punto más sobria. Aquí se gestiona lo propio (anuncios,
     * mensajes, facturas), así que se parece más al trabajo que al escaparate: la
     * mitad de la resta del backoffice, sin llegar a su austeridad.
     */
    cuenta: {
      secondary: '210 28% 96.1%',
      muted: '210 28% 96.1%',
      accent: '210 28% 96.1%',
      'motion-duration': '120ms',
    },

    /**
     * LOGIN DEL BACKOFFICE — EL OSCURO, POR FIN TEMATIZADO.
     *
     * Esta pantalla llevaba su oscuro escrito a mano en veintidós utilidades `slate-*`
     * desde siempre: era la única del proyecto que no respondía a ningún token, así
     * que ningún modelo podía tocarla. Ahora el oscuro ES la zona, y las clases de la
     * pantalla pasan a ser las de siempre (`bg-background`, `text-foreground`…).
     *
     * LOS VALORES SON LOS MISMOS `slate` QUE YA HABÍA, convertidos a triplete. La
     * conversión se comprobó antes de escribir nada: los ocho tonos hacen el viaje
     * hexadecimal → HSL → rgb sin mover un solo canal (`_rt`), así que la pantalla se
     * ve exactamente igual que antes. Cambia quién manda sobre ella, no cómo se ve.
     *
     * ⚠ SÓLO LA DEL BACKOFFICE, Y ESTO HAY QUE DECIRLO CLARO. El diseño (§5.3)
     * proponía una zona `login` compartida por los dos accesos. Compartir el REGISTRO
     * DE IMPACTO —las animaciones de §6— tiene sentido y llega en E6; compartir esta
     * PALETA no: volvería oscuro el login de usuario, que hoy es claro y que nadie ha
     * pedido cambiar. Un cambio así se aprueba mirándolo, no se cuela dentro del
     * mecanismo de zonas.
     */
    login: {
      background: '228.6 84% 4.9%', // slate-950
      foreground: '210 40% 96.1%', // slate-100
      card: '222.2 47.4% 11.2%', // slate-900
      'card-foreground': '210 40% 96.1%', // slate-100
      popover: '222.2 47.4% 11.2%',
      'popover-foreground': '210 40% 96.1%',
      border: '217.2 32.6% 17.5%', // slate-800
      // slate-500 y no el slate-700 que había: sobre este fondo, aquél daba 1,95:1.
      // Tematizar la zona destapó que el borde de campo de esta pantalla NUNCA cumplió
      // 1.4.11 — nadie lo medía. Ahora la validación lo exige también por zona.
      input: '215.4 16.3% 46.9%', // slate-500 — 4,24:1 sobre el lienzo
      'muted-foreground': '215 20.2% 65.1%', // slate-400
      // El foco sube a slate-300 para no confundirse con el borde en reposo, que ahora
      // es slate-500. Un indicador de foco que se parece al estado normal no indica.
      ring: '212.7 26.8% 83.9%', // slate-300
      // El botón: claro sobre oscuro, que es como estaba.
      primary: '210 40% 96.1%', // slate-100
      'primary-foreground': '222.2 47.4% 11.2%', // slate-900
      // El aviso de error, en su versión oscura.
      'destructive-subtle': '#450a0a', // red-950
      'destructive-border': '#7f1d1d', // red-900
      'destructive-strong': '#fca5a5', // red-300
    },
  },
};

/**
 * ══ E6 · LA RAMPA DEL MODELO DE PRUEBA ════════════════════════════════════════════
 *
 * Invertida respecto a la del Modelo 0: lienzo oscuro, letra clara. Es el eje en el que
 * más se puede diferir sin salirse de lo que un modelo puede hacer, y por eso es el que
 * se elige — un modelo sutil no probaría nada (§10.5).
 *
 * Las luces son absolutas, igual que en el Modelo 0, y por la misma razón de seguridad:
 * ningún neutro elegido por un admin puede volver el texto ilegible.
 */
const RAMPA_PRUEBA: Readonly<Record<string, FranjaRampa>> = {
  background: { dh: 0, ds: -4, l: 8 },
  foreground: { dh: 0, ds: -14, l: 96 },
  // La tarjeta SÍ se separa del fondo, al revés que en el Modelo 0: en un tema oscuro
  // la elevación no se puede insinuar con una sombra, así que la da la luz.
  card: { dh: 0, ds: -2, l: 13 },
  'card-foreground': { dh: 0, ds: -14, l: 96 },
  popover: { dh: 0, ds: -2, l: 16 },
  'popover-foreground': { dh: 0, ds: -14, l: 96 },
  muted: { dh: 0, ds: 0, l: 20 },
  'muted-foreground': { dh: 0, ds: -8, l: 74 },
  border: { dh: 0, ds: -4, l: 30 },
  input: { dh: 0, ds: -4, l: 55 },
};

/**
 * ══ E6 · EL MODELO DE PRUEBA — «Contraluz» ════════════════════════════════════════
 *
 * ── PARA QUÉ EXISTE ──────────────────────────────────────────────────────────────
 *
 * Para que el TEST DE INVARIANCIA DEL HTML (§10.5 del diseño) tenga con qué comparar.
 * Ese test carga la misma ruta con dos modelos distintos y exige que el árbol DOM sea
 * idéntico: si difiere, un modelo REORGANIZÓ en vez de revestir y la frontera —la
 * decisión #1 de todo el sistema— se rompió. Sin un segundo modelo, ese test no puede
 * existir; con un segundo modelo PARECIDO, pasaría por casualidad.
 *
 * De ahí que sea deliberadamente extremo: lienzo oscuro contra el blanco del Modelo 0,
 * naranja contra azul, serif contra Inter, esquinas de 1,25 rem contra 0,5, tempo de
 * 320 ms contra 150 y trazo de icono de 1 contra 2. **Si una reorganización se le
 * escapa a este modelo, no la iba a cazar ninguno.**
 *
 * ── POR QUÉ NO ESTÁ EN EL CATÁLOGO ───────────────────────────────────────────────
 *
 * No es un modelo de producto: nadie lo ha diseñado para que alguien lo use. `catalogo()`
 * sirve `MODELOS`, así que la pantalla de admin no lo ofrece nunca. Sí lo encuentra
 * `buscarModelo`, y eso es a propósito: el test de invariancia lo activa por la VÍA
 * REAL —el endpoint de admin, con su validación AA y su `revalidateTag`—, no escribiendo
 * la fila a mano. Un test que se salta el camino de producción prueba otra cosa.
 *
 * ── TIENE QUE CUMPLIR AA, Y NO ES UN CAPRICHO ────────────────────────────────────
 *
 * `contraste-modelos.spec.ts` lo mide como a cualquier otro. Un modelo de prueba
 * inaccesible enseñaría que la validación se puede esquivar «porque es sólo un test», y
 * la primera excepción a una regla es la que la deroga. Los valores de aquí abajo se
 * ajustaron contra esa medición, no a ojo.
 */
export const MODELO_PRUEBA: Modelo = {
  id: 'modelo-prueba-contraluz',
  nombre: 'Contraluz (prueba)',
  descripcion:
    'Modelo deliberadamente extremo. Existe para que el test de invariancia del HTML tenga contra qué comparar; no se ofrece en el catálogo.',
  versiones: ['1'],

  coloresPorDefecto: {
    primary: '28 96% 54%',
    secondary: '168 62% 30%',
    accent: '318 62% 42%',
    // Un neutro cálido y saturado: mueve la rampa entera lejos del gris azulado.
    neutral: '30 22% 20%',
  },

  // Blanco casi puro y un marrón muy oscuro. La máquina elige por contraste, igual que
  // en el Modelo 0 — un modelo no decide la letra, la decide la medición.
  textoSobre: ['30 30% 98%', '30 50% 8%'],

  rampa: RAMPA_PRUEBA,

  /**
   * Los MISMOS NOMBRES que el Modelo 0, con valores de tema oscuro. Que el juego de
   * nombres coincida no es cosmético: si un modelo declarara menos tokens, las pantallas
   * caerían a `globals.css` para los que faltan y el tema quedaría mezclado. Hay un test
   * que compara los dos juegos de claves.
   */
  semanticos: {
    /**
     * EN UN TEMA OSCURO EL ROJO SE INVIERTE, y lo dijo la barrera. Con el rojo medio del
     * primer intento (`0 72% 51%`) la letra blanca encima cumplía, pero el mismo token
     * usado como TEXTO sobre el lienzo oscuro se quedaba en 3,82:1: en un tema claro el
     * rojo tiene que ser oscuro para leerse, y en uno oscuro tiene que ser claro. No se
     * puede tener las dos con letra blanca encima, así que aquí el rojo es claro y su
     * letra, oscura. Es la misma pareja de siempre, dada la vuelta.
     */
    destructive: '0 85% 68%',
    'destructive-foreground': '30 50% 8%',

    warning: '#2a1f04',
    'warning-surface': '#3d2d05',
    'warning-border': '#a16207',
    'warning-foreground': '#fde68a',
    'warning-solid': '#f59e0b',
    'warning-solid-hover': '#fbbf24',

    success: '#052e16',
    'success-surface': '#064e3b',
    'success-border': '#15803d',
    'success-foreground': '#a7f3d0',
    'success-solid': '#10b981',
    'success-solid-hover': '#34d399',

    info: '#0b1e3a',
    'info-surface': '#12305c',
    'info-border': '#1d4ed8',
    'info-foreground': '#bfdbfe',

    'destructive-subtle': '#3f0a0a',
    'destructive-border': '#991b1b',
    'destructive-strong': '#fca5a5',

    'pending-surface': '#3b0764',
    'pending-foreground': '#e9d5ff',

    'neutral-surface': '#292524',
    'neutral-foreground': '#d6d3d1',
    'neutral-solid': '#a8a29e',
    'neutral-solid-hover': '#d6d3d1',

    rating: '#fbbf24',
    featured: '#fb923c',
    favorite: '#fb7185',
  },

  ejes: {
    // Serif contra la Inter del Modelo 0. No trae fichero propio: apunta a la pila del
    // sistema, que es lo que puede hacer un modelo que no viene con su tipografía.
    'font-sans': 'Georgia, "Times New Roman", serif',
    'font-heading': 'var(--font-sans)',

    radius: '1.25rem',

    // Sombras duras y desplazadas, lo contrario de las difusas del Modelo 0.
    'shadow-sm': '2px 2px 0 0 rgb(0 0 0 / 0.6)',
    shadow: '3px 3px 0 0 rgb(0 0 0 / 0.6)',
    'shadow-md': '5px 5px 0 0 rgb(0 0 0 / 0.6)',
    'shadow-lg': '8px 8px 0 0 rgb(0 0 0 / 0.6)',
    'shadow-xl': '12px 12px 0 0 rgb(0 0 0 / 0.6)',

    'motion-duration': '320ms',
    'motion-ease': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    'motion-ease-emphasis': 'cubic-bezier(0.16, 1, 0.3, 1)',
    'motion-sprite-duration': '2.5s',

    'icon-stroke': '1',
  },

  /**
   * E7 — el modelo de prueba REUSA las del Modelo 0 a propósito. No tiene arte propio y
   * no debe tenerlo: lo que este modelo existe para probar es la FRONTERA (que dos
   * modelos produzcan el mismo HTML), y para eso las imágenes dan igual. Declararlas de
   * todos modos, en vez de dejar el mapa vacío, ejercita el camino «el modelo trae la
   * suya» en vez de dejarlo sin recorrer en ninguna prueba.
   */
  ilustraciones: {
    'empty-favorites': '/ilustraciones/empty-favorites.svg',
    'empty-my-listings': '/ilustraciones/empty-my-listings.svg',
    'empty-search': '/ilustraciones/empty-search.svg',
    'empty-messages': '/ilustraciones/empty-messages.svg',
    'empty-tickets': '/ilustraciones/empty-tickets.svg',
    'empty-notifications': '/ilustraciones/empty-notifications.svg',
    'success-payment': '/ilustraciones/success-payment.svg',
    'success-review': '/ilustraciones/success-review.svg',
    'success-listing-published': '/ilustraciones/success-listing-published.svg',
    'success-ticket-sent': '/ilustraciones/success-ticket-sent.svg',
  },

  /**
   * Zonas: AJUSTA, no inventa — la misma regla dura que el Modelo 0, y comprobada por
   * el mismo test. Se declaran pocas y muy visibles, para que el modelo de prueba
   * también ejercite el mecanismo de zonas.
   */
  ajustesPorZona: {
    backoffice: {
      // La herramienta resta también aquí: menos color y más tempo corto.
      muted: '30 10% 20%',
      accent: '30 10% 26%',
      'motion-duration': '140ms',
    },
    blog: {
      background: '30 22% 11%',
      card: '30 22% 11%',
    },
    login: {
      // Ya es oscuro de fábrica: la zona sube el contraste del lienzo, no lo invierte.
      background: '30 30% 4%',
      card: '30 22% 10%',
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────────────
// E13 · CÁLIDO / EDITORIAL — el segundo modelo del catálogo
// ─────────────────────────────────────────────────────────────────────────────────────

/**
 * LA RAMPA DE «DÍA» — hueso y crema, nunca blanco puro.
 *
 * Es la diferencia de carácter más barata y más eficaz que puede hacer un modelo: el
 * Modelo 0 pinta el lienzo en `0 0% 100%` porque es la plataforma de hoy, y un blanco
 * puro a pantalla completa es lo que hace que una interfaz se lea como una herramienta.
 * Bajar a un hueso cálido la lee como una página impresa, y no cuesta ni un componente.
 *
 * Los desplazamientos se miden sobre el neutro de fábrica de este modelo
 * (`30 12% 92%`, un gris cálido). Como en el Modelo 0, **la luz es absoluta**: el admin
 * puede girar el neutro hacia donde quiera y el lienzo seguirá siendo claro y el texto
 * oscuro. Lo que gira con él es el tono y la saturación — o sea, la familia.
 */
const RAMPA_CALIDO_DIA: Readonly<Record<string, FranjaRampa>> = {
  // 38 44% 97.5% — hueso. Cálido y clarísimo, pero NO blanco.
  background: { dh: 8, ds: 32, l: 97.5 },
  // 25 30% 14% — el texto: un marrón muy oscuro, no negro. Sobre hueso da 15,6:1.
  foreground: { dh: -5, ds: 18, l: 14 },
  // La tarjeta SÍ se despega del lienzo, al revés que en el Modelo 0: sobre un fondo
  // crema, una tarjeta casi blanca es lo que le da relieve a la página sin una sombra.
  card: { dh: 10, ds: 38, l: 99 },
  'card-foreground': { dh: -5, ds: 18, l: 14 },
  popover: { dh: 10, ds: 38, l: 99 },
  'popover-foreground': { dh: -5, ds: 18, l: 14 },
  // 35 30% 94% — la superficie atenuada, un escalón por debajo del lienzo.
  muted: { dh: 5, ds: 18, l: 94 },
  // 25 14% 36% — el texto atenuado. Bajo a propósito: sobre hueso, un gris medio se
  // desvanece antes que sobre blanco.
  'muted-foreground': { dh: -5, ds: 2, l: 36 },
  // 32 24% 86% — el trazo decorativo.
  border: { dh: 2, ds: 12, l: 86 },
  // 28 18% 55% — el borde de campo. Igual que en el Modelo 0, se oscurece lo justo para
  // cumplir 1.4.11 (3:1) y ni un punto más.
  input: { dh: -2, ds: 6, l: 55 },
};

/**
 * «TARDE» — la misma personalidad con la luz de media tarde: el papel se tuesta, el
 * contraste sube y las sombras pesan un poco más.
 *
 * SÓLO REDEFINE FRANJAS Y EJES. No toca los cuatro colores ni la estructura, que son del
 * modelo (decisión #2): quien elige Tarde elige otro AMBIENTE, no otra plataforma.
 */
const RAMPA_CALIDO_TARDE: Readonly<Record<string, FranjaRampa>> = {
  // 32 38% 94% — el papel, tostado. Tres puntos y medio de luz menos que en Día.
  background: { dh: 2, ds: 26, l: 94 },
  // 22 34% 10% — el texto, más profundo: si el lienzo baja, el texto baja con él o el
  // contraste se queda igual y el ambiente no cambia.
  foreground: { dh: -8, ds: 22, l: 10 },
  card: { dh: 6, ds: 32, l: 97 },
  'card-foreground': { dh: -8, ds: 22, l: 10 },
  popover: { dh: 6, ds: 32, l: 97 },
  'popover-foreground': { dh: -8, ds: 22, l: 10 },
  muted: { dh: 0, ds: 18, l: 90 },
  'muted-foreground': { dh: -6, ds: 4, l: 32 },
  border: { dh: -2, ds: 14, l: 82 },
  input: { dh: -4, ds: 8, l: 50 },
};

/**
 * ══ CÁLIDO / EDITORIAL ═══════════════════════════════════════════════════════════════
 *
 * El segundo modelo del catálogo, y el primero que existe para tener CARÁCTER en vez de
 * para no tenerlo. Terracota y crema, titulares con serifa, sombras tibias: una revista,
 * no un panel de control.
 *
 * ── ESTÁ EN SECO, Y ESO ES LA MITAD DEL PUNTO ───────────────────────────────────────
 *
 * `MODELO_POR_DEFECTO` sigue siendo el Modelo 0. Este modelo es ELEGIBLE en
 * `/admin/estilo` y no está activo en ninguna parte, así que las 52 capturas de la
 * batería visual tienen que salir idénticas. Si alguna se mueve, es que se coló en el
 * defecto — y eso es un bug, no un cambio de aspecto.
 *
 * ── LA TIPOGRAFÍA ES DEL SISTEMA, Y ES UNA DECISIÓN DE v1 ───────────────────────────
 *
 * `font-heading` apunta a una pila de serifas del sistema y NO a un fichero propio. El
 * §3.1 del diseño es tajante con las fuentes —se sirven del repo con `next/font/local`,
 * nunca de Google, porque un runner que no alcance `fonts.gstatic.com` tumba el build—, y
 * servir una desde el repo obliga a declararla en `layout.tsx`. Esta ráfaga es **puro
 * registro**: no toca un solo `.tsx`, que es lo que garantiza que un modelo reviste y no
 * reorganiza.
 *
 * Georgia e Iowan Old Style están en Windows y en macOS respectivamente desde hace
 * décadas, así que el carácter editorial llega igual. El día que Ernest apruebe la
 * dirección, cambiar la pila por una serifa propia es una ráfaga aparte —añadir el
 * `.woff2`, declararlo en el layout y cambiar esta línea— y entonces sí toca un `.tsx`.
 *
 * ── LOS VALORES SON DE PARTIDA ──────────────────────────────────────────────────────
 *
 * Los cuatro colores y las dos rampas están medidos contra AA (`contraste-modelos.spec.ts`
 * los valida en CI, las dos versiones y las cinco zonas), pero el ASPECTO es de Ernest:
 * están puestos para que se vean y se ajusten, no para quedarse.
 */
export const MODELO_CALIDO_EDITORIAL: Modelo = {
  id: 'calido-editorial',
  nombre: 'Cálido / Editorial',
  descripcion:
    'Terracota y papel, titulares con serifa. Para que la plataforma se lea como una revista y no como un panel de control.',
  versiones: ['dia', 'tarde'],

  /**
   * LOS CUATRO DE FÁBRICA. Los cálidos son traicioneros con el contraste —un naranja
   * bonito casi nunca aguanta letra blanca— así que estos están elegidos midiendo:
   *
   *  · `primary` es una terracota QUEMADA, no un naranja. La luz al 42 % es lo que
   *    permite las dos cosas que tiene que hacer: llevar letra clara encima (4,5:1) y
   *    servir de anillo de foco sobre el hueso (3:1). Un terracota alegre al 55 % falla
   *    las dos.
   *  · `secondary` es un oliva PROFUNDO, y la profundidad no es gusto: el primer intento
   *    fue `88 20% 44%`, un oliva de media luz que parecía el complemento natural del
   *    terracota — y cayó en la zona muerta donde NINGUNA de las dos letras llega a
   *    4,5:1 (se quedaba en 4,16). Es el defecto clásico de los tonos medios, y en un
   *    modelo cálido es fácil caer en él sin darse cuenta. A 34 % la letra clara da de
   *    sobra.
   *  · `accent` es el coral, que es donde este modelo se permite ser vivo — sólo pinta
   *    fondos de resalte, no texto.
   *  · `neutral` NO es gris puro: lleva tinte cálido, y de él sale la rampa entera. Es el
   *    color que menos se nota y el que más cambia la sensación de la página.
   */
  coloresPorDefecto: {
    primary: '18 68% 42%',
    secondary: '88 22% 34%',
    accent: '8 66% 58%',
    neutral: '30 12% 92%',
  },

  /**
   * Los dos candidatos a letra. Ninguno es blanco ni negro puros: sobre un tema cálido
   * cantan, y el marfil/marrón mantienen la familia. `mejorTextoSobre` elige entre ellos
   * midiendo, así que basta con que los dos sean legibles en su extremo.
   */
  textoSobre: ['40 44% 97%', '25 34% 12%'],

  rampa: RAMPA_CALIDO_DIA,

  porVersion: {
    // «Día» es la versión base: la rampa del modelo tal cual, sin redefinir nada.
    dia: {},
    tarde: {
      rampa: RAMPA_CALIDO_TARDE,
      ejes: {
        // La tarde pesa más: sombras algo más densas y un tempo un punto más lento, que
        // es lo que separa «ágil» de «calmado» sin tocar una sola estructura.
        shadow: '0 1px 3px 0 rgb(60 30 10 / 0.14), 0 1px 2px -1px rgb(60 30 10 / 0.12)',
        'shadow-md':
          '0 4px 8px -1px rgb(60 30 10 / 0.16), 0 2px 5px -2px rgb(60 30 10 / 0.12)',
        'shadow-lg':
          '0 12px 18px -3px rgb(60 30 10 / 0.18), 0 5px 8px -4px rgb(60 30 10 / 0.14)',
        'motion-duration': '200ms',
      },
    },
  },

  /**
   * SE HEREDAN LOS SEMÁNTICOS DEL MODELO 0, Y ES DELIBERADO EN v1.
   *
   * Rojo de error, verde de éxito y ámbar de aviso son convenciones que el usuario trae
   * puestas de fuera; teñirlas de terracota para que «peguen» con el modelo es
   * exactamente el cambio que hace que un error deje de leerse como un error. Además,
   * estos valores están medidos contra AA desde E4b, y reinventarlos en un modelo nuevo
   * sería volver a hacer ese trabajo para ganar coherencia decorativa.
   *
   * Se mantienen a la vista —copiados, no importados— porque un modelo declara TODO lo
   * suyo: el día que este modelo quiera su propio rojo, se cambia aquí y no en dos sitios.
   *
   * ── Y ESE DÍA LLEGÓ, POR UNA RAZÓN QUE NO ES DE GUSTO ──────────────────────────────
   *
   * `destructive` NO se hereda: baja de 47 % a 46 % de luz. Es un arreglo de
   * accesibilidad, medido, y la historia merece quedar escrita porque es la MISMA de E6
   * un escalón más allá.
   *
   * E6 bajó este rojo de 60,2 % a 47 % porque como TEXTO sobre el blanco del Modelo 0 daba
   * 3,76:1. Con 47 % cumplía — sobre BLANCO. Pero el lienzo de «Tarde» es papel tostado
   * (`32 38% 94%`, tres puntos y medio de luz menos que el de «Día»), y sobre él el mismo
   * rojo se queda en **4,446:1**: falla 1.4.3 por cinco centésimas. A 46 % da 4,62:1 y
   * cumple en las dos versiones.
   *
   * ── POR QUÉ NADIE LO HABÍA VISTO ───────────────────────────────────────────────────
   *
   * Porque la barrera no miraba. `contraste-modelos.spec.ts` medía los semánticos UNA VEZ
   * POR MODELO, sin versión, y sin versión este modelo resuelve a «Día» — el lienzo claro,
   * donde el rojo pasa. La pareja «el rojo como texto sobre el lienzo» es la única de las
   * semánticas que se compara contra algo QUE LA VERSIÓN CAMBIA, así que era la única que
   * necesitaba medirse por versión. Ahora se mide.
   *
   * El agujero se destapó construyendo el modelo Premium, al intentar una versión oscura:
   * ver el comentario de `MODELO_PREMIUM`.
   */
  semanticos: { ...MODELO_0.semanticos, destructive: '0 84.2% 46%' },

  ejes: {
    // El cuerpo sigue en Inter: es legible, está en el repo y la escala tipográfica es
    // estructura (T3), no del modelo. Lo que cambia es el TITULAR.
    'font-sans': 'var(--font-inter)',
    /**
     * ⚠ SIN COMILLAS, Y NO ES UN DESCUIDO DE ESTILO: es lo único que hace que este valor
     * LLEGUE.
     *
     * La primera versión era `Georgia, 'Iowan Old Style', 'Times New Roman', serif` y la
     * previa salió con los titulares en sans. El token no estaba muerto —`globals.css`
     * pone `font-family: var(--font-heading)` en los encabezados— ni lo pisaba la
     * cascada: lo descartaba el filtro de inyección de `lib/estilo-css.ts`, cuyo
     * `VALOR_SEGURO` no admite comillas a propósito («un valor que no reconocemos es un
     * valor en el que no se confía»). Se caía en silencio, que es como se caen estas
     * cosas.
     *
     * CSS admite familias de varias palabras SIN comillas mientras cada palabra sea un
     * identificador válido, así que `Times New Roman` a pelo es correcto y además pasa el
     * filtro. Georgia está en Windows y en macOS desde hace décadas; Cambria cubre el
     * Windows sin Georgia; `serif` cierra.
     */
    'font-heading': 'Georgia, Cambria, Times New Roman, serif',

    // Menos redondeado que el Modelo 0: lo editorial es más recto.
    radius: '0.375rem',

    // Sombras TIBIAS: el negro puro sobre un lienzo crema hace una sombra gris que se ve
    // sucia. Estas llevan tinte marrón, así que el papel parece papel.
    'shadow-sm': '0 1px 2px 0 rgb(60 30 10 / 0.06)',
    shadow: '0 1px 3px 0 rgb(60 30 10 / 0.10), 0 1px 2px -1px rgb(60 30 10 / 0.09)',
    'shadow-md': '0 4px 6px -1px rgb(60 30 10 / 0.12), 0 2px 4px -2px rgb(60 30 10 / 0.09)',
    'shadow-lg': '0 10px 15px -3px rgb(60 30 10 / 0.13), 0 4px 6px -4px rgb(60 30 10 / 0.10)',
    'shadow-xl': '0 20px 25px -5px rgb(60 30 10 / 0.14), 0 8px 10px -6px rgb(60 30 10 / 0.10)',

    // Un pelo más presente que el Modelo 0 (150ms): editorial no es lento, es tranquilo.
    'motion-duration': '180ms',
    'motion-ease': 'cubic-bezier(0.32, 0.72, 0, 1)',
    'motion-ease-emphasis': 'cubic-bezier(0.4, 0, 0.2, 1)',
    'motion-sprite-duration': '1.4s',

    // Trazo de icono más fino: acompaña a la serifa. El Modelo 0 usa 2.
    'icon-stroke': '1.75',
  },

  /**
   * LAS DIEZ, APUNTANDO A LAS DE SIEMPRE — y declaradas una por una a propósito.
   *
   * El primer intento las dejó vacías, razonando que el registro cierra la cadena de
   * respaldo (admin → modelo → registro) y ninguna pantalla se quedaría sin imagen. Es
   * cierto y **aun así estaba mal**: `ilustraciones.spec.ts` exige que TODO modelo declare
   * los diez slots, y la cabecera de ese test explica por qué el respaldo no basta —está
   * ahí para que un olvido no rompa nada, no para que un modelo delegue en él—. Un modelo
   * que no declara no dice «sirvo las de siempre», dice «no lo he pensado».
   *
   * Este sí lo ha pensado: las del Modelo 0 son línea monocroma en gris medio —neutras a
   * propósito— y no pelean con el terracota. Un juego propio y cálido es trabajo de
   * ilustración, no de registro, y llega cuando Ernest apruebe la dirección: entonces se
   * cambian estas diez líneas y nada más.
   */
  ilustraciones: { ...MODELO_0.ilustraciones },

  /**
   * LAS ZONAS, con la misma INTENCIÓN que en el Modelo 0 y el vocabulario de éste.
   *
   * Es lo que hace que esto sea un modelo y no una paleta: las cinco decisiones de E5
   * —el backoffice resta, el blog tiñe, la cuenta va a medio camino, el login es oscuro—
   * son del SISTEMA, y un modelo las expresa en sus propios colores en vez de heredarlas
   * literales. `public` no aparece: el registro público es la base.
   */
  ajustesPorZona: {
    /**
     * BACKOFFICE — resta. Se le quita el tueste al lienzo (queda casi blanco, que es lo
     * que una tabla necesita) y se sube el contraste del texto atenuado. El tempo baja:
     * una herramienta responde.
     */
    backoffice: {
      background: '38 20% 98.5%',
      card: '38 20% 99.5%',
      muted: '35 14% 95%',
      accent: '35 14% 95%',
      border: '32 12% 88%',
      input: '28 10% 52%',
      'muted-foreground': '25 8% 32%',
      'motion-duration': '120ms',
    },

    /**
     * BLOG — tiñe, y aquí el modelo por fin no tiene que contenerse: es donde se viene a
     * leer seguido y donde el papel cálido está en su sitio. Un punto MÁS tostado que el
     * lienzo base, no menos.
     */
    blog: {
      background: '36 46% 96.5%',
      card: '36 46% 96.5%',
      muted: '34 34% 93%',
      'motion-duration': '160ms',
    },

    /** CUENTA — a medio camino entre el escaparate y la herramienta, como en el Modelo 0. */
    cuenta: {
      background: '37 32% 98%',
      muted: '35 22% 94.5%',
      accent: '35 22% 94.5%',
      'motion-duration': '150ms',
    },

    /**
     * LOGIN DEL BACKOFFICE — el oscuro, en cálido. Mismo papel que en el Modelo 0: la
     * puerta de servicio se distingue de un vistazo.
     *
     * Los valores están medidos, no elegidos a ojo: sobre este lienzo, el borde de campo
     * y el anillo de foco tienen que cumplir 1.4.11 igual que en cualquier otra zona, y
     * `contraste-modelos.spec.ts` lo exige zona por zona.
     */
    login: {
      background: '24 28% 8%',
      foreground: '38 30% 94%',
      card: '24 24% 13%',
      'card-foreground': '38 30% 94%',
      popover: '24 24% 13%',
      'popover-foreground': '38 30% 94%',
      border: '24 18% 22%',
      input: '28 14% 52%',
      'muted-foreground': '32 16% 68%',
      ring: '30 45% 72%',
      primary: '38 30% 94%',
      'primary-foreground': '24 24% 13%',
      'destructive-subtle': '#3d0d0d',
      'destructive-border': '#7f1d1d',
      'destructive-strong': '#fca5a5',
    },
  },
};

/**
 * LA RAMPA DE «CLARO» — blanco dominante con el aire frío dentro.
 *
 * El Modelo 0 pinta el lienzo en blanco PURO (`0 0% 100%`) y el Cálido/Editorial en
 * hueso. Éste hace la tercera cosa posible: un blanco que sigue siendo blanco pero lleva
 * una gota de azul, de modo que el ojo lo lee como aire y no como papel. La diferencia
 * con el Modelo 0 son cinco décimas de luz y un tinte; suena a nada y es justo lo que
 * separa «herramienta» de «producto que respira».
 *
 * Los desplazamientos se miden sobre el neutro de fábrica de este modelo
 * (`214 14% 93%`, un gris FRÍO). Como en los otros dos, **la luz es absoluta**: el admin
 * puede girar el neutro hacia donde quiera y el lienzo seguirá siendo claro y el texto
 * oscuro. Lo que gira con él es la familia.
 */
const RAMPA_FRESCO_CLARO: Readonly<Record<string, FranjaRampa>> = {
  // 208 36% 99.5% — blanco con una gota de azul. NO es hueso y NO es blanco puro.
  background: { dh: -6, ds: 22, l: 99.5 },
  // 218 42% 12% — el texto: un azul marino casi negro. Sobre el lienzo da 17,6:1.
  foreground: { dh: 4, ds: 28, l: 12 },
  // La tarjeta va POR ENCIMA del lienzo (blanco pleno), al revés que en el Modelo 0
  // —donde valen lo mismo— y como en el Cálido. Es lo que da relieve sin gastar sombra:
  // en un modelo aireado, el relieve lo hace la luz, no el contorno.
  card: { dh: -6, ds: 22, l: 100 },
  'card-foreground': { dh: 4, ds: 28, l: 12 },
  popover: { dh: -6, ds: 22, l: 100 },
  'popover-foreground': { dh: 4, ds: 28, l: 12 },
  // 212 30% 96% — la superficie atenuada, un escalón por debajo del lienzo.
  muted: { dh: -2, ds: 16, l: 96 },
  // 215 18% 40% — el texto atenuado. 4,82:1 sobre el lienzo: cumple con holgura corta y
  // a propósito, porque es un gris que tiene que leerse ATENUADO, no gritar.
  'muted-foreground': { dh: 1, ds: 4, l: 40 },
  // 214 24% 89% — el trazo decorativo, frío y limpio.
  border: { dh: 0, ds: 10, l: 89 },
  /**
   * 214 20% 53% — EL BORDE DE CAMPO, y el 53 no es redondo por gusto.
   *
   * A 56 % de luz daba 2,94:1 sobre este lienzo: falla 1.4.11 por seis centésimas. Es
   * exactamente la trampa que documenta el Modelo 0 —un valor que «parece» bastante
   * oscuro y no lo es— y aquí muerde antes, porque el lienzo de este modelo es más claro
   * que el suyo. A 53 % da 3,22:1.
   */
  input: { dh: 0, ds: 6, l: 53 },
};

/**
 * «NÍTIDO» — la misma personalidad, subida de definición: el tinte frío se nota más, el
 * texto es más profundo y **los trazos pesan de verdad**.
 *
 * ⚠ LO QUE ESTA VERSIÓN NO PUEDE HACER, Y CONVIENE QUE ESTÉ ESCRITO. El encargo pedía
 * «primary más saturado» para Nítido, y eso **el mecanismo no lo permite**: una versión
 * redefine `rampa` y `ejes`, nunca los cuatro colores configurables —son del modelo, y la
 * decisión #2 dice que el juego de atributos es el mismo para todas—. Ampliarlo sería
 * cambiar el mecanismo de E13, no afinar un ambiente.
 *
 * Así que la «más presencia» se consigue con lo que sí es de la versión, y se consigue de
 * verdad: el lienzo baja medio punto y sube su tinte (de 36 % a 45 % de saturación), el
 * texto baja de 12 % a 9 % de luz, el trazo decorativo pasa de 89 % a 82 % —siete puntos,
 * que en un borde es la diferencia entre insinuado y dibujado— y el de campo de 53 % a
 * 46 %. Medido, no afirmado: `estilo.spec.ts` exige que las dos versiones difieran en
 * lienzo, texto y trazo.
 */
const RAMPA_FRESCO_NITIDO: Readonly<Record<string, FranjaRampa>> = {
  // 210 45% 99% — medio punto menos de luz y nueve más de tinte: se nota que es frío.
  background: { dh: -4, ds: 31, l: 99 },
  // 220 55% 9% — el texto, más profundo. Si el lienzo baja, el texto baja con él o el
  // contraste se queda igual y el ambiente no cambia (la lección de «Tarde»).
  foreground: { dh: 6, ds: 41, l: 9 },
  card: { dh: -6, ds: 26, l: 100 },
  'card-foreground': { dh: 6, ds: 41, l: 9 },
  popover: { dh: -6, ds: 26, l: 100 },
  'popover-foreground': { dh: 6, ds: 41, l: 9 },
  muted: { dh: -2, ds: 24, l: 94.5 },
  // 216 26% 34% — el atenuado deja de ser tímido: 7,75:1 en vez de 4,82:1.
  'muted-foreground': { dh: 2, ds: 12, l: 34 },
  // 214 32% 82% — EL TRAZO, que es donde más se ve la palabra «nítido».
  border: { dh: 0, ds: 18, l: 82 },
  // 214 28% 46% — el borde de campo, muy por encima del mínimo (4,96:1).
  input: { dh: 0, ds: 14, l: 46 },
};

/**
 * ══ FRESCO / CONFIANZA ═══════════════════════════════════════════════════════════════
 *
 * El tercer modelo del catálogo, y el opuesto exacto del Cálido/Editorial: frío, aireado,
 * nítido. Azul vivo, turquesa y violeta sobre grises azulados; titulares en una sans
 * geométrica; sombras frías y ágiles. Donde aquél quiere leerse como una revista, éste
 * quiere leerse como una herramienta en la que se confía: rápida, limpia, sin adornos.
 *
 * ── ESTÁ EN SECO, Y ESO ES LA MITAD DEL PUNTO ───────────────────────────────────────
 *
 * `MODELO_POR_DEFECTO` sigue siendo el Modelo 0. Este modelo es ELEGIBLE en
 * `/admin/estilo` y no está activo en ninguna parte, así que las 52 capturas de la
 * batería visual tienen que salir IDÉNTICAS. Si alguna se mueve, es que se coló en el
 * defecto — y eso es un bug de registro, no un cambio de aspecto.
 *
 * ── PURO REGISTRO: CERO `.tsx` ──────────────────────────────────────────────────────
 *
 * No se toca un solo componente, y no es una casualidad de esta ráfaga: es la decisión #1
 * («un modelo reviste, no reorganiza») hecha práctica. El catálogo lo sirve el backend y
 * `/admin/estilo` lo pinta desde ahí, así que un modelo nuevo llega a la pantalla sin que
 * el frontend se entere de que existe.
 *
 * ── LOS COLORES ESTÁN MEDIDOS, NO ELEGIDOS A OJO ────────────────────────────────────
 *
 * La lección del oliva del Cálido/Editorial se repite aquí con otro color y la misma
 * forma: los tonos de LUZ MEDIA caen en una zona muerta donde NINGUNA de las dos letras
 * llega a 4,5:1. Le pasó al violeta al 62 % (4,36:1 con letra clara, 3,93:1 con oscura) y
 * al turquesa profundo al 36 % (4,47:1, a tres centésimas). Los dos se movieron hasta que
 * la medición pasó. `contraste-modelos.spec.ts` valida las DOS versiones por las CINCO
 * zonas en CI.
 *
 * ── LOS VALORES SON DE PARTIDA ──────────────────────────────────────────────────────
 *
 * Cumplen AA y están puestos para verse y ajustarse, no para quedarse: el ASPECTO es de
 * Ernest.
 */
export const MODELO_FRESCO_CONFIANZA: Modelo = {
  id: 'fresco-confianza',
  nombre: 'Fresco / Confianza',
  descripcion:
    'Azul vivo, turquesa y grises fríos, titulares en sans geométrica. Para que la plataforma se lea como una herramienta rápida y limpia en la que se confía.',
  versiones: ['claro', 'nitido'],

  /**
   * LOS CUATRO DE FÁBRICA. Los fríos engañan al revés que los cálidos: parecen seguros
   * porque son oscuros, y luego el que falla es el vivo del medio.
   *
   *  · `primary` es un AZUL CON ENERGÍA, no el azul corporativo apagado de siempre. Al
   *    50 % de luz hace las dos cosas que tiene que hacer: llevar letra clara encima
   *    (5,90:1) y servir de anillo de foco sobre un lienzo casi blanco (5,62:1). Subirlo
   *    a 60 % lo haría más alegre y rompería la primera.
   *  · `secondary` es un TURQUESA VIVO, y es el único de los tres que lleva letra OSCURA
   *    — `mejorTextoSobre` lo elige midiendo, no hay que decírselo—. Ese es justamente el
   *    motivo de que pueda ser vivo: a 46 % con letra clara daría 2,7:1, pero con letra
   *    oscura da 6,4:1. El turquesa PROFUNDO que probé primero (34-36 % de luz) llevaba
   *    letra clara y se quedaba en 4,47:1: la zona muerta, otra vez.
   *  · `accent` es el VIOLETA, el contraste frío. Al 62 % —que es lo que pedía el ojo—
   *    caía en la zona muerta por las dos caras; a 55 % lleva letra clara con 5,90:1.
   *  · `neutral` NO es gris puro: lleva tinte AZULADO, y de él sale la rampa entera. Es lo
   *    que hace que los grises de este modelo se lean como aire y no como polvo.
   */
  coloresPorDefecto: {
    primary: '222 76% 50%',
    secondary: '188 62% 46%',
    accent: '262 65% 55%',
    neutral: '214 14% 93%',
  },

  /**
   * Los dos candidatos a letra. Ninguno es blanco ni negro puros: sobre un tema frío el
   * negro puro hace un agujero y el blanco puro deslumbra. El casi-blanco azulado y el
   * azul marino mantienen la familia, y `mejorTextoSobre` elige entre ellos midiendo.
   */
  textoSobre: ['210 40% 98%', '215 45% 12%'],

  rampa: RAMPA_FRESCO_CLARO,

  porVersion: {
    // «Claro» es la versión base: la rampa del modelo tal cual, sin redefinir nada.
    claro: {},
    nitido: {
      rampa: RAMPA_FRESCO_NITIDO,
      ejes: {
        // Nítido define: sombras con más presencia y un tempo aún más corto. El radio
        // baja a la mitad — una esquina más recta es la forma más barata de decir
        // «preciso» sin tocar una estructura.
        radius: '0.125rem',
        shadow: '0 1px 3px 0 rgb(15 30 60 / 0.16), 0 1px 2px -1px rgb(15 30 60 / 0.14)',
        'shadow-md': '0 4px 8px -2px rgb(15 30 60 / 0.18), 0 2px 4px -2px rgb(15 30 60 / 0.14)',
        'shadow-lg': '0 10px 18px -4px rgb(15 30 60 / 0.20), 0 4px 7px -4px rgb(15 30 60 / 0.16)',
        'motion-duration': '110ms',
      },
    },
  },

  /**
   * SE HEREDAN LOS SEMÁNTICOS DEL MODELO 0, por la misma razón que el Cálido/Editorial:
   * rojo de error, verde de éxito y ámbar de aviso son convenciones que el usuario trae
   * puestas de fuera, y enfriarlas para que «peguen» con el azul es exactamente el cambio
   * que hace que un error deje de leerse como un error. Además están medidos contra AA
   * desde E4b.
   *
   * Copiados y no importados, como allí: un modelo declara TODO lo suyo, y el día que éste
   * quiera su propio rojo se cambia aquí y no en dos sitios.
   */
  semanticos: { ...MODELO_0.semanticos },

  ejes: {
    // El cuerpo sigue en Inter: es legible, está en el repo y la escala tipográfica es
    // estructura (T3), no del modelo. Lo que cambia es el TITULAR.
    'font-sans': 'var(--font-inter)',
    /**
     * ⚠ SIN COMILLAS. Es la cicatriz del Cálido/Editorial y se repite aquí porque el
     * filtro es el mismo: `VALOR_SEGURO` de `lib/estilo-css.ts` no admite comillas a
     * propósito, y un `font-heading` con ellas se DESCARTA EN SILENCIO — el token no
     * llega, los titulares salen en sans y nadie ve un error por ninguna parte.
     *
     * CSS admite familias de varias palabras sin comillas mientras cada palabra sea un
     * identificador válido, así que `Avenir Next` y `Segoe UI` a pelo son correctos y
     * además pasan el filtro.
     *
     * LA PILA, y por qué ésta: el frío pide una sans NÍTIDA, no una serifa —eso es lo que
     * hace el otro modelo—. Avenir Next es la geométrica de macOS; Segoe UI cubre Windows;
     * Helvetica Neue y Arial cierran; `sans-serif` es el último recurso. Igual que allí,
     * se usa la pila del SISTEMA y no un fichero propio porque esta ráfaga es puro
     * registro: servir una fuente del repo obliga a declararla en `layout.tsx`, y eso es
     * tocar un `.tsx`. Cuando Ernest apruebe la dirección, traer una geométrica propia es
     * una ráfaga aparte y entonces sí.
     */
    'font-heading': 'Avenir Next, Segoe UI, Helvetica Neue, Arial, sans-serif',

    // Más recto que los otros dos (0.5 el Modelo 0, 0.375 el editorial): lo preciso no se
    // redondea.
    radius: '0.25rem',

    // Sombras FRÍAS y CORTAS. El negro puro sobre un lienzo azulado hace una sombra gris
    // que ensucia; éstas llevan tinte marino. Y son de poco radio a propósito: una sombra
    // difusa es acogedora —que es lo que quiere el editorial— y una corta es definida.
    'shadow-sm': '0 1px 2px 0 rgb(15 30 60 / 0.07)',
    shadow: '0 1px 2px 0 rgb(15 30 60 / 0.12), 0 1px 1px -1px rgb(15 30 60 / 0.10)',
    'shadow-md': '0 3px 5px -1px rgb(15 30 60 / 0.13), 0 1px 3px -2px rgb(15 30 60 / 0.10)',
    'shadow-lg': '0 8px 12px -3px rgb(15 30 60 / 0.14), 0 3px 5px -4px rgb(15 30 60 / 0.11)',
    'shadow-xl': '0 16px 20px -5px rgb(15 30 60 / 0.15), 0 6px 8px -6px rgb(15 30 60 / 0.11)',

    // ÁGIL: 120 ms contra los 150 del Modelo 0 y los 180 del editorial. Este modelo
    // promete rapidez; el tempo es donde esa promesa se cumple o se rompe.
    'motion-duration': '120ms',
    'motion-ease': 'cubic-bezier(0.2, 0, 0, 1)',
    'motion-ease-emphasis': 'cubic-bezier(0.3, 0, 0.1, 1)',
    'motion-sprite-duration': '1.1s',

    // Trazo de icono FINO: acompaña a la geométrica. El Modelo 0 usa 2, el editorial 1.75.
    'icon-stroke': '1.5',
  },

  /**
   * LAS DIEZ, DECLARADAS UNA POR UNA — no vacías.
   *
   * `ilustraciones.spec.ts` exige que TODO modelo declare los diez slots, y la cabecera de
   * ese test explica por qué el respaldo del registro no basta: está ahí para que un
   * olvido no rompa nada, no para que un modelo delegue en él. Un modelo que no declara no
   * dice «sirvo las de siempre», dice «no lo he pensado».
   *
   * Éste sí: las del Modelo 0 son línea monocroma en gris medio, y un gris neutro sobre un
   * modelo frío pega mejor que sobre uno cálido — no hay nada que corregir todavía. Un
   * juego propio y frío es trabajo de ilustración, no de registro.
   */
  ilustraciones: { ...MODELO_0.ilustraciones },

  /**
   * LAS ZONAS, con la misma INTENCIÓN que en los otros dos modelos y el vocabulario de
   * éste. Las cinco decisiones de E5 son del SISTEMA; un modelo las expresa en sus colores
   * en vez de heredarlas literales. `public` no aparece: el registro público es la base.
   */
  ajustesPorZona: {
    /**
     * BACKOFFICE — resta. Aquí el modelo se quita el tinte: el lienzo va a blanco casi
     * puro, que es lo que una tabla de doscientas filas necesita, y el texto atenuado sube
     * de contraste. El tempo baja a 90 ms: si el modelo base ya promete agilidad, la
     * herramienta la cumple del todo.
     *
     * ⚠ `accent-foreground` VA CON `accent`, Y ESO NO ESTABA EN LOS OTROS DOS MODELOS.
     *
     * Las zonas sobrias repintan `accent` —la superficie de resalte— con el mismo gris
     * casi blanco que `muted`: es lo que hacen el Modelo 0 y el Cálido/Editorial, y es
     * correcto, porque en una herramienta el resalte no debe gritar. Pero `accent`
     * **viene emparejado con su letra**, que `resolverTokens` elige midiendo sobre el
     * color del MODELO, no sobre el de la zona.
     *
     * Aquí eso rompía: el violeta de fábrica es oscuro, así que su letra es clara — y
     * letra clara sobre un gris del 96 % da **1,05:1**. Lo cazó `contraste-modelos.spec.ts`
     * por zona, que es exactamente para lo que existe.
     *
     * El Cálido/Editorial no lo sufre por CASUALIDAD, no por diseño: su coral al 58 %
     * lleva letra oscura, así que al repintar la superficie la pareja seguía funcionando.
     * O sea que la regla general es ésta y nadie la había tenido que escribir todavía:
     * **una zona que repinta una superficie repinta también su letra**, o hereda la del
     * color que ya no está ahí. La zona `login` ya lo hacía con `primary`/
     * `primary-foreground`; esto es lo mismo un token más allá.
     */
    backoffice: {
      background: '210 20% 99.5%',
      card: '0 0% 100%',
      muted: '212 16% 96%',
      accent: '212 16% 96%',
      'accent-foreground': '218 42% 12%',
      border: '214 14% 90%',
      input: '214 12% 52%',
      'muted-foreground': '215 12% 34%',
      'motion-duration': '90ms',
    },

    /**
     * BLOG — tiñe, y en un modelo frío teñir significa BAJAR EL BLANCO, no calentarlo.
     * Leer seguido sobre blanco puro cansa; un azul grisáceo clarísimo da el mismo
     * descanso que el hueso del editorial sin traicionar el carácter del modelo.
     */
    blog: {
      background: '208 34% 97.5%',
      card: '208 34% 97.5%',
      muted: '210 26% 94.5%',
      'motion-duration': '140ms',
    },

    /**
     * CUENTA — a medio camino entre el escaparate y la herramienta, como en los otros dos.
     * Repinta `accent` igual que el backoffice, así que se lleva su letra con él — ver el
     * aviso de arriba.
     */
    cuenta: {
      background: '209 28% 99%',
      muted: '212 22% 95.5%',
      accent: '212 22% 95.5%',
      'accent-foreground': '218 42% 12%',
      'motion-duration': '110ms',
    },

    /**
     * LOGIN DEL BACKOFFICE — el oscuro, en frío. Mismo papel que en los otros dos modelos:
     * la puerta de servicio se distingue de un vistazo.
     *
     * Los valores están medidos, no elegidos: sobre este lienzo el borde de campo y el
     * anillo de foco tienen que cumplir 1.4.11 igual que en cualquier otra zona, y el azul
     * de marca —que es el anillo por defecto— es demasiado oscuro para verse sobre un
     * marino, así que la zona lo sustituye por un azul claro. Es exactamente lo que hace
     * el Cálido/Editorial con el suyo.
     */
    login: {
      background: '220 45% 7%',
      foreground: '210 30% 95%',
      card: '219 38% 12%',
      'card-foreground': '210 30% 95%',
      popover: '219 38% 12%',
      'popover-foreground': '210 30% 95%',
      border: '216 26% 22%',
      input: '214 20% 52%',
      'muted-foreground': '212 20% 70%',
      ring: '210 85% 68%',
      primary: '210 30% 95%',
      'primary-foreground': '219 38% 12%',
      'destructive-subtle': '#3d0d0d',
      'destructive-border': '#7f1d1d',
      'destructive-strong': '#fca5a5',
    },
  },
};

/**
 * LA RAMPA DE «CLARO» — blanco, grises VERDADEROS y el contraste subido.
 *
 * Los otros tres modelos tiñen su rampa: el Modelo 0 la deja azulada de fábrica, el
 * Cálido la calienta y el Fresco la enfría. Éste hace lo contrario de todos: la
 * desatura casi del todo. El neutro de fábrica es `220 6% 92%` —seis puntos de
 * saturación, prácticamente gris puro— y de ahí sale una escala que no tiene color,
 * sólo luz.
 *
 * ESO ES LO QUE HACE QUE UN MONOCROMO SE LEA COMO CALIDAD Y NO COMO UN BORRADOR: si no
 * hay color que mirar, lo único que queda es la separación entre superficies, y ahí no
 * se puede disimular. Por eso el contraste va alto y no medio — el texto atenuado da
 * 6,37:1 contra los 4,5 que exige la norma, y el trazo está en 86 % de luz cuando el
 * Modelo 0 lo deja en 91,4.
 *
 * Como en los otros tres, **la luz es absoluta**: el admin puede girar el neutro hacia
 * donde quiera y el lienzo seguirá claro y el texto oscuro.
 */
const RAMPA_PREMIUM_CLARO: Readonly<Record<string, FranjaRampa>> = {
  background: { dh: 0, ds: 8, l: 99 },
  foreground: { dh: 0, ds: 29, l: 9 },
  card: { dh: 0, ds: 8, l: 100 },
  'card-foreground': { dh: 0, ds: 29, l: 9 },
  popover: { dh: 0, ds: 8, l: 100 },
  'popover-foreground': { dh: 0, ds: 29, l: 9 },
  muted: { dh: 0, ds: 6, l: 95.5 },
  'muted-foreground': { dh: 0, ds: 4, l: 38 },
  border: { dh: 0, ds: 4, l: 86 },
  input: { dh: 0, ds: 6, l: 48 },
};

/**
 * «CLARO INTENSO» — la misma personalidad, con el contraste llevado al tope.
 *
 * El lienzo sube a blanco PURO (la máxima separación posible con las superficies), el
 * texto baja a 5 % de luz, la superficie atenuada se despega dos puntos y medio más y el
 * trazo pasa de 86 % a 78 % — ocho puntos, que en un monocromo es toda la diferencia
 * entre «sobrio» y «rotundo», porque no hay color que distraiga de la línea.
 *
 * ⚠ ESTA VERSIÓN NO ES LA QUE EL ENCARGO PEDÍA, y el porqué está en el comentario del
 * modelo: «Oscuro contenido» NO SE PUEDE HACER como versión. No es una renuncia estética,
 * es un límite del mecanismo, medido.
 */
const RAMPA_PREMIUM_INTENSO: Readonly<Record<string, FranjaRampa>> = {
  background: { dh: 0, ds: 8, l: 100 },
  foreground: { dh: 0, ds: 34, l: 5 },
  card: { dh: 0, ds: 8, l: 100 },
  'card-foreground': { dh: 0, ds: 34, l: 5 },
  popover: { dh: 0, ds: 8, l: 100 },
  'popover-foreground': { dh: 0, ds: 34, l: 5 },
  muted: { dh: 0, ds: 8, l: 93 },
  'muted-foreground': { dh: 0, ds: 6, l: 30 },
  border: { dh: 0, ds: 6, l: 78 },
  input: { dh: 0, ds: 8, l: 40 },
};

/**
 * ══ PREMIUM ══════════════════════════════════════════════════════════════════════════
 *
 * El cuarto modelo. Monocromo de grises verdaderos con UN acento de bronce, titulares con
 * serifa humanista, esquinas casi rectas, sombras difusas y un tempo lento. Refinado y
 * discreto: la calidad se nota en el contraste y en el detalle, no en el color.
 *
 * ── EL ENCARGO PEDÍA UNA VERSIÓN OSCURA. NO SE PUEDE, Y NO POR EL OSCURO ────────────
 *
 * La pregunta era si el mecanismo soporta «Oscuro contenido» como VERSIÓN. La respuesta
 * se midió antes de construir nada —se escribió la rampa oscura y se le pasó la barrera—
 * y es NO, con dos motivos que conviene separar del que parecía obvio:
 *
 * **El oscuro NO es el problema.** Este sistema ya pinta superficies oscuras y las pinta
 * bien: `MODELO_PRUEBA` es un modelo de lienzo carbón que cumple AA entero, y los TRES
 * modelos del catálogo tienen una zona `login` oscura. La rampa admite luz baja sin
 * pestañear, porque la luz de cada franja es absoluta.
 *
 * Lo que no se puede es hacerlo **desde una versión**, porque `AjustesDeVersion` sólo
 * redefine `rampa` y `ejes`, y un lienzo oscuro necesita tocar dos cosas más:
 *
 *  1. **EL ANILLO DE FOCO.** `resolverTokens` lo deriva de `primary`, que es uno de los
 *     cuatro colores configurables y por tanto del MODELO (decisión #2). El azul marino
 *     de este modelo sobre un carbón del 11 % da **1,71:1** contra los 3:1 que exige
 *     1.4.11 — lo cazó `contraste-modelos.spec.ts` en la base y en las cinco zonas.
 *  2. **LOS SEMÁNTICOS.** También son del modelo. `MODELO_PRUEBA` lo explica en su propio
 *     comentario: «en un tema claro el rojo tiene que ser oscuro para leerse, y en uno
 *     oscuro tiene que ser claro». Una versión oscura heredaría los catorce semánticos
 *     claros de su modelo y no hay forma de cambiarlos.
 *
 * **LA ASIMETRÍA QUE ESTO DESTAPA, y que no estaba escrita en ninguna parte:** una ZONA
 * puede redefinir CUALQUIER token —por eso el `login` oscuro funciona: redefine `ring`,
 * `primary` y el trío destructivo—; una VERSIÓN sólo puede redefinir dos cosas. El eje de
 * zona tiene escapes que el eje de versión no tiene.
 *
 * **LAS SALIDAS, para cuando Ernest quiera el oscuro** (ninguna es esta ráfaga):
 *
 *  · **«Premium Oscuro» como MODELO propio.** Es la barata y la que el mecanismo ya
 *    soporta hoy sin tocar una línea de infraestructura: un modelo declara sus cuatro
 *    colores y sus catorce semánticos, así que puede ser oscuro entero. Cuesta duplicar
 *    el registro, que es exactamente el precio que `pendientes.md` ya anotó para el eje
 *    de «ambiente» de Cálido/Editorial;
 *  · **ampliar `AjustesDeVersion`** con `semanticos` y una forma de fijar `ring`. Es más
 *    limpio conceptualmente y toca el mecanismo de E13 — decisión, no fleco;
 *  · **el modo oscuro de verdad** (el que la decisión #1 dejó fuera de v1): un eje
 *    paralelo con `prefers-color-scheme`. Es otra cosa y mucho más cara.
 *
 * Así que Premium entra con DOS VERSIONES CLARAS y distintas — «Claro» y «Claro
 * intenso»—, y el oscuro queda anotado arriba en vez de forzado.
 *
 * ── ESTÁ EN SECO ───────────────────────────────────────────────────────────────────
 *
 * `MODELO_POR_DEFECTO` sigue siendo el Modelo 0. Es ELEGIBLE y no está activo en ninguna
 * parte, así que las 52 capturas tienen que salir idénticas.
 *
 * ── PURO REGISTRO: CERO `.tsx` ─────────────────────────────────────────────────────
 *
 * El molde de los otros dos modelos de catálogo. El backend sirve el catálogo y
 * `/admin/estilo` lo pinta desde ahí.
 */
export const MODELO_PREMIUM: Modelo = {
  id: 'premium',
  nombre: 'Premium',
  descripcion:
    'Monocromo de grises verdaderos con un acento de bronce, titulares con serifa. Refinado y discreto: la calidad se nota en el contraste y en el detalle, no en el color.',
  versiones: ['claro', 'claro-intenso'],

  /**
   * LOS CUATRO DE FÁBRICA. Aquí la dificultad es la contraria que en los otros dos: los
   * tonos OSCUROS y saturados contrastan solos, así que `primary` y `secondary` salieron
   * a la primera. El que costó fue el acento.
   *
   *  · `primary` es un AZUL MARINO, no un azul. Al 30 % de luz lleva letra clara con
   *    **10,08:1** —el doble de lo que la norma pide— y sirve de anillo de foco con
   *    9,79:1. Se eligió el marino entre los tres candidatos elegantes (marino, verde
   *    bosque, burdeos) por versatilidad: es el único que no arrastra una connotación
   *    (el verde dice «ecológico», el burdeos dice «vino») en una plataforma donde se
   *    vende de todo.
   *  · `secondary` NO es otro color: es el MISMO tono con otra luz (30 % → 45 %) y menos
   *    saturación. Eso es lo que hace monocromo a un monocromo — dos colores de marca que
   *    son el mismo color a dos distancias.
   *  · `accent` es el BRONCE, y es el único riesgo real de esta paleta. Al 48 % de luz da
   *    2,71:1 con letra clara y **6,67:1 con letra oscura**, así que `mejorTextoSobre`
   *    elige la oscura y el acento puede ser dorado de verdad en vez de un mostaza
   *    apagado. Subirlo de luz lo volvería ilegible por arriba; bajarlo lo convertiría en
   *    marrón. El sitio es éste.
   *  · `neutral` es un GRIS VERDADERO — seis puntos de saturación, apenas un recuerdo de
   *    azul. Es la decisión que más define al modelo: sin color en la rampa, lo único que
   *    queda es el contraste, y ahí es donde se nota si algo está bien hecho.
   */
  coloresPorDefecto: {
    primary: '220 45% 30%',
    secondary: '220 30% 45%',
    accent: '42 58% 48%',
    neutral: '220 6% 92%',
  },

  /**
   * Los dos candidatos a letra. Ni blanco ni negro puros: sobre un monocromo de grises
   * finos, el negro puro hace un agujero y el blanco puro vibra. Un casi-blanco y un
   * casi-negro, los dos con el mismo recuerdo de azul que el neutro — la familia entera
   * comparte tono.
   */
  textoSobre: ['220 20% 98%', '220 40% 10%'],

  rampa: RAMPA_PREMIUM_CLARO,

  porVersion: {
    // «Claro» es la versión base: la rampa del modelo tal cual.
    claro: {},
    'claro-intenso': {
      rampa: RAMPA_PREMIUM_INTENSO,
      ejes: {
        // Si el contraste sube, el movimiento acompaña: 40 ms menos y una curva con más
        // salida. Sigue siendo lento comparado con los otros modelos — premium no corre.
        'motion-duration': '180ms',
        'motion-ease': 'cubic-bezier(0.2, 0.8, 0.2, 1)',
        // Y las sombras se recogen: con un trazo tan marcado, la sombra difusa sobra.
        shadow: '0 1px 3px 0 rgb(10 15 30 / 0.10), 0 1px 2px -1px rgb(10 15 30 / 0.08)',
        'shadow-md': '0 4px 8px -2px rgb(10 15 30 / 0.12), 0 2px 4px -3px rgb(10 15 30 / 0.09)',
        'shadow-lg': '0 10px 18px -4px rgb(10 15 30 / 0.14), 0 4px 7px -6px rgb(10 15 30 / 0.10)',
      },
    },
  },

  /**
   * SE HEREDAN LOS SEMÁNTICOS DEL MODELO 0, por la misma razón que en los otros dos
   * modelos: rojo de error, verde de éxito y ámbar de aviso son convenciones que el
   * usuario trae de fuera, y monocromarlas para que «peguen» sería exactamente el cambio
   * que hace que un error deje de leerse como un error.
   *
   * En este modelo la tentación es mayor que en ninguno —un monocromo pide que TODO sea
   * gris— y por eso conviene decirlo: el acento de bronce es el único color que este
   * modelo se permite por gusto. Los otros cinco son información.
   */
  semanticos: { ...MODELO_0.semanticos },

  ejes: {
    // El cuerpo sigue en Inter: la escala tipográfica es estructura (T3), no del modelo.
    'font-sans': 'var(--font-inter)',
    /**
     * ⚠ SIN COMILLAS — la cicatriz de Cálido/Editorial, que el filtro `VALOR_SEGURO` de
     * `lib/estilo-css.ts` descarta EN SILENCIO. `Palatino Linotype` y `Book Antiqua` a
     * pelo son identificadores válidos en CSS y además pasan el filtro.
     *
     * LA PILA, Y POR QUÉ NO ES LA DEL EDITORIAL: aquélla es Georgia, una serifa de
     * PANTALLA —robusta, ancha, hecha para leerse pequeña—. Ésta empieza por Optima y
     * Palatino, que son humanistas de libro: trazo modulado, más contraste entre grueso y
     * fino, y el aire que se asocia a lo caro. Georgia queda de respaldo porque está en
     * todas partes. Es la misma familia de decisión que el editorial y un escalón más
     * arriba de refinamiento.
     *
     * Pila del SISTEMA y no fichero propio, como en los otros dos: servir una fuente del
     * repo obliga a declararla en `layout.tsx`, y esta ráfaga es puro registro.
     */
    'font-heading': 'Optima, Palatino Linotype, Book Antiqua, Georgia, serif',

    // CASI RECTO. El más recto de los cuatro modelos (0.5 el Modelo 0, 0.375 el editorial,
    // 0.25 el fresco). Una esquina redondeada es amable; lo premium no quiere ser amable,
    // quiere ser exacto.
    radius: '0.125rem',

    // Sombras DIFUSAS Y LARGAS, lo contrario de las cortas del Fresco: poca opacidad y
    // mucho radio, que es como cae la luz en un sitio grande. Tinte azul muy oscuro para
    // que no ensucien el gris.
    'shadow-sm': '0 1px 2px 0 rgb(10 15 30 / 0.05)',
    shadow: '0 2px 6px -1px rgb(10 15 30 / 0.08), 0 1px 3px -2px rgb(10 15 30 / 0.06)',
    'shadow-md': '0 6px 14px -3px rgb(10 15 30 / 0.10), 0 3px 6px -4px rgb(10 15 30 / 0.07)',
    'shadow-lg': '0 14px 28px -6px rgb(10 15 30 / 0.12), 0 6px 10px -8px rgb(10 15 30 / 0.08)',
    'shadow-xl': '0 28px 48px -12px rgb(10 15 30 / 0.14), 0 10px 16px -10px rgb(10 15 30 / 0.09)',

    // EL MÁS LENTO DE LOS CUATRO: 220 ms contra los 150 del Modelo 0 y los 120 del Fresco.
    // Y la curva es casi simétrica, sin rebote: lo premium no tiene prisa ni hace gracias.
    'motion-duration': '220ms',
    'motion-ease': 'cubic-bezier(0.25, 0.1, 0.25, 1)',
    'motion-ease-emphasis': 'cubic-bezier(0.2, 0.6, 0.2, 1)',
    'motion-sprite-duration': '1.6s',

    // El trazo más fino de los cuatro. Acompaña a la serifa humanista y al radio recto.
    'icon-stroke': '1.25',
  },

  /**
   * LAS DIEZ, DECLARADAS — `ilustraciones.spec.ts` lo exige a TODO modelo, y el respaldo
   * del registro está para que un olvido no rompa nada, no para que un modelo delegue.
   *
   * Las del Modelo 0 son línea monocroma en gris medio, que en un modelo monocromo es
   * literalmente lo que corresponde: es el único de los cuatro donde las de fábrica no
   * son un apaño sino la elección correcta.
   */
  ilustraciones: { ...MODELO_0.ilustraciones },

  /**
   * LAS ZONAS, con las cinco decisiones de E5 dichas en monocromo. `public` no aparece:
   * el registro público es la base.
   */
  ajustesPorZona: {
    /**
     * BACKOFFICE — resta. En un modelo que ya es gris, restar no puede ser «quitar
     * color»: es APLANAR EL RELIEVE. El lienzo y la tarjeta se igualan en blanco, las
     * superficies se acercan y el tempo baja a 140 ms. Una herramienta no necesita
     * profundidad, necesita filas.
     *
     * `accent-foreground` va con `accent`, por la regla que destapó Fresco/Confianza: el
     * bronce de fábrica lleva letra OSCURA, así que aquí el emparejamiento sobreviviría
     * por casualidad — se declara igual, porque depender de la casualidad es cómo se
     * rompió aquello.
     */
    backoffice: {
      background: '0 0% 100%',
      card: '0 0% 100%',
      muted: '220 8% 96.5%',
      accent: '220 8% 96.5%',
      'accent-foreground': '220 40% 10%',
      border: '220 8% 89%',
      input: '220 8% 46%',
      'muted-foreground': '220 8% 32%',
      'motion-duration': '140ms',
    },

    /**
     * BLOG — tiñe, y en un monocromo teñir es BAJAR EL BLANCO sin meter color: un gris
     * clarísimo que descansa la vista en un texto largo y no traiciona la paleta. El
     * tempo sube: leer no es trabajar.
     */
    blog: {
      background: '220 10% 97.5%',
      card: '220 10% 97.5%',
      muted: '220 10% 94.5%',
      'motion-duration': '240ms',
    },

    /** CUENTA — a medio camino entre el escaparate y la herramienta, como en los otros. */
    cuenta: {
      background: '220 8% 99.5%',
      muted: '220 8% 96%',
      accent: '220 8% 96%',
      'accent-foreground': '220 40% 10%',
      'motion-duration': '180ms',
    },

    /**
     * LOGIN DEL BACKOFFICE — el oscuro, en monocromo. Y es, de paso, LA DEMOSTRACIÓN DE
     * LO QUE EL COMENTARIO DEL MODELO EXPLICA: aquí sí hay lienzo carbón, y funciona
     * porque una ZONA puede redefinir lo que una versión no — el anillo de foco pasa a un
     * azul claro (el marino de marca sería invisible sobre este fondo) y el trío
     * destructivo se sustituye por su forma oscura.
     *
     * Esos dos escapes son exactamente los que le faltan al eje de versión, y es lo que
     * dejó «Oscuro contenido» fuera de esta ráfaga.
     */
    login: {
      background: '220 24% 8%',
      foreground: '220 16% 95%',
      card: '220 20% 13%',
      'card-foreground': '220 16% 95%',
      popover: '220 20% 13%',
      'popover-foreground': '220 16% 95%',
      border: '220 14% 24%',
      input: '220 10% 52%',
      'muted-foreground': '220 12% 70%',
      ring: '42 62% 62%',
      primary: '220 16% 95%',
      'primary-foreground': '220 20% 13%',
      'destructive-subtle': '#3d0d0d',
      'destructive-border': '#7f1d1d',
      'destructive-strong': '#fca5a5',
    },
  },
};

/**
 * El catálogo PÚBLICO. Se añaden modelos AQUÍ, por código — «los iremos añadiendo».
 * `MODELO_PRUEBA` no está, y no es un olvido: ver su comentario.
 */
export const MODELOS: readonly Modelo[] = [
  MODELO_0,
  MODELO_CALIDO_EDITORIAL,
  MODELO_FRESCO_CONFIANZA,
  MODELO_PREMIUM,
];

/**
 * Los que EXISTEN pero no se ofrecen. Hoy sólo el de prueba. Se mantiene aparte de
 * `MODELOS` para que la separación «lo que se puede elegir» / «lo que se puede resolver»
 * sea un dato del código y no una convención que alguien recuerde.
 */
export const MODELOS_DE_PRUEBA: readonly Modelo[] = [MODELO_PRUEBA];

/** Todos los que `buscarModelo` puede resolver. El orden pone el catálogo primero. */
export const TODOS_LOS_MODELOS: readonly Modelo[] = [...MODELOS, ...MODELOS_DE_PRUEBA];

export const MODELO_POR_DEFECTO = MODELO_0;
export const VERSION_POR_DEFECTO = MODELO_0.versiones[0];

export function buscarModelo(id: string): Modelo | undefined {
  return TODOS_LOS_MODELOS.find((m) => m.id === id);
}

// ─────────────────────────────────────────────────────────────────────────────────────
// LA RESOLUCIÓN
// ─────────────────────────────────────────────────────────────────────────────────────

/** El mapa `nombre de variable → valor`, listo para escribirse en un `<style>`. */
export type Tokens = Record<string, string>;

function aplicarFranja(base: { h: number; s: number; l: number }, f: FranjaRampa): TripleteHsl {
  return formatearTriplete(base.h + f.dh, base.s + f.ds, f.l);
}

/**
 * De cuatro colores a la paleta entera. **Función pura**: mismo dato, mismo resultado,
 * sin base ni red de por medio, así que se puede probar valor a valor.
 *
 * `version` es OPCIONAL y no por comodidad: sin ella, esta función devuelve exactamente
 * lo que devolvía antes de que las versiones existieran. Es lo que garantiza que el
 * Modelo 0 —que no declara `porVersion`— resuelva byte a byte igual, y con él las 52
 * capturas de la batería visual.
 */
export function resolverTokens(
  modelo: Modelo,
  colores: ColoresConfigurables,
  version?: string,
): Tokens {
  const neutro = parsearTriplete(colores.neutral) ?? parsearTriplete('210 40% 96.1%')!;
  const tokens: Tokens = {};

  // 0 · Lo que la versión redefine. Se mezcla ANTES de derivar, no después: una versión
  // cambia la REGLA (la franja), no el color ya calculado — si parcheara el resultado,
  // dejaría de girar con el neutro que elija el admin, que es todo el sentido de la rampa.
  const deVersion = version ? modelo.porVersion?.[version] : undefined;
  const rampa = deVersion?.rampa ? { ...modelo.rampa, ...deVersion.rampa } : modelo.rampa;
  const ejes = deVersion?.ejes ? { ...modelo.ejes, ...deVersion.ejes } : modelo.ejes;

  // 1 · La rampa neutra: lienzo, superficies, trazo y texto base.
  for (const [nombre, franja] of Object.entries(rampa)) {
    tokens[nombre] = aplicarFranja(neutro, franja);
  }

  // 2 · Los tres colores de marca, cada uno con su letra elegida por contraste.
  for (const slot of ['primary', 'secondary', 'accent'] as const) {
    tokens[slot] = colores[slot];
    tokens[`${slot}-foreground`] = mejorTextoSobre(colores[slot], modelo.textoSobre);
  }

  // 3 · El anillo de foco sigue al color principal, como hasta ahora.
  tokens.ring = colores.primary;

  // 4 · Semánticos y ejes: fijos del modelo (los ejes, afinables por la versión).
  Object.assign(tokens, modelo.semanticos, ejes);

  return tokens;
}

/**
 * Los ajustes de una zona, ya resueltos. Devuelve SÓLO lo que difiere de la base: un
 * bloque por zona con dos declaraciones pesa dos declaraciones, no cuarenta.
 */
export function resolverZona(
  modelo: Modelo,
  colores: ColoresConfigurables,
  zona: EstiloZone,
  version?: string,
): Tokens {
  const ajustes = modelo.ajustesPorZona[zona];
  if (!ajustes) return {};
  // La base tiene que resolverse CON LA MISMA VERSIÓN, o el filtro de «ajuste que no
  // ajusta» compararía contra otro tema y emitiría —o se callaría— lo que no toca.
  const base = resolverTokens(modelo, colores, version);
  const salida: Tokens = {};
  for (const [nombre, valor] of Object.entries(ajustes)) {
    // Un ajuste que coincide con la base no se emite: sería una regla que no hace nada.
    if (base[nombre] !== valor) salida[nombre] = valor;
  }
  return salida;
}

/**
 * LA REGLA DURA, COMPROBABLE: los nombres que una zona ajusta tienen que existir ya en
 * la base. Devuelve los que no — vacío significa que la zona ajusta y no inventa.
 *
 * Se expone como función y no como comentario porque un comentario no impide nada. El
 * día que alguien añada `--backoffice-algo` a una zona, esto lo dice en CI en vez de
 * dejar crecer un segundo sistema de estilo a espaldas del modelo.
 */
export function zonaSoloAjusta(modelo: Modelo, colores: ColoresConfigurables): string[] {
  const base = resolverTokens(modelo, colores);
  const inventados: string[] = [];
  for (const [zona, ajustes] of Object.entries(modelo.ajustesPorZona)) {
    for (const nombre of Object.keys(ajustes ?? {})) {
      if (!(nombre in base)) inventados.push(`${zona}:${nombre}`);
    }
  }
  return inventados;
}

// ─────────────────────────────────────────────────────────────────────────────────────
// LA VALIDACIÓN AA
// ─────────────────────────────────────────────────────────────────────────────────────

export interface FalloContraste {
  pareja: string;
  ratio: number;
  minimo: number;
}

/**
 * Las parejas que TIENEN que cumplir AA, con su umbral.
 *
 * TEXTO (4.5:1) — todo lo que se lee. INTERFAZ (3:1) — lo que se ve pero no se lee: el
 * trazo de una caja, el anillo de foco.
 *
 * NO SE COMPRUEBAN LOS SEMÁNTICOS, y es deliberado: son fijos del modelo, así que no
 * dependen de lo que el admin elija y validarlos en cada guardado sería medir siempre
 * lo mismo. Su contraste se comprueba una vez por modelo, en CI
 * (`contraste-modelos.spec.ts`), que es donde un modelo nuevo tiene que demostrar que
 * es accesible ANTES de llegar a una instancia.
 */
function parejasBloqueantes(t: Tokens): readonly [string, string, string, number][] {
  return [
    ['texto base sobre el fondo', t.background, t.foreground, AA_TEXTO],
    ['texto atenuado sobre el fondo', t.background, t['muted-foreground'], AA_TEXTO],
    ['texto de la tarjeta', t.card, t['card-foreground'], AA_TEXTO],
    ['texto de la capa flotante', t.popover, t['popover-foreground'], AA_TEXTO],
    ['letra sobre el color principal', t.primary, t['primary-foreground'], AA_TEXTO],
    ['letra sobre el secundario', t.secondary, t['secondary-foreground'], AA_TEXTO],
    ['letra sobre el de resalte', t.accent, t['accent-foreground'], AA_TEXTO],
    ['anillo de foco sobre el fondo', t.background, t.ring, AA_INTERFAZ],
    /**
     * EL BORDE DE UN CAMPO, AHORA BLOQUEANTE. Nació como aviso porque el valor de
     * fábrica no cumplía (1,23:1) y arreglarlo cambiaba píxeles, cosa que E4a tenía
     * prohibida. Con el trazo del campo ya a 3:1, la pareja pasa a exigirse: un modelo
     * futuro no podrá volver a dejar los formularios sin contorno visible.
     */
    ['borde de campo sobre el fondo', t.background, t.input, AA_INTERFAZ],
  ];
}

/**
 * ⚠ EL TRAZO DECORATIVO SE MIDE PERO NO BLOQUEA, Y EL MATIZ ES NORMATIVO.
 *
 * Este aviso nació en E4a midiendo `--border` Y `--input` a la vez, porque valían lo
 * mismo. La ráfaga del trazo los ha separado: el borde de campo ya cumple 3:1 y pasó a
 * la lista bloqueante. Aquí queda sólo el decorativo, y queda a propósito.
 *
 * WCAG 1.4.11 exige 3:1 a «la información visual necesaria para IDENTIFICAR un
 * componente y su estado». Un contorno de tarjeta no identifica nada: la tarjeta se
 * identifica por su contenido, y el separador de una tabla por las filas que separa.
 * Ahí la norma no pide nada, y subirlo a 3:1 convertiría cada línea de la interfaz en
 * un trazo marcado — un rediseño completo del peso visual de la plataforma, hecho en
 * nombre de una exigencia que no existe.
 *
 * Así que se mide y se informa —el número sigue a la vista para quien diseñe un modelo
 * con personalidad— pero no se impone. Decidir que los contornos decorativos sean más
 * presentes es una decisión de aspecto legítima; lo que no es legítimo es disfrazarla
 * de obligación normativa.
 *
 * Se separa en dos funciones y no en un `nivel: 'error' | 'aviso'` porque quien llama
 * hace cosas distintas con cada una: una produce un 422 y la otra, información.
 */
function parejasDeAviso(t: Tokens): readonly [string, string, string, number][] {
  return [
    ['trazo decorativo sobre el fondo (no exigido por 1.4.11)', t.background, t.border, AA_INTERFAZ],
  ];
}

/**
 * Las parejas que NO llegan Y BLOQUEAN. Vacío = se puede guardar.
 *
 * Quien llama convierte esto en un 422 con la lista dentro: decirle al admin «no
 * cumple» sin decirle QUÉ pareja falla y por cuánto es obligarle a adivinar entre
 * cuatro colores.
 */
export function validarContraste(tokens: Tokens): FalloContraste[] {
  return medir(tokens, parejasBloqueantes(tokens));
}

/** Lo que se mide pero no impide guardar. Ver el comentario de arriba. */
export function avisosContraste(tokens: Tokens): FalloContraste[] {
  return medir(tokens, parejasDeAviso(tokens));
}

function medir(
  _tokens: Tokens,
  parejas: readonly [string, string, string, number][],
): FalloContraste[] {
  const fallos: FalloContraste[] = [];
  for (const [pareja, fondo, frente, minimo] of parejas) {
    const ok = minimo === AA_TEXTO ? cumpleTexto(fondo, frente) : cumpleInterfaz(fondo, frente);
    if (!ok) {
      fallos.push({ pareja, ratio: Math.round(contraste(fondo, frente) * 100) / 100, minimo });
    }
  }
  return fallos;
}
