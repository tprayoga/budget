import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { BukuKasPage } from './pages/BukuKasPage';
import { IncompletePaymentsPage } from './pages/IncompletePaymentsPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { ClusterPage } from './pages/ClusterPage';
import { FundRequestDetailPage } from './pages/FundRequestDetailPage';
import { FundRequestListPage } from './pages/FundRequestListPage';
import { FundRequestWizard } from './pages/FundRequestWizard';
import { ImportPage } from './pages/ImportPage';
import { InboxPage } from './pages/InboxPage';
import { LoginPage } from './pages/LoginPage';
import { MasterPage } from './pages/MasterPage';
import { ProjectPage } from './pages/ProjectPage';
import { QuickExpensePage } from './pages/QuickExpensePage';
import { RealisasiPage } from './pages/RealisasiPage';
import { RekapPage } from './pages/RekapPage';
import { SettingsPage } from './pages/SettingsPage';

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (user.mustChangePassword) return <Navigate to="/ganti-password" replace state={{ from: loc.pathname }} />;
  return children;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/ganti-password" element={<ChangePasswordPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/rekap" replace />} />
        <Route path="/rekap" element={<RekapPage />} />
        <Route path="/projects/:id" element={<ProjectPage />} />
        <Route path="/clusters/:id" element={<ClusterPage />} />
        <Route path="/pengajuan" element={<FundRequestListPage />} />
        <Route path="/pengajuan/baru" element={<FundRequestWizard />} />
        <Route path="/pengajuan/:id/edit" element={<FundRequestWizard />} />
        <Route path="/pengajuan/:id" element={<FundRequestDetailPage />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/realisasi" element={<RealisasiPage />} />
        <Route path="/realisasi/cepat" element={<QuickExpensePage />} />
        <Route path="/buku-kas" element={<BukuKasPage />} />
        <Route path="/pembayaran-klien" element={<IncompletePaymentsPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/master" element={<MasterPage />} />
        <Route path="/pengaturan" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/rekap" replace />} />
      </Route>
    </Routes>
  );
}
