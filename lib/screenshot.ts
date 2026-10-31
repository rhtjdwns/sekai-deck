// 게임 카드 목록 스크린샷 분석. 브라우저와 서버에서 같이 쓰도록 DOM에 의존하지 않는다.
// 기준 크기: 카드 한 칸 80px (게임 카드 목록 화면)

export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

export interface TileBox {
  x: number;
  y: number;
  size: number;
}

/** 일러스트 비교 영역: 썸네일(128px) 좌표. 속성 아이콘·별·마랭 다이아를 피한 오른쪽 위 */
export const FEATURE = { gx: 7, gy: 6, u0: 40, u1: 124, v0: 6, v1: 78 } as const;
/** 80px 칸 안에서 일러스트가 시작하는 위치와 크기 */
const ART_OFFSET = 3;
const ART_SIZE = 74;

function px(img: RGBAImage, x: number, y: number, c: number) {
  const xi = Math.min(img.width - 1, Math.max(0, x));
  const yi = Math.min(img.height - 1, Math.max(0, y));
  return img.data[(yi * img.width + xi) * 4 + c];
}

/** 이중선형 보간으로 한 점의 RGB */
function sample(img: RGBAImage, x: number, y: number): [number, number, number] {
  const x0 = Math.floor(x - 0.5);
  const y0 = Math.floor(y - 0.5);
  const fx = x - 0.5 - x0;
  const fy = y - 0.5 - y0;
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const a = px(img, x0, y0, c) * (1 - fx) + px(img, x0 + 1, y0, c) * fx;
    const b = px(img, x0, y0 + 1, c) * (1 - fx) + px(img, x0 + 1, y0 + 1, c) * fx;
    out[c] = a * (1 - fy) + b * fy;
  }
  return out;
}

// ---------- 카드 칸 찾기 ----------

/** 스킬 레벨이 적힌 남색 띠를 찾아 카드 칸 위치를 계산 (잘린 칸은 뺌) */
export function detectTiles(img: RGBAImage): TileBox[] {
  return detectTilesWithCut(img).tiles;
}

/**
 * 카드 칸 찾기. 스크린샷 가장자리에 걸려 일러스트·스킬 레벨 띠·마랭 다이아가 잘린 칸은 빼고, 몇 개 뺐는지 같이 돌려줌
 */
