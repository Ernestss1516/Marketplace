import { AdminNav } from './components/AdminNav';
import { AdminUserBar } from './components/AdminUserBar';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
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
