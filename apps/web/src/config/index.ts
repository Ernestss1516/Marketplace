export const SITE_NAME = 'Marketplace';
export const SITE_DESCRIPTION = 'Compra y vende artículos de segunda mano entre particulares.';
export const SITE_URL = process.env.AUTH_URL ?? 'http://localhost:3000';
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export const DEFAULT_PAGE_SIZE = 24;
export const DEFAULT_CURRENCY = 'EUR';
export const LISTING_EXPIRY_DAYS = 60;
