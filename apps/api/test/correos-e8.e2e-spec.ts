import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { NotificationProcessor } from 'src/infra/queue/processors/notification.processor';
import { NOTIFICATION_JOB } from 'src/infra/queue/notification.types';
import { categoriaDe } from 'src/infra/queue/email-categories';
import { BrandingService } from 'src/modules/branding/branding.service';
import { EstiloService } from 'src/modules/estilo/estilo.service';
import {
  ESTILO_ZONES,
  MODELO_POR_DEFECTO,
  resolverTokens,
} from 'src/modules/estilo/estilo.constants';

/**
 * E8 — LOS CORREOS TEMADOS, SOBRE LOS DIECIOCHO ENVÍOS REALES.
 *
 * ── POR QUÉ ESTE FICHERO EXISTE APARTE DE `correo.spec.ts` ──────────────────────────
 *
 * Aquel demuestra que **el serializador no tiene grietas**. Éste demuestra que **no hay
 * ningún envío que se lo salte** — que es la otra mitad, y la que de verdad sostiene la
 * invariante trasladada del §7: «el HTML se compone en un solo sitio y todo dato entra
 * escapado, siempre».
 *
 * Por eso se ejercita el PROCESSOR entero, con Resend interceptado, y por eso la tabla de
 * casos se compara contra `NOTIFICATION_JOB`: **un correo nuevo sin caso aquí pone el CI
 * en rojo**. El §7.5 lo pedía explícitamente —«se ejecuta sobre los 18, no sobre una
 * muestra»— y sin esa comparación la tabla envejecería en silencio, que es exactamente
 * cómo mueren las baterías exhaustivas.
 *
 * Molde de `preferencias-email.e2e-spec.ts`: mismo interceptado de `resend.emails.send`,
 * misma forma de disparar un trabajo como lo haría BullMQ.
 */

/** La carga: cada carácter que rompe el HTML, más una etiqueta y un atributo enteros. */
const VENENO = `<script>alert(1)</script> & "comillas" 'simples' <img src=x onerror=alert(2)>`;

/** Las únicas etiquetas que el serializador tiene permiso para emitir. */
const ETIQUETAS_PERMITIDAS = new Set([
  '!doctype', 'html', 'head', 'meta', 'title', 'body', 'table', 'tr', 'td', 'div', 'a',
  'img', 'br',
]);

function etiquetasDe(documento: string): string[] {
  return [...documento.matchAll(/<\/?([a-zA-Z!][a-zA-Z0-9-]*)/g)].map((m) => m[1].toLowerCase());
}