export function detectTilesWithCut(img: RGBAImage): { tiles: TileBox[]; cut: number } {
  const { width: W, height: H, data } = img;
  // 남색(스킬 레벨 띠) 마스크. JPEG 압축으로 색이 번져도 잡히게 넉넉하게
  const navy = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    if (Math.abs(r - 68) < 32 && Math.abs(g - 68) < 32 && Math.abs(b - 102) < 34 && b > r + 10) navy[i] = 1;
  }
  // 누적합: 사각형 안 남색 비율을 빠르게 구함
  const integ = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += navy[y * W + x];
      integ[(y + 1) * (W + 1) + x + 1] = integ[y * (W + 1) + x + 1] + row;
    }
  }
  const navyFrac = (x0: number, y0: number, x1: number, y1: number) => {
    const a = Math.max(0, Math.min(W, Math.round(x0))), b = Math.max(0, Math.min(H, Math.round(y0)));
    const c = Math.max(0, Math.min(W, Math.round(x1))), d = Math.max(0, Math.min(H, Math.round(y1)));
    if (c <= a || d <= b) return 0;
    const sum = integ[d * (W + 1) + c] - integ[b * (W + 1) + c] - integ[d * (W + 1) + a] + integ[b * (W + 1) + a];
    return sum / ((c - a) * (d - b));
  };

  // 연결 요소 (상하좌우)
  const seen = new Uint8Array(W * H);
  const comps: { x: number; y: number; w: number; h: number; maxY: number; fill: number }[] = [];
  const stack: number[] = [];
  for (let start = 0; start < W * H; start++) {
    if (!navy[start] || seen[start]) continue;
    let minX = W, minY = H, maxX = 0, maxY = 0, count = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % W, y = (p - x) / W;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && navy[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
      if (x < W - 1 && navy[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
      if (y > 0 && navy[p - W] && !seen[p - W]) { seen[p - W] = 1; stack.push(p - W); }
      if (y < H - 1 && navy[p + W] && !seen[p + W]) { seen[p + W] = 1; stack.push(p + W); }
    }
    const w = maxX - minX + 1, h = maxY - minY + 1;
    if (w >= 12 && h >= 3) comps.push({ x: minX, y: minY, w, h, maxY, fill: count / (w * h) });
  }

  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

  // 1) 띠 조각: 가로로 길고 속이 어느 정도 찬 것 (압축 때문에 띠가 여러 조각으로 끊길 수 있음)
  const pieces = comps.filter((c) => c.w >= c.h * 2.5 && c.h >= 4 && c.fill >= 0.35);
  if (pieces.length === 0) return { tiles: [], cut: 0 };
  const medH = median(pieces.map((c) => c.h));
  let size = (medH * 80) / 13.3; // 띠 높이로 대략

  // 2) 줄 나누기 (아래 끝 기준)
  // 사진 아래 끝에 걸려 낮아진 띠도 잘린 칸으로 세기 위해 포함
  const bars = pieces.filter((c) => (c.h >= medH * 0.6 || c.maxY >= H - 2) && c.h <= medH * 2.5);
  bars.sort((a, b) => a.maxY - b.maxY);
  const rows: (typeof bars)[] = [];
  for (const b of bars) {
    const row = rows.find((r) => Math.abs(r[0].maxY - b.maxY) < size / 4);
    if (row) row.push(b);
    else rows.push([b]);
  }

  // 3) 칸 간격(가로 피치 = 칸 크기 × 1.125)으로 크기를 정밀하게: 같은 줄 왼쪽 끝 사이의 간격
  const gaps: number[] = [];
  for (const row of rows) {
    const xs = row.map((b) => b.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      const d = xs[i] - xs[i - 1];
      const n = Math.round(d / (size * 1.125));
      if (n >= 1 && n <= 3 && Math.abs(d / n - size * 1.125) < size * 0.15) gaps.push(d / n);
    }
  }
  if (gaps.length >= 2) size = median(gaps) / 1.125;
  else {
    // 칸이 한두 개뿐이면 띠 너비로 보정 (다이아가 없으면 76, 있으면 59 / 80px 기준)
    const wMax = Math.max(...bars.map((b) => b.w));
    for (const full of [76, 59]) {
      const s = (wMax * 80) / full;
      if (Math.abs(s - size) / size < 0.2) {
        size = s;
        break;
      }
    }
  }
  const k = size / 80;
  const pitch = size * 1.125;

  // 4) 줄마다 격자 위치를 정하고, 띠가 있는 칸만 남김
  const out: TileBox[] = [];
  let cut = 0;
  const tol = 1.5 * k; // 가장자리 여유
  for (const row of rows) {
    // 띠가 사진 아래 끝에 닿은 줄은 띠·다이아가 잘린 것
    const bottomCut = row.some((b) => b.maxY >= H - 2);
    const y = median(row.map((b) => b.maxY)) + 1 - 75 * k;
    // 격자 기준점: 조각 왼쪽 끝 중 가장 많이 맞는 위치
    let bestOrigin = row[0].x, bestVotes = -1;
    for (const cand of row) {
      let votes = 0;
      for (const b of row) {
        const r = ((b.x - cand.x) / pitch) % 1;
        const off = Math.min(Math.abs(r), 1 - Math.abs(r)) * pitch;
        if (off < size * 0.06) votes += b.w;
      }
      if (votes > bestVotes) { bestVotes = votes; bestOrigin = cand.x; }
    }
    const x0 = bestOrigin - 2 * k;
    // 사진에 조금이라도 걸친 칸까지 살펴봄
    const first = Math.ceil((-x0 - size) / pitch);
    const last = Math.floor((W - x0) / pitch);
    for (let n = first; n <= last; n++) {
      const x = x0 + n * pitch;
      // 위쪽이 잘리면 일러스트로 카드를 알아볼 수 없으니 이것도 잘린 칸으로 봄 (테두리 3px까지는 괜찮음)
      const inside = x >= -tol && x + size <= W + tol && y >= -3 * k && y + size <= H + tol && !bottomCut;
      if (inside) {
        // 띠 왼쪽 부분(글자 앞)과 띠 위·아래 가장자리의 남색 비율로 칸이 있는지 확인
        const left = navyFrac(x + 2 * k, y + 63 * k, x + 7 * k, y + 75 * k);
        const band = navyFrac(x + 2 * k, y + 63 * k, x + 50 * k, y + 75 * k);
        if (left >= 0.45 && band >= 0.3) out.push({ x, y, size });
      } else {
        // 잘린 칸: 보이는 부분에 띠가 있으면 카드가 있던 것으로 세고 뺌
        const vx0 = Math.max(0, x + 2 * k), vx1 = Math.min(W, x + 78 * k);
        const vy0 = Math.max(0, y + 63 * k), vy1 = Math.min(H, y + 75 * k);
        if (vx1 - vx0 >= 4 * k && vy1 - vy0 >= 2 && navyFrac(vx0, vy0, vx1, vy1) >= 0.3) cut++;
      }
    }
  }
  out.sort((a, b) => (Math.abs(a.y - b.y) < size / 2 ? a.x - b.x : a.y - b.y));
  return { tiles: out, cut };
}

// ---------- 일러스트 특징값 ----------

/** 카드 칸의 일러스트 영역을 7x6 블록 평균 색(126개 값)으로 */
export function tileFeature(img: RGBAImage, t: TileBox): number[] {
  const k = t.size / 80;
  const toX = (u: number) => t.x + (ART_OFFSET + (u * ART_SIZE) / 128) * k;
  const toY = (v: number) => t.y + (ART_OFFSET + (v * ART_SIZE) / 128) * k;
  const { gx, gy, u0, u1, v0, v1 } = FEATURE;
  const out: number[] = [];
  const steps = 8;
  for (let by = 0; by < gy; by++) {
    for (let bx = 0; bx < gx; bx++) {
      const ua = u0 + ((u1 - u0) * bx) / gx, ub = u0 + ((u1 - u0) * (bx + 1)) / gx;
      const va = v0 + ((v1 - v0) * by) / gy, vb = v0 + ((v1 - v0) * (by + 1)) / gy;
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < steps; sy++) {
        for (let sx = 0; sx < steps; sx++) {
          const u = ua + ((ub - ua) * (sx + 0.5)) / steps;
          const v = va + ((vb - va) * (sy + 0.5)) / steps;
          const c = sample(img, toX(u), toY(v));
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const n = steps * steps;
      out.push(Math.round(r / n), Math.round(g / n), Math.round(b / n));
    }
  }
  return out;
}

/** 썸네일(128x128 RGBA) 특징값. 칸 특징값과 같은 영역·블록 */
export function thumbFeature(rgba: Uint8Array | Uint8ClampedArray, channels = 4): number[] {
  const { gx, gy, u0, u1, v0, v1 } = FEATURE;
  const out: number[] = [];
  for (let by = 0; by < gy; by++) {
    for (let bx = 0; bx < gx; bx++) {
      const ua = u0 + ((u1 - u0) * bx) / gx, ub = u0 + ((u1 - u0) * (bx + 1)) / gx;
      const va = v0 + ((v1 - v0) * by) / gy, vb = v0 + ((v1 - v0) * (by + 1)) / gy;
      let r = 0, g = 0, b = 0, n = 0;
      for (let v = Math.floor(va); v < Math.ceil(vb); v++) {
        for (let u = Math.floor(ua); u < Math.ceil(ub); u++) {
          const p = (v * 128 + u) * channels;
          r += rgba[p]; g += rgba[p + 1]; b += rgba[p + 2]; n++;
        }
      }
      out.push(Math.round(r / n), Math.round(g / n), Math.round(b / n));
    }
  }
  return out;
}

// ---------- 숫자 읽기 (스킬 레벨, 마스터 랭크) ----------

const NORM_W = 12;
const NORM_H = 16;
const UPSCALE = 6;

function isWhite(r: number, g: number, b: number) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : ((max - min) / max) * 255;
  return max > 185 && sat < 90;
}

/**
 * 마스크에서 가장 큰 덩어리를 12x16으로 정규화 (가로세로 비율 유지).
 * union이면 압축으로 끊긴 조각까지, 가장 큰 덩어리의 15% 이상인 덩어리를 모두 합쳐서 씀
 */
export function normalizeMask(mask: Uint8Array, w: number, h: number, union = false): number[] | null {
  const lab = new Int32Array(w * h);
  let best = -1, bestCount = 0, bestBox = [0, 0, 0, 0];
  let label = 0;
  const stack: number[] = [];
  const sizes: { label: number; count: number; box: number[] }[] = [];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || lab[s]) continue;
    label++;
    let count = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    lab[s] = label;
    stack.push(s);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w, y = (p - x) / w;
      count++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (mask[q] && !lab[q]) { lab[q] = label; stack.push(q); }
        }
      }
    }
    sizes.push({ label, count, box: [x0, y0, x1, y1] });
    if (count > bestCount) { bestCount = count; best = label; bestBox = [x0, y0, x1, y1]; }
  }
  if (best < 0) return null;
  const keep = new Set<number>([best]);
  if (union) {
    for (const c of sizes) {
      if (c.count >= bestCount * 0.15) {
        keep.add(c.label);
        bestBox = [
          Math.min(bestBox[0], c.box[0]),
          Math.min(bestBox[1], c.box[1]),
          Math.max(bestBox[2], c.box[2]),
          Math.max(bestBox[3], c.box[3]),
        ];
      }
    }
  }
  const [x0, y0, x1, y1] = bestBox;
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  // 3:4 상자에 가운데 정렬
  const H = Math.max(bh, Math.ceil((bw * 4) / 3));
  const W = Math.max(bw, Math.ceil((H * 3) / 4));
  const ox = x0 - (W - bw) / 2, oy = y0 - (H - bh) / 2;
  const out: number[] = [];
  for (let ny = 0; ny < NORM_H; ny++) {
    for (let nx = 0; nx < NORM_W; nx++) {
      let on = 0, n = 0;
      for (let sy = 0; sy < 3; sy++) {
        for (let sx = 0; sx < 3; sx++) {
          const x = Math.floor(ox + ((nx + (sx + 0.5) / 3) * W) / NORM_W);
          const y = Math.floor(oy + ((ny + (sy + 0.5) / 3) * H) / NORM_H);
          n++;
          if (x >= 0 && y >= 0 && x < w && y < h && keep.has(lab[y * w + x])) on++;
        }
      }
      out.push(on / n);
    }
  }
  return out;
}

