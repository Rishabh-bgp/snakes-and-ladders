/* ==========================================================================
   Board renderer: draws the 10x10 board, the curvy snakes and the ladders
   as one SVG, and computes the paths tokens follow when they jump.
   Everything here is hand-built geometry, no images.
   ========================================================================== */
(function (root) {
  'use strict';
  var SNL = root.SNL;
  var NS = 'http://www.w3.org/2000/svg';
  var W = 1000;             // board width in SVG units
  var DOCK = 96;            // height of the start dock under the board
  var H = W + DOCK;

  function f(n) { return Math.round(n * 10) / 10; }
  function pt(p) { return f(p.x) + ' ' + f(p.y); }
  function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
  function len(v) { return Math.sqrt(v.x * v.x + v.y * v.y); }
  function norm(v) { var l = len(v) || 1; return { x: v.x / l, y: v.y / l }; }

  /* ---------- squares ---------- */
  function cells() {
    var out = [];
    for (var n = 1; n <= 100; n++) {
      var c = SNL.squareToCell(n);
      var x = c.col * 100;
      var y = (9 - c.row) * 100;
      // Rainbow drifts diagonally across the board; neighbours alternate shade.
      var hue = Math.round(188 + c.row * 12 + c.col * 3.5);
      var alt = (c.row + c.col) % 2 ? ' alt' : '';
      out.push('<rect class="cell' + alt + '" x="' + x + '" y="' + y + '" width="100" height="100" style="--h:' + hue + '"/>');
      if (n === 100) {
        out.push('<g class="goal" transform="translate(' + (x + 50) + ' ' + (y + 58) + ')">' +
          '<path d="M-26 10 L-30 -18 L-14 -4 L0 -26 L14 -4 L30 -18 L26 10 Z" class="crown"/>' +
          '<rect x="-26" y="12" width="52" height="9" rx="3" class="crown"/></g>');
      }
      out.push('<text class="num' + (n === 100 ? ' num-goal' : '') + '" x="' + (x + 9) + '" y="' + (y + 27) + '">' + n + '</text>');
    }
    return out.join('');
  }

  /* ---------- ladders ---------- */
  function ladderPath(from, to) {
    var a = SNL.squareCenter(from);
    var b = SNL.squareCenter(to);
    return [a, b];
  }

  function ladder(from, to) {
    var a = SNL.squareCenter(from);
    var b = SNL.squareCenter(to);
    var d = norm(sub(b, a));
    var nrm = { x: -d.y, y: d.x };
    var inset = 18;
    a = { x: a.x - d.x * inset, y: a.y - d.y * inset };
    b = { x: b.x + d.x * inset, y: b.y + d.y * inset };
    var half = 21;
    var L1 = { x: a.x + nrm.x * half, y: a.y + nrm.y * half };
    var L2 = { x: b.x + nrm.x * half, y: b.y + nrm.y * half };
    var R1 = { x: a.x - nrm.x * half, y: a.y - nrm.y * half };
    var R2 = { x: b.x - nrm.x * half, y: b.y - nrm.y * half };
    var total = len(sub(b, a));
    var rungs = [];
    var count = Math.max(2, Math.floor(total / 44));
    for (var i = 1; i <= count; i++) {
      var t = i / (count + 1);
      var p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      rungs.push('M' + pt({ x: p.x + nrm.x * half, y: p.y + nrm.y * half }) + 'L' + pt({ x: p.x - nrm.x * half, y: p.y - nrm.y * half }));
    }
    var rails = 'M' + pt(L1) + 'L' + pt(L2) + 'M' + pt(R1) + 'L' + pt(R2);
    var r = rungs.join('');
    return '<g class="ladder" data-from="' + from + '">' +
      '<path class="ladder-shadow" d="' + rails + r + '" transform="translate(7 9)"/>' +
      '<path class="rung" d="' + r + '"/>' +
      '<path class="rung-hi" d="' + r + '"/>' +
      '<path class="rail" d="' + rails + '"/>' +
      '<path class="rail-hi" d="' + rails + '"/>' +
      '</g>';
  }

  /* ---------- snakes ---------- */
  // The spine is a straight line from head to tail with a sine wiggle on top.
  function snakeSpine(from, to, index) {
    var h = SNL.squareCenter(from);
    var t = SNL.squareCenter(to);
    var v = sub(t, h);
    var L = len(v);
    var d = norm(v);
    var nrm = { x: -d.y, y: d.x };
    var waves = Math.max(2, Math.round(L / 190));
    var amp = Math.min(40, Math.max(18, L * 0.09));
    var sign = index % 2 ? -1 : 1;
    var N = Math.max(36, Math.round(L / 6));
    var pts = [];
    for (var i = 0; i <= N; i++) {
      var s = i / N;
      var w = Math.sin(s * Math.PI * waves) * amp * sign * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, s * 1.15)));
      pts.push({ x: h.x + v.x * s + nrm.x * w, y: h.y + v.y * s + nrm.y * w });
    }
    return pts;
  }

  function snake(from, to, index, skin) {
    var spine = snakeSpine(from, to, index);
    var N = spine.length - 1;
    var left = [];
    var right = [];
    var normals = [];
    for (var i = 0; i <= N; i++) {
      var p0 = spine[Math.max(0, i - 1)];
      var p1 = spine[Math.min(N, i + 1)];
      var tg = norm(sub(p1, p0));
      var nm = { x: -tg.y, y: tg.x };
      normals.push(nm);
      var s = i / N;
      var w = (40 * Math.pow(1 - s, 0.55) + 5) / 2;
      if (s < 0.06) w *= 0.86 + s * 2.2;     // slim neck behind the head
      left.push({ x: spine[i].x + nm.x * w, y: spine[i].y + nm.y * w });
      right.push({ x: spine[i].x - nm.x * w, y: spine[i].y - nm.y * w });
    }
    var tip = spine[N];
    var tgEnd = norm(sub(spine[N], spine[N - 1]));
    var tailTip = { x: tip.x + tgEnd.x * 10, y: tip.y + tgEnd.y * 10 };
    var body = 'M' + left.map(pt).join('L') + 'L' + pt(tailTip) + 'L' + right.slice().reverse().map(pt).join('L') + 'Z';

    // Bands: quads between pairs of outline points.
    var bands = [];
    for (var b = 5; b < N - 3; b += 7) {
      var e = Math.min(N, b + 2);
      bands.push('M' + pt(left[b]) + 'L' + pt(left[e]) + 'L' + pt(right[e]) + 'L' + pt(right[b]) + 'Z');
    }
    // Sheen along one flank.
    var sheen = [];
    for (var k = 2; k < N - 2; k++) {
      var sk = k / N;
      var off = (40 * Math.pow(1 - sk, 0.55) + 5) * 0.2;
      sheen.push(pt({ x: spine[k].x + normals[k].x * off, y: spine[k].y + normals[k].y * off }));
    }
    var head = spine[0];
    var dir = norm(sub(spine[0], spine[3]));
    var ang = Math.atan2(dir.y, dir.x) * 180 / Math.PI;
    var sp = 'M' + spine.map(pt).join('L');
    return '<g class="snake" data-from="' + from + '" style="--body:' + skin.body + ';--dark:' + skin.dark + ';--band:' + skin.band + '">' +
      '<path class="snake-shadow" d="' + body + '" transform="translate(7 9)"/>' +
      '<path class="snake-body" d="' + body + '"/>' +
      '<path class="snake-band" d="' + bands.join('') + '"/>' +
      '<path class="snake-sheen" d="M' + sheen.join('L') + '"/>' +
      '<path class="snake-outline" d="' + body + '"/>' +
      '<g class="snake-head" transform="translate(' + f(head.x) + ' ' + f(head.y) + ') rotate(' + f(ang) + ') scale(1.18)">' +
        '<path class="tongue" d="M26 0 L44 0 M44 0 L52 -7 M44 0 L52 7"/>' +
        '<path class="head-shape" d="M-16 -17 C6 -24 26 -14 30 0 C26 14 6 24 -16 17 C-24 10 -24 -10 -16 -17 Z"/>' +
        '<ellipse class="head-spot" cx="2" cy="0" rx="9" ry="5"/>' +
        '<circle class="eye" cx="11" cy="-10" r="6.5"/><circle class="eye" cx="11" cy="10" r="6.5"/>' +
        '<circle class="pupil" cx="13.5" cy="-10" r="3.2"/><circle class="pupil" cx="13.5" cy="10" r="3.2"/>' +
        '<circle class="glint" cx="12" cy="-12" r="1.3"/><circle class="glint" cx="12" cy="8" r="1.3"/>' +
        '<circle class="nostril" cx="26" cy="-4" r="1.6"/><circle class="nostril" cx="26" cy="4" r="1.6"/>' +
      '</g>' +
      '<path class="snake-spine" d="' + sp + '"/>' +
      '</g>';
  }

  /* ---------- start dock ---------- */
  function dock() {
    return '<g class="dock">' +
      '<rect class="dock-bg" x="0" y="' + (W + 14) + '" width="1000" height="' + (DOCK - 14) + '" rx="22"/>' +
      '<text class="dock-label" x="40" y="' + (W + 66) + '">START</text>' +
      '<path class="dock-arrow" d="M150 ' + (W + 56) + ' h40 m-14 -12 l14 12 l-14 12"/>' +
      '<text class="dock-hint" x="960" y="' + (W + 66) + '" text-anchor="end">Reach 100 to win</text>' +
      '</g>';
  }

  function dockSlot(i) { return { x: 250 + i * 86, y: W + 55 }; }

  function defs() {
    return '<defs>' +
      '<radialGradient id="tokShine" cx="35%" cy="30%" r="70%"><stop offset="0" stop-color="#fff" stop-opacity=".85"/><stop offset=".45" stop-color="#fff" stop-opacity=".12"/><stop offset="1" stop-color="#000" stop-opacity=".28"/></radialGradient>' +
      '<linearGradient id="crownGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fde68a"/><stop offset="1" stop-color="#f59e0b"/></linearGradient>' +
      '</defs>';
  }

  /* ---------- public API ---------- */
  function render(svg, config) {
    var parts = ['<title id="boardTitle">Snakes and Ladders board</title>', defs(), '<g class="cells">', cells(), '</g>', '<rect class="board-edge" x="1.5" y="1.5" width="997" height="997" rx="6"/>'];
    var paths = {};
    var ladders = config.ladders;
    var snakes = config.snakes;
    var sKeys = Object.keys(snakes).map(Number);
    parts.push('<g class="ladders">');
    Object.keys(ladders).map(Number).forEach(function (from) {
      parts.push(ladder(from, ladders[from]));
      paths['L' + from] = ladderPath(from, ladders[from]);
    });
    parts.push('</g><g class="snakes">');
    sKeys.forEach(function (from, i) {
      var skin = config.snakeSkins[i % config.snakeSkins.length];
      parts.push(snake(from, snakes[from], i, skin));
      paths['S' + from] = snakeSpine(from, snakes[from], i);
    });
    parts.push('</g>', dock(), '<g class="tokens" id="tokenLayer"></g>');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.innerHTML = parts.join('');
    return paths;
  }

  // Where token k of `total` sharing square n should sit.
  var OFFSETS = {
    1: [[0, 0]],
    2: [[-20, 4], [20, 4]],
    3: [[-20, -10], [20, -10], [0, 20]],
    4: [[-20, -14], [20, -14], [-20, 22], [20, 22]]
  };
  function tokenSpot(square, k, total, playerIndex) {
    if (square === 0) { var d = dockSlot(playerIndex); return { x: d.x, y: d.y, s: 1 }; }
    var c = SNL.squareCenter(square);
    var o = OFFSETS[Math.min(total, 4)][k] || [0, 0];
    return { x: c.x + o[0], y: c.y + o[1] + 6, s: total > 1 ? 0.7 : 1 };
  }

  function makeToken(player) {
    var g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'token');
    g.setAttribute('data-player', player.id);
    g.style.setProperty('--tok', player.color);
    var initial = (player.name || '?').trim().charAt(0).toUpperCase() || '?';
    g.innerHTML = '<g class="tok-inner">' +
      '<ellipse class="tok-shadow" cx="3" cy="26" rx="22" ry="7"/>' +
      '<circle class="tok-ring" r="35"/>' +
      '<circle class="tok-base" r="27"/>' +
      '<circle class="tok-shine" r="27" fill="url(#tokShine)"/>' +
      '<text class="tok-label" y="9.5" text-anchor="middle">' + initial.replace(/[<>&"]/g, '') + '</text></g>';
    return g;
  }

  root.SNLBoard = { render: render, tokenSpot: tokenSpot, makeToken: makeToken, dockSlot: dockSlot, WIDTH: W, HEIGHT: H };
})(typeof self !== 'undefined' ? self : this);
