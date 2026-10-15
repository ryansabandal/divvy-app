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

// Editorial serif used only for user-supplied titles (see .heading-title in globals.css),
// always upright. Non-variable single-weight family, so `weight` is required — omitting it
// is a build-time error, not a silent fallback.
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  weight: "400",
  style: ["normal"],
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
      // scroll-pt-16: scrolled-to targets stop below the sticky header instead of under it
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} h-full scroll-pt-16 antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Sticky branded header — stays visible as users scroll through long expense lists.
            Stacking: dragged expense card z-10 < header z-20 < QR overlay z-50 */}
        <header className="header-material sticky top-0 z-20 flex items-center px-4 py-3 shadow-(--shadow-sm)">
          <span className="text-xl font-bold tracking-tight text-white">Divvy</span>
        </header>
        {children}
      </body>
    </html>
  );
}