/** 칸 안 영역(80px 기준 좌표)을 확대해 흰 글자 마스크로 */
function whiteMask(img: RGBAImage, t: TileBox, x0: number, y0: number, x1: number, y1: number) {
  const k = t.size / 80;
  const w = Math.round((x1 - x0) * UPSCALE), h = Math.round((y1 - y0) * UPSCALE);
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = sample(img, t.x + (x0 + (x + 0.5) / UPSCALE) * k, t.y + (y0 + (y + 0.5) / UPSCALE) * k);
      if (isWhite(c[0], c[1], c[2])) mask[y * w + x] = 1;
    }
  }
  return { mask, w, h };
}

export type DigitTemplates = Record<string, number[][]>;

/**
 * 게임 화면의 실제 숫자 모양 샘플 (12x16, 0~9 단계). 컴퓨터마다 다른 글꼴에 영향받지 않도록 상수로 둔다.
 * 스킬 레벨 1·2·4, 마랭 1·2·5를 실제 화면에서 잘라낸 것으로, 배율과 JPEG 압축을 바꿔 가며 모은 여러 모양이다.
 * 3은 실제 샘플이 없어 비슷한 굵은 글꼴로 만든 것.
 */
const GAME_DIGIT_DATA: Record<string, string[]> = {
  "1": [
    "000269830000004999960000000499960000000079960000000039960000000039960000000039960000000039960000000039960000000039960000000039960000000039980000000049990000003399997200039999999910006679996400",
    "000166500000001999930000000999930000000399930000000079930000000069930000000069930000000069930000000069930000000069930000000069930000000069950000000199991000000699997000003999999100002866664000",
    "000058630000000699960000001999990000000299990000000059990000000029990000000009990000000009990000000009970000000009960000000009990000000019990000000389996100003999999300000999999100000599630000",
    "000003997200000028999600000899999900007999999600008999999600005979999700000206999900000006999700000006999600000006999600000006999400000006999300000006999300000003999300000003999300000002996100",
    "000000004000000000159000000000699000000004999000000008999000000279997000000899993000000999993000000999993000000999993000000599995000000039999000000006999000000003999000000000399000000000006000",
    "000000599910000000999700000003999300000006999100000006997000000006994000000008991000020009980000034049960000039699940000039999920000039999800000039999500000039999100000039993000000027930000000"
  ],
  "2": [
    "000489763000016899998500049999999950499997689994799980059999269720019999000000059997000000699981000017999920000399998100003999850000009998100000049980000000299998666662399999999996289999999995",
    "299940000000398910000000390299730000204799995300006999999940009998569992009982019993001310029993000000279981000003899910000079998100000799820000002996100000008996313330039999999993019999999992",
    "003369930000059999996100499999999930699983389992699940059996133300069994000000289970000003899950000059999910001799983100008999510000049982000000189960000000699999999996699999999996476666666663",
    "069982000000399960000000399941310000399999981000399999998200299999679930049995009980000330019980000000069940000003899900000059995200000599620000003999000000008999533320009999999990005999999850",
    "002599861000039999999100039400399910002000079930000000049930000000049930000000079910000000199600000000799100000006995000000069980000000399810000003999500000039999973310099999999980038998666610"
  ],
  "3": [
    "001589996200008999999910069976679970099910019990013200009990000000029970000023599910000069996200000059999910000000049980000000006993266400006993299810008993069986679981018999999910001469975200"
  ],
  "4": [
    "000001798300000006999800000019999900000089999900000499999900000794499900003990099900019950099900079900099900199964699960599999999995159999999993000000399930000000089900000000069700000000027200",
    "000000378100000003999500000018999600000059999600000099999600000599999300003995399300007940069500069971099920399999899970399999999991289999999992001314899980000000189920000000029400000000006000",
    "000000397100000003999700000019999900000059999900000099999800000699999600002986999600007930499600069930499910499950799950699984999991699999999995167978999994000001899980000000499930000000089600",
    "000000389600000000899910000002999940000008999940000089999930000499999920000799999900003999999930059997689950089998999980399999999992399999999993056666999992000000699980000000089950000000027800"
  ],
  "5": [
    "059976653100199999999940399999999990399999999950099963333100099930310000499988997200699999999960599998799993056620028995000000006993000000006993059810007993099996799992059999999930005679966500",
    "299940000000398500000000395973000000305999966610006999999940007999999920003994000000003998666100006999999940005999679993001792005993000000001993001561001993004996348993001899999971000367996610",
    "058730000000199999986500399999999990499999999970089994366620069970000000079996997200099999999950099998699994069970018996000000004996002100003996019920004996059996669995009999999960003669976600",
    "018965330000579999999851999999999993599999999982059983023310049981332000069999999510069999999993059999689998026650006999000000001999001100000999028940002999069999689999018999999971002667996620",
    "299695000000399666000000397999200000399999985300149999999950008998699920002993000000006998798200006999999960006998448992001331003993000000000993000861002993001999669992000799999940000133673200",
    "000300000000018998666620189999999980999999998630009994330000009992133000009999999820039999999995008997668999001331001999000000000699001661002999006996227999007999999996002899999950000002320000",
    "069930000000099500000000099100000000026997666200006999999940009999999950006994333310006993131000006999999500006999999960003662018990000000005990001320004990005994369970001999999930000266866300",
    "069830000000069300000000065000000000067620000000069999999820069999999910028983333200007992330000029999997200029999999930007982039960000000007960001300006960006961049960005999999810001579986100",
    "039100000000034000000000034310000000039996400000039999998300039999999600039973333200039970200000039999997300039998899910026750179930000000039930002300029930039973479920017999999400001467764000",
    "000000563000000000188200200000017930963200000481999999700048999999930018998333300001996131000000999999710000999899960000562007990000000004990000551006990000997669970000399999610000023653100000",
    "039983000000389830000000899420000000955999743320803999999992106999999992000998213320000999433300000999999981000999999997000396101999000000000499000140000599000798434997000599999992000047998630",
    "099500000000099000000000098433320000069999999610069999999930069997687710009990000000009996664100009999999730009997679980002630008990000000006990004610006990009996669980004999999930000268965200",
    "169971000000399700000000399996000000377999856630367999999960127999768720006997000000006999410000006999998300004999999970001552038990000000005991000331005993003999679980002999999940000166866200",
    "266000000000396000000000397200000000269982000000019999999910039999769710029998000000006995331000006999999600004999999950001651007992000000002993000510004993004998689980002999999930000267986400",
    "079981000000099100000000097720000000035999663100008999999700029999999700028999898300006997995000006999999800005998699960000551028990000000005990000330005990004999679940003999999910000257975200"
  ]
};

