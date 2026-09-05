# AniDB.net Integration Research & Strategy Dossier
**Project:** ANISYNC Championship Engine  
**Focus:** Anime Theme song details, ratings, scores, and relationship mapping  

---

## 1. Executive Summary & Core Platform Philosophy
AniDB (Anime Database) is a highly structured, non-commercial database populated by anime fans since 2002. Unlike generalist social tracker platforms (MyAnimeList, AniList), AniDB functions similarly to a collaborative wiki with relational database precision, structured specifically for media archival.

For **ANISYNC**, leveraging AniDB as a metadata and scoring utility offers key advantages:
1. **Weighted Anime Ratings**: Highly reliable scores that filter out "hype spikes" and review-bombing through separate permanent, temporary, and review rating curves.
2. **Granular Theme Song Credits**: Direct connections between anime entries, episodes, and theme songs (Opening, Ending, and Insert tracks), including single/album discography references.
3. **Meticulous Title Mapping**: A massive, community-vetted translation dictionary matching Romanized, English, Japanese, Short, Synonymous, and Common Misspelled anime titles.

---

## 2. AniDB Data Extraction: Architectures & Protocols
AniDB exposes its data through three primary mechanisms:
1. **The Clients-Side XML HTTP API** (Recommended for on-demand details)
2. **The High-Performance UDP API** (Optimized for high-concurrency automated scripts)
3. **Daily Static Data Dumps** (Ideal for offline search index seed files)

### A. The XML HTTP API
To query details for a specific anime series, ANISYNC can use the following HTTP GET query format:
```http
GET http://api.anidb.net:9001/httpapi?client=anisyncclient&clientver=1&protover=1&request=anime&aid=ANIME_ID
```
*(Note: User needs to register their client identifier to avoid rate limit bans. Keep query volume to a maximum of 1 request per 2 seconds to adhere to AniDB's strict API guidelines.)*

#### Useful XML Data Elements Returned:
*   **`<anime id="[AID]" restricted="[boolean]">`**: Base entity root.
*   **`<type>`**: Returns format (e.g., `TV Series`, `OVA`, `Movie`, `Web`). Crucial for categorizing tournament seed groups.
*   **`<episodecount>`**: Physical length of the series.
*   **`<titles>`**:
    ```xml
    <titles>
      <title xml:lang="en" type="official">Attack on Titan</title>
      <title xml:lang="ja" type="official">進撃の巨人</title>
      <title xml:lang="x-jat" type="main">Shingeki no Kyojin</title>
      <title xml:lang="en" type="short">AoT</title>
    </titles>
    ```
*   **`<ratings>`**: Contains the score distribution:
    *   `<permanent count="[voter_count]">SCORE</permanent>` (Calculated from users who have watched >4 episodes, filtered against duplicate bias)
    *   `<temporary count="[voter_count]">SCORE</temporary>` (Currently watching rating)
    *   `<review count="[review_count]">SCORE</review>` (Average of official user-written review grades)
*   **`<resources>`**: Key identifier mapping nodes:
    ```xml
    <resources>
      <resource type="1">MyAnimeList ID</resource>
      <resource type="2">AnimeNewsNetwork ID</resource>
      <resource type="3">Wikipedia Page EN</resource>
      <resource type="12">Official Website</resource>
    </resources>
    ```
*   **`<episodes>`**: Structure mapping individual episodes, categorized as Normal (`type="1"`), Special, OP theme sequence (`type="3"`), or ED theme sequence (`type="4"`).

---

## 3. Extracting Song, Theme, and Music Metadata
Within AniDB, themes are categorized at the **Episode / Music Credit** level. For any given anime series, theme songs are linked directly through the relational system.

### A. Opening/Ending Credits (OP/ED Nodes)
AniDB groups song metadata directly within the anime's credit structures:
1. **Credit Categorization**: OP, ED, and Insert themes are mapped to corresponding episodes. For example:
   * `OP1` might map to Episodes 1–12 (Normal).
   * `ED2` might map to Episodes 13–24.
2. **Song Details**: Each song includes title, artist, composer, lyricist, and sometimes singer credits.
3. **Relational Advantage**: Clicking on a theme song in AniDB displays other movies or spin-offs where that exact track was reused as a theme, allowing perfect ELO tracking for re-released tracks (e.g., *Sorairo Days* in Gurren Lagann TV series vs. movies).

### B. Daily Title Dump File (`animetitles.xml.gz`)
Instead of searching live on every keyphrase keystroke, AniDB provides a daily-regenerated gzip database containing all titles:
*   **URL**: `https://anidb.net/api/animetitles.xml.gz`
*   **Format**: Maps `aid` (AniDB ID) directly to human titles.
*   **Use-Case**: Seed this XML into a Local IndexedDB/Redis database at build time. When a user searches for *"AoT"*, resolve it locally to Anime ID `9420` instantaneously, and then fetch detailed metadata.

---

## 4. ANISYNC - AniDB Integration Engineering Design
We propose a robust full-stack architecture for integrating AniDB inside ANISYNC:

```
[User Search] -> [Local Title Cache (animetitles.xml)] -> [Resolve AniDB ID]
                                                                  |
[Render Details] <- [Hydrate UI] <- [Express Caching Proxy] <- [AniDB XML HTTP API]
```

### Steps for Implementation:
1. **Local Resolution Proxy**: Add an endpoint `/api/external/anidb/anime` in `server.ts`. This endpoint acts as a reverse proxy to query AniDB. It uses a cache layer (Memory/Redis) to prevent requesting the same Anime ID multiple times within 24 hours, guaranteeing compliance with AniDB’s API rate limits.
2. **Fuzzy Name Syncing**:
   ```typescript
   export async function searchAniDBTitle(query: string): Promise<number | null> {
     // Parsed locally from daily gzip dump to protect live API limits
     const hit = localTitlesCollection.find(t => t.title.toLowerCase() === query.toLowerCase());
     return hit ? hit.animeId : null;
   }
   ```
3. **Score Calibration Engine**: Map AniDB's weighted permanent score to help seed initial ELO dynamically for custom additions:
   $$\text{Initial ELO} = 1000 + (\text{AniDB Score} \times 50)$$
   *Example: An anime with a 9.0 Rating starts at 1450 ELO, while a 5.0 starts at 1250 ELO, allowing the leaderboard to align faster!*
4. **Link Verification**: Use AniDB external maps to stitch MyAnimeList, YouTube video hashes, and Spotify metadata IDs automatically.

---

## 5. Legality & Compliance Guidelines
*   **Commercial Use**: AniDB terms specify API access is *strictly for non-commercial endpoints*. Since ANISYNC is a community project, it is fully compliant.
*   **User-Agent Registration**: Do not use generic User-Agents. We must set a specific HTTP Header:
    `User-Agent: anisync-client/1.0.0 (contact: support@anisync.com)`
*   **Caching Minimum**: Results must be cached locally on the server for a minimum of 4 hours, and up to 24 hours for completed series. This significantly improves client response latency and preserves database integrity.
