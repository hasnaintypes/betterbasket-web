import type { Metadata } from "next";
import { AppProviders } from "@betterbasket/ui/providers/app-providers";
import { VerificationBanner } from "@/components/verification-banner";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: "BetterBasket",
  description: "Shop from independent sellers on BetterBasket.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-background text-foreground antialiased">
        <AppProviders apiUrl={process.env.NEXT_PUBLIC_API_URL}>
          <VerificationBanner />
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
