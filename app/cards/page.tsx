import type { Metadata } from "next";
import { getMasterSnapshot } from "@/lib/master";
import CardBrowser from "../CardBrowser";
import "./cards.css";

export const metadata: Metadata = { title: "보유 카드 체크하기 | 세카이 덱 짜기" };

// 한 번 만든 화면을 계속 재사용하고, 오후 3시·8시(한국 시간)에만 새로 만듦 (lib/refreshSchedule.ts)
export const revalidate = false;

export default async function CardsPage() {
  const snapshot = await getMasterSnapshot();
  return <CardBrowser snapshot={snapshot} />;
}
