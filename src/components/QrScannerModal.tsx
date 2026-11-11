import React, { useState, useEffect, useRef } from 'react';
import { X, Camera, Upload, Search, CheckCircle2, AlertCircle } from 'lucide-react';
import type { Equipment } from '../types/index.ts';

interface QrScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectEquipmentId: (id: number) => void;
  onSelectGroupCode?: (code: string) => void;
}

export const QrScannerModal: React.FC<QrScannerModalProps> = ({
  isOpen,
  onClose,
  onSelectEquipmentId,
  onSelectGroupCode,
}) => {
  const [equipmentList, setEquipmentList] = useState<Equipment[]>([]);
  const [manualInput, setManualInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetch('/api/equipment?limit=100')
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data?.items)) setEquipmentList(data.items);
          else setEquipmentList([]);
        })
        .catch(console.error);
    } else {
      stopCamera();
    }
  }, [isOpen]);

  const startCamera = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setCameraActive(true);
    } catch (err: any) {
      setError('Не удалось получить доступ к камере. Используйте загрузку или ручной поиск.');
      setCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  if (!isOpen) return null;

  const handleManualSearch = () => {
    let raw = manualInput.trim();
    if (!raw) return;

    // Check if it's a gateway URL like https://domain/q/EQ-10492 or /q/GRP-2026-1234
    const urlMatch = raw.match(/\/q\/([^/?#]+)/i);
    if (urlMatch) {
      raw = decodeURIComponent(urlMatch[1]);
    }

    // Check if group code
    if (raw.startsWith('GRP-') || raw.startsWith('grp-') || raw.startsWith('BATCH-')) {
      if (onSelectGroupCode) {
        onSelectGroupCode(raw);
        onClose();
        return;
      }
    }

    // Strip EQ- prefix if present
    let cleanCode = raw;
    if (/^EQ-\d+$/i.test(raw)) {
      cleanCode = raw.replace(/^EQ-/i, '');
    }

    const term = cleanCode.toLowerCase();

    // Check if ID
    const numId = Number(cleanCode);
    if (!isNaN(numId) && equipmentList.some((e) => e.id === numId)) {
      onSelectEquipmentId(numId);
      onClose();
      return;
    }

    // Check if inventory number or name
    const found = equipmentList.find(
      (e) =>
        e.inventory_number.toLowerCase() === term ||
        e.inventory_number.toLowerCase() === raw.toLowerCase() ||
        e.inventory_number.toLowerCase().includes(term) ||
        e.name.toLowerCase().includes(term)
    );

    if (found) {
      onSelectEquipmentId(found.id);
      onClose();
    } else {
      setError(`Оборудование или партия по запросу "${manualInput}" не найдено`);
    }
  };

  const handleSelectPredefined = (id: number) => {
    onSelectEquipmentId(id);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-600 rounded-xl">
              <Camera className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-base">Сканер QR-кодов оборудования</h3>
              <p className="text-xs text-slate-400">
                Переход на персональную страницу единицы учета
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6">
          {error && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
              <span>{error}</span>
            </div>
          )}

          {/* Camera View Area */}
          <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50 flex flex-col items-center text-center">
            {cameraActive ? (
              <div className="relative w-full max-w-xs aspect-square rounded-xl overflow-hidden bg-black shadow-inner flex items-center justify-center">
                <video
                  ref={videoRef}
                  className="w-full h-full object-cover"
                  playsInline
                  muted
                />
                <div className="absolute inset-8 border-2 border-dashed border-emerald-400 rounded-xl pointer-events-none animate-pulse" />
              </div>
            ) : (
              <div className="w-full py-8 flex flex-col items-center justify-center">
                <div className="w-16 h-16 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 mb-3 shadow-xs">
                  <Camera className="w-8 h-8" />
                </div>
                <h4 className="font-semibold text-slate-800 text-sm">
                  Сканирование через камеру смартфона/ПК
                </h4>
                <p className="text-xs text-slate-500 max-w-xs mt-1">
                  Наведите камеру на распечатанный QR-код с инвентарным номером
                </p>
                <button
                  type="button"
                  onClick={startCamera}
                  className="mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors"
                >
                  Включить камеру
                </button>
              </div>
            )}
          </div>

          {/* Manual Input or Search */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Или введите инвентарный номер / ID вручную:
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                <input
                  type="text"
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleManualSearch()}
                  placeholder="Например: INV-2015-001 или 1"
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                />
              </div>
              <button
                type="button"
                onClick={handleManualSearch}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold rounded-xl transition-colors"
              >
                Найти
              </button>
            </div>
          </div>

          {/* Quick Simulation List */}
          <div>
            <span className="block text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wider">
              Быстрый переход к оборудованию кафедры:
            </span>
            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
              {(Array.isArray(equipmentList) ? equipmentList : []).slice(0, 6).map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleSelectPredefined(item.id)}
                  className="w-full flex items-center justify-between p-2.5 rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50 transition-all text-left text-xs"
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className="font-mono font-bold bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-[11px]">
                      {item.inventory_number}
                    </span>
                    <span className="font-medium text-slate-900 truncate">
                      {item.name}
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-500 shrink-0">
                    каб. {item.roomNumber}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
