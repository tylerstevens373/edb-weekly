/* EDB dynasty model. Shared by the site (window.EDBModel) and offline checks (module.exports).
   Input: dyn = { season: 2026, players: [{id,n,t,pos,own,ros,age,gp,'FG%','3PTM','FT%',PTS,REB,AST,ST,BLK,TO}],
                  picks: [{year,round,owner,orig}], draft: {year, picks:[{pick,round,team,id,n,t}]} },
          teams: [{id,name}], pedigree: {"2026": {name: slot}, ...}
   All player inputs are Fantrax per-game projections for the current season. */
(function (root) {
  "use strict";
  const COUNT = ["3PTM", "PTS", "REB", "AST", "ST", "BLK", "TO"];
  const POOL = 156;          // 12 teams x 13 rotation players
  const REPL_RANK = 130;     // replacement level: about the 130th-best rostered player
  const LINEUP = 10;         // starting slots counted for team strength
  const HORIZON = 5;         // seasons projected after this one
  const TITLE_YEAR = 4;      // the Bruno Caboclo season: 2 years away from being 2 years away

  // yearly change in 9-cat value (z units) at a given age; young growth is scaled by a talent factor
  const GROW = { 18: 1.6, 19: 1.5, 20: 1.3, 21: 1.1, 22: 0.9, 23: 0.6, 24: 0.4, 25: 0.25, 26: 0.1 };
  // yearly decline applied to value above replacement once a player passes 28
  const DECLINE = { 29: 0.03, 30: 0.06, 31: 0.09, 32: 0.12, 33: 0.16, 34: 0.2, 35: 0.25, 36: 0.3, 37: 0.4, 38: 0.5, 39: 0.6 };

  function mean(a) { return a.reduce((s, x) => s + x, 0) / (a.length || 1); }
  function sd(a) { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) * (x - m)))) || 1; }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function slotTalent(slot) { // real NBA draft slot -> growth multiplier
    if (slot <= 1) return 1.55; if (slot <= 3) return 1.45; if (slot <= 6) return 1.3; if (slot <= 10) return 1.15;
    if (slot <= 14) return 1.0; if (slot <= 20) return 0.9; if (slot <= 30) return 0.8; return 0.65;
  }
  function fantasySlotTalent(pick, teams) { // league rookie-draft slot -> growth multiplier for an unknown future rookie
    const r = Math.ceil(pick / teams), k = pick - (r - 1) * teams;
    if (r === 1) return k === 1 ? 1.5 : k <= 3 ? 1.4 : k <= 6 ? 1.2 : 1.0;
    return r === 2 ? 0.75 : 0.55;
  }

  function nineCat(players) {
    const pool = players.slice().sort((a, b) => rawScore(b) - rawScore(a)).slice(0, POOL);
    const m = {}, s = {};
    COUNT.forEach((c) => { const v = pool.map((p) => p[c] || 0); m[c] = mean(v); s[c] = sd(v); });
    const pts = pool.reduce((t, p) => t + (p.PTS || 0), 0) || 1;
    const fg = pool.reduce((t, p) => t + (p["FG%"] || 0) * (p.PTS || 0), 0) / pts;
    const ft = pool.reduce((t, p) => t + (p["FT%"] || 0) * (p.PTS || 0), 0) / pts;
    const sfg = sd(pool.map((p) => ((p["FG%"] || fg) - fg) * (p.PTS || 0)));
    const sft = sd(pool.map((p) => ((p["FT%"] || ft) - ft) * (p.PTS || 0)));
    const z = (p) => {
      let v = 0;
      COUNT.forEach((c) => { v += ((p[c] || 0) - m[c]) / s[c] * (c === "TO" ? -1 : 1); });
      v += ((p["FG%"] || fg) - fg) * (p.PTS || 0) / sfg;
      v += ((p["FT%"] || ft) - ft) * (p.PTS || 0) / sft;
      return v;
    };
    return z;
    function rawScore(p) { return (p.PTS || 0) + (p.REB || 0) + (p.AST || 0) + 2 * ((p.ST || 0) + (p.BLK || 0)); }
  }

  function project(dyn, teams, pedigree) {
    const players = dyn.players.filter((p) => p.own);
    const z = nineCat(players);
    players.forEach((p) => { p.z0 = z(p); });
    const sorted = players.map((p) => p.z0).sort((a, b) => b - a);
    const repl = sorted[Math.min(REPL_RANK, sorted.length - 1)];
    const top = sorted[9];
    const slotOf = {};
    Object.entries(pedigree || {}).forEach(([yr, m]) => { if (yr[0] !== "_") Object.entries(m).forEach(([n, s]) => (slotOf[n] = { slot: s, year: +yr })); });

    function path(z0, age, talent, raw) { // value above replacement for t = 0..HORIZON (raw: unclipped z instead)
      const out = []; let zt = z0, decay = 1;
      for (let t = 0; t <= HORIZON; t++) {
        const a = age + t;
        let v = Math.max(0, zt - repl) * decay;
        if (a >= 40) v = 0; else if (a >= 38) v *= 0.5;
        out.push(raw ? zt : v);
        const g = GROW[a];
        if (g) zt += g * talent; else if (a <= 17) zt += 1.6 * talent;
        if (DECLINE[a + 1]) decay *= 1 - DECLINE[a + 1];
        else if (a + 1 >= 40) decay = 0;
      }
      return out;
    }

    players.forEach((p) => {
      const ped = slotOf[p.n];
      const fz = clamp(0.6 + 0.08 * (p.z0 - repl), 0.5, 1.4);
      p.ped = ped ? ped.slot : null;
      p.talent = ped ? Math.max(fz, slotTalent(ped.slot)) : fz;
      // a rookie's projection mostly reflects his early role, so lean on where the NBA drafted him
      let zStart = p.z0;
      if (ped) {
        const prior = -1.5 - 0.12 * Math.min(ped.slot, 40);
        const w = ped.year >= dyn.season ? 0.5 : ped.year === dyn.season - 1 ? 0.25 : 0;
        zStart = (1 - w) * p.z0 + w * prior;
      }
      p.zStart = zStart;
      p.var = path(zStart, p.age || 27, p.talent);
      p.zpath = path(zStart, p.age || 27, p.talent, true);
      p.dynasty = mean(p.var.slice(1)); // average value over the next five seasons
    });

    // expected rookie from a future league pick, valued from the season after it is used
    const teamIds = teams.map((t) => t.id);
    const nowStrength = {};
    teamIds.forEach((id) => { nowStrength[id] = players.filter((p) => p.own === id).map((p) => p.var[0]).sort((a, b) => b - a).slice(0, LINEUP).reduce((s, x) => s + x, 0); });
    const worstFirst = teamIds.slice().sort((a, b) => nowStrength[a] - nowStrength[b]);
    const nT = teamIds.length || 12;
    const picks = (dyn.picks || []).map((pk) => {
      const slotInRound = Math.max(1, worstFirst.indexOf(pk.orig) + 1);
      const overall = (pk.round - 1) * nT + slotInRound;
      const lead = Math.max(1, pk.year - dyn.season); // seasons until the pick's rookie first plays
      const rookie = path(-4.5, 19, fantasySlotTalent(overall, nT)).map((v) => v * 0.85);
      const v = []; for (let t = 0; t <= HORIZON; t++) v.push(t < lead ? 0 : rookie[t - lead]);
      return Object.assign({}, pk, { slot: overall, var: v, dynasty: mean(v.slice(1)) });
    });

    const teamsOut = teamIds.map((id) => {
      const roster = players.filter((p) => p.own === id);
      const assets = roster.map((p) => ({ kind: "player", p })).concat(picks.filter((k) => k.owner === id).map((k) => ({ kind: "pick", k })));
      const strength = [];
      for (let t = 0; t <= HORIZON; t++) {
        const vals = assets.map((a) => (a.kind === "player" ? a.p.var[t] : a.k.var[t])).sort((a, b) => b - a).slice(0, LINEUP);
        strength.push(vals.reduce((s, x) => s + x, 0));
      }
      const core = roster.slice().sort((a, b) => b.var[TITLE_YEAR] - a.var[TITLE_YEAR]).slice(0, 3);
      const peak = strength.indexOf(Math.max.apply(null, strength));
      const ages = roster.slice().sort((a, b) => b.var[0] - a.var[0]).slice(0, LINEUP).map((p) => p.age);
      return { id, strength, title: strength[TITLE_YEAR], peak, core, picks: picks.filter((k) => k.owner === id), avgAge: mean(ages) };
    });
    teamsOut.sort((a, b) => b.title - a.title);
    teamsOut.forEach((t, i) => (t.rank = i + 1));
    const nowOrder = teamIds.slice().sort((a, b) => nowStrength[b] - nowStrength[a]);
    teamsOut.forEach((t) => (t.nowRank = nowOrder.indexOf(t.id) + 1));
    return { players, picks, teams: teamsOut, repl, top, season: dyn.season, horizon: HORIZON, titleYear: TITLE_YEAR };
  }

  function gradeDraft(model, draft, teams) {
    if (!draft || !draft.picks || !draft.picks.length) return null;
    const byId = {}; model.players.forEach((p) => (byId[p.id] = p));
    const rows = draft.picks.map((d) => {
      const p = byId[d.id];
      const raw = p ? p.zpath.slice(1).reduce((s, x) => s + x, 0) / HORIZON : null;
      return Object.assign({}, d, { age: p ? p.age : null, ped: p ? p.ped : null, raw, y4: p ? p.var[TITLE_YEAR] : 0, owner: p ? p.own : null, dropped: !p });
    });
    // prospect score: the class's five-year projected value on a 0-100 scale (100 = best in class)
    const raws = rows.filter((r) => r.raw != null).map((r) => r.raw);
    const hi = Math.max.apply(null, raws), lo = Math.min.apply(null, raws);
    rows.forEach((r) => { r.value = r.raw == null ? 0 : Math.max(3, Math.round(100 * (r.raw - lo) / ((hi - lo) || 1))); });
    const ranked = rows.slice().sort((a, b) => b.value - a.value || a.pick - b.pick);
    ranked.forEach((r, i) => (r.rank = i + 1));
    const expected = ranked.map((r) => r.value); // value of the k-th best rookie = what pick k should return
    rows.forEach((r) => { r.expect = expected[r.pick - 1]; r.diff = r.pick - r.rank; });
    const byTeam = {};
    rows.forEach((r) => { (byTeam[r.team] = byTeam[r.team] || []).push(r); });
    const grades = teams.map((t) => {
      const mine = byTeam[t.id] || [];
      if (!mine.length) return { id: t.id, picks: [], grade: null };
      const got = mine.reduce((s, r) => s + r.value, 0), exp = mine.reduce((s, r) => s + r.expect, 0);
      const surplus = got - exp; // prospect points gained versus what those draft slots usually return
      const best = mine.slice().sort((a, b) => (b.value - b.expect) - (a.value - a.expect))[0];
      return { id: t.id, picks: mine, got, exp, surplus, total: got, grade: letter(surplus), best };
    }).sort((a, b) => (b.grade ? b.surplus : -1e9) - (a.grade ? a.surplus : -1e9) || (b.total || 0) - (a.total || 0));
    return { year: draft.year, rows: ranked, grades };
  }
  function letter(x) {
    if (x >= 30) return "A+"; if (x >= 18) return "A"; if (x >= 8) return "A-"; if (x >= -2) return "B+";
    if (x >= -10) return "B"; if (x >= -18) return "B-"; if (x >= -28) return "C+"; if (x >= -40) return "C"; if (x >= -55) return "C-"; return "D";
  }

  const api = { project, gradeDraft, HORIZON, TITLE_YEAR, LINEUP };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.EDBModel = api;
})(typeof window !== "undefined" ? window : this);
