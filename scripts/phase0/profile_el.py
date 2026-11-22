"""Phase 0 profiler for CEC el*.csv election files. Usage: python3 -I profile_el.py <dir>"""
import csv, sys, collections, os
d = sys.argv[1]
def rows(n):
    p = os.path.join(d, n)
    if not os.path.exists(p): return []
    with open(p, encoding='utf-8-sig', newline='') as f:
        return [[c.strip() for c in r] for r in csv.reader(f) if r]
def level(r):
    prv, cty, dist, town, vil = r[:5]
    st = r[5] if len(r) > 5 else None
    if st not in (None, '0', '0000'): return 'station'
    if vil != '0000': return 'village'
    if town != '000': return 'town'
    if cty != '000' : return 'county(cty)'
    if prv != '00': return 'county(prv)' if dist == '00' else 'district'
    return 'national' if dist == '00' else 'national-dist'
base, cand, paty, prof, ctks = (rows(x) for x in ['elbase.csv','elcand.csv','elpaty.csv','elprof.csv','elctks.csv'])
print('rows: base', len(base), 'cand', len(cand), 'paty', len(paty), 'prof', len(prof), 'ctks', len(ctks))
print('field counts: prof', collections.Counter(len(r) for r in prof), 'ctks', collections.Counter(len(r) for r in ctks), 'cand', collections.Counter(len(r) for r in cand))
lv = collections.Counter((level(r), r[2]=='00') for r in prof)
print('prof levels (level, dist==00):', dict(lv))
print('distinct dist codes in prof:', sorted({r[2] for r in prof})[:30])
print('village codes non-numeric first char:', collections.Counter(r[4][0] for r in prof if r[4]!='0000'))
print('base levels:', collections.Counter(level(r+['0']) for r in base))
print('cand sample:', cand[:2])
# consistency: sum station valid = sum of station candidate votes ; town sum of stations
prof_by = {tuple(r[:6]): r for r in prof}
votes = collections.defaultdict(int)
for r in ctks: votes[tuple(r[:6])] += int(r[7])
bad = [(k, int(prof_by[k][6]), v) for k, v in votes.items() if k in prof_by and int(prof_by[k][6]) != v]
print('units where valid != sum(candidate votes):', len(bad), bad[:3])
miss = [k for k in votes if k not in prof_by]
print('ctks units missing from prof:', len(miss))
for r in prof:
    if level(r).startswith('national') or level(r)=='county(prv)' and r[1]=='000':
        pass
nat = [r for r in prof if r[0]=='00']
print('national rows:', nat[:3])
# check: valid+invalid==votes
print('valid+invalid!=cast:', sum(1 for r in prof if int(r[6])+int(r[7])!=int(r[8])))
# station sums vs higher levels
st = [r for r in prof if level(r)=='station']
tot = sum(int(r[6]) for r in st); print('sum station valid', tot, 'distinct stations', len({(r[0],r[1],r[3],r[5]) for r in st}))
dup = collections.Counter((r[0],r[1],r[2],r[3],r[5]) for r in st); print('station key dup (prv,cty,dist,town,st):', sum(1 for v in dup.values() if v>1))
dup2 = collections.Counter((r[0],r[1],r[5]) for r in st); print('station no unique within county:', sum(1 for v in dup2.values() if v>1)==0)
