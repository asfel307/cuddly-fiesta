// Token Radar's dashboard. It reads window.TOKEN_RADAR (written beside the
// page by main.ts) and renders the ranked board, a filterable table, a
// per-protocol detail drawer with the model's own inputs and the protocol's
// farm plan, and the live-token comparison set. No network: every byte it
// shows is in data.js.
//
// The page recomputes each row's implied value from the snapshot figures and
// the model's calibration, and says whether the recomputed number matches
// the one board.json carries, so the page's code and the board's data are
// visibly the same arithmetic.
(function () {
  "use strict";

  const DATA = window.TOKEN_RADAR;
  if (!DATA) return;
  const mount = document.getElementById("radar-app");
  const state = { q: "", category: "all", tab: "pre-token", sort: "implied", dir: -1, selected: null };

  const money = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return "n/a";
    if (Math.abs(n) >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (Math.abs(n) >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
    if (Math.abs(n) >= 1e3) return "$" + Math.round(n / 1e3) + "K";
    return money.format(n);
  }

  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return "n/a";
    return (n > 0 ? "+" : "") + n.toFixed(2) + "%";
  }

  function fmtAge(days) {
    if (days === null || days === undefined) return "unknown";
    if (days >= 365) return (days / 365).toFixed(1) + "y";
    return Math.max(0, Math.round(days)) + "d";
  }

  function clampNum(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  // Whole days from a protocol's listing date to the snapshot date; null
  // when the listing date is missing.
  function ageDaysOf(row) {
    if (!row.listed_at) return null;
    const start = Date.parse(row.listed_at + "T00:00:00Z");
    const end = Date.parse(DATA.as_of + "T00:00:00Z");
    if (!isFinite(start) || !isFinite(end)) return null;
    return Math.max(0, Math.floor((end - start) / 86400000));
  }

  // The multiple a row's category earned: its own calibrated median, or the
  // global median when the category had too few live-token protocols.
  const multipleByCategory = new Map(
    (DATA.categories || []).map((c) => [c.category, c.multiple]),
  );
  function multipleFor(row) {
    const own = row.category ? multipleByCategory.get(row.category) : undefined;
    const raw = own !== undefined ? own : DATA.global_multiple;
    return clampNum(raw, 0.02, 2.0);
  }

  function growthMultiplierOf(row) {
    const change = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    return 1 + (clampNum(change, -60, 120) / 100) * 0.5;
  }

  function maturityMultiplierOf(row) {
    const days = ageDaysOf(row);
    const age = days === null ? 365 : days;
    return 0.6 + (Math.min(Math.max(age, 0), 1095) / 1095) * 0.4;
  }

  // Recompute a row's implied value from its own figures. The dashboard
  // shows this beside the board's number so a reader can see they agree.
  function impliedFor(row) {
    const value =
      row.tvl_usd * multipleFor(row) * growthMultiplierOf(row) * maturityMultiplierOf(row);
    if (!isFinite(value) || value <= 0) return 1;
    return Math.max(1, Math.round(value));
  }

  function h(tag, attrs, ...kids) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const key of Object.keys(attrs)) {
        const value = attrs[key];
        if (key === "class") node.className = value;
        else if (key === "text") node.textContent = value;
        else if (key === "html") node.innerHTML = value;
        else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
        else if (value !== null && value !== undefined) node.setAttribute(key, value);
      }
    }
    for (const kid of kids) {
      if (kid === null || kid === undefined) continue;
      if (Array.isArray(kid)) kid.forEach((c) => { if (c) node.appendChild(c); });
      else if (typeof kid === "string") node.appendChild(document.createTextNode(kid));
      else node.appendChild(kid);
    }
    return node;
  }

  function readHash() {
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return;
    const params = new URLSearchParams(hash);
    if (params.get("q")) state.q = params.get("q");
    if (params.get("p")) state.selected = params.get("p");
    if (params.get("category")) state.category = params.get("category");
  }

  function writeHash() {
    const params = new URLSearchParams();
    if (state.q) params.set("q", state.q);
    if (state.category !== "all") params.set("category", state.category);
    if (state.selected) params.set("p", state.selected);
    const next = params.toString();
    if (next) window.history.replaceState(null, "", "#" + next);
    else window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }

  function visibleRows() {
    const q = state.q.trim().toLowerCase();
    return DATA.rows.filter((r) => {
      if (state.category !== "all" && r.category !== state.category) return false;
      if (!q) return true;
      const hay = [r.name, r.slug, r.category, (r.chains || []).join(" ")]
        .join(" ")
        .toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function orderedRows(list) {
    const key = state.sort;
    return list.slice().sort((a, b) => {
      let av;
      let bv;
      if (key === "name") { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === "tvl") { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === "growth") {
        av = a.change_7d === null ? -Infinity : a.change_7d;
        bv = b.change_7d === null ? -Infinity : b.change_7d;
      } else if (key === "age") {
        av = ageDaysOf(a) === null ? Infinity : ageDaysOf(a);
        bv = ageDaysOf(b) === null ? Infinity : ageDaysOf(b);
      } else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function masthead() {
    return h("header", { class: "masthead" },
      h("div", { class: "logo" },
        h("span", { class: "dot" }),
        h("span", { class: "wordmark", text: "Token Radar" })),
      h("div", { class: "meta" },
        h("span", { text: "Snapshot " + DATA.as_of }),
        h("span", { text: "DefiLlama protocol index" }),
        h("span", { text: DATA.model_version + " model" })));
  }

  function intro() {
    return h("section", { class: "intro" },
      h("div", null,
        h("h1", { text: DATA.watchlist_size + " watchlist protocols, ranked by implied value" }),
        h("p", { text: "The watchlist is the floor: every protocol with at least $" + Math.round(DATA.floor_usd / 1e6) + "M of TVL and no token on record. The full radar adds " + (DATA.board_size - DATA.watchlist_size) + " more pre-token protocols the watchlist does not name, ranked by the same model. Implied value is a model, not a promise." })),
      h("div", { class: "stats" },
        h("div", { class: "stat" }, h("span", { text: "Watchlist covered" }), h("b", { text: DATA.watchlist_size + " / " + DATA.watchlist_size })),
        h("div", { class: "stat" }, h("span", { text: "Pre-token rows scored" }), h("b", { text: String(DATA.board_size) })),
        h("div", { class: "stat" }, h("span", { text: "Extra rows beyond the watchlist" }), h("b", { text: String(DATA.board_size - DATA.watchlist_size) })),
        h("div", { class: "stat" }, h("span", { text: "Live-token protocols set aside" }), h("b", { text: String(DATA.live_size) }))));
  }

  function toolbar() {
    const categories = Array.from(
      new Set(DATA.rows.map((r) => r.category || "Other")),
    ).sort();
    const search = h("input", {
      type: "search",
      id: "q",
      placeholder: "Search name, category or chain",
      value: state.q,
      "aria-label": "Search the board",
    });
    search.addEventListener("input", () => { state.q = search.value; writeHash(); render(); });
    const select = h("select", { id: "category", "aria-label": "Filter by category" },
      h("option", { value: "all", text: "All categories" }),
      categories.map((c) =>
        h("option", { value: c, text: c, selected: c === state.category ? "selected" : null })),
    );
    select.addEventListener("change", () => { state.category = select.value; writeHash(); render(); });
    const preBtn = h("button", {
      type: "button",
      "aria-pressed": state.tab === "pre-token" ? "true" : "false",
      text: "Pre-token",
      onclick: () => { state.tab = "pre-token"; render(); },
    });
    const liveBtn = h("button", {
      type: "button",
      "aria-pressed": state.tab === "live" ? "true" : "false",
      text: "Live token",
      onclick: () => { state.tab = "live"; render(); },
    });
    return h("div", { class: "toolbar" },
      h("div", { class: "control" }, h("label", { for: "q", text: "Search" }), search),
      h("div", { class: "control" }, h("label", { for: "category", text: "Category" }), select),
      h("div", { class: "control" },
        h("span", { class: "fine", text: "Token status" }),
        h("div", { class: "switch" }, preBtn, liveBtn)),
      h("span", { class: "showing", text: state.tab === "pre-token" ? visibleRows().length + " rows shown" : DATA.live.length + " live-token protocols" }));
  }

  function sortHead(key, label) {
    return h("th", { scope: "col" },
      h("button", {
        type: "button",
        onclick: () => {
          if (state.sort === key) state.dir = -state.dir;
          else { state.sort = key; state.dir = -1; }
          render();
        },
      },
      label,
      state.sort === key ? h("span", { "aria-hidden": "true", text: state.dir < 0 ? " v" : " ^" }) : null));
  }

  function chainText(row) {
    if (!row.chains || row.chains.length === 0) return "an unnamed chain";
    return row.chains.slice(0, 2).join(", ");
  }

  function boardTable() {
    const list = orderedRows(visibleRows());
    if (list.length === 0) {
      return h("div", { class: "card" },
        h("div", { class: "no-match" },
          h("h2", { text: "No protocol matches that filter" }),
          h("p", { text: "Clear the search or pick another category to see the board again." }),
          h("button", {
            class: "btn solid",
            type: "button",
            text: "Clear filters",
            onclick: () => { state.q = ""; state.category = "all"; writeHash(); render(); },
          })));
    }
    const top = list[0].implied_value_usd || 1;
    const tbody = h("tbody");
    list.forEach((r) => {
      const growth = r.change_7d === null ? "n/a" : fmtPct(r.change_7d);
      const growthClass = r.change_7d === null ? "" : r.change_7d >= 0 ? "up" : "down";
      const tr = h("tr", {
        "data-active": state.selected === r.slug ? "true" : "false",
        tabindex: "0",
        onclick: () => openDetail(r.slug),
        onkeydown: (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(r.slug); }
        },
      },
      h("td", { class: "figures", text: String(r.rank) }),
      h("td", null, h("div", { class: "cell-name" },
        h("b", { text: r.name }),
        h("span", { class: "fine", text: (r.category || "Other") + " on " + chainText(r) }))),
      h("td", { class: "figures", text: fmtUsd(r.tvl_usd) }),
      h("td", { class: "figures " + growthClass, text: growth }),
      h("td", { class: "figures", text: fmtAge(ageDaysOf(r)) }),
      h("td", null, h("div", { class: "value-cell" },
        h("div", { class: "meter", "aria-hidden": "true" },
          h("i", { style: "width:" + Math.max(3, Math.round((r.implied_value_usd / top) * 100)) + "%" })),
        h("span", { class: "figures", text: fmtUsd(r.implied_value_usd) }))),
      h("td", null, h("span", { class: "badge", text: "no token" })));
      tbody.appendChild(tr);
    });
    return h("div", { class: "card" },
      h("div", { class: "scroller" },
        h("table", null,
          h("caption", { class: "fine", text: "Pre-token protocols, strongest implied value first. Select a row for its model and farm plan." }),
          h("thead", null, h("tr", null,
            sortHead("implied", "Rank"),
            sortHead("name", "Protocol"),
            sortHead("tvl", "TVL"),
            sortHead("growth", "7d"),
            sortHead("age", "Age"),
            sortHead("implied", "Implied value"),
            h("th", { scope: "col", text: "Token" }))),
          tbody)));
  }

  function liveTable() {
    const tbody = h("tbody");
    DATA.live.forEach((r) => {
      tbody.appendChild(h("tr", null,
        h("td", { class: "figures", text: "live" }),
        h("td", null, h("div", { class: "cell-name" },
          h("b", { text: r.name }),
          h("span", { class: "fine", text: (r.category || "Other") + " on " + chainText(r) }))),
        h("td", { class: "figures", text: fmtUsd(r.tvl_usd) }),
        h("td", { class: "figures " + (r.change_7d !== null && r.change_7d >= 0 ? "up" : "down"), text: fmtPct(r.change_7d) }),
        h("td", { class: "figures", text: fmtUsd(r.mcap_usd) }),
        h("td", null, h("span", { class: "badge", text: "already trades" }))));
    });
    return h("div", { class: "card" },
      h("div", { class: "scroller" },
        h("table", null,
          h("caption", { class: "fine", text: "Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking." }),
          h("thead", null, h("tr", null,
            h("th", { scope: "col", text: "Status" }),
            h("th", { scope: "col", text: "Protocol" }),
            h("th", { scope: "col", text: "TVL" }),
            h("th", { scope: "col", text: "7d" }),
            h("th", { scope: "col", text: "Market cap" }),
            h("th", { scope: "col", text: "Token" }))),
          tbody)));
  }

  function modelPanel() {
    return h("section", { class: "card model-box" },
      h("h2", { text: "How implied value is computed" }),
      h("p", { class: "fine", text: "Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked." }),
      h("div", { class: "equation" },
        "implied = round( tvl_usd x category_multiple x (1 + clamp(change_7d, -60, 120) / 100 x 0.5) x (0.6 + min(age_days, 1095) / 1095 x 0.4) )"),
      h("p", { class: "fine", text: "The category multiple is the median market-cap/TVL of the live-token protocols in that category, taken from this same snapshot; a category with fewer than 3 live protocols uses the global median of " + DATA.global_multiple.toFixed(4) + ". Every multiple is clamped to 0.02 to 2.0. TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses 365 days. The full radar ranks every rankable pre-token protocol, and the live-token protocols are set aside with their market caps shown." }));
  }

  const drawer = h("dialog", { class: "drawer", id: "detail", "aria-labelledby": "detail-title" });
  drawer.addEventListener("close", () => { state.selected = null; writeHash(); });

  function openDetail(slug) {
    const row = DATA.rows.filter((r) => r.slug === slug)[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    drawer.textContent = "";
    const recomputed = impliedFor(row);
    const agrees = recomputed === row.implied_value_usd;
    drawer.appendChild(h("div", { class: "drawer-top" },
      h("div", null,
        h("span", { class: "wordmark", text: "Rank " + row.rank + " of " + DATA.board_size }),
        h("h2", { id: "detail-title", text: row.name }),
        h("p", { class: "fine", text: (row.category || "Other") + " on " + (row.chains && row.chains.length ? row.chains.join(", ") : "an unnamed chain") })),
      h("button", { class: "dismiss", type: "button", "aria-label": "Close details", text: "Close", onclick: () => drawer.close() })));
    drawer.appendChild(h("section", { class: "drawer-block" },
      h("h3", { text: "Implied value" }),
      h("div", { class: "breakdown" },
        h("div", null, h("span", { text: "TVL" }), h("b", { class: "figures", text: fmtUsd(row.tvl_usd) })),
        h("div", null, h("span", { text: "Seven-day growth" }), h("b", { class: "figures", text: fmtPct(row.change_7d) })),
        h("div", null, h("span", { text: "Age with no token" }), h("b", { class: "figures", text: fmtAge(ageDaysOf(row)) })),
        h("div", null, h("span", { text: "Category multiple" }), h("b", { class: "figures", text: String(Math.round(multipleFor(row) * 1e4) / 1e4) })),
        h("div", null, h("span", { text: "Growth multiplier" }), h("b", { class: "figures", text: String(Math.round(growthMultiplierOf(row) * 1e4) / 1e4) })),
        h("div", null, h("span", { text: "Maturity multiplier" }), h("b", { class: "figures", text: String(Math.round(maturityMultiplierOf(row) * 1e4) / 1e4) })),
        h("div", null, h("span", { text: "Implied value" }), h("b", { class: "figures", text: fmtUsd(row.implied_value_usd) }))),
      h("p", { class: "fine", text: "Model " + DATA.model_version + ": the same function scores every protocol. The page recomputes this row as " + fmtUsd(recomputed) + (agrees ? ", the same number board.json carries." : ", which differs from the board: the data would be stale.") + " This is an estimate, not a price." })));
    drawer.appendChild(h("section", { class: "drawer-block" },
      h("h3", { text: "Farm plan" }),
      h("ol", { class: "plan" }, row.farm_steps.map((s) => {
        const at = s.indexOf(" Cost: ");
        const action = at >= 0 ? s.slice(0, at) : s;
        const tail = at >= 0 ? s.slice(at + 1) : "";
        return h("li", null, h("b", { text: action }), h("span", { class: "plan-cost", text: tail }));
      }))));
    if (typeof drawer.showModal === "function") {
      if (!drawer.open) drawer.showModal();
    } else {
      drawer.setAttribute("open", "");
    }
  }

  function render() {
    mount.textContent = "";
    const shell = h("div", { class: "wrap" });
    shell.appendChild(masthead());
    shell.appendChild(intro());
    shell.appendChild(toolbar());
    shell.appendChild(state.tab === "pre-token" ? boardTable() : liveTable());
    if (state.tab === "pre-token") shell.appendChild(modelPanel());
    mount.appendChild(shell);
    mount.setAttribute("aria-busy", "false");
    if (!drawer.isConnected) mount.appendChild(drawer);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drawer.open) drawer.close();
  });
})();
