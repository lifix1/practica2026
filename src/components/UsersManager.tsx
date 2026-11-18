import React, { useState, useEffect } from 'react';
import {
  Users,
  UserPlus,
  AlertCircle,
  CheckCircle2,
  KeyRound,
  Trash2,
  X,
  FileText,
  Download,
} from 'lucide-react';
import type { User, UserRole } from '../types/index.ts';
import { apiFetch } from '../utils/api.ts';

interface UsersManagerProps {
  currentUser?: User | null;
}

export const UsersManager: React.FC<UsersManagerProps> = ({ currentUser }) => {
  const [usersList, setUsersList] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('ENGINEER');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Reset password modal state
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [resetPasswordVal, setResetPasswordVal] = useState('');
  const [resetLoading, setResetLoading] = useState(false);

  // Delete confirmation modal state
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Team practice docs download state
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);

  const handleDownloadTeamDoc = async (key: string, fileName: string) => {
    setDownloadingKey(key);
    setError(null);
    try {
      const res = await apiFetch(`/api/reports/download/${encodeURIComponent(key)}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Не удалось скачать документ');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err?.message || 'Ошибка скачивания файла');
    } finally {
      setDownloadingKey(null);
    }
  };

  const fetchUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/users');
      const data = await res.json();
      if (Array.isArray(data)) {
        setUsersList(data);
      } else {
        setUsersList([]);
        if (data && data.error) {
          setError(data.error);
        }
      }
    } catch (err) {
      console.error(err);
      setUsersList([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!login.trim() || !password) return;

    setError(null);
    try {
      const res = await apiFetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          login: login.trim(),
          password,
          role,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка создания пользователя');

      setSuccess(`Пользователь «${data.login}» с ролью ${data.role} успешно создан!`);
      setShowAddModal(false);
      setLogin('');
      setPassword('');
      setRole('ENGINEER');
      fetchUsers();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget || !resetPasswordVal) return;

    setResetLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/users/${resetTarget.id}/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: resetPasswordVal }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка сброса пароля');

      setSuccess(data.message || `Пароль пользователя «${resetTarget.login}» обновлён`);
      setResetTarget(null);
      setResetPasswordVal('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setResetLoading(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/users/${deleteTarget.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка удаления пользователя');

      setSuccess(`Учётная запись «${deleteTarget.login}» удалена`);
      setDeleteTarget(null);
      fetchUsers();
    } catch (err: any) {
      setError(err.message);
      setDeleteTarget(null);
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* Top Banner */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Users className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-bold text-slate-900">
              Пользователи и управление доступом
            </h2>
          </div>
          <p className="text-xs text-slate-500">
            Управление учётными записями кафедры, сброс паролей и разграничение ролей (ADMIN, ENGINEER, USER).
          </p>
        </div>

        <button
          onClick={() => {
            setError(null);
            setShowAddModal(true);
          }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors inline-flex items-center gap-1.5 shrink-0"
        >
          <UserPlus className="w-4 h-4" />
          Добавить сотрудника
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-800">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {success && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-semibold flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>{success}</span>
          </div>
          <button onClick={() => setSuccess(null)} className="text-emerald-600 hover:text-emerald-900">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Users table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold text-[11px]">
            <tr>
              <th className="p-3 w-16">ID</th>
              <th className="p-3">Логин</th>
              <th className="p-3">Роль в системе</th>
              <th className="p-3 text-right">Действия безопасности</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={4} className="p-6 text-center text-slate-400">
                  Загрузка пользователей...
                </td>
              </tr>
            ) : (
              (Array.isArray(usersList) ? usersList : []).map((u) => {
                const isSelf = currentUser?.id === u.id;
                return (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="p-3 font-mono text-slate-400">{u.id}</td>
                    <td className="p-3 font-semibold text-slate-900">
                      {u.login}
                      {isSelf && (
                        <span className="ml-2 text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                          вы
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      <span
                        className={`px-2.5 py-0.5 rounded-full font-semibold text-[11px] ${
                          u.role === 'ADMIN'
                            ? 'bg-red-50 text-red-700 border border-red-200'
                            : u.role === 'ENGINEER'
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        }`}
                      >
                        {u.role === 'ADMIN'
                          ? 'Администратор'
                          : u.role === 'ENGINEER'
                          ? 'Инженер'
                          : 'Пользователь'}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          onClick={() => {
                            setResetPasswordVal('');
                            setResetTarget(u);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 font-medium transition-colors"
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                          <span>Сбросить пароль</span>
                        </button>
                        {!isSelf && (
                          <button
                            onClick={() => setDeleteTarget(u)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 font-medium transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Удалить</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Team Practice Diaries & Coursework Reports Download Block */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <FileText className="w-4 h-4 text-blue-600" />
              Дневники практики (DOCX) и материалы отчётов команды
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Готовые документы Word для печати (02–14.10.2026) и подробные отчёты к курсовой защите для каждого участника.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[
            {
              name: 'Стас',
              role: 'Фронтенд (React SPA, QR-сканер, фильтры, формы)',
              diaryKey: 'diary-stas',
              diaryFile: 'DNEVNIK_PRAKTIKI_STAS_FRONTEND.docx',
              reportKey: 'report-stas',
              reportFile: 'REPORT_STAS_FRONTEND.md',
            },
            {
              name: 'Артём',
              role: 'Бэкенд (БД учёта, справочники, валидация, Excel)',
              diaryKey: 'diary-artem',
              diaryFile: 'DNEVNIK_PRAKTIKI_ARTEM_BACKEND_ACCOUNTING.docx',
              reportKey: 'report-artem',
              reportFile: 'REPORT_ARTEM_BACKEND_ACCOUNTING.md',
            },
            {
              name: 'Илья',
              role: 'Бэкенд (Безопасность, QR-шлюз, инвентаризация, списание, аудит)',
              diaryKey: 'diary-ilya',
              diaryFile: 'DNEVNIK_PRAKTIKI_ILYA_BACKEND_PROCESSES_SECURITY.docx',
              reportKey: 'report-ilya',
              reportFile: 'REPORT_ILYA_BACKEND_PROCESSES_SECURITY.md',
            },
            {
              name: 'Егор',
              role: 'Генерация DOCX, деплой, тестирование и документация',
              diaryKey: 'diary-egor',
              diaryFile: 'DNEVNIK_PRAKTIKI_EGOR_DOCX_DEVOPS_QA.docx',
              reportKey: 'report-egor',
              reportFile: 'REPORT_EGOR_DOCX_DEVOPS_QA.md',
            },
          ].map((member) => (
            <div
              key={member.diaryKey}
              className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 flex flex-col justify-between gap-3"
            >
              <div>
                <div className="font-bold text-xs text-slate-900">{member.name}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">{member.role}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleDownloadTeamDoc(member.diaryKey, member.diaryFile)}
                  disabled={downloadingKey !== null}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>
                    {downloadingKey === member.diaryKey ? 'Скачивание...' : 'Дневник (.docx)'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDownloadTeamDoc(member.reportKey, member.reportFile)}
                  disabled={downloadingKey !== null}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-60 text-slate-700 text-xs font-medium transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>
                    {downloadingKey === member.reportKey ? 'Скачивание...' : 'Отчёт (.md)'}
                  </span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Add User Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-sm w-full p-6 space-y-4">
            <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-blue-600" />
              Добавить сотрудника
            </h3>
            <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Логин пользователя *
                </label>
                <input
                  type="text"
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  placeholder="ivanov_eng"
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none focus:border-blue-500"
                  required
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  От 3 до 64 символов: латиница, цифры, ., _, -
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Пароль *
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Минимум 8 символов (буквы + цифры)"
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Роль *
                </label>
                <select
                  value={role}
                  onChange={(e: any) => setRole(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none bg-white"
                >
                  <option value="ENGINEER">Инженер (ENGINEER)</option>
                  <option value="ADMIN">Администратор (ADMIN)</option>
                  <option value="USER">Пользователь (USER)</option>
                </select>
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
                  Создать
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetTarget && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-sm w-full p-6 space-y-4">
            <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-blue-600" />
              Сброс пароля: {resetTarget.login}
            </h3>
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Новый надёжный пароль *
                </label>
                <input
                  type="password"
                  value={resetPasswordVal}
                  onChange={(e) => setResetPasswordVal(e.target.value)}
                  placeholder="Минимум 8 символов (буквы + цифры)"
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none focus:border-blue-500"
                  required
                />
                <p className="text-[11px] text-slate-500 mt-1.5">
                  Активная сессия пользователя будет завершена автоматически.
                </p>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setResetTarget(null)}
                  className="px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={resetLoading}
                  className="px-4 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl"
                >
                  {resetLoading ? 'Сохранение...' : 'Сохранить пароль'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete User Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-sm w-full p-6 space-y-4">
            <h3 className="font-bold text-base text-red-700 flex items-center gap-2">
              <Trash2 className="w-5 h-5" />
              Удалить пользователя «{deleteTarget.login}»?
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Доступ к системе для этой учётной записи будет немедленно прекращён, а её активные сессии отозваны.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deleteLoading}
                className="px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleDeleteUser}
                disabled={deleteLoading}
                className="px-4 py-2 text-xs font-bold bg-red-600 hover:bg-red-700 text-white rounded-xl"
              >
                {deleteLoading ? 'Удаление...' : 'Удалить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
