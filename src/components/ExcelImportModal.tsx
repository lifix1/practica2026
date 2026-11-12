import React, { useState } from 'react';
import {
  X,
  Upload,
  FileSpreadsheet,
  Download,
  AlertCircle,
  CheckCircle2,
  Info,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import type { EquipmentType } from '../types/index.ts';
import { apiFetch } from '../utils/api.ts';

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
  const [importResult, setImportResult] = useState<{
    message: string;
    createdRooms?: string[];
    createdTypes?: string[];
  } | null>(null);

  if (!isOpen) return null;

  const previewKeys = Object.keys(parsedRows[0] || {});

  // Download full department template (columns A-R) or type-specific template
  const handleDownloadTemplate = async () => {
    try {
      if (!selectedTypeId) {
        const res = await apiFetch('/api/equipment/excel-template');
        if (!res.ok) throw new Error('Не удалось скачать шаблон с сервера');
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'shablon-ucheta-kafedry.xlsx';
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        return;
      }

      const selectedType = types.find((t) => t.id === selectedTypeId);
      const headers = [
        'Инвентарный номер',
        'Наименование',
        'Дата принятия к учету',
        'Первоначальная стоимость',
        'Остаточная стоимость',
        'Помещение',
        'Место',
        'Размеры (Д*Ш*В), см',
        'Описание',
        'Цвет',
        'Статус',
        'Состояние',
        'Категория (по бухучету)',
        'Содержание драгметаллов',
        'Оборудование на гарантии',
        'Гарантия истекает',
        'Примечание',
      ];

      let extraFields: any[] = [];
      try {
        const res = await apiFetch(`/api/equipment-types/${selectedTypeId}/fields`);
        const fields = await res.json();
        if (Array.isArray(fields)) {
          extraFields = fields.filter(
            (f) => f.code !== 'dimensions' && f.code !== 'color'
          );
          extraFields.forEach((f) => headers.push(f.code));
        }
      } catch (e) {
        console.error(e);
      }

      const isFurniture = selectedType?.name.toLowerCase().includes('мебель');
      const sampleRow: Record<string, any> = {
        'Инвентарный номер': `INV-2026-${Math.floor(100 + Math.random() * 900)}`,
        'Наименование': isFurniture
          ? 'Шкаф для документов'
          : `Образец (${selectedType?.name || 'оборудование'})`,
        'Дата принятия к учету': '2026-01-15',
        'Первоначальная стоимость': 45000,
        'Остаточная стоимость': 32000,
        'Помещение': '308',
        'Место': 'Стол 1',
        'Размеры (Д*Ш*В), см': isFurniture ? '120*45*200' : '',
        'Описание': '',
        'Цвет': 'серый',
        'Статус': 'Действует',
        'Состояние': 'Рабочее',
        'Категория (по бухучету)': 'Дорогостоящее',
        'Содержание драгметаллов': isFurniture ? 'Нет' : 'Да',
        'Оборудование на гарантии': 'Да',
        'Гарантия истекает': '15.01.2028',
        'Примечание': '',
      };

      extraFields.forEach((f) => {
        sampleRow[f.code] = '';
      });

      const ws = XLSX.utils.json_to_sheet([sampleRow], { header: headers });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Оборудование');
      XLSX.writeFile(wb, `shablon-importa-type-${selectedTypeId}.xlsx`);
    } catch (err: any) {
      setErrors([err.message || 'Ошибка при скачивании шаблона']);
    }
  };

  // Handle file select
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setErrors([]);
    setImportResult(null);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const dataBuffer = evt.target?.result;
        const wb = XLSX.read(dataBuffer, { type: 'array' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws, { defval: '' });
        // Filter out completely blank trailing rows
        const nonEmptyRows = (data as any[]).filter((row) =>
          Object.values(row).some((val) => val !== undefined && val !== null && String(val).trim() !== '')
        );
        setParsedRows(nonEmptyRows);
      } catch (err: any) {
        setErrors(['Не удалось прочитать Excel файл: ' + err.message]);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // Submit to server
  const handleUpload = async () => {
    if (parsedRows.length === 0) {
      setErrors(['Файл не содержит строк данных']);
      return;
    }

    setLoading(true);
    setErrors([]);
    setImportResult(null);

    try {
      const res = await apiFetch('/api/equipment/import-excel', {
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

      setImportResult({
        message: resData.message || 'Импорт успешно завершен!',
        createdRooms: resData.createdRooms,
        createdTypes: resData.createdTypes,
      });
      onSuccess();
      setTimeout(() => {
        onClose();
      }, 1800);
    } catch (err: any) {
      setErrors([err.message]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-6 animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-emerald-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-700 rounded-xl">
              <FileSpreadsheet className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-base sm:text-lg">
                Импорт таблицы учета кафедры из Excel
              </h3>
              <p className="text-xs text-emerald-200">
                Поддержка выгрузки бухгалтерии (A–E) и дополнительных столбцов кафедры (F–R)
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
        <div className="p-6 overflow-y-auto space-y-4">
          {/* Scenario & Template Download */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
              <div className="flex-1">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Режим импорта по типу оборудования:
                </label>
                <select
                  value={selectedTypeId}
                  onChange={(e) =>
                    setSelectedTypeId(e.target.value === '' ? '' : Number(e.target.value))
                  }
                  className="w-full text-xs p-2 border border-slate-300 rounded-lg outline-none bg-white"
                >
                  <option value="">
                    Все типы (тип берется из столбца «Тип оборудования» таблицы)
                  </option>
                  {(Array.isArray(types) ? types : []).map((t) => (
                    <option key={t.id} value={t.id}>
                      Только «{t.name}» (принудительно для всех строк)
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="px-3.5 py-2 bg-white border border-emerald-300 hover:bg-emerald-50 text-emerald-800 text-xs font-semibold rounded-xl inline-flex items-center gap-1.5 shadow-2xs transition-colors shrink-0"
              >
                <Download className="w-4 h-4 text-emerald-600" />
                <span>
                  {selectedTypeId
                    ? 'Скачать шаблон типа (.xlsx)'
                    : 'Скачать шаблон таблицы кафедры (.xlsx)'}
                </span>
              </button>
            </div>

            {/* Columns legend */}
            <div className="p-3 bg-white border border-slate-200 rounded-xl text-[11px] text-slate-600 space-y-1.5">
              <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                <Info className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                <span>Распознаваемые столбцы таблицы Excel (русские и английские заголовки):</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                <div>
                  <span className="font-semibold text-slate-700">Бухучёт (A–E):</span>{' '}
                  Инвентарный номер, Наименование, Дата принятия к учету, Первоначальная стоимость, Остаточная стоимость
                </div>
                <div>
                  <span className="font-semibold text-slate-700">Размещение и габариты (F–J):</span>{' '}
                  Помещение (создается автоматически), Место, Размеры (Д*Ш*В), см, Описание, Цвет
                </div>
                <div className="sm:col-span-2">
                  <span className="font-semibold text-slate-700">Классификация и гарантия (K–R):</span>{' '}
                  Тип оборудования, Статус (Действует / На хранении), Состояние, Категория (по бухучету), Содержание драгметаллов (Да/Нет), Оборудование на гарантии, Гарантия истекает (ДД.ММ.ГГГГ — статус обновится на «Нет» автоматически на следующий день после даты), Примечание.
                </div>
              </div>
            </div>
          </div>

          {/* Upload Area */}
          <div className="border-2 border-dashed border-slate-300 rounded-2xl p-6 text-center hover:border-emerald-500 transition-colors bg-white">
            <Upload className="w-10 h-10 text-slate-400 mx-auto mb-2" />
            <div className="text-xs font-medium text-slate-700 mb-1">
              Выберите или перетащите файл Excel (.xlsx, .xls)
            </div>
            <p className="text-[11px] text-slate-400 mb-3">
              Первая строка листа должна содержать названия столбцов (как в шаблоне кафедры)
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
                Загружен файл: {fileName} ({parsedRows.length} непустых строк)
              </div>
            )}
          </div>

          {/* Feedback */}
          {errors.length > 0 && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl space-y-1 max-h-48 overflow-y-auto">
              <div className="flex items-center gap-1.5 text-xs font-bold text-red-800 mb-1">
                <AlertCircle className="w-4 h-4 shrink-0" />
                Обнаружены ошибки при импорте ({errors.length}):
              </div>
              {errors.map((err, i) => (
                <div key={i} className="text-[11px] text-red-700 leading-tight">
                  • {err}
                </div>
              ))}
            </div>
          )}

          {importResult && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 text-xs space-y-1">
              <div className="font-bold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{importResult.message}</span>
              </div>
              {Array.isArray(importResult.createdRooms) && importResult.createdRooms.length > 0 && (
                <div className="text-[11px] text-emerald-800 pl-6">
                  Автоматически добавлены новые помещения: {importResult.createdRooms.join(', ')}
                </div>
              )}
              {Array.isArray(importResult.createdTypes) && importResult.createdTypes.length > 0 && (
                <div className="text-[11px] text-emerald-800 pl-6">
                  Автоматически добавлены новые типы: {importResult.createdTypes.join(', ')}
                </div>
              )}
            </div>
          )}

          {/* Preview snippet */}
          {parsedRows.length > 0 && (
            <div>
              <h4 className="text-xs font-bold text-slate-700 mb-2">
                Предпросмотр первых строк ({Math.min(5, parsedRows.length)} из {parsedRows.length}):
              </h4>
              <div className="max-h-48 overflow-auto border border-slate-200 rounded-xl text-[11px]">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-100 border-b border-slate-200 text-slate-700 sticky top-0">
                    <tr>
                      {previewKeys.map((k) => (
                        <th key={k} className="p-2 font-semibold whitespace-nowrap">
                          {k}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {parsedRows.slice(0, 5).map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        {previewKeys.map((k) => (
                          <td key={k} className="p-2 truncate max-w-[180px] whitespace-nowrap">
                            {String(row[k] ?? '')}
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
              {loading ? 'Проверка и импорт...' : `Импортировать (${parsedRows.length})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
