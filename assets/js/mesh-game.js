/* ==========================================================================
   FOREVER LoRa: mesh game
   Free play: knock out nodes and watch the message reroute.
   Storm survival: nodes fail faster and faster. Tap them to repair them, and
   keep messages getting through for as long as you can.
   Uses calm, $, and fitCanvas from main.js.
   ========================================================================== */
(function meshGame() {
  $("#simulator").hidden = false;

  const canvas = $("#sim-canvas");
  const ctx = canvas.getContext("2d");
  const readout = $("#sim-readout");
  const overlay = $("#game-over");

  /* ----- The map: positions are fractions of the canvas size ----- */
  const POINTS = [
    [.05, .5],                                        // 0: node A
    [.15, .2], [.13, .4], [.13, .62], [.15, .82],     // 1-4: A's neighbors
    [.3, .14], [.31, .4], [.29, .64], [.31, .88],     // 5-8
    [.5, .13], [.47, .44], [.54, .6], [.5, .78],      // 9-12: 9 and 12 are hilltops
    [.69, .14], [.69, .4], [.71, .64], [.69, .88],    // 13-16
    [.85, .2], [.87, .4], [.87, .62], [.85, .82],     // 17-20: B's neighbors
    [.95, .5],                                        // 21: node B
  ];
  const LINKS = [
    [0, 1], [0, 2], [0, 3], [0, 4], [1, 2], [2, 3], [3, 4],
    [1, 5], [1, 6], [2, 5], [2, 6], [3, 6], [3, 7], [4, 7], [4, 8], [5, 6], [6, 7], [7, 8],
    [5, 9], [6, 9], [6, 10], [7, 10], [7, 11], [7, 12], [8, 12], [9, 10], [10, 11], [11, 12],
    [9, 13], [9, 14], [10, 14], [11, 14], [11, 15], [12, 15], [12, 16], [13, 14], [14, 15], [15, 16],
    [13, 17], [14, 17], [14, 18], [15, 18], [15, 19], [16, 19], [16, 20], [17, 18], [18, 19], [19, 20],
    [17, 21], [18, 21], [19, 21], [20, 21],
    [1, 9], [9, 17], [4, 12], [12, 20],               // the long reach a hilltop gives you
  ];
  const A = 0;
  const B = POINTS.length - 1;
  const HILLTOPS = new Set([9, 12]);

  /* ----- Game state ----- */
  const dead = new Set();
  const effects = [];     // lightning and repair flashes
  let size = { width: 0, height: 0 };
  let flood = null;
  let visible = true;
  let hopLimit = 7;
  let mode = "free";
  let delivered = 0;
  let score = 0;
  let lives = 3;
  let best = 0;
  let nextStrike = 0;
  let strikeGap = 0;
  let previousFrame = 0;
  let gameOver = false;

  try { best = Number(localStorage.getItem("stormBest")) || 0; } catch (e) { /* best score just won't persist */ }

  const hopTime = () => (mode === "storm" ? 250 : 400);
  const place = (i) => [POINTS[i][0] * size.width, POINTS[i][1] * size.height];
  const neighbors = (i) => LINKS.flatMap(([a, b]) => (a === i ? [b] : b === i ? [a] : []));
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  /* Breadth-first search: finds the moment each radio first hears the message.
     Like Meshtastic, "hops" count relays, so a direct link is 0 hops. A hop limit
     of 3 means three radios may pass the message along after the sender. */
  function spread(limit) {
    const level = { [A]: 0 };
    const parent = {};
    const queue = [A];
    while (queue.length) {
      const current = queue.shift();
      if (level[current] > limit) continue; // this radio heard it, but can't relay it
      for (const next of neighbors(current)) {
        if (dead.has(next) || next in level) continue;
        level[next] = level[current] + 1;
        parent[next] = current;
        queue.push(next);
      }
    }
    return { level, parent };
  }

  function launch(now) {
    const { level, parent } = spread(hopLimit);
    const route = [];
    if (B in level) {
      for (let n = B; n !== A; n = parent[n]) route.unshift(n);
      route.unshift(A);
    }
    flood = {
      level, parent, route,
      start: now,
      last: Math.max(...Object.values(level)),
      arrived: false,
      ok: false,
    };
  }

  /* ----- Display ----- */
  function report(text, failed) {
    // Only update on a change, so screen readers aren't interrupted by every loop
    if (readout.textContent === text) return;
    readout.textContent = text;
    readout.classList.toggle("fail", failed);
  }

  function updateHud() {
    $("#stat-delivered").textContent = delivered;
    $("#stat-down").textContent = dead.size;
    $("#stat-score").textContent = score;
    $("#stat-lives").textContent = "#".repeat(lives) + "-".repeat(3 - lives);
    $("#stat-best").textContent = best;
  }

  function strike(node) {
    dead.add(node);
    effects.push({ kind: "strike", node, start: performance.now() });
    updateHud();
  }

  function repair(node) {
    dead.delete(node);
    effects.push({ kind: "repair", node, start: performance.now() });
    updateHud();
  }

  function settle(now) {
    flood.arrived = true;
    const hops = flood.route.length - 2;
    // In a storm, a radio on the route may have died while the message was moving
    flood.ok = flood.route.length > 0 && flood.route.every((n) => !dead.has(n));

    if (flood.ok) {
      delivered += 1;
      if (mode === "storm") {
        score += 10 + dead.size * 2;
        if (score > best) {
          best = score;
          try { localStorage.setItem("stormBest", String(best)); } catch (e) { /* not saved */ }
        }
      }
      report(`DELIVERED // ${hops} ${hops === 1 ? "HOP" : "HOPS"} // ${dead.size} ${dead.size === 1 ? "NODE" : "NODES"} DOWN`, false);
    } else {
      const unlimited = spread(Infinity).level;
      if (flood.route.length) {
        report("LOST // A RELAY DIED MID-MESSAGE", true);
      } else if (B in unlimited) {
        report(`HOP LIMIT // ROUTE NEEDS ${unlimited[B] - 1} HOPS, LIMIT IS ${hopLimit}`, true);
      } else {
        report(`NO ROUTE // ${dead.size} NODES DOWN // B IS CUT OFF`, true);
      }
      if (mode === "storm") {
        lives -= 1;
        if (lives <= 0) endStorm();
      }
    }
    updateHud();
  }

  /* ----- Modes ----- */
  function setMode(next) {
    mode = next;
    gameOver = false;
    overlay.hidden = true;
    dead.clear();
    effects.length = 0;
    delivered = 0;
    score = 0;
    lives = 3;
    strikeGap = 1800;
    nextStrike = performance.now() + 1500;

    const storm = mode === "storm";
    $("#mode-free").setAttribute("aria-pressed", String(!storm));
    $("#mode-storm").setAttribute("aria-pressed", String(storm));
    document.querySelectorAll("[data-storm]").forEach((el) => { el.hidden = !storm; });
    $("#sim-kill").hidden = storm;
    $("#sim-repair").textContent = storm ? "[ Repair a node ]" : "[ Repair all ]";
    $("#game-help").textContent = storm
      ? "Storm survival: tap a red X to repair that node. You lose a life whenever a message fails. Three strikes ends the run."
      : "Free play: tap any node to knock it out or bring it back. It takes at least four well-placed failures to cut B off.";
    report("LINK UP // SENDING", false);
    updateHud();
    restart();
    startLoop();
  }

  function endStorm() {
    gameOver = true;
    $("#over-score").textContent = score;
    $("#over-delivered").textContent = delivered;
    overlay.hidden = false;
    $("#over-again").focus({ preventScroll: true });
  }

  function restart() {
    launch(performance.now());
    if (calm && mode === "free") {
      settle(flood.start);
      draw(Infinity);
    }
  }

  /* ----- Drawing the terrain. It never changes, so it's painted once and reused. ----- */
  let terrain = null;

  function paintTerrain() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    terrain = document.createElement("canvas");
    terrain.width = canvas.width;
    terrain.height = canvas.height;
    const t = terrain.getContext("2d");
    t.setTransform(ratio, 0, 0, ratio, 0, 0);
    const X = (v) => v * size.width;
    const Y = (v) => v * size.height;

    // Map grid
    t.strokeStyle = "rgba(125,255,92,.05)";
    t.lineWidth = 1;
    t.beginPath();
    for (let i = 1; i < 12; i++) { t.moveTo(X(i / 12), 0); t.lineTo(X(i / 12), size.height); }
    for (let i = 1; i < 8; i++) { t.moveTo(0, Y(i / 8)); t.lineTo(size.width, Y(i / 8)); }
    t.stroke();

    function mountain(cx, peak, halfWidth, base, strength) {
      const ridge = [
        [cx - halfWidth, base], [cx - halfWidth * .72, base - (base - peak) * .34],
        [cx - halfWidth * .52, base - (base - peak) * .28], [cx - halfWidth * .22, base - (base - peak) * .78],
        [cx - halfWidth * .1, base - (base - peak) * .7], [cx, peak],
        [cx + halfWidth * .2, base - (base - peak) * .66], [cx + halfWidth * .34, base - (base - peak) * .72],
        [cx + halfWidth * .68, base - (base - peak) * .3], [cx + halfWidth, base],
      ];
      t.beginPath();
      ridge.forEach(([x, y], i) => (i ? t.lineTo(X(x), Y(y)) : t.moveTo(X(x), Y(y))));
      t.closePath();
      t.fillStyle = `rgba(20,70,14,${strength * .75})`;
      t.fill();
      t.strokeStyle = `rgba(125,255,92,${strength})`;
      t.stroke();
      // Wireframe facets running down from the summit
      t.strokeStyle = `rgba(125,255,92,${strength * .4})`;
      t.beginPath();
      [-.55, -.2, .2, .55].forEach((offset) => {
        t.moveTo(X(cx), Y(peak));
        t.lineTo(X(cx + halfWidth * offset), Y(base));
      });
      t.stroke();
    }
    mountain(.22, .36, .1, .54, .28);
    mountain(.78, .34, .09, .5, .28);
    mountain(.34, .72, .09, .98, .2);
    mountain(.66, .74, .1, .99, .2);
    mountain(.5, .13, .15, .42, .6);   // hilltop node
    mountain(.5, .78, .14, 1, .6);     // hilltop node

    // Lake
    t.strokeStyle = "rgba(125,255,92,.3)";
    t.beginPath();
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 3; col++) {
        const x = .585 + col * .03 + (row % 2) * .012;
        const y = .47 + row * .035;
        t.moveTo(X(x), Y(y));
        t.quadraticCurveTo(X(x + .007), Y(y) - 3, X(x + .014), Y(y));
      }
    }
    t.stroke();

    // Pine trees
    t.fillStyle = "rgba(125,255,92,.3)";
    [[.08, .14], [.1, .1], [.24, .08], [.06, .87], [.23, .77], [.39, .24], [.4, .94], [.61, .24],
     [.61, .92], [.78, .1], [.93, .14], [.91, .86], [.8, .9], [.21, .9]].forEach(([x, y]) => {
      t.beginPath();
      t.moveTo(X(x), Y(y) - 8);
      t.lineTo(X(x) - 4, Y(y));
      t.lineTo(X(x) + 4, Y(y));
      t.closePath();
      t.fill();
    });

    // Broken cell towers: the network that failed
    t.lineWidth = 1.5;
    [[.22, .74], [.78, .74]].forEach(([x, y]) => {
      const px = X(x);
      const py = Y(y);
      t.strokeStyle = "rgba(255,90,60,.65)";
      t.beginPath();
      t.moveTo(px - 6, py + 12); t.lineTo(px, py - 12); t.lineTo(px + 6, py + 12);
      t.moveTo(px - 3, py + 2); t.lineTo(px + 3, py + 2);
      t.moveTo(px - 5, py - 16); t.lineTo(px + 5, py - 8);
      t.moveTo(px + 5, py - 16); t.lineTo(px - 5, py - 8);
      t.stroke();
    });

    // Labels
    t.fillStyle = "rgba(125,255,92,.75)";
    t.font = "11px 'IBM Plex Mono', monospace";
    t.textAlign = "center";
    t.fillText("HILLTOP", X(.5), Y(.13) - 17);
    t.fillText("HILLTOP", X(.5), Y(.78) + 26);
  }

  /* ----- Drawing each frame ----- */
  function floatingLabel(text, x, y, color, opacity) {
    ctx.fillStyle = color;
    ctx.globalAlpha = opacity;
    ctx.font = "600 11px 'IBM Plex Mono', monospace";
    ctx.fillText(text, x, y);
    ctx.globalAlpha = 1;
  }

  function draw(now) {
    if (!size.width || !flood) return;
    const hop = hopTime();
    const elapsed = now === Infinity ? Infinity : now - flood.start;
    const { level, parent, route } = flood;

    ctx.clearRect(0, 0, size.width, size.height);
    if (terrain) ctx.drawImage(terrain, 0, 0, size.width, size.height);

    // Links
    ctx.lineWidth = 1;
    for (const [a, b] of LINKS) {
      const [ax, ay] = place(a);
      const [bx, by] = place(b);
      const broken = dead.has(a) || dead.has(b);
      const lit = !broken && level[a] !== undefined && level[b] !== undefined &&
        (parent[b] === a || parent[a] === b) && elapsed >= Math.max(level[a], level[b]) * hop;
      ctx.strokeStyle = broken ? "rgba(255,90,60,.2)" : lit ? "rgba(125,255,92,.55)" : "rgba(125,255,92,.2)";
      ctx.setLineDash(broken ? [4, 7] : []);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // The route the message took to B, once it arrives
    const arrival = route.length ? (route.length - 1) * hop : 0;
    if (route.length && elapsed >= arrival) {
      ctx.strokeStyle = "#7dff5c";
      ctx.lineWidth = 3;
      ctx.beginPath();
      route.forEach((n, i) => {
        const [x, y] = place(n);
        return i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.stroke();
    }

    // Packets spreading out through the flood
    ctx.fillStyle = "#eaffe2";
    for (const key of Object.keys(parent)) {
      const child = Number(key);
      const progress = (elapsed - (level[child] - 1) * hop) / hop;
      if (progress <= 0 || progress >= 1 || dead.has(parent[child])) continue;
      const [px, py] = place(parent[child]);
      const [cx, cy] = place(child);
      ctx.beginPath();
      ctx.arc(px + (cx - px) * progress, py + (cy - py) * progress, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // The acknowledgment heading back to A along the route
    const ackDone = route.length * hop * .5;
    if (flood.ok && elapsed > arrival && elapsed < arrival + ackDone) {
      const progress = ((elapsed - arrival) / ackDone) * (route.length - 1);
      const index = Math.min(Math.floor(progress), route.length - 2);
      const [fx, fy] = place(route[route.length - 1 - index]);
      const [tx, ty] = place(route[route.length - 2 - index]);
      const part = progress - index;
      const x = fx + (tx - fx) * part;
      const y = fy + (ty - fy) * part;
      ctx.fillStyle = "#ffcf3c";
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.textAlign = "center";
      floatingLabel("ACK", x, y - 11, "#ffcf3c", 1);
    }

    // Nodes
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    POINTS.forEach((_, i) => {
      const [x, y] = place(i);
      const endpoint = i === A || i === B;
      if (dead.has(i)) {
        ctx.strokeStyle = "#ff5a3c";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x - 8, y - 8); ctx.lineTo(x + 8, y + 8);
        ctx.moveTo(x + 8, y - 8); ctx.lineTo(x - 8, y + 8);
        ctx.stroke();
        return;
      }
      const heard = i in level && elapsed >= level[i] * hop;
      const radius = endpoint ? 15 : HILLTOPS.has(i) ? 10 : 7;

      // Radio waves and TX/RX labels as each radio hears and repeats the message
      if (heard && elapsed !== Infinity) {
        const age = elapsed - level[i] * hop;
        if (age < 600) {
          ctx.strokeStyle = `rgba(125,255,92,${1 - age / 600})`;
          ctx.lineWidth = 1.5;
          for (const delay of [0, 130]) {
            if (age > delay) {
              ctx.beginPath();
              ctx.arc(x, y, radius + (age - delay) / 16, 0, Math.PI * 2);
              ctx.stroke();
            }
          }
        }
        if (age < 480) {
          const relays = i !== B && level[i] <= hopLimit;
          const isRx = i !== A && (age < 220 || !relays);
          if (isRx) floatingLabel("RX", x, y - radius - 9, "#eaffe2", 1 - age / 480);
          else if (relays) floatingLabel("TX", x, y - radius - 9, "#7dff5c", 1 - age / 480);
        }
      }
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = heard ? "#7dff5c" : "#07200a";
      ctx.fill();
      ctx.strokeStyle = "#7dff5c";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (endpoint) {
        ctx.fillStyle = heard ? "#000" : "#7dff5c";
        ctx.font = "600 15px 'IBM Plex Mono', monospace";
        ctx.fillText(i === A ? "A" : "B", x, y + 1);
      }
    });

    // Lightning strikes and repair flashes
    for (let i = effects.length - 1; i >= 0; i--) {
      const effect = effects[i];
      const age = performance.now() - effect.start;
      if (age > 380 || calm) {
        effects.splice(i, 1);
        continue;
      }
      const [x, y] = place(effect.node);
      ctx.globalAlpha = 1 - age / 380;
      if (effect.kind === "strike") {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + 22, 0);
        ctx.lineTo(x - 12, y * .35);
        ctx.lineTo(x + 12, y * .55);
        ctx.lineTo(x - 8, y * .78);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.fillStyle = "rgba(255,90,60,.1)";
        ctx.fillRect(0, 0, size.width, size.height);
      } else {
        ctx.strokeStyle = "#7dff5c";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 8 + age / 12, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  /* ----- Main loop ----- */
  let looping = false;

  function startLoop() {
    if (looping || (calm && mode === "free")) return;
    looping = true;
    requestAnimationFrame(loop);
  }

  function loop(now) {
    if (calm && mode === "free") {
      looping = false;
      return;
    }
    if (visible && flood && !document.hidden) {
      // If the game was off screen, carry on from where it paused
      const gap = now - previousFrame;
      if (gap > 300) {
        flood.start += gap;
        nextStrike += gap;
      }

      if (!gameOver) {
        const hop = hopTime();
        const elapsed = now - flood.start;
        const arrival = flood.route.length ? (flood.route.length - 1) * hop : flood.last * hop;
        if (!flood.arrived && elapsed >= arrival) settle(now);

        if (mode === "storm" && now >= nextStrike && !gameOver) {
          const alive = POINTS.map((_, i) => i).filter((i) => i !== A && i !== B && !dead.has(i));
          if (alive.length) strike(pick(alive));
          strikeGap = Math.max(520, strikeGap - 45);
          nextStrike = now + strikeGap;
        }

        const ack = flood.ok ? flood.route.length * hop * .5 : 0;
        const hold = mode === "storm" ? 200 : 900;
        if (flood.arrived && elapsed > Math.max(arrival + ack, flood.last * hop) + hold) launch(now);
      }
      draw(now);
      previousFrame = now;
    }
    requestAnimationFrame(loop);
  }

  /* ----- Controls ----- */
  canvas.addEventListener("pointerdown", (event) => {
    if (gameOver) return;
    const box = canvas.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    let closest = -1;
    let bestDistance = 30; // a generous target, so nodes are easy to tap on a phone
    POINTS.forEach((_, i) => {
      if (i === A || i === B) return;
      if (mode === "storm" && !dead.has(i)) return; // in a storm, taps only repair
      const [nx, ny] = place(i);
      const distance = Math.hypot(nx - x, ny - y);
      if (distance < bestDistance) {
        bestDistance = distance;
        closest = i;
      }
    });
    if (closest < 0) return;

    if (dead.has(closest)) repair(closest);
    else strike(closest);
    if (mode === "free") restart();
  });

  $("#sim-kill").addEventListener("click", () => {
    const alive = POINTS.map((_, i) => i).filter((i) => i !== A && i !== B && !dead.has(i));
    if (alive.length) strike(pick(alive));
    restart();
  });

  $("#sim-repair").addEventListener("click", () => {
    if (mode === "storm") {
      if (dead.size && !gameOver) repair(pick([...dead]));
    } else {
      dead.clear();
      updateHud();
      restart();
    }
  });

  $("#mode-free").addEventListener("click", () => setMode("free"));
  $("#mode-storm").addEventListener("click", () => setMode("storm"));
  $("#over-again").addEventListener("click", () => setMode("storm"));

  document.querySelectorAll("[data-hops]").forEach((button) => {
    button.addEventListener("click", () => {
      hopLimit = Number(button.dataset.hops);
      document.querySelectorAll("[data-hops]").forEach((other) => {
        other.setAttribute("aria-pressed", String(other === button));
      });
      if (mode === "free") restart();
    });
  });

  // Don't spend battery animating the game while it's off screen
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }).observe(canvas);

  function resize() {
    size = fitCanvas(canvas);
    paintTerrain();
    if (calm && flood && mode === "free") draw(Infinity);
  }
  new ResizeObserver(resize).observe(canvas);

  // Repaint once the pixel font arrives, so the map labels use it
  if (document.fonts) document.fonts.ready.then(resize);

  size = fitCanvas(canvas);
  paintTerrain();
  setMode("free");
})();
