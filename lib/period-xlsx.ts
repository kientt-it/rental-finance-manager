type ExcelExpense = { category: string; amount: number; expense_date: string; payer: string; participants: string; status: string; reference_code: string; note: string };
type ExcelPerson = { full_name: string; allocated: number; advanced: number; balance: number; paid: boolean; bank_account: string; bank_name: string };
export type PeriodExcelData = { propertyName: string; periodLabel: string; expenses: ExcelExpense[]; people: ExcelPerson[] };

const encoder = new TextEncoder();
const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function escapeXml(value: unknown) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function ref(col: number, row: number) { return `${letters[col]}${row}`; }
function text(col: number, row: number, value: string, style = 4) { return `<c r="${ref(col, row)}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`; }
function number(col: number, row: number, value: number, style = 5) { return `<c r="${ref(col, row)}" s="${style}"><v>${Number(value) || 0}</v></c>`; }
function formula(col: number, row: number, value: string, cached: number, style = 6) { return `<c r="${ref(col, row)}" s="${style}"><f>${escapeXml(value)}</f><v>${Number(cached) || 0}</v></c>`; }
function date(col: number, row: number, value: string) {
  const iso = /^\d{2}\/\d{2}\/\d{4}$/.test(value) ? `${value.slice(6)}-${value.slice(3, 5)}-${value.slice(0, 2)}` : value.slice(0, 10);
  const time = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(time) ? text(col, row, value) : number(col, row, time / 86_400_000 + 25_569, 8);
}
function row(index: number, cells: string[], height?: number) { return `<row r="${index}"${height ? ` ht="${height}" customHeight="1"` : ""}>${cells.join("")}</row>`; }

