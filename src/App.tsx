import { useCallback, useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Camera,
  History,
  Bot,
  Settings,
  Shield,
  LogOut,
  Wallet,
} from 'lucide-react';
import { api, registerAccountLockedHandler } from './api/client';
import type { AuthUser, LoginNotice, SavingsGoal, SecurityAlert, WalletTransaction } from './types';
import { LoginScreen } from './components/LoginScreen';
import { ForcePasswordModal } from './components/ForcePasswordModal';
import { SecurityAlertsBanner } from './components/SecurityAlertsBanner';
import { OverviewTab } from './components/OverviewTab';
import { ScanDepositTab } from './components/ScanDepositTab';
import { HistoryTab } from './components/HistoryTab';
import { AdvisorTab } from './components/AdvisorTab';
import { SettingsTab } from './components/SettingsTab';
import { AdminTab } from './components/AdminTab';

type TabId = 'overview' | 'scan' | 'history' | 'advisor' | 'settings' | 'admin';

export default function App() {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [notice, setNotice] = useState<LoginNotice | null>(null);
  const [lockedMessage, setLockedMessage] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [goal, setGoal] = useState<SavingsGoal>({
    userId: '',
    title: 'Quỹ dự phòng cá nhân',
    targetAmount: 10000000,
    updatedAt: '',
  });
  const [alerts, setAlerts] = useState<SecurityAlert[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [alertBusy, setAlertBusy] = useState(false);

  const fetchLoginNotice = useCallback(async () => {
    try {
      const res = await api.getLoginNotice();
      setNotice(res);
    } catch {
      // Ignore transient error on public notice
    }
  }, []);

  const loadWorkspaceData = useCallback(async () => {
    setDataLoading(true);
    try {
      const [txRes, goalRes, alertRes] = await Promise.all([
        api.getTransactions(),
        api.getGoal(),
        api.getSecurityAlerts(),
      ]);
      setTransactions(txRes.transactions);
      setGoal(goalRes.goal);
      setAlerts(alertRes.alerts);
    } finally {
      setDataLoading(false);
    }
  }, []);

  const handleLockedLogout = useCallback((msg: string) => {
    setUser(null);
    setTransactions([]);
    setAlerts([]);
    setLockedMessage(msg || 'Tài khoản này đã bị khóa bởi quản trị viên.');
    void fetchLoginNotice();
  }, [fetchLoginNotice]);

  useEffect(() => {
    registerAccountLockedHandler(handleLockedLogout);
    return () => registerAccountLockedHandler(null);
  }, [handleLockedLogout]);

  // Initial session check (never produces 401 console error)
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [sessionRes, noticeRes] = await Promise.all([
          api.getSession(),
          api.getLoginNotice(),
        ]);
        if (!active) return;
        setNotice(noticeRes);
        if (sessionRes.authenticated && sessionRes.user) {
          setUser(sessionRes.user);
        } else if (sessionRes.locked && sessionRes.message) {
          setLockedMessage(sessionRes.message);
        }
      } finally {
        if (active) setBooting(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Load workspace data when authenticated and password change is not pending
  useEffect(() => {
    if (user && !user.mustChangePassword) {
      void loadWorkspaceData();
    }
  }, [user?.id, user?.mustChangePassword, loadWorkspaceData]);

  // Redirect away from Admin tab immediately if demoted
  useEffect(() => {
    if (activeTab === 'admin' && user && user.role !== 'admin') {
      setActiveTab('overview');
    }
  }, [activeTab, user?.role]);

  // Periodic heartbeat calling /api/auth/me; immediately logs out on 403 ACCOUNT_LOCKED
  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(async () => {
      try {
        const meRes = await api.me();
        setUser(meRes.user);
        setAlerts((prev) => {
          const localUnread = prev.filter((a) => !a.isRead).length;
          if (meRes.unreadAlertsCount > 0 || localUnread !== meRes.unreadAlertsCount) {
            void api.getSecurityAlerts().then((r) => setAlerts(r.alerts)).catch(() => {});
          }
          return prev;
        });
      } catch {
        // ACCOUNT_LOCKED handled globally by registerAccountLockedHandler
      }
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [user?.id]);

  async function handleLogout() {
    try {
      await api.logout();
    } finally {
      setUser(null);
      setTransactions([]);
      setAlerts([]);
      setActiveTab('overview');
      void fetchLoginNotice();
    }
  }

  async function handleMarkAlertRead(id: string) {
    setAlertBusy(true);
    try {
      await api.markAlertRead(id);
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, isRead: true } : a)));
    } finally {
      setAlertBusy(false);
    }
  }

  async function handleMarkAllAlertsRead() {
    setAlertBusy(true);
    try {
      await api.markAllAlertsRead();
      setAlerts((prev) => prev.map((a) => ({ ...a, isRead: true })));
    } finally {
      setAlertBusy(false);
    }
  }

  async function handleUpdateGoal(title: string, targetAmount: number) {
    const res = await api.updateGoal(title, targetAmount);
    setGoal(res.goal);
  }

  if (booting) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-sm font-medium text-slate-500">Đang khởi động Ví Tiết Kiệm Cá Nhân...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <LoginScreen
        notice={notice}
        lockedBannerMessage={lockedMessage}
        onSuccess={(loggedInUser) => {
          setLockedMessage(null);
          setUser(loggedInUser);
          setActiveTab('overview');
        }}
        onNoticeRefresh={() => void fetchLoginNotice()}
      />
    );
  }

  if (user.mustChangePassword) {
    return (
      <ForcePasswordModal
        user={user}
        onChanged={(updated) => setUser(updated)}
        onLogout={() => void handleLogout()}
      />
    );
  }

  const navItems: Array<{ id: TabId; label: string; shortLabel: string; icon: typeof LayoutDashboard }> = [
    { id: 'overview', label: 'Tổng quan', shortLabel: 'Tổng quan', icon: LayoutDashboard },
    { id: 'scan', label: 'Quét & Nạp tiền', shortLabel: 'Nạp tiền', icon: Camera },
    { id: 'history', label: 'Lịch sử giao dịch', shortLabel: 'Lịch sử', icon: History },
    { id: 'advisor', label: 'Trợ lý AI', shortLabel: 'Trợ lý AI', icon: Bot },
    { id: 'settings', label: 'Cài đặt & Bảo mật', shortLabel: 'Cài đặt', icon: Settings },
  ];

  if (user.role === 'admin') {
    navItems.push({ id: 'admin', label: 'Quản trị', shortLabel: 'Quản trị', icon: Shield });
  }

  const activeNav = navItems.find((n) => n.id === activeTab) ?? navItems[0];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Desktop Left Sidebar */}
      <aside className="hidden lg:flex w-64 shrink-0 bg-white border-r border-slate-200 flex-col justify-between sticky top-0 h-screen">
        <div className="p-5">
          <div className="flex items-center gap-2.5 px-2 py-1">
            <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
              <Wallet className="w-5 h-5" />
            </div>
            <span className="font-display text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">
              Ví Tiết Kiệm
            </span>
          </div>

          <nav aria-label="Điều hướng chính" className="mt-7 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full px-3.5 py-2.5 rounded-xl text-sm font-medium flex items-center gap-3 transition-colors whitespace-nowrap cursor-pointer ${
                    isActive
                      ? 'bg-emerald-50 text-emerald-800 font-semibold'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-emerald-700' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-4 border-t border-slate-100">
          <div className="px-2 mb-3">
            <div className="text-sm font-semibold text-slate-900 truncate">{user.displayName}</div>
            <div className="text-xs text-slate-500 truncate">
              @{user.username} · {user.isRootAdmin ? 'Quản trị gốc' : user.role === 'admin' ? 'Admin' : 'Cá nhân'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleLogout()}
            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center justify-center gap-2 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Đăng xuất</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Compact Top Bar */}
        <header className="sticky top-0 z-30 h-14 bg-white/95 backdrop-blur-md border-b border-slate-200 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="lg:hidden w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0">
              <Wallet className="w-4 h-4" />
            </div>
            <h1 className="font-display text-base sm:text-lg font-bold text-slate-900 truncate">
              {activeNav.label}
            </h1>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span className="hidden sm:inline text-xs text-slate-500">
              {user.displayName}
            </span>
            <button
              type="button"
              onClick={() => void handleLogout()}
              aria-label="Đăng xuất"
              className="lg:hidden px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Thoát</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 pb-24 lg:pb-10 max-w-6xl w-full mx-auto">
          <SecurityAlertsBanner
            alerts={alerts}
            onMarkRead={handleMarkAlertRead}
            onMarkAllRead={handleMarkAllAlertsRead}
            busy={alertBusy}
          />

          {activeTab === 'overview' && (
            <OverviewTab
              transactions={transactions}
              goal={goal}
              loading={dataLoading}
              onUpdateGoal={handleUpdateGoal}
              onNavigate={(tab) => setActiveTab(tab)}
            />
          )}

          {activeTab === 'scan' && (
            <ScanDepositTab
              user={user}
              transactions={transactions}
              onTransactionCreated={loadWorkspaceData}
            />
          )}

          {activeTab === 'history' && (
            <HistoryTab
              transactions={transactions}
              loading={dataLoading}
              onChanged={loadWorkspaceData}
            />
          )}

          {activeTab === 'advisor' && <AdvisorTab user={user} />}

          {activeTab === 'settings' && (
            <SettingsTab
              user={user}
              alerts={alerts}
              onUserUpdated={(updated) => setUser(updated)}
            />
          )}

          {activeTab === 'admin' && user.role === 'admin' && (
            <AdminTab
              currentUser={user}
              onNoticeUpdated={() => void fetchLoginNotice()}
            />
          )}
        </main>
      </div>

      {/* Mobile Bottom Tab Bar with Safe Area */}
      <nav
        aria-label="Điều hướng di động"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 pb-safe"
      >
        <div
          className="grid items-center h-16"
          style={{ gridTemplateColumns: `repeat(${navItems.length}, minmax(0, 1fr))` }}
        >
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`h-full flex flex-col items-center justify-center gap-0.5 px-1 cursor-pointer ${
                  isActive ? 'text-emerald-700' : 'text-slate-500'
                }`}
              >
                <Icon className="w-5 h-5 shrink-0" />
                <span className="text-[10px] font-medium truncate max-w-full">
                  {item.shortLabel}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
