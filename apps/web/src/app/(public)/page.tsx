import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { SearchBar } from '@/components/busqueda/SearchBar';
import { CategoryGrid } from '@/components/categorias/CategoryGrid';
import { ListingCard } from '@/components/anuncios/ListingCard';
import { getCategories } from '@/lib/api/categorias';
import { getRecentListings } from '@/lib/api/anuncios';

export default async function HomePage() {
  const [categories, recent] = await Promise.all([
    getCategories().catch(() => [] as Awaited<ReturnType<typeof getCategories>>),
    getRecentListings({ perPage: 8 }).catch(() => ({
      items: [],
      total: 0,
      page: 1,
      perPage: 8,
    })),
  ]);

  return (
    <div className="container mx-auto px-4 pb-16">
      {/* Hero */}
      <section className="py-12 md:py-20">
        <h1 className="mb-3 text-3xl font-bold md:text-4xl">
          Compra y vende de segunda mano
        </h1>
        <p className="mb-6 text-muted-foreground md:text-lg">
          Encuentra lo que buscas entre miles de anuncios de particulares.
        </p>
        <SearchBar />
      </section>

      {/* Categorías */}
      {categories.length > 0 && (
        <section className="mb-12">
          <h2 className="mb-4 text-xl font-semibold">Categorías</h2>
          <CategoryGrid categories={categories} />
        </section>
      )}

      {/* Últimos anuncios */}
      <section>
        <h2 className="mb-4 text-xl font-semibold">Últimos anuncios</h2>
        {recent.items.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {recent.items.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        ) : (
          <p className="py-8 text-center text-muted-foreground">
            Aún no hay anuncios publicados.
          </p>
        )}
      </section>

      {/* CTA publicar */}
      <section className="mt-16 rounded-xl bg-primary/5 px-6 py-10 text-center">
        <h2 className="mb-2 text-xl font-semibold">¿Tienes algo que vender?</h2>
        <p className="mb-6 text-muted-foreground">
          Publica tu anuncio en menos de 2 minutos, gratis.
        </p>
        <Button asChild size="lg">
          <Link href="/publicar">Publicar anuncio</Link>
        </Button>
      </section>
    </div>
  );
}
