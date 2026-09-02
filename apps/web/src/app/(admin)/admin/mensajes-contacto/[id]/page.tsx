'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ApiError } from '@/lib/api/client';
import {
  getAdminContactMessage,
  replyAdminContactMessage,
  updateAdminContactMessageEstado,
  type AdminContactMessageDetail,
  type ContactEstado,
} from '@/lib/api/admin-contact-messages';

// I18N T3-B — idéntico en la bandeja y en la ficha.
import { ESTADO_CONTACTO_LABELS as ESTADO_LABELS } from '@/lib/etiquetas-enums';

const ESTADO_VARIANTS: Record<ContactEstado, 'default' | 'secondary' | 'outline'> = {
  NUEVO: 'default',
  LEIDO: 'secondary',
  RESPONDIDO: 'outline',
  CERRADO: 'outline',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border">
      <div className="border-b bg-muted/50 px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function ReplyForm({
  token,
  messageId,
  senderEmail,
  onSuccess,
}: {
  token: string;
  messageId: string;
  senderEmail: string;
  onSuccess: (updated: AdminContactMessageDetail) => void;
}) {
  const [asunto, setAsunto] = useState('');
  const [cuerpo, setCuerpo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const updated = await replyAdminContactMessage(token, messageId, { asunto, cuerpo });
      onSuccess(updated);
      setAsunto('');
      setCuerpo('');
    } catch (err) {
      setFormError(
        err instanceof ApiError ? `Error ${err.statusCode}: ${err.message}` : 'Error al enviar la respuesta',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Se enviará por email a <span className="font-medium">{senderEmail}</span>.
      </p>
      <div>
        <Label htmlFor="reply-asunto">Asunto</Label>
        <Input
          id="reply-asunto"
          value={asunto}
          onChange={(e) => setAsunto(e.target.value)}
          maxLength={150}
          required
        />
      </div>
      <div>
        <Label htmlFor="reply-cuerpo">Mensaje</Label>
        <Textarea
          id="reply-cuerpo"
          value={cuerpo}
          onChange={(e) => setCuerpo(e.target.value)}
          rows={6}
          maxLength={5000}
          required
        />
      </div>
      {formError && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {formError}
        </div>
      )}
      <Button type="submit" disabled={submitting}>
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Enviar respuesta'}
      </Button>
    </form>
  );
}

export default function AdminContactMessageDetailPage() {
  const { data: session } = useSession();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [data, setData] = useState<AdminContactMessageDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [estadoBusy, setEstadoBusy] = useState(false);

  useEffect(() => {
    if (!token || !params?.id) return;
    setLoading(true);
    setError(null);
    getAdminContactMessage(token, params.id)
      .then(setData)
      .catch((err: unknown) => {
        setError(
          err instanceof ApiError && err.statusCode === 404
            ? 'Mensaje no encontrado.'
            : 'Error al cargar el mensaje',
        );
      })
      .finally(() => setLoading(false));
  }, [token, params?.id]);

  async function handleEstadoChange(estado: ContactEstado) {
    if (!token || !data) return;
    setEstadoBusy(true);
    try {
      const updated = await updateAdminContactMessageEstado(token, data.id, estado);
      setData((prev) => (prev ? { ...prev, estado: updated.estado } : prev));
    } catch {
      // Deja el estado visible sin cambios; el admin puede reintentar.
    } finally {
      setEstadoBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="rounded border border-yellow-300 bg-yellow-50 p-4 text-yellow-800">
        Sesión no disponible. Recarga la página o inicia sesión de nuevo.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Cargando...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        <AlertCircle className="h-4 w-4 shrink-0" />
        {error ?? 'Mensaje no encontrado'}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push('/admin/mensajes-contacto')}
          className="gap-1"
        >
          <ArrowLeft className="h-4 w-4" />
          Mensajes
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">{data.email}</h1>
          <p className="text-sm text-muted-foreground">
            {data.motivo.nombre} · {formatDate(data.createdAt)}
          </p>
        </div>
        <Badge variant={ESTADO_VARIANTS[data.estado]}>{ESTADO_LABELS[data.estado]}</Badge>
      </div>

      <Section title="Mensaje">
        <dl className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Email</dt>
            <dd className="font-medium">{data.email}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Teléfono</dt>
            <dd className="font-medium">{data.telefono ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Motivo</dt>
            <dd className="font-medium">{data.motivo.nombre}</dd>
          </div>
        </dl>
        {/* Texto plano — React lo escapa automáticamente. PROHIBIDO
            dangerouslySetInnerHTML aquí: el remitente no está autenticado
            (defensa XSS, RC.1). whitespace-pre-wrap preserva saltos de línea
            sin necesitar HTML. */}
        <p className="whitespace-pre-wrap rounded-md bg-muted/30 p-3 text-sm">{data.mensaje}</p>
      </Section>

      <Section title="Estado">
        <div className="flex items-center gap-2">
          <Select
            value={data.estado}
            onValueChange={(v) => handleEstadoChange(v as ContactEstado)}
            disabled={estadoBusy}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(ESTADO_LABELS) as ContactEstado[]).map((estado) => (
                <SelectItem key={estado} value={estado}>
                  {ESTADO_LABELS[estado]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {estadoBusy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
      </Section>

      {data.replies.length > 0 && (
        <Section title="Respuestas enviadas">
          <div className="space-y-4">
            {data.replies.map((reply) => (
              <div key={reply.id} className="rounded-md border p-3 text-sm">
                <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{reply.admin.name}</span>
                  <span>{formatDate(reply.sentAt)}</span>
                </div>
                <p className="mb-1 font-medium">{reply.asunto}</p>
                <p className="whitespace-pre-wrap text-muted-foreground">{reply.cuerpo}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Responder">
        <ReplyForm
          token={token}
          messageId={data.id}
          senderEmail={data.email}
          onSuccess={(updated) => setData(updated)}
        />
      </Section>
    </div>
  );
}
