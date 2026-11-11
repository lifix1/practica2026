import React, { useState } from 'react';
import { DoorOpen, Plus, Building, AlertCircle, CheckCircle2 } from 'lucide-react';
import type { Room, User } from '../types/index.ts';

interface RoomsManagerProps {
  currentUser: User | null;
  rooms: Room[];
  onRefreshRooms: () => void;
}

export const RoomsManager: React.FC<RoomsManagerProps> = ({
  currentUser,
  rooms,
  onRefreshRooms,
}) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [number, setNumber] = useState('');
  const [floor, setFloor] = useState<number | ''>(1);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isAdmin = currentUser?.role === 'ADMIN';

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!number.trim() || floor === '') return;

    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          number: number.trim(),
          floor: Number(floor),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка добавления кабинета');

      setSuccess(`Кабинет № ${data.number} успешно добавлен!`);
      setShowAddModal(false);
      setNumber('');
      setFloor(1);
      onRefreshRooms();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* Top Header */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <DoorOpen className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-bold text-slate-900">
              Кабинеты и лаборатории кафедры
            </h2>
          </div>
          <p className="text-xs text-slate-500">
            Справочник помещений для привязки материальных ценностей и инвентаризации.
          </p>
        </div>

        {isAdmin && (
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors inline-flex items-center gap-1.5 shrink-0"
          >
            <Plus className="w-4 h-4" />
            Добавить кабинет
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
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>{success}</span>
        </div>
      )}

      {/* Grid of rooms */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        {(Array.isArray(rooms) ? rooms : []).map((room) => (
          <div
            key={room.id}
            className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs hover:border-blue-300 transition-all flex items-center gap-3.5"
          >
            <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-700 font-bold text-sm shrink-0">
              {room.number}
            </div>
            <div>
              <div className="font-bold text-slate-900 text-sm">
                Аудитория {room.number}
              </div>
              <div className="text-xs text-slate-500">
                Этаж: {room.floor}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Add Room Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-sm w-full p-6 space-y-4">
            <h3 className="font-bold text-base text-slate-900">
              Добавить кабинет кафедры
            </h3>
            <form onSubmit={handleCreateRoom} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Номер кабинета / аудитории *
                </label>
                <input
                  type="text"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  placeholder="Например: 308 или 412-Б"
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Этаж *
                </label>
                <input
                  type="number"
                  value={floor}
                  onChange={(e) => setFloor(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="3"
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none"
                  required
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-xs"
                >
                  Добавить
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
