"""Match CEC village codes against every NLSC village boundary version.
Usage: python3 -I scripts/phase0/village_match.py"""
import sys, csv, glob, os, collections, re
sys.path.insert(0, os.path.dirname(__file__)); import dbf
B = 'data/raw/cec/'
ELECTIONS = [
    ('2021-12-18 ref17', B + '2018_2021公投_2022修憲複決/第１７案全國性公投/rfprof.csv', B + '2018_2021公投_2022修憲複決/第１７案全國性公投/rfarea.csv', 1),
    ('2022-11-26 V1', B + 'voteData/2022-111年地方公職人員選舉/V1/elprof.csv', B + 'voteData/2022-111年地方公職人員選舉/V1/elbase.csv', 0),
    ('2022-11-26 C1', None, None, 0),
    ('2024-01-13 president', B + 'voteData/2024總統立委/總統/elprof.csv', B + 'voteData/2024總統立委/總統/elbase.csv', 0),
]
def rows(p, h): return [[c.strip() for c in r] for r in csv.reader(open(p, encoding='utf-8-sig')) if r][h:]
def load_c1():
    pr, base = [], []
    for s in ('prv', 'city'):
        d = B + 'voteData/2022-111年地方公職人員選舉/C1/' + s
        pr += rows(d + '/elprof.csv', 0); base += rows(d + '/elbase.csv', 0)
    return pr, base
versions = sorted(glob.glob('data/raw/nlsc-village-history/y*/*/VILLAGE_*.dbf')) + ['data/raw/nlsc/village/VILLAGE_NLSC_1150817.dbf']
geo = {}
for v in versions:
    tag = re.search(r'VILLAGE_\w+?_(\d+)', v).group(1)
    f, recs, _ = dbf.read(v)
    geo[tag] = {r['VILLCODE'] for r in recs}
    if 'VILLCODE' not in [x[0] for x in f]: print('!! schema differs', tag, f)
print('versions:', {k: len(s) for k, s in geo.items()})
for name, pp, bp, h in ELECTIONS:
    if pp: pr, base = rows(pp, h), rows(bp, h)
    else: pr, base = load_c1()
    names = {(r[0], r[1], r[3], r[4]): r[5] for r in base}
    vil = {(r[0], r[1], r[3], r[4]) for r in pr if r[4] != '0000' and r[5] in ('0000', '0')}
    grp = {v for v in vil if '、' in names.get(v, '') or not v[3].isdigit()}
    real = vil - grp
    print(f'\n{name}: {len(vil)} village units = {len(real)} single villages + {len(grp)} groups')
    for tag, g in geo.items():
        miss = sorted(v for v in real if v[0] + v[1] + v[2] + v[3][1:] not in g)
        print(f'  {tag}: unmatched {len(miss):3d}  ' + ' '.join(names.get(m, '?') + '(' + ''.join(m) + ')' for m in miss[:6]))
