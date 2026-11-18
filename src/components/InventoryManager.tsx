import React, { useState, useEffect } from 'react';
import {
  ClipboardCheck,
  CheckCircle2,
  QrCode,
  AlertCircle,
  Play,
  Check,
  CheckCheck,
  History,
  DoorOpen,
} from 'lucide-react';
import type { User, ActiveAudit, InventoryHistoryItem } from '../types/index.ts';
import { apiFetch } from '../utils/api.ts';

interface InventoryManagerProps {
  currentUser: User | null;
  onOpenEquipmentDetail: (id: number) => void;
  onRefreshGlobalAuditState: () => void;
  onOpenQrScanner?: () => void;
}

export const InventoryManager: React.FC<InventoryManagerProps> = ({
  currentUser,
  onOpenEquipmentDetail,
  onRefreshGlobalAuditState,
  onOpenQrScanner,
}) => {
  const [activeAudit, setActiveAudit] = useState<ActiveAudit | null>(null);
  const [unverifiedItems, setUnverifiedItems] = useState<any[]>([]);
  const [auditHistory, setAuditHistory] = useState<InventoryHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fetchAuditHistory = async () => {
    try {
      const res = await apiFetch('/api/inventory/history');
      if (res.ok) {
        const data = await res.json();
        setAuditHistory(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      console.error('Inventory history error:', e);
    }
  };

  const fetchActiveAudit = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/inventory/current');
      const data = await res.json();
      setActiveAudit(data.activeInventory || null);

      if (data.activeInventory) {
        const unvRes = await apiFetch('/api/inventory/current/unverified');
        const unvData = await unvRes.json();
        setUnverifiedItems(Array.isArray(unvData) ? unvData : []);
      } else {
        setUnverifiedItems([]);
      }
      fetchAuditHistory();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchActiveAudit();
  }, []);

  // Start new inventory event
  const handleStartInventory = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/inventory/start', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Ошибка запуска инвентаризации');
      }

      setSuccessMsg('Событие инвентаризации успешно начато!');
      fetchActiveAudit();
      onRefreshGlobalAuditState();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Verify single item ("Проверено")
  const handleVerifyItem = async (equipmentId: number) => {
    if (!activeAudit) return;
    try {
      const res = await apiFetch(
        `/api/inventory/${activeAudit.id}/verify/${equipmentId}`,
        { method: 'POST' }
      );
      if (!res.ok) throw new Error('Ошибка подтверждения верификации');

      // Optimistic update
      setUnverifiedItems((prev) => prev.filter((i) => i.id !== equipmentId));
      setActiveAudit((prev) =>
        prev
          ? {
              ...prev,
              verifiedCount: prev.verifiedCount + 1,
              pendingCount: Math.max(0, prev.pendingCount - 1),
            }
          : null
      );
      onRefreshGlobalAuditState();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const [showFinishConfirmModal, setShowFinishConfirmModal] = useState(false);

  // Finish inventory action
  const confirmFinishInventory = async () => {
    if (!activeAudit) return;
    setLoading(true);
    setShowFinishConfirmModal(false);
    try {
      const res = await apiFetch(`/api/inventory/${activeAudit.id}/finish`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка завершения инвентаризации');

      setSuccessMsg(`Инвентаризация успешно завершена! Проверено: ${activeAudit.verifiedCount} из ${activeAudit.totalCount}.`);
      setActiveAudit(null);
      setUnverifiedItems([]);
      fetchActiveAudit();
      onRefreshGlobalAuditState();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFinishInventory = () => {
    if (!activeAudit) return;
    setShowFinishConfirmModal(true);
  };

  const progressPercent = activeAudit
    ? Math.round((activeAudit.verifiedCount / (activeAudit.totalCount || 1)) * 100)
    : 0;

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Title & Status */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ClipboardCheck className="w-6 h-6 text-indigo-600" />
            <h2 className="text-lg font-bold text-slate-900">
              Инвентаризация оборудования кафедры
            </h2>
          </div>
          <p className="text-xs text-slate-500 max-w-xl">
            Фиксация наличия материальных ценностей аудитором ({currentUser?.login}).
            Сканируйте QR-коды на оборудовании или отмечайте проверенное вручную.
          </p>
        </div>

        {activeAudit ? (
          <div className="flex flex-wrap items-center gap-2.5">
            {onOpenQrScanner && (
              <button
                onClick={onOpenQrScanner}
                className="px-4 py-2 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 font-bold rounded-xl text-xs transition-colors inline-flex items-center gap-1.5"
              >
                <QrCode className="w-4 h-4" />
                Сканировать QR
              </button>
            )}
            <button
              onClick={handleFinishInventory}
              disabled={loading}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs shadow-xs transition-colors inline-flex items-center gap-1.5"
            >
              <CheckCheck className="w-4 h-4" />
              Завершить инвентаризацию
            </button>
          </div>
        ) : (
          <button
            onClick={handleStartInventory}
            disabled={loading}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs shadow-xs transition-colors inline-flex items-center gap-2"
          >
            <Play className="w-4 h-4" />
            Начать новую инвентаризацию
          </button>
        )}
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Active Audit Dashboard */}
      {activeAudit ? (
        <div className="space-y-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <div>
                <span className="font-bold text-slate-800">
                  Инвентаризация № {activeAudit.id}
                </span>
                <span className="text-slate-500 ml-2">
                  (Начата:{' '}
                  {new Date(activeAudit.started_at).toLocaleString('ru-RU')})
                </span>
              </div>
              <div className="flex items-center gap-4 text-xs font-semibold tabular-nums">
                <span className="text-emerald-700">
                  Проверено: {activeAudit.verifiedCount}
                </span>
                <span className="text-amber-700">
                  Осталось: {activeAudit.pendingCount}
                </span>
                <span className="text-slate-600">
                  Всего: {activeAudit.totalCount}
                </span>
              </div>
            </div>

            {/* Progress Bar */}
            <div>
              <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden shadow-inner">
                <div
                  className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                  style={{ width: `${activeAudit.totalCount === 0 ? 100 : progressPercent}%` }}
                />
              </div>
              <div className="text-right text-[11px] text-slate-500 mt-1 font-semibold tabular-nums">
                Прогресс проверки: {activeAudit.totalCount === 0 ? 100 : progressPercent}%
              </div>
            </div>
          </div>

          {/* List of remaining equipment to verify grouped by rooms */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-bold text-xs sm:text-sm text-slate-800">
                Оборудование, еще не прошедшее верификацию ({unverifiedItems.length})
              </h3>
              <span className="text-xs text-slate-500">
                Сгруппировано по аудиториям
              </span>
            </div>

            {activeAudit.totalCount === 0 ? (
              <div className="p-12 text-center text-slate-500 text-xs">
                <ClipboardCheck className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                <div className="font-bold text-slate-700 text-sm">
                  В базе данных пока нет активного оборудования
                </div>
                <p className="mt-1">
                  Добавьте материальные ценности во вкладке «Оборудование» или завершите текущую проверку.
                </p>
              </div>
            ) : unverifiedItems.length === 0 ? (
              <div className="p-12 text-center text-slate-400 text-xs">
                <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-2" />
                <div className="font-bold text-slate-700 text-sm">
                  Все единицы оборудования проверены!
                </div>
                <p className="mt-1">
                  Нажмите кнопку «Завершить инвентаризацию» выше для фиксации итогов.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {(() => {
                  const grouped = new Map<string, any[]>();
                  for (const item of unverifiedItems) {
                    const roomKey = String(item.roomNumber || 'Без кабинета');
                    const arr = grouped.get(roomKey) || [];
                    arr.push(item);
                    grouped.set(roomKey, arr);
                  }
                  return Array.from(grouped.entries()).map(([roomNum, roomItems]) => (
                    <div key={roomNum}>
                      <div className="px-4 py-2 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between text-xs">
                        <span className="font-bold text-slate-700 inline-flex items-center gap-1.5">
                          <DoorOpen className="w-3.5 h-3.5 text-indigo-600" />
                          Аудитория № {roomNum}
                        </span>
                        <span className="text-[11px] font-semibold text-slate-500 tabular-nums">
                          Осталось: {roomItems.length} ед.
                        </span>
                      </div>
                      <div className="divide-y divide-slate-100">
                        {roomItems.map((item) => (
                          <div
                            key={item.id}
                            className="p-3.5 hover:bg-slate-50 flex items-center justify-between gap-4 text-xs transition-colors"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="font-mono font-bold bg-slate-100 text-slate-800 px-2 py-0.5 rounded text-[11px] shrink-0 tabular-nums">
                                {item.inventory_number || 'б/н'}
                              </span>
                              <div className="min-w-0">
                                <button
                                  onClick={() => onOpenEquipmentDetail(item.id)}
                                  className="font-semibold text-slate-900 hover:text-blue-600 text-left truncate block max-w-full"
                                >
                                  {item.name}
                                </button>
                                <div className="text-[11px] text-slate-500 mt-0.5">
                                  {item.typeName || 'Без типа'} • {item.roomNumber ? `Ауд. ${item.roomNumber}` : 'Без помещения'}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                onClick={() => onOpenEquipmentDetail(item.id)}
                                className="px-2.5 py-1 border border-slate-200 hover:bg-slate-100 text-slate-600 rounded-lg text-xs transition-colors inline-flex items-center gap-1"
                              >
                                <QrCode className="w-3.5 h-3.5 text-indigo-600" />
                                <span>Паспорт</span>
                              </button>
                              <button
                                onClick={() => handleVerifyItem(item.id)}
                                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-xs shadow-xs transition-colors inline-flex items-center gap-1"
                              >
                                <Check className="w-3.5 h-3.5" />
                                <span>Проверено</span>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ));
                })()}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 mx-auto shadow-xs">
            <ClipboardCheck className="w-8 h-8" />
          </div>
          <div className="max-w-md mx-auto">
            <h3 className="font-bold text-slate-900 text-base">
              Нет активной инвентаризации
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Нажмите кнопку «Начать новую инвентаризацию», чтобы инициировать аудит.
              Все текущее оборудование получит статус не прошедшего проверку, и появится
              список для сверки.
            </p>
          </div>
          <button
            onClick={handleStartInventory}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs shadow-xs transition-colors inline-flex items-center gap-2"
          >
            <Play className="w-4 h-4" />
            Начать инвентаризацию
          </button>
        </div>
      )}

      {/* Completed Inventories History */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-bold text-xs sm:text-sm text-slate-800 flex items-center gap-2">
            <History className="w-4 h-4 text-slate-600" />
            История завершённых инвентаризаций
          </h3>
          <span className="text-[11px] text-slate-500 tabular-nums">
            Записей: {auditHistory.length}
          </span>
        </div>
        {auditHistory.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">
            Завершённых инвентаризаций пока нет
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/50 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="p-3">№</th>
                  <th className="p-3">Аудитор</th>
                  <th className="p-3">Начало</th>
                  <th className="p-3">Завершение</th>
                  <th className="p-3">Проверено</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {auditHistory.map((h) => {
                  const pct = h.totalCount > 0 ? Math.round((h.verifiedCount / h.totalCount) * 100) : 100;
                  return (
                    <tr key={h.id} className="hover:bg-slate-50/60">
                      <td className="p-3 font-mono font-bold text-slate-700">#{h.id}</td>
                      <td className="p-3 font-medium text-slate-900">{h.auditorLogin || `ID ${h.auditor_ext_id}`}</td>
                      <td className="p-3 text-slate-600">{new Date(h.started_at).toLocaleString('ru-RU')}</td>
                      <td className="p-3 text-slate-600">{new Date(h.finished_at).toLocaleString('ru-RU')}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded font-semibold text-[11px] ${
                          h.pendingCount === 0
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-amber-50 text-amber-800 border border-amber-200'
                        }`}>
                          {h.verifiedCount} из {h.totalCount} ({pct}%)
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Finish Confirmation Modal */}
      {showFinishConfirmModal && activeAudit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
                <CheckCheck className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-900">
                  Завершить инвентаризацию?
                </h3>
                <p className="text-xs text-slate-500">
                  Инвентаризационное событие № {activeAudit.id}
                </p>
              </div>
            </div>

            <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 space-y-2 text-xs">
              <div className="flex justify-between text-slate-700">
                <span>Проверено и подтверждено:</span>
                <span className="font-bold text-emerald-700">
                  {activeAudit.verifiedCount} из {activeAudit.totalCount} ({progressPercent}%)
                </span>
              </div>
              <div className="flex justify-between text-slate-700">
                <span>Осталось без проверки:</span>
                <span className={`font-bold ${activeAudit.pendingCount > 0 ? 'text-amber-600' : 'text-slate-500'}`}>
                  {activeAudit.pendingCount} ед.
                </span>
              </div>
              {activeAudit.pendingCount > 0 && (
                <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-[11px] mt-1">
                  Обратите внимание: часть оборудования не была верифицирована. При завершении результаты проверки будут зафиксированы.
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowFinishConfirmModal(false)}
                className="px-4 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={confirmFinishInventory}
                disabled={loading}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5"
              >
                <CheckCheck className="w-4 h-4" />
                {loading ? 'Завершение...' : 'Подтвердить и завершить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
