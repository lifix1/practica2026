import React, { useState, useEffect, useRef } from 'react';
import {
  FileText,
  Download,
  Upload,
  RotateCcw,
  Save,
  Plus,
  Trash2,
  X,
  Copy,
  Check,
  AlertTriangle,
  CheckCircle2,
  FileCode,
} from 'lucide-react';
import { apiFetch } from '../utils/api.ts';

export type WriteoffTemplateKey =
  | 'case1_act'
  | 'case1_invoice'
  | 'case2_act'
  | 'case2_invoice'
  | 'case3_act';

export interface SignatoryEntry {
  title: string;
  name: string;
}

export interface TemplateRequisites {
  organization?: string;
  department?: string;
  orderNumber?: string;
  orderDateText?: string;
  approverRole?: string;
  approverName?: string;
  commissionChair?: SignatoryEntry;
  commissionMembers?: SignatoryEntry[];
  mol?: SignatoryEntry;
  sender?: string;
  recipient?: string;
  senderSign?: SignatoryEntry;
  recipientSign?: SignatoryEntry;
  chiefAccountantName?: string;
  conclusionText?: string;
  recycleDecisionText?: string;
}

export interface TemplatePlaceholderDoc {
  token: string;
  label: string;
  scope: 'document' | 'item';
}

export interface WriteoffTemplateItem {
  key: WriteoffTemplateKey;
  title: string;
  description: string;
  kind: 'act' | 'invoice';
  defaultFileName: string;
  requisites: TemplateRequisites;
  defaultRequisites: TemplateRequisites;
  hasCustomDocx: boolean;
  customFileName: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  placeholders: TemplatePlaceholderDoc[];
}

interface WriteoffTemplatesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onFeedback?: (msg: { type: 'success' | 'error'; text: string }) => void;
}

