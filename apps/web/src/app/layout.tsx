import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BetterBasket",
  description: "Shop from independent sellers on BetterBasket.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
