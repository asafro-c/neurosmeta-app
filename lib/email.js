/**
 * Отправка email через Яндекс SMTP.
 * - Смета заказчику
 * - Уведомление исполнителю
 */

const nodemailer = require("nodemailer");

function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.yandex.ru",
    port: parseInt(process.env.SMTP_PORT || "465"),
    secure: true,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

/**
 * Отправка сметы заказчику.
 * @param {string} to - email заказчика
 * @param {string} clientName - ФИО или наименование
 * @param {string} objectDesc - описание объекта
 * @param {Buffer} excelBuffer - файл сметы
 * @param {string} filename - имя файла
 */
async function sendEstimateToClient(to, clientName, objectDesc, excelBuffer, filename) {
  const transport = createTransport();

  await transport.sendMail({
    from: `"НейроСмета" <${process.env.SMTP_USER}>`,
    to,
    subject: `Смета готова — ${objectDesc}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px;">
        <h2 style="color: #2F5496;">Ваша смета готова</h2>
        <p>Здравствуйте, ${clientName}!</p>
        <p>Смета по объекту <strong>«${objectDesc}»</strong> подготовлена и прикреплена к этому письму в формате Excel.</p>
        <p>Файл содержит 4 листа:</p>
        <ul>
          <li><strong>Смета</strong> — позиции работ с разделением на стоимость работ и материалов</li>
          <li><strong>ВОР</strong> — ведомость объёмов работ</li>
          <li><strong>Материалы</strong> — ведомость материалов с ценами поставщиков</li>
          <li><strong>Расчёт площадей</strong> — расчёт площадей помещений</li>
        </ul>
        <p>Все цены актуальны на дату составления сметы. Срок действия цен — 30 календарных дней.</p>
        <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
        <p style="color: #888; font-size: 12px;">
          НейроСмета · neurosmeta.pro<br>
          Сафро Алексей Яковлевич · ИНН 780216329302<br>
          Методология зарегистрирована в РЦИС РФ, свидетельство № 0021-716-491<br>
          Email: aleksey.safro@yandex.ru · Telegram: @a_safro
        </p>
      </div>
    `,
    attachments: [
      {
        filename,
        content: excelBuffer,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    ],
  });
}

/**
 * Уведомление исполнителю об оплате и генерации.
 * @param {Object} order - данные заказа
 * @param {string} status - "paid" | "generated" | "sent" | "error"
 * @param {string} [error] - текст ошибки
 */
async function notifyOwner(order, status, error) {
  const transport = createTransport();

  const statusLabels = {
    paid: "💰 Оплата получена",
    generated: "📊 Смета сгенерирована",
    sent: "✅ Смета отправлена заказчику",
    error: "❌ Ошибка генерации",
  };

  await transport.sendMail({
    from: `"НейроСмета" <${process.env.SMTP_USER}>`,
    to: process.env.NOTIFY_EMAIL,
    subject: `[НейроСмета] ${statusLabels[status] || status}`,
    html: `
      <div style="font-family: Arial, sans-serif;">
        <h3>${statusLabels[status] || status}</h3>
        <table style="border-collapse: collapse;">
          <tr><td style="padding: 4px 12px; color: #888;">Заказчик:</td><td style="padding: 4px 12px;"><strong>${order.clientName}</strong></td></tr>
          <tr><td style="padding: 4px 12px; color: #888;">Email:</td><td style="padding: 4px 12px;">${order.email}</td></tr>
          <tr><td style="padding: 4px 12px; color: #888;">Контакт:</td><td style="padding: 4px 12px;">${order.phone}</td></tr>
          <tr><td style="padding: 4px 12px; color: #888;">Тип работ:</td><td style="padding: 4px 12px;">${order.workType}</td></tr>
          <tr><td style="padding: 4px 12px; color: #888;">Регион:</td><td style="padding: 4px 12px;">${order.region}</td></tr>
          <tr><td style="padding: 4px 12px; color: #888;">Площадь:</td><td style="padding: 4px 12px;">${order.area} м²</td></tr>
          <tr><td style="padding: 4px 12px; color: #888;">Сумма:</td><td style="padding: 4px 12px;"><strong>${order.price} ₽</strong></td></tr>
          <tr><td style="padding: 4px 12px; color: #888;">Документов:</td><td style="padding: 4px 12px;">${order.fileCount} шт.</td></tr>
          ${error ? `<tr><td style="padding: 4px 12px; color: red;">Ошибка:</td><td style="padding: 4px 12px; color: red;">${error}</td></tr>` : ""}
        </table>
      </div>
    `,
  });
}

module.exports = { sendEstimateToClient, notifyOwner };
