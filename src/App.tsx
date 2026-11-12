import { useState, useEffect } from 'react';
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
import { GroupDetailModal } from './components/GroupDetailModal.tsx';
import type { User, Room, EquipmentType, NotificationItem } from './types/index.ts';
import { apiFetch } from './utils/api.ts';

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
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
  const [showNotifications, setShowNotifications] = useState(false);
  const [selectedGroupCode, setSelectedGroupCode] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchRooms = async () => {
    try {
      const roomsRes = await apiFetch('/api/rooms');
      const roomsData = await roomsRes.json();
      if (Array.isArray(roomsData)) {
        setRooms(roomsData);
      } else {
        setRooms([]);
      }
    } catch (e) {
      console.error('Rooms error:', e);
      setRooms([]);
    }
  };

  const fetchTypes = async () => {
    try {
      const typesRes = await apiFetch('/api/equipment-types');
      const typesData = await typesRes.json();
      if (Array.isArray(typesData)) {
        setTypes(typesData);
      } else {
        setTypes([]);
      }
    } catch (e) {
      console.error('Types error:', e);
      setTypes([]);
    }
  };

  // Initial load
  const loadInitialData = async () => {
    // 1. Current user
    try {
      const res = await apiFetch('/api/auth/me');
      const data = await res.json();
      if (data.user) {
        setCurrentUser(data.user);
        localStorage.setItem('auth_user', JSON.stringify(data.user));
      } else {
        // Auto-login as Admin by default for seamless demo exploration
        const loginRes = await apiFetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ login: 'admin', password: 'admin123' }),
        });
        const loginData = await loginRes.json();
        if (loginData.accessToken) {
          localStorage.setItem('auth_token', loginData.accessToken);
        }
        if (loginData.user) {
          localStorage.setItem('auth_user', JSON.stringify(loginData.user));
          setCurrentUser(loginData.user);
        }
      }
    } catch (e) {
      console.error('Auth error:', e);
    }

    // 2. Rooms & Types
    await fetchRooms();
    await fetchTypes();
  };

  const refreshAuditState = async () => {
    try {
      const res = await apiFetch('/api/inventory/current');
      const data = await res.json();
      setHasActiveAudit(Boolean(data.activeInventory));
    } catch (e) {
      console.error(e);
    }
  };

  const refreshNotifications = async () => {
    try {
      const res = await apiFetch('/api/notifications');
      const data = await res.json();
      setNotifications(data || []);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadInitialData();

    // Check URL parameters (e.g. from QR gateway redirect or direct links)
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
    if (fromQrParam && !localStorage.getItem('auth_token')) {
      setShowLoginModal(true);
    }

    // Check URL for direct equipment link (e.g. /equipment/123)
    const pathname = window.location.pathname;
    const match = pathname.match(/\/equipment\/(\d+)/);
    if (match && match[1]) {
      setSelectedEquipmentId(Number(match[1]));
    }
  }, []);

  useEffect(() => {
    if (currentUser) {
      refreshAuditState();
      refreshNotifications();

      // Poll notifications every 30s
      const timer = setInterval(() => {
        refreshNotifications();
        refreshAuditState();
      }, 30000);
      return () => clearInterval(timer);
    }
  }, [currentUser]);

  // Handle Logout
  const handleLogout = async () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    await apiFetch('/api/auth/logout', { method: 'POST' });
    setCurrentUser(null);
    setShowLoginModal(true);
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

        {activeTab === 'users' && <UsersManager />}
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

      {/* Login Modal */}
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
    </div>
  );
}
