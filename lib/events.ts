// 덱 편성 도우미의 이벤트 선택용 목록 (서버 전용)
import "server-only";
import type { Attr, Unit } from "./master";
import { getMasterFile } from "./recommend";
import type { Region } from "./region";

export type EventStatus = "past" | "current" | "future";

export interface EventOption {
  id: number;
  name: string;
  eventType: string;
  startAt: number;
  aggregateAt: number;
  status: EventStatus;
  bonusAttr: Attr | null;
  bonusCharacters: { characterId: number; unit: Unit; color: string }[];
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

export async function getEventOptions(region: Region = "kr"): Promise<EventOption[]> {
  const [events, bonuses, charUnits, koEvents] = await Promise.all([
    getMasterFile<RawEvent>("events", region),
    getMasterFile<RawDeckBonus>("eventDeckBonuses", region),
    getMasterFile<RawCharacterUnit>("gameCharacterUnits", region),
    // 일본 서버도 한국판에 있는 이벤트는 한국어 이름으로
    region === "kr" ? Promise.resolve([] as RawEvent[]) : getMasterFile<RawEvent>("events"),
  ]);
  const koName = new Map(koEvents.map((e) => [e.id, e.name]));
  const now = Date.now();
  const charUnitById = new Map(charUnits.map((cu) => [cu.id, cu]));
  const bonusesByEvent = new Map<number, RawDeckBonus[]>();
  for (const b of bonuses) bonusesByEvent.set(b.eventId, [...(bonusesByEvent.get(b.eventId) ?? []), b]);

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
    };
  });
}
