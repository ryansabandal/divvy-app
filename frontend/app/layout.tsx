import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
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
