import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { HorizontalScrollController } from "./_components/horizontal-scroll-controller";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? "http://localhost:3000"),
  title: "WB Insight — 俄罗斯店铺经营分析",
  description: "Wildberries 店铺销售、商品、库存与利润数据分析后台。",
  openGraph: {
    title: "WB Insight — 俄罗斯店铺经营分析",
    description: "看清 Wildberries 店铺的销售、商品、库存与利润表现。",
    images: [{ url: "/og.png", width: 1672, height: 941, alt: "WB Insight 俄罗斯店铺经营分析" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "WB Insight — 俄罗斯店铺经营分析",
    description: "看清 Wildberries 店铺的销售、商品、库存与利润表现。",
    images: ["/og.png"],
  },
  icons: { icon: "/favicon.png", shortcut: "/favicon.png" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}<HorizontalScrollController /></body></html>;
}
