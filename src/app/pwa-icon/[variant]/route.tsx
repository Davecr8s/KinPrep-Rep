import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { KinPrepMark } from "@/components/brand-mark";

// PNG app icons for the web manifest, rendered once at build time.

const VARIANTS = {
  "192": { size: 192, maskable: false },
  "512": { size: 512, maskable: false },
  "512-maskable": { size: 512, maskable: true },
} as const;

export const dynamic = "force-static";

export function generateStaticParams() {
  return Object.keys(VARIANTS).map((variant) => ({ variant }));
}

export async function GET(_request: Request, { params }: RouteContext<"/pwa-icon/[variant]">) {
  const { variant } = await params;
  const spec = VARIANTS[variant as keyof typeof VARIANTS];
  if (!spec) notFound();
  return new ImageResponse(<KinPrepMark size={spec.size} maskable={spec.maskable} />, {
    width: spec.size,
    height: spec.size,
  });
}
