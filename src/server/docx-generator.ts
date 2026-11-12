import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  PageBreak,
  PageOrientation,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import QRCode from 'qrcode';

export interface EquipmentForDocx {
  id: number;
  inventory_number: string;
  name: string;
  typeName: string;
  roomNumber: string;
  initial_cost: number | string;
  residual_cost: number | string;
  recivedDate: string;
  recivedRaw?: Date | string | null;
  additional_fields?: Record<string, any> | null;
  writeoffDate?: Date | string | null;
}

export interface WriteoffDocxOptions {
  writeoffDate?: Date | string | null;
  reason?: string;
  organization?: string;
  department?: string;
  actDate?: Date | string | null;
  technicalConclusionNumber?: string;
}

export interface TransferInvoiceOptions {
  invoiceNumber?: string;
  invoiceDate?: Date | string | null;
  organization?: string;
  sender?: string;
  recipient?: string;
  note?: string;
}

const THIN_BLACK_BORDER = {
  style: BorderStyle.SINGLE,
  size: 4,
  color: '000000',
} as const;

const ALL_THIN_BORDERS = {
  top: THIN_BLACK_BORDER,
  bottom: THIN_BLACK_BORDER,
  left: THIN_BLACK_BORDER,
  right: THIN_BLACK_BORDER,
} as const;

const NO_BORDERS = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
} as const;

const BOTTOM_ONLY_BORDER = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: THIN_BLACK_BORDER,
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
} as const;

/**
 * Extracts calendar (year, month 1-12, day 1-31) safely without timezone off-by-one shifts.
 */
function extractCalendarYMD(input: Date | string | null | undefined): {
  year: number;
  month: number;
  day: number;
} {
  if (!input) {
    const now = new Date();
    return {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
    };
  }

  if (typeof input === 'string') {
    const trimmed = input.trim();
    const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      return {
        year: Number(isoMatch[1]),
        month: Number(isoMatch[2]),
        day: Number(isoMatch[3]),
      };
    }
    const ruMatch = trimmed.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    if (ruMatch) {
      return {
        year: Number(ruMatch[3]),
        month: Number(ruMatch[2]),
        day: Number(ruMatch[1]),
      };
    }
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      return {
        year: parsed.getUTCFullYear(),
        month: parsed.getUTCMonth() + 1,
        day: parsed.getUTCDate(),
      };
    }
  }

  if (input instanceof Date && !isNaN(input.getTime())) {
    if (input.getUTCHours() === 0 && input.getUTCMinutes() === 0 && input.getUTCSeconds() === 0) {
      return {
        year: input.getUTCFullYear(),
        month: input.getUTCMonth() + 1,
        day: input.getUTCDate(),
      };
    }
    return {
      year: input.getFullYear(),
      month: input.getMonth() + 1,
      day: input.getDate(),
    };
  }

  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
  };
}

