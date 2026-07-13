import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getCategories } from '@/lib/api/categorias';
import { getMe } from '@/lib/api/usuarios';
import { PublicarWizard } from '@/components/publicar/PublicarWizard';
import { buildLoginUrl } from '@/lib/auth/callback-url';

export const metadata = { title: 'Publicar anuncio' };

export default async function PublicarPage() {
  const session = await auth();
  if (!session?.user.accessToken) redirect(buildLoginUrl('/publicar'));

  const token = session.user.accessToken;
  const [categories, me] = await Promise.all([
    getCategories(),
    getMe(token).catch(() => ({})),
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
      />
    </div>
  );
}
