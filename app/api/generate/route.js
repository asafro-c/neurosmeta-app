/**
 * POST /api/generate — четырёхэтапная генерация сметы.
 *
 * Этап 1: Claude анализирует документы → JSON (работы + материалы, work_rate=0, цены ориентировочные)
 * Этап 2: Сервер + Claude мини → подбор расценок на работы из справочника
 * Этап 3: Claude + web_search → поиск актуальных цен на материалы в petrovich.ru
 * Этап 4: Сервер → сборка Excel → отправка email
 */

import { NextResponse } from "next/server";
import { generateEstimate } from "@/lib/claude";
import { matchAllRates } from "@/lib/price-matcher";
import { updateMaterialPrices } from "@/lib/material-prices";
import { generateExcel } from "@/lib/excel";
import { sendEstimateToClient, notifyOwner } from "@/lib/email";
import { getPrice } from "@/lib/tariffs";

export const maxDuration = 300;

export async function POST(request) {
  let order;
  try {
    const body = await request.json();
    order = body.order;
    const filesInput = body.files || [];

    if (!order || !order.email || !order.workType || !order.area) {
      return NextResponse.json({ error: "Неполные данные заказа" }, { status: 400 });
    }

    const expectedPrice = getPrice(order.workType, order.area, order.clientType);
    await notifyOwner({ ...order, price: expectedPrice || 0, fileCount: filesInput.length }, "paid").catch(console.error);

    const files = filesInput.map(f => ({
      name: f.name,
      mimeType: f.mimeType || "application/pdf",
      data: f.data || null,
      path: f.path || null,
    }));

    // ===== ЭТАП 1: Claude анализирует документы =====
    console.log("[generate] ЭТАП 1: Claude API — анализ документов, files:", files.length);
    const estimateData = await generateEstimate(order, files);
    const posCount = (estimateData.sections || []).reduce((s, sec) => s + (sec.positions || []).length, 0);
    console.log("[generate] ЭТАП 1 done. Sections:", estimateData.sections?.length, "Positions:", posCount);

    // ===== ЭТАП 2: Подбор расценок из справочника =====
    console.log("[generate] ЭТАП 2: Matching work rates");
    const allWorkItems = [];
    for (const section of estimateData.sections || []) {
      for (const pos of section.positions || []) {
        allWorkItems.push({ name: pos.name, unit: pos.unit, qty: pos.qty });
      }
    }
    const matchedItems = await matchAllRates(allWorkItems, order.region);
    let matchIdx = 0;
    for (const section of estimateData.sections || []) {
      for (const pos of section.positions || []) {
        if (matchIdx < matchedItems.length) {
          pos.work_rate = matchedItems[matchIdx].work_rate;
          pos.work_rate_source = matchedItems[matchIdx].work_rate_source;
          matchIdx++;
        }
      }
    }
    const rateOk = matchedItems.filter(m => m.work_rate > 0).length;
    console.log("[generate] ЭТАП 2 done. Rates matched:", rateOk + "/" + matchedItems.length);

    // ===== ЭТАП 3: Поиск актуальных цен на материалы =====
    console.log("[generate] ЭТАП 3: Material price lookup via web_search");
    await updateMaterialPrices(estimateData, order.region);
    console.log("[generate] ЭТАП 3 done.");

    // ===== ЭТАП 4: Генерация Excel и отправка =====
    const excelBuffer = await generateExcel(estimateData);
    console.log("[generate] Excel:", excelBuffer.length, "bytes");

    const workTypeRu = { cosmetic: "Косметический_ремонт", capital: "Капитальный_ремонт", construction: "Строительство", landscaping: "Благоустройство" };
    const filename = "Смета_" + (workTypeRu[order.workType] || order.workType) + "_" + order.area + "м2.xlsx";
    const objectDesc = estimateData.meta?.subtitle || order.area + " м², " + order.region;

    await sendEstimateToClient(order.email, order.clientName || "Заказчик", objectDesc, excelBuffer, filename);
    console.log("[generate] Email sent to", order.email);

    await notifyOwner({ ...order, price: expectedPrice || 0, fileCount: files.length }, "sent").catch(console.error);

    return NextResponse.json({
      success: true,
      message: "Смета отправлена на " + order.email,
      stats: {
        sections: estimateData.sections?.length,
        positions: posCount,
        matched_rates: rateOk,
        rooms: estimateData.rooms?.length,
        fileSize: excelBuffer.length,
      },
    });
  } catch (err) {
    console.error("[generate] Error:", err);
    if (order) {
      await notifyOwner({ ...order, price: 0, fileCount: 0 }, "error", err.message).catch(console.error);
    }
    return NextResponse.json({ error: "Ошибка генерации", details: err.message }, { status: 500 });
  }
}
