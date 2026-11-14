import React, { useState, useEffect } from 'react';
import { Ruler } from 'lucide-react';

export const QR_SIZE_PRESETS = [
  { value: 1, label: '1×1 см' },
  { value: 2, label: '2×2 см' },
  { value: 3, label: '3×3 см' },
  { value: 5, label: '5×5 см' },
] as const;

export const MIN_QR_SIZE_CM = 0.8;
export const MAX_QR_SIZE_CM = 10;

export function getColumnsForQrSize(sizeCm: number): number {
  if (sizeCm <= 1.8) return 4;
  if (sizeCm <= 2.6) return 3;
  if (sizeCm <= 6.5) return 2;
  return 1;
}

interface QrSizeSelectorProps {
  value: number;
  onChange: (sizeCm: number) => void;
  compact?: boolean;
  showColumnsHint?: boolean;
}

export const QrSizeSelector: React.FC<QrSizeSelectorProps> = ({
  value,
  onChange,
  compact = false,
  showColumnsHint = false,
}) => {
  const [inputValue, setInputValue] = useState(String(value));

  useEffect(() => {
    setInputValue(String(value));
  }, [value]);

  const handlePresetClick = (presetVal: number) => {
    setInputValue(String(presetVal));
    onChange(presetVal);
  };

  const handleInputChange = (raw: string) => {
    setInputValue(raw);
    const parsed = Number(raw.replace(',', '.'));
    if (Number.isFinite(parsed) && parsed >= MIN_QR_SIZE_CM && parsed <= MAX_QR_SIZE_CM) {
      onChange(Math.round(parsed * 10) / 10);
    }
  };

  const handleInputBlur = () => {
    const parsed = Number(inputValue.replace(',', '.'));
    if (!Number.isFinite(parsed)) {
      setInputValue(String(value));
      return;
    }
    const clamped = Math.min(MAX_QR_SIZE_CM, Math.max(MIN_QR_SIZE_CM, parsed));
    const rounded = Math.round(clamped * 10) / 10;
    setInputValue(String(rounded));
    onChange(rounded);
  };

  const columns = getColumnsForQrSize(value);
  const formattedValue = Number.isInteger(value) ? String(value) : value.toFixed(1);

  return (
    <div className={compact ? 'space-y-1.5 text-left' : 'space-y-2.5 text-left'}>
      <div className="flex items-center justify-between gap-2">
        <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-700">
          <Ruler className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
          <span>Размер QR-кода в DOCX</span>
        </label>
        <span className="text-[11px] font-mono font-bold text-indigo-700">
          {formattedValue}×{formattedValue} см
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {QR_SIZE_PRESETS.map((preset) => {
          const isActive = Math.abs(value - preset.value) < 0.05;
          return (
            <button
              key={preset.value}
              type="button"
              onClick={() => handlePresetClick(preset.value)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
                isActive
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              {preset.label}
            </button>
          );
        })}

        <div className="inline-flex items-center gap-1 bg-white border border-slate-300 rounded-lg px-2 py-0.5 focus-within:ring-2 focus-within:ring-indigo-500/20 focus-within:border-indigo-500">
          <span className="text-[10px] text-slate-400">Свой:</span>
          <input
            type="number"
            min={MIN_QR_SIZE_CM}
            max={MAX_QR_SIZE_CM}
            step={0.1}
            value={inputValue}
            onChange={(e) => handleInputChange(e.target.value)}
            onBlur={handleInputBlur}
            aria-label="Размер стороны QR-кода в сантиметрах"
            className="w-12 text-[11px] font-mono font-semibold text-slate-900 outline-none bg-transparent text-center"
          />
          <span className="text-[10px] text-slate-500 font-medium">см</span>
        </div>
      </div>

      {!compact && (
        <div className="flex items-center justify-between gap-2 text-[10px] text-slate-500">
          <span>Допустимый диапазон: от 0.8 до 10 см (квадрат {formattedValue}×{formattedValue} см)</span>
          {showColumnsHint && (
            <span className="font-semibold text-indigo-700 shrink-0">
              Сетка A4: {columns} {columns === 1 ? 'столбец' : columns < 5 ? 'столбца' : 'столбцов'}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
