'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { AlertCircle, Check, Loader2 } from 'lucide-react';
import {
  getAdminSettings,
  getDetectionStats,
  updateAdminSetting,
  type AdminSetting,
  type DetectionStat,
} from '@/lib/api/admin';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { PriceListEditor } from './_components/PriceListEditor';
// PUNTO 6 — el MISMO vocabulario que la ficha y los filtros. Tres pantallas nombrando los
// detectores por su cuenta es como acaban divergiendo (lo documenta el punto 4).
import { DETECTOR_LABELS } from '../etiquetas';
import { entradasQueEmpiezanAFiltrar, esTelefonoEs } from './entradas-inertes';

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

// ─── PUNTO 6 · RÁFAGA B — el ascenso de un detector ───────────────────────────

/**
 * EL ASCENSO: pasar un detector de AVISAR a BLOQUEAR.
 *
 * Lo que enseña al lado de cada interruptor es un RECUENTO EN BRUTO —en cuántos anuncios
 * está disparando ahora mismo— porque es el único dato honesto que hay.
 *
 * **NO es una tasa de acierto, y el texto lo dice con esas palabras.** Medir falsos
 * positivos exige que alguien juzgue cada hallazgo, y eso no existe todavía. Un porcentaje
 * aquí convencería más de lo que mide, que es lo peor que puede hacer un dato de moderación:
 * un admin que lee «97 % de acierto» asciende sin mirar; uno que lee «dispara en 340
 * anuncios» abre la lista y mira. El enlace al banco de pruebas está justo debajo por eso.
 */
