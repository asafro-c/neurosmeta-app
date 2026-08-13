import { NextResponse } from "next/server";
import { updateMaterialPrices } from "@/lib/material-prices";

export const maxDuration = 300;

export async function POST(request) {
  try {
    const { estimateData, region } = await request.json();

    if (!estimateData || !estimateData.sections) {
      return NextResponse.json({ error: "Нет данных сметы" }, { status: 400 });
    }

    console.log("[stage3] Material price lookup, region:", region);
    const updated = await updateMaterialPrices(estimateData, region);
    console.log("[stage3] Done.");

    return NextResponse.json({ success: true, estimateData: updated });
  } catch (err) {
    console.error("[stage3] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
