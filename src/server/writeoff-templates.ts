import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { writeoffTemplates } from '../db/schema.ts';

export type WriteoffTemplateKey =
  | 'case1_act'
  | 'case1_invoice'
  | 'case2_act'
  | 'case2_invoice'
  | 'case3_act';

export interface SignatoryEntry {
  title: string;
  name: string;
}

export interface TemplateRequisites {
  organization?: string;
  department?: string;
  orderNumber?: string;
  orderDateText?: string;
  approverRole?: string;
  approverName?: string;
  commissionChair?: SignatoryEntry;
  commissionMembers?: SignatoryEntry[];
  mol?: SignatoryEntry;
  sender?: string;
  recipient?: string;
  senderSign?: SignatoryEntry;
  recipientSign?: SignatoryEntry;
  chiefAccountantName?: string;
  conclusionText?: string;
  recycleDecisionText?: string;
}

export interface TemplatePlaceholderDoc {
  token: string;
  label: string;
  scope: 'document' | 'item';
}

export interface TemplateDefinition {
  key: WriteoffTemplateKey;
  title: string;
  description: string;
  kind: 'act' | 'invoice';
  defaultFileName: string;
  defaultRequisites: TemplateRequisites;
  placeholders: TemplatePlaceholderDoc[];
}

export const WRITEOFF_TEMPLATE_KEYS: WriteoffTemplateKey[] = [
  'case1_act',
  'case1_invoice',
  'case2_act',
  'case2_invoice',
  'case3_act',
];

