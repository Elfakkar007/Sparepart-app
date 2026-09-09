import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Expose sebagai --font-sans, match dengan token --font-sans di globals.css
// (@theme). Class ini di-attach ke <body>, jadi nilainya override fallback
// literal "Inter", sans-serif yang didefinisikan di @theme untuk elemen
// di dalam <body>.
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

// Expose sebagai --font-mono, dipakai lewat utility class `font-mono`
// (dipakai khusus untuk kolom Item Code di halaman sparepart).
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Sparepart App",
  description: "Manajemen stok sparepart per line",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased`}
      >
        {children}
      </body>
    </html>
  );
}