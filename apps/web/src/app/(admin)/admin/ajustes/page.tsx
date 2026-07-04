'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { AlertCircle, Check, Loader2 } from 'lucide-react';
import { getAdminSettings, updateAdminSetting, type AdminSetting } from '@/lib/api/admin';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';

// ─── Helpers for badWordList ───────────────────────────────────────────────────

function toWordListText(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return (value as string[]).filter(Boolean).join('\n');
}

function fromWordListText(text: string): string[] {
  return text
    .split('\n')
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
}

// ─── Individual setting editors ───────────────────────────────────────────────

function BadWordListEditor({
  setting,
  token,
  onSaved,
}: {
  setting: AdminSetting;
  token: string;
  onSaved: () => void;
}) {
  const [text, setText] = useState(() => toWordListText(setting.value));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await updateAdminSetting(token, 'badWordList', fromWordListText(text));
      setSuccess(true);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  const wordCount = fromWordListText(text).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          Palabras prohibidas{' '}
          <span className="font-normal">— una por línea, en minúsculas</span>
        </label>
        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value); setSuccess(false); }}
          rows={8}
          className="resize-y rounded-md border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder={'spam\nprohibida\n...'}
          disabled={saving}
        />
        <p className="text-xs text-muted-foreground">
          {wordCount} {wordCount === 1 ? 'palabra' : 'palabras'} en la lista.
          {wordCount === 0 && ' Si la lista está vacía, no se filtrará ningún anuncio.'}
        </p>
      </div>
      <SaveRow saving={saving} success={success} error={error} onSave={handleSave} />
    </div>
  );
}

function NumberSettingEditor({
  setting,
  token,
  onSaved,
  settingKey,
  label,
  helpText,
  min = 1,
  max,
}: {
  setting: AdminSetting;
  token: string;
  onSaved: () => void;
  settingKey: string;
  label: string;
  helpText: string;
  min?: number;
  max?: number;
}) {
  const [value, setValue] = useState(() => String(setting.value ?? min));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSave() {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < min) {
      setError(`Debe ser un número entero ${min > 0 ? 'positivo' : `mayor o igual a ${min}`}.`);
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await updateAdminSetting(token, settingKey, num);
      setSuccess(true);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">{label}</label>
          <input
            type="number"
            value={value}
            onChange={(e) => { setValue(e.target.value); setSuccess(false); }}
            min={min}
            max={max}
            className="w-32 rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={saving}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{helpText}</p>
      <SaveRow saving={saving} success={success} error={error} onSave={handleSave} />
    </div>
  );
}

function ContactVerificationEditor({
  setting,
  token,
  onSaved,
}: {
  setting: AdminSetting;
  token: string;
  onSaved: () => void;
}) {
  const [checked, setChecked] = useState(() => Boolean(setting.value));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await updateAdminSetting(token, 'contactRequiresVerification', checked);
      setSuccess(true);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <label className="flex cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => { setChecked(e.target.checked); setSuccess(false); }}
          disabled={saving}
          className="h-4 w-4 rounded border-input"
        />
        <span className="text-sm">
          Requerir email verificado para contactar con el vendedor
        </span>
      </label>
      <p className="text-xs text-muted-foreground">
        Si está activado, los usuarios con email no verificado no podrán iniciar conversaciones.
      </p>
      <SaveRow saving={saving} success={success} error={error} onSave={handleSave} />
    </div>
  );
}

// ─── Shared save row ──────────────────────────────────────────────────────────