describe('Correos E8 — HTML temado, contenido de usuario imposible de inyectar (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let processor: NotificationProcessor;
  let enviados: { to: string; subject: string; text: string; html?: string }[];

  let usuario: { id: string; email: string };

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    processor = app.get(NotificationProcessor);

    enviados = [];
    const resend = (processor as unknown as { resend: { emails: { send: unknown } } }).resend;
    jest
      .spyOn(resend.emails as { send: (...a: unknown[]) => unknown }, 'send')
      .mockImplementation((async (m: (typeof enviados)[number]) => {
        enviados.push(m);
        return {};
      }) as never);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanDb(prisma);
    enviados = [];
    const id = randomUUID().slice(0, 8);
    const u = await prisma.user.create({
      data: { email: `e8-${id}@test.local`, name: `E8 ${id}`, slug: `e8-${id}` },
    });
    usuario = { id: u.id, email: u.email };
  });

  const disparar = (name: string, data: Record<string, unknown>) =>
    processor.process({ name, data } as never);

  // ───────────────────────────────────────────────────────────────────────────────────
  // LA TABLA DE LOS DIECIOCHO
  // ───────────────────────────────────────────────────────────────────────────────────
  //
  // El veneno va en TODOS los campos de texto que escribe una persona —nombre, asunto,
  // extracto, título, motivo, cuerpo— porque el §7.5 pide «en cada campo de usuario de
  // los 18». Los identificadores y los enumerados no lo llevan: no llegan al correo como
  // texto, y ensuciarlos sólo probaría que una URL admite basura.
  //
  // Los tres envíos con varias acciones (moderación de anuncio, de cuenta y ciclo de
  // vida) llevan un caso por acción: cada una tiene su copy, y una copy sin caso es una
  // rama sin comprobar.

  const conNombre = () => ({ email: '', name: VENENO });

  interface Caso {
    job: string;
    etiqueta: string;
    data: () => Record<string, unknown>;
  }

  const CASOS: Caso[] = [
    {
      job: NOTIFICATION_JOB.SEND_VERIFICATION_EMAIL,
      etiqueta: 'verificación de email',
      data: () => ({ ...conNombre(), email: usuario.email, userId: usuario.id, token: 't0k' }),
    },
    {
      job: NOTIFICATION_JOB.SEND_RESET_EMAIL,
      etiqueta: 'restablecer contraseña',
      data: () => ({ ...conNombre(), email: usuario.email, token: 't0k' }),
    },
    {
      job: NOTIFICATION_JOB.SEND_ALERT_EMAIL,
      etiqueta: 'alerta',
      data: () => ({
        ...conNombre(),
        email: usuario.email,
        alertName: VENENO,
        listingTitle: VENENO,
        listingSlug: 'bici-1',
      }),
    },
    {
      job: NOTIFICATION_JOB.SEND_CONTACT_NOTIFICATION,
      etiqueta: 'contacto → admin',
      data: () => ({
        adminEmail: 'admin@test.local',
        adminName: VENENO,
        messageId: 'm1',
        motivo: VENENO,
        remitenteEmail: 'quien@sea.test',
        extracto: VENENO,
      }),
    },
    {
      job: NOTIFICATION_JOB.SEND_CONTACT_REPLY,
      etiqueta: 'contacto → respuesta del admin',
      data: () => ({ to: 'quien@sea.test', asunto: VENENO, cuerpo: VENENO }),
    },
    {
      job: NOTIFICATION_JOB.SEND_REVIEW_REQUEST_EMAIL,
      etiqueta: 'petición de valoración',
      data: () => ({
        ...conNombre(),
        email: usuario.email,
        otherUserName: VENENO,
        listingTitle: VENENO,
        otherUserSlug: 'otro',
        otherUserId: 'u2',
        listingId: 'l1',
      }),
    },
    {
      job: NOTIFICATION_JOB.SEND_TICKET_MESSAGE,
      etiqueta: 'ticket: respuesta al usuario',
      data: () => ({
        ...conNombre(),
        email: usuario.email,
        ticketId: 't1',
        subject: VENENO,
        extracto: VENENO,
        opened: false,
      }),
    },
    {
      job: NOTIFICATION_JOB.SEND_TICKET_STAFF_NOTIFICATION,
      etiqueta: 'ticket: aviso al buzón de soporte',
      data: () => ({
        to: 'soporte@test.local',
        ticketId: 't1',
        subject: VENENO,
        extracto: VENENO,
        userName: VENENO,
        kind: 'new',
      }),
    },
    {
      job: NOTIFICATION_JOB.SEND_TICKET_RESOLVED,
      etiqueta: 'ticket resuelto',
      data: () => ({
        ...conNombre(),
        email: usuario.email,
        ticketId: 't1',
        subject: VENENO,
        reopenWindowDays: 7,
      }),
    },
    ...(['APPROVED', 'REJECTED', 'DEACTIVATED', 'RESTORED'] as const).map((action) => ({
      job: NOTIFICATION_JOB.SEND_LISTING_MODERATED,
      etiqueta: `moderación de anuncio · ${action}`,
      data: () => ({
        ...conNombre(),
        email: usuario.email,
        listingTitle: VENENO,
        action,
        reason: VENENO,
      }),
    })),
    ...(['NO_FUNDS', 'LISTING_INACTIVE'] as const).map((reason) => ({
      job: NOTIFICATION_JOB.SEND_BUMP_AUTO_PAUSED,
      etiqueta: `bump pausado · ${reason}`,
      data: () => ({
        ...conNombre(),
        email: usuario.email,
        listingId: 'l1',
        listingTitle: VENENO,
        reason,
      }),
    })),
    ...(
      [
        'SUSPENDED',
        'UNSUSPENDED',
        'BANNED',
        'REINSTATED',
        'ARCHIVED',
        'ROLE_CHANGED',
        'DELETED',
      ] as const
    ).map((action) => ({
      job: NOTIFICATION_JOB.SEND_ACCOUNT_MODERATED,
      etiqueta: `moderación de cuenta · ${action}`,
      data: () => ({
        ...conNombre(),
        email: usuario.email,
        action,
        reason: VENENO,
        suspendedUntil: action === 'SUSPENDED' ? new Date().toISOString() : null,
        newRole: action === 'ROLE_CHANGED' ? VENENO : null,
      }),
    })),
    ...(['EXPIRING_SOON', 'EXPIRED', 'EDITED_BY_STAFF', 'DELETED_BY_STAFF'] as const).map(
      (action) => ({
        job: NOTIFICATION_JOB.SEND_LISTING_LIFECYCLE,
        etiqueta: `ciclo de vida · ${action}`,
        data: () => ({
          ...conNombre(),
          email: usuario.email,
          listingTitle: VENENO,
          action,
          reason: VENENO,
          daysLeft: action === 'EXPIRING_SOON' ? 3 : null,
        }),
      }),
    ),
    {
      job: NOTIFICATION_JOB.SEND_REVIEW_RECEIVED,
      etiqueta: 'valoración recibida',
      data: () => ({
        ...conNombre(),
        email: usuario.email,
        rating: 5,
        authorName: VENENO,
        targetSlug: 'yo',
        listingTitle: VENENO,
      }),
    },
    {
      job: NOTIFICATION_JOB.SEND_MESSAGE_UNREAD,
      etiqueta: 'mensajes sin leer',
      data: () => ({
        ...conNombre(),
        email: usuario.email,
        conversationId: 'c1',
        otherUserName: VENENO,
        unreadCount: 2,
        extracto: VENENO,
      }),
    },
    {
      job: NOTIFICATION_JOB.SEND_DATA_EXPORT_READY,
      etiqueta: 'copia de datos lista',
      data: () => ({
        ...conNombre(),
        email: usuario.email,
        expiresAt: new Date(Date.now() + 7 * 864e5).toISOString(),
        sizeBytes: 1024 * 1024,
      }),
    },
    {
      job: NOTIFICATION_JOB.SEND_INVOICING_PENDING,
      etiqueta: 'faltan datos fiscales',
      data: () => ({
        ...conNombre(),
        email: usuario.email,
        periodKey: '2026-Q1',
        facturableCount: 3,
      }),
    },
    {
      job: NOTIFICATION_JOB.SEND_BALANCE_DEBITED,
      etiqueta: 'saldo retirado',
      data: () => ({ ...conNombre(), email: usuario.email, credits: 5, bumps: 0, reason: VENENO }),
    },
  ];

  // ═══════════════════════════════════════════════════════════════════════════════════
  // BARRERA 0 — LA TABLA CUBRE LOS DIECIOCHO, Y SEGUIRÁ CUBRIÉNDOLOS
  // ═══════════════════════════════════════════════════════════════════════════════════

  it('BARRERA 0 — hay un caso para cada uno de los 18 tipos de envío', () => {
    const todos = Object.values(NOTIFICATION_JOB);
    expect(todos).toHaveLength(18);
    // Un correo nuevo sin caso aquí deja de estar comprobado, y sin esta línea nadie se
    // enteraría: la batería seguiría verde con diecisiete.
    expect([...new Set(CASOS.map((c) => c.job))].sort()).toEqual([...todos].sort());
  });

  // ═══════════════════════════════════════════════════════════════════════════════════
  // BARRERAS 1-3 — SOBRE CADA ENVÍO, UNO A UNO
  // ═══════════════════════════════════════════════════════════════════════════════════

  describe.each(CASOS.map((c) => [c.etiqueta, c] as const))('%s', (_etiqueta, caso) => {
    it('lleva las DOS partes, escapa todo y respeta el pie de baja', async () => {
      const data = caso.data();
      await disparar(caso.job, data);

      expect(enviados).toHaveLength(1);
      const correo = enviados[0];

      // ── B3: doble parte. Un correo sólo-HTML es un fallo de test (§7.5). ──────────
      expect(typeof correo.text).toBe('string');
      expect(correo.text.length).toBeGreaterThan(0);
      expect(typeof correo.html).toBe('string');
      expect(correo.html!.length).toBeGreaterThan(0);

      // ── B2: el escapado, sobre este envío concreto. ───────────────────────────────
      const etiquetas = etiquetasDe(correo.html!);
      for (const etiqueta of etiquetas) {
        expect(ETIQUETAS_PERMITIDAS.has(etiqueta)).toBe(true);
      }
      // Ni un `<` que no abra una de las etiquetas permitidas: es la forma fuerte de
      // «no aparece ninguna etiqueta nueva».
      expect((correo.html!.match(/</g) ?? []).length).toBe(etiquetas.length);
      expect(correo.html).not.toContain('<script');
      expect(correo.html).toContain('&lt;script&gt;');

      // Y la parte de texto NO se escapa: ahí el veneno es texto y ya está. Que las dos
      // partes se traten distinto es justo lo que hace que el escapado esté en la
      // frontera correcta —al convertir a HTML— y no repartido por el copy.
      expect(correo.text).toContain('<script>alert(1)</script>');

      // ── B3: el pie de baja, en las dos partes o en ninguna. ───────────────────────
      const categoria = categoriaDe(caso.job, data);
      if (categoria) {
        expect(correo.text).toContain('/baja?u=');
        expect(correo.html).toContain('/baja?u=');
      } else {
        // Ofrecer «date de baja» al pie de un baneo sería ofrecer algo imposible.
        expect(correo.text).not.toContain('/baja?u=');
        expect(correo.html).not.toContain('/baja?u=');
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════════
  // BARRERA 4 — EL TEMA DE LA INSTANCIA LLEGA AL CORREO
  // ═══════════════════════════════════════════════════════════════════════════════════

  /**
   * ⚠ AQUÍ NO SE ESCRIBE EN `Setting`, Y NO ES UN ATAJO.
   *
   * `cleanDb` excluye `Setting` a propósito —es dato de sistema, sembrado una vez en el
   * `globalSetup` y COMPARTIDO por los workers de Jest que corren en paralelo—, así que
   * una suite que escribiera ahí el tema o el logo se los dejaría puestos a las demás. La
   * primera versión de este bloque lo hacía y fallaba sola, en el mismo fichero.
   *
   * Así que lo que se comprueba aquí es **el cableado**: que el processor consulta de
   * verdad a `EstiloService` y a `BrandingService` y mete lo que devuelven en el correo.
   * Que la resolución de un modelo a hexadecimal sea correcta se comprueba donde toca,
   * sobre las funciones puras, en `src/infra/queue/email/correo.spec.ts`.
   */
  describe('BARRERA 4 — el tema y el logo de la instancia', () => {
    // Los espías se deshacen uno a uno y NO con `restoreAllMocks`, que se llevaría por
    // delante el de Resend —el que sostiene toda la suite— y dejaría los tests siguientes
    // mandando correo de verdad.
    const espias: jest.SpyInstance[] = [];
    afterEach(() => {
      while (espias.length) espias.pop()!.mockRestore();
    });

    const conTema = (primary: string, logo: string | null) => {
      const tokens = resolverTokens(MODELO_POR_DEFECTO, {
        ...MODELO_POR_DEFECTO.coloresPorDefecto,
        primary,
      });
      espias.push(
        jest.spyOn(app.get(EstiloService), 'get').mockResolvedValue({
          modelo: MODELO_POR_DEFECTO.id,
          version: '1',
          tokens,
          zonas: Object.fromEntries(ESTILO_ZONES.map((z) => [z, {}])) as never,
          avisos: [],
        }),
        jest
          .spyOn(app.get(BrandingService), 'get')
          .mockResolvedValue({ public: logo, backoffice: null, blog: null }),
      );
    };

    const mensaje = () => ({
      email: usuario.email,
      name: 'Ernest',
      conversationId: 'c1',
      otherUserName: 'Ana',
      unreadCount: 1,
      extracto: 'hola',
    });

    it('sin configurar nada, sale el tema de fábrica y sin logo', async () => {
      await disparar(NOTIFICATION_JOB.SEND_MESSAGE_UNREAD, mensaje());

      // El azul del Modelo 0, escrito inline: es el estado de una instancia recién
      // desplegada, y sale igual sin ninguna fila en `Setting`.
      expect(enviados[0].html).toContain('background-color:#2563eb');
      expect(enviados[0].html).not.toContain('<img');
    });

    it('con un modelo configurado y un logo, los dos llegan al correo', async () => {
      conTema('120 100% 25%', 'https://cdn.test/logo.png');

      await disparar(NOTIFICATION_JOB.SEND_MESSAGE_UNREAD, mensaje());

      const documento = enviados[0].html!;
      // El principal del modelo, resuelto a hexadecimal literal: en un correo no hay
      // variables CSS que valgan.
      expect(documento).toContain('background-color:#008000');
      expect(documento).toContain('<img src="https://cdn.test/logo.png"');
      expect(documento).not.toContain('var(--');
    });

    /**
     * SOBRIO (§7.4.2): los tres correos que no se adornan. Con logo configurado y todo,
     * un restablecimiento de contraseña sale sin cabecera de marca y sin botón de color —
     * un correo de restablecimiento muy adornado se parece a una suplantación.
     */
    it('los correos críticos se quedan sobrios aunque haya logo', async () => {
      conTema(MODELO_POR_DEFECTO.coloresPorDefecto.primary, 'https://cdn.test/logo.png');

      const sobrios: [string, Record<string, unknown>][] = [
        [NOTIFICATION_JOB.SEND_RESET_EMAIL, { email: usuario.email, name: 'E', token: 'x' }],
        [
          NOTIFICATION_JOB.SEND_VERIFICATION_EMAIL,
          { email: usuario.email, name: 'E', userId: usuario.id, token: 'x' },
        ],
        [
          NOTIFICATION_JOB.SEND_ACCOUNT_MODERATED,
          {
            email: usuario.email,
            name: 'E',
            action: 'BANNED',
            reason: null,
            suspendedUntil: null,
            newRole: null,
          },
        ],
      ];

      for (const [job, data] of sobrios) {
        enviados = [];
        await disparar(job, data);
        expect(enviados[0].html).not.toContain('<img');
        expect(enviados[0].html).not.toContain('background-color:#2563eb');
      }

      // Y en el que más importa, el enlace se lee ENTERO: es lo que permite comprobar a
      // dónde va antes de pulsarlo, que es la defensa real contra la suplantación.
      enviados = [];
      await disparar(NOTIFICATION_JOB.SEND_RESET_EMAIL, {
        email: usuario.email,
        name: 'E',
        token: 'x',
      });
      expect(enviados[0].html).toContain('/restablecer?token=x</a>');
    });
  });
});
