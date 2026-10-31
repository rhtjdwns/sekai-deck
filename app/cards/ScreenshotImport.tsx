"use client";

import { useEffect, useRef, useState } from "react";
import type { CardView, Rarity } from "@/lib/master";
import type { OwnedCard } from "@/lib/presets";
import { detectTilesWithCut, readDigits, tileFeature, type RGBAImage, type TileBox } from "@/lib/screenshot";

const RARITY_LABEL: Record<Rarity, string> = {
  rarity_4: "★4",
  rarity_birthday: "생일",
  rarity_3: "★3",
  rarity_2: "★2",
  rarity_1: "★1",
};

type Candidate = { cardId: number; trained: boolean; distance: number };

/** 가장 비슷한 카드와의 차이가 이보다 크면 일러스트를 알아볼 수 없는 칸으로 보고 뺌 (제대로 맞은 카드는 보통 3~10) */
const MAX_MATCH_DISTANCE = 15;

interface Row {
  key: string;
  tileUrl: string;
  candidates: Candidate[];
  /** 고른 후보 번호, -1이면 제외 */
  pick: number;
  trained: boolean;
  skillLevel: number;
  masterRank: number;
  sure: boolean;
  /** 스킬 레벨·마랭 숫자를 확실히 읽었는지 */
  digitsSure: boolean;
}

type Status = { kind: "idle" } | { kind: "working"; message: string } | { kind: "error"; message: string };

/** 이미지를 배율대로 그려서 픽셀 데이터로 */
function toImage(bmp: ImageBitmap, scale: number): { img: RGBAImage; canvas: HTMLCanvasElement } {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { img: { width: data.width, height: data.height, data: data.data }, canvas };
}

/** 카드 칸 찾기. 작게 찍힌 스크린샷은 확대해서 다시 찾음 */
function findTiles(bmp: ImageBitmap) {
  let best: { img: RGBAImage; canvas: HTMLCanvasElement; tiles: TileBox[]; cut: number } | null = null;
  const tried = new Set<number>();
  const tryScale = (s: number) => {
    const key = Math.round(s * 100);
    if (tried.has(key) || s <= 0 || bmp.width * s > 6000) return;
    tried.add(key);
    const { img, canvas } = toImage(bmp, s);
    const { tiles, cut } = detectTilesWithCut(img);
    const closeness = (t: TileBox[]) => (t.length ? Math.abs(t[0].size - 80) : 999);
    if (!best || tiles.length > best.tiles.length || (tiles.length === best.tiles.length && closeness(tiles) < closeness(best.tiles))) {
      best = { img, canvas, tiles, cut };
    }
  };
  tryScale(1);
  const first = best as { tiles: TileBox[] } | null;
  const size = first?.tiles[0]?.size;
  if (size && size < 76) tryScale(80 / size);
  if (!first || first.tiles.length < 3) tryScale(2);
  return best as { img: RGBAImage; canvas: HTMLCanvasElement; tiles: TileBox[]; cut: number } | null;
}

function cropUrl(canvas: HTMLCanvasElement, t: TileBox) {
  const c = document.createElement("canvas");
  c.width = 72;
  c.height = 72;
  c.getContext("2d")!.drawImage(canvas, t.x, t.y, t.size, t.size, 0, 0, 72, 72);
  return c.toDataURL("image/jpeg", 0.85);
}

