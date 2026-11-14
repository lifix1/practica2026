import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Header } from './components/Header.tsx';
import { EquipmentList } from './components/EquipmentList.tsx';
import { EquipmentDetailModal } from './components/EquipmentDetailModal.tsx';
import { EquipmentFormModal } from './components/EquipmentFormModal.tsx';
import { ExcelImportModal } from './components/ExcelImportModal.tsx';
import { QrScannerModal } from './components/QrScannerModal.tsx';
import { InventoryManager } from './components/InventoryManager.tsx';
import { TypesManager } from './components/TypesManager.tsx';
import { TransfersManager } from './components/TransfersManager.tsx';
import { WriteoffsManager } from './components/WriteoffsManager.tsx';
import { RoomsManager } from './components/RoomsManager.tsx';
import { UsersManager } from './components/UsersManager.tsx';
import { NotificationPanel } from './components/NotificationPanel.tsx';
import { LoginModal } from './components/LoginModal.tsx';
import { ChangePasswordModal } from './components/ChangePasswordModal.tsx';
import { GroupDetailModal } from './components/GroupDetailModal.tsx';
import { AuditLogsManager } from './components/AuditLogsManager.tsx';
import type { User, Room, EquipmentType, NotificationItem } from './types/index.ts';
import { apiFetch, clearSessionAuth, setSessionAuth } from './utils/api.ts';

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
  const [editEquipmentData, setEditEquipmentData] = useState<any | null>(null);
  const [showFormModal, setShowFormModal] = useState(false);
  const [showExcelModal, setShowExcelModal] = useState(false);
  const [showQrScannerModal, setShowQrScannerModal] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [selectedGroupCode, setSelectedGroupCode] = useState<string | null>(null);
  const [pendingQrCode, setPendingQrCode] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchRooms = useCallback(async () => {
    try {
      const roomsRes = await apiFetch('/api/rooms');
      if (!roomsRes.ok) {
        setRooms([]);
        return;
      }
      const roomsData = await roomsRes.json();
      setRooms(Array.isArray(roomsData) ? roomsData : []);
    } catch (e) {
      console.error('Rooms error:', e);
      setRooms([]);
    }
  }, []);

  const fetchTypes = useCallback(async () => {
    try {
      const typesRes = await apiFetch('/api/equipment-types');
      if (!typesRes.ok) {
        setTypes([]);
        return;
      }
      const typesData = await typesRes.json();
      setTypes(Array.isArray(typesData) ? typesData : []);
    } catch (e) {
      console.error('Types error:', e);
      setTypes([]);
    }
  }, []);

  const refreshAuditState = useCallback(async () => {
    try {
      const res = await apiFetch('/api/inventory/current');
      if (!res.ok) return;
      const data = await res.json();
      setHasActiveAudit(Boolean(data.activeInventory));
    } catch (e) {
      console.error(e);
    }
  }, []);

  const refreshNotifications = useCallback(async () => {
    try {
      const res = await apiFetch('/api/notifications');
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
    }
  }, []);

  // Verify existing session without any auto-login fallback
  const loadInitialSession = useCallback(async () => {
    setAuthChecking(true);
    try {
      const res = await apiFetch('/api/auth/me');
      const data = await res.json().catch(() => ({ user: null }));
      if (data.user) {
        setCurrentUser(data.user);
        setSessionAuth(null, data.user);
      } else {
        clearSessionAuth();
        setCurrentUser(null);
      }
    } catch (e) {
      console.error('Auth error:', e);
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
    const openEqParam = urlParams.get('openEquipment');
    if (openEqParam) {
      const num = Number(openEqParam);
      if (!isNaN(num) && num > 0) setSelectedEquipmentId(num);
    }

    const openGrpParam = urlParams.get('openGroup');
    if (openGrpParam) {
      setSelectedGroupCode(openGrpParam);
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
          return res.json();
        })
        .then((resolved) => {
          if (cancelled || !resolved) return;
          if (resolved.kind === 'group' && resolved.code) {
            setSelectedGroupCode(resolved.code);
          } else if (resolved.kind === 'equipment' && resolved.id) {
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
    if (currentUser) {
      fetchRooms();
      fetchTypes();
      refreshAuditState();
      refreshNotifications();

      const timer = setInterval(() => {
        refreshNotifications();
        refreshAuditState();
      }, 30000);
      return () => clearInterval(timer);
    }
  }, [currentUser, fetchRooms, fetchTypes, refreshAuditState, refreshNotifications]);

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
        {activeTab === 'equipment' && (
          <EquipmentList
            currentUser={currentUser}
            onOpenEquipmentDetail={(id) => setSelectedEquipmentId(id)}
            onOpenCreateEquipment={() => {
              setEditEquipmentData(null);
              setShowFormModal(true);
            }}
            onOpenExcelImport={() => setShowExcelModal(true)}
            onOpenGroupDetail={(code) => setSelectedGroupCode(code)}
            rooms={rooms}
            types={types}
            refreshKey={refreshKey}
          />
        )}

        {activeTab === 'inventory' && (
          <InventoryManager
            currentUser={currentUser}
            onOpenEquipmentDetail={(id) => setSelectedEquipmentId(id)}
            onRefreshGlobalAuditState={refreshAuditState}
            onOpenQrScanner={() => setShowQrScannerModal(true)}
          />
        )}

        {activeTab === 'types' && (
          <TypesManager
            currentUser={currentUser}
            types={types}
            onRefreshTypes={fetchTypes}
          />
        )}

        {activeTab === 'transfers' && (
          <TransfersManager
            currentUser={currentUser}
            onOpenEquipmentDetail={(id) => setSelectedEquipmentId(id)}
          />
        )}

        {activeTab === 'writeoffs' && (
          <WriteoffsManager
            currentUser={currentUser}
            onOpenEquipmentDetail={(id) => setSelectedEquipmentId(id)}
          />
        )}

        {activeTab === 'rooms' && (
          <RoomsManager
            currentUser={currentUser}
            rooms={rooms}
            onRefreshRooms={fetchRooms}
          />
        )}

        {activeTab === 'users' && <UsersManager currentUser={currentUser} />}

        {activeTab === 'logs' && (
          <AuditLogsManager
            currentUser={currentUser}
            onOpenEquipmentDetail={(id) => setSelectedEquipmentId(id)}
          />
        )}
      </main>

      {/* Equipment Personal Passport Modal */}
      <EquipmentDetailModal
        equipmentId={selectedEquipmentId}
        currentUser={currentUser}
        onClose={() => setSelectedEquipmentId(null)}
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
        onClose={() => setShowQrScannerModal(false)}
        onSelectEquipmentId={(id) => setSelectedEquipmentId(id)}
        onSelectGroupCode={(code) => setSelectedGroupCode(code)}
      />

      {/* Group Detail Modal */}
      <GroupDetailModal
        groupCode={selectedGroupCode}
        onClose={() => setSelectedGroupCode(null)}
        onOpenEquipmentDetail={(id) => setSelectedEquipmentId(id)}
        currentUser={currentUser}
        onReloadList={refreshNotifications}
      />

      {/* Notifications Panel */}
      <NotificationPanel
        isOpen={showNotifications}
        onClose={() => setShowNotifications(false)}
        notifications={notifications}
        onDismiss={handleDismissNotification}
        onOpenEquipmentDetail={(id) => setSelectedEquipmentId(id)}
      />

      {/* Re-Login Modal */}
      <LoginModal
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        onSuccess={(user) => {
          setCurrentUser(user);
          refreshAuditState();
          refreshNotifications();
          fetchRooms();
          fetchTypes();
        }}
      />

      {/* Change Own Password Modal */}
      <ChangePasswordModal
        isOpen={showChangePasswordModal}
        onClose={() => setShowChangePasswordModal(false)}
        currentUser={currentUser}
      />
    </div>
  );
}
