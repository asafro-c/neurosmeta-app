import { NextResponse } from "next/server";
import { generateEstimate } from "@/lib/claude";

export const maxDuration = 300;

export async function POST(request) {
  try {
    const body = await request.json();
    const order = body.order;
    const filesInput = body.files || [];

    if (!order || !order.workType || !order.area) {
      return NextResponse.json({ error: "Неполные данные" }, { status: 400 });
    }

    const files = filesInput.map(f => ({
      name: f.name,
      mimeType: f.mimeType || "application/pdf",
      data: f.data || null,
    }));

    console.log("[stage1] Claude API — files:", files.length);
    const estimateData = await generateEstimate(order, files);
    const posCount = (estimateData.sections || []).reduce((s, sec) => s + (sec.positions || []).length, 0);
    console.log("[stage1] Done. Sections:", estimateData.sections?.length, "Positions:", posCount);

    return NextResponse.json({ success: true, estimateData });
  } catch (err) {
    console.error("[stage1] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
