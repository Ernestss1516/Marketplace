import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

// Único sitio del frontend que renderiza Markdown no confiable (posts de blog y
// páginas informativas comparten este componente). rehype-sanitize limpia
// atributos/elementos peligrosos; rehype-raw NO se incluye a propósito — HTML
// literal en el body se escapa como texto, nunca se ejecuta. No tocar esta regla
// sin revisar /blog/[slug], /paginas/[slug] y el preview de PostForm.
export function MarkdownBody({ body, className }: { body: string; className?: string }) {
  return (
    <div className={className ?? 'prose prose-neutral max-w-none dark:prose-invert'}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {body}
      </ReactMarkdown>
    </div>
  );
}
