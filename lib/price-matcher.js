/**
 * Гибридный матчер расценок v2.
 * Fixes: синонимы (SPC→кварцвинил), расширенный поиск, fallback.
 */

const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const path = require("path");

let priceDB = null;
function loadPriceDB() {
  if (priceDB) return priceDB;
  const possiblePaths = [
    path.join(process.cwd(), "app", "prices", "price_db.json"),
    path.join(__dirname, "..", "app", "prices", "price_db.json"),
    "/var/task/app/prices/price_db.json",
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      priceDB = JSON.parse(fs.readFileSync(p, "utf-8"));
      console.log("[matcher] Loaded", priceDB.length, "positions from", p);
      return priceDB;
    }
  }
  console.error("[matcher] price_db.json NOT FOUND");
  priceDB = [];
  return priceDB;
}

const K_INF = 1.03;

const K_MSK_DETAILED = {
  "перегород": 1.02, "гкл": 1.02, "гипсокартон": 1.02,
  "штукатурк": 1.58, "шпакл": 1.14, "шпатл": 1.14,
  "покраск": 1.18, "окраск": 1.18, "грунтов": 1.75,
  "обои": 1.18, "стяжк": 1.17,
  "ламинат": 1.13, "кварцвинил": 1.13, "spc": 1.13,
  "плитк": 1.15, "керамогранит": 1.15,
  "гидроизол": 1.25,
  "двер": 1.14, "демонтаж": 1.10,
  "плинтус": 1.13, "подложк": 1.13,
  "минват": 1.10, "звукоизол": 1.10,
};

const K_MSK_DEFAULT = {
  "отделочные": 1.20, "строительные": 1.15,
  "сантехнические": 1.15, "электромонтажные": 1.15, "вентиляция": 1.15,
};

// Синонимы: слово из ВОР → слова для поиска в справочнике
const SYNONYMS = {
  "spc": ["кварцвинил", "spc", "lvt", "wpc"],
  "кварцвинил": ["кварцвинил", "spc", "lvt"],
  "кварц-винил": ["кварцвинил", "spc"],
  "минват": ["минерал", "звукоизол", "утеплител"],
  "минеральн": ["минерал", "звукоизол"],
  "звукоизол": ["звукоизол", "минерал"],
  "xps": ["подложк", "xps"],
  "керамогранит": ["керамогранит", "облицовк"],
  "плитк": ["плитк", "керамическ", "облицовк", "кафел"],
  "облицовк": ["облицовк"],
  "гкл": ["гкл", "гипсокартон"],
  "гипсокартон": ["гкл", "гипсокартон"],
  "подложк": ["подложк"],
  "ламинат": ["ламинат", "кварцвинил"],
  "грунтовк": ["грунтов"],
  "грунт": ["грунтов"],
  "шпакл": ["шпакл", "шпатл"],
  "шпатл": ["шпакл", "шпатл"],
};

function getKmsk(workName, direction, region) {
  if (region !== "msk" && region !== "mo") return 1.0;
  const nameLower = workName.toLowerCase();
  for (const [key, val] of Object.entries(K_MSK_DETAILED)) {
    if (nameLower.includes(key)) {
      return region === "mo" ? 1 + (val - 1) * 0.95 : val;
    }
  }
  return region === "mo" ? 1 + ((K_MSK_DEFAULT[direction] || 1.15) - 1) * 0.95 : (K_MSK_DEFAULT[direction] || 1.15);
}

function extractKeywords(workName) {
  const stopWords = new Set(["для", "при", "без", "или", "под", "над", "шт", "компл", "работа", "работы", "устройство", "монтаж", "установка", "укладка"]);
  const words = workName
    .toLowerCase()
    .replace(/[()«»"',./×\-]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));

  // Раскрываем синонимы
  const expanded = new Set();
  for (const w of words) {
    expanded.add(w);
    for (const [syn, replacements] of Object.entries(SYNONYMS)) {
      if (w.includes(syn) || syn.includes(w)) {
        for (const r of replacements) expanded.add(r);
      }
    }
  }
  return Array.from(expanded);
}

function searchCandidates(workName, workUnit, maxResults) {
  const db = loadPriceDB();
  const keywords = extractKeywords(workName);
  if (keywords.length === 0) return [];

  const scored = db.map(item => {
    const nameLower = item.n.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (nameLower.includes(kw)) score += kw.length;
    }
    if (workUnit && item.u) {
      const u1 = workUnit.toLowerCase().replace(/[.²³]/g, "");
      const u2 = item.u.toLowerCase().replace(/[.²³]/g, "");
      if (u1 === u2 || u1.includes(u2) || u2.includes(u1)) score += 3;
    }
    return { ...item, score };
  });

  return scored.filter(i => i.score > 0).sort((a, b) => b.score - a.score).slice(0, maxResults || 7);
}

async function matchWithClaude(workName, workUnit, candidates) {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const list = candidates.map((c, i) =>
    (i + 1) + ". [" + c.c + "] " + c.n + " | " + c.u + " | " + c.p1 + (c.p2 !== c.p1 ? "-" + c.p2 : "") + " р."
  ).join("\n");

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 10,
      messages: [{ role: "user", content: "Работа: \"" + workName + "\" (" + workUnit + ")\n\nКандидаты:\n" + list + "\n\nКакой номер лучше подходит? Только цифра. 0 если ни один." }],
    });
    const num = parseInt(response.content[0]?.text?.trim() || "0");
    if (num > 0 && num <= candidates.length) return candidates[num - 1];
    return candidates[0]; // fallback на лучший по score
  } catch (err) {
    console.error("[matcher] Claude mini error:", err.message);
    return candidates[0];
  }
}

function applyRate(item, region) {
  if (!item) return { rate: 0, source: "не найден в справочнике" };
  const avg = item.p2 !== item.p1 ? Math.round((item.p1 + item.p2) / 2) : item.p1;
  const kmsk = getKmsk(item.n, item.d, region);
  const rate = Math.round(avg * K_INF * kmsk);
  let source = "справочник: " + item.c + ", " + avg;
  source += kmsk !== 1.0
    ? " * " + K_INF + " * Кмск " + kmsk.toFixed(2) + " = " + rate
    : " * " + K_INF + " = " + rate;
  return { rate, source };
}

async function matchAllRates(workItems, region) {
  console.log("[matcher] Matching", workItems.length, "items, region:", region);
  const results = [];

  for (const item of workItems) {
    const candidates = searchCandidates(item.name, item.unit);
    console.log("[matcher]", item.name.substring(0, 40), "→", candidates.length, "candidates");

    let matched = null;
    if (candidates.length > 0) {
      matched = await matchWithClaude(item.name, item.unit, candidates);
      if (matched) console.log("[matcher]  → [" + matched.c + "] " + matched.p1 + "-" + matched.p2);
    }

    const { rate, source } = applyRate(matched, region);
    results.push({ ...item, work_rate: rate, work_rate_source: source });
  }

  const ok = results.filter(r => r.work_rate > 0).length;
  console.log("[matcher] Done:", ok + "/" + results.length, "matched");
  return results;
}

module.exports = { matchAllRates, searchCandidates, K_INF };
