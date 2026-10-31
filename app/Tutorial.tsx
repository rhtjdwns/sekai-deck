"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { currentRegion, regionHref, regionOfPath, stripRegion } from "@/lib/region";
import "./tutorial.css";

// ---------- 저장 ----------
const STORE_KEY = "sekai-deck-kr:tutorial";
const PRESET_KEY = "sekai-deck-kr:presets";
/** 다른 곳(메인 화면 버튼)에서 튜토리얼을 시작할 때 보내는 이벤트 */
export const TUTORIAL_START_EVENT = "sekai-deck-kr:tutorial-start";

type Status = "unseen" | "active" | "done" | "dismissed";
interface Saved {
  status: Status;
  step: number;
}

function loadSaved(): Saved {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Saved;
      if (s && typeof s.step === "number") return s;
    }
  } catch {
    // 저장소를 못 쓰면 처음 상태
  }
  return { status: "unseen", step: 0 };
}

function save(s: Saved) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    // 무시
  }
}

/** 지금 고른 프리셋의 보유 카드 수와 내실 입력 개수 */
function readProgress() {
  try {
    // 서버마다 프리셋을 따로 저장 (lib/presets.ts와 같은 이름)
    const raw = localStorage.getItem(currentRegion() === "jp" ? `${PRESET_KEY}:jp` : PRESET_KEY);
    if (!raw) return { cards: 0, growth: 0 };
    const store = JSON.parse(raw) as {
      activeId: string;
      presets: {
        id: string;
        cards?: Record<string, unknown>;
        characterRanks?: Record<string, unknown>;
        growth?: Record<string, Record<string, unknown>>;
      }[];
    };
    const p = store.presets.find((x) => x.id === store.activeId) ?? store.presets[0];
    if (!p) return { cards: 0, growth: 0 };
    const g = p.growth ?? {};
    const growth =
      Object.keys(p.characterRanks ?? {}).length +
      ["areaItems", "gates", "fixtures", "honors"].reduce((n, k) => n + Object.keys(g[k] ?? {}).length, 0);
    return { cards: Object.keys(p.cards ?? {}).length, growth };
  } catch {
    return { cards: 0, growth: 0 };
  }
}

// ---------- 단계 ----------
const all = (sel: string) => () => Array.from(document.querySelectorAll(sel));
/** 지금 서버(한섭·일섭)에 맞는 메뉴 링크 */
const menuLinks = (path: string) => () =>
  Array.from(document.querySelectorAll(`a[href="${regionHref(currentRegion(), path)}"]`));

interface Step {
  /** 이 단계가 진행되는 화면 */
  page: string;
  /** 상단 메뉴를 누르는 단계처럼 어느 화면에서든 할 수 있으면 true */
  anyPage?: boolean;
  pageName: string;
  title: string;
  body: string;
  /** 강조할 요소 */
  targets: () => Element[];
  /** 다음 단계로 넘어가는 조건 (없으면 "다음" 버튼으로 넘어감) */
  done?: (ctx: { pathname: string; cards: number; growth: number }) => boolean;
  /** "다음" 버튼 이름 */
  nextLabel?: string;
}

