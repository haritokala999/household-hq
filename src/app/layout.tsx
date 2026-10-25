import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HouseholdHQ",
  description: "Manage your household finances together.",
  icons: {
    icon: "/householdhq-icon.svg",
    apple: "/apple-touch-icon.png",
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "HouseholdHQ",
    statusBarStyle: "default",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
