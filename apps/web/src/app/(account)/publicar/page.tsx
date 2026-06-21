import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getCategories } from '@/lib/api/categorias';
import { PublicarWizard } from '@/components/publicar/PublicarWizard';

export const metadata = { title: 'Publicar anuncio' };

export default async function PublicarPage() {
  const session = await auth();
  if (!session?.user.accessToken) redirect('/login');

  const categories = await getCategories();

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Publicar anuncio</h1>
      <PublicarWizard token={session.user.accessToken} categories={categories} />
    </div>
  );
}
