import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { loginSchema, type LoginInput } from '@indotek/shared';
import { errorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { ErrorBox, Field } from '../components/ui';

export function LoginPage() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [err, setErr] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  if (user) return <Navigate to="/rekap" replace />;

  const onSubmit = handleSubmit(async (v) => {
    setErr(null);
    try {
      const me = await login(v.email, v.password);
      const from = (loc.state as { from?: string } | null)?.from ?? '/rekap';
      nav(me.mustChangePassword ? '/ganti-password' : from, { replace: true, state: { from } });
    } catch (e) {
      setErr(errorMessage(e));
    }
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand to-brand-800 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center text-white">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl bg-accent text-lg font-black text-brand">IB</div>
          <h1 className="text-xl font-bold">Indotek Project Budget</h1>
          <p className="text-sm text-blue-200">Budget cluster & pengajuan dana investor</p>
        </div>
        <form onSubmit={onSubmit} className="card space-y-4 p-6" noValidate>
          <ErrorBox error={err} />
          <Field label="Email" error={formState.errors.email?.message}>
            <input className="input" type="email" autoComplete="username" {...register('email')} />
          </Field>
          <Field label="Password" error={formState.errors.password?.message}>
            <input className="input" type="password" autoComplete="current-password" {...register('password')} />
          </Field>
          <button className="btn-primary w-full" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? 'Masuk…' : 'Masuk'}
          </button>
        </form>
      </div>
    </div>
  );
}
