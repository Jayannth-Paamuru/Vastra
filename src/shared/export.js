// Dependency-free CSV (UTF-8 BOM) and OpenXML (.xlsx) workbook generator.
// Runs identically in Cloudflare Workers and offline browsers with 0 third-party dependencies.

const encoder = new TextEncoder();

// Neutralize Excel formula injection (=, +, -, @, tab, CR)
export function sanitizeSpreadsheetText(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.length === 0) return '';
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

function escapeCsvCell(value) {
  const text = sanitizeSpreadsheetText(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildCsv(headers, rows) {
  const lines = [headers.map(escapeCsvCell).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCsvCell).join(','));
  }
  // Prepend UTF-8 BOM so ₹ renders properly in Microsoft Excel & Google Sheets
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

// --- Pure JS ZIP (STORE) + CRC32 for OpenXML .xlsx ---
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function buildZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const dataBytes =
      typeof entry.content === 'string' ? encoder.encode(entry.content) : entry.content;
    const crc = crc32(dataBytes);
    const size = dataBytes.length;

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0x5421, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, dataBytes);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x5421, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    centralParts.push(centralHeader);
    offset += localHeader.length + dataBytes.length;
  }

  const centralSize = centralParts.reduce((sum, p) => sum + p.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const totalLength = offset + centralSize + eocd.length;
  const output = new Uint8Array(totalLength);
  let cursor = 0;
  for (const part of localParts) {
    output.set(part, cursor);
    cursor += part.length;
  }
  for (const part of centralParts) {
    output.set(part, cursor);
    cursor += part.length;
  }
  output.set(eocd, cursor);
  return output;
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function columnIndexToLetter(index) {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function buildWorksheetXml(columns, rows) {
  const widths = columns.map((col) => Math.max(col.header.length + 4, col.minWidth || 12));
  for (const row of rows) {
    columns.forEach((col, ci) => {
      const raw = row[col.key];
      const len = raw === null || raw === undefined ? 0 : String(raw).length + 3;
      if (len > widths[ci]) {
        widths[ci] = Math.min(48, len);
      }
    });
  }

  const colsXml = widths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w.toFixed(1)}" customWidth="1"/>`)
    .join('');

  const headerCells = columns
    .map((col, ci) => {
      const ref = `${columnIndexToLetter(ci)}1`;
      return `<c r="${ref}" t="inlineStr" s="1"><is><t>${escapeXml(col.header)}</t></is></c>`;
    })
    .join('');

  const dataRowsXml = rows
    .map((row, ri) => {
      const rowNum = ri + 2;
      const cells = columns
        .map((col, ci) => {
          const ref = `${columnIndexToLetter(ci)}${rowNum}`;
          const raw = row[col.key];
          if (col.type === 'currency' || col.type === 'number' || col.type === 'percent') {
            const num = Number(raw);
            const safeNum = Number.isFinite(num) ? num : 0;
            const styleIdx = col.type === 'currency' ? 2 : col.type === 'percent' ? 4 : 3;
            return `<c r="${ref}" s="${styleIdx}"><v>${safeNum}</v></c>`;
          }
          const safeText = sanitizeSpreadsheetText(raw);
          return `<c r="${ref}" t="inlineStr" s="0"><is><t xml:space="preserve">${escapeXml(safeText)}</t></is></c>`;
        })
        .join('');
      return `<row r="${rowNum}">${cells}</row>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>${colsXml}</cols>
  <sheetData>
    <row r="1" ht="24" customHeight="1">${headerCells}</row>
    ${dataRowsXml}
  </sheetData>
</worksheet>`;
}

export function buildXlsxWorkbook(sheets) {
  const safeSheets = sheets.map((s, idx) => ({
    name: String(s.name || `Sheet${idx + 1}`)
      .replace(/[\\/*?:[\]]/g, '')
      .slice(0, 31),
    columns: s.columns,
    rows: s.rows
  }));

  const sheetOverrides = safeSheets
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )
    .join('');

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${sheetOverrides}
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbookSheetsXml = safeSheets
    .map(
      (s, i) =>
        `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
    )
    .join('');

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${workbookSheetsXml}</sheets>
</workbook>`;

  const wbRelsList = safeSheets
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
    )
    .join('');

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${wbRelsList}
  <Relationship Id="rId${safeSheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2">
    <numFmt numFmtId="164" formatCode="&quot;₹&quot;#,##0.00"/>
    <numFmt numFmtId="165" formatCode="0.0&quot;%&quot;"/>
  </numFmts>
  <fonts count="2">
    <font><sz val="11"/><color rgb="FF1F2937"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF141833"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFE5E7EB"/></left>
      <right style="thin"><color rgb="FFE5E7EB"/></right>
      <top style="thin"><color rgb="FFE5E7EB"/></top>
      <bottom style="thin"><color rgb="FFE5E7EB"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="5">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
    <xf numFmtId="1" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
  </cellXfs>
</styleSheet>`;

  const zipEntries = [
    { name: '[Content_Types].xml', content: contentTypesXml },
    { name: '_rels/.rels', content: rootRelsXml },
    { name: 'xl/workbook.xml', content: workbookXml },
    { name: 'xl/_rels/workbook.xml.rels', content: workbookRelsXml },
    { name: 'xl/styles.xml', content: stylesXml }
  ];

  safeSheets.forEach((sheet, i) => {
    zipEntries.push({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      content: buildWorksheetXml(sheet.columns, sheet.rows)
    });
  });

  return buildZip(zipEntries);
}

// --- Domain Sheet Definitions ---

const INVENTORY_COLUMNS = [
  { key: 'sku', header: 'SKU', type: 'text', minWidth: 16 },
  { key: 'item_name', header: 'Item Name', type: 'text', minWidth: 26 },
  { key: 'type', header: 'Type', type: 'text', minWidth: 15 },
  { key: 'sub_type', header: 'Sub-Type', type: 'text', minWidth: 16 },
  { key: 'color', header: 'Color', type: 'text', minWidth: 13 },
  { key: 'pattern', header: 'Pattern', type: 'text', minWidth: 15 },
  { key: 'fabric', header: 'Fabric', type: 'text', minWidth: 14 },
  { key: 'size', header: 'Size', type: 'text', minWidth: 12 },
  { key: 'supplier_name', header: 'Supplier', type: 'text', minWidth: 18 },
  { key: 'quantity', header: 'Qty', type: 'number', minWidth: 8 },
  { key: 'purchase_cost', header: 'Purchase Cost (₹)', type: 'currency', minWidth: 18 },
  { key: 'selling_price', header: 'Selling Price (₹)', type: 'currency', minWidth: 18 },
  { key: 'est_profit', header: 'Est. Unit Profit (₹)', type: 'currency', minWidth: 18 },
  { key: 'margin_pct', header: 'Margin %', type: 'percent', minWidth: 12 },
  { key: 'purchase_date', header: 'Purchase Date', type: 'text', minWidth: 14 },
  { key: 'selling_date', header: 'Selling Date', type: 'text', minWidth: 14 },
  { key: 'status', header: 'Status', type: 'text', minWidth: 12 },
  { key: 'notes', header: 'Notes', type: 'text', minWidth: 24 }
];

const SALES_COLUMNS = [
  { key: 'sale_date', header: 'Sale Date', type: 'text', minWidth: 14 },
  { key: 'sku', header: 'SKU', type: 'text', minWidth: 16 },
  { key: 'item_name', header: 'Item Name', type: 'text', minWidth: 26 },
  { key: 'type', header: 'Type', type: 'text', minWidth: 14 },
  { key: 'sub_type', header: 'Sub-Type', type: 'text', minWidth: 15 },
  { key: 'color', header: 'Color', type: 'text', minWidth: 13 },
  { key: 'quantity_sold', header: 'Units Sold', type: 'number', minWidth: 12 },
  { key: 'unit_cost', header: 'Unit Cost (₹)', type: 'currency', minWidth: 16 },
  { key: 'unit_price', header: 'Unit Price (₹)', type: 'currency', minWidth: 16 },
  { key: 'total_revenue', header: 'Total Revenue (₹)', type: 'currency', minWidth: 18 },
  { key: 'total_cost', header: 'Total COGS (₹)', type: 'currency', minWidth: 16 },
  { key: 'profit', header: 'Net Profit (₹)', type: 'currency', minWidth: 16 },
  { key: 'margin_pct', header: 'Margin %', type: 'percent', minWidth: 12 },
  { key: 'customer_name', header: 'Customer Name', type: 'text', minWidth: 18 },
  { key: 'customer_phone', header: 'Customer Phone', type: 'text', minWidth: 16 },
  { key: 'payment_mode', header: 'Payment Mode', type: 'text', minWidth: 15 },
  { key: 'notes', header: 'Notes', type: 'text', minWidth: 24 }
];

const MONTHLY_COLUMNS = [
  { key: 'month', header: 'Month', type: 'text', minWidth: 14 },
  { key: 'units_sold', header: 'Units Sold', type: 'number', minWidth: 14 },
  { key: 'revenue', header: 'Total Revenue (₹)', type: 'currency', minWidth: 18 },
  { key: 'cogs', header: 'Total COGS (₹)', type: 'currency', minWidth: 18 },
  { key: 'net_profit', header: 'Net Profit (₹)', type: 'currency', minWidth: 18 },
  { key: 'margin_pct', header: 'Margin %', type: 'percent', minWidth: 14 }
];

function formatInventoryRows(items) {
  return (items || []).map((item) => {
    const cost = Number(item.purchase_cost) || 0;
    const price = Number(item.selling_price) || 0;
    const estProfit = price - cost;
    const margin = price > 0 ? Number(((estProfit / price) * 100).toFixed(1)) : 0;
    return {
      ...item,
      quantity: Number(item.quantity) || 0,
      purchase_cost: cost,
      selling_price: price,
      est_profit: estProfit,
      margin_pct: margin,
      selling_date: item.selling_date || ''
    };
  });
}

function formatSalesRows(sales) {
  return (sales || []).map((sale) => {
    const qty = Number(sale.quantity_sold) || 1;
    const unitCost = Number(sale.purchase_cost) || 0;
    const unitPrice = Number(sale.selling_price) || 0;
    const totalRevenue = unitPrice * qty;
    const totalCost = unitCost * qty;
    const profit = Number.isFinite(Number(sale.profit))
      ? Number(sale.profit)
      : totalRevenue - totalCost;
    const margin = totalRevenue > 0 ? Number(((profit / totalRevenue) * 100).toFixed(1)) : 0;
    return {
      ...sale,
      quantity_sold: qty,
      unit_cost: unitCost,
      unit_price: unitPrice,
      total_revenue: totalRevenue,
      total_cost: totalCost,
      profit,
      margin_pct: margin
    };
  });
}

export function computeMonthlySummary(sales) {
  const map = new Map();
  for (const s of sales || []) {
    const month = String(s.sale_date || '').slice(0, 7) || 'Unknown';
    const qty = Number(s.quantity_sold) || 1;
    const rev = (Number(s.selling_price) || 0) * qty;
    const cogs = (Number(s.purchase_cost) || 0) * qty;
    const profit = Number.isFinite(Number(s.profit)) ? Number(s.profit) : rev - cogs;
    const existing = map.get(month) || {
      month,
      units_sold: 0,
      revenue: 0,
      cogs: 0,
      net_profit: 0
    };
    existing.units_sold += qty;
    existing.revenue += rev;
    existing.cogs += cogs;
    existing.net_profit += profit;
    map.set(month, existing);
  }
  return Array.from(map.values())
    .sort((a, b) => b.month.localeCompare(a.month))
    .map((m) => ({
      ...m,
      margin_pct: m.revenue > 0 ? Number(((m.net_profit / m.revenue) * 100).toFixed(1)) : 0
    }));
}

export function generateInventoryCsv(items) {
  const rows = formatInventoryRows(items);
  return buildCsv(
    INVENTORY_COLUMNS.map((c) => c.header),
    rows.map((r) => INVENTORY_COLUMNS.map((c) => r[c.key]))
  );
}

export function generateSalesCsv(sales) {
  const rows = formatSalesRows(sales);
  return buildCsv(
    SALES_COLUMNS.map((c) => c.header),
    rows.map((r) => SALES_COLUMNS.map((c) => r[c.key]))
  );
}

export function generateInventoryXlsx(items) {
  return buildXlsxWorkbook([
    { name: 'Inventory', columns: INVENTORY_COLUMNS, rows: formatInventoryRows(items) }
  ]);
}

export function generateSalesXlsx(sales) {
  return buildXlsxWorkbook([
    { name: 'Sales Ledger', columns: SALES_COLUMNS, rows: formatSalesRows(sales) }
  ]);
}

export function generateFullReportXlsx(items, sales) {
  return buildXlsxWorkbook([
    { name: 'Inventory', columns: INVENTORY_COLUMNS, rows: formatInventoryRows(items) },
    { name: 'Sales Ledger', columns: SALES_COLUMNS, rows: formatSalesRows(sales) },
    { name: 'Monthly Summary', columns: MONTHLY_COLUMNS, rows: computeMonthlySummary(sales) }
  ]);
}
