#!/usr/bin/env python3
"""Sync src/initialTracks.ts and src/seededTracks.ts youtubeId values with the
repaired, verified library (matched by title). Handles both quote styles and
preserves the rest of each line (trailing commas etc.)."""
import re
import sqlite3

DB = "/home/z/anisync-repo/data/anisync.sqlite"

con = sqlite3.connect(DB)
verified = {}
for title, yt in con.execute("SELECT title, youtube_id FROM tracks"):
    verified[title] = yt

TITLE_RE = re.compile(r"""^\s*title:\s*(["'])((?:[^\\]|\\.)*?)\1""")
YTID_RE = re.compile(r"""(youtubeId:\s*)(["'])([^"']+)(\2)""")

def unescape(s):
    return s.replace("\\'", "'").replace('\\"', '"')

def patch(path):
    out = []
    current_title = None
    changed = 0
    for line in open(path, encoding="utf-8"):
        tm = TITLE_RE.match(line)
        if tm:
            current_title = unescape(tm.group(2))
        ym = YTID_RE.search(line)
        if ym and current_title in verified:
            new_id = verified[current_title]
            if ym.group(3) != new_id:
                line = line[: ym.start()] + ym.group(1) + ym.group(2) + new_id + ym.group(4) + line[ym.end():]
                changed += 1
        out.append(line)
    open(path, "w", encoding="utf-8").write("".join(out))
    print("%s: %d youtubeIds updated" % (path, changed))

patch("/home/z/anisync-repo/src/initialTracks.ts")
patch("/home/z/anisync-repo/src/seededTracks.ts")
