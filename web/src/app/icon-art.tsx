import { ImageResponse } from "next/og";

/** The app icon as a PNG (PWA manifest and iOS home screen need raster icons). */
export function iconPng(size: number) {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#8b76ff", alignItems: "center", justifyContent: "center" }}>
        <svg width={size} height={size} viewBox="0 0 512 512">
          <path d="M256 104L148 408h216z" fill="none" stroke="#0c0a14" strokeWidth={34} strokeLinejoin="round" />
          <path d="M256 312l92-168" stroke="#0c0a14" strokeWidth={34} strokeLinecap="round" />
        </svg>
      </div>
    ),
    { width: size, height: size },
  );
}
