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

/**
 * El catálogo PÚBLICO. Se añaden modelos AQUÍ, por código — «los iremos añadiendo».
 * `MODELO_PRUEBA` no está, y no es un olvido: ver su comentario.
 */
export const MODELOS: readonly Modelo[] = [MODELO_0];

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
 */
export function resolverTokens(modelo: Modelo, colores: ColoresConfigurables): Tokens {
  const neutro = parsearTriplete(colores.neutral) ?? parsearTriplete('210 40% 96.1%')!;
  const tokens: Tokens = {};

  // 1 · La rampa neutra: lienzo, superficies, trazo y texto base.
  for (const [nombre, franja] of Object.entries(modelo.rampa)) {
    tokens[nombre] = aplicarFranja(neutro, franja);
  }

  // 2 · Los tres colores de marca, cada uno con su letra elegida por contraste.
  for (const slot of ['primary', 'secondary', 'accent'] as const) {
    tokens[slot] = colores[slot];
    tokens[`${slot}-foreground`] = mejorTextoSobre(colores[slot], modelo.textoSobre);
  }

  // 3 · El anillo de foco sigue al color principal, como hasta ahora.
  tokens.ring = colores.primary;

  // 4 · Semánticos y ejes: fijos del modelo.
  Object.assign(tokens, modelo.semanticos, modelo.ejes);

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
): Tokens {
  const ajustes = modelo.ajustesPorZona[zona];
  if (!ajustes) return {};
  const base = resolverTokens(modelo, colores);
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
