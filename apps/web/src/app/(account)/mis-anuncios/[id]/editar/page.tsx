import { redirect, notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getMyListingById } from '@/lib/api/anuncios';
import { getCategoryBySlug } from '@/lib/api/categorias';
import { EditarWizard, type EditarWizardData } from '@/components/publicar/EditarWizard';
import { ApiError } from '@/lib/api/client';
import type { PriceType } from '@/types';

export const metadata = { title: 'Editar anuncio' };

function priceModeFromType(priceType: PriceType): 'fixed' | 'free' | 'negotiable' {
  if (priceType === 'FREE') return 'free';
  if (priceType === 'NEGOTIABLE') return 'negotiable';
  return 'fixed';
}

export default async function EditarAnuncioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await auth();
  if (!session?.user.accessToken) redirect('/login');

  const token = session.user.accessToken;

  let listing;
  try {
    listing = await getMyListingById(id, token);
  } catch (err) {
    if (err instanceof ApiError && err.statusCode === 403) redirect('/mis-anuncios');
    notFound();
  }

  const category = await getCategoryBySlug(listing.category.slug);

  const initialData: EditarWizardData = {
    // Category — locked, not changeable from this wizard
    categoryId: category.id,
    categorySlug: category.slug,
    categoryName: category.name,
    attributeSchema: category.attributeSchema ?? [],
    // Images — preloaded with backend IDs so the wizard can manage them.
    // localId reuses img.id (a UUID from the DB, unique within the listing).
    images: listing.images.map((img) => ({
      localId: img.id,
      id: img.id,
      url: img.url,
      previewUrl: img.url,
      uploading: false,
    })),
    // Datos
    title: listing.title,
    description: listing.description,
    type: listing.type,
    condition: listing.condition ?? '',
    priceMode: priceModeFromType(listing.priceType),
    price: String(listing.price),
    // Attributes — convert unknown values to strings for the wizard inputs
    attributes: Object.fromEntries(
      Object.entries(listing.attributes).map(([k, v]) => [k, String(v)]),
    ),
    // Ubicacion
    city: listing.city ?? '',
    province: listing.province ?? '',
    postalCode: listing.postalCode ?? '',
  };

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Editar anuncio</h1>
      <EditarWizard listingId={id} token={token} initialData={initialData} />
    </div>
  );
}
