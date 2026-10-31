// 내실 화면에 필요한 마스터 데이터 (서버 전용)
import "server-only";
import type { Attr, Unit } from "./master";
import { getMasterFile } from "./recommend";
import type { Region } from "./region";

interface RawAreaItem {
  id: number;
  areaId: number;
  name: string;
}
interface RawAreaItemLevel {
  areaItemId: number;
  level: number;
  targetUnit: Unit | "any";
  targetCardAttr: Attr | "any";
  targetGameCharacterId?: number;
  power1BonusRate: number;
  power1AllMatchBonusRate: number;
}
interface RawGate {
  id: number;
  unit: Unit;
  name: string;
}
interface RawGateLevel {
  mysekaiGateId: number;
  level: number;
  powerBonusRate: number;
}

export type AreaItemGroup = "character" | "unit" | "attr";

export interface AreaItemInfo {
  id: number;
  name: string;
  group: AreaItemGroup;
  characterId?: number;
  unit?: Unit;
  attr?: Attr;
  maxLevel: number;
  /** 레벨별 보너스(%) — index = 레벨, 0은 미보유 */
  rates: number[];
  /** 유닛·속성이 모두 맞을 때 보너스(%) */
  allMatchRates: number[];
}

export interface GateInfo {
  id: number;
  unit: Unit;
  name: string;
  maxLevel: number;
  rates: number[];
}

export interface HonorInfo {
  id: number;
  name: string;
  /** 칭호 묶음 이름 (같은 이름의 칭호가 여러 개일 때 구분용) */
  groupName: string;
  levels: { level: number; bonus: number; description: string }[];
}

export interface EventHonorInfo {
  honorId: number;
  name: string;
  description: string;
  leaderCharacterId: number;
  bonusRate: number;
}

export interface GrowthMaster {
  areaItems: AreaItemInfo[];
  gates: GateInfo[];
  /** 종합력 보너스가 있는 칭호 */
  honors: HonorInfo[];
  /** 현재 이벤트에서 리더 캐릭터에 따라 이벤트 보너스를 주는 칭호 */
  eventHonors: EventHonorInfo[];
  /** 캐릭터 랭크별 종합력 보너스(%), 인덱스 = 랭크. 모든 캐릭터가 같은 표를 씀 */
  characterRankRates: number[];
  /** 한국판 캐릭터 랭크 최대값 */
  maxCharacterRank: number;
}

