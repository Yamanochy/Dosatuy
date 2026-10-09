// ============================================================
// EXCEL: оформленный лист — тот же вид, что у реестра перевозок
// в Досатуе: заголовок по центру, тёмно-синяя шапка таблицы, тонкие
// границы, «зебра», жирная строка ИТОГО, место под подписи.
//
// Один и тот же файл лежит в «Смене», Табеле и Досатуе, чтобы все
// выгрузки выглядели одинаково. Правишь оформление — поправь во всех
// трёх (файл целиком одинаковый, его можно просто скопировать).
//
// Нужна библиотека xlsx-js-style (обычная xlsx оформление не пишет).
//
// Как пользоваться:
//   const ws = xlBuildSheet({
//     title: "РЕЕСТР ПУТЕВЫХ ЛИСТОВ",
//     subtitle: "Спецтехника · Новосибирск",        // необязательно
//     lines: ["Период: 01.10.2026 — 15.10.2026"],     // строки под заголовком
//     columns: [
//       { title: "№", width: 5, align: "center" },
//       { title: "Водитель", width: 28 },
//       { title: "Часы", width: 9, align: "right", numFmt: "0.0" },
//     ],
//     rows: [[1, "Иванов И. И.", 10], ...],
//     total: { label: "ИТОГО: 2 путевых листа", span: 2, values: { 2: 18 } },
//     signatures: [{ label: "Реестр составил", name: "" }],   // необязательно
//   });
//   const wb = XLSX.utils.book_new();
//   xlAppendSheet(wb, ws, "Реестр", { landscape: true });   // альбомный лист
//   xlSaveFile(wb, "Реестр.xlsx");
//
// xlSaveFile дописывает в файл настройки печати: лист А4, вся таблица
// по ширине на одной странице, шапка повторяется на каждой странице.
// Сама библиотека этого не умеет, поэтому готовый файл правится на лету;
// если правка почему-то не удалась, файл всё равно скачается — просто
// без настроек печати.
// ============================================================

// Цвет в файле Excel по стандарту пишется восемью знаками: «FF» (непрозрачный)
// и шесть знаков самого цвета. Шестизначный Excel тоже понимает, но строгая
// проверка файла по схеме формата его не пропускает — пишем как положено.
const xlsColor = (hex) => ({ rgb: "FF" + hex });
const XLS_NAVY = "14213D";
const XLS_LINE = { style: "thin", color: xlsColor("9AA4B2") };
const XLS_BOX = { top: XLS_LINE, bottom: XLS_LINE, left: XLS_LINE, right: XLS_LINE };

function xlsStyle(ws, r1, c1, r2, c2, styleFn) {
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      const a = XLSX.utils.encode_cell({ r, c });
      if (!ws[a]) ws[a] = { t: "s", v: "" };
      ws[a].s = Object.assign({}, ws[a].s, styleFn(r, c));
    }
  }
}

