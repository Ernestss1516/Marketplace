import { render, screen } from '@testing-library/react';
import { ReporteDiana } from './ReporteDiana';
import type { Report } from '@/lib/api/moderacion';

/**
 * CONTRA QUÉ VA UNA DENUNCIA — las siete ramas, incluidas las tres que sólo
 * ocurren cuando el objeto denunciado ya no existe.
 *
 * SE PRUEBA AQUÍ Y NO EN PLAYWRIGHT, y es una decisión de coste: montar los
 * escenarios «se borró la valoración» o «se eliminó la cuenta» de punta a punta
 * exige un Deal cerrado, un borrado y una anonimización — minutos de CI para
 * comprobar a dónde apunta un `href`. Aquí es instantáneo y además se pueden
 * cubrir LAS SIETE, que end-to-end no saldría a cuenta.
 *
 * Lo que sí vive en Playwright es la rama del anuncio borrado
 * (`admin-reportes-completitud.spec.ts`): ésa recorre el `SetNull` real y
 * confirma que el snapshot llega de verdad en el payload, no sólo que se pinta
 * si se lo damos.
 */

const BASE: Report = {
  id: 'rep1',
  reason: 'SPAM',
  description: null,
  status: 'PENDING',
  createdAt: '2026-01-01T10:00:00.000Z',
  reporter: null,
  reportedUser: null,
  listing: null,
  review: null,
  listingTitle: null,
  reportedUserName: null,
  reviewComment: null,
  reviewAuthorName: null,
  resolvedBy: null,
  resolvedAt: null,
};

describe('ReporteDiana — el objeto denunciado', () => {
  it('anuncio vivo: enlaza a su ficha del BACKOFFICE (no a la pública)', () => {
    render(
      <ReporteDiana
        reporte={{
          ...BASE,
          listing: { id: 'l1', title: 'Bici de carretera', slug: 'bici', status: 'ACTIVE' },
        }}
      />,
    );
    expect(screen.getByRole('link', { name: 'Bici de carretera' })).toHaveAttribute(
      'href',
      '/admin/anuncios/l1',
    );
  });

  it('anuncio BORRADO: sigue diciendo cuál era, y SIN enlace', () => {
    // La rama que pintaba un guion. El `SetNull` deja `listing` a null y el
    // snapshot es lo único que queda para nombrarlo.
    render(<ReporteDiana reporte={{ ...BASE, listingTitle: 'Bici de carretera' }} />);
    expect(screen.getByText('Bici de carretera')).toBeInTheDocument();
    expect(screen.getByTestId('reporte-diana-fantasma')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('usuario vivo: enlaza a su ficha de staff', () => {
    render(
      <ReporteDiana
        reporte={{ ...BASE, reportedUser: { id: 'u1', name: 'Ana', slug: 'ana' } }}
      />,
    );
    expect(screen.getByRole('link', { name: 'Ana' })).toHaveAttribute('href', '/admin/usuarios/u1');
  });

  it('cuenta ELIMINADA: manda el snapshot, no el nombre vaciado de la relación', () => {
    // Eliminar una cuenta NO borra la fila: la vacía, y `name` pasa a «Usuario
    // eliminado». Sin esta precedencia, todas las denuncias contra esa persona
    // dirían «denuncia contra Usuario eliminado» — sobrevivirían sin decir contra
    // quién, que es la mitad de lo que una denuncia es.
    render(
      <ReporteDiana
        reporte={{
          ...BASE,
          reportedUser: { id: 'u1', name: 'Usuario eliminado', slug: 'u1' },
          reportedUserName: 'Ana',
        }}
      />,
    );
    expect(screen.getByRole('link', { name: 'Ana' })).toHaveAttribute('href', '/admin/usuarios/u1');
    expect(screen.queryByText('Usuario eliminado')).not.toBeInTheDocument();
  });

  it('usuario sin fila: el snapshot, sin enlace', () => {
    render(<ReporteDiana reporte={{ ...BASE, reportedUserName: 'Ana' }} />);
    expect(screen.getByTestId('reporte-diana-fantasma')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('LA BARRERA: una valoración denunciada enlaza a su AUTOR y a su DESTINATARIO', () => {
    // Eran texto plano. Para juzgar si una reseña es falsa hay que poder abrir a
    // los dos, y desde la cola no se llegaba a ninguno.
    render(
      <ReporteDiana
        reporte={{
          ...BASE,
          review: {
            id: 'rv1',
            rating: 1,
            comment: 'Vendedor pésimo',
            retiredAt: null,
            author: { id: 'a1', name: 'Ana', slug: 'ana' },
            target: { id: 't1', name: 'Bruno', slug: 'bruno' },
          },
        }}
      />,
    );
    expect(screen.getByTestId('reporte-enlace-autor')).toHaveAttribute('href', '/admin/usuarios/a1');
    expect(screen.getByTestId('reporte-enlace-destinatario')).toHaveAttribute(
      'href',
      '/admin/usuarios/t1',
    );
    expect(screen.getByText('Vendedor pésimo')).toBeInTheDocument();
  });

  it('valoración BORRADA: quedan el comentario y el autor del snapshot, sin enlace', () => {
    render(
      <ReporteDiana
        reporte={{ ...BASE, reviewComment: 'Vendedor pésimo', reviewAuthorName: 'Ana' }}
      />,
    );
    expect(screen.getByTestId('reporte-diana-fantasma')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('sin relación y sin snapshot: el guion, que entonces sí es la verdad', () => {
    render(<ReporteDiana reporte={BASE} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
