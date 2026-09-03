'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createAdminPost } from '@/lib/api/blog-admin';
import { ApiError } from '@/lib/api/client';
import { PostForm, EMPTY_POST_FORM, type PostFormValues } from '../_components/PostForm';
import { SesionNoDisponible } from '@/app/(admin)/components/SesionNoDisponible';

function parseTags(raw: string): string[] {
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

export default function NuevoBlogPage() {
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
      const post = await createAdminPost(token, {
        title: values.title,
        slug: values.slug || undefined,
        excerpt: values.excerpt || undefined,
        blocks: values.blocks,
        coverUrl: values.coverUrl || undefined,
        tags: parseTags(values.tags),
        metaTitle: values.metaTitle || undefined,
        metaDescription: values.metaDescription || undefined,
      });
      router.push(`/admin/blog/${post.id}/editar`);
    } catch (err) {
      setSubmitError(
        err instanceof ApiError
          ? `Error ${err.statusCode}: ${err.message}`
          : 'Error inesperado al crear el post',
      );
      setIsSubmitting(false);
    }
  }

  if (!token) {
    return (
      <SesionNoDisponible />
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center gap-4">
        <Link href="/admin/blog" className="text-sm text-muted-foreground hover:underline">
          ← Blog
        </Link>
        <h1 className="text-2xl font-bold">Nuevo post</h1>
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
        />
      </div>
    </div>
  );
}
