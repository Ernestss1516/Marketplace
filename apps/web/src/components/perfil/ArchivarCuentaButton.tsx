'use client';

import { useState } from 'react';
import { signOut } from 'next-auth/react';
import { Loader2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { archiveMyAccount } from '@/lib/api/usuarios';
import { useApiAction } from '@/lib/api/use-api-action';

/**
 * BORRADO DE CUENTAS C2 — el gesto del usuario: «cerrar mi cuenta».
 *
 * ES REVERSIBLE Y EL TEXTO LO DICE, porque mentir en cualquiera de las dos
 * direcciones tiene coste. Prometer «se borra todo» sería falso —archivar no
 * anonimiza nada, la fila queda intacta (D-1)— y quien lo lea creyendo que sus
 * datos desaparecen se llevará un chasco. Pero decir sólo «puedes recuperarla»
 * quitaría peso a algo que cierra la sesión, retira los anuncios y cancela el
 * Pro. Así que la confirmación enumera **lo que pasa**, y dice que para
 * recuperarla hay que escribir a soporte — que es la verdad: desarchivar es una
 * decisión del equipo, no un botón.
 *
 * `AlertDialog` antes y cierre de sesión después: es la regla de
 * `apps/web/CLAUDE.md` («acción irreversible ⇒ AlertDialog»), aplicada aquí
 * aunque esto sea reversible, porque el efecto inmediato —quedarse fuera— no lo
 * es para quien lo pulsa sin querer.
 */
export function ArchivarCuentaButton({ token }: { token: string }) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const { run } = useApiAction();

  const archivar = () => {
    setEnviando(true);
    void run(async () => archiveMyAccount(token, motivo.trim() || undefined), {
      onError: () => setEnviando(false),
      onSuccess: () => {
        // NO ES UN EXTRA: el backend acaba de invalidar el token
        // (`tokenVersion + 1`), así que la cookie de NextAuth apunta a una sesión
        // muerta. Sin este `signOut` el usuario se quedaría en una aplicación que
        // falla a cada clic en vez de salir por la puerta.
        void signOut({ callbackUrl: '/' });
      },
    });
  };

  return (
    <AlertDialog open={abierto} onOpenChange={setAbierto}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" className="text-destructive hover:text-destructive">
          Cerrar mi cuenta
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Cerrar tu cuenta?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">
              <p>Al cerrarla, y de inmediato:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Se cierra tu sesión y no podrás volver a entrar.</li>
                <li>Tus anuncios publicados se retiran del buscador.</li>
                <li>Si tienes una suscripción Pro, deja de renovarse.</li>
              </ul>
              <p>
                Tus conversaciones, valoraciones y facturas <strong>no se borran</strong>: la
                cuenta queda guardada, no destruida. Si cambias de opinión, escribe a soporte
                para recuperarla.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2">
          <Label htmlFor="motivo-cierre">Motivo (opcional)</Label>
          <Textarea
            id="motivo-cierre"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Si quieres, cuéntanos por qué te vas"
            maxLength={1000}
            rows={3}
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={enviando}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={enviando}
            onClick={(e) => {
              // El diálogo se cierra solo al pulsar; aquí se impide porque la
              // acción es asíncrona y el usuario tiene que ver que está pasando.
              e.preventDefault();
              archivar();
            }}
          >
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sí, cerrar mi cuenta'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
