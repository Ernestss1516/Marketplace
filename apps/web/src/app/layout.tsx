import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { auth } from '@/lib/auth';
import { AuthProvider } from '@/components/auth-provider';
import { Toaster } from '@/components/ui/sonner';
import { bloqueDeEstilo, getCachedEstilo } from '@/lib/api/estilo';
import './globals.css';

/**
 * INTER, SERVIDA DESDE EL REPO — y no descargada de Google en cada build.
 *
 * Esto era `Inter({ subsets: ['latin'] })` de `next/font/google`, que **descarga el
 * fichero de la fuente en tiempo de BUILD**. Cuando el runner de CI no alcanza
 * `fonts.gstatic.com`, el loader reintenta tres veces y aborta con `ETIMEDOUT`: el
 * build entero se pone rojo, y con él Playwright, que necesita el `next start`. No
 * es un test frágil ni código propio fallando — es una dependencia de red metida en
 * el camino crítico del CI. Mordió en el ciclo de C2.
 *
 * `next/font/local` lee el fichero del disco, así que el build no tiene a quién
 * llamar. Ver `docs/auditoria-deuda-test-ci.md` §3 y `fonts/README.md` (de dónde
 * salió el `.woff2` y cómo reproducirlo).
 *
 * LO VISIBLE NO CAMBIA, y los tres parámetros son los que lo garantizan:
 *
 *  · el fichero es el subset LATIN variable de Inter — el mismo que servía Google
 *    con esta configuración, mismo `unicode-range`;
 *  · `weight: '100 900'` reproduce el eje `wght` completo del variable font. Sin
 *    esto el `@font-face` declararía un peso fijo y los `font-bold` de Tailwind
 *    caerían a la síntesis del navegador;
 *  · `display: 'swap'` es el valor por defecto de los DOS cargadores (verificado en
 *    `next/font` 15.5), pero se escribe porque es lo que decide qué ve el usuario
 *    mientras la fuente carga, y eso no debe depender de un default.
 *
 * `adjustFontFallback` se deja sin tocar a propósito: sin fila, `next/font/local`
 * calcula las métricas del fallback LEYENDO ESTE FICHERO, en vez de la tabla que
 * `next/font/google` traía para Inter. Mismo mecanismo anti-CLS, y con métricas de
 * la fuente que de verdad se está sirviendo.
 */
const inter = localFont({
  src: './fonts/inter-latin-wght-normal.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  /**
   * E3 — INTER DEJA DE APLICARSE A MANO Y PASA A SER UN TOKEN.
   *
   * `variable` hace que `next/font` emita una clase que declara
   * `--font-inter: '__inter_xxxx', '__inter_Fallback_xxxx'` en vez de una clase que
   * fija `font-family` directamente. El fichero, los pesos, el `display: 'swap'` y
   * las métricas del respaldo no cambian: cambia CÓMO llega el nombre de la familia
   * al CSS.
   *
   * De ahí sale, en `globals.css`, `--font-sans: var(--font-inter)`, y de ahí
   * `fontFamily.sans` en la configuración de Tailwind. Lo aplica el PREFLIGHT de
   * Tailwind, que ya pone `font-family: theme('fontFamily.sans')` en el `<html>` —
   * por eso el `<body>` deja de llevar clase de fuente y NO gana ninguna otra: no
   * hace falta.
   *
   * POR QUÉ DOS VARIABLES Y NO UNA. `--font-inter` la declara `next/font` dentro de
   * una CLASE, y una clase gana a `:root` en especificidad: un modelo que quisiera
   * otra tipografía no podría sobreescribirla desde su bloque de `:root`.
   * `--font-sans` sí vive en `:root`, así que un modelo la redefine y manda. La
   * indirección es justo lo que hace el eje tipográfico themeable.
   */
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: {
    default: 'Marketplace — Compra y vende de segunda mano',
    template: '%s | Marketplace',
  },
  description: 'Plataforma de compraventa de segunda mano entre particulares.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  /**
   * E4a — EL TEMA, EN EL HTML DE LA PRIMERA RESPUESTA.
   *
   * Se resuelve AQUÍ, en el layout de servidor, y no en el navegador. Es un requisito
   * duro de la frontera, no una preferencia: si el tema llegara por JavaScript de
   * cliente habría un instante con los colores por defecto y después un repintado —
   * un salto visible, y probablemente CLS, que §6 prohíbe.
   *
   * El molde está probado en este repo: `(admin)/layout.tsx` ya resuelve los logos
   * así, «sin petición desde el navegador, sin estado cargando y sin un instante en
   * que la cabecera esté vacía».
   *
   * ── EL RESPALDO NO ES UNA COPIA DE VALORES, ES `globals.css` ────────────────────
   *
   * `.catch(() => null)` y, si no hay tema, NO SE EMITE NADA. No hace falta un mapa
   * de reserva en el frontend: `globals.css` sigue declarando el Modelo 0 completo
   * (E0-E3 lo dejaron ahí). Un backend caído deja la plataforma exactamente como
   * estaba antes de que existiera el sistema — degrada, nunca rompe, y sin duplicar
   * la paleta en dos sitios que podrían divergir.
   *
   * ── DOS NOTAS DE DESPLIEGUE ────────────────────────────────────────────────────
   *
   *  · **HOY NO HAY CSP** (verificado: ni en `next.config.ts` ni en `middleware.ts`).
   *    Si algún día se añade una, este `<style>` necesitará un `nonce` en
   *    `style-src`, o el tema desaparecerá en silencio y toda la plataforma se verá
   *    con el Modelo 0 sin que nada dé error. Queda dicho para que no sorprenda.
   *  · **LAS `NEXT_PUBLIC_*` NO SIRVEN PARA ESTO.** Se incrustan al CONSTRUIR, y el
   *    norte es multi-instancia: el tema tiene que venir de la base de datos de cada
   *    instancia, no del bundle. Es la misma lección que `image-domains.ts` dejó
   *    escrita.
   */
  const estilo = await getCachedEstilo().catch(() => null);
  const css = estilo ? bloqueDeEstilo(estilo.tokens, estilo.zonas) : "";
  // La clase de `next/font` va en el <html> y no en el <body>: `:root` ES el <html>,
  // así que es donde `--font-inter` tiene que estar declarada para que `--font-sans`
  // (que vive en `:root`, en globals.css) pueda referenciarla. El <body> ya no lleva
  // clase de fuente: la aplica el preflight de Tailwind desde `fontFamily.sans`.
  return (
    <html lang="es" className={inter.variable}>
      <head>
        {/* El selector es `html:root`, que gana a `:root` por especificidad y no por
            orden — ver `bloqueDeEstilo`. Con `css` vacío no se emite la etiqueta. */}
        {css ? <style data-estilo="modelo">{css}</style> : null}
      </head>
      <body>
        <AuthProvider session={session}>{children}</AuthProvider>
        {/* UXV.3 (M6) — UNA sola vez y en la raíz: así cualquier pantalla de cualquier
            zona puede avisar de algo con `toast(...)` sin montar nada propio. Va FUERA
            de AuthProvider a propósito: no depende de la sesión, y un toast tiene que
            poder salir también en las pantallas anónimas. */}
        <Toaster />
      </body>
    </html>
  );
}
