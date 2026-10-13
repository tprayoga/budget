import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Role } from '@indotek/shared';
import { api, loadAuth, saveAuth, setLogoutHandler } from '../api/client';
import type { Me } from '../api/types';

interface AuthState {
  user: Me | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (...roles: Role[]) => boolean;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();

  const clear = useCallback(() => {
    saveAuth(null);
    setUser(null);
    qc.clear();
  }, [qc]);

  useEffect(() => {
    setLogoutHandler(clear);
    if (!loadAuth()) {
      setLoading(false);
      return;
    }
    api<Me>('/auth/me')
      .then(setUser)
      .catch(clear)
      .finally(() => setLoading(false));
  }, [clear]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<{ accessToken: string; refreshToken: string; user: Me }>('/auth/login', {
      method: 'POST',
      json: { email, password },
    });
    saveAuth({ accessToken: res.accessToken, refreshToken: res.refreshToken });
    setUser(res.user);
  }, []);

  const logout = useCallback(async () => {
    const auth = loadAuth();
    if (auth) await api('/auth/logout', { method: 'POST', json: { refreshToken: auth.refreshToken } }).catch(() => undefined);
    clear();
  }, [clear]);

  const value = useMemo<AuthState>(
    () => ({ user, loading, login, logout, can: (...roles) => !!user && roles.includes(user.role) }),
    [user, loading, login, logout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth harus di dalam AuthProvider');
  return ctx;
}
