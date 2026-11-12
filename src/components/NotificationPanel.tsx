import React from 'react';
import { X, Bell, Check } from 'lucide-react';
import type { NotificationItem } from '../types/index.ts';

interface NotificationPanelProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: NotificationItem[];
  onDismiss: (id: number) => void;
  onOpenEquipmentDetail: (id: number) => void;
}

export const NotificationPanel: React.FC<NotificationPanelProps> = ({
  isOpen,
  onClose,
  notifications,
  onDismiss,
  onOpenEquipmentDetail,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-xs p-0 sm:p-4 animate-fadeIn">
      <div className="bg-white w-full sm:max-w-md h-full sm:h-auto sm:max-h-[90vh] sm:rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Bell className="w-5 h-5 text-indigo-400" />
            <div>
              <h3 className="font-bold text-sm">Уведомления о неисправностях</h3>
              <p className="text-[11px] text-slate-400">
                Таблица notification (удаление после просмотра)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto space-y-3 flex-1 text-xs">
          {!Array.isArray(notifications) || notifications.length === 0 ? (
            <div className="py-12 text-center text-slate-400">
              <Check className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
              Новых уведомлений о поломках нет
            </div>
          ) : (
            (Array.isArray(notifications) ? notifications : []).map((n) => (
              <div
                key={n.id}
                className="p-3.5 rounded-xl border border-red-200 bg-red-50/40 space-y-2 hover:bg-red-50/70 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                        n.state === 'CRITICAL_ISSUE'
                          ? 'bg-red-600 text-white'
                          : 'bg-amber-500 text-white'
                      }`}
                    >
                      {n.state === 'CRITICAL_ISSUE'
                        ? 'Критическая поломка'
                        : 'Незначительная поломка'}
                    </span>
                    <span className="font-mono text-[10px] text-slate-500 font-semibold">
                      {n.inventoryNumber}
                    </span>
                  </div>
                  <button
                    onClick={() => onDismiss(n.id)}
                    className="text-slate-400 hover:text-slate-700 text-[11px] font-semibold"
                    title="Прочитано (удалить)"
                  >
                    ✕
                  </button>
                </div>

                <div className="font-semibold text-slate-900">{n.equipmentName}</div>
                <p className="text-slate-700 text-[11px] bg-white p-2 rounded-lg border border-slate-100">
                  {n.description}
                </p>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-[10px] text-slate-400">
                    {new Date(n.created_at).toLocaleString('ru-RU')}
                  </span>
                  <button
                    onClick={() => {
                      onOpenEquipmentDetail(n.equipmentId);
                      onDismiss(n.id);
                    }}
                    className="text-xs font-semibold text-blue-600 hover:text-blue-800"
                  >
                    Перейти к паспорту →
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
