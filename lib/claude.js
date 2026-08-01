/**
 * Вызов Claude API для генерации сметы.
 * Отправляет документы + системный промпт → получает JSON со сметой.
 */

const Anthropic = require("@anthropic-ai/sdk");
const { buildPriceContext } = require("./prices");
const fs = require("fs");
const path = require("path");

const SYSTEM_PROMPT_TEMPLATE = `# СИСТЕМНЫЙ ПРОМПТ — АВТОМАТИЧЕСКАЯ ГЕНЕРАЦИЯ СМЕТЫ

Ты — профессиональный инженер-сметчик сервиса «НейроСмета». Твоя задача — на основе загруженных документов заказчика составить полную сметную документацию в формате JSON.

## ПАРАМЕТРЫ ЗАКАЗА
- Тип работ: {{work_type}}
- Регион: {{region}}
- Площадь объекта: {{area}} м²
- Заказчик: {{client_name}}

## ВХОДНЫЕ ДАННЫЕ
Заказчик загрузил документы. Проанализируй ВСЕ загруженные документы и извлеки:
1. Перечень работ с объёмами
2. Размеры помещений
3. Перечень материалов с количествами
4. Особые условия и требования

## ПРАВИЛА

### Источники цен на материалы
Для КАЖДОЙ позиции материалов выполни веб-поиск в каталогах поставщиков:
Лемана ПРО (lemanapro.ru), Петрович (petrovich.ru), Яндекс Маркет, Максидом.
Розничные цены от Лемана ПРО и Петрович делить на 1.22 (убрать НДС).
ЗАПРЕЩЕНО: использовать цены из памяти, экстраполировать, придумывать артикулы.

### Расценки на работы
Комплексные (труд + оборудование + накладные + прибыль).
Если в документах есть ВОР с расценками или КП — использовать их (приоритет).
Иначе — веб-поиск рыночных расценок в {{region}}.

### Расчёт количества материалов
Кол-во = Площадь × Норма расхода × Коэфф. толщины + Запас (5–10%).
Нормы — из паспортных данных производителя.

### НДС
Все цены в JSON — БЕЗ НДС. НДС 22% начисляется один раз в итоговом блоке.

### Нумерация
Раздел.Позиция: 1.1, 1.2, 2.1 и т.д.

### Расчёт площадей
Для каждого помещения: пол, потолок, каждая стена.
Стены: длина × высота − вычеты (окна 1.5×1.5=2.25 м², двери 0.9×2.1=1.89 м²).

### Полнота
Не пропускай подразумеваемые работы (грунтовка, вывоз мусора и т.д.).
Детализируй ВСЕ материалы для каждой работы.

## ФОРМАТ ОТВЕТА
Ответь ТОЛЬКО валидным JSON. Структура:
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
      "name": "Раздел",
      "positions": [
        {
          "num": "1.1",
          "name": "Работа",
          "unit": "м²",
          "qty": 100,
          "work_rate": 850,
          "work_rate_source": "рыночная оценка",
          "vor_note": "",
          "materials": [
            { "name": "Материал", "unit": "шт.", "qty": 10, "price": 500, "supplier": "Лемана ПРО", "note": "" }
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
}
Не добавляй текст до или после JSON.`;

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
 * Подготовка документов для отправки в Claude API.
 * @param {Array<{path: string, name: string, mimeType: string}>} files
 * @returns {Array} content blocks
 */
function prepareDocuments(files) {
  const content = [];

  for (const file of files) {
    const data = fs.readFileSync(file.path);
    const base64 = data.toString("base64");
    const mime = file.mimeType;

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
    }
    // Excel и другие файлы обрабатываем как текст
    else {
      content.push({
        type: "text",
        text: `[Файл: ${file.name}]\n${data.toString("utf-8").substring(0, 50000)}`,
      });
    }
  }

  content.push({
    type: "text",
    text: "Проанализируй все загруженные документы и составь полную смету в формате JSON согласно инструкциям.",
  });

  return content;
}

/**
 * Вызов Claude API для генерации сметы.
 * @param {Object} order - параметры заказа
 * @param {Array} files - загруженные файлы
 * @returns {Object} JSON со сметой
 */
async function generateEstimate(order, files) {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  // Подготовка системного промпта с расценками
  let systemPrompt = SYSTEM_PROMPT_TEMPLATE
    .replace(/\{\{work_type\}\}/g, WORK_TYPE_LABELS[order.workType] || order.workType)
    .replace(/\{\{region\}\}/g, REGION_LABELS[order.region] || order.region)
    .replace(/\{\{area\}\}/g, String(order.area))
    .replace(/\{\{client_name\}\}/g, order.clientName || "");

  // Встраиваем справочник расценок (с коэффициентами инфляции и региона)
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

  // Извлекаем текстовый ответ (JSON)
  const textBlocks = response.content.filter((b) => b.type === "text");
  const fullText = textBlocks.map((b) => b.text).join("\n");

  // Парсим JSON (убираем возможные ```json обёртки)
  const clean = fullText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

  try {
    return JSON.parse(clean);
  } catch (err) {
    console.error("Failed to parse Claude response as JSON:", err);
    console.error("Raw response:", clean.substring(0, 500));
    throw new Error("Claude API вернул невалидный JSON");
  }
}

module.exports = { generateEstimate, WORK_TYPE_LABELS, REGION_LABELS };
