import { useQuery } from '@tanstack/react-query';
import { BookOpen, FileText, Inbox, LayoutGrid, LogOut, Menu, Receipt, Settings, Upload, Database, X } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { ROLE_LABEL } from '@indotek/shared';
import { api } from '../api/client';
import type { Inbox as InboxT } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { cx } from './ui';

export function useInbox() {
  return useQuery({ queryKey: ['inbox'], queryFn: () => api<InboxT>('/fund-requests/inbox'), refetchInterval: 60_000 });
}

function Badge({ n, testId }: { n?: number; testId?: string }) {
  if (!n) return null;
  return (
    <span data-testid={testId} className="ml-auto min-w-5 rounded-full bg-red-600 px-1.5 text-center text-[11px] font-bold leading-5 text-white">
      {n}
    </span>
  );
}

/** Jumlah realisasi menunggu verifikasi (badge untuk FINANCE). */
function usePendingExpenses(enabled: boolean) {
  return useQuery({ queryKey: ['expense-pending'], queryFn: () => api<{ count: number }>('/expenses/pending-count'), enabled, refetchInterval: 60_000 });
}

export function Layout() {
  const { user, logout, can } = useAuth();
  const inbox = useInbox();
  const pending = usePendingExpenses(can('FINANCE'));
  const [open, setOpen] = useState(false);
  const count = inbox.data?.count;

  const nav = [
    { to: '/rekap', label: 'Rekap', icon: LayoutGrid, show: true },
    { to: '/pengajuan', label: 'Pengajuan Dana', icon: FileText, show: true },
    { to: '/inbox', label: 'Inbox Approval', icon: Inbox, show: true, badge: count },
    { to: '/realisasi', label: 'Realisasi', icon: Receipt, show: true, badge: can('FINANCE') ? pending.data?.count : undefined },
    { to: '/buku-kas', label: 'Buku Kas', icon: BookOpen, show: can('ADMIN', 'FINANCE', 'DIREKTUR', 'PM') },
    { to: '/import', label: 'Import Excel', icon: Upload, show: can('ADMIN', 'PM', 'FINANCE') },
    { to: '/master', label: 'Data Master', icon: Database, show: can('ADMIN', 'PM') },
    { to: '/pengaturan', label: 'Pengaturan', icon: Settings, show: true },
  ].filter((n) => n.show);

  const link = ({ isActive }: { isActive: boolean }) =>
    cx(
      'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition',
      isActive ? 'bg-white/15 text-white' : 'text-blue-100 hover:bg-white/10 hover:text-white',
    );

  const sidebar = (
    <div className="flex h-full flex-col bg-brand px-3 py-4">
      <div className="mb-6 flex items-center gap-2 px-2">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-accent font-black text-brand">IB</div>
        <div className="leading-tight">
          <div className="text-sm font-bold text-white">Indotek Budget</div>
          <div className="text-[11px] text-blue-200">PT Indotek Buana Karya</div>
        </div>
      </div>
      <nav className="flex-1 space-y-1">
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} className={link} onClick={() => setOpen(false)}>
            <n.icon className="h-4 w-4" /> {n.label} <Badge n={n.badge} testId={n.to === '/inbox' ? 'inbox-badge' : `badge-${n.to.slice(1)}`} />
          </NavLink>
        ))}
      </nav>
      <div className="mt-4 rounded-lg bg-white/10 px-3 py-2 text-xs text-blue-100">
        <div className="truncate font-semibold text-white">{user?.name}</div>
        <div>{user && ROLE_LABEL[user.role]}</div>
        <button onClick={() => void logout()} className="mt-2 inline-flex items-center gap-1 text-blue-100 hover:text-white">
          <LogOut className="h-3.5 w-3.5" /> Keluar
        </button>
      </div>
    </div>
  );

  const bottom = [nav[0], nav[1], nav[2]];

  return (
    <div className="min-h-screen lg:flex">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-slate-900/40" />
          <aside className="absolute inset-y-0 left-0 w-64" onClick={(e) => e.stopPropagation()}>
            {sidebar}
            <button className="absolute right-2 top-3 rounded p-1 text-white" onClick={() => setOpen(false)} aria-label="Tutup menu">
              <X className="h-5 w-5" />
            </button>
          </aside>
        </div>
      )}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b bg-white/90 px-4 py-2 backdrop-blur lg:hidden">
          <button className="btn-ghost p-1.5" onClick={() => setOpen(true)} aria-label="Buka menu">
            <Menu className="h-5 w-5" />
          </button>
          <span className="font-bold text-brand">Indotek Budget</span>
          <span className="ml-auto text-xs text-slate-500">{user && ROLE_LABEL[user.role]}</span>
        </header>
        <main className="mx-auto max-w-[1600px] px-4 pb-24 pt-4 sm:px-6 lg:pb-8 lg:pt-6">
          <Outlet />
        </main>
        <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t bg-white lg:hidden">
          {bottom.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) => cx('relative flex flex-col items-center gap-0.5 py-2 text-[11px]', isActive ? 'text-brand' : 'text-slate-500')}
            >
              <n.icon className="h-5 w-5" />
              {n.label.split(' ')[0]}
              {!!n.badge && (
                <span className="absolute right-[28%] top-1 rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">{n.badge}</span>
              )}
            </NavLink>
          ))}
          <button onClick={() => setOpen(true)} className="flex flex-col items-center gap-0.5 py-2 text-[11px] text-slate-500">
            <Menu className="h-5 w-5" /> Menu
          </button>
        </nav>
      </div>
    </div>
  );
}
