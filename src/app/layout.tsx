import type { Metadata } from "next";
import Nav from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Live Earth NE",
  description:
    "Live public cameras across the Northeast US, routed by what is actually happening there."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="top">
            <h1>Live Earth · Northeast</h1>
            <Nav />
          </header>
          {children}
          <footer className="note">
            Live video feeds published by NYSDOT. Events from USGS and the National
            Weather Service. All sources are public and keyless. Still-image cameras
            are deliberately excluded — every tile here is live video.
          </footer>
        </div>
      </body>
    </html>
  );
}
