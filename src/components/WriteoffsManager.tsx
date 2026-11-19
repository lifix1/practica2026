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
  Settings2,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import type { Equipment, User } from '../types/index.ts';
import { apiFetch } from '../utils/api.ts';
import { WriteoffTemplatesModal } from './WriteoffTemplatesModal.tsx';

interface WriteoffsManagerProps {
  currentUser: User | null;
  onOpenEquipmentDetail: (id: number) => void;
}

function formatServiceLifePreview(recivedIso: string | null | undefined, targetDateStr: string): string {
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

function hasInventoryNumber(item: Pick<Equipment, 'inventory_number'>): boolean {
  return Boolean(item.inventory_number && String(item.inventory_number).trim());
}

function isPreciousMetalsTrue(val: unknown): boolean {
  if (val === true || val === 1) return true;
  if (typeof val === 'string') {
    const s = val.trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'да' || s === 'yes';
  }
  return false;
}

function detectItemCase(item: Equipment): 'CASE_1' | 'CASE_2' | 'CASE_3' | 'OTHER' | 'NO_INV' {
  if (!hasInventoryNumber(item)) return 'NO_INV';
  const cat = (item.additional_fields?.accounting_category || '').toLowerCase();
  const hasDm = isPreciousMetalsTrue(item.additional_fields?.precious_metals);
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
  const [caseFilter, setCaseFilter] = useState<'ALL' | 'CASE_1' | 'CASE_2' | 'CASE_3' | 'OTHER'>('ALL');
  const [docFormMode, setDocFormMode] = useState<'auto' | 'case1' | 'case2' | 'case3'>('auto');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [downloadingAct, setDownloadingAct] = useState(false);
  const [downloadingInvoice, setDownloadingInvoice] = useState(false);
  const [downloadingSample, setDownloadingSample] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);

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
  const [showTemplatesModal, setShowTemplatesModal] = useState(false);
  const [confirmWriteoffTarget, setConfirmWriteoffTarget] = useState<
    | { mode: 'single'; item: Equipment }
    | { mode: 'bulk'; ids: number[]; items: Equipment[] }
    | { mode: 'create'; ids: number[]; items: Equipment[] }
    | null
  >(null);
  const [confirmWriteoffLoading, setConfirmWriteoffLoading] = useState(false);
  const [rollbackTarget, setRollbackTarget] = useState<
    | { mode: 'single'; item: Equipment }
    | { mode: 'bulk'; ids: number[]; items: Equipment[] }
    | null
  >(null);
  const [rollbackNextState, setRollbackNextState] = useState<'NONE' | 'DOCUMENTS_PREPARATION'>('NONE');
  const [rollbackLoading, setRollbackLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<
    | { mode: 'single'; item: Equipment }
    | { mode: 'bulk'; ids: number[]; items: Equipment[] }
    | null
  >(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
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
      params.set('only_writeoffs', 'true');
      params.set('include_written_off', 'true');
      if (filterState) params.set('writeoff_state', filterState);
      params.set('limit', '500');

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

  const fetchAvailableEquipment = async (searchQuery = '') => {
    try {
      const params = new URLSearchParams();
      params.set('limit', '200');
      if (searchQuery.trim()) {
        params.set('search', searchQuery.trim());
      }
      const res = await apiFetch(`/api/equipment?${params.toString()}`);
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

  useEffect(() => {
    if (!showNewWriteoffModal) return;
    const timer = setTimeout(() => {
      fetchAvailableEquipment(modalSearch);
    }, 250);
    return () => clearTimeout(timer);
  }, [modalSearch, showNewWriteoffModal]);

  const visibleItems = items
    .filter((item) => {
      const c = detectItemCase(item);
      if (caseFilter === 'CASE_1') return c === 'CASE_1';
      if (caseFilter === 'CASE_2') return c === 'CASE_2';
      if (caseFilter === 'CASE_3') return c === 'CASE_3';
      if (caseFilter === 'OTHER') return c === 'OTHER' || c === 'NO_INV';
      return true;
    })
    .sort((a, b) => {
      const aWritten = a.writeoffState === 'WRITTEN_OFF';
      const bWritten = b.writeoffState === 'WRITTEN_OFF';
      if (aWritten !== bWritten) return aWritten ? 1 : -1;
      if (aWritten && bWritten) {
        const aTime = a.writeoffDate ? new Date(a.writeoffDate).getTime() : 0;
        const bTime = b.writeoffDate ? new Date(b.writeoffDate).getTime() : 0;
        const validA = Number.isFinite(aTime) ? aTime : 0;
        const validB = Number.isFinite(bTime) ? bTime : 0;
        if (validA !== validB) return validB - validA;
      }
      return Number(b.id) - Number(a.id);
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

  // Export selected writeoff rows to Excel (.xlsx)
  const handleExportSelectedExcel = async () => {
    if (selectedIds.length === 0) return;
    setExportingExcel(true);
    try {
      const res = await apiFetch('/api/equipment/export-excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipment_ids: selectedIds,
          source: 'writeoff',
        }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Ошибка экспорта в Excel');
      }
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      const fnMatch = cd.match(/filename="([^"]+)"/i);
      const filename =
        fnMatch?.[1] || `export-spisanie-${new Date().toISOString().slice(0, 10)}.xlsx`;
      triggerBlobDownload(blob, filename);
      setFeedbackMsg({
        type: 'success',
        text: `Выбранные строки списания (${selectedIds.length} поз.) экспортированы в Excel!`,
      });
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message || 'Ошибка экспорта в Excel' });
    } finally {
      setExportingExcel(false);
    }
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
      const res = await apiFetch(endpointMap[kind]);
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
      const cd = res.headers.get('Content-Disposition') || '';
      const fnMatch = cd.match(/filename="([^"]+)"/i);
      const filename =
        fnMatch?.[1] || `akty-${caseType}-${ids.length}-poz-${docDate || 'today'}.docx`;
      triggerBlobDownload(blob, filename);
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
      const cd = res.headers.get('Content-Disposition') || '';
      const fnMatch = cd.match(/filename="([^"]+)"/i);
      const filename =
        fnMatch?.[1] || `nakladnaya-${caseType}-${ids.length}-poz-${docDate || 'today'}.docx`;
      triggerBlobDownload(blob, filename);
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

  // Execute create writeoff request (optionally after confirmation when targetState === 'WRITTEN_OFF')
  const executeNewWriteoff = async () => {
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

      const selectedObjs = availableEquipment.filter(
        (eq) => selectedEqIds.includes(eq.id) && hasInventoryNumber(eq)
      );
      const actEligibleIds = selectedObjs
        .filter((eq) => {
          const c = detectItemCase(eq);
          return docFormMode === 'auto'
            ? c === 'CASE_1' || c === 'CASE_2' || c === 'CASE_3'
            : c !== 'NO_INV';
        })
        .map((eq) => eq.id);
      const invoiceEligibleIds =
        docFormMode === 'case3'
          ? []
          : selectedObjs
              .filter((eq) => {
                const c = detectItemCase(eq);
                if (c === 'NO_INV') return false;
                if (docFormMode !== 'auto') return true;
                return c === 'CASE_1' || c === 'CASE_2';
              })
              .map((eq) => eq.id);

      const idsToExport = [...selectedEqIds];
      setShowNewWriteoffModal(false);
      setSelectedEqIds([]);
      await fetchItems();

      if (downloadActAfter && actEligibleIds.length > 0) {
        await handleDownloadActForIds(actEligibleIds);
      }
      if (downloadInvoiceAfter && invoiceEligibleIds.length > 0) {
        await handleDownloadInvoiceForIds(invoiceEligibleIds);
      }
      if (
        (!downloadActAfter || actEligibleIds.length === 0) &&
        (!downloadInvoiceAfter || invoiceEligibleIds.length === 0)
      ) {
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

  const handleSubmitNewWriteoff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedEqIds.length === 0) return;
    if (targetState === 'WRITTEN_OFF') {
      const selectedObjs = availableEquipment.filter((eq) => selectedEqIds.includes(eq.id));
      setConfirmWriteoffTarget({
        mode: 'create',
        ids: [...selectedEqIds],
        items: selectedObjs,
      });
      return;
    }
    await executeNewWriteoff();
  };

  // Confirmed irreversible transition into WRITTEN_OFF
  const handleConfirmWriteoffCompletion = async () => {
    if (!confirmWriteoffTarget) return;
    setConfirmWriteoffLoading(true);
    try {
      if (confirmWriteoffTarget.mode === 'create') {
        await executeNewWriteoff();
        setConfirmWriteoffTarget(null);
        return;
      }

      const targetIds =
        confirmWriteoffTarget.mode === 'single'
          ? [confirmWriteoffTarget.item.id]
          : confirmWriteoffTarget.ids;

      const res = await apiFetch('/api/writeoff/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipment_ids: targetIds,
          state: 'WRITTEN_OFF',
          writeoff_date: docDate
            ? new Date(`${docDate}T00:00:00Z`).toISOString()
            : new Date().toISOString(),
        }),
      });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(resData.error || 'Ошибка завершения списания');

      if (confirmWriteoffTarget.mode === 'bulk') {
        setSelectedIds([]);
      } else {
        setSelectedIds((prev) => prev.filter((id) => id !== confirmWriteoffTarget.item.id));
      }

      const label =
        confirmWriteoffTarget.mode === 'single'
          ? `Оборудование «${confirmWriteoffTarget.item.name}» переведено в статус «Списано»`
          : `Выбранное оборудование (${targetIds.length} ед.) переведено в статус «Списано»!`;

      setConfirmWriteoffTarget(null);
      await fetchItems();
      setFeedbackMsg({ type: 'success', text: label });
    } catch (e: any) {
      setFeedbackMsg({ type: 'error', text: e.message || 'Ошибка завершения списания' });
    } finally {
      setConfirmWriteoffLoading(false);
    }
  };

  // Rollback writeoff status (with confirmation)
  const handleConfirmRollback = async () => {
    if (!rollbackTarget) return;
    setRollbackLoading(true);
    try {
      const targetIds =
        rollbackTarget.mode === 'single' ? [rollbackTarget.item.id] : rollbackTarget.ids;

      const res = await apiFetch('/api/writeoff/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipment_ids: targetIds,
          target_state: rollbackNextState,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Ошибка отката списания');

      if (rollbackTarget.mode === 'bulk') {
        setSelectedIds([]);
      } else {
        setSelectedIds((prev) => prev.filter((id) => id !== rollbackTarget.item.id));
      }

      const successText =
        rollbackTarget.mode === 'single'
          ? rollbackNextState === 'NONE'
            ? `Списание «${rollbackTarget.item.name}» откачено — позиция возвращена в активный учёт.`
            : `Позиция «${rollbackTarget.item.name}» возвращена на этап «Подготовка документов».`
          : rollbackNextState === 'NONE'
          ? `Выполнен откат списания для ${targetIds.length} ед. оборудования (возвращены в активный учёт).`
          : `Для ${targetIds.length} ед. оборудования выполнен откат на этап «Подготовка документов».`;

      setRollbackTarget(null);
      setRollbackNextState('NONE');
      await fetchItems();
      setFeedbackMsg({ type: 'success', text: successText });
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message || 'Ошибка отката списания' });
    } finally {
      setRollbackLoading(false);
    }
  };

  // Single or Bulk Equipment Delete from DB (identical to main table)
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

      const deletedText =
        deleteTarget.mode === 'single'
          ? `Оборудование «${deleteTarget.item.name}» удалено из базы данных.`
          : `Удалено записей оборудования: ${deleteTarget.ids.length} шт.`;

      setDeleteTarget(null);
      await fetchItems();
      setFeedbackMsg({ type: 'success', text: deletedText });
    } catch (err: any) {
      setDeleteError(err.message || 'Ошибка удаления оборудования');
    } finally {
      setDeleting(false);
    }
  };

  const filteredModalEq = availableEquipment.filter((eq) => {
    if (!modalSearch.trim()) return true;
    const q = modalSearch.toLowerCase();
    return (
      (eq.name || '').toLowerCase().includes(q) ||
      (eq.inventory_number || '').toLowerCase().includes(q) ||
      (eq.roomNumber || '').toLowerCase().includes(q)
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
            <>
              <button
                type="button"
                onClick={() => setShowTemplatesModal(true)}
                className="px-3.5 py-2 bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 rounded-xl text-xs font-semibold shadow-xs transition-colors inline-flex items-center gap-1.5"
                title="Редактировать № приказа, должностных лиц и загружать свои Word-шаблоны (.docx)"
              >
                <Settings2 className="w-4 h-4 text-blue-600" />
                Шаблоны документов
              </button>
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
            </>
          )}
        </div>
      </div>

      {/* Document Parameters Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 text-xs items-end">
        <div>
          <label className="text-[11px] font-semibold text-slate-600 mb-1 flex items-center gap-1">
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
              setCaseFilter(e.target.value as 'ALL' | 'CASE_1' | 'CASE_2' | 'CASE_3' | 'OTHER')
            }
            className="w-full p-2 border border-slate-200 rounded-xl bg-slate-50 outline-none"
          >
            <option value="ALL">Все позиции</option>
            <option value="CASE_1">Кейс 1: Дорогостоящее с ДМ</option>
            <option value="CASE_2">Кейс 2: Малоценка с ДМ</option>
            <option value="CASE_3">Кейс 3: Малоценка без ДМ</option>
            <option value="OTHER">Без кейса для списания</option>
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
              type="button"
              onClick={handleExportSelectedExcel}
              disabled={exportingExcel}
              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors inline-flex items-center gap-1.5"
              title="Экспортировать все выбранные строки в таблицу Excel (.xlsx)"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              {exportingExcel ? 'Экспорт...' : 'Экспорт в Excel'}
            </button>
            {(() => {
              const selectedObjs = items.filter((it) => selectedIds.includes(it.id));
              const balanceSelected = selectedObjs.filter(hasInventoryNumber);
              const actEligibleIds = balanceSelected
                .filter((it) => {
                  const c = detectItemCase(it);
                  return docFormMode === 'auto'
                    ? c === 'CASE_1' || c === 'CASE_2' || c === 'CASE_3'
                    : true;
                })
                .map((it) => it.id);
              const invoiceEligibleIds =
                docFormMode === 'case3'
                  ? []
                  : balanceSelected
                      .filter((it) => {
                        if (docFormMode !== 'auto') return true;
                        const c = detectItemCase(it);
                        return c === 'CASE_1' || c === 'CASE_2';
                      })
                      .map((it) => it.id);

              if (balanceSelected.length === 0) {
                return (
                  <span className="px-2.5 py-1.5 rounded-lg bg-slate-200 text-slate-700 text-[11px] font-semibold">
                    Позиции без инв. № не подлежат списанию (только удаление)
                  </span>
                );
              }

              if (actEligibleIds.length === 0) {
                return (
                  <span className="px-2.5 py-1.5 rounded-lg bg-slate-200 text-slate-700 text-[11px] font-semibold">
                    Нет кейса списания — акты и накладные не формируются
                  </span>
                );
              }

              return (
                <>
                  <button
                    onClick={() => handleDownloadActForIds(actEligibleIds)}
                    disabled={downloadingAct}
                    className="px-3.5 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors inline-flex items-center gap-1.5"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    {downloadingAct
                      ? 'Генерация...'
                      : `Акт списания (${actEligibleIds.length} поз.)`}
                  </button>
                  {invoiceEligibleIds.length === 0 ? (
                    <span className="px-2.5 py-1.5 rounded-lg bg-teal-100 text-teal-800 text-[11px] font-semibold">
                      Кейс 3 — без накладной
                    </span>
                  ) : (
                    <button
                      onClick={() => handleDownloadInvoiceForIds(invoiceEligibleIds)}
                      disabled={downloadingInvoice}
                      className="px-3.5 py-1.5 bg-blue-700 hover:bg-blue-800 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors inline-flex items-center gap-1.5"
                    >
                      <Truck className="w-3.5 h-3.5" />
                      {downloadingInvoice
                        ? 'Генерация...'
                        : `Накладная (${invoiceEligibleIds.length} поз.)`}
                    </button>
                  )}
                </>
              );
            })()}
            {canManage && (() => {
              const selectedObjs = items.filter((it) => selectedIds.includes(it.id));
              const eligibleBulkItems = selectedObjs.filter(
                (it) => hasInventoryNumber(it) && it.writeoffState !== 'WRITTEN_OFF'
              );
              return (
                <>
                  {eligibleBulkItems.length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmWriteoffTarget({
                          mode: 'bulk',
                          ids: eligibleBulkItems.map((it) => it.id),
                          items: eligibleBulkItems,
                        })
                      }
                      className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold shadow-xs"
                    >
                      Перевести в «Списано»
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setRollbackNextState('NONE');
                      setRollbackTarget({
                        mode: 'bulk',
                        ids: selectedObjs.map((it) => it.id),
                        items: selectedObjs,
                      });
                    }}
                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold shadow-xs inline-flex items-center gap-1"
                    title="Откатить списание для выбранных позиций"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Откатить списание
                  </button>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteError(null);
                        setDeleteTarget({
                          mode: 'bulk',
                          ids: selectedObjs.map((it) => it.id),
                          items: selectedObjs,
                        });
                      }}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold shadow-xs inline-flex items-center gap-1"
                      title="Удалить выбранное оборудование из базы данных"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Удалить ({selectedObjs.length})
                    </button>
                  )}
                </>
              );
            })()}
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
            <div className="p-3 bg-slate-50 text-slate-500 font-semibold flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedIds.length === visibleItems.length && visibleItems.length > 0}
                  onChange={selectAll}
                  className="rounded text-blue-600 cursor-pointer"
                />
                <span>Выбрать все ({visibleItems.length} ед.)</span>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[10px] font-medium text-slate-600">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded bg-[#fdf9ef] border border-[#e6d6b1]" />
                  Выбрано для списания
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded bg-[#f4e7cf] border border-[#d7be92]" />
                  Проходит процедуру
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded bg-slate-200 border border-slate-300" />
                  Списано (внизу, новые сверху)
                </span>
              </div>
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

              const isWrittenOff = item.writeoffState === 'WRITTEN_OFF';
              const isDocsPrep = item.writeoffState === 'DOCUMENTS_PREPARATION';
              const rowBgClass = isSelected
                ? 'bg-indigo-50/55 ring-1 ring-inset ring-indigo-300'
                : isWrittenOff
                ? 'bg-slate-200/75 hover:bg-slate-200 text-slate-600'
                : isDocsPrep
                ? 'bg-[#f4e7cf] hover:bg-[#ecdabc]'
                : 'bg-[#fdf9ef] hover:bg-[#f7f0dc]';

              return (
                <div
                  key={item.id}
                  className={`p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 transition-colors ${rowBgClass}`}
                >
                  <div className="flex items-start sm:items-center gap-3">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(item.id)}
                      className="mt-1 sm:mt-0 rounded text-blue-600 cursor-pointer"
                    />
                    <span className="font-mono font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-[11px] shrink-0">
                      {item.inventory_number || 'б/н'}
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
                        {detectedCase === 'OTHER' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-semibold border border-slate-200">
                            Без кейса списания
                          </span>
                        )}
                        {detectedCase === 'NO_INV' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 text-red-700 text-[10px] font-semibold border border-red-200">
                            Без инв. № (не на балансе)
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
                        <span>{item.typeName || 'Без типа'}</span>
                        <span>• {item.roomNumber || 'Без локации'}</span>
                        <span>
                          • Ввод: {item.recived ? new Date(item.recived).toLocaleDateString('ru-RU') : 'не указана'} (срок на{' '}
                          {docDate ? new Date(`${docDate}T00:00:00`).toLocaleDateString('ru-RU') : 'сегодня'}:{' '}
                          <strong className="text-slate-700">{serviceLife}</strong>)
                        </span>
                        <span>
                          • Цена:{' '}
                          <strong className="text-slate-700 tabular-nums">
                            {kitPart && detectedCase !== 'CASE_2' && detectedCase !== 'CASE_3'
                              ? 'в составе комплекта'
                              : `${formatCostRu(unitCost)} BYN`}
                          </strong>
                          {qty > 1 && <span className="tabular-nums">{` × ${qty} = ${formatCostRu(totalCost)} BYN`}</span>}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <span
                      className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
                        item.writeoffState === 'WRITTEN_OFF'
                          ? 'bg-slate-200 text-slate-700 border-slate-300'
                          : item.writeoffState === 'DOCUMENTS_PREPARATION'
                          ? 'bg-[#ead5b2] text-amber-950 border-[#d7be92]'
                          : 'bg-[#f6ecd4] text-amber-900 border-[#e6d6b1]'
                      }`}
                    >
                      {item.writeoffState === 'WRITTEN_OFF'
                        ? item.writeoffDate
                          ? `Списано · ${new Date(item.writeoffDate).toLocaleDateString('ru-RU')}`
                          : 'Списано'
                        : item.writeoffState === 'DOCUMENTS_PREPARATION'
                        ? 'Проходит процедуру'
                        : 'Выбрано для списания'}
                    </span>

                    {detectedCase === 'NO_INV' ? (
                      <span className="px-2.5 py-1 bg-red-50 text-red-700 border border-red-200 rounded-lg text-[11px] font-medium">
                        Не списывается (только удаление)
                      </span>
                    ) : (detectedCase !== 'OTHER' || docFormMode !== 'auto') ? (
                      <>
                        <button
                          onClick={() => handleDownloadActForIds([item.id])}
                          className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 rounded-lg text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                          title="Скачать Акт списания (автоматически выбирает форму Кейс 1, 2 или 3)"
                        >
                          <Download className="w-3.5 h-3.5 text-emerald-600" />
                          Акт (.docx)
                        </button>

                        {detectedCase !== 'CASE_3' && docFormMode !== 'case3' && (
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
                      </>
                    ) : (
                      <span className="px-2.5 py-1 bg-slate-100 text-slate-500 rounded-lg text-[11px] font-medium">
                        Документы не требуются
                      </span>
                    )}

                    {canManage && item.writeoffState !== 'WRITTEN_OFF' && detectedCase !== 'NO_INV' && (
                      <button
                        type="button"
                        onClick={() => setConfirmWriteoffTarget({ mode: 'single', item })}
                        className="px-2.5 py-1 bg-white/80 hover:bg-white border border-slate-300 text-slate-700 rounded-lg text-xs font-medium"
                      >
                        Завершить списание
                      </button>
                    )}

                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => {
                          setRollbackNextState('NONE');
                          setRollbackTarget({ mode: 'single', item });
                        }}
                        className="px-2.5 py-1 bg-white/80 hover:bg-amber-50 border border-amber-300 text-amber-800 rounded-lg text-xs font-medium inline-flex items-center gap-1 transition-colors"
                        title={
                          item.writeoffState === 'WRITTEN_OFF'
                            ? 'Откатить списание (вернуть в активный учёт или на подготовку документов)'
                            : 'Убрать из списка списания (откатить статус)'
                        }
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Откатить
                      </button>
                    )}

                    <button
                      onClick={() => onOpenEquipmentDetail(item.id)}
                      className="px-3 py-1 bg-white/80 hover:bg-white border border-slate-200 text-slate-700 rounded-lg text-xs font-semibold"
                    >
                      Паспорт
                    </button>

                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteError(null);
                          setDeleteTarget({ mode: 'single', item });
                        }}
                        className="p-1.5 rounded-lg bg-white/80 border border-red-200 hover:bg-red-50 text-red-600 transition-colors"
                        title="Удалить оборудование из базы данных"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
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
                      const canWriteoff = eqCase !== 'NO_INV';
                      const qty =
                        Number(eq.additional_fields?.quantity) > 0
                          ? Number(eq.additional_fields?.quantity)
                          : 1;
                      return (
                        <label
                          key={eq.id}
                          className={`flex items-center justify-between gap-2 p-2.5 ${
                            canWriteoff
                              ? `cursor-pointer hover:bg-slate-50 ${checked ? 'bg-red-50/50' : ''}`
                              : 'cursor-not-allowed bg-slate-50/70 opacity-65'
                          }`}
                          title={
                            canWriteoff
                              ? undefined
                              : 'Оборудование без инвентарного номера не находится на балансе — его можно только удалить'
                          }
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <input
                              type="checkbox"
                              checked={checked && canWriteoff}
                              disabled={!canWriteoff}
                              onChange={() => {
                                if (!canWriteoff) return;
                                setSelectedEqIds((prev) =>
                                  prev.includes(eq.id)
                                    ? prev.filter((id) => id !== eq.id)
                                    : [...prev, eq.id]
                                );
                              }}
                              className="rounded text-red-600 disabled:opacity-40"
                            />
                            <span className="font-mono text-[11px] bg-slate-100 px-1.5 py-0.5 rounded shrink-0">
                              {eq.inventory_number || 'б/н'}
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
                            {eqCase === 'OTHER' && (
                              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-semibold">
                                Без кейса (без акта)
                              </span>
                            )}
                            {eqCase === 'NO_INV' && (
                              <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 font-semibold">
                                Без инв. № · только удаление
                              </span>
                            )}
                            {qty > 1 && (
                              <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold">
                                {qty} шт.
                              </span>
                            )}
                            <span className="tabular-nums">{formatCostRu(eq.initial_cost)} BYN</span>
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

      {/* Confirmation Modal for Completing Write-off (WRITTEN_OFF) */}
      {confirmWriteoffTarget && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/55 p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-red-100 text-red-600 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-900">
                    Завершение списания оборудования
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Дата списания:{' '}
                    <span className="font-semibold text-slate-700 tabular-nums">
                      {docDate
                        ? new Date(`${docDate}T00:00:00`).toLocaleDateString('ru-RU')
                        : new Date().toLocaleDateString('ru-RU')}
                    </span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !confirmWriteoffLoading && setConfirmWriteoffTarget(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1.5">
              {confirmWriteoffTarget.mode === 'single' ? (
                <>
                  <div className="font-semibold text-slate-900">
                    {confirmWriteoffTarget.item.name}
                  </div>
                  <div className="text-[11px] text-slate-600 font-mono tabular-nums">
                    Инв. № {confirmWriteoffTarget.item.inventory_number || 'б/н'} · ID #{confirmWriteoffTarget.item.id}
                  </div>
                </>
              ) : (
                <>
                  <div className="font-semibold text-slate-900">
                    Выбрано единиц оборудования: {confirmWriteoffTarget.ids.length} шт.
                  </div>
                  <div className="max-h-28 overflow-y-auto divide-y divide-slate-200/70 pr-1">
                    {confirmWriteoffTarget.items.map((eq) => (
                      <div key={eq.id} className="py-1 flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-slate-800 truncate">{eq.name}</span>
                        <span className="font-mono text-slate-500 shrink-0">
                          {eq.inventory_number || `ID #${eq.id}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Вы действительно хотите завершить списание и перевести{' '}
              {confirmWriteoffTarget.mode === 'single' ? 'данную позицию' : 'выбранные позиции'} в
              статус <strong className="text-slate-900">«Списано с баланса»</strong>? После
              подтверждения редактирование карточки, выдача, инвентаризация и регистрация
              неисправностей будут заблокированы.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setConfirmWriteoffTarget(null)}
                disabled={confirmWriteoffLoading}
                className="px-3.5 py-2 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleConfirmWriteoffCompletion}
                disabled={confirmWriteoffLoading}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white rounded-xl text-xs font-bold shadow-xs"
              >
                {confirmWriteoffLoading ? 'Выполнение...' : 'Подтвердить списание'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rollback Confirmation Modal */}
      {rollbackTarget && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/55 p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                  <RotateCcw className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-900">
                    Откат списания оборудования
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Подтвердите возврат из статуса списания
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !rollbackLoading && setRollbackTarget(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1.5">
              {rollbackTarget.mode === 'single' ? (
                <>
                  <div className="font-semibold text-slate-900">
                    {rollbackTarget.item.name}
                  </div>
                  <div className="text-[11px] text-slate-600 font-mono tabular-nums">
                    Инв. № {rollbackTarget.item.inventory_number || 'б/н'} · ID #{rollbackTarget.item.id}
                  </div>
                </>
              ) : (
                <>
                  <div className="font-semibold text-slate-900">
                    Выбрано единиц оборудования: {rollbackTarget.ids.length} шт.
                  </div>
                  <div className="max-h-28 overflow-y-auto divide-y divide-slate-200/70 pr-1">
                    {rollbackTarget.items.map((eq) => (
                      <div key={eq.id} className="py-1 flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-slate-800 truncate">{eq.name}</span>
                        <span className="font-mono text-slate-500 shrink-0">
                          {eq.inventory_number || `ID #${eq.id}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="space-y-2 text-xs">
              <label className="flex items-start gap-2 p-2.5 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50">
                <input
                  type="radio"
                  name="rollbackNextState"
                  checked={rollbackNextState === 'NONE'}
                  onChange={() => setRollbackNextState('NONE')}
                  className="mt-0.5 text-amber-600"
                />
                <div>
                  <div className="font-semibold text-slate-900">
                    Полный откат (вернуть в активное оборудование)
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Статус списания будет снят, позиция исчезнет со вкладки «Списание» и снова станет доступна для редактирования, выдачи и инвентаризации.
                  </div>
                </div>
              </label>
              <label className="flex items-start gap-2 p-2.5 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50">
                <input
                  type="radio"
                  name="rollbackNextState"
                  checked={rollbackNextState === 'DOCUMENTS_PREPARATION'}
                  onChange={() => setRollbackNextState('DOCUMENTS_PREPARATION')}
                  className="mt-0.5 text-amber-600"
                />
                <div>
                  <div className="font-semibold text-slate-900">
                    Вернуть на этап «Проходит процедуру»
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Дата окончательного списания очистится, позиция останется во вкладке «Списание» в статусе подготовки документов.
                  </div>
                </div>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setRollbackTarget(null)}
                disabled={rollbackLoading}
                className="px-3.5 py-2 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleConfirmRollback}
                disabled={rollbackLoading}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-400 text-white rounded-xl text-xs font-bold shadow-xs"
              >
                {rollbackLoading ? 'Выполнение...' : 'Подтвердить откат'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Equipment Confirmation Modal (identical to main table) */}
      {deleteTarget && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/55 p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full p-6 space-y-4">
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
                  ({deleteTarget.item.inventory_number ? (
                    <>инв. № <span className="font-mono">{deleteTarget.item.inventory_number}</span></>
                  ) : (
                    <>ID #{deleteTarget.item.id}</>
                  )})?
                  Запись будет полностью удалена из базы данных. Это действие необратимо.
                </>
              ) : (
                <>
                  Вы действительно хотите удалить выбранные единицы оборудования (
                  <strong>{deleteTarget.ids.length} шт.</strong>) из базы данных? Все связанные
                  записи о списании, проверках, неисправностях и передачах будут также удалены.
                </>
              )}
            </p>
            {deleteError && (
              <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
                {deleteError}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="px-3.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl"
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

      {/* Templates Editor Modal */}
      <WriteoffTemplatesModal
        isOpen={showTemplatesModal}
        onClose={() => setShowTemplatesModal(false)}
        onFeedback={(msg) => setFeedbackMsg(msg)}
      />
    </div>
  );
};
