export default async function EditarAnuncioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Editar anuncio</h1>
      <p className="text-muted-foreground">TODO: formulario de edición del anuncio {id}</p>
    </div>
  );
}
