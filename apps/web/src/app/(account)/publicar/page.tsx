import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getCategories } from '@/lib/api/categorias';
import { getPhotoLimits } from '@/lib/api/anuncios';
import { getMe } from '@/lib/api/usuarios';
import { getProStatus, type ProStatus } from '@/lib/api/billing';
import { PublicarWizard } from '@/components/publicar/PublicarWizard';
import { buildLoginUrl } from '@/lib/auth/callback-url';

export const metadata = { title: 'Publicar anuncio' };

export default async function PublicarPage() {
  const session = await auth();
  if (!session?.user.accessToken) redirect(buildLoginUrl('/publicar'));

  const token = session.user.accessToken;
  const [categories, me, photoLimits, proStatus] = await Promise.all([
    getCategories(),
    getMe(token).catch(() => ({})),
    // PUERTA regla #3 — el tope de fotos lo dice el servidor, no una constante del
    // asistente. Se pide aquí, junto al resto de datos de la página.
    getPhotoLimits(),
    // VÍDEO #11 — el asistente necesita saber si quien publica es Pro para decirle lo que
    // le toca: al Pro, que su vídeo se añade editando; al que no lo es, que existe. Se
    // pide como en `/mis-anuncios` y en el editor, y se degrada a «no Pro» si falla — un
    // aviso perdido no puede tumbar la publicación.
    getProStatus(token).catch(() => ({ isPro: false }) as ProStatus),
  ]);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Publicar anuncio</h1>
      <PublicarWizard
        token={token}
        categories={categories}
        initialLocation={{
          city: ('city' in me && me.city) ? me.city : '',
          province: ('province' in me && me.province) ? me.province : '',
          postalCode: ('postalCode' in me && me.postalCode) ? me.postalCode : '',
        }}
        initialPhone={('phone' in me && me.phone) ? me.phone : ''}
        photoLimits={photoLimits}
        isPro={proStatus.isPro}
      />
    </div>
  );
}