export const GAME_DIGITS: DigitTemplates = Object.fromEntries(
  Object.entries(GAME_DIGIT_DATA).map(([d, list]) => [d, list.map((s) => Array.from(s, (c) => Number(c) / 9))]),
);

function correlate(a: number[], b: number[]) {
  const ma = a.reduce((s, v) => s + v, 0) / a.length;
  const mb = b.reduce((s, v) => s + v, 0) / b.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return num / (Math.sqrt(da * db) + 1e-6);
}

function classifyScored(v: number[] | null, templates: DigitTemplates, allowed: string) {
  if (!v) return { value: null as number | null, sure: false, score: -1, margin: 0 };
  let best: string | null = null, bestScore = -2, second = -2;
  for (const d of allowed) {
    const list = templates[d];
    if (!list || list.length === 0) continue;
    // 같은 숫자의 여러 샘플 중 가장 닮은 것으로 비교
    const s = Math.max(...list.map((t) => correlate(v, t)));
    if (s > bestScore) { second = bestScore; bestScore = s; best = d; }
    else if (s > second) second = s;
  }
  // 모양이 충분히 닮았고, 다음 후보와 차이가 날 때만 확실하다고 봄
  return {
    value: best ? Number(best) : null,
    sure: bestScore >= 0.75 && bestScore - second >= 0.1,
    score: bestScore,
    margin: bestScore - second,
  };
}

