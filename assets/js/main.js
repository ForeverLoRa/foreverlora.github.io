/* ==========================================================================
   FOREVER LoRa: page effects
   The site still reads fine without this file. It only adds the extras:
     1. Boot screen           4. Photo viewer and copy-email button
     2. File "decrypt" effect 5. Terminal
     3. Background mesh
   The mesh game and phone simulator have their own files: mesh-game.js and phone.js.
   ========================================================================== */
const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = (selector) => document.querySelector(selector);

/* --- 1. Boot screen ------------------------------------------------------ */
const BOOT_LINES = [
  "FOREVERLORA BIOS v2.4 // EST. 2024",
  "MEMORY CHECK ............ 640K OK",
  "!POWER GRID .............. FAULT",
  "!CELL NETWORK ............ NO SIGNAL",
  "!INTERNET BACKBONE ....... NOT RESPONDING",
  "!SECTOR 07 ............... DAMAGED",
  "RECOVERING FILES ........ 6 FOUND",
  "LORA RADIO .............. ONLINE",
  "MESH .................... NODES HEARD",
  " ",
  ">_ WELCOME, SURVIVOR",
];

function runBoot() {
  const screen = document.createElement("div");
  screen.id = "boot";
  screen.setAttribute("aria-hidden", "true");
  const skip = document.createElement("button");
  skip.type = "button";
  skip.textContent = "[ Skip ]";
  screen.append(skip);
  document.body.append(screen);
  document.body.style.overflow = "hidden";

  let timer;
  let finished = false;

  function finish() {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    window.removeEventListener("keydown", finish);
    try { sessionStorage.setItem("booted", "1"); } catch (e) { /* private mode: boot again next time */ }
    document.documentElement.classList.remove("boot");
    document.body.style.overflow = "";
    screen.classList.add("out");
    setTimeout(() => screen.remove(), 340);
  }

  let line = 0;
  function nextLine() {
    if (line >= BOOT_LINES.length) {
      timer = setTimeout(finish, 480);
      return;
    }
    const text = BOOT_LINES[line++];
    const p = document.createElement("p");
    if (text.startsWith("!")) p.className = "bad";
    p.textContent = text.replace(/^!/, "");
    skip.before(p);
    timer = setTimeout(nextLine, 90 + Math.random() * 150);
  }

  screen.addEventListener("click", finish);
  window.addEventListener("keydown", finish);
  nextLine();
}

if (document.documentElement.classList.contains("boot")) runBoot();

/* --- 2. Decrypt effect: scrambles text, then reveals it left to right ----- */
const GLYPHS = "!<>-_/\\[]{}=+*^?#%01ABCDEF";

function decrypt(container) {
  if (calm) return;
  // Collect every piece of text inside, keeping links and bold text intact
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const pieces = [];
  while (walker.nextNode()) {
    if (walker.currentNode.nodeValue.trim()) {
      pieces.push({ node: walker.currentNode, text: walker.currentNode.nodeValue });
    }
  }
  const started = performance.now();
  const duration = 620;
  container.setAttribute("aria-busy", "true");

  function frame(now) {
    const progress = Math.min((now - started) / duration, 1);
    for (const { node, text } of pieces) {
      const shown = Math.floor(text.length * progress);
      let out = text.slice(0, shown);
      for (let i = shown; i < text.length; i++) {
        out += /\s/.test(text[i]) ? text[i] : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      }
      node.nodeValue = out;
    }
    if (progress < 1) requestAnimationFrame(frame);
    else container.removeAttribute("aria-busy");
  }
  requestAnimationFrame(frame);
}

document.querySelectorAll(".tile details").forEach((details) => {
  details.addEventListener("toggle", () => {
    if (details.open) decrypt(details.querySelector(".more"));
  });
});

/* Fits a canvas to its on-screen size, including on sharp phone screens */
function fitCanvas(canvas) {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const { width, height } = canvas.getBoundingClientRect();
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.getContext("2d").setTransform(ratio, 0, 0, ratio, 0, 0);
  return { width, height };
}

/* --- 3. Background mesh: faint nodes with packets wandering between them -- */
(function backgroundMesh() {
  const canvas = $("#bg-mesh");
  const ctx = canvas.getContext("2d");
  let nodes = [];
  let links = [];
  let size = { width: 0, height: 0 };
  let packet = null;

  function build() {
    size = fitCanvas(canvas);
    const count = Math.round(Math.min(46, (size.width * size.height) / 32000));
    nodes = Array.from({ length: count }, () => ({
      x: Math.random() * size.width,
      y: Math.random() * size.height,
      links: [],
    }));
    links = [];
    const reach = Math.max(170, Math.min(size.width, size.height) / 3.4);
    nodes.forEach((a, i) => {
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        if (Math.hypot(a.x - b.x, a.y - b.y) < reach) {
          links.push([a, b]);
          a.links.push(b);
          b.links.push(a);
        }
      }
    });
    packet = null;
  }

  function draw(now) {
    ctx.clearRect(0, 0, size.width, size.height);
    ctx.strokeStyle = "rgba(125,255,92,.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const [a, b] of links) {
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    ctx.fillStyle = "#7dff5c";
    for (const n of nodes) ctx.fillRect(n.x - 2, n.y - 2, 4, 4);

    if (calm) return;

    // Move one packet along the links, picking a new link at every node
    if (!packet || now - packet.start > 900) {
      const from = packet ? packet.to : nodes[Math.floor(Math.random() * nodes.length)];
      const options = from && from.links;
      if (options && options.length) {
        packet = { from, to: options[Math.floor(Math.random() * options.length)], start: now };
      } else {
        packet = null;
      }
    }
    if (packet) {
      const t = (now - packet.start) / 900;
      ctx.beginPath();
      ctx.arc(packet.from.x + (packet.to.x - packet.from.x) * t, packet.from.y + (packet.to.y - packet.from.y) * t, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#eaffe2";
      ctx.fill();
    }
    requestAnimationFrame(draw);
  }

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      build();
      if (calm) draw(0);
    }, 200);
  });

  build();
  requestAnimationFrame(draw);
})();

