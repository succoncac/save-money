export type TableAlign = 'left' | 'center' | 'right';

export type ChatBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'table'; headers: string[]; alignments: TableAlign[]; rows: string[][] };

export type InlineSegment =
  | { type: 'text'; text: string }
  | { type: 'bold'; text: string }
  | { type: 'italic'; text: string }
  | { type: 'code'; text: string };

const TABLE_SEP_REGEX = /^\s*\|?\s*:?-{2,}:?(?:\s*\|\s*:?-{2,}:?)*\s*\|?\s*$/;

function parsePipeRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
  return trimmed.split('|').map((cell) => cell.trim());
}

function parseAlignments(sepLine: string, colCount: number): TableAlign[] {
  const cells = parsePipeRow(sepLine);
  const aligns: TableAlign[] = [];
  for (let i = 0; i < colCount; i++) {
    const raw = (cells[i] || '').trim();
    if (raw.startsWith(':') && raw.endsWith(':')) {
      aligns.push('center');
    } else if (raw.endsWith(':')) {
      aligns.push('right');
    } else {
      aligns.push('left');
    }
  }
  return aligns;
}

function isTableStart(lines: string[], idx: number): boolean {
  if (idx + 1 >= lines.length) return false;
  const header = lines[idx];
  const sep = lines[idx + 1];
  if (!header.includes('|') || !sep.includes('-')) return false;
  if (!TABLE_SEP_REGEX.test(sep)) return false;
  const headerCells = parsePipeRow(header);
  const sepCells = parsePipeRow(sep);
  return headerCells.length >= 2 && sepCells.length >= 2;
}

function sanitizePlainText(raw: string): string {
  // Strip any leftover raw markdown asterisks or heading hash markers
  return raw
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/[*#]+/g, '')
    .replace(/[ \t]{2,}/g, ' ');
}

export function parseInlineSegments(input: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  // Match **bold**, __bold__, *italic*, or `code`
  const tokenRegex = /(\*\*[^*\n]+?\*\*|__[^_\n]+?__|`[^`\n]+?`|\*[^*\n]+?\*)/g;

  let lastIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(input)) !== null) {
    if (match.index > lastIdx) {
      const plain = sanitizePlainText(input.slice(lastIdx, match.index));
      if (plain) segments.push({ type: 'text', text: plain });
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      const inner = sanitizePlainText(token.slice(2, -2));
      if (inner) segments.push({ type: 'bold', text: inner });
    } else if (token.startsWith('__') && token.endsWith('__')) {
      const inner = sanitizePlainText(token.slice(2, -2));
      if (inner) segments.push({ type: 'bold', text: inner });
    } else if (token.startsWith('`') && token.endsWith('`')) {
      const inner = sanitizePlainText(token.slice(1, -1));
      if (inner) segments.push({ type: 'code', text: inner });
    } else if (token.startsWith('*') && token.endsWith('*')) {
      const inner = sanitizePlainText(token.slice(1, -1));
      if (inner) segments.push({ type: 'italic', text: inner });
    }
    lastIdx = match.index + token.length;
  }

  if (lastIdx < input.length) {
    const tail = sanitizePlainText(input.slice(lastIdx));
    if (tail) segments.push({ type: 'text', text: tail });
  }

  return segments;
}

export function parseChatBlocks(rawContent: string): ChatBlock[] {
  const normalized = rawContent.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const lines = normalized.split('\n');
  const blocks: ChatBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Horizontal rules like --- or ***
    if (/^(\*{3,}|-{3,}|_{3,})$/.test(trimmed)) {
      i++;
      continue;
    }

    // Markdown table
    if (isTableStart(lines, i)) {
      const headers = parsePipeRow(lines[i]);
      const alignments = parseAlignments(lines[i + 1], headers.length);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length) {
        const rowLine = lines[i].trim();
        if (!rowLine || !rowLine.includes('|') || TABLE_SEP_REGEX.test(rowLine)) {
          break;
        }
        const rawCells = parsePipeRow(rowLine);
        const normalizedRow = Array.from({ length: headers.length }, (_, colIdx) =>
          (rawCells[colIdx] ?? '').trim(),
        );
        rows.push(normalizedRow);
        i++;
      }
      blocks.push({ type: 'table', headers, alignments, rows });
      continue;
    }

    // Markdown heading (# Heading)
    const headingMatch = /^#{1,6}\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      blocks.push({ type: 'heading', text: headingMatch[1].trim() });
      i++;
      continue;
    }

    // Unordered list (* item, - item, + item, • item)
    if (/^([*\-+•])\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length) {
        const ulMatch = /^([*\-+•])\s+(.+)$/.exec(lines[i].trim());
        if (!ulMatch) break;
        items.push(ulMatch[2].trim());
        i++;
      }
      if (items.length > 0) {
        blocks.push({ type: 'ul', items });
        continue;
      }
    }

    // Ordered list (1. item)
    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length) {
        const olMatch = /^\d+[.)]\s+(.+)$/.exec(lines[i].trim());
        if (!olMatch) break;
        items.push(olMatch[1].trim());
        i++;
      }
      if (items.length > 0) {
        blocks.push({ type: 'ol', items });
        continue;
      }
    }

    // Paragraph: collect contiguous normal text lines until blank line or structural block
    const paraLines: string[] = [];
    while (i < lines.length) {
      const cur = lines[i];
      const curTrim = cur.trim();
      if (!curTrim) break;
      if (
        isTableStart(lines, i) ||
        /^#{1,6}\s+/.test(curTrim) ||
        /^([*\-+•])\s+/.test(curTrim) ||
        /^\d+[.)]\s+/.test(curTrim) ||
        /^(\*{3,}|-{3,}|_{3,})$/.test(curTrim)
      ) {
        break;
      }
      paraLines.push(curTrim);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: 'paragraph', text: paraLines.join('\n') });
    }
  }

  return blocks;
}

export function formatReadablePlainText(rawContent: string): string {
  const blocks = parseChatBlocks(rawContent);
  return blocks
    .map((block) => {
      if (block.type === 'heading' || block.type === 'paragraph') {
        return parseInlineSegments(block.text).map((s) => s.text).join('');
      }
      if (block.type === 'ul') {
        return block.items
          .map((item) => `- ${parseInlineSegments(item).map((s) => s.text).join('')}`)
          .join('\n');
      }
      if (block.type === 'ol') {
        return block.items
          .map((item, idx) => `${idx + 1}. ${parseInlineSegments(item).map((s) => s.text).join('')}`)
          .join('\n');
      }
      const headerLine = block.headers
        .map((h) => parseInlineSegments(h).map((s) => s.text).join(''))
        .join(' | ');
      const bodyLines = block.rows.map((row) =>
        row.map((c) => parseInlineSegments(c).map((s) => s.text).join('')).join(' | '),
      );
      return [headerLine, ...bodyLines].join('\n');
    })
    .join('\n\n');
}
