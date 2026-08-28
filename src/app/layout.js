import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import ImpactSiteVerificationMeta from "./ImpactSiteVerificationMeta";

import ThemeProvider from "@/components/theme/ThemeProvider";
import { buildNoFlashThemeScript } from "@/lib/theme/noFlashThemeScript";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "409 Marketplace | Buy Local. Sell Local.",
  description:
    "A local Southeast Texas marketplace for listings, services, rentals, pets, community resources, and American-made products.",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <ImpactSiteVerificationMeta />
      </head>
      <body className="min-h-full flex flex-col">
        <script
          // Runs before hydration to apply the resolved theme class and
          // prevent a light-mode flash on initial load. See
          // src/lib/theme/noFlashThemeScript.js.
          dangerouslySetInnerHTML={{ __html: buildNoFlashThemeScript() }}
        />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