function DetectionModesEditor({
  setting,
  token,
  onSaved,
}: {
  setting: AdminSetting;
  token: string;
  onSaved: () => void;
}) {
  const [stats, setStats] = useState<DetectionStat[] | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      setStats(await getDetectionStats(token));
    } catch {
      setStats(null);
    }
  }, [token]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const modos = (setting.value ?? {}) as Record<string, string>;

  async function cambiar(detector: string, modo: 'WARN' | 'BLOCK') {
    setSaving(detector);
    setError(null);
    try {
      // Se manda el objeto COMPLETO: `Setting.value` se guarda por reemplazo, así que
      // enviar una sola clave borraría el modo de los otros dos detectores.
      await updateAdminSetting(token, 'detectionModes', { ...modos, [detector]: modo });
      onSaved();
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se ha podido guardar');
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-3">
      {(stats ?? []).map((s) => (
        <div key={s.detector} className="rounded-md border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">{DETECTOR_LABELS[s.detector] ?? s.detector}</p>
              <p className="text-xs text-muted-foreground">
                {s.detections === 0
                  ? 'No ha encontrado nada todavía.'
                  : `Está disparando en ${s.listings} anuncio${s.listings === 1 ? '' : 's'} (${s.detections} hallazgo${s.detections === 1 ? '' : 's'}).`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={s.mode}
                disabled={saving === s.detector}
                onChange={(e) => void cambiar(s.detector, e.target.value as 'WARN' | 'BLOCK')}
                className="h-9 rounded-md border bg-background px-2 text-sm"
                aria-label={`Modo de ${DETECTOR_LABELS[s.detector] ?? s.detector}`}
                data-testid={`modo-${s.detector}`}
              >
                <option value="WARN">Avisar (no despublica)</option>
                <option value="BLOCK">Bloquear (manda a revisión)</option>
              </select>
              <Link
                href={`/admin/anuncios?detector=${s.detector}`}
                className="text-xs text-blue-700 hover:underline"
              >
                Ver cuáles
              </Link>
            </div>
          </div>
        </div>
      ))}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">
        Los números son <strong>recuentos de disparos</strong>, no una tasa de acierto: para
        saber cuántos son falsas alarmas hay que abrir la lista y mirarlos. En{' '}
        <strong>Avisar</strong> el anuncio no se toca y sólo queda marcado para el equipo; en{' '}
        <strong>Bloquear</strong> pasa a «En revisión» al publicarse <em>y también al
        editarse</em> — un anuncio ya publicado puede volver a la cola. El vendedor sale
        solo: en cuanto edita y quita lo que lo disparó, vuelve a publicarse.
      </p>
    </div>
  );
}

/**
 * A1 — LA LISTA DE IPs MARCADAS.
 *
 * Molde literal de `BadWordListEditor`: una por línea, texto plano, guardado entero. Se copia
 * la forma porque es la misma tarea —mantener una lista corta a mano— y un admin que ya sabe
 * usar una no tiene que aprender otra.
 *
 * LO QUE EL TEXTO TIENE QUE DEJAR CLARO, y por eso está: **esto no bloquea nada**. Marca. Una
 * lista llamada «bloqueadas» que sólo avisa es una promesa incumplida esperando a que alguien
 * la descubra el día que importe.
 */
function FlaggedIpsEditor({
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

  const entradas = fromWordListText(text);
  // Una entrada que no es una IPv4 válida no casará NUNCA: se marca, mismo criterio que las
  // entradas inertes de la lista de palabras (ráfaga C). Un octeto fuera de rango o un dedazo
  // se quedaría ahí para siempre pareciendo que vigila algo.
  const invalidas = entradas.filter(
    (e) =>
      !/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(e) ||
      e.split('.').some((o) => Number(o) > 255 || (o.length > 1 && o.startsWith('0'))),
  );

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await updateAdminSetting(token, 'flaggedIps', entradas);
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
      {invalidas.length > 0 && (
        <div
          className="rounded-md border border-amber-400 bg-amber-50 p-3 text-xs text-amber-900"
          data-testid="aviso-ips-invalidas"
        >
          <p className="font-medium">
            {invalidas.length === 1
              ? 'Esta entrada no es una dirección IPv4 y no marcará nunca:'
              : `Estas ${invalidas.length} entradas no son direcciones IPv4 y no marcarán nunca:`}
          </p>
          <ul className="mt-1 list-inside list-disc font-mono">
            {invalidas.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          IPs marcadas <span className="font-normal">— una por línea</span>
        </label>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setSuccess(false);
          }}
          rows={6}
          className="resize-y rounded-md border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder={'10.0.0.5\n203.0.113.9'}
          disabled={saving}
        />
        <p className="text-xs text-muted-foreground">
          {entradas.length} {entradas.length === 1 ? 'IP marcada' : 'IPs marcadas'}.{' '}
          <strong>Marcar una IP no bloquea nada:</strong> los anuncios y los usuarios que
          vengan de ella quedan señalados para el equipo, y nadie los despublica ni los
          suspende. Quitarla de aquí los des-señala al instante.
        </p>
      </div>
      <SaveRow saving={saving} success={success} error={error} onSave={handleSave} />
    </div>
  );
}

/**
 * A2 — LA LISTA DE TELÉFONOS MARCADOS.
 *
 * Molde de `FlaggedIpsEditor` y de `BadWordListEditor`: una por línea, guardado entero. Se
 * copia la forma porque es la misma tarea, y un admin que ya sabe usar una no aprende otra.
 *
 * MARCA LOS QUE NO CASARÁN NUNCA, molde de la ráfaga C: un número mal escrito se guarda
 * igual —y debe guardarse, para que quien lo escribió lo reconozca y lo corrija— pero **no
 * filtra nada**. Sin este aviso se quedaría ahí para siempre pareciendo que vigila algo, que
 * es exactamente el fail-open que la ráfaga C acaba de cerrar en la lista de palabras.
 */
function FlaggedPhonesEditor({
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

  const entradas = fromWordListText(text);
  const invalidas = entradas.filter((e) => !esTelefonoEs(e));

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await updateAdminSetting(token, 'flaggedPhones', entradas);
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
      {invalidas.length > 0 && (
        <div
          className="rounded-md border border-amber-400 bg-amber-50 p-3 text-xs text-amber-900"
          data-testid="aviso-telefonos-invalidos"
        >
          <p className="font-medium">
            {invalidas.length === 1
              ? 'Esta entrada no es un teléfono español y no marcará nunca:'
              : `Estas ${invalidas.length} entradas no son teléfonos españoles y no marcarán nunca:`}
          </p>
          <ul className="mt-1 list-inside list-disc font-mono">
            {invalidas.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          Teléfonos marcados{' '}
          <span className="font-normal">— uno por línea, en cualquier formato</span>
        </label>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setSuccess(false);
          }}
          rows={6}
          className="resize-y rounded-md border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder={'654 123 456\n+34 600 111 222'}
          disabled={saving}
        />
        <p className="text-xs text-muted-foreground">
          {entradas.length} {entradas.length === 1 ? 'teléfono marcado' : 'teléfonos marcados'}.
          Da igual cómo lo escribas: <strong>654 123 456</strong> encuentra al anuncio que lo
          puso como <strong>+34654123456</strong>. Se busca en el título, en la descripción{' '}
          <strong>y en el campo de teléfono del anuncio</strong> — un número marcado lo está
          esté donde esté. <strong>Hoy sólo marca:</strong> el anuncio no se despublica. Se
          puede cambiar a «Bloquear» más abajo.
        </p>
      </div>
      <SaveRow saving={saving} success={success} error={error} onSave={handleSave} />
    </div>
  );
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
  // PUNTO 6 · RÁFAGA C — las que hasta ahora NO FILTRABAN NADA y empiezan a hacerlo.
  const empiezanAFiltrar = entradasQueEmpiezanAFiltrar(fromWordListText(text));

  return (
    <div className="space-y-3">
      {/* EL AVISO QUE TIENE QUE LLEGAR ANTES QUE LA COLA DE MODERACIÓN.
          Estas entradas llevaban meses inertes —el emparejamiento viejo las partía y no
          casaban nunca— y esta misma pantalla se las guardó prometiendo que filtraban.
          Ahora funcionan. Y como el detector de palabras está en BLOQUEAR y desde la
          ráfaga B bloquear actúa TAMBIÉN AL EDITAR, una entrada olvidada puede sacar del
          escaparate un anuncio ya publicado en cuanto su dueño lo toque.
          Por eso se señalan una a una, en vez de dejar que el admin lo descubra por el
          efecto. Ver docs/diseno-listas-bloqueo.md §5.4. */}
      {empiezanAFiltrar.length > 0 && (
        <div
          className="rounded-md border border-amber-400 bg-amber-50 p-3 text-xs text-amber-900"
          data-testid="aviso-entradas-inertes"
        >
          <p className="font-medium">
            {empiezanAFiltrar.length === 1
              ? 'Esta entrada no filtraba nada y ahora sí:'
              : `Estas ${empiezanAFiltrar.length} entradas no filtraban nada y ahora sí:`}
          </p>
          <ul className="mt-1 list-inside list-disc font-mono">
            {empiezanAFiltrar.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
          <p className="mt-2">
            Llevan sin funcionar desde que se escribieron: el filtro sólo sabía comparar
            palabras sueltas, así que cualquier entrada con espacios o símbolos no casaba
            nunca. <strong>A partir de ahora sí casan.</strong> Como este filtro manda los
            anuncios a revisión —y también cuando su dueño los edita—, revísalas antes de
            seguir: corrige las que estén mal escritas y borra las que ya no quieras.
          </p>
        </div>
      )}
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
  suffix,
}: {
  setting: AdminSetting;
  token: string;
  onSaved: () => void;
  settingKey: string;
  label: string;
  helpText: string;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  const [value, setValue] = useState(() => String(setting.value ?? min));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSave() {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < min || (max != null && num > max)) {
      setError(
        max != null
          ? `Debe ser un número entero entre ${min} y ${max}.`
          : `Debe ser un número entero ${min > 0 ? 'positivo' : `mayor o igual a ${min}`}.`,
      );
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
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={value}
              onChange={(e) => { setValue(e.target.value); setSuccess(false); }}
              min={min}
              max={max}
              className="w-32 rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              disabled={saving}
            />
            {suffix && <span className="text-sm text-muted-foreground">{suffix}</span>}
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{helpText}</p>
      <SaveRow saving={saving} success={success} error={error} onSave={handleSave} />
    </div>
  );
}

/**
 * Editor de texto libre. Hoy solo lo usa `supportEmail`.
 *
 * OJO con la validación: el backend NO valida el formato de esta clave (no está en
 * POSITIVE_INT ni en PERCENT — acepta cualquier string). Así que el aviso de aquí es
 * UX, no una garantía: sirve para que nadie guarde "soporte@" por un dedazo, pero
 * quien se lo salte no recibe un 400. Se dice explícitamente para no dar por
 * enforced algo que no lo está.
 */
function TextSettingEditor({
  setting,
  token,
  onSaved,
  settingKey,
  label,
  helpText,
  placeholder,
  tipo = 'text',
}: {
  setting: AdminSetting;
  token: string;
  onSaved: () => void;
  settingKey: string;
  label: string;
  helpText: string;
  placeholder?: string;
  tipo?: 'text' | 'email';
}) {
  const [value, setValue] = useState(() =>
    typeof setting.value === 'string' ? setting.value : '',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSave() {
    const limpio = value.trim();
    // Vacío es un valor VÁLIDO: "sin buzón configurado" es un estado que el backend
    // entiende (registra un warning y omite solo el email).
    if (tipo === 'email' && limpio && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpio)) {
      setError('No parece una dirección de correo válida.');
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await updateAdminSetting(token, settingKey, limpio);
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
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">{label}</label>
        <input
          type={tipo}
          value={value}
          onChange={(e) => { setValue(e.target.value); setSuccess(false); }}
          placeholder={placeholder}
          className="w-full max-w-md rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          disabled={saving}
        />
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

/**
 * Interruptor genérico para un ajuste booleano.
 *
 * `ContactVerificationEditor` hace lo mismo pero con su clave y su texto
 * incrustados; no se refactoriza para no tocar un ajuste que ya funciona y que
 * tiene sus propias pruebas. Éste nace parametrizado porque va a haber más
 * interruptores: la puerta de validación estrena uno por regla nueva.
 */
function BooleanSettingEditor({
  setting,
  token,
  onSaved,
  settingKey,
  label,
  helpText,
}: {
  setting: AdminSetting;
  token: string;
  onSaved: () => void;
  settingKey: string;
  label: string;
  helpText: string;
}) {
  const [checked, setChecked] = useState(() => setting.value === true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await updateAdminSetting(token, settingKey, checked);
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
        <span className="text-sm">{label}</span>
      </label>
      <p className="text-xs text-muted-foreground">{helpText}</p>
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
  freeTotalListingLimit: 'Límite TOTAL de anuncios (Free)',
  proTotalListingLimit: 'Límite TOTAL de anuncios (Pro)',
  totalListingLimitEnabled: 'Aplicar el límite total de anuncios',
  emailVerifiedToPublishEnabled: 'Exigir correo verificado para publicar',
  maxPhotosPerListing: 'Máximo de fotos por anuncio',
  minPhotosPerListing: 'Mínimo de fotos para publicar',
  minPhotosRuleEnabled: 'Exigir el mínimo de fotos',
  preModerationAllListings: 'Revisar TODOS los anuncios antes de publicarlos',
  preModerationTrustedExempt: 'Los vendedores de confianza se saltan la revisión general',
  detectionModes: 'Qué hace cada detector de contenido',
  flaggedIps: 'IPs marcadas para vigilancia',
  flaggedPhones: 'Teléfonos marcados',
  proMonthlyFeaturedQuota: 'Cuota mensual de destacados (Pro)',
  proQuotaFeaturedDurationDays: 'Duración del destacado por cuota (Pro)',
  proExtraCreditsPercent: 'Bonus de créditos al comprar packs (Pro)',
  proMonthlyBumpQuota: 'Cuota mensual de bumps (Pro)',
  proExtraBumpsPercent: 'Bonus de bumps al comprar packs de bumps (Pro)',
  maxTagsPerListing: 'Máximo de tags por anuncio',
  supportEmail: 'Buzón de soporte',
  ticketAutoCloseWindowDays: 'Ventana de reapertura y cierre de tickets',
};

const SETTING_DESCRIPTIONS: Record<string, string> = {
  badWordList:
    'Palabras o frases que activan la revisión manual de un anuncio. Si alguna aparece en el título o la descripción, el anuncio pasa a "En revisión" en lugar de publicarse directamente — y desde ahora eso vale también cuando su dueño EDITA un anuncio ya publicado, que puede volver a la cola. Se casan palabras enteras: «estafa» no salta con «estafador». Se admiten frases con espacios y entradas con símbolos, y la puntuación no tiene que coincidir: «100%-garantizado» encuentra «100 % garantizado». Ojo: para IPs y teléfonos no hace falta escribir nada aquí — tienen sus propios detectores, más abajo.',
  listingExpiryDays:
    'Número de días desde la publicación hasta que un anuncio activo caduca automáticamente.',
  contactRequiresVerification:
    'Controla si los usuarios necesitan tener el email verificado para poder contactar con vendedores.',
  freeActiveListingLimit:
    'Número máximo de anuncios en estado ACTIVE que puede tener simultáneamente un usuario con plan Free.',
  proActiveListingLimit:
    'Número máximo de anuncios en estado ACTIVE que puede tener simultáneamente un usuario con plan Pro.',
  freeTotalListingLimit:
    'Cuántos anuncios puede TENER en total un usuario Free, estén publicados o no: cuenta borradores, en revisión, activos, reservados, pausados, caducados y rechazados. NO cuentan los archivados ni los vendidos, así que archivar o marcar como vendido libera hueco. Es distinto del límite de activos: aquel limita el escaparate y este la acumulación. Tiene que ser mayor que el de activos — el backend rechaza el cambio si no lo es.',
  proTotalListingLimit:
    'Lo mismo para un usuario Pro. Tiene que ser mayor que el límite de activos de Pro.',
  maxPhotosPerListing:
    'Cuántas fotos admite como máximo un anuncio. Antes era un número fijo en el código (15); ahora se puede cambiar sin desplegar. Bajarlo NO toca los anuncios ya publicados con más fotos: sólo impide guardar tantas a partir de ahora.',
  minPhotosPerListing:
    'Cuántas fotos hacen falta como mínimo para PUBLICAR. Sólo se aplica si el interruptor de abajo está encendido. No puede superar al máximo — el backend rechaza esa combinación, porque dejaría el sistema pidiendo algo imposible.',
  minPhotosRuleEnabled:
    'El asistente de publicación lleva desde siempre diciendo «se necesita al menos 1 foto» y deshabilitando su botón sin ellas, pero el servidor no lo exigía: por «Mis anuncios» o por la API se podía publicar un anuncio sin ninguna. Encender esto alinea el servidor con lo que la interfaz ya promete. Sólo afecta a PUBLICAR: crear y editar borradores sin fotos sigue permitido, y los anuncios ya publicados no se tocan (renovar y reactivar tampoco lo miran).',
  preModerationTrustedExempt:
    'Sólo tiene efecto con la revisión de plataforma encendida. Apagado (por defecto), «revisar todos» significa TODOS, incluidos los vendedores con la insignia de confianza. Encendido, esa insignia pasa a eximir de la revisión GENERAL — y ojo: hoy la insignia es puramente decorativa, así que al encender esto los vendedores marcados hace meses quedan exentos sin que nadie lo haya decidido para ellos. NUNCA exime de las marcas específicas: una categoría que exige revisión, o un vendedor marcado para revisión, se revisan igual.',
  preModerationAllListings:
    'MODERACIÓN PREVIA, nivel plataforma. Encendido, TODO anuncio nuevo queda «en revisión» al publicarse y no se ve en el marketplace hasta que un moderador lo apruebe. ⚠ Es el más exigente de los tres niveles: a partir del clic, cada anuncio espera a un humano, así que enciéndelo sólo si hay alguien vaciando la cola. Para acotarlo a una parte del catálogo, marca «requiere revisión» en una categoría: se aplica a ella y a TODOS sus descendientes. Los anuncios ya publicados no se tocan.',
  flaggedPhones:
    'Teléfonos bajo vigilancia. Cuando un anuncio contiene uno de estos números —en el título, en la descripción O en su campo de teléfono— el equipo lo ve señalado. Da igual el formato: «654 123 456» encuentra al que lo escribió como «+34654123456». ⚠ Hoy sólo MARCA, no despublica; se puede cambiar a «Bloquear» en el ajuste de detectores, más abajo. Ojo con la diferencia entre los dos avisos de teléfono: «Teléfono en el texto» salta con CUALQUIER número escrito fuera de su campo (es evasión, y se equivoca a menudo — cualquier referencia de nueve dígitos lo parece), mientras que éste salta sólo con los que hayas puesto aquí.',
  flaggedIps:
    'Direcciones IP bajo vigilancia. Cuando la ÚLTIMA conexión de un usuario, o la última gestión de un anuncio, viene de una de estas IPs, el equipo lo ve señalado en las fichas y puede filtrar por ello en las listas. ⚠ Marcar una IP NO bloquea a nadie: no despublica anuncios ni suspende cuentas, sólo señala para que alguien lo mire. Se decidió así por dos motivos: la IP que se anota puede estar falsificada mientras no se verifique la topología del proxy, y además se anota en CADA gestión del dueño (también al subir un anuncio, que no toca el contenido). Quitar una IP de la lista des-señala al instante todo lo que marcaba, sin dejar rastro que limpiar.',
  detectionModes:
    'El motor busca dos cosas en el título y la descripción de cada anuncio: palabras de la lista de arriba y teléfonos escritos en el texto (el detector de direcciones IP en el texto se retiró — las IPs se vigilan por su propia lista, más abajo, y sobre la última conexión en vez del texto). Aquí se decide qué pasa cuando encuentra algo. ⚠ Poner un detector en «Bloquear» tiene consecuencias para los vendedores: el anuncio pasa a «En revisión» al publicarse Y al editarse, así que uno ya publicado puede volver a la cola por una edición. Antes de ascender un detector, mira en cuántos anuncios está disparando y abre unos cuantos: los de IP y teléfono se equivocan (una IP es legítima en un anuncio de router, y cualquier referencia de nueve dígitos parece un teléfono). Ojo también con el teléfono: el anuncio TIENE un campo propio para publicarlo, que sólo se ve tras iniciar sesión — lo que este detector marca es que está escrito fuera de su sitio, no que publicarlo esté prohibido.',
  emailVerifiedToPublishEnabled:
    'Mientras esté apagado, un usuario con el correo sin verificar publica como siempre. Al encenderlo, NO se rechaza nada ni se pierde ningún anuncio: quien intente publicar sin haber verificado su correo se encuentra el anuncio guardado como BORRADOR y un aviso con el enlace para verificar. Crear y redactar siguen siendo libres — sólo se frena el paso al mercado, y en cuanto verifique podrá publicarlo. No afecta a los anuncios que ya están publicados.',
  totalListingLimitEnabled:
    'Mientras esté apagado, los dos límites totales de arriba NO se aplican: se pueden configurar y dejar preparados sin que nadie se vea frenado. Al encenderlo, un usuario que ya esté por encima de su tope NO pierde ningún anuncio; simplemente no podrá crear otro hasta bajar archivando o vendiendo. El freno actúa al CREAR, no al publicar.',
  proMonthlyFeaturedQuota:
    'Destacados gratuitos que un usuario Pro puede usar cada mes. Se renuevan en el aniversario del ciclo de su suscripción; los no usados no se acumulan al mes siguiente.',
  proQuotaFeaturedDurationDays:
    'Duración fija (en días) de un destacado pagado con la cuota gratuita de Pro. Al pagar con créditos, el usuario elige la duración (7/14/30 días); la cuota siempre usa esta duración fija.',
  proExtraCreditsPercent:
    'Porcentaje de créditos extra que recibe un usuario Pro al comprar un pack de créditos, sobre el mismo precio que paga cualquier usuario (no es un descuento en euros). Se congela en cada compra: cambiar este valor no afecta a compras ya realizadas.',
  proMonthlyBumpQuota:
    'Bumps gratuitos que un usuario Pro puede usar cada mes. Mismo periodo que la cuota de destacados (una sola suscripción por usuario); se renuevan en el aniversario del ciclo, los no usados no se acumulan. Se consumen ANTES que el saldo de bumps por cupón y que los créditos.',
  proExtraBumpsPercent:
    'Porcentaje de bumps extra que recibe un usuario Pro al comprar un pack de bumps, sobre el mismo precio que paga cualquier usuario. Setting independiente del bonus de créditos (proExtraCreditsPercent) — beneficios distintos, calibrables por separado. Se congela en cada compra: cambiar este valor no afecta a compras ya realizadas.',
  maxTagsPerListing:
    'Cuántas etiquetas puede llevar como máximo un anuncio. Los tags se configuran por categoría (catálogo en Tags, asignación en Categorías) y el usuario elige entre los que su categoría ofrece; este número es el tope de cuántos puede marcar. Subirlo no afecta a los anuncios ya publicados con menos.',
  supportEmail:
    'Dirección única a la que llegan los avisos por correo de los tickets de soporte. No es un reparto por administrador: es un buzón compartido. Si se deja vacío, el aviso in-app al staff se sigue creando y solo se omite el correo.',
  ticketAutoCloseWindowDays:
    'Días que un ticket resuelto admite reapertura por parte del usuario y, pasados los cuales, se cierra automáticamente. Es UN SOLO valor para las dos cosas a propósito: si divergieran habría un limbo entre "ya no puedo reabrir" y "aún no me han cerrado".',
};

// ─── Monetización: costes en créditos ──────────────────────────────────────────

const MONETIZATION_SETTING_KEYS = [
  'bumpCreditCost',
  'featuredCreditCost7d',
  'featuredCreditCost14d',
  'featuredCreditCost30d',
] as const;

const MONETIZATION_TITLES: Record<string, string> = {
  bumpCreditCost: 'Coste de subir un anuncio',
  featuredCreditCost7d: 'Coste del destacado — 7 días',
  featuredCreditCost14d: 'Coste del destacado — 14 días',
  featuredCreditCost30d: 'Coste del destacado — 30 días',
};

const MONETIZATION_DESCRIPTIONS: Record<string, string> = {
  bumpCreditCost:
    'Créditos que se descuentan al usuario cada vez que sube un anuncio a la parte superior del listado.',
  featuredCreditCost7d:
    'Créditos que cuesta destacar un anuncio durante 7 días, pagando con el saldo de créditos.',
  featuredCreditCost14d:
    'Créditos que cuesta destacar un anuncio durante 14 días, pagando con el saldo de créditos.',
  featuredCreditCost30d:
    'Créditos que cuesta destacar un anuncio durante 30 días, pagando con el saldo de créditos.',
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

  // Canonical display order. Las tres últimas se intercalan sin mover ninguna de
  // las que ya estaban: maxTagsPerListing junto a la otra config de anuncios, y el
  // par de tickets al final porque se leen juntas.
  const ORDER = [
    'badWordList',
    'listingExpiryDays',
    'maxTagsPerListing',
    'contactRequiresVerification',
    'freeActiveListingLimit',
    'proActiveListingLimit',
    // Puerta regla #1 — van JUSTO DEBAJO de los de activos: son su pareja, y hay
    // una invariante entre ellos (`total > activos`) que el backend comprueba en
    // las dos direcciones. Separarlos en la página invitaría a editar uno sin
    // mirar el otro.
    'freeTotalListingLimit',
    'proTotalListingLimit',
    'totalListingLimitEnabled',
    'emailVerifiedToPublishEnabled',
    'maxPhotosPerListing',
    'minPhotosPerListing',
    'minPhotosRuleEnabled',
    'preModerationAllListings',
    'preModerationTrustedExempt',
    // PUNTO 6 · RÁFAGA B — el ascenso, junto a la moderación previa: son la misma clase de
    // decisión (qué manda un anuncio a la cola) y se leen mejor una detrás de otra.
    'detectionModes',
    // A1 — junto a los detectores: es la otra mitad de «qué vigila la plataforma», sólo que
    // esta mira la última IP en vez del texto.
    'flaggedIps',
    // A2 — junto a la de IPs: son las dos listas de vigilancia, y se leen juntas.
    'flaggedPhones',
    'proMonthlyFeaturedQuota',
    'proQuotaFeaturedDurationDays',
    'proExtraCreditsPercent',
    'proMonthlyBumpQuota',
    'proExtraBumpsPercent',
    'supportEmail',
    'ticketAutoCloseWindowDays',
  ] as const;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Ajustes</h1>

      <div className="space-y-6">
        {ORDER.map((key) => {
          const setting = settingsByKey[key];
          // El backend devuelve TODA clave del whitelist: las que no tienen fila
          // llegan con su DEFAULT y `configured: false`. Este guard ya no oculta
          // esas —antes sí, y por eso tres ajustes eran invisibles—; solo salta una
          // clave que el backend no conozca, p. ej. si se quita del whitelist y se
          // olvida aquí.
          if (!setting) return null;

          const updatedAt = lastSaved[key] ?? setting.updatedAt;

          return (
            <div key={key} className="rounded-md border bg-background p-5">
              <div className="mb-1 flex items-start justify-between gap-4">
                <h2 className="text-base font-semibold">{SETTING_TITLES[key] ?? key}</h2>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {updatedAt
                    ? `Actualizado: ${formatDate(updatedAt)}`
                    : 'Sin configurar — se usa el valor por defecto'}
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
              {key === 'maxTagsPerListing' && (
                <NumberSettingEditor
                  setting={setting}
                  token={token}
                  onSaved={() => handleSaved(key)}
                  settingKey="maxTagsPerListing"
                  label="Tags como máximo por anuncio"
                  helpText="Debe ser al menos 1: un tope de 0 dejaría el sistema de tags muerto, y el backend lo rechaza."
                  min={1}
                  suffix="tags"
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
              {key === 'freeTotalListingLimit' && (
                <NumberSettingEditor
                  setting={setting}
                  token={token}
                  onSaved={() => handleSaved(key)}
                  settingKey="freeTotalListingLimit"
                  label="Anuncios en total (Free)"
                  helpText="Cuenta todo menos archivados y vendidos. Debe ser mayor que el límite de activos de Free."
                  min={1}
                />
              )}
              {key === 'proTotalListingLimit' && (
                <NumberSettingEditor
                  setting={setting}
                  token={token}
                  onSaved={() => handleSaved(key)}
                  settingKey="proTotalListingLimit"
                  label="Anuncios en total (Pro)"
                  helpText="Cuenta todo menos archivados y vendidos. Debe ser mayor que el límite de activos de Pro."
                  min={1}
                />
              )}
              {key === 'totalListingLimitEnabled' && (
                <BooleanSettingEditor
                  setting={setting}
                  token={token}
                  onSaved={() => handleSaved(key)}
                  settingKey="totalListingLimitEnabled"
                  label="Aplicar el límite total al crear un anuncio"
                  helpText="Apagado, los topes de arriba no frenan a nadie. Encenderlo no expulsa ni oculta nada: sólo impide crear anuncios nuevos a quien esté en su tope."
                />
              )}
              {key === 'maxPhotosPerListing' && (
                <NumberSettingEditor
                  setting={setting}
                  token={token}
                  onSaved={() => handleSaved(key)}
                  settingKey="maxPhotosPerListing"
                  label="Fotos como máximo por anuncio"
                  helpText="Bajarlo no quita fotos a los anuncios que ya las tienen."
                  min={1}
                  suffix="fotos"
                />
              )}
              {key === 'minPhotosPerListing' && (
                <NumberSettingEditor
                  setting={setting}
                  token={token}
                  onSaved={() => handleSaved(key)}
                  settingKey="minPhotosPerListing"
                  label="Fotos como mínimo para publicar"
                  helpText="Sólo se aplica con el interruptor de abajo encendido. No puede superar al máximo."
                  min={1}
                  suffix="fotos"
                />
              )}
              {key === 'minPhotosRuleEnabled' && (
                <BooleanSettingEditor
                  setting={setting}
                  token={token}
                  onSaved={() => handleSaved(key)}
                  settingKey="minPhotosRuleEnabled"
                  label="Exigir el mínimo de fotos al publicar"
                  helpText="Apagado, el mínimo es sólo una recomendación de la interfaz. Encendido, el servidor lo exige de verdad — pero sólo al publicar."
                />
              )}
              {key === 'preModerationTrustedExempt' && (
                <BooleanSettingEditor
                  setting={setting}
                  token={token}
                  onSaved={() => handleSaved(key)}
                  settingKey="preModerationTrustedExempt"
                  label="La insignia de confianza exime de la revisión general"
                  helpText="Sólo afecta a la revisión de plataforma. Nunca exime de una categoría marcada ni de un vendedor marcado."
                />
              )}
              {key === 'preModerationAllListings' && (
                <BooleanSettingEditor
                  setting={setting}
                  token={token}
                  onSaved={() => handleSaved(key)}
                  settingKey="preModerationAllListings"
                  label="Revisar todos los anuncios antes de publicarlos"
                  helpText="Encendido, cada anuncio nuevo espera a que un moderador lo apruebe. Para acotarlo a una rama del catálogo, marca la categoría en Categorías (la marca alcanza a todas sus subcategorías)."
                />
              )}
              {key === 'flaggedPhones' && (
                <FlaggedPhonesEditor
                  setting={setting}
                  token={token}
                  onSaved={() => handleSaved(key)}
                />
              )}
              {key === 'flaggedIps' && (
                <FlaggedIpsEditor
                  setting={setting}
                  token={token}
                  onSaved={() => handleSaved(key)}
                />
              )}
              {key === 'detectionModes' && (
                <DetectionModesEditor
                  setting={setting}
                  token={token}
                  onSaved={() => handleSaved(key)}
                />
              )}
              {key === 'emailVerifiedToPublishEnabled' && (
                <BooleanSettingEditor
                  setting={setting}
                  token={token}
                  onSaved={() => handleSaved(key)}
                  settingKey="emailVerifiedToPublishEnabled"
                  label="Exigir el correo verificado para publicar"
                  helpText="No rechaza: el anuncio se queda en borrador con un aviso y su enlace para verificar. Crear y redactar siguen libres."
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
                  min={1}
                />
              )}
              {key === 'proQuotaFeaturedDurationDays' && (
                <NumberSettingEditor
                  setting={setting}
                  token={token}
                  onSaved={() => handleSaved(key)}
                  settingKey="proQuotaFeaturedDurationDays"
                  label="Duración fija del destacado por cuota (días)"
                  helpText="Todos los destacados pagados con la cuota gratuita de Pro usan esta duración fija, sin importar qué variante hubiera elegido el usuario."
                  min={1}
                  max={365}
                />
              )}
              {key === 'proExtraCreditsPercent' && (
                <NumberSettingEditor
                  setting={setting}
                  token={token}
                  onSaved={() => handleSaved(key)}
                  settingKey="proExtraCreditsPercent"
                  label="Bonus de créditos (%)"
                  helpText="Porcentaje extra de créditos que un Pro recibe al comprar un pack, sobre el mismo precio que paga cualquier usuario. 0 desactiva el bonus sin quitar la ventaja de la lista."
                  min={0}
                  max={100}
                  suffix="%"
                />
              )}
              {key === 'proMonthlyBumpQuota' && (
                <NumberSettingEditor
                  setting={setting}
                  token={token}
                  onSaved={() => handleSaved(key)}
                  settingKey="proMonthlyBumpQuota"
                  label="Bumps gratis por mes"
                  helpText="Cantidad de bumps que la cuota mensual de Pro concede gratis, antes que el saldo de bumps por cupón y que los créditos. No se acumulan de un mes a otro."
                  min={1}
                />
              )}
              {key === 'proExtraBumpsPercent' && (
                <NumberSettingEditor
                  setting={setting}
                  token={token}
                  onSaved={() => handleSaved(key)}
                  settingKey="proExtraBumpsPercent"
                  label="Bonus de bumps (%)"
                  helpText="Porcentaje extra de bumps que un Pro recibe al comprar un pack de bumps, sobre el mismo precio que paga cualquier usuario. 0 desactiva el bonus sin quitar la ventaja de la lista."
                  min={0}
                  max={100}
                  suffix="%"
                />
              )}
              {key === 'supportEmail' && (
                <TextSettingEditor
                  setting={setting}
                  token={token}
                  onSaved={() => handleSaved(key)}
                  settingKey="supportEmail"
                  label="Dirección del buzón"
                  helpText="Déjalo vacío para no enviar correos: el aviso in-app al staff se crea igual y solo se omite el email."
                  placeholder="soporte@tudominio.com"
                  tipo="email"
                />
              )}
              {key === 'ticketAutoCloseWindowDays' && (
                <NumberSettingEditor
                  setting={setting}
                  token={token}
                  onSaved={() => handleSaved(key)}
                  settingKey="ticketAutoCloseWindowDays"
                  label="Días de ventana"
                  helpText="Debe ser al menos 1: una ventana de 0 cerraría al instante todo lo que se resuelva."
                  min={1}
                  suffix="días"
                />
              )}
            </div>
          );
        })}
      </div>

      <h2 className="mb-4 mt-10 text-lg font-bold">Monetización</h2>

      <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
        Costes en créditos
      </h3>
      <div className="space-y-6">
        {MONETIZATION_SETTING_KEYS.map((key) => {
          const setting = settingsByKey[key];
          if (!setting) return null;

          const updatedAt = lastSaved[key] ?? setting.updatedAt;

          return (
            <div key={key} className="rounded-md border bg-background p-5">
              <div className="mb-1 flex items-start justify-between gap-4">
                <h4 className="text-base font-semibold">{MONETIZATION_TITLES[key]}</h4>
                <span className="shrink-0 text-xs text-muted-foreground">
                  Actualizado: {formatDate(updatedAt)}
                </span>
              </div>
              <p className="mb-4 text-sm text-muted-foreground">
                {MONETIZATION_DESCRIPTIONS[key]}
              </p>
              <NumberSettingEditor
                setting={setting}
                token={token}
                onSaved={() => handleSaved(key)}
                settingKey={key}
                label="Créditos"
                helpText="Debe ser un número entero de al menos 1 crédito."
                min={1}
              />
            </div>
          );
        })}
      </div>

      <h3 className="mb-3 mt-6 text-sm font-semibold text-muted-foreground">
        Precios (Redsys)
      </h3>
      <PriceListEditor
        token={token}
        creditCosts={{
          7: settingsByKey.featuredCreditCost7d?.value as number | undefined,
          14: settingsByKey.featuredCreditCost14d?.value as number | undefined,
          30: settingsByKey.featuredCreditCost30d?.value as number | undefined,
        }}
      />
    </div>
  );
}
