import "./globals.css";
import "./brand-theme.css";
import "./creator-revenue.css";
import "./pending-states.css";
import "./incoming-flows.css";
import "./portfolio-summary.css";
import "./production-ui-fix.css";
import "./raster-visuals.css";
import "./landing.css";
import "./social-links.css";
import SocialLinks from "./SocialLinks";

export const metadata = {
  title: "MONFLUXO — On-chain Intelligence for Solana",
  description: "Turn raw Solana wallet history into readable on-chain intelligence, positions, PnL, creator revenue and behavioral signals."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <img
          className="monfluxo-raster-background"
          src="/monfluxo-background.webp"
          alt=""
          aria-hidden="true"
        />
        <div className="monfluxo-app-layer">{children}<SocialLinks /></div>
      </body>
    </html>
  );
}

