import { getThumb, isValidThumbName } from "@/lib/thumbs";

export const dynamic = "force-dynamic";

/** 카드 썸네일. 서버에 저장해 둔 이미지를 보내고, 없으면 원본에서 한 번 받아 저장한 뒤 보냄 */
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!isValidThumbName(name)) return new Response("Not found", { status: 404 });
  try {
    const buf = await getThumb(name);
    if (!buf) return new Response("Not found", { status: 404 });
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "image/webp",
        // 카드 일러스트는 바뀌지 않으니 브라우저·CDN이 오래 보관하게
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Upstream error", { status: 502 });
  }
}
