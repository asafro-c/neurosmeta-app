/**
 * Гибридный матчер расценок: справочник + Claude.
 * 
 * Этап 2a: программный поиск по ключевым словам → 3-7 кандидатов
 * Этап 2b: Claude мини-запрос → выбор лучшего кандидата
 * Этап 3: подстановка цены × Кинф × Кмск
 */

const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const path = require("path");

// Загрузка базы расценок
let priceDB = null;
function loadPriceDB() {
  if (priceDB) return priceDB;
  const dbPath = path.join(__dirname, "..", "app", "prices", "price_db.json");
  if (fs.existsSync(dbPath)) {
    priceDB = JSON.parse(fs.readFileSync(dbPath, "utf-8"));
  } else {
    priceDB = [];
    console.error("[price-matcher] price_db.json not found at", dbPath);
  }
  return priceDB;
}

// Коэффициенты
const K_INF = 1.03;

const K_MSK_DETAILED = {
  "перегород": 1.02, "гкл": 1.02, "гипсокартон": 1.02,
  "штукатурк": 1.58, "шпакл": 1.14, "шпатл": 1.14,
  "покраск": 1.18, "окраск": 1.18, "грунтов": 1.75,
  "обои": 1.18, "стяжк": 1.17,
  "ламинат": 1.13, "кварцвинил": 1.13, "spc": 1.13,
  "плитк": 1.15, "керамогранит": 1.15,
  "гидроизол": 1.25,
  "дверь": 1.14, "двер": 1.14,
  "демонтаж": 1.10, "разбор": 1.10,
  "плинтус": 1.13, "подложк": 1.13,
  "минват": 1.10, "звукоизол": 1.10,
  "смесител": 1.18, "унитаз": 1.14, "раковин": 1.14,
  "радиатор": 1.14, "полотенцесуш": 1.30,
  "розетк": 1.17, "выключател": 1.17, "провод": 1.18,
  "светильник": 1.14, "люстр": 1.18,
};

const K_MSK_DEFAULT = {
  "отделочные": 1.20,
  "строительные": 1.15,
  "сантехнические": 1.15,
  "электромонтажные": 1.15,
  "вентиляция": 1.15,
};

/**
 * Определить Кмск для работы по её названию и направлению.
 */
function getKmsk(workName, direction, region) {
  if (region !== "msk" && region !== "mo") return 1.0;
  
  const nameLower = workName.toLowerCase();
  for (const [key, val] of Object.entries(K_MSK_DETAILED)) {
    if (nameLower.includes(key)) {
      return region === "mo" ? 1 + (val - 1) * 0.95 : val;
    }
  }
  const kDefault = K_MSK_DEFAULT[direction] || 1.15;
  return region === "mo" ? 1 + (kDefault - 1) * 0.95 : kDefault;
}

/**
 * Генерация ключевых слов из названия работы.
 */
