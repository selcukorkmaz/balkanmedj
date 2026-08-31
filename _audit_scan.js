const fs=require('fs'),path=require('path');
const root=process.cwd();
const htmls=fs.readdirSync(root).filter(f=>f.endsWith('.html'));
const issues={brokenLinks:[],missingAssets:[],noLang:[],noTitle:[],noMetaDesc:[],noCanonical:[],imgNoAlt:[],noViewport:[],h1count:{}};
function exists(p){
  // strip query/hash
  p=p.split('#')[0].split('?')[0];
  if(!p) return true;
  if(/^(https?:|mailto:|tel:|javascript:|data:|#)/i.test(p)) return null; // external/skip
  let fp=path.join(root,decodeURIComponent(p));
  return fs.existsSync(fp);
}
for(const f of htmls){
  const html=fs.readFileSync(path.join(root,f),'utf8');
  if(!/<html[^>]*\slang=/i.test(html)) issues.noLang.push(f);
  if(!/<title>[^<]+<\/title>/i.test(html)) issues.noTitle.push(f);
  if(!/<meta\s+name=["']description["']/i.test(html)) issues.noMetaDesc.push(f);
  if(!/<link[^>]+rel=["']canonical["']/i.test(html)) issues.noCanonical.push(f);
  if(!/<meta[^>]+name=["']viewport["']/i.test(html)) issues.noViewport.push(f);
  const h1=(html.match(/<h1[\s>]/gi)||[]).length; issues.h1count[f]=h1;
  // imgs without alt
  const imgs=html.match(/<img\b[^>]*>/gi)||[];
  for(const im of imgs){ if(!/\balt=/i.test(im)) issues.imgNoAlt.push(f+' :: '+im.slice(0,80)); }
  // local href/src
  const refs=[...html.matchAll(/(?:href|src)=["']([^"']+)["']/gi)].map(m=>m[1]);
  for(const r of refs){
    const e=exists(r);
    if(e===false){
      if(/\.(css|js|png|jpe?g|svg|webp|gif|ico|pdf|woff2?|mp4)$/i.test(r)) issues.missingAssets.push(f+' -> '+r);
      else issues.brokenLinks.push(f+' -> '+r);
    }
  }
}
console.log("=== noLang ===",issues.noLang);
console.log("=== noTitle ===",issues.noTitle);
console.log("=== noMetaDesc ===",issues.noMetaDesc);
console.log("=== noCanonical ===",issues.noCanonical);
console.log("=== noViewport ===",issues.noViewport);
console.log("=== H1 count per page (should be exactly 1) ===");
for(const[k,v] of Object.entries(issues.h1count)) if(v!==1) console.log("  ",k,"=",v);
console.log("=== MISSING ASSETS ("+issues.missingAssets.length+") ===");issues.missingAssets.forEach(x=>console.log("  ",x));
console.log("=== BROKEN LOCAL LINKS ("+issues.brokenLinks.length+") ===");issues.brokenLinks.forEach(x=>console.log("  ",x));
console.log("=== IMG WITHOUT ALT ("+issues.imgNoAlt.length+") ===");issues.imgNoAlt.slice(0,40).forEach(x=>console.log("  ",x));
