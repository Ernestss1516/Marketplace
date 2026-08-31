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
// AJUSTES RÁFAGA A — el emisor fiscal se MUESTRA aquí y se edita en su página.
import { getFiscalIssuer, type FiscalIssuerResponse } from '@/lib/api/admin-facturas';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { PriceListEditor } from './_components/PriceListEditor';
// PUNTO 6 — el MISMO vocabulario que la ficha y los filtros. Tres pantallas nombrando los
// detectores por su cuenta es como acaban divergiendo (lo documenta el punto 4).
import { DETECTOR_LABELS } from '../etiquetas';
import { entradasQueEmpiezanAFiltrar, esTelefonoEs } from './entradas-inertes';
// AJUSTES RÁFAGA A — los títulos, las descripciones y los siete grupos viven en su propio
// módulo de datos, para que un test pueda comprobarlos sin montar esta página. Molde de
// `entradas-inertes.ts`.
import {
  GRUPOS,
  PERIODICIDAD_OPCIONES,
  SETTING_DESCRIPTIONS,
  SETTING_TITLES,
} from './ajustes-organizacion';

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
  /**
   * AJUSTES RÁFAGA A — UN `null` SE PINTA VACÍO, NO COMO EL MÍNIMO.
   *
   * Antes caía a `min`, y con las claves de siempre daba igual: todas llegan con un número
   * (su fila o el default que el backend añade). `defaultSuspensionDays` es la primera cuyo
   * «sin configurar» NO es un número, sino la suspensión INDEFINIDA — y pintar un «1» junto
   * al rótulo «Sin configurar» diría que hay un plazo de un día donde no hay ninguno. Es
   * exactamente la clase de mentira que esta ráfaga viene a quitar de esta página. Vacío es
   * lo que significa: no hay valor. Mismo criterio que `supportEmail`.
   */
  const [value, setValue] = useState(() =>
    setting.value === null || setting.value === undefined ? '' : String(setting.value),
  );
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

/**
 * AJUSTES RÁFAGA A — EL CONTROL QUE FALTABA: un ajuste de opciones cerradas.
 *
 * Hoy sólo lo usa `fiscalInvoicingPeriodicity`, y nace parametrizado porque el motivo por el
 * que existe es justo ése: su valor NO es texto libre. El `<select>` hace imposible por
 * construcción el error que la guarda del backend rechaza con un 400 —escribir «trimestral» y
 * que el cron lo lea como QUARTERLY en silencio—, y las dos capas hacen falta: el select es UX,
 * la guarda es la que de verdad protege (por la API se puede mandar cualquier cosa).
 *
 * `DetectionModesEditor` ya tenía un `<select>` incrustado, pero el suyo edita TRES valores
 * dentro de un objeto y trae su propia estadística al lado; no había nada que compartir sin
 * retorcer los dos.
 */
