'use client';

import { useEffect, useState } from 'react';
import { getCatalog, getProStatus, getWallet } from '@/lib/api/billing';
import type { BumpPricing } from '@/types';

/**
 * UXV.4 — los precios y bolsas del usuario para promocionar, pedidos DESDE EL CLIENTE.
 *
 * POR QUÉ EXISTE: `/mis-anuncios` es una página de servidor y los resuelve una vez para
 * todas las tarjetas. La ficha pública NO puede hacer eso: es SSR/ISR cacheada para
 * cualquiera, y meterle tres peticiones por usuario rompería ese caché para todo el mundo.
 * Por eso UXV.1 dejó fuera el coste en la ficha y las dos superficies siguieron
 * discrepando: una decía «Bump 5 cr.» y la otra «Subir al inicio (bump)», sin precio.
 *
 * `enabled` es lo que lo hace aceptable: solo se pide cuando quien mira ES EL DUEÑO del
 * anuncio. Un visitante anónimo —el caso normal y masivo de una ficha— no dispara nada.
 */
export function useBumpPricing(token: string | undefined, enabled: boolean): BumpPricing | null {
  const [pricing, setPricing] = useState<BumpPricing | null>(null);

  useEffect(() => {
    if (!enabled || !token) return;
    let cancelado = false;

    Promise.all([
      getCatalog().catch(() => null),
      getWallet(token).catch(() => null),
      getProStatus(token).catch(() => null),
    ]).then(([catalog, wallet, pro]) => {
      if (cancelado) return;
      setPricing({
        // Los fallbacks son los mismos que ya usaba `/mis-anuncios` cuando una de las tres
        // llamadas fallaba: se degrada a «cuesta créditos», nunca a «es gratis».
        bumpCreditCost: catalog?.bumpCreditCost ?? 5,
        bumpOriginalCreditCost: catalog?.bumpOriginalCreditCost,
        bumpDiscountPercent: catalog?.bumpDiscountPercent,
        bumpBalance: wallet?.bumpBalance ?? 0,
        bumpQuota: pro?.bumpQuota ?? { limit: 0, used: 0, remaining: 0 },
      });
    });

    return () => {
      cancelado = true;
    };
  }, [token, enabled]);

  return pricing;
}
