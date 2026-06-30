'use client';

import { createContext, useContext } from 'react';
import type { CardAttributeDef } from '@/types';

export type CardAttributeMap = Record<string, CardAttributeDef[]>;

const CardAttributesContext = createContext<CardAttributeMap>({});

export function useCardAttributes(categorySlug: string | undefined): CardAttributeDef[] {
  const map = useContext(CardAttributesContext);
  return (categorySlug ? map[categorySlug] : undefined) ?? [];
}

// ── Provider ─────────────────────────────────────────────────────────────────

interface ProviderProps {
  cardAttributeMap: CardAttributeMap;
  children: React.ReactNode;
}

export function CardAttributesProvider({ cardAttributeMap, children }: ProviderProps) {
  return (
    <CardAttributesContext.Provider value={cardAttributeMap}>
      {children}
    </CardAttributesContext.Provider>
  );
}

// ── CardAttrsDisplay ─────────────────────────────────────────────────────────
//
// Tiny client island that reads cardAttributes from context and renders the
// "Marca: Toyota · Año: 2022" line inside ListingCard.
//
// Keeping this as a separate client sub-component lets ListingCard itself stay
// as a Server Component (RSC): its Link/Image/Card structure ships zero client
// JS, while only this small piece is hydrated for context access.

function formatAttrValue(value: unknown, unit?: string): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  const str = String(value);
  if (str === '') return '';
  return unit ? `${str} ${unit}` : str;
}

interface CardAttrsProps {
  categorySlug: string | undefined;
  attributes: Record<string, unknown> | undefined;
}

export function CardAttrsDisplay({ categorySlug, attributes }: CardAttrsProps) {
  const defs = useCardAttributes(categorySlug);

  const entries = defs
    .map((def) => ({
      label: def.label,
      value: formatAttrValue(attributes?.[def.key], def.unit),
    }))
    .filter((e) => e.value !== '');

  if (entries.length === 0) return null;

  return (
    <p className="mt-1 truncate text-xs text-muted-foreground">
      {entries.map((e) => `${e.label}: ${e.value}`).join(' · ')}
    </p>
  );
}
