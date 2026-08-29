'use client';

import { useState } from 'react';
import { Loader2, Mail } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import {
  updateEmailPreferences,
  type EmailCategory,
  type EmailPreferences,
} from '@/lib/api/usuarios';
import { useApiAction } from '@/lib/api/use-api-action';

/**
 * NOTIFICACIONES N5 — la válvula del correo, desde `/perfil`.
 *
 * ── SOLO SE LISTA LO QUE SE PUEDE APAGAR ───────────────────────────────────
 *
 * Las sanciones, el borrado de la cuenta, el cambio de rol, lo que el staff hace
 * con tus anuncios y el dinero **no aparecen aquí**, ni siquiera como interruptor
 * deshabilitado. No es un olvido: enseñar un interruptor apagado y bloqueado
 * invita a preguntar por qué no se puede tocar; no enseñarlo dice la verdad —
 * esos avisos no son opcionales. La nota de abajo lo explica en una frase.
 *
 * ── TODO ENCENDIDO POR DEFECTO ─────────────────────────────────────────────
 *
 * Opt-out: se recibe hasta que uno se da de baja, no al revés.
 */
const CATEGORIAS: { id: EmailCategory; titulo: string; descripcion: string }[] = [
  {
    id: 'MESSAGES',
    titulo: 'Mensajes',
    descripcion:
      'Cuando alguien te escribe y no lo has leído. Se agrupan por conversación y se envían con unos minutos de margen.',
  },
  {
    id: 'LISTINGS',
    titulo: 'Caducidad de tus anuncios',
    descripcion: 'Aviso unos días antes de que caduquen, y cuando caducan.',
  },
  {
    id: 'REVIEWS',
    titulo: 'Valoraciones',
    descripcion: 'Cuando alguien te valora, y cuando puedes valorar tras cerrar un trato.',
  },
  {
    id: 'ALERTS',
    titulo: 'Alertas guardadas',
    descripcion: 'Anuncios nuevos que coinciden con las búsquedas que has guardado.',
  },
];

export function PreferenciasCorreoPanel({
  token,
  inicial,
}: {
  token: string;
  inicial: EmailPreferences;
}) {
  const [prefs, setPrefs] = useState(inicial);
  const [guardando, setGuardando] = useState<EmailCategory | null>(null);
  const { run } = useApiAction();

  async function alternar(categoria: EmailCategory, valor: boolean) {
    // OPTIMISTA CON VUELTA ATRÁS: la casilla responde al instante, y si el guardado
    // falla se restaura el valor anterior. Sin la vuelta atrás, la pantalla diría
    // que estás dado de baja de algo que sigue llegando.
    const anterior = prefs;
    setPrefs({ ...prefs, [categoria]: valor });
    setGuardando(categoria);

    // `run` emite el toast y traga el error (UXV.3); devuelve `void`, así que el
    // resultado se recoge aquí dentro para poder confirmar con lo que diga el
    // servidor en vez de con lo que supusimos.
    let confirmado: EmailPreferences | null = null;
    await run(
      async () => {
        confirmado = await updateEmailPreferences(token, { [categoria]: valor });
      },
      {
        successMessage: valor
          ? 'Volverás a recibir estos correos.'
          : 'Ya no recibirás estos correos.',
      },
    );

    setPrefs(confirmado ?? anterior);
    setGuardando(null);
  }

  return (
    <section className="rounded-lg border p-6">
      <div className="mb-1 flex items-center gap-2">
        <Mail className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Correos que recibes</h2>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        Puedes desactivar los avisos que no te interesen. Seguirás viéndolos en la campana.
      </p>

      <ul className="space-y-4">
        {CATEGORIAS.map((cat) => (
          <li key={cat.id} className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">{cat.titulo}</p>
              <p className="text-xs text-muted-foreground">{cat.descripcion}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {guardando === cat.id && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
              <Checkbox
                checked={prefs[cat.id]}
                disabled={guardando !== null}
                onCheckedChange={(v) => void alternar(cat.id, v === true)}
                aria-label={`Correos de ${cat.titulo}`}
              />
            </div>
          </li>
        ))}
      </ul>

      {/*
        LA FRONTERA, DICHA. Sin esta nota, alguien que desactive todo esperaría no
        recibir NADA y un correo de sanción parecería un fallo. Con ella, el sistema
        promete lo que cumple.
      */}
      <p className="mt-6 border-t pt-4 text-xs text-muted-foreground">
        Hay avisos que no se pueden desactivar: las decisiones sobre tu cuenta (suspensión,
        baneo, cambio de permisos), lo que el equipo haga con tus anuncios, los movimientos de
        tu saldo y lo relacionado con tus facturas. Son cosas que necesitas saber.
      </p>
    </section>
  );
}
