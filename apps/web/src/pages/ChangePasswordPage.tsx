import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { changePasswordSchema, type ChangePasswordInput } from '@indotek/shared';
import { errorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { ErrorBox, Field, Spinner } from '../components/ui';

/** Ganti password — wajib saat login pertama, juga bisa dibuka dari menu Pengaturan. */
export function ChangePasswordPage() {
  const { user, loading, changePassword, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [err, setErr] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<ChangePasswordInput>({ resolver: zodResolver(changePasswordSchema) });

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;

  const onSubmit = handleSubmit(async (v) => {
    setErr(null);
    try {
      await changePassword(v);
      nav((loc.state as { from?: string } | null)?.from ?? '/rekap', { replace: true });
    } catch (e) {
      setErr(errorMessage(e));
    }
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand to-brand-800 px-4">
      <form onSubmit={onSubmit} className="card w-full max-w-sm space-y-4 p-6" noValidate>
        <div>
          <h1 className="text-lg font-bold">Ganti password</h1>
          <p className="text-sm text-slate-500">
            {user.mustChangePassword ? 'Demi keamanan, ganti password sebelum melanjutkan.' : `Masuk sebagai ${user.name}.`}
          </p>
        </div>
        <ErrorBox error={err} />
        <Field label="Password saat ini" error={formState.errors.currentPassword?.message}>
          <input className="input" type="password" autoComplete="current-password" {...register('currentPassword')} />
        </Field>
        <Field label="Password baru" hint="Minimal 10 karakter, berisi huruf dan angka." error={formState.errors.newPassword?.message}>
          <input className="input" type="password" autoComplete="new-password" {...register('newPassword')} />
        </Field>
        <button className="btn-primary w-full" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? 'Menyimpan…' : 'Simpan password'}
        </button>
        <button type="button" className="btn-ghost w-full" onClick={() => void logout()}>Keluar</button>
      </form>
    </div>
  );
}
