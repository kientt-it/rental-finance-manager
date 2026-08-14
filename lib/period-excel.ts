type ExcelExpense = {
  category: string;
  amount: number;
  expense_date: string;
  payer: string;
  participants: string;
  status: string;
  reference_code: string;
  note: string;
};

type ExcelPerson = {
  full_name: string;
  allocated: number;
  advanced: number;
  balance: number;
  paid: boolean;
  bank_account: string;
  bank_name: string;
};

export type PeriodExcelData = {
  propertyName: string;
  periodLabel: string;
  expenses: ExcelExpense[];
  people: ExcelPerson[];
};

function xml(value: string | number | boolean | null | undefined) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function textCell(value: string, style = "Body") {
  return `<Cell ss:StyleID="${style}"><Data ss:Type="String">${xml(value)}</Data></Cell>`;
}

function numberCell(value: number, style = "Currency") {
  return `<Cell ss:StyleID="${style}"><Data ss:Type="Number">${Number(value) || 0}</Data></Cell>`;
}

function row(cells: string[], style?: string) {
  return `<Row${style ? ` ss:StyleID="${style}"` : ""}>${cells.join("")}</Row>`;
}

function worksheet(name: string, rows: string[], widths: number[]) {
  return `<Worksheet ss:Name="${xml(name)}"><Table>${widths.map((width) => `<Column ss:AutoFitWidth="0" ss:Width="${width}"/>`).join("")}${rows.join("")}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>3</SplitHorizontal><TopRowBottomPane>3</TopRowBottomPane><ActivePane>2</ActivePane><ProtectObjects>False</ProtectObjects><ProtectScenarios>False</ProtectScenarios></WorksheetOptions></Worksheet>`;
}

