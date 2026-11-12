import React, { useState, useEffect } from 'react';
import {
  Search,
  Plus,
  FileSpreadsheet,
  QrCode,
  FileText,
  ArrowRightLeft,
  ChevronLeft,
  ChevronRight,
  CheckSquare,
  Square,
  RefreshCw,
  Boxes,
  Ruler,
  RotateCcw,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  Palette,
  Trash2,
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
  refreshKey?: number;
}

const COLOR_SUGGESTIONS = ['белый', 'серый', 'черный', 'бежевый', 'коричневый', 'синий'];

const getColorDotClass = (colorName?: string | null) => {
  const c = (colorName || '').trim().toLowerCase();
  if (c.includes('бел')) return 'bg-white border-slate-400';
  if (c.includes('сер')) return 'bg-slate-400 border-slate-500';
  if (c.includes('черн') || c.includes('чёрн')) return 'bg-slate-900 border-slate-950';
  if (c.includes('беж')) return 'bg-amber-100 border-amber-300';
  if (c.includes('корич') || c.includes('дуб') || c.includes('орех')) return 'bg-amber-800 border-amber-900';
  if (c.includes('син') || c.includes('голуб')) return 'bg-blue-500 border-blue-600';
  if (c.includes('зел')) return 'bg-emerald-500 border-emerald-600';
  if (c.includes('крас')) return 'bg-red-500 border-red-600';
  return 'bg-slate-300 border-slate-400';
};

const formatDateRu = (val?: string | null) => {
  if (!val) return '';
  const match = String(val).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return `${match[3]}.${match[2]}.${match[1]}`;
  }
  const d = new Date(val);
  return isNaN(d.getTime()) ? String(val) : d.toLocaleDateString('ru-RU');
};

