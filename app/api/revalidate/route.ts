import { revalidatePath, revalidateTag } from "next/cache";
import { clearMasterCache } from "@/lib/recommend";
import { refreshSecret } from "@/lib/refreshSchedule";

export const dynamic = "force-dynamic";

/** 오후 3시·8시 예약(lib/refreshSchedule.ts)이 부르는 화면 갱신. 같은 서버 안에서만 부를 수 있음 */
export async function POST(req: Request) {
  if (req.headers.get("x-refresh-secret") !== refreshSecret()) {
    return new Response("Forbidden", { status: 403 });
  }
  clearMasterCache();
  // 바로 만료시켜 다음 요청에서 새 데이터를 받게 함
  revalidateTag("master", { expire: 0 });
  for (const path of ["/", "/cards", "/deck", "/growth", "/jp", "/jp/cards", "/jp/deck", "/jp/growth"]) revalidatePath(path);
  return Response.json({ ok: true, at: Date.now() });
}
