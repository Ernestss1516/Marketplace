export default async function SubcategoriaPage({
  params,
}: {
  params: Promise<{ categoria: string; subcategoria: string }>;
}) {
  const { categoria, subcategoria } = await params;
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold">
        TODO: Listado — {categoria} / {subcategoria}
      </h1>
    </div>
  );
}
