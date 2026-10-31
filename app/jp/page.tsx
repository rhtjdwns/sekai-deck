import type { Metadata } from "next";
import HomeView from "../HomeView";

export const metadata: Metadata = { title: "세카이 덱 짜기 (일본 서버)" };

// 한 번 만든 화면을 계속 재사용하고, 오후 3시·8시(한국 시간)에만 새로 만듦 (lib/refreshSchedule.ts)
export const revalidate = false;

export default function JpHome() {
  return <HomeView region="jp" />;
}
