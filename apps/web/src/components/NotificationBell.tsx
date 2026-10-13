import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatTanggalJam } from '@indotek/shared';
import { api } from '../api/client';
import type { AppNotification } from '../api/types';
import { cx } from './ui';

/** Notifikasi in-app (mis. pos/cluster over budget untuk PM & DIREKTUR). */
export function NotificationBell({ tone = 'dark' }: { tone?: 'dark' | 'light' }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api<{ unread: number; items: AppNotification[] }>('/notifications'), refetchInterval: 60_000 });
  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const read = useMutation({ mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: 'POST' }), onSuccess: refresh });
  const readAll = useMutation({ mutationFn: () => api('/notifications/read-all', { method: 'POST' }), onSuccess: refresh });
  const unread = q.data?.unread ?? 0;

  return (
    <div className="relative">
      <button
        className={cx('relative rounded-lg p-1.5', tone === 'dark' ? 'text-blue-100 hover:bg-white/10 hover:text-white' : 'text-slate-600 hover:bg-slate-100')}
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifikasi${unread ? ` (${unread} belum dibaca)` : ''}`}
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span data-testid="notif-badge" className="absolute -right-1 -top-1 min-w-4 rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-4 text-white">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className={cx('absolute z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border bg-white text-slate-800 shadow-lg', tone === 'dark' ? 'left-0' : 'right-0')} role="dialog" aria-label="Daftar notifikasi">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-semibold">Notifikasi</span>
            {unread > 0 && <button className="text-xs text-brand hover:underline" onClick={() => readAll.mutate()}>Tandai semua dibaca</button>}
          </div>
          <ul className="max-h-96 divide-y overflow-y-auto">
            {(q.data?.items ?? []).map((n) => (
              <li key={n.id}>
                <button
                  className={cx('block w-full px-3 py-2 text-left hover:bg-slate-50', !n.readAt && 'bg-red-50/60')}
                  onClick={() => {
                    if (!n.readAt) read.mutate(n.id);
                    setOpen(false);
                    if (n.link) nav(n.link);
                  }}
                >
                  <div className="text-sm font-medium">{n.title}</div>
                  <div className="whitespace-pre-line text-xs text-slate-600">{n.body}</div>
                  <div className="mt-0.5 text-[11px] text-slate-400">{formatTanggalJam(n.createdAt)}</div>
                </button>
              </li>
            ))}
            {!q.data?.items.length && <li className="px-3 py-6 text-center text-sm text-slate-500">Tidak ada notifikasi.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