function extractKeywords(workName) {
  const stopWords = new Set(["в", "на", "из", "с", "и", "по", "для", "до", "от", "под", "без", "при", "за", "или", "к", "мм", "см", "шт", "компл", "слой", "слоя", "слоев", "работа", "работы", "устройство", "монтаж", "установка"]);
  
  return workName
    .toLowerCase()
    .replace(/[()«»"',./×]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w))
    .slice(0, 8);
}

/**
 * Этап 2a: Программный поиск кандидатов по ключевым словам.
 * Возвращает top-N позиций справочника, отсортированных по релевантности.
 */
function searchCandidates(workName, workUnit, maxResults = 7) {
  const db = loadPriceDB();
  const keywords = extractKeywords(workName);
  
  if (keywords.length === 0) return [];
  
  // Подсчёт совпадений для каждой позиции
  const scored = db.map(item => {
    const nameLower = item.n.toLowerCase();
    let score = 0;
    
    for (const kw of keywords) {
      if (nameLower.includes(kw)) {
        score += kw.length; // Длинные слова весят больше
      }
    }
    
    // Бонус за совпадение единицы измерения
    if (workUnit && item.u) {
      const u1 = workUnit.toLowerCase().replace(/[.²³]/g, "");
      const u2 = item.u.toLowerCase().replace(/[.²³]/g, "");
      if (u1 === u2 || u1.includes(u2) || u2.includes(u1)) {
        score += 3;
      }
    }
    
    return { ...item, score };
  });
  
  return scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

/**
 * Этап 2b: Claude мини-запрос для выбора лучшего кандидата.
 */
async function matchWithClaude(workName, workUnit, candidates) {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  
  const candidateList = candidates.map((c, i) => 
    `${i + 1}. [${c.c}] ${c.n} | ${c.u} | ${c.p1}${c.p2 !== c.p1 ? "-" + c.p2 : ""} ₽`
  ).join("\n");
  
  const prompt = `Работа из ВОР заказчика: "${workName}" (${workUnit})

Кандидаты из справочника расценок:
${candidateList}

Какой номер кандидата ЛУЧШЕ ВСЕГО соответствует работе? Ответь ТОЛЬКО цифрой (1, 2, 3...). Если ни один не подходит — ответь 0.`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 10,
      messages: [{ role: "user", content: prompt }],
    });
    
    const text = response.content[0]?.text?.trim() || "0";
    const num = parseInt(text);
    
    if (num > 0 && num <= candidates.length) {
      return candidates[num - 1];
    }
    return null;
  } catch (err) {
    console.error("[price-matcher] Claude mini-call error:", err.message);
    // Fallback: берём первого кандидата с наибольшим score
    return candidates[0];
  }
}

/**
 * Этап 3: Подстановка расценки с коэффициентами.
 */
function applyRate(matchedItem, region) {
  if (!matchedItem) return { rate: 0, source: "не найден в справочнике" };
  
  const avg = matchedItem.p2 !== matchedItem.p1 
    ? Math.round((matchedItem.p1 + matchedItem.p2) / 2) 
    : matchedItem.p1;
  
  const kmsk = getKmsk(matchedItem.n, matchedItem.d, region);
  const rate = Math.round(avg * K_INF * kmsk);
  
  let source = `справочник: ${matchedItem.c}, ${avg}`;
  if (kmsk !== 1.0) {
    source += ` × ${K_INF} × Кмск ${kmsk.toFixed(2)} = ${rate}`;
  } else {
    source += ` × ${K_INF} = ${rate}`;
  }
  
  return { rate, source, code: matchedItem.c, direction: matchedItem.d };
}

/**
 * Полный цикл: для массива работ найти расценки.
 * @param {Array} workItems - [{name, unit, qty}]
 * @param {string} region - spb | msk | mo | lo
 * @returns {Array} [{name, unit, qty, work_rate, work_rate_source}]
 */
async function matchAllRates(workItems, region) {
  const results = [];
  
  for (const item of workItems) {
    console.log(`[price-matcher] Matching: ${item.name} (${item.unit})`);
    
    // Этап 2a: поиск кандидатов
    const candidates = searchCandidates(item.name, item.unit);
    console.log(`[price-matcher]   Found ${candidates.length} candidates`);
    
    // Этап 2b: Claude выбирает лучшего
    let matched = null;
    if (candidates.length > 0) {
      matched = await matchWithClaude(item.name, item.unit, candidates);
      if (matched) {
        console.log(`[price-matcher]   Matched: [${matched.c}] ${matched.n} (${matched.p1}-${matched.p2})`);
      }
    }
    
    // Этап 3: подстановка цены
    const { rate, source } = applyRate(matched, region);
    console.log(`[price-matcher]   Rate: ${rate} ₽ (${source})`);
    
    results.push({
      ...item,
      work_rate: rate,
      work_rate_source: source,
    });
  }
  
  return results;
}

module.exports = { matchAllRates, searchCandidates, matchWithClaude, applyRate, K_INF };
