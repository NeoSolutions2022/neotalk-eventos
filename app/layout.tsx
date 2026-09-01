import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") || "localhost:3000";
  const protocol = host.includes("localhost") ? "http" : "https";
  const baseUrl = `${protocol}://${host}`;
  return {
    metadataBase: new URL(baseUrl),
    title: "NeoTalk Eventos — Central de traduções",
    description: "Gerencie traduções em Libras, horas de uso e players acessíveis em um só lugar.",
    icons: { icon: "/neotalk-logo.png" },
    openGraph: {
      title: "NeoTalk Eventos",
      description: "Tradução acessível, em tempo real.",
      images: [`${baseUrl}/og.png`],
    },
    twitter: { card: "summary_large_image", images: [`${baseUrl}/og.png`] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body className={inter.variable}>{children}</body></html>;
}
