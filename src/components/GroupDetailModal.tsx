import React, { useState, useEffect } from 'react';
import {
  X,
  Boxes,
  QrCode,
  Download,
  FileText,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Layers,
} from 'lucide-react';
import QRCode from 'qrcode';
import type { User } from '../types/index.ts';
import { apiFetch } from '../utils/api.ts';

interface GroupDetailModalProps {
  groupCode: string | null;
  onClose: () => void;
  onOpenEquipmentDetail: (id: number) => void;
  currentUser: User | null;
  onReloadList?: () => void;
}

export const GroupDetailModal: React.FC<GroupDetailModalProps> = ({
  groupCode,
  onClose,
  onOpenEquipmentDetail,
  currentUser,
  onReloadList,
}) => {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [downloadingDocx, setDownloadingDocx] = useState(false);
  const [bulkVerifying, setBulkVerifying] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!groupCode) {
      setData(null);
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    apiFetch(`/api/equipment/qr-group/${groupCode}`)
      .then(async (res) => {
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Ошибка загрузки данных партии');
        }
        return res.json();
      })
      .then(async (resData) => {
        setData(resData);
        if (resData.qrUrl) {
          const url = await QRCode.toDataURL(resData.qrUrl, {
            width: 220,
            margin: 1,
            errorCorrectionLevel: 'M',
          });
          setQrDataUrl(url);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [groupCode]);

  if (!groupCode) return null;

  const handleDownloadDocx = async () => {
    if (!data?.batch?.code) return;
    setDownloadingDocx(true);
    try {
      const res = await apiFetch(`/api/equipment/qr-group/${data.batch.code}/docx`);
      if (!res.ok) throw new Error('Ошибка скачивания карточки DOCX');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `group-qr-${data.batch.code}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDownloadingDocx(false);
    }
  };

  const handleBulkVerify = async () => {
    if (!data?.items || data.items.length === 0) return;
    setBulkVerifying(true);
    setError(null);
    try {
      // Get active audit first
      const auditRes = await apiFetch('/api/inventory/current');
      const auditData = await auditRes.json();
      if (!auditData?.id) {
        throw new Error('Сейчас нет активной инвентаризации для подтверждения');
      }

      // Verify each item in batch
      let verifiedCount = 0;
      for (const item of data.items) {
        const vRes = await apiFetch(`/api/inventory/${auditData.id}/verify/${item.id}`, {
          method: 'POST',
        });
        if (vRes.ok) verifiedCount++;
      }

      setSuccessMsg(`Пакетно подтверждено ${verifiedCount} из ${data.items.length} единиц в инвентаризации!`);
      if (onReloadList) onReloadList();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBulkVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-2xl w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto animate-scaleUp">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center text-purple-700">
              <Boxes className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base text-slate-900">
                  {data?.batch?.name || 'Партия оборудования'}
                </h3>
                <span className="px-2 py-0.5 rounded bg-purple-100 text-purple-800 text-[11px] font-mono font-bold">
                  {groupCode}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Групповой QR-комплект кафедры ({data?.items?.length || 0} предметов)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-semibold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {loading ? (
          <div className="py-12 text-center text-slate-400 text-xs">
            Загрузка данных партии...
          </div>
        ) : data ? (
          <div className="space-y-5">
            {/* Top Info Box: QR + Gateway */}
            <div className="flex flex-col sm:flex-row items-center gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
              <div className="bg-white p-2 rounded-xl border border-slate-200 shadow-2xs shrink-0">
                {qrDataUrl && (
                  <img src={qrDataUrl} alt="QR" className="w-28 h-28 object-contain" />
                )}
              </div>
              <div className="space-y-1 text-center sm:text-left flex-1">
                <span className="text-[10px] font-bold text-purple-700 uppercase tracking-wider">
                  Единый шлюз доступа партии
                </span>
                <p className="text-xs font-mono text-slate-700 break-all select-all font-semibold">
                  {data.qrUrl}
                </p>
                <p className="text-[11px] text-slate-500 leading-tight">
                  🔒 Доступен сотрудникам кафедры при сканировании. Посторонним наблюдателям возвращается 404 (пустышка).
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    onClick={handleDownloadDocx}
                    disabled={downloadingDocx}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1 shadow-2xs transition-colors"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    {downloadingDocx ? 'Загрузка...' : 'Карточка DOCX'}
                  </button>
                  {qrDataUrl && (
                    <a
                      href={qrDataUrl}
                      download={`QR-${groupCode}.png`}
                      className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      PNG
                    </a>
                  )}
                </div>
              </div>
            </div>

            {/* Bulk verify action during audit */}
            {currentUser && ['ADMIN', 'ENGINEER'].includes(currentUser.role) && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="text-xs text-emerald-900">
                  <strong>Инвентаризация комплекта:</strong>
                  <p className="text-[11px] text-emerald-700">
                    Подтвердите наличие всех {data.items.length} единиц одним кликом
                  </p>
                </div>
                <button
                  onClick={handleBulkVerify}
                  disabled={bulkVerifying}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors shrink-0 inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {bulkVerifying ? 'Подтверждение...' : 'Подтвердить всю партию'}
                </button>
              </div>
            )}

            {/* Included Equipment Table */}
            <div>
              <h4 className="text-xs font-bold uppercase text-slate-600 tracking-wider mb-2">
                Состав комплекта ({data.items.length} ед.):
              </h4>
              <div className="border border-slate-200 rounded-xl overflow-hidden max-h-60 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold text-[11px] sticky top-0">
                    <tr>
                      <th className="p-2.5">Инв. №</th>
                      <th className="p-2.5">Наименование</th>
                      <th className="p-2.5">Кабинет</th>
                      <th className="p-2.5 text-right">Действие</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.items.map((item: any) => (
                      <tr key={item.id} className="hover:bg-slate-50">
                        <td className="p-2.5 font-mono text-blue-700 font-bold">
                          {item.inventory_number}
                        </td>
                        <td className="p-2.5 font-medium text-slate-800">
                          {item.name}
                        </td>
                        <td className="p-2.5 text-slate-600">
                          {item.roomNumber ? `Ауд. ${item.roomNumber}` : '—'}
                        </td>
                        <td className="p-2.5 text-right">
                          <button
                            onClick={() => {
                              onOpenEquipmentDetail(item.id);
                              onClose();
                            }}
                            className="text-xs text-blue-600 hover:text-blue-800 font-semibold inline-flex items-center gap-1"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            Паспорт
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};
