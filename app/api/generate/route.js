/**
 * POST /api/generate — трёхэтапная генерация сметы.
 *
 * Этап 1: Claude анализирует документы → JSON (работы с объёмами + материалы с ценами, work_rate=0)
 * Этап 2: Сервер + Claude мини-запрос → подбор расценок из справочника
 * Этап 3: Сервер → подстановка цен × Кинф × Кмск → Excel → email
 */

import { NextResponse } from "next/server";
import { generateEstimate } from "@/lib/claude";
import { matchAllRates } from "@/lib/price-matcher";
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

    // ========== ЭТАП 1: Claude анализирует документы ==========
    console.log("[generate] ЭТАП 1: Claude API call for", order.email, "files:", files.length);
    const estimateData = await generateEstimate(order, files);
    console.log("[generate] ЭТАП 1 done. Sections:", estimateData.sections?.length);

    // ========== ЭТАП 2-3: Подбор расценок из справочника ==========
    console.log("[generate] ЭТАП 2-3: Matching work rates from price DB");
    
    // Собираем все позиции работ
    const allWorkItems = [];
    for (const section of estimateData.sections || []) {
      for (const pos of section.positions || []) {
        allWorkItems.push({
          sectionName: section.name,
          num: pos.num,
          name: pos.name,
          unit: pos.unit,
          qty: pos.qty,
        });
      }
    }

    // Матчим расценки
    const matchedItems = await matchAllRates(allWorkItems, order.region);

    // Подставляем расценки обратно в estimateData
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

    const matchedCount = matchedItems.filter(m => m.work_rate > 0).length;
    const totalCount = matchedItems.length;
    console.log("[generate] ЭТАП 2-3 done. Matched:", matchedCount, "/", totalCount);

    // ========== ГЕНЕРАЦИЯ EXCEL ==========
    const excelBuffer = await generateExcel(estimateData);
    console.log("[generate] Excel generated:", excelBuffer.length, "bytes");

    // ========== ОТПРАВКА EMAIL ==========
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
        positions: totalCount,
        matched_rates: matchedCount,
        unmatched_rates: totalCount - matchedCount,
        rooms: estimateData.rooms?.length,
        fileSize: excelBuffer.length,
      },
    });
  } catch (err) {
    console.error("[generate] Error:", err);
    if (order) {
      await notifyOwner({ ...order, price: 0, fileCount: 0 }, "error", err.message).catch(console.error);
    }
    return NextResponse.json({ error: "Ошибка генерации сметы", details: err.message }, { status: 500 });
  }
}