export function createPeriodExcelXml(data: PeriodExcelData) {
  const total = data.expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const completed = data.expenses.filter((expense) => expense.status === "Hoàn thành").reduce((sum, expense) => sum + expense.amount, 0);
  const paidPeople = data.people.filter((person) => person.paid).length;

  const summaryRows = [
    row([`<Cell ss:MergeAcross="3" ss:StyleID="Title"><Data ss:Type="String">BÁO CÁO ${xml(data.periodLabel)}</Data></Cell>`]),
    row([`<Cell ss:MergeAcross="3" ss:StyleID="Subtitle"><Data ss:Type="String">${xml(data.propertyName)}</Data></Cell>`]),
    row([textCell("Chỉ tiêu", "Header"), textCell("Giá trị", "Header"), textCell("Ghi chú", "Header"), textCell("Trạng thái", "Header")]),
    row([textCell("Tổng chi phí"), numberCell(total), textCell(`${data.expenses.length} khoản`), textCell(completed === total ? "Đã hoàn thành" : "Còn chờ xử lý")]),
    row([textCell("Đã hoàn thành"), numberCell(completed), textCell(`${data.expenses.filter((expense) => expense.status === "Hoàn thành").length} khoản`), textCell("")]),
    row([textCell("Chưa hoàn thành"), numberCell(total - completed), textCell(`${data.expenses.filter((expense) => expense.status !== "Hoàn thành").length} khoản`), textCell("")]),
    row([textCell("Thành viên đã đóng"), numberCell(paidPeople, "Integer"), textCell(`${paidPeople}/${data.people.length} người`), textCell(paidPeople === data.people.length ? "Đã đóng đủ" : "Còn tồn đọng")]),
  ];

  const expenseRows = [
    row([`<Cell ss:MergeAcross="7" ss:StyleID="Title"><Data ss:Type="String">CHI PHÍ ${xml(data.periodLabel)}</Data></Cell>`]),
    row([`<Cell ss:MergeAcross="7" ss:StyleID="Subtitle"><Data ss:Type="String">${xml(data.propertyName)}</Data></Cell>`]),
    row(["Ngày", "Nội dung", "Mã tham chiếu", "Người thanh toán", "Người tham gia", "Tổng chi", "Trạng thái", "Ghi chú"].map((value) => textCell(value, "Header"))),
    ...data.expenses.map((expense) => row([
      textCell(expense.expense_date, "Date"),
      textCell(expense.category),
      textCell(expense.reference_code),
      textCell(expense.payer),
      textCell(expense.participants, "Wrap"),
      numberCell(expense.amount),
      textCell(expense.status, expense.status === "Hoàn thành" ? "Success" : "Warning"),
      textCell(expense.note, "Wrap"),
    ])),
    row([`<Cell ss:MergeAcross="4" ss:StyleID="TotalLabel"><Data ss:Type="String">TỔNG CỘNG</Data></Cell>`, numberCell(total, "TotalCurrency"), textCell(""), textCell("")]),
  ];

  const peopleRows = [
    row([`<Cell ss:MergeAcross="7" ss:StyleID="Title"><Data ss:Type="String">ĐỐI SOÁT ${xml(data.periodLabel)}</Data></Cell>`]),
    row([`<Cell ss:MergeAcross="7" ss:StyleID="Subtitle"><Data ss:Type="String">${xml(data.propertyName)}</Data></Cell>`]),
    row(["Thành viên", "Phần chi phí", "Đã ứng", "Cần đóng", "Được nhận", "Đã đóng", "Số tài khoản", "Ngân hàng"].map((value) => textCell(value, "Header"))),
    ...data.people.map((person) => row([
      textCell(person.full_name),
      numberCell(person.allocated),
      numberCell(person.advanced),
      numberCell(Math.max(person.balance, 0)),
      numberCell(Math.max(-person.balance, 0)),
      textCell(person.paid ? "Đã đóng" : "Chưa đóng", person.paid ? "Success" : "Warning"),
      textCell(person.bank_account),
      textCell(person.bank_name),
    ])),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/><Font ss:FontName="Arial" ss:Size="10"/></Style><Style ss:ID="Body"><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5E7EB"/></Borders></Style><Style ss:ID="Wrap"><Alignment ss:Vertical="Center" ss:WrapText="1"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5E7EB"/></Borders></Style><Style ss:ID="Title"><Font ss:FontName="Arial" ss:Size="16" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#087A58" ss:Pattern="Solid"/><Alignment ss:Vertical="Center"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#087A58"/></Borders></Style><Style ss:ID="Subtitle"><Font ss:FontName="Arial" ss:Size="11" ss:Bold="1" ss:Color="#36534A"/><Interior ss:Color="#DFF3EA" ss:Pattern="Solid"/></Style><Style ss:ID="Header"><Font ss:FontName="Arial" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#235B49" ss:Pattern="Solid"/><Alignment ss:Vertical="Center" ss:WrapText="1"/></Style><Style ss:ID="Currency"><NumberFormat ss:Format="#,##0&quot; ₫&quot;"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5E7EB"/></Borders></Style><Style ss:ID="TotalCurrency"><Font ss:Bold="1"/><NumberFormat ss:Format="#,##0&quot; ₫&quot;"/><Interior ss:Color="#DFF3EA" ss:Pattern="Solid"/></Style><Style ss:ID="Integer"><NumberFormat ss:Format="0"/></Style><Style ss:ID="Date"><NumberFormat ss:Format="dd/mm/yyyy"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5E7EB"/></Borders></Style><Style ss:ID="Success"><Font ss:Color="#087A58" ss:Bold="1"/><Interior ss:Color="#E8F7F0" ss:Pattern="Solid"/></Style><Style ss:ID="Warning"><Font ss:Color="#B55A00" ss:Bold="1"/><Interior ss:Color="#FFF3E2" ss:Pattern="Solid"/></Style><Style ss:ID="TotalLabel"><Font ss:Bold="1"/><Interior ss:Color="#DFF3EA" ss:Pattern="Solid"/><Alignment ss:Horizontal="Right"/></Style></Styles>${worksheet("Tổng quan", summaryRows, [150, 115, 160, 120])}${worksheet("Chi phí", expenseRows, [85, 150, 105, 135, 240, 110, 105, 180])}${worksheet("Đối soát", peopleRows, [145, 105, 105, 105, 105, 95, 125, 130])}</Workbook>`;
}

export function downloadPeriodExcel(xmlContent: string, fileName: string) {
  const blob = new Blob(["\ufeff", xmlContent], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName.endsWith(".xls") ? fileName : `${fileName}.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

