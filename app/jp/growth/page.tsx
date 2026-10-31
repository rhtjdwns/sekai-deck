import type { Metadata } from "next";
import { getGrowthMaster } from "@/lib/growth";
import { getMasterSnapshot } from "@/lib/master";
import GrowthEditor from "../../growth/GrowthEditor";
import "../../growth/growth.css";

export const metadata: Metadata = { title: "내실 (일본 서버) | 세카이 덱 짜기" };

// 한 번 만든 화면을 계속 재사용하고, 오후 3시·8시(한국 시간)에만 새로 만듦 (lib/refreshSchedule.ts)
export const revalidate = false;

export default async function JpGrowthPage() {
  const { characters, units, event } = await getMasterSnapshot("jp");
  const master = await getGrowthMaster(event?.id, "jp");
  return <GrowthEditor characters={characters} units={units} master={master} />;
}
