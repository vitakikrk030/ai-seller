import './globals.css';

export const metadata = {
  title: 'AI Seller',
  description: 'Telegram relay chat',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
