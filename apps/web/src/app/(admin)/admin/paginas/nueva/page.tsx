'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createAdminPost } from '@/lib/api/blog-admin';
import { ApiError } from '@/lib/api/client';
import { PostForm, EMPTY_POST_FORM, type PostFormValues } from '../../blog/_components/PostForm';

export default function NuevaPaginaPage() {
  const { data: session } = useSession();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;
  const router = useRouter();

  const [values, setValues] = useState<PostFormValues>(EMPTY_POST_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!token || isSubmitting || !values.title) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const page = await createAdminPost(token, {
        type: 'PAGE',
        title: values.title,
        slug: values.slug || undefined,
        excerpt: values.excerpt || undefined,
        body: values.body || undefined,
        coverUrl: values.coverUrl || undefined,
        metaTitle: values.metaTitle || undefined,
        metaDescription: values.metaDescription || undefined,
        showInFooter: values.showInFooter,
        footerOrder: values.footerOrder ? Number(values.footerOrder) : undefined,
      });
      router.push(`/admin/paginas/${page.id}/editar`);
    } catch (err) {
      setSubmitError(
        err instanceof ApiError
          ? `Error ${err.statusCode}: ${err.message}`
          : 'Error inesperado al crear la página',
      );
      setIsSubmitting(false);
    }
  }

  if (!token) {
    return (
      <div className="rounded border border-yellow-300 bg-yellow-50 p-4 text-yellow-800">
        Sesión no disponible. Recarga la página o inicia sesión de nuevo.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center gap-4">
        <Link href="/admin/paginas" className="text-sm text-muted-foreground hover:underline">
          ← Páginas
        </Link>
        <h1 className="text-2xl font-bold">Nueva página</h1>
      </div>

      <div className="max-w-3xl">
        <PostForm
          values={values}
          onChange={(patch) => setValues((v) => ({ ...v, ...patch }))}
          onSubmit={handleSubmit}
          submitLabel="Guardar borrador"
          isSubmitting={isSubmitting}
          submitError={submitError}
          token={token}
          showSlugHint
          showTagsField={false}
          showFooterControls
        />
      </div>
    </div>
  );
}
