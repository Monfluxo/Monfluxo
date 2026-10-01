import "./globals.css";
import "./brand-theme.css";
import "./banner-theme.css";
import "./official-logo-fix.css";
import "./creator-revenue.css";
import "./pending-states.css";
import "./incoming-flows.css";
import "./portfolio-summary.css";
import "./production-ui-fix.css";

export const metadata = {
  title: "MONFLUXO Wallet Intelligence",
  description: "Cross-chain wallet intelligence"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