export function formatDateRu(input: Date | string | null | undefined): string {
  if (!input) return '';
  const { year, month, day } = extractCalendarYMD(input);
  return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`;
}

export function formatYearsWordRu(years: number): string {
  const abs = Math.abs(years) % 100;
  const last = abs % 10;
  if (abs >= 11 && abs <= 19) return 'лет';
  if (last === 1) return 'год';
  if (last >= 2 && last <= 4) return 'года';
  return 'лет';
}

/**
 * Computes full completed years and full completed months between commission date and writeoff date.
 * Example: 10.01.2011 -> 21.10.2026 = "15 лет 9 мес."
 */
export function calculateServiceLife(
  startInput: Date | string | null | undefined,
  endInput: Date | string | null | undefined
): { years: number; months: number; formatted: string } {
  if (!startInput) {
    return { years: 0, months: 0, formatted: '—' };
  }
  const start = extractCalendarYMD(startInput);
  const end = extractCalendarYMD(endInput);

  let years = end.year - start.year;
  let months = end.month - start.month;
  if (end.day < start.day) {
    months -= 1;
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  if (years < 0) {
    years = 0;
    months = 0;
  }

  return {
    years,
    months,
    formatted: `${years} ${formatYearsWordRu(years)} ${months} мес.`,
  };
}

/**
 * Formats rubles and kopecks matching accounting documents (e.g. 1210,23 / 1 390,91 / 318).
 */
export function formatRubKop(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const num =
    typeof value === 'number'
      ? value
      : parseFloat(String(value).replace(/\s+/g, '').replace(',', '.'));
  if (isNaN(num)) return '';
  const rounded = Math.round(num * 100) / 100;
  const isWhole = Math.abs(rounded - Math.round(rounded)) < 0.001;
  const fixed = isWhole ? String(Math.round(rounded)) : rounded.toFixed(2);
  const [intPart, decPart] = fixed.split('.');
  const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return decPart !== undefined ? `${formattedInt},${decPart}` : formattedInt;
}

/**
 * Detects whether an equipment item is a component/part of a bundle/kit whose cost is included in the main unit.
 */
export function isKitPartItem(item: {
  name?: string | null;
  additional_fields?: Record<string, any> | null;
}): boolean {
  if (item.additional_fields?.is_kit_part === true) return true;
  if (item.additional_fields?.is_kit_part === false) return false;
  const name = (item.name || '').toLowerCase();
  return /из\s+комплекта/i.test(name);
}

function makeTextParagraph(
  text: string,
  opts?: {
    bold?: boolean;
    italics?: boolean;
    size?: number;
    alignment?: (typeof AlignmentType)[keyof typeof AlignmentType];
    spacingBefore?: number;
    spacingAfter?: number;
  }
): Paragraph {
  return new Paragraph({
    alignment: opts?.alignment ?? AlignmentType.LEFT,
    spacing: {
      before: opts?.spacingBefore ?? 0,
      after: opts?.spacingAfter ?? 0,
    },
    children: [
      new TextRun({
        text,
        font: 'Times New Roman',
        bold: opts?.bold ?? false,
        italics: opts?.italics ?? false,
        size: opts?.size ?? 18,
      }),
    ],
  });
}

function makeCell(
  text: string,
  opts?: {
    width?: number;
    bold?: boolean;
    italics?: boolean;
    size?: number;
    alignment?: (typeof AlignmentType)[keyof typeof AlignmentType];
    verticalAlign?: Exclude<(typeof VerticalAlign)[keyof typeof VerticalAlign], 'both'>;
    borders?: any;
    columnSpan?: number;
    rowSpan?: number;
    margins?: { top?: number; bottom?: number; left?: number; right?: number };
  }
): TableCell {
  return new TableCell({
    width: opts?.width ? { size: opts.width, type: WidthType.DXA } : undefined,
    columnSpan: opts?.columnSpan,
    rowSpan: opts?.rowSpan,
    verticalAlign: opts?.verticalAlign ?? VerticalAlign.CENTER,
    margins: opts?.margins ?? { top: 45, bottom: 45, left: 65, right: 65 },
    borders: opts?.borders ?? ALL_THIN_BORDERS,
    children: [
      makeTextParagraph(text, {
        bold: opts?.bold,
        italics: opts?.italics,
        size: opts?.size ?? 18,
        alignment: opts?.alignment ?? AlignmentType.CENTER,
      }),
    ],
  });
}

export async function generateQrDocx(
  items: EquipmentForDocx[],
  baseUrl: string
): Promise<Buffer> {
  const tableRows: TableRow[] = [];

  for (let i = 0; i < items.length; i += 2) {
    const pair = items.slice(i, i + 2);
    const cells: TableCell[] = [];

    for (const item of pair) {
      const qrUrl = `${baseUrl.replace(/\/$/, '')}/q/EQ-${item.id}`;
      const qrBuffer = await QRCode.toBuffer(qrUrl, {
        width: 180,
        margin: 1,
        errorCorrectionLevel: 'M',
      });

      const cell = new TableCell({
        width: { size: 4500, type: WidthType.DXA },
        margins: { top: 180, bottom: 180, left: 180, right: 180 },
        borders: {
          top: { style: BorderStyle.SINGLE, size: 8, color: '64748B' },
          bottom: { style: BorderStyle.SINGLE, size: 8, color: '64748B' },
          left: { style: BorderStyle.SINGLE, size: 8, color: '64748B' },
          right: { style: BorderStyle.SINGLE, size: 8, color: '64748B' },
        },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: 'КАФЕДРАЛЬНЫЙ УЧЕТ',
                size: 16,
                bold: true,
                color: '475569',
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: item.name,
                bold: true,
                size: 22,
                color: '0F172A',
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 80, after: 80 },
            children: [
              new ImageRun({
                data: qrBuffer,
                transformation: { width: 140, height: 140 },
                type: 'png',
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: `Инв. №: `,
                bold: true,
                size: 20,
              }),
              new TextRun({
                text: item.inventory_number,
                bold: true,
                size: 20,
                color: '1E40AF',
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 40 },
            children: [
              new TextRun({
                text: `Тип: ${item.typeName} | Кабинет: ${item.roomNumber}`,
                size: 16,
                color: '64748B',
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 40 },
            children: [
              new TextRun({
                text: `Шлюз: /q/EQ-${item.id}`,
                size: 14,
                color: '94A3B8',
              }),
            ],
          }),
        ],
      });
      cells.push(cell);
    }

    if (cells.length === 1) {
      cells.push(
        new TableCell({
          width: { size: 4500, type: WidthType.DXA },
          borders: NO_BORDERS,
          children: [new Paragraph({})],
        })
      );
    }

    tableRows.push(new TableRow({ children: cells }));
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
            children: [
              new TextRun({
                text: 'ИС «Учет материальных ценностей»',
                bold: true,
                size: 28,
                color: '1E3A8A',
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 300 },
            children: [
              new TextRun({
                text: `Инвентарные этикетки и QR-коды для оборудования кафедры (${items.length} шт.)`,
                italics: true,
                size: 20,
                color: '475569',
              }),
            ],
          }),
          new Table({
            rows: tableRows,
            width: { size: 9000, type: WidthType.DXA },
          }),
        ],
      },
    ],
  });

  return await Packer.toBuffer(doc);
}

/**
 * Case 1: «АКТ О СПИСАНИИ ИМУЩЕСТВА»
 * One separate Act section (A4 Landscape page) is generated for EACH equipment unit.
 */
export async function generateWriteoffDocx(
  items: EquipmentForDocx[],
  actNumber: string,
  options: WriteoffDocxOptions = {}
): Promise<Buffer> {
  const organization = options.organization || 'ВГУ имени П.М.Машерова';
  const defaultDate = options.actDate || options.writeoffDate || new Date();
  const reason = options.reason || 'начисленная амортизация составляет 100%';
  const techConclusion = options.technicalConclusionNumber || '';

  const sections = items.map((item, idx) => {
    const effectiveWriteoffDate =
      options.writeoffDate || item.writeoffDate || options.actDate || defaultDate;
    const { year: actYear } = extractCalendarYMD(effectiveWriteoffDate);
    const serviceLife = calculateServiceLife(
      item.recivedRaw || item.recivedDate,
      effectiveWriteoffDate
    );
    const accountingName =
      item.additional_fields?.['Наименование (по бухгалтерии)'] || item.name;
    const initialCostFormatted = formatRubKop(item.initial_cost);
    const itemActNumber =
      items.length > 1 && actNumber && !actNumber.includes('ПРИМЕР')
        ? `${actNumber}/${idx + 1}`
        : actNumber;
    const yearSuffix = String(actYear).slice(-2);

    // Top organization line
    const orgTable = new Table({
      width: { size: 15438, type: WidthType.DXA },
      rows: [
        new TableRow({
          children: [
            makeCell('Организация', {
              width: 1400,
              size: 18,
              alignment: AlignmentType.LEFT,
              borders: NO_BORDERS,
              margins: { top: 20, bottom: 20, left: 0, right: 40 },
            }),
            makeCell(organization, {
              width: 5800,
              size: 18,
              alignment: AlignmentType.CENTER,
              borders: BOTTOM_ONLY_BORDER,
              margins: { top: 20, bottom: 20, left: 40, right: 40 },
            }),
            makeCell('', {
              width: 8238,
              size: 18,
              borders: NO_BORDERS,
            }),
          ],
        }),
        new TableRow({
          children: [
            makeCell('', { width: 1400, borders: NO_BORDERS, margins: { top: 0, bottom: 40 } }),
            makeCell('(наименование)', {
              width: 5800,
              size: 14,
              italics: true,
              alignment: AlignmentType.CENTER,
              borders: NO_BORDERS,
              margins: { top: 0, bottom: 40 },
            }),
            makeCell('', { width: 8238, borders: NO_BORDERS, margins: { top: 0, bottom: 40 } }),
          ],
        }),
      ],
    });

    // Header block: Title (left) + Number/Date box (center) + Approval (right)
    const numDateBox = new Table({
      width: { size: 4200, type: WidthType.DXA },
      rows: [
        new TableRow({
          children: [
            makeCell('Номер', { width: 1900, bold: true, size: 18 }),
            makeCell('Дата составления', { width: 2300, bold: true, size: 18 }),
          ],
        }),
        new TableRow({
          children: [
            makeCell(itemActNumber || '', {
              width: 1900,
              size: 18,
              margins: { top: 80, bottom: 80, left: 40, right: 40 },
            }),
            makeCell(formatDateRu(effectiveWriteoffDate), {
              width: 2300,
              size: 18,
              margins: { top: 80, bottom: 80, left: 40, right: 40 },
            }),
          ],
        }),
      ],
    });

    const approvalSignTable = new Table({
      width: { size: 6000, type: WidthType.DXA },
      rows: [
        new TableRow({
          children: [
            makeCell('', { width: 2300, size: 18, borders: BOTTOM_ONLY_BORDER, margins: { top: 60, bottom: 20 } }),
            makeCell('', { width: 200, borders: NO_BORDERS }),
            makeCell('', { width: 1400, size: 18, borders: BOTTOM_ONLY_BORDER, margins: { top: 60, bottom: 20 } }),
            makeCell('', { width: 200, borders: NO_BORDERS }),
            makeCell('В.В.Богатырёва', {
              width: 1900,
              size: 18,
              alignment: AlignmentType.CENTER,
              borders: BOTTOM_ONLY_BORDER,
              margins: { top: 60, bottom: 20 },
            }),
          ],
        }),
        new TableRow({
          children: [
            makeCell('М.П.', { width: 2300, size: 14, borders: NO_BORDERS, margins: { top: 0, bottom: 40 } }),
            makeCell('', { width: 200, borders: NO_BORDERS, margins: { top: 0, bottom: 40 } }),
            makeCell('(подпись)', { width: 1400, size: 14, italics: true, borders: NO_BORDERS, margins: { top: 0, bottom: 40 } }),
            makeCell('', { width: 200, borders: NO_BORDERS, margins: { top: 0, bottom: 40 } }),
            makeCell('(фамилия, инициалы)', { width: 1900, size: 14, italics: true, borders: NO_BORDERS, margins: { top: 0, bottom: 40 } }),
          ],
        }),
      ],
    });

    const headerGrid = new Table({
      width: { size: 15438, type: WidthType.DXA },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: 4600, type: WidthType.DXA },
              borders: NO_BORDERS,
              verticalAlign: VerticalAlign.CENTER,
              children: [
                makeTextParagraph('АКТ', { bold: true, size: 22, alignment: AlignmentType.CENTER }),
                makeTextParagraph('О СПИСАНИИ ИМУЩЕСТВА', {
                  bold: true,
                  size: 22,
                  alignment: AlignmentType.CENTER,
                  spacingBefore: 40,
                }),
              ],
            }),
            new TableCell({
              width: { size: 4538, type: WidthType.DXA },
              borders: NO_BORDERS,
              verticalAlign: VerticalAlign.TOP,
              children: [numDateBox],
            }),
            new TableCell({
              width: { size: 6300, type: WidthType.DXA },
              borders: NO_BORDERS,
              verticalAlign: VerticalAlign.TOP,
              children: [
                makeTextParagraph('УТВЕРЖДАЮ', { size: 18 }),
                makeTextParagraph('Руководитель организации', { size: 18 }),
                makeTextParagraph('Ректор ВГУ', { size: 18 }),
                makeTextParagraph('имени П.М.Машерова', { size: 18, spacingAfter: 40 }),
                approvalSignTable,
                makeTextParagraph(`" ____ " _________________ 20${yearSuffix} г.`, {
                  size: 18,
                  spacingBefore: 20,
                }),
              ],
            }),
          ],
        }),
      ],
    });

    // Section 1 Table (7 columns)
    const section1Table = new Table({
      width: { size: 15438, type: WidthType.DXA },
      rows: [
        new TableRow({
          cantSplit: true,
          children: [
            makeCell('Наименование объекта основных средств', { width: 3400, bold: true, size: 17 }),
            makeCell('Инвентарный номер', { width: 1900, bold: true, size: 17 }),
            makeCell('Фактический срок эксплуатации (лет, месяцев)', { width: 2100, bold: true, size: 17 }),
            makeCell('Первоначальная (переоцененная) стоимость, руб.коп', { width: 2000, bold: true, size: 17 }),
            makeCell('Сумма накопленной амортизации, руб.коп', { width: 2000, bold: true, size: 17 }),
            makeCell('Остаточная (ликвидационная) стоимость, руб. коп', { width: 1800, bold: true, size: 17 }),
            makeCell('Основание для списания', { width: 2238, bold: true, size: 17 }),
          ],
        }),
        new TableRow({
          cantSplit: true,
          children: [
            makeCell('1', { width: 3400, bold: true, size: 17 }),
            makeCell('2', { width: 1900, bold: true, size: 17 }),
            makeCell('3', { width: 2100, bold: true, size: 17 }),
            makeCell('4', { width: 2000, bold: true, size: 17 }),
            makeCell('5', { width: 2000, bold: true, size: 17 }),
            makeCell('6', { width: 1800, bold: true, size: 17 }),
            makeCell('7', { width: 2238, bold: true, size: 17 }),
          ],
        }),
        new TableRow({
          cantSplit: true,
          children: [
            makeCell(accountingName, {
              width: 3400,
              size: 18,
              alignment: AlignmentType.CENTER,
              margins: { top: 80, bottom: 80, left: 60, right: 60 },
            }),
            makeCell(item.inventory_number, {
              width: 1900,
              size: 18,
              alignment: AlignmentType.CENTER,
              margins: { top: 80, bottom: 80, left: 60, right: 60 },
            }),
            makeCell(serviceLife.formatted, {
              width: 2100,
              size: 18,
              alignment: AlignmentType.CENTER,
              margins: { top: 80, bottom: 80, left: 60, right: 60 },
            }),
            makeCell(initialCostFormatted, {
              width: 2000,
              size: 18,
              alignment: AlignmentType.CENTER,
              margins: { top: 80, bottom: 80, left: 60, right: 60 },
            }),
            makeCell(initialCostFormatted, {
              width: 2000,
              size: 18,
              alignment: AlignmentType.CENTER,
              margins: { top: 80, bottom: 80, left: 60, right: 60 },
            }),
            makeCell('', {
              width: 1800,
              size: 18,
              alignment: AlignmentType.CENTER,
              margins: { top: 80, bottom: 80, left: 60, right: 60 },
            }),
            makeCell(reason, {
              width: 2238,
              size: 17,
              alignment: AlignmentType.CENTER,
              margins: { top: 80, bottom: 80, left: 60, right: 60 },
            }),
          ],
        }),
      ],
    });

    // Section 2 Table (6 columns — Construction in progress, blank)
    const section2Table = new Table({
      width: { size: 15438, type: WidthType.DXA },
      rows: [
        new TableRow({
          cantSplit: true,
          children: [
            makeCell('Наименование объекта незавершенного строительства', {
              width: 4000,
              bold: true,
              size: 17,
              rowSpan: 2,
            }),
            makeCell('Дата начала строительства', {
              width: 1800,
              bold: true,
              size: 17,
              rowSpan: 2,
            }),
            makeCell('Срок строительства', {
              width: 4000,
              bold: true,
              size: 17,
              columnSpan: 2,
            }),
            makeCell(
              'Стоимость объекта незавершенного строительства (здания, сооружения и других частей объекта), руб. коп',
              {
                width: 3100,
                bold: true,
                size: 16,
                rowSpan: 2,
              }
            ),
            makeCell('Основание для списания', {
              width: 2538,
              bold: true,
              size: 17,
              rowSpan: 2,
            }),
          ],
        }),
        new TableRow({
          cantSplit: true,
          children: [
            makeCell('нормативный', { width: 2000, bold: true, size: 17 }),
            makeCell('фактический', { width: 2000, bold: true, size: 17 }),
          ],
        }),
        new TableRow({
          cantSplit: true,
          children: [
            makeCell('1', { width: 4000, bold: true, size: 17 }),
            makeCell('2', { width: 1800, bold: true, size: 17 }),
            makeCell('3', { width: 2000, bold: true, size: 17 }),
            makeCell('4', { width: 2000, bold: true, size: 17 }),
            makeCell('5', { width: 3100, bold: true, size: 17 }),
            makeCell('6', { width: 2538, bold: true, size: 17 }),
          ],
        }),
        new TableRow({
          cantSplit: true,
          children: [
            makeCell('', { width: 4000, size: 17, margins: { top: 60, bottom: 60 } }),
            makeCell('', { width: 1800, size: 17, margins: { top: 60, bottom: 60 } }),
            makeCell('', { width: 2000, size: 17, margins: { top: 60, bottom: 60 } }),
            makeCell('', { width: 2000, size: 17, margins: { top: 60, bottom: 60 } }),
            makeCell('', { width: 3100, size: 17, margins: { top: 60, bottom: 60 } }),
            makeCell('', { width: 2538, size: 17, margins: { top: 60, bottom: 60 } }),
          ],
        }),
      ],
    });

    // Commission conclusion & signatories
    const conclusionTable = new Table({
      width: { size: 15438, type: WidthType.DXA },
      rows: [
        new TableRow({
          children: [
            makeCell('Заключение комиссии по списанию имущества:', {
              width: 15438,
              size: 16,
              alignment: AlignmentType.LEFT,
              borders: NO_BORDERS,
              columnSpan: 2,
              margins: { top: 40, bottom: 10 },
            }),
          ],
        }),
        new TableRow({
          children: [
            makeCell(
              'В результате осмотра объекта основных средств (незавершенного строительства) установлено:',
              {
                width: 9800,
                size: 16,
                alignment: AlignmentType.LEFT,
                borders: NO_BORDERS,
                margins: { top: 10, bottom: 10 },
              }
            ),
            makeCell('', {
              width: 5638,
              size: 16,
              borders: BOTTOM_ONLY_BORDER,
              margins: { top: 10, bottom: 10 },
            }),
          ],
        }),
        new TableRow({
          children: [
            makeCell(
              'данное оборудование к дальнейшей эксплуатации не пригодно, списать с баланса учреждения.',
              {
                width: 15438,
                size: 16,
                alignment: AlignmentType.LEFT,
                borders: BOTTOM_ONLY_BORDER,
                columnSpan: 2,
                margins: { top: 20, bottom: 20 },
              }
            ),
          ],
        }),
        new TableRow({
          children: [
            makeCell('Прилагаемые документы :', {
              width: 2800,
              size: 16,
              alignment: AlignmentType.LEFT,
              borders: NO_BORDERS,
              margins: { top: 30, bottom: 20 },
            }),
            makeCell(
              techConclusion
                ? `Техническое заключение № ${techConclusion}`
                : 'Техническое заключение № _______________',
              {
                width: 12638,
                size: 16,
                alignment: AlignmentType.CENTER,
                borders: BOTTOM_ONLY_BORDER,
                margins: { top: 30, bottom: 20 },
              }
            ),
          ],
        }),
      ],
    });

    const commissionRows: Array<[string, string, string]> = [
      ['Председатель комиссии по списанию имущества:', 'Проректор', 'Раловец А.И'],
      ['Члены комиссии по списанию имущества:', 'Зам начальника ЦБУиФ', 'Долгополова Т.В'],
      ['', 'Начальник ЦИТ', 'Мателенок Д.М.'],
      ['', 'Ведущий инженер энергетик', 'Яцук А.Г.'],
      ['', 'Бухгалтер', 'Сас К.А.'],
    ];

    const commissionTableRows: TableRow[] = commissionRows.map(([label, role, person]) => {
      return new TableRow({
        cantSplit: true,
        children: [
          makeCell(label, {
            width: 4400,
            size: 16,
            alignment: AlignmentType.LEFT,
            borders: NO_BORDERS,
            margins: { top: 30, bottom: 15 },
          }),
          makeCell(role, {
            width: 4400,
            size: 17,
            alignment: AlignmentType.CENTER,
            borders: BOTTOM_ONLY_BORDER,
            margins: { top: 30, bottom: 15 },
          }),
          makeCell('', { width: 800, borders: NO_BORDERS, margins: { top: 0, bottom: 0 } }),
          makeCell('', {
            width: 2400,
            size: 17,
            borders: BOTTOM_ONLY_BORDER,
            margins: { top: 30, bottom: 15 },
          }),
          makeCell('', { width: 800, borders: NO_BORDERS, margins: { top: 0, bottom: 0 } }),
          makeCell(person, {
            width: 2638,
            size: 17,
            alignment: AlignmentType.CENTER,
            borders: BOTTOM_ONLY_BORDER,
            margins: { top: 30, bottom: 15 },
          }),
        ],
      });
    });

    commissionTableRows.push(
      new TableRow({
        children: [
          makeCell('', { width: 4400, borders: NO_BORDERS, margins: { top: 0, bottom: 20 } }),
          makeCell('(должность)', { width: 4400, size: 13, italics: true, borders: NO_BORDERS, margins: { top: 0, bottom: 20 } }),
          makeCell('', { width: 800, borders: NO_BORDERS, margins: { top: 0, bottom: 20 } }),
          makeCell('(подпись)', { width: 2400, size: 13, italics: true, borders: NO_BORDERS, margins: { top: 0, bottom: 20 } }),
          makeCell('', { width: 800, borders: NO_BORDERS, margins: { top: 0, bottom: 20 } }),
          makeCell('(фамилия, инициалы)', { width: 2638, size: 13, italics: true, borders: NO_BORDERS, margins: { top: 0, bottom: 20 } }),
        ],
      }),
      new TableRow({
        cantSplit: true,
        children: [
          makeCell('Материально ответственное лицо:', {
            width: 4400,
            size: 16,
            alignment: AlignmentType.LEFT,
            borders: NO_BORDERS,
            margins: { top: 20, bottom: 15 },
          }),
          makeCell('Заведующий кафедрой ПиСП', {
            width: 4400,
            size: 17,
            alignment: AlignmentType.CENTER,
            borders: BOTTOM_ONLY_BORDER,
            margins: { top: 20, bottom: 15 },
          }),
          makeCell('', { width: 800, borders: NO_BORDERS }),
          makeCell('', { width: 2400, size: 17, borders: BOTTOM_ONLY_BORDER, margins: { top: 20, bottom: 15 } }),
          makeCell('', { width: 800, borders: NO_BORDERS }),
          makeCell('Ермоченко С.А.', {
            width: 2638,
            size: 17,
            alignment: AlignmentType.CENTER,
            borders: BOTTOM_ONLY_BORDER,
            margins: { top: 20, bottom: 15 },
          }),
        ],
      }),
      new TableRow({
        children: [
          makeCell('', { width: 4400, borders: NO_BORDERS, margins: { top: 0, bottom: 0 } }),
          makeCell('(должность)', { width: 4400, size: 13, italics: true, borders: NO_BORDERS, margins: { top: 0, bottom: 0 } }),
          makeCell('', { width: 800, borders: NO_BORDERS, margins: { top: 0, bottom: 0 } }),
          makeCell('(подпись)', { width: 2400, size: 13, italics: true, borders: NO_BORDERS, margins: { top: 0, bottom: 0 } }),
          makeCell('', { width: 800, borders: NO_BORDERS, margins: { top: 0, bottom: 0 } }),
          makeCell('(фамилия, инициалы)', { width: 2638, size: 13, italics: true, borders: NO_BORDERS, margins: { top: 0, bottom: 0 } }),
        ],
      })
    );

    const commissionTable = new Table({
      width: { size: 15438, type: WidthType.DXA },
      rows: commissionTableRows,
    });

    return {
      properties: {
        page: {
          size: {
            width: 11906,
            height: 16838,
            orientation: PageOrientation.LANDSCAPE,
          },
          margin: { top: 450, bottom: 450, left: 700, right: 700 },
        },
      },
      children: [
        orgTable,
        headerGrid,
        makeTextParagraph('1. Сведения о состоянии объекта основных средств на дату списания', {
          size: 19,
          alignment: AlignmentType.CENTER,
          spacingBefore: 60,
          spacingAfter: 60,
        }),
        section1Table,
        makeTextParagraph(
          '2. Сведения о состоянии объекта незавершенного строительства на дату списания',
          {
            size: 19,
            alignment: AlignmentType.CENTER,
            spacingBefore: 100,
            spacingAfter: 60,
          }
        ),
        section2Table,
        conclusionTable,
        makeTextParagraph(
          'Принято решение о передаче списанного оборудования. Сдать на переработку в полной комплектации без изъятия деталей, узлов и комплектующих изделий, содержащих драгметаллы.',
          {
            size: 16,
            alignment: AlignmentType.CENTER,
            spacingBefore: 40,
            spacingAfter: 60,
          }
        ),
        commissionTable,
      ],
    };
  });

  const doc = new Document({ sections });
  return await Packer.toBuffer(doc);
}

/**
 * Case 1: «НАКЛАДНАЯ на внутреннее перемещение объектов основных средств» (Форма по ОКУД 0501460)
 * Transfer to ЦИТ for recycling (supports multiple items spanning front and back of A4 sheet).
 * Kit components ("из комплекта" or is_kit_part) automatically omit cost columns (cols 6 & 7).
 */
export async function generateTransferInvoiceDocx(
  items: EquipmentForDocx[],
  options: TransferInvoiceOptions = {}
): Promise<Buffer> {
  const organization = options.organization || 'ВГУ имени П.М.Машерова';
  const sender = options.sender || 'Кафедра ПиСП';
  const recipient = options.recipient || 'ЦИТ';
  const invoiceNumber = options.invoiceNumber || '';
  const invoiceDate = options.invoiceDate ? formatDateRu(options.invoiceDate) : '';
  const note = options.note || '';

  // Top Header with OKUD code block on the right
  const topHeaderTable = new Table({
    width: { size: 10606, type: WidthType.DXA },
    rows: [
      new TableRow({
        children: [
          makeCell('', { width: 6200, borders: NO_BORDERS }),
          makeCell('', { width: 2600, borders: NO_BORDERS }),
          makeCell('Коды', { width: 1806, size: 16, alignment: AlignmentType.CENTER }),
        ],
      }),
      new TableRow({
        children: [
          makeCell('', { width: 6200, borders: NO_BORDERS }),
          makeCell('Форма по ОКУД', {
            width: 2600,
            size: 16,
            alignment: AlignmentType.RIGHT,
            borders: NO_BORDERS,
          }),
          makeCell('0501460', { width: 1806, size: 16, alignment: AlignmentType.CENTER }),
        ],
      }),
      new TableRow({
        children: [
          makeCell(organization, {
            width: 6200,
            size: 18,
            alignment: AlignmentType.CENTER,
            borders: BOTTOM_ONLY_BORDER,
          }),
          makeCell('по ОКЮЛП', {
            width: 2600,
            size: 16,
            alignment: AlignmentType.RIGHT,
            borders: NO_BORDERS,
          }),
          makeCell('', { width: 1806, size: 16 }),
        ],
      }),
      new TableRow({
        children: [
          makeCell('(наименование организации)', {
            width: 6200,
            size: 13,
            italics: true,
            alignment: AlignmentType.CENTER,
            borders: NO_BORDERS,
            margins: { top: 0, bottom: 20 },
          }),
          makeCell('', { width: 2600, borders: NO_BORDERS }),
          makeCell('', { width: 1806, size: 16 }),
        ],
      }),
    ],
  });

  // Sender / Recipient block
  const partiesTable = new Table({
    width: { size: 10606, type: WidthType.DXA },
    rows: [
      new TableRow({
        children: [
          makeCell('Сдатчик', {
            width: 1400,
            size: 18,
            alignment: AlignmentType.LEFT,
            borders: NO_BORDERS,
            margins: { top: 20, bottom: 10 },
          }),
          makeCell(sender, {
            width: 5400,
            size: 18,
            alignment: AlignmentType.CENTER,
            borders: BOTTOM_ONLY_BORDER,
            margins: { top: 20, bottom: 10 },
          }),
          makeCell('', { width: 3806, borders: NO_BORDERS }),
        ],
      }),
      new TableRow({
        children: [
          makeCell('', { width: 1400, borders: NO_BORDERS, margins: { top: 0, bottom: 30 } }),
          makeCell('(наименование структурного подразделения)', {
            width: 5400,
            size: 13,
            italics: true,
            borders: NO_BORDERS,
            margins: { top: 0, bottom: 30 },
          }),
          makeCell('', { width: 3806, borders: NO_BORDERS }),
        ],
      }),
      new TableRow({
        children: [
          makeCell('Получатель', {
            width: 1400,
            size: 18,
            alignment: AlignmentType.LEFT,
            borders: NO_BORDERS,
            margins: { top: 20, bottom: 10 },
          }),
          makeCell(recipient, {
            width: 5400,
            size: 18,
            alignment: AlignmentType.CENTER,
            borders: BOTTOM_ONLY_BORDER,
            margins: { top: 20, bottom: 10 },
          }),
          makeCell('', { width: 3806, borders: NO_BORDERS }),
        ],
      }),
      new TableRow({
        children: [
          makeCell('', { width: 1400, borders: NO_BORDERS, margins: { top: 0, bottom: 40 } }),
          makeCell('(наименование структурного подразделения)', {
            width: 5400,
            size: 13,
            italics: true,
            borders: NO_BORDERS,
            margins: { top: 0, bottom: 40 },
          }),
          makeCell('', { width: 3806, borders: NO_BORDERS }),
        ],
      }),
    ],
  });

  // Title & Document Number/Date row
  const docNumTable = new Table({
    width: { size: 3800, type: WidthType.DXA },
    rows: [
      new TableRow({
        children: [
          makeCell('Номер', { width: 1300, bold: true, size: 17 }),
          makeCell('Дата составления', { width: 2500, bold: true, size: 17 }),
        ],
      }),
      new TableRow({
        children: [
          makeCell(invoiceNumber, {
            width: 1300,
            size: 17,
            margins: { top: 70, bottom: 70 },
          }),
          makeCell(invoiceDate, {
            width: 2500,
            size: 17,
            margins: { top: 70, bottom: 70 },
          }),
        ],
      }),
    ],
  });

  const titleGrid = new Table({
    width: { size: 10606, type: WidthType.DXA },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 6606, type: WidthType.DXA },
            borders: NO_BORDERS,
            verticalAlign: VerticalAlign.CENTER,
            children: [
              makeTextParagraph('НАКЛАДНАЯ', {
                size: 20,
                bold: true,
                alignment: AlignmentType.CENTER,
              }),
              makeTextParagraph('на внутреннее перемещение', {
                size: 19,
                alignment: AlignmentType.CENTER,
              }),
              makeTextParagraph('объектов основных средств', {
                size: 19,
                alignment: AlignmentType.CENTER,
              }),
            ],
          }),
          new TableCell({
            width: { size: 4000, type: WidthType.DXA },
            borders: NO_BORDERS,
            verticalAlign: VerticalAlign.CENTER,
            children: [docNumTable],
          }),
        ],
      }),
    ],
  });

  // Main Items Table (7 columns totaling 10606)
  const mainRows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      cantSplit: true,
      children: [
        makeCell('№ п./п', { width: 650, bold: true, size: 16, rowSpan: 2 }),
        makeCell('Объект основных средств', { width: 6756, bold: true, size: 16, columnSpan: 3 }),
        makeCell('количество, шт', { width: 900, bold: true, size: 16, rowSpan: 2 }),
        makeCell('Стоимость, руб.', { width: 2300, bold: true, size: 16, columnSpan: 2 }),
      ],
    }),
    new TableRow({
      tableHeader: true,
      cantSplit: true,
      children: [
        makeCell('наименование', { width: 3856, bold: true, size: 16 }),
        makeCell('дата приобретения (год выпуска, постройки)', { width: 1450, bold: true, size: 15 }),
        makeCell('инвентарный номер', { width: 1450, bold: true, size: 16 }),
        makeCell('единицы', { width: 1150, bold: true, size: 16 }),
        makeCell('всего', { width: 1150, bold: true, size: 16 }),
      ],
    }),
    new TableRow({
      tableHeader: true,
      cantSplit: true,
      children: [
        makeCell('1', { width: 650, size: 15 }),
        makeCell('2', { width: 3856, size: 15 }),
        makeCell('3', { width: 1450, size: 15 }),
        makeCell('4', { width: 1450, size: 15 }),
        makeCell('5', { width: 900, size: 15 }),
        makeCell('6', { width: 1150, size: 15 }),
        makeCell('7', { width: 1150, size: 15 }),
      ],
    }),
  ];

  let totalQty = 0;
  let totalSum = 0;

  items.forEach((item, index) => {
    const qty = Number(item.additional_fields?.quantity) > 0 ? Number(item.additional_fields?.quantity) : 1;
    totalQty += qty;

    const kitPart = isKitPartItem(item);
    const unitCostNum =
      typeof item.initial_cost === 'number'
        ? item.initial_cost
        : parseFloat(String(item.initial_cost || 0).replace(/\s+/g, '').replace(',', '.')) || 0;
    const rowSumNum = kitPart ? 0 : Math.round(unitCostNum * qty * 100) / 100;
    if (!kitPart) {
      totalSum += rowSumNum;
    }

    const col6Text = kitPart ? '' : formatRubKop(unitCostNum);
    const col7Text = kitPart ? '' : formatRubKop(rowSumNum);
    const accountingName =
      item.additional_fields?.['Наименование (по бухгалтерии)'] || item.name;
    const acquiredDate = formatDateRu(item.recivedRaw || item.recivedDate);

    mainRows.push(
      new TableRow({
        cantSplit: true,
        children: [
          makeCell(String(index + 1), {
            width: 650,
            size: 16,
            alignment: AlignmentType.CENTER,
            margins: { top: 30, bottom: 30, left: 40, right: 40 },
          }),
          makeCell(accountingName, {
            width: 3856,
            size: 16,
            alignment: AlignmentType.LEFT,
            margins: { top: 30, bottom: 30, left: 60, right: 50 },
          }),
          makeCell(acquiredDate, {
            width: 1450,
            size: 16,
            alignment: AlignmentType.CENTER,
            margins: { top: 30, bottom: 30, left: 40, right: 40 },
          }),
          makeCell(item.inventory_number, {
            width: 1450,
            size: 16,
            alignment: AlignmentType.CENTER,
            margins: { top: 30, bottom: 30, left: 40, right: 40 },
          }),
          makeCell(String(qty), {
            width: 900,
            size: 16,
            alignment: AlignmentType.CENTER,
            margins: { top: 30, bottom: 30, left: 40, right: 40 },
          }),
          makeCell(col6Text, {
            width: 1150,
            size: 16,
            alignment: AlignmentType.CENTER,
            margins: { top: 30, bottom: 30, left: 40, right: 40 },
          }),
          makeCell(col7Text, {
            width: 1150,
            size: 16,
            alignment: AlignmentType.CENTER,
            margins: { top: 30, bottom: 30, left: 40, right: 40 },
          }),
        ],
      })
    );
  });

  // ИТОГО по документу row
  mainRows.push(
    new TableRow({
      cantSplit: true,
      children: [
        makeCell('ИТОГО по документу', {
          width: 7406,
          bold: true,
          size: 17,
          alignment: AlignmentType.LEFT,
          columnSpan: 4,
          margins: { top: 40, bottom: 40, left: 60, right: 40 },
        }),
        makeCell(String(totalQty), {
          width: 900,
          bold: true,
          size: 17,
          alignment: AlignmentType.CENTER,
          margins: { top: 40, bottom: 40, left: 40, right: 40 },
        }),
        makeCell('', {
          width: 1150,
          size: 17,
          margins: { top: 40, bottom: 40, left: 40, right: 40 },
        }),
        makeCell(formatRubKop(totalSum), {
          width: 1150,
          bold: true,
          size: 17,
          alignment: AlignmentType.CENTER,
          margins: { top: 40, bottom: 40, left: 40, right: 40 },
        }),
      ],
    })
  );

  const mainTable = new Table({
    width: { size: 10606, type: WidthType.DXA },
    rows: mainRows,
  });

  // Footer: Note + Sdal/Prinyal signatories
  const footerNoteTable = new Table({
    width: { size: 10606, type: WidthType.DXA },
    rows: [
      new TableRow({
        children: [
          makeCell('Примечание (краткая характеристика технического состояния объекта основных средств).', {
            width: 10606,
            size: 16,
            alignment: AlignmentType.CENTER,
            borders: NO_BORDERS,
            margins: { top: 80, bottom: 20 },
          }),
        ],
      }),
      new TableRow({
        children: [
          makeCell(note, {
            width: 10606,
            size: 16,
            alignment: AlignmentType.LEFT,
            borders: BOTTOM_ONLY_BORDER,
            margins: { top: 40, bottom: 20 },
          }),
        ],
      }),
      new TableRow({
        children: [
          makeCell('', {
            width: 10606,
            size: 16,
            borders: BOTTOM_ONLY_BORDER,
            margins: { top: 60, bottom: 20 },
          }),
        ],
      }),
    ],
  });

  const footerSignTable = new Table({
    width: { size: 10606, type: WidthType.DXA },
    rows: [
      new TableRow({
        children: [
          makeCell('Объекты основных средств', {
            width: 10606,
            size: 16,
            alignment: AlignmentType.LEFT,
            borders: NO_BORDERS,
            columnSpan: 6,
            margins: { top: 80, bottom: 20 },
          }),
        ],
      }),
      new TableRow({
        cantSplit: true,
        children: [
          makeCell('Сдал', { width: 1000, size: 17, alignment: AlignmentType.LEFT, borders: NO_BORDERS }),
          makeCell('Заведующий каф. ПиСП', { width: 4200, size: 17, borders: BOTTOM_ONLY_BORDER }),
          makeCell('', { width: 500, borders: NO_BORDERS }),
          makeCell('', { width: 1800, size: 17, borders: BOTTOM_ONLY_BORDER }),
          makeCell('', { width: 500, borders: NO_BORDERS }),
          makeCell('Ермоченко С.А.', { width: 2606, size: 17, borders: BOTTOM_ONLY_BORDER }),
        ],
      }),
      new TableRow({
        children: [
          makeCell('', { width: 1000, borders: NO_BORDERS, margins: { top: 0, bottom: 30 } }),
          makeCell('(должность)', { width: 4200, size: 13, italics: true, borders: NO_BORDERS, margins: { top: 0, bottom: 30 } }),
          makeCell('', { width: 500, borders: NO_BORDERS, margins: { top: 0, bottom: 30 } }),
          makeCell('подпись', { width: 1800, size: 13, italics: true, borders: NO_BORDERS, margins: { top: 0, bottom: 30 } }),
          makeCell('', { width: 500, borders: NO_BORDERS, margins: { top: 0, bottom: 30 } }),
          makeCell('(расшифровка подписи)', { width: 2606, size: 13, italics: true, borders: NO_BORDERS, margins: { top: 0, bottom: 30 } }),
        ],
      }),
      new TableRow({
        cantSplit: true,
        children: [
          makeCell('Принял', { width: 1000, size: 17, alignment: AlignmentType.LEFT, borders: NO_BORDERS }),
          makeCell('Нач.отд. ПТО и ЭУС ЦИТ (Д/М)', { width: 4200, size: 17, borders: BOTTOM_ONLY_BORDER }),
          makeCell('', { width: 500, borders: NO_BORDERS }),
          makeCell('', { width: 1800, size: 17, borders: BOTTOM_ONLY_BORDER }),
          makeCell('', { width: 500, borders: NO_BORDERS }),
          makeCell('Фунтикова Т.Г.', { width: 2606, size: 17, borders: BOTTOM_ONLY_BORDER }),
        ],
      }),
      new TableRow({
        children: [
          makeCell('', { width: 1000, borders: NO_BORDERS, margins: { top: 0, bottom: 30 } }),
          makeCell('(должность)', { width: 4200, size: 13, italics: true, borders: NO_BORDERS, margins: { top: 0, bottom: 30 } }),
          makeCell('', { width: 500, borders: NO_BORDERS, margins: { top: 0, bottom: 30 } }),
          makeCell('подпись', { width: 1800, size: 13, italics: true, borders: NO_BORDERS, margins: { top: 0, bottom: 30 } }),
          makeCell('', { width: 500, borders: NO_BORDERS, margins: { top: 0, bottom: 30 } }),
          makeCell('(расшифровка подписи)', { width: 2606, size: 13, italics: true, borders: NO_BORDERS, margins: { top: 0, bottom: 30 } }),
        ],
      }),
    ],
  });

  const chiefAccountantTable = new Table({
    width: { size: 10606, type: WidthType.DXA },
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          makeCell('Главный бухгалтер', {
            width: 5200,
            size: 17,
            alignment: AlignmentType.LEFT,
            borders: NO_BORDERS,
            margins: { top: 40, bottom: 10 },
          }),
          makeCell('', { width: 500, borders: NO_BORDERS }),
          makeCell('', {
            width: 1800,
            size: 17,
            borders: BOTTOM_ONLY_BORDER,
            margins: { top: 40, bottom: 10 },
          }),
          makeCell('', { width: 500, borders: NO_BORDERS }),
          makeCell('Л.Н.Прокопкина', {
            width: 2606,
            size: 17,
            alignment: AlignmentType.CENTER,
            borders: BOTTOM_ONLY_BORDER,
            margins: { top: 40, bottom: 10 },
          }),
        ],
      }),
      new TableRow({
        children: [
          makeCell('', { width: 5200, borders: NO_BORDERS, margins: { top: 0, bottom: 20 } }),
          makeCell('', { width: 500, borders: NO_BORDERS, margins: { top: 0, bottom: 20 } }),
          makeCell('(подпись)', {
            width: 1800,
            size: 13,
            italics: true,
            borders: NO_BORDERS,
            margins: { top: 0, bottom: 20 },
          }),
          makeCell('', { width: 500, borders: NO_BORDERS, margins: { top: 0, bottom: 20 } }),
          makeCell('(расшифровка подписи)', {
            width: 2606,
            size: 13,
            italics: true,
            borders: NO_BORDERS,
            margins: { top: 0, bottom: 20 },
          }),
        ],
      }),
    ],
  });

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: {
              width: 11906,
              height: 16838,
              orientation: PageOrientation.PORTRAIT,
            },
            margin: { top: 550, bottom: 550, left: 700, right: 600 },
          },
        },
        children: [
          topHeaderTable,
          partiesTable,
          titleGrid,
          makeTextParagraph('', { spacingBefore: 40, spacingAfter: 40 }),
          mainTable,
          footerNoteTable,
          footerSignTable,
          makeTextParagraph(
            'В инвентарной карточке (книге) учета объектов основных средств выбытие отмечено.',
            {
              size: 16,
              alignment: AlignmentType.LEFT,
              spacingBefore: 80,
              spacingAfter: 60,
            }
          ),
          chiefAccountantTable,
        ],
      },
    ],
  });

  return await Packer.toBuffer(doc);
}

export interface GroupQrBatchData {
  code: string;
  name: string;
  roomNumber?: string;
  items: EquipmentForDocx[];
}

export async function generateGroupQrDocx(
  batch: GroupQrBatchData,
  baseUrl: string
): Promise<Buffer> {
  const qrUrl = `${baseUrl.replace(/\/$/, '')}/q/${batch.code}`;
  const qrBuffer = await QRCode.toBuffer(qrUrl, {
    width: 260,
    margin: 1,
    errorCorrectionLevel: 'M',
  });

  const tableRows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: [
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: '№', bold: true })] })],
          width: { size: 600, type: WidthType.DXA },
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: 'Инв. номер', bold: true })] })],
          width: { size: 2400, type: WidthType.DXA },
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: 'Наименование предмета', bold: true })] })],
          width: { size: 3600, type: WidthType.DXA },
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: 'Кабинет', bold: true })] })],
          width: { size: 1200, type: WidthType.DXA },
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: 'Стоимость (BYN)', bold: true })] })],
          width: { size: 1400, type: WidthType.DXA },
        }),
      ],
    }),
  ];

  batch.items.forEach((item, index) => {
    tableRows.push(
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph({ text: String(index + 1) })] }),
          new TableCell({
            children: [
              new Paragraph({
                children: [new TextRun({ text: item.inventory_number, bold: true, color: '1E40AF' })],
              }),
            ],
          }),
          new TableCell({ children: [new Paragraph({ text: item.name })] }),
          new TableCell({ children: [new Paragraph({ text: item.roomNumber || '—' })] }),
          new TableCell({
            children: [
              new Paragraph({
                text: formatRubKop(item.initial_cost || 0),
              }),
            ],
          }),
        ],
      })
    );
  });

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            spacing: { after: 150 },
            children: [
              new TextRun({
                text: 'КАФЕДРАЛЬНЫЙ УЧЕТ МАТЕРИАЛЬНЫХ ЦЕННОСТЕЙ',
                bold: true,
                size: 26,
                color: '1E3A8A',
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 250 },
            children: [
              new TextRun({
                text: `ГРУППОВОЙ QR-КОД ПАРТИИ ОБОРУДОВАНИЯ: ${batch.code}`,
                bold: true,
                size: 20,
                color: '0F172A',
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
            children: [
              new ImageRun({
                data: qrBuffer,
                transformation: { width: 170, height: 170 },
                type: 'png',
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 100 },
            children: [
              new TextRun({
                text: `Партия: «${batch.name}» (${batch.items.length} единиц)`,
                bold: true,
                size: 20,
                color: '1E40AF',
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 300 },
            children: [
              new TextRun({
                text: `Защищенный шлюз доступа: ${qrUrl}`,
                size: 14,
                color: '64748B',
                italics: true,
              }),
            ],
          }),
          new Paragraph({
            spacing: { after: 150 },
            children: [
              new TextRun({
                text: 'Состав партии оборудования (единый групповой QR-код):',
                bold: true,
                size: 18,
              }),
            ],
          }),
          new Table({
            rows: tableRows,
            width: { size: 9200, type: WidthType.DXA },
          }),
          new Paragraph({
            spacing: { before: 250 },
            children: [
              new TextRun({
                text: 'Примечание: Сканирование данного кода авторизованным сотрудником мгновенно открывает список всей партии оборудования и позволяет выполнить пакетное подтверждение при инвентаризации.',
                size: 14,
                italics: true,
                color: '64748B',
              }),
            ],
          }),
        ],
      },
    ],
  });

  return await Packer.toBuffer(doc);
}

/**
 * Formats currency strictly with 2 decimal digits and comma separator (e.g. 28,20 / 7,10 / 1 210,23)
 */
export function formatRubKopFixed2(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const num =
    typeof value === 'number'
      ? value
      : parseFloat(String(value).replace(/\s+/g, '').replace(',', '.'));
  if (isNaN(num)) return '';
  const rounded = Math.round(num * 100) / 100;
  const [intPart, decPart] = rounded.toFixed(2).split('.');
  const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${formattedInt},${decPart}`;
}

