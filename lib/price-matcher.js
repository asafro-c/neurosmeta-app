/**
 * Гибридный матчер расценок v4.
 * Системное правило: предмет работы определяет приоритет.
 * Контекстная проверка: "без учёта подложки" ≠ "подложка".
 */
const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const path = require("path");

let priceDB = null;
function loadPriceDB() {
  if (priceDB) return priceDB;
  const paths = [
    path.join(process.cwd(), "app", "prices", "price_db.json"),
    path.join(__dirname, "..", "app", "prices", "price_db.json"),
    "/var/task/app/prices/price_db.json",
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
      priceDB = raw.filter(item => {
        if (item.p2 === 0) item.p2 = item.p1;
        return item.p1 > 0;
      });
      console.log("[matcher] Loaded", priceDB.length, "positions");
      return priceDB;
    }
  }
  priceDB = [];
  return priceDB;
}

const K_INF = 1.03;
const K_MSK = {"перегород":1.02,"гкл":1.02,"штукатурк":1.58,"шпакл":1.14,"покраск":1.18,"окраск":1.18,"грунтов":1.75,"обои":1.18,"стяжк":1.17,"ламинат":1.13,"кварцвинил":1.13,"spc":1.13,"плитк":1.15,"керамогранит":1.15,"гидроизол":1.25,"двер":1.14,"демонтаж":1.10,"плинтус":1.13,"подложк":1.13,"минват":1.10};
const K_MSK_DEF = {"отделочные":1.20,"строительные":1.15,"сантехнические":1.15,"электромонтажные":1.15,"вентиляция":1.15};

function getKmsk(name, dir, region) {
  if (region !== "msk" && region !== "mo") return 1.0;
  const nl = name.toLowerCase();
  for (const [k, v] of Object.entries(K_MSK)) {
    if (nl.includes(k)) return region === "mo" ? 1 + (v - 1) * 0.95 : v;
  }
  const d = K_MSK_DEF[dir] || 1.15;
  return region === "mo" ? 1 + (d - 1) * 0.95 : d;
}

const SECTION_RULES = [
  [["гкл","гипсокартон","перегород"],["ГК09"],["ДМ"]],
  [["грунтов"],["СТ01"],["ДМ","ПТ","ГК","КП","ПЛ"]],
  [["шпакл","шпатл"],["СТ01"],["ДМ","ПТ"]],
  [["покраск","окраск"],["СТ01"],["ДМ","ПТ"]],
  [["кварцвинил","spc","lvt"],["ПЛ02"],["КП","СТ","ПТ","ДМ"]],
  [["подложк"],["ПЛ02"],["КП","ДМ","СТ","ГК"]],
  [["плинтус"],["ПЛ02"],["КП","ДМ"]],
  [["плитк","керамогранит"],["КП04"],["ДМ","ПЛ"]],
  [["гидроизол"],["КП04"],["ДМ"]],
  [["двер"],["МД05","ВД06"],["ДМ"]],
  [["минват","минерал","звукоизол"],["ГК09","СТ01"],["ДМ"]],
  [["демонтаж"],["ДМ11"],[]],
];

function getSectionPrefs(wl) {
  const p = [], n = [];
  for (const [kws, prefs, pens] of SECTION_RULES) {
    if (kws.some(k => wl.includes(k))) { p.push(...prefs); n.push(...pens); }
  }
  if (!wl.includes("демонтаж")) n.push("ДМ");
  return [Array.from(new Set(p)), Array.from(new Set(n))];
}

function detectSubject(name) {
  const actionStems = ["устрой","уклад","монтаж","устано","демонт","облицо","вывоз","защит"];
  const selfActions = ["грунто","гидрои","шпакле","шпатле","покрас","окраск"];
  const stops = ["стен","стены","пол","пола","полов","потолк","санузл","помещ","внутр","наруж","несущ","бетон","обеих","сторо","двух","напол","строит","масля","финиш","обмаз","глух","межко","эконо","слоя","слой","класс","толщи","замко","компл"];
  const words = name.toLowerCase().replace(/[(),.\/\-]/g, " ").split(/\s+/);
  for (const w of words) {
    if (w.length <= 2) continue;
    const ws = w.substring(0, 6);
    const ws5 = w.substring(0, 5);
    if (stops.some(s => ws5.startsWith(s.substring(0, 4)))) continue;
    if (selfActions.some(a => ws5.startsWith(a.substring(0, 4)))) return ws;
    if (actionStems.some(a => ws5.startsWith(a.substring(0, 4)))) continue;
    return ws;
  }
  return null;
}

function subjectInName(subject, fullName) {
  const nl = fullName.toLowerCase();
  const ss = subject.length > 5 ? subject.substring(0, 5) : subject;
  let mainPart = nl.includes("(") ? nl.split("(")[0] : nl;
  for (const neg of ["без учёта", "без учета", "не включая", "исключая"]) {
    const idx = mainPart.indexOf(neg);
    if (idx !== -1) mainPart = mainPart.substring(0, idx);
  }
  return mainPart.includes(ss);
}

function stem(word) {
  if (word.length <= 4) return word;
  const suffixes = ["ками","ного","ной","ную","ого","ому","ами","ями","ков","ком","кой","ать","ять","ить","ные","ных","ным","ов","ой","ом","ок","ки","ка","ке","ку","ая","ый","ую","ые","ий","ия","ие","ей","ям","ам","ем","ми","ть"];
  for (const s of suffixes) {
    if (word.endsWith(s) && word.length - s.length >= 3) return word.substring(0, word.length - s.length);
  }
  return word.length > 6 ? word.substring(0, word.length - 2) : word;
}