function SaveRow({
  saving,
  success,
  error,
  onSave,
}: {
  saving: boolean;
  success: boolean;
  error: string | null;
  onSave: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <Button size="sm" onClick={onSave} disabled={saving}>
        {saving ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
        Guardar
      </Button>
      {success && (
        <span className="flex items-center gap-1 text-xs text-green-700">
          <Check className="h-3 w-3" />
          Guardado
        </span>
      )}
      {error && (
        <span className="flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="h-3 w-3" />
          {error}
        </span>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const SETTING_TITLES: Record<string, string> = {
  badWordList: 'Lista de palabras prohibidas',
  listingExpiryDays: 'Caducidad de anuncios',
  contactRequiresVerification: 'Verificación para contacto',
  freeActiveListingLimit: 'Límite de anuncios activos (Free)',
  proActiveListingLimit: 'Límite de anuncios activos (Pro)',
  proMonthlyFeaturedQuota: 'Cuota mensual de destacados (Pro)',
};

const SETTING_DESCRIPTIONS: Record<string, string> = {
  badWordList:
    'Palabras que activan la revisión manual de un anuncio al publicarse. Si una palabra de esta lista aparece en el título o descripción, el anuncio pasa a estado "En revisión" en lugar de publicarse directamente.',
  listingExpiryDays:
    'Número de días desde la publicación hasta que un anuncio activo caduca automáticamente.',
  contactRequiresVerification:
    'Controla si los usuarios necesitan tener el email verificado para poder contactar con vendedores.',
  freeActiveListingLimit:
    'Número máximo de anuncios en estado ACTIVE que puede tener simultáneamente un usuario con plan Free.',
  proActiveListingLimit:
    'Número máximo de anuncios en estado ACTIVE que puede tener simultáneamente un usuario con plan Pro.',
  proMonthlyFeaturedQuota:
    'Destacados gratuitos que un usuario Pro puede usar cada mes. Se renuevan en el aniversario del ciclo de su suscripción; los no usados no se acumulan al mes siguiente.',
};

export default function AdminAjustesPage() {
  const { data: session } = useSession();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;

  const [settings, setSettings] = useState<AdminSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Track last updatedAt after each save to show the timestamp
  const [lastSaved, setLastSaved] = useState<Record<string, string>>({});

  async function fetchSettings() {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getAdminSettings(token);
      setSettings(data);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `Error ${err.statusCode}: ${err.message}`
          : 'Error al cargar ajustes',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function handleSaved(key: string) {
    setLastSaved((prev) => ({ ...prev, [key]: new Date().toISOString() }));
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
      <div>
        <h1 className="mb-6 text-2xl font-bold">Ajustes</h1>
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-md border bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-bold">Ajustes</h1>
        <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      </div>
    );
  }

  const settingsByKey = Object.fromEntries(settings.map((s) => [s.key, s]));

  // Canonical display order
  const ORDER = [
    'badWordList',
    'listingExpiryDays',
    'contactRequiresVerification',
    'freeActiveListingLimit',
    'proActiveListingLimit',
    'proMonthlyFeaturedQuota',
  ] as const;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Ajustes</h1>

      <div className="space-y-6">
        {ORDER.map((key) => {
          const setting = settingsByKey[key];
          if (!setting) return null;

          const updatedAt = lastSaved[key] ?? setting.updatedAt;

          return (
            <div key={key} className="rounded-md border bg-background p-5">
              <div className="mb-1 flex items-start justify-between gap-4">
                <h2 className="text-base font-semibold">{SETTING_TITLES[key] ?? key}</h2>
                <span className="shrink-0 text-xs text-muted-foreground">
                  Actualizado: {formatDate(updatedAt)}
                </span>
              </div>
              <p className="mb-4 text-sm text-muted-foreground">{SETTING_DESCRIPTIONS[key]}</p>

              {key === 'badWordList' && (
                <BadWordListEditor
                  setting={setting}
                  token={token}
                  onSaved={() => handleSaved(key)}
                />
              )}
              {key === 'listingExpiryDays' && (
                <NumberSettingEditor
                  setting={setting}
                  token={token}
                  onSaved={() => handleSaved(key)}
                  settingKey="listingExpiryDays"
                  label="Días hasta que caduca un anuncio"
                  helpText="Los anuncios en estado ACTIVE que superen este período sin renovarse pasarán a EXPIRED."
                  min={1}
                  max={365}
                />
              )}
              {key === 'contactRequiresVerification' && (
                <ContactVerificationEditor
                  setting={setting}
                  token={token}
                  onSaved={() => handleSaved(key)}
                />
              )}
              {key === 'freeActiveListingLimit' && (
                <NumberSettingEditor
                  setting={setting}
                  token={token}
                  onSaved={() => handleSaved(key)}
                  settingKey="freeActiveListingLimit"
                  label="Anuncios activos simultáneos (Free)"
                  helpText="Al superar este límite, los anuncios más antiguos pasan a borrador al publicar uno nuevo."
                  min={1}
                />
              )}
              {key === 'proActiveListingLimit' && (
                <NumberSettingEditor
                  setting={setting}
                  token={token}
                  onSaved={() => handleSaved(key)}
                  settingKey="proActiveListingLimit"
                  label="Anuncios activos simultáneos (Pro)"
                  helpText="Al superar este límite, los anuncios más antiguos pasan a borrador al publicar uno nuevo."
                  min={1}
                />
              )}
              {key === 'proMonthlyFeaturedQuota' && (
                <NumberSettingEditor
                  setting={setting}
                  token={token}
                  onSaved={() => handleSaved(key)}
                  settingKey="proMonthlyFeaturedQuota"
                  label="Destacados gratis por mes"
                  helpText="Cantidad de destacados que la cuota mensual de Pro concede gratis. No se acumulan de un mes a otro."
                  min={0}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