interface RawHonor {
  id: number;
  seq: number;
  groupId: number;
  name: string;
  levels?: { level: number; bonus: number; description: string; startAt?: number }[];
}
interface RawEventHonorBonus {
  eventId: number;
  honorId: number;
  leaderGameCharacterId: number;
  bonusRate: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

export async function getGrowthMaster(eventId?: number, region: Region = "kr"): Promise<GrowthMaster> {
  const [items, levels, gates, gateLevels, rawHonors, honorGroups, eventHonorBonuses, characterRanks] = await Promise.all([
    getMasterFile<RawAreaItem>("areaItems", region),
    getMasterFile<RawAreaItemLevel>("areaItemLevels", region),
    getMasterFile<RawGate>("mysekaiGates", region),
    getMasterFile<RawGateLevel>("mysekaiGateLevels", region),
    getMasterFile<RawHonor>("honors", region),
    getMasterFile<{ id: number; name: string }>("honorGroups", region),
    getMasterFile<RawEventHonorBonus>("eventHonorBonuses", region),
    getMasterFile<{ characterId: number; characterRank: number; power1BonusRate: number }>("characterRanks", region),
  ]);

  // 일본 서버: 한국판에 있는 아이템·게이트·칭호는 한국어 이름으로
  const [koItems, koGates, koHonors, koGroups] =
    region === "kr"
      ? [[], [], [], []]
      : await Promise.all([
          getMasterFile<RawAreaItem>("areaItems"),
          getMasterFile<RawGate>("mysekaiGates"),
          getMasterFile<RawHonor>("honors"),
          getMasterFile<{ id: number; name: string }>("honorGroups"),
        ]);
  const koItemName = new Map(koItems.map((x) => [x.id, x.name]));
  const koGateName = new Map(koGates.map((x) => [x.id, x.name]));
  const koHonorName = new Map(koHonors.map((x) => [x.id, x.name]));
  const koGroupName = new Map(koGroups.map((x) => [x.id, x.name]));
  const koHonorDesc = new Map(koHonors.map((x) => [x.id, new Map((x.levels ?? []).map((l) => [l.level, l.description]))]));

  const levelsByItem = new Map<number, RawAreaItemLevel[]>();
  for (const l of levels) {
    const list = levelsByItem.get(l.areaItemId) ?? [];
    list.push(l);
    levelsByItem.set(l.areaItemId, list);
  }

  const areaItems: AreaItemInfo[] = [];
  for (const item of items) {
    const ls = (levelsByItem.get(item.id) ?? []).sort((a, b) => a.level - b.level);
    const first = ls[0];
    if (!first) continue;
    const maxLevel = ls[ls.length - 1].level;
    const rates = [0];
    const allMatchRates = [0];
    for (const l of ls) {
      rates[l.level] = round(l.power1BonusRate);
      allMatchRates[l.level] = round(l.power1AllMatchBonusRate);
    }
    const group: AreaItemGroup =
      first.targetGameCharacterId !== undefined ? "character" : first.targetCardAttr !== "any" ? "attr" : "unit";
    areaItems.push({
      id: item.id,
      name: koItemName.get(item.id) ?? item.name,
      group,
      characterId: first.targetGameCharacterId,
      unit: first.targetUnit !== "any" ? first.targetUnit : undefined,
      attr: first.targetCardAttr !== "any" ? first.targetCardAttr : undefined,
      maxLevel,
      rates,
      allMatchRates,
    });
  }

  const gateInfos: GateInfo[] = gates.map((g) => {
    const ls = gateLevels.filter((l) => l.mysekaiGateId === g.id).sort((a, b) => a.level - b.level);
    const rates = [0];
    for (const l of ls) rates[l.level] = round(l.powerBonusRate);
    return { id: g.id, unit: g.unit, name: koGateName.get(g.id) ?? g.name, maxLevel: ls[ls.length - 1]?.level ?? 0, rates };
  });

  const now = Date.now();
  const groupName = new Map(honorGroups.map((g) => [g.id, koGroupName.get(g.id) ?? g.name]));
  const honors: HonorInfo[] = rawHonors
    .map((h) => ({
      h,
      levels: (h.levels ?? []).filter((l) => (l.startAt ?? 0) <= now).sort((a, b) => a.level - b.level),
    }))
    .filter(({ levels }) => levels.some((l) => l.bonus > 0))
    .sort((a, b) => a.h.seq - b.h.seq)
    .map(({ h, levels }) => ({
      id: h.id,
      name: koHonorName.get(h.id) ?? h.name,
      groupName: groupName.get(h.groupId) ?? "",
      levels: levels.map((l) => ({
        level: l.level,
        bonus: l.bonus,
        description: koHonorDesc.get(h.id)?.get(l.level) ?? l.description,
      })),
    }));

  const honorById = new Map(rawHonors.map((h) => [h.id, h]));
  const eventHonors: EventHonorInfo[] = eventId
    ? eventHonorBonuses
        .filter((b) => b.eventId === eventId)
        .map((b) => {
          const h = honorById.get(b.honorId);
          return {
            honorId: b.honorId,
            name: koHonorName.get(b.honorId) ?? h?.name ?? `칭호 ${b.honorId}`,
            description: koHonorDesc.get(b.honorId)?.get(1) ?? h?.levels?.[0]?.description ?? "",
            leaderCharacterId: b.leaderGameCharacterId,
            bonusRate: b.bonusRate,
          };
        })
    : [];

  // 캐릭터 랭크 보너스: 마스터 값이 이미 % 단위 (랭크 1 = 0.1%). 첫 캐릭터 기준 (모든 캐릭터가 같음)
  const firstChar = Math.min(...characterRanks.map((r) => r.characterId));
  const rankRows = characterRanks.filter((r) => r.characterId === firstChar).sort((a, b) => a.characterRank - b.characterRank);
  const maxCharacterRank = rankRows.length ? rankRows[rankRows.length - 1].characterRank : 1;
  const characterRankRates: number[] = [0];
  for (const r of rankRows) characterRankRates[r.characterRank] = Math.round(r.power1BonusRate * 100) / 100;

  return { areaItems, gates: gateInfos, honors, eventHonors, characterRankRates, maxCharacterRank };
}
