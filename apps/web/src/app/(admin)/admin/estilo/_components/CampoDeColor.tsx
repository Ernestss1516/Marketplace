'use client';

import { AlertCircle } from 'lucide-react';
import type { ApiErrorContrastFailure } from '@/lib/api/client';
import {
  comoColorCss,
  textoDeFallo,
  tripleteAHexParaSelector,
  type RanuraDeColor,
} from '@/lib/api/estilo-admin';

/**
 * E9 — UNO DE LOS CUATRO COLORES, con su fallo de contraste AL LADO.
 *
 * ── LO QUE ESTE COMPONENTE EXISTE PARA HACER BIEN ────────────────────────────────────
 *
 * Enseñar el 422 de AA **en el campo que hay que mover, con el número medido**. Un toast
 * que diga «no cumple el contraste mínimo» es información que el admin no puede usar:
 * tiene cuatro colores delante y el aviso no señala ninguno, así que le toca probar
 * combinaciones a ciegas. El backend ya se molestó en medir la pareja y mandar el ratio
 * (`EstiloService.setConfig`: «decirle al admin *no cumple* y callar qué pareja falla y
 * por cuánto es obligarle a probar a ciegas»); tirar ese dato en la pantalla sería
 * desperdiciar la mitad del trabajo que el servidor ya hizo.
 *
 * Así que el mensaje va aquí abajo, en rojo, con «3,1:1 — necesita 4,5:1» dentro. Es un
 * error de validación de campo, y el reparto de UXV.3 los quiere inline: el toast es para
 * el error suelto que no tiene dónde vivir, y éste tiene dónde.
 *
 * ── DOS MANDOS PARA EL MISMO VALOR, Y NO ES REDUNDANCIA ──────────────────────────────
 *
 * El selector nativo es para elegir mirando; la caja de texto es para pegar un valor
 * exacto —el hexadecimal de una guía de marca, o el triplete que ya estaba guardado— sin
 * pasar por la rueda de color, que redondea. El DTO acepta las dos formas a propósito
 * (`FORMA_COLOR`), así que los dos mandos escriben lo mismo y el servidor normaliza al
 * guardar.
 *
 * El selector no puede mostrar un triplete (sólo entiende `#rrggbb`), así que cuando el
 * valor no se puede convertir se queda con el negro por defecto del control y manda la
 * caja de texto — que es la que lleva el valor de verdad.
 */
export function CampoDeColor({
  ranura,
  etiqueta,
  descripcion,
  valor,
  fallos,
  disabled,
  onChange,
}: {
  ranura: RanuraDeColor;
  etiqueta: string;
  descripcion: string;
  valor: string;
  fallos: ApiErrorContrastFailure[];
  disabled: boolean;
  onChange: (nuevo: string) => void;
}) {
  const hex = tripleteAHexParaSelector(valor);
  const idTexto = `color-${ranura}`;
  const tieneFallo = fallos.length > 0;

  return (
    <div className="space-y-2" data-testid={`campo-color-${ranura}`}>
      <div>
        <label htmlFor={idTexto} className="text-sm font-medium leading-none">
          {etiqueta}
        </label>
        <p className="mt-1 text-xs text-muted-foreground">{descripcion}</p>
      </div>

      <div className="flex items-center gap-2">
        {/* La MUESTRA no pasa por ninguna conversión: CSS entiende el triplete tal cual.
            Es el color de verdad, no una aproximación del selector. */}
        <span
          aria-hidden
          className="h-9 w-9 shrink-0 rounded-md border"
          style={{ backgroundColor: comoColorCss(valor) }}
          data-testid={`muestra-${ranura}`}
        />

        <input
          type="color"
          value={hex ?? '#000000'}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 shrink-0 cursor-pointer rounded-md border bg-background disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={`Elegir ${etiqueta.toLowerCase()} con el selector de color`}
          data-testid={`selector-${ranura}`}
        />

        <input
          id={idTexto}
          type="text"
          value={valor}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          className={`h-9 w-full rounded-md border bg-background px-2 font-mono text-sm disabled:cursor-not-allowed disabled:opacity-50 ${
            tieneFallo ? 'border-destructive' : ''
          }`}
          aria-invalid={tieneFallo || undefined}
          aria-describedby={tieneFallo ? `${idTexto}-error` : undefined}
          data-testid={`valor-${ranura}`}
        />
      </div>

      {tieneFallo && (
        <div
          id={`${idTexto}-error`}
          role="alert"
          className="space-y-1"
          data-testid={`error-contraste-${ranura}`}
        >
          {fallos.map((fallo) => (
            <p
              key={fallo.pareja}
              className="flex items-start gap-1.5 text-xs text-destructive"
            >
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{textoDeFallo(fallo)}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
