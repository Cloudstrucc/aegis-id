(function(){
// Dead space at the top of a page.
//
// Paste into the console on any signed-in page, or run it through a browser
// tool the way scripts/contrast-audit.js is run. It reports how far below the
// top of the content area the first thing that draws ink actually sits.
//
// The failure it exists for: a page opens with a screenful of nothing between
// the breadcrumb and the first card. It is invisible in the stylesheet — the
// padding is on a shared rule several files away — and invisible in a test,
// because the page renders correctly, just lower down. The only way to see it
// is to measure the rendered page, which is what this does.
//
// The original was `main > .band:first-child { padding-top: 152px }`, a
// clearance for pages that sit under the fixed site header. Inside the
// application shell <main> is .app-shell__main, which sits below the shell's
// own topbar, so the clearance was 152px of nothing on every shell page whose
// first element is a band.

// Anything above this is a reader looking at an empty screen rather than
// generous spacing. A band's own breathing room is 40px or less in the shell.
var LIMIT = 56;

function visible(el){
  if(!el || !el.getClientRects().length) return false;
  var cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.opacity !== '0';
}

// The first descendant, in document order, that actually paints: text, a
// border, a non-transparent background or a replaced element. A wrapper with
// nothing but padding does not count, which is the whole point.
function firstInk(root){
  var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode: function(el){
      if(!visible(el)) return NodeFilter.FILTER_REJECT;
      if(/^(IMG|SVG|CANVAS|VIDEO|INPUT|BUTTON|SELECT|TEXTAREA)$/.test(el.tagName)) {
        return NodeFilter.FILTER_ACCEPT;
      }
      var cs = getComputedStyle(el);
      var bg = cs.backgroundColor;
      var paintsBg = bg && bg !== 'transparent' && !/rgba\([^)]*,\s*0\s*\)/.test(bg);
      var paintsBorder = parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderBottomWidth) > 0;
      var ownText = [].slice.call(el.childNodes).some(function(n){
        return n.nodeType === 3 && n.textContent.trim();
      });
      if(ownText || paintsBg || paintsBorder) return NodeFilter.FILTER_ACCEPT;
      return NodeFilter.FILTER_SKIP;
    }
  });
  return walker.nextNode();
}

var shell = document.querySelector('.app-shell__main');
var main = shell || document.querySelector('main');
if(!main) return { path: location.pathname, skipped: 'no <main>' };

var first = [].slice.call(main.children).filter(visible)[0];
if(!first) return { path: location.pathname, skipped: 'nothing rendered' };

var ink = firstInk(first) || first;
var firstTop = first.getBoundingClientRect().top;
var inkTop = ink.getBoundingClientRect().top;
var gap = Math.round(inkTop - firstTop);
var cs = getComputedStyle(first);

// Which rules put it there, so the finding names its own cause rather than
// sending the reader to search the stylesheet for a number.
var causes = [];
for(var s = 0; s < document.styleSheets.length; s++){
  var rules; try { rules = document.styleSheets[s].cssRules; } catch(e) { continue; }
  (function walk(list, media){
    for(var i = 0; i < list.length; i++){
      var rule = list[i];
      if(!rule.selectorText){ if(rule.cssRules) walk(rule.cssRules, rule.conditionText || media); continue; }
      if(rule.cssRules && rule.cssRules.length) walk(rule.cssRules, media);
      var pt = rule.style.getPropertyValue('padding-top') || rule.style.getPropertyValue('padding');
      if(!pt) continue;
      var matches = false; try { matches = first.matches(rule.selectorText); } catch(e) {}
      if(matches) causes.push({ sel: rule.selectorText, media: media || '', value: pt.trim() });
    }
  })(rules, null);
}

return {
  path: location.pathname,
  inShell: Boolean(shell),
  firstElement: first.tagName.toLowerCase() + (first.className && typeof first.className === 'string'
    ? '.' + first.className.trim().split(/\s+/).slice(0, 2).join('.') : ''),
  paddingTop: cs.paddingTop,
  gap: gap,
  limit: LIMIT,
  fails: gap > LIMIT,
  // Last one wins in the cascade, so the tail of this list is the suspect.
  causes: causes.slice(-4)
};
})()
