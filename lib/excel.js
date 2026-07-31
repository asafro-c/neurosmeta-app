/**
 * Генератор Excel-сметы из JSON (ExcelJS).
 * Порт Python-генератора generate_excel.py на Node.js.
 */

const ExcelJS = require("exceljs");

const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F5496" } };
const SECTION_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD6E4F0" } };
const TOTAL_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2EFDA" } };
const SUB_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
const VAT_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFCE4EC" } };

const THIN_BORDER = {
  top: { style: "thin", color: { argb: "FFAAAAAA" } },
  bottom: { style: "thin", color: { argb: "FFAAAAAA" } },
  left: { style: "thin", color: { argb: "FFAAAAAA" } },
  right: { style: "thin", color: { argb: "FFAAAAAA" } },
};

const FONT_D = { name: "Arial", size: 9 };
const FONT_DB = { name: "Arial", size: 9, bold: true };
const FONT_H = { name: "Arial", size: 9, bold: true, color: { argb: "FFFFFFFF" } };
const FONT_T = { name: "Arial", size: 12, bold: true };
const FONT_TL = { name: "Arial", size: 10, bold: true };
const FONT_S = { name: "Arial", size: 10, italic: true };
const FONT_SM = { name: "Arial", size: 8, color: { argb: "FF666666" } };
const FONT_L = { name: "Arial", size: 9, color: { argb: "FF444444" } };
const FONT_SC = { name: "Arial", size: 9, bold: true };

function sc(cell, { font, fill, align, border, numFmt } = {}) {
  if (font) cell.font = font;
  if (fill) cell.fill = fill;
  if (align) cell.alignment = align;
  if (border) cell.border = border;
  if (numFmt) cell.numFmt = numFmt;
}

function hdrRow(ws, r, headers) {
  headers.forEach((h, i) => {
    const cell = ws.getCell(r, i + 1);
    cell.value = h;
    sc(cell, { font: FONT_H, fill: HEADER_FILL, align: { horizontal: "center", vertical: "middle", wrapText: true }, border: THIN_BORDER });
  });
}