function SelectSettingEditor({
  setting,
  token,
  onSaved,
  settingKey,
  label,
  helpText,
  options,
}: {
  setting: AdminSetting;
  token: string;
  onSaved: () => void;
  settingKey: string;
  label: string;
  helpText: string;
  options: readonly { value: string; label: string }[];
}) {
  // El valor de la fila si es uno de los válidos; si no (una fila escrita a mano antes de que
  // existiera la guarda), el primero — que es el default de lectura del backend.
  const inicial =
    typeof setting.value === 'string' && options.some((o) => o.value === setting.value)
      ? setting.value
      : options[0].value;
  const [value, setValue] = useState<string>(inicial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await updateAdminSetting(token, settingKey, value);
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
        <select
          value={value}
          disabled={saving}
          onChange={(e) => {
            setValue(e.target.value);
            setSuccess(false);
          }}
          className="h-9 w-full max-w-xs rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          data-testid={`select-${settingKey}`}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
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


/**
 * AJUSTES RÁFAGA A — EL EMISOR FISCAL, DE SOLO LECTURA Y CON SU ENLACE.
 *
 * NO se edita aquí, y es una barrera, no una comodidad. Su endpoint valida el NIF, escribe su
 * propio registro de auditoría y sostiene la no-retroactividad (las facturas ya emitidas llevan
 * el emisor CONGELADO). Meterlo en el `upsert` genérico de ajustes rompería las tres cosas.
 *
 * Lo que sí hacía falta era que desde aquí se VEA si está configurado: sin `taxId` y razón
 * social no se puede emitir ninguna factura, y hoy eso es un fallo silencioso que nadie
 * descubre hasta que alguien pide una.
 */
function EmisorFiscalCard({ token }: { token: string }) {
  const [estado, setEstado] = useState<FiscalIssuerResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let vivo = true;
    getFiscalIssuer(token)
      .then((r) => vivo && setEstado(r))
      .catch(() => vivo && setError(true));
    return () => {
      vivo = false;
    };
  }, [token]);

  return (
    <div className="rounded-md border bg-background p-5">
      <div className="mb-1 flex items-start justify-between gap-4">
        <h3 className="text-base font-semibold">Datos fiscales del emisor</h3>
        <span className="shrink-0 text-xs text-muted-foreground">Solo lectura</span>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        El NIF y la razón social con los que se emiten las facturas. Se editan en su propia
        página porque allí se valida el NIF y queda registrado quién lo cambió; además, las
        facturas ya emitidas conservan congelados los datos con los que salieron, así que
        cambiarlos aquí nunca reescribe el pasado.
      </p>
      {error && (
        <p className="text-sm text-muted-foreground">No se ha podido consultar el estado del emisor.</p>
      )}
      {!error && estado === null && <p className="text-sm text-muted-foreground">Consultando…</p>}
      {estado?.configured && estado.issuer && (
        <p className="text-sm" data-testid="emisor-configurado">
          Configurado: <strong>{estado.issuer.fiscalName}</strong> ({estado.issuer.taxId})
        </p>
      )}
      {estado && !estado.configured && (
        <div
          className="rounded-md border border-amber-400 bg-amber-50 p-3 text-xs text-amber-900"
          data-testid="emisor-sin-configurar"
        >
          <strong>Sin configurar.</strong> Mientras falten el NIF y la razón social no se puede
          emitir ninguna factura — ni las que pida un usuario ni las del proceso automático.
        </div>
      )}
      <p className="mt-3 text-sm">
        <Link href="/admin/facturas/emisor" className="text-blue-700 hover:underline">
          Configurar el emisor fiscal →
        </Link>
      </p>
    </div>
  );
}

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

  /**
   * Una tarjeta de ajuste. LAS CLASES DEL CONTENEDOR Y EL TÍTULO NO SE TOCAN: las specs de
   * Playwright localizan cada ajuste por `div.rounded-md.border.bg-background.p-5` filtrado por
   * su encabezado, así que reorganizar la página no puede cambiar cómo se encuentra una tarjeta.
   * Los encabezados de grupo van FUERA de estos divs, por lo mismo.
   */
  function renderCard(key: string) {
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
          <h3 className="text-base font-semibold">{SETTING_TITLES[key] ?? key}</h3>
          <span className="shrink-0 text-xs text-muted-foreground">
            {updatedAt
              ? `Actualizado: ${formatDate(updatedAt)}`
              : 'Sin configurar — se usa el valor por defecto'}
          </span>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">{SETTING_DESCRIPTIONS[key]}</p>

        {renderEditor(key, setting)}
      </div>
    );
  }

  function renderEditor(key: string, setting: AdminSetting) {
    if (!token) return null;
    return (
      <>
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
                  helpText="Sólo se aplica a los anuncios que se publiquen, renueven o reactiven a partir de ahora: los que ya están vivos conservan su fecha de caducidad."
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
                  helpText="Al llegar al tope, publicar o reactivar otro se RECHAZA; no se despublica nada. Cuando caduca una suscripción Pro, este número decide cuántos anuncios conserva activos el ex-Pro."
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
                  helpText="Al llegar al tope, publicar o reactivar otro se RECHAZA; no se despublica nada. Debe ser mayor que el límite de Free."
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

              {/* ENCENDER EL VÍDEO — los cuatro que faltaban. El circuito del backend
                  (whitelist, GET/PATCH, el guard `assertEnabled`) ya estaba entero desde su
                  ráfaga: lo único que faltaba era esto, la interfaz para darle al
                  interruptor. Ver docs/auditoria-pro-video.md §2.0. */}
              {key === 'videoEnabled' && (
                <BooleanSettingEditor
                  setting={setting}
                  token={token}
                  onSaved={() => handleSaved(key)}
                  settingKey="videoEnabled"
                  label="Permitir vídeo en los anuncios de vendedores Pro"
                  helpText="Al encenderlo, la sección «Vídeo» aparece en el editor de anuncios: para un Pro, con el botón de subir; para el resto, con el candado y el enlace a los planes. Apagado, no existe para nadie y el servidor rechaza cualquier subida."
                />
              )}
              {key === 'attributeRevalidationEnabled' && (
                <BooleanSettingEditor
                  setting={setting}
                  token={token}
                  onSaved={() => handleSaved(key)}
                  settingKey="attributeRevalidationEnabled"
                  label="Marcar los anuncios que dejan de cumplir la configuración de su categoría"
                  helpText="Los anuncios marcados SIGUEN ACTIVOS y visibles: es un aviso para su dueño, no un estado del ciclo de vida."
                />
              )}
              {key === 'bumpAutoEnabled' && (
                <BooleanSettingEditor
                  setting={setting}
                  token={token}
                  onSaved={() => handleSaved(key)}
                  settingKey="bumpAutoEnabled"
                  label="Ejecutar las programaciones de bump automático"
                  helpText="Apagarlo detiene el cron al instante y no borra ninguna programación. Es el freno de mano de la única función que gasta saldo de los usuarios sin que estén delante."
                />
              )}
              {key === 'maxBumpSchedulesPerUser' && (
                <NumberSettingEditor
                  setting={setting}
                  token={token}
                  onSaved={() => handleSaved(key)}
                  settingKey="maxBumpSchedulesPerUser"
                  label="Programaciones activas por usuario"
                  helpText="Bajarlo no cancela las programaciones existentes: sólo impide crear más a quien ya esté en su tope."
                  min={1}
                />
              )}

              {/* AJUSTES RÁFAGA A — los cuatro costes en créditos. Antes se pintaban en un
                  bloque aparte con su propio mapa de títulos; ahora son tarjetas como las
                  demás dentro del grupo «Monetización», que además incluye los precios en
                  euros. La etiqueta del control sigue diciendo «Créditos». */}
              {(key === 'bumpCreditCost' ||
                key === 'featuredCreditCost7d' ||
                key === 'featuredCreditCost14d' ||
                key === 'featuredCreditCost30d') && (
                <NumberSettingEditor
                  setting={setting}
                  token={token}
                  onSaved={() => handleSaved(key)}
                  settingKey={key}
                  label="Créditos"
                  helpText="Debe ser un número entero de al menos 1 crédito."
                  min={1}
                />
              )}

              {/* ─── AJUSTES RÁFAGA A — los cuatro huérfanos ──────────────────────────
                  Los cuatro se leían ya en producción y no había forma de tocarlos que no
                  fuera un UPDATE a mano. Cada uno con el control que le corresponde. */}
              {key === 'messageEmailGraceMinutes' && (
                <NumberSettingEditor
                  setting={setting}
                  token={token}
                  onSaved={() => handleSaved(key)}
                  settingKey="messageEmailGraceMinutes"
                  label="Minutos de espera"
                  helpText="Si el destinatario abre la conversación antes de que pasen, el correo no llega a enviarse."
                  min={1}
                  suffix="minutos"
                />
              )}
              {key === 'defaultSuspensionDays' && (
                <NumberSettingEditor
                  setting={setting}
                  token={token}
                  onSaved={() => handleSaved(key)}
                  settingKey="defaultSuspensionDays"
                  label="Días de suspensión"
                  helpText="Mientras no se configure, «Suspender» sin duración deja la suspensión indefinida, como hasta ahora."
                  min={1}
                  suffix="días"
                />
              )}
              {key === 'fiscalSelfServiceWindow' && (
                <NumberSettingEditor
                  setting={setting}
                  token={token}
                  onSaved={() => handleSaved(key)}
                  settingKey="fiscalSelfServiceWindow"
                  label="Meses hacia atrás"
                  helpText="Se cuentan sobre la fecha de la operación. Fuera de la ventana, la factura se pide al soporte."
                  min={1}
                  suffix="meses"
                />
              )}
              {key === 'fiscalInvoicingPeriodicity' && (
                <SelectSettingEditor
                  setting={setting}
                  token={token}
                  onSaved={() => handleSaved(key)}
                  settingKey="fiscalInvoicingPeriodicity"
                  label="Cada cuánto se factura"
                  helpText="Sólo admite estas dos opciones: el backend rechaza cualquier otro valor, porque una periodicidad mal escrita se leería como trimestral sin avisar."
                  options={PERIODICIDAD_OPCIONES}
                />
              )}
      </>
    );
  }

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold">Ajustes</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Todo lo que se puede cambiar sin desplegar. Cada cambio queda registrado con quién lo
        hizo.
      </p>

      {/* EL ÍNDICE. Con 37 ajustes en la página, la lista plana obligaba a recorrerlos todos
          para encontrar uno; esto da el salto directo al grupo. */}
      <nav className="mb-8 flex flex-wrap gap-2" aria-label="Secciones de ajustes">
        {GRUPOS.map((g) => (
          <a
            key={g.id}
            href={`#${g.id}`}
            className="rounded-full border bg-background px-3 py-1 text-xs font-medium hover:bg-muted"
          >
            {g.titulo}
          </a>
        ))}
      </nav>

      <div className="space-y-12">
        {GRUPOS.map((grupo) => (
          <section key={grupo.id} id={grupo.id} className="scroll-mt-6">
            <h2 className="text-lg font-bold">{grupo.titulo}</h2>
            <p className="mb-4 mt-1 text-sm text-muted-foreground">{grupo.resumen}</p>

            <div className="space-y-6">
              {grupo.keys.map((key) => renderCard(key))}

              {/* Los precios en euros cierran Monetización: son la otra moneda de los mismos
                  productos y se leen junto a los costes en créditos, no en otra pantalla. */}
              {grupo.id === 'monetizacion' && (
                <div>
                  <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
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
              )}

              {/* El emisor fiscal: se VE aquí, se EDITA en su página. Ver EmisorFiscalCard. */}
              {grupo.id === 'facturacion' && <EmisorFiscalCard token={token} />}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
