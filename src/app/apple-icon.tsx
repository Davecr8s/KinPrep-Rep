import { ImageResponse } from "next/og";
import { KinPrepMark } from "@/components/brand-mark";

// iPhone home-screen icon (iOS ignores the web manifest's icons).
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(<KinPrepMark size={180} maskable />, size);
}
