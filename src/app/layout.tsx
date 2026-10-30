import { ScrollPace } from "@/components/application/scroll-pace";
import { ApplicationHeader } from "@/components/application/application-header";
import type { Metadata } from "next";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const ibmPlexMono = IBM_Plex_Mono({
  weight: ["400", "500", "600"],
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DocSyde",
  description: "Contextual documentation, inside your product.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      suppressHydrationWarning
      className={`${inter.variable} ${ibmPlexMono.variable} h-full antialiased`}
    >
      <head>
        {/* Apply the saved theme before paint; only the root class is changed. */}
        <script dangerouslySetInnerHTML={{ __html: `try { document.documentElement.classList.toggle("dark", localStorage.getItem("docsyde-theme") === "dark"); } catch {}` }} />
      </head>
      <body className="min-h-full flex flex-col"><ScrollPace /><ApplicationHeader />{children}</body>
    </html>
  );
}