function xlBuildSheet(spec) {
  const cols = spec.columns;
  const n = cols.length;
  const last = n - 1;
  const blank = () => new Array(n).fill("");
  const aoa = [];
  const merges = [];
  const rowHeights = [];
  const fullRow = (text, height) => {
    const row = blank(); row[0] = text;
    merges.push({ s: { r: aoa.length, c: 0 }, e: { r: aoa.length, c: last } });
    rowHeights[aoa.length] = { hpt: height };
    aoa.push(row);
    return aoa.length - 1;
  };

  const titleRow = fullRow(spec.title || "", 24);
  const subtitleRow = spec.subtitle ? fullRow(spec.subtitle, 15) : -1;
  const lineRows = (spec.lines || []).filter(Boolean).map((t) => fullRow(t, 15));
  rowHeights[aoa.length] = { hpt: 6 };
  aoa.push(blank());

  const headerRow = aoa.length;
  rowHeights[headerRow] = { hpt: 30 };
  aoa.push(cols.map((c) => c.title));
  const firstData = aoa.length;
  (spec.rows || []).forEach((r) => {
    const row = blank();
    r.forEach((v, i) => { if (i < n) row[i] = (v === null || v === undefined) ? "" : v; });
    aoa.push(row);
  });
  const lastData = aoa.length - 1;

  let totalRow = -1;
  if (spec.total) {
    totalRow = aoa.length;
    const row = blank();
    row[0] = spec.total.label || "ИТОГО";
    Object.keys(spec.total.values || {}).forEach((k) => { row[Number(k)] = spec.total.values[k]; });
    aoa.push(row);
    const span = Math.min(Math.max(1, spec.total.span || 1), n);
    if (span > 1) merges.push({ s: { r: totalRow, c: 0 }, e: { r: totalRow, c: span - 1 } });
  }

  // подписи: слева — кто, посередине — черта под подпись, справа — расшифровка
  const sigRows = [];
  const sigs = spec.signatures || [];
  const L = Math.min(2, Math.max(0, n - 3));                 // подпись «кто» занимает колонки 0..L
  const M = L + Math.max(1, Math.floor((last - L) / 2));     // черта под подпись: L+1..M, имя: M+1..last
  if (sigs.length) {
    aoa.push(blank());
    sigs.forEach((s) => {
      aoa.push(blank());
      const r = aoa.length;
      const row = blank(); row[0] = s.label || ""; if (M + 1 <= last) row[M + 1] = s.name || "";
      aoa.push(row);
      const cap = blank(); cap[L + 1] = "(подпись)"; if (M + 1 <= last) cap[M + 1] = "(расшифровка подписи)";
      aoa.push(cap);
      if (L > 0) merges.push({ s: { r, c: 0 }, e: { r, c: L } });
      if (M > L + 1) { merges.push({ s: { r, c: L + 1 }, e: { r, c: M } }); merges.push({ s: { r: r + 1, c: L + 1 }, e: { r: r + 1, c: M } }); }
      if (last > M + 1) { merges.push({ s: { r, c: M + 1 }, e: { r, c: last } }); merges.push({ s: { r: r + 1, c: M + 1 }, e: { r: r + 1, c: last } }); }
      rowHeights[r] = { hpt: 22 };
      sigRows.push(r);
    });
  }
  let footRow = -1;
  if (spec.footnote) {
    aoa.push(blank());
    footRow = fullRow(spec.footnote, 14);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!margins"] = { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 };
  ws["!xlHeaderRow"] = headerRow; // строка шапки — чтобы повторять её на каждой печатной странице
  ws["!cols"] = cols.map((c) => ({ wch: c.width || 12 }));
  ws["!rows"] = Array.from({ length: aoa.length }, (_, i) => rowHeights[i] || {});
  ws["!merges"] = merges;

  // заголовок документа
  xlsStyle(ws, titleRow, 0, titleRow, last, () => ({
    font: { bold: true, sz: 16, name: "Arial", color: xlsColor(XLS_NAVY) },
    alignment: { horizontal: "center", vertical: "center" },
  }));
  if (subtitleRow >= 0) xlsStyle(ws, subtitleRow, 0, subtitleRow, last, () => ({
    font: { sz: 10, italic: true, name: "Arial", color: xlsColor("64748B") },
    alignment: { horizontal: "center" },
  }));
  lineRows.forEach((r) => xlsStyle(ws, r, 0, r, last, () => ({
    font: { sz: 11, bold: true, name: "Arial", color: xlsColor("1F2937") },
    alignment: { horizontal: "center" },
  })));

  // шапка таблицы
  xlsStyle(ws, headerRow, 0, headerRow, last, () => ({
    font: { bold: true, sz: 10, color: xlsColor("FFFFFF"), name: "Arial" },
    fill: { patternType: "solid", fgColor: xlsColor(XLS_NAVY) },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
    border: XLS_BOX,
  }));

  // данные: границы, «зебра», выравнивание и формат по колонкам
  if (lastData >= firstData) {
    xlsStyle(ws, firstData, 0, lastData, last, (r, c) => {
      const col = cols[c];
      const st = {
        font: { sz: 10, name: "Arial" },
        alignment: { vertical: "center", horizontal: col.align || "left", wrapText: !!col.wrap },
        border: XLS_BOX,
      };
      if ((r - firstData) % 2 === 1) st.fill = { patternType: "solid", fgColor: xlsColor("F7F8FA") };
      if (col.numFmt) st.numFmt = col.numFmt;
      return st;
    });
  }

  // строка ИТОГО
  if (totalRow >= 0) {
    xlsStyle(ws, totalRow, 0, totalRow, last, (r, c) => {
      const col = cols[c];
      const st = {
        font: { bold: true, sz: 11, name: "Arial", color: xlsColor(XLS_NAVY) },
        fill: { patternType: "solid", fgColor: xlsColor("EEF0F3") },
        border: { top: { style: "medium", color: xlsColor(XLS_NAVY) }, bottom: XLS_LINE, left: XLS_LINE, right: XLS_LINE },
        alignment: { vertical: "center", horizontal: c === 0 ? "left" : (col.align || "left") },
      };
      if (col.numFmt && c !== 0) st.numFmt = col.numFmt;
      return st;
    });
    rowHeights[totalRow] = { hpt: 20 };
    ws["!rows"][totalRow] = { hpt: 20 };
  }

  // подписи
  sigRows.forEach((r) => {
    xlsStyle(ws, r, 0, r, L, () => ({ font: { bold: true, sz: 11, name: "Arial" }, alignment: { vertical: "bottom", wrapText: true } }));
    xlsStyle(ws, r, L + 1, r, last, () => ({
      font: { sz: 11, name: "Arial" },
      alignment: { horizontal: "center", vertical: "bottom" },
      border: { bottom: { style: "thin", color: xlsColor("1F2937") } },
    }));
    xlsStyle(ws, r + 1, L + 1, r + 1, last, () => ({
      font: { sz: 8, italic: true, name: "Arial", color: xlsColor("94A3B8") },
      alignment: { horizontal: "center", vertical: "top" },
    }));
  });
  if (footRow >= 0) xlsStyle(ws, footRow, 0, footRow, last, () => ({
    font: { sz: 9, italic: true, name: "Arial", color: xlsColor("64748B") },
    alignment: { horizontal: "left" },
  }));

  return ws;
}

// Добавить лист в книгу. opts.landscape — печатать в альбомной ориентации
// (для широких таблиц); без него — в книжной.
function xlAppendSheet(wb, ws, name, opts) {
  XLSX.utils.book_append_sheet(wb, ws, name);
  const index = wb.SheetNames.length - 1;
  if (!wb.xlPrint) wb.xlPrint = [];
  wb.xlPrint[index] = { landscape: !!(opts && opts.landscape) };
  // шапка таблицы — на каждой печатной странице
  if (typeof ws["!xlHeaderRow"] === "number") {
    if (!wb.Workbook) wb.Workbook = {};
    if (!wb.Workbook.Names) wb.Workbook.Names = [];
    const row = ws["!xlHeaderRow"] + 1;
    wb.Workbook.Names.push({ Name: "_xlnm.Print_Titles", Sheet: index, Ref: "'" + String(name).replace(/'/g, "''") + "'!$" + row + ":$" + row });
  }
}

// Вписать в готовый файл настройки печати каждого листа.
// На входе и на выходе — содержимое файла .xlsx (байты).
function xlAddPrintSetup(bytes, printBySheet) {
  const zip = XLSX.CFB.read(bytes, { type: "array" });
  const dec = new TextDecoder("utf-8"), enc = new TextEncoder();
  zip.FullPaths.forEach((path, i) => {
    const m = /xl\/worksheets\/sheet(\d+)\.xml$/.exec(path);
    if (!m) return;
    const file = zip.FileIndex[i];
    let xml = dec.decode(file.content instanceof Uint8Array ? file.content : new Uint8Array(file.content));
    if (xml.indexOf("<pageSetup") >= 0 || xml.indexOf("<pageMargins") < 0) return;
    const p = (printBySheet && printBySheet[Number(m[1]) - 1]) || {};
    // порядок частей в файле Excel строгий: sheetPr — первым, printOptions —
    // перед полями, pageSetup — сразу после полей
    xml = xml.replace(/<pageMargins[^>]*\/>/, (margins) =>
      '<printOptions horizontalCentered="1"/>' + margins
      + '<pageSetup paperSize="9" orientation="' + (p.landscape ? "landscape" : "portrait") + '" fitToWidth="1" fitToHeight="0"/>');
    if (xml.indexOf("<sheetPr") < 0) xml = xml.replace(/<worksheet[^>]*>/, (open) => open + '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
    file.content = enc.encode(xml);
    file.size = file.content.length;
  });
  return XLSX.CFB.write(zip, { fileType: "zip", type: "array" });
}

// Скачать книгу файлом .xlsx
function xlSaveFile(wb, fileName) {
  let bytes = null;
  try {
    const raw = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    bytes = xlAddPrintSetup(new Uint8Array(raw), wb.xlPrint);
  } catch (e) {
    console.warn("Настройки печати не добавлены, файл сохраняется без них", e);
  }
  if (!bytes) { XLSX.writeFile(wb, fileName); return; }
  const blob = new Blob([bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

// «12 путевых листов»: 1 лист, 2–4 листа, 5+ листов
function xlPlural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

// имя файла без символов, которые не любят телефоны и Windows
function xlFileName(parts) {
  return parts.filter(Boolean).map((p) => String(p).replace(/[\\/:*?"<>|«»]+/g, "").trim().replace(/\s+/g, "_")).join("_") + ".xlsx";
}
