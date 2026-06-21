import type { MediaUploadResponse } from '@/types';
import { apiFetch } from './client';

export function uploadMedia(file: File, token: string): Promise<MediaUploadResponse> {
  const body = new FormData();
  body.append('file', file);
  return apiFetch<MediaUploadResponse>('/media/upload', {
    method: 'POST',
    body,
    token,
  });
}
