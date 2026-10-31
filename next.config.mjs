import path from "path";
import { fileURLToPath } from "url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // 글자 인식 라이브러리는 내부 작업 파일 경로를 쓰므로 묶지 않고 그대로 불러옴
  // (instrumentation.ts는 Next 15부터 기본 기능이라 따로 켤 필요 없음)
  serverExternalPackages: ["tesseract.js"],
  // 프로젝트 폴더를 기준으로 빌드 (상위 폴더에 있는 다른 package-lock.json을 보지 않게)
  turbopack: {
    root: path.dirname(fileURLToPath(import.meta.url)),
  },
};
export default nextConfig;
