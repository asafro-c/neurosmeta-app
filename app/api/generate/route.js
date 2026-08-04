import { NextResponse } from "next/server";
import { generateEstimate } from "@/lib/claude";
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

    const files = filesInput.map((f) => ({
      name: f.name,
      mimeType: f.mimeType || "application/pdf",
      data: f.data || null,
      path: f.path || null,
    }));

    console.log("[generate] Starting Claude API call for", order.email, "files:", files.length);
    const estimateData = await generateEstimate(order, files);
    console.log("[generate] Claude response received, sections:", estimateData.sections?.length);

    const excelBuffer = await generateExcel(estimateData);
    console.log("[generate] Excel generated, size:", excelBuffer.length, "bytes");

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
        positions: estimateData.sections?.reduce((s, sec) => s + sec.positions.length, 0),
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
