import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Heart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FavoritosClient } from './FavoritosClient';
import { CardAttributesProvider } from '@/components/anuncios/CardAttributesContext';
import { auth } from '@/lib/auth';
import { getMyFavorites } from '@/lib/api/favoritos';
import { getCategories } from '@/lib/api/categorias';
import { buildCardAttributeMap } from '@/lib/card-attributes';
import { buildLoginUrl } from '@/lib/auth/callback-url';

export const metadata = { title: 'Favoritos' };

const PER_PAGE = 20;

export default async function FavoritosPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await auth();
  if (!session?.user.accessToken) redirect(buildLoginUrl('/favoritos'));

  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const [data, categories] = await Promise.all([
    getMyFavorites(session.user.accessToken, page, PER_PAGE),
    getCategories().catch(() => [] as Awaited<ReturnType<typeof getCategories>>),
  ]);

  const cardAttributeMap = buildCardAttributeMap(categories);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Favoritos</h1>

      {data.total === 0 ? (
        <div className="flex flex-col items-center gap-4 py-16 text-center text-muted-foreground">
          <Heart className="h-12 w-12 opacity-30" />
          <p className="text-base">Aún no tienes anuncios guardados.</p>
          <Button variant="outline" asChild>
            <Link href="/busqueda">Explorar anuncios</Link>
          </Button>
        </div>
      ) : (
        <CardAttributesProvider cardAttributeMap={cardAttributeMap}>
          <FavoritosClient
            initialListings={data.items}
            totalInitial={data.total}
            page={page}
            pages={data.pages}
          />
        </CardAttributesProvider>
      )}
    </div>
  );
}