const STEPS: Step[] = [
  {
    page: "/",
    pageName: "첫 화면",
    anyPage: true,
    title: "보유 카드 체크하기를 눌러 보세요",
    body: "먼저 내가 가진 카드를 알려 줘야 덱을 짤 수 있어요. 빛나는 메뉴를 눌러 주세요.",
    targets: menuLinks("/cards"),
    done: ({ pathname }) => pathname === "/cards",
  },
  {
    page: "/cards",
    pageName: "보유 카드 체크",
    title: "가진 카드를 5장 이상 추가하세요",
    body:
      "게임의 카드 목록 화면을 캡처했다면 '스크린샷으로 보유 카드 추가'를, 직접 고르려면 '체크 시작'을 누르고 카드를 눌러 체크하세요. 5장이 되면 다음으로 넘어가요.",
    targets: () => [
      ...Array.from(document.querySelectorAll(".shot-toggle")),
      ...Array.from(document.querySelectorAll(".listbar-actions > button[aria-pressed]")),
    ],
    done: ({ cards }) => cards >= 5,
  },
  {
    page: "/cards",
    pageName: "보유 카드 체크",
    anyPage: true,
    title: "이제 내실 메뉴로 가 볼까요",
    body: "캐릭터 랭크와 에어리어 아이템처럼 종합력을 올려 주는 요소를 입력하는 곳이에요. 빛나는 메뉴를 눌러 주세요.",
    targets: menuLinks("/growth"),
    done: ({ pathname }) => pathname === "/growth",
  },
  {
    page: "/growth",
    pageName: "내실",
    title: "내가 가진 보너스 요소를 입력하세요",
    body:
      "캐릭터 랭크, 에어리어 아이템 레벨, 마이세카이 게이트, 칭호 중 가진 것을 입력하거나 체크하세요. 정확할수록 덱 계산이 실제와 가까워져요. 다 했으면 다음을 눌러 주세요.",
    targets: all(".g-section"),
    nextLabel: "입력 끝, 다음",
  },
  {
    page: "/growth",
    pageName: "내실",
    anyPage: true,
    title: "덱 편성 도우미로 이동하세요",
    body: "입력한 카드와 내실로 이벤트에 가장 좋은 덱을 찾아 줘요. 빛나는 메뉴를 눌러 주세요.",
    targets: menuLinks("/deck"),
    done: ({ pathname }) => pathname === "/deck",
  },
  {
    page: "/deck",
    pageName: "덱 편성 도우미",
    title: "곡과 난이도를 고르고 최적 덱 찾기를 누르세요",
    body: "효율곡이나 공방용 랜덤 곡을 고르고, 평소 하는 난이도를 고른 뒤 '최적 덱 찾기'를 눌러 보세요.",
    targets: () => {
      const labels = Array.from(document.querySelectorAll(".deck-options > label.field"));
      return [
        ...labels.filter((l) => l.classList.contains("grow")), // 곡
        ...labels.slice(-1).filter((l) => !l.classList.contains("grow")), // 난이도
        ...Array.from(document.querySelectorAll(".deck-options .run")),
      ];
    },
    done: () => Boolean(document.getElementById("best-deck")),
  },
];

// ---------- 화면 ----------
type Ring = { key: string; top: number; left: number; width: number; height: number };

