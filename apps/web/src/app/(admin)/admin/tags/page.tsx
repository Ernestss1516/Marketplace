'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { AlertCircle, ArrowLeft, ChevronDown, ChevronUp, Loader2, Plus, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api/client';
import {
  createAdminTag,
  getAdminTagUsage,
  getAdminTags,
  reorderAdminTags,
  updateAdminTag,
  type AdminTag,
} from '@/lib/api/admin-tags';

/**
 * B1 — catálogo global de tags. Molde de /admin/motivos-contacto: tabla, alta inline,
 * flechas ↑↓ y toggle de activo. SIN borrar: un tag se desactiva, nunca se elimina, para
 * que los anuncios que ya lo llevan lo conserven.
 */

function TagRow({
  tag,
  isFirst,
  isLast,
  busy,
  token,
  onMove,
  onSave,
  onToggleActivo,
}: {
  tag: AdminTag;
  isFirst: boolean;
  isLast: boolean;
  busy: boolean;
  token: string;
  onMove: (dir: 'up' | 'down') => void;
  onSave: (name: string) => Promise<void>;
  onToggleActivo: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(tag.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (name.trim().length < 1) {
      setError('El nombre no puede estar vacío.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(name.trim());
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  /** Desactivar SE PERMITE, pero el admin merece saber a cuántos afecta antes. */
  async function handleToggle() {
    if (tag.activo) {
      try {
        const { listingCount, categoryCount } = await getAdminTagUsage(token, tag.id);
        if (listingCount > 0 || categoryCount > 0) {
          const ok = window.confirm(
            `"${tag.name}" está en ${listingCount} anuncio(s) y ofrecido en ${categoryCount} categoría(s).\n\n` +
              'Al desactivarlo dejará de ofrecerse y de filtrarse, pero los anuncios que ya lo tienen lo conservan.\n\n' +
              '¿Desactivarlo?',
          );
          if (!ok) return;
        }
      } catch {
        // Si el conteo falla no se bloquea la acción: es un aviso, no un permiso.
      }
    }
    await onToggleActivo();
  }

  return (
    <div className="flex items-center gap-2 rounded-md border px-3 py-2">
      <div className="flex flex-col">
        <button
          onClick={() => onMove('up')}
          disabled={isFirst || busy}
          aria-label="Subir"
          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
        <button
          onClick={() => onMove('down')}
          disabled={isLast || busy}
          aria-label="Bajar"
          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="flex items-center gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              aria-label="Nombre del tag"
              autoFocus
            />
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Guardar'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setName(tag.name); }}>
              Cancelar
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className={tag.activo ? '' : 'text-muted-foreground line-through'}>{tag.name}</span>
            {/* El slug se MUESTRA pero no se edita: es la URL de filtro y lo indexado. */}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{tag.slug}</code>
            {!tag.activo && <Badge variant="secondary">Inactivo</Badge>}
          </div>
        )}
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>

      {!editing && (
        <>
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)} disabled={busy}>
            Renombrar
          </Button>
          <Button size="sm" variant="outline" onClick={handleToggle} disabled={busy}>
            {tag.activo ? 'Desactivar' : 'Reactivar'}
          </Button>
        </>
      )}
    </div>
  );
}

export default function AdminTagsPage() {
  const { data: session } = useSession();
  const token = session?.user?.accessToken ?? '';

  const [tags, setTags] = useState<AdminTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async (busqueda: string) => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getAdminTags(token, { q: busqueda || undefined, perPage: 200 });
      setTags(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudieron cargar los tags');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(''); }, [load]);

  async function handleCreate() {
    if (newName.trim().length < 1) {
      setCreateError('El nombre no puede estar vacío.');
      return;
    }
    setBusy(true);
    setCreateError(null);
    try {
      await createAdminTag(token, {
        name: newName.trim(),
        ...(newSlug.trim() ? { slug: newSlug.trim() } : {}),
      });
      setNewName('');
      setNewSlug('');
      setCreating(false);
      await load(q);
    } catch (err) {
      // El 409 de slug duplicado llega con su mensaje: se muestra tal cual, que ya
      // dice qué slug choca.
      setCreateError(err instanceof ApiError ? err.message : 'No se pudo crear');
    } finally {
      setBusy(false);
    }
  }

  /** Swap de dos elementos: se calcula aquí y se manda la lista {id, orden} — mismo
   *  molde que motivos de contacto y categorías. */
  async function handleMove(index: number, dir: 'up' | 'down') {
    const destino = dir === 'up' ? index - 1 : index + 1;
    if (destino < 0 || destino >= tags.length) return;

    const copia = [...tags];
    [copia[index], copia[destino]] = [copia[destino], copia[index]];
    setTags(copia);

    setBusy(true);
    try {
      await reorderAdminTags(token, copia.map((t, i) => ({ id: t.id, orden: i })));
    } catch {
      await load(q); // revertir al estado real
    } finally {
      setBusy(false);
    }
  }

  async function handleSave(id: string, name: string) {
    await updateAdminTag(token, id, { name });
    await load(q);
  }

  async function handleToggleActivo(tag: AdminTag) {
    setBusy(true);
    try {
      await updateAdminTag(token, tag.id, { activo: !tag.activo });
      await load(q);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin"><ArrowLeft className="mr-1 h-4 w-4" />Volver</Link>
        </Button>
        <h1 className="text-2xl font-bold">Tags</h1>
      </div>

      <p className="text-sm text-muted-foreground">
        Vocabulario común a todo el sitio. Un tag se asigna a las categorías donde se ofrece
        (desde <Link href="/admin/categorias" className="underline">Categorías</Link>), y las
        subcategorías heredan los del padre. Los tags no se borran: se desactivan, para que los
        anuncios que ya los llevan los conserven.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load(q)}
            onBlur={() => load(q)}
            placeholder="Buscar por nombre…"
            aria-label="Buscar tags"
            className="pl-9"
          />
        </div>
        <Button onClick={() => setCreating((v) => !v)} disabled={busy}>
          <Plus className="mr-1 h-4 w-4" />Nuevo tag
        </Button>
      </div>

      {creating && (
        <div className="space-y-2 rounded-md border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nombre (p. ej. Con garantía)"
              aria-label="Nombre del nuevo tag"
              className="flex-1 min-w-[200px]"
              autoFocus
            />
            <Input
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value)}
              placeholder="slug (opcional)"
              aria-label="Slug del nuevo tag"
              className="w-56"
            />
            <Button onClick={handleCreate} disabled={busy}>Crear</Button>
            <Button variant="ghost" onClick={() => { setCreating(false); setCreateError(null); }}>
              Cancelar
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            El slug se deriva del nombre si lo dejas vacío. No se puede cambiar después: es lo que
            viaja en la URL de búsqueda.
          </p>
          {createError && <p className="text-sm text-destructive">{createError}</p>}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />{error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : tags.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {q ? 'Ningún tag coincide con la búsqueda.' : 'Todavía no hay tags. Crea el primero.'}
        </p>
      ) : (
        <div className="space-y-2">
          {tags.map((tag, i) => (
            <TagRow
              key={tag.id}
              tag={tag}
              token={token}
              isFirst={i === 0}
              isLast={i === tags.length - 1}
              busy={busy}
              onMove={(dir) => handleMove(i, dir)}
              onSave={(name) => handleSave(tag.id, name)}
              onToggleActivo={() => handleToggleActivo(tag)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
