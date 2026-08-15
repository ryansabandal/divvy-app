import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Editorial serif used only for heading accents (see .heading-accent / .heading-title in
// globals.css). Non-variable single-weight family, so `weight` is required — omitting it
// is a build-time error, not a silent fallback. Italic must be requested explicitly.
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Divvy",
  description: "Split bills with friends, no login required",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Sticky branded header — stays visible as users scroll through long expense lists */}
        <header className="sticky top-0 z-10 flex items-center bg-navy px-4 py-3 shadow-sm">
          <span className="text-xl font-bold tracking-tight text-white">Divvy</span>
        </header>
        {children}
      </body>
    </html>
  );
}
