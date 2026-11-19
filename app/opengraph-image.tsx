import { ImageResponse } from "next/og";
import { brand } from "@/config/brand";
import { tr } from "@/i18n";

// The image shown when a link to the store is shared (1200 × 630). Drawn from config/brand.ts:
// change the brand and it follows. Replace it with a real photo when there is one.
export const alt = brand.name;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  const { theme } = brand;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 80, background: theme.background, color: theme.ink }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 28, height: 28, borderRadius: 14, background: theme.action }} />
          <div style={{ fontSize: 30, letterSpacing: 4, textTransform: "uppercase", color: theme.muted }}>{tr({ es: "Tienda online", en: "Online store" })}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 118, fontWeight: 600, letterSpacing: -3, lineHeight: 1 }}>{brand.name}</div>
          <div style={{ fontSize: 42, color: theme.muted, maxWidth: 900 }}>{tr(brand.tagline)}</div>
        </div>
        <div style={{ display: "flex", height: 12, width: 220, borderRadius: 6, background: theme.highlight }} />
      </div>
    ),
    size,
  );
}
