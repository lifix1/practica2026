import React, { useState, useEffect, useRef } from 'react';
import { X, Plus, Trash2, AlertCircle, Save, ShieldCheck, ShieldAlert } from 'lucide-react';
import type { Room, EquipmentType, AdditionalField } from '../types/index.ts';
import { apiFetch } from '../utils/api.ts';
import { flattenTypeTree } from '../utils/typeTree.ts';

interface EquipmentFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialData?: any | null;
  rooms: Room[];
  types: EquipmentType[];
}

function toInputDate(value: any): string {
  if (!value) return new Date().toISOString().split('T')[0];
  const str = String(value).trim();
  const isoPrefix = str.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoPrefix) return isoPrefix[1];
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }
  return new Date().toISOString().split('T')[0];
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
  const [errors, setErrors] = useState<string[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const previousDynamicCodesRef = useRef<string[]>([]);

  const showErrors = (list: string[]) => {
    setErrors(list);
    requestAnimationFrame(() => {
      formRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    });
  };

  // Initialize or reset form
  useEffect(() => {
    if (!isOpen) return;
    previousDynamicCodesRef.current = [];
    if (initialData) {
      setInventoryNumber(initialData.inventory_number || '');
      setName(initialData.name || '');
      setTypeId(initialData.type_id || '');
      setRoomId(initialData.room_id || '');
      setRecived(toInputDate(initialData.recived));
      setInitialCost(initialData.initial_cost ?? '');
      setResidualCost(initialData.residual_cost ?? '');
      setAdditionalFieldsValues({
        status: 'Действует',
        condition: 'Рабочее',
        accounting_category: '',
        precious_metals: '',
        ...(initialData.additional_fields || {}),
      });
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
      setAdditionalFieldsValues({
        status: 'Действует',
        condition: 'Рабочее',
        accounting_category: '',
        precious_metals: '',
      });
    }
    setErrors([]);
  }, [initialData, isOpen, types, rooms]);

  // When typeId changes, fetch inherited dynamic fields and strip stale type-specific keys
  useEffect(() => {
    if (!isOpen) return;
    if (!typeId) {
      setDynamicFieldDefs([]);
      return;
    }
    let cancelled = false;
    apiFetch(`/api/equipment-types/${typeId}/fields`)
      .then((r) => r.json())
      .then((fields: AdditionalField[]) => {
        if (cancelled) return;
        const safeFields = Array.isArray(fields) ? fields : [];
        const newCodes = new Set(safeFields.map((f) => f.code));
        const prevCodes = previousDynamicCodesRef.current;

        // Remove fields that belonged strictly to the previously selected type
        // (never remove universal department fields like dimensions/color)
        const universalCodes = new Set(['dimensions', 'color']);
        const staleCodes = prevCodes.filter(
          (code) => !newCodes.has(code) && !universalCodes.has(code)
        );
        if (staleCodes.length > 0) {
          setAdditionalFieldsValues((prev) => {
            const next = { ...prev };
            for (const code of staleCodes) {
              delete next[code];
            }
            return next;
          });
        }

        previousDynamicCodesRef.current = safeFields.map((f) => f.code);
        setDynamicFieldDefs(safeFields);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [typeId, isOpen]);

  if (!isOpen) return null;

  const selectedTypeName =
    (Array.isArray(types) ? types : []).find((t) => t.id === Number(typeId))?.name || '';

  const handleDynamicFieldChange = (code: string, value: any) => {
    setAdditionalFieldsValues((prev) => ({
      ...prev,
      [code]: value,
    }));
  };

  // Derive warranty status strictly from warranty_until date:
  // no date -> not under warranty; date < today -> expired (not under warranty); date >= today -> under warranty
  const warrantyUntilVal = additionalFieldsValues.warranty_until
    ? toInputDate(additionalFieldsValues.warranty_until)
    : '';
  let computedWarrantyActive = false;
  let warrantyExpiredByDate = false;
  if (warrantyUntilVal) {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const trimmed = String(warrantyUntilVal).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      computedWarrantyActive = trimmed >= todayStr;
      warrantyExpiredByDate = !computedWarrantyActive;
    }
  }

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

    const validationErrors: string[] = [];
    if (!inventoryNumber.trim()) {
      validationErrors.push('Укажите инвентарный номер оборудования.');
    }
    if (!name.trim()) {
      validationErrors.push('Укажите наименование оборудования.');
    }
    if (!typeId) {
      validationErrors.push('Выберите тип оборудования из списка.');
    }
    if (!roomId) {
      validationErrors.push('Выберите помещение (аудиторию).');
    }
    if (!recived || isNaN(new Date(recived).getTime())) {
      validationErrors.push('Укажите корректную дату принятия к учёту.');
    }
    if (initialCost !== '' && (isNaN(Number(initialCost)) || Number(initialCost) < 0)) {
      validationErrors.push('Первоначальная стоимость не может быть отрицательной.');
    }
    if (residualCost !== '' && (isNaN(Number(residualCost)) || Number(residualCost) < 0)) {
      validationErrors.push('Остаточная стоимость не может быть отрицательной.');
    }

    const qty = Number(additionalFieldsValues.quantity ?? 1);
    if (!Number.isInteger(qty) || qty < 1) {
      validationErrors.push('Поле «Количество (шт.)» должно быть целым числом не меньше 1.');
    }
    if (!additionalFieldsValues.accounting_category) {
      validationErrors.push('Выберите обязательное поле «Категория (по бухучету)».');
    }
    if (typeof additionalFieldsValues.precious_metals !== 'boolean') {
      validationErrors.push('Укажите обязательное поле «Содержание драгметаллов» (Да или Нет).');
    }

    if (additionalFieldsValues.dimensions && String(additionalFieldsValues.dimensions).trim()) {
      const dimParts = String(additionalFieldsValues.dimensions)
        .trim()
        .split(/[*xхXХ×/\s]+/)
        .map((s) => parseFloat(s.replace(',', '.')))
        .filter((n) => !isNaN(n) && n > 0);
      if (dimParts.length === 0) {
        validationErrors.push(
          'В поле «Размеры (Д*Ш*В), см» укажите числовые габариты через «*» (например: 120*60*75).'
        );
      }
    }

    // Validate required type-specific fields client-side for immediate feedback
    for (const field of dynamicFieldDefs) {
      if (!field.is_required) continue;
      const val = additionalFieldsValues[field.code];
      const isEmpty =
        val === undefined ||
        val === null ||
        val === '' ||
        (Array.isArray(val) && val.length === 0);
      if (isEmpty) {
        validationErrors.push(`Заполните обязательное поле «${field.title}».`);
      }
    }

    if (validationErrors.length > 0) {
      showErrors(validationErrors);
      return;
    }

    setLoading(true);
    setErrors([]);

    const cleanedFields: Record<string, any> = {
      ...additionalFieldsValues,
      quantity: qty,
      warranty_until: warrantyUntilVal ? String(warrantyUntilVal).trim() : null,
    };
    delete cleanedFields.is_under_warranty;
    delete cleanedFields.warranty_expired;
    delete cleanedFields.warranty_status_ru;

    const payloadFields = cleanedFields;

    const payload = {
      inventory_number: inventoryNumber.trim(),
      name: name.trim(),
      type_id: Number(typeId),
      room_id: Number(roomId),
      recived: new Date(recived).toISOString(),
      initial_cost: initialCost === '' ? 0 : Number(initialCost),
      residual_cost: residualCost === '' ? 0 : Number(residualCost),
      additional_fields: payloadFields,
    };

    try {
      const url = initialData
        ? `/api/equipment/${initialData.id}`
        : '/api/equipment';
      const method = initialData ? 'PUT' : 'POST';

      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      let resData: any = {};
      try {
        resData = await res.json();
      } catch {
        resData = {};
      }

      if (!res.ok) {
        if (res.status === 401) {
          throw new Error('Сессия работы истекла. Пожалуйста, войдите в систему заново.');
        }
        if (res.status === 403) {
          throw new Error('Недостаточно прав: добавлять и редактировать оборудование может только Администратор.');
        }
        if (resData.details && Array.isArray(resData.details) && resData.details.length > 0) {
          showErrors(resData.details);
          return;
        }
        throw new Error(resData.error || 'Не удалось сохранить оборудование. Проверьте введённые данные.');
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (msg === 'Failed to fetch' || msg.includes('NetworkError')) {
        showErrors(['Нет связи с сервером. Проверьте подключение к сети и повторите попытку.']);
      } else {
        showErrors([msg || 'Произошла непредвиденная ошибка при сохранении.']);
      }
    } finally {
      setLoading(false);
    }
  };

  const extraCustomFieldDefs = dynamicFieldDefs.filter(
    (f) => f.code !== 'dimensions' && f.code !== 'color'
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-6 animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl overflow-hidden flex flex-col max-h-[92vh]">
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
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form ref={formRef} onSubmit={handleSubmit} noValidate className="p-6 overflow-y-auto space-y-5">
          {errors.length > 0 && (
            <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
              <div className="space-y-1">
                <div className="font-semibold text-red-900">
                  Не удалось сохранить оборудование:
                </div>
                {errors.length === 1 ? (
                  <p className="text-red-700">{errors[0]}</p>
                ) : (
                  <ul className="list-disc pl-4 space-y-0.5 text-red-700">
                    {errors.map((errText, idx) => (
                      <li key={idx}>{errText}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* Basic Accounting Fields (A-E + F) */}
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
              {Array.isArray(types) && types.length === 0 ? (
                <div className="p-2.5 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 text-[11px] font-medium">
                  Справочник типов пуст — сначала создайте тип во вкладке «Типы и поля».
                </div>
              ) : (
                <select
                  value={typeId}
                  onChange={(e) => setTypeId(Number(e.target.value))}
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                  required
                >
                  <option value="">Выберите тип...</option>
                  {flattenTypeTree(types).map(({ type: t, label }) => (
                    <option key={t.id} value={t.id}>
                      {label}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Наименование оборудования *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Например: Центральный стол на 12 мест или Лазерный принтер HP LJ 1020"
                className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Помещение / Аудитория *
              </label>
              {Array.isArray(rooms) && rooms.length === 0 ? (
                <div className="p-2.5 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 text-[11px] font-medium">
                  Справочник помещений пуст — сначала добавьте аудиторию во вкладке «Кабинеты».
                </div>
              ) : (
                <select
                  value={roomId}
                  onChange={(e) => setRoomId(Number(e.target.value))}
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                  required
                >
                  <option value="">Выберите кабинет...</option>
                  {(Array.isArray(rooms) ? rooms : []).map((r) => (
                    <option key={r.id} value={r.id}>
                      Ауд. {r.number} ({r.floor} этаж)
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Дата принятия к учету *
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
                Первоначальная стоимость (бел. руб., BYN)
              </label>
              <input
                type="number"
                step="0.01"
                value={initialCost}
                onChange={(e) => setInitialCost(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="0.00"
                className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Остаточная стоимость (бел. руб., BYN)
              </label>
              <input
                type="number"
                step="0.01"
                value={residualCost}
                onChange={(e) => setResidualCost(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="0.00"
                className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          </div>

          {/* Department Manual Fields (Columns G-R) */}
          <div className="border-t border-slate-200 pt-4 space-y-4">
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Характеристики учета кафедры
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Место в помещении
                </label>
                <input
                  type="text"
                  value={additionalFieldsValues.location_place || ''}
                  onChange={(e) => handleDynamicFieldChange('location_place', e.target.value)}
                  placeholder="Напр.: Стол секретаря, Стол 7, Шкаф 3"
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Цвет
                </label>
                <input
                  type="text"
                  value={additionalFieldsValues.color || ''}
                  onChange={(e) => handleDynamicFieldChange('color', e.target.value)}
                  placeholder="серый, черный, белый..."
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Размеры (Д*Ш*В), см
                </label>
                <input
                  type="text"
                  value={additionalFieldsValues.dimensions || ''}
                  onChange={(e) => handleDynamicFieldChange('dimensions', e.target.value)}
                  placeholder="Например: 120*60*75"
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl font-mono bg-white outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Формат: Длина*Ширина*Высота в см — применяется к любым записям и доступен в фильтре.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Статус
                </label>
                <select
                  value={additionalFieldsValues.status || 'Действует'}
                  onChange={(e) => handleDynamicFieldChange('status', e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none bg-white"
                >
                  <option value="Действует">Действует</option>
                  <option value="На хранении">На хранении</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Состояние
                </label>
                <select
                  value={additionalFieldsValues.condition || 'Рабочее'}
                  onChange={(e) => handleDynamicFieldChange('condition', e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none bg-white"
                >
                  <option value="Рабочее">Рабочее</option>
                  <option value="Есть нюансы">Есть нюансы</option>
                  <option value="Вышло из строя (ремонт возможен)">Вышло из строя (ремонт возможен)</option>
                  <option value="Неремонтопригодно">Неремонтопригодно</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Категория (по бухучету) *
                </label>
                <select
                  value={additionalFieldsValues.accounting_category || ''}
                  onChange={(e) => handleDynamicFieldChange('accounting_category', e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none bg-white focus:ring-2 focus:ring-blue-500"
                  required
                >
                  <option value="">Выберите категорию...</option>
                  <option value="Дорогостоящее">Дорогостоящее</option>
                  <option value="Малоценка">Малоценка</option>
                  <option value="Мягкий инвентарь">Мягкий инвентарь</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Содержание драгметаллов *
                </label>
                <select
                  value={
                    additionalFieldsValues.precious_metals === true
                      ? 'true'
                      : additionalFieldsValues.precious_metals === false
                      ? 'false'
                      : ''
                  }
                  onChange={(e) =>
                    handleDynamicFieldChange(
                      'precious_metals',
                      e.target.value === 'true'
                        ? true
                        : e.target.value === 'false'
                        ? false
                        : ''
                    )
                  }
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none bg-white focus:ring-2 focus:ring-blue-500"
                  required
                >
                  <option value="">Выберите значение...</option>
                  <option value="false">Нет</option>
                  <option value="true">Да</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Гарантия истекает (дата)
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    value={warrantyUntilVal}
                    onChange={(e) => handleDynamicFieldChange('warranty_until', e.target.value || null)}
                    className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none"
                  />
                  {warrantyUntilVal && (
                    <button
                      type="button"
                      onClick={() => handleDynamicFieldChange('warranty_until', null)}
                      className="px-2.5 py-2.5 text-xs text-slate-500 hover:text-red-600 hover:bg-red-50 border border-slate-200 rounded-xl transition-colors"
                      title="Очистить дату окончания гарантии"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Статус гарантии (вычисляется по дате)
                </label>
                <div
                  className={`p-2.5 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
                    computedWarrantyActive
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-slate-100 border-slate-200 text-slate-600'
                  }`}
                >
                  {computedWarrantyActive ? (
                    <>
                      <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>Да (действует до {warrantyUntilVal})</span>
                    </>
                  ) : warrantyExpiredByDate ? (
                    <>
                      <ShieldAlert className="w-4 h-4 text-slate-500 shrink-0" />
                      <span>Нет (срок гарантии истёк)</span>
                    </>
                  ) : (
                    <>
                      <ShieldAlert className="w-4 h-4 text-slate-400 shrink-0" />
                      <span>Нет (дата окончания гарантии не задана)</span>
                    </>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Описание
                </label>
                <input
                  type="text"
                  value={additionalFieldsValues.description || ''}
                  onChange={(e) => handleDynamicFieldChange('description', e.target.value)}
                  placeholder="Краткое описание характеристик"
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Примечание
                </label>
                <input
                  type="text"
                  value={additionalFieldsValues.notes || ''}
                  onChange={(e) => handleDynamicFieldChange('notes', e.target.value)}
                  placeholder="Дополнительные заметки"
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Количество (шт.)
                </label>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={additionalFieldsValues.quantity ?? 1}
                  onChange={(e) =>
                    handleDynamicFieldChange(
                      'quantity',
                      e.target.value === '' ? 1 : Math.max(1, parseInt(e.target.value, 10) || 1)
                    )
                  }
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 flex items-center">
                <label className="flex items-start gap-2.5 cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    checked={Boolean(additionalFieldsValues.is_kit_part)}
                    onChange={(e) => handleDynamicFieldChange('is_kit_part', e.target.checked)}
                    className="mt-0.5 rounded text-blue-600"
                  />
                  <div>
                    <span className="font-semibold text-slate-800 block">
                      Часть комплекта («из комплекта»)
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Не указывать отдельную стоимость в накладной ОКУД 0501460.
                    </span>
                  </div>
                </label>
              </div>
            </div>
          </div>

          {/* Dynamic Additional Fields Section (Type-specific e.g. CPU, RAM) */}
          {extraCustomFieldDefs.length > 0 && (
            <div className="border-t border-slate-200 pt-4 space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Дополнительные характеристики (общие и типа «{selectedTypeName}»)
                </h4>
                <span className="text-[11px] text-slate-500">
                  {extraCustomFieldDefs.length} полей
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {extraCustomFieldDefs.map((field) => {
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
                        {field.type_id === null && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-semibold">
                            Общая
                          </span>
                        )}
                        <span className="text-[10px] font-mono text-slate-400 ml-1">
                          ({field.code})
                        </span>
                      </label>

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
                          <option value="true">Да</option>
                          <option value="false">Нет</option>
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
