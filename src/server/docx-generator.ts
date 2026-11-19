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
import { encodeEquipmentQrToken, encodeGroupQrToken } from './qr-token.ts';
import {
  mergeRequisites,
  type LoadedTemplateState,
  type TemplateRequisites,
  type WriteoffTemplateKey,
} from './writeoff-templates.ts';
import {
  mergeDocxBuffers,
  renderPerItemSectionTemplateDocx,
  renderTableTemplateDocx,
} from './docx-template-engine.ts';

export interface EquipmentForDocx {
  id: number;
  qrCode?: string;
  inventory_number: string | null;
  name: string;
  typeName: string;
  roomNumber: string | null;
  initial_cost: number | string | null;
  residual_cost: number | string | null;
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
  requisites?: TemplateRequisites;
  templateMode?: boolean;
}

export interface TransferInvoiceOptions {
  invoiceNumber?: string;
  invoiceDate?: Date | string | null;
  organization?: string;
  sender?: string;
  recipient?: string;
  note?: string;
  requisites?: TemplateRequisites;
  templateMode?: boolean;
}

export interface QrDocxOptions {
  qrSizeCm?: number;
}

const MIN_QR_SIZE_CM = 0.8;
const MAX_QR_SIZE_CM = 10;
const DEFAULT_QR_SIZE_CM = 3;

function normalizeQrSizeCm(sizeCm?: number): number {
  if (typeof sizeCm !== 'number' || !Number.isFinite(sizeCm)) {
    return DEFAULT_QR_SIZE_CM;
  }
  const clamped = Math.min(MAX_QR_SIZE_CM, Math.max(MIN_QR_SIZE_CM, sizeCm));
  return Math.round(clamped * 10) / 10;
}

function cmToDocxPx(cm: number): number {
  // docx converts px -> EMU via Math.round(px * 9525); 1 inch = 2.54 cm = 96 CSS px
  return Number(((cm / 2.54) * 96).toFixed(3));
}

function cmToRasterPx(cm: number): number {
  // ~300 DPI raster source for crisp laser/label printing
  return Math.max(200, Math.min(900, Math.round((cm / 2.54) * 300)));
}

function formatCmText(cm: number): string {
  return Number.isInteger(cm) ? String(cm) : cm.toFixed(1).replace('.', ',');
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

function isEmptyDateValue(input: Date | string | null | undefined): boolean {
  if (!input) return true;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    return !trimmed || trimmed === '—' || trimmed === '-';
  }
  return false;
}

export function formatDateRu(input: Date | string | null | undefined): string {
  if (isEmptyDateValue(input)) return '';
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
  if (isEmptyDateValue(startInput)) {
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
  baseUrl: string,
  options: QrDocxOptions = {}
): Promise<Buffer> {
  const qrSizeCm = normalizeQrSizeCm(options.qrSizeCm);
  const qrDocxPx = cmToDocxPx(qrSizeCm);
  const qrRasterPx = cmToRasterPx(qrSizeCm);
  const sizeLabel = `${formatCmText(qrSizeCm)}×${formatCmText(qrSizeCm)} см`;

  // Adaptive columns & typography for A4 portrait (total table width 9600 DXA ≈ 16.9 cm)
  const columns =
    qrSizeCm <= 1.8 ? 4 : qrSizeCm <= 2.6 ? 3 : qrSizeCm <= 6.5 ? 2 : 1;
  const totalTableWidth = 9600;
  const cellWidth = Math.floor(totalTableWidth / columns);

  const cellMargin =
    columns === 4 ? 90 : columns === 3 ? 120 : columns === 2 ? 160 : 200;
  const nameFontSize =
    columns === 4 ? 15 : columns === 3 ? 18 : columns === 2 ? 22 : 24;
  const invFontSize =
    columns === 4 ? 15 : columns === 3 ? 17 : columns === 2 ? 20 : 22;
  const metaFontSize =
    columns === 4 ? 12 : columns === 3 ? 14 : columns === 2 ? 16 : 18;
  const imageSpacing = columns === 4 ? 40 : 80;
  const qrWidthDxa = Math.round((qrSizeCm / 2.54) * 1440);
  const innerPadH = columns === 4 ? 45 : 80;
  const innerPadTop = columns === 4 ? 45 : 70;
  const innerPadBottom = columns === 4 ? 40 : 55;
  const maxInnerWidth = Math.max(400, cellWidth - cellMargin * 2);
  const innerBoxWidth = Math.min(maxInnerWidth, qrWidthDxa + innerPadH * 2);

  const cutFrameBorder = {
    style: BorderStyle.SINGLE,
    size: 8,
    color: '1E40AF',
  } as const;

  const cutFrameTableBorders = {
    top: cutFrameBorder,
    bottom: cutFrameBorder,
    left: cutFrameBorder,
    right: cutFrameBorder,
    insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  } as const;

  const cutFrameCellBorders = {
    top: cutFrameBorder,
    bottom: cutFrameBorder,
    left: cutFrameBorder,
    right: cutFrameBorder,
  } as const;

  const tableRows: TableRow[] = [];

  for (let i = 0; i < items.length; i += columns) {
    const rowItems = items.slice(i, i + columns);
    const cells: TableCell[] = [];

    for (const item of rowItems) {
      const qrPayload = item.qrCode || encodeEquipmentQrToken(item.id);
      const qrBuffer = await QRCode.toBuffer(qrPayload, {
        width: qrRasterPx,
        margin: 1,
        errorCorrectionLevel: 'M',
      });
      const labelText = `${item.inventory_number || 'б/н'}::${item.id}`;

      const qrCutBox = new Table({
        alignment: AlignmentType.CENTER,
        width: { size: innerBoxWidth, type: WidthType.DXA },
        columnWidths: [innerBoxWidth],
        borders: cutFrameTableBorders,
        rows: [
          new TableRow({
            cantSplit: true,
            children: [
              new TableCell({
                width: { size: innerBoxWidth, type: WidthType.DXA },
                verticalAlign: VerticalAlign.CENTER,
                margins: {
                  top: innerPadTop,
                  bottom: innerPadBottom,
                  left: innerPadH,
                  right: innerPadH,
                },
                borders: cutFrameCellBorders,
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: { before: 0, after: 0 },
                    children: [
                      new ImageRun({
                        data: qrBuffer,
                        transformation: { width: qrDocxPx, height: qrDocxPx },
                        type: 'png',
                      }),
                    ],
                  }),
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: { before: 0, after: 0 },
                    children: [
                      new TextRun({
                        text: labelText,
                        bold: true,
                        size: invFontSize,
                        color: '1E40AF',
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ],
      });

      const cell = new TableCell({
        width: { size: cellWidth, type: WidthType.DXA },
        verticalAlign: VerticalAlign.CENTER,
        margins: {
          top: cellMargin,
          bottom: cellMargin,
          left: cellMargin,
          right: cellMargin,
        },
        borders: {
          top: { style: BorderStyle.SINGLE, size: 8, color: '64748B' },
          bottom: { style: BorderStyle.SINGLE, size: 8, color: '64748B' },
          left: { style: BorderStyle.SINGLE, size: 8, color: '64748B' },
          right: { style: BorderStyle.SINGLE, size: 8, color: '64748B' },
        },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: imageSpacing },
            children: [
              new TextRun({
                text: item.name,
                bold: true,
                size: nameFontSize,
                color: '0F172A',
              }),
            ],
          }),
          qrCutBox,
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: imageSpacing, after: 0 },
            children: [
              new TextRun({
                text: `Тип: ${item.typeName || 'Без типа'}${item.roomNumber ? ` | Каб. ${item.roomNumber}` : ''}`,
                size: metaFontSize,
                color: '64748B',
              }),
            ],
          }),
        ],
      });
      cells.push(cell);
    }

    while (cells.length < columns) {
      cells.push(
        new TableCell({
          width: { size: cellWidth, type: WidthType.DXA },
          borders: NO_BORDERS,
          children: [new Paragraph({})],
        })
      );
    }

    tableRows.push(new TableRow({ cantSplit: true, children: cells }));
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 650, bottom: 650, left: 850, right: 850 },
          },
        },
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            spacing: { after: 180 },
            children: [
              new TextRun({
                text: 'Инвентарные этикетки',
                bold: true,
                size: 28,
                color: '1E3A8A',
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 280 },
            children: [
              new TextRun({
                text: `Комплект QR-наклеек (${items.length} шт. • QR ${sizeLabel})`,
                italics: true,
                size: 20,
                color: '475569',
              }),
            ],
          }),
          new Table({
            rows: tableRows,
            width: { size: totalTableWidth, type: WidthType.DXA },
          }),
        ],
      },
    ],
  });

  return await Packer.toBuffer(doc);
}

