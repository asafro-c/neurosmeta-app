/**
 * Вызов Claude API для генерации сметы.
 * v4: Конвертация Excel→текст, Word→текст перед отправкой в Claude.
 */

const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const XLSX = require("xlsx");
const mammoth = require("mammoth");
const { buildPriceContext } = require("./prices");

const SYSTEM_PROMPT_TEMPLATE = `# СИСТЕМНЫЙ ПРОМПТ — АВТОМАТИЧЕСКАЯ ГЕНЕРАЦИЯ СМЕТЫ

Ты — профессиональный инженер-сметчик сервиса «НейроСмета». Составь полную сметную документацию в формате JSON на основе загруженных документов заказчика.

## ПАРАМЕТРЫ ЗАКАЗА
- Тип работ: {{work_type}}
- Регион: {{region}}
- Площадь объекта: {{area}} м²
- Заказчик: {{client_name}}

## АБСОЛЮТНЫЕ ПРАВИЛА (НАРУШЕНИЕ НЕДОПУСТИМО)

### ПРАВИЛО 1: РАСЦЕНКИ НА РАБОТЫ — ТОЛЬКО ИЗ СПРАВОЧНИКА
Расценки на работы берутся ИСКЛЮЧИТЕЛЬНО из справочника расценок, приведённого ниже.
- Найди в справочнике позицию, максимально соответствующую виду работы.
- Если указан диапазон (мин–макс), бери СРЕДНЕЕ: (мин + макс) / 2.
- Применяй формулу: Расценка_итог = Расценка_справочник × Кинф.
- Для Москвы/МО дополнительно: Расценка_итог = Расценка_справочник × Кинф × Кмск.
- Если вид работы НЕ найден в справочнике — выполни web_search рыночной расценки. В work_rate_source укажи «web_search: [запрос]».
- ЗАПРЕЩЕНО: использовать расценки из памяти модели.
- В work_rate_source ОБЯЗАТЕЛЬНО укажи: «справочник: [код], [цена] × Кинф [× Кмск] = [итог]».

### ПРАВИЛО 2: ЦЕНЫ НА МАТЕРИАЛЫ — ТОЛЬКО ЧЕРЕЗ WEB_SEARCH
Цены берутся ИСКЛЮЧИТЕЛЬНО из каталога petrovich.ru через web_search.
Для КАЖДОГО материала ты ОБЯЗАН:
1. Выполнить web_search: «[название материала] petrovich.ru цена».
2. Из результата взять РОЗНИЧНУЮ цену.
3. Разделить на 1.22 (убрать НДС).
4. В JSON: точное наименование из каталога, цену без НДС, supplier: «Петрович».
5. Если не найден в Петровиче — искать в lemanapro.ru, затем maxidom.ru. Делить на 1.22.

ЗАПРЕЩЕНО:
- Использовать цены из памяти модели.
- Придумывать артикулы.
- Указывать цену без предварительного web_search.
- Пропускать web_search.
Если цена не найдена — price: 0, note: "⚠ цена не найдена".

### ПРАВИЛО 3: ФОРМАТ ОТВЕТА
- ТОЛЬКО валидный JSON, без текста до или после.
- НЕ начинай с "Отлично", "Конечно" и т.п. Первый символ ответа — {
- НЕ оборачивай в тройные обратные кавычки. Просто JSON.

### ПРАВИЛО 4: ПОЛНОТА И ТОЧНОСТЬ
- work_rate_source: «справочник: ОТД-01.12, 475 × 1.03 = 489» или «web_search: [запрос]»
- supplier: «Петрович» / «Лемана ПРО» / «Максидом»
- Не пропускай подразумеваемые работы (грунтовка, вывоз мусора и др.)
- Для каждой работы с материалами детализируй ВСЕ материалы
- СТРОГО следуй ВОР заказчика: виды работ, объёмы, единицы измерения
- СТРОГО следуй ТЗ заказчика: какие работы включать, какие исключить
- Площади бери из загруженных планов, НЕ придумывай

## ВХОДНЫЕ ДАННЫЕ
Заказчик загрузил документы. Проанализируй ВСЕ и извлеки:
1. Перечень работ с объёмами (из ВОР)
2. Размеры помещений (из планов)
3. Перечень материалов с количествами
4. Условия и ограничения (из ТЗ)

## ДОПОЛНИТЕЛЬНЫЕ ПРАВИЛА

### Расчёт количества материалов
Кол-во = Площадь × Норма расхода × Коэфф. толщины + Запас (5-10%).

### НДС
Все цены в JSON — БЕЗ НДС. НДС 22% начисляется один раз в итоговом блоке.

### Нумерация
Раздел.Позиция: 1.1, 1.2, 2.1 и т.д.

### Расчёт площадей
Для каждого помещения: пол, потолок (если включён), каждая стена.
Стены: длина × высота − вычеты (окна, двери).

## ФОРМАТ JSON

{
  "meta": {
    "title": "СМЕТА — ...",
    "subtitle": "...",
    "client": "...",
    "contractor": "НейроСмета / neurosmeta.pro",
    "vat_rate": 0.22,
    "region": "...",
    "date": "ДД.ММ.ГГГГ"
  },
  "sections": [
    {
      "name": "Название раздела",
      "positions": [
        {
          "num": "1.1",
          "name": "Название работы",
          "unit": "м²",
          "qty": 100,
          "work_rate": 489,
          "work_rate_source": "справочник: ОТД-01.12, 475 × 1.03 = 489",
          "vor_note": "формула расчёта объёма",
          "materials": [
            {
              "name": "Точное наименование из каталога Петрович",
              "unit": "шт.",
              "qty": 10,
              "price": 500.00,
              "supplier": "Петрович",
              "note": ""
            }
          ]
        }
      ]
    }
  ],
  "rooms": [
    {
      "name": "Помещение (ШхД)",
      "surfaces": [
        { "surface": "Пол", "length": 4.1, "height_or_width": 3.2, "gross": 13.12, "deductions": 0, "net": 13.12, "note": "" }
      ]
    }
  ]
}`;

