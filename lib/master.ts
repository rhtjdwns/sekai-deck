// 게임 마스터 데이터 (한국판: Sekai-World/sekai-master-db-kr-diff, 일본판: Sekai-World/sekai-master-db-diff)
// 일본 서버도 카드·이벤트·캐릭터 번호가 한국판과 같아서, 한국판에 있는 것은 한국어 이름으로 보여 준다.
import { fetchWithRetry } from "./fetchRetry";
import { REGIONS, type Region } from "./region";

// 카드 썸네일. 원본 이미지 서버가 핫링크를 막아서 우리 서버(/api/thumb)를 거쳐 받는다 (lib/thumbs.ts)
const THUMB_BASE = "/api/thumb";


// ---------- 원본 타입 (필요한 필드만) ----------
export type Attr = "cute" | "cool" | "pure" | "happy" | "mysterious";
export type Unit =
  | "light_sound"
  | "idol"
  | "street"
  | "theme_park"
  | "school_refusal"
  | "piapro";
export type Rarity =
  | "rarity_1"
  | "rarity_2"
  | "rarity_3"
  | "rarity_4"
  | "rarity_birthday";

interface RawCard {
  id: number;
  characterId: number;
  cardRarityType: Rarity;
  attr: Attr;
  supportUnit: Unit | "none";
  prefix: string;
  assetbundleName: string;
  releaseAt: number;
}

interface RawCharacter {
  id: number;
  firstName?: string | null;
  givenName: string;
  unit: Unit;
}

interface RawCharacterUnit {
  id: number;
  gameCharacterId: number;
  unit: Unit;
  colorCode: string;
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
  bonusRate: number;
}

interface RawUnitProfile {
  unit: Unit;
  unitName: string;
}

// ---------- 화면에 넘길 가공 타입 ----------
export interface Character {
  id: number;
  name: string;
  unit: Unit;
  color: string;
}

export interface CardView {
  id: number;
  characterId: number;
  title: string;
  rarity: Rarity;
  attr: Attr;
  /** 이 카드가 속한 캐릭터-유닛 (버추얼 싱어는 서포트 유닛에 따라 달라짐) */
  characterUnitId: number;
  /** 카드의 소속 유닛 (버추얼 싱어 카드는 서포트 유닛, 없으면 버추얼 싱어) */
  unit: Unit;
  releaseAt: number;
  thumbNormal: string;
  thumbTrained: string | null;
  eventBonus: number;
}

export interface EventView {
  id: number;
  name: string;
  eventType: string;
  startAt: number;
  aggregateAt: number;
  bonusAttr: Attr | null;
  bonusCharacters: { characterId: number; unit: Unit; color: string }[];
}

export interface MasterSnapshot {
  units: { unit: Unit; name: string }[];
  characters: Character[];
  cards: CardView[];
  event: EventView | null;
  fetchedAt: number;
}

// 같은 파일을 여러 화면이 동시에 만들 때 한 번만 받도록 잠깐 보관 (일본판 cards.json은 40MB가 넘음).
// 2MB가 넘는 파일은 Next 데이터 캐시에 들어가지 않아서, 이것이 없으면 화면마다 다시 받는다.
const LOAD_TTL_MS = 10 * 60 * 1000;
const loadMemo = new Map<string, { at: number; value: Promise<unknown> }>();

async function load<T>(file: string, region: Region = "kr"): Promise<T> {
  const url = `${REGIONS[region].masterBase}/${file}.json`;
  const hit = loadMemo.get(url);
  if (hit && Date.now() - hit.at < LOAD_TTL_MS) return hit.value as Promise<T>;
  const value = (async () => {
    // 시간으로 만료시키지 않고, 오후 3시·8시 갱신(app/api/revalidate) 때만 새로 받음
    const res = await fetchWithRetry(url, { next: { revalidate: false, tags: ["master"] } });
    if (!res.ok) throw new Error(`${file}.json 불러오기 실패 (${res.status})`);
    return res.json() as Promise<T>;
  })().catch((e) => {
    loadMemo.delete(url);
    throw e;
  });
  loadMemo.set(url, { at: Date.now(), value });
  return value;
}

/** 진행 중인 이벤트, 없으면 가장 최근에 시작한 이벤트 */
function pickEvent(events: RawEvent[], now: number): RawEvent | null {
  const running = events.find((e) => e.startAt <= now && now <= e.closedAt);
  if (running) return running;
  const started = events
    .filter((e) => e.startAt <= now)
    .sort((a, b) => b.startAt - a.startAt);
  return started[0] ?? null;
}

/**
 * 카드의 기본 이벤트 보너스(%).
 * 캐릭터+속성이 모두 맞으면 전용 항목(보통 50%),
 * 아니면 캐릭터 보너스와 속성 보너스를 더한 값.
 * 마스터 랭크 등 카드 육성 보너스는 아직 포함하지 않음.
 */
function bonusFor(card: RawCard, characterUnitId: number, bonuses: RawDeckBonus[]): number {
  let both = 0;
  let charOnly = 0;
  let attrOnly = 0;
  for (const b of bonuses) {
    const hasChar = b.gameCharacterUnitId !== undefined;
    const hasAttr = b.cardAttr !== undefined;
    const charOk = b.gameCharacterUnitId === characterUnitId;
    const attrOk = b.cardAttr === card.attr;
    if (hasChar && hasAttr && charOk && attrOk) both = Math.max(both, b.bonusRate);
    else if (hasChar && !hasAttr && charOk) charOnly = Math.max(charOnly, b.bonusRate);
    else if (!hasChar && hasAttr && attrOk) attrOnly = Math.max(attrOnly, b.bonusRate);
  }
  return both || charOnly + attrOnly;
}