function classify(v: number[] | null, templates: DigitTemplates, allowed: string): number | null {
  return classifyScored(v, templates, allowed).value;
}

/** 스킬 레벨 숫자 모양 (정규화된 12x16) */
export function skillDigitVector(img: RGBAImage, t: TileBox): number[] | null {
  const { mask, w, h } = whiteMask(img, t, 31, 63, 42, 75);
  return normalizeMask(mask, w, h);
}

/** 마랭 다이아 자리의 짙은 청록 비율 */
export function rankDiamondTeal(img: RGBAImage, t: TileBox): number {
  const k = t.size / 80;
  let teal = 0, n = 0;
  for (let y = 52; y < 74; y += 0.5) {
    for (let x = 58; x < 76; x += 0.5) {
      const [r, g, b] = sample(img, t.x + x * k, t.y + y * k);
      n++;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : ((max - min) / max) * 255;
      let hue = 0;
      if (max !== min) {
        if (max === r) hue = ((g - b) / (max - min)) % 6;
        else if (max === g) hue = (b - r) / (max - min) + 2;
        else hue = (r - g) / (max - min) + 4;
        hue = (hue * 60 + 360) % 360;
      }
      if (hue >= 160 && hue <= 210 && sat > 60 && max > 40 && max < 190) teal++;
    }
  }
  return teal / n;
}

