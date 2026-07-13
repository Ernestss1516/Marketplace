'use client';

import { useState } from 'react';

// RÁFAGA 2 — vista ampliada: corte a 280 caracteres con "Leer más" expandible.
// Una descripción más corta que el corte se muestra entera, sin botón (no hay
// nada que expandir). Client island aparte para no forzar toda ListingCardWide
// a ser cliente solo por este estado — mismo patrón que CardAttrsDisplay.
const MAX_CHARS = 280;

export function TruncatedDescription({ text }: { text: string | undefined }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;

  const isLong = text.length > MAX_CHARS;
  const shown = expanded || !isLong ? text : `${text.slice(0, MAX_CHARS).trimEnd()}…`;

  return (
    <p className="mt-2 text-sm text-muted-foreground">
      {shown}
      {isLong && (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setExpanded((v) => !v); }}
          className="ml-1 font-medium text-primary hover:underline"
          data-testid="description-toggle"
        >
          {expanded ? 'Leer menos' : 'Leer más'}
        </button>
      )}
    </p>
  );
}