// =============================================
// ЛИСТ: МАТЕРИАЛЫ (строится первым)
// =============================================
function buildMaterials(wb, data) {
  const ws = wb.addWorksheet("Материалы");
  const meta = data.meta;
  ws.columns = [
    { width: 7 }, { width: 55 }, { width: 8 }, { width: 10 }, { width: 12 }, { width: 14 },
  ];

  let r = 1;
  ws.mergeCells(r, 1, r, 6);
  const title = (meta.title || "").replace("СМЕТА", "ВЕДОМОСТЬ МАТЕРИАЛОВ");
  ws.getCell(r, 1).value = title;
  sc(ws.getCell(r, 1), { font: FONT_T, align: { horizontal: "center" } });
  r++;
  ws.mergeCells(r, 1, r, 6);
  ws.getCell(r, 1).value = "Все цены без НДС";
  sc(ws.getCell(r, 1), { font: FONT_SM });
  r += 2;
  hdrRow(ws, r, ["№", "Наименование материала", "Ед.", "Кол-во", "Цена (без НДС)", "Стоимость"]);
  r++;

  const subtotalMap = {};
  const allSubRows = [];

  for (const sec of data.sections) {
    const hasM = sec.positions.some((p) => p.materials && p.materials.length > 0);
    if (!hasM) continue;

    ws.mergeCells(r, 1, r, 6);
    ws.getCell(r, 1).value = sec.name;
    sc(ws.getCell(r, 1), { font: FONT_SC, fill: SECTION_FILL, align: { horizontal: "left" }, border: THIN_BORDER });
    for (let c = 1; c <= 6; c++) sc(ws.getCell(r, c), { fill: SECTION_FILL, border: THIN_BORDER });
    r++;

    for (const pos of sec.positions) {
      const mats = pos.materials || [];
      if (!mats.length) continue;

      const start = r;
      for (const mat of mats) {
        ws.getCell(r, 1).value = pos.num;
        sc(ws.getCell(r, 1), { font: FONT_D, align: { horizontal: "center" }, border: THIN_BORDER });
        ws.getCell(r, 2).value = mat.name;
        sc(ws.getCell(r, 2), { font: FONT_D, align: { horizontal: "left", wrapText: true }, border: THIN_BORDER });
        ws.getCell(r, 3).value = mat.unit;
        sc(ws.getCell(r, 3), { font: FONT_D, align: { horizontal: "center" }, border: THIN_BORDER });
        ws.getCell(r, 4).value = mat.qty;
        sc(ws.getCell(r, 4), { font: FONT_D, align: { horizontal: "center" }, border: THIN_BORDER, numFmt: "#,##0.00" });
        ws.getCell(r, 5).value = mat.price;
        sc(ws.getCell(r, 5), { font: FONT_D, align: { horizontal: "right" }, border: THIN_BORDER, numFmt: "#,##0.00" });
        ws.getCell(r, 6).value = { formula: `D${r}*E${r}` };
        sc(ws.getCell(r, 6), { font: FONT_D, align: { horizontal: "right" }, border: THIN_BORDER, numFmt: "#,##0.00" });
        r++;
      }

      // Subtotal
      ws.mergeCells(r, 1, r, 5);
      ws.getCell(r, 1).value = `Итого поз. ${pos.num}`;
      sc(ws.getCell(r, 1), { font: FONT_DB, fill: SUB_FILL, align: { horizontal: "left" }, border: THIN_BORDER });
      ws.getCell(r, 6).value = { formula: `SUM(F${start}:F${r - 1})` };
      sc(ws.getCell(r, 6), { font: FONT_DB, fill: SUB_FILL, align: { horizontal: "right" }, border: THIN_BORDER, numFmt: "#,##0.00" });
      subtotalMap[pos.num] = r;
      allSubRows.push(r);
      r++;
    }
  }

  // Grand total
  r++;
  ws.mergeCells(r, 1, r, 5);
  ws.getCell(r, 1).value = "ИТОГО МАТЕРИАЛЫ (без НДС):";
  sc(ws.getCell(r, 1), { font: FONT_TL, fill: TOTAL_FILL, align: { horizontal: "left" }, border: THIN_BORDER });
  const formula = allSubRows.length ? allSubRows.map((sr) => `F${sr}`).join("+") : "0";
  ws.getCell(r, 6).value = { formula };
  sc(ws.getCell(r, 6), { font: FONT_TL, fill: TOTAL_FILL, align: { horizontal: "right" }, border: THIN_BORDER, numFmt: "#,##0.00" });

  return subtotalMap;
}


