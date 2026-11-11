import React, { useState, useEffect } from 'react';
import { Users, Plus, Shield, UserPlus, AlertCircle, CheckCircle2 } from 'lucide-react';
import type { User, UserRole } from '../types/index.ts';
import { apiFetch } from '../utils/api.ts';

export const UsersManager: React.FC = () => {
  const [usersList, setUsersList] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('ENGINEER');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
    } catch (err: any) {
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

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* Top Banner */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Users className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-bold text-slate-900">
              Пользователи и распределение ролей (ENUM)
            </h2>
          </div>
          <p className="text-xs text-slate-500">
            Управление учетными записями кафедры: Администратор (ADMIN), Инженер (ENGINEER), Пользователь (USER).
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors inline-flex items-center gap-1.5 shrink-0"
        >
          <UserPlus className="w-4 h-4" />
          Добавить сотрудника
        </button>
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

      {/* Users table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold text-[11px]">
            <tr>
              <th className="p-3 w-16">ID</th>
              <th className="p-3">Логин</th>
              <th className="p-3">Роль в системе</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={3} className="p-6 text-center text-slate-400">
                  Загрузка пользователей...
                </td>
              </tr>
            ) : (
              (Array.isArray(usersList) ? usersList : []).map((u) => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="p-3 font-mono text-slate-400">{u.id}</td>
                  <td className="p-3 font-semibold text-slate-900">{u.login}</td>
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
                </tr>
              ))
            )}
          </tbody>
        </table>
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
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Пароль *
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Роль (ENUM) *
                </label>
                <select
                  value={role}
                  onChange={(e: any) => setRole(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none"
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
    </div>
  );
};
