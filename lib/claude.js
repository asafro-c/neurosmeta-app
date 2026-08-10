/**
 * Claude API — Этап 1: анализ документов.
 * Claude извлекает: виды работ, объёмы, материалы с ценами, площади.
 * Расценки на работы НЕ определяет (work_rate: 0) — они подставляются на Этапе 2-3.
 */

const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const XLSX = require("xlsx");
const mammoth = require("mammoth");

const SYSTEM_PROMPT = `# СИСТЕМНЫЙ ПРОМПТ — АНАЛИЗ ДОКУМЕНТОВ И ГЕНЕРАЦИЯ СМЕТЫ (ЭТАП 1)

Ты — профессиональный инженер-сметчик сервиса «НейроСмета». Проанализируй загруженные документы и составь сметную документацию в формате JSON.

## ПАРАМЕТРЫ ЗАКАЗА
- Тип работ: {{work_type}}
- Регион: {{region}}
- Площадь объекта: {{area}} м²
- Заказчик: {{client_name}}

## ТВОЯ ЗАДАЧА

### 1. ВИДЫ РАБОТ И ОБЪЁМЫ (из ВОР и ТЗ)
- Перенеси ВСЕ виды работ из ВОР заказчика с точными объёмами.
- Учти условия из ТЗ (что включать, что исключать).
- Добавь подразумеваемые работы (грунтовка, вывоз мусора и т.д.).
- work_rate ставь 0 для всех позиций (расценки подставятся автоматически).
- work_rate_source ставь "" (будет заполнено автоматически).

### 2. МАТЕРИАЛЫ — ТОЛЬКО ЧЕРЕЗ WEB_SEARCH
Для КАЖДОГО материала ты ОБЯЗАН:
1. Выполнить web_search: «[название материала] petrovich.ru цена СПб».
2. Из результата взять РОЗНИЧНУЮ цену.
3. Разделить на 1.22 (убрать НДС).
4. В JSON: точное наименование из каталога, цену без НДС, supplier: «Петрович».
5. Если не найден — искать в lemanapro.ru, затем maxidom.ru. Делить на 1.22.

ЗАПРЕЩЕНО: использовать цены из памяти, придумывать артикулы.
Если цена не найдена — price: 0, note: "⚠ цена не найдена".

### 3. РАСЧЁТ ПЛОЩАДЕЙ (из планов)
Для каждого помещения из плана: пол, стены (с вычетами на окна/двери).
Площади бери СТРОГО из планов (там указаны м²).

## ФОРМАТ ОТВЕТА
- ТОЛЬКО JSON. Первый символ — {
- НЕ начинай с текста. НЕ оборачивай в тройные кавычки.

{
  "meta": {
    "title": "СМЕТА — ...",
    "subtitle": "описание объекта",
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
          "name": "Название работы (как в ВОР)",
          "unit": "м²",
          "qty": 100,
          "work_rate": 0,
          "work_rate_source": "",
          "vor_note": "формула объёма или ссылка на ВОР",
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

function excelToText(buffer) {
  try {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    let result = "";
    for (const sheetName of workbook.SheetNames) {
      result += "=== Лист: " + sheetName + " ===\n";
      const sheet = workbook.Sheets[sheetName];
      result += XLSX.utils.sheet_to_csv(sheet, { FS: " | ", RS: "\n" }) + "\n\n";
    }
    return result;
  } catch (e) {
    return "[Ошибка чтения Excel: " + e.message + "]";
  }
}

async function wordToText(buffer) {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } catch (e) {
    return "[Ошибка чтения Word: " + e.message + "]";
  }
}

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
    const name = file.name || "document";
    const nameLower = name.toLowerCase();
    const mime = file.mimeType || "application/octet-stream";

    if (mime.startsWith("image/") || nameLower.match(/\.(jpg|jpeg|png)$/)) {
      const imgMime = nameLower.endsWith(".png") ? "image/png" : "image/jpeg";
      content.push({ type: "image", source: { type: "base64", media_type: imgMime, data: base64 } });
    } else if (mime === "application/pdf" || nameLower.endsWith(".pdf")) {
      content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } });
    } else if (nameLower.match(/\.(xlsx|xls)$/) || mime.includes("spreadsheet")) {
      content.push({ type: "text", text: "[Excel: " + name + "]\n" + excelToText(buffer) });
    } else if (nameLower.match(/\.(docx|doc)$/) || mime.includes("word")) {
      content.push({ type: "text", text: "[Word: " + name + "]\n" + await wordToText(buffer) });
    } else {
      try {
        content.push({ type: "text", text: "[Файл: " + name + "]\n" + buffer.toString("utf-8").substring(0, 50000) });
      } catch (e) {
        content.push({ type: "text", text: "[Файл: " + name + "] (не удалось прочитать)" });
      }
    }
  }

  content.push({
    type: "text",
    text: "Проанализируй ВСЕ документы. Следуй ВОР и ТЗ заказчика. work_rate ставь 0 для всех позиций. Материалы ищи через web_search в petrovich.ru. Первый символ ответа — {",
  });

  return content;
}

async function generateEstimate(order, files) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const systemPrompt = SYSTEM_PROMPT
    .replace(/\{\{work_type\}\}/g, WORK_TYPE_LABELS[order.workType] || order.workType)
    .replace(/\{\{region\}\}/g, REGION_LABELS[order.region] || order.region)
    .replace(/\{\{area\}\}/g, String(order.area))
    .replace(/\{\{client_name\}\}/g, order.clientName || "");

  const content = await prepareDocuments(files);

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 16000,
    system: systemPrompt,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    messages: [{ role: "user", content }],
  });

  const textBlocks = response.content.filter(b => b.type === "text");
  const fullText = textBlocks.map(b => b.text).join("\n");
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
        console.error("[claude] JSON extract failed:", e2.message);
      }
    }
    console.error("[claude] Raw (500 chars):", clean.substring(0, 500));
    throw new Error("Claude API вернул невалидный JSON");
  }
}

module.exports = { generateEstimate, WORK_TYPE_LABELS, REGION_LABELS };
