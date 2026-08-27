import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { auth } from '@/lib/auth';
import { AuthProvider } from '@/components/auth-provider';
import { Toaster } from '@/components/ui/sonner';
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
  return (
    <html lang="es">
      <body className={inter.className}>
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