export const WriteoffTemplatesModal: React.FC<WriteoffTemplatesModalProps> = ({
  isOpen,
  onClose,
  onFeedback,
}) => {
  const [templates, setTemplates] = useState<WriteoffTemplateItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeKey, setActiveKey] = useState<WriteoffTemplateKey>('case1_act');
  const [activeTab, setActiveTab] = useState<'requisites' | 'docx'>('requisites');
  const [draftRequisites, setDraftRequisites] = useState<TemplateRequisites>({});
  const [savingRequisites, setSavingRequisites] = useState(false);
  const [uploadingDocx, setUploadingDocx] = useState(false);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [resettingDocx, setResettingDocx] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [localMsg, setLocalMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadTemplates = async (preserveKey?: WriteoffTemplateKey) => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/writeoff/templates');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Не удалось загрузить шаблоны');
      const list: WriteoffTemplateItem[] = Array.isArray(data?.templates) ? data.templates : [];
      setTemplates(list);
      const targetKey = preserveKey || activeKey;
      const found = list.find((t) => t.key === targetKey) || list[0];
      if (found) {
        setActiveKey(found.key);
        setDraftRequisites(structuredClone(found.requisites || {}));
      }
    } catch (e: any) {
      setLocalMsg({ type: 'error', text: e.message || 'Ошибка загрузки шаблонов' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setLocalMsg(null);
      loadTemplates();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const activeTemplate = templates.find((t) => t.key === activeKey) || null;

  const handleSelectTemplate = (tpl: WriteoffTemplateItem) => {
    setActiveKey(tpl.key);
    setDraftRequisites(structuredClone(tpl.requisites || {}));
    setLocalMsg(null);
  };

  const replaceTemplateInState = (updated: WriteoffTemplateItem) => {
    setTemplates((prev) => prev.map((t) => (t.key === updated.key ? updated : t)));
    if (updated.key === activeKey) {
      setDraftRequisites(structuredClone(updated.requisites || {}));
    }
  };

  const updateSignatoryField = (
    field: 'commissionChair' | 'mol' | 'senderSign' | 'recipientSign',
    part: 'title' | 'name',
    value: string
  ) => {
    setDraftRequisites((prev) => ({
      ...prev,
      [field]: {
        title: part === 'title' ? value : prev[field]?.title || '',
        name: part === 'name' ? value : prev[field]?.name || '',
      },
    }));
  };

  const updateMemberField = (idx: number, part: 'title' | 'name', value: string) => {
    setDraftRequisites((prev) => {
      const next = [...(prev.commissionMembers || [])];
      next[idx] = {
        title: part === 'title' ? value : next[idx]?.title || '',
        name: part === 'name' ? value : next[idx]?.name || '',
      };
      return { ...prev, commissionMembers: next };
    });
  };

  const addMember = () => {
    setDraftRequisites((prev) => ({
      ...prev,
      commissionMembers: [...(prev.commissionMembers || []), { title: '', name: '' }],
    }));
  };

  const removeMember = (idx: number) => {
    setDraftRequisites((prev) => ({
      ...prev,
      commissionMembers: (prev.commissionMembers || []).filter((_, i) => i !== idx),
    }));
  };

  const handleSaveRequisites = async (reset = false) => {
    if (!activeTemplate) return;
    setSavingRequisites(true);
    setLocalMsg(null);
    try {
      const res = await apiFetch(`/api/writeoff/templates/${activeTemplate.key}/requisites`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reset ? { reset: true } : { requisites: draftRequisites }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка сохранения реквизитов');
      if (data.template) {
        replaceTemplateInState(data.template);
      }
      const msgText = reset
        ? `Реквизиты «${activeTemplate.title}» сброшены к значениям по умолчанию.`
        : `Реквизиты шаблона «${activeTemplate.title}» сохранены.`;
      setLocalMsg({ type: 'success', text: msgText });
      onFeedback?.({ type: 'success', text: msgText });
    } catch (e: any) {
      setLocalMsg({ type: 'error', text: e.message || 'Ошибка сохранения' });
    } finally {
      setSavingRequisites(false);
    }
  };

  const handleDownloadEditableDocx = async (fresh: boolean) => {
    if (!activeTemplate) return;
    setDownloadingKey(fresh ? 'fresh' : 'current');
    setLocalMsg(null);
    try {
      const urlPath = `/api/writeoff/templates/${activeTemplate.key}/download${fresh ? '?fresh=1' : ''}`;
      const res = await apiFetch(urlPath);
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Ошибка скачивания шаблона');
      }
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      const fnMatch = cd.match(/filename="([^"]+)"/i);
      const filename = fnMatch?.[1] || activeTemplate.defaultFileName;
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      setLocalMsg({
        type: 'success',
        text: `Файл шаблона «${filename}» скачан. Вы можете отредактировать его в Word и загрузить обратно.`,
      });
    } catch (e: any) {
      setLocalMsg({ type: 'error', text: e.message || 'Ошибка выгрузки шаблона' });
    } finally {
      setDownloadingKey(null);
    }
  };

  const handleUploadDocxFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !activeTemplate) return;
    if (!file.name.toLowerCase().endsWith('.docx')) {
      setLocalMsg({ type: 'error', text: 'Поддерживаются только файлы формата .docx' });
      return;
    }

    setUploadingDocx(true);
    setLocalMsg(null);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Не удалось прочитать выбранный файл'));
        reader.readAsDataURL(file);
      });

      const res = await apiFetch(`/api/writeoff/templates/${activeTemplate.key}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileBase64: base64,
          fileName: file.name,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка загрузки .docx шаблона');
      if (data.template) {
        replaceTemplateInState(data.template);
      }
      const msgText = `Пользовательский Word-шаблон «${file.name}» успешно загружен и активирован.`;
      setLocalMsg({ type: 'success', text: msgText });
      onFeedback?.({ type: 'success', text: msgText });
    } catch (err: any) {
      setLocalMsg({ type: 'error', text: err.message || 'Ошибка загрузки файла' });
    } finally {
      setUploadingDocx(false);
    }
  };

  const handleResetCustomDocx = async () => {
    if (!activeTemplate) return;
    setResettingDocx(true);
    setLocalMsg(null);
    try {
      const res = await apiFetch(`/api/writeoff/templates/${activeTemplate.key}/custom-docx`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка сброса пользовательского файла');
      if (data.template) {
        replaceTemplateInState(data.template);
      }
      const msgText = `Для «${activeTemplate.title}» восстановлен встроенный шаблон системы.`;
      setLocalMsg({ type: 'success', text: msgText });
      onFeedback?.({ type: 'success', text: msgText });
    } catch (e: any) {
      setLocalMsg({ type: 'error', text: e.message || 'Ошибка сброса шаблона' });
    } finally {
      setResettingDocx(false);
    }
  };

  const handleCopyToken = async (token: string) => {
    try {
      await navigator.clipboard.writeText(token);
      setCopiedToken(token);
      setTimeout(() => setCopiedToken((curr) => (curr === token ? null : curr)), 1500);
    } catch {
      // Clipboard fallback ignored cleanly
    }
  };

  const hasOrderFields = activeKey === 'case2_act' || activeKey === 'case3_act';
  const hasApprover = activeKey === 'case1_act' || activeKey === 'case2_act' || activeKey === 'case3_act';
  const hasCommission = activeKey === 'case1_act' || activeKey === 'case2_act' || activeKey === 'case3_act';
  const hasMol = activeKey !== 'case1_invoice';
  const hasInvoiceParties = activeKey === 'case1_invoice';
  const hasDepartment = activeKey === 'case2_invoice';
  const hasInvoiceSignatories = activeKey === 'case1_invoice' || activeKey === 'case2_invoice';
  const hasChiefAccountant = activeKey === 'case1_invoice';
  const hasConclusions = activeKey === 'case1_act';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-3 sm:p-5">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Top Modal Bar */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <h3 className="font-bold text-base truncate flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-400 shrink-0" />
              Редактор шаблонов актов и накладных
            </h3>
            <p className="text-xs text-slate-300 mt-0.5 truncate">
              Изменение № приказа, должностных лиц и комиссии, а также загрузка своих файлов .docx с сохранением вставки данных из БД
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors shrink-0"
            aria-label="Закрыть редактор шаблонов"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Main Workspace Split */}
        <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
          {/* Left Template List */}
          <aside className="w-full md:w-72 shrink-0 border-b md:border-b-0 md:border-r border-slate-200 bg-slate-50 overflow-y-auto p-3 space-y-1.5">
            <div className="px-2 py-1 text-[11px] font-semibold text-slate-500">
              Документы списания ({templates.length})
            </div>
            {loading && templates.length === 0 ? (
              <div className="p-4 text-xs text-slate-400 text-center">Загрузка шаблонов...</div>
            ) : (
              templates.map((tpl) => {
                const isActive = tpl.key === activeKey;
                return (
                  <button
                    key={tpl.key}
                    type="button"
                    onClick={() => handleSelectTemplate(tpl)}
                    className={`w-full text-left p-3 rounded-xl border transition-colors ${
                      isActive
                        ? 'bg-white border-blue-500 shadow-xs'
                        : 'bg-transparent border-transparent hover:bg-white hover:border-slate-200'
                    }`}
                  >
                    <div className="font-semibold text-xs text-slate-900 leading-snug">
                      {tpl.title}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500 flex items-center gap-1.5">
                      <span>{tpl.kind === 'act' ? 'Акт' : 'Накладная'}</span>
                      <span aria-hidden="true">·</span>
                      <span
                        className={
                          tpl.hasCustomDocx ? 'text-blue-700 font-semibold' : 'text-slate-600'
                        }
                      >
                        {tpl.hasCustomDocx ? 'Свой .docx' : 'Встроенный бланк'}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </aside>

          {/* Right Editor Content */}
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-white">
            {activeTemplate ? (
              <>
                {/* Template Subheader + Tabs */}
                <div className="px-6 pt-4 pb-3 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
                  <div className="min-w-0">
                    <h4 className="font-bold text-sm text-slate-900 truncate">
                      {activeTemplate.title}
                    </h4>
                    <p className="text-xs text-slate-500 mt-0.5">{activeTemplate.description}</p>
                  </div>

                  <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg shrink-0 self-start sm:self-auto">
                    <button
                      type="button"
                      onClick={() => setActiveTab('requisites')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                        activeTab === 'requisites'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Реквизиты и лица
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('docx')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                        activeTab === 'docx'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Файл Word (.docx)
                    </button>
                  </div>
                </div>

                {/* Local Feedback Banner */}
                {localMsg && (
                  <div
                    className={`mx-6 mt-3 px-3.5 py-2.5 rounded-xl border text-xs font-medium flex items-center justify-between gap-2 shrink-0 ${
                      localMsg.type === 'success'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-red-50 border-red-200 text-red-700'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {localMsg.type === 'success' ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                      )}
                      <span className="break-words">{localMsg.text}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setLocalMsg(null)}
                      className="text-slate-400 hover:text-slate-600 shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Scrollable Body */}
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5 text-xs">
                  {activeTab === 'requisites' ? (
                    <>
                      {activeTemplate.hasCustomDocx && (
                        <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="space-y-0.5">
                            <div className="font-semibold">
                              Активен загруженный Word-файл: {activeTemplate.customFileName}
                            </div>
                            <p className="text-[11px] text-amber-800">
                              При формировании документов используется загруженный файл .docx. После сохранения реквизитов вы можете скачать обновлённый чистый бланк во вкладке «Файл Word (.docx)» или сбросить свой файл.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setActiveTab('docx')}
                            className="px-3 py-1.5 bg-white border border-amber-300 hover:bg-amber-100 text-amber-900 rounded-lg text-[11px] font-semibold whitespace-nowrap shrink-0"
                          >
                            К файлу .docx
                          </button>
                        </div>
                      )}

                      {/* Organization & Order */}
                      <div className="space-y-3">
                        <h5 className="text-xs font-bold text-slate-900 border-b border-slate-100 pb-1.5">
                          Организация и приказ
                        </h5>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className={hasOrderFields ? 'sm:col-span-2' : 'sm:col-span-2'}>
                            <label className="block font-semibold text-slate-700 mb-1">
                              Наименование учреждения / организации
                            </label>
                            <textarea
                              rows={activeKey === 'case2_act' ? 2 : 1}
                              value={draftRequisites.organization || ''}
                              onChange={(e) =>
                                setDraftRequisites((p) => ({ ...p, organization: e.target.value }))
                              }
                              className="w-full p-2.5 border border-slate-300 rounded-xl bg-white outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>

                          {hasOrderFields && (
                            <>
                              <div>
                                <label className="block font-semibold text-slate-700 mb-1">
                                  № приказа о создании комиссии
                                </label>
                                <input
                                  type="text"
                                  value={draftRequisites.orderNumber || ''}
                                  onChange={(e) =>
                                    setDraftRequisites((p) => ({
                                      ...p,
                                      orderNumber: e.target.value,
                                    }))
                                  }
                                  placeholder="Например: 322"
                                  className="w-full p-2.5 border border-slate-300 rounded-xl bg-white outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                                />
                              </div>
                              <div>
                                <label className="block font-semibold text-slate-700 mb-1">
                                  Дата приказа (текст без года)
                                </label>
                                <input
                                  type="text"
                                  value={draftRequisites.orderDateText || ''}
                                  onChange={(e) =>
                                    setDraftRequisites((p) => ({
                                      ...p,
                                      orderDateText: e.target.value,
                                    }))
                                  }
                                  placeholder='Например: " 22 " сентября'
                                  className="w-full p-2.5 border border-slate-300 rounded-xl bg-white outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              </div>
                            </>
                          )}

                          {hasDepartment && (
                            <div className="sm:col-span-2">
                              <label className="block font-semibold text-slate-700 mb-1">
                                Отделение / кафедра по умолчанию
                              </label>
                              <input
                                type="text"
                                value={draftRequisites.department || ''}
                                onChange={(e) =>
                                  setDraftRequisites((p) => ({ ...p, department: e.target.value }))
                                }
                                className="w-full p-2.5 border border-slate-300 rounded-xl bg-white outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                          )}

                          {hasInvoiceParties && (
                            <>
                              <div>
                                <label className="block font-semibold text-slate-700 mb-1">
                                  Сдатчик по умолчанию
                                </label>
                                <input
                                  type="text"
                                  value={draftRequisites.sender || ''}
                                  onChange={(e) =>
                                    setDraftRequisites((p) => ({ ...p, sender: e.target.value }))
                                  }
                                  className="w-full p-2.5 border border-slate-300 rounded-xl bg-white outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              </div>
                              <div>
                                <label className="block font-semibold text-slate-700 mb-1">
                                  Получатель по умолчанию
                                </label>
                                <input
                                  type="text"
                                  value={draftRequisites.recipient || ''}
                                  onChange={(e) =>
                                    setDraftRequisites((p) => ({ ...p, recipient: e.target.value }))
                                  }
                                  className="w-full p-2.5 border border-slate-300 rounded-xl bg-white outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              </div>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Approver */}
                      {hasApprover && (
                        <div className="space-y-3">
                          <h5 className="text-xs font-bold text-slate-900 border-b border-slate-100 pb-1.5">
                            Гриф «УТВЕРЖДАЮ»
                          </h5>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label className="block font-semibold text-slate-700 mb-1">
                                Должность утверждающего руководителя
                              </label>
                              <textarea
                                rows={activeKey === 'case1_act' ? 3 : 2}
                                value={draftRequisites.approverRole || ''}
                                onChange={(e) =>
                                  setDraftRequisites((p) => ({ ...p, approverRole: e.target.value }))
                                }
                                className="w-full p-2.5 border border-slate-300 rounded-xl bg-white outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                            <div>
                              <label className="block font-semibold text-slate-700 mb-1">
                                Инициалы и фамилия руководителя
                              </label>
                              <input
                                type="text"
                                value={draftRequisites.approverName || ''}
                                onChange={(e) =>
                                  setDraftRequisites((p) => ({ ...p, approverName: e.target.value }))
                                }
                                className="w-full p-2.5 border border-slate-300 rounded-xl bg-white outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Commission */}
                      {hasCommission && (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                            <h5 className="text-xs font-bold text-slate-900">
                              Комиссия по списанию
                            </h5>
                            <button
                              type="button"
                              onClick={addMember}
                              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-semibold inline-flex items-center gap-1"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              Добавить члена комиссии
                            </button>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            <div>
                              <label className="block font-semibold text-slate-700 mb-1">
                                Председатель комиссии — должность
                              </label>
                              <input
                                type="text"
                                value={draftRequisites.commissionChair?.title || ''}
                                onChange={(e) =>
                                  updateSignatoryField('commissionChair', 'title', e.target.value)
                                }
                                className="w-full p-2 border border-slate-300 rounded-xl bg-white outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                            <div>
                              <label className="block font-semibold text-slate-700 mb-1">
                                Председатель комиссии — Ф.И.О.
                              </label>
                              <input
                                type="text"
                                value={draftRequisites.commissionChair?.name || ''}
                                onChange={(e) =>
                                  updateSignatoryField('commissionChair', 'name', e.target.value)
                                }
                                className="w-full p-2 border border-slate-300 rounded-xl bg-white outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                          </div>

                          <div className="space-y-2">
                            <div className="font-semibold text-slate-700">Члены комиссии:</div>
                            {(draftRequisites.commissionMembers || []).length === 0 ? (
                              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-500 text-center">
                                Список членов комиссии пуст
                              </div>
                            ) : (
                              (draftRequisites.commissionMembers || []).map((member, idx) => (
                                <div
                                  key={idx}
                                  className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-center"
                                >
                                  <input
                                    type="text"
                                    value={member.title}
                                    onChange={(e) =>
                                      updateMemberField(idx, 'title', e.target.value)
                                    }
                                    placeholder="Должность"
                                    className="p-2 border border-slate-300 rounded-xl bg-white outline-none focus:ring-2 focus:ring-blue-500"
                                  />
                                  <input
                                    type="text"
                                    value={member.name}
                                    onChange={(e) =>
                                      updateMemberField(idx, 'name', e.target.value)
                                    }
                                    placeholder="Ф.И.О."
                                    className="p-2 border border-slate-300 rounded-xl bg-white outline-none focus:ring-2 focus:ring-blue-500"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => removeMember(idx)}
                                    className="p-2 text-red-600 hover:bg-red-50 rounded-xl border border-slate-200"
                                    title="Удалить члена комиссии"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      )}

                      {/* MOL & Invoice Signatories */}
                      {(hasMol || hasInvoiceSignatories || hasChiefAccountant) && (
                        <div className="space-y-3">
                          <h5 className="text-xs font-bold text-slate-900 border-b border-slate-100 pb-1.5">
                            Ответственные лица и подписи
                          </h5>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {hasMol && (
                              <>
                                <div>
                                  <label className="block font-semibold text-slate-700 mb-1">
                                    МОЛ — должность
                                  </label>
                                  <input
                                    type="text"
                                    value={draftRequisites.mol?.title || ''}
                                    onChange={(e) =>
                                      updateSignatoryField('mol', 'title', e.target.value)
                                    }
                                    className="w-full p-2 border border-slate-300 rounded-xl bg-white outline-none focus:ring-2 focus:ring-blue-500"
                                  />
                                </div>
                                <div>
                                  <label className="block font-semibold text-slate-700 mb-1">
                                    МОЛ — Ф.И.О.
                                  </label>
                                  <input
                                    type="text"
                                    value={draftRequisites.mol?.name || ''}
                                    onChange={(e) =>
                                      updateSignatoryField('mol', 'name', e.target.value)
                                    }
                                    className="w-full p-2 border border-slate-300 rounded-xl bg-white outline-none focus:ring-2 focus:ring-blue-500"
                                  />
                                </div>
                              </>
                            )}

                            {hasInvoiceSignatories && (
                              <>
                                <div>
                                  <label className="block font-semibold text-slate-700 mb-1">
                                    Сдал — должность
                                  </label>
                                  <input
                                    type="text"
                                    value={draftRequisites.senderSign?.title || ''}
                                    onChange={(e) =>
                                      updateSignatoryField('senderSign', 'title', e.target.value)
                                    }
                                    className="w-full p-2 border border-slate-300 rounded-xl bg-white outline-none focus:ring-2 focus:ring-blue-500"
                                  />
                                </div>
                                <div>
                                  <label className="block font-semibold text-slate-700 mb-1">
                                    Сдал — Ф.И.О.
                                  </label>
                                  <input
                                    type="text"
                                    value={draftRequisites.senderSign?.name || ''}
                                    onChange={(e) =>
                                      updateSignatoryField('senderSign', 'name', e.target.value)
                                    }
                                    className="w-full p-2 border border-slate-300 rounded-xl bg-white outline-none focus:ring-2 focus:ring-blue-500"
                                  />
                                </div>
                                <div>
                                  <label className="block font-semibold text-slate-700 mb-1">
                                    Принял — должность
                                  </label>
                                  <input
                                    type="text"
                                    value={draftRequisites.recipientSign?.title || ''}
                                    onChange={(e) =>
                                      updateSignatoryField('recipientSign', 'title', e.target.value)
                                    }
                                    className="w-full p-2 border border-slate-300 rounded-xl bg-white outline-none focus:ring-2 focus:ring-blue-500"
                                  />
                                </div>
                                <div>
                                  <label className="block font-semibold text-slate-700 mb-1">
                                    Принял — Ф.И.О.
                                  </label>
                                  <input
                                    type="text"
                                    value={draftRequisites.recipientSign?.name || ''}
                                    onChange={(e) =>
                                      updateSignatoryField('recipientSign', 'name', e.target.value)
                                    }
                                    className="w-full p-2 border border-slate-300 rounded-xl bg-white outline-none focus:ring-2 focus:ring-blue-500"
                                  />
                                </div>
                              </>
                            )}

                            {hasChiefAccountant && (
                              <div className="sm:col-span-2">
                                <label className="block font-semibold text-slate-700 mb-1">
                                  Главный бухгалтер — Ф.И.О.
                                </label>
                                <input
                                  type="text"
                                  value={draftRequisites.chiefAccountantName || ''}
                                  onChange={(e) =>
                                    setDraftRequisites((p) => ({
                                      ...p,
                                      chiefAccountantName: e.target.value,
                                    }))
                                  }
                                  className="w-full p-2 border border-slate-300 rounded-xl bg-white outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Case 1 Conclusion texts */}
                      {hasConclusions && (
                        <div className="space-y-3">
                          <h5 className="text-xs font-bold text-slate-900 border-b border-slate-100 pb-1.5">
                            Формулировки заключения комиссии
                          </h5>
                          <div>
                            <label className="block font-semibold text-slate-700 mb-1">
                              Заключение комиссии
                            </label>
                            <textarea
                              rows={2}
                              value={draftRequisites.conclusionText || ''}
                              onChange={(e) =>
                                setDraftRequisites((p) => ({ ...p, conclusionText: e.target.value }))
                              }
                              className="w-full p-2.5 border border-slate-300 rounded-xl bg-white outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                          <div>
                            <label className="block font-semibold text-slate-700 mb-1">
                              Решение о передаче и переработке ДМ
                            </label>
                            <textarea
                              rows={2}
                              value={draftRequisites.recycleDecisionText || ''}
                              onChange={(e) =>
                                setDraftRequisites((p) => ({
                                  ...p,
                                  recycleDecisionText: e.target.value,
                                }))
                              }
                              className="w-full p-2.5 border border-slate-300 rounded-xl bg-white outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    /* DOCX Template Upload / Download Tab */
                    <div className="space-y-5">
                      <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div>
                            <div className="font-bold text-slate-900 text-sm">
                              Редактирование через Microsoft Word / LibreOffice
                            </div>
                            <p className="text-xs text-slate-600 mt-0.5">
                              Скачайте бланк в формате .docx, измените в нём шапку, № приказа, ФИО или формулировки, не удаляя метки в фигурных скобках, и загрузите файл обратно.
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => handleDownloadEditableDocx(false)}
                            disabled={downloadingKey !== null}
                            className="px-3.5 py-2 bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5"
                          >
                            <Download className="w-4 h-4 text-blue-600" />
                            {downloadingKey === 'current'
                              ? 'Скачивание...'
                              : activeTemplate.hasCustomDocx
                              ? 'Скачать текущий .docx'
                              : 'Скачать шаблон .docx'}
                          </button>

                          {activeTemplate.hasCustomDocx && (
                            <button
                              type="button"
                              onClick={() => handleDownloadEditableDocx(true)}
                              disabled={downloadingKey !== null}
                              className="px-3.5 py-2 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5"
                              title="Сформировать новый чистый .docx шаблон с актуальными реквизитами из вкладки «Реквизиты и лица»"
                            >
                              <FileCode className="w-4 h-4 text-slate-600" />
                              {downloadingKey === 'fresh'
                                ? 'Формирование...'
                                : 'Скачать чистый бланк из реквизитов'}
                            </button>
                          )}

                          <input
                            ref={fileInputRef}
                            type="file"
                            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                            onChange={handleUploadDocxFile}
                            className="hidden"
                          />
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploadingDocx}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 shadow-xs"
                          >
                            <Upload className="w-4 h-4" />
                            {uploadingDocx ? 'Загрузка файла...' : 'Загрузить изменённый .docx'}
                          </button>
                        </div>
                      </div>

                      {/* Custom Docx Status */}
                      <div className="p-4 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="space-y-1">
                          <div className="font-semibold text-slate-900">
                            {activeTemplate.hasCustomDocx
                              ? `Активен пользовательский файл: ${activeTemplate.customFileName}`
                              : 'Используется встроенный генератор бланка'}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {activeTemplate.updatedAt ? (
                              <>
                                Обновлено:{' '}
                                <span className="tabular-nums">
                                  {new Date(activeTemplate.updatedAt).toLocaleString('ru-RU')}
                                </span>
                                {activeTemplate.updatedBy ? ` · Автор: ${activeTemplate.updatedBy}` : ''}
                              </>
                            ) : (
                              'Изменения ещё не сохранялись — действуют значения по умолчанию.'
                            )}
                          </div>
                        </div>
                        {activeTemplate.hasCustomDocx && (
                          <button
                            type="button"
                            onClick={handleResetCustomDocx}
                            disabled={resettingDocx}
                            className="px-3.5 py-2 border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 shrink-0"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            {resettingDocx ? 'Сброс...' : 'Вернуть встроенный бланк'}
                          </button>
                        )}
                      </div>

                      {/* Placeholders Reference Table */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h5 className="font-bold text-xs text-slate-900">
                            Переменные подстановки данных из БД ({activeTemplate.placeholders.length})
                          </h5>
                          <span className="text-[11px] text-slate-500">
                            Сохраняйте эти метки в таблицах и строках при правке в Word
                          </span>
                        </div>
                        <div className="border border-slate-200 rounded-xl overflow-hidden">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                                <th className="py-2 px-3">Метка</th>
                                <th className="py-2 px-3">Область</th>
                                <th className="py-2 px-3">Подставляемое значение</th>
                                <th className="py-2 px-3 text-right">Действие</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-xs">
                              {activeTemplate.placeholders.map((ph) => (
                                <tr key={ph.token} className="hover:bg-slate-50">
                                  <td className="py-2 px-3 font-mono text-[11px] font-semibold text-blue-700 whitespace-nowrap">
                                    {ph.token}
                                  </td>
                                  <td className="py-2 px-3 text-[11px] text-slate-500 whitespace-nowrap">
                                    {ph.scope === 'item' ? 'Строка / единица' : 'Документ'}
                                  </td>
                                  <td className="py-2 px-3 text-slate-700">{ph.label}</td>
                                  <td className="py-2 px-3 text-right">
                                    <button
                                      type="button"
                                      onClick={() => handleCopyToken(ph.token)}
                                      className="px-2 py-1 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 text-[11px] font-medium inline-flex items-center gap-1"
                                    >
                                      {copiedToken === ph.token ? (
                                        <>
                                          <Check className="w-3 h-3 text-emerald-600" />
                                          Скопировано
                                        </>
                                      ) : (
                                        <>
                                          <Copy className="w-3 h-3" />
                                          Копировать
                                        </>
                                      )}
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Bottom Action Footer */}
                <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3 shrink-0">
                  {activeTab === 'requisites' ? (
                    <>
                      <button
                        type="button"
                        onClick={() => handleSaveRequisites(true)}
                        disabled={savingRequisites}
                        className="px-3.5 py-2 border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Сбросить реквизиты
                      </button>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={onClose}
                          className="px-4 py-2 border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold"
                        >
                          Закрыть
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveRequisites(false)}
                          disabled={savingRequisites}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 shadow-xs"
                        >
                          <Save className="w-4 h-4" />
                          {savingRequisites ? 'Сохранение...' : 'Сохранить реквизиты'}
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="w-full flex items-center justify-end">
                      <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold"
                      >
                        Закрыть
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center p-8 text-xs text-slate-400">
                Выберите шаблон в списке слева
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
