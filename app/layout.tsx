import type { Metadata } from "next";
import { IBM_Plex_Sans_KR } from "next/font/google";
import SiteNav from "./SiteNav";
import Tutorial from "./Tutorial";
import "./globals.css";

const plex = IBM_Plex_Sans_KR({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "세카이 덱 메이커",
  description: "프로젝트 세카이 한국 서버·일본 서버 보유 카드로 이벤트 덱 짜기",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className={plex.className}>
        <SiteNav />
        {children}
        <Tutorial />
      </body>
    </html>
  );
}
