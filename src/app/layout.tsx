import type { Metadata, Viewport } from "next";
import { SiteFooter } from "@/components/site-footer";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "KinPrep", template: "%s · KinPrep" },
  description: "They practise daily. You see the proof every Sunday.",
  applicationName: "KinPrep",
  // iPhone "Add to Home Screen" (the web manifest covers Android).
  appleWebApp: { capable: true, title: "KinPrep", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#25308A",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col font-sans">
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
