import type { Metadata, Viewport } from "next";
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/newsreader/opsz-italic.css";
import "@fontsource-variable/inter/wght.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "subscan · your money, handled",
  description: "Manage your stablecoins, set money rules and schedule transfers to wallets you trust.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { themeColor: "#f6f2e9", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
