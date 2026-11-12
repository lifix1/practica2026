import React, { useState, useEffect } from 'react';
import {
  FileSpreadsheet,
  AlertTriangle,
  FileText,
  Download,
  CheckCircle2,
  Calendar,
  Plus,
  X,
  Gem,
  Truck,
  Package,
  Layers,
} from 'lucide-react';
import type { Equipment, User } from '../types/index.ts';
import { apiFetch } from '../utils/api.ts';

interface WriteoffsManagerProps {
  currentUser: User | null;
  onOpenEquipmentDetail: (id: number) => void;
}

function formatServiceLifePreview(recivedIso: string, targetDateStr: string): string {
  if (!recivedIso || !targetDateStr) return '—';
  const startStr = recivedIso.slice(0, 10);
  const startMatch = startStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const endMatch = targetDateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!startMatch || !endMatch) return '—';

  const sy = Number(startMatch[1]);
  const sm = Number(startMatch[2]);
  const sd = Number(startMatch[3]);
  const ey = Number(endMatch[1]);
  const em = Number(endMatch[2]);
  const ed = Number(endMatch[3]);

  let years = ey - sy;
  let months = em - sm;
  if (ed < sd) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  if (years < 0) {
    years = 0;
    months = 0;
  }

  const abs = Math.abs(years) % 100;
  const last = abs % 10;
  const yWord =
    abs >= 11 && abs <= 19 ? 'лет' : last === 1 ? 'год' : last >= 2 && last <= 4 ? 'года' : 'лет';

  return `${years} ${yWord} ${months} мес.`;
}

function isKitComponent(item: Equipment): boolean {
  if (item.additional_fields?.is_kit_part === true) return true;
  if (item.additional_fields?.is_kit_part === false) return false;
  return /из\s+комплекта/i.test(item.name || '');
}

