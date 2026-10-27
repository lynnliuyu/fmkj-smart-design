import type { Metadata } from "next";
import localFont from "next/font/local";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/lib/i18n";

// 用仓库里的 Inter（可变字体，latin 子集）：
// 1) 构建不再需要访问 Google，国内网络与离线环境都能出包；
// 2) 页面不再依赖外部字体 CDN，客户设备断网时外观一致。
const fontSans = localFont({
  src: "./fonts/inter-latin.woff2",
  variable: "--font-sans",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "FMKJ 项目管理",
  description: "项目流程、产品库、方案报价与团队协作后台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning className={`${fontSans.variable} bg-background`}>
      <body className="antialiased">
        <ThemeProvider>
          <I18nProvider>
            <TooltipProvider>{children}</TooltipProvider>
          </I18nProvider>
          <Toaster />
        </ThemeProvider>
        {process.env.VERCEL === "1" ? <SpeedInsights /> : null}
      </body>
    </html>
  );
}
