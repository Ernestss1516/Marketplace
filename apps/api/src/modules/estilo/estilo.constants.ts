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

/** Las tres zonas. ESPEJO EXACTO de `LOGO_ZONES` — la marca y el estilo se configuran
 *  por las mismas zonas, y tener dos listas sería tener dos que divergen. */
export const ESTILO_ZONES = ['public', 'backoffice', 'blog'] as const;
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
    // Error. Su color de letra NO se elige por contraste y es deliberado: sobre este
    // rojo gana el texto oscuro (4.69 contra 3.14), pero hoy el botón destructivo
    // lleva letra clara. Cambiarlo sería una decisión de aspecto, y E4a no toma
    // ninguna — así que se declara fijo, como el resto de semánticos.
    destructive: '0 84.2% 60.2%',
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
};

/** El catálogo. Se añaden modelos AQUÍ, por código — «los iremos añadiendo». */
export const MODELOS: readonly Modelo[] = [MODELO_0];

export const MODELO_POR_DEFECTO = MODELO_0;
export const VERSION_POR_DEFECTO = MODELO_0.versiones[0];

export function buscarModelo(id: string): Modelo | undefined {
  return MODELOS.find((m) => m.id === id);
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
