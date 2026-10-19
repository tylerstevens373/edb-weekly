"""Rebuild consensus.json from the ranking lists in this folder.
Each <source>.txt holds one player per line in rank order; lines starting with 'PICK ' are draft-pick slots.
Edit SOURCES below when a list is refreshed (date and URL)."""
import json, unicodedata, re, os
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
SOURCES = [
    ("RotoWire", "rotowire.txt", "2026-10-16", "https://www.rotowire.com/basketball/article/fantasy-basketball-dynasty-rankings-2026-27-top-150-players-to-draft-141439"),
    ("LineupExperts", "lineupexperts.txt", "2026-10-18", "https://www.lineupexperts.com/basketball/dynasty-draft-rankings"),
    ("Dynatyze", "dynatyze.txt", "2026-10-19", "https://dynatyze.com/basketball/dynasty-rankings"),
    ("Hashtag Basketball", "hashtag.txt", "2026-09-24", "https://hashtagbasketball.com/fantasy-basketball-dynasty-rankings"),
]
ALIAS = {"nic claxton": "nicolas claxton", "alexandre sarr": "alex sarr"}
def norm(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
    s = re.sub(r"\b(jr|sr|ii|iii|iv)\b\.?", "", s); s = re.sub(r"[.'’]", "", s); s = re.sub(r"\s+", " ", s).strip()
    return ALIAS.get(s, s)
data = json.load(open(os.path.join(ROOT, 'data.json')))
fx = {norm(p['n']): p['n'] for p in data['dynasty']['players']}
players, picks, lens = {}, [], {}
for name, f, date, url in SOURCES:
    lines = [l.strip() for l in open(os.path.join(HERE, f)) if l.strip()]
    lens[name] = len(lines)
    for i, l in enumerate(lines):
        if l.startswith('PICK '): picks.append({"source": name, "rank": i + 1, "label": l[5:]}); continue
        k = norm(l); players.setdefault(k, {"name": fx.get(k, l), "ranks": {}})["ranks"][name] = i + 1
out = []
for k, v in players.items():
    rs = [v['ranks'].get(n, lens[n] + 30) for n, _, _, _ in SOURCES]
    v['avg'] = round(sum(rs) / len(rs), 1); v['listed'] = len(v['ranks']); v['onRoster'] = k in fx; out.append(v)
out.sort(key=lambda v: v['avg'])
for i, v in enumerate(out): v['consensus'] = i + 1
json.dump({"updated": max(s[2] for s in SOURCES), "sources": [{"name": n, "updated": dt, "url": u} for n, _, dt, u in SOURCES],
           "method": "Average rank across sources; a player missing from a list counts as that list's length + 30.", "players": out, "picks": picks},
          open(os.path.join(ROOT, 'consensus.json'), 'w'), ensure_ascii=False, indent=0)
print(len(out), "players ranked;", sum(1 for v in out if not v['onRoster']), "not on a league roster")
