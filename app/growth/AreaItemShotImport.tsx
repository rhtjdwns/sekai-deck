"use client";

import { useEffect, useRef, useState } from "react";
import type { AreaItemInfo } from "@/lib/growth";
import "./areaItemShot.css";

interface ShotItem {
  preview: string;
  ocrName: string;
  areaItemId: number | null;
  nameScore: number;
  level: number | null;
  sure: boolean;
}

interface Row extends ShotItem {
  key: string;
  /** 고른 아이템 (null이면 추가하지 않음) */
  pick: number | null;
  pickLevel: number;
}

type Status = { kind: "idle" } | { kind: "working"; message: string } | { kind: "error"; message: string };

export default function AreaItemShotImport({
  items,
  current,
  onApply,
}: {
  items: AreaItemInfo[];
  current: Record<number, number>;
  onApply: (levels: Record<number, number>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [rows, setRows] = useState<Row[]>([]);
  const [cutCount, setCutCount] = useState(0);
  const [done, setDone] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 같은 이름(뮤직 스피커)은 번호를 붙여 구분
  const labelOf = (() => {
    const counts = new Map<string, number>();
    const label = new Map<number, string>();
    for (const it of [...items].sort((a, b) => a.id - b.id)) {
      const total = items.filter((x) => x.name === it.name).length;
      const n = (counts.get(it.name) ?? 0) + 1;
      counts.set(it.name, n);
      label.set(it.id, total > 1 ? `${it.name} ${n}` : it.name);
    }
    return (id: number) => label.get(id) ?? String(id);
  })();
  const itemById = new Map(items.map((it) => [it.id, it]));
  const groups: { title: string; list: AreaItemInfo[] }[] = [
    { title: "캐릭터", list: items.filter((i) => i.group === "character") },
    { title: "유닛", list: items.filter((i) => i.group === "unit") },
    { title: "타입", list: items.filter((i) => i.group === "attr") },
  ];

  const analyze = async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    setDone(null);
    setStatus({ kind: "working", message: `스크린샷 ${images.length}장에서 아이템 이름과 레벨을 읽고 있어요.` });
    try {
      const form = new FormData();
      for (const f of images.slice(0, 10)) form.append("images", f);
      const res = await fetch("/api/area-items", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "스크린샷을 읽지 못했습니다.");
      const found = data.items as ShotItem[];
      setCutCount((c) => c + (data.cut as number));
      if (found.length === 0) {
        setStatus({
          kind: "error",
          message:
            data.cut > 0
              ? "위아래가 잘린 칸만 있어서 읽지 못했어요. 아이템 칸이 온전히 보이게 캡처해 주세요."
              : "아이템 칸을 찾지 못했어요. 소지품의 에어리어 아이템 화면을 캡처했는지 확인해 주세요.",
        });
        return;
      }
      const stamp = Date.now();
      setRows((prev) => [
        ...prev,
        ...found.map((f, i) => {
          const max = f.areaItemId ? itemById.get(f.areaItemId)?.maxLevel ?? 20 : 20;
          return {
            ...f,
            key: `${stamp}-${i}`,
            pick: f.areaItemId,
            pickLevel: Math.min(max, f.level ?? 0),
          };
        }),
      ]);
      setStatus({ kind: "idle" });
      if (images.length > 10) setDone("한 번에 10장까지만 읽어요. 나머지는 다시 올려 주세요.");
    } catch (e) {
      setStatus({ kind: "error", message: (e as Error).message });
    }
  };

  // 붙여넣기(Ctrl+V)로도 받기
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

  const picked = rows.filter((r) => r.pick !== null);
  const unsure = picked.filter((r) => !r.sure).length;

  const apply = () => {
    // 같은 아이템이 여러 번 나오면 나중 것으로
    const levels: Record<number, number> = {};
    for (const r of picked) levels[r.pick!] = r.pickLevel;
    onApply(levels);
    const n = Object.keys(levels).length;
    setDone(`에어리어 아이템 ${n}개의 레벨을 반영했어요.`);
    setRows([]);
    setCutCount(0);
  };

  return (
    <section className="ai-shot">
      <button type="button" className="ai-shot-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        스크린샷으로 에어리어 아이템 입력
      </button>

      {open && (
        <div className="ai-shot-body">
          <div className="ai-guide">
            <p className="ai-guide-title">이렇게 캡처해 주세요</p>
            <ol>
              <li>
                게임 화면 <strong>오른쪽 위 메뉴</strong> → <strong>소지품</strong> → 왼쪽의 <strong>에어리어 아이템</strong>
                탭으로 들어가요.
              </li>
              <li>아이템 이름과 &quot;Lv.15&quot; 같은 레벨이 보이게, 칸이 잘리지 않도록 캡처해요.</li>
              <li>목록을 내리면서 여러 장 찍어 한꺼번에 올려도 돼요. 위아래가 잘린 칸은 자동으로 빼요.</li>
            </ol>
            <p className="ai-guide-note">
              아이템 이름과 레벨 글자를 읽어서 입력해요. 마이세카이 인형 보너스는 아래 칸에 직접 입력해 주세요.
            </p>
          </div>

          <div className="ai-actions">
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
                }}
              >
                목록 비우기
              </button>
            )}
          </div>

          {status.kind === "working" && <p className="hint">{status.message}</p>}
          {status.kind === "error" && <p className="hint ai-warn">{status.message}</p>}
          {done && <p className="hint">{done}</p>}

          {rows.length > 0 && (
            <>
              <p className="hint">
                읽은 아이템 {rows.length}개{unsure > 0 && `, 이 중 ${unsure}개는 확인이 필요해요`}.
                {cutCount > 0 && ` 위아래가 잘린 칸 ${cutCount}개는 뺐어요.`} 틀린 것은 고친 뒤 반영하세요.
              </p>
              <ul className="ai-list">
                {rows.map((r) => {
                  const it = r.pick !== null ? itemById.get(r.pick) : undefined;
                  const now = r.pick !== null ? current[r.pick] ?? 0 : 0;
                  return (
                    <li key={r.key} className={`ai-row${r.sure ? "" : " unsure"}${r.pick === null ? " excluded" : ""}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={r.preview} alt="" width={56} height={60} className="ai-preview" />
                      <div className="ai-fields">
                        <select
                          value={r.pick ?? ""}
                          aria-label="아이템"
                          onChange={(e) => {
                            const pick = e.target.value === "" ? null : Number(e.target.value);
                            const max = pick !== null ? itemById.get(pick)?.maxLevel ?? 20 : 20;
                            update(r.key, { pick, pickLevel: Math.min(max, r.pickLevel), sure: true });
                          }}
                        >
                          {groups.map((g) => (
                            <optgroup key={g.title} label={g.title}>
                              {g.list.map((i) => (
                                <option key={i.id} value={i.id}>
                                  {labelOf(i.id)}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                          <option value="">추가하지 않음</option>
                        </select>
                        <label className="ai-level">
                          Lv
                          <select
                            value={r.pickLevel}
                            onChange={(e) => update(r.key, { pickLevel: Number(e.target.value), sure: true })}
                          >
                            {Array.from({ length: (it?.maxLevel ?? 20) + 1 }, (_, n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                        </label>
                        {!r.sure && r.pick !== null && <span className="ai-badge">확인 필요</span>}
                        {r.pick !== null && now !== r.pickLevel && (
                          <span className="ai-diff">
                            지금 {now} → {r.pickLevel}
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="ai-actions">
                <button type="button" className="primary" onClick={apply} disabled={picked.length === 0}>
                  {picked.length}개 레벨 반영
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
