#!/usr/bin/env python3
"""Python port of the v12 scoring engine (routes_meta.php) for logic testing.

Mirrors: an_points_rules, an_points_marker_hit, an_derivative_lexicon,
an_derivative_hit, an_fan_is_official, an_duration_score_adjust,
an_candidate_points, AN_POINTS_FLOOR.
Test cases from FIXES.md §18.4 (v11 points suite).
"""
import re

AN_POINTS_FLOOR = -400

def points_rules():
    return [
        ('full song', 60, ['full song', 'full version', 'full ver', 'フルバージョン', 'フルコーラス']),
        ('full', 30, ['full']),
        ('lyrics', 30, ['lyrics', 'lyric video', 'lyrics video']),
        ('creditless', 25, ['creditless', 'creditsless', 'no credits', 'ノンクレジット']),
        ('hd', 20, ['hd', '1080p', '720p', '60fps', '4k', 'uhd', '高画質']),
        ('amv/mad fan edit', 25, ['amv', 'mad', 'pmv', 'gmv']),
        ('original', 15, ['original', 'オリジナル', 'original song', 'original pv', 'original mv']),
        ('audio only', 10, ['audio', 'audio only', 'audio upload']),
        ('theme', 10, ['theme', '主題歌']),
        ('parody', -300, ['parody', 'パロディ', 'parodie']),
        ('trailer/teaser', -250, ['trailer', 'teaser', '予告']),
        ('preview', -200, ['preview', 'snippet']),
        ('subbed re-upload', -150, ['subbed', 'subbed version', 'sub español', 'sub espanol']),
        ('low quality', -20, ['240p', '360p', '低画質']),
    ]

def marker_hit(t, marker):
    m = marker.lower()
    if m == '': return False
    if re.fullmatch(r'[a-z0-9]+', m) and len(m) < 9:
        return re.search(r'\b' + re.escape(m) + r'(s|es|ed|ing|er|version)?\b', t) is not None
    return m in t

def derivative_lexicon():
    audio = [
        'cover', 'covers', 'covered', 'covering', 'cover by', 'covered by', 'vocal cover',
        'piano cover', 'guitar cover', 'drum cover', 'metal cover', 'band cover',
        'english cover', 'spanish cover', 'fanmade', 'fan made', 'fan-made',
        'male version', 'female version', 'male ver', 'female ver', 'eng ver', 'eng cover',
        'amv cover', '歌ってみた', '歌ってみた。', '弾いてみた', '演奏してみた', '踊ってみた',
        '歌って踊って', '弾き語り', '歌カバー', 'セッション',
        'remix', 'remixes', 'remixed', 're-mix', 'nightcore', 'mashup', 'mash-up',
        'bootleg', 'vip mix', 'edit mix', 'rework', 're-arrange', 'rearrange',
        'arrange ver', 'arranged ver', 'arranged version', 'synthwave', 'chiptune',
        'lofi', 'lo-fi', 'sped up', 'speed up', 'fast version', 'slowed', 'slow down',
        'slowed down', 'slowed+reverb', 'reverb', 'bass boosted', 'bass boost',
        'pitch shifted', 'pitch shift', 'chipmunk', 'deep voice', 'low voice',
        '8d audio', '8d music', '8d version', '3d audio', '16d', 'sped-up', 'hypertouched',
        'instrumental', 'instrumentale', 'off vocal', 'offvocal', 'off-vocal',
        'karaoke', 'acapella', 'a cappella', 'inst ver', 'inst. version',
        'piano ver', 'piano version', 'piano solo', 'guitar ver', 'guitar version',
        'violin ver', 'violin version', 'orchestra ver', 'orchestral ver',
        'music box', 'musicbox', 'synthesia', '8-bit', '8bit', 'acoustic ver',
        'acoustic', 'unplugged', 'piano arrangement', 'metal ver', 'rock ver', 'band ver',
        'ai cover', 'ai covers', 'ai voice', 'ai singing', 'ai-generated', 'ai generated',
        'voicemod', 'rvc', 'sovits', 'kits ai',
        'live ver', 'live version', 'live cover', 'live edit', 'concert ver',
        'concert version', 'festival ver', 'live at', 'live from', '弾き語りver', 'live',
        'english version', 'english ver', 'eng version', 'english dub',
        'spanish version', 'spanish ver', 'spanish dub', 'latin version', 'latin ver',
        'french version', 'french ver', 'german version', 'german ver',
        'korean version', 'chinese version', '中文版', 'version en español', 'en español',
        'compilation', 'medley', 'best of', 'top 10', 'mix playlist', 'anthology',
        '1 hour', '1hour', '10 hours', '10 hour', '10hour', 'hour loop',
        'loop version', 'loop ver', 'extended mix', 'extended version',
        'extended edit', 'reaction', 'reacts', 'full album',
    ]
    length = [
        'tv size', 'tv-size', 'tv ver', 'tv ver.', 'tv version', 'tv edit',
        'tv limited', 'tv length', 'tv-size ver', 'short ver', 'short version',
        'short edit', 'radio edit', 'tv版', 'ショートver',
    ]
    return {'audio': audio, 'length': length}

def derivative_hit(text):
    t = ' ' + str(text).lower() + ' '
    if t == '  ': return ''
    lex = derivative_lexicon()
    for tier in ('audio', 'length'):
        for marker in lex[tier]:
            m = marker.lower()
            if m == '': continue
            if re.fullmatch(r'[a-z0-9 ]+', m) and len(m.replace(' ', '')) < 9 and ' ' not in m:
                if re.search(r'\b' + re.escape(m) + r'(s|es|ed|ing|er|version)?\b', t): return tier
            else:
                if m in t: return tier
    return ''

