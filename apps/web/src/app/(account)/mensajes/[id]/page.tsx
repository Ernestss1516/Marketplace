export default async function ChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Conversación</h1>
      <p className="text-muted-foreground">TODO: chat en tiempo real — conversación {id}</p>
    </div>
  );
}
