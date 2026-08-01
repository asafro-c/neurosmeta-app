export const metadata = {
  title: "НейроСмета — заказ сметы онлайн",
  description: "Подготовка сметной документации на основе рыночных цен",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
