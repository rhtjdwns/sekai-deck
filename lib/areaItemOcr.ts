// 에어리어 아이템 스크린샷 인식 (서버 전용)
// 게임: 우측 상단 메뉴 → 소지품 → 에어리어 아이템 화면. 흰 카드마다 아이콘, 이름, "Lv.15", 보너스가 있다.
// 흰 카드를 찾아 이름과 레벨 글자를 읽고(Tesseract), 이름을 게임 데이터의 아이템 이름과 대조한다.
import "server-only";
import path from "path";
import sharp from "sharp";
import { createWorker, PSM, type Worker } from "tesseract.js";
import { getMasterFile } from "./recommend";
import type { Region } from "./region";

interface RawAreaItem {
  id: number;
  areaId: number;
  name: string;
}

export interface AreaItemShotResult {
  /** 카드 미리보기 (작은 jpeg data URL) */
  preview: string;
  /** 읽은 이름 그대로 */
  ocrName: string;
  /** 가장 닮은 아이템 (없으면 null) */
  areaItemId: number | null;
  /** 이름이 얼마나 닮았는지 0~1 */
  nameScore: number;
  /** 읽은 레벨 (못 읽으면 null) */
  level: number | null;
  /** 이름·레벨 모두 확실한지 */
  sure: boolean;
}

// ---------- 글자 인식기 (서버에 하나만 두고 순서대로 사용) ----------
const DATA_DIR = path.join(process.cwd(), "node_modules", "@tesseract.js-data");
// 이름 읽기용(한국어·일본어)과 레벨 숫자 읽기용(영어) 인식기
const nameWorkers: Partial<Record<Region, Promise<Worker>>> = {};
let levelWorker: Promise<Worker> | null = null;
let queue: Promise<unknown> = Promise.resolve();

function getNameWorker(region: Region) {
  const lang = region === "jp" ? "jpn" : "kor";
  nameWorkers[region] ??= (async () => {
    const w = await createWorker(lang, 1, {
      langPath: path.join(DATA_DIR, lang, "4.0.0_best_int"),
      gzip: true,
      cacheMethod: "none",
    });
    await w.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
    return w;
  })().catch((e) => {
    delete nameWorkers[region];
    throw e;
  });
  return nameWorkers[region]!;
}

function getLevelWorker() {
  levelWorker ??= (async () => {
    const w = await createWorker("eng", 1, {
      langPath: path.join(DATA_DIR, "eng", "4.0.0_best_int"),
      gzip: true,
      cacheMethod: "none",
    });
    await w.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: "Lv.0123456789" });
    return w;
  })().catch((e) => {
    levelWorker = null;
    throw e;
  });
  return levelWorker;
}

/** 여러 요청이 동시에 와도 인식기는 한 번에 하나씩 */
function serial<T>(job: () => Promise<T>): Promise<T> {
  const next = queue.then(job, job);
  queue = next.catch(() => {});
  return next;
}

