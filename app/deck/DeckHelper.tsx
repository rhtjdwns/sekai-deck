"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { EventOption, EventStatus } from "@/lib/events";
import type { Attr, CardView, MasterSnapshot, Rarity } from "@/lib/master";
import type { LiveKind, RecommendResult } from "@/lib/recommend";
import { REGIONS, regionHref, regionOfPath } from "@/lib/region";
import type { SongOption } from "@/lib/songs";
import { usePresets } from "../usePresets";
import "./fixedCards.css";
import "./teammates.css";

/** 공방 랜덤 곡 (서버의 RANDOM_MUSIC_ID와 같은 값) */
const RANDOM_SONG = -1;
/** 계산 응답을 기다리는 최대 시간. 서버는 보통 몇 초 안에 끝나지만, 네트워크 문제로 응답이 없을 때를 대비 */
const REQUEST_TIMEOUT_MS = 100_000;
/** 멀티 라이브 팀원 입력을 이 브라우저에 저장하는 이름 */
const TEAM_KEY = "sekai-deck-kr:teammates";

const RARITY_LABEL: Record<Rarity, string> = {
  rarity_4: "★4",
  rarity_birthday: "생일",
  rarity_3: "★3",
  rarity_2: "★2",
  rarity_1: "★1",
};
const ATTR_LABEL: Record<Attr, string> = {
  cute: "큐트",
  cool: "쿨",
  pure: "퓨어",
  happy: "해피",
  mysterious: "미스테리어스",
};
const EVENT_TYPE_LABEL: Record<string, string> = {
  marathon: "마라톤",
  cheerful_carnival: "치어풀 카니발",
  world_bloom: "월드 링크",
};
const STATUS_LABEL: Record<EventStatus, string> = { current: "현재", future: "미래", past: "과거" };
const STATUS_ORDER: EventStatus[] = ["current", "future", "past"];
const RESULT_LIVE_LABEL: Record<RecommendResult["liveType"], string> = {
  multi: "멀티 라이브",
  solo: "솔로 라이브",
  auto: "오토 라이브",
  cheerful: "치어풀 라이브",
};
const DIFFICULTIES = ["easy", "normal", "hard", "expert", "master", "append"];
const DEFAULT_SONG = 74; // 혼자 놀이 엔비

const dateFmt = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "Asia/Seoul",
});
const shortDate = new Intl.DateTimeFormat("ko-KR", {
  year: "2-digit",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Asia/Seoul",
});

type Songs = { efficient: SongOption[]; all: SongOption[] };
/** 팀원 입력 칸 (입력 중인 글자 그대로) */
type TeamInput = { power: string; skill: string };
const emptyTeam = (): TeamInput[] => Array.from({ length: 4 }, () => ({ power: "", skill: "" }));

/** 146 → "2분 26초" */
function formatTime(sec: number) {
  const s = Math.round(sec);
  return s >= 60 ? `${Math.floor(s / 60)}분 ${s % 60}초` : `${s}초`;
}

/** 실효 스킬(실스업): 리더 스킬 효과 + 나머지 4명 스킬 효과 합 × 0.2 (덱의 첫 카드가 리더) */
function effectiveSkill(deck: RecommendResult["decks"][number]) {
  const [leader, ...rest] = deck.cards;
  if (!leader) return 0;
  return leader.skillScoreUp + rest.reduce((sum, c) => sum + c.skillScoreUp, 0) * 0.2;
}
/** 256.0 → "256", 255.6 → "255.6" */
const fmtSkill = (n: number) => n.toFixed(1).replace(/\.0$/, "");

type Saved = {
  result: RecommendResult;
  presetName: string;
  at: number;
  fixed: number[];
  leader: number | null;
  /** 고정한 캐릭터와 리더로 고정한 캐릭터 */
  chars: number[];
  leaderChar: number | null;
};

const MAX_FIXED = 5;