export interface LowValueInvoiceOptions {
  invoiceNumber?: string;
  invoiceDate?: Date | string | null;
  organization?: string;
  department?: string;
  reason?: string;
}

/**
 * Case 2: «АКТ НА СПИСАНИЕ ОТДЕЛЬНЫХ ПРЕДМЕТОВ В СОСТАВЕ ОБОРОТНЫХ СРЕДСТВ»
 * For «Малоценка» containing precious metals (ДМ).
 * Each equipment entry produces 2 A4 Portrait pages (front side + back side).
 * Sum column = Price (Цена) * Quantity (Количество).
 */
export async function generateLowValueWriteoffActDocx(
  items: EquipmentForDocx[],
  options: WriteoffDocxOptions = {}
): Promise<Buffer> {
  const defaultDate = options.writeoffDate || options.actDate || new Date();
  const { year: docYear } = extractCalendarYMD(defaultDate);
  const yearStr = String(docYear);
  const reasonText = options.reason && options.reason !== 'начисленная амортизация составляет 100%'
    ? options.reason
    : `тех. закл. №${options.technicalConclusionNumber ? ` ${options.technicalConclusionNumber}` : ''}`;

  const sections = items.map((item) => {
    const effectiveDate =
      options.writeoffDate || item.writeoffDate || options.actDate || defaultDate;
    const { year: itemYear } = extractCalendarYMD(effectiveDate);
    const serviceLife = calculateServiceLife(
      item.recivedRaw || item.recivedDate,
      effectiveDate
    );

    const qty =
      Number(item.additional_fields?.quantity) > 0
        ? Number(item.additional_fields?.quantity)
        : 1;
    const unitPrice =
      typeof item.initial_cost === 'number'
        ? item.initial_cost
        : parseFloat(String(item.initial_cost || 0).replace(/\s+/g, '').replace(',', '.')) || 0;
    const totalSum = Math.round(unitPrice * qty * 100) / 100;

    const accountingName =
      item.additional_fields?.['Наименование (по бухгалтерии)'] || item.name;
    const dateReceivedStr = formatDateRu(item.recivedRaw || item.recivedDate);

    // Top row: Organization left + Approval right
    const topBlock = new Table({
      width: { size: 10706, type: WidthType.DXA },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: 4700, type: WidthType.DXA },
              borders: NO_BORDERS,
              verticalAlign: VerticalAlign.TOP,
              children: [
                makeTextParagraph('Витебский государственный университет', {
                  size: 16,
                  alignment: AlignmentType.CENTER,
                }),
                makeTextParagraph('имени П.М. Машерова', {
                  size: 16,
                  alignment: AlignmentType.CENTER,
                }),
                makeTextParagraph('(предприятие, организация)', {
                  size: 12,
                  italics: true,
                  alignment: AlignmentType.CENTER,
                }),
              ],
            }),
            new TableCell({
              width: { size: 6006, type: WidthType.DXA },
              borders: NO_BORDERS,
              verticalAlign: VerticalAlign.TOP,
              children: [
                makeTextParagraph('Утверждаю', { size: 16, alignment: AlignmentType.CENTER }),
                makeTextParagraph('Ректор        ВГУ имени П.М. Машерова', {
                  size: 16,
                  alignment: AlignmentType.CENTER,
                }),
                makeTextParagraph('__________________________________   Богатырёва В.В.', {
                  size: 16,
                  alignment: AlignmentType.CENTER,
                  spacingBefore: 40,
                }),
                makeTextParagraph('(подпись)                              (И., О., Фамилия)', {
                  size: 12,
                  italics: true,
                  alignment: AlignmentType.CENTER,
                }),
                makeTextParagraph(`" ___ " __________________ ${itemYear} г.`, {
                  size: 16,
                  alignment: AlignmentType.CENTER,
                  spacingBefore: 20,
                }),
              ],
            }),
          ],
        }),
      ],
    });

    // Small accounting metadata table (8 cols totaling 10706)
    const metaTable = new Table({
      width: { size: 10706, type: WidthType.DXA },
      rows: [
        new TableRow({
          cantSplit: true,
          children: [
            makeCell('', { width: 1400, size: 14, rowSpan: 2 }),
            makeCell('Дата составления', { width: 1250, size: 14, rowSpan: 2 }),
            makeCell('Код вида операции', { width: 1250, size: 14, rowSpan: 2 }),
            makeCell('Цех, отдел, участок', { width: 1250, size: 14, rowSpan: 2 }),
            makeCell('Кладовая', { width: 900, size: 14, rowSpan: 2 }),
            makeCell('Корреспондирующий счет', { width: 3400, size: 14, columnSpan: 2 }),
            makeCell('', { width: 1256, size: 14, rowSpan: 2 }),
          ],
        }),
        new TableRow({
          cantSplit: true,
          children: [
            makeCell('счет, субсчет', { width: 1100, size: 14 }),
            makeCell('код аналитического учёта', { width: 2300, size: 14 }),
          ],
        }),
        new TableRow({
          cantSplit: true,
          children: [
            makeCell('', { width: 1400, size: 15, margins: { top: 60, bottom: 60 } }),
            makeCell('', { width: 1250, size: 15, margins: { top: 60, bottom: 60 } }),
            makeCell('', { width: 1250, size: 15, margins: { top: 60, bottom: 60 } }),
            makeCell('', { width: 1250, size: 15, margins: { top: 60, bottom: 60 } }),
            makeCell('', { width: 900, size: 15, margins: { top: 60, bottom: 60 } }),
            makeCell('071', { width: 1100, size: 16, margins: { top: 60, bottom: 60 } }),
            makeCell('', { width: 2300, size: 15, margins: { top: 60, bottom: 60 } }),
            makeCell('', { width: 1256, size: 15, margins: { top: 60, bottom: 60 } }),
          ],
        }),
      ],
    });

    // Helper for the 12-column main item table (used on Front Side filled + Back Side empty)
    const buildTwelveColHeaderRows = (): TableRow[] => [
      new TableRow({
        cantSplit: true,
        children: [
          makeCell('Предмет', { width: 3850, size: 14, bold: true, columnSpan: 3 }),
          makeCell('Единица измерения', { width: 1150, size: 14, bold: true, columnSpan: 2 }),
          makeCell('Количество', { width: 650, size: 13, bold: true, rowSpan: 2 }),
          makeCell('Дата поступления', { width: 950, size: 13, bold: true, rowSpan: 2 }),
          makeCell('Цена', { width: 800, size: 14, bold: true, rowSpan: 2 }),
          makeCell('Сумма', { width: 800, size: 14, bold: true, rowSpan: 2 }),
          makeCell('Срок службы', { width: 950, size: 13, bold: true, rowSpan: 2 }),
          makeCell('Причина списания', { width: 956, size: 13, bold: true, rowSpan: 2 }),
          makeCell('Номер паспорта', { width: 600, size: 13, bold: true, rowSpan: 2 }),
        ],
      }),
      new TableRow({
        cantSplit: true,
        children: [
          makeCell('наименование', { width: 1850, size: 13 }),
          makeCell('номенклатурный №', { width: 850, size: 12 }),
          makeCell('инвентарный номер', { width: 1150, size: 13 }),
          makeCell('код', { width: 500, size: 13 }),
          makeCell('наименование', { width: 650, size: 12 }),
        ],
      }),
      new TableRow({
        cantSplit: true,
        children: [
          makeCell('1', { width: 1850, size: 13 }),
          makeCell('2', { width: 850, size: 13 }),
          makeCell('3', { width: 1150, size: 13 }),
          makeCell('4', { width: 500, size: 13 }),
          makeCell('5', { width: 650, size: 13 }),
          makeCell('6', { width: 650, size: 13 }),
          makeCell('7', { width: 950, size: 13 }),
          makeCell('8', { width: 800, size: 13 }),
          makeCell('9', { width: 800, size: 13 }),
          makeCell('10', { width: 950, size: 13 }),
          makeCell('11', { width: 956, size: 13 }),
          makeCell('12', { width: 600, size: 13 }),
        ],
      }),
    ];

    const emptyTwelveColRow = () =>
      new TableRow({
        cantSplit: true,
        children: [
          makeCell('', { width: 1850, size: 14, margins: { top: 80, bottom: 80 } }),
          makeCell('', { width: 850, size: 14, margins: { top: 80, bottom: 80 } }),
          makeCell('', { width: 1150, size: 14, margins: { top: 80, bottom: 80 } }),
          makeCell('', { width: 500, size: 14, margins: { top: 80, bottom: 80 } }),
          makeCell('', { width: 650, size: 14, margins: { top: 80, bottom: 80 } }),
          makeCell('', { width: 650, size: 14, margins: { top: 80, bottom: 80 } }),
          makeCell('', { width: 950, size: 14, margins: { top: 80, bottom: 80 } }),
          makeCell('', { width: 800, size: 14, margins: { top: 80, bottom: 80 } }),
          makeCell('', { width: 800, size: 14, margins: { top: 80, bottom: 80 } }),
          makeCell('', { width: 950, size: 14, margins: { top: 80, bottom: 80 } }),
          makeCell('', { width: 956, size: 14, margins: { top: 80, bottom: 80 } }),
          makeCell('', { width: 600, size: 14, margins: { top: 80, bottom: 80 } }),
        ],
      });

    // Front Side Item Table
    const frontItemsTable = new Table({
      width: { size: 10706, type: WidthType.DXA },
      rows: [
        ...buildTwelveColHeaderRows(),
        new TableRow({
          cantSplit: true,
          children: [
            makeCell(accountingName, {
              width: 1850,
              size: 14,
              alignment: AlignmentType.CENTER,
              margins: { top: 80, bottom: 80, left: 40, right: 40 },
            }),
            makeCell('', { width: 850, size: 14 }),
            makeCell(item.inventory_number, { width: 1150, size: 14, alignment: AlignmentType.CENTER }),
            makeCell('', { width: 500, size: 14 }),
            makeCell('', { width: 650, size: 14 }),
            makeCell(String(qty), { width: 650, size: 15, alignment: AlignmentType.CENTER }),
            makeCell(dateReceivedStr, { width: 950, size: 14, alignment: AlignmentType.CENTER }),
            makeCell(formatRubKopFixed2(unitPrice), { width: 800, size: 14, alignment: AlignmentType.CENTER }),
            makeCell(formatRubKopFixed2(totalSum), { width: 800, size: 14, alignment: AlignmentType.CENTER }),
            makeCell(serviceLife.formatted, { width: 950, size: 14, alignment: AlignmentType.CENTER }),
            makeCell(reasonText, { width: 956, size: 13, alignment: AlignmentType.CENTER }),
            makeCell('', { width: 600, size: 14 }),
          ],
        }),
        emptyTwelveColRow(),
        new TableRow({
          cantSplit: true,
          children: [
            makeCell('Содержание драг, металлов по данным бухгалтерии', {
              width: 1850,
              size: 13,
              alignment: AlignmentType.CENTER,
              margins: { top: 80, bottom: 80, left: 30, right: 30 },
            }),
            makeCell('В одном изделии:', {
              width: 8856,
              size: 15,
              alignment: AlignmentType.LEFT,
              verticalAlign: VerticalAlign.TOP,
              columnSpan: 11,
              margins: { top: 80, bottom: 160, left: 80, right: 40 },
            }),
          ],
        }),
      ],
    });

    // Back Side continuation 12-col table (2 blank rows)
    const backContinuationTable = new Table({
      width: { size: 10706, type: WidthType.DXA },
      rows: [
        ...buildTwelveColHeaderRows(),
        emptyTwelveColRow(),
        emptyTwelveColRow(),
      ],
    });

    // Back Side Scrap (Утиль) 8-col table
    const scrapTable = new Table({
      width: { size: 10706, type: WidthType.DXA },
      rows: [
        new TableRow({
          cantSplit: true,
          children: [
            makeCell('Утиль', { width: 3200, size: 14, bold: true, columnSpan: 2 }),
            makeCell('Единица измерения', { width: 1700, size: 14, bold: true, columnSpan: 2 }),
            makeCell('Количество', { width: 1100, size: 14, bold: true, rowSpan: 2 }),
            makeCell('Цена', { width: 1000, size: 14, bold: true, rowSpan: 2 }),
            makeCell('Сумма', { width: 1100, size: 14, bold: true, rowSpan: 2 }),
            makeCell('Порядковый номер записи по складской картотеке', {
              width: 2606,
              size: 13,
              bold: true,
              rowSpan: 2,
            }),
          ],
        }),
        new TableRow({
          cantSplit: true,
          children: [
            makeCell('наименование', { width: 2100, size: 13 }),
            makeCell('номенклатурный №', { width: 1100, size: 13 }),
            makeCell('код', { width: 700, size: 13 }),
            makeCell('наименование', { width: 1000, size: 13 }),
          ],
        }),
        new TableRow({
          cantSplit: true,
          children: [
            makeCell('1', { width: 2100, size: 13 }),
            makeCell('2', { width: 1100, size: 13 }),
            makeCell('3', { width: 700, size: 13 }),
            makeCell('4', { width: 1000, size: 13 }),
            makeCell('5', { width: 1100, size: 13 }),
            makeCell('6', { width: 1000, size: 13 }),
            makeCell('7', { width: 1100, size: 13 }),
            makeCell('8', { width: 2606, size: 13 }),
          ],
        }),
        ...Array.from({ length: 4 }, () =>
          new TableRow({
            cantSplit: true,
            children: [
              makeCell('', { width: 2100, size: 14, margins: { top: 60, bottom: 60 } }),
              makeCell('', { width: 1100, size: 14, margins: { top: 60, bottom: 60 } }),
              makeCell('', { width: 700, size: 14, margins: { top: 60, bottom: 60 } }),
              makeCell('', { width: 1000, size: 14, margins: { top: 60, bottom: 60 } }),
              makeCell('', { width: 1100, size: 14, margins: { top: 60, bottom: 60 } }),
              makeCell('', { width: 1000, size: 14, margins: { top: 60, bottom: 60 } }),
              makeCell('', { width: 1100, size: 14, margins: { top: 60, bottom: 60 } }),
              makeCell('', { width: 2606, size: 14, margins: { top: 60, bottom: 60 } }),
            ],
          })
        ),
      ],
    });

    // Back Side Commission signatures (Case 2 exact roles & names from screenshot)
    const backSignTable = new Table({
      width: { size: 10706, type: WidthType.DXA },
      rows: [
        new TableRow({
          children: [
            makeCell('Председатель комиссии', {
              width: 5500,
              size: 16,
              alignment: AlignmentType.LEFT,
              borders: NO_BORDERS,
              columnSpan: 2,
              margins: { top: 40, bottom: 20 },
            }),
            makeCell('', { width: 5206, borders: NO_BORDERS }),
          ],
        }),
        new TableRow({
          children: [
            makeCell('Проректор', {
              width: 5500,
              size: 16,
              alignment: AlignmentType.LEFT,
              borders: NO_BORDERS,
              margins: { top: 10, bottom: 40 },
            }),
            makeCell('', { width: 2200, borders: NO_BORDERS }),
            makeCell('А.И. Раловец', {
              width: 3006,
              size: 16,
              alignment: AlignmentType.RIGHT,
              borders: NO_BORDERS,
              margins: { top: 10, bottom: 40 },
            }),
          ],
        }),
        new TableRow({
          children: [
            makeCell('Члены комиссии:', {
              width: 5500,
              size: 16,
              alignment: AlignmentType.LEFT,
              borders: NO_BORDERS,
              margins: { top: 30, bottom: 20 },
            }),
            makeCell('', { width: 2200, borders: NO_BORDERS }),
            makeCell('', { width: 3006, borders: NO_BORDERS }),
          ],
        }),
        ...(
          [
            ['Зам. нач. ЦБУ и Ф', 'Д.А. Лукин'],
            ['Начальник ЦИТ', 'Д.М. Мателенок'],
            ['Бухгалтер ЦБУ и Ф', 'Т.Л. Русецкая'],
            ['Ведущий инженер-энергетик', 'А.Г. Яцук'],
            ['Материально - ответственное лицо', 'С.А. Ермоченко'],
          ] as Array<[string, string]>
        ).map(
          ([role, name]) =>
            new TableRow({
              children: [
                makeCell(role, {
                  width: 5500,
                  size: 16,
                  alignment: AlignmentType.LEFT,
                  borders: NO_BORDERS,
                  margins: { top: 20, bottom: 20 },
                }),
                makeCell('', { width: 2200, borders: NO_BORDERS }),
                makeCell(name, {
                  width: 3006,
                  size: 16,
                  alignment: AlignmentType.RIGHT,
                  borders: NO_BORDERS,
                  margins: { top: 20, bottom: 20 },
                }),
              ],
            })
        ),
      ],
    });

    return {
      properties: {
        page: {
          size: {
            width: 11906,
            height: 16838,
            orientation: PageOrientation.PORTRAIT,
          },
          margin: { top: 450, bottom: 450, left: 600, right: 600 },
        },
      },
      children: [
        // FRONT SIDE (Лицевая сторона)
        topBlock,
        makeTextParagraph('АКТ', {
          size: 18,
          bold: true,
          alignment: AlignmentType.CENTER,
          spacingBefore: 80,
          spacingAfter: 20,
        }),
        makeTextParagraph('НА СПИСАНИЕ ОТДЕЛЬНЫХ ПРЕДМЕТОВ В СОСТАВЕ ОБОРОТНЫХ СРЕДСТВ', {
          size: 17,
          bold: true,
          alignment: AlignmentType.CENTER,
          spacingAfter: 80,
        }),
        makeTextParagraph(
          `     Комиссия, назначенная приказом от " 22 " сентября ${yearStr} года № 322, осмотрела принятые за ___________ и находившиеся в эксплуатации отдельные предметы в составе оборотных средств и признала их пришедшими в негодность и подлежащими сдаче в утиль.`,
          {
            size: 15,
            alignment: AlignmentType.LEFT,
            spacingAfter: 80,
          }
        ),
        metaTable,
        makeTextParagraph('', { spacingBefore: 40, spacingAfter: 40 }),
        frontItemsTable,
        makeTextParagraph('Приложение. Перечень прилагаемых документов:', {
          size: 15,
          spacingBefore: 120,
          spacingAfter: 60,
        }),
        makeTextParagraph(
          `Техническое заключение № ${options.technicalConclusionNumber || ''}`,
          {
            size: 15,
            spacingAfter: 60,
          }
        ),

        // PAGE BREAK TO REVERSE SIDE (Оборотная сторона)
        new Paragraph({ children: [new PageBreak()] }),

        backContinuationTable,
        makeTextParagraph('[общее количество предметов прописью]', {
          size: 12,
          alignment: AlignmentType.CENTER,
          spacingBefore: 100,
          spacingAfter: 20,
        }),
        makeTextParagraph(
          'Номер и даты актов выбытия ____________________________________________________________________',
          {
            size: 15,
            alignment: AlignmentType.LEFT,
            spacingAfter: 80,
          }
        ),
        makeTextParagraph(
          'Перечисленные в настоящем Акте предметы в присутствии комиссии превращены в утиль, который подлежит оприходованию:',
          {
            size: 15,
            alignment: AlignmentType.LEFT,
            spacingAfter: 60,
          }
        ),
        scrapTable,
        makeTextParagraph('Утиль, не подлежащий учету, уничтожен.', {
          size: 15,
          spacingBefore: 80,
          spacingAfter: 80,
        }),
        backSignTable,
        makeTextParagraph(
          `Утиль по накладной № ______________ сдан        " ___ " ______________ ${itemYear} г.`,
          {
            size: 15,
            alignment: AlignmentType.CENTER,
            spacingBefore: 240,
          }
        ),
      ],
    };
  });

  const doc = new Document({ sections });
  return await Packer.toBuffer(doc);
}

