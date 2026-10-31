"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { REGIONS, regionHref, regionOfPath, stripRegion, type Region } from "@/lib/region";
import "./siteNav.css";

const LINKS = [
  { href: "/cards", label: "보유 카드 체크" },
  { href: "/deck", label: "덱 편성 도우미" },
  { href: "/growth", label: "내실" },
];

export default function SiteNav() {
  const pathname = usePathname() ?? "/";
  const region = regionOfPath(pathname);
  const base = stripRegion(pathname);
  return (
    <header className="sitebar">
      <div className="sitebar-inner">
        <Link href={regionHref(region, "/")} className="brand">
          세카이 덱 짜기
        </Link>
        <nav aria-label="주 메뉴">
          {LINKS.map((l) => (
            <Link key={l.href} href={regionHref(region, l.href)} aria-current={base === l.href ? "page" : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="region-switch" role="group" aria-label="서버 선택">
          {(Object.keys(REGIONS) as Region[]).map((r) => (
            <Link key={r} href={regionHref(r, base)} aria-current={r === region ? "true" : undefined}>
              {REGIONS[r].short}
            </Link>
          ))}
        </div>
      </div>
    </header>
  );
}
