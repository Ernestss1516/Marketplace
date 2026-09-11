'use client';

import { CONSENT_REOPEN_EVENT } from './consentimiento';

/**
 * COOKIES RÁFAGA 2 — «Preferencias de cookies», en el footer.
 *
 * Ver docs/diseno-consentimiento-cookies.md §2.5.
 *
 * ─── POR QUÉ ESTO ES CÓDIGO Y NO UN `FooterItem` CONFIGURABLE ───────────────────
 *
 * El diseño lo proponía como un ítem de footer gestionable desde el backoffice, como el
 * resto de enlaces. No encaja por dos razones:
 *
 *  · **no es un enlace**: no navega a ninguna parte, reabre el panel en la misma página,
 *    y un `FooterItem` sólo sabe apuntar a una URL;
 *  · **no debe poder quitarse**. Que retirar el consentimiento sea tan fácil como darlo
 *    es una obligación del RGPD, no una preferencia de navegación. Como `FooterItem`,
 *    bastaría con que alguien lo borrase por descuido para dejar la plataforma sin vía de
 *    revocación — y nadie se daría cuenta.
 *
 * Es la misma frontera de siempre: el admin edita el TEXTO del banner; la mecánica del
 * consentimiento es fija.
 *
 * Un `<button>` de verdad y no un `<a>` con `onClick`: lo que hace es abrir un panel, no
 * navegar, y así es alcanzable por teclado y lo anuncia bien un lector de pantalla.
 */
export function PreferenciasCookiesLink() {
  return (
    <button
      type="button"
      data-testid="footer-preferencias-cookies"
      className="hover:text-foreground"
      onClick={() => window.dispatchEvent(new Event(CONSENT_REOPEN_EVENT))}
    >
      Preferencias de cookies
    </button>
  );
}
