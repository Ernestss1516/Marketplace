import { redirect, notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getMyListingById } from '@/lib/api/anuncios';
import { getCategoryBySlug } from '@/lib/api/categorias';
import { EditarWizard, type EditarWizardData } from '@/components/publicar/EditarWizard';
import { resolvePriceUnitSelection } from '@/components/publicar/steps/StepDatos';
import { ApiError } from '@/lib/api/client';
import { buildLoginUrl } from '@/lib/auth/callback-url';
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
  if (!session?.user.accessToken) redirect(buildLoginUrl(`/mis-anuncios/${id}/editar`));

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
    // RP.3 — formatos efectivos de la categoría del anuncio (ya resueltos por
    // el backend). Aquí la categoría no se puede cambiar, así que la lista es
    // fija durante toda la edición.
    allowedPriceUnits: category.allowedPriceUnits ?? [],
    // B2 — tags efectivos de la categoría y tope vigente, del mismo GET que ya se
    // hacía. Sin tags → el wizard omite el paso (regla de desaparición).
    availableTags: category.tags ?? [],
    maxTags: category.maxTags ?? 0,
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
    // Preselecciona el formato ACTUAL del anuncio; si su categoría ya no lo
    // permitiera (caso de borde: el guard de RP.2 lo impide por la vía normal),
    // cae al primero válido en vez de mostrar el selector en blanco.
    priceUnit: resolvePriceUnitSelection(
      category.allowedPriceUnits ?? [],
      listing.priceUnit,
    ),
    // Attributes — convert unknown values to strings for the wizard inputs
    attributes: Object.fromEntries(
      Object.entries(listing.attributes).map(([k, v]) => [k, String(v)]),
    ),
    // B2 — precarga: los tags que el anuncio YA tiene. Se filtran contra los efectivos
    // porque un tag puede haber dejado de ofrecerse en la categoría (o haberse
    // desactivado) después de publicarse: mostrarlo marcado sería ofrecer algo que el
    // backend rechazaría al guardar. El anuncio lo conserva mientras no se edite.
    tags: (listing.tags ?? [])
      .map((t) => t.slug)
      .filter((slug) => (category.tags ?? []).some((t) => t.slug === slug)),
    // Ubicacion
    city: listing.city ?? '',
    province: listing.province ?? '',
    postalCode: listing.postalCode ?? '',
    // Del ANUNCIO, no del perfil — igual que city/province/postalCode arriba.
    phone: listing.phone ?? '',
  };

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Editar anuncio</h1>
      <EditarWizard listingId={id} token={token} initialData={initialData} />
    </div>
  );
}
