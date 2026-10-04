import "./globals.css";
import "./credits.css";
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
import WebAnalytics from "./WebAnalytics";

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
        <WebAnalytics token={/^[a-f0-9]{32}$/i.test(process.env.CLOUDFLARE_WEB_ANALYTICS_TOKEN||"")?process.env.CLOUDFLARE_WEB_ANALYTICS_TOKEN:null}/>
        <div className="monfluxo-app-layer">{children}<SocialLinks /></div>
      </body>
    </html>
  );
}