export const EquipmentList: React.FC<EquipmentListProps> = ({
  currentUser,
  onOpenEquipmentDetail,
  onOpenCreateEquipment,
  onOpenExcelImport,
  onOpenGroupDetail,
  rooms,
  types,
  refreshKey = 0,
}) => {
  const [items, setItems] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const limit = 15;

  // Main filter states
  const [search, setSearch] = useState('');
  const [selectedTypeId, setSelectedTypeId] = useState<string>('');
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');
  const [receivedFrom, setReceivedFrom] = useState('');
  const [receivedTo, setReceivedTo] = useState('');
  const [includeWrittenOff, setIncludeWrittenOff] = useState(false);
  const [hasUnrepairedIssue, setHasUnrepairedIssue] = useState(false);
  const [activeTransferOnly, setActiveTransferOnly] = useState(false);

  // Department classification filters (columns J-Q)
  const [colorFilter, setColorFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [conditionFilter, setConditionFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [preciousMetalsFilter, setPreciousMetalsFilter] = useState('');
  const [warrantyFilter, setWarrantyFilter] = useState('');

  // Dimensions filters for furniture (Размеры Д*Ш*В, см)
  const [showDimensionsPanel, setShowDimensionsPanel] = useState(false);
  const [lengthMin, setLengthMin] = useState('');
  const [lengthMax, setLengthMax] = useState('');
  const [widthMin, setWidthMin] = useState('');
  const [widthMax, setWidthMax] = useState('');
  const [heightMin, setHeightMin] = useState('');
  const [heightMax, setHeightMax] = useState('');

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

  // Delete Confirmation Modal
  const [deleteTarget, setDeleteTarget] = useState<
    | { mode: 'single'; item: Equipment }
    | { mode: 'bulk'; ids: number[] }
    | null
  >(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const isAdmin = currentUser?.role === 'ADMIN';
  const isEngineer = currentUser?.role === 'ENGINEER';

  const selectedTypeObj = (Array.isArray(types) ? types : []).find(
    (t) => String(t.id) === selectedTypeId
  );
  const isFurnitureSelected = Boolean(
    selectedTypeObj?.name.toLowerCase().includes('корпусная мебель')
  );

  // Automatically expand dimensions filter when "Корпусная мебель" is selected
  useEffect(() => {
    if (isFurnitureSelected) {
      setShowDimensionsPanel(true);
    }
  }, [isFurnitureSelected]);

  const hasDimensionFilterActive = Boolean(
    lengthMin || lengthMax || widthMin || widthMax || heightMin || heightMax
  );

  const hasAnyFilterActive = Boolean(
    search ||
      selectedTypeId ||
      selectedRoomId ||
      receivedFrom ||
      receivedTo ||
      includeWrittenOff ||
      hasUnrepairedIssue ||
      activeTransferOnly ||
      colorFilter ||
      statusFilter ||
      conditionFilter ||
      categoryFilter ||
      preciousMetalsFilter ||
      warrantyFilter ||
      hasDimensionFilterActive ||
      (customFieldCode && customFieldValue)
  );

  const handleResetFilters = () => {
    setSearch('');
    setSelectedTypeId('');
    setSelectedRoomId('');
    setReceivedFrom('');
    setReceivedTo('');
    setIncludeWrittenOff(false);
    setHasUnrepairedIssue(false);
    setActiveTransferOnly(false);
    setColorFilter('');
    setStatusFilter('');
    setConditionFilter('');
    setCategoryFilter('');
    setPreciousMetalsFilter('');
    setWarrantyFilter('');
    setLengthMin('');
    setLengthMax('');
    setWidthMin('');
    setWidthMax('');
    setHeightMin('');
    setHeightMax('');
    setCustomFieldCode('');
    setCustomFieldValue('');
    setPage(1);
  };

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
    if (colorFilter.trim()) params.set('color', colorFilter.trim());
    if (statusFilter) params.set('status', statusFilter);
    if (conditionFilter) params.set('condition', conditionFilter);
    if (categoryFilter) params.set('accounting_category', categoryFilter);
    if (preciousMetalsFilter) params.set('precious_metals', preciousMetalsFilter);
    if (warrantyFilter) params.set('is_under_warranty', warrantyFilter);
    if (lengthMin) params.set('length_min', lengthMin);
    if (lengthMax) params.set('length_max', lengthMax);
    if (widthMin) params.set('width_min', widthMin);
    if (widthMax) params.set('width_max', widthMax);
    if (heightMin) params.set('height_min', heightMin);
    if (heightMax) params.set('height_max', heightMax);
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
    colorFilter,
    statusFilter,
    conditionFilter,
    categoryFilter,
    preciousMetalsFilter,
    warrantyFilter,
    lengthMin,
    lengthMax,
    widthMin,
    widthMax,
    heightMin,
    heightMax,
    customFieldCode,
    customFieldValue,
    refreshKey,
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
      .then((fields: AdditionalField[]) => {
        const filteredFields = Array.isArray(fields)
          ? fields.filter((f) => f.code !== 'dimensions' && f.code !== 'color')
          : [];
        setTypeFields(filteredFields);
      })
      .catch(console.error);
  }, [selectedTypeId]);

  // Selection toggle
  const toggleSelectAll = () => {
    const list = Array.isArray(items) ? items : [];
    if (selectedIds.length === list.length && list.length > 0) {
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

  // Generate QR Codes DOCX file
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

  // Generate Writeoff Act DOCX
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

  // Single or Bulk Delete confirm handler
  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      if (deleteTarget.mode === 'single') {
        const res = await apiFetch(`/api/equipment/${deleteTarget.item.id}`, {
          method: 'DELETE',
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Ошибка удаления оборудования');
        }
        setSelectedIds((prev) => prev.filter((id) => id !== deleteTarget.item.id));
      } else {
        const res = await apiFetch('/api/equipment/bulk-delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ equipment_ids: deleteTarget.ids }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Ошибка массового удаления');
        }
        setSelectedIds([]);
      }
      setDeleteTarget(null);
      fetchEquipment();
    } catch (err: any) {
      setDeleteError(err.message);
    } finally {
      setDeleting(false);
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

  const selectFurnitureTypeQuick = () => {
    const furn = (Array.isArray(types) ? types : []).find((t) =>
      t.name.toLowerCase().includes('корпусная мебель')
    );
    if (furn) {
      setSelectedTypeId(String(furn.id));
      setPage(1);
    }
    setShowDimensionsPanel(true);
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
              placeholder="Поиск по инв. номеру, наименованию, месту, описанию, цвету..."
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
              type="button"
              onClick={() => setShowDimensionsPanel((v) => !v)}
              className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-colors inline-flex items-center gap-1.5 ${
                showDimensionsPanel || hasDimensionFilterActive
                  ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                  : 'border-slate-200 hover:bg-slate-50 text-slate-700'
              }`}
              title="Фильтр по размерам корпусной мебели (Д*Ш*В)"
            >
              <Ruler className="w-4 h-4" />
              <span>Габариты мебели</span>
              {hasDimensionFilterActive && (
                <span className="w-2 h-2 rounded-full bg-indigo-600" />
              )}
            </button>

            {hasAnyFilterActive && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="px-3 py-2 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl text-xs font-medium transition-colors inline-flex items-center gap-1.5"
                title="Сбросить все фильтры"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Сбросить</span>
              </button>
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

        {/* Filter Row 1: Rooms, Types, Status, Condition */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-2 border-t border-slate-100 text-xs">
          {/* Room filter */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
              Помещение / Кабинет:
            </label>
            <select
              value={selectedRoomId}
              onChange={(e) => {
                setSelectedRoomId(e.target.value);
                setPage(1);
              }}
              className="w-full p-2 border border-slate-200 rounded-xl bg-slate-50/50 outline-none"
            >
              <option value="">Все помещения</option>
              {(Array.isArray(rooms) ? rooms : []).map((r) => (
                <option key={r.id} value={r.id}>
                  Ауд. {r.number} ({r.floor} этаж)
                </option>
              ))}
            </select>
          </div>

          {/* Type filter (11 standard types) */}
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

          {/* Status filter */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
              Статус эксплуатации:
            </label>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="w-full p-2 border border-slate-200 rounded-xl bg-slate-50/50 outline-none"
            >
              <option value="">Все статусы</option>
              <option value="Действует">Действует</option>
              <option value="На хранении">На хранении</option>
            </select>
          </div>

          {/* Condition filter */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
              Состояние:
            </label>
            <select
              value={conditionFilter}
              onChange={(e) => {
                setConditionFilter(e.target.value);
                setPage(1);
              }}
              className="w-full p-2 border border-slate-200 rounded-xl bg-slate-50/50 outline-none"
            >
              <option value="">Любое состояние</option>
              <option value="Рабочее">Рабочее</option>
              <option value="Есть нюансы">Есть нюансы</option>
              <option value="Вышло из строя">Вышло из строя (ремонт возможен)</option>
              <option value="Неремонтопригодно">Неремонтопригодно</option>
            </select>
          </div>
        </div>

        {/* Filter Row 2: Accounting Category, Precious Metals, Warranty, Color */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
          {/* Accounting category */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
              Категория (по бухучету):
            </label>
            <select
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value);
                setPage(1);
              }}
              className="w-full p-2 border border-slate-200 rounded-xl bg-slate-50/50 outline-none"
            >
              <option value="">Все категории</option>
              <option value="Дорогостоящее">Дорогостоящее</option>
              <option value="Малоценка">Малоценка</option>
              <option value="Мягкий инвентарь">Мягкий инвентарь</option>
            </select>
          </div>

          {/* Precious metals */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
              Содержание драгметаллов:
            </label>
            <select
              value={preciousMetalsFilter}
              onChange={(e) => {
                setPreciousMetalsFilter(e.target.value);
                setPage(1);
              }}
              className="w-full p-2 border border-slate-200 rounded-xl bg-slate-50/50 outline-none"
            >
              <option value="">Неважно</option>
              <option value="true">Да (содержит)</option>
              <option value="false">Нет</option>
            </select>
          </div>

          {/* Warranty status */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
              Оборудование на гарантии:
            </label>
            <select
              value={warrantyFilter}
              onChange={(e) => {
                setWarrantyFilter(e.target.value);
                setPage(1);
              }}
              className="w-full p-2 border border-slate-200 rounded-xl bg-slate-50/50 outline-none"
            >
              <option value="">Все (с гарантией и без)</option>
              <option value="true">Да (действующая гарантия)</option>
              <option value="false">Нет (истекла / неприменимо)</option>
            </select>
          </div>

          {/* Color filter */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
              Цвет:
            </label>
            <div className="relative">
              <Palette className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                list="equipment-color-options"
                value={colorFilter}
                onChange={(e) => {
                  setColorFilter(e.target.value);
                  setPage(1);
                }}
                placeholder="серый, черный, белый..."
                className="w-full pl-8 pr-2.5 py-2 border border-slate-200 rounded-xl bg-slate-50/50 outline-none"
              />
              <datalist id="equipment-color-options">
                {COLOR_SUGGESTIONS.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
          </div>
        </div>

        {/* Collapsible Dimensions Filter Panel for Furniture (Размеры Д*Ш*В, см) */}
        {showDimensionsPanel && (
          <div className="p-3.5 bg-indigo-50/70 border border-indigo-200 rounded-xl space-y-2.5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-bold text-indigo-950">
                <Ruler className="w-4 h-4 text-indigo-600" />
                <span>Фильтрация корпусной мебели по габаритам (Д × Ш × В, см)</span>
              </div>
              <div className="flex items-center gap-2">
                {!isFurnitureSelected && (
                  <button
                    type="button"
                    onClick={selectFurnitureTypeQuick}
                    className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[11px] font-semibold transition-colors"
                  >
                    Выбрать тип «Корпусная мебель»
                  </button>
                )}
                {hasDimensionFilterActive && (
                  <button
                    type="button"
                    onClick={() => {
                      setLengthMin('');
                      setLengthMax('');
                      setWidthMin('');
                      setWidthMax('');
                      setHeightMin('');
                      setHeightMax('');
                      setPage(1);
                    }}
                    className="px-2.5 py-1 bg-white border border-indigo-200 hover:bg-indigo-100 text-indigo-700 rounded-lg text-[11px] font-semibold transition-colors"
                  >
                    Очистить размеры
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Length */}
              <div className="bg-white p-2.5 rounded-xl border border-indigo-100">
                <span className="block text-[11px] font-semibold text-slate-700 mb-1.5">
                  Длина (Д), см
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    min={0}
                    value={lengthMin}
                    onChange={(e) => {
                      setLengthMin(e.target.value);
                      setPage(1);
                    }}
                    placeholder="от (напр. 400)"
                    className="w-full p-1.5 border border-slate-200 rounded-lg text-xs outline-none focus:border-indigo-500"
                  />
                  <input
                    type="number"
                    min={0}
                    value={lengthMax}
                    onChange={(e) => {
                      setLengthMax(e.target.value);
                      setPage(1);
                    }}
                    placeholder="до (напр. 600)"
                    className="w-full p-1.5 border border-slate-200 rounded-lg text-xs outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              {/* Width */}
              <div className="bg-white p-2.5 rounded-xl border border-indigo-100">
                <span className="block text-[11px] font-semibold text-slate-700 mb-1.5">
                  Ширина (Ш), см
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    min={0}
                    value={widthMin}
                    onChange={(e) => {
                      setWidthMin(e.target.value);
                      setPage(1);
                    }}
                    placeholder="от (напр. 60)"
                    className="w-full p-1.5 border border-slate-200 rounded-lg text-xs outline-none focus:border-indigo-500"
                  />
                  <input
                    type="number"
                    min={0}
                    value={widthMax}
                    onChange={(e) => {
                      setWidthMax(e.target.value);
                      setPage(1);
                    }}
                    placeholder="до (напр. 250)"
                    className="w-full p-1.5 border border-slate-200 rounded-lg text-xs outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              {/* Height */}
              <div className="bg-white p-2.5 rounded-xl border border-indigo-100">
                <span className="block text-[11px] font-semibold text-slate-700 mb-1.5">
                  Высота (В), см
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    min={0}
                    value={heightMin}
                    onChange={(e) => {
                      setHeightMin(e.target.value);
                      setPage(1);
                    }}
                    placeholder="от (напр. 100)"
                    className="w-full p-1.5 border border-slate-200 rounded-lg text-xs outline-none focus:border-indigo-500"
                  />
                  <input
                    type="number"
                    min={0}
                    value={heightMax}
                    onChange={(e) => {
                      setHeightMax(e.target.value);
                      setPage(1);
                    }}
                    placeholder="до (напр. 260)"
                    className="w-full p-1.5 border border-slate-200 rounded-lg text-xs outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
            </div>

            <p className="text-[11px] text-indigo-800/80">
              Можно задать только длину, только ширину, только высоту или любую их комбинацию (например, и длину, и ширину). Для точного совпадения укажите одинаковое значение в «от» и «до».
            </p>
          </div>
        )}

        {/* Filter Row 3: Dates, Dynamic fields and checkboxes */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold text-slate-500">На балансе с:</span>
              <input
                type="date"
                value={receivedFrom}
                onChange={(e) => {
                  setReceivedFrom(e.target.value);
                  setPage(1);
                }}
                className="p-1.5 border border-slate-200 rounded-lg bg-slate-50/50 outline-none text-xs"
              />
              <span className="text-slate-400">—</span>
              <input
                type="date"
                value={receivedTo}
                onChange={(e) => {
                  setReceivedTo(e.target.value);
                  setPage(1);
                }}
                className="p-1.5 border border-slate-200 rounded-lg bg-slate-50/50 outline-none text-xs"
              />
            </div>

            {/* Dynamic field filter */}
            {typeFields.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-600">Доп. поле:</span>
                <select
                  value={customFieldCode}
                  onChange={(e) => {
                    setCustomFieldCode(e.target.value);
                    setPage(1);
                  }}
                  className="p-1.5 border border-slate-200 rounded-lg bg-slate-50 text-xs"
                >
                  <option value="">Выберите характеристику...</option>
                  {typeFields.map((f) => (
                    <option key={f.code} value={f.code}>
                      {f.title}
                    </option>
                  ))}
                </select>
                {customFieldCode && (
                  <input
                    type="text"
                    value={customFieldValue}
                    onChange={(e) => {
                      setCustomFieldValue(e.target.value);
                      setPage(1);
                    }}
                    placeholder="Значение..."
                    className="p-1.5 border border-slate-200 rounded-lg text-xs"
                  />
                )}
              </div>
            )}
          </div>

          {/* Quick toggle checkboxes */}
          <div className="flex flex-wrap items-center gap-4 text-slate-700">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={hasUnrepairedIssue}
                onChange={(e) => {
                  setHasUnrepairedIssue(e.target.checked);
                  setPage(1);
                }}
                className="rounded text-red-600 focus:ring-0"
              />
              <span>Только с неисправностями</span>
            </label>

            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={activeTransferOnly}
                onChange={(e) => {
                  setActiveTransferOnly(e.target.checked);
                  setPage(1);
                }}
                className="rounded text-blue-600 focus:ring-0"
              />
              <span>В пользовании (аренда)</span>
            </label>

            {(isAdmin || isEngineer) && (
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeWrittenOff}
                  onChange={(e) => {
                    setIncludeWrittenOff(e.target.checked);
                    setPage(1);
                  }}
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

            {(isAdmin || isEngineer) && (
              <button
                onClick={() => setShowTransferModal(true)}
                className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded-xl font-semibold inline-flex items-center gap-1.5 transition-colors"
              >
                <ArrowRightLeft className="w-4 h-4 text-blue-300" />
                <span>Передать в пользование</span>
              </button>
            )}

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
                <button
                  onClick={() => {
                    setDeleteError(null);
                    setDeleteTarget({ mode: 'bulk', ids: selectedIds });
                  }}
                  className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-xl font-semibold inline-flex items-center gap-1.5 transition-colors"
                >
                  <Trash2 className="w-4 h-4 text-red-100" />
                  <span>Удалить выбранные</span>
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
                <th className="p-3">Наименование и описание</th>
                <th className="p-3">Тип / Бухучет</th>
                <th className="p-3">Помещение / Место</th>
                <th className="p-3">Габариты / Цвет</th>
                <th className="p-3">Статус / Состояние</th>
                <th className="p-3">Гарантия</th>
                <th className="p-3">Ост. стоимость</th>
                <th className="p-3 text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && items.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-slate-400">
                    Загрузка списка оборудования...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-slate-400">
                    Оборудование по заданным критериям не найдено
                  </td>
                </tr>
              ) : (
                (Array.isArray(items) ? items : []).map((item) => {
                  const isSelected = selectedIds.includes(item.id);
                  const isWrittenOff = item.writeoffState === 'WRITTEN_OFF';
                  const af = item.additional_fields || {};
                  const opStatus = af.status || 'Действует';
                  const cond = af.condition || 'Рабочее';
                  const cat = af.accounting_category;
                  const underWarranty = Boolean(af.is_under_warranty);

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
                        <div>{item.inventory_number}</div>
                        <div className="text-[10px] font-sans font-normal text-slate-400">
                          с {new Date(item.recived).toLocaleDateString('ru-RU')}
                        </div>
                      </td>
                      <td className="p-3 max-w-[240px]">
                        <button
                          onClick={() => onOpenEquipmentDetail(item.id)}
                          className="font-semibold text-slate-900 hover:text-blue-700 hover:underline text-left line-clamp-2"
                        >
                          {item.name}
                        </button>
                        {af.description && af.description !== item.name && (
                          <div className="text-[11px] text-slate-500 truncate mt-0.5" title={af.description}>
                            {af.description}
                          </div>
                        )}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <div className="font-medium text-slate-800">{item.typeName}</div>
                        <div className="flex flex-wrap items-center gap-1 mt-1">
                          {cat && (
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                                cat === 'Дорогостоящее'
                                  ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                                  : cat === 'Малоценка'
                                  ? 'bg-slate-100 text-slate-700 border-slate-200'
                                  : 'bg-teal-50 text-teal-700 border-teal-200'
                              }`}
                            >
                              {cat}
                            </span>
                          )}
                          {af.precious_metals && (
                            <span
                              className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 inline-flex items-center gap-0.5"
                              title="Содержит драгметаллы"
                            >
                              <Sparkles className="w-2.5 h-2.5" />
                              Драгмет.
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="font-semibold text-slate-800 whitespace-nowrap">
                          ауд. {item.roomNumber}
                        </div>
                        {af.location_place && (
                          <div className="text-[11px] text-slate-500 max-w-[160px] truncate" title={af.location_place}>
                            {af.location_place}
                          </div>
                        )}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        {af.dimensions ? (
                          <div className="font-mono text-[11px] font-semibold text-slate-800">
                            {af.dimensions} см
                          </div>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                        {af.color && (
                          <div className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 mt-0.5">
                            <span
                              className={`w-2.5 h-2.5 rounded-full border ${getColorDotClass(af.color)}`}
                            />
                            <span>{af.color}</span>
                          </div>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex flex-col gap-1 items-start">
                          {isWrittenOff ? (
                            <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-700 font-semibold text-[10px]">
                              Списано
                            </span>
                          ) : item.writeoffState === 'PREPARING' ? (
                            <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold text-[10px]">
                              К списанию
                            </span>
                          ) : (
                            <span
                              className={`px-2 py-0.5 rounded font-semibold text-[10px] ${
                                opStatus === 'На хранении'
                                  ? 'bg-slate-100 text-slate-700 border border-slate-200'
                                  : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              }`}
                            >
                              {opStatus}
                            </span>
                          )}
                          <span
                            className={`text-[10px] font-medium ${
                              cond === 'Рабочее'
                                ? 'text-slate-600'
                                : cond === 'Есть нюансы'
                                ? 'text-amber-700'
                                : 'text-red-600 font-semibold'
                            }`}
                          >
                            {cond}
                          </span>
                        </div>
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        {underWarranty ? (
                          <div className="inline-flex flex-col">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold text-[10px]">
                              <ShieldCheck className="w-3 h-3" />
                              Да
                            </span>
                            {af.warranty_until && (
                              <span className="text-[10px] text-slate-500 mt-0.5">
                                до {formatDateRu(af.warranty_until)}
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="inline-flex flex-col">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-medium text-[10px] w-fit">
                              <ShieldAlert className="w-3 h-3 text-slate-400" />
                              Нет
                            </span>
                            {af.warranty_until && (
                              <span className="text-[10px] text-red-500 mt-0.5">
                                ист. {formatDateRu(af.warranty_until)}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-slate-800 whitespace-nowrap font-medium">
                        {Number(item.residual_cost).toLocaleString('ru-RU')} ₽
                      </td>
                      <td className="p-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            onClick={() => onOpenEquipmentDetail(item.id)}
                            className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold transition-colors inline-flex items-center gap-1"
                          >
                            <QrCode className="w-3.5 h-3.5 text-indigo-600" />
                            <span>Паспорт</span>
                          </button>
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() => {
                                setDeleteError(null);
                                setDeleteTarget({ mode: 'single', item });
                              }}
                              className="p-1.5 rounded-lg border border-red-200 hover:bg-red-50 text-red-600 transition-colors"
                              title="Удалить оборудование"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
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

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-red-600" />
              {deleteTarget.mode === 'single'
                ? 'Удаление оборудования'
                : `Удаление выбранного оборудования (${deleteTarget.ids.length} ед.)`}
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              {deleteTarget.mode === 'single' ? (
                <>
                  Вы действительно хотите удалить{' '}
                  <strong className="text-slate-900">«{deleteTarget.item.name}»</strong>{' '}
                  (инв. № <span className="font-mono">{deleteTarget.item.inventory_number}</span>)?
                  Это действие необратимо.
                </>
              ) : (
                <>
                  Вы действительно хотите удалить выбранные единицы оборудования (
                  <strong>{deleteTarget.ids.length} шт.</strong>)? Все связанные записи о
                  проверках, неисправностях и передачах будут также удалены.
                </>
              )}
            </p>
            {deleteError && (
              <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
                {deleteError}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleting}
                className="px-4 py-2 text-xs font-bold bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white rounded-xl shadow-xs"
              >
                {deleting ? 'Удаление...' : 'Удалить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