/**
 * Case 2: «НАКЛАДНАЯ (ТРЕБОВАНИЕ) Форма № 434»
 * For «Малоценка» transfer / writeoff (supports multiple items and quantities > 1).
 * Sum = Price * Quantity.
 */
export async function generateLowValueInvoiceDocx(
  items: EquipmentForDocx[],
  options: LowValueInvoiceOptions = {}
): Promise<Buffer> {
  const organization = options.organization || 'ВГУ имени П.М. Машерова';
  const department = options.department || 'Кафедра ПиСП';
  const invoiceDateInput = options.invoiceDate || new Date();
  const { year: docYear } = extractCalendarYMD(invoiceDateInput);
  const yearStr = String(docYear);
  const invoiceNumber = options.invoiceNumber || '_______';

  // Top-right УТВЕРЖДАЮ block
  const approvalHeaderTable = new Table({
    width: { size: 10706, type: WidthType.DXA },
    rows: [
      new TableRow({
        children: [
          makeCell('', { width: 4500, borders: NO_BORDERS }),
          new TableCell({
            width: { size: 6206, type: WidthType.DXA },
            borders: NO_BORDERS,
            children: [
              makeTextParagraph('УТВЕРЖДАЮ', {
                size: 18,
                alignment: AlignmentType.CENTER,
              }),
              makeTextParagraph('Руководитель', { size: 17 }),
              makeTextParagraph(
                'учреждения  ___________________   _____________________',
                { size: 17 }
              ),
              makeTextParagraph(
                '                               подпись                расшифровка подписи',
                { size: 12, italics: true }
              ),
              makeTextParagraph(
                `« ___ » ______________________ ${yearStr} г.`,
                { size: 17, spacingBefore: 30 }
              ),
            ],
          }),
        ],
      }),
    ],
  });

  // Left document details + Right Коды table
  const codesTable = new Table({
    width: { size: 2200, type: WidthType.DXA },
    rows: [
      new TableRow({ children: [makeCell('Коды', { width: 2200, size: 16, bold: true })] }),
      ...Array.from({ length: 6 }, (_, i) =>
        new TableRow({
          children: [
            makeCell('', {
              width: 2200,
              size: 14,
              margins: { top: i === 5 ? 100 : 40, bottom: i === 5 ? 100 : 40 },
            }),
          ],
        })
      ),
    ],
  });

  const infoAndCodesGrid = new Table({
    width: { size: 10706, type: WidthType.DXA },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 8400, type: WidthType.DXA },
            borders: NO_BORDERS,
            verticalAlign: VerticalAlign.TOP,
            children: [
              makeTextParagraph(`НАКЛАДНАЯ (ТРЕБОВАНИЕ) № ${invoiceNumber}`, {
                size: 18,
                bold: true,
                alignment: AlignmentType.CENTER,
              }),
              makeTextParagraph('Форма № 434', {
                size: 17,
                alignment: AlignmentType.CENTER,
              }),
              makeTextParagraph(
                `за _____________________ ${yearStr} г.             Дата`,
                {
                  size: 17,
                  alignment: AlignmentType.CENTER,
                  spacingAfter: 40,
                }
              ),
              makeTextParagraph(
                'Централизованная бухгалтерия ________________________________________',
                { size: 16 }
              ),
              makeTextParagraph(
                'Раздел ______________________________________________________________',
                { size: 16 }
              ),
              makeTextParagraph(
                `Учреждение    ${organization}  ___________________________________`,
                { size: 16 }
              ),
              makeTextParagraph(
                `Отделение         ${department}  _________________________________________`,
                { size: 16 }
              ),
              makeTextParagraph(
                'Материально ответственное',
                { size: 16 }
              ),
              makeTextParagraph(
                'лицо (МОЛ)    Зав. каф. ПиСП Ермоченко С.А.  _______________________',
                { size: 16 }
              ),
              makeTextParagraph(
                'Контрольная сумма __________________________________________________',
                { size: 16, spacingAfter: 40 }
              ),
            ],
          }),
          new TableCell({
            width: { size: 2306, type: WidthType.DXA },
            borders: NO_BORDERS,
            verticalAlign: VerticalAlign.TOP,
            children: [codesTable],
          }),
        ],
      }),
    ],
  });

  // Main 8-column Table (10706 twips)
  const mainRows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      cantSplit: true,
      children: [
        makeCell('Наименование материальных ценностей, сорт, размер', {
          width: 3456,
          size: 15,
          bold: true,
          rowSpan: 2,
        }),
        makeCell('Единица измерения', { width: 850, size: 14, bold: true, rowSpan: 2 }),
        makeCell('Номенклатурный номер', { width: 2400, size: 15, bold: true, columnSpan: 2 }),
        makeCell('Количество', { width: 1900, size: 15, bold: true, columnSpan: 2 }),
        makeCell('Цена', { width: 1050, size: 15, bold: true, rowSpan: 2 }),
        makeCell('Сумма', { width: 1050, size: 15, bold: true, rowSpan: 2 }),
      ],
    }),
    new TableRow({
      tableHeader: true,
      cantSplit: true,
      children: [
        makeCell('дебет', { width: 1450, size: 15 }),
        makeCell('кредит', { width: 950, size: 15 }),
        makeCell('затребовано', { width: 950, size: 14 }),
        makeCell('отпущено', { width: 950, size: 14 }),
      ],
    }),
    new TableRow({
      tableHeader: true,
      cantSplit: true,
      children: [
        makeCell('1', { width: 3456, size: 14 }),
        makeCell('2', { width: 850, size: 14 }),
        makeCell('3', { width: 1450, size: 14 }),
        makeCell('4', { width: 950, size: 14 }),
        makeCell('5', { width: 950, size: 14 }),
        makeCell('6', { width: 950, size: 14 }),
        makeCell('7', { width: 1050, size: 14 }),
        makeCell('8', { width: 1050, size: 14 }),
      ],
    }),
  ];

  items.forEach((item) => {
    const qty =
      Number(item.additional_fields?.quantity) > 0
        ? Number(item.additional_fields?.quantity)
        : 1;
    const unitPrice =
      typeof item.initial_cost === 'number'
        ? item.initial_cost
        : parseFloat(String(item.initial_cost || 0).replace(/\s+/g, '').replace(',', '.')) || 0;
    const rowSum = Math.round(unitPrice * qty * 100) / 100;
    const accountingName =
      item.additional_fields?.['Наименование (по бухгалтерии)'] || item.name;

    mainRows.push(
      new TableRow({
        cantSplit: true,
        children: [
          makeCell(accountingName, {
            width: 3456,
            size: 15,
            alignment: AlignmentType.LEFT,
            margins: { top: 30, bottom: 30, left: 60, right: 40 },
          }),
          makeCell('шт.', {
            width: 850,
            size: 15,
            alignment: AlignmentType.LEFT,
            margins: { top: 30, bottom: 30, left: 40, right: 40 },
          }),
          makeCell(item.inventory_number, {
            width: 1450,
            size: 15,
            alignment: AlignmentType.LEFT,
            margins: { top: 30, bottom: 30, left: 50, right: 40 },
          }),
          makeCell('', { width: 950, size: 15 }),
          makeCell(String(qty), {
            width: 950,
            size: 15,
            alignment: AlignmentType.LEFT,
            margins: { top: 30, bottom: 30, left: 50, right: 40 },
          }),
          makeCell(String(qty), {
            width: 950,
            size: 15,
            alignment: AlignmentType.LEFT,
            margins: { top: 30, bottom: 30, left: 50, right: 40 },
          }),
          makeCell(formatRubKopFixed2(unitPrice), {
            width: 1050,
            size: 15,
            alignment: AlignmentType.LEFT,
            margins: { top: 30, bottom: 30, left: 50, right: 40 },
          }),
          makeCell(formatRubKopFixed2(rowSum), {
            width: 1050,
            size: 15,
            alignment: AlignmentType.LEFT,
            margins: { top: 30, bottom: 30, left: 50, right: 40 },
          }),
        ],
      })
    );
  });

  // Pad with blank rows up to at least 16 rows so it visually resembles Form 434
  const minRows = Math.max(16, items.length + 4);
  for (let r = items.length; r < minRows; r++) {
    mainRows.push(
      new TableRow({
        cantSplit: true,
        children: [
          makeCell('', { width: 3456, size: 15, margins: { top: 60, bottom: 60 } }),
          makeCell('', { width: 850, size: 15, margins: { top: 60, bottom: 60 } }),
          makeCell('', { width: 1450, size: 15, margins: { top: 60, bottom: 60 } }),
          makeCell('', { width: 950, size: 15, margins: { top: 60, bottom: 60 } }),
          makeCell('', { width: 950, size: 15, margins: { top: 60, bottom: 60 } }),
          makeCell('', { width: 950, size: 15, margins: { top: 60, bottom: 60 } }),
          makeCell('', { width: 1050, size: 15, margins: { top: 60, bottom: 60 } }),
          makeCell('', { width: 1050, size: 15, margins: { top: 60, bottom: 60 } }),
        ],
      })
    );
  }

  const mainTable = new Table({
    width: { size: 10706, type: WidthType.DXA },
    rows: mainRows,
  });

  // Footer signatures (Отпустил / Получил)
  const footerSignTable = new Table({
    width: { size: 10706, type: WidthType.DXA },
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          makeCell('Отпустил', {
            width: 1200,
            size: 17,
            alignment: AlignmentType.LEFT,
            borders: NO_BORDERS,
          }),
          makeCell('Зав. каф. ПиСП', {
            width: 3400,
            size: 17,
            alignment: AlignmentType.CENTER,
            borders: BOTTOM_ONLY_BORDER,
          }),
          makeCell('', { width: 300, borders: NO_BORDERS }),
          makeCell('', { width: 2700, size: 17, borders: BOTTOM_ONLY_BORDER }),
          makeCell('', { width: 300, borders: NO_BORDERS }),
          makeCell('Ермоченко С.А.', {
            width: 2806,
            size: 17,
            alignment: AlignmentType.CENTER,
            borders: BOTTOM_ONLY_BORDER,
          }),
        ],
      }),
      new TableRow({
        children: [
          makeCell('', { width: 1200, borders: NO_BORDERS, margins: { top: 0, bottom: 30 } }),
          makeCell('должность', { width: 3400, size: 13, italics: true, borders: NO_BORDERS, margins: { top: 0, bottom: 30 } }),
          makeCell('', { width: 300, borders: NO_BORDERS, margins: { top: 0, bottom: 30 } }),
          makeCell('подпись', { width: 2700, size: 13, italics: true, borders: NO_BORDERS, margins: { top: 0, bottom: 30 } }),
          makeCell('', { width: 300, borders: NO_BORDERS, margins: { top: 0, bottom: 30 } }),
          makeCell('расшифровка подписи', { width: 2806, size: 13, italics: true, borders: NO_BORDERS, margins: { top: 0, bottom: 30 } }),
        ],
      }),
      new TableRow({
        children: [
          makeCell(`« ___ » ______________________ ${yearStr} г.`, {
            width: 10706,
            size: 17,
            alignment: AlignmentType.LEFT,
            borders: NO_BORDERS,
            columnSpan: 6,
            margins: { top: 60, bottom: 80 },
          }),
        ],
      }),
      new TableRow({
        cantSplit: true,
        children: [
          makeCell('Получил', {
            width: 1200,
            size: 17,
            alignment: AlignmentType.LEFT,
            borders: NO_BORDERS,
          }),
          makeCell('Нач. отд. ПТО и ЭУС ЦИТ (Д/М)', {
            width: 3400,
            size: 15,
            alignment: AlignmentType.CENTER,
            borders: BOTTOM_ONLY_BORDER,
          }),
          makeCell('', { width: 300, borders: NO_BORDERS }),
          makeCell('', { width: 2700, size: 17, borders: BOTTOM_ONLY_BORDER }),
          makeCell('', { width: 300, borders: NO_BORDERS }),
          makeCell('Фунтикова Т.Г.', {
            width: 2806,
            size: 17,
            alignment: AlignmentType.CENTER,
            borders: BOTTOM_ONLY_BORDER,
          }),
        ],
      }),
      new TableRow({
        children: [
          makeCell('', { width: 1200, borders: NO_BORDERS, margins: { top: 0, bottom: 10 } }),
          makeCell('должность', { width: 3400, size: 13, italics: true, borders: NO_BORDERS, margins: { top: 0, bottom: 10 } }),
          makeCell('', { width: 300, borders: NO_BORDERS, margins: { top: 0, bottom: 10 } }),
          makeCell('подпись', { width: 2700, size: 13, italics: true, borders: NO_BORDERS, margins: { top: 0, bottom: 10 } }),
          makeCell('', { width: 300, borders: NO_BORDERS, margins: { top: 0, bottom: 10 } }),
          makeCell('расшифровка подписи', { width: 2806, size: 13, italics: true, borders: NO_BORDERS, margins: { top: 0, bottom: 10 } }),
        ],
      }),
    ],
  });

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: {
              width: 11906,
              height: 16838,
              orientation: PageOrientation.PORTRAIT,
            },
            margin: { top: 450, bottom: 450, left: 600, right: 600 },
          },
        },
        children: [
          approvalHeaderTable,
          infoAndCodesGrid,
          mainTable,
          makeTextParagraph('', { spacingBefore: 100, spacingAfter: 40 }),
          footerSignTable,
        ],
      },
    ],
  });

  return await Packer.toBuffer(doc);
}

