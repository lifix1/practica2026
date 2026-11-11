import React, { useState, useEffect } from 'react';
import {
  Search,
  Filter,
  Plus,
  FileSpreadsheet,
  QrCode,
  FileText,
  AlertTriangle,
  ArrowRightLeft,
  ChevronLeft,
  ChevronRight,
  CheckSquare,
  Square,
  RefreshCw,
  Building,
  Layers,
  Calendar,
  Boxes,
} from 'lucide-react';
import type { Equipment, EquipmentType, Room, User, AdditionalField } from '../types/index.ts';
import { apiFetch } from '../utils/api.ts';
import { GroupQrModal } from './GroupQrModal.tsx';

interface EquipmentListProps {
  currentUser: User | null;
  onOpenEquipmentDetail: (id: number) => void;
  onOpenCreateEquipment: () => void;
  onOpenExcelImport: () => void;
  onOpenGroupDetail?: (code: string) => void;
  rooms: Room[];
  types: EquipmentType[];
}

export const EquipmentList: React.FC<EquipmentListProps> = ({
  currentUser,
  onOpenEquipmentDetail,
  onOpenCreateEquipment,
  onOpenExcelImport,
  onOpenGroupDetail,
  rooms,
  types,
}) => {
  const [items, setItems] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const limit = 15;

  // Filter states
  const [search, setSearch] = useState('');
  const [selectedTypeId, setSelectedTypeId] = useState<string>('');
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');
  const [receivedFrom, setReceivedFrom] = useState('');
  const [receivedTo, setReceivedTo] = useState('');
  const [includeWrittenOff, setIncludeWrittenOff] = useState(false);
  const [hasUnrepairedIssue, setHasUnrepairedIssue] = useState(false);
  const [activeTransferOnly, setActiveTransferOnly] = useState(false);

  // Dynamic field filter
  const [typeFields, setTypeFields] = useState<AdditionalField[]>([]);
  const [customFieldCode, setCustomFieldCode] = useState('');
  const [customFieldValue, setCustomFieldValue] = useState('');

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [generatingQrDocx, setGeneratingQrDocx] = useState(false);

  // Bulk Writeoff Modal
  const [showWriteoffModal, setShowWriteoffModal] = useState(false);
  const [writeoffState, setWriteoffState] = useState<'PREPARING' | 'DOCUMENTS_PREPARATION' | 'WRITTEN_OFF'>('PREPARING');

  // Bulk Transfer Modal
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferIssuedTo, setTransferIssuedTo] = useState('');
  const [transferExpectedDate, setTransferExpectedDate] = useState('');

  // Group QR Modal
  const [showGroupQrModal, setShowGroupQrModal] = useState(false);

  const isAdmin = currentUser?.role === 'ADMIN';
  const isEngineer = currentUser?.role === 'ENGINEER';

  // Fetch when filters or page changes
  const fetchEquipment = () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', String(limit));
    if (search.trim()) params.set('search', search.trim());
    if (selectedTypeId) params.set('type_id', selectedTypeId);
    if (selectedRoomId) params.set('room_id', selectedRoomId);
    if (receivedFrom) params.set('received_from', receivedFrom);
    if (receivedTo) params.set('received_to', receivedTo);
    if (includeWrittenOff) params.set('include_written_off', 'true');
    if (hasUnrepairedIssue) params.set('has_unrepaired_issue', 'true');
    if (activeTransferOnly) params.set('active_transfer', 'true');
    if (customFieldCode && customFieldValue) {
      params.set('custom_field_code', customFieldCode);
      params.set('custom_field_value', customFieldValue);
    }

    apiFetch(`/api/equipment?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        setItems(Array.isArray(data?.items) ? data.items : []);
        setTotal(data?.total || 0);
        setTotalPages(data?.totalPages || 1);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchEquipment();
  }, [
    page,
    search,
    selectedTypeId,
    selectedRoomId,
    receivedFrom,
    receivedTo,
    includeWrittenOff,
    hasUnrepairedIssue,
    activeTransferOnly,
    customFieldCode,
    customFieldValue,
  ]);

  // When type changes for dynamic field filter
  useEffect(() => {
    if (!selectedTypeId) {
      setTypeFields([]);
      setCustomFieldCode('');
      setCustomFieldValue('');
      return;
    }
    apiFetch(`/api/equipment-types/${selectedTypeId}/fields`)
      .then((r) => r.json())
      .then((fields: AdditionalField[]) => setTypeFields(Array.isArray(fields) ? fields : []))
      .catch(console.error);
  }, [selectedTypeId]);

  // Selection toggle
  const toggleSelectAll = () => {
    const list = Array.isArray(items) ? items : [];
    if (selectedIds.length === list.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(list.map((i) => i.id));
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  // Generate QR Codes DOCX file (PDF page 3 requirement)
  const handleGenerateQrDocx = async () => {
    if (selectedIds.length === 0) return;
    setGeneratingQrDocx(true);
    try {
      const res = await apiFetch('/api/equipment/qr-docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ equipment_ids: selectedIds }),
      });

      if (!res.ok) throw new Error('Ошибка генерации DOCX');

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `equipment-qr-codes-${new Date().toISOString().slice(0, 10)}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setGeneratingQrDocx(false);
    }
  };

  // Generate Writeoff Act DOCX (PDF page 10-11)
  const handleGenerateWriteoffAct = async () => {
    if (selectedIds.length === 0) return;
    try {
      const res = await apiFetch('/api/writeoff/generate-act', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ equipment_ids: selectedIds }),
      });

      if (!res.ok) throw new Error('Ошибка генерации акта списания');

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `akt-spisaniya-${new Date().toISOString().slice(0, 10)}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Bulk update writeoff status
  const handleBulkWriteoffSubmit = async () => {
    if (selectedIds.length === 0) return;
    try {
      const res = await apiFetch('/api/writeoff/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipment_ids: selectedIds,
          state: writeoffState,
          writeoff_date: writeoffState === 'WRITTEN_OFF' ? new Date().toISOString() : null,
        }),
      });

      if (!res.ok) throw new Error('Ошибка обновления статуса списания');
      setShowWriteoffModal(false);
      setSelectedIds([]);
      fetchEquipment();
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Bulk Transfer submit
  const handleBulkTransferSubmit = async () => {
    if (selectedIds.length === 0 || !transferIssuedTo.trim()) return;
    try {
      const res = await apiFetch('/api/equipment/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipment_ids: selectedIds,
          issued_to: transferIssuedTo.trim(),
          issued_at: new Date().toISOString(),
          expected_return_at: transferExpectedDate || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка передачи оборудования');

      setShowTransferModal(false);
      setTransferIssuedTo('');
      setTransferExpectedDate('');
      setSelectedIds([]);
      fetchEquipment();
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div className="space-y-4">
      {/* Search & Actions Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Search box */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Поиск по инвентарному номеру или наименованию..."
              className="w-full pl-10 pr-4 py-2 text-xs sm:text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {isAdmin && (
              <>
                <button
                  onClick={onOpenCreateEquipment}
                  className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors inline-flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>Добавить</span>
                </button>
                <button
                  onClick={onOpenExcelImport}
                  className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors inline-flex items-center gap-1.5"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>Импорт Excel</span>
                </button>
              </>
            )}

            <button
              onClick={fetchEquipment}
              className="p-2 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl transition-colors"
              title="Обновить список"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Filter Row 1: Rooms, Types, Dates */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-2 border-t border-slate-100 text-xs">
          {/* Room filter */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
              Кабинет / Аудитория:
            </label>
            <select
              value={selectedRoomId}
              onChange={(e) => {
                setSelectedRoomId(e.target.value);
                setPage(1);
              }}
              className="w-full p-2 border border-slate-200 rounded-xl bg-slate-50/50 outline-none"
            >
              <option value="">Все кабинеты</option>
              {(Array.isArray(rooms) ? rooms : []).map((r) => (
                <option key={r.id} value={r.id}>
                  Ауд. {r.number} ({r.floor} этаж)
                </option>
              ))}
            </select>
          </div>

          {/* Type filter */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
              Тип оборудования:
            </label>
            <select
              value={selectedTypeId}
              onChange={(e) => {
                setSelectedTypeId(e.target.value);
                setPage(1);
              }}
              className="w-full p-2 border border-slate-200 rounded-xl bg-slate-50/50 outline-none"
            >
              <option value="">Все типы оборудования</option>
              {(Array.isArray(types) ? types : []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          {/* Date from */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
              Получено на баланс с:
            </label>
            <input
              type="date"
              value={receivedFrom}
              onChange={(e) => {
                setReceivedFrom(e.target.value);
                setPage(1);
              }}
              className="w-full p-2 border border-slate-200 rounded-xl bg-slate-50/50 outline-none"
            />
          </div>

          {/* Date to */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
              Получено на баланс по:
            </label>
            <input
              type="date"
              value={receivedTo}
              onChange={(e) => {
                setReceivedTo(e.target.value);
                setPage(1);
              }}
              className="w-full p-2 border border-slate-200 rounded-xl bg-slate-50/50 outline-none"
            />
          </div>
        </div>

        {/* Filter Row 2: Dynamic fields and toggles */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 text-xs">
          {/* Dynamic field filter */}
          {typeFields.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-600">Доп. поле:</span>
              <select
                value={customFieldCode}
                onChange={(e) => setCustomFieldCode(e.target.value)}
                className="p-1.5 border border-slate-200 rounded-lg bg-slate-50 text-xs"
              >
                <option value="">Выберите характеристику...</option>
                {(Array.isArray(typeFields) ? typeFields : []).map((f) => (
                  <option key={f.code} value={f.code}>
                    {f.title}
                  </option>
                ))}
              </select>
              {customFieldCode && (
                <input
                  type="text"
                  value={customFieldValue}
                  onChange={(e) => setCustomFieldValue(e.target.value)}
                  placeholder="Значение характеристики..."
                  className="p-1.5 border border-slate-200 rounded-lg text-xs"
                />
              )}
            </div>
          )}

          {/* Quick toggle checkboxes */}
          <div className="flex flex-wrap items-center gap-4 text-slate-700">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={hasUnrepairedIssue}
                onChange={(e) => setHasUnrepairedIssue(e.target.checked)}
                className="rounded text-red-600 focus:ring-0"
              />
              <span>Только с неисправностями</span>
            </label>

            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={activeTransferOnly}
                onChange={(e) => setActiveTransferOnly(e.target.checked)}
                className="rounded text-blue-600 focus:ring-0"
              />
              <span>В пользовании (аренда)</span>
            </label>

            {(isAdmin || isEngineer) && (
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeWrittenOff}
                  onChange={(e) => setIncludeWrittenOff(e.target.checked)}
                  className="rounded text-slate-600 focus:ring-0"
                />
                <span>Включая списанное</span>
              </label>
            )}
          </div>
        </div>
      </div>

      {/* Bulk actions banner if items selected */}
      {selectedIds.length > 0 && (
        <div className="bg-indigo-900 text-white p-3 sm:p-4 rounded-2xl flex flex-wrap items-center justify-between gap-3 shadow-md animate-fadeIn text-xs">
          <div className="flex items-center gap-2">
            <CheckSquare className="w-5 h-5 text-indigo-300" />
            <span className="font-bold">
              Выбрано единиц оборудования: {selectedIds.length}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Generate QR DOCX button (PDF page 3) */}
            <button
              onClick={handleGenerateQrDocx}
              disabled={generatingQrDocx}
              className="px-3 py-1.5 bg-indigo-700 hover:bg-indigo-600 text-white rounded-xl font-semibold inline-flex items-center gap-1.5 transition-colors"
            >
              <QrCode className="w-4 h-4 text-indigo-300" />
              <span>
                {generatingQrDocx ? 'Формирование DOCX...' : 'Индивидуальные QR (DOCX)'}
              </span>
            </button>

            {/* Group QR Code button (for batches of identical items) */}
            {(isAdmin || isEngineer) && selectedIds.length >= 2 && (
              <button
                onClick={() => setShowGroupQrModal(true)}
                className="px-3 py-1.5 bg-purple-700 hover:bg-purple-600 text-white rounded-xl font-semibold inline-flex items-center gap-1.5 transition-colors shadow-2xs"
                title="Сгенерировать единый QR-код для партии (например, нескольких столов)"
              >
                <Boxes className="w-4 h-4 text-purple-300" />
                <span>Групповой QR (партия)</span>
              </button>
            )}

            {/* Temporary loan transfer */}
            {(isAdmin || isEngineer) && (
              <button
                onClick={() => setShowTransferModal(true)}
                className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded-xl font-semibold inline-flex items-center gap-1.5 transition-colors"
              >
                <ArrowRightLeft className="w-4 h-4 text-blue-300" />
                <span>Передать в пользование</span>
              </button>
            )}

            {/* Change write-off state */}
            {isAdmin && (
              <>
                <button
                  onClick={() => setShowWriteoffModal(true)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-semibold inline-flex items-center gap-1.5 transition-colors"
                >
                  <FileText className="w-4 h-4 text-slate-300" />
                  <span>Статус списания</span>
                </button>
                <button
                  onClick={handleGenerateWriteoffAct}
                  className="px-3 py-1.5 bg-emerald-800 hover:bg-emerald-700 text-white rounded-xl font-semibold inline-flex items-center gap-1.5 transition-colors"
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-300" />
                  <span>Акт списания (DOCX)</span>
                </button>
              </>
            )}

            <button
              onClick={() => setSelectedIds([])}
              className="px-2.5 py-1.5 text-indigo-200 hover:text-white"
            >
              Снять выбор
            </button>
          </div>
        </div>
      )}

      {/* Main Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                <th className="p-3 w-10 text-center">
                  <button
                    onClick={toggleSelectAll}
                    className="text-slate-400 hover:text-slate-700"
                  >
                    {selectedIds.length > 0 && selectedIds.length === items.length ? (
                      <CheckSquare className="w-4 h-4 text-blue-600" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                  </button>
                </th>
                <th className="p-3">Инв. номер</th>
                <th className="p-3">Наименование</th>
                <th className="p-3">Тип</th>
                <th className="p-3">Кабинет</th>
                <th className="p-3">На балансе с</th>
                <th className="p-3">Ост. стоимость</th>
                <th className="p-3">Статус</th>
                <th className="p-3 text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && items.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-slate-400">
                    Загрузка списка оборудования...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-slate-400">
                    Оборудование по заданным критериям не найдено
                  </td>
                </tr>
              ) : (
                (Array.isArray(items) ? items : []).map((item) => {
                  const isSelected = selectedIds.includes(item.id);
                  const isWrittenOff = item.writeoffState === 'WRITTEN_OFF';

                  return (
                    <tr
                      key={item.id}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        isSelected ? 'bg-indigo-50/40' : ''
                      } ${isWrittenOff ? 'opacity-60 bg-slate-50' : ''}`}
                    >
                      <td className="p-3 text-center">
                        <button
                          onClick={() => toggleSelect(item.id)}
                          className="text-slate-400 hover:text-slate-700"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-indigo-600" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </td>
                      <td className="p-3 font-mono font-bold text-blue-700 whitespace-nowrap">
                        {item.inventory_number}
                      </td>
                      <td className="p-3 font-medium text-slate-900 max-w-xs truncate">
                        <button
                          onClick={() => onOpenEquipmentDetail(item.id)}
                          className="hover:underline text-left"
                        >
                          {item.name}
                        </button>
                      </td>
                      <td className="p-3 text-slate-600">{item.typeName}</td>
                      <td className="p-3 text-slate-800 font-medium">
                        каб. {item.roomNumber}
                      </td>
                      <td className="p-3 text-slate-600 whitespace-nowrap">
                        {new Date(item.recived).toLocaleDateString('ru-RU')}
                      </td>
                      <td className="p-3 text-slate-800 whitespace-nowrap">
                        {Number(item.residual_cost).toLocaleString('ru-RU')} ₽
                      </td>
                      <td className="p-3">
                        {isWrittenOff ? (
                          <span className="px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 font-semibold text-[10px]">
                            Списано
                          </span>
                        ) : item.writeoffState === 'PREPARING' ? (
                          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-semibold text-[10px]">
                            К списанию
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-semibold text-[10px]">
                            В эксплуатации
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-right whitespace-nowrap">
                        <button
                          onClick={() => onOpenEquipmentDetail(item.id)}
                          className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold transition-colors inline-flex items-center gap-1"
                        >
                          <QrCode className="w-3.5 h-3.5 text-indigo-600" />
                          <span>Паспорт</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <div>
            Показано {items.length} из {total} единиц оборудования
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-1.5 border border-slate-200 rounded-lg hover:bg-white disabled:opacity-40 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="font-semibold text-slate-700">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-1.5 border border-slate-200 rounded-lg hover:bg-white disabled:opacity-40 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Sub-modal: Bulk write-off status */}
      {showWriteoffModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <h3 className="font-bold text-base text-slate-900">
              Изменение статуса списания ({selectedIds.length} ед.)
            </h3>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Выберите статус
              </label>
              <select
                value={writeoffState}
                onChange={(e: any) => setWriteoffState(e.target.value)}
                className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none"
              >
                <option value="PREPARING">Готовится к списанию (PREPARING)</option>
                <option value="DOCUMENTS_PREPARATION">
                  В процессе списания (DOCUMENTS_PREPARATION)
                </option>
                <option value="WRITTEN_OFF">Списано (WRITTEN_OFF)</option>
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowWriteoffModal(false)}
                className="px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleBulkWriteoffSubmit}
                className="px-4 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl"
              >
                Применить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sub-modal: Bulk transfer */}
      {showTransferModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <h3 className="font-bold text-base text-slate-900">
              Передача во временное пользование ({selectedIds.length} ед.)
            </h3>
            <p className="text-xs text-slate-500">
              Параметры передачи будут выставлены одинаковые для всех выбранных единиц
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Кому передается *
              </label>
              <input
                type="text"
                value={transferIssuedTo}
                onChange={(e) => setTransferIssuedTo(e.target.value)}
                placeholder="ФИО / отдел / лаборатория"
                className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Ожидаемая дата возврата
              </label>
              <input
                type="date"
                value={transferExpectedDate}
                onChange={(e) => setTransferExpectedDate(e.target.value)}
                className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowTransferModal(false)}
                className="px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleBulkTransferSubmit}
                className="px-4 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl"
              >
                Оформить передачу
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Group QR Modal */}
      <GroupQrModal
        isOpen={showGroupQrModal}
        onClose={() => setShowGroupQrModal(false)}
        selectedItems={items.filter((item) => selectedIds.includes(item.id))}
        onOpenGroupDetail={(code) => {
          if (onOpenGroupDetail) onOpenGroupDetail(code);
        }}
      />
    </div>
  );
};
