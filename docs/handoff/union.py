#!/usr/bin/env python3
"""Resolve conflitos 'adiciona dos dois lados' (keys de ratelimit, AGENTS.md, listas):
mantém HEAD e depois o outro lado, removendo linhas idênticas repetidas."""
import re, sys
for path in sys.argv[1:]:
    s = open(path).read()
    def r(m):
        a, b = m.group(1), m.group(2)
        al = a.splitlines(keepends=True)
        out = list(al)
        for line in b.splitlines(keepends=True):
            if line not in al:
                out.append(line)
        return ''.join(out)
    s2 = re.sub(r'<<<<<<< [^\n]*\n(.*?)=======\n(.*?)>>>>>>> [^\n]*\n', r, s, flags=re.S)
    open(path, 'w').write(s2)
    print(path, 'ok' if '<<<<<<<' not in s2 else 'AINDA COM CONFLITO')
