import React, { useState } from 'react';
import {
  X,
  QrCode,
  Download,
  Copy,
  Check,
  Boxes,
  FileText,
  ExternalLink,
  AlertCircle,
} from 'lucide-react';
import QRCode from 'qrcode';
import type { Equipment } from '../types/index.ts';
import { apiFetch } from '../utils/api.ts';

interface GroupQrModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedItems: Equipment[];
  onOpenGroupDetail?: (code: string) => void;
}

export const GroupQrModal: React.FC<GroupQrModalProps> = ({
  isOpen,
  onClose,
  selectedItems,
  onOpenGroupDetail,
}) => {
  const [batchName, setBatchName] = useState(() => {
    if (selectedItems.length === 0) return '';
    const first = selectedItems[0];
    const room = first.roomNumber ? ` (Ауд. ${first.roomNumber})` : '';
    return `Комплект: ${selectedItems.length} шт. («${first.name}»)${room}`;
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedBatch, setGeneratedBatch] = useState<{
    code: string;
    name: string;
    qrUrl: string;
    itemsCount: number;
  } | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [downloadingDocx, setDownloadingDocx] = useState(false);

  if (!isOpen) return null;

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedItems.length === 0) return;

    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/equipment/qr-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipment_ids: selectedItems.map((i) => i.id),
          name: batchName.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка создания группового QR-кода');

      setGeneratedBatch(data);
      const url = await QRCode.toDataURL(data.qrUrl, {
        width: 280,
        margin: 1,
        errorCorrectionLevel: 'M',
      });
      setQrDataUrl(url);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyLink = () => {
    if (!generatedBatch) return;
    navigator.clipboard.writeText(generatedBatch.qrUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadDocx = async () => {
    if (!generatedBatch) return;
    setDownloadingDocx(true);
    try {
      const res = await apiFetch(`/api/equipment/qr-group/${generatedBatch.code}/docx`);
      if (!res.ok) throw new Error('Ошибка скачивания карточки');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `group-qr-${generatedBatch.code}.docx`;
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-xl w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto animate-scaleUp">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-purple-100 flex items-center justify-center text-purple-700">
              <Boxes className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900">
                Групповой QR-код партии оборудования
              </h3>
              <p className="text-xs text-slate-500">
                Единый QR-код для комплекта одинаковых предметов (столы, стулья, ПК)
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

        {!generatedBatch ? (
          <form onSubmit={handleGenerate} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Название партии / комплекта *
              </label>
              <input
                type="text"
                value={batchName}
                onChange={(e) => setBatchName(e.target.value)}
                placeholder="Например: Партия 10 учебных столов, ауд. 308"
                className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
                required
              />
            </div>

            {/* Selected Items summary */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                <span>Выбранные предметы ({selectedItems.length} ед.):</span>
                <span className="text-purple-700 font-mono text-[11px]">
                  {selectedItems[0]?.roomNumber ? `Кабинет: ${selectedItems[0].roomNumber}` : ''}
                </span>
              </div>
              <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                {selectedItems.map((item, idx) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between text-[11px] bg-white p-2 rounded-lg border border-slate-150"
                  >
                    <span className="truncate max-w-[280px] font-medium text-slate-800">
                      {idx + 1}. {item.name}
                    </span>
                    <span className="font-mono text-blue-700 font-bold shrink-0">
                      {item.inventory_number}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-[11px] leading-relaxed">
              <strong>Как работает шлюз:</strong> Сканирование этого единого QR-кода авторизованным
              сотрудником откроет весь список из {selectedItems.length} предметов с возможностью
              пакетного подтверждения при инвентаризации. Посторонний человек увидит безопасную
              страницу «404 Не найдено» (пустышку).
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-5 py-2 text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white rounded-xl shadow-xs transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                <QrCode className="w-4 h-4" />
                {loading ? 'Формирование...' : 'Сгенерировать групповой QR'}
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-4 text-center">
            {/* Generated QR View */}
            <div className="flex flex-col items-center">
              <div className="bg-white p-3 rounded-2xl border-2 border-purple-200 shadow-sm mb-3">
                {qrDataUrl && (
                  <img
                    src={qrDataUrl}
                    alt="Групповой QR"
                    className="w-48 h-48 object-contain"
                  />
                )}
              </div>
              <h4 className="font-bold text-slate-900 text-sm">{generatedBatch.name}</h4>
              <span className="text-xs font-mono text-purple-700 font-bold mt-0.5">
                Код партии: {generatedBatch.code} ({generatedBatch.itemsCount} предметов)
              </span>
            </div>

            {/* Gateway link box */}
            <div className="flex items-center gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-left">
              <div className="flex-1 min-w-0">
                <span className="block text-[10px] text-slate-400 font-semibold uppercase">
                  Шлюз доступа
                </span>
                <span className="text-xs font-mono text-slate-800 truncate block">
                  {generatedBatch.qrUrl}
                </span>
              </div>
              <button
                onClick={handleCopyLink}
                className="px-2.5 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg text-xs font-medium text-slate-700 flex items-center gap-1 shrink-0"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Скопировано</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Копировать</span>
                  </>
                )}
              </button>
            </div>

            {/* Action buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
              <button
                onClick={handleDownloadDocx}
                disabled={downloadingDocx}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 shadow-xs transition-colors"
              >
                <FileText className="w-4 h-4" />
                {downloadingDocx ? 'Формирование DOCX...' : 'Скачать карточку партии (DOCX)'}
              </button>

              <a
                href={qrDataUrl}
                download={`QR-batch-${generatedBatch.code}.png`}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors"
              >
                <Download className="w-4 h-4" />
                Скачать изображение QR (PNG)
              </a>
            </div>

            {onOpenGroupDetail && (
              <div className="pt-2 border-t border-slate-100">
                <button
                  onClick={() => {
                    onOpenGroupDetail(generatedBatch.code);
                    onClose();
                  }}
                  className="text-xs text-purple-700 hover:text-purple-900 font-semibold inline-flex items-center gap-1"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Открыть карточку партии в системе
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
