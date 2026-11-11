import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, AlertCircle, Save } from 'lucide-react';
import type { Room, EquipmentType, AdditionalField } from '../types/index.ts';

interface EquipmentFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialData?: any | null;
  rooms: Room[];
  types: EquipmentType[];
}

export const EquipmentFormModal: React.FC<EquipmentFormModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialData,
  rooms,
  types,
}) => {
  const [inventoryNumber, setInventoryNumber] = useState('');
  const [name, setName] = useState('');
  const [typeId, setTypeId] = useState<number | ''>('');
  const [roomId, setRoomId] = useState<number | ''>('');
  const [recived, setRecived] = useState(new Date().toISOString().split('T')[0]);
  const [initialCost, setInitialCost] = useState<number | ''>('');
  const [residualCost, setResidualCost] = useState<number | ''>('');
  const [additionalFieldsValues, setAdditionalFieldsValues] = useState<Record<string, any>>({});
  const [dynamicFieldDefs, setDynamicFieldDefs] = useState<AdditionalField[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize or reset form
  useEffect(() => {
    if (initialData) {
      setInventoryNumber(initialData.inventory_number || '');
      setName(initialData.name || '');
      setTypeId(initialData.type_id || '');
      setRoomId(initialData.room_id || '');
      setRecived(
        initialData.recived
          ? new Date(initialData.recived).toISOString().split('T')[0]
          : new Date().toISOString().split('T')[0]
      );
      setInitialCost(initialData.initial_cost ?? '');
      setResidualCost(initialData.residual_cost ?? '');
      setAdditionalFieldsValues(initialData.additional_fields || {});
    } else {
      setInventoryNumber(`INV-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`);
      setName('');
      const safeTypes = Array.isArray(types) ? types : [];
      const safeRooms = Array.isArray(rooms) ? rooms : [];
      setTypeId(safeTypes.length > 0 ? safeTypes[0].id : '');
      setRoomId(safeRooms.length > 0 ? safeRooms[0].id : '');
      setRecived(new Date().toISOString().split('T')[0]);
      setInitialCost('');
      setResidualCost('');
      setAdditionalFieldsValues({});
    }
  }, [initialData, isOpen, types, rooms]);

  // When typeId changes, fetch inherited dynamic fields
  useEffect(() => {
    if (!typeId) {
      setDynamicFieldDefs([]);
      return;
    }
    fetch(`/api/equipment-types/${typeId}/fields`)
      .then((r) => r.json())
      .then((fields: AdditionalField[]) => {
        setDynamicFieldDefs(fields);
      })
      .catch(console.error);
  }, [typeId]);

  if (!isOpen) return null;

  const handleDynamicFieldChange = (code: string, value: any) => {
    setAdditionalFieldsValues((prev) => ({
      ...prev,
      [code]: value,
    }));
  };

  const handleAddMultipleItem = (code: string, currentItems: any[]) => {
    handleDynamicFieldChange(code, [...(currentItems || []), '']);
  };

  const handleUpdateMultipleItem = (code: string, index: number, val: any, currentItems: any[]) => {
    const updated = [...(currentItems || [])];
    updated[index] = val;
    handleDynamicFieldChange(code, updated);
  };

  const handleRemoveMultipleItem = (code: string, index: number, currentItems: any[]) => {
    const updated = [...(currentItems || [])];
    updated.splice(index, 1);
    handleDynamicFieldChange(code, updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inventoryNumber || !name || !typeId || !roomId || !recived) {
      setError('Заполните все обязательные основные поля');
      return;
    }

    setLoading(true);
    setError(null);

    const payload = {
      inventory_number: inventoryNumber.trim(),
      name: name.trim(),
      type_id: Number(typeId),
      room_id: Number(roomId),
      recived: new Date(recived).toISOString(),
      initial_cost: Number(initialCost) || 0,
      residual_cost: Number(residualCost) || 0,
      additional_fields: additionalFieldsValues,
    };

    try {
      const url = initialData
        ? `/api/equipment/${initialData.id}`
        : '/api/equipment';
      const method = initialData ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const resData = await res.json();
      if (!res.ok) {
        if (resData.details && Array.isArray(resData.details)) {
          throw new Error(resData.details.join('\n'));
        }
        throw new Error(resData.error || 'Ошибка сохранения оборудования');
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-6 animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div>
            <h3 className="font-bold text-base sm:text-lg">
              {initialData ? 'Редактирование оборудования' : 'Добавление нового оборудования'}
            </h3>
            <p className="text-xs text-slate-400">
              {initialData ? `Инв. № ${initialData.inventory_number}` : 'Заполните параметры единицы учета кафедры'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-5">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs flex items-start gap-2 whitespace-pre-line">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Basic Fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Инвентарный номер *
              </label>
              <input
                type="text"
                value={inventoryNumber}
                onChange={(e) => setInventoryNumber(e.target.value)}
                placeholder="INV-2026-001"
                className="w-full text-xs p-2.5 border border-slate-300 rounded-xl font-mono focus:ring-2 focus:ring-blue-500 outline-none"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Тип оборудования *
              </label>
              <select
                value={typeId}
                onChange={(e) => setTypeId(Number(e.target.value))}
                className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                required
              >
                <option value="">Выберите тип...</option>
                {(Array.isArray(types) ? types : []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Наименование оборудования *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Например: Рабочая станция HP Z440 или Ноутбук Lenovo"
                className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Кабинет / Аудитория *
              </label>
              <select
                value={roomId}
                onChange={(e) => setRoomId(Number(e.target.value))}
                className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                required
              >
                <option value="">Выберите кабинет...</option>
                {(Array.isArray(rooms) ? rooms : []).map((r) => (
                  <option key={r.id} value={r.id}>
                    Кабинет {r.number} ({r.floor} этаж)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Дата получения на баланс *
              </label>
              <input
                type="date"
                value={recived}
                onChange={(e) => setRecived(e.target.value)}
                className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Первоначальная стоимость (₽)
              </label>
              <input
                type="number"
                value={initialCost}
                onChange={(e) => setInitialCost(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="0"
                className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Остаточная стоимость (₽)
              </label>
              <input
                type="number"
                value={residualCost}
                onChange={(e) => setResidualCost(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="0"
                className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          </div>

          {/* Dynamic Additional Fields Section */}
          {dynamicFieldDefs.length > 0 && (
            <div className="border-t border-slate-200 pt-4 space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Дополнительные характеристики типа (включая унаследованные)
                </h4>
                <span className="text-[11px] text-slate-500">
                  {dynamicFieldDefs.length} полей
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {dynamicFieldDefs.map((field) => {
                  const val = additionalFieldsValues[field.code];

                  return (
                    <div
                      key={field.code}
                      className={`p-3 rounded-xl border ${
                        field.is_required ? 'border-blue-200 bg-blue-50/20' : 'border-slate-200 bg-white'
                      }`}
                    >
                      <label className="block text-xs font-semibold text-slate-800 mb-1">
                        {field.title} {field.is_required && <span className="text-red-500">*</span>}
                        <span className="text-[10px] font-mono text-slate-400 ml-1">
                          ({field.code})
                        </span>
                      </label>

                      {/* Multiple values input */}
                      {field.is_multiple ? (
                        <div className="space-y-2">
                          {((Array.isArray(val) ? val : []) as any[]).map((subVal, idx) => (
                            <div key={idx} className="flex gap-1.5 items-center">
                              <input
                                type={field.data_type === 'INTEGER' || field.data_type === 'NUMBER' ? 'number' : 'text'}
                                value={subVal}
                                onChange={(e) =>
                                  handleUpdateMultipleItem(
                                    field.code,
                                    idx,
                                    field.data_type === 'INTEGER' || field.data_type === 'NUMBER'
                                      ? Number(e.target.value)
                                      : e.target.value,
                                    val
                                  )
                                }
                                className="w-full text-xs p-2 border border-slate-300 rounded-lg outline-none"
                                placeholder={`Элемент #${idx + 1}`}
                              />
                              <button
                                type="button"
                                onClick={() => handleRemoveMultipleItem(field.code, idx, val)}
                                className="p-1.5 text-red-500 hover:bg-red-50 rounded"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() => handleAddMultipleItem(field.code, val)}
                            className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700 font-semibold"
                          >
                            <Plus className="w-3.5 h-3.5" /> Добавить элемент
                          </button>
                        </div>
                      ) : field.data_type === 'ENUM' ? (
                        <select
                          value={val || ''}
                          onChange={(e) => handleDynamicFieldChange(field.code, e.target.value)}
                          className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none"
                          required={field.is_required}
                        >
                          <option value="">Выберите значение...</option>
                          {(field.options || []).map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : field.data_type === 'BOOLEAN' ? (
                        <select
                          value={val === undefined ? '' : String(val)}
                          onChange={(e) =>
                            handleDynamicFieldChange(
                              field.code,
                              e.target.value === 'true' ? true : e.target.value === 'false' ? false : undefined
                            )
                          }
                          className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none"
                          required={field.is_required}
                        >
                          <option value="">Не выбрано</option>
                          <option value="true">Да (True)</option>
                          <option value="false">Нет (False)</option>
                        </select>
                      ) : field.data_type === 'DATE' ? (
                        <input
                          type="date"
                          value={val || ''}
                          onChange={(e) => handleDynamicFieldChange(field.code, e.target.value)}
                          className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none"
                          required={field.is_required}
                        />
                      ) : (
                        <input
                          type={field.data_type === 'INTEGER' || field.data_type === 'NUMBER' ? 'number' : 'text'}
                          value={val !== undefined ? val : ''}
                          onChange={(e) =>
                            handleDynamicFieldChange(
                              field.code,
                              field.data_type === 'INTEGER' || field.data_type === 'NUMBER'
                                ? (e.target.value === '' ? '' : Number(e.target.value))
                                : e.target.value
                            )
                          }
                          placeholder={field.data_type === 'INTEGER' ? 'Целое число' : 'Значение'}
                          className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none"
                          required={field.is_required}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Footer actions */}
          <div className="border-t border-slate-200 pt-4 flex justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-xl shadow-xs transition-colors inline-flex items-center gap-1.5"
            >
              <Save className="w-4 h-4" />
              {loading ? 'Сохранение...' : 'Сохранить оборудование'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
