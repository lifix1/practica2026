import React, { useState, useEffect, useCallback } from 'react';
import {
  ScrollText,
  ShieldCheck,
  ShieldAlert,
  Wrench,
  User as UserIcon,
  Search,
  RefreshCw,
  Trash2,
  Eye,
  X,
  CheckCircle2,
  Lock,
  Filter,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Info,
  FileJson,
  FileSpreadsheet,
  Calendar,
} from 'lucide-react';
import type {
  User,
  AuditCategory,
  AuditSeverity,
  AuditLogItem,
  AuditLogsResponse,
} from '../types/index.ts';
import { apiFetch } from '../utils/api.ts';

interface AuditLogsManagerProps {
  currentUser: User | null;
  onOpenEquipmentDetail: (id: number) => void;
}

const CATEGORY_LABELS: Record<AuditCategory, string> = {
  AUTH: 'Авторизация',
  SECURITY: 'Безопасность',
  ADMIN: 'Администрирование',
  EQUIPMENT: 'Оборудование',
  MAINTENANCE: 'Неисправности и ремонт',
  TRANSFER: 'Передачи и возвраты',
  INVENTORY: 'Инвентаризация',
  WRITEOFF: 'Списание',
  DOCUMENT: 'Документы и QR',
};

const CATEGORY_BADGES: Record<AuditCategory, string> = {
  AUTH: 'bg-slate-100 text-slate-700 border-slate-200',
  SECURITY: 'bg-red-50 text-red-700 border-red-200',
  ADMIN: 'bg-purple-50 text-purple-700 border-purple-200',
  EQUIPMENT: 'bg-blue-50 text-blue-700 border-blue-200',
  MAINTENANCE: 'bg-amber-50 text-amber-800 border-amber-200',
  TRANSFER: 'bg-cyan-50 text-cyan-800 border-cyan-200',
  INVENTORY: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  WRITEOFF: 'bg-orange-50 text-orange-800 border-orange-200',
  DOCUMENT: 'bg-indigo-50 text-indigo-700 border-indigo-200',
};

const SEVERITY_BADGES: Record<
  AuditSeverity,
  { label: string; className: string; icon: React.ComponentType<{ className?: string }> }
> = {
  INFO: {
    label: 'INFO',
    className: 'bg-slate-100 text-slate-700 border-slate-200',
    icon: Info,
  },
  WARNING: {
    label: 'WARNING',
    className: 'bg-amber-50 text-amber-800 border-amber-200',
    icon: AlertTriangle,
  },
  CRITICAL: {
    label: 'CRITICAL',
    className: 'bg-red-50 text-red-700 border-red-200',
    icon: ShieldAlert,
  },
};

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Администратор',
  ENGINEER: 'Инженер',
  USER: 'Пользователь',
  ANONYMOUS: 'Гость',
};

