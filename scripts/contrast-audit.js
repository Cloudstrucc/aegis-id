(function(){
const srgb=c=>c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4);
function rgbOf(str){const m=str&&str.match(/rgba?\(([^)]+)\)/);if(!m)return null;
  const p=m[1].split(',').map(s=>parseFloat(s));return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1};}
function lum(c){const[r,g,b]=[c.r,c.g,c.b].map(n=>srgb(n/255));return 0.2126*r+0.7152*g+0.0722*b;}
function over(fg,bg){const a=fg.a;return {r:fg.r*a+bg.r*(1-a),g:fg.g*a+bg.g*(1-a),b:fg.b*a+bg.b*(1-a),a:1};}
// Every colour a gradient actually paints, so a label on a gradient is judged
// against its worst stop rather than skipped.
function gradientStops(img){const out=[];const re=/rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}/g;let m;
  while((m=re.exec(img))){const v=m[0];if(v.startsWith('#')){let h=v.slice(1);
    if(h.length===3)h=[...h].map(x=>x+x).join('');if(h.length>=6)out.push({r:parseInt(h.slice(0,2),16),g:parseInt(h.slice(2,4),16),b:parseInt(h.slice(4,6),16),a:1});}
    else {const c=rgbOf(v);if(c)out.push(c);}}
  return out;}
function backdrop(el){
  let n=el,stack=[];
  while(n&&n!==document.documentElement){const cs=getComputedStyle(n);
    const img=cs.backgroundImage;
    if(img&&img!=='none'){const st=gradientStops(img);if(st.length)return {solid:null,stops:st};
      if(/url\(/.test(img))return {solid:null,stops:null,image:true};}
    const c=rgbOf(cs.backgroundColor);
    if(c&&c.a>0){stack.push(c);if(c.a>=0.999)break;}
    n=n.parentElement;}
  let base=rgbOf(getComputedStyle(document.body).backgroundColor)||{r:255,g:255,b:255,a:1};
  for(let i=stack.length-1;i>=0;i--)base=over(stack[i],base);
  return {solid:base,stops:null};
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
const seen=new Set();
const uniq=out.filter(i=>{const k=i.sel+'|'+i.ratio;return !seen.has(k)&&seen.add(k);});
uniq.sort((a,b)=>a.ratio-b.ratio);
return {path:location.pathname,theme:document.documentElement.getAttribute('data-theme')||'system',
  total:out.length, worst:uniq.slice(0,10)};
})()
