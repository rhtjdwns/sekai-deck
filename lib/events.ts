// 덱 편성 도우미의 이벤트 선택용 목록 (서버 전용)
import "server-only";
import type { Attr, Unit } from "./master";
import { getMasterFile } from "./recommend";
import type { Region } from "./region";

export type EventStatus = "past" | "current" | "future";

/** 월드 링크 챕터 (챕터마다 주인공 캐릭터가 있음) */
export interface WorldBloomChapter {
  characterId: number;
  chapterNo: number;
  startAt: number;
  endAt: number;
}

export interface EventOption {
  id: number;
  name: string;
  eventType: string;
  startAt: number;
  aggregateAt: number;
  status: EventStatus;
  bonusAttr: Attr | null;
  bonusCharacters: { characterId: number; unit: Unit; color: string }[];
  /** 월드 링크: 캐릭터 챕터 목록 (챕터 순) */
  chapters: WorldBloomChapter[];
  /** 월드 링크 파이널 (특정 캐릭터 챕터가 없음) */
  finale: boolean;
}

interface RawEvent {
  id: number;
  name: string;
  eventType: string;
  startAt: number;
  aggregateAt: number;
  closedAt: number;
}
interface RawDeckBonus {
  eventId: number;
  gameCharacterUnitId?: number;
  cardAttr?: Attr;
}
interface RawCharacterUnit {
  id: number;
  gameCharacterId: number;
  unit: Unit;
  colorCode: string;
}
interface RawWorldBloom {
  eventId: number;
  gameCharacterId?: number;
  worldBloomChapterType: string;
  chapterNo: number;
  chapterStartAt: number;
  chapterEndAt: number;
}

export async function getEventOptions(region: Region = "kr"): Promise<EventOption[]> {
  const [events, bonuses, charUnits, worldBlooms, koEvents] = await Promise.all([
    getMasterFile<RawEvent>("events", region),
    getMasterFile<RawDeckBonus>("eventDeckBonuses", region),
    getMasterFile<RawCharacterUnit>("gameCharacterUnits", region),
    getMasterFile<RawWorldBloom>("worldBlooms", region),
    // 일본 서버도 한국판에 있는 이벤트는 한국어 이름으로
    region === "kr" ? Promise.resolve([] as RawEvent[]) : getMasterFile<RawEvent>("events"),
  ]);
  const koName = new Map(koEvents.map((e) => [e.id, e.name]));
  const now = Date.now();
  const charUnitById = new Map(charUnits.map((cu) => [cu.id, cu]));
  const bonusesByEvent = new Map<number, RawDeckBonus[]>();
  for (const b of bonuses) bonusesByEvent.set(b.eventId, [...(bonusesByEvent.get(b.eventId) ?? []), b]);
  const bloomsByEvent = new Map<number, RawWorldBloom[]>();
  for (const w of worldBlooms) bloomsByEvent.set(w.eventId, [...(bloomsByEvent.get(w.eventId) ?? []), w]);

  return events.map((e) => {
    const list = bonusesByEvent.get(e.id) ?? [];
    const attr = list.find((b) => b.cardAttr && b.gameCharacterUnitId === undefined)?.cardAttr ?? null;
    const charUnitIds = Array.from(
      new Set(
        list
          .filter((b) => b.gameCharacterUnitId !== undefined && b.cardAttr === undefined)
          .map((b) => b.gameCharacterUnitId as number),
      ),
    );
    const blooms = bloomsByEvent.get(e.id) ?? [];
    return {
      id: e.id,
      name: koName.get(e.id) ?? e.name,
      eventType: e.eventType,
      startAt: e.startAt,
      aggregateAt: e.aggregateAt,
      status: e.closedAt < now ? "past" : e.startAt > now ? "future" : "current",
      bonusAttr: attr,
      bonusCharacters: charUnitIds
        .map((id) => charUnitById.get(id))
        .filter((cu): cu is RawCharacterUnit => Boolean(cu))
        .map((cu) => ({ characterId: cu.gameCharacterId, unit: cu.unit, color: cu.colorCode })),
      chapters: blooms
        .filter((w) => w.gameCharacterId !== undefined)
        .sort((a, b) => a.chapterNo - b.chapterNo)
        .map((w) => ({ characterId: w.gameCharacterId!, chapterNo: w.chapterNo, startAt: w.chapterStartAt, endAt: w.chapterEndAt })),
      finale: blooms.some((w) => w.worldBloomChapterType === "finale"),
    };
  });
}
