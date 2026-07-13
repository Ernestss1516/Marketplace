import { ImageResponse } from 'next/og';
import { SITE_NAME } from '@/config';
import { getListing } from '@/lib/api/anuncios';

export const alt = 'Anuncio';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Solo se usa como fallback: generateMetadata (page.tsx) pone su propia
// openGraph.images con la foto real del anuncio cuando existe, y esa
// tiene prioridad sobre este archivo. Este render solo se ve para
// anuncios sin fotos — por eso vale la pena mostrar el TÍTULO real, no
// el slug en crudo (que es solo un identificador SEO, no texto legible).
export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const title = await getListing(slug).then((l) => l.title).catch(() => slug);
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
          padding: '0 80px',
        }}
      >
        <div style={{ fontSize: 24, color: '#64748b' }}>{SITE_NAME}</div>
        <div style={{ fontSize: 48, fontWeight: 700, color: '#0f172a', textAlign: 'center' }}>
          {title}
        </div>
      </div>
    ),
    size,
  );
}
