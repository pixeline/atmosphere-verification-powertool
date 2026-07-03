import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vidi",
  description: "Trusted Verifier tool for Mu",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
