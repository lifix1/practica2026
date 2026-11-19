import JSZip from 'jszip';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function unescapeXml(str: string): string {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Validates that an uploaded buffer is a legitimate .docx archive containing word/document.xml.
 */
export async function validateDocxBuffer(buffer: Buffer): Promise<{ valid: boolean; error?: string }> {
  if (!buffer || buffer.length < 100) {
    return { valid: false, error: 'Файл пуст или слишком мал для документа Word (.docx)' };
  }
  // ZIP files start with PK\x03\x04 or PK\x05\x06
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    return { valid: false, error: 'Файл не является корректным документом .docx (ZIP-контейнером)' };
  }
  try {
    const zip = await JSZip.loadAsync(buffer);
    const docXml = zip.file('word/document.xml');
    if (!docXml) {
      return {
        valid: false,
        error: 'Архив не содержит word/document.xml — загрузите корректный файл Word (.docx)',
      };
    }
    const content = await docXml.async('string');
    if (!content.includes('<w:body')) {
      return { valid: false, error: 'Некорректная структура word/document.xml в файле .docx' };
    }
    return { valid: true };
  } catch (err: any) {
    return { valid: false, error: `Ошибка чтения .docx: ${err?.message || 'поврежденный файл'}` };
  }
}

interface TextNodeMatch {
  fullStart: number;
  fullEnd: number;
  openTag: string;
  rawText: string;
  decodedText: string;
}

/**
 * Replaces {{TOKEN}} placeholders inside a single <w:p>...</w:p> XML block
 * while gracefully handling Microsoft Word / LibreOffice split <w:r><w:t> runs.
 */
function replacePlaceholdersInParagraph(
  pXml: string,
  values: Record<string, string>
): string {
  if (!pXml.includes('{{') && !pXml.includes('{')) {
    return pXml;
  }

  const tRegex = /(<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/g;
  const nodes: TextNodeMatch[] = [];
  let match: RegExpExecArray | null;
  while ((match = tRegex.exec(pXml)) !== null) {
    nodes.push({
      fullStart: match.index,
      fullEnd: match.index + match[0].length,
      openTag: match[1],
      rawText: match[2],
      decodedText: unescapeXml(match[2]),
    });
  }

  if (nodes.length === 0) return pXml;

  // Build combined string and character offset -> node mapping
  let combined = '';
  const charMap: Array<{ nodeIdx: number; offset: number }> = [];
  for (let i = 0; i < nodes.length; i++) {
    const txt = nodes[i].decodedText;
    for (let j = 0; j < txt.length; j++) {
      charMap.push({ nodeIdx: i, offset: j });
    }
    combined += txt;
  }

  if (!combined.includes('{{')) return pXml;

  const placeholderRegex = /\{\{([A-Z0-9_]+)\}\}/g;
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  let pm: RegExpExecArray | null;
  while ((pm = placeholderRegex.exec(combined)) !== null) {
    const key = pm[1];
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      replacements.push({
        start: pm.index,
        end: pm.index + pm[0].length,
        value: values[key] ?? '',
      });
    }
  }

  if (replacements.length === 0) return pXml;

  // Apply replacements in reverse order so node offsets stay valid
  const nodeTexts = nodes.map((n) => n.decodedText);
  for (let r = replacements.length - 1; r >= 0; r--) {
    const rep = replacements[r];
    const startRef = charMap[rep.start];
    const endRef = charMap[rep.end - 1];
    if (!startRef || !endRef) continue;

    if (startRef.nodeIdx === endRef.nodeIdx) {
      const idx = startRef.nodeIdx;
      const t = nodeTexts[idx];
      nodeTexts[idx] = t.slice(0, startRef.offset) + rep.value + t.slice(endRef.offset + 1);
    } else {
      const firstIdx = startRef.nodeIdx;
      const lastIdx = endRef.nodeIdx;
      nodeTexts[firstIdx] = nodeTexts[firstIdx].slice(0, startRef.offset) + rep.value;
      for (let k = firstIdx + 1; k < lastIdx; k++) {
        nodeTexts[k] = '';
      }
      nodeTexts[lastIdx] = nodeTexts[lastIdx].slice(endRef.offset + 1);
    }
  }

  // Reassemble paragraph XML
  let out = '';
  let cursor = 0;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    out += pXml.slice(cursor, node.fullStart);
    const updatedText = nodeTexts[i];
    let openTag = node.openTag;
    if (
      (updatedText.startsWith(' ') || updatedText.endsWith(' ')) &&
      !openTag.includes('xml:space=')
    ) {
      openTag = openTag.replace('<w:t', '<w:t xml:space="preserve"');
    }
    out += `${openTag}${escapeXml(updatedText)}</w:t>`;
    cursor = node.fullEnd;
  }
  out += pXml.slice(cursor);
  return out;
}

