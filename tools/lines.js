// Betting lines for the EDB recap site.
// Spread rule (from the league): start at 0 and, for each of the nine categories, move the line toward the team that is
// projected better in it: one whole category if the gap is more than half a standard deviation (of that category across
// all 12 teams' projected weeks), half a category if it is smaller. The line is the away team's expected category margin
// (positive = away favored). Projections are the same ones the site shows: a simulated season of daily lineups blended
// with season-to-date weekly averages (weight on the season average = min(weeks played / 6, 1)).
//
// Usage:
//   node tools/lines.js                      add lines for the upcoming week (data.currentPeriod) to lines.json if missing
//   node tools/lines.js --data <file> --week N [--force]   compute week N from a given data.json snapshot
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const M = require(path.join(ROOT, "model.js"));
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const dataFile = opt("--data") || path.join(ROOT, "data.json");
const data = JSON.parse(fs.readFileSync(dataFile, "utf8"));
const week = +(opt("--week") || data.currentPeriod);
const force = args.includes("--force");
const linesFile = path.join(ROOT, "lines.json");
const store = fs.existsSync(linesFile) ? JSON.parse(fs.readFileSync(linesFile, "utf8")) : { rule: "1 category per category edge over 0.5 SD, 0.5 otherwise", weeks: {} };

const CATS = data.cats, PCT = { "FG%": 1, "FT%": 1 }, LOW = { TO: 1 };
const real = (s) => s && s.id && !/^-?\d+$/.test(String(s.id)) && !/bye/i.test(String(s.name || ""));
function strengths(d) {
  const ids = d.teams.map((t) => t.id);
  const sim = d.dynasty ? M.simulateSeason(d.dynasty.players, d.teams) : {};
  const sum = {}, n = {};
  d.schedule.filter((s) => s.complete).forEach((s) => s.matchups.forEach((m) => [m.away, m.home].forEach((x) => {
    if (!real(x) || !x.cats) return; n[x.id] = (n[x.id] || 0) + 1; sum[x.id] = sum[x.id] || {};
    CATS.forEach((c) => { sum[x.id][c] = (sum[x.id][c] || 0) + (x.cats[c] || 0); });
  })));
  const out = {};
  ids.forEach((id) => {
    const w = Math.min((n[id] || 0) / 6, 1), p = sim[id]; out[id] = {};
    CATS.forEach((c) => {
      const s = n[id] ? sum[id][c] / n[id] : null;
      out[id][c] = s != null && p ? w * s + (1 - w) * p[c] : s != null ? s : p ? p[c] : null;
    });
  });
  return out;
}
function linesForWeek(d, wk) {
  const S = strengths(d);
  const sd = {};
  CATS.forEach((c) => { const xs = Object.values(S).map((s) => s[c]).filter((x) => x != null); const m = xs.reduce((a, b) => a + b, 0) / xs.length; sd[c] = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length); });
  const sched = d.schedule.find((s) => s.n === wk);
  if (!sched) throw new Error("week " + wk + " not in schedule");
  return sched.matchups.filter((m) => real(m.away) && real(m.home)).map((m) => {
    const a = S[m.away.id], h = S[m.home.id]; let line = 0; const cats = {};
    CATS.forEach((c) => {
      let diff = a[c] - h[c]; if (LOW[c]) diff = -diff;
      const step = Math.abs(diff) > 0.5 * sd[c] ? 1 : diff === 0 ? 0 : 0.5;
      cats[c] = Math.sign(diff) * step; line += cats[c];
    });
    return { away: m.away.id, home: m.home.id, line, cats };
  });
}
if (store.weeks[week] && !force) { console.log("week " + week + " already has lines; use --force to recompute"); process.exit(0); }
store.weeks[week] = { set: new Date().toISOString(), basis: path.basename(dataFile) === "data.json" ? data.generatedAt : opt("--data"), games: linesForWeek(data, week) };
fs.writeFileSync(linesFile, JSON.stringify(store, null, 1));
store.weeks[week].games.forEach((g) => {
  const T = {}; data.teams.forEach((t) => (T[t.id] = t.name));
  const fav = g.line > 0 ? T[g.away] : g.line < 0 ? T[g.home] : "Pick'em";
  console.log("Wk " + week + ": " + T[g.away] + " @ " + T[g.home] + "  ->  " + fav + (g.line ? " -" + Math.abs(g.line) : ""));
});
