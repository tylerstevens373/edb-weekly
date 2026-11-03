# Rebuilds league.json (managers, IST setup, history) from the commissioner's spreadsheet.
import openpyxl, json, re, datetime, sys
SRC=sys.argv[2] if len(sys.argv) > 2 else 'Egregious_Dynasty_Basketball.xlsx'  # usage: python3 tools/league_from_xlsx.py league.json <spreadsheet.xlsx>
OUT=sys.argv[1]
wb=openpyxl.load_workbook(SRC,data_only=True)
ALIAS={'Jake':'Hunter'}  # Hunter is 'Jake' on the 2025-26 IST tab
nm=lambda s: ALIAS.get(str(s).strip(),str(s).strip()) if s is not None else None
MANAGERS={'Zach':'070oazg4mqqv88in','Pat':'n3z2eshxmqqv88in','Tom':'auysoygrmqqv88in','Bumpskiii':'b33iacngmqqv88in','Hunter':'saydaqzgmqqv88in','Jakobi':'rufupenmmqqv88in','Stevie':'mizl2op8mqqv88im','Zhang':'cipchrpimqqv88in','Kevin':'d91prsm4mqqv88in','Ethan':'ctvglb6gmqqv88in','Cade':'xoe774vlmqqv88in','Yash':'ygisq4rlmqqv88in'}

# ---- matchup history (completed seasons only; the current season comes live from Fantrax)
ws=wb['Matchup History']; season=None; week=None; games=[]
for r in ws.iter_rows(values_only=True):
    if r[0] and 'Season' in str(r[0]): season=str(r[0]).split()[0]; continue
    if r[0]=='Week': continue
    if r[0]: week=str(r[0])
    if not r[1] or r[3] is None: continue
    if season.startswith('2026'): continue
    rnd={'Round 1':'R1','Semis':'SF','FINALS':'F'}.get(week)
    games.append([season, rnd or int(week.replace('Week','').strip()), nm(r[1]), nm(r[2]), int(r[3]), int(r[4]), r[7]])

# ---- playoff seeds from bracket sheets
seeds={}
for ws in wb.worksheets:
    m=re.match(r'(\d{4}-\d{4}) Playoffs',ws.title)
    if not m: continue
    s={}
    for row in ws.iter_rows(values_only=True):
        for v in row:
            if isinstance(v,str):
                for k,n in re.findall(r'(\d)\.\s*([A-Za-z]+)',v): s[nm(n)]=int(k)
    seeds[m.group(1)]=s

# ---- champions from the bracket tabs (the Matchup History tab has the 2025-26 final score reversed, and 2023-24 was a 4-4 tie)
champions={}
for ws in wb.worksheets:
    m=re.match(r'(\d{4}-\d{4}) Playoffs',ws.title)
    if not m: continue
    col=None
    for row in ws.iter_rows(values_only=True):
        for j,v in enumerate(row):
            if isinstance(v,str) and 'CHAMPION' in v: col=j
        if col is not None and row[col] and 'CHAMPION' not in str(row[col]):
            champions[m.group(1)]=nm(re.sub(r'^\d\.\s*|\s*\(.*\)$','',str(row[col])).strip()); break
for g in games:
    if g[1]=='F' and g[0] in champions:
        ch=champions[g[0]]
        if ch==g[2] and g[4]<g[5] or ch==g[3] and g[5]<g[4]: g[4],g[5]=g[5],g[4]
        g.append(ch)
# ---- franchise ledger
ws=wb['Dues PaidTeam Results']; hdr=[c.value for c in ws[1]]; ledger=[]
for r in ws.iter_rows(min_row=2,values_only=True):
    if not r[0] or str(r[0]).startswith('Dues'): continue
    row=dict(zip(hdr,r)); years=[int(h) for h in hdr[1:9] if row.get(h)=='Paid']
    ledger.append({'mgr':nm(r[0]),'seasons':len(years),'first':min(years) if years else None,'titles':int(row['Championships'] or 0),'finals':int(row['Finals Appearances'] or 0),'divs':int(row['Division Titles'] or 0),'playoffs':int(row['Made Playoffs'] or 0),'ist':int(row['IST Titles'] or 0),'payouts':float(row['Total Payouts'] or 0),'dues':float(row['Total Dues'] or 0)})

# ---- awards by season
ws=wb['Award History']; rows=list(ws.iter_rows(values_only=True))
def rec(v):
    if isinstance(v,datetime.datetime): return f'{v.month}-{v.day}'
    return str(v) if v is not None else None
