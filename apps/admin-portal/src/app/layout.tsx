import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BetterBasket Admin",
  description: "Platform administration: sellers, users, orders, and moderation.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