def fan_is_official(author):
    a = str(author).lower()
    if a == '': return False
    if '- topic' in a or '– topic' in a: return True
    if 'vevo' in a: return True
    if 'official' in a: return True
    if '公式' in a: return True
    labels = ['lantis', 'sony music', 'avex', 'pony canyon', 'aniplex',
              'crunchyroll', 'toho', 'nbcuniversal', 'nippon columbia', 'columbia music',
              'frontier works', 'marvelous', 'flying dog', 'flyingdog', 'j storm',
              'warner music', 'universal music', 'music japan', 'king records',
              'kings records', 'japan records', 'sacra music', 'smr', 'sony',
              'shueisha', 'kodansha', 'tv tokyo', 'records', 'record company']
    return any(l in a for l in labels)

def duration_score_adjust(dur):
    if dur is None: return 0
    if dur >= 200: return 25
    if dur >= 150: return 10
    if dur >= 120: return -30
    if dur >= 85: return -120
    return -200

def candidate_points(text, author, dur):
    t = ' ' + str(text).lower() + ' '
    score, hits = 0, []
    if str(author) != '':
        if fan_is_official(author):
            score -= 420; hits.append('official channel -420')
        else:
            score += 120; hits.append('fan upload +120')
    for label, pts, markers in points_rules():
        for marker in markers:
            if marker_hit(t, marker):
                score += pts; hits.append(f'{label} {"+" if pts >= 0 else ""}{pts}')
                break
    tier = derivative_hit(text)
    if tier == 'audio':
        score -= 1500; hits.append('cover/remix/derivative -1500')
    elif tier == 'length':
        score -= 350; hits.append('tv size/short cut -350')
    if dur is not None:
        adj = duration_score_adjust(dur)
        if adj != 0:
            score += adj; hits.append(f'duration {"+" if adj >= 0 else ""}{adj}')
    return score, hits


if __name__ == '__main__':
    # ========================================================================
    # FIXES.md §18.4 test suite
    # ========================================================================
    failures = []
    def check(name, cond):
        print(('  PASS  ' if cond else '  FAIL  ') + name)
        if not cond: failures.append(name)

    print('== channel points ==')
    s, h = candidate_points('Guren no Yumiya', 'Some Fan Channel', None)
    check('fan upload gets +120', s == 120)
    s, h = candidate_points('Guren no Yumiya', 'Linked Horizon - Topic', None)
    check('topic channel gets -420', s == -420)
    s, h = candidate_points('Guren no Yumiya', 'Lantis Music', None)
    check('label channel gets -420', s == -420)

    print('== floor exclusions (never returned) ==')
    s, h = candidate_points('Guren no Yumiya (Cover)', 'Fan', None)
    check('cover below floor', s < AN_POINTS_FLOOR)
    s, h = candidate_points('Guren no Yumiya English Version', 'Fan', None)
    check('english version below floor', s < AN_POINTS_FLOOR)
    s, h = candidate_points('Guren no Yumiya Live at Tokyo', 'Fan', None)
    check('live performance below floor', s < AN_POINTS_FLOOR)
    s, h = candidate_points('Unravel nightcore', 'Fan', None)
    check('nightcore below floor', s < AN_POINTS_FLOOR)
    s, h = candidate_points('歌ってみた version', 'Fan', None)
    check('japanese utattemita below floor', s < AN_POINTS_FLOOR)

    print('== tv size last resort ==')
    s, h = candidate_points('Guren no Yumiya (TV Size)', 'Fan', None)
    check('tv size = -350 + 120 (above floor, below full)', -350 + 120 == s)
    s_full, _ = candidate_points('Guren no Yumiya full song', 'Fan', None)
    check('full song outranks tv size', s_full > s)

    print('== duration ladder ==')
    check('>=200s +25', duration_score_adjust(210) == 25)
    check('>=150s +10', duration_score_adjust(160) == 10)
    check('120-149 -30', duration_score_adjust(130) == -30)
    check('85-119 -120', duration_score_adjust(100) == -120)
    check('<85 -200', duration_score_adjust(60) == -200)
    check('None = 0', duration_score_adjust(None) == 0)

    print('== word-boundary false positive guards (§18.4) ==')
    check('"Alive" does not trip live', derivative_hit('Alive and Well') == '')
    check('"Liverpool" does not trip cover', derivative_hit('Liverpool FC Anthem') == '')
    check('"delivered" does not trip live', derivative_hit('The Promise delivered') == '')
    check('"Made in Abyss" does not trip mad', derivative_hit('Made in Abyss OST') == '')
    check('"Discovery" does not trip cover', derivative_hit('Discovery of new sound') == '')
    check('real title stays clean', derivative_hit('Guren no Yumiya') == '')
    check('"Recovery" does not trip cover', derivative_hit('Recovery of an MBL') == '')

    print('== rulebook receipts ==')
    s, h = candidate_points('Guren no Yumiya full song HD', 'Fan', None)
    # fan +120, full song +60, full (bare word) +30, hd +20 — rules stack per-rulebook
    check('fan + full song + full + hd = 120+60+30+20', s == 230)
    check('receipt lists all hits', any('fan upload' in x for x in h) and any('full song' in x for x in h) and any('hd' in x for x in h))

    print('== subbed re-upload ==')
    s, h = candidate_points('Naruto OP subbed', 'Fan', None)
    check('subbed gets -150', s == 120 - 150)

    print()
    print(f'RESULT: {"ALL PASS" if not failures else str(len(failures)) + " FAILURES"}')
    for f in failures: print('  -', f)
    exit(1 if failures else 0)
