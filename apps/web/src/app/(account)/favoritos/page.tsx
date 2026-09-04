import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Ilustracion } from '@/components/shared/Ilustracion';
import { getIlustracion } from '@/lib/api/ilustraciones';
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
          {/* E7 — LA ILUSTRACIÓN OCUPA EL HUECO QUE YA HABÍA, el del icono. El hueco es
              ESTRUCTURA (§8.1): esta pantalla decide que aquí va una imagen, de qué
              tamaño y con qué texto debajo. Qué imagen es lo único que un modelo o un
              admin cambian. */}
          <Ilustracion slot="empty-favorites" />
          <p className="text-base">Aún no tienes anuncios guardados.</p>
          <Button variant="outline" asChild>
            <Link href="/busqueda">Explorar anuncios</Link>
          </Button>
        </div>
      ) : (
        <CardAttributesProvider cardAttributeMap={cardAttributeMap}>
          <FavoritosClient
            ilustracionVacio={await getIlustracion('empty-favorites')}
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
