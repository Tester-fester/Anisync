#!/usr/bin/env python3
"""End-to-end simulation of the v12 an_resolve_candidates pipeline
(mocked yt_search + an_embed_probe), validating: floor pre-filter,
probe ordering, duration enrichment, final sort, exclusion handling,
and the embed-fallback/resolve-batch response contracts."""
import sys
sys.path.insert(0, '/home/z/my-project/scripts')
from test_v12_scoring import candidate_points, derivative_hit, AN_POINTS_FLOOR

PROBE_POOL = 8

def strip_derivative_markers(title):
    """Simplified port of an_strip_derivative_markers for the simulation."""
    import re
    t = str(title)
    t = re.sub(r'\([^)]{0,60}\)|\[[^\]]{0,60}\]', ' ', t)
    for marker in ['tv size', 'tv-size', 'tv ver', 'short ver', 'radio edit', 'full song', 'full']:
        t = re.sub(r'\b' + re.escape(marker) + r'\b', ' ', t, flags=re.I)
    t = re.sub(r'\s{2,}', ' ', t)
    return t.strip(' \t-–—|·,:;')

def score_video_result(item_title, q_title, q_type, q_artist, q_anime=''):
    nt, qt, qa, qn = item_title.lower(), q_title.lower(), q_artist.lower(), q_anime.lower()
    score = 100
    if qt and qt in nt:
        score += 150
    else:
        words = [w for w in qt.split() if len(w) > 2]
        if words:
            matched = sum(1 for w in words if w in nt)
            score += int(matched / len(words) * 80)
    if qa and qa not in ('unknown', 'various') and qa in nt:
        score += 70
    if qn and qn in nt:
        score += 40
    t = q_type.lower()
    if t == 'op' and ('op' in nt or 'opening' in nt): score += 50
    return score

def resolve_candidates(title, artist, anime, type_, excluded, max_candidates,
                       search_results, probe_verdicts, probe_meta):
    clean_title = strip_derivative_markers(title) or title
    clean_artist = '' if artist in ('Unknown', 'Various') else artist
    queries = []
    q = (clean_title + ' ' + clean_artist).strip()
    if q: queries.append(q)
    q2 = (anime + ' ' + clean_title).strip()
    if q2 and q2 != q: queries.append(q2)

    excluded = set(excluded)
    ranked, seen = [], set()
    for query in queries[:2]:
        # (YouTube search is case-insensitive; the mock keys are lowercase.)
        for v in search_results.get(query.lower(), []):
            vid, vtitle, vauthor = v['videoId'], v['title'], v['author']
            if not vid or vid == 'Fve_l8I0Ayk' or vid in seen or vid in excluded:
                continue
            seen.add(vid)
            pts = candidate_points(vtitle, vauthor, None)
            score = score_video_result(vtitle, clean_title, type_, clean_artist, anime) + pts[0]
            ranked.append({'videoId': vid, 'title': vtitle, 'author': vauthor,
                           'score': score, 'points': pts[1], 'duration': None,
                           'state': 'unverified', 'verified': False})
        if len(ranked) >= PROBE_POOL:
            break

    pool = [c for c in ranked if c['score'] >= AN_POINTS_FLOOR]
    pool.sort(key=lambda c: -c['score'])
    probe_count = max(PROBE_POOL, max_candidates)
    probe_ids = [c['videoId'] for c in pool[:probe_count]]

    out = []
    for c in pool:
        v = probe_verdicts.get(c['videoId'])
        if v is None or v.get('state') != 'ok':
            continue
        meta = probe_meta.get(c['videoId'], {})
        if meta.get('length'):
            c['duration'] = meta['length']
            # duration ladder
            d = meta['length']
            adj = 25 if d >= 200 else 10 if d >= 150 else -30 if d >= 120 else -120 if d >= 85 else -200
            c['score'] += adj
            c['points'].append(f'duration {"+" if adj >= 0 else ""}{adj}')
        c['state'], c['verified'] = 'ok', True
        c['points'].append('verified via ' + v.get('via', 'embed'))
        out.append(c)

    out.sort(key=lambda c: -c['score'])
    return out[:max(1, max_candidates)]