export const WRITEOFF_TEMPLATE_DEFINITIONS: Record<WriteoffTemplateKey, TemplateDefinition> = {
  case1_act: {
    key: 'case1_act',
    title: 'Кейс 1: Акт о списании имущества',
    description: 'Дорогостоящее оборудование с ДМ (альбомный лист А4 на каждую единицу)',
    kind: 'act',
    defaultFileName: 'shablon-akt-spisaniya-case1.docx',
    defaultRequisites: {
      organization: 'ВГУ имени П.М.Машерова',
      approverRole: 'Руководитель организации\nРектор ВГУ\nимени П.М.Машерова',
      approverName: 'В.В.Богатырёва',
      commissionChair: { title: 'Проректор', name: 'Раловец А.И' },
      commissionMembers: [
        { title: 'Зам начальника ЦБУиФ', name: 'Долгополова Т.В' },
        { title: 'Начальник ЦИТ', name: 'Мателенок Д.М.' },
        { title: 'Ведущий инженер энергетик', name: 'Яцук А.Г.' },
        { title: 'Бухгалтер', name: 'Сас К.А.' },
      ],
      mol: { title: 'Заведующий кафедрой ПиСП', name: 'Ермоченко С.А.' },
      conclusionText:
        'данное оборудование к дальнейшей эксплуатации не пригодно, списать с баланса учреждения.',
      recycleDecisionText:
        'Принято решение о передаче списанного оборудования. Сдать на переработку в полной комплектации без изъятия деталей, узлов и комплектующих изделий, содержащих драгметаллы.',
    },
    placeholders: [
      { token: '{{ACT_NUMBER}}', label: 'Номер акта (с дробью при пакетной выгрузке)', scope: 'item' },
      { token: '{{WRITEOFF_DATE}}', label: 'Дата составления / списания (ДД.ММ.ГГГГ)', scope: 'item' },
      { token: '{{WRITEOFF_YEAR_SHORT}}', label: 'Две последние цифры года (напр. 26)', scope: 'item' },
      { token: '{{ITEM_NAME}}', label: 'Наименование объекта основных средств (по бухгалтерии)', scope: 'item' },
      { token: '{{ITEM_INVENTORY_NUMBER}}', label: 'Инвентарный номер (или «б/н»)', scope: 'item' },
      { token: '{{ITEM_SERVICE_LIFE}}', label: 'Фактический срок эксплуатации (лет, месяцев)', scope: 'item' },
      { token: '{{ITEM_INITIAL_COST}}', label: 'Первоначальная стоимость, руб. коп.', scope: 'item' },
      { token: '{{ITEM_ACCUMULATED_AMORTIZATION}}', label: 'Сумма накопленной амортизации', scope: 'item' },
      { token: '{{ITEM_RESIDUAL_COST}}', label: 'Остаточная стоимость', scope: 'item' },
      { token: '{{REASON}}', label: 'Основание для списания', scope: 'document' },
      { token: '{{TECH_CONCLUSION_TEXT}}', label: 'Строка «Техническое заключение № ...»', scope: 'document' },
    ],
  },
  case1_invoice: {
    key: 'case1_invoice',
    title: 'Кейс 1: Накладная ОКУД 0501460',
    description: 'Внутреннее перемещение объектов основных средств в ЦИТ (многострочная таблица)',
    kind: 'invoice',
    defaultFileName: 'shablon-nakladnaya-0501460-case1.docx',
    defaultRequisites: {
      organization: 'ВГУ имени П.М.Машерова',
      sender: 'Кафедра ПиСП',
      recipient: 'ЦИТ',
      senderSign: { title: 'Заведующий каф. ПиСП', name: 'Ермоченко С.А.' },
      recipientSign: { title: 'Нач.отд. ПТО и ЭУС ЦИТ (Д/М)', name: 'Фунтикова Т.Г.' },
      chiefAccountantName: 'Л.Н.Прокопкина',
    },
    placeholders: [
      { token: '{{DOC_NUMBER}}', label: 'Номер накладной', scope: 'document' },
      { token: '{{DOC_DATE}}', label: 'Дата составления (ДД.ММ.ГГГГ)', scope: 'document' },
      { token: '{{SENDER}}', label: 'Сдатчик (структурное подразделение)', scope: 'document' },
      { token: '{{RECIPIENT}}', label: 'Получатель (структурное подразделение)', scope: 'document' },
      { token: '{{NOTE}}', label: 'Примечание о техническом состоянии', scope: 'document' },
      { token: '{{TOTAL_QTY}}', label: 'Итого количество (шт.)', scope: 'document' },
      { token: '{{TOTAL_SUM}}', label: 'Итого сумма, руб.', scope: 'document' },
      { token: '{{ROW_NUM}}', label: '№ п/п в строке таблицы', scope: 'item' },
      { token: '{{ITEM_NAME}}', label: 'Наименование объекта', scope: 'item' },
      { token: '{{ITEM_RECEIVED_DATE}}', label: 'Дата приобретения (ввода)', scope: 'item' },
      { token: '{{ITEM_INVENTORY_NUMBER}}', label: 'Инвентарный номер (или «б/н»)', scope: 'item' },
      { token: '{{ITEM_QTY}}', label: 'Количество, шт.', scope: 'item' },
      { token: '{{ITEM_UNIT_COST}}', label: 'Стоимость единицы (пусто для части комплекта)', scope: 'item' },
      { token: '{{ITEM_TOTAL_COST}}', label: 'Стоимость всего (пусто для части комплекта)', scope: 'item' },
    ],
  },
  case2_act: {
    key: 'case2_act',
    title: 'Кейс 2: Акт на списание малоценки (с ДМ)',
    description: 'Отдельные предметы в составе оборотных средств с ДМ (лицевая и оборотная стороны)',
    kind: 'act',
    defaultFileName: 'shablon-akt-malotsenka-case2.docx',
    defaultRequisites: {
      organization: 'Витебский государственный университет\nимени П.М. Машерова',
      orderNumber: '322',
      orderDateText: '" 22 " сентября',
      approverRole: 'Ректор        ВГУ имени П.М. Машерова',
      approverName: 'Богатырёва В.В.',
      commissionChair: { title: 'Проректор', name: 'А.И. Раловец' },
      commissionMembers: [
        { title: 'Зам. нач. ЦБУ и Ф', name: 'Д.А. Лукин' },
        { title: 'Начальник ЦИТ', name: 'Д.М. Мателенок' },
        { title: 'Бухгалтер ЦБУ и Ф', name: 'Т.Л. Русецкая' },
        { title: 'Ведущий инженер-энергетик', name: 'А.Г. Яцук' },
      ],
      mol: { title: 'Материально - ответственное лицо', name: 'С.А. Ермоченко' },
    },
    placeholders: [
      { token: '{{WRITEOFF_YEAR}}', label: 'Год списания (4 цифры)', scope: 'item' },
      { token: '{{ITEM_NAME}}', label: 'Наименование предмета (по бухгалтерии)', scope: 'item' },
      { token: '{{ITEM_INVENTORY_NUMBER}}', label: 'Инвентарный номер', scope: 'item' },
      { token: '{{ITEM_QTY}}', label: 'Количество', scope: 'item' },
      { token: '{{ITEM_RECEIVED_DATE}}', label: 'Дата поступления', scope: 'item' },
      { token: '{{ITEM_UNIT_COST}}', label: 'Цена (с 2 знаками после запятой)', scope: 'item' },
      { token: '{{ITEM_TOTAL_COST}}', label: 'Сумма (Цена × Количество)', scope: 'item' },
      { token: '{{ITEM_SERVICE_LIFE}}', label: 'Срок службы', scope: 'item' },
      { token: '{{REASON}}', label: 'Причина списания', scope: 'item' },
      { token: '{{TECH_CONCLUSION}}', label: 'Номер технического заключения', scope: 'document' },
    ],
  },
  case2_invoice: {
    key: 'case2_invoice',
    title: 'Кейс 2: Накладная (требование) Форма № 434',
    description: 'Накладная-требование для малоценки (многострочная таблица с количеством и суммой)',
    kind: 'invoice',
    defaultFileName: 'shablon-nakladnaya-434-case2.docx',
    defaultRequisites: {
      organization: 'ВГУ имени П.М. Машерова',
      department: 'Кафедра ПиСП',
      mol: { title: 'Зав. каф. ПиСП', name: 'Ермоченко С.А.' },
      senderSign: { title: 'Зав. каф. ПиСП', name: 'Ермоченко С.А.' },
      recipientSign: { title: 'Нач. отд. ПТО и ЭУС ЦИТ (Д/М)', name: 'Фунтикова Т.Г.' },
    },
    placeholders: [
      { token: '{{DOC_NUMBER}}', label: 'Номер накладной', scope: 'document' },
      { token: '{{DOC_YEAR}}', label: 'Год документа', scope: 'document' },
      { token: '{{DEPARTMENT}}', label: 'Отделение / кафедра', scope: 'document' },
      { token: '{{ITEM_NAME}}', label: 'Наименование материальных ценностей', scope: 'item' },
      { token: '{{ITEM_UNIT}}', label: 'Единица измерения (шт.)', scope: 'item' },
      { token: '{{ITEM_INVENTORY_NUMBER}}', label: 'Номенклатурный / инвентарный номер', scope: 'item' },
      { token: '{{ITEM_QTY}}', label: 'Количество (затребовано / отпущено)', scope: 'item' },
      { token: '{{ITEM_UNIT_COST}}', label: 'Цена', scope: 'item' },
      { token: '{{ITEM_TOTAL_COST}}', label: 'Сумма', scope: 'item' },
    ],
  },
  case3_act: {
    key: 'case3_act',
    title: 'Кейс 3: Акт списания малоценки (без ДМ)',
    description: 'Общий акт на группу предметов в составе оборотных средств без ДМ (лицевая и оборотная стороны)',
    kind: 'act',
    defaultFileName: 'shablon-akt-malotsenka-bez-dm-case3.docx',
    defaultRequisites: {
      organization: 'ВГУ имени П.М. Машерова',
      orderNumber: '322',
      orderDateText: '22   сентября',
      approverRole: 'Ректор ВГУ имени П.М. Машерова',
      approverName: 'В.В. Богатырёва',
      commissionChair: { title: 'Проректор', name: 'А.И. Раловец' },
      commissionMembers: [
        { title: 'Зам.нач. ЦБУ и Ф', name: 'Д.А. Лукин' },
        { title: 'Ведущий инж.энергетик', name: 'А.Г. Яцук' },
        { title: 'Бухгалтер ЦБУ и Ф', name: 'Т.Л. Русецкая' },
      ],
      mol: { title: 'МОЛ', name: 'С.А. Ермоченко' },
    },
    placeholders: [
      { token: '{{ACT_NUMBER}}', label: 'Номер акта', scope: 'document' },
      { token: '{{WRITEOFF_YEAR}}', label: 'Год составления акта', scope: 'document' },
      { token: '{{ITEM_NAME}}', label: 'Наименование предмета (по бухгалтерии)', scope: 'item' },
      { token: '{{ITEM_INVENTORY_NUMBER}}', label: 'Код (инвентарный / номенклатурный номер)', scope: 'item' },
      { token: '{{ITEM_UNIT}}', label: 'Единица измерения (шт.)', scope: 'item' },
      { token: '{{ITEM_RECEIVED_DATE}}', label: 'Дата поступления в эксплуатацию', scope: 'item' },
      { token: '{{ITEM_QTY}}', label: 'Количество', scope: 'item' },
      { token: '{{ITEM_UNIT_COST}}', label: 'Цена', scope: 'item' },
      { token: '{{ITEM_TOTAL_COST}}', label: 'Сумма', scope: 'item' },
    ],
  },
};

