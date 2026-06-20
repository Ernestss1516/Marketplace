import { ImageResponse } from 'next/og';
import { SITE_NAME } from '@/config';

export const alt = 'Anuncio';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: '100%',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f8fafc',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div style={{ fontSize: 24, color: '#64748b' }}>{SITE_NAME}</div>
        <div style={{ fontSize: 48, fontWeight: 700, color: '#0f172a' }}>{slug}</div>
      </div>
    ),
    size,
  );
}
