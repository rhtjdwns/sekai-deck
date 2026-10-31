"use client";

import { usePathname } from "next/navigation";
import { useMemo, useState, type CSSProperties } from "react";
import type { Attr, CardView, MasterSnapshot, Rarity, Unit } from "@/lib/master";
import type { OwnedCard } from "@/lib/presets";
import ScreenshotImport from "./cards/ScreenshotImport";
import { REGIONS, regionOfPath } from "@/lib/region";
import PresetBar from "./PresetBar";
import { usePresets } from "./usePresets";

const ATTR_LABEL: Record<Attr, string> = {
  cute: "큐트",
  cool: "쿨",
  pure: "퓨어",
  happy: "해피",
  mysterious: "미스테리어스",
};
const ATTRS = Object.keys(ATTR_LABEL) as Attr[];

const RARITY_LABEL: Record<Rarity, string> = {
  rarity_4: "★4",
  rarity_birthday: "생일",
  rarity_3: "★3",
  rarity_2: "★2",
  rarity_1: "★1",
};
const RARITIES = Object.keys(RARITY_LABEL) as Rarity[];

const EVENT_TYPE_LABEL: Record<string, string> = {
  marathon: "마라톤",
  cheerful_carnival: "치어풀 카니발",
  world_bloom: "월드 링크",
};

const dateFmt = new Intl.DateTimeFormat("ko-KR", {
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Seoul",
});

type Sort = "newest" | "bonus";
type OwnFilter = "all" | "owned" | "missing";

const canTrain = (c: CardView) => c.thumbTrained !== null;