awards=[]; i=0; seen=set()
while i<len(rows):
    r=rows[i]
    if r[0] and re.match(r'\d{4}-\d{4}',str(r[0])) and r[1]=='MVP':
        label=str(r[0])
        if label in seen: pass
        a=rows[i+1]
        blk={'season':label,'MVP':[a[1],nm(a[2])],'MIP':[a[3],nm(a[4])],'DPOY':[a[5],nm(a[6])],'ROY':[a[7],nm(a[8])],'MEP':[a[9],nm(a[10])],'GMoY':[nm(a[11]),rec(a[12])]}
        teams={k:[] for k in ['All-EDB 1st','All-EDB 2nd','All-EDB 3rd','All-Rookie 1st','All-Rookie 2nd','All-Defense 1st','All-Defense 2nd']}
        cols=[(1,'All-EDB 1st'),(3,'All-EDB 2nd'),(5,'All-EDB 3rd'),(7,'All-Rookie 1st'),(9,'All-Rookie 2nd'),(11,'All-Defense 1st'),(13,'All-Defense 2nd')]
        for rr in rows[i+4:i+9]:
            for c,k in cols:
                if rr[c]: teams[k].append([str(rr[c]).replace('Gilegeous','Gilgeous'),nm(rr[c+1])])
        blk['teams']=teams
        stars={'Rec':[], 'Pro-Am':[]}
        for rr in rows[i+12:i+19]:
            for c,k in ((1,'Rec'),(3,'Rec'),(5,'Pro-Am'),(7,'Pro-Am')):
                if rr[c]: stars[k].append([str(rr[c]).replace('Gilegeous','Gilgeous'),nm(rr[c+1]),'starter' if c in (1,5) else 'reserve'])
        blk['allStars']=stars
        awards.append(blk); i+=9; continue
    i+=1
# the first block is labelled 2024-2025 in the sheet but holds 2025-26 awards (Knueppel ROY); fix labels by order
order=['2025-2026','2024-2025','2023-2024','2022-2023','2021-2022']
for b,s in zip(awards,order): b['season']=s
# trophy case
tc_hdr=[c for c in rows[0][1:16]]; trophies=[]
for r in rows[1:16]:
    if r[1]: trophies.append({'mgr':nm(r[1]), **{h:int(v or 0) for h,v in zip(tc_hdr[1:],r[2:16])}})

# ---- IST
def ist_sheet(name):
    ws=wb[name]; rows=list(ws.iter_rows(values_only=True)); groups={}; g=None; games=[]; mode=None
    for r in rows:
        if r[0] and str(r[0]).startswith('Group '): g=str(r[0])[-1]; groups[g]=[]; continue
        if r[0]=='Round Robin Games': mode='games'; continue
        if mode=='games' and isinstance(r[0],(int,float)):
            games.append({'week':int(r[0]),'group':r[1],'away':nm(r[2]),'home':nm(r[3]),'ac':r[4],'hc':r[5],'ap':r[6],'hp':r[7]}); continue
        if g and mode is None and r[0] and r[0]!='Team': groups[g].append(nm(r[0]))
    bracket=[str(v) for r in rows[5:25] for v in r[8:13] if isinstance(v,str) and 'Winner' not in v]
    return groups,games,bracket
g26,games26,_=ist_sheet('2026-2027 IST')
g25,games25,br25=ist_sheet('2025-2026 IST')
ist={'2026-2027':{'groups':g26,'games':[{k:v for k,v in x.items() if k in('week','group','away','home')} for x in games26],'semis':[['A','B'],['C','D']],'weeks':{'groups':[3,4,5],'semis':6,'final':7},'prize':60},
     '2025-2026':{'groups':g25,'games':games25,'bracket':{'semis':[[['Yash',1],['Zach',8]],[['Ethan',5],['Stevie',4]]],'final':['Zach','Ethan'],'champion':'Zach'},'raw':br25}}
json.dump({'source':'Egregious Dynasty Basketball league spreadsheet (commissioner)','managers':MANAGERS,'aliases':ALIAS,'games':games,'seeds':seeds,'champions':champions,'ledger':ledger,'awards':awards,'trophies':trophies,'ist':ist},open(OUT,'w'),separators=(',',':'))
print(len(games),'games', {s:sum(1 for x in games if x[0]==s) for s in sorted(set(x[0] for x in games))}); print(seeds); print(ist['2025-2026']['raw']); print([b['season']+' '+b['MVP'][0] for b in awards]); print(trophies[:2]); print(ledger[:3])
