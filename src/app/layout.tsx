import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { auth } from "@/auth";
import { Sidebar } from "@/components/layout/sidebar";

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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Session dicek di sini (server-side) untuk memutuskan apakah sidebar
  // perlu dirender. Sengaja pakai SESSION, bukan pathname — supaya
  // konsisten dengan proteksi rute di proxy.ts (middleware) dan otomatis
  // benar untuk halaman publik mana pun ke depannya (bukan cuma /login),
  // tanpa perlu daftar pathname manual yang bisa lupa di-update.
  const session = await auth();

  return (
    <html lang="id">
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased`}
      >
        {session?.user ? (
          <div className="flex h-screen overflow-hidden bg-app-bg">
            <Sidebar
              user={{
                name: session.user.name ?? "User",
                role: session.user.role ?? "-",
              }}
            />
            <main className="flex-1 overflow-y-auto">{children}</main>
          </div>
        ) : (
          // Tidak ada session (mis. sedang di /login, atau belum sempat
          // redirect) → render children apa adanya, full-screen tanpa
          // sidebar.
          children
        )}
      </body>
    </html>
  );
}