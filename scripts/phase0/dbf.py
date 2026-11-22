"""Minimal DBF reader for Phase 0 inspection. Usage: python3 -I dbf.py file.dbf [n]"""
import struct, sys
def read(path, enc=None):
    b = open(path, 'rb').read()
    n, hl, rl = struct.unpack('<IHH', b[4:12])
    cpg = path[:-4] + '.CPG'
    try: enc = enc or open(cpg).read().strip()
    except OSError: enc = enc or 'utf-8'
    enc = {'UTF-8': 'utf-8'}.get(enc.upper(), enc)
    fields, off = [], 32
    while b[off] != 0x0D:
        name = b[off:off+11].split(b'\0')[0].decode(); typ = chr(b[off+11]); ln = b[off+16]
        fields.append((name, typ, ln)); off += 32
    recs = []
    for i in range(n):
        r = b[hl + i*rl: hl + (i+1)*rl]; p = 1; rec = {}
        for name, typ, ln in fields:
            rec[name] = r[p:p+ln].decode(enc, 'replace').strip(); p += ln
        recs.append(rec)
    return fields, recs, enc
if __name__ == '__main__':
    f, r, e = read(sys.argv[1]); k = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    print('encoding', e, 'records', len(r)); print('fields', f)
    for x in r[:k]: print(x)