/* --- 4. Photo viewer and copy-email button --------------------------------- */
(function viewer() {
  const dialog = $("#viewer");
  const image = $("#viewer-img");
  const caption = $("#viewer-caption");
  const shots = [...document.querySelectorAll(".shot")];
  let current = 0;

  function show(index) {
    current = (index + shots.length) % shots.length;
    const shot = shots[current];
    image.src = shot.getAttribute("href");
    image.alt = shot.querySelector("img").alt;
    caption.textContent = shot.querySelector("span").textContent;
  }

  shots.forEach((shot, index) => {
    shot.addEventListener("click", (event) => {
      event.preventDefault();
      show(index);
      dialog.showModal();
    });
  });

  $("#viewer-prev").addEventListener("click", () => show(current - 1));
  $("#viewer-next").addEventListener("click", () => show(current + 1));
  $("#viewer-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") show(current - 1);
    if (event.key === "ArrowRight") show(current + 1);
  });
  // A click on the dark area outside the photo closes the viewer
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
})();

(function copyEmail() {
  const button = $("#copy-email");
  const status = $("#copy-status");
  const address = $("#email");
  button.hidden = false;

  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(address.textContent);
      status.textContent = "Address copied. Channel open.";
    } catch (e) {
      // Clipboard blocked: select the address so it can be copied by hand
      getSelection().selectAllChildren(address);
      status.textContent = "Couldn't copy automatically. The address is selected, so copy it by hand.";
    }
  });
})();

/* --- 5. Terminal: add your own commands to this list ----------------------- */
(function terminal() {
  const section = $("#terminal");
  section.hidden = false;
  const output = $("#term-output");
  const form = $("#term-form");
  const input = $("#term-input");

  const go = (selector) => {
    $(selector).scrollIntoView({ behavior: calm ? "auto" : "smooth" });
  };

  const COMMANDS = {
    help: () => "Commands: whois, lora, mesh, phone, meshtastic, meshcore, cases, contact, status, reboot, clear",
    whois: () => "FOREVER LoRa // mesh network technology // est. 2024.\nIf it's decentralized, we're interested.",
    lora: () => "Long range. Low power. Tiny messages.\nIt won't stream your movies, but it might reach your neighbor when nothing else will.",
    mesh: () => "Radios relay for each other. Knock one out and the message tries another way.\nLoading simulator...",
    phone: () => "Loading phone simulator...",
    meshtastic: () => "Open source. Quick to set up. Nodes can relay what they hear.\nhttps://meshtastic.org",
    meshcore: () => "Open source. Fixed roles. Dedicated repeaters carry the traffic.\nhttps://github.com/meshcore-dev/MeshCore",
    cases: () => "Scrolling to salvaged hardware...",
    contact: () => "foreverlora_contact@proton.me\nYouTube: @ForeverLoRa // TikTok: @forever.lora",
    status: () => "GRID: FAULT\nCELL: NO SIGNAL\nMESH: STILL TALKING",
    sudo: () => "Permission denied. This network has no admin. That's the whole point.",
    reboot: () => "Rebooting...",
  };

  const AFTER = {
    mesh: () => go("#simulator"),
    phone: () => go("#phone"),
    cases: () => go("#hardware"),
    reboot: () => {
      try { sessionStorage.removeItem("booted"); } catch (e) { /* nothing to clear */ }
      setTimeout(() => location.reload(), 400);
    },
  };

  function print(text, className) {
    const line = document.createElement("p");
    line.textContent = text; // textContent keeps typed input from being treated as HTML
    if (className) line.className = className;
    output.append(line);
    output.scrollTop = output.scrollHeight;
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const typed = input.value.trim();
    input.value = "";
    if (!typed) return;

    print(`survivor@mesh:~$ ${typed}`, "cmd");
    const name = typed.toLowerCase().split(/\s+/)[0];

    if (name === "clear") {
      output.replaceChildren();
    } else if (Object.hasOwn(COMMANDS, name)) {
      print(COMMANDS[name]());
      if (AFTER[name]) AFTER[name]();
    } else {
      print(`${name}: command not found. Sector may be damaged. Try "help".`);
    }
  });
})();
