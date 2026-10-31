// 카드 썸네일을 원본 이미지 서버에서 한 번만 받아 서버에 저장해 두고 재사용한다 (서버 전용)
// 원본 서버가 다른 사이트에서 직접 불러오는 것(핫링크)을 막고 있어서, 브라우저 대신 우리 서버가 받아 전달한다.
import "server-only";
import { promises as fs } from "fs";
import path from "path";

const SOURCE_BASE = process.env.CARD_THUMB_BASE ?? "https://storage.sekai.best/sekai-jp-assets/thumbnail/chara";
const CACHE_DIR = path.join(process.env.CACHE_DIR ?? path.join(process.cwd(), ".cache"), "thumbs");

/** 허용하는 파일 이름: 에셋 이름 + _normal 또는 _after_training + .webp */
const NAME_RE = /^[a-z0-9_]+_(normal|after_training)\.webp$/;

// 디스크에 저장하지 못하는 환경을 위한 메모리 보관 (최근 것 위주로 최대 400장)
const memory = new Map<string, Buffer>();
const MEMORY_LIMIT = 400;
// 같은 이미지를 동시에 여러 번 받지 않도록
const inflight = new Map<string, Promise<Buffer | null>>();

export function isValidThumbName(name: string) {
  return NAME_RE.test(name);
}

function remember(name: string, buf: Buffer) {
  memory.delete(name);
  memory.set(name, buf);
  if (memory.size > MEMORY_LIMIT) memory.delete(memory.keys().next().value as string);
}

/** 썸네일 이미지 (webp). 원본에 없으면 null */
export async function getThumb(name: string): Promise<Buffer | null> {
  if (!isValidThumbName(name)) return null;
  const hit = memory.get(name);
  if (hit) return hit;
  const file = path.join(CACHE_DIR, name);
  try {
    const buf = await fs.readFile(file);
    remember(name, buf);
    return buf;
  } catch {
    // 아직 저장되지 않음
  }
  const running = inflight.get(name);
  if (running) return running;
  const job = (async () => {
    const res = await fetch(`${SOURCE_BASE}/${name}`, { cache: "no-store" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`썸네일 ${name} 받기 실패 (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    remember(name, buf);
    try {
      await fs.mkdir(CACHE_DIR, { recursive: true });
      await fs.writeFile(file, buf);
    } catch {
      // 디스크에 못 쓰는 환경이면 메모리에만 둠
    }
    return buf;
  })().finally(() => inflight.delete(name));
  inflight.set(name, job);
  return job;
}