// =============================================
// ЛИСТ: СМЕТА
// =============================================
function buildSmeta(wb, data, matMap) {
  const ws = wb.addWorksheet("СМЕТА");
  const meta = data.meta;
  ws.columns = [
    { width: 7 }, { width: 58 }, { width: 8 }, { width: 9 },
    { width: 12 }, { width: 14 }, { width: 12 }, { width: 14 }, { width: 16 },
  ];

  let r = 1;
  ws.mergeCells(r, 1, r, 9);
  ws.getCell(r, 1).value = meta.title;
  sc(ws.getCell(r, 1), { font: FONT_T, align: { horizontal: "center" } });
  r++;
  ws.mergeCells(r, 1, r, 9);
  ws.getCell(r, 1).value = meta.subtitle || "";
  sc(ws.getCell(r, 1), { font: FONT_S, align: { horizontal: "center" } });
  r += 2;

  ws.getCell(r, 1).value = "Заказчик:"; sc(ws.getCell(r, 1), { font: FONT_L });
  ws.getCell(r, 3).value = meta.client || ""; r++;
  ws.getCell(r, 1).value = "Подрядчик / Исполнитель:"; sc(ws.getCell(r, 1), { font: FONT_L });
  ws.getCell(r, 3).value = meta.contractor || "НейроСмета"; r++;

  const sumStart = r;
  for (const lbl of ["Итоговая стоимость, в т.ч. НДС 22%", "В том числе НДС 22%", "Стоимость без НДС"]) {
    ws.mergeCells(r, 1, r, 7);
    ws.getCell(r, 1).value = lbl;
    sc(ws.getCell(r, 1), { font: lbl.includes("Итоговая") ? FONT_TL : FONT_DB });
    sc(ws.getCell(r, 9), { font: lbl.includes("Итоговая") ? FONT_TL : FONT_DB, align: { horizontal: "right" }, numFmt: "#,##0.00" });
    r++;
  }
  r++;

  // Headers
  const h1 = ["№", "Наименование работ", "Ед.", "Кол-во", "Материалы (без НДС)", "", "Работы (без НДС)", "", "Всего (без НДС)"];
  h1.forEach((h, i) => {
    ws.getCell(r, i + 1).value = h;
    sc(ws.getCell(r, i + 1), { font: FONT_H, fill: HEADER_FILL, align: { horizontal: "center", vertical: "middle", wrapText: true }, border: THIN_BORDER });
  });
  ws.mergeCells(r, 5, r, 6);
  ws.mergeCells(r, 7, r, 8);
  r++;
  const h2 = ["", "", "", "", "Цена/ед.", "Итого", "Цена/ед.", "Итого", ""];
  h2.forEach((h, i) => {
    ws.getCell(r, i + 1).value = h;
    sc(ws.getCell(r, i + 1), { font: FONT_H, fill: HEADER_FILL, align: { horizontal: "center", wrapText: true }, border: THIN_BORDER });
  });
  r++;

  const dataRows = [];

  for (const sec of data.sections) {
    ws.mergeCells(r, 1, r, 9);
    ws.getCell(r, 1).value = sec.name;
    sc(ws.getCell(r, 1), { font: FONT_SC, fill: SECTION_FILL, align: { horizontal: "left" }, border: THIN_BORDER });
    for (let c = 1; c <= 9; c++) sc(ws.getCell(r, c), { fill: SECTION_FILL, border: THIN_BORDER });
    r++;

    for (const pos of sec.positions) {
      dataRows.push(r);
      const hasM = pos.materials && pos.materials.length > 0 && matMap[pos.num];

      ws.getCell(r, 1).value = pos.num;
      sc(ws.getCell(r, 1), { font: FONT_D, align: { horizontal: "center" }, border: THIN_BORDER });
      ws.getCell(r, 2).value = pos.name;
      sc(ws.getCell(r, 2), { font: FONT_D, align: { horizontal: "left", wrapText: true }, border: THIN_BORDER });
      ws.getCell(r, 3).value = pos.unit;
      sc(ws.getCell(r, 3), { font: FONT_D, align: { horizontal: "center" }, border: THIN_BORDER });
      ws.getCell(r, 4).value = pos.qty;
      sc(ws.getCell(r, 4), { font: FONT_D, align: { horizontal: "center" }, border: THIN_BORDER, numFmt: "#,##0.00" });

      if (hasM) {
        const msr = matMap[pos.num];
        ws.getCell(r, 5).value = { formula: `IF(D${r}>0,'Материалы'!F${msr}/D${r},0)` };
      } else {
        ws.getCell(r, 5).value = 0;
      }
      sc(ws.getCell(r, 5), { font: FONT_D, align: { horizontal: "right" }, border: THIN_BORDER, numFmt: "#,##0.00" });

      ws.getCell(r, 6).value = { formula: `ROUND(D${r}*E${r},2)` };
      sc(ws.getCell(r, 6), { font: FONT_D, align: { horizontal: "right" }, border: THIN_BORDER, numFmt: "#,##0.00" });

      ws.getCell(r, 7).value = pos.work_rate;
      sc(ws.getCell(r, 7), { font: FONT_D, align: { horizontal: "right" }, border: THIN_BORDER, numFmt: "#,##0" });

      ws.getCell(r, 8).value = { formula: `ROUND(D${r}*G${r},2)` };
      sc(ws.getCell(r, 8), { font: FONT_D, align: { horizontal: "right" }, border: THIN_BORDER, numFmt: "#,##0.00" });

      ws.getCell(r, 9).value = { formula: `F${r}+H${r}` };
      sc(ws.getCell(r, 9), { font: FONT_DB, align: { horizontal: "right" }, border: THIN_BORDER, numFmt: "#,##0.00" });
      r++;
    }
  }

  // ИТОГО
  r++;
  const itogo = r;
  ws.mergeCells(r, 1, r, 3);
  ws.getCell(r, 1).value = "ИТОГО (без НДС):";
  sc(ws.getCell(r, 1), { font: FONT_TL, fill: TOTAL_FILL, align: { horizontal: "left" }, border: THIN_BORDER });
  ws.getCell(r, 6).value = { formula: dataRows.map((d) => `F${d}`).join("+") };
  ws.getCell(r, 8).value = { formula: dataRows.map((d) => `H${d}`).join("+") };
  ws.getCell(r, 9).value = { formula: dataRows.map((d) => `I${d}`).join("+") };
  for (const c of [6, 8, 9]) sc(ws.getCell(r, c), { font: FONT_TL, fill: TOTAL_FILL, align: { horizontal: "right" }, border: THIN_BORDER, numFmt: "#,##0.00" });
  r++;

  // НДС
  const nds = r;
  ws.getCell(r, 1).value = "НДС 22%";
  sc(ws.getCell(r, 1), { font: FONT_DB, border: THIN_BORDER });
  ws.getCell(r, 9).value = { formula: `ROUND(I${itogo}*${meta.vat_rate || 0.22},0)` };
  sc(ws.getCell(r, 9), { font: FONT_DB, fill: VAT_FILL, align: { horizontal: "right" }, border: THIN_BORDER, numFmt: "#,##0" });
  r++;

  // ИТОГО с НДС
  const tot = r;
  ws.mergeCells(r, 1, r, 7);
  ws.getCell(r, 1).value = "ИТОГО с НДС 22%";
  sc(ws.getCell(r, 1), { font: FONT_TL, fill: TOTAL_FILL, align: { horizontal: "left" }, border: THIN_BORDER });
  ws.getCell(r, 9).value = { formula: `I${itogo}+I${nds}` };
  sc(ws.getCell(r, 9), { font: FONT_TL, fill: TOTAL_FILL, align: { horizontal: "right" }, border: THIN_BORDER, numFmt: "#,##0.00" });

  // Summary
  ws.getCell(sumStart, 9).value = { formula: `I${tot}` };
  ws.getCell(sumStart + 1, 9).value = { formula: `I${nds}` };
  ws.getCell(sumStart + 2, 9).value = { formula: `I${itogo}` };
}


