// The icon set the application chrome draws from.
//
// Inline SVG rather than an icon font or a sprite sheet, for two reasons that
// both come from this deployment's constraints: the Content Security Policy
// allows styles and fonts from 'self' only, so a hosted icon font is out; and
// a sprite referenced with <use xlink:href> is a second request that can lose
// the race with first paint, which is visible as a row of empty squares in the
// sidebar. Inline paths arrive with the markup.
//
// Every glyph is a 24x24 stroked outline on the same grid, so they sit at one
// optical weight beside each other. `currentColor` throughout — the navigation
// recolours on hover, on the active row and between the two themes, and an
// icon with a baked-in fill would stay the wrong colour in one of them.

const PATHS = {
  // --- workspace ----------------------------------------------------------
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  people: 'M16 20v-1.5a3.5 3.5 0 00-3.5-3.5h-5A3.5 3.5 0 004 18.5V20M10 11.5a3.75 3.75 0 100-7.5 3.75 3.75 0 000 7.5M17 4.3a3.75 3.75 0 010 7.2M20 20v-1.5a3.5 3.5 0 00-2.6-3.4',
  badge: 'M4 5h16v14H4zM8 9.5h3M8 13h6M15.5 9.5h.5',
  shield: 'M12 3.2l7 2.9v5.6c0 4.1-2.9 7.7-7 8.4-4.1-.7-7-4.3-7-8.4V6.1zM9.3 12.2l1.9 1.9 3.6-3.7',
  tag: 'M11.6 3.6H20v8.4l-8.6 8.6a1.4 1.4 0 01-2 0l-6.4-6.4a1.4 1.4 0 010-2zM16 8h.01',
  sitemap: 'M9.5 3.5h5v4h-5zM3.5 16.5h5v4h-5zM15.5 16.5h5v4h-5zM12 7.5v4M6 16.5v-2.5h12v2.5',
  palette: 'M12 3.5a8.5 8.5 0 000 17c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.1 0-.9.8-1.7 1.7-1.7h1a4.5 4.5 0 004.5-4.5c0-3.8-3.6-6.8-8-6.8M7.5 9h.01M11 7h.01M15.5 8h.01M7 13h.01',
  plug: 'M9 3.5v4.5M15 3.5v4.5M6.5 8h11v2.5a5.5 5.5 0 01-11 0zM12 16v4.5',
  link: 'M10.5 13.5l3-3M9.2 8.6l1.6-1.6a3.4 3.4 0 014.8 4.8l-1.6 1.6M14.8 15.4l-1.6 1.6a3.4 3.4 0 01-4.8-4.8l1.6-1.6',
  building: 'M5 20.5V5.5a2 2 0 012-2h6a2 2 0 012 2v15M15 10h2.5a2 2 0 012 2v8.5M3.5 20.5h17M8.5 7.5h3M8.5 11h3M8.5 14.5h3',
  lifebuoy: 'M12 20.5a8.5 8.5 0 100-17 8.5 8.5 0 000 17M12 15.2a3.2 3.2 0 100-6.4 3.2 3.2 0 000 6.4M6 6l3.7 3.7M14.3 14.3L18 18M18 6l-3.7 3.7M9.7 14.3L6 18',
  activity: 'M3.5 12.5h3.2l2.1-6 3.3 11 2.4-7.5 1.6 2.5h4.4',
  chain: 'M6.5 8.2a2.7 2.7 0 100 5.4h3a2.7 2.7 0 002.6-2M17.5 15.8a2.7 2.7 0 100-5.4h-3a2.7 2.7 0 00-2.6 2',
  idcheck: 'M4 5h16v14H4zM8.4 11.6a1.9 1.9 0 100-3.8 1.9 1.9 0 000 3.8M5.8 16.2c.4-1.6 1.4-2.4 2.6-2.4s2.2.8 2.6 2.4M14 10h4M14 13.5h2.5',
  gear: 'M12 15.1a3.1 3.1 0 100-6.2 3.1 3.1 0 000 6.2M19.2 14.3l1.5 1-1.6 2.8-1.8-.5a7.4 7.4 0 01-1.6.9l-.4 1.8h-3.2l-.4-1.8a7.4 7.4 0 01-1.6-.9l-1.8.5-1.6-2.8 1.5-1a7.6 7.6 0 010-1.8l-1.5-1 1.6-2.8 1.8.5a7.4 7.4 0 011.6-.9l.4-1.8h3.2l.4 1.8a7.4 7.4 0 011.6.9l1.8-.5 1.6 2.8-1.5 1a7.6 7.6 0 010 1.8',

  // --- organization & platform -------------------------------------------
  phone: 'M7.5 2.8h9v18.4h-9zM10.5 18.6h3',
  globe: 'M12 20.5a8.5 8.5 0 100-17 8.5 8.5 0 000 17M3.6 9.5h16.8M3.6 14.5h16.8M12 3.5c-2.2 2.3-3.4 5.3-3.4 8.5s1.2 6.2 3.4 8.5c2.2-2.3 3.4-5.3 3.4-8.5S14.2 5.8 12 3.5',
  sliders: 'M4 7h10M18 7h2M4 12h3M11 12h9M4 17h7M15 17h5M16 5v4M9 10v4M13 15v4',
  key: 'M14.8 3.5a5.7 5.7 0 00-5.3 7.8L3.5 17.3v3.2h3.2l.9-.9v-1.8h1.8l1.6-1.6v-1.8h1.8l.5-.5a5.7 5.7 0 001.5-10.4M16.8 8.2h.01',
  bell: 'M12 3.5a5.5 5.5 0 00-5.5 5.5c0 4.2-1.5 5.6-1.5 5.6h14s-1.5-1.4-1.5-5.6A5.5 5.5 0 0012 3.5M10 17.6a2.1 2.1 0 004 0',
  ticket: 'M3.5 9.2V6.5h17v2.7a2.8 2.8 0 000 5.6v2.7h-17v-2.7a2.8 2.8 0 000-5.6M9.5 6.5v11',
  alert: 'M8.6 3.5h6.8l4.1 4.1v6.8l-4.1 4.1H8.6l-4.1-4.1V7.6zM12 8v4.5M12 15.8h.01',
  rotate: 'M20 5.5v4.6h-4.6M4 18.5v-4.6h4.6M19.2 10.1A7.6 7.6 0 006 7.2L4 10.1M4.8 13.9a7.6 7.6 0 0013.2 2.9l2-2.9',
  wallet: 'M4 7.5h16v12H4zM4 7.5l2.8-3h10.4l2.8 3M16 13.5h.01',

  // --- generic ------------------------------------------------------------
  home: 'M4 10.2L12 3.8l8 6.4V20h-5.4v-5.4H9.4V20H4z',
  user: 'M12 12.2a4 4 0 100-8 4 4 0 000 8M4.8 20.5c.6-3.6 3.5-5.8 7.2-5.8s6.6 2.2 7.2 5.8',
  beaker: 'M9 3.5h6M10 3.5v5.2L5.4 17a2.2 2.2 0 001.9 3.3h9.4a2.2 2.2 0 001.9-3.3L14 8.7V3.5M7 14h10',
  chevron: 'M7 10l5-5 5 5M7 14l5 5 5-5'
};

/**
 * One icon as inline SVG.
 *
 * Unknown names yield an empty string rather than a placeholder box: a missing
 * glyph should be invisible, not a visible defect in the navigation. The
 * markup is fixed and carries no caller input, so it is safe to mark trusted
 * at the call site.
 */
function iconSvg(name, size = 16) {
  const path = PATHS[name];
  if (!path) {
    return '';
  }
  const dimension = Number(size) || 16;
  return `<svg class="ag-icon" width="${dimension}" height="${dimension}" viewBox="0 0 24 24" fill="none"`
    + ' stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"'
    + ` aria-hidden="true" focusable="false"><path d="${path}"/></svg>`;
}

function hasIcon(name) {
  return Object.prototype.hasOwnProperty.call(PATHS, name);
}

module.exports = { iconSvg, hasIcon, iconNames: Object.keys(PATHS) };
