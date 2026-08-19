import { AdminNav } from './components/AdminNav';
import { AdminUserBar } from './components/AdminUserBar';
import { AdminSessionGuard } from './components/AdminSessionGuard';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      {/* ROLES R3 — no pinta nada: escucha el 401 de cualquier sección y lo
          convierte en re-login. Va en el shell para cubrir las 22 secciones —y
          las que vengan— sin tocar ninguna. Ver AdminSessionGuard. */}
      <AdminSessionGuard />
      {/* Top header */}
      <header className="flex h-14 items-center justify-between border-b bg-background px-6">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Backoffice
        </span>
        <AdminUserBar />
      </header>

      <div className="flex flex-1">
        {/* Sidebar */}
        <aside className="w-56 shrink-0 border-r bg-muted/30 p-4">
          <AdminNav />
        </aside>

        {/* Page content */}
        <main className="flex-1 p-8">{children}</main>
      </div>
    </div>
  );
}
