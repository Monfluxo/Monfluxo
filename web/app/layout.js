import "./globals.css";

export const metadata = {
  title: "MONFLUXO Wallet Intelligence",
  description: "On-chain wallet intelligence for Solana"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
