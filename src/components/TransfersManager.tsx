import React, { useState, useEffect } from 'react';
import {
  Clock,
  Search,
} from 'lucide-react';
import type { User as UserType } from '../types/index.ts';
import { apiFetch } from '../utils/api.ts';

interface TransfersManagerProps {
  currentUser: UserType | null;
  onOpenEquipmentDetail: (id: number) => void;
}

export const TransfersManager: React.FC<TransfersManagerProps> = ({
  onOpenEquipmentDetail,
}) => {
  const [transfers, setTransfers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchBorrower, setSearchBorrower] = useState('');
  const [onlyActive, setOnlyActive] = useState(true);

  const fetchTransfers = async () => {
    setLoading(true);
    try {
      // Query equipment with active transfer or history
      const params = new URLSearchParams();
      if (onlyActive) params.set('active_transfer', 'true');
      if (searchBorrower.trim()) params.set('transferred_to', searchBorrower.trim());
      params.set('limit', '50');

      const res = await apiFetch(`/api/equipment?${params.toString()}`);
      const data = await res.json();
      setTransfers(Array.isArray(data?.items) ? data.items : []);
    } catch (err) {
      console.error(err);
      setTransfers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTransfers();
  }, [searchBorrower, onlyActive]);

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* Header */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-bold text-slate-900">
              Учет оборудования во временном пользовании
            </h2>
          </div>
          <p className="text-xs text-slate-500">
            Контроль выданного сотрудникам оборудования, командировок и плановых сроков возврата.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={onlyActive}
              onChange={(e) => setOnlyActive(e.target.checked)}
              className="rounded text-blue-600"
            />
            <span>Только невозвращенные</span>
          </label>
        </div>
      </div>

      {/* Search box */}
      <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-2 text-xs">
        <Search className="w-4 h-4 text-slate-400 ml-2" />
        <input
          type="text"
          value={searchBorrower}
          onChange={(e) => setSearchBorrower(e.target.value)}
          placeholder="Поиск по ФИО / отделу получателя..."
          className="w-full py-1.5 outline-none"
        />
      </div>

      {/* Items list */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-xs">
            Загрузка списка выданного оборудования...
          </div>
        ) : !Array.isArray(transfers) || transfers.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-xs">
            Оборудование во временном пользовании не найдено
          </div>
        ) : (
          <div className="divide-y divide-slate-100 text-xs">
            {(Array.isArray(transfers) ? transfers : []).map((item) => (
              <div
                key={item.id}
                className="p-4 hover:bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <span className="font-mono font-bold bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded text-[11px] shrink-0 mt-0.5">
                    {item.inventory_number}
                  </span>
                  <div>
                    <button
                      onClick={() => onOpenEquipmentDetail(item.id)}
                      className="font-bold text-slate-900 hover:text-blue-600 text-left text-sm"
                    >
                      {item.name}
                    </button>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {item.typeName} • Базовая аудитория: № {item.roomNumber}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => onOpenEquipmentDetail(item.id)}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors"
                  >
                    Паспорт и возврат
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