/** 마랭 다이아가 있는지 */
export function hasRankDiamond(img: RGBAImage, t: TileBox): boolean {
  return rankDiamondTeal(img, t) >= 0.1;
}

/**
 * 마랭 숫자 모양 (정규화된 12x16).
 * 압축으로 숫자가 여러 조각으로 끊길 수 있어 가운데에 있는 조각들을 합치고, 모서리의 다이아 테두리 조각은 뺌
 */
export function rankDigitVector(img: RGBAImage, t: TileBox): number[] | null {
  const X0 = 59, Y0 = 56, X1 = 70, Y1 = 70;
  const { mask, w, h } = whiteMask(img, t, X0, Y0, X1, Y1);
  // 조각 나누기 (8방향)
  const lab = new Int32Array(w * h);
  const blobs: { label: number; count: number; sx: number; sy: number }[] = [];
  const stack: number[] = [];
  let label = 0;
  for (let s0 = 0; s0 < w * h; s0++) {
    if (!mask[s0] || lab[s0]) continue;
    label++;
    let count = 0, sx = 0, sy = 0;
    lab[s0] = label;
    stack.push(s0);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w, y = (p - x) / w;
      count++; sx += x; sy += y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (mask[q] && !lab[q]) { lab[q] = label; stack.push(q); }
        }
      }
    }
    blobs.push({ label, count, sx: sx / count, sy: sy / count });
  }
  // 무게중심이 가운데 영역에 있는 조각만 (모서리의 테두리 조각 제외)
  const central = blobs.filter((b) => b.sx > w * 0.2 && b.sx < w * 0.8 && b.sy > h * 0.12 && b.sy < h * 0.92);
  if (central.length === 0) return normalizeMask(mask, w, h);
  const biggest = Math.max(...central.map((b) => b.count));
  const keep = new Set(central.filter((b) => b.count >= biggest * 0.1).map((b) => b.label));
  const kept = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) if (keep.has(lab[p])) kept[p] = 1;
  return normalizeMask(kept, w, h, true);
}

