'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { ListingAction } from './use-listing-actions';

/**
 * UXV.4 (A6) — el desbordamiento «⋯» donde viven las acciones poco frecuentes y las
 * DESTRUCTIVAS.
 *
 * Sacar Archivar y Eliminar de la fila es la mitad del arreglo de A6: estaban ahí, con el
 * mismo aspecto que Editar, a un clic de distancia y sin más protección que su diálogo.
 * Siguen teniéndolo —esto no relaja ninguna confirmación—, pero dejan de competir por la
 * mirada con lo que el vendedor hace todos los días.
 *
 * El `AlertDialog` se monta FUERA del menú y se controla por estado: un diálogo declarado
 * dentro de un `DropdownMenuItem` se desmonta con el propio menú al seleccionarlo, y la
 * confirmación no llegaría a verse nunca.
 */

interface Props {
  actions: ListingAction[];
  /** El llamador abre su propio diálogo (cerrar trato) cuando la acción lo pide. */
  onDialog: (dialog: NonNullable<ListingAction['dialog']>) => void;
  disabled?: boolean;
  /** Etiqueta accesible: hay una por tarjeta, así que conviene distinguirlas. */
  label?: string;
}

export function OwnerActionsMenu({ actions, onDialog, disabled, label }: Props) {
  const [pendiente, setPendiente] = useState<ListingAction | null>(null);

  if (actions.length === 0) return null;

  const normales = actions.filter((a) => !a.destructive);
  const destructivas = actions.filter((a) => a.destructive);

  function seleccionar(action: ListingAction) {
    if (action.destructive) {
      // Se aplaza: el menú se está cerrando y el diálogo tiene que sobrevivirle.
      setPendiente(action);
      return;
    }
    if (action.dialog) {
      onDialog(action.dialog);
      return;
    }
    action.run?.();
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="px-2"
            disabled={disabled}
            aria-label={label ?? 'Más acciones'}
            data-testid="btn-mas-acciones"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {normales.map((action) => {
            const Icon = action.icon;
            return action.href ? (
              <DropdownMenuItem key={action.key} asChild>
                <Link href={action.href} prefetch={false}>
                  <Icon className="mr-2 h-4 w-4" aria-hidden />
                  {action.label}
                </Link>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem key={action.key} onSelect={() => seleccionar(action)}>
                <Icon className="mr-2 h-4 w-4" aria-hidden />
                {action.label}
              </DropdownMenuItem>
            );
          })}

          {destructivas.length > 0 && normales.length > 0 && <DropdownMenuSeparator />}

          {destructivas.map((action) => {
            const Icon = action.icon;
            return (
              <DropdownMenuItem
                key={action.key}
                onSelect={() => seleccionar(action)}
                className="text-destructive focus:text-destructive"
              >
                <Icon className="mr-2 h-4 w-4" aria-hidden />
                {action.label}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={pendiente !== null} onOpenChange={(o) => !o && setPendiente(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendiente?.confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>{pendiente?.confirm?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className={
                // BORRADO B2 — la clave era 'delete'; el borrado del dueño ya no
                // existe y en su lugar está 'discard' (descartar un borrador).
                pendiente?.key === 'discard'
                  ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                  : undefined
              }
              onClick={() => {
                pendiente?.run?.();
                setPendiente(null);
              }}
            >
              {pendiente?.confirm?.cta}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