function sheetXml(rows: string[], widths: number[], endColumn: string, endRow: number, merges: string[], filter: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${endColumn}${endRow}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="20"/><cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}</cols><sheetData>${rows.join("")}</sheetData><autoFilter ref="${filter}"/><mergeCells count="${merges.length}">${merges.map((item) => `<mergeCell ref="${item}"/>`).join("")}</mergeCells><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>`;
}

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
function u16(value: number) { const bytes = new Uint8Array(2); new DataView(bytes.buffer).setUint16(0, value, true); return bytes; }
function u32(value: number) { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value >>> 0, true); return bytes; }
function join(parts: Uint8Array[]) { const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let offset = 0; for (const part of parts) { output.set(part, offset); offset += part.length; } return output; }

function makeZip(entries: Array<{ name: string; value: string }>) {
  const local: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name), data = encoder.encode(entry.value), checksum = crc32(data);
    const header = join([u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(checksum), u32(data.length), u32(data.length), u16(name.length), u16(0), name]);
    local.push(header, data);
    central.push(join([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(checksum), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    offset += header.length + data.length;
  }
  const directory = join(central);
  return join([...local, directory, u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(directory.length), u32(offset), u16(0)]);
}

export function createPeriodXlsx(data: PeriodExcelData) {
  const total = data.expenses.reduce((sum, item) => sum + item.amount, 0);
  const completedItems = data.expenses.filter((item) => item.status === "Hoàn thành");
  const completed = completedItems.reduce((sum, item) => sum + item.amount, 0);
  const paid = data.people.filter((person) => person.paid).length;
  const summary = [
    row(1, [text(0, 1, `BÁO CÁO ${data.periodLabel}`, 1)], 30), row(2, [text(0, 2, data.propertyName, 2)], 23),
    row(3, ["Chỉ tiêu", "Giá trị", "Ghi chú", "Trạng thái"].map((value, col) => text(col, 3, value, 3)), 26),
    row(4, [text(0, 4, "Tổng chi phí"), number(1, 4, total), text(2, 4, `${data.expenses.length} khoản`), text(3, 4, completed === total ? "Đã hoàn thành" : "Còn chờ xử lý", completed === total ? 9 : 10)]),
    row(5, [text(0, 5, "Đã hoàn thành"), number(1, 5, completed), text(2, 5, `${completedItems.length} khoản`), text(3, 5, "")]),
    row(6, [text(0, 6, "Chưa hoàn thành"), number(1, 6, total - completed), text(2, 6, `${data.expenses.length - completedItems.length} khoản`), text(3, 6, "")]),
    row(7, [text(0, 7, "Thành viên đã đóng"), number(1, 7, paid, 7), text(2, 7, `${paid}/${data.people.length} người`), text(3, 7, paid === data.people.length ? "Đã đóng đủ" : "Còn tồn đọng", paid === data.people.length ? 9 : 10)]),
  ];
  const firstExpenseRow = 4, totalRow = firstExpenseRow + data.expenses.length;
  const expenseRows = [
    row(1, [text(0, 1, `CHI PHÍ ${data.periodLabel}`, 1)], 30), row(2, [text(0, 2, data.propertyName, 2)], 23),
    row(3, ["Ngày", "Nội dung", "Mã tham chiếu", "Người thanh toán", "Người tham gia", "Tổng chi", "Trạng thái", "Ghi chú"].map((value, col) => text(col, 3, value, 3)), 32),
    ...data.expenses.map((item, index) => { const line = firstExpenseRow + index; return row(line, [date(0, line, item.expense_date), text(1, line, item.category), text(2, line, item.reference_code), text(3, line, item.payer), text(4, line, item.participants, 12), number(5, line, item.amount), text(6, line, item.status, item.status === "Hoàn thành" ? 9 : 10), text(7, line, item.note, 12)], 28); }),
    row(totalRow, [text(0, totalRow, "TỔNG CỘNG", 11), formula(5, totalRow, data.expenses.length ? `SUM(F4:F${totalRow - 1})` : "0", total)], 26),
  ];
  const peopleRows = [
    row(1, [text(0, 1, `ĐỐI SOÁT ${data.periodLabel}`, 1)], 30), row(2, [text(0, 2, data.propertyName, 2)], 23),
    row(3, ["Thành viên", "Phần chi phí", "Đã ứng", "Cần đóng", "Được nhận", "Đã đóng", "Số tài khoản", "Ngân hàng"].map((value, col) => text(col, 3, value, 3)), 32),
    ...data.people.map((person, index) => { const line = 4 + index; return row(line, [text(0, line, person.full_name), number(1, line, person.allocated), number(2, line, person.advanced), number(3, line, Math.max(person.balance, 0)), number(4, line, Math.max(-person.balance, 0)), text(5, line, person.paid ? "Đã đóng" : "Chưa đóng", person.paid ? 9 : 10), text(6, line, person.bank_account), text(7, line, person.bank_name)], 26); }),
  ];
  const sheets = [
    sheetXml(summary, [24, 18, 24, 20], "D", 7, ["A1:D1", "A2:D2"], "A3:D7"),
    sheetXml(expenseRows, [14, 24, 18, 22, 38, 18, 18, 30], "H", Math.max(totalRow, 3), ["A1:H1", "A2:H2", `A${totalRow}:E${totalRow}`], `A3:H${Math.max(3, totalRow - 1)}`),
    sheetXml(peopleRows, [24, 18, 18, 18, 18, 16, 22, 22], "H", Math.max(3, data.people.length + 3), ["A1:H1", "A2:H2"], `A3:H${Math.max(3, data.people.length + 3)}`),
  ];
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0 &quot;₫&quot;"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts><fonts count="5"><font><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="16"/><name val="Aptos Display"/></font><font><b/><color rgb="FF36534A"/><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font><font><b/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="7"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF087A58"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDFF3EA"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF235B49"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8F7F0"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF3E2"/></patternFill></fill></fills><borders count="2"><border/><border><bottom style="thin"><color rgb="FFE5E7EB"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="13"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="3" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment horizontal="right"/></xf><xf numFmtId="164" fontId="4" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"><alignment horizontal="right"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment horizontal="right"/></xf><xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="0" fontId="4" fillId="5" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment horizontal="center"/></xf><xf numFmtId="0" fontId="4" fillId="6" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment horizontal="center"/></xf><xf numFmtId="0" fontId="4" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment horizontal="right"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment wrapText="1" vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView windowWidth="24000" windowHeight="12000"/></bookViews><sheets><sheet name="Tổng quan" sheetId="1" r:id="rId1"/><sheet name="Chi phí" sheetId="2" r:id="rId2"/><sheet name="Đối soát" sheetId="3" r:id="rId3"/></sheets><calcPr calcMode="auto" fullCalcOnLoad="1"/></workbook>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  return makeZip([{ name: "[Content_Types].xml", value: contentTypes }, { name: "_rels/.rels", value: rels }, { name: "xl/workbook.xml", value: workbook }, { name: "xl/_rels/workbook.xml.rels", value: workbookRels }, { name: "xl/styles.xml", value: styles }, ...sheets.map((value, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, value }))]);
}

export function downloadPeriodXlsx(content: Uint8Array, fileName: string) {
  const blob = new Blob([content.buffer as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url;
  link.download = fileName.replace(/\.(xls|xlsx)$/i, "") + ".xlsx";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
