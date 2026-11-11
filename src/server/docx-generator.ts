import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
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
}

export async function generateQrDocx(
  items: EquipmentForDocx[],
  baseUrl: string
): Promise<Buffer> {
  const tableRows: TableRow[] = [];

  // Group items into rows of 2 cards per row
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

    // If odd number, add empty cell for padding
    if (cells.length === 1) {
      cells.push(
        new TableCell({
          width: { size: 4500, type: WidthType.DXA },
          borders: {
            top: { style: BorderStyle.NONE },
            bottom: { style: BorderStyle.NONE },
            left: { style: BorderStyle.NONE },
            right: { style: BorderStyle.NONE },
          },
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

export async function generateWriteoffDocx(
  items: EquipmentForDocx[],
  actNumber: string
): Promise<Buffer> {
  const currentDate = new Date().toLocaleDateString('ru-RU');
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
          width: { size: 2000, type: WidthType.DXA },
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: 'Наименование', bold: true })] })],
          width: { size: 3000, type: WidthType.DXA },
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: 'Перв. стоим. (руб.)', bold: true })] })],
          width: { size: 1700, type: WidthType.DXA },
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: 'Ост. стоим. (руб.)', bold: true })] })],
          width: { size: 1700, type: WidthType.DXA },
        }),
      ],
    }),
  ];

  let totalInitial = 0;
  let totalResidual = 0;

  items.forEach((item, index) => {
    totalInitial += Number(item.initial_cost) || 0;
    totalResidual += Number(item.residual_cost) || 0;

    tableRows.push(
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({ text: String(index + 1) })],
          }),
          new TableCell({
            children: [new Paragraph({ text: item.inventory_number })],
          }),
          new TableCell({
            children: [new Paragraph({ text: item.name })],
          }),
          new TableCell({
            children: [new Paragraph({ text: Number(item.initial_cost).toLocaleString('ru-RU') })],
          }),
          new TableCell({
            children: [new Paragraph({ text: Number(item.residual_cost).toLocaleString('ru-RU') })],
          }),
        ],
      })
    );
  });

  // Total summary row
  tableRows.push(
    new TableRow({
      children: [
        new TableCell({ children: [new Paragraph({ text: '' })] }),
        new TableCell({ children: [new Paragraph({ text: '' })] }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'ИТОГО:', bold: true })] })] }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: totalInitial.toLocaleString('ru-RU'), bold: true })] })] }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: totalResidual.toLocaleString('ru-RU'), bold: true })] })] }),
      ],
    })
  );

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({ text: '«УТВЕРЖДАЮ»\nЗаведующий кафедрой\n___________________\n«____» ___________ 2026 г.', italics: true }),
            ],
          }),
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            spacing: { before: 200, after: 100 },
            children: [
              new TextRun({ text: `АКТ № ${actNumber}`, bold: true, size: 26 }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
            children: [
              new TextRun({ text: `о списании материальных ценностей от ${currentDate}`, bold: true }),
            ],
          }),
          new Paragraph({
            spacing: { after: 200 },
            children: [
              new TextRun({
                text: 'Комиссия кафедры составила настоящий акт о том, что перечисленное ниже оборудование непригодно к дальнейшей эксплуатации и подлежит списанию:',
              }),
            ],
          }),
          new Table({
            rows: tableRows,
            width: { size: 9000, type: WidthType.DXA },
          }),
          new Paragraph({
            spacing: { before: 300 },
            children: [
              new TextRun({ text: 'Члены комиссии:\n\n1. ____________________ (Ответственный администратор)\n\n2. ____________________ (Инженер по оборудованию)' }),
            ],
          }),
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
          children: [new Paragraph({ children: [new TextRun({ text: 'Стоимость (руб)', bold: true })] })],
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
                text: Number(item.initial_cost || 0).toLocaleString('ru-RU'),
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
