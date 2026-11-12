import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SiteHeader } from "@/components/site-header";
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
  title: "NHL Goalscorer Model",
  description: "A daily 3-leg NHL player parlay from a transparent goals, points and shots model. Probabilities, not advice.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <SiteHeader />
        <div className="mx-auto flex w-full max-w-xl flex-1 flex-col px-4 py-5">{children}</div>
        <footer className="mx-auto w-full max-w-xl px-4 pb-8 text-xs text-muted">
          Model probabilities, not advice.
        </footer>
      </body>
    </html>
  );
}
