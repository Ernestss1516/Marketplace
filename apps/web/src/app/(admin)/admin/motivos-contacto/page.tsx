'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { AlertCircle, ArrowLeft, ChevronDown, ChevronUp, Loader2, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api/client';
import { SesionNoDisponible } from '@/app/(admin)/components/SesionNoDisponible';
import {
  createAdminContactReason,
  getAdminContactReasons,
  reorderAdminContactReasons,
  updateAdminContactReason,
  type AdminContactReason,
} from '@/lib/api/admin-contact-reasons';

function ReasonRow({
  reason,
  isFirst,
  isLast,
  busy,
  onMove,
  onSave,
  onToggleActivo,
}: {
  reason: AdminContactReason;
  isFirst: boolean;
  isLast: boolean;
  busy: boolean;
  onMove: (dir: 'up' | 'down') => void;
  onSave: (nombre: string) => Promise<void>;
  onToggleActivo: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [nombre, setNombre] = useState(reason.nombre);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (nombre.trim().length < 2) {
      setError('El nombre debe tener al menos 2 caracteres.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(nombre.trim());
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-md border px-3 py-2">
      <div className="flex flex-col">
        <button
          onClick={() => onMove('up')}
          disabled={isFirst || busy}
          className="h-4 w-4 text-muted-foreground hover:text-foreground disabled:opacity-30"
          title="Subir"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
        <button
          onClick={() => onMove('down')}
          disabled={isLast || busy}
          className="h-4 w-4 text-muted-foreground hover:text-foreground disabled:opacity-30"
          title="Bajar"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="flex items-center gap-2">
            <Input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              maxLength={60}
              className="h-8 max-w-xs"
              autoFocus
            />
            <Button size="sm" className="h-8" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Guardar'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8"
              onClick={() => {
                setEditing(false);
                setNombre(reason.nombre);
                setError(null);
              }}
              disabled={saving}
            >
              Cancelar
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="font-medium">{reason.nombre}</span>
            <Badge variant={reason.activo ? 'default' : 'outline'}>
              {reason.activo ? 'Activo' : 'Inactivo'}
            </Badge>
          </div>
        )}
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>

      {!editing && (
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setEditing(true)}>
            Renombrar
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={onToggleActivo}
            disabled={busy}
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : reason.activo ? 'Desactivar' : 'Activar'}
          </Button>
        </div>
      )}
    </div>
  );
}

export default function AdminContactReasonsPage() {
  const { data: session } = useSession();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;

  const [reasons, setReasons] = useState<AdminContactReason[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [newNombre, setNewNombre] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const fetchReasons = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getAdminContactReasons(token);
      setReasons(data.sort((a, b) => a.orden - b.orden));
    } catch (err) {
      setError(err instanceof ApiError ? `Error ${err.statusCode}: ${err.message}` : 'Error al cargar los motivos');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchReasons();
  }, [fetchReasons]);

  async function handleCreate() {
    if (!token) return;
    if (newNombre.trim().length < 2) {
      setCreateError('El nombre debe tener al menos 2 caracteres.');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      await createAdminContactReason(token, { nombre: newNombre.trim() });
      setNewNombre('');
      await fetchReasons();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'Error al crear el motivo');
    } finally {
      setCreating(false);
    }
  }

  async function handleRename(id: string, nombre: string) {
    if (!token) return;
    await updateAdminContactReason(token, id, { nombre });
    await fetchReasons();
  }

  async function handleToggleActivo(reason: AdminContactReason) {
    if (!token) return;
    setBusyId(reason.id);
    setError(null);
    try {
      await updateAdminContactReason(token, reason.id, { activo: !reason.activo });
      await fetchReasons();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Error al cambiar el estado del motivo',
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleMove(reason: AdminContactReason, dir: 'up' | 'down') {
    const sorted = [...reasons].sort((a, b) => a.orden - b.orden);
    const idx = sorted.findIndex((r) => r.id === reason.id);
    const neighborIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (neighborIdx < 0 || neighborIdx >= sorted.length) return;

    const a = sorted[idx];
    const b = sorted[neighborIdx];
    const swapped = sorted.map((r) => {
      if (r.id === a.id) return { ...r, orden: b.orden };
      if (r.id === b.id) return { ...r, orden: a.orden };
      return r;
    });
    setReasons(swapped.sort((x, y) => x.orden - y.orden));

    if (!token) return;
    setBusyId(reason.id);
    try {
      await reorderAdminContactReasons(token, [
        { id: a.id, orden: b.orden },
        { id: b.id, orden: a.orden },
      ]);
    } catch {
      await fetchReasons();
    } finally {
      setBusyId(null);
    }
  }

  if (!token) {
    return (
      <SesionNoDisponible />
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild className="gap-1">
          <Link href="/admin/mensajes-contacto">
            <ArrowLeft className="h-4 w-4" />
            Mensajes
          </Link>
        </Button>
        <h1 className="text-2xl font-bold">Motivos de contacto</h1>
      </div>

      <p className="text-sm text-muted-foreground">
        Definen las opciones del <code>&lt;select&gt;</code> del formulario público de contacto.
        El orden aquí es el orden en el que aparecen. Un motivo desactivado deja de ofrecerse en
        el formulario, pero los mensajes ya recibidos con ese motivo lo conservan intacto — nunca
        se borra.
      </p>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Cargando...
        </div>
      ) : (
        <div className="space-y-2">
          {reasons.map((reason, i) => (
            <ReasonRow
              key={reason.id}
              reason={reason}
              isFirst={i === 0}
              isLast={i === reasons.length - 1}
              busy={busyId === reason.id}
              onMove={(dir) => handleMove(reason, dir)}
              onSave={(nombre) => handleRename(reason.id, nombre)}
              onToggleActivo={() => handleToggleActivo(reason)}
            />
          ))}
        </div>
      )}

      <div className="rounded-md border p-4">
        <p className="mb-2 text-sm font-medium">Nuevo motivo</p>
        <div className="flex items-center gap-2">
          <Input
            value={newNombre}
            onChange={(e) => setNewNombre(e.target.value)}
            placeholder="Ej. Colaboraciones"
            maxLength={60}
            className="max-w-xs"
          />
          <Button size="sm" onClick={handleCreate} disabled={creating} className="gap-1">
            {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            Crear
          </Button>
        </div>
        {createError && <p className="mt-2 text-xs text-destructive">{createError}</p>}
      </div>
    </div>
  );
}
