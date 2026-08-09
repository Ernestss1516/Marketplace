import { isOwnStorageUrl, isSafeContentUrl, isAbsoluteHttpUrl } from './safe-url';

/**
 * La restricción de origen del almacenamiento propio.
 *
 * Cobra importancia con el vídeo Pro: un `<video src>` NO pasa por `remotePatterns` de
 * next/image —a diferencia de las imágenes—, así que esta función es la ÚNICA protección de
 * origen que tiene. Lo que antes era una capa de dos, aquí es la única.
 */
describe('isOwnStorageUrl — la restricción de origen', () => {
  const original = process.env.S3_PUBLIC_URL;
  afterAll(() => {
    process.env.S3_PUBLIC_URL = original;
  });

  describe('con un almacenamiento configurado', () => {
    beforeEach(() => {
      process.env.S3_PUBLIC_URL = 'https://cdn.ejemplo.com';
    });

    it('acepta lo que sale de nuestro propio almacenamiento', () => {
      expect(isOwnStorageUrl('https://cdn.ejemplo.com/listing-videos/abc/v.mp4')).toBe(true);
      expect(isOwnStorageUrl('https://cdn.ejemplo.com/uploads/foto.jpg')).toBe(true);
    });

    it('EXIGE FRONTERA: un dominio que solo EMPIEZA igual es ajeno', () => {
      // Este es el caso que un `startsWith` pelado dejaba pasar. Empieza por el prefijo
      // configurado y sin embargo es otro servidor, controlado por otra persona.
      expect(isOwnStorageUrl('https://cdn.ejemplo.com.atacante.net/v.mp4')).toBe(false);
      expect(isOwnStorageUrl('https://cdn.ejemplo.commalicioso/v.mp4')).toBe(false);
    });

    it('rechaza cualquier otro origen', () => {
      expect(isOwnStorageUrl('https://atacante.net/v.mp4')).toBe(false);
      expect(isOwnStorageUrl('http://cdn.ejemplo.com/v.mp4')).toBe(false); // otro protocolo
    });

    it('rechaza esquemas que no son http(s), que es el vector de un src sin validar', () => {
      expect(isOwnStorageUrl('javascript:alert(1)')).toBe(false);
      expect(isOwnStorageUrl('data:video/mp4;base64,AAAA')).toBe(false);
    });

    it('tolera la barra final del ajuste sin cambiar de criterio', () => {
      process.env.S3_PUBLIC_URL = 'https://cdn.ejemplo.com/';
      expect(isOwnStorageUrl('https://cdn.ejemplo.com/uploads/foto.jpg')).toBe(true);
      expect(isOwnStorageUrl('https://cdn.ejemplo.com.atacante.net/v.mp4')).toBe(false);
    });

    it('con bucket en la ruta, tampoco vale un bucket que empiece igual', () => {
      // MinIO en local sirve así: dominio + bucket en la ruta.
      process.env.S3_PUBLIC_URL = 'http://localhost:9000/marketplace';
      expect(isOwnStorageUrl('http://localhost:9000/marketplace/uploads/x.jpg')).toBe(true);
      expect(isOwnStorageUrl('http://localhost:9000/marketplace-ajeno/x.jpg')).toBe(false);
    });
  });

  it('sin almacenamiento configurado no acepta NADA: el fallo es cerrado', () => {
    delete process.env.S3_PUBLIC_URL;
    expect(isOwnStorageUrl('https://cdn.ejemplo.com/v.mp4')).toBe(false);
  });
});

/** Los otros dos validadores del fichero no cambian; se fijan para que sigan sin cambiar. */
describe('el resto del fichero sigue igual', () => {
  it('isSafeContentUrl admite relativas y http(s), y nada más', () => {
    expect(isSafeContentUrl('/anuncio/x')).toBe(true);
    expect(isSafeContentUrl('https://ejemplo.com')).toBe(true);
    expect(isSafeContentUrl('javascript:alert(1)')).toBe(false);
  });

  it('isAbsoluteHttpUrl rechaza las relativas', () => {
    expect(isAbsoluteHttpUrl('https://ejemplo.com')).toBe(true);
    expect(isAbsoluteHttpUrl('/anuncio/x')).toBe(false);
  });
});
