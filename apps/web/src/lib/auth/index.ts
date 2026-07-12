import NextAuth, { CredentialsSignin } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import { apiFetch, ApiError } from '../api/client';
import { authConfig } from './auth.config';

interface LoginResponse {
  accessToken: string;
  user: { id: string; name: string; email: string; slug: string; role: string; emailVerified: boolean };
}

/** Lanzada por el provider `admin-credentials` cuando las credenciales son
 * correctas pero la cuenta no es ADMIN — `signIn(..., { redirect: false })`
 * devuelve este `code` tal cual en `result.code`, para que /admin/login
 * pueda mostrar "esta entrada es solo para administración" en vez del
 * genérico "email o contraseña incorrectos". El código en sí no filtra nada
 * sensible (no dice si la cuenta existe) — ver el comentario de Auth.js en
 * CredentialsSignin sobre no usar esto para pistas de "email o contraseña". */
class AdminOnlyError extends CredentialsSignin {
  code = 'admin_login_not_admin';
}

/** Lanzada por el provider público `credentials` cuando las credenciales son
 * correctas pero la cuenta ES admin — decisión: los ADMIN solo entran por
 * /admin/login. El mensaje ("ve a /admin/login") solo se muestra tras
 * validar la contraseña — nunca antes, o /login sería un oráculo para
 * enumerar qué emails son de administración. */
class AdminMustUseAdminLoginError extends CredentialsSignin {
  code = 'admin_must_use_admin_login';
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    // Auth.js picks up AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET by convention.
    // No adapter is configured, so Auth.js's own account-linking-by-email never
    // runs; all linking happens in our signIn callback (auth.config.ts) against
    // our backend, which only links after verifying Google's email_verified claim.
    Google({}),
    Credentials({
      credentials: {
        email: { type: 'email' },
        password: { type: 'password' },
      },
      async authorize(credentials) {
        try {
          const res = await apiFetch<LoginResponse>('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email: credentials.email, password: credentials.password }),
          });
          return {
            id: res.user.id,
            name: res.user.name,
            email: res.user.email,
            slug: res.user.slug,
            role: res.user.role,
            accessToken: res.accessToken,
            emailVerified: res.user.emailVerified,
          };
        } catch (error) {
          if (error instanceof ApiError && error.statusCode === 403 && error.code === 'ADMIN_MUST_USE_ADMIN_LOGIN') {
            throw new AdminMustUseAdminLoginError();
          }
          return null;
        }
      },
    }),
    // Puerta separada del panel — /admin/login usa este provider, nunca el de
    // arriba. Pega contra /auth/admin-login (no /auth/login): el backend
    // rechaza ahí a cualquiera que NO sea ADMIN, con el mismo cuidado de
    // validar la contraseña antes de mirar el rol (AuthService.adminLogin).
    Credentials({
      id: 'admin-credentials',
      name: 'Admin Credentials',
      credentials: {
        email: { type: 'email' },
        password: { type: 'password' },
      },
      async authorize(credentials) {
        try {
          const res = await apiFetch<LoginResponse>('/auth/admin-login', {
            method: 'POST',
            body: JSON.stringify({ email: credentials.email, password: credentials.password }),
          });
          return {
            id: res.user.id,
            name: res.user.name,
            email: res.user.email,
            slug: res.user.slug,
            role: res.user.role,
            accessToken: res.accessToken,
            emailVerified: res.user.emailVerified,
          };
        } catch (error) {
          if (error instanceof ApiError && error.statusCode === 403 && error.code === 'ADMIN_LOGIN_NOT_ADMIN') {
            throw new AdminOnlyError();
          }
          return null;
        }
      },
    }),
  ],
});
