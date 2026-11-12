import React, { useState, useEffect } from 'react';
import {
  X,
  QrCode,
  AlertTriangle,
  Wrench,
  Clock,
  History,
  CheckCircle,
  Edit,
  Trash2,
  Share2,
  Calendar,
  Building,
  Tag,
  DollarSign,
  FileText,
  AlertOctagon,
  ArrowRightLeft,
  Lock,
  RefreshCw,
  Download,
} from 'lucide-react';
import QRCode from 'qrcode';
import type {
  Equipment,
  EquipmentIssue,
  EquipmentTransfer,
  User,
  AdditionalField,
} from '../types/index.ts';
import { apiFetch } from '../utils/api.ts';

interface EquipmentDetailModalProps {
  equipmentId: number | null;
  currentUser: User | null;
  onClose: () => void;
  onEditEquipment: (item: any) => void;
  onDeleteEquipment: (id: number) => void;
  onReloadList: () => void;
  onOpenLogin?: () => void;
}

export const EquipmentDetailModal: React.FC<EquipmentDetailModalProps> = ({
  equipmentId,
  currentUser,
  onClose,
  onEditEquipment,
  onDeleteEquipment,
  onReloadList,
  onOpenLogin,
}) => {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');

  // Modals inside detail:
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [issueState, setIssueState] = useState<'ISSUE' | 'CRITICAL_ISSUE' | 'WEAR_AND_TEAR'>('ISSUE');
  const [issueDesc, setIssueDesc] = useState('');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().split('T')[0]);

  // Histories
  const [showIssueHistory, setShowIssueHistory] = useState(false);
  const [issuesHistory, setIssuesHistory] = useState<EquipmentIssue[]>([]);
  const [showTransferHistory, setShowTransferHistory] = useState(false);
  const [transferHistory, setTransferHistory] = useState<EquipmentTransfer[]>([]);

  // Transfer modal
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferIssuedTo, setTransferIssuedTo] = useState('');
  const [transferExpectedDate, setTransferExpectedDate] = useState('');

  // Writeoff modal & status state
  const [showWriteoffModal, setShowWriteoffModal] = useState(false);
  const [targetWriteoffState, setTargetWriteoffState] = useState<'PREPARING' | 'DOCUMENTS_PREPARATION' | 'WRITTEN_OFF'>('DOCUMENTS_PREPARATION');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const isUser = currentUser?.role === 'USER';
  const isEngineer = currentUser?.role === 'ENGINEER';
  const isAdmin = currentUser?.role === 'ADMIN';

  const fetchDetail = () => {
    if (!equipmentId) return;

    setLoading(true);
    setError(null);

    apiFetch(`/api/equipment/${equipmentId}`)
      .then(async (res) => {
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Ошибка загрузки данных оборудования');
        }
        return res.json();
      })
      .then((detail) => {
        setData(detail);
        const qrUrl = `${window.location.origin}/q/EQ-${detail.id}`;
        QRCode.toDataURL(qrUrl, { width: 220, margin: 1 })
          .then(setQrDataUrl)
          .catch(console.error);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchDetail();
  }, [equipmentId, currentUser]);

  const handleQuickLogin = async (loginRole: 'admin' | 'engineer' | 'user') => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: loginRole, password: `${loginRole}123` }),
      });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || 'Ошибка авторизации');
      if (resData.accessToken) {
        localStorage.setItem('auth_token', resData.accessToken);
      }
      if (resData.user) {
        localStorage.setItem('auth_user', JSON.stringify(resData.user));
      }
      onReloadList();
      fetchDetail();
    } catch (e: any) {
      setError(e.message);
      setLoading(false);
    }
  };

  if (!equipmentId) return null;

  // Verify during audit
  const handleVerify = async () => {
    if (!data?.currentAuditVerification?.auditId) return;
    try {
      const res = await apiFetch(
        `/api/inventory/${data.currentAuditVerification.auditId}/verify/${equipmentId}`,
        { method: 'POST' }
      );
      if (!res.ok) throw new Error('Ошибка подтверждения инвентаризации');
      // Update state locally
      setData((prev: any) => ({
        ...prev,
        currentAuditVerification: {
          ...prev.currentAuditVerification,
          isVerified: true,
          verifiedAt: new Date().toISOString(),
        },
      }));
      onReloadList();
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Submit Issue
  const handleSubmitIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!issueDesc.trim()) return;

    try {
      const res = await apiFetch(`/api/equipment/${equipmentId}/issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state: issueState,
          description: issueDesc,
          broken_at: issueDate,
        }),
      });

      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || 'Не удалось зафиксировать поломку');

      alert('Информация о неисправности успешно зарегистрирована и отправлена инженерам!');
      setShowIssueModal(false);
      setIssueDesc('');
      // Reload details
      const detailRes = await apiFetch(`/api/equipment/${equipmentId}`);
      const updated = await detailRes.json();
      setData(updated);
      onReloadList();
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Mark Issue Repaired
  const handleRepairIssue = async (issueId: number) => {
    try {
      const res = await apiFetch(`/api/issues/${issueId}/repair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repaired_at: new Date().toISOString() }),
      });
      if (!res.ok) throw new Error('Ошибка обновления статуса неисправности');

      const detailRes = await apiFetch(`/api/equipment/${equipmentId}`);
      const updated = await detailRes.json();
      setData(updated);
      onReloadList();
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Load Issues History
  const handleLoadIssueHistory = async () => {
    try {
      const res = await apiFetch(`/api/equipment/${equipmentId}/issues`);
      const list = await res.json();
      setIssuesHistory(Array.isArray(list) ? list : []);
      setShowIssueHistory(true);
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Load Transfer History
  const handleLoadTransferHistory = async () => {
    try {
      const res = await apiFetch(`/api/equipment/${equipmentId}/transfers`);
      const list = await res.json();
      setTransferHistory(Array.isArray(list) ? list : []);
      setShowTransferHistory(true);
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Handle Return from Loan
  const handleReturnEquipment = async (transferId: number) => {
    try {
      const res = await apiFetch(`/api/transfers/${transferId}/return`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returned_at: new Date().toISOString() }),
      });
      if (!res.ok) throw new Error('Ошибка оформления возврата');

      const detailRes = await apiFetch(`/api/equipment/${equipmentId}`);
      const updated = await detailRes.json();
      setData(updated);
      onReloadList();
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Handle Transfer Submit
  const handleTransferSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferIssuedTo.trim()) return;

    try {
      const res = await apiFetch('/api/equipment/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipment_ids: [equipmentId],
          issued_to: transferIssuedTo,
          issued_at: new Date().toISOString(),
          expected_return_at: transferExpectedDate || null,
        }),
      });

      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || 'Ошибка передачи оборудования');

      setShowTransferModal(false);
      setTransferIssuedTo('');
      setTransferExpectedDate('');
      const detailRes = await apiFetch(`/api/equipment/${equipmentId}`);
      const updated = await detailRes.json();
      setData(updated);
      onReloadList();
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Download Act for current item
  const handleDownloadActForCurrentItem = async () => {
    if (!equipmentId) return;
    try {
      const res = await apiFetch('/api/writeoff/generate-act', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ equipment_ids: [equipmentId] }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Ошибка генерации акта списания');
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const cleanNum = (data?.inventory_number || `id-${equipmentId}`).toString().replace(/[^a-zA-Z0-9_-]/g, '_');
      a.download = `akt-spisaniya-${cleanNum}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.message);
    }
  };

  // Submit writeoff status change
  const handleWriteoffSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!equipmentId) return;
    try {
      const res = await apiFetch('/api/writeoff/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipment_ids: [equipmentId],
          state: targetWriteoffState,
          writeoff_date: targetWriteoffState === 'WRITTEN_OFF' ? new Date().toISOString() : null,
        }),
      });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || 'Ошибка списания оборудования');

      setShowWriteoffModal(false);
      fetchDetail();
      onReloadList();
    } catch (e: any) {
      alert(e.message);
    }
  };

  // Format dynamic field value
  const renderFieldValue = (field: AdditionalField, val: any) => {
    if (val === undefined || val === null || val === '') {
      return <span className="text-slate-400 italic">—</span>;
    }
    if (field.is_multiple && Array.isArray(val)) {
      return (
        <div className="flex flex-wrap gap-1">
          {val.map((item, idx) => (
            <span
              key={idx}
              className="bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded text-xs"
            >
              {String(item)}
            </span>
          ))}
        </div>
      );
    }
    if (field.data_type === 'BOOLEAN') {
      return val ? (
        <span className="text-emerald-700 font-medium">Да</span>
      ) : (
        <span className="text-slate-600">Нет</span>
      );
    }
    return <span className="text-slate-800 font-medium">{String(val)}</span>;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-6 animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600 rounded-xl">
              <FileText className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs bg-slate-800 border border-slate-700 text-blue-300 px-2 py-0.5 rounded">
                  {data?.inventory_number || 'Загрузка...'}
                </span>
                <span className="text-xs text-slate-400">
                  {data?.typeName}
                </span>
              </div>
              <h2 className="text-base sm:text-lg font-bold text-white truncate max-w-md">
                {data?.name || 'Паспорт единицы оборудования'}
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 overflow-y-auto space-y-6">
          {loading && (
            <div className="py-12 text-center text-slate-500">
              <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              Загрузка паспорта оборудования...
            </div>
          )}

          {error && (
            <div className="p-6 bg-slate-50 border border-slate-200 rounded-2xl text-center space-y-4">
              <div className="w-12 h-12 bg-amber-100 text-amber-700 rounded-2xl flex items-center justify-center mx-auto shadow-xs">
                <Lock className="w-6 h-6" />
              </div>
              <div className="max-w-md mx-auto">
                <h4 className="font-bold text-slate-900 text-base">
                  {error.includes('авториз') || error.includes('Сессия')
                    ? 'Требуется авторизация'
                    : 'Не удалось загрузить данные'}
                </h4>
                <p className="text-xs text-slate-600 mt-1">
                  {error.includes('авториз') || error.includes('Сессия')
                    ? 'Для просмотра персональной страницы и паспорта данного оборудования необходимо войти в систему с учетной записью сотрудника (Администратор, Инженер или Пользователь).'
                    : error}
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                <button
                  onClick={() => handleQuickLogin('admin')}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors flex items-center gap-1.5"
                >
                  Войти как Администратор
                </button>
                <button
                  onClick={() => handleQuickLogin('engineer')}
                  className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-medium transition-colors"
                >
                  Войти как Инженер
                </button>
                <button
                  onClick={fetchDetail}
                  className="px-3 py-2 border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-medium transition-colors flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Повторить запрос
                </button>
                {onOpenLogin && (
                  <button
                    onClick={onOpenLogin}
                    className="px-3 py-2 text-xs text-blue-600 hover:underline font-semibold"
                  >
                    Ввести другие учетные данные
                  </button>
                )}
              </div>
            </div>
          )}

          {data && !loading && (
            <>
              {/* Audit Verification Banner (if current active audit) */}
              {data.currentAuditVerification && (
                <div
                  className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                    data.currentAuditVerification.isVerified
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : 'bg-amber-50 border-amber-200 text-amber-900'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <CheckCircle
                      className={`w-5 h-5 ${
                        data.currentAuditVerification.isVerified
                          ? 'text-emerald-600'
                          : 'text-amber-500'
                      }`}
                    />
                    <div>
                      <div className="font-bold text-xs uppercase tracking-wider">
                        Текущая инвентаризация аудитора
                      </div>
                      <div className="text-xs">
                        {data.currentAuditVerification.isVerified
                          ? `Оборудование проверено (${new Date(
                              data.currentAuditVerification.verifiedAt
                            ).toLocaleString('ru-RU')})`
                          : 'Оборудование еще не прошло верификацию в текущей инвентаризации'}
                      </div>
                    </div>
                  </div>
                  {!data.currentAuditVerification.isVerified && (
                    <button
                      onClick={handleVerify}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs shadow-xs transition-colors shrink-0"
                    >
                      ✓ Проверено
                    </button>
                  )}
                </div>
              )}

              {/* Status alerts */}
              {data.writeoffState && (
                <div className="p-3.5 bg-purple-50 border border-purple-200 rounded-xl text-purple-900 text-xs flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-purple-600 shrink-0" />
                    <span>
                      Статус списания:{' '}
                      <strong className="text-purple-950 font-bold">
                        {data.writeoffState === 'PREPARING'
                          ? 'Готовится к списанию'
                          : data.writeoffState === 'DOCUMENTS_PREPARATION'
                          ? 'В процессе списания (подготовка документов)'
                          : 'Списано с баланса'}
                      </strong>
                      {data.writeoffDate && ` (${new Date(data.writeoffDate).toLocaleDateString('ru-RU')})`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleDownloadActForCurrentItem}
                      className="px-3 py-1 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1 shadow-xs transition-colors"
                      title="Сформировать и скачать официальный акт списания (DOCX)"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Скачать Акт (DOCX)
                    </button>
                    {(isAdmin || isEngineer) && (
                      <button
                        onClick={() => {
                          setTargetWriteoffState(data.writeoffState || 'DOCUMENTS_PREPARATION');
                          setShowWriteoffModal(true);
                        }}
                        className="px-2.5 py-1 bg-white hover:bg-purple-100 border border-purple-200 text-purple-800 rounded-lg text-xs font-medium transition-colors"
                      >
                        Сменить статус
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Active Loan Alert */}
              {data.activeTransfer && (
                <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-xl text-blue-900 text-xs flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-blue-600" />
                    <span>
                      Оборудование во временном пользовании у{' '}
                      <strong>{data.activeTransfer.issued_to}</strong> с{' '}
                      {new Date(data.activeTransfer.issued_at).toLocaleDateString('ru-RU')}
                      {data.activeTransfer.expected_return_at &&
                        ` (ожидаемый возврат: ${new Date(
                          data.activeTransfer.expected_return_at
                        ).toLocaleDateString('ru-RU')})`}
                    </span>
                  </div>
                  {(isAdmin || isEngineer) && (
                    <button
                      onClick={() => handleReturnEquipment(data.activeTransfer.id)}
                      className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg text-xs"
                    >
                      Оформить возврат
                    </button>
                  )}
                </div>
              )}

              {/* Active Issues */}
              {Array.isArray(data.activeIssues) && data.activeIssues.length > 0 && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-xl space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-red-900 uppercase">
                    <span className="flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-red-600" />
                      Текущие активные неисправности ({data.activeIssues.length})
                    </span>
                  </div>
                  <div className="space-y-2">
                    {data.activeIssues.map((issue: any) => (
                      <div
                        key={issue.id}
                        className="bg-white p-3 rounded-lg border border-red-100 shadow-2xs flex items-start justify-between gap-3 text-xs"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-2 py-0.5 rounded font-semibold text-[10px] ${
                                issue.state === 'CRITICAL_ISSUE'
                                  ? 'bg-red-600 text-white'
                                  : issue.state === 'ISSUE'
                                  ? 'bg-amber-500 text-white'
                                  : 'bg-slate-500 text-white'
                              }`}
                            >
                              {issue.state === 'CRITICAL_ISSUE'
                                ? 'Критическая поломка'
                                : issue.state === 'ISSUE'
                                ? 'Незначительная поломка'
                                : 'Естественный износ'}
                            </span>
                            <span className="text-slate-500">
                              Обнаружено:{' '}
                              {new Date(issue.broken_at).toLocaleDateString('ru-RU')}
                            </span>
                          </div>
                          <p className="mt-1 text-slate-800 font-medium">{issue.description}</p>
                        </div>
                        {(isAdmin || isEngineer) && (
                          <button
                            onClick={() => handleRepairIssue(issue.id)}
                            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-semibold shrink-0"
                          >
                            ✓ Отремонтировано
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Grid: QR Code & Basic Passport Info */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* QR Code column */}
                <div className="border border-slate-200 rounded-2xl p-4 flex flex-col items-center justify-center bg-slate-50/60 text-center">
                  <div className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-xs mb-2">
                    {qrDataUrl ? (
                      <img
                        src={qrDataUrl}
                        alt="QR Code"
                        className="w-40 h-40 object-contain"
                      />
                    ) : (
                      <div className="w-40 h-40 flex items-center justify-center text-slate-400">
                        Генерация QR...
                      </div>
                    )}
                  </div>
                  <span className="text-[11px] font-mono text-slate-700 font-bold">
                    Инв. № {data.inventory_number}
                  </span>
                  <div className="mt-1 px-2 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-700 text-[10px] font-mono">
                    Шлюз: /q/EQ-{data.id}
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1 max-w-[200px] leading-tight">
                    🔒 Защищенный шлюз: сотрудникам открывает паспорт, посторонним выдает 404 (пустышку).
                  </p>
                  <a
                    href={qrDataUrl}
                    download={`QR-${data.inventory_number}.png`}
                    className="mt-2 text-xs text-blue-600 hover:text-blue-800 font-semibold inline-flex items-center gap-1"
                  >
                    Скачать изображение QR
                  </a>
                </div>

                {/* Passport Details column */}
                <div className="md:col-span-2 space-y-3">
                  <h4 className="text-xs font-bold uppercase text-slate-500 tracking-wider">
                    Паспортные данные
                  </h4>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                      <span className="text-slate-500 block">Помещение / Аудитория</span>
                      <span className="font-semibold text-slate-900 text-sm">
                        № {data.roomNumber} ({data.roomFloor} этаж)
                      </span>
                      {data.additional_fields?.location_place && (
                        <span className="text-[11px] text-slate-600 block mt-0.5">
                          Место: {data.additional_fields.location_place}
                        </span>
                      )}
                    </div>
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                      <span className="text-slate-500 block">Дата принятия к учету</span>
                      <span className="font-semibold text-slate-900 text-sm">
                        {new Date(data.recived).toLocaleDateString('ru-RU')}
                      </span>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                      <span className="text-slate-500 block">Первоначальная стоимость</span>
                      <span className="font-semibold text-slate-900 text-sm">
                        {Number(data.initial_cost).toLocaleString('ru-RU')} ₽
                      </span>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                      <span className="text-slate-500 block">Остаточная стоимость</span>
                      <span className="font-semibold text-slate-900 text-sm">
                        {Number(data.residual_cost).toLocaleString('ru-RU')} ₽
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Department Accounting Classification Grid (Columns G-R) */}
              <div className="border-t border-slate-100 pt-5 space-y-3">
                <h4 className="text-xs font-bold uppercase text-slate-500 tracking-wider">
                  Учетные характеристики кафедры
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                  <div className="p-3 rounded-xl border border-slate-200 bg-white">
                    <span className="text-slate-500 block mb-0.5">Статус</span>
                    <span className="font-semibold text-slate-900">
                      {data.additional_fields?.status || 'Действует'}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl border border-slate-200 bg-white">
                    <span className="text-slate-500 block mb-0.5">Состояние</span>
                    <span className="font-semibold text-slate-900">
                      {data.additional_fields?.condition || 'Рабочее'}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl border border-slate-200 bg-white">
                    <span className="text-slate-500 block mb-0.5">Категория (по бухучету)</span>
                    <span className="font-semibold text-slate-900">
                      {data.additional_fields?.accounting_category || 'Дорогостоящее'}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl border border-slate-200 bg-white">
                    <span className="text-slate-500 block mb-0.5">Размеры (Д×Ш×В), см</span>
                    <span className="font-semibold font-mono text-slate-900">
                      {data.additional_fields?.dimensions || '—'}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl border border-slate-200 bg-white">
                    <span className="text-slate-500 block mb-0.5">Цвет</span>
                    <span className="font-semibold text-slate-900">
                      {data.additional_fields?.color || '—'}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl border border-slate-200 bg-white">
                    <span className="text-slate-500 block mb-0.5">Содержание драгметаллов</span>
                    <span
                      className={`font-semibold ${
                        data.additional_fields?.precious_metals
                          ? 'text-amber-700'
                          : 'text-slate-700'
                      }`}
                    >
                      {data.additional_fields?.precious_metals ? 'Да' : 'Нет'}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl border border-slate-200 bg-white sm:col-span-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="text-slate-500 block mb-0.5">Оборудование на гарантии</span>
                      <span
                        className={`font-bold ${
                          data.additional_fields?.is_under_warranty
                            ? 'text-emerald-700'
                            : 'text-slate-700'
                        }`}
                      >
                        {data.additional_fields?.is_under_warranty ? 'Да' : 'Нет'}
                      </span>
                      {data.additional_fields?.warranty_until && (
                        <span className="text-slate-500 ml-2">
                          (Срок до:{' '}
                          {new Date(data.additional_fields.warranty_until).toLocaleDateString('ru-RU')}
                          {data.additional_fields?.warranty_expired && ' — срок истёк'})
                        </span>
                      )}
                    </div>
                  </div>
                  {(data.additional_fields?.description || data.additional_fields?.notes) && (
                    <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 sm:col-span-3 space-y-1">
                      {data.additional_fields?.description && (
                        <div>
                          <span className="text-slate-500 font-semibold">Описание: </span>
                          <span className="text-slate-800">{data.additional_fields.description}</span>
                        </div>
                      )}
                      {data.additional_fields?.notes && (
                        <div>
                          <span className="text-slate-500 font-semibold">Примечание: </span>
                          <span className="text-slate-800">{data.additional_fields.notes}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Dynamic Additional Fields Section */}
              {Array.isArray(data.fieldsDefinitions) &&
                data.fieldsDefinitions.filter(
                  (f: AdditionalField) => f.code !== 'dimensions' && f.code !== 'color'
                ).length > 0 && (
                <div className="border-t border-slate-100 pt-5 space-y-3">
                  <h4 className="text-xs font-bold uppercase text-slate-500 tracking-wider">
                    Специфические характеристики типа «{data.typeName}»
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {data.fieldsDefinitions
                      .filter((f: AdditionalField) => f.code !== 'dimensions' && f.code !== 'color')
                      .map((field: AdditionalField) => (
                      <div
                        key={field.code}
                        className="p-3 rounded-xl border border-slate-200 bg-white"
                      >
                        <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                          <span>{field.title}</span>
                          <span className="font-mono text-[10px] text-slate-400">
                            {field.code}
                          </span>
                        </div>
                        <div className="text-xs">
                          {renderFieldValue(
                            field,
                            data.additional_fields?.[field.code]
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions Footer */}
              <div className="border-t border-slate-200 pt-5 flex flex-wrap gap-2 justify-between">
                <div className="flex flex-wrap gap-2">
                  {/* Report Issue button: enabled if not written off */}
                  {data.writeoffState !== 'WRITTEN_OFF' ? (
                    <button
                      onClick={() => setShowIssueModal(true)}
                      className="px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 shadow-xs transition-colors"
                    >
                      <AlertTriangle className="w-4 h-4" />
                      Сообщить о неисправности
                    </button>
                  ) : (
                    <span className="text-xs text-slate-400 italic py-2">
                      (Оборудование списано, регистрация неисправностей недоступна)
                    </span>
                  )}

                  {/* Transfer button (Admin or Engineer) */}
                  {(isAdmin || isEngineer) && data.writeoffState !== 'WRITTEN_OFF' && (
                    <button
                      onClick={() => setShowTransferModal(true)}
                      disabled={Boolean(data.activeTransfer)}
                      className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 shadow-xs transition-colors"
                    >
                      <ArrowRightLeft className="w-4 h-4" />
                      {data.activeTransfer ? 'Уже передано' : 'Передать в пользование'}
                    </button>
                  )}

                  {/* History buttons */}
                  <button
                    onClick={handleLoadIssueHistory}
                    className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-medium inline-flex items-center gap-1.5 transition-colors"
                  >
                    <History className="w-4 h-4" />
                    История неисправностей
                  </button>

                  {(isAdmin || isEngineer) && (
                    <button
                      onClick={handleLoadTransferHistory}
                      className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-medium inline-flex items-center gap-1.5 transition-colors"
                    >
                      <Clock className="w-4 h-4" />
                      История передач
                    </button>
                  )}

                  {(isAdmin || isEngineer) && (
                    <button
                      onClick={() => {
                        setTargetWriteoffState(data.writeoffState || 'DOCUMENTS_PREPARATION');
                        setShowWriteoffModal(true);
                      }}
                      className="px-3 py-2 bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 shadow-xs transition-colors"
                    >
                      <FileText className="w-4 h-4" />
                      {data.writeoffState ? 'Списание и Акт' : 'Оформить списание'}
                    </button>
                  )}
                </div>

                {/* Admin controls */}
                {isAdmin && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        onEditEquipment(data);
                        onClose();
                      }}
                      className="px-3 py-2 border border-slate-300 hover:bg-slate-50 text-slate-800 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                    >
                      <Edit className="w-4 h-4" />
                      Редактировать
                    </button>
                    <button
                      onClick={() => setShowDeleteConfirm(true)}
                      className="px-3 py-2 border border-red-200 hover:bg-red-50 text-red-600 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                      title="Удалить оборудование"
                    >
                      <Trash2 className="w-4 h-4" />
                      Удалить
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Sub-Modal: Delete Confirmation */}
      {showDeleteConfirm && data && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-red-600" />
              Удаление оборудования
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Вы действительно хотите удалить{' '}
              <strong className="text-slate-900">«{data.name}»</strong> (инв. №{' '}
              <span className="font-mono">{data.inventory_number}</span>)? Это действие необратимо.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowDeleteConfirm(false);
                  onDeleteEquipment(data.id);
                  onClose();
                }}
                className="px-4 py-2 text-xs font-bold bg-red-600 hover:bg-red-700 text-white rounded-xl shadow-xs"
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sub-Modal: Report Issue */}
      {showIssueModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full p-6">
            <h3 className="font-bold text-base text-slate-900 mb-4 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
              Сообщить о неисправности
            </h3>
            <form onSubmit={handleSubmitIssue} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Характер неисправности
                </label>
                <select
                  value={issueState}
                  onChange={(e: any) => setIssueState(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none"
                >
                  <option value="ISSUE">Незначительная поломка</option>
                  <option value="CRITICAL_ISSUE">Критическая поломка</option>
                  <option value="WEAR_AND_TEAR">Естественный износ</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Дата обнаружения
                </label>
                <input
                  type="date"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Описание поломки
                </label>
                <textarea
                  rows={3}
                  value={issueDesc}
                  onChange={(e) => setIssueDesc(e.target.value)}
                  placeholder="Опишите симптомы неисправности (напр. не включается, треск в блоке питания, поврежден кабель)..."
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none"
                  required
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowIssueModal(false)}
                  className="px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-xl shadow-xs"
                >
                  Отправить
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Sub-Modal: Temporary Loan Transfer */}
      {showTransferModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full p-6">
            <h3 className="font-bold text-base text-slate-900 mb-4 flex items-center gap-2">
              <ArrowRightLeft className="w-5 h-5 text-blue-600" />
              Передача во временное пользование
            </h3>
            <form onSubmit={handleTransferSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Кому передается (ФИО / должность / аудитория)
                </label>
                <input
                  type="text"
                  value={transferIssuedTo}
                  onChange={(e) => setTransferIssuedTo(e.target.value)}
                  placeholder="Например: доц. Иванов И.И. (для командировки)"
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Предполагаемая дата возвращения
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
                  type="submit"
                  className="px-4 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-xs"
                >
                  Оформить выдачу
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Sub-Modal: Issues History (PDF page 12) */}
      {showIssueHistory && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-lg w-full p-6 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                <History className="w-4 h-4 text-slate-600" />
                Хронологическая история неисправностей
              </h3>
              <button
                onClick={() => setShowIssueHistory(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="py-4 overflow-y-auto space-y-3">
              {!Array.isArray(issuesHistory) || issuesHistory.length === 0 ? (
                <div className="text-center py-6 text-slate-400 text-xs">
                  История неисправностей пуста
                </div>
              ) : (
                issuesHistory.map((h) => (
                  <div
                    key={h.id}
                    className="p-3 rounded-xl border border-slate-200 bg-slate-50/50 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900">
                        {h.state === 'CRITICAL_ISSUE'
                          ? 'Критическая поломка'
                          : h.state === 'ISSUE'
                          ? 'Незначительная поломка'
                          : 'Естественный износ'}
                      </span>
                      <span className="text-slate-400 text-[11px]">
                        {new Date(h.broken_at).toLocaleDateString('ru-RU')}
                      </span>
                    </div>
                    <p className="text-slate-700">{h.description}</p>
                    <div className="pt-1 text-[11px]">
                      {h.repaired_at ? (
                        <span className="text-emerald-700 font-semibold">
                          ✓ Отремонтировано:{' '}
                          {new Date(h.repaired_at).toLocaleDateString('ru-RU')}
                        </span>
                      ) : (
                        <span className="text-red-600 font-semibold">
                          ● Не устранено
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Sub-Modal: Transfer History (PDF page 15) */}
      {showTransferHistory && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-lg w-full p-6 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-600" />
                Хронологическая история передач
              </h3>
              <button
                onClick={() => setShowTransferHistory(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="py-4 overflow-y-auto space-y-3">
              {!Array.isArray(transferHistory) || transferHistory.length === 0 ? (
                <div className="text-center py-6 text-slate-400 text-xs">
                  История передач пуста
                </div>
              ) : (
                transferHistory.map((t) => (
                  <div
                    key={t.id}
                    className="p-3 rounded-xl border border-slate-200 bg-slate-50/50 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900">
                        {t.issued_to}
                      </span>
                      <span className="text-slate-400 text-[11px]">
                        Выдано: {new Date(t.issued_at).toLocaleDateString('ru-RU')}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-600">
                      {t.expected_return_at && (
                        <span>
                          План. возврат:{' '}
                          {new Date(t.expected_return_at).toLocaleDateString('ru-RU')}
                        </span>
                      )}
                    </div>
                    <div className="pt-1 text-[11px]">
                      {t.returned_at ? (
                        <span className="text-emerald-700 font-semibold">
                          ✓ Возвращено:{' '}
                          {new Date(t.returned_at).toLocaleDateString('ru-RU')}
                        </span>
                      ) : (
                        <span className="text-amber-600 font-semibold">
                          ● Находится во временном пользовании
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Sub-Modal: Write-off & Act */}
      {showWriteoffModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                <FileText className="w-5 h-5 text-red-600" />
                Списание единицы оборудования
              </h3>
              <button
                onClick={() => setShowWriteoffModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1">
              <div className="font-semibold text-slate-800">{data?.name}</div>
              <div className="text-slate-500 font-mono text-[11px]">
                Инв. № {data?.inventory_number} • Каб. {data?.roomNumber} • {Number(data?.initial_cost).toLocaleString('ru-RU')} ₽
              </div>
            </div>

            <form onSubmit={handleWriteoffSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Статус списания:
                </label>
                <select
                  value={targetWriteoffState}
                  onChange={(e: any) => setTargetWriteoffState(e.target.value)}
                  className="w-full p-2.5 border border-slate-300 rounded-xl outline-none font-medium"
                >
                  <option value="PREPARING">Готовится к списанию (PREPARING)</option>
                  <option value="DOCUMENTS_PREPARATION">
                    В процессе списания — подготовка документов (DOCUMENTS_PREPARATION)
                  </option>
                  <option value="WRITTEN_OFF">Окончательно списано с баланса (WRITTEN_OFF)</option>
                </select>
                <p className="text-[11px] text-slate-500 mt-1">
                  {targetWriteoffState === 'DOCUMENTS_PREPARATION'
                    ? 'При этом статусе генерируется комплект документов и комиссионный акт списания.'
                    : targetWriteoffState === 'WRITTEN_OFF'
                    ? 'Оборудование полностью выводится из эксплуатации и снимается с материального учета кафедры.'
                    : 'Предварительное согласование перед списанием.'}
                </p>
              </div>

              <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl space-y-2">
                <div className="font-semibold text-emerald-950 flex items-center justify-between">
                  <span>Официальный Акт списания (DOCX):</span>
                </div>
                <p className="text-[11px] text-emerald-800">
                  Вы можете скачать официальный акт списания на данную единицу оборудования в формате Word:
                </p>
                <button
                  type="button"
                  onClick={handleDownloadActForCurrentItem}
                  className="w-full py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-bold flex items-center justify-center gap-1.5 shadow-xs transition-colors text-xs"
                >
                  <Download className="w-4 h-4" />
                  Скачать Акт списания (DOCX)
                </button>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowWriteoffModal(false)}
                  className="px-3 py-2 text-slate-600 hover:bg-slate-100 rounded-xl font-medium"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold shadow-xs"
                >
                  Сохранить статус
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
