import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Heart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ListingCard } from '@/components/anuncios/ListingCard';
import { auth } from '@/lib/auth';
import { getMyFavorites } from '@/lib/api/favoritos';

export const metadata = { title: 'Favoritos' };

const PER_PAGE = 20;

export default async function FavoritosPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await auth();
  if (!session?.user.accessToken) redirect('/login');

  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const data = await getMyFavorites(session.user.accessToken, page, PER_PAGE);

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
        <>
          <p className="text-sm text-muted-foreground">
            {data.total} {data.total === 1 ? 'anuncio guardado' : 'anuncios guardados'}
          </p>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {data.items.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>

          {data.pages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              {page > 1 && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/favoritos?page=${page - 1}`}>Anterior</Link>
                </Button>
              )}
              <span className="text-sm text-muted-foreground">
                Página {page} de {data.pages}
              </span>
              {page < data.pages && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/favoritos?page=${page + 1}`}>Siguiente</Link>
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