export function isValidWriteoffTemplateKey(key: string): key is WriteoffTemplateKey {
  return WRITEOFF_TEMPLATE_KEYS.includes(key as WriteoffTemplateKey);
}

export function mergeRequisites(
  key: WriteoffTemplateKey,
  stored?: Record<string, any> | null
): TemplateRequisites {
  const def = WRITEOFF_TEMPLATE_DEFINITIONS[key].defaultRequisites;
  if (!stored || typeof stored !== 'object') {
    return structuredClone(def);
  }
  const merged: TemplateRequisites = {
    ...structuredClone(def),
    ...stored,
  };
  if (stored.commissionChair && typeof stored.commissionChair === 'object') {
    merged.commissionChair = {
      title: String(stored.commissionChair.title ?? def.commissionChair?.title ?? ''),
      name: String(stored.commissionChair.name ?? def.commissionChair?.name ?? ''),
    };
  }
  if (Array.isArray(stored.commissionMembers)) {
    merged.commissionMembers = stored.commissionMembers.map((m: any) => ({
      title: String(m?.title ?? ''),
      name: String(m?.name ?? ''),
    }));
  }
  if (stored.mol && typeof stored.mol === 'object') {
    merged.mol = {
      title: String(stored.mol.title ?? def.mol?.title ?? ''),
      name: String(stored.mol.name ?? def.mol?.name ?? ''),
    };
  }
  if (stored.senderSign && typeof stored.senderSign === 'object') {
    merged.senderSign = {
      title: String(stored.senderSign.title ?? def.senderSign?.title ?? ''),
      name: String(stored.senderSign.name ?? def.senderSign?.name ?? ''),
    };
  }
  if (stored.recipientSign && typeof stored.recipientSign === 'object') {
    merged.recipientSign = {
      title: String(stored.recipientSign.title ?? def.recipientSign?.title ?? ''),
      name: String(stored.recipientSign.name ?? def.recipientSign?.name ?? ''),
    };
  }
  return merged;
}

