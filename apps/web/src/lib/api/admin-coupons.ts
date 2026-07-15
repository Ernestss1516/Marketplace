import { apiFetch } from './client';

export type CouponRewardType = 'CREDITS' | 'FEATURED' | 'BUMP';
export type CouponStatus = 'upcoming' | 'live' | 'ended';

export interface AdminCoupon {
  id: string;
  code: string;
  rewardType: CouponRewardType;
  creditAmount: number | null;
  featuredDurationDays: number | null;
  bumpAmount: number | null;
  maxRedemptions: number | null;
  redemptionCount: number;
  active: boolean;
  startsAt: string;
  endsAt: string;
  status: CouponStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedAdminCoupons {
  items: AdminCoupon[];
  total: number;
  page: number;
  perPage: number;
}

export interface CreateCouponPayload {
  code: string;
  rewardType: CouponRewardType;
  creditAmount?: number;
  featuredDurationDays?: number;
  bumpAmount?: number;
  maxRedemptions?: number | null;
  active?: boolean;
  startsAt: string;
  endsAt: string;
}

export interface UpdateCouponPayload {
  active?: boolean;
  startsAt?: string;
  endsAt?: string;
  maxRedemptions?: number | null;
  creditAmount?: number;
  featuredDurationDays?: number;
  bumpAmount?: number;
}

export function getAdminCoupons(
  token: string,
  params: { rewardType?: CouponRewardType; active?: boolean; page?: number; perPage?: number } = {},
): Promise<PaginatedAdminCoupons> {
  const qs = new URLSearchParams({ page: String(params.page ?? 1) });
  if (params.rewardType) qs.set('rewardType', params.rewardType);
  if (params.active !== undefined) qs.set('active', String(params.active));
  if (params.perPage) qs.set('perPage', String(params.perPage));

  return apiFetch<PaginatedAdminCoupons>(`/admin/coupons?${qs}`, { token, cache: 'no-store' });
}

export function createAdminCoupon(token: string, dto: CreateCouponPayload): Promise<AdminCoupon> {
  return apiFetch<AdminCoupon>('/admin/coupons', {
    method: 'POST',
    body: JSON.stringify(dto),
    token,
  });
}

export function updateAdminCoupon(
  token: string,
  id: string,
  dto: UpdateCouponPayload,
): Promise<AdminCoupon> {
  return apiFetch<AdminCoupon>(`/admin/coupons/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
    token,
  });
}
