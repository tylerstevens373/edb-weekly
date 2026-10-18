// EDB recap data collector. Run inside a logged-in fantrax.com tab.
// Returns a compact JSON-able object; stores it on window.__edb too.
(async () => {
  const OPTS = window.__edbOpts || {};
  const LEAGUE = OPTS.league || '1v9ir5x1mqqv88hj';
  const CATS = ['FG%', '3PTM', 'FT%', 'PTS', 'REB', 'AST', 'ST', 'BLK', 'TO'];
  const now = OPTS.now || Date.now();

  async function fx(lid, method, data) {
    const r = await fetch('/fxpa/req?leagueId=' + lid, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgs: [{ method, data: Object.assign({ leagueId: lid }, data || {}) }] })
    }).then(r => r.json());
    const resp = r.responses && r.responses[0];
    if (!resp || !resp.data) throw new Error(method + ': ' + JSON.stringify(r.pageError || r).slice(0, 200));
    return resp.data;
  }
  const fxea = (path) => fetch('/fxea/general/' + path).then(r => r.json());
  const num = (s) => { if (s == null || s === '' || s === '-') return null; const n = parseFloat(String(s).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? null : n; };
  const parseTs = (s) => Date.parse(s.replace(/\.0(?=[-+])/, '').replace(/([-+]\d\d)(\d\d)$/, '$1:$2'));

  // ---------- league + teams ----------
  const info = await fxea('getLeagueInfo?leagueId=' + LEAGUE);
  const settings = (await fx(LEAGUE, 'getFantasyLeagueInfo')).fantasySettings || {};
  // A week counts as finished from midnight (local time) on its closing day: Fantrax closes the period Monday evening,
  // but the last games are Sunday night, so a Monday-morning run can already recap it.
  const dayStart = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const periods = info.scoringPeriods.map(p => { const end = parseTs(p.endDate); return { n: p.number, start: parseTs(p.startDate), end, done: dayStart(end) }; });
  const lastRegular = info.playoffs ? info.playoffs.lastRegularSeasonPeriod : periods.length;
  const completed = periods.filter(p => p.done <= now).map(p => p.n);
  const lastCompleted = completed.length ? Math.max(...completed) : 0;
  const current = lastCompleted ? Math.min(lastCompleted + 1, periods.length) : 1;
  const phase = lastCompleted === 0 && now < periods[0].start ? 'preseason' : (lastCompleted >= periods.length ? 'complete' : 'inseason');

  const standingsRaw = await fx(LEAGUE, 'getStandings', { view: 'ALL' });
  const teamInfo = standingsRaw.fantasyTeamInfo || {};
  const teams = Object.values(info.teamInfo).map(t => ({
    id: t.id, name: t.name, division: t.division,
    short: (teamInfo[t.id] || {}).shortName || '', logo: (teamInfo[t.id] || {}).logoUrl512 || ''
  }));

  // ---------- standings ----------
  function parseStandings(raw) {
    return (raw.tableList || []).map(t => ({
      caption: t.caption,
      rows: (t.rows || []).map(r => {
        const c = r.cells.map(x => x.content);
        const team = r.fixedCells.find(f => f.teamId) || {};
        return { rank: num(r.fixedCells[0].content), id: team.teamId, name: team.content,
          w: num(c[0]), l: num(c[1]), t: num(c[2]), pct: c[3], div: c[4], gb: c[5], pf: num(c[7]), pa: num(c[8]), streak: c[9] };
      })
    }));
  }
  const standings = parseStandings(standingsRaw).filter(t => t.caption === 'Standings');

  // ---------- schedule / results ----------
  function parseSchedule(raw) {
    return (raw.tableList || []).map((t, i) => {
      const hdr = t.header.cells.map(c => c.shortName);
      const rows = t.rows || [];
      const out = [];
      for (let k = 0; k + 1 < rows.length; k += 2) {
        const side = (r) => {
          const f = r.fixedCells.find(x => x.teamId) || {};
          const vals = {}; hdr.forEach((h, j) => { vals[h] = r.cells[j] ? (r.cells[j].toolTip || r.cells[j].content) : null; });
          const cats = {}; CATS.forEach(cn => { cats[cn] = num(vals[cn]); });
          return { id: f.teamId, name: f.content, w: num(vals.W), l: num(vals.L), t: num(vals.T), cats };
        };
        out.push({ away: side(rows[k]), home: side(rows[k + 1]) });
      }
      return { n: i + 1, caption: t.caption, dates: t.subCaption, matchups: out };
    });
  }
  const schedRaw = await fx(LEAGUE, 'getStandings', { view: 'SCHEDULE' });
  const schedule = parseSchedule(schedRaw);
  schedule.forEach(s => { const p = periods.find(x => x.n === s.n); s.complete = !!p && p.done <= now; s.playoff = s.n > lastRegular; });

  // ---------- players ----------
  const seasonCode = (settings.season && settings.season.id) || '41n';
  async function playerTable(lid, code, extra) {
    const d = await fx(lid, 'getPlayerStats', Object.assign({ statusOrTeamFilter: 'ALL_TAKEN', pageNumber: '1', maxResultsPerPage: '500', seasonOrProjection: code, scoringCategoryType: '5' }, extra || {}));
    const hdr = d.tableHeader.cells.map(c => c.shortName);
    return d.statsTable.map(p => {
      const v = {}; hdr.forEach((h, j) => { v[h] = p.cells[j] ? p.cells[j].content : null; });
      const owner = p.cells[1] || {};
      const cats = {}; CATS.forEach(cn => { cats[cn] = num(v[cn]); });
      const inj = (p.scorer.icons || []).filter(i => /return|Out|Game-time|Day-to-Day|Indefinitely|Questionable|Doubtful|season/i.test(i.tooltip) && !/^[A-Z][a-z]{2} \d+, \d/.test(i.tooltip)).map(i => i.tooltip);
      return { id: p.scorer.scorerId, name: p.scorer.name, nba: p.scorer.teamShortName, pos: p.scorer.posShortNames,
        img: p.scorer.headshotUrl, owner: owner.teamId, ros: v.Ros, age: num(v.Age), score: num(v.Score), gp: num(v.GP), cats, inj };
    });
  }
  const rostered = await playerTable(LEAGUE, 'PROJECTION_0_' + seasonCode + '_SEASON', {});
  const players = {};
  if (lastCompleted > 0) {
    const lp = periods.find(p => p.n === lastCompleted);
    const etDate = (ts) => new Date(ts).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const wk = await playerTable(LEAGUE, 'SEASON_' + seasonCode + '_BY_DATE', { timeframeTypeCode: 'BY_DATE', startDate: etDate(lp.start), endDate: etDate(lp.end) });
    players.week = wk.filter(p => p.cats.PTS).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 40);
    const ytd = await playerTable(LEAGUE, 'SEASON_' + seasonCode + '_YEAR_TO_DATE', {});
    players.season = ytd.filter(p => p.cats.PTS).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 60);
  }
  // projected team strength (used for previews and preseason power rankings)
  const proj = {};
  // top 13 projected players per team (roughly the guys who actually play)
  const byTeam = {};
  rostered.filter(p => p.ros === 'Act' || p.ros === 'Res').forEach(p => { (byTeam[p.owner] = byTeam[p.owner] || []).push(p); });
  Object.values(byTeam).flatMap(arr => arr.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 13)).forEach(p => {
    const t = proj[p.owner] || (proj[p.owner] = { n: 0, PTS: 0, REB: 0, AST: 0, ST: 0, BLK: 0, '3PTM': 0, TO: 0, fgw: 0, ftw: 0 });
    t.n++; ['PTS', 'REB', 'AST', 'ST', 'BLK', '3PTM', 'TO'].forEach(k => t[k] += p.cats[k] || 0);
    if (p.cats['FG%'] != null) { t.fgw += p.cats['FG%'] * (p.cats.PTS || 0); }
    if (p.cats['FT%'] != null) { t.ftw += p.cats['FT%'] * (p.cats.PTS || 0); }
  });
  Object.values(proj).forEach(t => { t['FG%'] = t.PTS ? t.fgw / t.PTS : null; t['FT%'] = t.PTS ? t.ftw / t.PTS : null; delete t.fgw; delete t.ftw; });
  players.topProjected = rostered.filter(p => p.ros === 'Act' || p.ros === 'Res').sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 36)
    .map(p => ({ id: p.id, name: p.name, nba: p.nba, pos: p.pos, img: p.img, owner: p.owner, age: p.age, score: p.score }));

  // ---------- dynasty inputs: per-game projections for every rostered player, future picks, last rookie draft ----------
  const perGame = await playerTable(LEAGUE, 'PROJECTION_0_' + seasonCode + '_EVENT_PROJECTED_WEEKLY', { scoringCategoryType: '7' });
  const gpById = {}; rostered.forEach(p => { gpById[p.id] = p.gp; });
  const dynPlayers = perGame.filter(p => p.owner).map(p => Object.assign({ id: p.id, n: p.name, t: p.nba, pos: p.pos, own: p.owner, ros: p.ros, age: p.age, gp: gpById[p.id] || 0 }, p.cats));
  const nameById = {}; perGame.forEach(p => { nameById[p.id] = p; });
  const pickData = await fxea('getDraftPicks?leagueId=' + LEAGUE);
  const futurePicks = (pickData.futureDraftPicks || []).map(p => ({ year: p.year, round: p.round, owner: p.currentOwnerTeamId, orig: p.originalOwnerTeamId }));
  let rookieDraft = null;
  try {
    const dr = await fxea('getDraftResults?leagueId=' + LEAGUE);
    if (dr && dr.draftPicks && dr.draftPicks.length) {
      let ids = null;
      const missing = dr.draftPicks.some(p => !nameById[p.playerId]);
      if (missing) ids = await fxea('getPlayerIds?sport=NBA');
      const flip = (s) => s && s.indexOf(', ') > 0 ? s.split(', ').reverse().join(' ') : s;
      rookieDraft = { year: dr.draftDate ? parseInt(dr.draftDate, 10) : null, picks: dr.draftPicks.filter(p => p.playerId).map(p => {
        const known = nameById[p.playerId] || {}; const alt = ids && ids[p.playerId] || {};
        return { pick: p.pick, round: p.round, team: p.teamId, id: p.playerId, n: known.name || flip(alt.name) || p.playerId, t: known.nba || alt.team || '' };
      }) };
    }
  } catch (e) { rookieDraft = null; }
  const dynasty = { season: parseInt((settings.season && settings.season.displayYear) || '', 10) || new Date(now).getFullYear(), players: dynPlayers, picks: futurePicks, draft: rookieDraft };

  const injuries = rostered.filter(p => p.inj.length && p.ros !== 'Min').map(p => ({ name: p.name, nba: p.nba, owner: p.owner, ros: p.ros, img: p.img, note: p.inj[0] }));

  // ---------- transactions (last 10 days) ----------
  async function tx(view) {
    const d = await fx(LEAGUE, 'getTransactionDetailsHistory', { view, maxResultsPerPage: '100' });
    return (d.table && d.table.rows) || [];
  }
  const cutoff = now - 10 * 864e5;
  const pd = (s) => Date.parse(s.replace(/,(?= \d{4})/, '').replace(/(\d)(AM|PM)$/, '$1 $2'));
  const trades = []; let cur = null;
  for (const r of await tx('TRADE')) {
    const cells = Object.fromEntries(r.cells.map(c => [c.key, c]));
    if (cells.date) { cur = { set: r.txSetId, date: cells.date.content, ts: pd(cells.date.content), moves: [] }; trades.push(cur); }
    const asset = r.draftPickDisplayParts ? (r.draftPickDisplayParts.year + ' ' + r.draftPickDisplayParts.roundInfo).replace(/<[^>]+>/g, '') : (r.scorer.name + ' (' + r.scorer.teamShortName + ')');
    cur.moves.push({ from: cells.from.teamId, to: cells.to.teamId, asset });
  }
  const moves = [];
  for (const r of await tx('CLAIM_DROP')) {
    const cells = Object.fromEntries(r.cells.map(c => [c.key, c]));
    const last = moves[moves.length - 1];
    const date = cells.date ? cells.date.content : (last && last.date);
    const team = cells.team ? cells.team.teamId : (last && last.team);
    moves.push({ team, date, ts: pd(date), type: r.transactionType, player: r.scorer.name + ' (' + r.scorer.teamShortName + ')' });
  }

  // ---------- history ----------
  const hist = await fx(LEAGUE, 'getLeagueHistory');
  const seasons = (hist.seasons || []).map(s => ({ year: s.year, champion: s.championTeamName, runnerUp: s.runnerUpTeamName, leagueId: s.leagueId }));
  let lastSeason = null;
  const prev = (hist.seasons || []).filter(s => s.leagueId && s.leagueId !== LEAGUE).sort((a, b) => b.year - a.year)[0];
  if (prev) {
    const ps = parseStandings(await fx(prev.leagueId, 'getStandings', { view: 'ALL' })).filter(t => t.caption === 'Standings');
    lastSeason = { year: prev.year, divisions: ((await fx(prev.leagueId, 'getStandings', { view: 'ALL' })).displayedLists.tabs || []).slice(0, 2).map(t => t.name), champion: prev.championTeamName, runnerUp: prev.runnerUpTeamName, standings: ps };
  }

  const data = {
    generatedAt: new Date(now).toISOString(), league: { id: LEAGUE, name: info.leagueName, season: settings.season ? settings.season.displayYear : '' },
    phase, currentPeriod: current, lastCompleted, lastRegular, numPlayoffTeams: info.playoffs ? info.playoffs.numPlayoffTeams : null,
    cats: CATS, dynasty, teams, divisions: ((standingsRaw.displayedLists || {}).tabs || []).slice(0, 2).map(t => t.name), standings, schedule, proj, players, injuries,
    transactions: { trades: trades.filter(t => t.ts >= cutoff), moves: moves.filter(m => m.ts >= cutoff && m.type !== 'Lineup Change') },
    history: { seasons, lastSeason }, notes: null
  };
  window.__edb = data;
  window.__edbJson = JSON.stringify(data);
  return { ok: true, phase, current, lastCompleted, bytes: window.__edbJson.length };
})()
