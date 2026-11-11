import React from 'react';
import {
  Boxes,
  ClipboardCheck,
  Layers,
  FileSpreadsheet,
  Clock,
  DoorOpen,
  Users,
  QrCode,
  Bell,
  LogOut,
  UserCheck,
} from 'lucide-react';
import type { User } from '../types/index.ts';

interface HeaderProps {
  currentUser: User | null;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  unreadCount: number;
  onOpenNotifications: () => void;
  onOpenQrScanner: () => void;
  onOpenAuth: () => void;
  onLogout: () => void;
  hasActiveAudit: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  currentUser,
  activeTab,
  setActiveTab,
  unreadCount,
  onOpenNotifications,
  onOpenQrScanner,
  onOpenAuth,
  onLogout,
  hasActiveAudit,
}) => {
  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'ADMIN':
        return (
          <span className="bg-red-50 text-red-700 border border-red-200 text-xs font-semibold px-2.5 py-0.5 rounded-full">
            Администратор
          </span>
        );
      case 'ENGINEER':
        return (
          <span className="bg-blue-50 text-blue-700 border border-blue-200 text-xs font-semibold px-2.5 py-0.5 rounded-full">
            Инженер
          </span>
        );
      case 'USER':
      default:
        return (
          <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold px-2.5 py-0.5 rounded-full">
            Пользователь
          </span>
        );
    }
  };

  const navItems = [
    { id: 'equipment', label: 'Оборудование', icon: Boxes },
    ...(currentUser && ['ADMIN', 'ENGINEER'].includes(currentUser.role) && hasActiveAudit
      ? [{ id: 'inventory', label: 'Текущая инвентаризация', icon: ClipboardCheck, alert: true }]
      : currentUser && ['ADMIN', 'ENGINEER'].includes(currentUser.role)
      ? [{ id: 'inventory', label: 'Инвентаризация', icon: ClipboardCheck }]
      : []),
    { id: 'types', label: 'Типы и поля', icon: Layers },
    ...(currentUser && ['ADMIN', 'ENGINEER'].includes(currentUser.role)
      ? [
          { id: 'transfers', label: 'Временное пользование', icon: Clock },
          { id: 'writeoffs', label: 'Списание', icon: FileSpreadsheet },
        ]
      : []),
    { id: 'rooms', label: 'Кабинеты', icon: DoorOpen },
    ...(currentUser?.role === 'ADMIN'
      ? [{ id: 'users', label: 'Пользователи', icon: Users }]
      : []),
  ];

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
      {/* Top Banner */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & System Title */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-700 to-indigo-600 flex items-center justify-center text-white shadow-sm font-bold text-lg">
              ИС
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-bold text-slate-900 text-base sm:text-lg tracking-tight">
                  Учет материальных ценностей
                </h1>
                <span className="hidden sm:inline-block text-[11px] font-mono uppercase bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md font-semibold">
                  Кафедра
                </span>
              </div>
              <p className="text-xs text-slate-500 hidden sm:block">
                PostgreSQL • Drizzle ORM • Инвентаризация и QR-метки
              </p>
            </div>
          </div>

          {/* Right Header Actions */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Quick QR Scanner button */}
            <button
              onClick={onOpenQrScanner}
              title="Сканировать QR-код оборудования"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50/60 hover:bg-indigo-100/80 text-indigo-700 text-xs font-semibold transition-colors"
            >
              <QrCode className="w-4 h-4" />
              <span className="hidden sm:inline">Сканер QR</span>
            </button>

            {/* Notifications (for Admin & Engineer) */}
            {currentUser && ['ADMIN', 'ENGINEER'].includes(currentUser.role) && (
              <button
                onClick={onOpenNotifications}
                title="Уведомления о неисправностях оборудования"
                className="relative p-2 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
              >
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white ring-2 ring-white">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
            )}

            {/* User Profile / Login */}
            {currentUser ? (
              <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
                <div className="text-right hidden sm:block">
                  <div className="text-xs font-semibold text-slate-900 leading-tight">
                    {currentUser.login}
                  </div>
                  <div className="mt-0.5">{getRoleBadge(currentUser.role)}</div>
                </div>
                <button
                  onClick={onLogout}
                  title="Выйти из системы"
                  className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={onOpenAuth}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors"
              >
                <UserCheck className="w-4 h-4" />
                <span>Войти</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Navigation Sub-bar */}
      <div className="border-t border-slate-100 bg-slate-50/70">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex space-x-1 sm:space-x-4 overflow-x-auto py-2 scrollbar-none">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium whitespace-nowrap transition-all ${
                    isActive
                      ? 'bg-white text-blue-700 shadow-xs border border-slate-200/80 font-semibold'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-blue-600' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                  {item.alert && (
                    <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </div>
    </header>
  );
};
