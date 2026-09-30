import "./globals.css";
import "./brand-theme.css";
import "./creator-revenue.css";

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
