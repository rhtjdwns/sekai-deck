import path from "path";
import { fileURLToPath } from "url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // 글자 인식 라이브러리는 내부 작업 파일 경로를 쓰므로 묶지 않고 그대로 불러옴
  // (instrumentation.ts는 Next 15부터 기본 기능이라 따로 켤 필요 없음)
  serverExternalPackages: ["tesseract.js"],
  // 화면을 미리 만들 때 게임 데이터(일본판은 40MB 이상)를 받느라 오래 걸릴 수 있어서 시간 제한을 늘림 (기본 60초).
  // 데이터 받기는 한 번에 최대 3분, 최대 3번 시도하므로 그보다 넉넉하게 둠
  staticPageGenerationTimeout: 600,
  // 프로젝트 폴더를 기준으로 빌드 (상위 폴더에 있는 다른 package-lock.json을 보지 않게)
  turbopack: {
    root: path.dirname(fileURLToPath(import.meta.url)),
  },
};
export default nextConfig;
