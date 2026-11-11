import React, { useState, useEffect } from 'react';
import {
  Layers,
  Plus,
  Trash2,
  FolderTree,
  AlertCircle,
  Tag,
  CheckCircle2,
  ListPlus,
  ChevronRight,
  Pencil,
  X,
  HelpCircle,
} from 'lucide-react';
import type { EquipmentType, AdditionalField, User } from '../types/index.ts';
import { apiFetch } from '../utils/api.ts';

interface TypesManagerProps {
  currentUser: User | null;
  types: EquipmentType[];
  onRefreshTypes: () => void;
}

export const TypesManager: React.FC<TypesManagerProps> = ({
  currentUser,
  types,
  onRefreshTypes,
}) => {
  const safeTypes = Array.isArray(types) ? types : [];

  const [selectedType, setSelectedType] = useState<EquipmentType | null>(
    safeTypes.length > 0 ? safeTypes[0] : null
  );
  const [fields, setFields] = useState<AdditionalField[]>([]);
  const [loadingFields, setLoadingFields] = useState(false);

  // New Type Modal
  const [showAddTypeModal, setShowAddTypeModal] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');
  const [newTypeParentId, setNewTypeParentId] = useState<number | ''>('');

  // Edit Type Modal
  const [showEditTypeModal, setShowEditTypeModal] = useState(false);
  const [editingType, setEditingType] = useState<EquipmentType | null>(null);
  const [editTypeName, setEditTypeName] = useState('');
  const [editTypeParentId, setEditTypeParentId] = useState<number | ''>('');

  // Delete Type Confirm Modal
  const [typeToDelete, setTypeToDelete] = useState<EquipmentType | null>(null);

  // New Field Modal
  const [showAddFieldModal, setShowAddFieldModal] = useState(false);
  const [fieldCode, setFieldCode] = useState('');
  const [fieldTitle, setFieldTitle] = useState('');
  const [fieldDataType, setFieldDataType] = useState<
    'STRING' | 'INTEGER' | 'NUMBER' | 'BOOLEAN' | 'DATE' | 'ENUM'
  >('STRING');
  const [fieldRequired, setFieldRequired] = useState(false);
  const [fieldMultiple, setFieldMultiple] = useState(false);
  const [fieldOptions, setFieldOptions] = useState('');

  // Delete Field Confirm
  const [fieldToDelete, setFieldToDelete] = useState<AdditionalField | null>(null);

  // Edit Field Modal
  const [showEditFieldModal, setShowEditFieldModal] = useState(false);
  const [editingField, setEditingField] = useState<AdditionalField | null>(null);
  const [editFieldCode, setEditFieldCode] = useState('');
  const [editFieldTitle, setEditFieldTitle] = useState('');
  const [editFieldDataType, setEditFieldDataType] = useState<
    'STRING' | 'INTEGER' | 'NUMBER' | 'BOOLEAN' | 'DATE' | 'ENUM'
  >('STRING');
  const [editFieldRequired, setEditFieldRequired] = useState(false);
  const [editFieldMultiple, setEditFieldMultiple] = useState(false);
  const [editFieldOptions, setEditFieldOptions] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isAdmin = currentUser?.role === 'ADMIN';

  // Keep selectedType valid when types list updates
  useEffect(() => {
    if (selectedType) {
      const fresh = safeTypes.find((t) => t.id === selectedType.id);
      if (fresh) {
        setSelectedType(fresh);
      } else if (safeTypes.length > 0) {
        setSelectedType(safeTypes[0]);
      } else {
        setSelectedType(null);
      }
    } else if (safeTypes.length > 0) {
      setSelectedType(safeTypes[0]);
    }
  }, [types]);

  // Load fields when selectedType changes
  const fetchFields = (typeId: number) => {
    setLoadingFields(true);
    apiFetch(`/api/equipment-types/${typeId}/fields`)
      .then((r) => r.json())
      .then((data: AdditionalField[]) => setFields(Array.isArray(data) ? data : []))
      .catch((err) => {
        console.error(err);
        setFields([]);
      })
      .finally(() => setLoadingFields(false));
  };

  useEffect(() => {
    if (selectedType) {
      fetchFields(selectedType.id);
    } else {
      setFields([]);
    }
  }, [selectedType?.id]);

  // Helper to get all descendant IDs for a given type (to avoid cyclical hierarchy in edit modal)
  const getDescendantIds = (typeId: number): Set<number> => {
    const descendants = new Set<number>();
    const findChildren = (pid: number) => {
      safeTypes
        .filter((t) => t.parent_id === pid)
        .forEach((child) => {
          descendants.add(child.id);
          findChildren(child.id);
        });
    };
    findChildren(typeId);
    return descendants;
  };

  // Open Edit Type Modal
  const handleOpenEditType = (typeToEdit: EquipmentType) => {
    setError(null);
    setSuccess(null);
    setEditingType(typeToEdit);
    setEditTypeName(typeToEdit.name);
    setEditTypeParentId(typeToEdit.parent_id || '');
    setShowEditTypeModal(true);
  };

  // Open Add Subtype Modal with parent preselected
  const handleOpenAddSubtype = (parentTypeId: number) => {
    setError(null);
    setSuccess(null);
    setNewTypeName('');
    setNewTypeParentId(parentTypeId);
    setShowAddTypeModal(true);
  };

  // Create Type
  const handleCreateType = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTypeName.trim()) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch('/api/equipment-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newTypeName.trim(),
          parent_id: newTypeParentId || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка создания типа');

      setSuccess(`Тип оборудования «${data.name}» успешно создан!`);
      setShowAddTypeModal(false);
      setNewTypeName('');
      setNewTypeParentId('');
      onRefreshTypes();
      setSelectedType(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Save Edited Type
  const handleSaveEditType = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingType || !editTypeName.trim()) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/equipment-types/${editingType.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editTypeName.trim(),
          parent_id: editTypeParentId === '' ? null : Number(editTypeParentId),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка обновления типа');

      setSuccess(`Тип оборудования «${data.name}» успешно обновлен!`);
      setShowEditTypeModal(false);
      setEditingType(null);
      setSelectedType(data);
      onRefreshTypes();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Confirm and Delete Type
  const handleConfirmDeleteType = async () => {
    if (!typeToDelete) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/equipment-types/${typeToDelete.id}`, {
        method: 'DELETE',
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка удаления типа оборудования');

      setSuccess(`Тип оборудования «${typeToDelete.name}» успешно удален!`);
      setTypeToDelete(null);
      onRefreshTypes();
    } catch (err: any) {
      setError(err.message);
      setTypeToDelete(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Create Additional Field
  const handleCreateField = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedType || !fieldCode.trim() || !fieldTitle.trim()) return;

    const optionsArray =
      fieldDataType === 'ENUM'
        ? fieldOptions
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : null;

    if (fieldDataType === 'ENUM' && (!optionsArray || optionsArray.length === 0)) {
      setError('Для типа ENUM необходимо указать хотя бы 1 вариант через запятую');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/equipment-types/${selectedType.id}/fields`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: fieldCode.trim(),
          title: fieldTitle.trim(),
          data_type: fieldDataType,
          is_required: fieldRequired,
          is_multiple: fieldMultiple,
          options: optionsArray,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка добавления характеристики');

      setSuccess(`Характеристика «${data.title}» добавлена!`);
      setShowAddFieldModal(false);
      setFieldCode('');
      setFieldTitle('');
      setFieldDataType('STRING');
      setFieldRequired(false);
      setFieldMultiple(false);
      setFieldOptions('');
      fetchFields(selectedType.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delete Additional Field
  const handleConfirmDeleteField = async () => {
    if (!selectedType || !fieldToDelete) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/equipment-types/${selectedType.id}/fields/${fieldToDelete.id}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Ошибка удаления поля');
      }

      setSuccess(`Характеристика «${fieldToDelete.title}» успешно деактивирована`);
      setFieldToDelete(null);
      fetchFields(selectedType.id);
    } catch (err: any) {
      setError(err.message);
      setFieldToDelete(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Open Edit Field Modal
  const handleOpenEditField = (field: AdditionalField) => {
    setError(null);
    setSuccess(null);
    setEditingField(field);
    setEditFieldCode(field.code);
    setEditFieldTitle(field.title);
    setEditFieldDataType(field.data_type);
    setEditFieldRequired(Boolean(field.is_required));
    setEditFieldMultiple(Boolean(field.is_multiple));
    setEditFieldOptions(Array.isArray(field.options) ? field.options.join(', ') : '');
    setShowEditFieldModal(true);
  };

  // Save Edited Field
  const handleSaveEditField = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedType || !editingField || !editFieldCode.trim() || !editFieldTitle.trim()) return;

    const optionsArray =
      editFieldDataType === 'ENUM'
        ? editFieldOptions
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : null;

    if (editFieldDataType === 'ENUM' && (!optionsArray || optionsArray.length === 0)) {
      setError('Для типа ENUM необходимо указать хотя бы 1 вариант через запятую');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/equipment-types/${selectedType.id}/fields/${editingField.id}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: editFieldCode.trim(),
            title: editFieldTitle.trim(),
            data_type: editFieldDataType,
            is_required: editFieldRequired,
            is_multiple: editFieldMultiple,
            options: optionsArray,
          }),
        }
      );

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка обновления характеристики');

      setSuccess(`Характеристика «${data.title}» успешно обновлена!`);
      setShowEditFieldModal(false);
      setEditingField(null);
      fetchFields(selectedType.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Build tree representation
  const rootTypes = safeTypes.filter((t) => !t.parent_id);
  const getSubtypes = (parentId: number) => safeTypes.filter((t) => t.parent_id === parentId);

  // Excluded IDs for edit parent selector (cannot pick self or any descendants)
  const forbiddenParentIds = editingType
    ? new Set([editingType.id, ...Array.from(getDescendantIds(editingType.id))])
    : new Set<number>();

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* Top Banner */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <FolderTree className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-bold text-slate-900">
              Иерархия типов оборудования и дополнительные характеристики
            </h2>
          </div>
          <p className="text-xs text-slate-500">
            Редактирование категорий оборудования в древовидной структуре и настройка наследуемых
            характеристик.
          </p>
        </div>

        {isAdmin && (
          <button
            onClick={() => {
              setError(null);
              setSuccess(null);
              setNewTypeName('');
              setNewTypeParentId('');
              setShowAddTypeModal(true);
            }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors inline-flex items-center gap-1.5 shrink-0"
          >
            <Plus className="w-4 h-4" />
            Создать тип оборудования
          </button>
        )}
      </div>

      {error && (
        <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => setError(null)}
            className="p-1 hover:bg-red-100 rounded-lg text-red-500 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {success && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-semibold flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{success}</span>
          </div>
          <button
            onClick={() => setSuccess(null)}
            className="p-1 hover:bg-emerald-100 rounded-lg text-emerald-600 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Grid: Tree Sidebar + Fields Detail */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Hierarchy Tree Sidebar */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-slate-500" />
              Дерево типов
            </h3>
            <span className="text-[11px] text-slate-400 font-mono">
              Всего: {safeTypes.length}
            </span>
          </div>

          <div className="space-y-1.5 max-h-[600px] overflow-y-auto pr-1">
            {rootTypes.length === 0 ? (
              <div className="py-8 text-center text-slate-400 text-xs">
                Типы оборудования ещё не созданы
              </div>
            ) : (
              rootTypes.map((root) => {
                const children = getSubtypes(root.id);
                const isSelected = selectedType?.id === root.id;

                return (
                  <div key={root.id} className="space-y-1">
                    {/* Root Node Item */}
                    <div
                      className={`group relative rounded-xl transition-all border ${
                        isSelected
                          ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                          : 'bg-slate-50/70 hover:bg-slate-100/90 text-slate-800 border-slate-200/60'
                      }`}
                    >
                      <div className="flex items-center justify-between px-3 py-2">
                        <button
                          type="button"
                          onClick={() => setSelectedType(root)}
                          className="flex-1 text-left font-bold text-xs truncate mr-2"
                          title={root.name}
                        >
                          {root.name}
                        </button>

                        <div className="flex items-center gap-1 shrink-0">
                          {isAdmin && (
                            <div className="flex items-center gap-0.5 opacity-90 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenAddSubtype(root.id);
                                }}
                                className={`p-1 rounded-lg transition-colors ${
                                  isSelected
                                    ? 'hover:bg-blue-700 text-blue-100'
                                    : 'hover:bg-slate-200 text-slate-500'
                                }`}
                                title="Создать дочерний подтип"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenEditType(root);
                                }}
                                className={`p-1 rounded-lg transition-colors ${
                                  isSelected
                                    ? 'hover:bg-blue-700 text-blue-100'
                                    : 'hover:bg-slate-200 text-slate-500 hover:text-blue-600'
                                }`}
                                title="Редактировать тип"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setTypeToDelete(root);
                                }}
                                className={`p-1 rounded-lg transition-colors ${
                                  isSelected
                                    ? 'hover:bg-blue-700 text-red-200 hover:text-white'
                                    : 'hover:bg-slate-200 text-slate-500 hover:text-red-600'
                                }`}
                                title="Удалить тип"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                          <span
                            className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                              isSelected
                                ? 'bg-blue-500/50 text-blue-100'
                                : 'bg-slate-200/70 text-slate-500'
                            }`}
                          >
                            #{root.id}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Children / Subtypes */}
                    {children.length > 0 && (
                      <div className="pl-3.5 space-y-1 border-l-2 border-indigo-100 ml-3">
                        {children.map((child) => {
                          const isChildSelected = selectedType?.id === child.id;
                          return (
                            <div
                              key={child.id}
                              className={`group relative rounded-lg transition-all border ${
                                isChildSelected
                                  ? 'bg-indigo-50 border-indigo-200 text-indigo-900 shadow-xs'
                                  : 'bg-white hover:bg-slate-50 border-slate-200/50 text-slate-700'
                              }`}
                            >
                              <div className="flex items-center justify-between px-2.5 py-1.5">
                                <button
                                  type="button"
                                  onClick={() => setSelectedType(child)}
                                  className="flex-1 text-left text-xs font-medium flex items-center gap-1.5 truncate mr-2"
                                  title={child.name}
                                >
                                  <ChevronRight className="w-3 h-3 text-indigo-400 shrink-0" />
                                  <span className="truncate">{child.name}</span>
                                </button>

                                <div className="flex items-center gap-1 shrink-0">
                                  {isAdmin && (
                                    <div className="flex items-center gap-0.5 opacity-90 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleOpenAddSubtype(child.id);
                                        }}
                                        className="p-1 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-indigo-100/50 transition-colors"
                                        title="Создать вложенный подтип"
                                      >
                                        <Plus className="w-3 h-3" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleOpenEditType(child);
                                        }}
                                        className="p-1 rounded-md text-slate-400 hover:text-blue-600 hover:bg-blue-100/50 transition-colors"
                                        title="Редактировать тип"
                                      >
                                        <Pencil className="w-3 h-3" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setTypeToDelete(child);
                                        }}
                                        className="p-1 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-100/50 transition-colors"
                                        title="Удалить тип"
                                      >
                                        <Trash2 className="w-3 h-3" />
                                      </button>
                                    </div>
                                  )}
                                  <span className="text-[10px] font-mono text-slate-400">
                                    #{child.id}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Fields Panel for Selected Type */}
        <div className="md:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-5">
          {selectedType ? (
            <>
              {/* Type Details Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-slate-900 text-lg">
                      «{selectedType.name}»
                    </h3>
                    <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 font-mono text-[11px] font-semibold">
                      ID: {selectedType.id}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {selectedType.parent_id ? (
                      <span>
                        Дочерний подтип родителя:{' '}
                        <strong className="text-indigo-600">
                          {safeTypes.find((t) => t.id === selectedType.parent_id)?.name ||
                            `#${selectedType.parent_id}`}
                        </strong>{' '}
                        (наследует все его характеристики)
                      </span>
                    ) : (
                      'Корневой тип оборудования'
                    )}
                  </p>
                </div>

                {isAdmin && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => handleOpenEditType(selectedType)}
                      className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-xl text-xs font-semibold shadow-xs transition-colors inline-flex items-center gap-1.5"
                      title="Редактировать название или родительскую категорию"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Редактировать тип
                    </button>

                    <button
                      onClick={() => handleOpenAddSubtype(selectedType.id)}
                      className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-xl text-xs font-semibold shadow-xs transition-colors inline-flex items-center gap-1.5"
                      title="Создать подтип для этого типа"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Создать подтип
                    </button>

                    <button
                      onClick={() => setTypeToDelete(selectedType)}
                      className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded-xl text-xs font-semibold shadow-xs transition-colors inline-flex items-center gap-1.5"
                      title="Удалить тип"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Удалить тип
                    </button>

                    <button
                      onClick={() => setShowAddFieldModal(true)}
                      className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors inline-flex items-center gap-1.5"
                    >
                      <ListPlus className="w-4 h-4" />
                      Добавить характеристику
                    </button>
                  </div>
                )}
              </div>

              {/* Fields Table */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Характеристики типа (собственные и унаследованные):
                  </h4>
                  <span className="text-[11px] text-slate-400">
                    Всего: {fields.length}
                  </span>
                </div>

                {loadingFields ? (
                  <div className="py-10 text-center text-slate-400 text-xs">
                    Загрузка характеристик...
                  </div>
                ) : fields.length === 0 ? (
                  <div className="py-10 text-center text-slate-400 text-xs border border-dashed border-slate-200 rounded-xl">
                    У данного типа пока нет характеристик. Нажмите «Добавить характеристику», чтобы
                    задать параметры (например, серийный номер, частоту, диагональ, объем памяти).
                  </div>
                ) : (
                  <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold text-[11px]">
                        <tr>
                          <th className="p-3">Название</th>
                          <th className="p-3">Код JSON</th>
                          <th className="p-3">Тип данных</th>
                          <th className="p-3">Принадлежность</th>
                          <th className="p-3 text-center">Обязательное</th>
                          <th className="p-3 text-center">Массив</th>
                          <th className="p-3">Варианты (Enum)</th>
                          {isAdmin && <th className="p-3 text-right">Действие</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {fields.map((f) => {
                          const isOwnField = f.type_id === selectedType.id;
                          return (
                            <tr key={f.id} className="hover:bg-slate-50/70 transition-colors">
                              <td className="p-3 font-semibold text-slate-900">
                                {f.title}
                              </td>
                              <td className="p-3 font-mono text-blue-700 text-[11px]">
                                {f.code}
                              </td>
                              <td className="p-3">
                                <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[10px] font-medium">
                                  {f.data_type}
                                </span>
                              </td>
                              <td className="p-3">
                                {isOwnField ? (
                                  <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-semibold border border-emerald-200">
                                    Собственное
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-[10px] font-medium border border-indigo-200">
                                    Унаследовано
                                  </span>
                                )}
                              </td>
                              <td className="p-3 text-center">
                                {f.is_required ? (
                                  <span className="text-red-600 font-bold">Да</span>
                                ) : (
                                  <span className="text-slate-400">Нет</span>
                                )}
                              </td>
                              <td className="p-3 text-center">
                                {f.is_multiple ? (
                                  <span className="text-indigo-600 font-bold">Да</span>
                                ) : (
                                  <span className="text-slate-400">Нет</span>
                                )}
                              </td>
                              <td className="p-3 text-slate-500 text-[11px]">
                                {f.options && f.options.length > 0 ? (
                                  <span className="font-mono bg-slate-50 px-1.5 py-0.5 rounded border border-slate-150">
                                    {f.options.join(', ')}
                                  </span>
                                ) : (
                                  '—'
                                )}
                              </td>
                              {isAdmin && (
                                <td className="p-3 text-right">
                                  {isOwnField ? (
                                    <div className="flex items-center justify-end gap-1">
                                      <button
                                        onClick={() => handleOpenEditField(f)}
                                        className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                        title="Редактировать характеристику"
                                      >
                                        <Pencil className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        onClick={() => setFieldToDelete(f)}
                                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                        title="Деактивировать характеристику"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  ) : (
                                    <span
                                      className="text-[10px] text-slate-400 italic"
                                      title="Редактируется в родительском типе"
                                    >
                                      Из родителя
                                    </span>
                                  )}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="py-16 text-center text-slate-400 text-xs">
              Выберите тип оборудования в дереве слева
            </div>
          )}
        </div>
      </div>

      {/* Modal: Create Type */}
      {showAddTypeModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full p-6 space-y-4 animate-scaleUp">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base text-slate-900">
                Создать новый тип оборудования
              </h3>
              <button
                onClick={() => setShowAddTypeModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateType} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Название типа *
                </label>
                <input
                  type="text"
                  value={newTypeName}
                  onChange={(e) => setNewTypeName(e.target.value)}
                  placeholder="Например: Планшет или Принтер"
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Родительский тип (для наследования характеристик)
                </label>
                <select
                  value={newTypeParentId}
                  onChange={(e) =>
                    setNewTypeParentId(e.target.value === '' ? '' : Number(e.target.value))
                  }
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                >
                  <option value="">Без родителя (корневой тип)</option>
                  {safeTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-400 mt-1">
                  Дочерний подтип автоматически наследует все поля родительской категории.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddTypeModal(false)}
                  className="px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl"
                  disabled={isSubmitting}
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-xs transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? 'Создание...' : 'Создать тип'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Type */}
      {showEditTypeModal && editingType && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full p-6 space-y-4 animate-scaleUp">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Pencil className="w-4 h-4 text-blue-600" />
                <h3 className="font-bold text-base text-slate-900">
                  Редактировать тип оборудования
                </h3>
              </div>
              <button
                onClick={() => {
                  setShowEditTypeModal(false);
                  setEditingType(null);
                }}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEditType} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Название типа *
                </label>
                <input
                  type="text"
                  value={editTypeName}
                  onChange={(e) => setEditTypeName(e.target.value)}
                  placeholder="Например: Ноутбуки или Мониторы"
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Родительский тип (иерархия наследования)
                </label>
                <select
                  value={editTypeParentId}
                  onChange={(e) =>
                    setEditTypeParentId(e.target.value === '' ? '' : Number(e.target.value))
                  }
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                >
                  <option value="">Без родителя (корневой тип)</option>
                  {safeTypes
                    .filter((t) => !forbiddenParentIds.has(t.id))
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </select>
                <p className="text-[11px] text-slate-400 mt-1">
                  Сам тип и его текущие дочерние категории исключены из списка для предотвращения
                  зацикливания.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setShowEditTypeModal(false);
                    setEditingType(null);
                  }}
                  className="px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl"
                  disabled={isSubmitting}
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-xs transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? 'Сохранение...' : 'Сохранить изменения'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Delete Type Confirmation */}
      {typeToDelete && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full p-6 space-y-4 animate-scaleUp">
            <div className="flex items-center gap-3 text-red-600">
              <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-900">Удалить тип оборудования?</h3>
                <p className="text-xs text-slate-500">
                  Тип: <strong>«{typeToDelete.name}»</strong> (ID: {typeToDelete.id})
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-200">
              Удаление типа возможно только если к нему не привязано оборудование и у него нет
              дочерних подтипов. Все собственные характеристики этого типа будут удалены.
            </p>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setTypeToDelete(null)}
                className="px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl"
                disabled={isSubmitting}
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteType}
                disabled={isSubmitting}
                className="px-4 py-2 text-xs font-bold bg-red-600 hover:bg-red-700 text-white rounded-xl shadow-xs transition-colors disabled:opacity-50"
              >
                {isSubmitting ? 'Удаление...' : 'Да, удалить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Delete Field Confirmation */}
      {fieldToDelete && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full p-6 space-y-4 animate-scaleUp">
            <div className="flex items-center gap-3 text-red-600">
              <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-900">Деактивировать характеристику?</h3>
                <p className="text-xs text-slate-500">
                  Поле: <strong>«{fieldToDelete.title}»</strong> ({fieldToDelete.code})
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-200">
              Данная характеристика перестанет запрашиваться и отображаться для нового оборудования
              данного типа.
            </p>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setFieldToDelete(null)}
                className="px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl"
                disabled={isSubmitting}
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteField}
                disabled={isSubmitting}
                className="px-4 py-2 text-xs font-bold bg-red-600 hover:bg-red-700 text-white rounded-xl shadow-xs transition-colors disabled:opacity-50"
              >
                {isSubmitting ? 'Удаление...' : 'Деактивировать'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Create Additional Field */}
      {showAddFieldModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full p-6 space-y-4 animate-scaleUp">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base text-slate-900">
                Добавить характеристику для «{selectedType?.name}»
              </h3>
              <button
                onClick={() => setShowAddFieldModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateField} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Отображаемое название (Title) *
                </label>
                <input
                  type="text"
                  value={fieldTitle}
                  onChange={(e) => setFieldTitle(e.target.value)}
                  placeholder="Например: Объем накопителя (ГБ)"
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Код в JSON (уникален для типа) *
                </label>
                <input
                  type="text"
                  value={fieldCode}
                  onChange={(e) => setFieldCode(e.target.value)}
                  placeholder="Например: storage_gb"
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl font-mono outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Тип данных (Data Type) *
                </label>
                <select
                  value={fieldDataType}
                  onChange={(e: any) => setFieldDataType(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                >
                  <option value="STRING">STRING (Текст)</option>
                  <option value="INTEGER">INTEGER (Целое число)</option>
                  <option value="NUMBER">NUMBER (Число с точкой)</option>
                  <option value="BOOLEAN">BOOLEAN (Логическое да/нет)</option>
                  <option value="DATE">DATE (Дата)</option>
                  <option value="ENUM">ENUM (Выбор из списка)</option>
                </select>
              </div>

              {fieldDataType === 'ENUM' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Варианты выбора (через запятую) *
                  </label>
                  <input
                    type="text"
                    value={fieldOptions}
                    onChange={(e) => setFieldOptions(e.target.value)}
                    placeholder="Например: SSD, HDD, NVMe"
                    className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                    required
                  />
                </div>
              )}

              <div className="flex items-center gap-6 pt-1 text-xs text-slate-700">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={fieldRequired}
                    onChange={(e) => setFieldRequired(e.target.checked)}
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span>Обязательное поле</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={fieldMultiple}
                    onChange={(e) => setFieldMultiple(e.target.checked)}
                    className="rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>Поле-массив (список)</span>
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddFieldModal(false)}
                  className="px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl"
                  disabled={isSubmitting}
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-xs transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? 'Сохранение...' : 'Сохранить характеристику'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Additional Field */}
      {showEditFieldModal && editingField && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full p-6 space-y-4 animate-scaleUp">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Pencil className="w-4 h-4 text-blue-600" />
                <h3 className="font-bold text-base text-slate-900">
                  Редактировать характеристику
                </h3>
              </div>
              <button
                onClick={() => {
                  setShowEditFieldModal(false);
                  setEditingField(null);
                }}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEditField} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Отображаемое название (Title) *
                </label>
                <input
                  type="text"
                  value={editFieldTitle}
                  onChange={(e) => setEditFieldTitle(e.target.value)}
                  placeholder="Например: Объем накопителя (ГБ)"
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Код в JSON (уникален для типа) *
                </label>
                <input
                  type="text"
                  value={editFieldCode}
                  onChange={(e) => setEditFieldCode(e.target.value)}
                  placeholder="Например: storage_gb"
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl font-mono outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Тип данных (Data Type) *
                </label>
                <select
                  value={editFieldDataType}
                  onChange={(e: any) => setEditFieldDataType(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                >
                  <option value="STRING">STRING (Текст)</option>
                  <option value="INTEGER">INTEGER (Целое число)</option>
                  <option value="NUMBER">NUMBER (Число с точкой)</option>
                  <option value="BOOLEAN">BOOLEAN (Логическое да/нет)</option>
                  <option value="DATE">DATE (Дата)</option>
                  <option value="ENUM">ENUM (Выбор из списка)</option>
                </select>
              </div>

              {editFieldDataType === 'ENUM' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Варианты выбора (через запятую) *
                  </label>
                  <input
                    type="text"
                    value={editFieldOptions}
                    onChange={(e) => setEditFieldOptions(e.target.value)}
                    placeholder="Например: SSD, HDD, NVMe"
                    className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    required
                  />
                </div>
              )}

              <div className="flex items-center gap-6 pt-1 text-xs text-slate-700">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={editFieldRequired}
                    onChange={(e) => setEditFieldRequired(e.target.checked)}
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span>Обязательное поле</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={editFieldMultiple}
                    onChange={(e) => setEditFieldMultiple(e.target.checked)}
                    className="rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>Поле-массив (список)</span>
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setShowEditFieldModal(false);
                    setEditingField(null);
                  }}
                  className="px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl"
                  disabled={isSubmitting}
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-xs transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? 'Сохранение...' : 'Сохранить изменения'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
