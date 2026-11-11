// Run this ONCE per theme, on a page that was loaded in that theme.
//
// Setting `data-theme` and re-running it in the same script reports failures
// that are not there: the second pass read `.rel-row.is-active` as having the
// light brand fill at 1.08:1 while the element actually computed
// rgb(11, 31, 46) with near-white text, about 14:1. Chased twice before it was
// written down. Flip the theme, let the page settle, then audit in a separate
// call — or load the page in the theme you mean to test.

(function(){
const srgb=c=>c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4);
function rgbOf(str){const m=str&&str.match(/rgba?\(([^)]+)\)/);if(!m)return null;
  const p=m[1].split(',').map(s=>parseFloat(s));return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1};}
function lum(c){const[r,g,b]=[c.r,c.g,c.b].map(n=>srgb(n/255));return 0.2126*r+0.7152*g+0.0722*b;}
function over(fg,bg){const a=fg.a;return {r:fg.r*a+bg.r*(1-a),g:fg.g*a+bg.g*(1-a),b:fg.b*a+bg.b*(1-a),a:1};}
// Every colour a gradient actually paints, so a label on a gradient is judged
// against its worst stop rather than skipped.
//
// `color(srgb r g b / a)` is included because Chrome serialises a computed
// color-mix() that way, and a stop at zero alpha is dropped because it paints
// nothing — reading `rgba(0,0,0,0)` as solid black scored the organization
// branding preview, which is dark ink on its own pale paper, as 1.3:1.
function gradientStops(img){const out=[];
  const re=/rgba?\([^)]+\)|color\(srgb[^)]+\)|#[0-9a-fA-F]{3,8}/g;let m;
  while((m=re.exec(img))){const v=m[0];let c=null;
    if(v.startsWith('#')){let h=v.slice(1);
      if(h.length===3)h=[...h].map(x=>x+x).join('');
      if(h.length>=6)c={r:parseInt(h.slice(0,2),16),g:parseInt(h.slice(2,4),16),b:parseInt(h.slice(4,6),16),a:1};}
    else if(v.startsWith('color(')){
      const n=v.slice(v.indexOf('srgb')+4).split('/');
      const p=n[0].trim().split(/\s+/).map(Number);
      if(p.length>=3&&p.every(x=>!Number.isNaN(x)))
        c={r:p[0]*255,g:p[1]*255,b:p[2]*255,a:n[1]!==undefined?parseFloat(n[1]):1};}
    else c=rgbOf(v);
    if(c&&c.a>0)out.push(c);}
  return out;}

