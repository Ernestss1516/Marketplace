'use client';

import { createContext, useContext } from 'react';
import type { CardAttributeDef } from '@/types';

export type CardAttributeMap = Record<string, CardAttributeDef[]>;

const CardAttributesContext = createContext<CardAttributeMap>({});

export function useCardAttributes(categorySlug: string | undefined): CardAttributeDef[] {
  const map = useContext(CardAttributesContext);
  return (categorySlug ? map[categorySlug] : undefined) ?? [];
}

interface Props {
  cardAttributeMap: CardAttributeMap;
  children: React.ReactNode;
}

export function CardAttributesProvider({ cardAttributeMap, children }: Props) {
  return (
    <CardAttributesContext.Provider value={cardAttributeMap}>
      {children}
    </CardAttributesContext.Provider>
  );
}