export default function ScreenshotImport({
  cardById,
  charName,
  ownedIds,
  onApply,
}: {
  cardById: Map<number, CardView>;
  charName: Map<number, string>;
  ownedIds: Set<number>;
  onApply: (entries: { id: number; detail: OwnedCard }[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [rows, setRows] = useState<Row[]>([]);
  const [done, setDone] = useState<string | null>(null);
  const [cutCount, setCutCount] = useState(0);
  const [unknownCount, setUnknownCount] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  // 패널을 열면 서버가 카드 이미지 정보를 미리 준비하게 함 (처음 한 번은 오래 걸림)
  useEffect(() => {
    if (open) fetch("/api/match-cards").catch(() => {});
  }, [open]);

  const analyze = async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    setDone(null);
    try {
      const found: { url: string; feature: number[]; skill: number | null; mr: number | null; digitsSure: boolean }[] = [];
      let cut = 0;
      for (const [i, file] of images.entries()) {
        setStatus({ kind: "working", message: `스크린샷 ${i + 1}/${images.length}에서 카드 칸을 찾고 있어요.` });
        const bmp = await createImageBitmap(file);
        const res = findTiles(bmp);
        bmp.close();
        if (!res) continue;
        cut += res.cut;
        if (res.tiles.length === 0) continue;
        for (const t of res.tiles) {
          const digits = readDigits(res.img, t);
          found.push({
            url: cropUrl(res.canvas, t),
            feature: tileFeature(res.img, t),
            skill: digits.skill,
            mr: digits.rank,
            digitsSure: digits.skillSure && digits.rankSure,
          });
        }
      }
      setCutCount((c) => c + cut);
      if (found.length === 0) {
        setStatus({
          kind: "error",
          message:
            cut > 0
              ? `사진 가장자리에서 잘린 카드 ${cut}장만 있어서 뺐어요. 카드가 온전히 보이게 캡처해 주세요.`
              : "카드 칸을 찾지 못했어요. 게임의 카드 목록 화면을 스킬 레벨 띠가 보이게 캡처해 주세요. 너무 작게 찍히면 인식이 안 돼요.",
        });
        return;
      }
      setStatus({
        kind: "working",
        message: `카드 ${found.length}장을 대조하고 있어요. 처음 한 번은 카드 이미지 정보를 만드느라 1~2분 걸릴 수 있어요.`,
      });
      const res = await fetch("/api/match-cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tiles: found.map((f) => f.feature) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "카드를 대조하지 못했습니다.");
      const matches = data.matches as Candidate[][];
      // 일러스트가 가려졌거나 카드가 아닌 칸은 비슷한 카드가 없으니 뺌
      const recognizable = found
        .map((f, i) => ({ f, cands: matches[i] ?? [] }))
        .filter(({ cands }) => cands[0] && cands[0].distance <= MAX_MATCH_DISTANCE);
      const unknown = found.length - recognizable.length;
      setUnknownCount((c) => c + unknown);
      if (recognizable.length === 0) {
        setStatus({
          kind: "error",
          message: `찾은 칸 ${found.length}개 모두 일러스트로 카드를 알아볼 수 없어서 뺐어요. 카드가 가려지지 않게 캡처해 주세요.`,
        });
        return;
      }
      const next: Row[] = recognizable.map(({ f, cands }, i) => {
        const [a, b] = cands;
        const sure = Boolean(a && a.distance <= 12 && (!b || b.distance - a.distance >= 8));
        const card = a ? cardById.get(a.cardId) : undefined;
        return {
          key: `${Date.now()}-${i}`,
          tileUrl: f.url,
          candidates: cands,
          pick: cands.length ? 0 : -1,
          trained: Boolean(a?.trained && card?.thumbTrained),
          skillLevel: f.skill ?? 1,
          masterRank: f.mr ?? 0,
          sure,
          digitsSure: f.digitsSure,
        };
      });
      setRows((prev) => [...prev, ...next]);
      setStatus({ kind: "idle" });
    } catch (e) {
      setStatus({ kind: "error", message: (e as Error).message });
    }
  };

  // 붙여넣기(Ctrl+V)로도 스크린샷 받기
  useEffect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) analyze(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const update = (key: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const picked = rows.filter((r) => r.pick >= 0 && r.candidates[r.pick]);
  const unsure = picked.filter((r) => !r.sure || !r.digitsSure).length;

  const apply = () => {
    // 같은 카드가 여러 번 나오면 나중 것으로
    const map = new Map<number, OwnedCard>();
    for (const r of picked) {
      const c = r.candidates[r.pick];
      const card = cardById.get(c.cardId);
      map.set(c.cardId, {
        trained: Boolean(card?.thumbTrained) && r.trained,
        masterRank: r.masterRank,
        skillLevel: r.skillLevel,
        canvas: true,
        storyFirst: true,
        storySecond: true,
      });
    }
    const entries = Array.from(map, ([id, detail]) => ({ id, detail }));
    onApply(entries);
    const added = entries.filter((e) => !ownedIds.has(e.id)).length;
    setDone(`${entries.length}장을 반영했어요. 새로 추가 ${added}장, 기존 카드 갱신 ${entries.length - added}장.`);
    setRows([]);
    setCutCount(0);
    setUnknownCount(0);
  };

  return (
    <section className="shot">
      <button type="button" className="shot-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        스크린샷으로 보유 카드 추가
      </button>

      {open && (
        <div className="shot-body">
          <p className="hint">
            게임의 카드 목록 화면을 캡처해서 올리거나 붙여넣기(Ctrl+V) 하세요. 일러스트로 카드를 찾고, 스킬 레벨과 마스터
            랭크를 읽어요. 사이드 스토리와 캔버스는 완료로 넣어요.
          </p>
          <div className="shot-guide">
            <p className="shot-guide-title">캡처 전에 꼭 확인하세요: 카드 아래에 스킬 레벨(SLv)이 보여야 해요</p>
            <div className="shot-guide-body">
              <ol className="shot-guide-steps">
                <li>
                  게임에서 <strong>멤버</strong> → <strong>멤버 목록</strong>으로 들어가요.
                </li>
                <li>
                  오른쪽 위의 <strong>정렬 버튼</strong>(지금 정렬 이름이 적힌 칸)을 눌러요.
                </li>
                <li>
                  목록에서 <strong>스킬 레벨</strong>을 골라요. 카드마다 아래에 &quot;SLv.4&quot;처럼 스킬 레벨이 표시돼요.
                </li>
                <li>카드가 잘리지 않게 화면을 캡처해서 올려 주세요. 여러 장을 나눠 찍어 한꺼번에 올려도 돼요.</li>
              </ol>
              <div className="shot-guide-demo" aria-hidden="true">
                <span className="shot-guide-sortbtn">스킬 레벨 ▾</span>
                <ul>
                  <li>획득순</li>
                  <li>퍼포먼스</li>
                  <li>희귀도</li>
                  <li>레벨</li>
                  <li className="on">스킬 레벨</li>
                  <li>마스터 랭크</li>
                  <li>이벤트 보너스</li>
                </ul>
              </div>
            </div>
            <p className="shot-guide-note">
              다른 정렬에서는 카드 아래 띠에 스킬 레벨 대신 다른 값이 나와서, 카드 칸을 찾지 못하거나 스킬 레벨을 잘못 읽어요.
            </p>
          </div>
          <div className="shot-actions">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={status.kind === "working"}>
              스크린샷 고르기
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                analyze(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            {rows.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setRows([]);
                  setCutCount(0);
                  setUnknownCount(0);
                }}
              >
                목록 비우기
              </button>
            )}
          </div>

          {status.kind === "working" && <p className="hint">{status.message}</p>}
          {status.kind === "error" && <p className="hint warn">{status.message}</p>}
          {done && <p className="hint">{done}</p>}

          {rows.length > 0 && (
            <>
              <p className="hint">
                인식한 카드 {rows.length}장{unsure > 0 && `, 이 중 ${unsure}장은 확인이 필요해요`}.
                {cutCount > 0 && ` 사진 가장자리에서 잘린 카드 ${cutCount}장은 뺐어요.`}
                {unknownCount > 0 && ` 일러스트로 카드를 알아볼 수 없는 칸 ${unknownCount}개도 뺐어요.`} 틀린 카드는 다른
                후보를 고르거나 제외하고, 스킬 레벨과 마랭을 확인한 뒤 반영하세요.
              </p>
              <ul className="shot-list">
                {rows.map((r) => {
                  const c = r.pick >= 0 ? r.candidates[r.pick] : undefined;
                  const card = c ? cardById.get(c.cardId) : undefined;
                  return (
                    <li
                      key={r.key}
                      className={`shot-row${r.pick < 0 ? " excluded" : ""}${r.sure && r.digitsSure ? "" : " unsure"}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={r.tileUrl} alt="스크린샷 칸" width={56} height={56} className="shot-tile" />
                      <span className="shot-arrow" aria-hidden="true">→</span>
                      {card ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={r.trained && card.thumbTrained ? card.thumbTrained : card.thumbNormal}
                          alt=""
                          width={56}
                          height={56}
                          className={`shot-card attr-border-${card.attr}`}
                        />
                      ) : (
                        <span className="shot-card empty" />
                      )}
                      <div className="shot-info">
                        <select
                          value={r.pick}
                          onChange={(e) => {
                            const pick = Number(e.target.value);
                            const cand = r.candidates[pick];
                            update(r.key, { pick, trained: cand ? cand.trained : r.trained, sure: true });
                          }}
                          aria-label="카드 선택"
                        >
                          {r.candidates.map((cand, i) => {
                            const cv = cardById.get(cand.cardId);
                            return (
                              <option key={cand.cardId} value={i}>
                                {i === 0 ? "" : `${i + 1}순위: `}
                                {cv ? `${charName.get(cv.characterId)} ${RARITY_LABEL[cv.rarity]} ${cv.title}` : cand.cardId}
                              </option>
                            );
                          })}
                          <option value={-1}>추가하지 않음</option>
                        </select>
                        {!r.sure && r.pick >= 0 && <span className="shot-badge">카드 확인 필요</span>}
                        {r.sure && !r.digitsSure && r.pick >= 0 && <span className="shot-badge">숫자 확인 필요</span>}
                        {ownedIds.has(c?.cardId ?? -1) && <span className="shot-owned">이미 보유</span>}
                      </div>
                      <div className="shot-detail">
                        {card?.thumbTrained && (
                          <label className="mini-check">
                            <input type="checkbox" checked={r.trained} onChange={(e) => update(r.key, { trained: e.target.checked })} />
                            특훈
                          </label>
                        )}
                        <label className="mini-select">
                          스킬
                          <select
                            value={r.skillLevel}
                            onChange={(e) => update(r.key, { skillLevel: Number(e.target.value), digitsSure: true })}
                          >
                            {[1, 2, 3, 4].map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="mini-select">
                          마랭
                          <select
                            value={r.masterRank}
                            onChange={(e) => update(r.key, { masterRank: Number(e.target.value), digitsSure: true })}
                          >
                            {[0, 1, 2, 3, 4, 5].map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="shot-actions">
                <button type="button" className="primary" onClick={apply} disabled={picked.length === 0}>
                  {picked.length}장 보유 카드에 반영
                </button>
              </div>
              <p className="hint">이미 체크된 카드는 스크린샷 값으로 바뀌어요.</p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
