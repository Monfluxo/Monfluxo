import "./globals.css";
import "./brand-theme.css";
import "./creator-revenue.css";
import "./pending-states.css";
import "./incoming-flows.css";
import "./portfolio-summary.css";
import "./production-ui-fix.css";
import "./raster-visuals.css";

export const metadata = {
  title: "MONFLUXO Wallet Intelligence",
  description: "Cross-chain wallet intelligence"
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
        <div className="monfluxo-app-layer">{children}</div>
      </body>
    </html>
  );
}
