// ============================================================
// РАЗБОР СЧЁТА: вытаскиваем из текста PDF номер, дату, сумму,
// поставщика и признак НДС.
//
// Работает с «текстовыми» PDF — такими, какие выдают 1С, СБИС,
// Диадок, интернет-магазины. Со сканом или фотографией не работает:
// там текста нет, одни пиксели, и разбирать нечего.
//
// Всё, что разобрали, ПОДСТАВЛЯЕТСЯ В ФОРМУ, а не сохраняется молча:
// последнее слово за человеком. Ошибиться разбор может, и цена ошибки
// в расходах высокая.
// ============================================================

const RU_MONTHS = {
  "января": 1, "февраля": 2, "марта": 3, "апреля": 4, "мая": 5, "июня": 6,
  "июля": 7, "августа": 8, "сентября": 9, "октября": 10, "ноября": 11, "декабря": 12,
  "январь": 1, "февраль": 2, "март": 3, "апрель": 4, "май": 5, "июнь": 6,
  "июль": 7, "август": 8, "сентябрь": 9, "октябрь": 10, "ноябрь": 11, "декабрь": 12,
};

// Пробелы в суммах бывают разные: обычный, неразрывный, узкий неразрывный.
// Приводим всё к одному виду, иначе «48 000,00» не разберётся.
function invNormSpaces(s) {
  return String(s || "").replace(/[    ]/g, " ");
}

// «48 000,00» / «48000.00» / «48 000-00» -> 48000
function invParseMoney(raw) {
  if (raw == null) return null;
  let s = invNormSpaces(raw).trim();
  s = s.replace(/руб\.?|р\.|₽/gi, "").trim();
  // отделяем копейки: последняя запятая/точка/дефис перед ровно двумя цифрами
  const m = s.match(/^([\d\s]+?)(?:[.,-](\d{2}))?$/);
  if (!m) return null;
  const whole = m[1].replace(/\s/g, "");
  if (!whole || !/^\d+$/.test(whole)) return null;
  const kop = m[2] ? Number(m[2]) : 0;
  const val = Number(whole) + kop / 100;
  return Number.isFinite(val) ? val : null;
}

// Ищем число после метки. Метка и число могут быть разделены двоеточием,
// пробелами, точками-заполнителями («Итого:......48 000,00») или переносом
// строки — в PDF колонки часто съезжают на следующую строку.
// Буквы, которые могут стоять вплотную к метке. \b в JavaScript считает
// словом только латиницу, поэтому для «Итого» и «Всего» он бесполезен —
// границы задаём явными классами.
const INV_LETTER = "А-Яа-яЁёA-Za-z";

// Все совпадения метки — берём последнее: в счёте «Всего к оплате»
// может встретиться и в шапке таблицы, и внизу под итогом.
function invFindAllAfterLabel(text, labelRe) {
  const re = new RegExp(
    labelRe.source + "[^0-9\\-]{0,40}?((?:\\d[\\d \\u00a0\\u202f]*)(?:[.,-]\\d{2})?)",
    "gim"
  );
  const t = invNormSpaces(text);
  const out = [];
  let m;
  while ((m = re.exec(t)) !== null) {
    const v = invParseMoney(m[1]);
    if (v != null && v > 0) out.push(v);
  }
  return out;
}

function invParseAmount(text) {
  // Порядок важен: «Итого» в счёте с НДС — это сумма БЕЗ налога,
  // а платить надо «Всего к оплате». Сначала самые однозначные метки.
  const B = "(?:^|[^" + INV_LETTER + "])";   // начало строки или не-буква перед меткой
  const ladder = [
    new RegExp(B + "всего\\s*к\\s*оплате"),
    new RegExp(B + "итого\\s*к\\s*оплате"),
    new RegExp(B + "сумма\\s*к\\s*оплате"),
    new RegExp(B + "к\\s*оплате"),
    new RegExp(B + "всего\\s*наименований[^.]{0,60}?на\\s*сумму"),
    new RegExp(B + "на\\s*сумму"),
    // «Всего» без «наименований» — иначе зацепим количество позиций
    new RegExp(B + "всего(?!\\s*наименований)"),
    new RegExp(B + "итого"),
  ];
  for (const re of ladder) {
    const all = invFindAllAfterLabel(text, re);
    if (all.length) return all[all.length - 1];
  }
  return null;
}

