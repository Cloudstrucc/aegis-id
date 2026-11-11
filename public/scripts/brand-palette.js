// The organization branding palette editor.
//
// Four colours, each edited three ways that stay in step: a hex field, the
// operating system's own picker behind a swatch, and hue / saturation /
// lightness sliders. The sliders' tracks are painted with the colours they
// would produce at the current values, so moving one shows what it will do
// before it is moved — which is the part a bare <input type="color"> cannot
// do, and which on this page rendered as a thin grey line showing no colour
// at all.
//
// Everything repaints the preview card beside the form as it moves, so the
// palette is judged against the organization's own logo and name rather than
// against four swatches.
//
// The posted field is a plain text input holding #rrggbb, which is what the
// server already validates. With this script blocked the form still submits,
// and the swatch still opens the picker.

(function () {
  'use strict';

  var root = document.querySelector('[data-brand-palette]');
  if (!root) {
    return;
  }

  var preview = document.querySelector('[data-brand-preview]');
  var paletteSelect = document.getElementById('paletteId');

  // The custom-property the preview reads for each role.
  var PREVIEW_VARIABLE = {
    primary: '--brand-primary',
    accent: '--brand-accent',
    background: '--brand-bg',
    text: '--brand-text'
  };

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
  }

  function normalizeHex(value) {
    var raw = String(value || '').trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{3}$/.test(raw)) {
      raw = raw.charAt(0) + raw.charAt(0) + raw.charAt(1) + raw.charAt(1) + raw.charAt(2) + raw.charAt(2);
    }
    return /^[0-9a-fA-F]{6}$/.test(raw) ? '#' + raw.toLowerCase() : null;
  }

  function hexToRgb(hex) {
    return {
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16)
    };
  }

  function rgbToHex(rgb) {
    var part = function (value) {
      var text = clamp(Math.round(value), 0, 255).toString(16);
      return text.length === 1 ? '0' + text : text;
    };
    return '#' + part(rgb.r) + part(rgb.g) + part(rgb.b);
  }

  function rgbToHsl(rgb) {
    var r = rgb.r / 255;
    var g = rgb.g / 255;
    var b = rgb.b / 255;
    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    var lightness = (max + min) / 2;
    var hue = 0;
    var saturation = 0;

    if (max !== min) {
      var span = max - min;
      saturation = lightness > 0.5 ? span / (2 - max - min) : span / (max + min);
      if (max === r) {
        hue = (g - b) / span + (g < b ? 6 : 0);
      } else if (max === g) {
        hue = (b - r) / span + 2;
      } else {
        hue = (r - g) / span + 4;
      }
      hue *= 60;
    }

    return { h: Math.round(hue), s: Math.round(saturation * 100), l: Math.round(lightness * 100) };
  }

  function hslToRgb(hsl) {
    var h = ((hsl.h % 360) + 360) % 360 / 360;
    var s = clamp(hsl.s, 0, 100) / 100;
    var l = clamp(hsl.l, 0, 100) / 100;

    if (s === 0) {
      var grey = Math.round(l * 255);
      return { r: grey, g: grey, b: grey };
    }

    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;

    var channel = function (t) {
      var value = t;
      if (value < 0) { value += 1; }
      if (value > 1) { value -= 1; }
      if (value < 1 / 6) { return p + (q - p) * 6 * value; }
      if (value < 1 / 2) { return q; }
      if (value < 2 / 3) { return p + (q - p) * (2 / 3 - value) * 6; }
      return p;
    };

    return {
      r: Math.round(channel(h + 1 / 3) * 255),
      g: Math.round(channel(h) * 255),
      b: Math.round(channel(h - 1 / 3) * 255)
    };
  }

  function hslCss(h, s, l) {
    return 'hsl(' + h + ' ' + s + '% ' + l + '%)';
  }

  /**
   * One field: the hex input, the picker, the swatch, three sliders and the
   * rgb() readout, all driven from a single HSL value.
   */
  function wire(field) {
    var role = field.getAttribute('data-role');
    var hexInput = field.querySelector('[data-color-hex]');
    var picker = field.querySelector('[data-color-picker]');
    var chip = field.querySelector('[data-color-chip]');
    var rgbOut = field.querySelector('[data-color-rgb]');
    var sliders = {
      h: field.querySelector('[data-color-slider="h"]'),
      s: field.querySelector('[data-color-slider="s"]'),
      l: field.querySelector('[data-color-slider="l"]')
    };

    if (!hexInput || !sliders.h || !sliders.s || !sliders.l) {
      return;
    }

    var hsl = rgbToHsl(hexToRgb(normalizeHex(hexInput.value) || '#000000'));

    // Paint each track with the colours that slider would produce, holding the
    // other two where they are. The hue track is the spectrum at this
    // saturation and lightness, not a fixed rainbow, so a near-grey colour
    // shows a near-grey track and the control stops promising colours it
    // cannot reach.
    function paintTracks() {
      var hueStops = [];
      for (var degree = 0; degree <= 360; degree += 30) {
        hueStops.push(hslCss(degree, hsl.s, hsl.l) + ' ' + (degree / 3.6) + '%');
      }
      sliders.h.style.setProperty('--track', 'linear-gradient(90deg, ' + hueStops.join(', ') + ')');
      sliders.s.style.setProperty(
        '--track',
        'linear-gradient(90deg, ' + hslCss(hsl.h, 0, hsl.l) + ', ' + hslCss(hsl.h, 100, hsl.l) + ')'
      );
      sliders.l.style.setProperty(
        '--track',
        'linear-gradient(90deg, ' + hslCss(hsl.h, hsl.s, 0) + ', ' + hslCss(hsl.h, hsl.s, 50) + ', ' + hslCss(hsl.h, hsl.s, 100) + ')'
      );
    }

    function paint(hex, options) {
      var rgb = hexToRgb(hex);

      chip.style.background = hex;
      rgbOut.textContent = 'rgb(' + rgb.r + ' ' + rgb.g + ' ' + rgb.b + ')';

      if (!options || options.from !== 'hex') { hexInput.value = hex; }
      if (picker && (!options || options.from !== 'picker')) { picker.value = hex; }
      if (!options || options.from !== 'slider') {
        sliders.h.value = String(hsl.h);
        sliders.s.value = String(hsl.s);
        sliders.l.value = String(hsl.l);
      }

      paintTracks();

      if (preview && PREVIEW_VARIABLE[role]) {
        preview.style.setProperty(PREVIEW_VARIABLE[role], hex);
      }
    }

    function commit(hex, from) {
      hsl = rgbToHsl(hexToRgb(hex));
      paint(hex, { from: from });
      markCustom();
    }

    sliders.h.addEventListener('input', function () {
      hsl.h = Number(sliders.h.value);
      paint(rgbToHex(hslToRgb(hsl)), { from: 'slider' });
      markCustom();
    });
    sliders.s.addEventListener('input', function () {
      hsl.s = Number(sliders.s.value);
      paint(rgbToHex(hslToRgb(hsl)), { from: 'slider' });
      markCustom();
    });
    sliders.l.addEventListener('input', function () {
      hsl.l = Number(sliders.l.value);
      paint(rgbToHex(hslToRgb(hsl)), { from: 'slider' });
      markCustom();
    });

    if (picker) {
      picker.addEventListener('input', function () {
        var hex = normalizeHex(picker.value);
        if (hex) { commit(hex, 'picker'); }
      });
    }

    // Typed hex only takes effect once it is a colour, so the field can be
    // edited a character at a time without the preview flickering through
    // whatever the half-typed value happens to parse as.
    hexInput.addEventListener('input', function () {
      var hex = normalizeHex(hexInput.value);
      if (hex) { commit(hex, 'hex'); }
    });
    hexInput.addEventListener('blur', function () {
      var hex = normalizeHex(hexInput.value);
      commit(hex || rgbToHex(hslToRgb(hsl)), 'blur');
    });

    paint(rgbToHex(hslToRgb(hsl)), { from: 'init' });

    return { role: role, set: function (hex) { commit(hex, 'palette'); } };
  }

  var suppressCustom = false;

  // Touching any colour means the palette is no longer the preset it was.
  // Saying so in the select is what stops the save quietly reverting to the
  // preset's own colours.
  function markCustom() {
    if (suppressCustom || !paletteSelect) {
      return;
    }
    var custom = Array.prototype.find.call(paletteSelect.options, function (option) {
      return option.value === 'custom';
    });
    if (custom && paletteSelect.value !== 'custom') {
      paletteSelect.value = 'custom';
    }
  }

  Array.prototype.forEach.call(root.querySelectorAll('[data-color-field]'), wire);
})();
