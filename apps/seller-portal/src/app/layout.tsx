import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BetterBasket Seller Portal",
  description: "Manage your store, products, orders, and payouts.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
