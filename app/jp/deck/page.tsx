import type { Metadata } from "next";
import { getEventOptions } from "@/lib/events";
import { getMasterSnapshot } from "@/lib/master";
import { getSongOptions } from "@/lib/songs";
import DeckHelper from "../../deck/DeckHelper";
import "../../deck/deck.css";

export const metadata: Metadata = { title: "덱 편성 도우미 (일본 서버) | 세카이 덱 짜기" };

// 한 번 만든 화면을 계속 재사용하고, 오후 3시·8시(한국 시간)에만 새로 만듦 (lib/refreshSchedule.ts)
export const revalidate = false;

export default async function JpDeckPage() {
  const [snapshot, songs, events] = await Promise.all([
    getMasterSnapshot("jp"),
    getSongOptions("jp"),
    getEventOptions("jp"),
  ]);
  return <DeckHelper snapshot={snapshot} songs={songs} events={events} />;
}
