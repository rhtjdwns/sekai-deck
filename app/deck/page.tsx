import type { Metadata } from "next";
import { getEventOptions } from "@/lib/events";
import { getMasterSnapshot } from "@/lib/master";
import { getSongOptions } from "@/lib/songs";
import DeckHelper from "./DeckHelper";
import "./deck.css";

export const metadata: Metadata = { title: "덱 편성 도우미 | 세카이 덱 메이커" };

// 한 번 만든 화면을 계속 재사용하고, 오후 3시·8시(한국 시간)에만 새로 만듦 (lib/refreshSchedule.ts)
export const revalidate = false;

export default async function DeckPage() {
  const [snapshot, songs, events] = await Promise.all([getMasterSnapshot(), getSongOptions(), getEventOptions()]);

  return <DeckHelper snapshot={snapshot} songs={songs} events={events} />;
}
