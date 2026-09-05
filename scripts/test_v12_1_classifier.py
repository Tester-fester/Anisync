#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""test_v12_1_classifier.py — v12.1 an_classify_embed + verify-batch semantics.

Port of the PHP classifier (public/api/routes_meta.php :: an_classify_embed)
plus the verify-batch liveness rule, tested against the REAL failure classes
observed in the NAS field console log:

  - as_D_LzF3_M  : embed page 200, oEmbed 404, thumbnail 404   -> DEAD
                   (the v12 probe would have caught it via oEmbed, but the
                   deployed NAS never ran v12; this test pins the class so it
                   can never regress)
  - o6wtDPVkKqI  : oEmbed 200 from some networks, but the player dies with
                   an auth-class "Video unavailable" from the user's region
                   -> InnerTube ERROR must resolve to restricted (NOT ok).
                   This was HOLE 1: generic-ERROR fell through to oEmbed-ok.
  - browser feedback from the blind v4 patch (possible table poison)
                   -> must NOT override a positive server verdict (HOLE 2).

Run:  python3 scripts/test_v12_1_classifier.py
"""

import sys

FAILURES = []


def check(name, got, want):
    ok = got == want
    if not ok:
        FAILURES.append('%s: expected %r, got %r' % (name, want, got))
    print('%s %-58s %s' % ('PASS' if ok else 'FAIL', name, got))


# ----------------------------------------------------------------------------
# Faithful port of an_classify_embed (v12.1)
# ----------------------------------------------------------------------------
def classify(s):
    oe = s.get('oembed')
    it = s.get('innertube') if isinstance(s.get('innertube'), dict) else None
    api = s.get('api') if isinstance(s.get('api'), dict) else None
    rep = bool(s.get('reported'))

    it_status = str(it.get('status', '')) if it else ''
    it_reason = str(it.get('reason', '')) if it else ''
    it_low = (it_status + ' ' + it_reason).lower()
    api_embed = api.get('embeddable') if api and 'embeddable' in api else None
    api_priv = str(api.get('privacy', '')).lower() if api else ''
    api_up = str(api.get('upload', '')).lower() if api else ''

    # 1) hard death signals
    if api_priv in ('private', 'absent') or api_up in ('deleted', 'rejected', 'absent'):
        return ('dead', 'dataapi')
    if oe == 'dead':
        return ('dead', 'oembed')

    # 2) InnerTube authoritative
    if it is not None and it_status != '':
        if 'not a bot' in it_low:
            pass  # bot wall -> fall through
        elif it_status in ('OK', 'LIVE_STREAM_OFFLINE'):
            return ('ok', 'innertube')
        elif 'playback on other websites has been disabled' in it_low or 'watch on youtube' in it_low:
            return ('embed-blocked', 'innertube')
        elif it_status == 'UNPLAYABLE':
            return ('embed-blocked', 'innertube')
        elif 'country' in it_low:
            return ('restricted', 'innertube')
        elif 'age' in it_low or 'inappropriate' in it_low:
            return ('restricted', 'innertube')
        elif it_status == 'LOGIN_REQUIRED':
            return ('restricted', 'innertube')
        else:
            # ERROR and any other non-OK -> restricted (never ok)
            return ('restricted', 'innertube')

    # 3) oEmbed 401
    if oe == 'embed-blocked':
        return ('embed-blocked', 'oembed')

    # 4) Data API embeddable=false
    if api_embed is False:
        return ('embed-blocked', 'dataapi')

    # 5) positives (InnerTube had no say)
    if api_embed is True and oe in ('ok', None):
        return ('ok', 'dataapi')
    if oe == 'ok':
        return ('ok', 'oembed')

    # 6) browser tie-break only
    if rep:
        return ('embed-blocked', 'browser')

    return ('unknown', 'none')


def alive(state):
    """meta_verify_batch liveness: only ok/unknown pass the audit."""
    return state in ('ok', 'unknown')


# ----------------------------------------------------------------------------
# Field-log cases
# ----------------------------------------------------------------------------
# as_D_LzF3_M: oEmbed 404 (dead), thumbnail 404, embed page 200. InnerTube is
# skipped server-side for already-dead oEmbeds (probe optimization).
check('as_D: oEmbed 404 -> dead', classify({'oembed': 'dead', 'innertube': None, 'api': None}), ('dead', 'oembed'))
check('as_D: dead fails audit', alive(classify({'oembed': 'dead'})[0]), False)

# o6wt: oEmbed 200 but the player dies with auth-class "Video unavailable".
# HOLE 1 regression test: must NOT resolve to ok.
check('o6wt: IT ERROR generic + oEmbed ok -> restricted',
      classify({'oembed': 'ok', 'innertube': {'status': 'ERROR', 'reason': 'Video unavailable'}, 'api': None}),
      ('restricted', 'innertube'))
check('o6wt: restricted fails audit', alive('restricted'), False)

# HOLE 1 with a Data API embeddable=true that would otherwise say ok:
check('IT ERROR beats DataAPI embeddable=true',
      classify({'oembed': 'ok', 'innertube': {'status': 'ERROR', 'reason': 'Video unavailable'},
                'api': {'embeddable': True, 'privacy': 'public', 'upload': 'processed'}}),
      ('restricted', 'innertube'))

# Explicit country reason:
check('IT country reason -> restricted',
      classify({'oembed': 'ok', 'innertube': {'status': 'ERROR', 'reason': 'This video is not available in your country'}}),
      ('restricted', 'innertube'))

# Positive path: InnerTube OK wins even with a browser report (HOLE 2).
check('IT OK + stale browser report -> ok (poison immune)',
      classify({'oembed': 'ok', 'innertube': {'status': 'OK', 'reason': ''}, 'reported': True}),
      ('ok', 'innertube'))
check('IT OK passes audit', alive('ok'), True)

# Browser report still breaks ties when the server has no verdict:
check('no signal + browser report -> embed-blocked',
      classify({'oembed': None, 'innertube': None, 'api': None, 'reported': True}),
      ('embed-blocked', 'browser'))
check('embed-blocked fails audit', alive('embed-blocked'), False)

# Bot wall is not a health verdict — falls through to oEmbed:
check('bot wall + oEmbed ok -> ok',
      classify({'oembed': 'ok', 'innertube': {'status': 'LOGIN_REQUIRED', 'reason': 'Sign in to confirm you\'re not a bot'}}),
      ('ok', 'oembed'))

# oEmbed 401 (private/region-locked oEmbed) with no InnerTube (probe skip):
check('oEmbed 401 -> embed-blocked', classify({'oembed': 'embed-blocked', 'innertube': None}), ('embed-blocked', 'oembed'))

# Syndication block keywords:
check('IT syndication block -> embed-blocked',
      classify({'oembed': 'ok', 'innertube': {'status': 'UNPLAYABLE', 'reason': 'Playback on other websites has been disabled by the video owner'}}),
      ('embed-blocked', 'innertube'))

# Data API hard-dead beats everything:
check('DataAPI deleted -> dead',
      classify({'oembed': 'ok', 'innertube': None, 'api': {'embeddable': True, 'privacy': 'public', 'upload': 'deleted'}}),
      ('dead', 'dataapi'))
check('DataAPI private -> dead',
      classify({'oembed': 'ok', 'api': {'embeddable': True, 'privacy': 'private', 'upload': 'processed'}}),
      ('dead', 'dataapi'))

# Data API embeddable=false (no InnerTube) -> embed-blocked
check('DataAPI embeddable=false -> embed-blocked',
      classify({'oembed': 'ok', 'api': {'embeddable': False, 'privacy': 'public', 'upload': 'processed'}}),
      ('embed-blocked', 'dataapi'))

# No signals at all -> unknown (v11 semantics: ambiguous never condemns)
check('no signals -> unknown', classify({}), ('unknown', 'none'))
check('unknown passes audit (never condemn)', alive('unknown'), True)

# InnerTube LIVE_STREAM_OFFLINE counts as playable:
check('IT LIVE_STREAM_OFFLINE -> ok',
      classify({'innertube': {'status': 'LIVE_STREAM_OFFLINE', 'reason': ''}}), ('ok', 'innertube'))

# LOGIN_REQUIRED with an age reason -> restricted:
check('IT LOGIN_REQUIRED age -> restricted',
      classify({'oembed': 'ok', 'innertube': {'status': 'LOGIN_REQUIRED', 'reason': 'Sign in to confirm your age'}}),
      ('restricted', 'innertube'))

# ----------------------------------------------------------------------------
print()
if FAILURES:
    print('%d FAILURE(S):' % len(FAILURES))
    for f in FAILURES:
        print('  - ' + f)
    sys.exit(1)
print('ALL v12.1 CLASSIFIER TESTS PASSED')
