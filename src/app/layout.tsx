import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "تماشای همزمان | Watch Party",
  description: "با دوستانتان به صورت همزمان فیلم و ویدیو تماشا کنید. چت آنلاین، هماهنگ‌سازی ویدیو و اشتراک‌گذاری لینک.",
  icons: { icon: "/favicon.ico" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl" className="h-full antialiased" data-scroll-behavior="smooth">
      <body className="min-h-full flex flex-col bg-[var(--bg-deep)]">{children}</body>
    </html>
  );
}
