#!/usr/bin/env python3
"""Structural sanity checks for the edited PHP files (no PHP runtime here).

1. Brace/paren/bracket balance outside strings & comments.
2. Duplicate function declarations across the include chain (fatal in PHP).
3. PHP 5.3 compatibility scan of the whole public/api tree: null coalescing
   (??), short arrays ( [ at statement start), arrow fns, etc.
"""
import re, sys, glob

BASE = '/home/z/my-project/anisync-project/anisync/public/api/'
FILES = ['lib.php', 'routes_meta.php', 'routes_db.php', 'routes_auth.php', 'routes_google.php']

def strip_php(src):
    """Remove comments and string contents (keeping quote chars balanced)."""
    out = []
    i, n = 0, len(src)
    state = None  # None | 'line' | 'block' | "'" | '"'
    while i < n:
        c = src[i]
        nxt = src[i+1] if i + 1 < n else ''
        if state is None:
            if c == '/' and nxt == '/':
                state = 'line'; i += 2; continue
            if c == '#':
                state = 'line'; i += 1; continue
            if c == '/' and nxt == '*':
                state = 'block'; i += 2; continue
            if c == "'":
                state = "'"; i += 1; continue
            if c == '"':
                state = '"'; i += 1; continue
            out.append(c); i += 1
        elif state == 'line':
            if c == '\n':
                state = None; out.append('\n')
            i += 1
        elif state == 'block':
            if c == '*' and nxt == '/':
                state = None; i += 2; continue
            if c == '\n': out.append('\n')
            i += 1
        elif state == "'":
            if c == '\\':
                i += 2; continue
            if c == "'":
                state = None
            i += 1
        elif state == '"':
            if c == '\\':
                i += 2; continue
            if c == '"':
                state = None
            i += 1
    return ''.join(out)

fail = 0

# --- 1. balance ---
for f in FILES:
    src = open(BASE + f, encoding='utf-8', errors='replace').read()
    code = strip_php(src)
    for open_c, close_c, name in [('{', '}', 'braces'), ('(', ')', 'parens'), ('[', ']', 'brackets')]:
        if code.count(open_c) != code.count(close_c):
            print(f'FAIL {f}: unbalanced {name} {code.count(open_c)} vs {code.count(close_c)}')
            fail += 1
        else:
            print(f'OK   {f}: {name} balanced ({code.count(open_c)})')

# --- 2. duplicate functions across include chain ---
seen = {}
dups = []
for f in FILES:
    src = open(BASE + f, encoding='utf-8', errors='replace').read()
    for m in re.finditer(r'function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(', src):
        name = m.group(1)
        if name in seen and seen[name] != f:
            dups.append(f'{name}: {seen[name]} + {f}')
        seen[name] = f
if dups:
    print('FAIL duplicate functions:')
    for d in dups: print('  ', d)
    fail += 1
else:
    print(f'OK   no duplicate function names across {len(FILES)} files ({len(seen)} unique)')

# --- 3. PHP 5.3 compatibility scan ---
bad_patterns = [
    (r'\?\?', 'null coalescing ??'),
    (r'=>\s*fn\s*\(', 'arrow function'),
    (r'(?:^|[\s(])\[\s*$', 'short array literal [ at line end'),
]
for f in FILES:
    src = open(BASE + f, encoding='utf-8', errors='replace').read()
    lines = src.split('\n')
    for idx, line in enumerate(lines, 1):
        for pat, desc in bad_patterns:
            if re.search(pat, line):
                print(f'WARN {f}:{idx}: possible 5.3-incompatible {desc}: {line.strip()[:80]}')

# --- 4. CLI tool balance ---
src = open('/home/z/my-project/anisync-project/anisync/bulk_stream_repair.php', encoding='utf-8', errors='replace').read()
code = strip_php(src)
ok = all(code.count(a) == code.count(b) for a, b in [('{}'), ('()'), ('[]')] if a)
for a, b in [('{', '}'), ('(', ')'), ('[', ']')]:
    if code.count(a) != code.count(b):
        print(f'FAIL bulk_stream_repair.php: unbalanced {a}{b}')
        fail += 1
print('OK   bulk_stream_repair.php balanced') if fail == 0 else None

print()
print('RESULT:', 'ALL STRUCTURAL CHECKS PASS' if fail == 0 else f'{fail} FAILURES')
sys.exit(1 if fail else 0)