export async function getMasterSnapshot(region: Region = "kr"): Promise<MasterSnapshot> {
  const [rawCards, rawChars, rawCharUnits, rawEvents, rawBonuses, rawUnits] =
    await Promise.all([
      load<RawCard[]>("cards", region),
      load<RawCharacter[]>("gameCharacters", region),
      load<RawCharacterUnit[]>("gameCharacterUnits", region),
      load<RawEvent[]>("events", region),
      load<RawDeckBonus[]>("eventDeckBonuses", region),
      load<RawUnitProfile[]>("unitProfiles", region),
    ]);

  // 일본 서버: 한국판에 있는 카드·이벤트·캐릭터·유닛은 한국어 이름으로
  const ko =
    region === "kr"
      ? null
      : await Promise.all([
          load<RawCard[]>("cards"),
          load<RawCharacter[]>("gameCharacters"),
          load<RawEvent[]>("events"),
          load<RawUnitProfile[]>("unitProfiles"),
        ]).then(([c, ch, ev, u]) => ({
          cardTitle: new Map(c.map((x) => [x.id, x.prefix])),
          charName: new Map(ch.map((x) => [x.id, `${x.firstName ?? ""}${x.givenName}`.trim()])),
          eventName: new Map(ev.map((x) => [x.id, x.name])),
          unitName: new Map(u.map((x) => [x.unit, x.unitName])),
        }));

  const now = Date.now();

  // (캐릭터, 유닛) → 캐릭터-유닛 ID
  const charUnitKey = (charId: number, unit: string) => `${charId}:${unit}`;
  const charUnitMap = new Map<string, RawCharacterUnit>();
  for (const cu of rawCharUnits) charUnitMap.set(charUnitKey(cu.gameCharacterId, cu.unit), cu);
  const charUnitById = new Map(rawCharUnits.map((cu) => [cu.id, cu]));

  const characters: Character[] = rawChars.map((c) => ({
    id: c.id,
    name: ko?.charName.get(c.id) ?? `${c.firstName ?? ""}${c.givenName}`.trim(),
    unit: c.unit,
    color: charUnitMap.get(charUnitKey(c.id, c.unit))?.colorCode ?? "#888888",
  }));
  const charById = new Map(characters.map((c) => [c.id, c]));

  const event = pickEvent(rawEvents, now);
  const eventBonuses = event ? rawBonuses.filter((b) => b.eventId === event.id) : [];

  const cards: CardView[] = rawCards
    .filter((c) => c.releaseAt <= now) // 아직 출시 안 된 예정 카드 제외
    .map((c) => {
      const ownUnit = charById.get(c.characterId)?.unit ?? "piapro";
      // 버추얼 싱어 카드는 서포트 유닛이 곧 소속 유닛
      const unit = ownUnit === "piapro" && c.supportUnit !== "none" ? c.supportUnit : ownUnit;
      const characterUnitId = charUnitMap.get(charUnitKey(c.characterId, unit))?.id ?? -1;
      const canTrain = c.cardRarityType === "rarity_3" || c.cardRarityType === "rarity_4";
      return {
        id: c.id,
        characterId: c.characterId,
        title: ko?.cardTitle.get(c.id) ?? c.prefix,
        rarity: c.cardRarityType,
        attr: c.attr,
        characterUnitId,
        unit,
        releaseAt: c.releaseAt,
        thumbNormal: `${THUMB_BASE}/${c.assetbundleName}_normal.webp`,
        thumbTrained: canTrain ? `${THUMB_BASE}/${c.assetbundleName}_after_training.webp` : null,
        eventBonus: bonusFor(c, characterUnitId, eventBonuses),
      };
    })
    .sort((a, b) => b.releaseAt - a.releaseAt);

  let eventView: EventView | null = null;
  if (event) {
    const attrEntry = eventBonuses.find((b) => b.cardAttr && b.gameCharacterUnitId === undefined);
    const bonusCharUnitIds = Array.from(
      new Set(
        eventBonuses
          .filter((b) => b.gameCharacterUnitId !== undefined && b.cardAttr === undefined)
          .map((b) => b.gameCharacterUnitId as number),
      ),
    );
    eventView = {
      id: event.id,
      name: ko?.eventName.get(event.id) ?? event.name,
      eventType: event.eventType,
      startAt: event.startAt,
      aggregateAt: event.aggregateAt,
      bonusAttr: attrEntry?.cardAttr ?? null,
      bonusCharacters: bonusCharUnitIds
        .map((id) => charUnitById.get(id))
        .filter((cu): cu is RawCharacterUnit => Boolean(cu))
        .map((cu) => ({
          characterId: cu.gameCharacterId,
          unit: cu.unit,
          color: charById.get(cu.gameCharacterId)?.color ?? cu.colorCode,
        })),
    };
  }

  return {
    units: rawUnits.map((u) => ({ unit: u.unit, name: ko?.unitName.get(u.unit) ?? u.unitName })),
    characters,
    cards,
    event: eventView,
    fetchedAt: now,
  };
}
