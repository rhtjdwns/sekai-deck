import { NextResponse } from "next/server";
import { recognizeAreaItems } from "@/lib/areaItemOcr";
import { regionOfRequest } from "@/lib/region";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_FILES = 10;
const MAX_BYTES = 10 * 1024 * 1024;

/** 에어리어 아이템 스크린샷(여러 장) → 아이템과 레벨 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "요청 형식이 잘못되었습니다." }, { status: 400 });
  }
  const files = form.getAll("images").filter((f): f is File => f instanceof File);
  if (files.length === 0) return NextResponse.json({ error: "스크린샷이 없습니다." }, { status: 400 });
  if (files.length > MAX_FILES) {
    return NextResponse.json({ error: `스크린샷은 한 번에 ${MAX_FILES}장까지 올릴 수 있어요.` }, { status: 400 });
  }
  if (files.some((f) => f.size > MAX_BYTES)) {
    return NextResponse.json({ error: "10MB보다 큰 이미지는 올릴 수 없어요." }, { status: 400 });
  }
  try {
    const buffers = await Promise.all(files.map(async (f) => Buffer.from(await f.arrayBuffer())));
    return NextResponse.json(await recognizeAreaItems(buffers, regionOfRequest(req, form.get("region"))));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "스크린샷을 읽지 못했습니다. 다른 이미지로 다시 시도해 주세요." }, { status: 500 });
  }
}