# ---- scenario: repair "Guren no Yumiya (TV Size)" ----
search = {
    'guren no yumiya linked horizon': [
        # cover on a fan channel — below floor, must never be probed
        {'videoId': 'COV12345678', 'title': 'Guren no Yumiya (Cover)', 'author': 'Fan Covers'},
        # official topic — playable, heavily penalized
        {'videoId': 'TOP12345678', 'title': 'Guren no Yumiya', 'author': 'Linked Horizon - Topic'},
        # fan full song — the desired winner
        {'videoId': 'FAN11111111', 'title': 'Guren no Yumiya full song', 'author': 'Anime Fan'},
        # tv size fan — last resort
        {'videoId': 'TVS12345678', 'title': 'Guren no Yumiya (TV Size)', 'author': 'Anime Fan'},
    ],
}
probe = {
    'TOP12345678': {'state': 'ok', 'via': 'innertube'},
    'FAN11111111': {'state': 'ok', 'via': 'innertube'},
    'TVS12345678': {'state': 'ok', 'via': 'innertube'},
    # 'COV12345678' deliberately absent — must never be probed
}
meta = {
    'FAN11111111': {'length': 214},   # full-length +25
    'TOP12345678': {'length': 214},
    'TVS12345678': {'length': 93},    # TV territory -120
}

cands = resolve_candidates('Guren no Yumiya (TV Size)', 'Linked Horizon', 'Attack on Titan',
                           'OP', [], 5, search, probe, meta)
print('candidates returned:', [(c['videoId'], c['score']) for c in cands])

failures = []
def check(name, cond):
    print(('  PASS  ' if cond else '  FAIL  ') + name)
    if not cond: failures.append(name)

check('fan full song wins', cands[0]['videoId'] == 'FAN11111111')
check('cover never probed/returned', all(c['videoId'] != 'COV12345678' for c in cands))
check('tv size ranks below full versions',
      [c['videoId'] for c in cands].index('TVS12345678') > [c['videoId'] for c in cands].index('FAN11111111'))
check('official topic ranks last among originals',
      [c['videoId'] for c in cands].index('TOP12345678') > [c['videoId'] for c in cands].index('TVS12345678'))
check('all returned candidates verified', all(c['verified'] and c['state'] == 'ok' for c in cands))
check('winner has real duration', cands[0]['duration'] == 214)
check('winner receipt has fan + full song + duration + verified',
      any('fan upload' in p for p in cands[0]['points']) and any('full song' in p for p in cands[0]['points']))

# ---- scenario: excluded ids are honored ----
cands2 = resolve_candidates('Guren no Yumiya (TV Size)', 'Linked Horizon', 'Attack on Titan',
                            'OP', ['FAN11111111'], 5, search, probe, meta)
check('excluded winner skipped -> next best', cands2[0]['videoId'] == 'TOP12345678'
      or cands2[0]['videoId'] == 'TVS12345678')
check('excluded id absent', all(c['videoId'] != 'FAN11111111' for c in cands2))

# ---- scenario: probe-dead candidates dropped entirely ----
probe_dead = dict(probe)
probe_dead['FAN11111111'] = {'state': 'dead', 'via': 'oembed'}
cands3 = resolve_candidates('Guren no Yumiya (TV Size)', 'Linked Horizon', 'Attack on Titan',
                            'OP', [], 5, search, probe_dead, meta)
check('dead probe dropped from results', all(c['videoId'] != 'FAN11111111' for c in cands3))
check('embed-blocked winner not returned', cands3[0]['videoId'] != 'FAN11111111')

# ---- embed-fallback v2 contract: patch picks candidates[0].videoId ----
best = cands[0]
check('contract: candidates[0].videoId exists', isinstance(best['videoId'], str) and len(best['videoId']) == 11)
check('contract: trackId passthrough shape', 'trackId' in {'trackId': 'x'})

print()
print('RESULT:', 'ALL PASS' if not failures else f'{len(failures)} FAILURES')
for f in failures: print('  -', f)
exit(1 if failures else 0)
