import React, { useState } from 'react';
import { X, Upload, FileSpreadsheet, Download, AlertCircle, CheckCircle2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import type { EquipmentType } from '../types/index.ts';

interface ExcelImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  types: EquipmentType[];
}

export const ExcelImportModal: React.FC<ExcelImportModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  types,
}) => {
  const [selectedTypeId, setSelectedTypeId] = useState<number | ''>('');
  const [parsedRows, setParsedRows] = useState<any[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  // Generate and download Excel template
  const handleDownloadTemplate = async () => {
    let headers = [
      'inventory_number',
      'name',
      'recived',
      'initial_cost',
      'residual_cost',
      'room_number',
    ];

    if (!selectedTypeId) {
      headers.push('type_name');
    }

    // If specific type selected, append its dynamic fields!
    if (selectedTypeId) {
      try {
        const res = await fetch(`/api/equipment-types/${selectedTypeId}/fields`);
        const fields = await res.json();
        fields.forEach((f: any) => headers.push(f.code));
      } catch (e) {
        console.error(e);
      }
    }

    const sampleRow: Record<string, any> = {
      inventory_number: `INV-2026-${Math.floor(100 + Math.random() * 900)}`,
      name: 'Пример наименования оборудования',
      recived: '2026-01-15',
      initial_cost: 50000,
      residual_cost: 35000,
      room_number: '308',
    };

    if (!selectedTypeId) {
      sampleRow.type_name = 'Компьютер';
    }

    const ws = XLSX.utils.json_to_sheet([sampleRow], { header: headers });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Оборудование');

    XLSX.writeFile(
      wb,
      selectedTypeId
        ? `shablon-importa-type-${selectedTypeId}.xlsx`
        : 'shablon-importa-oborudovaniya.xlsx'
    );
  };

  // Handle file select
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setErrors([]);
    setSuccessMsg(null);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws, { defval: '' });
        setParsedRows(data);
      } catch (err: any) {
        setErrors(['Не удалось прочитать Excel файл: ' + err.message]);
      }
    };
    reader.readAsBinaryString(file);
  };

  // Submit to server
  const handleUpload = async () => {
    if (parsedRows.length === 0) {
      setErrors(['Файл не содержит строк данных']);
      return;
    }

    setLoading(true);
    setErrors([]);
    setSuccessMsg(null);

    try {
      const res = await fetch('/api/equipment/import-excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: parsedRows,
          type_id: selectedTypeId || undefined,
        }),
      });

      const resData = await res.json();
      if (!res.ok) {
        if (resData.details && Array.isArray(resData.details)) {
          setErrors(resData.details);
        } else {
          setErrors([resData.error || 'Ошибка импорта данных']);
        }
        return;
      }

      setSuccessMsg(resData.message || 'Импорт успешно завершен!');
      onSuccess();
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err: any) {
      setErrors([err.message]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-6 animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-emerald-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-700 rounded-xl">
              <FileSpreadsheet className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-base sm:text-lg">
                Заполнение списка оборудования из Excel
              </h3>
              <p className="text-xs text-emerald-200">
                Автоматическая валидация обязательных столбцов и типов данных
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-emerald-200 hover:text-white hover:bg-emerald-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5">
          {/* Scenario & Options */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Импорт для конкретного типа (с доп. полями) или общий:
                </label>
                <select
                  value={selectedTypeId}
                  onChange={(e) => setSelectedTypeId(e.target.value === '' ? '' : Number(e.target.value))}
                  className="text-xs p-2 border border-slate-300 rounded-lg outline-none bg-white min-w-[240px]"
                >
                  <option value="">Все типы оборудования (общий импорт)</option>
                  {(Array.isArray(types) ? types : []).map((t) => (
                    <option key={t.id} value={t.id}>
                      Только «{t.name}» (с проверкой доп. характеристик)
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="px-3 py-2 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-xl inline-flex items-center gap-1.5 shadow-2xs transition-colors shrink-0"
              >
                <Download className="w-4 h-4 text-emerald-600" />
                Скачать шаблон (.xlsx)
              </button>
            </div>
          </div>

          {/* Upload Area */}
          <div className="border-2 border-dashed border-slate-300 rounded-2xl p-6 text-center hover:border-emerald-500 transition-colors bg-white">
            <Upload className="w-10 h-10 text-slate-400 mx-auto mb-2" />
            <div className="text-xs font-medium text-slate-700 mb-1">
              Выберите или перетащите файл Excel (.xlsx, .xls)
            </div>
            <p className="text-[11px] text-slate-400 mb-3">
              Первая строка файла должна содержать заголовки полей таблицы
            </p>
            <label className="inline-block px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold cursor-pointer shadow-xs transition-colors">
              Выбрать файл
              <input
                type="file"
                accept=".xlsx, .xls"
                onChange={handleFileChange}
                className="hidden"
              />
            </label>
            {fileName && (
              <div className="mt-3 text-xs font-semibold text-emerald-700">
                Загружен файл: {fileName} ({parsedRows.length} записей)
              </div>
            )}
          </div>

          {/* Feedback */}
          {errors.length > 0 && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl space-y-1 max-h-48 overflow-y-auto">
              <div className="flex items-center gap-1.5 text-xs font-bold text-red-800 mb-1">
                <AlertCircle className="w-4 h-4 shrink-0" />
                Обнаружены ошибки валидации Excel ({errors.length}):
              </div>
              {errors.map((err, i) => (
                <div key={i} className="text-[11px] text-red-700 leading-tight">
                  • {err}
                </div>
              ))}
            </div>
          )}

          {successMsg && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-semibold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Preview snippet */}
          {parsedRows.length > 0 && (
            <div>
              <h4 className="text-xs font-bold text-slate-700 mb-2">
                Предпросмотр данных ({parsedRows.length} строк):
              </h4>
              <div className="max-h-40 overflow-auto border border-slate-200 rounded-xl text-[11px]">
                <table className="w-full text-left">
                  <thead className="bg-slate-100 border-b border-slate-200 text-slate-600 sticky top-0">
                    <tr>
                      {Object.keys(parsedRows[0] || {}).map((k) => (
                        <th key={k} className="p-2 font-mono">
                          {k}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {parsedRows.slice(0, 5).map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        {Object.keys(parsedRows[0] || {}).map((k) => (
                          <td key={k} className="p-2 truncate max-w-xs">
                            {String(row[k])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="border-t border-slate-200 pt-4 flex justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={handleUpload}
              disabled={loading || parsedRows.length === 0}
              className="px-5 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white rounded-xl shadow-xs transition-colors"
            >
              {loading ? 'Проверка и импорт...' : 'Импортировать в базу данных'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