const WORK_TYPE_LABELS = {
  cosmetic: "Косметический ремонт",
  capital: "Капитальный ремонт",
  construction: "Строительство (малоэтажное)",
  landscaping: "Благоустройство",
};

const REGION_LABELS = {
  msk: "Москва",
  mo: "Московская область",
  spb: "Санкт-Петербург",
  lo: "Ленинградская область",
};

/**
 * Конвертация Excel (xlsx/xls) в текстовую таблицу.
 */
function excelToText(buffer) {
  try {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    let result = "";
    for (const sheetName of workbook.SheetNames) {
      result += "=== Лист: " + sheetName + " ===\n";
      const sheet = workbook.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet, { FS: " | ", RS: "\n" });
      result += csv + "\n\n";
    }
    return result;
  } catch (e) {
    return "[Ошибка чтения Excel: " + e.message + "]";
  }
}

/**
 * Конвертация Word (docx) в текст.
 */
async function wordToText(buffer) {
  try {
    const result = await mammoth.extractRawText({ buffer: buffer });
    return result.value;
  } catch (e) {
    return "[Ошибка чтения Word: " + e.message + "]";
  }
}

/**
 * Подготовка документов для Claude API.
 * Изображения и PDF — напрямую (Claude умеет).
 * Excel и Word — конвертируются в текст.
 */