export default function Tutorial() {
  const fullPath = usePathname() ?? "/";
  // 단계의 화면 비교는 서버 부분(/jp)을 뺀 경로로
  const pathname = stripRegion(fullPath);
  const region = regionOfPath(fullPath);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [rings, setRings] = useState<Ring[]>([]);
  const [progress, setProgress] = useState({ cards: 0, growth: 0 });
  const scrolledFor = useRef<number>(-1);

  const update = useCallback((s: Saved) => {
    save(s);
    setSaved(s);
  }, []);

  // 브라우저에서만 불러옴
  useEffect(() => setSaved(loadSaved()), []);

  // 메인 화면의 "사용법 따라하기" 버튼
  useEffect(() => {
    const start = () => update({ status: "active", step: 0 });
    window.addEventListener(TUTORIAL_START_EVENT, start);
    return () => window.removeEventListener(TUTORIAL_START_EVENT, start);
  }, [update]);

  const active = saved?.status === "active";
  const stepIndex = saved?.step ?? 0;
  const step = active ? STEPS[stepIndex] : undefined;
  const finished = active && stepIndex >= STEPS.length;

  // 진행 상황 확인 + 강조 위치 갱신 (화면이 바뀌거나 요소가 늦게 나타나도 따라가게 주기적으로)
  useEffect(() => {
    if (!step) {
      setRings([]);
      return;
    }
    const tick = () => {
      const p = readProgress();
      setProgress(p);
      if (step.done?.({ pathname, ...p })) {
        update({ status: "active", step: stepIndex + 1 });
        return;
      }
      const els = step.anyPage || pathname === step.page ? step.targets() : [];
      const visible = els.filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      if (visible.length && scrolledFor.current !== stepIndex) {
        scrolledFor.current = stepIndex;
        const r = visible[0].getBoundingClientRect();
        if (r.top < 60 || r.bottom > window.innerHeight - 160) {
          visible[0].scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
      setRings(
        visible.map((el, i) => {
          const r = el.getBoundingClientRect();
          return { key: `${stepIndex}-${i}`, top: r.top - 6, left: r.left - 6, width: r.width + 12, height: r.height + 12 };
        }),
      );
    };
    tick();
    const timer = window.setInterval(tick, 400);
    window.addEventListener("scroll", tick, { passive: true });
    window.addEventListener("resize", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("scroll", tick);
      window.removeEventListener("resize", tick);
    };
  }, [step, stepIndex, pathname, update]);

  if (!saved) return null;

  // 처음 온 사람에게 첫 화면에서 한 번 물어봄
  if (saved.status === "unseen" && pathname === "/") {
    return (
      <aside className="tour-card" role="dialog" aria-label="사용법 안내">
        <p className="tour-step">처음 오셨나요?</p>
        <h2 className="tour-title">사용법을 따라 하며 배워 볼까요</h2>
        <p className="tour-body">
          보유 카드 추가 → 내실 입력 → 덱 찾기까지 6단계를 화면을 직접 눌러 보며 익혀요. 2~3분이면 끝나요.
        </p>
        <div className="tour-actions">
          <button type="button" className="tour-skip" onClick={() => update({ status: "dismissed", step: 0 })}>
            괜찮아요
          </button>
          <button type="button" className="tour-next" onClick={() => update({ status: "active", step: 0 })}>
            따라 하기 시작
          </button>
        </div>
      </aside>
    );
  }

  if (finished) {
    return (
      <aside className="tour-card" role="dialog" aria-label="사용법 안내">
        <p className="tour-step">완료</p>
        <h2 className="tour-title">튜토리얼을 마쳤어요</h2>
        <p className="tour-body">
          이벤트가 바뀌면 덱 편성 도우미에서 다시 계산하고, 새 카드를 뽑으면 보유 카드 체크에서 추가해 주세요. 첫 화면의
          &quot;사용법 따라하기&quot;로 언제든 다시 볼 수 있어요.
        </p>
        <div className="tour-actions">
          <button type="button" className="tour-next" onClick={() => update({ status: "done", step: 0 })}>
            닫기
          </button>
        </div>
      </aside>
    );
  }

  if (!step) return null;

  const onPage = step.anyPage || pathname === step.page;
  const close = () => update({ status: "dismissed", step: 0 });

  return (
    <>
      {rings.map((r) => (
        <div
          key={r.key}
          className="tour-ring"
          aria-hidden="true"
          style={{ top: r.top, left: r.left, width: r.width, height: r.height }}
        />
      ))}
      <aside className="tour-card" role="dialog" aria-live="polite" aria-label="사용법 안내">
        <div className="tour-head">
          <p className="tour-step">
            {stepIndex + 1} / {STEPS.length}
          </p>
          <button type="button" className="tour-close" onClick={close} aria-label="튜토리얼 그만하기">
            ✕
          </button>
        </div>
        <ol className="tour-dots" aria-hidden="true">
          {STEPS.map((_, i) => (
            <li key={i} className={i < stepIndex ? "done" : i === stepIndex ? "now" : ""} />
          ))}
        </ol>
        {onPage ? (
          <>
            <h2 className="tour-title">{step.title}</h2>
            <p className="tour-body">{step.body}</p>
            {stepIndex === 1 && (
              <p className="tour-progress">
                지금 보유 카드 <strong>{progress.cards}</strong> / 5장
              </p>
            )}
            {stepIndex === 3 && (
              <p className="tour-progress">
                입력한 항목 <strong>{progress.growth}</strong>개
              </p>
            )}
          </>
        ) : (
          <>
            <h2 className="tour-title">{step.pageName} 화면에서 이어져요</h2>
            <p className="tour-body">튜토리얼 {stepIndex + 1}단계를 하려면 {step.pageName} 화면으로 돌아가 주세요.</p>
          </>
        )}
        <div className="tour-actions">
          {!onPage ? (
            <Link href={regionHref(region, step.page)} className="tour-next">
              {step.pageName}(으)로 가기
            </Link>
          ) : step.done ? (
            <button type="button" className="tour-skip" onClick={() => update({ status: "active", step: stepIndex + 1 })}>
              이 단계 건너뛰기
            </button>
          ) : (
            <button type="button" className="tour-next" onClick={() => update({ status: "active", step: stepIndex + 1 })}>
              {step.nextLabel ?? "다음"}
            </button>
          )}
        </div>
      </aside>
    </>
  );
}

/** 메인 화면에 두는 "사용법 따라하기" 버튼 */
export function TutorialStartButton() {
  return (
    <button
      type="button"
      className="tour-start"
      onClick={() => window.dispatchEvent(new Event(TUTORIAL_START_EVENT))}
    >
      사용법 따라하기
    </button>
  );
}