/**
 * Replaces placeholders across every <w:p> in an XML fragment.
 */
export function replacePlaceholdersInXml(
  xml: string,
  values: Record<string, string>
): string {
  if (!xml.includes('<w:t')) return xml;
  return xml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>|<w:p\/>/g, (pXml) =>
    replacePlaceholdersInParagraph(pXml, values)
  );
}

interface TagRange {
  start: number;
  end: number;
  xml: string;
}

/**
 * Depth-aware finder for balanced XML elements (e.g. 'w:tbl', 'w:tr') at top level of a fragment.
 * Properly skips nested elements with the same tag name.
 */
function findBalancedElements(xml: string, tagName: string): TagRange[] {
  const results: TagRange[] = [];
  const openToken = `<${tagName}`;
  const closeToken = `</${tagName}>`;
  let pos = 0;

  while (pos < xml.length) {
    const openIdx = xml.indexOf(openToken, pos);
    if (openIdx === -1) break;

    const charAfter = xml[openIdx + openToken.length];
    if (charAfter !== '>' && charAfter !== ' ' && charAfter !== '\t' && charAfter !== '\n' && charAfter !== '\r' && charAfter !== '/') {
      pos = openIdx + openToken.length;
      continue;
    }

    // Check self-closing
    const tagCloseBracket = xml.indexOf('>', openIdx);
    if (tagCloseBracket === -1) break;
    if (xml[tagCloseBracket - 1] === '/') {
      pos = tagCloseBracket + 1;
      continue;
    }

    let depth = 1;
    let scan = tagCloseBracket + 1;
    while (depth > 0 && scan < xml.length) {
      const nextOpen = xml.indexOf(openToken, scan);
      const nextClose = xml.indexOf(closeToken, scan);
      if (nextClose === -1) {
        scan = xml.length;
        break;
      }

      if (nextOpen !== -1 && nextOpen < nextClose) {
        const nextCharAfter = xml[nextOpen + openToken.length];
        if (
          nextCharAfter === '>' ||
          nextCharAfter === ' ' ||
          nextCharAfter === '\t' ||
          nextCharAfter === '\n' ||
          nextCharAfter === '\r'
        ) {
          const nextBracket = xml.indexOf('>', nextOpen);
          if (nextBracket !== -1 && xml[nextBracket - 1] !== '/') {
            depth++;
          }
          scan = (nextBracket !== -1 ? nextBracket : nextOpen + openToken.length) + 1;
        } else {
          scan = nextOpen + openToken.length;
        }
      } else {
        depth--;
        scan = nextClose + closeToken.length;
      }
    }

    if (depth === 0) {
      results.push({
        start: openIdx,
        end: scan,
        xml: xml.slice(openIdx, scan),
      });
    }
    pos = scan;
  }

  return results;
}

/**
 * Extracts readable plain text from an XML snippet (used to inspect what placeholders a <w:tr> contains).
 */
