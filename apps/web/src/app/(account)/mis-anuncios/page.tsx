import { redirect } from 'next/navigation';
import Link from 'next/link';
import { PlusCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { auth } from '@/lib/auth';
import { getMyListings } from '@/lib/api/anuncios';
import { MisAnunciosClient } from '@/components/anuncios/MisAnunciosClient';

export const metadata = { title: 'Mis anuncios' };

export default async function MisAnunciosPage() {
  const session = await auth();
  if (!session?.user.accessToken) redirect('/login');

  const { items } = await getMyListings(session.user.accessToken);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Mis anuncios</h1>
        <Button asChild>
          <Link href="/publicar">
            <PlusCircle className="mr-2 h-4 w-4" />
            Publicar anuncio
          </Link>
        </Button>
      </div>

      <MisAnunciosClient initialListings={items} token={session.user.accessToken} />
    </div>
  );
}
