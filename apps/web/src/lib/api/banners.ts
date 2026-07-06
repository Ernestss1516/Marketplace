import { apiFetch } from './client';

export type BannerPlacement = 'HOME' | 'MIS_ANUNCIOS';
export type BannerVariant = 'INFO' | 'PROMO' | 'WARNING';

export interface Banner {
  id: string;
  title: string;
  text: string;
  linkUrl: string | null;
  linkText: string | null;
  placements: BannerPlacement[];
  variant: BannerVariant;
  shareable: boolean;
  shareText: string | null;
  active: boolean;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  updatedAt: string;
}

/** GET /banners?placement=... — público, sin auth (la home es pública). */
export function getActiveBanners(placement: BannerPlacement): Promise<Banner[]> {
  return apiFetch<Banner[]>(`/banners?placement=${placement}`);
}