function extractPlainTextFromXml(xml: string): string {
  const parts: string[] = [];
  const tRegex = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let m: RegExpExecArray | null;
  while ((m = tRegex.exec(xml)) !== null) {
    parts.push(unescapeXml(m[1]));
  }
  return parts.join('');
}

const ITEM_ROW_MARKERS = [
  '{{ITEM_NAME}}',
  '{{ITEM_INVENTORY_NUMBER}}',
  '{{ROW_NUM}}',
  '{{ITEM_UNIT_COST}}',
  '{{ITEM_TOTAL_COST}}',
];

function rowHasItemMarker(rowXml: string): boolean {
  const txt = extractPlainTextFromXml(rowXml);
  return ITEM_ROW_MARKERS.some((marker) => txt.includes(marker));
}

/**
 * Renders a multi-row table .docx template (Case 1 Invoice, Case 2 Form 434, Case 3 Act).
 */
export async function renderTableTemplateDocx(
  templateBuffer: Buffer,
  docValues: Record<string, string>,
  itemValuesList: Array<Record<string, string>>,
  options: {
    mode: 'invoice' | 'case3_act';
    minRows?: number;
  }
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(templateBuffer);
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('В шаблоне .docx отсутствует word/document.xml');

  let docXml = await docFile.async('string');

  // Inspect top-level tables (and nested if any via recursive walk of w:tbl)
  // First normalize split placeholders inside all paragraphs? No, do table row expansion first
  // after normalizing row text check via extractPlainTextFromXml!
  const topTables = findBalancedElements(docXml, 'w:tbl');
  const tablesWithItemRows: Array<{
    tblRange: TagRange;
    templateRowIndices: number[];
    rowRanges: TagRange[];
  }> = [];

  for (const tbl of topTables) {
    // Only scan direct rows of this table cleanly: find balanced w:tr inside tbl after <w:tblGrid>
    // Note: nested tables inside a cell don't contain item markers in our templates,
    // and findBalancedElements on tbl.xml returns direct outer rows because it skips children while depth > 0!
    const tblInnerOffset = tbl.xml.indexOf('>') + 1;
    const tblInner = tbl.xml.slice(tblInnerOffset, tbl.xml.length - '</w:tbl>'.length);
    const rawRowRanges = findBalancedElements(tblInner, 'w:tr');
    const rowRanges = rawRowRanges.map((r) => ({
      start: tbl.start + tblInnerOffset + r.start,
      end: tbl.start + tblInnerOffset + r.end,
      xml: r.xml,
    }));

    const templateRowIndices: number[] = [];
    rowRanges.forEach((r, idx) => {
      if (rowHasItemMarker(r.xml)) {
        templateRowIndices.push(idx);
      }
    });

    if (templateRowIndices.length > 0) {
      tablesWithItemRows.push({
        tblRange: tbl,
        templateRowIndices,
        rowRanges,
      });
    }
  }

  // Build modified docXml from right to left across matched tables
  let updatedDocXml = docXml;
  for (let tIdx = tablesWithItemRows.length - 1; tIdx >= 0; tIdx--) {
    const info = tablesWithItemRows[tIdx];
    const firstTemplateIdx = info.templateRowIndices[0];
    const templateRowXml = info.rowRanges[firstTemplateIdx].xml;

    // Determine which items go into this table
    let sliceItems: Array<Record<string, string>>;
    let padToCount = 0;

    if (options.mode === 'case3_act' && tablesWithItemRows.length >= 2) {
      if (tIdx === 0) {
        // Front table: up to 15 items, padded to 15
        sliceItems = itemValuesList.slice(0, 15);
        padToCount = 15;
      } else if (tIdx === 1) {
        // Back continuation table: items 15+, padded to at least 12
        sliceItems = itemValuesList.slice(15);
        padToCount = Math.max(12, sliceItems.length + 3);
      } else {
        sliceItems = [];
      }
    } else if (options.mode === 'case3_act') {
      sliceItems = itemValuesList;
      padToCount = Math.max(15, sliceItems.length);
    } else {
      // Invoice (Case 1 or Form 434)
      sliceItems = itemValuesList;
      padToCount = options.minRows ? Math.max(options.minRows, sliceItems.length + 2) : sliceItems.length;
    }

    const emptyValues: Record<string, string> = {};
    if (sliceItems.length > 0) {
      for (const k of Object.keys(sliceItems[0])) {
        emptyValues[k] = '';
      }
    } else {
      for (const marker of ITEM_ROW_MARKERS) {
        emptyValues[marker.slice(2, -2)] = '';
      }
      emptyValues.ITEM_UNIT = '';
      emptyValues.ITEM_RECEIVED_DATE = '';
      emptyValues.ITEM_QTY = '';
    }

    const expandedRows: string[] = [];
    for (const itemVals of sliceItems) {
      expandedRows.push(replacePlaceholdersInXml(templateRowXml, { ...docValues, ...itemVals }));
    }
    for (let p = sliceItems.length; p < padToCount; p++) {
      expandedRows.push(replacePlaceholdersInXml(templateRowXml, { ...docValues, ...emptyValues }));
    }

    // Replace the template row(s) in the table.
    // Note: for Form 434 or Case 3 templates, any pre-existing blank padding rows right after templateRow
    // were NOT tagged with ITEM markers; if we replace ONLY the tagged template row AND strip trailing
    // completely empty cloned rows if user used our downloaded template? Wait: in our downloaded editable
    // template we put ONLY 1 template row (no redundant blank rows) so padding is computed cleanly!
    const targetRow = info.rowRanges[firstTemplateIdx];
    updatedDocXml =
      updatedDocXml.slice(0, targetRow.start) +
      expandedRows.join('') +
      updatedDocXml.slice(targetRow.end);
  }

  // Replace remaining document-level placeholders in body, headers, footers
  updatedDocXml = replacePlaceholdersInXml(updatedDocXml, docValues);
  zip.file('word/document.xml', updatedDocXml);

  for (const fileName of Object.keys(zip.files)) {
    if (/^word\/(header|footer)\d*\.xml$/i.test(fileName)) {
      const f = zip.file(fileName);
      if (f) {
        const xml = await f.async('string');
        zip.file(fileName, replacePlaceholdersInXml(xml, docValues));
      }
    }
  }

  return await zip.generateAsync({ type: 'nodebuffer' });
}

