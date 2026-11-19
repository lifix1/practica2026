import React, { useState } from 'react';
import {
  MapPin,
  Plus,
  AlertCircle,
  CheckCircle2,
  Trash2,
  Pencil,
  X,
  ChevronDown,
  ChevronUp,
  Save,
} from 'lucide-react';
import type { Room, User } from '../types/index.ts';
import { apiFetch } from '../utils/api.ts';

interface RoomsManagerProps {
  currentUser: User | null;
  rooms: Room[];
  onRefreshRooms: () => void;
}

interface ExtraParamRow {
  key: string;
  value: string;
}

export const RoomsManager: React.FC<RoomsManagerProps> = ({
  currentUser,
  rooms,
  onRefreshRooms,
}) => {
  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [roomToDelete, setRoomToDelete] = useState<Room | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [number, setNumber] = useState('');
  const [dimensions, setDimensions] = useState('');
  const [scheme, setScheme] = useState('');
  const [description, setDescription] = useState('');
  const [floor, setFloor] = useState<number | ''>('');
  const [extraParams, setExtraParams] = useState<ExtraParamRow[]>([]);
  const [showExtraSection, setShowExtraSection] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isAdmin = currentUser?.role === 'ADMIN';

  const openCreateModal = () => {
    setEditingRoom(null);
    setModalMode('create');
    setNumber('');
    setDimensions('');
    setScheme('');
    setDescription('');
    setFloor('');
    setExtraParams([]);
    setShowExtraSection(false);
    setModalError(null);
    setError(null);
    setSuccess(null);
  };

  const openEditModal = (room: Room) => {
    const d = room.details && typeof room.details === 'object' ? room.details : {};
    const knownKeys = new Set(['dimensions', 'scheme', 'description', 'notes']);
    const customRows: ExtraParamRow[] = [];
    for (const [k, v] of Object.entries(d)) {
      if (!knownKeys.has(k) && v !== undefined && v !== null && String(v).trim() !== '') {
        customRows.push({ key: k, value: String(v) });
      }
    }
    if (d.notes && String(d.notes).trim()) {
      customRows.unshift({ key: 'Примечания', value: String(d.notes) });
    }

    setEditingRoom(room);
    setModalMode('edit');
    setNumber(room.number || '');
    setDimensions(d.dimensions ? String(d.dimensions) : '');
    setScheme(d.scheme ? String(d.scheme) : '');
    setDescription(d.description ? String(d.description) : '');
    setFloor(room.floor !== null && room.floor !== undefined ? room.floor : '');
    setExtraParams(customRows);
    setShowExtraSection(
      Boolean(
        d.dimensions ||
          d.scheme ||
          d.description ||
          customRows.length > 0 ||
          (room.floor !== null && room.floor !== undefined)
      )
    );
    setModalError(null);
    setError(null);
    setSuccess(null);
  };

  const closeFormModal = () => {
    setModalMode(null);
    setEditingRoom(null);
    setModalError(null);
  };

  const handleSaveRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!number.trim()) {
      setModalError('Укажите название локации.');
      return;
    }

    const detailsPayload: Record<string, any> = {};
    if (dimensions.trim()) detailsPayload.dimensions = dimensions.trim();
    if (scheme.trim()) detailsPayload.scheme = scheme.trim();
    if (description.trim()) detailsPayload.description = description.trim();
    for (const row of extraParams) {
      const k = row.key.trim();
      const v = row.value.trim();
      if (k && v) {
        detailsPayload[k] = v;
      }
    }

    setSaving(true);
    setModalError(null);
    try {
      const isEdit = modalMode === 'edit' && editingRoom;
      const url = isEdit ? `/api/rooms/${editingRoom.id}` : '/api/rooms';
      const method = isEdit ? 'PUT' : 'POST';

      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          number: number.trim(),
          floor: floor === '' ? null : Number(floor),
          details: detailsPayload,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          data.error || (isEdit ? 'Ошибка обновления локации' : 'Ошибка добавления локации')
        );
      }

      setError(null);
      setSuccess(
        isEdit
          ? `Локация «${data.number}» успешно обновлена!`
          : `Локация «${data.number}» успешно добавлена!`
      );
      closeFormModal();
      onRefreshRooms();
    } catch (err: any) {
      setModalError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDeleteRoom = async () => {
    if (!roomToDelete) return;
    setDeleting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await apiFetch(`/api/rooms/${roomToDelete.id}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Ошибка удаления локации');
      }
      setSuccess(`Локация «${roomToDelete.number}» успешно удалена!`);
      setRoomToDelete(null);
      onRefreshRooms();
    } catch (err: any) {
      setError(err.message);
      setRoomToDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  const handleAddParamRow = () => {
    setExtraParams((prev) => [...prev, { key: '', value: '' }]);
  };

  const handleUpdateParamRow = (idx: number, field: 'key' | 'value', val: string) => {
    setExtraParams((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, [field]: val } : row))
    );
  };

  const handleRemoveParamRow = (idx: number) => {
    setExtraParams((prev) => prev.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* Top Header */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <MapPin className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-bold text-slate-900">Локации</h2>
          </div>
          <p className="text-xs text-slate-500">
            Справочник локаций для привязки оборудования, фильтрации и инвентаризации.
          </p>
        </div>

        {isAdmin && (
          <button
            onClick={openCreateModal}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors inline-flex items-center gap-1.5 shrink-0"
          >
            <Plus className="w-4 h-4" />
            Добавить локацию
          </button>
        )}
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {/* Grid of locations */}
      {!Array.isArray(rooms) || rooms.length === 0 ? (
        <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mx-auto">
            <MapPin className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-slate-800">Список локаций пуст</h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Добавьте локации вручную, прямо при создании единицы оборудования или загрузите таблицу из Excel.
            </p>
          </div>
          {isAdmin && (
            <button
              onClick={openCreateModal}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs inline-flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              Добавить первую локацию
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {rooms.map((room) => {
            const d = room.details && typeof room.details === 'object' ? room.details : {};
            const subtitle = d.dimensions || d.description || '';
            return (
              <div
                key={room.id}
                className="group bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-xs hover:border-blue-300 transition-all flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-700 shrink-0">
                    <MapPin className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <div
                      className="font-bold text-slate-900 text-sm truncate"
                      title={room.number}
                    >
                      {room.number}
                    </div>
                    {subtitle && (
                      <div
                        className="text-[11px] text-slate-500 truncate mt-0.5"
                        title={String(subtitle)}
                      >
                        {String(subtitle)}
                      </div>
                    )}
                  </div>
                </div>

                {isAdmin && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEditModal(room)}
                      title={`Редактировать локацию «${room.number}»`}
                      aria-label={`Редактировать локацию «${room.number}»`}
                      className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-colors cursor-pointer"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setSuccess(null);
                        setRoomToDelete(room);
                      }}
                      title={`Удалить локацию «${room.number}»`}
                      aria-label={`Удалить локацию «${room.number}»`}
                      className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Location Modal */}
      {modalMode && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-base text-slate-900">
                  {modalMode === 'edit' ? 'Редактирование локации' : 'Добавить локацию'}
                </h3>
                <p className="text-xs text-slate-500">
                  {modalMode === 'edit'
                    ? 'Измените название или дополнительные параметры локации'
                    : 'Укажите название локации (например: 302 или Планетарий)'}
                </p>
              </div>
              <button
                type="button"
                onClick={closeFormModal}
                disabled={saving}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {modalError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleSaveRoom} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Название локации *
                </label>
                <input
                  type="text"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  placeholder="Например: 302 или Планетарий"
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              {/* Collapsible / Extensible Parameters Section */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowExtraSection((prev) => !prev)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 hover:bg-slate-100 flex items-center justify-between text-xs font-semibold text-slate-700 transition-colors"
                >
                  <span>Дополнительные параметры (размеры, схема, этаж и др.)</span>
                  {showExtraSection ? (
                    <ChevronUp className="w-4 h-4 text-slate-500" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-500" />
                  )}
                </button>

                {showExtraSection && (
                  <div className="p-3.5 space-y-3 bg-white border-t border-slate-200">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                          Размеры / площадь
                        </label>
                        <input
                          type="text"
                          value={dimensions}
                          onChange={(e) => setDimensions(e.target.value)}
                          placeholder="Напр.: 6×9 м, 54 м²"
                          className="w-full text-xs p-2 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                          Этаж (опционально)
                        </label>
                        <input
                          type="number"
                          value={floor}
                          onChange={(e) =>
                            setFloor(e.target.value === '' ? '' : Number(e.target.value))
                          }
                          placeholder="Не указан"
                          className="w-full text-xs p-2 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Описание / назначение
                      </label>
                      <input
                        type="text"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Напр.: Лаборатория компьютерного моделирования"
                        className="w-full text-xs p-2 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Схема локации / планировка (ссылка или описание)
                      </label>
                      <textarea
                        rows={2}
                        value={scheme}
                        onChange={(e) => setScheme(e.target.value)}
                        placeholder="Описание схемы размещения рабочих мест, стеллажей, URL плана..."
                        className="w-full text-xs p-2 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                      />
                    </div>

                    {/* Extensible custom parameters */}
                    <div className="space-y-2 pt-1 border-t border-slate-100">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-slate-600">
                          Другие параметры
                        </span>
                        <button
                          type="button"
                          onClick={handleAddParamRow}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Добавить параметр
                        </button>
                      </div>

                      {extraParams.map((row, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={row.key}
                            onChange={(e) => handleUpdateParamRow(idx, 'key', e.target.value)}
                            placeholder="Параметр"
                            className="w-2/5 text-xs p-2 border border-slate-300 rounded-lg outline-none"
                          />
                          <input
                            type="text"
                            value={row.value}
                            onChange={(e) => handleUpdateParamRow(idx, 'value', e.target.value)}
                            placeholder="Значение"
                            className="flex-1 text-xs p-2 border border-slate-300 rounded-lg outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => handleRemoveParamRow(idx)}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                            title="Удалить параметр"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeFormModal}
                  disabled={saving}
                  className="px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-xl shadow-xs inline-flex items-center gap-1.5"
                >
                  <Save className="w-3.5 h-3.5" />
                  {saving
                    ? 'Сохранение...'
                    : modalMode === 'edit'
                    ? 'Сохранить изменения'
                    : 'Добавить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Location Confirmation Modal */}
      {roomToDelete && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-sm w-full p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-red-50 border border-red-200 flex items-center justify-center text-red-600 shrink-0">
                  <Trash2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">Удалить локацию?</h3>
                  <p className="text-xs text-slate-500">{roomToDelete.number}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRoomToDelete(null)}
                disabled={deleting}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Локация будет удалена из справочника. Если за ней закреплено оборудование, система предупредит об этом и отменит удаление.
            </p>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setRoomToDelete(null)}
                disabled={deleting}
                className="px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteRoom}
                disabled={deleting}
                className="px-4 py-2 text-xs font-bold bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white rounded-xl shadow-xs inline-flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {deleting ? 'Удаление...' : 'Удалить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
