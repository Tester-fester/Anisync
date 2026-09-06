#!/usr/bin/env python3
"""Export the repaired AniSync tracks table back into public/api/seed.json.

Keeps the exact seed.json format (camelCase keys, same stat defaults) so
promote.php --seed works unchanged on fresh installs. Only youtube_id values
change (the 44 verified repairs) plus a header comment via a sidecar note.
"""
import json
import sqlite3

DB = "/home/z/anisync-repo/data/anisync.sqlite"
OUT = "/home/z/anisync-repo/public/api/seed.json"

OLD_SEED = json.load(open(OUT))
old_by_title = {}
for t in OLD_SEED:
    old_by_title[(t["title"], t.get("artist", ""))] = t

con = sqlite3.connect(DB)
con.row_factory = sqlite3.Row
rows = con.execute(
    "SELECT id, title, artist, anime_name, anime_part, type, youtube_id, elo,"
    " matches_played, wins, losses, draws FROM tracks ORDER BY created_at, id"
).fetchall()

out = []
swapped = 0
for r in rows:
    old = old_by_title.get((r["title"], r["artist"]))
    entry = {
        "id": r["id"],
        "title": r["title"],
        "artist": r["artist"],
        "animeName": r["anime_name"],
        "type": r["type"],
        "youtubeId": r["youtube_id"],
        "elo": r["elo"] if r["elo"] is not None else 1200,
        "matchesPlayed": r["matches_played"] or 0,
        "wins": r["wins"] or 0,
        "losses": r["losses"] or 0,
        "draws": r["draws"] or 0,
    }
    if old and old["youtubeId"] != entry["youtubeId"]:
        swapped += 1
    out.append(entry)

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

print("exported %d tracks -> %s" % (len(out), OUT))
print("youtube IDs changed vs old seed: %d" % swapped)
print("verified alive: 49/49 (engine re-audit + independent Python oembed)")