/**
 * Renders a per-item-section .docx template (Case 1 Act, Case 2 Act),
 * duplicating the entire document section for each equipment unit.
 */
export async function renderPerItemSectionTemplateDocx(
  templateBuffer: Buffer,
  perItemValues: Array<Record<string, string>>
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(templateBuffer);
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('В шаблоне .docx отсутствует word/document.xml');

  const docXml = await docFile.async('string');
  const bodyOpenMatch = docXml.match(/<w:body(?:\s[^>]*)?>/);
  const bodyCloseIdx = docXml.lastIndexOf('</w:body>');
  if (!bodyOpenMatch || bodyOpenMatch.index === undefined || bodyCloseIdx === -1) {
    throw new Error('Некорректный <w:body> в шаблоне .docx');
  }

  const bodyContentStart = bodyOpenMatch.index + bodyOpenMatch[0].length;
  const bodyInner = docXml.slice(bodyContentStart, bodyCloseIdx);

  // Extract trailing <w:sectPr>...</w:sectPr> if present
  const sectPrMatches = findBalancedElements(bodyInner, 'w:sectPr');
  const trailingSectPr = sectPrMatches.length > 0 ? sectPrMatches[sectPrMatches.length - 1] : null;

  const contentWithoutTrailingSectPr = trailingSectPr
    ? bodyInner.slice(0, trailingSectPr.start) + bodyInner.slice(trailingSectPr.end)
    : bodyInner;

  const sectPrXml = trailingSectPr ? trailingSectPr.xml : '';
  const sectionBreakParagraph = sectPrXml
    ? `<w:p><w:pPr>${sectPrXml}</w:pPr></w:p>`
    : '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

  const renderedBodies = perItemValues.map((vals, idx) => {
    const filled = replacePlaceholdersInXml(contentWithoutTrailingSectPr, vals);
    return idx < perItemValues.length - 1 ? `${filled}${sectionBreakParagraph}` : filled;
  });

  const finalDocXml =
    docXml.slice(0, bodyContentStart) +
    renderedBodies.join('') +
    sectPrXml +
    docXml.slice(bodyCloseIdx);

  zip.file('word/document.xml', finalDocXml);

  if (perItemValues.length > 0) {
    for (const fileName of Object.keys(zip.files)) {
      if (/^word\/(header|footer)\d*\.xml$/i.test(fileName)) {
        const f = zip.file(fileName);
        if (f) {
          const xml = await f.async('string');
          zip.file(fileName, replacePlaceholdersInXml(xml, perItemValues[0]));
        }
      }
    }
  }

  return await zip.generateAsync({ type: 'nodebuffer' });
}

