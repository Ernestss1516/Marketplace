/**
 * La sección VÍDEO del editor: quién la ve y en qué estado.
 *
 * Se prueba aquí y no en el navegador porque los tres casos que importan —Pro, no-Pro y
 * feature apagada— dependen de datos que el servidor resuelve, y montar cada combinación
 * desde Playwright exigiría fabricar suscripciones y tocar ajustes por cada caso. El
 * componente y `resolveEditSections` aceptan el estado por props.
 *
 * LO QUE FIJA: que el GATE y el FLAG son cosas distintas. El gate Pro SE VE (candado y
 * «Hazte Pro»), porque esconder un beneficio a quien hay que convencer es la lección de
 * UXV.6. El flag apagado, en cambio, hace desaparecer la sección para todos.
 */
import { render, screen, cleanup } from '@testing-library/react';
import { resolveEditSections } from './EditarForm';
import { StepVideo } from './steps/StepVideo';
import type { VideoConfig } from '@/lib/api/video';
import type { ProStatus } from '@/lib/api/billing';

// Mismos mocks que `EditarForm.test.tsx`: importar el formulario arrastra next-auth, que
// jest no transforma.
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/mis-anuncios',
}));

jest.mock('next-auth/react', () => ({
  signOut: jest.fn(),
  useSession: () => ({ data: null }),
}));

jest.mock('@/lib/api/use-api-action', () => ({
  useApiAction: () => ({ run: jest.fn() }),
}));

const config: VideoConfig = {
  enabled: true,
  maxBytes: 50 * 1024 * 1024,
  maxDurationSeconds: 60,
  allowedMimeTypes: ['video/mp4'],
};

const pro: ProStatus = {
  isPro: true,
  limit: 4,
  used: 0,
  remaining: 4,
  bumpQuota: { limit: 5, used: 0, remaining: 5 },
};
const noPro: ProStatus = { ...pro, isPro: false };

const datosMinimos = { attributeSchema: [], availableTags: [] };

afterEach(cleanup);

describe('resolveEditSections — el FLAG decide si la sección existe', () => {
  it('con la feature encendida, la sección de vídeo está', () => {
    const ids = resolveEditSections(datosMinimos, pro, config).map((s) => s.id);
    expect(ids).toContain('video');
  });

  it('APAGADA no existe para nadie, ni para un Pro', () => {
    const ids = resolveEditSections(datosMinimos, pro, { enabled: false }).map((s) => s.id);
    expect(ids).not.toContain('video');
  });

  it('sin configuración (la API no respondió) tampoco: se falla hacia «no existe»', () => {
    // Enseñar una subida que luego no se podría completar sería peor que no ofrecerla.
    expect(resolveEditSections(datosMinimos, pro, null).map((s) => s.id)).not.toContain('video');
    expect(resolveEditSections(datosMinimos, pro).map((s) => s.id)).not.toContain('video');
  });

  it('para un NO-Pro la sección SÍ existe: el gate va dentro, no en la desaparición', () => {
    const ids = resolveEditSections(datosMinimos, noPro, config).map((s) => s.id);
    expect(ids).toContain('video');
  });

  it('REQUISITO DE ORO — las secciones de UXV.5 siguen todas ahí', () => {
    const ids = resolveEditSections(
      { attributeSchema: [{ name: 'x' }] as never, availableTags: [{ id: '1' }] as never },
      pro,
      config,
    ).map((s) => s.id);

    expect(ids).toEqual(['fotos', 'video', 'datos', 'atributos', 'tags', 'ubicacion']);
  });

  it('y las dos reglas de desaparición de UXV.5 no se han tocado', () => {
    const ids = resolveEditSections(datosMinimos, pro, config).map((s) => s.id);
    expect(ids).not.toContain('atributos');
    expect(ids).not.toContain('tags');
  });
});

describe('StepVideo — el gate Pro se VE', () => {
  const props = {
    listingId: 'l1',
    token: 't',
    config,
    video: { videoUrl: null, videoPosterUrl: null },
    onChange: jest.fn(),
  };

  it('un NO-Pro encuentra la sección, con su candado y su salida', () => {
    render(<StepVideo {...props} isPro={false} />);

    expect(screen.getByTestId('video-gate-pro')).toBeInTheDocument();
    // La salida importa tanto como el candado: sin ella el bloqueo es un callejón.
    expect(screen.getByRole('link', { name: /hazte pro/i })).toHaveAttribute('href', '/planes');
    // Y no se le ofrece subir nada.
    expect(screen.queryByTestId('video-elegir')).not.toBeInTheDocument();
  });

  it('un Pro sin vídeo ve el botón de subir', () => {
    render(<StepVideo {...props} isPro />);

    expect(screen.queryByTestId('video-gate-pro')).not.toBeInTheDocument();
    expect(screen.getByTestId('video-elegir')).toHaveTextContent(/subir un vídeo/i);
  });

  it('un Pro CON vídeo ve que ya lo tiene, y que subir otro lo SUSTITUYE', () => {
    render(
      <StepVideo
        {...props}
        isPro
        video={{ videoUrl: 'https://cdn/v.mp4', videoPosterUrl: 'https://cdn/p.jpg' }}
      />,
    );

    // Un vídeo por anuncio: el texto tiene que decirlo, o alguien esperará una galería.
    expect(screen.getByText(/sustituirá al actual/i)).toBeInTheDocument();
    expect(screen.getByTestId('video-elegir')).toHaveTextContent(/sustituir el vídeo/i);
    expect(screen.getByTestId('video-quitar')).toBeInTheDocument();
  });

  it('el selector de fichero solo admite lo que el servidor aceptaría', () => {
    render(<StepVideo {...props} isPro />);
    // Coherente con los límites que publica la API: ni se ofrece elegir lo que se va a
    // rechazar.
    expect(screen.getByTestId('video-input')).toHaveAttribute('accept', 'video/mp4');
  });
});
