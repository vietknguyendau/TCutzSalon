import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Chair — salon appointments", template: "%s · Chair" },
  description: "Keep cutting hair. We'll handle the appointments.",
  applicationName: "Chair",
  appleWebApp: { capable: true, title: "Chair", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#1c1b1a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <Suspense>{children}</Suspense>
      </body>
    </html>
  );
}
