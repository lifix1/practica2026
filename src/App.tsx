import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Header } from './components/Header.tsx';
import { EquipmentList } from './components/EquipmentList.tsx';
import { LoginModal } from './components/LoginModal.tsx';
import type { User, Room, EquipmentType, NotificationItem } from './types/index.ts';
import { apiFetch, clearSessionAuth, getSessionUser, safeReadJson, setSessionAuth } from './utils/api.ts';

const EquipmentDetailModal = lazy(() =>
  import('./components/EquipmentDetailModal.tsx').then((m) => ({ default: m.EquipmentDetailModal }))
);
const EquipmentFormModal = lazy(() =>
  import('./components/EquipmentFormModal.tsx').then((m) => ({ default: m.EquipmentFormModal }))
);
const ExcelImportModal = lazy(() =>
  import('./components/ExcelImportModal.tsx').then((m) => ({ default: m.ExcelImportModal }))
);
const QrScannerModal = lazy(() =>
  import('./components/QrScannerModal.tsx').then((m) => ({ default: m.QrScannerModal }))
);
const InventoryManager = lazy(() =>
  import('./components/InventoryManager.tsx').then((m) => ({ default: m.InventoryManager }))
);
const TypesManager = lazy(() =>
  import('./components/TypesManager.tsx').then((m) => ({ default: m.TypesManager }))
);
const TransfersManager = lazy(() =>
  import('./components/TransfersManager.tsx').then((m) => ({ default: m.TransfersManager }))
);
const WriteoffsManager = lazy(() =>
  import('./components/WriteoffsManager.tsx').then((m) => ({ default: m.WriteoffsManager }))
);
const RoomsManager = lazy(() =>
  import('./components/RoomsManager.tsx').then((m) => ({ default: m.RoomsManager }))
);
const UsersManager = lazy(() =>
  import('./components/UsersManager.tsx').then((m) => ({ default: m.UsersManager }))
);
const NotificationPanel = lazy(() =>
  import('./components/NotificationPanel.tsx').then((m) => ({ default: m.NotificationPanel }))
);
const ChangePasswordModal = lazy(() =>
  import('./components/ChangePasswordModal.tsx').then((m) => ({ default: m.ChangePasswordModal }))
);
const GroupDetailModal = lazy(() =>
  import('./components/GroupDetailModal.tsx').then((m) => ({ default: m.GroupDetailModal }))
);
const AuditLogsManager = lazy(() =>
  import('./components/AuditLogsManager.tsx').then((m) => ({ default: m.AuditLogsManager }))
);

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [activeTab, setActiveTab] = useState<string>('equipment');
  const [rooms, setRooms] = useState<Room[]>([]);
  const [types, setTypes] = useState<EquipmentType[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [hasActiveAudit, setHasActiveAudit] = useState(false);

  // Modals state
  const [selectedEquipmentId, setSelectedEquipmentId] = useState<number | null>(null);
  const [selectedEquipmentQrToken, setSelectedEquipmentQrToken] = useState<string | null>(null);
  const [editEquipmentData, setEditEquipmentData] = useState<any | null>(null);
  const [showFormModal, setShowFormModal] = useState(false);
  const [showExcelModal, setShowExcelModal] = useState(false);
  const [showQrScannerModal, setShowQrScannerModal] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [selectedGroupCode, setSelectedGroupCode] = useState<string | null>(null);
  const [selectedGroupQrToken, setSelectedGroupQrToken] = useState<string | null>(null);
  const [pendingQrCode, setPendingQrCode] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchRooms = useCallback(async () => {
    try {
      const roomsRes = await apiFetch('/api/rooms');
      if (!roomsRes.ok) {
        return;
      }
      const roomsData = await safeReadJson<Room[]>(roomsRes, []);
      setRooms(Array.isArray(roomsData) ? roomsData : []);
    } catch {
      setRooms([]);
    }
  }, []);

  const fetchTypes = useCallback(async () => {
    try {
      const typesRes = await apiFetch('/api/equipment-types');
      if (!typesRes.ok) {
        return;
      }
      const typesData = await safeReadJson<EquipmentType[]>(typesRes, []);
      setTypes(Array.isArray(typesData) ? typesData : []);
    } catch {
      setTypes([]);
    }
  }, []);

  const refreshAuditState = useCallback(async () => {
    try {
      const res = await apiFetch('/api/inventory/current');
      if (!res.ok) return;
      const data = await safeReadJson<{ activeInventory?: unknown }>(res, {});
      setHasActiveAudit(Boolean(data?.activeInventory));
    } catch {
      // Ignore transient polling failures
    }
  }, []);

  const refreshNotifications = useCallback(async () => {
    try {
      const res = await apiFetch('/api/notifications');
      if (!res.ok) return;
      const data = await safeReadJson<NotificationItem[]>(res, []);
      setNotifications(Array.isArray(data) ? data : []);
    } catch {
      // Ignore transient polling failures
    }
  }, []);

  // Verify existing session without any auto-login fallback
  const loadInitialSession = useCallback(async () => {
    setAuthChecking(true);
    try {
      const res = await apiFetch('/api/auth/me');
      if (res.status >= 500) {
        const cachedUser = getSessionUser();
        setCurrentUser(cachedUser);
        return;
      }
      const data = await safeReadJson<{ user?: User | null }>(res, { user: null });
      if (data?.user) {
        setCurrentUser(data.user);
        setSessionAuth(null, data.user);
      } else {
        clearSessionAuth();
        setCurrentUser(null);
      }
    } catch {
      clearSessionAuth();
      setCurrentUser(null);
    } finally {
      setAuthChecking(false);
    }
  }, []);

  useEffect(() => {
    loadInitialSession();

    // Parse deep links (applied once user authenticates)
    const urlParams = new URLSearchParams(window.location.search);
    const qrTokenParam = urlParams.get('qr_token');
    const openEqParam = urlParams.get('openEquipment');
    if (openEqParam) {
      const num = Number(openEqParam);
      if (!isNaN(num) && num > 0) {
        setSelectedEquipmentId(num);
        if (qrTokenParam) setSelectedEquipmentQrToken(qrTokenParam);
      }
    }

    const openGrpParam = urlParams.get('openGroup');
    if (openGrpParam) {
      setSelectedGroupCode(openGrpParam);
      if (qrTokenParam) setSelectedGroupQrToken(qrTokenParam);
    }

    const fromQrParam = urlParams.get('from_qr');
    if (fromQrParam && fromQrParam.trim()) {
      setPendingQrCode(fromQrParam.trim());
    }

    const pathname = window.location.pathname;
    const match = pathname.match(/\/equipment\/(\d+)/);
    if (match && match[1]) {
      setSelectedEquipmentId(Number(match[1]));
    }

    const handleExpired = () => {
      setCurrentUser(null);
      setRooms([]);
      setTypes([]);
      setNotifications([]);
      setHasActiveAudit(false);
    };

    window.addEventListener('auth:expired', handleExpired);
    return () => window.removeEventListener('auth:expired', handleExpired);
  }, [loadInitialSession]);

  useEffect(() => {
    if (currentUser && pendingQrCode) {
      let cancelled = false;
      const code = pendingQrCode;
      setPendingQrCode(null);
      apiFetch(`/api/equipment/resolve/${encodeURIComponent(code)}`)
        .then(async (res) => {
          if (!res.ok) return null;
          return safeReadJson<any>(res, null);
        })
        .then((resolved) => {
          if (cancelled || !resolved) return;
          if (resolved.kind === 'group' && resolved.code) {
            setSelectedGroupQrToken(resolved.qrToken || code);
            setSelectedGroupCode(resolved.code);
          } else if (resolved.kind === 'equipment' && resolved.id) {
            setSelectedEquipmentQrToken(resolved.qrToken || code);
            setSelectedEquipmentId(Number(resolved.id));
          }
          const url = new URL(window.location.href);
          if (url.searchParams.has('from_qr')) {
            url.searchParams.delete('from_qr');
            window.history.replaceState({}, '', url.toString());
          }
        })
        .catch(console.error);
      return () => {
        cancelled = true;
      };
    }
  }, [currentUser, pendingQrCode]);

  useEffect(() => {
    if (!currentUser) return;
    const isStaff = ['ADMIN', 'ENGINEER'].includes(currentUser.role);

    if (!isStaff) {
      setActiveTab('equipment');
      setRooms([]);
      setTypes([]);
      setNotifications([]);
      setHasActiveAudit(false);
      return;
    }

    if (currentUser.role !== 'ADMIN' && ['writeoffs', 'users'].includes(activeTab)) {
      setActiveTab('equipment');
    }

    fetchRooms();
    fetchTypes();
    refreshAuditState();
    refreshNotifications();

    const timer = setInterval(() => {
      refreshNotifications();
      refreshAuditState();
    }, 30000);
    return () => clearInterval(timer);
  }, [currentUser, activeTab, fetchRooms, fetchTypes, refreshAuditState, refreshNotifications]);

  // Handle Logout
  const handleLogout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore network errors during logout
    }
    clearSessionAuth();
    setCurrentUser(null);
    setRooms([]);
    setTypes([]);
    setNotifications([]);
    setHasActiveAudit(false);
    setActiveTab('equipment');
  };

  // Dismiss notification
  const handleDismissNotification = async (notifId: number) => {
    try {
      await apiFetch(`/api/notifications/${notifId}`, { method: 'DELETE' });
      setNotifications((prev) => prev.filter((n) => n.id !== notifId));
    } catch (e) {
      console.error(e);
    }
  };

  // Delete equipment
  const handleDeleteEquipment = async (id: number) => {
    try {
      const res = await apiFetch(`/api/equipment/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setSelectedEquipmentId(null);
        setRefreshKey((k) => k + 1);
      }
    } catch (e) {
      console.error(e);
    }
  };

  if (authChecking) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white p-4">
        <div className="w-10 h-10 border-3 border-blue-400 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm text-slate-300 font-medium">Проверка защищённой сессии...</p>
      </div>
    );
  }

  // Mandatory Authentication Gate when unauthenticated
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
        <div className="text-center mb-6 max-w-md">
          <div className="w-12 h-12 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center mx-auto mb-3 text-blue-300">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold text-white tracking-tight">
            ИС «Учет материальных ценностей»
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Доступ к данным кафедры предоставляется только авторизованным сотрудникам
          </p>
        </div>

        <LoginModal
          isOpen
          isBlocking
          onClose={() => {}}
          onSuccess={(user) => {
            setCurrentUser(user);
            setShowLoginModal(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col text-slate-900 font-sans">
      {/* Header */}
      <Header
        currentUser={currentUser}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        unreadCount={notifications.length}
        onOpenNotifications={() => setShowNotifications(true)}
        onOpenQrScanner={() => setShowQrScannerModal(true)}
        onOpenAuth={() => setShowLoginModal(true)}
        onOpenChangePassword={() => setShowChangePasswordModal(true)}
        onLogout={handleLogout}
        hasActiveAudit={hasActiveAudit}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {(activeTab === 'equipment' || !['ADMIN', 'ENGINEER'].includes(currentUser.role)) && (
          <EquipmentList
            currentUser={currentUser}
            onOpenEquipmentDetail={(id) => {
              setSelectedEquipmentQrToken(null);
              setSelectedEquipmentId(id);
            }}
            onOpenCreateEquipment={() => {
              setEditEquipmentData(null);
              setShowFormModal(true);
            }}
            onOpenExcelImport={() => setShowExcelModal(true)}
            onOpenGroupDetail={(code) => {
              setSelectedGroupQrToken(null);
              setSelectedGroupCode(code);
            }}
            onOpenQrScanner={() => setShowQrScannerModal(true)}
            rooms={rooms}
            types={types}
            refreshKey={refreshKey}
          />
        )}

        <Suspense
          fallback={
            <div className="py-12 flex justify-center">
              <div className="w-7 h-7 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          }
        >
          {activeTab === 'inventory' && ['ADMIN', 'ENGINEER'].includes(currentUser.role) && (
            <InventoryManager
              currentUser={currentUser}
              onOpenEquipmentDetail={(id) => {
                setSelectedEquipmentQrToken(null);
                setSelectedEquipmentId(id);
              }}
              onRefreshGlobalAuditState={refreshAuditState}
              onOpenQrScanner={() => setShowQrScannerModal(true)}
            />
          )}

          {activeTab === 'types' && ['ADMIN', 'ENGINEER'].includes(currentUser.role) && (
            <TypesManager
              currentUser={currentUser}
              types={types}
              onRefreshTypes={fetchTypes}
            />
          )}

          {activeTab === 'transfers' && ['ADMIN', 'ENGINEER'].includes(currentUser.role) && (
            <TransfersManager
              currentUser={currentUser}
              onOpenEquipmentDetail={(id) => {
                setSelectedEquipmentQrToken(null);
                setSelectedEquipmentId(id);
              }}
            />
          )}

          {activeTab === 'writeoffs' && currentUser.role === 'ADMIN' && (
            <WriteoffsManager
              currentUser={currentUser}
              onOpenEquipmentDetail={(id) => {
                setSelectedEquipmentQrToken(null);
                setSelectedEquipmentId(id);
              }}
            />
          )}

          {activeTab === 'rooms' && ['ADMIN', 'ENGINEER'].includes(currentUser.role) && (
            <RoomsManager
              currentUser={currentUser}
              rooms={rooms}
              onRefreshRooms={fetchRooms}
            />
          )}

          {activeTab === 'users' && currentUser.role === 'ADMIN' && (
            <UsersManager currentUser={currentUser} />
          )}

          {activeTab === 'logs' && ['ADMIN', 'ENGINEER'].includes(currentUser.role) && (
            <AuditLogsManager
              currentUser={currentUser}
              onOpenEquipmentDetail={(id) => {
                setSelectedEquipmentQrToken(null);
                setSelectedEquipmentId(id);
              }}
            />
          )}
        </Suspense>
      </main>

      <Suspense fallback={null}>
        {/* Equipment Personal Passport Modal */}
        <EquipmentDetailModal
          equipmentId={selectedEquipmentId}
          qrToken={selectedEquipmentQrToken}
          currentUser={currentUser}
          onClose={() => {
            setSelectedEquipmentId(null);
            setSelectedEquipmentQrToken(null);
          }}
          onEditEquipment={(data) => {
            setEditEquipmentData(data);
            setShowFormModal(true);
          }}
          onDeleteEquipment={handleDeleteEquipment}
          onReloadList={() => setRefreshKey((k) => k + 1)}
          onOpenLogin={() => setShowLoginModal(true)}
        />

        {/* Equipment Create / Edit Form Modal */}
        <EquipmentFormModal
          isOpen={showFormModal}
          onClose={() => {
            setShowFormModal(false);
            setEditEquipmentData(null);
          }}
          onSuccess={() => setRefreshKey((k) => k + 1)}
          onRefreshRooms={fetchRooms}
          initialData={editEquipmentData}
          rooms={rooms}
          types={types}
        />

        {/* Excel Importer Modal */}
        <ExcelImportModal
          isOpen={showExcelModal}
          onClose={() => setShowExcelModal(false)}
          onSuccess={() => {
            setRefreshKey((k) => k + 1);
            fetchRooms();
            fetchTypes();
          }}
          types={types}
        />

        {/* QR Scanner Modal */}
        <QrScannerModal
          isOpen={showQrScannerModal}
          currentUser={currentUser}
          onClose={() => setShowQrScannerModal(false)}
          onSelectEquipmentId={(id, qrToken) => {
            setSelectedEquipmentQrToken(qrToken || null);
            setSelectedEquipmentId(id);
          }}
          onSelectGroupCode={(code, qrToken) => {
            setSelectedGroupQrToken(qrToken || null);
            setSelectedGroupCode(code);
          }}
        />

        {/* Group Detail Modal */}
        <GroupDetailModal
          groupCode={selectedGroupCode}
          qrToken={selectedGroupQrToken}
          onClose={() => {
            setSelectedGroupCode(null);
            setSelectedGroupQrToken(null);
          }}
          onOpenEquipmentDetail={(id, qrToken) => {
            setSelectedEquipmentQrToken(qrToken || null);
            setSelectedEquipmentId(id);
          }}
          currentUser={currentUser}
          onReloadList={refreshNotifications}
        />

        {/* Notifications Panel */}
        <NotificationPanel
          isOpen={showNotifications}
          onClose={() => setShowNotifications(false)}
          notifications={notifications}
          onDismiss={handleDismissNotification}
          onOpenEquipmentDetail={(id) => {
            setSelectedEquipmentQrToken(null);
            setSelectedEquipmentId(id);
          }}
        />
      </Suspense>

      {/* Re-Login Modal */}
      <LoginModal
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        onSuccess={(user) => {
          setCurrentUser(user);
          if (['ADMIN', 'ENGINEER'].includes(user.role)) {
            refreshAuditState();
            refreshNotifications();
            fetchRooms();
            fetchTypes();
          }
        }}
      />

      {/* Change Own Password Modal */}
      <Suspense fallback={null}>
        <ChangePasswordModal
          isOpen={showChangePasswordModal}
          onClose={() => setShowChangePasswordModal(false)}
          currentUser={currentUser}
        />
      </Suspense>
    </div>
  );
}
