/**
 * Поиск цен на материалы через Claude + web_search.
 * Отдельный вызов: Claude получает список материалов и ищет цену каждого на petrovich.ru.
 * Результат: обновлённые цены в JSON.
 */

const Anthropic = require("@anthropic-ai/sdk");

const PRICE_LOOKUP_PROMPT = `Ты — помощник по поиску цен на строительные материалы. Твоя ЕДИНСТВЕННАЯ задача: для каждого материала из списка найти актуальную розничную цену на petrovich.ru (Санкт-Петербург).

ИНСТРУКЦИИ:
1. Для каждого материала выполни web_search: "[название материала] petrovich.ru цена"
2. Найди РОЗНИЧНУЮ цену на сайте Петровича
3. Раздели цену на 1.22 (убрать НДС 22%)
4. Если не нашёл на petrovich.ru — ищи на lemanapro.ru, затем maxidom.ru. Тоже дели на 1.22.
5. Если нигде не нашёл — поставь price: 0

ВАЖНО:
- Ищи КАЖДЫЙ материал, не пропускай
- Цена должна быть за указанную единицу (шт., кг, м², упаковка)
- Не придумывай цены — только из результатов поиска
- Если находишь несколько вариантов, бери БЛИЖАЙШИЙ к описанию

Ответь ТОЛЬКО JSON-массивом, без текста. Первый символ — [

Формат ответа:
[
  {"idx": 0, "price": 1964.75, "supplier": "Петрович", "name_found": "Точное название из каталога"},
  {"idx": 1, "price": 0, "supplier": "", "name_found": ""},
  ...
]`;

/**
 * Поиск цен для массива материалов.
 * @param {Array} materials - [{name, unit, qty}]
 * @param {string} region - spb | msk
 * @returns {Array} [{idx, price, supplier, name_found}]
 */
async function lookupPrices(materials, region) {
  if (!materials || materials.length === 0) return [];

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const regionLabel = region === "msk" || region === "mo" ? "Москва" : "Санкт-Петербург";
  const regionSite = region === "msk" || region === "mo" ? "moscow.petrovich.ru" : "petrovich.ru";

  const materialList = materials.map((m, i) =>
    (i + 1) + ". " + m.name + " (" + m.unit + ") — искать на " + regionSite
  ).join("\n");

  const userMessage = "Найди цены для следующих " + materials.length + " материалов (регион: " + regionLabel + "):\n\n" + materialList + "\n\nВыполни web_search для КАЖДОГО материала. Ответь JSON-массивом. Первый символ — [";

  console.log("[prices] Looking up", materials.length, "materials for", regionLabel);

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      system: PRICE_LOOKUP_PROMPT,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: userMessage }],
    });

    const textBlocks = response.content.filter(b => b.type === "text");
    const fullText = textBlocks.map(b => b.text).join("\n");
    const clean = fullText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

    // Извлекаем JSON-массив
    let results;
    try {
      results = JSON.parse(clean);
    } catch (e1) {
      const firstBracket = clean.indexOf("[");
      const lastBracket = clean.lastIndexOf("]");
      if (firstBracket !== -1 && lastBracket > firstBracket) {
        try {
          results = JSON.parse(clean.substring(firstBracket, lastBracket + 1));
        } catch (e2) {
          console.error("[prices] JSON parse failed:", clean.substring(0, 300));
          return [];
        }
      } else {
        return [];
      }
    }

    const found = results.filter(r => r.price > 0).length;
    console.log("[prices] Found prices:", found + "/" + materials.length);
    return results;

  } catch (err) {
    console.error("[prices] Claude API error:", err.message);
    return [];
  }
}

/**
 * Обновить цены материалов в estimateData.
 * @param {Object} estimateData - JSON сметы из этапа 1
 * @param {string} region - spb | msk
 * @returns {Object} обновлённый estimateData
 */
async function updateMaterialPrices(estimateData, region) {
  // Собираем все материалы из всех позиций
  const allMaterials = [];
  const materialMap = []; // для маппинга обратно

  for (const section of estimateData.sections || []) {
    for (const pos of section.positions || []) {
      for (let mi = 0; mi < (pos.materials || []).length; mi++) {
        const mat = pos.materials[mi];
        allMaterials.push({ name: mat.name, unit: mat.unit, qty: mat.qty });
        materialMap.push({ section, pos, mi });
      }
    }
  }

  if (allMaterials.length === 0) {
    console.log("[prices] No materials to look up");
    return estimateData;
  }

  console.log("[prices] Total materials:", allMaterials.length);

  // Разбиваем на батчи по 15 (чтобы Claude не терял фокус)
  const batchSize = 15;
  const allResults = [];

  for (let i = 0; i < allMaterials.length; i += batchSize) {
    const batch = allMaterials.slice(i, i + batchSize);
    console.log("[prices] Batch", Math.floor(i / batchSize) + 1, ":", batch.length, "materials");
    const results = await lookupPrices(batch, region);

    // Маппим результаты
    for (let j = 0; j < batch.length; j++) {
      const result = results.find(r => r.idx === j) || results[j] || null;
      if (result && result.price > 0) {
        const { section, pos, mi } = materialMap[i + j];
        pos.materials[mi].price = result.price;
        if (result.supplier) pos.materials[mi].supplier = result.supplier;
        if (result.name_found) pos.materials[mi].name = result.name_found;
        allResults.push({ name: batch[j].name, price: result.price, supplier: result.supplier });
      }
    }
  }

  console.log("[prices] Updated", allResults.length, "of", allMaterials.length, "prices");
  return estimateData;
}

module.exports = { updateMaterialPrices, lookupPrices };