// ---------- 카드 찾기 ----------
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 흰 카드(거의 흰색인 큰 사각형)를 찾음. 위아래가 잘린 카드는 따로 셈 */
function findCards(data: Buffer, W: number, H: number, channels: number): { cards: Box[]; cut: number } {
  const white = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const p = i * channels;
    if (Math.min(data[p], data[p + 1], data[p + 2]) > 236) white[i] = 1;
  }
  const seen = new Uint8Array(W * H);
  const comps: (Box & { count: number })[] = [];
  const stack: number[] = [];
  for (let s = 0; s < W * H; s++) {
    if (!white[s] || seen[s]) continue;
    let x0 = W, y0 = H, x1 = 0, y1 = 0, count = 0;
    seen[s] = 1;
    stack.push(s);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % W, y = (p - x) / W;
      count++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0 && white[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
      if (x < W - 1 && white[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
      if (y > 0 && white[p - W] && !seen[p - W]) { seen[p - W] = 1; stack.push(p - W); }
      if (y < H - 1 && white[p + W] && !seen[p + W]) { seen[p + W] = 1; stack.push(p + W); }
    }
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    if (w >= 60 && h >= 30 && count >= w * h * 0.4) comps.push({ x: x0, y: y0, w, h, count });
  }
  // 온전한 카드: 세로가 가로의 1.0~1.13배 (게임 기준 180×192)
  const full = comps.filter((c) => c.h / c.w >= 1.0 && c.h / c.w <= 1.13);
  if (full.length === 0) return { cards: [], cut: 0 };
  const medW = [...full.map((c) => c.w)].sort((a, b) => a - b)[Math.floor(full.length / 2)];
  const cards = full.filter((c) => Math.abs(c.w - medW) / medW < 0.08);
  // 잘린 카드: 너비는 같은데 세로가 짧음
  const cut = comps.filter((c) => Math.abs(c.w - medW) / medW < 0.08 && c.h / c.w < 1.0).length;
  cards.sort((a, b) => (Math.abs(a.y - b.y) < a.h / 2 ? a.x - b.x : a.y - b.y));
  return { cards, cut };
}

// ---------- 이름 대조 ----------
const normalize = (s: string) => s.replace(/[\s"'“”‘’.,·:;!?()[\]{}|「」『』・、。]/g, "").toLowerCase();

function levenshtein(a: string, b: string) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

function similarity(a: string, b: string) {
  const x = normalize(a), y = normalize(b);
  if (!x || !y) return 0;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

// ---------- 인식 ----------
export async function recognizeAreaItems(
  images: Buffer[],
  region: Region = "kr",
): Promise<{ items: AreaItemShotResult[]; cut: number }> {
  // 스크린샷의 이름은 그 서버 언어(한국어·일본어)라서 그 서버의 아이템 이름과 대조
  const master = await getMasterFile<RawAreaItem>("areaItems", region);
  // 같은 이름(뮤직 스피커)은 한 번만 대조하고, 어느 에어리어 것인지는 앞뒤 카드로 정함
  const names = Array.from(new Set(master.map((m) => m.name)));
  const byName = new Map<string, RawAreaItem[]>();
  for (const m of master) byName.set(m.name, [...(byName.get(m.name) ?? []), m]);
  const areaOf = new Map(master.map((m) => [m.id, m.areaId]));
  const areaOrder = Array.from(new Set(master.map((m) => m.areaId))).sort((a, b) => a - b);

  return serial(async () => {
    const kor = await getNameWorker(region);
    const eng = await getLevelWorker();
    const items: AreaItemShotResult[] = [];
    let cut = 0;
    for (const buf of images) {
      const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const found = findCards(data, info.width, info.height, info.channels);
      cut += found.cut;
      const perImage: AreaItemShotResult[] = [];
      for (const c of found.cards) {
        const crop = async (a: number, b: number, cc: number, d: number) =>
          sharp(buf)
            .extract({
              left: Math.round(c.x + a * c.w),
              top: Math.round(c.y + b * c.h),
              width: Math.max(1, Math.round((cc - a) * c.w)),
              height: Math.max(1, Math.round((d - b) * c.h)),
            })
            .resize({ width: Math.round((cc - a) * 540) }) // 카드 너비 180px 기준 3배
            .grayscale()
            .normalize()
            .png()
            .toBuffer();
        const nameText = (await kor.recognize(await crop(0.04, 0.48, 0.96, 0.65))).data.text.trim();
        const levelText = (await eng.recognize(await crop(0.25, 0.65, 0.75, 0.79))).data.text.trim();
        const preview = await sharp(buf)
          .extract({ left: c.x, top: c.y, width: c.w, height: c.h })
          .resize({ width: 72 })
          .jpeg({ quality: 80 })
          .toBuffer();

        const scored = names.map((n) => ({ n, s: similarity(nameText, n) })).sort((a, b) => b.s - a.s);
        const best = scored[0];
        const second = scored[1];
        const m = /(\d{1,2})/.exec(levelText.replace(/^Lv\.?/i, ""));
        const level = m ? Number(m[1]) : null;
        const nameOk = best && best.s >= 0.5;
        perImage.push({
          preview: `data:image/jpeg;base64,${preview.toString("base64")}`,
          ocrName: nameText,
          areaItemId: nameOk ? byName.get(best.n)![0].id : null,
          nameScore: Math.round((best?.s ?? 0) * 100) / 100,
          level: level !== null && level >= 1 && level <= 20 ? level : null,
          sure: Boolean(nameOk && best.s >= 0.6 && (!second || best.s - second.s >= 0.15) && level !== null && level >= 1 && level <= 20),
        });
      }

      // 같은 이름 아이템(뮤직 스피커)은 화면에서 바로 앞 카드와 같은 에어리어 것 (에어리어마다 마지막 칸)
      perImage.forEach((r, i) => {
        if (r.areaItemId === null) return;
        const group = byName.get(master.find((m) => m.id === r.areaItemId)!.name)!;
        if (group.length < 2) return;
        const prev = perImage.slice(0, i).reverse().find((p) => p.areaItemId !== null && !group.some((g) => g.id === p.areaItemId));
        const next = perImage.slice(i + 1).find((p) => p.areaItemId !== null && !group.some((g) => g.id === p.areaItemId));
        let area: number | undefined;
        if (prev) area = areaOf.get(prev.areaItemId!);
        else if (next) area = areaOrder[areaOrder.indexOf(areaOf.get(next.areaItemId!)!) - 1];
        const pick = group.find((g) => g.areaId === area);
        if (pick) r.areaItemId = pick.id;
        else r.sure = false;
      });
      items.push(...perImage);
    }
    return { items, cut };
  });
}
