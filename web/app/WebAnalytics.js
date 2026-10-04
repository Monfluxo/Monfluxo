'use client';
import Script from 'next/script';
import {usePathname} from 'next/navigation';
export default function WebAnalytics({token}){
 const pathname=usePathname();
 if(!token||!['/','/beta','/data'].includes(pathname))return null;
 return <Script id="monfluxo-web-analytics" src="https://static.cloudflareinsights.com/beacon.min.js" strategy="afterInteractive" data-cf-beacon={JSON.stringify({token,spa:false})}/>;
}
