'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Check, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api/client';
import {
  getAdminTags,
  getCategoryTags,
  setCategoryTags,
  type AdminTag,
  type TagRef,
} from '@/lib/api/admin-tags';

/**
 * B1 — asignación de tags a una categoría. Hermano de `SchemaEditorPanel` (atributos):
 * se despliega en la fila de la categoría y edita SOLO lo propio.
 *
 * Los HEREDADOS del padre se muestran en gris y no se pueden tocar aquí, igual que
 * `AttributeSchemaEditor` hace con los atributos heredados: se ven para saber con qué
 * cuenta la categoría, pero se editan donde viven — en el padre. Si se pudieran quitar
 * desde la hija haría falta una lista de exclusión, y la herencia dejaría de ser "el
 * padre define, la hija añade".
 */
export function TagsEditorPanel({
  categoryId,
  categoryName,
  token,
}: {
  categoryId: string;
  categoryName: string;
  token: string;
}) {
  const [catalogo, setCatalogo] = useState<AdminTag[]>([]);
  const [propios, setPropios] = useState<TagRef[]>([]);
  const [heredados, setHeredados] = useState<TagRef[]>([]);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [lista, asignados] = await Promise.all([
        // Solo el catálogo ACTIVO se puede asignar: ofrecer uno desactivado sería
        // configurar algo que el público nunca vería.
        getAdminTags(token, { perPage: 200 }),
        getCategoryTags(token, categoryId),
      ]);
      setCatalogo(lista.items.filter((t) => t.activo));
      setPropios(asignados.own);
      setHeredados(asignados.inherited);
      setSeleccion(new Set(asignados.own.map((t) => t.id)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudieron cargar los tags');
    } finally {
      setLoading(false);
    }
  }, [token, categoryId]);

  useEffect(() => { void load(); }, [load]);

  const visibles = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? catalogo.filter((t) => t.name.toLowerCase().includes(needle)) : catalogo;
  }, [catalogo, q]);

  const heredadosIds = useMemo(() => new Set(heredados.map((t) => t.id)), [heredados]);

  const sucio = useMemo(() => {
    const original = new Set(propios.map((t) => t.id));
    if (original.size !== seleccion.size) return true;
    for (const id of seleccion) if (!original.has(id)) return true;
    return false;
  }, [propios, seleccion]);

  function toggle(id: string) {
    setSeleccion((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setGuardado(false);
  }

  async function guardar() {
    setSaving(true);
    setError(null);
    try {
      const res = await setCategoryTags(token, categoryId, [...seleccion]);
      setPropios(res.own);
      setHeredados(res.inherited);
      setSeleccion(new Set(res.own.map((t) => t.id)));
      setGuardado(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudieron guardar los tags');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="p-4 text-sm text-muted-foreground">Cargando tags…</p>;

  return (
    <div className="space-y-4 rounded-md border bg-muted/20 p-4">
      <div>
        <h4 className="text-sm font-semibold">Tags de {categoryName}</h4>
        <p className="text-xs text-muted-foreground">
          Los que marques se ofrecerán al publicar en esta categoría. Sus subcategorías los
          heredan.{' '}
          <Link href="/admin/tags" className="underline">Gestionar el catálogo</Link>
        </p>
      </div>

      {catalogo.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No hay tags activos en el catálogo.{' '}
          <Link href="/admin/tags" className="underline">Crea el primero</Link>.
        </p>
      ) : (
        <>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar en el catálogo…"
              aria-label="Buscar tags del catálogo"
              className="pl-9"
            />
          </div>

          <div className="flex flex-wrap gap-1.5" data-testid="tags-catalogo">
            {visibles.map((tag) => {
              const activo = seleccion.has(tag.id);
              const yaHeredado = heredadosIds.has(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggle(tag.id)}
                  title={yaHeredado ? 'Ya se hereda del padre; marcarlo aquí también es redundante' : undefined}
                  className={[
                    'flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors',
                    activo
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border hover:border-primary/50 hover:bg-accent',
                  ].join(' ')}
                >
                  {activo && <Check className="h-3 w-3 shrink-0" />}
                  {tag.name}
                </button>
              );
            })}
            {visibles.length === 0 && (
              <p className="text-xs text-muted-foreground">Ninguno coincide con la búsqueda.</p>
            )}
          </div>
        </>
      )}

      {/* HEREDADOS — solo lectura, igual que los atributos heredados del padre. */}
      {heredados.length > 0 && (
        <div data-testid="tags-heredados">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Heredados del padre
          </p>
          <div className="flex flex-wrap gap-1.5">
            {heredados.map((tag) => (
              <span
                key={tag.id}
                className="rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground"
              >
                {tag.name}
              </span>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Se ofrecen aquí automáticamente. Para quitarlos, edítalos en la categoría padre.
          </p>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={guardar} disabled={!sucio || saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Guardar tags'}
        </Button>
        {guardado && !sucio && <span className="text-xs text-muted-foreground">Guardado.</span>}
      </div>
    </div>
  );
}