/**
 * Case 3: «АКТ НА СПИСАНИЕ ОТДЕЛЬНЫХ ПРЕДМЕТОВ В СОСТАВЕ ОБОРОТНЫХ СРЕДСТВ»
 * For «Малоценка» WITHOUT precious metals (ДМ).
 * - Multi-item Act (all selected items placed into a single 10-column table).
 * - No separate invoice needed.
 * - Column «Причина списания» (9–10) is intentionally left blank for manual completion.
 * - Sum = Price * Quantity.
 * - Commission: А.И. Раловец, Д.А. Лукин, А.Г. Яцук, Т.Л. Русецкая, С.А. Ермоченко.
 */
export async function generateLowValueNoDmWriteoffActDocx(
  items: EquipmentForDocx[],
  actNumber: string = '',
  options: WriteoffDocxOptions = {}
): Promise<Buffer> {
  const defaultDate = options.writeoffDate || options.actDate || new Date();
  const { year: docYear } = extractCalendarYMD(defaultDate);
  const yearStr = String(docYear);
  const actNumText = actNumber && String(actNumber).trim() ? String(actNumber).trim() : '';

  // Top Header: Organization left + Approval right
  const topBlock = new Table({
    width: { size: 10706, type: WidthType.DXA },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 4800, type: WidthType.DXA },
            borders: NO_BORDERS,
            verticalAlign: VerticalAlign.TOP,
            children: [
              new Table({
                width: { size: 4600, type: WidthType.DXA },
                rows: [
                  new TableRow({
                    children: [
                      makeCell('ВГУ имени П.М. Машерова', {
                        width: 4600,
                        size: 16,
                        alignment: AlignmentType.CENTER,
                        borders: BOTTOM_ONLY_BORDER,
                        margins: { top: 40, bottom: 20 },
                      }),
                    ],
                  }),
                  new TableRow({
                    children: [
                      makeCell('предприятие, организация', {
                        width: 4600,
                        size: 12,
                        italics: true,
                        alignment: AlignmentType.CENTER,
                        borders: NO_BORDERS,
                        margins: { top: 10, bottom: 20 },
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),
          new TableCell({
            width: { size: 5906, type: WidthType.DXA },
            borders: NO_BORDERS,
            verticalAlign: VerticalAlign.TOP,
            children: [
              makeTextParagraph('"У Т В Е Р Ж Д А Ю "', {
                size: 16,
                alignment: AlignmentType.CENTER,
                spacingAfter: 30,
              }),
              new Table({
                width: { size: 5700, type: WidthType.DXA },
                rows: [
                  new TableRow({
                    children: [
                      makeCell('Ректор ВГУ имени П.М. Машерова', {
                        width: 5700,
                        size: 16,
                        alignment: AlignmentType.CENTER,
                        borders: BOTTOM_ONLY_BORDER,
                        columnSpan: 2,
                        margins: { top: 20, bottom: 10 },
                      }),
                    ],
                  }),
                  new TableRow({
                    children: [
                      makeCell('должность', {
                        width: 5700,
                        size: 12,
                        italics: true,
                        alignment: AlignmentType.CENTER,
                        borders: NO_BORDERS,
                        columnSpan: 2,
                        margins: { top: 0, bottom: 40 },
                      }),
                    ],
                  }),
                  new TableRow({
                    children: [
                      makeCell('', {
                        width: 2400,
                        size: 16,
                        borders: BOTTOM_ONLY_BORDER,
                        margins: { top: 40, bottom: 10 },
                      }),
                      makeCell('В.В. Богатырёва', {
                        width: 3300,
                        size: 16,
                        alignment: AlignmentType.CENTER,
                        borders: BOTTOM_ONLY_BORDER,
                        margins: { top: 40, bottom: 10 },
                      }),
                    ],
                  }),
                  new TableRow({
                    children: [
                      makeCell('подпись', {
                        width: 2400,
                        size: 12,
                        italics: true,
                        borders: NO_BORDERS,
                        margins: { top: 0, bottom: 20 },
                      }),
                      makeCell('И.О. Фамилия', {
                        width: 3300,
                        size: 12,
                        italics: true,
                        borders: NO_BORDERS,
                        margins: { top: 0, bottom: 20 },
                      }),
                    ],
                  }),
                ],
              }),
              makeTextParagraph(`" ____ " _______________________ ${yearStr} г.`, {
                size: 16,
                alignment: AlignmentType.CENTER,
                spacingBefore: 20,
              }),
            ],
          }),
        ],
      }),
    ],
  });

  // АКТ № [bordered box]
  const actNumberGrid = new Table({
    width: { size: 10706, type: WidthType.DXA },
    rows: [
      new TableRow({
        children: [
          makeCell('АКТ №', {
            width: 5200,
            size: 17,
            alignment: AlignmentType.RIGHT,
            borders: NO_BORDERS,
            margins: { top: 40, bottom: 40, right: 80 },
          }),
          makeCell(actNumText, {
            width: 1400,
            size: 17,
            bold: true,
            alignment: AlignmentType.CENTER,
            margins: { top: 40, bottom: 40 },
          }),
          makeCell('', { width: 4106, borders: NO_BORDERS }),
        ],
      }),
    ],
  });

  // Top small metadata table (6 columns totaling 10706, matching Case 3 screenshot)
  const metaTable = new Table({
    width: { size: 10706, type: WidthType.DXA },
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          makeCell('', { width: 1550, size: 14, rowSpan: 2 }),
          makeCell('Вид операции', { width: 1950, size: 14, rowSpan: 2 }),
          makeCell('Цех (отдел) участок', { width: 1150, size: 14, rowSpan: 2 }),
          makeCell('Кладовая', { width: 1100, size: 14, rowSpan: 2 }),
          makeCell('Корреспондирующий счет', { width: 4956, size: 14, columnSpan: 2 }),
        ],
      }),
      new TableRow({
        cantSplit: true,
        children: [
          makeCell('счет, субсчет', { width: 1750, size: 14 }),
          makeCell('код аналитического учета', { width: 3206, size: 14 }),
        ],
      }),
      new TableRow({
        cantSplit: true,
        children: [
          makeCell('', { width: 1550, size: 15, margins: { top: 80, bottom: 80 } }),
          makeCell('', { width: 1950, size: 15, margins: { top: 80, bottom: 80 } }),
          makeCell('', { width: 1150, size: 15, margins: { top: 80, bottom: 80 } }),
          makeCell('', { width: 1100, size: 15, margins: { top: 80, bottom: 80 } }),
          makeCell('', { width: 1750, size: 15, margins: { top: 80, bottom: 80 } }),
          makeCell('', { width: 3206, size: 15, margins: { top: 80, bottom: 80 } }),
        ],
      }),
    ],
  });

  // 10-column item table header helper (total width 10706)
  // Widths: [2050, 1450, 500, 700, 1150, 700, 850, 900, 600, 1806] = 10706
  const buildTenColHeaderRows = (): TableRow[] => [
    new TableRow({
      cantSplit: true,
      children: [
        makeCell('Предмет', { width: 3500, size: 14, bold: true, columnSpan: 2 }),
        makeCell('Единица измерения', { width: 1200, size: 13, bold: true, columnSpan: 2 }),
        makeCell('Дата поступления в эксплуатацию', { width: 1150, size: 13, bold: true, rowSpan: 2 }),
        makeCell('Количество', { width: 700, size: 13, bold: true, rowSpan: 2 }),
        makeCell('Цена', { width: 850, size: 14, bold: true, rowSpan: 2 }),
        makeCell('Сумма', { width: 900, size: 14, bold: true, rowSpan: 2 }),
        makeCell('Причина списания', { width: 2406, size: 14, bold: true, columnSpan: 2 }),
      ],
    }),
    new TableRow({
      cantSplit: true,
      children: [
        makeCell('наименование', { width: 2050, size: 13 }),
        makeCell('код (номенклатурный номер)', { width: 1450, size: 12 }),
        makeCell('код', { width: 500, size: 13 }),
        makeCell('наименование', { width: 700, size: 12 }),
        makeCell('код', { width: 600, size: 13 }),
        makeCell('наименование', { width: 1806, size: 13 }),
      ],
    }),
    new TableRow({
      cantSplit: true,
      children: [
        makeCell('1', { width: 2050, size: 13 }),
        makeCell('2', { width: 1450, size: 13 }),
        makeCell('3', { width: 500, size: 13 }),
        makeCell('4', { width: 700, size: 13 }),
        makeCell('5', { width: 1150, size: 13 }),
        makeCell('6', { width: 700, size: 13 }),
        makeCell('7', { width: 850, size: 13 }),
        makeCell('8', { width: 900, size: 13 }),
        makeCell('9', { width: 600, size: 13 }),
        makeCell('10', { width: 1806, size: 13 }),
      ],
    }),
  ];

  const makeTenColItemRow = (item: EquipmentForDocx) => {
    const qty =
      Number(item.additional_fields?.quantity) > 0
        ? Number(item.additional_fields?.quantity)
        : 1;
    const unitPrice =
      typeof item.initial_cost === 'number'
        ? item.initial_cost
        : parseFloat(String(item.initial_cost || 0).replace(/\s+/g, '').replace(',', '.')) || 0;
    const totalSum = Math.round(unitPrice * qty * 100) / 100;
    const accountingName =
      item.additional_fields?.['Наименование (по бухгалтерии)'] || item.name;
    const dateReceivedStr = formatDateRu(item.recivedRaw || item.recivedDate);

    return new TableRow({
      cantSplit: true,
      children: [
        makeCell(accountingName, {
          width: 2050,
          size: 14,
          alignment: AlignmentType.LEFT,
          margins: { top: 40, bottom: 40, left: 50, right: 40 },
        }),
        makeCell(item.inventory_number, {
          width: 1450,
          size: 14,
          alignment: AlignmentType.CENTER,
        }),
        makeCell('', { width: 500, size: 14 }),
        makeCell('шт.', {
          width: 700,
          size: 14,
          alignment: AlignmentType.CENTER,
        }),
        makeCell(dateReceivedStr, {
          width: 1150,
          size: 14,
          alignment: AlignmentType.CENTER,
        }),
        makeCell(String(qty), {
          width: 700,
          size: 14,
          alignment: AlignmentType.CENTER,
        }),
        makeCell(formatRubKopFixed2(unitPrice), {
          width: 850,
          size: 14,
          alignment: AlignmentType.CENTER,
        }),
        makeCell(formatRubKopFixed2(totalSum), {
          width: 900,
          size: 14,
          alignment: AlignmentType.CENTER,
        }),
        // Columns 9 & 10 («Причина списания») intentionally left blank for manual entry
        makeCell('', { width: 600, size: 14 }),
        makeCell('', { width: 1806, size: 14 }),
      ],
    });
  };

  const makeEmptyTenColRow = () =>
    new TableRow({
      cantSplit: true,
      children: [
        makeCell('', { width: 2050, size: 14, margins: { top: 65, bottom: 65 } }),
        makeCell('', { width: 1450, size: 14, margins: { top: 65, bottom: 65 } }),
        makeCell('', { width: 500, size: 14, margins: { top: 65, bottom: 65 } }),
        makeCell('', { width: 700, size: 14, margins: { top: 65, bottom: 65 } }),
        makeCell('', { width: 1150, size: 14, margins: { top: 65, bottom: 65 } }),
        makeCell('', { width: 700, size: 14, margins: { top: 65, bottom: 65 } }),
        makeCell('', { width: 850, size: 14, margins: { top: 65, bottom: 65 } }),
        makeCell('', { width: 900, size: 14, margins: { top: 65, bottom: 65 } }),
        makeCell('', { width: 600, size: 14, margins: { top: 65, bottom: 65 } }),
        makeCell('', { width: 1806, size: 14, margins: { top: 65, bottom: 65 } }),
      ],
    });

  // Split items between Front (up to 15) and Back continuation (overflow + blank rows)
  const frontItems = items.slice(0, 15);
  const backOverflowItems = items.slice(15);

  const frontTableRows: TableRow[] = [
    ...buildTenColHeaderRows(),
    ...frontItems.map(makeTenColItemRow),
  ];
  for (let i = frontItems.length; i < 15; i++) {
    frontTableRows.push(makeEmptyTenColRow());
  }

  const frontItemsTable = new Table({
    width: { size: 10706, type: WidthType.DXA },
    rows: frontTableRows,
  });

  const backTableRows: TableRow[] = [
    ...buildTenColHeaderRows(),
    ...backOverflowItems.map(makeTenColItemRow),
  ];
  const backMinRows = Math.max(12, backOverflowItems.length + 3);
  for (let i = backOverflowItems.length; i < backMinRows; i++) {
    backTableRows.push(makeEmptyTenColRow());
  }

  const backContinuationTable = new Table({
    width: { size: 10706, type: WidthType.DXA },
    rows: backTableRows,
  });

  // Back side Утиль 8-col table (Col 3: наименование, Col 4: код — matching Case 3 back screenshot)
  const scrapTable = new Table({
    width: { size: 10706, type: WidthType.DXA },
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          makeCell('Утиль', { width: 3600, size: 14, bold: true, columnSpan: 2 }),
          makeCell('Единица измерения', { width: 1700, size: 13, bold: true, columnSpan: 2 }),
          makeCell('Количество', { width: 950, size: 14, bold: true, rowSpan: 2 }),
          makeCell('Цена', { width: 1050, size: 14, bold: true, rowSpan: 2 }),
          makeCell('Сумма', { width: 1100, size: 14, bold: true, rowSpan: 2 }),
          makeCell('Порядковый номер записи по складской картотеке', {
            width: 2306,
            size: 13,
            bold: true,
            rowSpan: 2,
          }),
        ],
      }),
      new TableRow({
        cantSplit: true,
        children: [
          makeCell('наименование', { width: 2050, size: 13 }),
          makeCell('код (номенклатурный номер)', { width: 1550, size: 12 }),
          makeCell('наименование', { width: 950, size: 12 }),
          makeCell('код', { width: 750, size: 13 }),
        ],
      }),
      new TableRow({
        cantSplit: true,
        children: [
          makeCell('1', { width: 2050, size: 13 }),
          makeCell('2', { width: 1550, size: 13 }),
          makeCell('3', { width: 950, size: 13 }),
          makeCell('4', { width: 750, size: 13 }),
          makeCell('5', { width: 950, size: 13 }),
          makeCell('6', { width: 1050, size: 13 }),
          makeCell('7', { width: 1100, size: 13 }),
          makeCell('8', { width: 2306, size: 13 }),
        ],
      }),
      ...Array.from({ length: 8 }, () =>
        new TableRow({
          cantSplit: true,
          children: [
            makeCell('', { width: 2050, size: 14, margins: { top: 55, bottom: 55 } }),
            makeCell('', { width: 1550, size: 14, margins: { top: 55, bottom: 55 } }),
            makeCell('', { width: 950, size: 14, margins: { top: 55, bottom: 55 } }),
            makeCell('', { width: 750, size: 14, margins: { top: 55, bottom: 55 } }),
            makeCell('', { width: 950, size: 14, margins: { top: 55, bottom: 55 } }),
            makeCell('', { width: 1050, size: 14, margins: { top: 55, bottom: 55 } }),
            makeCell('', { width: 1100, size: 14, margins: { top: 55, bottom: 55 } }),
            makeCell('', { width: 2306, size: 14, margins: { top: 55, bottom: 55 } }),
          ],
        })
      ),
    ],
  });

  // Back side Commission Signatures (5 people in Case 3 screenshot order)
  const commissionEntries: Array<[string, string, string]> = [
    ['Председатель комиссии', 'Проректор', 'А.И. Раловец'],
    ['Члены комиссии:', 'Зам.нач. ЦБУ и Ф', 'Д.А. Лукин'],
    ['', 'Ведущий инж.энергетик', 'А.Г. Яцук'],
    ['', 'Бухгалтер ЦБУ и Ф', 'Т.Л. Русецкая'],
    ['', 'МОЛ', 'С.А. Ермоченко'],
  ];

  const signRows: TableRow[] = [];
  commissionEntries.forEach(([label, role, person]) => {
    signRows.push(
      new TableRow({
        cantSplit: true,
        children: [
          makeCell(label, {
            width: 2800,
            size: 16,
            alignment: AlignmentType.LEFT,
            borders: NO_BORDERS,
            margins: { top: 30, bottom: 10 },
          }),
          makeCell(role, {
            width: 2900,
            size: 16,
            alignment: AlignmentType.LEFT,
            borders: BOTTOM_ONLY_BORDER,
            margins: { top: 30, bottom: 10 },
          }),
          makeCell('', { width: 350, borders: NO_BORDERS }),
          makeCell('', {
            width: 1750,
            size: 16,
            borders: BOTTOM_ONLY_BORDER,
            margins: { top: 30, bottom: 10 },
          }),
          makeCell('', { width: 350, borders: NO_BORDERS }),
          makeCell(person, {
            width: 2556,
            size: 16,
            alignment: AlignmentType.LEFT,
            borders: BOTTOM_ONLY_BORDER,
            margins: { top: 30, bottom: 10 },
          }),
        ],
      }),
      new TableRow({
        cantSplit: true,
        children: [
          makeCell('', { width: 2800, borders: NO_BORDERS, margins: { top: 0, bottom: 20 } }),
          makeCell('должность', {
            width: 2900,
            size: 12,
            italics: true,
            borders: NO_BORDERS,
            margins: { top: 0, bottom: 20 },
          }),
          makeCell('', { width: 350, borders: NO_BORDERS, margins: { top: 0, bottom: 20 } }),
          makeCell('подпись', {
            width: 1750,
            size: 12,
            italics: true,
            borders: NO_BORDERS,
            margins: { top: 0, bottom: 20 },
          }),
          makeCell('', { width: 350, borders: NO_BORDERS, margins: { top: 0, bottom: 20 } }),
          makeCell('И., О., Фамилия', {
            width: 2556,
            size: 12,
            italics: true,
            borders: NO_BORDERS,
            margins: { top: 0, bottom: 20 },
          }),
        ],
      })
    );
  });

  const backSignTable = new Table({
    width: { size: 10706, type: WidthType.DXA },
    rows: signRows,
  });

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: {
              width: 11906,
              height: 16838,
              orientation: PageOrientation.PORTRAIT,
            },
            margin: { top: 450, bottom: 450, left: 600, right: 600 },
          },
        },
        children: [
          // FRONT SIDE (Страница 1)
          topBlock,
          makeTextParagraph('', { spacingBefore: 40, spacingAfter: 20 }),
          actNumberGrid,
          makeTextParagraph('НА СПИСАНИЕ ОТДЕЛЬНЫХ ПРЕДМЕТОВ В СОСТАВЕ ОБОРОТНЫХ СРЕДСТВ', {
            size: 17,
            bold: true,
            alignment: AlignmentType.CENTER,
            spacingBefore: 20,
            spacingAfter: 30,
          }),
          makeTextParagraph(`" ____ " _______________________ ${yearStr} г.`, {
            size: 16,
            alignment: AlignmentType.CENTER,
            spacingAfter: 80,
          }),
          makeTextParagraph(
            `Комиссия, назначенная приказом от   22   сентября ${yearStr} г.   №322   осмотрела принятые за _________________ г., находившиеся в эксплуатации малоценные и быстроизнашивающиеся предметы и признала их пришедшими в негодность и подлежащими сдаче в утиль`,
            {
              size: 15,
              alignment: AlignmentType.LEFT,
              spacingAfter: 80,
            }
          ),
          metaTable,
          frontItemsTable,

          // PAGE BREAK TO REVERSE SIDE (Страница 2)
          new Paragraph({ children: [new PageBreak()] }),

          backContinuationTable,
          makeTextParagraph('___________________________________________________________', {
            size: 14,
            alignment: AlignmentType.CENTER,
            spacingBefore: 80,
            spacingAfter: 0,
          }),
          makeTextParagraph('общее количество предметов прописью', {
            size: 11,
            italics: true,
            alignment: AlignmentType.CENTER,
            spacingAfter: 60,
          }),
          makeTextParagraph(
            'Номера и даты актов выбытия ________________________________________________________________________',
            {
              size: 15,
              alignment: AlignmentType.LEFT,
              spacingAfter: 60,
            }
          ),
          makeTextParagraph(
            'Перечисленные в настоящем акте предметы в присутствии комиссии превращены в утиль, который подлежит оприходованию:',
            {
              size: 15,
              alignment: AlignmentType.LEFT,
              spacingAfter: 60,
            }
          ),
          scrapTable,
          makeTextParagraph('Утиль, не подлежащий учету, уничтожен.', {
            size: 15,
            spacingBefore: 70,
            spacingAfter: 70,
          }),
          backSignTable,
          makeTextParagraph(
            `Утиль по накладной № ____________________  сдан   " ___ " ___________________ ${yearStr} г.`,
            {
              size: 15,
              alignment: AlignmentType.LEFT,
              spacingBefore: 160,
            }
          ),
        ],
      },
    ],
  });

  return await Packer.toBuffer(doc);
}


