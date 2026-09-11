'use client';

import { useState } from 'react';
import { useConsent } from './ConsentProvider';
import { AvisoTerceroCargado, MarcadorTercero } from './MarcadorTercero';

/**
 * COOKIES RÁFAGA 1 — EL GATE. La pieza que cumple.
 *
 * Ver docs/diseno-consentimiento-cookies.md §1.
 *
 * ─── LA REGLA, SIN MATICES ──────────────────────────────────────────────────────
 *
 * Sin consentimiento, el recurso de terceros **no se pide**. No se carga oculto, no se
 * monta con `display:none`, no se pide y se descarta. NO SE PIDE.
 *
 * Eso funciona porque en React un elemento pasado como `children` es sólo un descriptor:
 * mientras este componente no lo renderice, **no se monta nada** — ni el `<iframe>` de
 * Vimeo, ni el `dynamic()` de MapLibre, que ni siquiera llega a descargar su bundle. Por
 * eso el gate envuelve, en vez de recibir una bandera y dejar que el hijo decida: un
 * hijo que decide ya se ha montado.
 *
 * ─── POR QUÉ ENVUELVE COMPONENTES Y NO PÁGINAS ──────────────────────────────────
 *
 * Porque las páginas se cachean (ISR). Ver el comentario largo de `ConsentProvider`.
 *
 * ─── LAS TRES VÍAS POR LAS QUE ALGO CARGA ───────────────────────────────────────
 *
 *  1. **Consentimiento guardado** (la cookie) — carga, sin aviso: ya se informó al
 *     consentir.
 *  2. **`solicitadoPorUsuario`** (D3, sólo el mapa) — carga CON aviso permanente.
 *  3. **«Cargar solo esta vez»** — carga, sin escribir nada, hasta que se recargue.
 *
 * Y una cuarta que no existe: cargar porque sí.
 */
export function GateTerceros({
  proveedor,
  descripcion,
  className,
  solicitadoPorUsuario = false,
  testId,
  children,
}: {
  proveedor: string;
  descripcion: string;
  /** Las clases del contenido real, para que el marcador mida lo mismo (sin CLS). */
  className?: string;
  /**
   * D3 — el usuario pidió EXPLÍCITAMENTE este contenido (hoy: `?view=mapa` en la URL).
   * Carga sin consentimiento previo, pero informando: la exención es informada, no
   * silenciosa. Ver `view-mode.ts:usuarioPidioVista`.
   */
  solicitadoPorUsuario?: boolean;
  testId?: string;
  children: React.ReactNode;
}) {
  const { permite, conceder } = useConsent();
  const [soloEstaVez, setSoloEstaVez] = useState(false);

  const consentido = permite('terceros');

  if (consentido) return <>{children}</>;

  // D3, y la vía de «solo esta vez»: hay contenido, y hay que decir de dónde viene.
  if (solicitadoPorUsuario || soloEstaVez) {
    return (
      <>
        {children}
        <AvisoTerceroCargado proveedor={proveedor} testId={testId ? `${testId}-aviso` : undefined} />
      </>
    );
  }

  return (
    <MarcadorTercero
      proveedor={proveedor}
      descripcion={descripcion}
      className={className}
      testId={testId}
      onCargarUnaVez={() => setSoloEstaVez(true)}
      onPermitirSiempre={() => conceder('terceros')}
    />
  );
}