/**
 * Merges multiple standalone .docx buffers sequentially, preserving each document's page orientation
 * and margins via <w:p><w:pPr><w:sectPr>...</w:sectPr></w:pPr></w:p> section breaks.
 */
export async function mergeDocxBuffers(buffers: Buffer[]): Promise<Buffer> {
  if (buffers.length === 0) {
    throw new Error('Нет документов для объединения');
  }
  if (buffers.length === 1) {
    return buffers[0];
  }

  const baseZip = await JSZip.loadAsync(buffers[0]);
  const baseDocFile = baseZip.file('word/document.xml');
  if (!baseDocFile) throw new Error('Некорректный базовый .docx документ');
  const baseDocXml = await baseDocFile.async('string');

  const bodyOpenMatch = baseDocXml.match(/<w:body(?:\s[^>]*)?>/);
  const baseBodyCloseIdx = baseDocXml.lastIndexOf('</w:body>');
  if (!bodyOpenMatch || bodyOpenMatch.index === undefined || baseBodyCloseIdx === -1) {
    throw new Error('Некорректный <w:body> в базовом .docx');
  }
  const baseBodyStart = bodyOpenMatch.index + bodyOpenMatch[0].length;

  const combinedParts: string[] = [];
  let lastSectPr = '';

  for (let i = 0; i < buffers.length; i++) {
    const z = i === 0 ? baseZip : await JSZip.loadAsync(buffers[i]);
    const df = z.file('word/document.xml');
    if (!df) continue;
    const xml = await df.async('string');

    const bOpen = xml.match(/<w:body(?:\s[^>]*)?>/);
    const bClose = xml.lastIndexOf('</w:body>');
    if (!bOpen || bOpen.index === undefined || bClose === -1) continue;

    const inner = xml.slice(bOpen.index + bOpen[0].length, bClose);
    const sectPrList = findBalancedElements(inner, 'w:sectPr');
    const trailingSect = sectPrList.length > 0 ? sectPrList[sectPrList.length - 1] : null;
    const pureBody = trailingSect
      ? inner.slice(0, trailingSect.start) + inner.slice(trailingSect.end)
      : inner;
    const thisSectXml = trailingSect ? trailingSect.xml : '';

    if (i < buffers.length - 1) {
      combinedParts.push(
        `${pureBody}${thisSectXml ? `<w:p><w:pPr>${thisSectXml}</w:pPr></w:p>` : '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'}`
      );
    } else {
      combinedParts.push(pureBody);
      lastSectPr = thisSectXml;
    }
  }

  const mergedDocXml =
    baseDocXml.slice(0, baseBodyStart) +
    combinedParts.join('') +
    lastSectPr +
    baseDocXml.slice(baseBodyCloseIdx);

  baseZip.file('word/document.xml', mergedDocXml);
  return await baseZip.generateAsync({ type: 'nodebuffer' });
}
