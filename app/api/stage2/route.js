import { NextResponse } from "next/server";
import { matchAllRates } from "@/lib/price-matcher";

export const maxDuration = 300;

export async function POST(request) {
  try {
    const { estimateData, region } = await request.json();

    if (!estimateData || !estimateData.sections) {
      return NextResponse.json({ error: "Нет данных сметы" }, { status: 400 });
    }

    console.log("[stage2] Matching work rates, region:", region);

    const allWorkItems = [];
    for (const section of estimateData.sections) {
      for (const pos of section.positions || []) {
        allWorkItems.push({ name: pos.name, unit: pos.unit, qty: pos.qty });
      }
    }

    const matched = await matchAllRates(allWorkItems, region);

    let idx = 0;
    for (const section of estimateData.sections) {
      for (const pos of section.positions || []) {
        if (idx < matched.length) {
          pos.work_rate = matched[idx].work_rate;
          pos.work_rate_source = matched[idx].work_rate_source;
          idx++;
        }
      }
    }

    const ok = matched.filter(m => m.work_rate > 0).length;
    console.log("[stage2] Done:", ok + "/" + matched.length);

    return NextResponse.json({ success: true, estimateData, matched: ok, total: matched.length });
  } catch (err) {
    console.error("[stage2] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
