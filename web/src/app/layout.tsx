import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { BottomNav } from "@/components/BottomNav";
import { Header } from "@/components/Header";
import { Providers } from "./providers";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans-face" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono-face" });

export const metadata: Metadata = {
  title: "Metronome",
  description: "Sandwich-proof trading on Monad: every block is a fair batch auction.",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Metronome" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#07060c" },
    { media: "(prefers-color-scheme: light)", color: "#f6f5fb" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="font-sans antialiased">
        <Providers>
          <div className="mx-auto flex min-h-dvh max-w-md flex-col">
            <Header />
            <main className="flex-1 px-4 pb-32 pt-3">{children}</main>
            <BottomNav />
          </div>
        </Providers>
      </body>
    </html>
  );
}
