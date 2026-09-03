'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, Loader2 } from 'lucide-react';
import {
  getAdminPost,
  updateAdminPost,
  publishAdminPost,
  unpublishAdminPost,
  deleteAdminPost,
  type AdminPost,
} from '@/lib/api/blog-admin';
import { ApiError } from '@/lib/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PostForm, type PostFormValues } from '../../_components/PostForm';

// I18N T3-B — estaba en la lista y en el editor, idéntico. «Publicado» concuerda con
// «el post»; la variante femenina —para las páginas del CMS— vive declarada aparte.
import { ESTADO_POST_LABELS as STATUS_LABELS } from '@/lib/etiquetas-enums';
import { SesionNoDisponible } from '@/app/(admin)/components/SesionNoDisponible';

const STATUS_VARIANTS: Record<string, 'default' | 'outline'> = {
  DRAFT: 'outline',
  PUBLISHED: 'default',
};

function parseTags(raw: string): string[] {
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

function toFormValues(post: AdminPost): PostFormValues {
  return {
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt ?? '',
    blocks: post.blocks,
    tags: post.tags.join(', '),
    coverUrl: post.coverUrl ?? '',
    metaTitle: post.metaTitle ?? '',
    metaDescription: post.metaDescription ?? '',
  };
}

export default function EditarBlogPage() {
  const { id } = useParams<{ id: string }>();
  const { data: session } = useSession();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;
  const router = useRouter();

  const [post, setPost] = useState<AdminPost | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [values, setValues] = useState<PostFormValues>({
    title: '',
    slug: '',
    excerpt: '',
    blocks: [],
    tags: '',
    coverUrl: '',
    metaTitle: '',
    metaDescription: '',
  });

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchPost = useCallback(async () => {
    if (!token || !id) return;
    setLoadError(null);
    try {
      const data = await getAdminPost(token, id);
      setPost(data);
      setValues(toFormValues(data));
    } catch (err) {
      setLoadError(
        err instanceof ApiError
          ? `Error ${err.statusCode}: ${err.message}`
          : 'Error al cargar el post',
      );
    }
  }, [token, id]);

  useEffect(() => {
    fetchPost();
  }, [fetchPost]);

  async function handleSave() {
    if (!token || !post || saving) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const updated = await updateAdminPost(token, post.id, {
        title: values.title,
        slug: values.slug || undefined,
        excerpt: values.excerpt || undefined,
        blocks: values.blocks,
        coverUrl: values.coverUrl || undefined,
        tags: parseTags(values.tags),
        metaTitle: values.metaTitle || undefined,
        metaDescription: values.metaDescription || undefined,
      });
      setPost(updated);
      setValues(toFormValues(updated));
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setSaveError(
        err instanceof ApiError
          ? `Error ${err.statusCode}: ${err.message}`
          : 'Error al guardar',
      );
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    if (!token || !post || actionLoading) return;
    setActionLoading('publish');
    setSaveSuccess(false);
    try {
      const updated = await publishAdminPost(token, post.id);
      setPost(updated);
      setValues(toFormValues(updated));
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Error al publicar');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleUnpublish() {
    if (!token || !post || actionLoading) return;
    setActionLoading('unpublish');
    setSaveSuccess(false);
    try {
      const updated = await unpublishAdminPost(token, post.id);
      setPost(updated);
      setValues(toFormValues(updated));
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Error al despublicar');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDelete() {
    if (
      !token ||
      !post ||
      !window.confirm(`¿Eliminar "${post.title}"? Esta acción no se puede deshacer.`)
    )
      return;
    setActionLoading('delete');
    try {
      await deleteAdminPost(token, post.id);
      router.push('/admin/blog');
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Error al eliminar');
      setActionLoading(null);
    }
  }

  if (!token) {
    return (
      <SesionNoDisponible />
    );
  }

  if (loadError) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        <AlertCircle className="h-4 w-4 shrink-0" />
        {loadError}
      </div>
    );
  }

  if (!post) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Cargando post…
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/admin/blog" className="shrink-0 text-sm text-muted-foreground hover:underline">
            ← Blog
          </Link>
          <h1 className="line-clamp-1 text-2xl font-bold">{post.title}</h1>
          <Badge variant={STATUS_VARIANTS[post.status] ?? 'outline'} className="shrink-0">
            {STATUS_LABELS[post.status] ?? post.status}
          </Badge>
        </div>

        {/* Status actions */}
        <div className="flex shrink-0 items-center gap-2">
          {post.status === 'PUBLISHED' && (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/blog/${post.slug}`} target="_blank">
                Ver en blog ↗
              </Link>
            </Button>
          )}
          {post.status === 'DRAFT' ? (
            <Button size="sm" onClick={handlePublish} disabled={!!actionLoading}>
              {actionLoading === 'publish' ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : null}
              Publicar
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={handleUnpublish} disabled={!!actionLoading}>
              {actionLoading === 'unpublish' ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : null}
              Despublicar
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={handleDelete}
            disabled={!!actionLoading}
          >
            {actionLoading === 'delete' ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : null}
            Eliminar
          </Button>
        </div>
      </div>

      {saveSuccess && (
        <div className="mb-4 rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-800">
          Cambios guardados correctamente.
        </div>
      )}

      <div className="max-w-3xl">
        <PostForm
          values={values}
          onChange={(patch) => setValues((v) => ({ ...v, ...patch }))}
          onSubmit={handleSave}
          submitLabel="Guardar cambios"
          isSubmitting={saving}
          submitError={saveError}
          token={token}
        />
      </div>
    </div>
  );
}
