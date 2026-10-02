/**
 * The KinPrep app icon as ImageResponse-compatible JSX: navy square, white K, orange dot.
 * `maskable` keeps everything inside the central safe zone and fills the full square.
 */
export function KinPrepMark({ size, maskable = false }: { size: number; maskable?: boolean }) {
  const scale = maskable ? 0.7 : 1;
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#25308A",
        borderRadius: maskable ? 0 : size * 0.22,
        position: "relative",
      }}
    >
      <div
        style={{
          color: "#ffffff",
          fontSize: size * 0.62 * scale,
          fontWeight: 700,
          lineHeight: 1,
          marginTop: -size * 0.04 * scale,
        }}
      >
        K
      </div>
      <div
        style={{
          position: "absolute",
          width: size * 0.16 * scale,
          height: size * 0.16 * scale,
          borderRadius: size,
          background: "#F0A93C",
          right: size * (0.5 - 0.3 * scale),
          bottom: size * (0.5 - 0.3 * scale),
        }}
      />
    </div>
  );
}