// The grounds a piece of text could be sitting on.
//
// The solid first: every background-color from the element up to the first
// opaque one, composited. Then, if anything in that chain also paints a
// gradient, each of its stops over that solid — a gradient leaves the solid
// visible wherever its stops are transparent, so both are candidates and the
// worst of them decides.
function backdrop(el){
  let n=el,stack=[],gradient=null,photo=false;
  while(n&&n!==document.documentElement){const cs=getComputedStyle(n);
    const img=cs.backgroundImage;
    if(img&&img!=='none'){
      if(/url\(/.test(img))photo=true;
      if(!gradient){const st=gradientStops(img);if(st.length)gradient=st;}}
    const c=rgbOf(cs.backgroundColor);
    if(c&&c.a>0){stack.push(c);if(c.a>=0.999)break;}
    n=n.parentElement;}
  if(photo&&!gradient)return {solid:null,stops:null,image:true};
  let base=rgbOf(getComputedStyle(document.body).backgroundColor)||{r:255,g:255,b:255,a:1};
  for(let i=stack.length-1;i>=0;i--)base=over(stack[i],base);
  if(!gradient)return {solid:base,stops:null};
  // The solid is only a candidate ground when the gradient lets it through.
  // Including it unconditionally judged the branding preview's monogram —
  // white on an opaque two-colour fill — against the pale card behind it.
  const translucent=gradient.some(g=>g.a<0.999);
  const stops=gradient.map(g=>over(g,base));
  return {solid:base,stops:translucent?[base,...stops]:stops};
}
const out=[];
document.querySelectorAll('h1,h2,h3,h4,h5,p,a,span,li,td,th,label,button,strong,small,em,dt,dd,summary,legend,figcaption').forEach(el=>{
  const txt=el.textContent.trim(); if(!txt) return;
  if(!el.getClientRects().length) return;
  const cs=getComputedStyle(el);
  if(cs.visibility==='hidden'||cs.opacity==='0') return;
  if([...el.children].some(c=>c.textContent.trim()===txt)) return;   // measure the innermost
  const fg=rgbOf(cs.color); if(!fg) return;
  const bd=backdrop(el);
  if(bd.image) return;                                              // photo: cannot judge
  const grounds = bd.stops || [bd.solid];
  const px=parseFloat(cs.fontSize), bold=parseInt(cs.fontWeight,10)>=700;
  const need=(px>=24||(px>=18.66&&bold))?3:4.5;
  let worst=99, wbg=null;
  for(const g of grounds){ const f=lum(over(fg,g)), b=lum(g);
    const r=(Math.max(f,b)+0.05)/(Math.min(f,b)+0.05); if(r<worst){worst=r;wbg=g;} }
  if(worst<need) out.push({sel:el.tagName.toLowerCase()+(el.className&&typeof el.className==='string'?'.'+el.className.trim().split(/\s+/).slice(0,2).join('.'):''),
    txt:txt.slice(0,34), ratio:+worst.toFixed(2), need, px:Math.round(px),
    fg:cs.color, bg:wbg?`rgb(${Math.round(wbg.r)}, ${Math.round(wbg.g)}, ${Math.round(wbg.b)})`:'?'});
});

// ---------------------------------------------------------------------------
// The hover pass.
//
// A rendered page shows only the resting state, so a :hover rule that paints
// text the colour of its own background is invisible to the loop above. That
// is not a hypothetical: .site-nav a:hover carried `color: #ffffff` from when
// the header was navy, and outranked the rule that recoloured the bar to a
// white surface — so every link in the header vanished under the pointer, and
// a full static sweep of twenty-two routes reported no failures.
//
// Hover declarations live in the stylesheets rather than in the DOM, so this
// reads them back and replays the cascade: all :hover rules that match an
// element, ordered by specificity then source order, last colour and last
// background-color win. !important is honoured; inline styles are not, since
// nothing here sets one.
// ---------------------------------------------------------------------------
function specificity(sel){
  // Enough to order rules correctly, not a full selector parser: ids, then
  // classes/attributes/pseudo-classes, then element names.
  const s=sel.replace(/\\./g,'');
  const ids=(s.match(/#[\w-]+/g)||[]).length;
  const cls=(s.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g)||[]).length;
  const els=(s.replace(/[#.][\w-]+|\[[^\]]*\]|:{1,2}[\w-]+(\([^)]*\))?/g,' ')
              .match(/[a-zA-Z][\w-]*/g)||[]).length;
  return ids*10000+cls*100+els;
}
const hoverRules=[];
let order=0;
function collect(sheet){
  let rules; try { rules=sheet.cssRules; } catch(e) { return; }   // cross-origin
  for(const rule of rules||[]){
    // Since CSS nesting shipped, a plain CSSStyleRule also has a `cssRules`
    // list — an empty one. Treating "has cssRules" as "is a grouping rule"
    // therefore skipped every ordinary rule in the stylesheet, and the hover
    // pass quietly reported zero findings on every page. Dispatch on
    // selectorText instead, and still descend for genuinely nested rules.
    if(!rule.selectorText){ if(rule.cssRules) collect(rule); continue; }
    if(rule.cssRules&&rule.cssRules.length) collect(rule);
    if(rule.selectorText.indexOf(':hover')<0) continue;
    const col=rule.style.getPropertyValue('color');
    const bg=rule.style.getPropertyValue('background-color')||rule.style.getPropertyValue('background');
    if(!col&&!bg) continue;
    for(const one of rule.selectorText.split(',')){
      const sel=one.trim();
      if(sel.indexOf(':hover')<0) continue;
      // The element the pointer is actually over. A descendant selector like
      // `.site-nav a:hover` hovers the <a>; `.card:hover .label` hovers the
      // card and repaints a child, so only the trailing :hover is stripped.
      const base=sel.replace(/:hover/g,'');
      hoverRules.push({base,spec:specificity(sel),order:order++,
        color:col||null, bg:bg||null,
        colorImp:rule.style.getPropertyPriority('color')==='important',
        bgImp:rule.style.getPropertyPriority('background-color')==='important'});
    }
  }
}
for(const sheet of document.styleSheets) collect(sheet);

const hoverOut=[];
const targets=new Map();
for(const r of hoverRules){
  let found; try { found=document.querySelectorAll(r.base); } catch(e) { continue; }
  for(const el of found){
    if(!el.getClientRects().length) continue;
    if(!el.textContent.trim()) continue;
    if(!targets.has(el)) targets.set(el,[]);
    targets.get(el).push(r);
  }
}
for(const [el,rules] of targets){
  const txt=el.textContent.trim(); if(!txt) continue;
  // Unlike the resting pass, this one does NOT skip a wrapper whose child
  // holds the text. A hover rule is usually written on the thing the pointer
  // is over — `.app-nav:hover`, `.button:hover` — while the words live in a
  // span inside it, and skipping the wrapper meant nothing was measured at
  // all. The child is used only when it sets a colour of its own.
  const inner=[...el.children].find(c=>c.textContent.trim()===txt);
  if(inner&&getComputedStyle(inner).color!==getComputedStyle(el).color) continue;
  rules.sort((a,b)=>(a.colorImp-b.colorImp)||(a.spec-b.spec)||(a.order-b.order));
  let color=null,bg=null;
  for(const r of rules){ if(r.color) color=r.color; if(r.bg) bg=r.bg; }
  const cs=getComputedStyle(el);
  // Resolve against the element: a declared var() or a keyword needs the
  // element's own context to become a colour.
  const probe=document.createElement('span');
  probe.style.display='none';
  if(color) probe.style.color=color;
  if(bg) probe.style.backgroundColor=bg;
  el.appendChild(probe);
  const ps=getComputedStyle(probe);
  const resolvedFg=color?ps.color:cs.color;
  const fg=rgbOf(resolvedFg);
  let ground=null;
  if(bg){ const c=rgbOf(ps.backgroundColor); if(c&&c.a>0) ground=c.a>=0.999?c:over(c,(backdrop(el).solid)||{r:255,g:255,b:255,a:1}); }
  el.removeChild(probe);
  if(!fg) continue;
  if(!ground){ const bd=backdrop(el); if(bd.image||!bd.solid) continue; ground=bd.solid; }
  const px=parseFloat(cs.fontSize), bold=parseInt(cs.fontWeight,10)>=700;
  const need=(px>=24||(px>=18.66&&bold))?3:4.5;
  const f=lum(over(fg,ground)), b=lum(ground);
  const ratio=(Math.max(f,b)+0.05)/(Math.min(f,b)+0.05);
  if(ratio<need) hoverOut.push({
    sel:el.tagName.toLowerCase()+(el.className&&typeof el.className==='string'?'.'+el.className.trim().split(/\s+/).slice(0,2).join('.'):''),
    txt:txt.slice(0,34), ratio:+ratio.toFixed(2), need, px:Math.round(px),
    fg:resolvedFg, bg:`rgb(${Math.round(ground.r)}, ${Math.round(ground.g)}, ${Math.round(ground.b)})`});
}

const seen=new Set();
const uniq=out.filter(i=>{const k=i.sel+'|'+i.ratio;return !seen.has(k)&&seen.add(k);});
uniq.sort((a,b)=>a.ratio-b.ratio);
const hseen=new Set();
const huniq=hoverOut.filter(i=>{const k=i.sel+'|'+i.ratio;return !hseen.has(k)&&hseen.add(k);});
huniq.sort((a,b)=>a.ratio-b.ratio);
return {path:location.pathname,theme:document.documentElement.getAttribute('data-theme')||'system',
  total:out.length, worst:uniq.slice(0,10),
  hoverTotal:hoverOut.length, hoverWorst:huniq.slice(0,10)};
})()
