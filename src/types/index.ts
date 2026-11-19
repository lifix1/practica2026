export type UserRole = 'ADMIN' | 'ENGINEER' | 'USER';

export interface User {
  id: number;
  login: string;
  role: UserRole;
}

export interface RoomDetails {
  description?: string;
  dimensions?: string;
  scheme?: string;
  notes?: string;
  [key: string]: any;
}

export interface Room {
  id: number;
  number: string;
  floor: number | null;
  details?: RoomDetails | null;
}

export interface EquipmentType {
  id: number;
  name: string;
  parent_id: number | null;
}

export type FieldDataType =
  | 'STRING'
  | 'INTEGER'
  | 'NUMBER'
  | 'BOOLEAN'
  | 'DATE'
  | 'ENUM';

export interface AdditionalField {
  id: number;
  type_id: number | null;
  code: string;
  title: string;
  data_type: FieldDataType;
  is_required: boolean;
  is_multiple: boolean;
  options: string[] | null;
  is_active: boolean;
}

export type WriteoffState =
  | 'PREPARING'
  | 'DOCUMENTS_PREPARATION'
  | 'WRITTEN_OFF';

export type IssueState = 'ISSUE' | 'CRITICAL_ISSUE' | 'WEAR_AND_TEAR';

export type EquipmentStatus = 'Действует' | 'На хранении' | string;
export type EquipmentCondition =
  | 'Рабочее'
  | 'Есть нюансы'
  | 'Вышло из строя'
  | 'Неремонтопригодно'
  | string;
export type AccountingCategory =
  | 'Без категории'
  | 'Дорогостоящее'
  | 'Малоценка'
  | 'Мягкий инвентарь'
  | string;

export interface EquipmentAdditionalFields {
  location_place?: string; // Место (Стол секретаря, Стол 7, Шкаф 3...)
  dimensions?: string; // Размеры строка (560*200*140)
  length_cm?: number | null; // Длина (см)
  width_cm?: number | null; // Ширина (см)
  height_cm?: number | null; // Высота (см)
  description?: string; // Описание
  color?: string; // Цвет (серый, черный, белый...)
  status?: EquipmentStatus; // Статус (Действует / На хранении)
  condition?: EquipmentCondition; // Состояние
  accounting_category?: AccountingCategory; // Категория (по бухучету)
  precious_metals?: boolean; // Содержание драгметаллов (Да / Нет)
  is_under_warranty?: boolean; // Оборудование на гарантии
  warranty_until?: string | null; // Гарантия истекает (YYYY-MM-DD или DD.MM.YYYY)
  warranty_status_ru?: 'Да' | 'Нет'; // Автоматический расчет статуса гарантии
  warranty_expired?: boolean; // Истекла ли гарантия на текущий момент
  is_kit_part?: boolean; // Часть комплекта (стоимость не указывается отдельно в накладной)
  notes?: string; // Примечание
  [key: string]: any;
}

export interface Equipment {
  id: number;
  inventory_number: string | null;
  name: string;
  type_id: number;
  typeName: string;
  recived: string | null;
  initial_cost: number | null;
  residual_cost: number | null;
  room_id: number | null;
  roomNumber: string | null;
  roomFloor: number | null;
  additional_fields: EquipmentAdditionalFields;
  writeoffState?: WriteoffState | null;
  writeoffDate?: string | null;
  qrCode?: string;
  activeTransfer?: {
    id: number;
    issued_to: string;
    issued_at: string;
    expected_return_at?: string | null;
  } | null;
  activeIssues?: Array<{
    id: number;
    state: IssueState;
    description: string;
    broken_at: string;
  }>;
  highestIssueState?: IssueState | null;
}

export interface EquipmentIssue {
  id: number;
  equipment_id: number;
  state: IssueState;
  description: string;
  broken_at: string;
  repaired_at?: string | null;
}

export interface EquipmentTransfer {
  id: number;
  equipment_id: number;
  issued_to: string;
  issued_at: string;
  expected_return_at?: string | null;
  returned_at?: string | null;
}

export interface NotificationItem {
  id: number;
  created_at: string;
  is_read: boolean;
  issueId: number;
  state: IssueState;
  description: string;
  broken_at: string;
  equipmentId: number;
  equipmentName: string;
  inventoryNumber: string | null;
}

export interface ActiveAudit {
  id: number;
  auditor_ext_id: number;
  started_at: string;
  finished_at?: string | null;
  totalCount: number;
  verifiedCount: number;
  pendingCount: number;
}

export interface InventoryHistoryItem {
  id: number;
  auditor_ext_id: number;
  auditorLogin?: string | null;
  started_at: string;
  finished_at: string;
  totalCount: number;
  verifiedCount: number;
  pendingCount: number;
}

export type AuditCategory =
  | 'AUTH'
  | 'SECURITY'
  | 'ADMIN'
  | 'EQUIPMENT'
  | 'MAINTENANCE'
  | 'TRANSFER'
  | 'INVENTORY'
  | 'WRITEOFF'
  | 'DOCUMENT';

export type AuditSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface AuditLogCapabilities {
  role: UserRole;
  roleLabel: string;
  scope: 'ALL' | 'OPERATIONAL' | 'OWN';
  scopeTitle: string;
  scopeDescription: string;
  allowedCategories: AuditCategory[];
  canViewAllUsers: boolean;
  canViewSecurityEvents: boolean;
  canViewTechnicalMeta: boolean;
  canExport: boolean;
  canPurge: boolean;
}

export interface AuditLogItem {
  id: number;
  created_at: string;
  actor_id: number | null;
  actor_login: string | null;
  actor_role: string | null;
  action: string;
  category: AuditCategory;
  severity: AuditSeverity;
  entity_type: string | null;
  entity_id: string | null;
  entity_label: string | null;
  summary: string;
  details: Record<string, any> | null;
  ip_address?: string | null;
  user_agent?: string | null;
}

export interface AuditLogsResponse {
  items: AuditLogItem[];
  total: number;
  page: number;
  totalPages: number;
  stats: {
    total: number;
    info: number;
    warning: number;
    critical: number;
  };
  capabilities: AuditLogCapabilities;
  actors?: Array<{ id: number | null; login: string; role: string }>;
}