/** 스킬 레벨 (SLv.N의 N) */
export function readSkillLevel(img: RGBAImage, t: TileBox, templates: DigitTemplates = GAME_DIGITS): number | null {
  return classify(skillDigitVector(img, t), templates, "1234");
}

/** 스킬 레벨과 마스터 랭크를 확신 여부와 함께 */
export function readDigits(img: RGBAImage, t: TileBox, templates: DigitTemplates = GAME_DIGITS) {
  const skill = classifyScored(skillDigitVector(img, t), templates, "1234");
  let rank: { value: number | null; sure: boolean } = { value: 0, sure: true };
  if (hasRankDiamond(img, t)) {
    const r = classifyScored(rankDigitVector(img, t), templates, "12345");
    // 청록색이 있어도 숫자 모양이 전혀 안 닮았으면 일러스트 색을 다이아로 착각한 것으로 봄
    rank = r.score < 0.6 ? { value: 0, sure: false } : r;
  }
  return { skill: skill.value, skillSure: skill.sure, rank: rank.value, rankSure: rank.sure };
}

/** 마스터 랭크. 다이아가 없으면 0 */
export function readMasterRank(img: RGBAImage, t: TileBox, templates: DigitTemplates = GAME_DIGITS): number | null {
  return readDigits(img, t, templates).rank;
}

/** 거리 (평균 제곱근 오차) */
export function featureDistance(a: number[], b: ArrayLike<number>) {
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    const e = a[i] - b[i];
    d += e * e;
  }
  return Math.sqrt(d / a.length);
}
