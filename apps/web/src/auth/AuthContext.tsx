import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ChangePasswordInput, Role } from '@indotek/shared';
import { api, setSessionHandlers } from '../api/client';
import type { Me } from '../api/types';

interface AuthState {
  user: Me | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<Me>;
  logout: () => Promise<void>;
  changePassword: (input: ChangePasswordInput) => Promise<void>;
  can: (...roles: Role[]) => boolean;
}

const Ctx = createContext<AuthState | null>(null);

/** Sesi berbasis cookie httpOnly: status login diketahui lewat GET /auth/me. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();

  const clear = useCallback(() => {
    setUser(null);
    qc.clear();
  }, [qc]);

  useEffect(() => {
    setSessionHandlers({
      logout: clear,
      passwordChangeRequired: () => setUser((u) => (u ? { ...u, mustChangePassword: true } : u)),
    });
    api<Me>('/auth/me')
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, [clear]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<{ user: Me }>('/auth/login', { method: 'POST', json: { email, password } });
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    clear();
  }, [clear]);

  const changePassword = useCallback(async (input: ChangePasswordInput) => {
    const res = await api<{ user: Me }>('/auth/change-password', { method: 'POST', json: input });
    setUser(res.user);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, loading, login, logout, changePassword, can: (...roles) => !!user && roles.includes(user.role) }),
    [user, loading, login, logout, changePassword],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth harus di dalam AuthProvider');
  return ctx;
}
