export type UserRole = 'ADMIN' | 'ENGINEER' | 'USER';

export interface User {
  id: number;
  login: string;
  role: UserRole;
}

export interface Room {
  id: number;
  number: string;
  floor: number;
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
  type_id: number;
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
  | 'Вышло из строя (ремонт возможен)'
  | 'Неремонтопригодно'
  | string;
export type AccountingCategory =
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
  notes?: string; // Примечание
  [key: string]: any;
}

export interface Equipment {
  id: number;
  inventory_number: string;
  name: string;
  type_id: number;
  typeName: string;
  recived: string;
  initial_cost: number;
  residual_cost: number;
  room_id: number;
  roomNumber: string;
  roomFloor: number;
  additional_fields: EquipmentAdditionalFields;
  writeoffState?: WriteoffState | null;
  writeoffDate?: string | null;
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
  inventoryNumber: string;
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