export interface LoadedTemplateState {
  key: WriteoffTemplateKey;
  title: string;
  description: string;
  kind: 'act' | 'invoice';
  defaultFileName: string;
  requisites: TemplateRequisites;
  defaultRequisites: TemplateRequisites;
  hasCustomDocx: boolean;
  customFileName: string | null;
  customDocxBuffer: Buffer | null;
  updatedAt: string | null;
  updatedBy: string | null;
  placeholders: TemplatePlaceholderDoc[];
}

type WriteoffTemplateRow = typeof writeoffTemplates.$inferSelect;

export async function getAllWriteoffTemplates(): Promise<LoadedTemplateState[]> {
  const rows: WriteoffTemplateRow[] = await db.select().from(writeoffTemplates);
  const byKey = new Map<string, WriteoffTemplateRow>(rows.map((r) => [r.template_key, r]));

  return WRITEOFF_TEMPLATE_KEYS.map((key) => {
    const def = WRITEOFF_TEMPLATE_DEFINITIONS[key];
    const row = byKey.get(key);
    const hasCustom = Boolean(row?.custom_docx_base64);
    return {
      key,
      title: def.title,
      description: def.description,
      kind: def.kind,
      defaultFileName: def.defaultFileName,
      requisites: mergeRequisites(key, row?.requisites),
      defaultRequisites: structuredClone(def.defaultRequisites),
      hasCustomDocx: hasCustom,
      customFileName: row?.custom_file_name || null,
      customDocxBuffer: hasCustom && row?.custom_docx_base64 ? Buffer.from(row.custom_docx_base64, 'base64') : null,
      updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
      updatedBy: row?.updated_by || null,
      placeholders: def.placeholders,
    };
  });
}