function invParseNumber(text) {
  const t = invNormSpaces(text);
  // «Счет на оплату № 1542», «Счёт №1542», «СЧЕТ N 1542»
  const m = t.match(/сч[ёе]т\s*(?:на\s*оплату)?\s*(?:№|N|#)\s*([A-Za-zА-Яа-я0-9][A-Za-zА-Яа-я0-9\-\/_]*)/i);
  return m ? m[1].replace(/[.,;]+$/, "") : null;
}

function invParseDate(text) {
  const t = invNormSpaces(text);
  const pad = (n) => String(n).padStart(2, "0");
  // «от 10 ноября 2026 г.»
  let m = t.match(/от\s+(\d{1,2})\s+([А-Яа-яёЁ]+)\s+(\d{4})/i);
  if (m) {
    const mon = RU_MONTHS[m[2].toLowerCase()];
    if (mon) return `${m[3]}-${pad(mon)}-${pad(m[1])}`;
  }
  // «от 10.11.2026» или «от 10/11/2026»
  m = t.match(/от\s+(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})/);
  if (m) {
    let y = m[3];
    if (y.length === 2) y = "20" + y;
    const mon = Number(m[2]), day = Number(m[1]);
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) return `${y}-${pad(mon)}-${pad(day)}`;
  }
  return null;
}

function invParseSupplier(text) {
  const t = invNormSpaces(text);
  // «Поставщик (Исполнитель): ООО «Автодеталь», ИНН 5401234567, ...»
  const m = t.match(/поставщик[^:]{0,40}:\s*([^\n\r]+)/i);
  if (!m) return null;
  let s = m[1].trim();
  // отрезаем всё начиная с ИНН/КПП/адреса — нужно только название
  s = s.split(/[,;]?\s*(?:ИНН|КПП)(?![А-Яа-яЁёA-Za-z])/i)[0];
  s = s.replace(/[,;]\s*$/, "").trim();
  if (s.length < 2 || s.length > 120) return null;
  return s;
}

function invParseVat(text) {
  const t = invNormSpaces(text).toLowerCase();
  if (/без\s*(?:налога|ндс)|ндс\s*не\s*облагается|не\s*облагается\s*ндс|без\s*ндс/.test(t)) return false;
  if (/в\s*т(?:ом)?\.?\s*ч(?:исле)?\.?\s*ндс|сумма\s*ндс|ндс\s*\d{1,2}\s*%|\bндс\b/.test(t)) return true;
  return null; // не поняли — не трогаем галочку
}

// Главная функция: отдаёт то, что удалось разобрать.
// Ничего не выдумывает: чего не нашли — того в ответе нет.
function parseInvoiceText(text) {
  const t = String(text || "");
  const hasText = t.replace(/\s/g, "").length >= 20;
  return {
    hasText,
    amount: hasText ? invParseAmount(t) : null,
    invoiceNumber: hasText ? invParseNumber(t) : null,
    date: hasText ? invParseDate(t) : null,
    supplier: hasText ? invParseSupplier(t) : null,
    vat: hasText ? invParseVat(t) : null,
  };
}

// ---------- чтение текста из PDF ----------
// pdf.js подключаем лениво, только когда руководитель выбрал PDF:
// библиотека около мегабайта, и водителям, которые расходы не видят,
// тащить её в кэш незачем.
const PDFJS_SRC = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js";
const PDFJS_WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
let pdfjsLoading = null;

function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (pdfjsLoading) return pdfjsLoading;
  pdfjsLoading = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = PDFJS_SRC;
    s.onload = () => {
      if (!window.pdfjsLib) return reject(new Error("pdf.js не загрузился"));
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      resolve(window.pdfjsLib);
    };
    s.onerror = () => reject(new Error("не удалось загрузить разборщик PDF"));
    document.head.appendChild(s);
  });
  return pdfjsLoading;
}

// Читает текстовый слой PDF. Страниц берём не больше четырёх:
// счёт всегда в начале, а многостраничные приложения только замедлят.
async function readPdfText(file) {
  const pdfjsLib = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const pages = Math.min(pdf.numPages, 4);
  let out = "";
  for (let i = 1; i <= pages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    // Склеиваем по строкам: ориентируемся на координату Y, иначе
    // «Всего к оплате» и сумма из соседней колонки слипнутся с чужими.
    const lines = {};
    content.items.forEach((it) => {
      if (!it.str) return;
      const y = Math.round(it.transform[5]);
      (lines[y] = lines[y] || []).push(it.str);
    });
    out += Object.keys(lines)
      .sort((a, b) => Number(b) - Number(a))
      .map((y) => lines[y].join(" "))
      .join("\n") + "\n";
  }
  return out;
}

// Разбирает файл счёта. Всегда возвращает объект, никогда не бросает:
// не разобралось — значит просто заполнят руками.
async function parseInvoiceFile(file) {
  try {
    if (!/pdf/i.test(file.type || "") && !/\.pdf$/i.test(file.name || "")) {
      return { ok: false, reason: "not-pdf" };
    }
    const text = await readPdfText(file);
    const parsed = parseInvoiceText(text);
    if (!parsed.hasText) return { ok: false, reason: "no-text" };
    return { ok: true, ...parsed };
  } catch (e) {
    return { ok: false, reason: "error", message: e && e.message };
  }
}