function formatCostRu(val: number | string | null | undefined): string {
  const num = Number(val) || 0;
  return num.toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function detectItemCase(item: Equipment): 'CASE_1' | 'CASE_2' | 'CASE_3' | 'OTHER' {
  const cat = (item.additional_fields?.accounting_category || '').toLowerCase();
  const hasDm = Boolean(item.additional_fields?.precious_metals);
  if (cat.includes('малоцен') && hasDm) return 'CASE_2';
  if (cat.includes('малоцен') && !hasDm) return 'CASE_3';
  if (cat.includes('дорогостоящ') && hasDm) return 'CASE_1';
  return 'OTHER';
}

export const WriteoffsManager: React.FC<WriteoffsManagerProps> = ({
  currentUser,
  onOpenEquipmentDetail,
}) => {
  const [items, setItems] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterState, setFilterState] = useState<string>('');
  const [caseFilter, setCaseFilter] = useState<'ALL' | 'CASE_1' | 'CASE_2' | 'CASE_3'>('ALL');
  const [docFormMode, setDocFormMode] = useState<'auto' | 'case1' | 'case2' | 'case3'>('auto');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [downloadingAct, setDownloadingAct] = useState(false);
  const [downloadingInvoice, setDownloadingInvoice] = useState(false);
  const [downloadingSample, setDownloadingSample] = useState(false);

  // Document parameters
  const [docDate, setDocDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [docNumber, setDocNumber] = useState<string>('');
  const [actReason, setActReason] = useState<string>('начисленная амортизация составляет 100%');

  // New Write-off Modal state
  const [showNewWriteoffModal, setShowNewWriteoffModal] = useState(false);
  const [availableEquipment, setAvailableEquipment] = useState<Equipment[]>([]);
  const [selectedEqIds, setSelectedEqIds] = useState<number[]>([]);
  const [modalSearch, setModalSearch] = useState('');
  const [targetState, setTargetState] = useState<
    'PREPARING' | 'DOCUMENTS_PREPARATION' | 'WRITTEN_OFF'
  >('DOCUMENTS_PREPARATION');
  const [downloadActAfter, setDownloadActAfter] = useState(true);
  const [downloadInvoiceAfter, setDownloadInvoiceAfter] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  const isAdmin = currentUser?.role === 'ADMIN';
  const isEngineer = currentUser?.role === 'ENGINEER';
  const canManage = isAdmin || isEngineer;

  const fetchItems = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('include_written_off', 'true');
      if (filterState) params.set('writeoff_state', filterState);
      params.set('limit', '200');

      const res = await apiFetch(`/api/equipment?${params.toString()}`);
      const data = await res.json();
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
      const res = await apiFetch('/api/equipment?limit=300');
      const data = await res.json();
      if (Array.isArray(data?.items)) {
        const active = data.items.filter((i: Equipment) => i.writeoffState !== 'WRITTEN_OFF');
        setAvailableEquipment(active);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchItems();
  }, [filterState]);

  const visibleItems = items.filter((item) => {
    if (caseFilter === 'CASE_1') return detectItemCase(item) === 'CASE_1';
    if (caseFilter === 'CASE_2') return detectItemCase(item) === 'CASE_2';
    if (caseFilter === 'CASE_3') return detectItemCase(item) === 'CASE_3';
    return true;
  });

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const selectAll = () => {
    if (selectedIds.length === visibleItems.length && visibleItems.length > 0) {
      setSelectedIds([]);
    } else {
      setSelectedIds(visibleItems.map((i) => i.id));
    }
  };

  const triggerBlobDownload = (blob: Blob, filename: string) => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  };

  // Download Sample Act or Sample Invoice DOCX
  const handleDownloadSample = async (
    kind: 'act-case1' | 'invoice-case1' | 'act-case2' | 'invoice-case2' | 'act-case3'
  ) => {
    setDownloadingSample(true);
    try {
      const endpointMap = {
        'act-case1': '/api/writeoff/sample-act',
        'invoice-case1': '/api/writeoff/sample-invoice',
        'act-case2': '/api/writeoff/sample-act-case2',
        'invoice-case2': '/api/writeoff/sample-invoice-case2',
        'act-case3': '/api/writeoff/sample-act-case3',
      };
      const filenameMap = {
        'act-case1': 'primer-akta-spisaniya-case1.docx',
        'invoice-case1': 'primer-nakladnoy-CIT-0501460.docx',
        'act-case2': 'primer-akta-malotsenka-case2.docx',
        'invoice-case2': 'primer-nakladnoy-forma-434-case2.docx',
        'act-case3': 'primer-akta-malotsenka-bez-dm-case3.docx',
      };
      const res = await fetch(endpointMap[kind]);
      if (!res.ok) throw new Error('Ошибка скачивания примера документа');
      const blob = await res.blob();
      triggerBlobDownload(blob, filenameMap[kind]);
      setFeedbackMsg({
        type: 'success',
        text: `Образец документа «${filenameMap[kind]}» успешно загружен!`,
      });
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message });
    } finally {
      setDownloadingSample(false);
    }
  };

  // Download Writeoff Acts (auto or explicit case1/case2/case3)
  const handleDownloadActForIds = async (
    ids: number[],
    overrideCaseType?: 'auto' | 'case1' | 'case2' | 'case3'
  ) => {
    if (ids.length === 0) return;
    setDownloadingAct(true);
    const caseType = overrideCaseType || docFormMode;
    try {
      const res = await apiFetch('/api/writeoff/generate-act', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipment_ids: ids,
          writeoff_date: docDate || null,
          act_number: docNumber,
          reason: caseType === 'case2' || caseType === 'case3' ? undefined : actReason,
          case_type: caseType,
        }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Ошибка генерации акта');
      }
      const blob = await res.blob();
      triggerBlobDownload(
        blob,
        `akty-${caseType}-${ids.length}-poz-${docDate || 'today'}.docx`
      );
      setFeedbackMsg({
        type: 'success',
        text:
          ids.length === 1
            ? 'Акт списания успешно сформирован и скачан!'
            : `Акт(ы) списания на ${ids.length} поз. успешно сформированы и скачаны!`,
      });
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message });
    } finally {
      setDownloadingAct(false);
    }
  };

  // Download Transfer Invoice (Case 1 ОКУД 0501460 or Case 2 Форма 434; Case 3 has no invoice)
  const handleDownloadInvoiceForIds = async (
    ids: number[],
    overrideCaseType?: 'auto' | 'case1' | 'case2' | 'case3'
  ) => {
    if (ids.length === 0) return;
    setDownloadingInvoice(true);
    const caseType = overrideCaseType || docFormMode;
    try {
      const res = await apiFetch('/api/writeoff/generate-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipment_ids: ids,
          invoice_date: docDate || null,
          invoice_number: docNumber,
          sender: 'Кафедра ПиСП',
          recipient: 'ЦИТ',
          case_type: caseType,
        }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Ошибка генерации накладной');
      }
      const blob = await res.blob();
      triggerBlobDownload(
        blob,
        `nakladnaya-${caseType}-${ids.length}-poz-${docDate || 'today'}.docx`
      );
      setFeedbackMsg({
        type: 'success',
        text: `Накладная на ${ids.length} поз. успешно сформирована и скачана!`,
      });
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message });
    } finally {
      setDownloadingInvoice(false);
    }
  };

  // Submit new writeoff
  const handleSubmitNewWriteoff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedEqIds.length === 0) return;

    setActionLoading(true);
    try {
      const updateRes = await apiFetch('/api/writeoff/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipment_ids: selectedEqIds,
          state: targetState,
          writeoff_date:
            targetState === 'WRITTEN_OFF'
              ? docDate
                ? new Date(`${docDate}T00:00:00Z`).toISOString()
                : new Date().toISOString()
              : null,
        }),
      });

      const updateData = await updateRes.json();
      if (!updateRes.ok) throw new Error(updateData.error || 'Ошибка списания оборудования');

      const selectedObjs = availableEquipment.filter((eq) => selectedEqIds.includes(eq.id));
      const invoiceEligibleIds =
        docFormMode === 'case3'
          ? []
          : selectedObjs
              .filter((eq) => docFormMode !== 'auto' || detectItemCase(eq) !== 'CASE_3')
              .map((eq) => eq.id);

      const idsToExport = [...selectedEqIds];
      setShowNewWriteoffModal(false);
      setSelectedEqIds([]);
      await fetchItems();

      if (downloadActAfter) {
        await handleDownloadActForIds(idsToExport);
      }
      if (downloadInvoiceAfter && invoiceEligibleIds.length > 0) {
        await handleDownloadInvoiceForIds(invoiceEligibleIds);
      }
      if (!downloadActAfter && (!downloadInvoiceAfter || invoiceEligibleIds.length === 0)) {
        setFeedbackMsg({
          type: 'success',
          text: `Статус списания для ${idsToExport.length} ед. оборудования успешно обновлен!`,
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
          writeoff_date:
            newState === 'WRITTEN_OFF'
              ? docDate
                ? new Date(`${docDate}T00:00:00Z`).toISOString()
                : new Date().toISOString()
              : null,
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

  const filteredModalEq = availableEquipment.filter((eq) => {
    if (!modalSearch.trim()) return true;
    const q = modalSearch.toLowerCase();
    return (
      eq.name.toLowerCase().includes(q) ||
      eq.inventory_number.toLowerCase().includes(q) ||
      eq.roomNumber.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* Header */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <FileSpreadsheet className="w-5 h-5 text-red-600" />
            <h2 className="text-lg font-bold text-slate-900">
              Списание материальных ценностей кафедры
            </h2>
          </div>
          <p className="text-xs text-slate-500">
            <strong>Кейс 1</strong> (Дорогост. с ДМ): Акт + ОКУД 0501460.{' '}
            <strong>Кейс 2</strong> (Малоценка с ДМ): Акт + Форма № 434.{' '}
            <strong>Кейс 3</strong> (Малоценка без ДМ): общий Акт (без накладной).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => handleDownloadSample('act-case1')}
            disabled={downloadingSample}
            className="px-2.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-[11px] font-semibold transition-colors inline-flex items-center gap-1 border border-slate-300"
          >
            <Download className="w-3.5 h-3.5 text-slate-600" />
            Пример Акт К1
          </button>
          <button
            onClick={() => handleDownloadSample('invoice-case1')}
            disabled={downloadingSample}
            className="px-2.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-[11px] font-semibold transition-colors inline-flex items-center gap-1 border border-slate-300"
          >
            <Truck className="w-3.5 h-3.5 text-slate-600" />
            Пример ОКУД 0501460
          </button>
          <button
            onClick={() => handleDownloadSample('act-case2')}
            disabled={downloadingSample}
            className="px-2.5 py-2 bg-amber-50 hover:bg-amber-100 text-amber-900 rounded-xl text-[11px] font-semibold transition-colors inline-flex items-center gap-1 border border-amber-300"
          >
            <Download className="w-3.5 h-3.5 text-amber-700" />
            Пример Акт К2
          </button>
          <button
            onClick={() => handleDownloadSample('invoice-case2')}
            disabled={downloadingSample}
            className="px-2.5 py-2 bg-amber-50 hover:bg-amber-100 text-amber-900 rounded-xl text-[11px] font-semibold transition-colors inline-flex items-center gap-1 border border-amber-300"
          >
            <Layers className="w-3.5 h-3.5 text-amber-700" />
            Пример Форма 434
          </button>
          <button
            onClick={() => handleDownloadSample('act-case3')}
            disabled={downloadingSample}
            className="px-2.5 py-2 bg-teal-50 hover:bg-teal-100 text-teal-900 rounded-xl text-[11px] font-semibold transition-colors inline-flex items-center gap-1 border border-teal-300"
          >
            <Download className="w-3.5 h-3.5 text-teal-700" />
            Пример Акт К3
          </button>

          {canManage && (
            <button
              onClick={() => {
                fetchAvailableEquipment();
                setSelectedEqIds([]);
                setShowNewWriteoffModal(true);
              }}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors inline-flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              Оформить списание
            </button>
          )}
        </div>
      </div>

      {/* Document Parameters Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 text-xs items-end">
        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1 flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5 text-blue-600" />
            Дата списания
          </label>
          <input
            type="date"
            value={docDate}
            onChange={(e) => setDocDate(e.target.value)}
            className="w-full p-2 border border-slate-200 rounded-xl bg-slate-50 outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
            Номер документа (опц.)
          </label>
          <input
            type="text"
            value={docNumber}
            onChange={(e) => setDocNumber(e.target.value)}
            placeholder="Пусто — вручную"
            className="w-full p-2 border border-slate-200 rounded-xl bg-slate-50 outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
            Основание (для Кейса 1)
          </label>
          <input
            type="text"
            value={actReason}
            onChange={(e) => setActReason(e.target.value)}
            className="w-full p-2 border border-slate-200 rounded-xl bg-slate-50 outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
            Формат бланков
          </label>
          <select
            value={docFormMode}
            onChange={(e) =>
              setDocFormMode(e.target.value as 'auto' | 'case1' | 'case2' | 'case3')
            }
            className="w-full p-2 border border-slate-200 rounded-xl bg-slate-50 outline-none font-medium"
          >
            <option value="auto">Авто (по категории и ДМ)</option>
            <option value="case1">Кейс 1 (Дорогост. + 0501460)</option>
            <option value="case2">Кейс 2 (Малоценка ДМ + Ф.434)</option>
            <option value="case3">Кейс 3 (Малоценка без ДМ, без накл.)</option>
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
            Фильтр по кейсу
          </label>
          <select
            value={caseFilter}
            onChange={(e) =>
              setCaseFilter(e.target.value as 'ALL' | 'CASE_1' | 'CASE_2' | 'CASE_3')
            }
            className="w-full p-2 border border-slate-200 rounded-xl bg-slate-50 outline-none"
          >
            <option value="ALL">Все позиции</option>
            <option value="CASE_1">Кейс 1: Дорогостоящее с ДМ</option>
            <option value="CASE_2">Кейс 2: Малоценка с ДМ</option>
            <option value="CASE_3">Кейс 3: Малоценка без ДМ</option>
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
            Статус списания
          </label>
          <select
            value={filterState}
            onChange={(e) => setFilterState(e.target.value)}
            className="w-full p-2 border border-slate-200 rounded-xl bg-slate-50 outline-none"
          >
            <option value="">Все статусы</option>
            <option value="PREPARING">Готовится к списанию</option>
            <option value="DOCUMENTS_PREPARATION">Подготовка документов</option>
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
        <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 font-semibold text-red-900">
            <span>Выбрано позиций: {selectedIds.length}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => handleDownloadActForIds(selectedIds)}
              disabled={downloadingAct}
              className="px-3.5 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors inline-flex items-center gap-1.5"
            >
              <FileText className="w-3.5 h-3.5" />
              {downloadingAct ? 'Генерация...' : `Акт списания (${selectedIds.length} поз.)`}
            </button>
            {(() => {
              const selectedObjs = items.filter((it) => selectedIds.includes(it.id));
              const allCase3Selected =
                docFormMode === 'case3' ||
                (docFormMode === 'auto' &&
                  selectedObjs.length > 0 &&
                  selectedObjs.every((it) => detectItemCase(it) === 'CASE_3'));
              if (allCase3Selected) {
                return (
                  <span className="px-2.5 py-1.5 rounded-lg bg-teal-100 text-teal-800 text-[11px] font-semibold">
                    Кейс 3 — без накладной
                  </span>
                );
              }
              return (
                <button
                  onClick={() => handleDownloadInvoiceForIds(selectedIds)}
                  disabled={downloadingInvoice}
                  className="px-3.5 py-1.5 bg-blue-700 hover:bg-blue-800 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors inline-flex items-center gap-1.5"
                >
                  <Truck className="w-3.5 h-3.5" />
                  {downloadingInvoice
                    ? 'Генерация...'
                    : `Накладная (${selectedIds.length} поз.)`}
                </button>
              );
            })()}
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
                        writeoff_date: docDate
                          ? new Date(`${docDate}T00:00:00Z`).toISOString()
                          : new Date().toISOString(),
                      }),
                    });
                    const count = selectedIds.length;
                    setSelectedIds([]);
                    fetchItems();
                    setFeedbackMsg({
                      type: 'success',
                      text: `Выбранное оборудование (${count} ед.) переведено в статус «Списано»!`,
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
        ) : !Array.isArray(visibleItems) || visibleItems.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mx-auto">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Оборудование в процессе списания не найдено. Нажмите «Оформить списание» или выберите оборудование в общем реестре.
            </p>
            {canManage && (
              <button
                onClick={() => {
                  fetchAvailableEquipment();
                  setSelectedEqIds([]);
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
                  checked={selectedIds.length === visibleItems.length && visibleItems.length > 0}
                  onChange={selectAll}
                  className="rounded text-blue-600 cursor-pointer"
                />
                <span>Выбрать все ({visibleItems.length} ед.)</span>
              </div>
              <span>Документы и статусы</span>
            </div>

            {visibleItems.map((item) => {
              const isSelected = selectedIds.includes(item.id);
              const detectedCase = detectItemCase(item);
              const kitPart = isKitComponent(item);
              const serviceLife = formatServiceLifePreview(item.recived, docDate);
              const qty =
                Number(item.additional_fields?.quantity) > 0
                  ? Number(item.additional_fields?.quantity)
                  : 1;
              const unitCost = Number(item.initial_cost) || 0;
              const totalCost = Math.round(unitCost * qty * 100) / 100;

              return (
                <div
                  key={item.id}
                  className={`p-4 hover:bg-slate-50 flex flex-col lg:flex-row lg:items-center justify-between gap-3 transition-colors ${
                    isSelected ? 'bg-indigo-50/40' : ''
                  }`}
                >
                  <div className="flex items-start sm:items-center gap-3">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(item.id)}
                      className="mt-1 sm:mt-0 rounded text-blue-600 cursor-pointer"
                    />
                    <span className="font-mono font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-[11px] shrink-0">
                      {item.inventory_number}
                    </span>
                    <div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          onClick={() => onOpenEquipmentDetail(item.id)}
                          className="font-bold text-slate-900 hover:text-blue-600 text-left text-sm"
                        >
                          {item.name}
                        </button>
                        {detectedCase === 'CASE_1' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">
                            <Gem className="w-3 h-3" />
                            Кейс 1 (Дорогост. • ДМ)
                          </span>
                        )}
                        {detectedCase === 'CASE_2' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 text-[10px] font-bold">
                            <Layers className="w-3 h-3" />
                            Кейс 2 (Малоценка • ДМ)
                          </span>
                        )}
                        {detectedCase === 'CASE_3' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-teal-100 text-teal-800 text-[10px] font-bold">
                            <Layers className="w-3 h-3" />
                            Кейс 3 (Малоценка без ДМ)
                          </span>
                        )}
                        {kitPart && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 text-[10px] font-semibold">
                            <Package className="w-3 h-3" />
                            Часть комплекта
                          </span>
                        )}
                        {qty > 1 && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                            {qty} шт.
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
                        <span>{item.typeName}</span>
                        <span>• Каб. {item.roomNumber}</span>
                        <span>
                          • Ввод: {new Date(item.recived).toLocaleDateString('ru-RU')} (срок на{' '}
                          {docDate ? new Date(`${docDate}T00:00:00`).toLocaleDateString('ru-RU') : 'сегодня'}:{' '}
                          <strong className="text-slate-700">{serviceLife}</strong>)
                        </span>
                        <span>
                          • Цена:{' '}
                          <strong className="text-slate-700">
                            {kitPart && detectedCase !== 'CASE_2' && detectedCase !== 'CASE_3'
                              ? 'в составе комплекта'
                              : `${formatCostRu(unitCost)} BYN`}
                          </strong>
                          {qty > 1 && ` × ${qty} = ${formatCostRu(totalCost)} BYN`}
                        </span>
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

                    <button
                      onClick={() => handleDownloadActForIds([item.id])}
                      className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 rounded-lg text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                      title="Скачать Акт списания (автоматически выбирает форму Кейс 1, 2 или 3)"
                    >
                      <Download className="w-3.5 h-3.5 text-emerald-600" />
                      Акт (.docx)
                    </button>

                    {detectedCase !== 'CASE_3' && (
                      <button
                        onClick={() => handleDownloadInvoiceForIds([item.id])}
                        className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-800 rounded-lg text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                        title={
                          detectedCase === 'CASE_2'
                            ? 'Скачать Накладную-требование Форма № 434'
                            : 'Скачать Накладную в ЦИТ (ОКУД 0501460)'
                        }
                      >
                        <Truck className="w-3.5 h-3.5 text-blue-600" />
                        {detectedCase === 'CASE_2' ? 'Форма 434' : 'ЦИТ'}
                      </button>
                    )}

                    {canManage && item.writeoffState !== 'WRITTEN_OFF' && (
                      <button
                        onClick={() => handleQuickStatusChange(item.id, 'WRITTEN_OFF')}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium"
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
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-2xl w-full p-6 space-y-4 max-h-[90vh] flex flex-col">
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

            <form onSubmit={handleSubmitNewWriteoff} className="space-y-4 text-xs overflow-y-auto pr-1">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="font-semibold text-slate-700">
                    Выберите оборудование ({selectedEqIds.length} выбрано):
                  </label>
                  <input
                    type="text"
                    value={modalSearch}
                    onChange={(e) => setModalSearch(e.target.value)}
                    placeholder="Поиск по инв. № или названию..."
                    className="px-2.5 py-1 border border-slate-200 rounded-lg text-xs outline-none w-56"
                  />
                </div>
                <div className="border border-slate-200 rounded-xl max-h-52 overflow-y-auto divide-y divide-slate-100">
                  {filteredModalEq.length === 0 ? (
                    <div className="p-4 text-center text-slate-400">Оборудование не найдено</div>
                  ) : (
                    filteredModalEq.map((eq) => {
                      const checked = selectedEqIds.includes(eq.id);
                      const eqCase = detectItemCase(eq);
                      const qty =
                        Number(eq.additional_fields?.quantity) > 0
                          ? Number(eq.additional_fields?.quantity)
                          : 1;
                      return (
                        <label
                          key={eq.id}
                          className={`flex items-center justify-between gap-2 p-2.5 cursor-pointer hover:bg-slate-50 ${
                            checked ? 'bg-red-50/50' : ''
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setSelectedEqIds((prev) =>
                                  prev.includes(eq.id)
                                    ? prev.filter((id) => id !== eq.id)
                                    : [...prev, eq.id]
                                )
                              }
                              className="rounded text-red-600"
                            />
                            <span className="font-mono text-[11px] bg-slate-100 px-1.5 py-0.5 rounded shrink-0">
                              {eq.inventory_number}
                            </span>
                            <span className="font-medium text-slate-800 truncate">{eq.name}</span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0 text-[11px] text-slate-500">
                            {eqCase === 'CASE_1' && (
                              <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold">
                                К1 (ДМ)
                              </span>
                            )}
                            {eqCase === 'CASE_2' && (
                              <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 font-semibold">
                                К2 (Малоц. ДМ)
                              </span>
                            )}
                            {eqCase === 'CASE_3' && (
                              <span className="px-1.5 py-0.5 rounded bg-teal-100 text-teal-800 font-semibold">
                                К3 (Без ДМ)
                              </span>
                            )}
                            {qty > 1 && (
                              <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold">
                                {qty} шт.
                              </span>
                            )}
                            <span>{formatCostRu(eq.initial_cost)} BYN</span>
                          </div>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Статус жизненного цикла:
                  </label>
                  <select
                    value={targetState}
                    onChange={(e: any) => setTargetState(e.target.value)}
                    className="w-full p-2.5 border border-slate-300 rounded-xl outline-none font-medium"
                  >
                    <option value="PREPARING">Готовится к списанию</option>
                    <option value="DOCUMENTS_PREPARATION">Подготовка документов</option>
                    <option value="WRITTEN_OFF">Списано с баланса</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Дата списания / документа:
                  </label>
                  <input
                    type="date"
                    value={docDate}
                    onChange={(e) => setDocDate(e.target.value)}
                    className="w-full p-2.5 border border-slate-300 rounded-xl outline-none"
                  />
                </div>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <label className="flex items-center gap-2 cursor-pointer font-semibold text-slate-800">
                  <input
                    type="checkbox"
                    checked={downloadActAfter}
                    onChange={(e) => setDownloadActAfter(e.target.checked)}
                    className="rounded text-emerald-600"
                  />
                  <span>Сразу скачать Акт списания (Кейс 1, 2 или 3 автоматически, DOCX)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer font-semibold text-slate-800">
                  <input
                    type="checkbox"
                    checked={downloadInvoiceAfter}
                    onChange={(e) => setDownloadInvoiceAfter(e.target.checked)}
                    className="rounded text-blue-600"
                  />
                  <span>Сразу скачать Накладную (для К1 и К2; для К3 не требуется, DOCX)</span>
                </label>
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
                  disabled={actionLoading || selectedEqIds.length === 0}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white rounded-xl font-bold shadow-xs flex items-center gap-1.5"
                >
                  <Download className="w-4 h-4" />
                  {actionLoading ? 'Обработка...' : `Оформить (${selectedEqIds.length} ед.)`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
