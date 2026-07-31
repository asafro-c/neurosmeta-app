/**
 * POST /api/order
 *
 * Приём заказа: валидация данных, сохранение файлов, создание платежа ЮKassa.
 * Возвращает URL для перенаправления на страницу оплаты.
 *
 * TODO: интеграция с Vercel Blob (файлы) и ЮKassa API (платёж).
 */

import { NextResponse } from "next/server";
const { getPrice } = require("@/lib/tariffs");
const { v4: uuidv4 } = require("uuid");

export async function POST(request) {
  try {
    const formData = await request.formData();

    // Извлекаем данные формы
    const order = {
      clientType: formData.get("clientType"),
      fullName: formData.get("fullName") || "",
      orgName: formData.get("orgName") || "",
      inn: formData.get("inn") || "",
      email: formData.get("email"),
      phone: formData.get("phone"),
      workType: formData.get("workType"),
      region: formData.get("region"),
      area: parseFloat(formData.get("area")),
    };

    // Валидация
    if (!order.clientType || !order.email || !order.workType || !order.region || !order.area) {
      return NextResponse.json({ error: "Заполните все обязательные поля" }, { status: 400 });
    }

    // Проверяем, что физлицо не заказывает строительство
    if (order.clientType === "fiz" && order.workType === "construction") {
      return NextResponse.json({ error: "Строительство доступно только для юрлиц и ИП" }, { status: 400 });
    }

    // Расчёт цены
    const price = getPrice(order.workType, order.area, order.clientType);
    if (!price) {
      return NextResponse.json({ error: "Не удалось определить стоимость" }, { status: 400 });
    }

    // Извлекаем файлы
    const files = [];
    for (const [key, value] of formData.entries()) {
      if (value instanceof File && value.size > 0) {
        files.push({
          name: value.name,
          size: value.size,
          type: value.type,
          slot: key,
        });
      }
    }

    if (files.length < 2) {
      return NextResponse.json({ error: "Загрузите не менее 2 документов" }, { status: 400 });
    }

    // Генерируем orderId
    const orderId = uuidv4();
    const clientName = order.clientType === "fiz" ? order.fullName : order.orgName;

    // TODO: сохранить файлы в Vercel Blob
    // const uploadedFiles = await Promise.all(files.map(f => uploadToBlob(orderId, f)));

    // TODO: создать платёж в ЮKassa
    // const payment = await createYukassaPayment({
    //   amount: { value: price.toFixed(2), currency: "RUB" },
    //   confirmation: { type: "redirect", return_url: `${process.env.NEXT_PUBLIC_SITE_URL}/success` },
    //   description: `Смета НейроСмета — ${clientName}`,
    //   metadata: { orderId, email: order.email, clientName, clientType: order.clientType, workType: order.workType, region: order.region, area: String(order.area), phone: order.phone, inn: order.inn, orgName: order.orgName },
    // });

    // Временная заглушка — возвращаем данные заказа
    return NextResponse.json({
      success: true,
      orderId,
      price,
      clientName,
      // confirmationUrl: payment.confirmation.confirmation_url, // TODO: URL оплаты ЮKassa
      message: `Заказ создан. Стоимость: ${price} ₽. Ожидается подключение ЮKassa.`,
    });

  } catch (err) {
    console.error("[order] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