export default function CardBrowser({ snapshot }: { snapshot: MasterSnapshot }) {
  const { characters, cards, event, units } = snapshot;
  const charById = useMemo(() => new Map(characters.map((c) => [c.id, c])), [characters]);
  const validCardIds = useMemo(() => new Set(cards.map((c) => c.id)), [cards]);
  const cardById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const charName = useMemo(() => new Map(characters.map((c) => [c.id, c.name])), [characters]);

  const presetApi = usePresets();
  const region = regionOfPath(usePathname());
  const owned = presetApi.active?.cards ?? {};

  const [checkMode, setCheckMode] = useState(false);
  const [unit, setUnit] = useState<Unit | "all">("all");
  const [charId, setCharId] = useState<number | "all">("all");
  const [attr, setAttr] = useState<Attr | "all">("all");
  const [rarity, setRarity] = useState<Rarity | "all">("all");
  const [own, setOwn] = useState<OwnFilter>("all");
  const [bonusOnly, setBonusOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("newest");

  const filtered = useMemo(() => {
    const q = query.trim();
    const list = cards.filter(
      (c) =>
        // 유닛: 그 유닛 멤버 카드 + 그 유닛을 서포트하는 버추얼 싱어 카드. 버추얼 싱어는 버추얼 싱어 캐릭터 카드 전체
        (unit === "all" ||
          (unit === "piapro" ? charById.get(c.characterId)?.unit === "piapro" : c.unit === unit)) &&
        (charId === "all" || c.characterId === charId) &&
        (attr === "all" || c.attr === attr) &&
        (rarity === "all" || c.rarity === rarity) &&
        (own === "all" || (own === "owned") === Boolean(owned[c.id])) &&
        (!bonusOnly || c.eventBonus > 0) &&
        (q === "" || c.title.includes(q)),
    );
    if (sort === "bonus") {
      return [...list].sort((a, b) => b.eventBonus - a.eventBonus || b.releaseAt - a.releaseAt);
    }
    return list;
  }, [cards, charById, unit, charId, attr, rarity, own, owned, bonusOnly, query, sort]);

  const resetFilters = () => {
    setUnit("all");
    setCharId("all");
    setAttr("all");
    setRarity("all");
    setOwn("all");
    setBonusOnly(false);
    setQuery("");
  };

  const visibleItems = filtered.map((c) => ({ id: c.id, canTrain: canTrain(c) }));
  const visibleOwnedIds = filtered.filter((c) => owned[c.id]).map((c) => c.id);

  return (
    <main className="page">
      <header className="masthead">
        <h1>보유 카드 체크하기</h1>
        <p className="sub">
          {REGIONS[region].label} 카드 {cards.length.toLocaleString()}장. 체크 시작을 누른 뒤 가진 카드를 눌러 주세요.
          {region === "jp" && " 한국판에 아직 없는 카드는 일본어 이름으로 보여요."}
        </p>
      </header>

      {event && (
        <section className="event" aria-labelledby="event-name">
          <div className="event-head">
            <span className="event-type">
              {EVENT_TYPE_LABEL[event.eventType] ?? event.eventType} 이벤트
            </span>
            <h2 id="event-name">{event.name}</h2>
            <p className="event-time">
              {dateFmt.format(event.startAt)} ~ {dateFmt.format(event.aggregateAt)} 집계
            </p>
          </div>

          <div className="bonus">
            <p className="bonus-label">보너스 캐릭터</p>
            <ul className="bonus-chars">
              {event.bonusCharacters.map((b) => {
                const ch = charById.get(b.characterId);
                const unitName = units.find((u) => u.unit === b.unit)?.name;
                const isVsSupport = ch && ch.unit === "piapro" && b.unit !== "piapro";
                return (
                  <li key={`${b.characterId}-${b.unit}`} style={{ "--char": b.color } as CSSProperties}>
                    {ch?.name}
                    {isVsSupport && <small> ({unitName})</small>}
                  </li>
                );
              })}
            </ul>
            {event.bonusAttr && (
              <p className="bonus-attr">
                보너스 속성 <span className={`attr-dot attr-${event.bonusAttr}`} aria-hidden="true" />
                <strong>{ATTR_LABEL[event.bonusAttr]}</strong>
              </p>
            )}
          </div>
        </section>
      )}

      {presetApi.ready && <PresetBar api={presetApi} validCardIds={validCardIds} />}

      {presetApi.ready && presetApi.active && (
        <ScreenshotImport
          cardById={cardById}
          charName={charName}
          ownedIds={new Set(Object.keys(owned).map(Number))}
          onApply={presetApi.upsertMany}
        />
      )}

      <section className="filters" aria-label="카드 필터">
        <label className="field">
          <span>유닛</span>
          <select
            value={unit}
            onChange={(e) => {
              const next = e.target.value as Unit | "all";
              setUnit(next);
              // 고른 캐릭터가 새 유닛에 없으면 캐릭터 필터 해제
              const ch = charId === "all" ? undefined : charById.get(charId);
              if (ch && next !== "all" && ch.unit !== next && ch.unit !== "piapro") setCharId("all");
            }}
          >
            <option value="all">전체</option>
            {units.map((u) => (
              <option key={u.unit} value={u.unit}>
                {u.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>캐릭터</span>
          <select
            value={charId}
            onChange={(e) => setCharId(e.target.value === "all" ? "all" : Number(e.target.value))}
          >
            <option value="all">전체</option>
            {units
              // 유닛을 고르면 그 유닛 멤버와 서포트로 들어올 수 있는 버추얼 싱어만 보여 줌
              .filter((u) => unit === "all" || u.unit === unit || u.unit === "piapro")
              .map((u) => (
                <optgroup key={u.unit} label={u.name}>
                  {characters
                    .filter((c) => c.unit === u.unit)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </optgroup>
              ))}
          </select>
        </label>

        <fieldset className="field">
          <legend>속성</legend>
          <div className="seg">
            <button type="button" aria-pressed={attr === "all"} onClick={() => setAttr("all")}>
              전체
            </button>
            {ATTRS.map((a) => (
              <button key={a} type="button" aria-pressed={attr === a} onClick={() => setAttr(a)}>
                <span className={`attr-dot attr-${a}`} aria-hidden="true" />
                {ATTR_LABEL[a]}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="field">
          <legend>레어도</legend>
          <div className="seg">
            <button type="button" aria-pressed={rarity === "all"} onClick={() => setRarity("all")}>
              전체
            </button>
            {RARITIES.map((r) => (
              <button key={r} type="button" aria-pressed={rarity === r} onClick={() => setRarity(r)}>
                {RARITY_LABEL[r]}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="field">
          <legend>보유</legend>
          <div className="seg">
            {(
              [
                ["all", "전체"],
                ["owned", "보유"],
                ["missing", "미보유"],
              ] as const
            ).map(([v, label]) => (
              <button key={v} type="button" aria-pressed={own === v} onClick={() => setOwn(v)}>
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="field grow">
          <span>카드 이름</span>
          <input
            type="search"
            value={query}
            placeholder="예: Happy Birthday"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>

        <div className="field toggles">
          <label className="check">
            <input type="checkbox" checked={bonusOnly} onChange={(e) => setBonusOnly(e.target.checked)} />
            보너스 카드만
          </label>
          <label className="field inline">
            <span>정렬</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="newest">최신순</option>
              <option value="bonus">보너스 높은 순</option>
            </select>
          </label>
        </div>
      </section>

      <div className="listbar">
        <p className="count" aria-live="polite">
          {filtered.length.toLocaleString()}장
        </p>
        <div className="listbar-actions">
          {checkMode && filtered.length > 0 && (
            <>
              <button type="button" onClick={() => presetApi.setManyOwned(visibleItems, true)}>
                보이는 {filtered.length}장 모두 체크
              </button>
              <button type="button" onClick={() => presetApi.setManyOwned(visibleItems, false)}>
                보이는 카드 체크 해제
              </button>
              {visibleOwnedIds.length > 0 && (
                <label className="bulk-skill">
                  보이는 보유 {visibleOwnedIds.length}장 스킬 레벨
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) presetApi.setManyDetail(visibleOwnedIds, { skillLevel: Number(e.target.value) });
                    }}
                  >
                    <option value="">일괄 변경</option>
                    {[1, 2, 3, 4].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}
          <button
            type="button"
            className={checkMode ? "primary" : undefined}
            aria-pressed={checkMode}
            onClick={() => setCheckMode((m) => !m)}
            disabled={!presetApi.ready}
          >
            {checkMode ? "체크 끝내기" : "체크 시작"}
          </button>
        </div>
      </div>

      {checkMode && (
        <p className="hint">카드를 누르면 보유로 체크됩니다. 체크한 카드는 특훈 여부, 스킬 레벨, 마이세카이 캔버스 제작 여부, 사이드 스토리 전편·후편 읽음 여부, 마스터 랭크를 고를 수 있어요.</p>
      )}

      {filtered.length === 0 ? (
        <div className="empty">
          <p>조건에 맞는 카드가 없습니다.</p>
          <button type="button" onClick={resetFilters}>
            필터 초기화
          </button>
        </div>
      ) : (
        <ul className={`grid${checkMode ? " checking" : ""}`}>
          {filtered.map((c) => (
            <CardTile
              key={c.id}
              card={c}
              characterName={charById.get(c.characterId)?.name ?? ""}
              owned={owned[c.id]}
              checkMode={checkMode}
              onToggle={() => presetApi.toggleOwned(c.id, canTrain(c))}
              onDetail={(d) => presetApi.setOwnedDetail(c.id, d)}
            />
          ))}
        </ul>
      )}

      <footer className="foot">
        카드 정보는 Sekai-World {region === "jp" ? "일본판" : "한국판"} 마스터 데이터, 이미지는 Sekai Viewer 에셋을 사용합니다. 이벤트 보너스는
        캐릭터와 속성 기본 보너스만 반영합니다. 보유 카드 프리셋은 이 브라우저에만 저장되니, 다른 기기에서
        쓰려면 내보내기 파일을 옮겨 주세요. 한국 서버와 일본 서버의 프리셋은 따로 저장돼요.
      </footer>
    </main>
  );
}

function CardTile({
  card,
  characterName,
  owned,
  checkMode,
  onToggle,
  onDetail,
}: {
  card: CardView;
  characterName: string;
  owned: OwnedCard | undefined;
  checkMode: boolean;
  onToggle: () => void;
  onDetail: (d: Partial<OwnedCard>) => void;
}) {
  const [viewTrained, setViewTrained] = useState(false);
  const [broken, setBroken] = useState(false);

  // 체크 모드에서는 보유 카드의 특훈 상태대로 이미지 표시
  const showTrained = checkMode ? Boolean(owned?.trained) : viewTrained;
  const src = showTrained && card.thumbTrained ? card.thumbTrained : card.thumbNormal;
  const label = `${characterName} ${card.title}`;

  const image = broken ? (
    <div className="thumb-fallback" aria-hidden="true">
      {characterName.slice(0, 1)}
    </div>
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={checkMode ? "" : label} width={128} height={128} loading="lazy" onError={() => setBroken(true)} />
  );

  return (
    <li className={`tile attr-border-${card.attr}${owned ? " owned" : ""}`}>
      {checkMode ? (
        <button
          type="button"
          className="thumb thumb-button"
          aria-pressed={Boolean(owned)}
          aria-label={`${label} 보유`}
          onClick={onToggle}
        >
          {image}
          {owned && <span className="owned-mark" aria-hidden="true">✓</span>}
          {card.eventBonus > 0 && <span className="badge">+{card.eventBonus}%</span>}
        </button>
      ) : (
        <div className="thumb">
          {image}
          {owned && <span className="owned-mark" aria-hidden="true">✓</span>}
          {card.eventBonus > 0 && <span className="badge">+{card.eventBonus}%</span>}
        </div>
      )}

      <div className="meta">
        <p className="title">{card.title}</p>
        <p className="who">
          <span className={`attr-dot attr-${card.attr}`} aria-label={ATTR_LABEL[card.attr]} />
          {characterName}
          <span className="rarity">{RARITY_LABEL[card.rarity]}</span>
        </p>

        {checkMode && owned ? (
          <div className="owned-detail">
            {card.thumbTrained && (
              <label className="mini-check">
                <input
                  type="checkbox"
                  checked={owned.trained}
                  onChange={(e) => onDetail({ trained: e.target.checked })}
                />
                특훈
              </label>
            )}
            <label className="mini-select">
              스킬
              <select
                value={owned.skillLevel ?? 1}
                onChange={(e) => onDetail({ skillLevel: Number(e.target.value) })}
                aria-label="스킬 레벨"
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="mini-check">
              <input
                type="checkbox"
                checked={Boolean(owned.canvas)}
                onChange={(e) => onDetail({ canvas: e.target.checked })}
              />
              캔버스
            </label>
            <span className="mini-story" role="group" aria-label="사이드 스토리 읽음">
              <span aria-hidden="true">스토리</span>
              <label className="mini-check">
                <input
                  type="checkbox"
                  checked={owned.storyFirst !== false}
                  onChange={(e) => onDetail({ storyFirst: e.target.checked })}
                />
                전편
              </label>
              <label className="mini-check">
                <input
                  type="checkbox"
                  checked={owned.storySecond !== false}
                  onChange={(e) => onDetail({ storySecond: e.target.checked })}
                />
                후편
              </label>
            </span>
            <label className="mini-select">
              마랭
              <select
                value={owned.masterRank}
                onChange={(e) => onDetail({ masterRank: Number(e.target.value) })}
                aria-label="마스터 랭크"
              >
                {[0, 1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          !checkMode &&
          card.thumbTrained &&
          !broken && (
            <button type="button" className="train" aria-pressed={viewTrained} onClick={() => setViewTrained((t) => !t)}>
              {viewTrained ? "특훈 전 보기" : "특훈 후 보기"}
            </button>
          )
        )}
      </div>
    </li>
  );
}