export const AuditLogsManager: React.FC<AuditLogsManagerProps> = ({
  currentUser,
  onOpenEquipmentDetail,
}) => {
  const [data, setData] = useState<AuditLogsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [category, setCategory] = useState<string>('');
  const [severity, setSeverity] = useState<string>('');
  const [actorId, setActorId] = useState<string>('');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');

  // Inspector & Purge state
  const [selectedLog, setSelectedLog] = useState<AuditLogItem | null>(null);
  const [showPurgeModal, setShowPurgeModal] = useState(false);
  const [purgeDays, setPurgeDays] = useState<number>(90);
  const [purgeLoading, setPurgeLoading] = useState(false);
  const [purgeError, setPurgeError] = useState<string | null>(null);
  const [actionBanner, setActionBanner] = useState<string | null>(null);
  const [exportingFormat, setExportingFormat] = useState<'xlsx' | 'json' | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Reset role-dependent filters if currentUser switches
  useEffect(() => {
    setCategory('');
    setSeverity('');
    setActorId('');
    setPage(1);
    setSelectedLog(null);
    setActionBanner(null);
  }, [currentUser?.id, currentUser?.role]);

  const fetchLogs = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '20');
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (category) params.set('category', category);
      if (severity) params.set('severity', severity);
      if (actorId) params.set('actor_id', actorId);
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);

      const res = await apiFetch(`/api/audit-logs?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Не удалось загрузить журнал событий');
      }
      setData(json);
    } catch (err: any) {
      setError(err?.message || 'Ошибка при загрузке журнала событий');
    } finally {
      setLoading(false);
    }
  }, [currentUser, page, debouncedSearch, category, severity, actorId, dateFrom, dateTo]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleResetFilters = () => {
    setSearch('');
    setDebouncedSearch('');
    setCategory('');
    setSeverity('');
    setActorId('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  };

  const handleExport = async (format: 'xlsx' | 'json') => {
    if (!data?.capabilities.canExport) return;
    setExportingFormat(format);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('format', format);
      if (category) params.set('category', category);
      if (severity) params.set('severity', severity);

      const res = await apiFetch(`/api/audit-logs/export?${params.toString()}`);
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Ошибка экспорта журнала');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setActionBanner(
        `Журнал выгружен в формате ${format.toUpperCase()} согласно правам вашей роли.`
      );
      await fetchLogs();
    } catch (err: any) {
      setError(err?.message || 'Не удалось выполнить экспорт');
    } finally {
      setExportingFormat(null);
    }
  };

  const handleConfirmPurge = async () => {
    setPurgeLoading(true);
    setPurgeError(null);
    try {
      const res = await apiFetch(`/api/audit-logs/purge?older_than_days=${purgeDays}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ older_than_days: purgeDays }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Не удалось очистить журнал');
      }
      setShowPurgeModal(false);
      setActionBanner(json.message || 'Ротация журнала выполнена успешно.');
      setPage(1);
      await fetchLogs();
    } catch (err: any) {
      setPurgeError(err?.message || 'Ошибка при очистке журнала');
    } finally {
      setPurgeLoading(false);
    }
  };

  if (!currentUser) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center shadow-xs">
        <Lock className="w-10 h-10 text-slate-400 mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-slate-900">
          Требуется авторизация
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Войдите в систему, чтобы просматривать журнал событий согласно вашей роли.
        </p>
      </div>
    );
  }

  const capabilities = data?.capabilities;

  const RoleIcon =
    currentUser.role === 'ADMIN'
      ? ShieldCheck
      : currentUser.role === 'ENGINEER'
      ? Wrench
      : UserIcon;

  const permissionItems = capabilities
    ? [
        { label: 'События всех пользователей', allowed: capabilities.canViewAllUsers },
        { label: 'Безопасность и неудачные входы', allowed: capabilities.canViewSecurityEvents },
        { label: 'IP-адреса и User-Agent', allowed: capabilities.canViewTechnicalMeta },
        { label: 'Экспорт XLSX / JSON', allowed: capabilities.canExport },
        { label: 'Ротация и очистка архива', allowed: capabilities.canPurge },
      ]
    : [];

  return (
    <div className="space-y-5">
      {/* Page Header & Actions */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-slate-900 text-white flex items-center justify-center shadow-xs">
              <ScrollText className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 tracking-tight">
                Журнал событий и аудита
              </h2>
              <p className="text-xs text-slate-500">
                Полноценный аудит действий с ролевым разграничением доступа
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={fetchLogs}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Обновить</span>
          </button>

          {capabilities?.canExport ? (
            <>
              <button
                onClick={() => handleExport('xlsx')}
                disabled={exportingFormat !== null}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-semibold transition-colors disabled:opacity-50"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>
                  {exportingFormat === 'xlsx' ? 'Выгрузка...' : 'Экспорт Excel'}
                </span>
              </button>
              <button
                onClick={() => handleExport('json')}
                disabled={exportingFormat !== null}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 text-xs font-semibold transition-colors disabled:opacity-50"
              >
                <FileJson className="w-3.5 h-3.5" />
                <span>
                  {exportingFormat === 'json' ? 'Выгрузка...' : 'Экспорт JSON'}
                </span>
              </button>
            </>
          ) : (
            capabilities && (
              <div className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-slate-100 text-slate-500 text-xs font-medium">
                <Lock className="w-3.5 h-3.5" />
                <span>Экспорт доступен инженеру и администратору</span>
              </div>
            )
          )}

          {capabilities?.canPurge && (
            <button
              onClick={() => {
                setPurgeError(null);
                setShowPurgeModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Очистка / ротация</span>
            </button>
          )}
        </div>
      </div>

      {/* Role Capabilities Matrix Card */}
      {capabilities && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex items-start gap-3">
              <div
                className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 border ${
                  capabilities.role === 'ADMIN'
                    ? 'bg-red-50 text-red-700 border-red-200'
                    : capabilities.role === 'ENGINEER'
                    ? 'bg-blue-50 text-blue-700 border-blue-200'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                }`}
              >
                <RoleIcon className="w-5 h-5" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-slate-900">
                    {capabilities.scopeTitle}
                  </span>
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
                    Роль: {capabilities.roleLabel}
                  </span>
                </div>
                <p className="text-xs text-slate-600 mt-1 max-w-3xl leading-relaxed">
                  {capabilities.scopeDescription}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-1.5 shrink-0">
              {permissionItems.map((perm) => (
                <div
                  key={perm.label}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border ${
                    perm.allowed
                      ? 'bg-emerald-50/70 text-emerald-800 border-emerald-200'
                      : 'bg-slate-50 text-slate-400 border-slate-200'
                  }`}
                >
                  {perm.allowed ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  ) : (
                    <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  )}
                  <span className="truncate">{perm.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* KPI Strip */}
      {data && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-xs">
            <div className="text-xs text-slate-500 font-medium">Всего в области доступа</div>
            <div className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
              {data.stats.total}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-xs">
            <div className="text-xs text-slate-500 font-medium">Информационные (INFO)</div>
            <div className="text-2xl font-bold text-slate-700 mt-1 tabular-nums">
              {data.stats.info}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-amber-200/80 p-3.5 shadow-xs">
            <div className="text-xs text-amber-700 font-medium">Предупреждения (WARNING)</div>
            <div className="text-2xl font-bold text-amber-700 mt-1 tabular-nums">
              {data.stats.warning}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-red-200/80 p-3.5 shadow-xs">
            <div className="text-xs text-red-700 font-medium">Критические (CRITICAL)</div>
            <div className="text-2xl font-bold text-red-700 mt-1 tabular-nums">
              {data.stats.critical}
            </div>
          </div>
        </div>
      )}

      {/* Banners */}
      {actionBanner && (
        <div className="flex items-center justify-between gap-3 bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-2.5 rounded-xl text-xs font-medium">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{actionBanner}</span>
          </div>
          <button
            onClick={() => setActionBanner(null)}
            className="text-emerald-700 hover:text-emerald-900"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-center justify-between gap-3 bg-red-50 border border-red-200 text-red-700 px-4 py-2.5 rounded-xl text-xs font-medium">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-red-600 hover:text-red-900">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Filters Toolbar */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 uppercase tracking-wider">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <span>Фильтры журнала</span>
          </div>
          {(search || category || severity || actorId || dateFrom || dateTo) && (
            <button
              onClick={handleResetFilters}
              className="text-xs font-medium text-blue-600 hover:text-blue-800"
            >
              Сбросить фильтры
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
          {/* Search */}
          <div className="relative lg:col-span-2">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по описанию, коду, объекту..."
              className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>

          {/* Category (strictly scoped by role capabilities) */}
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          >
            <option value="">Все доступные категории</option>
            {(capabilities?.allowedCategories || []).map((cat) => (
              <option key={cat} value={cat}>
                {CATEGORY_LABELS[cat] || cat}
              </option>
            ))}
          </select>

          {/* Severity */}
          <select
            value={severity}
            onChange={(e) => {
              setSeverity(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          >
            <option value="">Любой уровень</option>
            <option value="INFO">INFO (обычные)</option>
            <option value="WARNING">WARNING (важные)</option>
            <option value="CRITICAL">CRITICAL (критические)</option>
          </select>

          {/* Actor selector (ADMIN ONLY) */}
          {capabilities?.canViewAllUsers && data?.actors ? (
            <select
              value={actorId}
              onChange={(e) => {
                setActorId(e.target.value);
                setPage(1);
              }}
              className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            >
              <option value="">Все пользователи</option>
              {data.actors.map((act) => (
                <option key={String(act.id)} value={String(act.id || '')}>
                  {act.login} ({ROLE_LABELS[act.role] || act.role})
                </option>
              ))}
            </select>
          ) : (
            <div className="flex items-center gap-1.5 px-3 py-2 text-xs border border-slate-200 rounded-lg bg-slate-50 text-slate-500">
              <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  setPage(1);
                }}
                title="Дата с"
                className="bg-transparent w-full text-xs focus:outline-none text-slate-700"
              />
            </div>
          )}

          {/* Date Range */}
          {capabilities?.canViewAllUsers ? (
            <div className="flex items-center gap-1">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  setPage(1);
                }}
                title="Дата с"
                className="w-1/2 px-2 py-2 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
              <input
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  setPage(1);
                }}
                title="Дата по"
                className="w-1/2 px-2 py-2 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-3 py-2 text-xs border border-slate-200 rounded-lg bg-slate-50 text-slate-500">
              <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  setPage(1);
                }}
                title="Дата по"
                className="bg-transparent w-full text-xs focus:outline-none text-slate-700"
              />
            </div>
          )}
        </div>
      </div>

      {/* Events Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 whitespace-nowrap">
                  Дата и время
                </th>
                <th className="px-3 py-3 text-left font-semibold text-slate-600 whitespace-nowrap">
                  Уровень
                </th>
                <th className="px-3 py-3 text-left font-semibold text-slate-600 whitespace-nowrap">
                  Категория
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600">
                  Событие и описание
                </th>
                <th className="px-3 py-3 text-left font-semibold text-slate-600 whitespace-nowrap">
                  Пользователь
                </th>
                <th className="px-3 py-3 text-left font-semibold text-slate-600 whitespace-nowrap">
                  Объект
                </th>
                {capabilities?.canViewTechnicalMeta && (
                  <th className="px-3 py-3 text-left font-semibold text-slate-600 whitespace-nowrap">
                    IP-адрес
                  </th>
                )}
                <th className="px-3 py-3 text-right font-semibold text-slate-600 whitespace-nowrap">
                  Детали
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {loading && (!data || data.items.length === 0) ? (
                <tr>
                  <td
                    colSpan={capabilities?.canViewTechnicalMeta ? 8 : 7}
                    className="px-4 py-10 text-center text-slate-500"
                  >
                    Загрузка журнала событий...
                  </td>
                </tr>
              ) : !data || data.items.length === 0 ? (
                <tr>
                  <td
                    colSpan={capabilities?.canViewTechnicalMeta ? 8 : 7}
                    className="px-4 py-10 text-center text-slate-500"
                  >
                    Записи журнала по заданным фильтрам не найдены.
                  </td>
                </tr>
              ) : (
                data.items.map((log) => {
                  const sevMeta = SEVERITY_BADGES[log.severity] || SEVERITY_BADGES.INFO;
                  const SevIcon = sevMeta.icon;
                  const isEquipmentLink =
                    log.entity_type === 'equipment' &&
                    log.entity_id &&
                    /^\d+$/.test(log.entity_id);

                  return (
                    <tr key={log.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap text-slate-600 tabular-nums">
                        <div className="font-medium text-slate-800">
                          {new Date(log.created_at).toLocaleDateString('ru-RU')}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {new Date(log.created_at).toLocaleTimeString('ru-RU')}
                        </div>
                      </td>

                      <td className="px-3 py-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-semibold ${sevMeta.className}`}
                        >
                          <SevIcon className="w-3 h-3" />
                          <span>{sevMeta.label}</span>
                        </span>
                      </td>

                      <td className="px-3 py-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-medium ${
                            CATEGORY_BADGES[log.category] ||
                            'bg-slate-100 text-slate-700 border-slate-200'
                          }`}
                        >
                          {CATEGORY_LABELS[log.category] || log.category}
                        </span>
                      </td>

                      <td className="px-4 py-3 max-w-md">
                        <div className="font-medium text-slate-900 leading-snug">
                          {log.summary}
                        </div>
                        <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                          {log.action}
                        </div>
                      </td>

                      <td className="px-3 py-3 whitespace-nowrap">
                        <div className="font-medium text-slate-800">
                          {log.actor_login || 'Система'}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {log.actor_role
                            ? ROLE_LABELS[log.actor_role] || log.actor_role
                            : '—'}
                        </div>
                      </td>

                      <td className="px-3 py-3 whitespace-nowrap">
                        {isEquipmentLink ? (
                          <button
                            onClick={() => onOpenEquipmentDetail(Number(log.entity_id))}
                            className="text-left text-blue-600 hover:text-blue-800 hover:underline font-medium"
                          >
                            <div>{log.entity_label || `Оборудование #${log.entity_id}`}</div>
                            <div className="text-[11px] text-slate-400 font-mono">
                              #{log.entity_id}
                            </div>
                          </button>
                        ) : (
                          <div className="text-slate-600">
                            <div>{log.entity_label || '—'}</div>
                            {log.entity_id && (
                              <div className="text-[11px] text-slate-400 font-mono">
                                ID: {log.entity_id}
                              </div>
                            )}
                          </div>
                        )}
                      </td>

                      {capabilities?.canViewTechnicalMeta && (
                        <td className="px-3 py-3 whitespace-nowrap font-mono text-[11px] text-slate-500">
                          {log.ip_address || '—'}
                        </td>
                      )}

                      <td className="px-3 py-3 whitespace-nowrap text-right">
                        <button
                          onClick={() => setSelectedLog(log)}
                          title="Открыть инспектор события"
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 font-medium transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Детали</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && data.total > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-slate-200 bg-slate-50/60 text-xs text-slate-600">
            <div>
              Показано записей:{' '}
              <span className="font-semibold text-slate-900">{data.items.length}</span> из{' '}
              <span className="font-semibold text-slate-900">{data.total}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Назад</span>
              </button>
              <span className="font-medium text-slate-700">
                Стр. {data.page} из {data.totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                disabled={page >= data.totalPages}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40"
              >
                <span>Вперед</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Event Inspector Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-2xl w-full overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Событие #{selectedLog.id}
                </h3>
                <p className="text-xs font-mono text-slate-500 mt-0.5">
                  {selectedLog.action}
                </p>
              </div>
              <button
                onClick={() => setSelectedLog(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto text-xs">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-slate-500 mb-1">Описание события</div>
                <div className="text-sm font-semibold text-slate-900">
                  {selectedLog.summary}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="p-3 rounded-lg border border-slate-200">
                  <div className="text-slate-400">Дата и время</div>
                  <div className="font-semibold text-slate-800 mt-0.5">
                    {new Date(selectedLog.created_at).toLocaleString('ru-RU')}
                  </div>
                </div>
                <div className="p-3 rounded-lg border border-slate-200">
                  <div className="text-slate-400">Категория</div>
                  <div className="font-semibold text-slate-800 mt-0.5">
                    {CATEGORY_LABELS[selectedLog.category] || selectedLog.category}
                  </div>
                </div>
                <div className="p-3 rounded-lg border border-slate-200">
                  <div className="text-slate-400">Уровень</div>
                  <div className="font-semibold text-slate-800 mt-0.5">
                    {selectedLog.severity}
                  </div>
                </div>
                <div className="p-3 rounded-lg border border-slate-200">
                  <div className="text-slate-400">Инициатор</div>
                  <div className="font-semibold text-slate-800 mt-0.5">
                    {selectedLog.actor_login || 'Система'} (
                    {selectedLog.actor_role
                      ? ROLE_LABELS[selectedLog.actor_role] || selectedLog.actor_role
                      : '—'}
                    )
                  </div>
                </div>
                <div className="p-3 rounded-lg border border-slate-200 sm:col-span-2">
                  <div className="text-slate-400">Объект</div>
                  <div className="font-semibold text-slate-800 mt-0.5">
                    {selectedLog.entity_label || '—'}{' '}
                    {selectedLog.entity_type ? `(${selectedLog.entity_type}` : ''}
                    {selectedLog.entity_id ? ` #${selectedLog.entity_id})` : selectedLog.entity_type ? ')' : ''}
                  </div>
                </div>
              </div>

              {(capabilities?.canViewTechnicalMeta ||
                selectedLog.actor_id === currentUser.id) && (
                <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/70 space-y-1.5">
                  <div className="font-semibold text-slate-700">
                    Технические метаданные подключения
                  </div>
                  <div className="text-slate-600">
                    <span className="text-slate-400">IP-адрес:</span>{' '}
                    <span className="font-mono">{selectedLog.ip_address || 'не определён'}</span>
                  </div>
                  <div className="text-slate-600 break-all">
                    <span className="text-slate-400">User-Agent:</span>{' '}
                    <span className="font-mono text-[11px]">
                      {selectedLog.user_agent || 'не определён'}
                    </span>
                  </div>
                </div>
              )}

              <div>
                <div className="font-semibold text-slate-700 mb-1.5">
                  Структурированные данные (JSON)
                </div>
                <pre className="p-3 rounded-xl bg-slate-900 text-slate-100 font-mono text-[11px] overflow-x-auto leading-relaxed">
                  {selectedLog.details
                    ? JSON.stringify(selectedLog.details, null, 2)
                    : '{}'}
                </pre>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end">
              <button
                onClick={() => setSelectedLog(null)}
                className="px-4 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Purge / Archive Rotation Modal (ADMIN ONLY) */}
      {showPurgeModal && capabilities?.canPurge && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-red-50/60">
              <div className="flex items-center gap-2 text-red-800 font-bold text-sm">
                <Trash2 className="w-4 h-4" />
                <span>Ротация и очистка журнала</span>
              </div>
              <button
                onClick={() => setShowPurgeModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <p className="text-slate-600 leading-relaxed">
                Выберите глубину хранения записей журнала событий. Факт очистки будет
                дополнительно зафиксирован как критическое событие безопасности.
              </p>

              <div className="space-y-2">
                {[
                  { days: 180, label: 'Удалить записи старше 180 дней' },
                  { days: 90, label: 'Удалить записи старше 90 дней (рекомендуется)' },
                  { days: 30, label: 'Удалить записи старше 30 дней' },
                  { days: 0, label: 'Полная очистка всего журнала (необратимо)' },
                ].map((opt) => (
                  <label
                    key={opt.days}
                    className={`flex items-center gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                      purgeDays === opt.days
                        ? opt.days === 0
                          ? 'border-red-400 bg-red-50 text-red-900'
                          : 'border-blue-400 bg-blue-50 text-blue-900'
                        : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <input
                      type="radio"
                      name="purgeDays"
                      checked={purgeDays === opt.days}
                      onChange={() => setPurgeDays(opt.days)}
                    />
                    <span className="font-medium">{opt.label}</span>
                  </label>
                ))}
              </div>

              {purgeError && (
                <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700">
                  {purgeError}
                </div>
              )}
            </div>

            <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
              <button
                onClick={() => setShowPurgeModal(false)}
                disabled={purgeLoading}
                className="px-3.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold"
              >
                Отмена
              </button>
              <button
                onClick={handleConfirmPurge}
                disabled={purgeLoading}
                className="px-3.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold disabled:opacity-50"
              >
                {purgeLoading ? 'Выполнение...' : 'Подтвердить очистку'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