export function isPreciousMetalsFlag(val: unknown): boolean {
  if (val === true || val === 1) return true;
  if (typeof val === 'string') {
    const s = val.trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'да' || s === 'yes';
  }
  return false;
}

export function detectEquipmentWriteoffCase(item: {
  inventory_number?: string | null;
  additional_fields?: Record<string, any> | null;
}): 'case1' | 'case2' | 'case3' | null {
  if (!item.inventory_number || !String(item.inventory_number).trim()) {
    return null;
  }
  const cat = String(item.additional_fields?.accounting_category || '').toLowerCase();
  const hasDm = isPreciousMetalsFlag(item.additional_fields?.precious_metals);
  if (cat.includes('малоцен') && hasDm) return 'case2';
  if (cat.includes('малоцен') && !hasDm) return 'case3';
  if (cat.includes('дорогостоящ') && hasDm) return 'case1';
  return null;
}

/**
 * Case 1: «АКТ О СПИСАНИИ ИМУЩЕСТВА»
 * One separate Act section (A4 Landscape page) is generated for EACH equipment unit.
 */
export function buildWriteoffCase1Sections(
  items: EquipmentForDocx[],
  actNumber: string,
  options: WriteoffDocxOptions = {}
) {
  const reqCfg = mergeRequisites('case1_act', options.requisites as Record<string, any> | undefined);
  const organization = options.organization || reqCfg.organization || 'ВГУ имени П.М.Машерова';
  const defaultDate = options.actDate || options.writeoffDate || new Date();
  const reason = options.templateMode
    ? '{{REASON}}'
    : options.reason || 'начисленная амортизация составляет 100%';
  const techConclusion = options.technicalConclusionNumber || '';
  const approverRoleLines = (reqCfg.approverRole || 'Руководитель организации\nРектор ВГУ\nимени П.М.Машерова')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const approverName = reqCfg.approverName || 'В.В.Богатырёва';

  const sections = items.map((item, idx) => {
    const effectiveWriteoffDate =
      options.writeoffDate || item.writeoffDate || options.actDate || defaultDate;
    const { year: actYear } = extractCalendarYMD(effectiveWriteoffDate);
    const serviceLife = calculateServiceLife(
      item.recivedRaw || item.recivedDate,
      effectiveWriteoffDate
    );
    const accountingName = options.templateMode
      ? '{{ITEM_NAME}}'
      : item.additional_fields?.['Наименование (по бухгалтерии)'] || item.name;
    const invText = options.templateMode ? '{{ITEM_INVENTORY_NUMBER}}' : item.inventory_number || 'б/н';
    const serviceLifeText = options.templateMode ? '{{ITEM_SERVICE_LIFE}}' : serviceLife.formatted;
    const initialCostFormatted = options.templateMode
      ? '{{ITEM_INITIAL_COST}}'
      : formatRubKop(item.initial_cost);
    const accumAmortText = options.templateMode
      ? '{{ITEM_ACCUMULATED_AMORTIZATION}}'
      : initialCostFormatted;
    const residualText = options.templateMode ? '{{ITEM_RESIDUAL_COST}}' : '';
    const itemActNumber = options.templateMode
      ? '{{ACT_NUMBER}}'
      : items.length > 1 && actNumber && !actNumber.includes('ПРИМЕР')
      ? `${actNumber}/${idx + 1}`
      : actNumber;
    const actDateText = options.templateMode ? '{{WRITEOFF_DATE}}' : formatDateRu(effectiveWriteoffDate);
    const yearSuffix = options.templateMode ? '{{WRITEOFF_YEAR_SHORT}}' : String(actYear).slice(-2);

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
            makeCell(actDateText, {
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
            makeCell(approverName, {
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
                ...approverRoleLines.map((line, lIdx) =>
                  makeTextParagraph(line, {
                    size: 18,
                    spacingAfter: lIdx === approverRoleLines.length - 1 ? 40 : 0,
                  })
                ),
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
            makeCell(invText, {
              width: 1900,
              size: 18,
              alignment: AlignmentType.CENTER,
              margins: { top: 80, bottom: 80, left: 60, right: 60 },
            }),
            makeCell(serviceLifeText, {
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
            makeCell(accumAmortText, {
              width: 2000,
              size: 18,
              alignment: AlignmentType.CENTER,
              margins: { top: 80, bottom: 80, left: 60, right: 60 },
            }),
            makeCell(residualText, {
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
              reqCfg.conclusionText ||
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
              options.templateMode
                ? '{{TECH_CONCLUSION_TEXT}}'
                : techConclusion
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

    const chair = reqCfg.commissionChair || { title: 'Проректор', name: 'Раловец А.И' };
    const members = Array.isArray(reqCfg.commissionMembers) ? reqCfg.commissionMembers : [];
    const commissionRows: Array<[string, string, string]> = [
      ['Председатель комиссии по списанию имущества:', chair.title, chair.name],
      ...members.map((m, mIdx): [string, string, string] => [
        mIdx === 0 ? 'Члены комиссии по списанию имущества:' : '',
        m.title,
        m.name,
      ]),
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

    const molEntry = reqCfg.mol || { title: 'Заведующий кафедрой ПиСП', name: 'Ермоченко С.А.' };
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
          makeCell(molEntry.title, {
            width: 4400,
            size: 17,
            alignment: AlignmentType.CENTER,
            borders: BOTTOM_ONLY_BORDER,
            margins: { top: 20, bottom: 15 },
          }),
          makeCell('', { width: 800, borders: NO_BORDERS }),
          makeCell('', { width: 2400, size: 17, borders: BOTTOM_ONLY_BORDER, margins: { top: 20, bottom: 15 } }),
          makeCell('', { width: 800, borders: NO_BORDERS }),
          makeCell(molEntry.name, {
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
          reqCfg.recycleDecisionText ||
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

  return sections;
}

export async function generateWriteoffDocx(
  items: EquipmentForDocx[],
  actNumber: string,
  options: WriteoffDocxOptions = {}
): Promise<Buffer> {
  const sections = buildWriteoffCase1Sections(items, actNumber, options);
  const doc = new Document({ sections });
  return await Packer.toBuffer(doc);
}

/**
 * Case 1: «НАКЛАДНАЯ на внутреннее перемещение объектов основных средств» (Форма по ОКУД 0501460)
 * Transfer to ЦИТ for recycling (supports multiple items spanning front and back of A4 sheet).
 * Kit components ("из комплекта" or is_kit_part) automatically omit cost columns (cols 6 & 7).
 */
export function buildTransferInvoiceCase1Sections(
  items: EquipmentForDocx[],
  options: TransferInvoiceOptions = {}
) {
  const reqCfg = mergeRequisites('case1_invoice', options.requisites as Record<string, any> | undefined);
  const organization = options.organization || reqCfg.organization || 'ВГУ имени П.М.Машерова';
  const sender = options.templateMode
    ? '{{SENDER}}'
    : options.sender && options.sender !== 'Кафедра ПиСП'
    ? options.sender
    : reqCfg.sender || options.sender || 'Кафедра ПиСП';
  const recipient = options.templateMode
    ? '{{RECIPIENT}}'
    : options.recipient && options.recipient !== 'ЦИТ'
    ? options.recipient
    : reqCfg.recipient || options.recipient || 'ЦИТ';
  const invoiceNumber = options.templateMode ? '{{DOC_NUMBER}}' : options.invoiceNumber || '';
  const invoiceDate = options.templateMode
    ? '{{DOC_DATE}}'
    : options.invoiceDate
    ? formatDateRu(options.invoiceDate)
    : '';
  const note = options.templateMode ? '{{NOTE}}' : options.note || '';

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

  if (options.templateMode) {
    mainRows.push(
      new TableRow({
        cantSplit: true,
        children: [
          makeCell('{{ROW_NUM}}', {
            width: 650,
            size: 16,
            alignment: AlignmentType.CENTER,
            margins: { top: 30, bottom: 30, left: 40, right: 40 },
          }),
          makeCell('{{ITEM_NAME}}', {
            width: 3856,
            size: 16,
            alignment: AlignmentType.LEFT,
            margins: { top: 30, bottom: 30, left: 60, right: 50 },
          }),
          makeCell('{{ITEM_RECEIVED_DATE}}', {
            width: 1450,
            size: 16,
            alignment: AlignmentType.CENTER,
            margins: { top: 30, bottom: 30, left: 40, right: 40 },
          }),
          makeCell('{{ITEM_INVENTORY_NUMBER}}', {
            width: 1450,
            size: 16,
            alignment: AlignmentType.CENTER,
            margins: { top: 30, bottom: 30, left: 40, right: 40 },
          }),
          makeCell('{{ITEM_QTY}}', {
            width: 900,
            size: 16,
            alignment: AlignmentType.CENTER,
            margins: { top: 30, bottom: 30, left: 40, right: 40 },
          }),
          makeCell('{{ITEM_UNIT_COST}}', {
            width: 1150,
            size: 16,
            alignment: AlignmentType.CENTER,
            margins: { top: 30, bottom: 30, left: 40, right: 40 },
          }),
          makeCell('{{ITEM_TOTAL_COST}}', {
            width: 1150,
            size: 16,
            alignment: AlignmentType.CENTER,
            margins: { top: 30, bottom: 30, left: 40, right: 40 },
          }),
        ],
      })
    );
  } else {
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
            makeCell(item.inventory_number || 'б/н', {
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
  }

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
        makeCell(options.templateMode ? '{{TOTAL_QTY}}' : String(totalQty), {
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
        makeCell(options.templateMode ? '{{TOTAL_SUM}}' : formatRubKop(totalSum), {
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

  const senderSign = reqCfg.senderSign || { title: 'Заведующий каф. ПиСП', name: 'Ермоченко С.А.' };
  const recipientSign = reqCfg.recipientSign || { title: 'Нач.отд. ПТО и ЭУС ЦИТ (Д/М)', name: 'Фунтикова Т.Г.' };
  const chiefAccountantName = reqCfg.chiefAccountantName || 'Л.Н.Прокопкина';

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
          makeCell(senderSign.title, { width: 4200, size: 17, borders: BOTTOM_ONLY_BORDER }),
          makeCell('', { width: 500, borders: NO_BORDERS }),
          makeCell('', { width: 1800, size: 17, borders: BOTTOM_ONLY_BORDER }),
          makeCell('', { width: 500, borders: NO_BORDERS }),
          makeCell(senderSign.name, { width: 2606, size: 17, borders: BOTTOM_ONLY_BORDER }),
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
          makeCell(recipientSign.title, { width: 4200, size: 17, borders: BOTTOM_ONLY_BORDER }),
          makeCell('', { width: 500, borders: NO_BORDERS }),
          makeCell('', { width: 1800, size: 17, borders: BOTTOM_ONLY_BORDER }),
          makeCell('', { width: 500, borders: NO_BORDERS }),
          makeCell(recipientSign.name, { width: 2606, size: 17, borders: BOTTOM_ONLY_BORDER }),
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
          makeCell(chiefAccountantName, {
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

  return [
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
  ];
}

export async function generateTransferInvoiceDocx(
  items: EquipmentForDocx[],
  options: TransferInvoiceOptions = {}
): Promise<Buffer> {
  const sections = buildTransferInvoiceCase1Sections(items, options);
  const doc = new Document({ sections });
  return await Packer.toBuffer(doc);
}

export interface GroupQrBatchData {
  id?: number;
  qrCode?: string;
  code: string;
  name: string;
  roomNumber?: string | null;
  items: EquipmentForDocx[];
}

export async function generateGroupQrDocx(
  batch: GroupQrBatchData,
  _baseUrl: string,
  options: QrDocxOptions = {}
): Promise<Buffer> {
  const qrSizeCm = normalizeQrSizeCm(options.qrSizeCm);
  const qrDocxPx = cmToDocxPx(qrSizeCm);
  const qrRasterPx = cmToRasterPx(qrSizeCm);
  const sizeLabel = `${formatCmText(qrSizeCm)}×${formatCmText(qrSizeCm)} см`;

  const qrPayload = batch.qrCode || (batch.id ? encodeGroupQrToken(batch.id) : batch.code);
  const qrBuffer = await QRCode.toBuffer(qrPayload, {
    width: qrRasterPx,
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
                children: [new TextRun({ text: item.inventory_number || 'б/н', bold: true, color: '1E40AF' })],
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
                text: 'ИНВЕНТАРНАЯ КАРТОЧКА ГРУППЫ ОБОРУДОВАНИЯ',
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
                text: `ГРУППОВОЙ QR-КОД: ${batch.code}`,
                bold: true,
                size: 20,
                color: '0F172A',
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 160 },
            children: [
              new ImageRun({
                data: qrBuffer,
                transformation: { width: qrDocxPx, height: qrDocxPx },
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
                text: `Размер QR: ${sizeLabel}  •  Код: ${qrPayload}`,
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
  requisites?: TemplateRequisites;
  templateMode?: boolean;
}

/**
 * Case 2: «АКТ НА СПИСАНИЕ ОТДЕЛЬНЫХ ПРЕДМЕТОВ В СОСТАВЕ ОБОРОТНЫХ СРЕДСТВ»
 * For «Малоценка» containing precious metals (ДМ).
 * Each equipment entry produces 2 A4 Portrait pages (front side + back side).
 * Sum column = Price (Цена) * Quantity (Количество).
 */
export function buildWriteoffCase2Sections(
  items: EquipmentForDocx[],
  options: WriteoffDocxOptions = {}
) {
  const reqCfg = mergeRequisites('case2_act', options.requisites as Record<string, any> | undefined);
  const orgLines = (
    options.organization ||
    reqCfg.organization ||
    'Витебский государственный университет\nимени П.М. Машерова'
  )
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const approverRole = reqCfg.approverRole || 'Ректор        ВГУ имени П.М. Машерова';
  const approverName = reqCfg.approverName || 'Богатырёва В.В.';
  const orderDateText = reqCfg.orderDateText || '" 22 " сентября';
  const orderNumber = reqCfg.orderNumber || '322';

  const defaultDate = options.writeoffDate || options.actDate || new Date();
  const { year: docYear } = extractCalendarYMD(defaultDate);
  const yearStr = options.templateMode ? '{{WRITEOFF_YEAR}}' : String(docYear);
  const reasonText = options.templateMode
    ? '{{REASON}}'
    : options.reason && options.reason !== 'начисленная амортизация составляет 100%'
    ? options.reason
    : `тех. закл. №${options.technicalConclusionNumber ? ` ${options.technicalConclusionNumber}` : ''}`;

  const sections = items.map((item) => {
    const effectiveDate =
      options.writeoffDate || item.writeoffDate || options.actDate || defaultDate;
    const { year: itemYear } = extractCalendarYMD(effectiveDate);
    const itemYearText = options.templateMode ? '{{WRITEOFF_YEAR}}' : String(itemYear);
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

    const accountingName = options.templateMode
      ? '{{ITEM_NAME}}'
      : item.additional_fields?.['Наименование (по бухгалтерии)'] || item.name;
    const invText = options.templateMode ? '{{ITEM_INVENTORY_NUMBER}}' : item.inventory_number || 'б/н';
    const qtyText = options.templateMode ? '{{ITEM_QTY}}' : String(qty);
    const dateReceivedStr = options.templateMode
      ? '{{ITEM_RECEIVED_DATE}}'
      : formatDateRu(item.recivedRaw || item.recivedDate);
    const unitPriceText = options.templateMode ? '{{ITEM_UNIT_COST}}' : formatRubKopFixed2(unitPrice);
    const totalSumText = options.templateMode ? '{{ITEM_TOTAL_COST}}' : formatRubKopFixed2(totalSum);
    const serviceLifeText = options.templateMode ? '{{ITEM_SERVICE_LIFE}}' : serviceLife.formatted;

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
                ...orgLines.map((line) =>
                  makeTextParagraph(line, {
                    size: 16,
                    alignment: AlignmentType.CENTER,
                  })
                ),
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
                makeTextParagraph(approverRole, {
                  size: 16,
                  alignment: AlignmentType.CENTER,
                }),
                makeTextParagraph(`__________________________________   ${approverName}`, {
                  size: 16,
                  alignment: AlignmentType.CENTER,
                  spacingBefore: 40,
                }),
                makeTextParagraph('(подпись)                              (И., О., Фамилия)', {
                  size: 12,
                  italics: true,
                  alignment: AlignmentType.CENTER,
                }),
                makeTextParagraph(`" ___ " __________________ ${itemYearText} г.`, {
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
            makeCell(invText, { width: 1150, size: 14, alignment: AlignmentType.CENTER }),
            makeCell('', { width: 500, size: 14 }),
            makeCell('', { width: 650, size: 14 }),
            makeCell(qtyText, { width: 650, size: 15, alignment: AlignmentType.CENTER }),
            makeCell(dateReceivedStr, { width: 950, size: 14, alignment: AlignmentType.CENTER }),
            makeCell(unitPriceText, { width: 800, size: 14, alignment: AlignmentType.CENTER }),
            makeCell(totalSumText, { width: 800, size: 14, alignment: AlignmentType.CENTER }),
            makeCell(serviceLifeText, { width: 950, size: 14, alignment: AlignmentType.CENTER }),
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

    // Back Side Commission signatures
    const chair2 = reqCfg.commissionChair || { title: 'Проректор', name: 'А.И. Раловец' };
    const members2 = Array.isArray(reqCfg.commissionMembers) ? reqCfg.commissionMembers : [];
    const mol2 = reqCfg.mol || { title: 'Материально - ответственное лицо', name: 'С.А. Ермоченко' };
    const memberRows2: Array<[string, string]> = [
      ...members2.map((m): [string, string] => [m.title, m.name]),
      [mol2.title, mol2.name],
    ];

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
            makeCell(chair2.title, {
              width: 5500,
              size: 16,
              alignment: AlignmentType.LEFT,
              borders: NO_BORDERS,
              margins: { top: 10, bottom: 40 },
            }),
            makeCell('', { width: 2200, borders: NO_BORDERS }),
            makeCell(chair2.name, {
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
        ...memberRows2.map(
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
          `     Комиссия, назначенная приказом от ${orderDateText} ${yearStr} года № ${orderNumber}, осмотрела принятые за ___________ и находившиеся в эксплуатации отдельные предметы в составе оборотных средств и признала их пришедшими в негодность и подлежащими сдаче в утиль.`,
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
          `Техническое заключение № ${options.templateMode ? '{{TECH_CONCLUSION}}' : options.technicalConclusionNumber || ''}`,
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
          `Утиль по накладной № ______________ сдан        " ___ " ______________ ${itemYearText} г.`,
          {
            size: 15,
            alignment: AlignmentType.CENTER,
            spacingBefore: 240,
          }
        ),
      ],
    };
  });

  return sections;
}

export async function generateLowValueWriteoffActDocx(
  items: EquipmentForDocx[],
  options: WriteoffDocxOptions = {}
): Promise<Buffer> {
  const sections = buildWriteoffCase2Sections(items, options);
  const doc = new Document({ sections });
  return await Packer.toBuffer(doc);
}

/**
 * Case 2: «НАКЛАДНАЯ (ТРЕБОВАНИЕ) Форма № 434»
 * For «Малоценка» transfer / writeoff (supports multiple items and quantities > 1).
 * Sum = Price * Quantity.
 */
export function buildLowValueInvoiceCase2Sections(
  items: EquipmentForDocx[],
  options: LowValueInvoiceOptions = {}
) {
  const reqCfg = mergeRequisites('case2_invoice', options.requisites as Record<string, any> | undefined);
  const organization = options.organization || reqCfg.organization || 'ВГУ имени П.М. Машерова';
  const department = options.templateMode
    ? '{{DEPARTMENT}}'
    : options.department && options.department !== 'Кафедра ПиСП'
    ? options.department
    : reqCfg.department || options.department || 'Кафедра ПиСП';
  const invoiceDateInput = options.invoiceDate || new Date();
  const { year: docYear } = extractCalendarYMD(invoiceDateInput);
  const yearStr = options.templateMode ? '{{DOC_YEAR}}' : String(docYear);
  const invoiceNumber = options.templateMode ? '{{DOC_NUMBER}}' : options.invoiceNumber || '_______';
  const molEntry = reqCfg.mol || { title: 'Зав. каф. ПиСП', name: 'Ермоченко С.А.' };
  const senderSign = reqCfg.senderSign || { title: 'Зав. каф. ПиСП', name: 'Ермоченко С.А.' };
  const recipientSign = reqCfg.recipientSign || { title: 'Нач. отд. ПТО и ЭУС ЦИТ (Д/М)', name: 'Фунтикова Т.Г.' };

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
                `лицо (МОЛ)    ${[molEntry.title, molEntry.name].filter(Boolean).join(' ')}  _______________________`,
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

  if (options.templateMode) {
    mainRows.push(
      new TableRow({
        cantSplit: true,
        children: [
          makeCell('{{ITEM_NAME}}', {
            width: 3456,
            size: 15,
            alignment: AlignmentType.LEFT,
            margins: { top: 30, bottom: 30, left: 60, right: 40 },
          }),
          makeCell('{{ITEM_UNIT}}', {
            width: 850,
            size: 15,
            alignment: AlignmentType.LEFT,
            margins: { top: 30, bottom: 30, left: 40, right: 40 },
          }),
          makeCell('{{ITEM_INVENTORY_NUMBER}}', {
            width: 1450,
            size: 15,
            alignment: AlignmentType.LEFT,
            margins: { top: 30, bottom: 30, left: 50, right: 40 },
          }),
          makeCell('', { width: 950, size: 15 }),
          makeCell('{{ITEM_QTY}}', {
            width: 950,
            size: 15,
            alignment: AlignmentType.LEFT,
            margins: { top: 30, bottom: 30, left: 50, right: 40 },
          }),
          makeCell('{{ITEM_QTY}}', {
            width: 950,
            size: 15,
            alignment: AlignmentType.LEFT,
            margins: { top: 30, bottom: 30, left: 50, right: 40 },
          }),
          makeCell('{{ITEM_UNIT_COST}}', {
            width: 1050,
            size: 15,
            alignment: AlignmentType.LEFT,
            margins: { top: 30, bottom: 30, left: 50, right: 40 },
          }),
          makeCell('{{ITEM_TOTAL_COST}}', {
            width: 1050,
            size: 15,
            alignment: AlignmentType.LEFT,
            margins: { top: 30, bottom: 30, left: 50, right: 40 },
          }),
        ],
      })
    );
  } else {
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
            makeCell(item.inventory_number || 'б/н', {
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
          makeCell(senderSign.title, {
            width: 3400,
            size: 17,
            alignment: AlignmentType.CENTER,
            borders: BOTTOM_ONLY_BORDER,
          }),
          makeCell('', { width: 300, borders: NO_BORDERS }),
          makeCell('', { width: 2700, size: 17, borders: BOTTOM_ONLY_BORDER }),
          makeCell('', { width: 300, borders: NO_BORDERS }),
          makeCell(senderSign.name, {
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
          makeCell(recipientSign.title, {
            width: 3400,
            size: 15,
            alignment: AlignmentType.CENTER,
            borders: BOTTOM_ONLY_BORDER,
          }),
          makeCell('', { width: 300, borders: NO_BORDERS }),
          makeCell('', { width: 2700, size: 17, borders: BOTTOM_ONLY_BORDER }),
          makeCell('', { width: 300, borders: NO_BORDERS }),
          makeCell(recipientSign.name, {
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

  return [
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
  ];
}

export async function generateLowValueInvoiceDocx(
  items: EquipmentForDocx[],
  options: LowValueInvoiceOptions = {}
): Promise<Buffer> {
  const sections = buildLowValueInvoiceCase2Sections(items, options);
  const doc = new Document({ sections });
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
export function buildWriteoffCase3Sections(
  items: EquipmentForDocx[],
  actNumber: string = '',
  options: WriteoffDocxOptions = {}
) {
  const reqCfg = mergeRequisites('case3_act', options.requisites as Record<string, any> | undefined);
  const organization = options.organization || reqCfg.organization || 'ВГУ имени П.М. Машерова';
  const approverRole = reqCfg.approverRole || 'Ректор ВГУ имени П.М. Машерова';
  const approverName = reqCfg.approverName || 'В.В. Богатырёва';
  const orderDateText = reqCfg.orderDateText || '22   сентября';
  const orderNumber = reqCfg.orderNumber || '322';

  const defaultDate = options.writeoffDate || options.actDate || new Date();
  const { year: docYear } = extractCalendarYMD(defaultDate);
  const yearStr = options.templateMode ? '{{WRITEOFF_YEAR}}' : String(docYear);
  const actNumText = options.templateMode
    ? '{{ACT_NUMBER}}'
    : actNumber && String(actNumber).trim()
    ? String(actNumber).trim()
    : '';

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
                      makeCell(organization, {
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
                      makeCell(approverRole, {
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
                      makeCell(approverName, {
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

  // Top small metadata table
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

  const makeTenColTemplateRow = () =>
    new TableRow({
      cantSplit: true,
      children: [
        makeCell('{{ITEM_NAME}}', {
          width: 2050,
          size: 14,
          alignment: AlignmentType.LEFT,
          margins: { top: 40, bottom: 40, left: 50, right: 40 },
        }),
        makeCell('{{ITEM_INVENTORY_NUMBER}}', {
          width: 1450,
          size: 14,
          alignment: AlignmentType.CENTER,
        }),
        makeCell('', { width: 500, size: 14 }),
        makeCell('{{ITEM_UNIT}}', {
          width: 700,
          size: 14,
          alignment: AlignmentType.CENTER,
        }),
        makeCell('{{ITEM_RECEIVED_DATE}}', {
          width: 1150,
          size: 14,
          alignment: AlignmentType.CENTER,
        }),
        makeCell('{{ITEM_QTY}}', {
          width: 700,
          size: 14,
          alignment: AlignmentType.CENTER,
        }),
        makeCell('{{ITEM_UNIT_COST}}', {
          width: 850,
          size: 14,
          alignment: AlignmentType.CENTER,
        }),
        makeCell('{{ITEM_TOTAL_COST}}', {
          width: 900,
          size: 14,
          alignment: AlignmentType.CENTER,
        }),
        makeCell('', { width: 600, size: 14 }),
        makeCell('', { width: 1806, size: 14 }),
      ],
    });

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
        makeCell(item.inventory_number || 'б/н', {
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

  let frontTableRows: TableRow[];
  let backTableRows: TableRow[];

  if (options.templateMode) {
    frontTableRows = [...buildTenColHeaderRows(), makeTenColTemplateRow()];
    backTableRows = [...buildTenColHeaderRows(), makeTenColTemplateRow()];
  } else {
    const frontItems = items.slice(0, 15);
    const backOverflowItems = items.slice(15);

    frontTableRows = [
      ...buildTenColHeaderRows(),
      ...frontItems.map(makeTenColItemRow),
    ];
    for (let i = frontItems.length; i < 15; i++) {
      frontTableRows.push(makeEmptyTenColRow());
    }

    backTableRows = [
      ...buildTenColHeaderRows(),
      ...backOverflowItems.map(makeTenColItemRow),
    ];
    const backMinRows = Math.max(12, backOverflowItems.length + 3);
    for (let i = backOverflowItems.length; i < backMinRows; i++) {
      backTableRows.push(makeEmptyTenColRow());
    }
  }

  const frontItemsTable = new Table({
    width: { size: 10706, type: WidthType.DXA },
    rows: frontTableRows,
  });

  const backContinuationTable = new Table({
    width: { size: 10706, type: WidthType.DXA },
    rows: backTableRows,
  });

  // Back side Утиль 8-col table
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

  const chair3 = reqCfg.commissionChair || { title: 'Проректор', name: 'А.И. Раловец' };
  const members3 = Array.isArray(reqCfg.commissionMembers) ? reqCfg.commissionMembers : [];
  const mol3 = reqCfg.mol || { title: 'МОЛ', name: 'С.А. Ермоченко' };
  const commissionEntries: Array<[string, string, string]> = [
    ['Председатель комиссии', chair3.title, chair3.name],
    ...members3.map((m, mIdx): [string, string, string] => [
      mIdx === 0 ? 'Члены комиссии:' : '',
      m.title,
      m.name,
    ]),
    ['', mol3.title, mol3.name],
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

  return [
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
          `Комиссия, назначенная приказом от   ${orderDateText} ${yearStr} г.   №${orderNumber}   осмотрела принятые за _________________ г., находившиеся в эксплуатации малоценные и быстроизнашиющиеся предметы и признала их пришедшими в негодность и подлежащими сдаче в утиль`,
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
  ];
}

export async function generateLowValueNoDmWriteoffActDocx(
  items: EquipmentForDocx[],
  actNumber: string = '',
  options: WriteoffDocxOptions = {}
): Promise<Buffer> {
  const sections = buildWriteoffCase3Sections(items, actNumber, options);
  const doc = new Document({ sections });
  return await Packer.toBuffer(doc);
}

/**
 * Generates an editable .docx template containing static text from current requisites
 * and {{PLACEHOLDER}} markers in all DB-driven fields/rows so the user can edit
 * order numbers, names, and titles in Microsoft Word / LibreOffice and re-upload it.
 */
export async function generateEditableTemplateDocx(
  key: WriteoffTemplateKey,
  requisites?: TemplateRequisites
): Promise<Buffer> {
  const placeholderItem: EquipmentForDocx = {
    id: 0,
    inventory_number: '{{ITEM_INVENTORY_NUMBER}}',
    name: '{{ITEM_NAME}}',
    typeName: '',
    roomNumber: '',
    initial_cost: null,
    residual_cost: null,
    recivedDate: '',
    recivedRaw: null,
    additional_fields: {},
  };

  let sections: any[];
  switch (key) {
    case 'case1_act':
      sections = buildWriteoffCase1Sections([placeholderItem], '{{ACT_NUMBER}}', {
        requisites,
        templateMode: true,
      });
      break;
    case 'case1_invoice':
      sections = buildTransferInvoiceCase1Sections([placeholderItem], {
        requisites,
        templateMode: true,
      });
      break;
    case 'case2_act':
      sections = buildWriteoffCase2Sections([placeholderItem], {
        requisites,
        templateMode: true,
      });
      break;
    case 'case2_invoice':
      sections = buildLowValueInvoiceCase2Sections([placeholderItem], {
        requisites,
        templateMode: true,
      });
      break;
    case 'case3_act':
      sections = buildWriteoffCase3Sections([placeholderItem], '{{ACT_NUMBER}}', {
        requisites,
        templateMode: true,
      });
      break;
  }

  const doc = new Document({ sections });
  return await Packer.toBuffer(doc);
}

function buildCase1ActItemPlaceholders(
  items: EquipmentForDocx[],
  actNumber: string,
  options: WriteoffDocxOptions,
  requisites: TemplateRequisites
): Array<Record<string, string>> {
  const defaultDate = options.actDate || options.writeoffDate || new Date();
  const reason = options.reason || 'начисленная амортизация составляет 100%';
  const techConclusion = options.technicalConclusionNumber || '';
  const techText = techConclusion
    ? `Техническое заключение № ${techConclusion}`
    : 'Техническое заключение № _______________';

  return items.map((item, idx) => {
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
    const residualCost =
      item.residual_cost !== null && item.residual_cost !== undefined
        ? formatRubKop(item.residual_cost)
        : '';

    return {
      ACT_NUMBER: itemActNumber || '',
      WRITEOFF_DATE: formatDateRu(effectiveWriteoffDate),
      WRITEOFF_YEAR: String(actYear),
      WRITEOFF_YEAR_SHORT: String(actYear).slice(-2),
      ITEM_NAME: accountingName,
      ITEM_INVENTORY_NUMBER: item.inventory_number || 'б/н',
      ITEM_SERVICE_LIFE: serviceLife.formatted,
      ITEM_INITIAL_COST: initialCostFormatted,
      ITEM_ACCUMULATED_AMORTIZATION: initialCostFormatted,
      ITEM_RESIDUAL_COST: residualCost,
      REASON: reason,
      TECH_CONCLUSION: techConclusion,
      TECH_CONCLUSION_TEXT: techText,
      ORGANIZATION: options.organization || requisites.organization || 'ВГУ имени П.М.Машерова',
    };
  });
}

function buildCase2ActItemPlaceholders(
  items: EquipmentForDocx[],
  options: WriteoffDocxOptions,
  requisites: TemplateRequisites
): Array<Record<string, string>> {
  const defaultDate = options.writeoffDate || options.actDate || new Date();
  const reasonText =
    options.reason && options.reason !== 'начисленная амортизация составляет 100%'
      ? options.reason
      : `тех. закл. №${options.technicalConclusionNumber ? ` ${options.technicalConclusionNumber}` : ''}`;

  return items.map((item) => {
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

    return {
      WRITEOFF_YEAR: String(itemYear),
      WRITEOFF_DATE: formatDateRu(effectiveDate),
      ITEM_NAME: accountingName,
      ITEM_INVENTORY_NUMBER: item.inventory_number || 'б/н',
      ITEM_QTY: String(qty),
      ITEM_RECEIVED_DATE: formatDateRu(item.recivedRaw || item.recivedDate),
      ITEM_UNIT_COST: formatRubKopFixed2(unitPrice),
      ITEM_TOTAL_COST: formatRubKopFixed2(totalSum),
      ITEM_SERVICE_LIFE: serviceLife.formatted,
      REASON: reasonText,
      TECH_CONCLUSION: options.technicalConclusionNumber || '',
      ORDER_NUMBER: requisites.orderNumber || '322',
      ORDER_DATE_TEXT: requisites.orderDateText || '" 22 " сентября',
      ORGANIZATION: options.organization || requisites.organization || '',
    };
  });
}

function buildCase3ActPlaceholders(
  items: EquipmentForDocx[],
  actNumber: string,
  options: WriteoffDocxOptions,
  requisites: TemplateRequisites
): { docValues: Record<string, string>; itemValues: Array<Record<string, string>> } {
  const defaultDate = options.writeoffDate || options.actDate || new Date();
  const { year: docYear } = extractCalendarYMD(defaultDate);
  const actNumText = actNumber && String(actNumber).trim() ? String(actNumber).trim() : '';

  const itemValues = items.map((item, idx) => {
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

    return {
      ROW_NUM: String(idx + 1),
      ITEM_NAME: accountingName,
      ITEM_INVENTORY_NUMBER: item.inventory_number || 'б/н',
      ITEM_UNIT: 'шт.',
      ITEM_RECEIVED_DATE: formatDateRu(item.recivedRaw || item.recivedDate),
      ITEM_QTY: String(qty),
      ITEM_UNIT_COST: formatRubKopFixed2(unitPrice),
      ITEM_TOTAL_COST: formatRubKopFixed2(totalSum),
    };
  });

  const docValues = {
    ACT_NUMBER: actNumText,
    WRITEOFF_YEAR: String(docYear),
    WRITEOFF_DATE: formatDateRu(defaultDate),
    ORDER_NUMBER: requisites.orderNumber || '322',
    ORDER_DATE_TEXT: requisites.orderDateText || '22   сентября',
    ORGANIZATION: options.organization || requisites.organization || 'ВГУ имени П.М. Машерова',
  };

  return { docValues, itemValues };
}

function buildCase1InvoicePlaceholders(
  items: EquipmentForDocx[],
  options: TransferInvoiceOptions,
  requisites: TemplateRequisites
): { docValues: Record<string, string>; itemValues: Array<Record<string, string>> } {
  let totalQty = 0;
  let totalSum = 0;

  const itemValues = items.map((item, index) => {
    const qty =
      Number(item.additional_fields?.quantity) > 0
        ? Number(item.additional_fields?.quantity)
        : 1;
    totalQty += qty;

    const kitPart = isKitPartItem(item);
    const unitCostNum =
      typeof item.initial_cost === 'number'
        ? item.initial_cost
        : parseFloat(String(item.initial_cost || 0).replace(/\s+/g, '').replace(',', '.')) || 0;
    const rowSumNum = kitPart ? 0 : Math.round(unitCostNum * qty * 100) / 100;
    if (!kitPart) totalSum += rowSumNum;

    const accountingName =
      item.additional_fields?.['Наименование (по бухгалтерии)'] || item.name;

    return {
      ROW_NUM: String(index + 1),
      ITEM_NAME: accountingName,
      ITEM_RECEIVED_DATE: formatDateRu(item.recivedRaw || item.recivedDate),
      ITEM_INVENTORY_NUMBER: item.inventory_number || 'б/н',
      ITEM_QTY: String(qty),
      ITEM_UNIT_COST: kitPart ? '' : formatRubKop(unitCostNum),
      ITEM_TOTAL_COST: kitPart ? '' : formatRubKop(rowSumNum),
    };
  });

  const sender =
    options.sender && options.sender !== 'Кафедра ПиСП'
      ? options.sender
      : requisites.sender || options.sender || 'Кафедра ПиСП';
  const recipient =
    options.recipient && options.recipient !== 'ЦИТ'
      ? options.recipient
      : requisites.recipient || options.recipient || 'ЦИТ';

  const docValues = {
    DOC_NUMBER: options.invoiceNumber || '',
    DOC_DATE: options.invoiceDate ? formatDateRu(options.invoiceDate) : '',
    SENDER: sender,
    RECIPIENT: recipient,
    NOTE: options.note || '',
    TOTAL_QTY: String(totalQty),
    TOTAL_SUM: formatRubKop(totalSum),
    ORGANIZATION: options.organization || requisites.organization || 'ВГУ имени П.М.Машерова',
  };

  return { docValues, itemValues };
}

function buildCase2InvoicePlaceholders(
  items: EquipmentForDocx[],
  options: LowValueInvoiceOptions,
  requisites: TemplateRequisites
): { docValues: Record<string, string>; itemValues: Array<Record<string, string>> } {
  const invoiceDateInput = options.invoiceDate || new Date();
  const { year: docYear } = extractCalendarYMD(invoiceDateInput);

  const itemValues = items.map((item, idx) => {
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

    return {
      ROW_NUM: String(idx + 1),
      ITEM_NAME: accountingName,
      ITEM_UNIT: 'шт.',
      ITEM_INVENTORY_NUMBER: item.inventory_number || 'б/н',
      ITEM_QTY: String(qty),
      ITEM_UNIT_COST: formatRubKopFixed2(unitPrice),
      ITEM_TOTAL_COST: formatRubKopFixed2(rowSum),
    };
  });

  const department =
    options.department && options.department !== 'Кафедра ПиСП'
      ? options.department
      : requisites.department || options.department || 'Кафедра ПиСП';

  const docValues = {
    DOC_NUMBER: options.invoiceNumber || '_______',
    DOC_DATE: formatDateRu(invoiceDateInput),
    DOC_YEAR: String(docYear),
    DEPARTMENT: department,
    ORGANIZATION: options.organization || requisites.organization || 'ВГУ имени П.М. Машерова',
  };

  return { docValues, itemValues };
}

/**
 * Renders Writeoff Acts honoring both saved DB requisites and custom uploaded .docx templates.
 */
export async function renderWriteoffActsFromTemplates(
  groups: {
    case1: EquipmentForDocx[];
    case2: EquipmentForDocx[];
    case3: EquipmentForDocx[];
  },
  templates: Record<WriteoffTemplateKey, LoadedTemplateState>,
  actNumber: string = '',
  options: WriteoffDocxOptions = {}
): Promise<Buffer> {
  const partBuffers: Buffer[] = [];

  if (groups.case1.length > 0) {
    const tpl = templates.case1_act;
    if (tpl.customDocxBuffer) {
      const itemVals = buildCase1ActItemPlaceholders(groups.case1, actNumber, options, tpl.requisites);
      partBuffers.push(await renderPerItemSectionTemplateDocx(tpl.customDocxBuffer, itemVals));
    } else {
      partBuffers.push(
        await generateWriteoffDocx(groups.case1, actNumber, {
          ...options,
          requisites: tpl.requisites,
        })
      );
    }
  }

  if (groups.case2.length > 0) {
    const tpl = templates.case2_act;
    if (tpl.customDocxBuffer) {
      const itemVals = buildCase2ActItemPlaceholders(groups.case2, options, tpl.requisites);
      partBuffers.push(await renderPerItemSectionTemplateDocx(tpl.customDocxBuffer, itemVals));
    } else {
      partBuffers.push(
        await generateLowValueWriteoffActDocx(groups.case2, {
          ...options,
          requisites: tpl.requisites,
        })
      );
    }
  }

  if (groups.case3.length > 0) {
    const tpl = templates.case3_act;
    if (tpl.customDocxBuffer) {
      const { docValues, itemValues } = buildCase3ActPlaceholders(
        groups.case3,
        actNumber,
        options,
        tpl.requisites
      );
      partBuffers.push(
        await renderTableTemplateDocx(tpl.customDocxBuffer, docValues, itemValues, {
          mode: 'case3_act',
        })
      );
    } else {
      partBuffers.push(
        await generateLowValueNoDmWriteoffActDocx(groups.case3, actNumber, {
          ...options,
          requisites: tpl.requisites,
        })
      );
    }
  }

  return await mergeDocxBuffers(partBuffers);
}

/**
 * Renders Transfer Invoices (ОКУД 0501460 / Форма 434) honoring both saved DB requisites
 * and custom uploaded .docx templates.
 */
export async function renderInvoicesFromTemplates(
  groups: {
    case1: EquipmentForDocx[];
    case2: EquipmentForDocx[];
  },
  templates: Record<WriteoffTemplateKey, LoadedTemplateState>,
  options: TransferInvoiceOptions = {}
): Promise<Buffer> {
  const partBuffers: Buffer[] = [];

  if (groups.case1.length > 0) {
    const tpl = templates.case1_invoice;
    if (tpl.customDocxBuffer) {
      const { docValues, itemValues } = buildCase1InvoicePlaceholders(
        groups.case1,
        options,
        tpl.requisites
      );
      partBuffers.push(
        await renderTableTemplateDocx(tpl.customDocxBuffer, docValues, itemValues, {
          mode: 'invoice',
        })
      );
    } else {
      partBuffers.push(
        await generateTransferInvoiceDocx(groups.case1, {
          ...options,
          requisites: tpl.requisites,
        })
      );
    }
  }

  if (groups.case2.length > 0) {
    const tpl = templates.case2_invoice;
    if (tpl.customDocxBuffer) {
      const { docValues, itemValues } = buildCase2InvoicePlaceholders(
        groups.case2,
        {
          invoiceNumber: options.invoiceNumber,
          invoiceDate: options.invoiceDate,
          organization: options.organization,
          department: options.sender,
        },
        tpl.requisites
      );
      partBuffers.push(
        await renderTableTemplateDocx(tpl.customDocxBuffer, docValues, itemValues, {
          mode: 'invoice',
          minRows: 16,
        })
      );
    } else {
      partBuffers.push(
        await generateLowValueInvoiceDocx(groups.case2, {
          invoiceNumber: options.invoiceNumber,
          invoiceDate: options.invoiceDate,
          organization: options.organization,
          department: options.sender,
          requisites: tpl.requisites,
        })
      );
    }
  }

  return await mergeDocxBuffers(partBuffers);
}

/**
 * Unified group generator: builds individual acts per item for Case 1 and Case 2,
 * plus a common act table for Case 3 items, preserving each item's exact case form.
 */
export async function generateMixedWriteoffActsDocx(
  case1Items: EquipmentForDocx[],
  case2Items: EquipmentForDocx[],
  case3Items: EquipmentForDocx[],
  actNumber: string = '',
  options: WriteoffDocxOptions = {}
): Promise<Buffer> {
  const sections = [
    ...(case1Items.length > 0 ? buildWriteoffCase1Sections(case1Items, actNumber, options) : []),
    ...(case2Items.length > 0 ? buildWriteoffCase2Sections(case2Items, options) : []),
    ...(case3Items.length > 0 ? buildWriteoffCase3Sections(case3Items, actNumber, options) : []),
  ];
  const doc = new Document({ sections });
  return await Packer.toBuffer(doc);
}

/**
 * Unified invoice generator: builds ОКУД 0501460 for Case 1 items and Форма № 434 for Case 2 items.
 */
export async function generateMixedInvoicesDocx(
  case1Items: EquipmentForDocx[],
  case2Items: EquipmentForDocx[],
  options: {
    invoiceNumber?: string;
    invoiceDate?: Date | string | null;
    organization?: string;
    sender?: string;
    recipient?: string;
    note?: string;
  } = {}
): Promise<Buffer> {
  const sections = [
    ...(case1Items.length > 0
      ? buildTransferInvoiceCase1Sections(case1Items, {
          invoiceNumber: options.invoiceNumber,
          invoiceDate: options.invoiceDate,
          organization: options.organization,
          sender: options.sender,
          recipient: options.recipient,
          note: options.note,
        })
      : []),
    ...(case2Items.length > 0
      ? buildLowValueInvoiceCase2Sections(case2Items, {
          invoiceNumber: options.invoiceNumber,
          invoiceDate: options.invoiceDate,
          organization: options.organization,
          department: options.sender,
        })
      : []),
  ];
  const doc = new Document({ sections });
  return await Packer.toBuffer(doc);
}
