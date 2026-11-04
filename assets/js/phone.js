/* ==========================================================================
   FOREVER LoRa: phone simulator
   A practice version of sending messages and creating an encrypted channel.
   Nothing is transmitted anywhere. Visitors can only send the preset phrases
   below, so there's no way to post anything inappropriate.
   Uses calm and $ from main.js.
   ========================================================================== */
(function phoneSimulator() {
  $("#phone").hidden = false;

  const screen = $("#phone-screen");
  const coach = $("#phone-coach");
  const missionList = $("#phone-missions");
  const airLog = $("#air-log");

  /* ----- Edit these lists to change what visitors can say ----- */
  const PUBLIC_PHRASES = ["Anyone out there?", "Radio check. How do you copy?", "Testing from Forever LoRa.", "Power's out here. Mesh is up."];
  const PRIVATE_PHRASES = ["Everyone okay?", "Meet at the trailhead.", "Bringing spare batteries.", "Heading back to camp."];
  const CHANNEL_NAMES = ["BASECAMP", "FAMILY", "TRAILCREW", "NEIGHBORS"];
  const PUBLIC_REPLIES = [
    { from: "Ridge Repeater", text: "Copy. Hearing you through the ridge.", meta: "2 hops" },
    { from: "Trail Mule", text: "Loud and clear from the valley.", meta: "1 hop" },
    { from: "Harbor Node", text: "Got you here. Welcome to the mesh.", meta: "3 hops" },
  ];
  const PRIVATE_REPLIES = ["Copy. Only we can read this.", "All good here. See you soon.", "Loud and clear on the private channel."];

  const MISSIONS = [
    { id: "sent", label: "Send a message on LongFast", tip: "Open LongFast, then tap a preset phrase to send it. Watch the On the air panel to see who can read it." },
    { id: "started", label: "Start a private channel", tip: "Go back to your channels and tap New private channel." },
    { id: "named", label: "Name the channel", tip: "Pick a name. Everyone on the channel needs the same name and the same key." },
    { id: "keyed", label: "Generate a random key", tip: "Tap Generate key. This creates a random 256-bit key, the recommended choice for private use." },
    { id: "saved", label: "Save the channel", tip: "Tap Save channel to store the name and key on your radio." },
    { id: "shared", label: "Share the key with a friend", tip: "Real apps can share a channel as a QR code or link. Only share it with people you trust, then tap Friend scans code." },
    { id: "secret", label: "Send a private message", tip: "Open your new channel and send a phrase. Then compare what your friend and a stranger each receive." },
  ];

  let state;

  function fresh() {
    return {
      view: "list",
      active: null,
      draft: { name: null, key: null },
      done: new Set(),
      busy: false,
      friendJoined: false,
      replyIndex: 0,
      channels: [{
        id: "public",
        name: "LongFast",
        secure: false,
        key: null,
        messages: [
          { from: "Trail Mule", text: "Morning, mesh. Anyone awake?", meta: "1 hop" },
          { from: "Ridge Repeater", text: "Repeater's up. Battery's good.", meta: "2 hops" },
        ],
      }],
    };
  }

  /* Small helper for building elements. Text always goes in as text, never as HTML. */
  function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === "class") el.className = value;
      else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
      else if (key === "k") el.dataset.k = value;
      else if (value !== false && value != null) el.setAttribute(key, value === true ? "" : value);
    }
    el.append(...children.filter((child) => child !== null && child !== false && child !== undefined));
    return el;
  }

  const currentMission = () => MISSIONS.find((m) => !state.done.has(m.id));
  const nextIs = (id) => (currentMission() && currentMission().id === id ? " next" : "");
  const channel = () => state.channels.find((c) => c.id === state.active);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, calm ? Math.min(ms, 80) : ms));

  function complete(id) {
    state.done.add(id);
  }

  /* ----- Real encryption, using the browser's built-in crypto. Like Meshtastic
     channels, this uses AES in CTR mode. Falls back to random bytes if the page
     isn't on a secure connection, since that's the only time crypto is missing. ----- */
  const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

  function randomBytes(count) {
    return crypto.getRandomValues(new Uint8Array(count));
  }

  async function encrypt(text, keyBytes) {
    try {
      const key = await crypto.subtle.importKey("raw", keyBytes, "AES-CTR", false, ["encrypt"]);
      const data = new TextEncoder().encode(text);
      const cipher = await crypto.subtle.encrypt({ name: "AES-CTR", counter: randomBytes(16), length: 64 }, key, data);
      return toHex(new Uint8Array(cipher));
    } catch (e) {
      return toHex(randomBytes(text.length));
    }
  }

  /* ----- Sending a message ----- */
  async function send(text) {
    const room = channel();
    if (state.busy || !room) return;
    state.busy = true;
    const message = { mine: true, text, status: "Sending to radio..." };
    room.messages.push(message);
    render();

    await wait(450);
    message.status = "Radio transmitting...";
    render();

    await wait(500);
    const cipher = room.secure ? await encrypt(text, room.key) : null;
    addAirEntry(text, room, cipher);
    message.status = "Relaying through the mesh...";
    render();

    await wait(800);
    message.status = "Acknowledged";
    state.busy = false;
    complete(room.secure ? "secret" : "sent");
    render();

    await wait(900);
    if (room.secure) {
      const reply = PRIVATE_REPLIES[state.replyIndex++ % PRIVATE_REPLIES.length];
      room.messages.push({ from: "Friend", text: reply, meta: "1 hop" });
    } else {
      const reply = PUBLIC_REPLIES[state.replyIndex++ % PUBLIC_REPLIES.length];
      room.messages.push(reply);
    }
    render();
  }

  function addAirEntry(text, room, cipher) {
    airLog.querySelector(".air-empty")?.remove();
    // Packets carry a short channel hash rather than the channel's name
    const hash = [...room.name].reduce((sum, letter) => sum ^ letter.charCodeAt(0), room.secure ? room.key[0] : 8);
    const header = `FROM !a7f3c21d // TO ALL // CHANNEL HASH 0x${hash.toString(16).padStart(2, "0")} // HOP LIMIT 3`;
    const entry = h("li", { class: `air-entry ${room.secure ? "is-secure" : "is-open"}` },
      h("p", { class: "air-header" }, header),
      room.secure
        ? h("div", {},
            h("p", { class: "air-row good" }, h("b", {}, "Friend with the key reads: "), text),
            h("p", { class: "air-row bad" }, h("b", {}, "Stranger without the key sees: "), cipher),
            h("p", { class: "air-why" }, "That scrambled text is your message, encrypted right here in your browser with AES-256. The header stays readable so radios can relay what they can't read."))
        : h("div", {},
            h("p", { class: "air-row bad" }, h("b", {}, "Any radio on the default channel reads: "), text),
            h("p", { class: "air-why" }, "LongFast is encrypted with a key published in the source code, so it's effectively public. Treat it like talking in a crowded room.")));
    airLog.prepend(entry);
    while (airLog.children.length > 4) airLog.lastChild.remove();
  }

  /* ----- Phone screens ----- */
  function statusBar() {
    return h("div", { class: "ph-status", "aria-hidden": "true" },
      h("span", {}, "BT: RADIO LINKED"),
      h("span", {}, "NODES: 14"));
  }

  function appBar(title, back, subtitle) {
    return h("div", { class: "ph-bar" },
      back && h("button", { class: "ph-back", type: "button", k: "back", onclick: back, "aria-label": "Back" }, "<"),
      h("div", {},
        h("p", { class: "ph-title" }, title),
        subtitle && h("p", { class: "ph-sub" }, subtitle)));
  }

  function listView() {
    const openChannel = (id) => () => {
      state.active = id;
      state.view = "chat";
      render(true);
    };
    const items = state.channels.map((c) => {
      const last = c.messages[c.messages.length - 1];
      const highlight = (c.id === "public" && nextIs("sent")) || (c.secure && nextIs("secret")) || "";
      return h("button", { class: `ph-channel${highlight}`, type: "button", k: `open-${c.id}`, onclick: openChannel(c.id) },
        h("span", { class: `ph-tag ${c.secure ? "lock" : "open"}` }, c.secure ? "PRIVATE" : "PUBLIC"),
        h("span", { class: "ph-name" }, c.name),
        h("span", { class: "ph-preview" }, last ? last.text : "No messages yet"));
    });
    const canAdd = !state.channels.some((c) => c.secure);
    return h("div", { class: "ph-view" }, statusBar(), appBar("Channels"),
      h("div", { class: "ph-body" }, ...items,
        canAdd && h("button", {
          class: `ph-action${nextIs("started")}`, type: "button", k: "new",
          onclick: () => { complete("started"); state.view = "name"; render(true); },
        }, "+ New private channel")));
  }

  function chatView() {
    const room = channel();
    const phrases = room.secure ? PRIVATE_PHRASES : PUBLIC_PHRASES;
    const list = h("div", { class: "ph-messages", id: "ph-messages" },
      ...room.messages.map((m) => h("div", { class: `ph-msg ${m.mine ? "mine" : ""}` },
        !m.mine && h("p", { class: "ph-from" }, m.from),
        h("p", {}, m.text),
        h("p", { class: "ph-meta" }, m.mine ? m.status : m.meta))));
    return h("div", { class: "ph-view" }, statusBar(),
      appBar(room.name, () => { state.view = "list"; render(true); }, room.secure ? "Private: key holders only" : "Public: anyone can read"),
      list,
      h("div", { class: "ph-phrases" },
        h("p", { class: "ph-hint" }, "Tap a phrase to send"),
        ...phrases.map((phrase, i) => h("button", {
          class: `ph-phrase${i === 0 ? nextIs(room.secure ? "secret" : "sent") : ""}`,
          type: "button", k: `say-${i}`, disabled: state.busy,
          onclick: () => send(phrase),
        }, phrase))));
  }

  function nameView() {
    return h("div", { class: "ph-view" }, statusBar(),
      appBar("New channel", () => { state.view = "list"; render(true); }, "Step 1 of 3: name"),
      h("div", { class: "ph-body" },
        h("p", { class: "ph-copy" }, "Choose a channel name. Everyone who joins needs the same name and key."),
        ...CHANNEL_NAMES.map((name, i) => h("button", {
          class: `ph-action alt${i === 0 ? nextIs("named") : ""}`, type: "button", k: `name-${i}`,
          onclick: () => { state.draft.name = name; complete("named"); state.view = "key"; render(true); },
        }, name))));
  }

  function keyView() {
    const { draft } = state;
    const base64 = draft.key ? btoa(String.fromCharCode(...draft.key)) : null;
    return h("div", { class: "ph-view" }, statusBar(),
      appBar(draft.name, () => { state.view = "name"; render(true); }, "Step 2 of 3: key"),
      h("div", { class: "ph-body" },
        h("p", { class: "ph-copy" }, "The key is what makes the channel private. Radios without it can relay your messages, but can't read them."),
        h("p", { class: `ph-key ${base64 ? "" : "empty"}` }, base64 || "NO KEY SET"),
        base64 && h("p", { class: "ph-copy small" }, "256 bits. This key is unique to you, and is only used in this demo."),
        h("button", {
          class: `ph-action${base64 ? " alt" : nextIs("keyed")}`, type: "button", k: "generate",
          onclick: () => { draft.key = randomBytes(32); complete("keyed"); render(true); },
        }, base64 ? "Generate a different key" : "Generate key"),
        base64 && h("button", {
          class: `ph-action${nextIs("saved")}`, type: "button", k: "save",
          onclick: () => {
            state.channels.push({ id: "private", name: draft.name, secure: true, key: draft.key, messages: [] });
            complete("saved");
            state.view = "share";
            render(true);
          },
        }, "Save channel")));
  }

  function shareView() {
    return h("div", { class: "ph-view" }, statusBar(),
      appBar("Share channel", null, "Step 3 of 3: share"),
      h("div", { class: "ph-body" },
        h("p", { class: "ph-copy" }, state.friendJoined
          ? "Your friend's radio now has the key. You're on a private channel together."
          : "Your friend scans this with their app to get the name and key. Anyone holding this code can read the channel."),
        codePattern(state.draft.key),
        h("p", { class: "ph-copy small" }, "Demo pattern. Real apps make a working QR code."),
        state.friendJoined
          ? h("button", {
              class: `ph-action${nextIs("secret")}`, type: "button", k: "open-private",
              onclick: () => { state.active = "private"; state.view = "chat"; render(true); },
            }, `Open ${state.draft.name}`)
          : h("button", {
              class: `ph-action${nextIs("shared")}`, type: "button", k: "scan",
              onclick: () => { state.friendJoined = true; complete("shared"); render(true); },
            }, "Friend scans code")));
  }

  /* Draws a QR-like pattern from the key. It looks the part, but isn't scannable. */
  function codePattern(key) {
    const cells = 25;
    const canvas = h("canvas", { class: "ph-code", width: cells * 6, height: cells * 6, role: "img", "aria-label": "Decorative code pattern representing the shared channel key." });
    const c = canvas.getContext("2d");
    c.fillStyle = "#eaffe2";
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.fillStyle = "#000";
    const inFinder = (x, y) => (x < 8 && y < 8) || (x > 16 && y < 8) || (x < 8 && y > 16);
    for (let y = 1; y < cells - 1; y++) {
      for (let x = 1; x < cells - 1; x++) {
        const bit = (key[(x * 7 + y * 13) % key.length] >> ((x + y) % 8)) & 1;
        if (bit && !inFinder(x, y)) c.fillRect(x * 6, y * 6, 6, 6);
      }
    }
    for (const [x, y] of [[1, 1], [17, 1], [1, 17]]) {
      c.fillRect(x * 6, y * 6, 42, 42);
      c.fillStyle = "#eaffe2";
      c.fillRect((x + 1) * 6, (y + 1) * 6, 30, 30);
      c.fillStyle = "#000";
      c.fillRect((x + 2) * 6, (y + 2) * 6, 18, 18);
    }
    return canvas;
  }

  const VIEWS = { list: listView, chat: chatView, name: nameView, key: keyView, share: shareView };

  /* ----- Redraw the phone and the mission list -----
     moveFocus: after a tap that changes screens, focus the next suggested button,
     so keyboard and screen-reader users aren't dropped back at the top of the page. */
  function render(moveFocus) {
    const activeKey = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.k;
    const hadFocus = screen.contains(document.activeElement);

    screen.replaceChildren(VIEWS[state.view]());
    const messages = $("#ph-messages");
    if (messages) messages.scrollTop = messages.scrollHeight;

    if (moveFocus && hadFocus) {
      const target = screen.querySelector(".next") || screen.querySelector("button:not(:disabled)");
      if (target) target.focus({ preventScroll: true });
    } else if (hadFocus && activeKey) {
      const same = screen.querySelector(`[data-k="${activeKey}"]`);
      if (same) same.focus({ preventScroll: true });
    }

    const current = currentMission();
    missionList.replaceChildren(...MISSIONS.map((m) => h("li", {
      class: state.done.has(m.id) ? "done" : m === current ? "now" : "",
    }, m.label)));

    const text = current
      ? current.tip
      : "Mission complete. You've made a private channel, shared the key, and seen why the key matters. Real apps have a few more menus, but these are the same basic steps.";
    if (coach.textContent !== text) coach.textContent = text;
    coach.classList.toggle("finished", !current);
  }

  $("#phone-reset").addEventListener("click", () => {
    state = fresh();
    airLog.replaceChildren(h("li", { class: "air-empty" }, "No packets yet. Send a message to see what goes out over the air."));
    render();
  });

  state = fresh();
  render();
})();
