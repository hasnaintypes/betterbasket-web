import type { Metadata } from "next";
import { AppProviders } from "@betterbasket/ui/providers/app-providers";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "BetterBasket Seller Portal",
  description: "Manage your store, products, orders, and payouts.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-background text-foreground antialiased">
        <AppProviders apiUrl={process.env.NEXT_PUBLIC_API_URL}>{children}</AppProviders>
      </body>
    </html>
  );
}