export async function getWriteoffTemplate(key: WriteoffTemplateKey): Promise<LoadedTemplateState> {
  const def = WRITEOFF_TEMPLATE_DEFINITIONS[key];
  const [row]: WriteoffTemplateRow[] = await db
    .select()
    .from(writeoffTemplates)
    .where(eq(writeoffTemplates.template_key, key))
    .limit(1);

  const hasCustom = Boolean(row?.custom_docx_base64);
  return {
    key,
    title: def.title,
    description: def.description,
    kind: def.kind,
    defaultFileName: def.defaultFileName,
    requisites: mergeRequisites(key, row?.requisites),
    defaultRequisites: structuredClone(def.defaultRequisites),
    hasCustomDocx: hasCustom,
    customFileName: row?.custom_file_name || null,
    customDocxBuffer: hasCustom && row?.custom_docx_base64 ? Buffer.from(row.custom_docx_base64, 'base64') : null,
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
    updatedBy: row?.updated_by || null,
    placeholders: def.placeholders,
  };
}

export async function saveTemplateRequisites(
  key: WriteoffTemplateKey,
  requisites: TemplateRequisites,
  actorLogin: string
): Promise<void> {
  const def = WRITEOFF_TEMPLATE_DEFINITIONS[key];
  const sanitized = mergeRequisites(key, requisites as Record<string, any>);
  const [existing] = await db
    .select({ template_key: writeoffTemplates.template_key })
    .from(writeoffTemplates)
    .where(eq(writeoffTemplates.template_key, key))
    .limit(1);

  if (existing) {
    await db
      .update(writeoffTemplates)
      .set({
        requisites: sanitized as Record<string, any>,
        updated_at: new Date(),
        updated_by: actorLogin,
      })
      .where(eq(writeoffTemplates.template_key, key));
  } else {
    await db.insert(writeoffTemplates).values({
      template_key: key,
      title: def.title,
      description: def.description,
      requisites: sanitized as Record<string, any>,
      custom_docx_base64: null,
      custom_file_name: null,
      updated_at: new Date(),
      updated_by: actorLogin,
    });
  }
}

export async function saveCustomTemplateDocx(
  key: WriteoffTemplateKey,
  fileBuffer: Buffer,
  fileName: string,
  actorLogin: string
): Promise<void> {
  const def = WRITEOFF_TEMPLATE_DEFINITIONS[key];
  const base64 = fileBuffer.toString('base64');
  const [existing] = await db
    .select({ template_key: writeoffTemplates.template_key })
    .from(writeoffTemplates)
    .where(eq(writeoffTemplates.template_key, key))
    .limit(1);

  if (existing) {
    await db
      .update(writeoffTemplates)
      .set({
        custom_docx_base64: base64,
        custom_file_name: fileName,
        updated_at: new Date(),
        updated_by: actorLogin,
      })
      .where(eq(writeoffTemplates.template_key, key));
  } else {
    await db.insert(writeoffTemplates).values({
      template_key: key,
      title: def.title,
      description: def.description,
      requisites: structuredClone(def.defaultRequisites) as Record<string, any>,
      custom_docx_base64: base64,
      custom_file_name: fileName,
      updated_at: new Date(),
      updated_by: actorLogin,
    });
  }
}

export async function clearCustomTemplateDocx(
  key: WriteoffTemplateKey,
  actorLogin: string
): Promise<void> {
  const [existing] = await db
    .select({ template_key: writeoffTemplates.template_key })
    .from(writeoffTemplates)
    .where(eq(writeoffTemplates.template_key, key))
    .limit(1);

  if (existing) {
    await db
      .update(writeoffTemplates)
      .set({
        custom_docx_base64: null,
        custom_file_name: null,
        updated_at: new Date(),
        updated_by: actorLogin,
      })
      .where(eq(writeoffTemplates.template_key, key));
  }
}