async function prepareDocuments(files) {
  const content = [];

  for (const file of files) {
    let buffer;
    if (file.data) {
      buffer = Buffer.from(file.data, "base64");
    } else if (file.path) {
      buffer = fs.readFileSync(file.path);
    } else {
      continue;
    }

    const base64 = buffer.toString("base64");
    const mime = file.mimeType || "application/octet-stream";
    const name = file.name || "document";
    const nameLower = name.toLowerCase();

    // Изображения — напрямую в Claude
    if (mime.startsWith("image/") || nameLower.endsWith(".jpg") || nameLower.endsWith(".jpeg") || nameLower.endsWith(".png")) {
      const imgMime = nameLower.endsWith(".png") ? "image/png" : "image/jpeg";
      content.push({
        type: "image",
        source: { type: "base64", media_type: imgMime, data: base64 },
      });
      console.log("[docs] Image:", name);
    }
    // PDF — напрямую в Claude
    else if (mime === "application/pdf" || nameLower.endsWith(".pdf")) {
      content.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: base64 },
      });
      console.log("[docs] PDF:", name);
    }
    // Excel — конвертируем в текст
    else if (nameLower.endsWith(".xlsx") || nameLower.endsWith(".xls") || mime.includes("spreadsheet") || mime.includes("excel")) {
      const text = excelToText(buffer);
      content.push({
        type: "text",
        text: "[Excel файл: " + name + "]\n" + text,
      });
      console.log("[docs] Excel->text:", name, "(" + text.length + " chars)");
    }
    // Word — конвертируем в текст
    else if (nameLower.endsWith(".docx") || nameLower.endsWith(".doc") || mime.includes("word")) {
      const text = await wordToText(buffer);
      content.push({
        type: "text",
        text: "[Word файл: " + name + "]\n" + text,
      });
      console.log("[docs] Word->text:", name, "(" + text.length + " chars)");
    }
    // Прочие текстовые файлы
    else {
      try {
        const text = buffer.toString("utf-8").substring(0, 50000);
        content.push({ type: "text", text: "[Файл: " + name + "]\n" + text });
        console.log("[docs] Text:", name);
      } catch (e) {
        content.push({ type: "text", text: "[Файл: " + name + "] (не удалось прочитать)" });
      }
    }
  }

  content.push({
    type: "text",
    text: "Проанализируй ВСЕ загруженные документы. СТРОГО следуй ВОР и ТЗ заказчика — включай ТОЛЬКО те работы, которые указаны в ВОР и ТЗ, с указанными объёмами. Площади бери из планов. Расценки — ТОЛЬКО из справочника. Материалы — ТОЛЬКО через web_search в petrovich.ru. Первый символ ответа — {",
  });

  return content;
}

async function generateEstimate(order, files) {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  let systemPrompt = SYSTEM_PROMPT_TEMPLATE
    .replace(/\{\{work_type\}\}/g, WORK_TYPE_LABELS[order.workType] || order.workType)
    .replace(/\{\{region\}\}/g, REGION_LABELS[order.region] || order.region)
    .replace(/\{\{area\}\}/g, String(order.area))
    .replace(/\{\{client_name\}\}/g, order.clientName || "");

  const priceContext = buildPriceContext(order.workType, order.region);
  if (priceContext) {
    systemPrompt += "\n" + priceContext;
  }

  const content = await prepareDocuments(files);

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 16000,
    system: systemPrompt,
    tools: [
      {
        type: "web_search_20250305",
        name: "web_search",
      },
    ],
    messages: [
      {
        role: "user",
        content: content,
      },
    ],
  });

  const textBlocks = response.content.filter((b) => b.type === "text");
  const fullText = textBlocks.map((b) => b.text).join("\n");
  const clean = fullText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

  try {
    return JSON.parse(clean);
  } catch (e1) {
    const firstBrace = clean.indexOf("{");
    const lastBrace = clean.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(clean.substring(firstBrace, lastBrace + 1));
      } catch (e2) {
        console.error("Failed to extract JSON:", e2);
      }
    }
    console.error("Raw response (first 500):", clean.substring(0, 500));
    throw new Error("Claude API вернул невалидный JSON. Попробуйте снова.");
  }
}

module.exports = { generateEstimate, WORK_TYPE_LABELS, REGION_LABELS };
