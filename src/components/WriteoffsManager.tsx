import React, { useState, useEffect } from 'react';
import {
  FileSpreadsheet,
  AlertTriangle,
  FileText,
  Download,
  CheckCircle2,
  Calendar,
  Building,
  Plus,
  ArrowRight,
  Sparkles,
  RefreshCw,
  X,
} from 'lucide-react';
import type { Equipment, User } from '../types/index.ts';
import { apiFetch } from '../utils/api.ts';

interface WriteoffsManagerProps {
  currentUser: User | null;
  onOpenEquipmentDetail: (id: number) => void;
}

export const WriteoffsManager: React.FC<WriteoffsManagerProps> = ({
  currentUser,
  onOpenEquipmentDetail,
}) => {
  const [items, setItems] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterState, setFilterState] = useState<string>('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [downloadingAct, setDownloadingAct] = useState(false);
  const [downloadingSample, setDownloadingSample] = useState(false);

  // New Write-off Modal state
  const [showNewWriteoffModal, setShowNewWriteoffModal] = useState(false);
  const [availableEquipment, setAvailableEquipment] = useState<Equipment[]>([]);
  const [selectedEqId, setSelectedEqId] = useState<number | ''>('');
  const [targetState, setTargetState] = useState<'PREPARING' | 'DOCUMENTS_PREPARATION' | 'WRITTEN_OFF'>('DOCUMENTS_PREPARATION');
  const [reason, setReason] = useState('Физический и моральный износ, неремонтопригодность');
  const [downloadActAfter, setDownloadActAfter] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const isAdmin = currentUser?.role === 'ADMIN';
  const isEngineer = currentUser?.role === 'ENGINEER';
  const canManage = isAdmin || isEngineer;

  const fetchItems = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('include_written_off', 'true');
      if (filterState) params.set('writeoff_state', filterState);
      params.set('limit', '100');

      const res = await apiFetch(`/api/equipment?${params.toString()}`);
      const data = await res.json();
      // Keep only items that have a writeoff state
      const filtered = (Array.isArray(data?.items) ? data.items : []).filter((i: Equipment) =>
        Boolean(i.writeoffState)
      );
      setItems(filtered);
    } catch (e) {
      console.error(e);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchAvailableEquipment = async () => {
    try {
      const res = await apiFetch('/api/equipment?limit=150');
      const data = await res.json();
      if (Array.isArray(data?.items)) {
        // Exclude items already written off completely
        const active = data.items.filter((i: Equipment) => i.writeoffState !== 'WRITTEN_OFF');
        setAvailableEquipment(active);
        if (active.length > 0 && !selectedEqId) {
          setSelectedEqId(active[0].id);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchItems();
  }, [filterState]);

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const selectAll = () => {
    if (selectedIds.length === items.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(items.map((i) => i.id));
    }
  };

  // Download Sample Act DOCX
  const handleDownloadSampleAct = async () => {
    setDownloadingSample(true);
    try {
      const res = await fetch('/api/writeoff/sample-act');
      if (!res.ok) throw new Error('Ошибка скачивания примера акта');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `primer-akta-spisaniya-kafedry-${new Date().getFullYear()}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      setFeedbackMsg({
        type: 'success',
        text: 'Пример акта списания в формате DOCX успешно загружен на ваш компьютер!',
      });
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message });
    } finally {
      setDownloadingSample(false);
    }
  };

  // Download Act for selected items
  const handleDownloadActForIds = async (ids: number[]) => {
    if (ids.length === 0) return;
    setDownloadingAct(true);
    try {
      const res = await apiFetch('/api/writeoff/generate-act', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ equipment_ids: ids }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Ошибка генерации акта');
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `akt-spisaniya-${ids.length}-ed-${new Date().toISOString().slice(0, 10)}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      setFeedbackMsg({
        type: 'success',
        text: `Акт списания на ${ids.length} ед. оборудования успешно сформирован и скачан!`,
      });
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message });
    } finally {
      setDownloadingAct(false);
    }
  };

  // Submit new writeoff
  const handleSubmitNewWriteoff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEqId) return;

    setActionLoading(true);
    try {
      const updateRes = await apiFetch('/api/writeoff/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipment_ids: [Number(selectedEqId)],
          state: targetState,
          writeoff_date: targetState === 'WRITTEN_OFF' ? new Date().toISOString() : null,
        }),
      });

      const updateData = await updateRes.json();
      if (!updateRes.ok) throw new Error(updateData.error || 'Ошибка списания оборудования');

      setShowNewWriteoffModal(false);
      fetchItems();

      // Download act if requested
      if (downloadActAfter) {
        await handleDownloadActForIds([Number(selectedEqId)]);
      } else {
        setFeedbackMsg({
          type: 'success',
          text: `Статус списания оборудования успешно обновлен на «${
            targetState === 'WRITTEN_OFF'
              ? 'Списано'
              : targetState === 'DOCUMENTS_PREPARATION'
              ? 'Подготовка документов'
              : 'Готовится к списанию'
          }»!`,
        });
      }
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  // Quick change status for single item
  const handleQuickStatusChange = async (
    eqId: number,
    newState: 'PREPARING' | 'DOCUMENTS_PREPARATION' | 'WRITTEN_OFF'
  ) => {
    try {
      const res = await apiFetch('/api/writeoff/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipment_ids: [eqId],
          state: newState,
          writeoff_date: newState === 'WRITTEN_OFF' ? new Date().toISOString() : null,
        }),
      });
      if (!res.ok) throw new Error('Ошибка обновления статуса');
      fetchItems();
      setFeedbackMsg({
        type: 'success',
        text: `Статус списания изменен на «${
          newState === 'WRITTEN_OFF'
            ? 'Списано'
            : newState === 'DOCUMENTS_PREPARATION'
            ? 'Подготовка документов'
            : 'Готовится к списанию'
        }»`,
      });
    } catch (e: any) {
      setFeedbackMsg({ type: 'error', text: e.message });
    }
  };

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* Header */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <FileSpreadsheet className="w-5 h-5 text-red-600" />
            <h2 className="text-lg font-bold text-slate-900">
              Списание материальных ценностей кафедры
            </h2>
          </div>
          <p className="text-xs text-slate-500">
            Жизненный цикл списания: <strong>Готовится</strong> (PREPARING) →{' '}
            <strong>Подготовка документов</strong> (DOCUMENTS_PREPARATION) →{' '}
            <strong>Списано с баланса</strong> (WRITTEN_OFF) с официальным Актом DOCX.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Download Sample Act button */}
          <button
            onClick={handleDownloadSampleAct}
            disabled={downloadingSample}
            title="Скачать готовый пример официального акта о списании кафедры"
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-semibold shadow-2xs transition-colors inline-flex items-center gap-1.5 border border-slate-300"
          >
            <Download className="w-4 h-4 text-slate-600" />
            {downloadingSample ? 'Формирование...' : 'Скачать пример Акта списания (.docx)'}
          </button>

          {/* New Writeoff Action button */}
          {canManage && (
            <button
              onClick={() => {
                fetchAvailableEquipment();
                setShowNewWriteoffModal(true);
              }}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors inline-flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              Оформить списание оборудования
            </button>
          )}

          {/* Filter */}
          <select
            value={filterState}
            onChange={(e) => setFilterState(e.target.value)}
            className="text-xs p-2 border border-slate-200 rounded-xl bg-slate-50 outline-none"
          >
            <option value="">Все статусы списания</option>
            <option value="PREPARING">Готовится к списанию</option>
            <option value="DOCUMENTS_PREPARATION">В процессе (подготовка документов)</option>
            <option value="WRITTEN_OFF">Списано с баланса</option>
          </select>
        </div>
      </div>

      {/* Feedback Alert */}
      {feedbackMsg && (
        <div
          className={`p-3.5 rounded-xl border text-xs font-medium flex items-center justify-between gap-2 ${
            feedbackMsg.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedbackMsg.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            )}
            <span>{feedbackMsg.text}</span>
          </div>
          <button
            onClick={() => setFeedbackMsg(null)}
            className="text-slate-400 hover:text-slate-600"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Bulk Action Bar (when items selected) */}
      {selectedIds.length > 0 && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 font-semibold text-red-900">
            <span>Выбрано позиций для списания: {selectedIds.length}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => handleDownloadActForIds(selectedIds)}
              disabled={downloadingAct}
              className="px-3.5 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors inline-flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              {downloadingAct ? 'Генерация...' : `Сформировать Акт на ${selectedIds.length} ед. (DOCX)`}
            </button>
            {canManage && (
              <button
                onClick={async () => {
                  try {
                    await apiFetch('/api/writeoff/update-status', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        equipment_ids: selectedIds,
                        state: 'WRITTEN_OFF',
                        writeoff_date: new Date().toISOString(),
                      }),
                    });
                    setSelectedIds([]);
                    fetchItems();
                    setFeedbackMsg({
                      type: 'success',
                      text: `Выбранное оборудование (${selectedIds.length} ед.) переведено в статус «Списано»!`,
                    });
                  } catch (e: any) {
                    setFeedbackMsg({ type: 'error', text: e.message });
                  }
                }}
                className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold shadow-xs"
              >
                Перевести в «Списано»
              </button>
            )}
            <button
              onClick={() => setSelectedIds([])}
              className="px-2.5 py-1.5 text-slate-600 hover:text-slate-900 font-medium"
            >
              Снять выбор
            </button>
          </div>
        </div>
      )}

      {/* List */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-xs">
            Загрузка списка списания...
          </div>
        ) : !Array.isArray(items) || items.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mx-auto">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Оборудование в процессе списания не найдено. Нажмите «Оформить списание оборудования» или перейдите в паспорт оборудования.
            </p>
            {canManage && (
              <button
                onClick={() => {
                  fetchAvailableEquipment();
                  setShowNewWriteoffModal(true);
                }}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold shadow-xs inline-flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                Оформить списание
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-slate-100 text-xs">
            <div className="p-3 bg-slate-50 text-slate-500 font-semibold flex items-center justify-between text-[11px]">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedIds.length === items.length && items.length > 0}
                  onChange={selectAll}
                  className="rounded text-blue-600 cursor-pointer"
                />
                <span>Выбрать все ({items.length} ед.)</span>
              </div>
              <span>Действия со списанием и документами</span>
            </div>

            {items.map((item) => {
              const isSelected = selectedIds.includes(item.id);
              return (
                <div
                  key={item.id}
                  className={`p-4 hover:bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                    isSelected ? 'bg-indigo-50/40' : ''
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(item.id)}
                      className="rounded text-blue-600 cursor-pointer"
                    />
                    <span className="font-mono font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-[11px]">
                      {item.inventory_number}
                    </span>
                    <div>
                      <button
                        onClick={() => onOpenEquipmentDetail(item.id)}
                        className="font-bold text-slate-900 hover:text-blue-600 text-left text-sm"
                      >
                        {item.name}
                      </button>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {item.typeName} • Кабинет: {item.roomNumber} • Балансовая стоимость:{' '}
                        {Number(item.initial_cost).toLocaleString('ru-RU')} ₽
                        {item.writeoffDate && (
                          <span className="ml-2 text-slate-400">
                            (Дата списания: {new Date(item.writeoffDate).toLocaleDateString('ru-RU')})
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <span
                      className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${
                        item.writeoffState === 'WRITTEN_OFF'
                          ? 'bg-slate-200 text-slate-800'
                          : item.writeoffState === 'DOCUMENTS_PREPARATION'
                          ? 'bg-purple-100 text-purple-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {item.writeoffState === 'WRITTEN_OFF'
                        ? 'Списано'
                        : item.writeoffState === 'DOCUMENTS_PREPARATION'
                        ? 'Подготовка документов'
                        : 'Готовится к списанию'}
                    </span>

                    {/* Download Act for this specific item */}
                    <button
                      onClick={() => handleDownloadActForIds([item.id])}
                      className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 rounded-lg text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                      title="Сформировать и скачать официальный акт списания для данной единицы оборудования"
                    >
                      <Download className="w-3.5 h-3.5 text-emerald-600" />
                      Акт (.docx)
                    </button>

                    {/* Quick status transitions for admins and engineers */}
                    {canManage && item.writeoffState !== 'WRITTEN_OFF' && (
                      <button
                        onClick={() => handleQuickStatusChange(item.id, 'WRITTEN_OFF')}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium"
                        title="Подтвердить окончательное списание"
                      >
                        Завершить списание
                      </button>
                    )}

                    <button
                      onClick={() => onOpenEquipmentDetail(item.id)}
                      className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold"
                    >
                      Паспорт
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* New Write-off Modal */}
      {showNewWriteoffModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-red-600" />
                <h3 className="font-bold text-base text-slate-900">
                  Оформление списания оборудования
                </h3>
              </div>
              <button
                onClick={() => setShowNewWriteoffModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitNewWriteoff} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Выберите единицу оборудования для списания:
                </label>
                <select
                  value={selectedEqId}
                  onChange={(e) => setSelectedEqId(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full p-2.5 border border-slate-300 rounded-xl outline-none"
                  required
                >
                  <option value="">-- Выберите оборудование из баланса --</option>
                  {availableEquipment.map((eq) => (
                    <option key={eq.id} value={eq.id}>
                      [{eq.inventory_number}] {eq.name} (каб. {eq.roomNumber}, {Number(eq.initial_cost).toLocaleString('ru-RU')} ₽)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Статус жизненного цикла списания:
                </label>
                <select
                  value={targetState}
                  onChange={(e: any) => setTargetState(e.target.value)}
                  className="w-full p-2.5 border border-slate-300 rounded-xl outline-none font-medium"
                >
                  <option value="PREPARING">Готовится к списанию (PREPARING)</option>
                  <option value="DOCUMENTS_PREPARATION">
                    В процессе списания — подготовка документов (DOCUMENTS_PREPARATION)
                  </option>
                  <option value="WRITTEN_OFF">Окончательно списано с баланса (WRITTEN_OFF)</option>
                </select>
                <p className="text-[11px] text-slate-500 mt-1">
                  {targetState === 'DOCUMENTS_PREPARATION'
                    ? 'При этом статусе генерируется комплект документов и комиссионный акт списания.'
                    : targetState === 'WRITTEN_OFF'
                    ? 'Оборудование полностью выводится из эксплуатации и снимается с материального учета.'
                    : 'Предварительное согласование перед списанием.'}
                </p>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Причина списания:
                </label>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Например: Моральный и физический износ, неремонтопригодность"
                  className="w-full p-2.5 border border-slate-300 rounded-xl outline-none"
                  required
                />
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                <label className="flex items-center gap-2 cursor-pointer font-semibold text-slate-800">
                  <input
                    type="checkbox"
                    checked={downloadActAfter}
                    onChange={(e) => setDownloadActAfter(e.target.checked)}
                    className="rounded text-blue-600"
                  />
                  <span>Сразу сформировать и скачать официальный Акт списания (DOCX)</span>
                </label>
                <p className="text-[11px] text-slate-500 ml-5 mt-0.5">
                  Файл акта будет сгенерирован со всеми реквизитами, табличной частью и строкой подписей комиссии.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowNewWriteoffModal(false)}
                  className="px-4 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl font-semibold"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={actionLoading || !selectedEqId}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold shadow-xs flex items-center gap-1.5"
                >
                  {downloadActAfter ? <Download className="w-4 h-4" /> : <FileSpreadsheet className="w-4 h-4" />}
                  {actionLoading ? 'Обработка...' : downloadActAfter ? 'Списать и скачать Акт (.docx)' : 'Подтвердить статус'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