// =============================================
// ЛИСТ: ВОР
// =============================================
function buildVor(wb, data) {
  const ws = wb.addWorksheet("ВОР");
  ws.columns = [{ width: 8 }, { width: 58 }, { width: 10 }, { width: 10 }, { width: 42 }];

  let r = 1;
  ws.mergeCells(r, 1, r, 5);
  ws.getCell(r, 1).value = (data.meta.title || "").replace("СМЕТА", "ВЕДОМОСТЬ ОБЪЁМОВ РАБОТ");
  sc(ws.getCell(r, 1), { font: FONT_T, align: { horizontal: "center" } });
  r += 2;
  hdrRow(ws, r, ["№", "Наименование работ", "Ед.", "Кол-во", "Примечание"]);
  r++;

  for (const sec of data.sections) {
    ws.mergeCells(r, 1, r, 5);
    ws.getCell(r, 1).value = sec.name;
    sc(ws.getCell(r, 1), { font: FONT_SC, fill: SECTION_FILL, align: { horizontal: "left" }, border: THIN_BORDER });
    for (let c = 1; c <= 5; c++) sc(ws.getCell(r, c), { fill: SECTION_FILL, border: THIN_BORDER });
    r++;
    for (const pos of sec.positions) {
      ws.getCell(r, 1).value = pos.num; sc(ws.getCell(r, 1), { font: FONT_D, align: { horizontal: "center" }, border: THIN_BORDER });
      ws.getCell(r, 2).value = pos.name; sc(ws.getCell(r, 2), { font: FONT_D, align: { horizontal: "left", wrapText: true }, border: THIN_BORDER });
      ws.getCell(r, 3).value = pos.unit; sc(ws.getCell(r, 3), { font: FONT_D, align: { horizontal: "center" }, border: THIN_BORDER });
      ws.getCell(r, 4).value = pos.qty; sc(ws.getCell(r, 4), { font: FONT_D, align: { horizontal: "center" }, border: THIN_BORDER, numFmt: "#,##0.00" });
      ws.getCell(r, 5).value = pos.vor_note || ""; sc(ws.getCell(r, 5), { font: FONT_SM, align: { horizontal: "left" }, border: THIN_BORDER });
      r++;
    }
  }
}


