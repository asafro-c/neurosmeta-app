/**
 * Вызов Claude API для генерации сметы.
 * v3: Жёсткие правила + поддержка base64 файлов с тестовой страницы.
 */

const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const path = require("path");
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
- НЕ оборачивай в \\\`\\\`\\\`json\\\`\\\`\\\`. Просто JSON.

### ПРАВИЛО 4: ПОЛНОТА
- work_rate_source: «справочник: ОТД-01.12, 475 × 1.03 = 489» или «web_search: штукатурка стен СПб цена за м2»
- supplier: «Петрович» / «Лемана ПРО» / «Максидом»
- Не пропускай подразумеваемые работы (грунтовка, вывоз мусора и др.)
- Для каждой работы с материалами детализируй ВСЕ материалы

## ВХОДНЫЕ ДАННЫЕ
Заказчик загрузил документы. Проанализируй ВСЕ и извлеки:
1. Перечень работ с объёмами
2. Размеры помещений
3. Перечень материалов с количествами

## ДОПОЛНИТЕЛЬНЫЕ ПРАВИЛА

### Расчёт количества материалов
Кол-во = Площадь × Норма расхода × Коэфф. толщины + Запас (5-10%).
Нормы расхода — из паспортных данных (искать через web_search если неизвестно).

### НДС
Все цены в JSON — БЕЗ НДС. НДС 22% начисляется один раз в итоговом блоке.

### Нумерация
Раздел.Позиция: 1.1, 1.2, 2.1 и т.д.

### Расчёт площадей
Для каждого помещения: пол, потолок, каждая стена.
Стены: длина × высота − вычеты (окна 1.5×1.5=2.25 м², двери 0.9×2.1=1.89 м²).

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
      "name": "Кухня (3200×4100)",
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

function prepareDocuments(files) {
  const content = [];

  for (const file of files) {
    let base64;
    if (file.data) {
      base64 = file.data;
    } else if (file.path) {
      const data = fs.readFileSync(file.path);
      base64 = data.toString("base64");
    } else {
      continue;
    }

    const mime = file.mimeType || "application/pdf";

    if (mime.startsWith("image/")) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: mime, data: base64 },
      });
    } else if (mime === "application/pdf") {
      content.push({
        type: "document",
        source: { type: "base64", media_type: mime, data: base64 },
      });
    } else {
      try {
        const text = Buffer.from(base64, "base64").toString("utf-8").substring(0, 50000);
        content.push({ type: "text", text: "[Файл: " + file.name + "]\n" + text });
      } catch (e) {
        content.push({ type: "text", text: "[Файл: " + file.name + "] (не удалось прочитать)" });
      }
    }
  }

  content.push({
    type: "text",
    text: "Проанализируй все загруженные документы и составь полную смету в формате JSON. СТРОГО следуй АБСОЛЮТНЫМ ПРАВИЛАМ из системного промпта. Расценки — ТОЛЬКО из справочника. Материалы — ТОЛЬКО через web_search в petrovich.ru. Первый символ ответа — {",
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

  const content = prepareDocuments(files);

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
        console.error("Failed to extract JSON from response:", e2);
      }
    }
    console.error("Raw response (first 500 chars):", clean.substring(0, 500));
    throw new Error("Claude API вернул невалидный JSON. Попробуйте снова.");
  }
}

module.exports = { generateEstimate, WORK_TYPE_LABELS, REGION_LABELS };
