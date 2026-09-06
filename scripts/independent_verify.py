#!/usr/bin/env python3
"""Independent ground-truth verification of all 49 AniSync DB track links.

Uses the same oembed approach that fixed the original 19 dead links, but as a
completely separate code path (Python) from the PHP engine — a real
double-verification. Also identity-checks that each link's oembed title/author
matches the track (catches 'right ID, wrong song' swaps).
"""
import json
import re
import sqlite3
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

DB = "/home/z/anisync-repo/data/anisync.sqlite"
OEMBED = "https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={}&format=json"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
}


def tokens(s):
    return [w for w in re.findall(r"[a-z0-9'’]+", s.lower()) if len(w) >= 3]


def check(row):
    tid, title, artist, yt = row
    req = urllib.request.Request(OEMBED.format(yt), headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            data = json.loads(r.read().decode())
            oe_title = data.get("title", "")
            oe_author = data.get("author_name", "")
            # identity check: track title tokens should mostly appear in the
            # oembed title+author blob
            need = [w for w in tokens(title) if len(w) >= 4] or tokens(title)
            blob = (oe_title + " " + oe_author).lower()
            hits = sum(1 for w in need if w in blob)
            identity = hits >= max(1, len(need) - 1)
            return (tid, title, yt, True, "IDENTITY OK" if identity else "IDENTITY WEAK", oe_title)
    except urllib.error.HTTPError as e:
        return (tid, title, yt, False, "HTTP %d" % e.code, "")
    except Exception as e:
        return (tid, title, yt, False, str(e)[:60], "")


def main():
    con = sqlite3.connect(DB)
    rows = con.execute("SELECT id, title, artist, youtube_id FROM tracks ORDER BY id").fetchall()
    print("verifying %d tracks (independent Python oembed path)...\n" % len(rows))
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(check, rows))
    dead = [r for r in results if not r[3]]
    weak = [r for r in results if r[3] and r[4] == "IDENTITY WEAK"]
    for tid, title, yt, alive, status, oe in results:
        mark = "OK " if alive and status == "IDENTITY OK" else "!! "
        print("%s %-34s %-12s %-16s %s" % (mark, title[:34], yt, status, oe[:40]))
    print("\nSUMMARY: %d/%d alive, %d dead, %d weak-identity" % (
        len(results) - len(dead), len(results), len(dead), len(weak)))
    if dead:
        print("DEAD:", [d[2] for d in dead])
    if weak:
        print("WEAK:", [(w[1], w[2], w[5]) for w in weak])


if __name__ == "__main__":
    main()