// =============================================
// ЛИСТ: РАСЧЁТ ПЛОЩАДЕЙ
// =============================================
function buildAreas(wb, data) {
  const ws = wb.addWorksheet("Расчёт площадей");
  ws.columns = [{ width: 25 }, { width: 32 }, { width: 10 }, { width: 10 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 38 }];

  let r = 1;
  ws.mergeCells(r, 1, r, 8);
  ws.getCell(r, 1).value = `РАСЧЁТ ПЛОЩАДЕЙ • ${data.meta.subtitle || ""}`;
  sc(ws.getCell(r, 1), { font: FONT_T, align: { horizontal: "center" } });
  r += 2;
  hdrRow(ws, r, ["Помещение", "Поверхность", "Длина", "Выс/Ш", "Брутто", "Вычеты", "Нетто", "Примечание"]);
  r++;

  for (const room of data.rooms || []) {
    ws.mergeCells(r, 1, r, 8);
    ws.getCell(r, 1).value = room.name;
    sc(ws.getCell(r, 1), { font: FONT_SC, fill: SECTION_FILL, align: { horizontal: "left" }, border: THIN_BORDER });
    for (let c = 1; c <= 8; c++) sc(ws.getCell(r, c), { fill: SECTION_FILL, border: THIN_BORDER });
    r++;
    let first = true;
    for (const s of room.surfaces) {
      ws.getCell(r, 1).value = first ? room.name.split("(")[0].trim() : "";
      sc(ws.getCell(r, 1), { font: FONT_D, align: { horizontal: "left" }, border: THIN_BORDER });
      ws.getCell(r, 2).value = s.surface; sc(ws.getCell(r, 2), { font: FONT_D, border: THIN_BORDER });
      ws.getCell(r, 3).value = s.length; sc(ws.getCell(r, 3), { font: FONT_D, align: { horizontal: "center" }, border: THIN_BORDER, numFmt: "#,##0.00" });
      ws.getCell(r, 4).value = s.height_or_width; sc(ws.getCell(r, 4), { font: FONT_D, align: { horizontal: "center" }, border: THIN_BORDER, numFmt: "#,##0.00" });
      ws.getCell(r, 5).value = s.gross; sc(ws.getCell(r, 5), { font: FONT_D, align: { horizontal: "center" }, border: THIN_BORDER, numFmt: "#,##0.00" });
      ws.getCell(r, 6).value = s.deductions; sc(ws.getCell(r, 6), { font: FONT_D, align: { horizontal: "center" }, border: THIN_BORDER, numFmt: "#,##0.00" });
      ws.getCell(r, 7).value = s.net; sc(ws.getCell(r, 7), { font: FONT_D, align: { horizontal: "center" }, border: THIN_BORDER, numFmt: "#,##0.00" });
      ws.getCell(r, 8).value = s.note || ""; sc(ws.getCell(r, 8), { font: FONT_SM, border: THIN_BORDER });
      first = false;
      r++;
    }
  }
}


/**
 * Генерация Excel-файла из JSON.
 * @param {Object} data - JSON-данные сметы
 * @returns {Buffer} xlsx файл
 */
async function generateExcel(data) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "НейроСмета";
  wb.created = new Date();

  // 1. Materials first (to get row map)
  const matMap = buildMaterials(wb, data);

  // 2. Smeta (uses matMap)
  buildSmeta(wb, data, matMap);

  // 3. VOR
  buildVor(wb, data);

  // 4. Areas
  buildAreas(wb, data);

  // Reorder: СМЕТА, ВОР, Материалы, Расчёт площадей
  const order = ["СМЕТА", "ВОР", "Материалы", "Расчёт площадей"];
  // ExcelJS doesn't have move_sheet, but worksheets are ordered by creation
  // We created: Материалы(0), СМЕТА(1), ВОР(2), Расчёт(3)
  // Need: СМЕТА(0), ВОР(1), Материалы(2), Расчёт(3)
  // Swap positions
  const sheets = wb.worksheets;
  const matSheet = sheets[0]; // Материалы
  const smetaSheet = sheets[1]; // СМЕТА
  // Reorder by setting orderNo
  smetaSheet.orderNo = 0;
  matSheet.orderNo = 2;

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

module.exports = { generateExcel };
