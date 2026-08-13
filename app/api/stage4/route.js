import { NextResponse } from "next/server";
import { generateExcel } from "@/lib/excel";
import { sendEstimateToClient, notifyOwner } from "@/lib/email";
import { getPrice } from "@/lib/tariffs";

export const maxDuration = 60;

export async function POST(request) {
  try {
    const { estimateData, order } = await request.json();

    if (!estimateData || !order || !order.email) {
      return NextResponse.json({ error: "Нет данных" }, { status: 400 });
    }

    console.log("[stage4] Generating Excel...");
    const excelBuffer = await generateExcel(estimateData);
    console.log("[stage4] Excel:", excelBuffer.length, "bytes");

    const workTypeRu = { cosmetic: "Косметический_ремонт", capital: "Капитальный_ремонт", construction: "Строительство", landscaping: "Благоустройство" };
    const filename = "Смета_" + (workTypeRu[order.workType] || "Ремонт") + "_" + order.area + "м2.xlsx";
    const objectDesc = estimateData.meta?.subtitle || order.area + " м²";

    await sendEstimateToClient(order.email, order.clientName || "Заказчик", objectDesc, excelBuffer, filename);
    console.log("[stage4] Email sent to", order.email);

    const price = getPrice(order.workType, order.area, order.clientType);
    await notifyOwner({ ...order, price: price || 0, fileCount: 0 }, "sent").catch(console.error);

    const posCount = (estimateData.sections || []).reduce((s, sec) => s + (sec.positions || []).length, 0);

    return NextResponse.json({
      success: true,
      message: "Смета отправлена на " + order.email,
      stats: {
        sections: estimateData.sections?.length,
        positions: posCount,
        rooms: estimateData.rooms?.length,
        fileSize: excelBuffer.length,
      },
    });
  } catch (err) {
    console.error("[stage4] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
