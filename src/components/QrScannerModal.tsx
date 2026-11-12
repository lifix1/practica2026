import React, { useState, useEffect, useRef } from 'react';
import { X, Camera, Upload, Search, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import jsQR from 'jsqr';
import type { Equipment } from '../types/index.ts';
import { apiFetch } from '../utils/api.ts';

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
  const [scanSuccess, setScanSuccess] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Load equipment list on open for ID and inventory matching
  useEffect(() => {
    if (isOpen) {
      apiFetch('/api/equipment?limit=200')
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data?.items)) setEquipmentList(data.items);
          else setEquipmentList([]);
        })
        .catch(console.error);
    } else {
      stopCamera();
      setError(null);
      setScanSuccess(false);
      setManualInput('');
    }
  }, [isOpen]);

  // Clean up camera when unmounting
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  // Ensure stream is bound to video element as soon as camera becomes active
  useEffect(() => {
    if (cameraActive && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current
        .play()
        .then(() => {
          if (!animationFrameRef.current) {
            animationFrameRef.current = requestAnimationFrame(scanLoop);
          }
        })
        .catch((err) => {
          console.warn('Video play warning:', err);
        });
    }
  }, [cameraActive]);

  const handleProcessScannedCode = (rawText: string): boolean => {
    let raw = rawText.trim();
    if (!raw) return false;

    // Check if it's a gateway URL like https://domain/q/EQ-10492 or /q/GRP-2026-1234
    const urlMatch = raw.match(/\/q\/([^/?#]+)/i);
    if (urlMatch) {
      raw = decodeURIComponent(urlMatch[1]);
    }

    // Check if group code
    if (raw.startsWith('GRP-') || raw.startsWith('grp-') || raw.startsWith('BATCH-')) {
      if (onSelectGroupCode) {
        stopCamera();
        onSelectGroupCode(raw);
        onClose();
        return true;
      }
    }

    // Strip EQ- prefix if present
    let cleanCode = raw;
    if (/^EQ-\d+$/i.test(raw)) {
      cleanCode = raw.replace(/^EQ-/i, '');
    }

    const term = cleanCode.toLowerCase();

    // Check if direct ID
    const numId = Number(cleanCode);
    if (!isNaN(numId) && equipmentList.some((e) => e.id === numId)) {
      stopCamera();
      onSelectEquipmentId(numId);
      onClose();
      return true;
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
      stopCamera();
      onSelectEquipmentId(found.id);
      onClose();
      return true;
    }

    // If ID is valid number even if not in first page of cached equipment
    if (!isNaN(numId) && numId > 0) {
      stopCamera();
      onSelectEquipmentId(numId);
      onClose();
      return true;
    }

    return false;
  };

  const scanLoop = () => {
    if (!videoRef.current || videoRef.current.readyState < 2) {
      animationFrameRef.current = requestAnimationFrame(scanLoop);
      return;
    }

    const video = videoRef.current;
    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
    }
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    if (ctx && video.videoWidth > 0 && video.videoHeight > 0) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert',
      });

      if (code && code.data) {
        setScanSuccess(true);
        const processed = handleProcessScannedCode(code.data);
        if (processed) {
          return; // Modal closed
        } else {
          setError(`Распознан QR: "${code.data}", но объект не найден в реестре.`);
        }
      }
    }

    animationFrameRef.current = requestAnimationFrame(scanLoop);
  };

  const startCamera = async () => {
    setError(null);
    setScanSuccess(false);

    if (!navigator?.mediaDevices?.getUserMedia) {
      setError(
        'Доступ к камере недоступен. Браузер блокирует камеру на незащищенных HTTP-сайтах (требуется HTTPS) или камера не поддерживается.'
      );
      return;
    }

    try {
      let stream: MediaStream;
      try {
        // Prefer rear camera on smartphones/tablets
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
      } catch {
        // Fallback for laptop webcams with only front camera
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
        });
      }

      streamRef.current = stream;
      setCameraActive(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        if (!animationFrameRef.current) {
          animationFrameRef.current = requestAnimationFrame(scanLoop);
        }
      }
    } catch (err: any) {
      console.error('Camera access error:', err);
      let msg = 'Не удалось получить доступ к камере.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        msg = 'Доступ к камере заблокирован в настройках браузера. Разрешите камере доступ к сайту.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        msg = 'Камера на данном устройстве не найдена. Используйте ручной ввод или загрузку фото QR-кода.';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        msg = 'Камера уже занята другим приложением или вкладкой.';
      }
      setError(msg);
      setCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height);
          if (code && code.data) {
            setScanSuccess(true);
            const processed = handleProcessScannedCode(code.data);
            if (!processed) {
              setError(`В файле найден код "${code.data}", но объект не найден в системе.`);
            }
          } else {
            setError('На загруженной фотографии QR-код не распознан. Попробуйте более чёткий снимок.');
          }
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleManualSearch = () => {
    const processed = handleProcessScannedCode(manualInput);
    if (!processed && manualInput.trim()) {
      setError(`Оборудование или партия по запросу "${manualInput}" не найдено`);
    }
  };

  const handleSelectPredefined = (id: number) => {
    stopCamera();
    onSelectEquipmentId(id);
    onClose();
  };

  if (!isOpen) return null;

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
                Камера смартфона/ПК, загрузка фото или ручной поиск
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
        <div className="p-6 overflow-y-auto space-y-5">
          {error && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs flex items-center gap-2 animate-fadeIn">
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
              <span>{error}</span>
            </div>
          )}

          {scanSuccess && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs flex items-center gap-2 animate-fadeIn">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              <span>QR-код успешно распознан! Открываем паспорт...</span>
            </div>
          )}

          {/* Camera View Area */}
          <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50 flex flex-col items-center text-center">
            {cameraActive ? (
              <div className="w-full flex flex-col items-center">
                <div className="relative w-full max-w-xs aspect-square rounded-xl overflow-hidden bg-black shadow-inner flex items-center justify-center">
                  <video
                    ref={videoRef}
                    className="w-full h-full object-cover"
                    playsInline
                    autoPlay
                    muted
                  />
                  {/* Aiming Reticle */}
                  <div className="absolute inset-8 border-2 border-dashed border-emerald-400 rounded-xl pointer-events-none animate-pulse flex items-center justify-center">
                    <span className="text-[10px] text-white/90 bg-black/60 px-2 py-0.5 rounded-full font-medium">
                      Наведите на QR-код
                    </span>
                  </div>
                </div>

                <div className="flex gap-2 mt-3">
                  <button
                    type="button"
                    onClick={stopCamera}
                    className="px-3.5 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-xs font-semibold transition-colors"
                  >
                    Выключить камеру
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      stopCamera();
                      setTimeout(startCamera, 300);
                    }}
                    className="px-3.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Перезапустить
                  </button>
                </div>
              </div>
            ) : (
              <div className="w-full py-6 flex flex-col items-center justify-center">
                <div className="w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 mb-2.5 shadow-xs">
                  <Camera className="w-7 h-7" />
                </div>
                <h4 className="font-semibold text-slate-800 text-sm">
                  Сканирование через камеру
                </h4>
                <p className="text-xs text-slate-500 max-w-xs mt-1">
                  Поддерживаются смартфоны (задняя камера), планшеты и веб-камеры ПК
                </p>

                <div className="flex items-center gap-2 mt-4">
                  <button
                    type="button"
                    onClick={startCamera}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-xs flex items-center gap-2 transition-colors cursor-pointer"
                  >
                    <Camera className="w-4 h-4" />
                    Включить камеру
                  </button>

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-4 py-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold shadow-xs flex items-center gap-2 transition-colors cursor-pointer"
                  >
                    <Upload className="w-4 h-4 text-slate-500" />
                    Загрузить фото QR
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Manual Input or Search */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Или введите инвентарный номер, код или ссылку шлюза:
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                <input
                  type="text"
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleManualSearch()}
                  placeholder="Например: INV-2015-001, EQ-123 или GRP-2026-0001"
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                />
              </div>
              <button
                type="button"
                onClick={handleManualSearch}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer"
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
            <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
              {(Array.isArray(equipmentList) ? equipmentList : []).slice(0, 6).map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleSelectPredefined(item.id)}
                  className="w-full flex items-center justify-between p-2.5 rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50 transition-all text-left text-xs cursor-pointer"
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