function extractKeywords(name) {
  const stops = new Set(["для","при","без","или","под","над","шт","компл","работа","работы","слоя","слой","двух","сторон","обеих","каждой","стороны"]);
  const words = name.toLowerCase().replace(/[()×,.\-\/]/g, " ").split(/\s+/).filter(w => w.length > 2 && !stops.has(w));
  const stems = new Set();
  for (const w of words) { stems.add(stem(w)); if (w.length >= 4) stems.add(w.substring(0, 4)); }
  const wl = name.toLowerCase();
  if (!wl.includes("подложк")) {
    if (["spc","кварцвинил","lvt"].some(x => wl.includes(x))) ["кварцвинил","spc","lvt"].forEach(s => stems.add(s));
  }
  if (["минват","минерал"].some(x => wl.includes(x))) ["минерал","звукоизол"].forEach(s => stems.add(s));
  if (wl.includes("гкл")) ["гкл","гипсокартон"].forEach(s => stems.add(s));
  if (wl.includes("шпакл")) ["шпакл","шпатл"].forEach(s => stems.add(s));
  if (wl.includes("грунт")) stems.add("грунтован");
  if (wl.includes("серпянк")) ["серпянк","швов","швы"].forEach(s => stems.add(s));
  return Array.from(stems);
}

function searchCandidates(name, unit, maxResults) {
  const db = loadPriceDB();
  const keywords = extractKeywords(name);
  const [preferred, penalized] = getSectionPrefs(name.toLowerCase());
  const wl = name.toLowerCase();
  const subject = detectSubject(name);

  const scored = [];
  for (const item of db) {
    const nl = item.n.toLowerCase();
    const code = item.c;
    let score = 0;
    for (const kw of keywords) {
      if (nl.includes(kw)) score += kw.length;
      else if (kw.length >= 4 && nl.split(/\s+/).some(w => w.startsWith(kw.substring(0, 4)))) score += kw.length - 1;
    }
    if (subject) {
      if (subjectInName(subject, item.n)) score += 20;
      else score -= 15;
    }
    if (unit && item.u) {
      const u1 = unit.toLowerCase().replace(/[.²³]/g, "");
      const u2 = item.u.toLowerCase().replace(/[.²³]/g, "");
      if (u1 === u2 || u1.includes(u2) || u2.includes(u1)) score += 5;
    }
    if (preferred.length && preferred.some(p => code.startsWith(p))) score += 15;
    if (penalized.length && penalized.some(p => code.startsWith(p))) score -= 20;
    if (wl.includes("2 сло") && nl.includes("2 сло")) score += 10;
    if (name.includes("1200") && (nl.includes("большого формата") || nl.includes("60*120"))) score += 12;
    if (wl.includes("грунтов") && nl.includes("грунтован")) score += 12;
    if (wl.includes("грунтов") && nl.includes("шпаклеван")) score -= 15;
    if (wl.includes("двер") && nl.includes("межкомнатн")) score += 8;
    if (wl.includes("перегород") && nl.includes("перегородк")) score += 12;
    if (score > 0) scored.push({ ...item, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxResults || 10);
}

async function matchWithClaude(workName, workUnit, candidates) {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const list = candidates.map((c, i) => (i + 1) + ". [" + c.c + "] " + c.n + " | " + c.u + " | " + c.p1 + " р.").join("\n");
  try {
    const r = await client.messages.create({
      model: "claude-sonnet-4-6", max_tokens: 10,
      messages: [{ role: "user", content: "Работа из сметы: \"" + workName + "\" (" + workUnit + ")\n\nПозиции справочника:\n" + list + "\n\nКакой номер ЛУЧШЕ ВСЕГО подходит? Только цифра." }],
    });
    const num = parseInt(r.content[0]?.text?.trim() || "0");
    return (num > 0 && num <= candidates.length) ? candidates[num - 1] : candidates[0];
  } catch (err) {
    console.error("[matcher] Claude mini error:", err.message);
    return candidates[0];
  }
}

function applyRate(item, region) {
  if (!item) return { rate: 0, source: "не найден в справочнике" };
  const price = item.p1;
  const kmsk = getKmsk(item.n, item.d, region);
  const rate = Math.round(price * K_INF * kmsk);
  let source = "справочник: " + item.c + ", " + price;
  source += kmsk !== 1.0 ? " * " + K_INF + " * Кмск " + kmsk.toFixed(2) + " = " + rate : " * " + K_INF + " = " + rate;
  return { rate, source };
}

async function matchAllRates(workItems, region) {
  console.log("[matcher] Matching", workItems.length, "items, region:", region);
  const results = [];
  for (const item of workItems) {
    const candidates = searchCandidates(item.name, item.unit);
    console.log("[matcher]", item.name.substring(0, 40), "->", candidates.length, "cands");
    let matched = candidates.length > 0 ? await matchWithClaude(item.name, item.unit, candidates) : null;
    if (matched) console.log("[matcher]  => [" + matched.c + "] " + matched.p1);
    const { rate, source } = applyRate(matched, region);
    results.push({ ...item, work_rate: rate, work_rate_source: source });
  }
  console.log("[matcher] Done:", results.filter(r => r.work_rate > 0).length + "/" + results.length);
  return results;
}

module.exports = { matchAllRates, searchCandidates, K_INF };
