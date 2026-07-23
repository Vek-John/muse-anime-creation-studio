import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MUSE — 二次元文生图创作台",
  description:
    "面向二次元 Diffusion 创作的结构化提示词与参数配置前端框架。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
