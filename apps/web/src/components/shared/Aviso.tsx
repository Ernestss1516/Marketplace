import { cn } from '@/lib/utils';

/**
 * E0 — EL AVISO, Y EL PRIMER TOKEN SEMÁNTICO DEL PROYECTO.
 *
 * ── QUÉ CONSOLIDA ─────────────────────────────────────────────────────────────────────
 *
 * La misma cadena de clases estaba escrita **29 veces, byte a byte**, en 29 pantallas del
 * backoffice:
 *
 *     rounded border border-yellow-300 bg-yellow-50 p-4 text-yellow-800
 *
 * No eran 29 decisiones de diseño: era una copia. Y con ella iba copiado el color, que es
 * lo que convierte «cambiar el amarillo de aviso» en 29 ediciones y 29 ocasiones de
 * olvidar una.
 *
 * ── POR QUÉ TOKENS Y NO LAS CLASES DE SIEMPRE ─────────────────────────────────────────
 *
 * Porque es el punto entero de E0: dejar el sistema listo para que un MODELO decida los
 * colores sin tocar un solo `.tsx` (la regla de oro de la frontera). Un `bg-yellow-50`
 * escrito en un componente es una decisión de aspecto viviendo en la capa que no puede
 * tenerlas. `bg-warning` es la misma decisión, movida a donde el modelo puede cambiarla.
 *
 * ── POR QUÉ EL VALOR NO CAMBIA NI UN BIT ──────────────────────────────────────────────
 *
 * `--warning`, `--warning-border` y `--warning-foreground` valen **exactamente**
 * `yellow-50`, `yellow-300` y `yellow-800` de Tailwind, escritos como el mismo hexadecimal
 * literal. No hay conversión de por medio, así que no hay redondeo que pueda mover un
 * canal: el píxel es el mismo. `Aviso.test.tsx` lo comprueba contra la paleta de Tailwind
 * en vez de contra una constante escrita a mano, así que también avisaría si una subida
 * de Tailwind cambiara el amarillo bajo nuestros pies.
 *
 * ── LO QUE NO HACE, Y ES DELIBERADO ───────────────────────────────────────────────────
 *
 * **No lleva `role="alert"`.** Las 29 copias son un `<div>` pelado, y añadir el rol
 * cambiaría el árbol de accesibilidad: lo que hoy no se anuncia pasaría a anunciarse, y
 * 26 capturas y 518 casos funcionales dependen de que esta ráfaga no cambie nada. Es una
 * mejora razonable, pero es una MEJORA, y E0 no mejora: E0 mueve. Queda anotada para E2.
 *
 * **No tiene variantes.** Los tonos de éxito, información y error existen en el repo con
 * otras formas y otros call sites; inventarles aquí una API que nadie usa sería código
 * muerto. Se añaden cuando lleguen sus consumidores, en E2.
 */
export function Aviso({
  children,
  className,
}: {
  children: React.ReactNode;
  /**
   * Sólo para GEOMETRÍA (márgenes, ancho). `tailwind-merge` deja que un call site ajuste
   * el hueco que ocupa el aviso sin poder cambiar su color por accidente: si alguien pasa
   * un `bg-*`, el merge lo dejaría ganar — y por eso el test fija la forma por defecto.
   */
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded border border-warning-border bg-warning p-4 text-warning-foreground',
        className,
      )}
    >
      {children}
    </div>
  );
}
