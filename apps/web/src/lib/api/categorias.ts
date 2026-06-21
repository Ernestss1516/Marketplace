import type { Category, CategoryWithSchema } from '@/types';
import { apiFetch } from './client';

export function getCategories(): Promise<Category[]> {
  return apiFetch<Category[]>('/categories');
}

export function getCategoryBySlug(slug: string): Promise<CategoryWithSchema> {
  return apiFetch<CategoryWithSchema>(`/categories/${slug}`);
}
