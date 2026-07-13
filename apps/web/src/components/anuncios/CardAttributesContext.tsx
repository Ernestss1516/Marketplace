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
// attribute line inside ListingCard.
// Format: unit present → "valor unit" (e.g. "45000 km"); no unit → "Label: valor".
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
      hasUnit: !!def.unit,
    }))
    .filter((e) => e.value !== '');

  if (entries.length === 0) return null;

  return (
    <p className="mt-1 truncate text-xs text-muted-foreground">
      {entries.map((e) => (e.hasUnit ? e.value : `${e.label}: ${e.value}`)).join(' · ')}
    </p>
  );
}

// ── Wide card attributes (RÁFAGA 2 — vista ampliada) ────────────────────────
//
// Independent context/provider from the one above: the compact card stays
// limited to its curated 2-attribute map regardless of how many attributes
// the wide card shows (up to 6, its own curated set — see wideCardAttribute
// in AttributeField). Same shape, same lookup pattern, deliberately duplicated
// rather than parameterized — two maps living side by side is simpler to
// reason about than one context branching on a "mode" prop.

const WideCardAttributesContext = createContext<CardAttributeMap>({});

export function useWideCardAttributes(categorySlug: string | undefined): CardAttributeDef[] {
  const map = useContext(WideCardAttributesContext);
  return (categorySlug ? map[categorySlug] : undefined) ?? [];
}

export function WideCardAttributesProvider({ cardAttributeMap, children }: ProviderProps) {
  return (
    <WideCardAttributesContext.Provider value={cardAttributeMap}>
      {children}
    </WideCardAttributesContext.Provider>
  );
}

/** Like CardAttrsDisplay but reads the wide-card map and renders each attribute as its
 * own labeled row (the wide card has room for that) instead of one truncated dot-joined line. */
export function WideCardAttrsDisplay({ categorySlug, attributes }: CardAttrsProps) {
  const defs = useWideCardAttributes(categorySlug);

  const entries = defs
    .map((def) => ({
      label: def.label,
      value: formatAttrValue(attributes?.[def.key], def.unit),
      hasUnit: !!def.unit,
    }))
    .filter((e) => e.value !== '');

  if (entries.length === 0) return null;

  return (
    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-3">
      {entries.map((e, i) => (
        <div key={i} className="flex gap-1 truncate">
          {!e.hasUnit && <dt className="shrink-0 font-medium text-foreground/70">{e.label}:</dt>}
          <dd className="truncate">{e.value}</dd>
        </div>
      ))}
    </dl>
  );
}
