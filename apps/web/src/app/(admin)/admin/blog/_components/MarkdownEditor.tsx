'use client';

import { useCallback, useRef, useState } from 'react';
import MDEditor, { type ICommand, type TextAreaTextApi } from '@uiw/react-md-editor';
import '@uiw/react-md-editor/markdown-editor.css';
import { AlertCircle } from 'lucide-react';
import { uploadMedia } from '@/lib/api/media';
import { ApiError } from '@/lib/api/client';

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  token: string;
  disabled?: boolean;
}

// SECURITY — regla invariante del blog (ver /blog/[slug] y el preview de PostForm):
// el body se almacena y se renderiza en público como Markdown puro con
// react-markdown + remark-gfm + rehype-sanitize, SIN rehype-raw — HTML literal en
// el body se escapa como texto, nunca se ejecuta.
//
// El preview integrado de @uiw/react-md-editor (modos "live"/"preview", vía
// @uiw/react-markdown-preview) incluye rehype-raw de forma INCONDICIONAL en su
// pipeline interno — no hay ninguna prop pública para quitarlo, solo para añadir
// plugins después. Si se habilitara ese modo, cualquier <script> escrito en el
// editor se parsearía como HTML real en el propio preview del admin. Por eso este
// componente:
//   1. Fija preview="edit" SIEMPRE (nunca "live" ni "preview") — el pipeline de
//      @uiw/react-markdown-preview no llega a montarse en absoluto en ese modo.
//   2. Quita del toolbar los 3 comandos que cambian de modo en caliente (edit/live/
//      preview comparten keyCommand:'preview' en esta librería) — sin esto, el
//      propio usuario podría reactivar el modo peligroso con un clic o un atajo de
//      teclado, sin pasar por la prop `preview`.
// El preview renderizado real sigue siendo el toggle ya existente en PostForm.tsx,
// que usa nuestra propia instancia de react-markdown + remark-gfm + rehype-sanitize
// (la misma tubería que /blog/[slug]) — no esta librería.
export default function MarkdownEditor({ value, onChange, token, disabled }: MarkdownEditorProps) {
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Holds the text API captured when the "insert image" toolbar command fires —
  // the actual upload is async, so the markdown gets inserted once it resolves,
  // well after the synchronous command execute() has returned.
  const pendingApiRef = useRef<TextAreaTextApi | null>(null);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      const api = pendingApiRef.current;
      if (!file || !api) return;
      setUploadError(null);
      try {
        const { url } = await uploadMedia(file, token);
        api.replaceSelection(`![${file.name}](${url})`);
      } catch (err) {
        setUploadError(err instanceof ApiError ? err.message : 'Error al subir la imagen');
      } finally {
        if (fileRef.current) fileRef.current.value = '';
      }
    },
    [token],
  );

  const commandsFilter = useCallback((command: ICommand, isExtra: boolean): false | ICommand => {
    // Strip the edit/live/preview toggle (all three share keyCommand:'preview') —
    // see the module-level comment above for why "live"/"preview" must never mount.
    if (isExtra && command.keyCommand === 'preview') {
      return false;
    }
    // Reuse the built-in "image" button/icon/shortcut, but replace its behavior:
    // open a file picker and upload via the same POST /media/upload used for the
    // cover image, instead of inserting an empty ![]() placeholder.
    if (!isExtra && command.keyCommand === 'image') {
      return {
        ...command,
        execute: (_state, api) => {
          pendingApiRef.current = api;
          fileRef.current?.click();
        },
      };
    }
    return command;
  }, []);

  return (
    <div data-color-mode="light">
      <MDEditor
        value={value}
        onChange={(v) => onChange(v ?? '')}
        preview="edit"
        height={360}
        commandsFilter={commandsFilter}
        textareaProps={{ disabled, spellCheck: false, placeholder: '# Título\n\nEscribe en Markdown…' }}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />
      {uploadError && (
        <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="h-3 w-3" />
          {uploadError}
        </p>
      )}
    </div>
  );
}
