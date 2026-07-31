/**
 * Тарифная сетка НейроСмета — утверждённые цены.
 */

const TARIFFS = [
  { type: "cosmetic", maxArea: 50, fiz: 3000, ur: 5500 },
  { type: "cosmetic", maxArea: 100, fiz: 4000, ur: 7000 },
  { type: "cosmetic", maxArea: 200, fiz: 6500, ur: 10000 },
  { type: "capital", maxArea: 50, fiz: 5000, ur: 8000 },
  { type: "capital", maxArea: 100, fiz: 7000, ur: 10000 },
  { type: "capital", maxArea: 200, fiz: 9500, ur: 13000 },
  { type: "capital", maxArea: Infinity, fiz: 12500, ur: 15000 },
  { type: "construction", maxArea: 100, fiz: null, ur: 10000 },
  { type: "construction", maxArea: 200, fiz: null, ur: 14000 },
  { type: "construction", maxArea: 350, fiz: null, ur: 18000 },
  { type: "landscaping", maxArea: 100, fiz: 2500, ur: 5000 },
  { type: "landscaping", maxArea: 500, fiz: 4000, ur: 8000 },
  { type: "landscaping", maxArea: Infinity, fiz: 6000, ur: 11500 },
];

/**
 * @param {string} workType - cosmetic | capital | construction | landscaping
 * @param {number} area - площадь, м²
 * @param {string} clientType - fiz | ip | ur
 * @returns {number|null} цена в рублях или null
 */
function getPrice(workType, area, clientType) {
  if (!workType || !area || area <= 0) return null;
  const isUr = clientType === "ur" || clientType === "ip";
  const rows = TARIFFS.filter((t) => t.type === workType);
  for (const row of rows) {
    if (area <= row.maxArea) {
      return isUr ? row.ur : row.fiz;
    }
  }
  return null;
}

module.exports = { TARIFFS, getPrice };
