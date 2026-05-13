import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { DashboardHome } from './pages/DashboardHome';
import { AccountsPage } from './pages/AccountsPage';
import { SettingsPage } from './pages/SettingsPage';
import { BetsPage } from './pages/BetsPage';
import { StatsPage } from './pages/StatsPage';
import { FiltersPage } from './pages/FiltersPage';
import { ProxiesPage } from './pages/ProxiesPage';
import { LogsPage } from './pages/LogsPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<DashboardHome />} />
        <Route path="logs" element={<LogsPage />} />
        <Route path="accounts" element={<AccountsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="bets" element={<BetsPage />} />
        <Route path="stats" element={<StatsPage />} />
        <Route path="filters" element={<FiltersPage />} />
        <Route path="proxies" element={<ProxiesPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
