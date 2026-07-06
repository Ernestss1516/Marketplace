'use client';

import dynamic from 'next/dynamic';
import type { ComponentProps } from 'react';
import type MarkdownEditor from './MarkdownEditor';

// dynamic(ssr:false) keeps @uiw/react-md-editor (DOM-dependent at module load, like
// maplibre-gl) out of any server-evaluated pass — same pattern as MapViewClient.tsx.
const MarkdownEditorDynamic = dynamic(() => import('./MarkdownEditor'), {
  ssr: false,
  loading: () => <div className="h-[360px] animate-pulse rounded-md border bg-muted" />,
});

export default function MarkdownEditorClient(props: ComponentProps<typeof MarkdownEditor>) {
  return <MarkdownEditorDynamic {...props} />;
}
