/**
 * POST /api/generate
 *
 * Основной эндпоинт генерации сметы.
 * Вызывается после подтверждения оплаты (webhook ЮKassa) или вручную для тестирования.
 *
 * Flow: получить заказ → вызвать Claude API → сгенерировать Excel → отправить email.
 */

import { NextResponse } from "next/server";

// Dynamic import для совместимости с Next.js
const { generateEstimate } = require("@/lib/claude");
const { generateExcel } = require("@/lib/excel");
const { sendEstimateToClient, notifyOwner } = require("@/lib/email");
const { getPrice, WORK_TYPE_LABELS, REGION_LABELS } = require("@/lib/tariffs");

// Увеличиваем timeout для Vercel Pro
export const maxDuration = 300; // 5 минут

export async function POST(request) {
  let order;

  try {
    const body = await request.json();
    order = body.order;
    const files = body.files || []; // [{path, name, mimeType}]

    if (!order || !order.email || !order.workType || !order.area) {
      return NextResponse.json({ error: "Неполные данные заказа" }, { status: 400 });
    }

    // 1. Проверка цены
    const expectedPrice = getPrice(order.workType, order.area, order.clientType);
    if (!expectedPrice) {
      return NextResponse.json({ error: "Не удалось определить цену" }, { status: 400 });
    }

    // 2. Уведомление: генерация начата
    await notifyOwner({ ...order, price: expectedPrice, fileCount: files.length }, "paid").catch(console.error);

    // 3. Вызов Claude API
    console.log(`[generate] Starting Claude API call for ${order.email}`);
    const estimateData = await generateEstimate(order, files);
    console.log(`[generate] Claude API response received, sections: ${estimateData.sections?.length}`);

    // 4. Генерация Excel
    const excelBuffer = await generateExcel(estimateData);
    console.log(`[generate] Excel generated, size: ${excelBuffer.length} bytes`);

    // 5. Имя файла
    const workTypeRu = {
      cosmetic: "Косметический_ремонт",
      capital: "Капитальный_ремонт",
      construction: "Строительство",
      landscaping: "Благоустройство",
    };
    const filename = `Смета_${workTypeRu[order.workType] || order.workType}_${order.area}м2.xlsx`;

    // 6. Отправка email заказчику
    const objectDesc = estimateData.meta?.subtitle || `${order.area} м², ${order.region}`;
    await sendEstimateToClient(
      order.email,
      order.clientName || "Заказчик",
      objectDesc,
      excelBuffer,
      filename
    );
    console.log(`[generate] Email sent to ${order.email}`);

    // 7. Уведомление: отправлено
    await notifyOwner({ ...order, price: expectedPrice, fileCount: files.length }, "sent").catch(console.error);

    return NextResponse.json({
      success: true,
      message: `Смета отправлена на ${order.email}`,
      stats: {
        sections: estimateData.sections?.length,
        positions: estimateData.sections?.reduce((s, sec) => s + sec.positions.length, 0),
        rooms: estimateData.rooms?.length,
        fileSize: excelBuffer.length,
      },
    });

  } catch (err) {
    console.error("[generate] Error:", err);

    // Уведомление об ошибке
    if (order) {
      await notifyOwner(
        { ...order, price: 0, fileCount: 0 },
        "error",
        err.message
      ).catch(console.error);
    }

    return NextResponse.json(
      { error: "Ошибка генерации сметы", details: err.message },
      { status: 500 }
    );
  }
}
