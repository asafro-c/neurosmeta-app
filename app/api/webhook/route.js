/**
 * POST /api/webhook
 *
 * Webhook от ЮKassa: подтверждение оплаты.
 * После получения payment.succeeded → запускает генерацию сметы.
 *
 * TODO: подключить после получения ключей ЮKassa.
 */

import { NextResponse } from "next/server";

export async function POST(request) {
  try {
    const body = await request.json();

    // ЮKassa отправляет event в формате:
    // { type: "notification", event: "payment.succeeded", object: { id, status, amount, metadata, ... } }
    const event = body.event;
    const payment = body.object;

    if (event !== "payment.succeeded") {
      return NextResponse.json({ ok: true, message: "Событие не обрабатывается" });
    }

    console.log(`[webhook] Payment succeeded: ${payment.id}, amount: ${payment.amount?.value} ${payment.amount?.currency}`);

    // Из metadata достаём данные заказа (вкладывали при создании платежа)
    const meta = payment.metadata || {};
    const order = {
      email: meta.email,
      clientName: meta.clientName,
      clientType: meta.clientType,
      workType: meta.workType,
      region: meta.region,
      area: parseFloat(meta.area),
      phone: meta.phone,
      inn: meta.inn || "",
      orgName: meta.orgName || "",
    };

    // Файлы хранятся в Vercel Blob по orderId
    const orderId = meta.orderId;
    // TODO: загрузить файлы из Vercel Blob по orderId

    // Запускаем генерацию через внутренний вызов
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
    const generateResponse = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order,
        files: [], // TODO: передать файлы из хранилища
      }),
    });

    const result = await generateResponse.json();
    console.log(`[webhook] Generation result:`, result);

    return NextResponse.json({ ok: true, result });

  } catch (err) {
    console.error("[webhook] Error:", err);
    // ЮKassa ожидает 200, иначе повторит webhook
    return NextResponse.json({ ok: false, error: err.message });
  }
}