export default function DeckHelper({
  snapshot,
  songs,
  events,
}: {
  snapshot: MasterSnapshot;
  songs: Songs;
  events: EventOption[];
}) {
  const { cards, characters, units } = snapshot;
  const { ready, presets, active, selectPreset } = usePresets();
  const region = regionOfPath(usePathname());
  const href = (p: string) => regionHref(region, p);
  const cardById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const charName = useMemo(() => new Map(characters.map((c) => [c.id, c.name])), [characters]);
  const songTitle = useMemo(
    () => new Map([...songs.all.map((s) => [s.id, s.title] as const), [RANDOM_SONG, "랜덤 곡(공방)"] as const]),
    [songs],
  );

  // 이벤트를 현재/미래/과거로 나눔 (미래는 가까운 순, 과거는 최근 순)
  const grouped = useMemo(() => {
    const g: Record<EventStatus, EventOption[]> = { current: [], future: [], past: [] };
    for (const e of events) g[e.status].push(e);
    g.future.sort((a, b) => a.startAt - b.startAt);
    g.past.sort((a, b) => b.startAt - a.startAt);
    return g;
  }, [events]);
  const eventById = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);
  const initial = grouped.current[0] ?? grouped.future[0] ?? grouped.past[0];

  const [tab, setTab] = useState<EventStatus>(initial?.status ?? "current");
  const [eventId, setEventId] = useState<number | undefined>(initial?.id);
  const [liveType, setLiveType] = useState<LiveKind>("multi");
  const [musicId, setMusicId] = useState(
    songs.all.some((s) => s.id === DEFAULT_SONG) ? DEFAULT_SONG : songs.all[0]?.id ?? DEFAULT_SONG,
  );
  const selectedSong = songs.all.find((s) => s.id === musicId);
  const [difficulty, setDifficulty] = useState("expert");
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [saved, setSaved] = useState<Record<number, Saved>>({});
  // 꼭 넣을 카드와 리더로 고정할 카드
  const [fixed, setFixed] = useState<number[]>([]);
  const [fixedLeader, setFixedLeader] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  // 카드 대신 캐릭터만 고정 (그 캐릭터의 가장 좋은 카드를 골라 줌)
  const [fixedChars, setFixedChars] = useState<number[]>([]);
  const [fixedLeaderChar, setFixedLeaderChar] = useState<number | null>(null);
  // 월드 링크: 이벤트별로 고른 챕터 캐릭터
  const [chapterByEvent, setChapterByEvent] = useState<Record<number, number>>({});
  // 멀티 라이브 팀원 4명 (비워 두면 내 덱과 같다고 봄). 이 브라우저에 저장
  const [team, setTeam] = useState<TeamInput[]>(emptyTeam);
  const [teamLoaded, setTeamLoaded] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(TEAM_KEY);
      const parsed = raw ? (JSON.parse(raw) as TeamInput[]) : null;
      if (Array.isArray(parsed) && parsed.length === 4) {
        setTeam(parsed.map((t) => ({ power: String(t?.power ?? ""), skill: String(t?.skill ?? "") })));
      }
    } catch {
      // 저장소를 못 쓰면 빈 칸으로
    }
    setTeamLoaded(true);
  }, []);
  useEffect(() => {
    if (!teamLoaded) return;
    try {
      localStorage.setItem(TEAM_KEY, JSON.stringify(team));
    } catch {
      // 무시
    }
  }, [team, teamLoaded]);
  const teammates = team
    .map((t) => ({ power: Number(t.power.replace(/,/g, "")), skill: Number(t.skill || 0) }))
    .filter((t) => Number.isFinite(t.power) && t.power > 0 && Number.isFinite(t.skill) && t.skill >= 0);
  const setTeamField = (i: number, key: keyof TeamInput, value: string) =>
    setTeam((list) => list.map((t, j) => (j === i ? { ...t, [key]: value } : t)));

  const event = eventId !== undefined ? eventById.get(eventId) : undefined;
  const isCheerful = event?.eventType === "cheerful_carnival";
  // 월드 링크 챕터: 고른 값 → 지금 진행 중인 챕터 → 첫 챕터
  const chapters = event?.chapters ?? [];
  const nowMs = Date.now();
  const defaultChapter = (chapters.find((c) => c.startAt <= nowMs && nowMs <= c.endAt) ?? chapters[0])?.characterId;
  const chapterChar = event ? chapterByEvent[event.id] ?? defaultChapter : undefined;

  const owned = active?.cards ?? {};
  const ownedCount = Object.keys(owned).length;
  const rankCount = Object.keys(active?.characterRanks ?? {}).length;
  const skillUnset = Object.values(owned).filter((o) => o.skillLevel === undefined).length;
  const growthItems = Object.keys(active?.growth?.areaItems ?? {}).length;
  const growthGates = Object.keys(active?.growth?.gates ?? {}).length;
  const growthHonors = Object.keys(active?.growth?.honors ?? {}).length;
  const canvasCount = Object.values(owned).filter((o) => o.canvas).length;
  // 프리셋을 바꿔 보유하지 않게 된 카드는 고정에서 뺌
  const fixedOwned = fixed.filter((id) => owned[id] && cardById.has(id));
  const leaderOwned = fixedLeader !== null && fixedOwned.includes(fixedLeader) ? fixedLeader : null;
  // 보유 카드가 있는 캐릭터만, 카드를 고정한 캐릭터는 빼고
  const ownedCharIds = new Set(Object.keys(owned).map((id) => cardById.get(Number(id))?.characterId));
  const fixedCardChars = new Set(fixedOwned.map((id) => cardById.get(id)?.characterId));
  const charsOwned = fixedChars.filter((ch) => ownedCharIds.has(ch) && !fixedCardChars.has(ch));
  const leaderCharOwned = leaderOwned === null && fixedLeaderChar !== null && charsOwned.includes(fixedLeaderChar) ? fixedLeaderChar : null;
  const fixedTotal = fixedOwned.length + charsOwned.length;

  /** 리더는 카드 하나 또는 캐릭터 하나만 */
  const setLeaderCard = (id: number | null) => {
    setFixedLeader(id);
    if (id !== null) setFixedLeaderChar(null);
  };
  const setLeaderChar = (ch: number | null) => {
    setFixedLeaderChar(ch);
    if (ch !== null) setFixedLeader(null);
  };
  const addFixedChar = (ch: number) => {
    if (fixedTotal >= MAX_FIXED || charsOwned.includes(ch)) return;
    setFixedChars([...charsOwned, ch]);
  };
  const removeFixedChar = (ch: number) => {
    setFixedChars(charsOwned.filter((x) => x !== ch));
    if (leaderCharOwned === ch) setFixedLeaderChar(null);
  };

  /** 카드 고정/해제. 같은 캐릭터 카드가 이미 고정돼 있으면 그 카드와 바꿈 */
  const toggleFixed = (id: number) => {
    const card = cardById.get(id);
    if (!card) return;
    if (fixedOwned.includes(id)) {
      setFixed(fixedOwned.filter((x) => x !== id));
      if (leaderOwned === id) setFixedLeader(null);
      return;
    }
    const sameChar = fixedOwned.find((x) => cardById.get(x)?.characterId === card.characterId);
    const next = fixedOwned.filter((x) => x !== sameChar);
    // 이 캐릭터를 캐릭터로 고정해 두었으면 카드 고정으로 바꿈 (리더였다면 이 카드가 리더)
    const charFixed = charsOwned.includes(card.characterId);
    if (!charFixed && sameChar === undefined && fixedTotal >= MAX_FIXED) return;
    if (sameChar !== undefined && leaderOwned === sameChar) setFixedLeader(null);
    if (charFixed) {
      setFixedChars(charsOwned.filter((x) => x !== card.characterId));
      if (leaderCharOwned === card.characterId) setLeaderCard(id);
    }
    setFixed([...next, id]);
  };

  const changeTab = (next: EventStatus) => {
    setTab(next);
    if (!event || event.status !== next) setEventId(grouped[next][0]?.id);
  };

  const run = async () => {
    if (!event || !active) return;
    const id = event.id;
    setLoadingId(id);
    setErrors(({ [id]: _, ...rest }) => rest);
    try {
      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: id,
          liveType,
          musicId,
          difficulty,
          cards: active.cards,
          characterRanks: active.characterRanks ?? {},
          growth: active.growth,
          fixedCardIds: fixedOwned,
          fixedLeaderId: leaderOwned,
          fixedCharacterIds: charsOwned,
          fixedLeaderCharacterId: leaderCharOwned,
          worldBloomCharacterId: chapterChar ?? null,
          // 팀원 정보는 멀티(치어풀) 라이브에서만 보냄
          teammates: liveType === "multi" ? teammates : [],
          region,
        }),
        // 응답이 오지 않으면 무한히 기다리지 않도록
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "덱을 계산하지 못했습니다.");
      setSaved((s) => ({
        ...s,
        [id]: {
          result: data as RecommendResult,
          presetName: active.name,
          at: Date.now(),
          fixed: fixedOwned,
          leader: leaderOwned,
          chars: charsOwned,
          leaderChar: leaderCharOwned,
        },
      }));
    } catch (e) {
      const err = e as Error;
      const timedOut = err.name === "TimeoutError" || err.name === "AbortError";
      setErrors((s) => ({
        ...s,
        [id]: timedOut
          ? "서버 응답이 너무 오래 걸려서 기다리기를 멈췄어요. 잠시 후 다시 시도해 주세요."
          : err.message,
      }));
    } finally {
      setLoadingId(null);
    }
  };

  if (!ready) return <main className="page" />;

  const computedIds = Object.keys(saved).map(Number);
  const current = event ? saved[event.id] : undefined;

  return (
    <main className="page">
      <header className="masthead">
        <h1>덱 편성 도우미</h1>
        <p className="sub">이벤트를 골라 그 이벤트에서 이벤트 포인트가 가장 높은 5장 조합을 찾습니다.</p>
      </header>

      {ownedCount < 5 ? (
        <section className="notice">
          <p>
            {active ? `"${active.name}" 프리셋에 체크한 카드가 ${ownedCount}장입니다. ` : ""}덱을 짜려면 5장 이상
            필요해요. 먼저 가진 카드를 체크해 주세요.
          </p>
          <Link href={href("/cards")} className="button-link">
            보유 카드 체크하러 가기
          </Link>
        </section>
      ) : (
        <>
          <section className="event-picker" aria-label="이벤트 선택">
            <div className="seg" role="tablist" aria-label="이벤트 구분">
              {STATUS_ORDER.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="tab"
                  aria-selected={tab === s}
                  aria-pressed={tab === s}
                  onClick={() => changeTab(s)}
                  disabled={grouped[s].length === 0}
                >
                  {STATUS_LABEL[s]} 이벤트 <span className="tab-count">{grouped[s].length}</span>
                </button>
              ))}
            </div>

            {tab !== "current" && grouped[tab].length > 0 && (
              <label className="field event-select">
                <span>{STATUS_LABEL[tab]} 이벤트 {grouped[tab].length}개</span>
                <select value={eventId} onChange={(e) => setEventId(Number(e.target.value))}>
                  {grouped[tab].map((e) => (
                    <option key={e.id} value={e.id}>
                      {shortDate.format(e.startAt)} {e.name} ({EVENT_TYPE_LABEL[e.eventType] ?? e.eventType})
                      {saved[e.id] ? " ✓" : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {event ? (
              <EventCard event={event} charName={charName} units={units} />
            ) : (
              <p className="hint">이 구분에 해당하는 이벤트가 없습니다.</p>
            )}

            {event?.status === "future" && (
              <p className="hint">
                미래 이벤트는 {REGIONS[region].label} 데이터에 미리 등록된 예정 정보라 일정과 보너스가 바뀔 수 있어요. 그 이벤트의 신규
                카드는 아직 없으니 지금 보유한 카드로만 계산합니다.
              </p>
            )}

            {computedIds.length > 0 && (
              <div className="computed">
                <span>계산한 이벤트</span>
                {computedIds.map((id) => {
                  const e = eventById.get(id);
                  if (!e) return null;
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={id === eventId}
                      onClick={() => {
                        setTab(e.status);
                        setEventId(id);
                      }}
                    >
                      {e.name}
                      <small>{Math.round(saved[id].result.decks[0]?.eventPoint ?? 0).toLocaleString()}pt</small>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {event && (
            <>
              <section className="deck-options" aria-label="계산 조건">
                <label className="field">
                  <span>프리셋</span>
                  <select value={active?.id} onChange={(e) => selectPreset(e.target.value)}>
                    {presets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name || "이름 없음"} ({Object.keys(p.cards).length}장)
                      </option>
                    ))}
                  </select>
                </label>

                {chapters.length > 0 && (
                  <label className="field">
                    <span>월드 링크 챕터</span>
                    <select
                      value={chapterChar}
                      onChange={(e) => setChapterByEvent((m) => ({ ...m, [event.id]: Number(e.target.value) }))}
                    >
                      {chapters.map((c) => (
                        <option key={c.characterId} value={c.characterId}>
                          {c.chapterNo}장 {charName.get(c.characterId)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <fieldset className="field">
                  <legend>라이브</legend>
                  <div className="seg">
                    {(["multi", "solo", "auto"] as LiveKind[]).map((k) => (
                      <button key={k} type="button" aria-pressed={liveType === k} onClick={() => setLiveType(k)}>
                        {k === "multi" && isCheerful ? "치어풀 라이브" : RESULT_LIVE_LABEL[k]}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <label className="field grow">
                  <span>곡</span>
                  <select value={musicId} onChange={(e) => setMusicId(Number(e.target.value))}>
                    <optgroup label="공방">
                      <option value={RANDOM_SONG}>랜덤 곡 (전체 곡 평균)</option>
                    </optgroup>
                    {songs.efficient.length > 0 && (
                      <optgroup label="효율곡">
                        {songs.efficient.map((s) => (
                          <option key={`e-${s.id}`} value={s.id}>
                            {s.title}
                            {!s.hasMeta && " (추정)"}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    <optgroup label={`전체 곡 ${songs.all.length}곡`}>
                      {songs.all
                        .filter((s) => !songs.efficient.some((e) => e.id === s.id))
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.title}
                            {!s.hasMeta && " (추정)"}
                          </option>
                        ))}
                    </optgroup>
                  </select>
                </label>

                <label className="field">
                  <span>난이도</span>
                  <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                    {DIFFICULTIES.map((d) => (
                      <option key={d} value={d}>
                        {d.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </label>

                <button type="button" className="run" onClick={run} disabled={loadingId !== null}>
                  {loadingId === event.id ? "계산 중…" : current ? "다시 계산" : "최적 덱 찾기"}
                </button>
              </section>

              {chapters.length > 0 && (
                <p className="hint">
                  월드 링크는 챕터마다 보너스 캐릭터와 서포트 덱이 달라서, 고른 챕터 기준으로 계산해요.
                </p>
              )}

              {liveType === "multi" && (
                <details className="team" open={teammates.length > 0}>
                  <summary>
                    팀원 정보 ({isCheerful ? "치어풀" : "멀티"} 라이브)
                    <span className="team-count">
                      {teammates.length > 0 ? `${teammates.length}명 입력됨` : "입력하지 않으면 5명 모두 내 덱과 같다고 계산"}
                    </span>
                  </summary>
                  <p className="hint">
                    함께 라이브할 팀원 4명의 종합력과 실효 스킬(리더 스킬 + 나머지 4명 스킬 합 × 0.2)을 넣으면, 팀원 스킬과 종합력
                    합에 따른 점수 변화를 반영해 최적 덱을 찾아요. 비워 둔 팀원은 내 덱과 같은 값으로 계산해요. 입력한 값은 이
                    브라우저에 저장돼요.
                  </p>
                  <div className="team-grid">
                    {team.map((t, i) => (
                      <fieldset key={i} className="team-row">
                        <legend>팀원 {i + 1}</legend>
                        <label>
                          종합력
                          <input
                            className="team-power"
                            inputMode="numeric"
                            placeholder="예: 250000"
                            value={t.power}
                            onChange={(e) => setTeamField(i, "power", e.target.value.replace(/[^\d,]/g, ""))}
                          />
                        </label>
                        <label>
                          실효 스킬
                          <input
                            className="team-skill"
                            inputMode="decimal"
                            placeholder="예: 200"
                            value={t.skill}
                            onChange={(e) => setTeamField(i, "skill", e.target.value.replace(/[^\d.]/g, ""))}
                          />
                          %
                        </label>
                      </fieldset>
                    ))}
                  </div>
                  <div className="team-actions">
                    <button type="button" onClick={() => setTeam(emptyTeam())}>
                      팀원 정보 비우기
                    </button>
                  </div>
                </details>
              )}

              <section className="fixed-cards" aria-label="고정할 카드">
                <div className="fixed-head">
                  <h3>고정할 카드·캐릭터</h3>
                  <p className="hint">
                    꼭 넣고 싶은 카드를 고르면 그 카드를 넣은 채로 나머지 자리를 가장 좋게 채워요. 카드 대신 캐릭터만 고르면 그
                    캐릭터의 보유 카드 중 이 이벤트에서 가장 좋은 카드를 골라 줘요. 카드와 캐릭터를 합쳐 최대 {MAX_FIXED}개, 그중
                    하나는 리더로 고정할 수 있어요.
                  </p>
                </div>
                {fixedTotal > 0 && (
                  <ul className="fixed-list">
                    {fixedOwned.map((id) => {
                      const c = cardById.get(id)!;
                      return (
                        <li key={id} className={`fixed-chip attr-border-${c.attr}`}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={c.thumbTrained ?? c.thumbNormal} alt="" width={40} height={40} />
                          <span className="fixed-name">
                            {charName.get(c.characterId)}
                            <small>{c.title}</small>
                          </span>
                          <button
                            type="button"
                            className="fixed-leader"
                            aria-pressed={leaderOwned === id}
                            onClick={() => setLeaderCard(leaderOwned === id ? null : id)}
                          >
                            리더
                          </button>
                          <button
                            type="button"
                            className="fixed-remove"
                            aria-label={`${charName.get(c.characterId)} ${c.title} 고정 해제`}
                            onClick={() => toggleFixed(id)}
                          >
                            ✕
                          </button>
                        </li>
                      );
                    })}
                    {charsOwned.map((ch) => {
                      const character = characters.find((x) => x.id === ch);
                      return (
                        <li key={`c-${ch}`} className="fixed-chip fixed-char" style={{ "--char": character?.color } as CSSProperties}>
                          <span className="fixed-char-dot" aria-hidden="true" />
                          <span className="fixed-name">
                            {character?.name}
                            <small>캐릭터 고정 (가장 좋은 카드 자동)</small>
                          </span>
                          <button
                            type="button"
                            className="fixed-leader"
                            aria-pressed={leaderCharOwned === ch}
                            onClick={() => setLeaderChar(leaderCharOwned === ch ? null : ch)}
                          >
                            리더
                          </button>
                          <button
                            type="button"
                            className="fixed-remove"
                            aria-label={`${character?.name} 캐릭터 고정 해제`}
                            onClick={() => removeFixedChar(ch)}
                          >
                            ✕
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <div className="fixed-actions">
                  <button type="button" onClick={() => setPicking((p) => !p)} aria-expanded={picking}>
                    {picking ? "카드 고르기 닫기" : "+ 고정할 카드 고르기"}
                  </button>
                  <select
                    className="fixed-char-select"
                    value=""
                    aria-label="고정할 캐릭터"
                    disabled={fixedTotal >= MAX_FIXED}
                    onChange={(e) => {
                      if (e.target.value) addFixedChar(Number(e.target.value));
                    }}
                  >
                    <option value="">+ 캐릭터만 고정</option>
                    {units.map((u) => (
                      <optgroup key={u.unit} label={u.name}>
                        {characters
                          .filter((ch) => ch.unit === u.unit && ownedCharIds.has(ch.id))
                          .map((ch) => (
                            <option
                              key={ch.id}
                              value={ch.id}
                              disabled={charsOwned.includes(ch.id) || fixedCardChars.has(ch.id)}
                            >
                              {ch.name}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                  {fixedTotal > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setFixed([]);
                        setFixedLeader(null);
                        setFixedChars([]);
                        setFixedLeaderChar(null);
                      }}
                    >
                      고정 모두 해제
                    </button>
                  )}
                </div>
                {picking && (
                  <CardPicker
                    cards={cards.filter((c) => owned[c.id])}
                    characters={characters}
                    fixed={fixedOwned}
                    full={fixedTotal >= MAX_FIXED}
                    onToggle={toggleFixed}
                  />
                )}
              </section>

              {musicId === RANDOM_SONG && (
                <p className="hint warn-song">
                  공방처럼 곡이 랜덤으로 정해질 때 기준이에요. {REGIONS[region].label}에 나온 곡 전체를 고른 난이도로 평균 낸 가상의 곡으로
                  계산해서, 어떤 곡이 걸려도 평균적으로 포인트가 가장 높은 덱을 찾아요.
                  {liveType !== "multi" && " 공방은 멀티 라이브라 라이브 종류도 멀티로 맞추는 게 좋아요."}
                </p>
              )}
              {selectedSong && !selectedSong.hasMeta && (
                <p className="hint warn-song">
                  「{selectedSong.title}」 곡은 점수 계산용 곡 데이터가 없어서, 길이가 비슷한 곡 15개의 값으로 추정해 계산해요.{" "}
                  {selectedSong.knownTime
                    ? `곡 길이는 ${formatTime(selectedSong.knownTime)} 기준이에요.`
                    : "곡 길이는 노트 수로 추정해요."}
                </p>
              )}
              <p className="hint input-status">
                보유 {ownedCount}장의 특훈, 마스터 랭크, 스킬 레벨, 사이드 스토리는 보유 카드 체크 화면에서 입력한 값을 씁니다.
                {skillUnset > 0 && (
                  <>
                    {" "}
                    스킬 레벨이 없는 카드 {skillUnset}장은 1로 계산해요. <Link href={href("/cards")}>입력하러 가기</Link>
                  </>
                )}
              </p>
              <p className="hint">
                {rankCount + growthItems + growthGates + growthHonors > 0
                  ? `내실은 캐릭터 랭크 ${rankCount}/${characters.length}명, 에어리어 아이템 ${growthItems}개, 마이세카이 게이트 ${growthGates}개, 칭호 ${growthHonors}개를 반영합니다. `
                  : "내실이 입력되지 않아 캐릭터 랭크는 모두 1, 에어리어 아이템·마이세카이·칭호 보너스 없이 계산합니다. "}
                {rankCount > 0 && rankCount < characters.length && "입력하지 않은 캐릭터 랭크는 1로 계산해요. "}
                {canvasCount > 0 && `캔버스를 만든 카드 ${canvasCount}장도 반영해요. `}
                <Link href={href("/growth")}>{rankCount + growthItems + growthGates + growthHonors > 0 ? "내실 수정" : "내실 입력하러 가기"}</Link>
              </p>

              {loadingId === event.id && <p className="hint">카드 조합을 계산하고 있습니다.</p>}
              {errors[event.id] && (
                <section className="notice error">
                  <p>{errors[event.id]}</p>
                </section>
              )}
              {current ? (
                <Results
                  saved={current}
                  cardById={cardById}
                  charName={charName}
                  songTitle={songTitle}
                  fixedNow={fixedOwned}
                  onToggleFixed={toggleFixed}
                />
              ) : (
                loadingId !== event.id &&
                !errors[event.id] && (
                  <p className="hint">이 이벤트는 아직 계산하지 않았어요. 조건을 고르고 최적 덱 찾기를 눌러 주세요.</p>
                )
              )}
            </>
          )}
        </>
      )}
    </main>
  );
}

function EventCard({
  event,
  charName,
  units,
}: {
  event: EventOption;
  charName: Map<number, string>;
  units: { unit: string; name: string }[];
}) {
  return (
    <section className="event picked-event" aria-labelledby="picked-event-name">
      <div className="event-head">
        <span className="event-type">
          <span className={`status status-${event.status}`}>{STATUS_LABEL[event.status]}</span>
          {EVENT_TYPE_LABEL[event.eventType] ?? event.eventType} 이벤트
        </span>
        <h2 id="picked-event-name">{event.name}</h2>
        <p className="event-time">
          {dateFmt.format(event.startAt)} ~ {dateFmt.format(event.aggregateAt)}
        </p>
      </div>
      <div className="bonus">
        <p className="bonus-label">보너스 캐릭터</p>
        {event.bonusCharacters.length > 0 ? (
          <ul className="bonus-chars">
            {event.bonusCharacters.map((b) => {
              const vsSupport = b.characterId > 20 && b.unit !== "piapro";
              return (
                <li key={`${b.characterId}-${b.unit}`} style={{ "--char": b.color } as CSSProperties}>
                  {charName.get(b.characterId)}
                  {vsSupport && <small> ({units.find((u) => u.unit === b.unit)?.name})</small>}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="hint">보너스 정보가 없습니다.</p>
        )}
        {event.bonusAttr && (
          <p className="bonus-attr">
            보너스 속성 <span className={`attr-dot attr-${event.bonusAttr}`} aria-hidden="true" />
            <strong>{ATTR_LABEL[event.bonusAttr]}</strong>
          </p>
        )}
      </div>
    </section>
  );
}

function Results({
  saved,
  cardById,
  charName,
  songTitle,
  fixedNow,
  onToggleFixed,
}: {
  saved: Saved;
  cardById: Map<number, CardView>;
  charName: Map<number, string>;
  songTitle: Map<number, string>;
  fixedNow: number[];
  onToggleFixed: (id: number) => void;
}) {
  const { result } = saved;
  const [best, ...others] = result.decks;
  if (!best) return <p className="hint">조건에 맞는 덱을 찾지 못했습니다.</p>;
  const fmt = (n: number) => Math.round(n).toLocaleString();
  const isTeamLive = result.liveType === "multi" || result.liveType === "cheerful";
  const teamUsed = result.teammatesUsed ?? 0;

  return (
    <section className="result" aria-labelledby="best-deck">
      <div className="result-head">
        <h2 id="best-deck">최적 덱</h2>
        <p className="sub">
          {songTitle.get(result.musicId) ?? `곡 ${result.musicId}`} {result.difficulty.toUpperCase()},{" "}
          {RESULT_LIVE_LABEL[result.liveType]} 1회 기준, &quot;{saved.presetName}&quot; 프리셋
          {result.worldBloomCharacterId !== undefined && `, ${charName.get(result.worldBloomCharacterId)} 챕터`}
          {isTeamLive && teamUsed > 0 && `, 팀원 ${teamUsed}명 입력값 반영`}
          {result.metaSource === "estimated" && <span className="est-badge">추정</span>}
          {result.metaSource === "average" && <span className="est-badge">평균</span>}
        </p>
        {saved.fixed.length + saved.chars.length > 0 && (
          <p className="hint">
            {[
              saved.fixed.length > 0 && `고정 카드 ${saved.fixed.length}장`,
              saved.chars.length > 0 &&
                `고정 캐릭터 ${saved.chars.map((ch) => charName.get(ch)).join(", ")}(가장 좋은 카드로 선택)`,
            ]
              .filter(Boolean)
              .join("과 ")}
            을 넣은 덱이에요
            {saved.leaderChar !== null
              ? `, 리더는 ${charName.get(saved.leaderChar)}로 고정했어요`
              : saved.leader !== null && ", 리더도 고정했어요"}
            . 📌 표시가 고정한 카드예요.
          </p>
        )}
      </div>

      <dl className="stats">
        <div className="stat-main">
          <dt>예상 이벤트 포인트</dt>
          <dd>{fmt(best.eventPoint)}</dd>
        </div>
        <div>
          <dt>이벤트 보너스</dt>
          <dd>+{best.eventBonus.toFixed(1).replace(/\.0$/, "")}%</dd>
        </div>
        <div>
          <dt>종합력</dt>
          <dd>{fmt(best.power)}</dd>
        </div>
        <div title="리더 스킬 효과 + 나머지 4명 스킬 효과 합 × 0.2">
          <dt>실효 스킬</dt>
          <dd>{fmtSkill(effectiveSkill(best))}%</dd>
        </div>
        <div>
          <dt>예상 점수</dt>
          <dd>{fmt(best.liveScore)}</dd>
        </div>
      </dl>

      <ol className="deck-cards">
        {best.cards.map((dc, i) => {
          const c = cardById.get(dc.cardId);
          return (
            <li key={dc.cardId} className={`deck-card attr-border-${c?.attr ?? "cute"}`}>
              {i === 0 && <span className="leader">리더</span>}
              {(saved.fixed.includes(dc.cardId) || (c !== undefined && saved.chars.includes(c.characterId))) && (
                <span className="pin" aria-label="고정한 카드">
                  📌
                </span>
              )}
              {c && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.thumbTrained ?? c.thumbNormal} alt="" width={128} height={128} />
              )}
              <span className="deck-card-name">{c ? charName.get(c.characterId) : dc.cardId}</span>
              <span className="deck-card-title">{c?.title}</span>
              <span className="deck-card-meta">
                {c && RARITY_LABEL[c.rarity]} 마랭 {dc.masterRank}
              </span>
              <span className="deck-card-meta">
                보너스 +{dc.eventBonus}% 스킬 {dc.skillScoreUp}%
              </span>
              <button
                type="button"
                className="pin-toggle"
                aria-pressed={fixedNow.includes(dc.cardId)}
                onClick={() => onToggleFixed(dc.cardId)}
              >
                {fixedNow.includes(dc.cardId) ? "고정 해제" : "이 카드 고정"}
              </button>
            </li>
          );
        })}
      </ol>

      <PowerBreakdown deck={best} cardById={cardById} charName={charName} />

      {others.length > 0 && (
        <details className="others" open>
          <summary>다른 후보 {others.length}개</summary>
          <ol className="alt-list">
            {others.map((d, i) => (
              <li key={i} className="alt">
                <div className="alt-head">
                  <span className="alt-rank">{i + 2}위</span>
                  <span className="alt-ep">
                    {fmt(d.eventPoint)}pt <small>({fmt(d.eventPoint - best.eventPoint)})</small>
                  </span>
                  <span className="alt-meta">
                    보너스 +{d.eventBonus.toFixed(1).replace(/\.0$/, "")}%, 종합력 {fmt(d.power)}, 실효 스킬{" "}
                    {fmtSkill(effectiveSkill(d))}%
                  </span>
                </div>
                <ol className="alt-cards">
                  {d.cards.map((dc, j) => {
                    const c = cardById.get(dc.cardId);
                    const name = c ? charName.get(c.characterId) : String(dc.cardId);
                    return (
                      <li
                        key={dc.cardId}
                        className={`alt-card attr-border-${c?.attr ?? "cute"}`}
                        title={`${name} ${c?.title ?? ""}`}
                      >
                        {j === 0 && <span className="leader">리더</span>}
                        {c && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={c.thumbTrained ?? c.thumbNormal} alt="" width={80} height={80} loading="lazy" />
                        )}
                        <span className="alt-card-name">{name}</span>
                        <span className="alt-card-meta">
                          {c && RARITY_LABEL[c.rarity]} 마랭 {dc.masterRank}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </li>
            ))}
          </ol>
        </details>
      )}

      <p className="assume">
        라이브 보너스(에너지) 미사용, 카드 레벨 최대 기준입니다. 실효 스킬은 리더 스킬 효과에 나머지 4명 스킬 효과 합의
        0.2배를 더한 값이에요.
        {isTeamLive &&
          (teamUsed > 0
            ? ` 팀원 ${teamUsed}명은 입력한 종합력·실효 스킬로${teamUsed < 4 ? ", 나머지 팀원은 내 덱과 같다고" : ""} 계산했어요. 1~5번째 스킬은 5명이 한 번씩 순서 무작위로(평균), 6번째 스킬은 실효 스킬이 가장 높은 사람 것으로 봐요.`
            : " 팀원은 입력하지 않아서 다른 4명이 나와 같은 덱으로 같은 점수를 낸다고 가정했어요.")}
        {result.metaSource === "estimated" &&
          ` 이 곡은 곡 데이터가 없어 길이가 비슷한 곡들로 점수를 추정했어요(곡 길이 ${formatTime(result.musicTime)}${
            result.musicTimeSource === "estimated" ? ", 노트 수로 추정" : result.musicTimeSource === "input" ? ", 입력값" : ""
          }). 덱 순위는 믿을 만하지만 포인트는 ${result.musicTimeSource === "estimated" ? "10%" : "6%"} 안팎 차이가 날 수 있어요.`}
        {result.metaSource === "average" &&
          ` 랜덤 곡은 이 서버 곡 ${result.averagedSongs}곡의 ${result.difficulty.toUpperCase()} 평균 기준이라, 실제로 걸린 곡에 따라 포인트가 위아래로 달라져요.`}
        {result.metaSource === "fallback" && " 선택한 곡의 점수 데이터를 불러오지 못해 혼자 놀이 엔비 EXPERT 기준으로 계산했습니다."}
      </p>
    </section>
  );
}

const POWER_COLUMNS = [
  { key: "base", label: "카드 기본" },
  { key: "areaItemBonus", label: "에어리어 아이템" },
  { key: "characterBonus", label: "캐릭터 랭크" },
  { key: "fixtureBonus", label: "마이세카이 인형" },
  { key: "gateBonus", label: "마이세카이 게이트" },
] as const;

/** 최적 덱의 종합력이 어떤 값들로 이뤄졌는지 펼쳐 보는 표 */
function PowerBreakdown({
  deck,
  cardById,
  charName,
}: {
  deck: RecommendResult["decks"][number];
  cardById: Map<number, CardView>;
  charName: Map<number, string>;
}) {
  const [open, setOpen] = useState(false);
  const fmt = (n: number) => Math.round(n).toLocaleString();
  const d = deck.powerDetail;
  const pct = (n: number) => (d.total > 0 ? `${((n / d.total) * 100).toFixed(1)}%` : "");

  return (
    <div className="power">
      <button type="button" className="power-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? "종합력 계산 접기" : "종합력 계산 보기"}
      </button>
      {open && (
        <>
          <div className="power-scroll">
            <table className="power-table">
              <caption>종합력 {fmt(d.total)}의 구성</caption>
              <thead>
                <tr>
                  <th scope="col">카드</th>
                  {POWER_COLUMNS.map((c) => (
                    <th key={c.key} scope="col">
                      {c.label}
                    </th>
                  ))}
                  <th scope="col">칭호</th>
                  <th scope="col">합계</th>
                </tr>
              </thead>
              <tbody>
                {deck.cards.map((dc, i) => {
                  const c = cardById.get(dc.cardId);
                  return (
                    <tr key={dc.cardId}>
                      <th scope="row">
                        {i === 0 && <span className="power-leader">리더</span>}
                        {c ? charName.get(c.characterId) : dc.cardId}
                        {c && <small>{c.title}</small>}
                      </th>
                      {POWER_COLUMNS.map((col) => (
                        <td key={col.key}>{dc.powerDetail[col.key] ? fmt(dc.powerDetail[col.key]) : "-"}</td>
                      ))}
                      <td>-</td>
                      <td className="power-sum">{fmt(dc.powerDetail.total)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">덱 합계</th>
                  {POWER_COLUMNS.map((col) => (
                    <td key={col.key}>
                      {fmt(d[col.key])}
                      <small>{pct(d[col.key])}</small>
                    </td>
                  ))}
                  <td>
                    {fmt(d.honorBonus)}
                    <small>{pct(d.honorBonus)}</small>
                  </td>
                  <td className="power-sum">{fmt(d.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="hint power-note">
            카드 기본은 카드 레벨(최대 기준), 특훈, 마스터 랭크, 사이드 스토리, 마이세카이 캔버스를 반영한 카드 자체의
            종합력이에요. 에어리어 아이템·캐릭터 랭크·마이세카이 보너스는 카드 기본에 비율로 더해지고, 칭호 보너스는 덱
            전체에 한 번 더해져요. 값은 내실 화면과 보유 카드 체크 화면에 입력한 내용으로 계산했어요.
          </p>
        </>
      )}
    </div>
  );
}

/** 보유 카드 중에서 고정할 카드를 고르는 목록 */
function CardPicker({
  cards,
  characters,
  fixed,
  full,
  onToggle,
}: {
  cards: CardView[];
  characters: { id: number; name: string }[];
  fixed: number[];
  full: boolean;
  onToggle: (id: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [charId, setCharId] = useState<number | "all">("all");
  const charName = new Map(characters.map((c) => [c.id, c.name]));
  const q = query.trim();
  const list = cards.filter(
    (c) =>
      (charId === "all" || c.characterId === charId) &&
      (q === "" || c.title.includes(q) || (charName.get(c.characterId) ?? "").includes(q)),
  );
  const LIMIT = 60;
  return (
    <div className="picker">
      <div className="picker-filters">
        <label className="field">
          <span>캐릭터</span>
          <select value={charId} onChange={(e) => setCharId(e.target.value === "all" ? "all" : Number(e.target.value))}>
            <option value="all">전체</option>
            {characters
              .filter((ch) => cards.some((c) => c.characterId === ch.id))
              .map((ch) => (
                <option key={ch.id} value={ch.id}>
                  {ch.name}
                </option>
              ))}
          </select>
        </label>
        <label className="field grow">
          <span>카드·캐릭터 이름</span>
          <input type="search" value={query} placeholder="예: 미쿠, Happy Birthday" onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>
      <p className="hint">
        보유 카드 {list.length}장{list.length > LIMIT && ` 중 ${LIMIT}장만 보여요. 캐릭터나 이름으로 좁혀 보세요`}.
        {full && " 이미 5장을 고정해서, 더 넣으려면 하나를 빼야 해요."} 같은 캐릭터 카드를 고르면 원래 고정한 카드와 바뀌어요.
      </p>
      <ul className="picker-grid">
        {list.slice(0, LIMIT).map((c) => {
          const on = fixed.includes(c.id);
          return (
            <li key={c.id}>
              <button
                type="button"
                className={`picker-card attr-border-${c.attr}`}
                aria-pressed={on}
                disabled={!on && full && !fixed.some((id) => cards.find((x) => x.id === id)?.characterId === c.characterId)}
                onClick={() => onToggle(c.id)}
                title={`${charName.get(c.characterId)} ${c.title}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.thumbTrained ?? c.thumbNormal} alt="" width={64} height={64} loading="lazy" />
                <span className="picker-name">{charName.get(c.characterId)}</span>
                <span className="picker-title">{c.title}</span>
                {on && (
                  <span className="pin" aria-hidden="true">
                    📌
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
