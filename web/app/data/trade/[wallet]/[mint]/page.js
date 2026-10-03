import "../../../../brand-theme.css";
import "../../../data.css";
import "../../../intelligence.css";
import "./trade.css";
import TradeDetailClient from "./TradeDetailClient";

export default async function TradeDetail({params,searchParams}) {
  const [{wallet,mint},search]=await Promise.all([params,searchParams]);
  const raw=search?.journey;
  if (Array.isArray(raw)) return <main className="data-shell trade-detail-shell"><div className="trade-load">Invalid trade journey identifier</div></main>;
  const journey=raw ?? null;
  return <TradeDetailClient key={JSON.stringify([wallet,mint,journey])} wallet={wallet} mint={mint} journey={journey}/>;
}
