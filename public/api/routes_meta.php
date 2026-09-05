<?php
/**
 * routes_meta.php — metadata / AI / proxy endpoints (server.ts port).
 *
 * External sources (all via cURL): Jikan (MAL), AnimeThemes.moe, AniList
 * GraphQL, MusicBrainz, Last.fm, iTunes Search, YouTube (InnerTube + Scraping + oEmbed),
 * LRCLIB, Anison.info (Shift-JIS), AniDB, VGMdb, Google Gemini (REST).
 *
 * PHP 5.3+ / PHP 8.x compatible.
 */

// ===========================================================================
// External API clients
// ===========================================================================
define('JIKAN_UA', 'ANISYNC/1.0 (https://anisync.app)');

function jikan_get($path, $timeout = 8) {
    return http_get_json('https://api.jikan.moe/v4' . $path, $timeout, JIKAN_UA);
}

function animethemes_search($animeName, $limit = 5) {
    $url = "https://api.animethemes.moe/anime?q=" . rawurlencode($animeName) .
        "&include=animethemes,animethemes.song,animethemes.song.artists&limit=" . (int)$limit;
    
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 4);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 2);
    curl_setopt($ch, CURLOPT_USERAGENT, "AniSync/1.0.0 (https://anisync.app)");
    curl_setopt($ch, CURLOPT_HTTPHEADER, array("Accept: application/json"));
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    
    $res = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($code === 200 && $res) {
        $d = json_decode($res, true);
        if (is_array($d)) return $d;
    }
    return null;
}

/** AniList GraphQL helper with Kitsu Fallback */
function kitsu_fallback_fetch($query_str, $variables = array()) {
    $search = "";
    if (is_array($variables) && !empty($variables["search"])) {
        $search = $variables["search"];
    } elseif (is_string($variables) && $variables !== "") {
        $search = $variables;
    }

    if ($search !== "") {
        $url = "https://kitsu.io/api/edge/anime?filter[text]=" . urlencode($search) . "&page[limit]=20";
    } else {
        $page = (is_array($variables) && isset($variables["page"])) ? (int)$variables["page"] : 1;
        $offset = ($page - 1) * 20;
        $url = "https://kitsu.io/api/edge/anime?page[limit]=20&page[offset]=" . $offset . "&sort=-userCount";
    }

    $r = an_curl($url, array("headers" => array("Accept: application/vnd.api+json")));
    if (!$r["ok"]) return null;
    $d = safe_json_parse($r["body"], null);
    if (!isset($d["data"]) || !is_array($d["data"])) return null;

    $media = array();
    foreach ($d["data"] as $item) {
        $attr = isset($item["attributes"]) ? $item["attributes"] : array();
        $titles = isset($attr["titles"]) ? $attr["titles"] : array();
        $romaji = isset($titles["en_jp"]) ? $titles["en_jp"] : (isset($attr["canonicalTitle"]) ? $attr["canonicalTitle"] : "");
        $english = isset($titles["en"]) ? $titles["en"] : $romaji;
        $native = isset($titles["ja_jp"]) ? $titles["ja_jp"] : "";
        $poster = isset($attr["posterImage"]["large"]) ? $attr["posterImage"]["large"] : (isset($attr["posterImage"]["medium"]) ? $attr["posterImage"]["medium"] : "");
        $banner = isset($attr["coverImage"]["original"]) ? $attr["coverImage"]["original"] : $poster;

        $media[] = array(
            "id" => (int)$item["id"],
            "idMal" => (int)$item["id"],
            "title" => array(
                "romaji" => $romaji,
                "english" => $english,
                "native" => $native,
                "userPreferred" => $english ? $english : $romaji
            ),
            "coverImage" => array(
                "large" => $poster,
                "medium" => $poster,
                "color" => "#38bdf8"
            ),
            "bannerImage" => $banner,
            "format" => isset($attr["subtype"]) ? strtoupper($attr["subtype"]) : "TV",
            "episodes" => isset($attr["episodeCount"]) ? (int)$attr["episodeCount"] : null,
            "seasonYear" => isset($attr["startDate"]) ? (int)substr($attr["startDate"], 0, 4) : null,
            "genres" => array("Anime", "Action", "Music")
        );
    }

    return array(
        "data" => array(
            "Page" => array(
                "pageInfo" => array("hasNextPage" => count($media) >= 20),
                "media" => $media
            ),
            "Media" => count($media) > 0 ? $media[0] : null
        )
    );
}

function anilist_query($query, $variables = array()) {
    $r = an_curl("https://graphql.anilist.co", array(
        "method" => "POST",
        "headers" => array("Content-Type: application/json", "Accept: application/json"),
        "body" => json_encode(array("query" => $query, "variables" => $variables)),
        "timeout" => 8,
        "useragent" => JIKAN_UA,
    ));
    if ($r["ok"]) {
        $d = safe_json_parse($r["body"], null);
        if ($d !== null && !isset($d["errors"])) return $d;
    }
    return kitsu_fallback_fetch($query, $variables);
}

$GLOBALS['_MB_LAST'] = 0;
function musicbrainz_fetch($path) {
    $wait = 1100 - ((int)(microtime(true) * 1000) - $GLOBALS['_MB_LAST']);
    if ($wait > 0) usleep($wait * 1000);
    $GLOBALS['_MB_LAST'] = (int)(microtime(true) * 1000);
    $r = an_curl('https://musicbrainz.org/ws/2' . $path, array(
        'timeout' => 15,
        'useragent' => 'ANISYNC/1.0 ( anisync.app / contact@anisync.app )',
        'headers' => array('Accept: application/json'),
    ));
    if ((int)$r['status'] === 503) return null;
    if (!$r['ok']) return null;
    return safe_json_parse($r['body'], null);
}

function mb_search_recordings($title, $artist, $limit) {
    $q = 'recording:"' . $title . '"';
    if ($artist !== null && $artist !== '') $q .= ' AND artist:"' . $artist . '"';
    $url = '/recording?query=' . rawurlencode($q) . '&limit=' . (int)$limit . '&fmt=json&inc=releases';
    $data = musicbrainz_fetch($url);
    if ($data === null || !isset($data['recordings'])) return array();
    $out = array();
    foreach ($data['recordings'] as $rec) {
        $artistName = null;
        if (isset($rec['artist-credit'][0]['name'])) $artistName = $rec['artist-credit'][0]['name'];
        $releases = array();
        if (isset($rec['releases']) && is_array($rec['releases'])) {
            foreach (array_slice($rec['releases'], 0, 3) as $rel) {
                $releases[] = array(
                    'id' => isset($rel['id']) ? $rel['id'] : '',
                    'title' => isset($rel['title']) ? $rel['title'] : '',
                    'date' => isset($rel['date']) ? $rel['date'] : null,
                );
            }
        }
        $out[] = array(
            'id' => isset($rec['id']) ? $rec['id'] : '',
            'title' => isset($rec['title']) ? $rec['title'] : '',
            'artist' => $artistName,
            'releases' => $releases,
        );
    }
    return $out;
}

function mb_find_cover_art($title, $artist) {
    $recs = mb_search_recordings($title, $artist, 3);
    foreach ($recs as $rec) {
        if (!empty($rec['releases'][0]['id'])) {
            $r = an_curl('https://coverartarchive.org/release/' . $rec['releases'][0]['id'] . '/front', array('timeout' => 10));
            if ((int)$r['status'] === 200) {
                return 'https://coverartarchive.org/release/' . $rec['releases'][0]['id'] . '/front-250.jpg';
            }
        }
    }
    return null;
}

function lastfm_call($method, $params) {
    if (LASTFM_API_KEY === '') return null;
    $all = array_merge($params, array(
        'method' => $method, 'api_key' => LASTFM_API_KEY, 'format' => 'json',
    ));
    $r = an_curl('https://ws.audioscrobbler.com/2.0/?' . http_build_query($all), array(
        'timeout' => 8, 'useragent' => 'ANISYNC/1.0',
    ));
    if (!$r['ok']) return null;
    $d = safe_json_parse($r['body'], null);
    if ($d === null || isset($d['error'])) return null;
    return $d;
}

function fetch_with_encoding($url, $encoding) {
    $r = an_curl($url, array('timeout' => 6));
    if (!$r['ok']) return '';
    $body = $r['body'];
    if ($encoding !== 'utf-8' && $encoding !== 'UTF-8') {
        if (function_exists('mb_convert_encoding')) {
            $body = mb_convert_encoding($body, 'UTF-8', $encoding);
        } elseif (function_exists('iconv')) {
            $body = @iconv($encoding, 'UTF-8//IGNORE', $body);
        }
    }
    return $body === false ? '' : $body;
}

function an_find_objects($data, $key, &$out, $limit) {
    if (count($out) >= $limit) return;
    if (!is_array($data)) return;
    if (isset($data[$key]) && is_array($data[$key])) { $out[] = $data[$key]; }
    foreach ($data as $v) {
        if (is_array($v)) an_find_objects($v, $key, $out, $limit);
        if (count($out) >= $limit) return;
    }
}

function an_deep_get($data, $path) {
    $cur = $data;
    foreach ($path as $seg) {
        if (!is_array($cur) || !isset($cur[$seg])) return null;
        $cur = $cur[$seg];
    }
    return $cur;
}

// ---------------------------------------------------------------------------
// Upgraded YouTube Search: YouTube Data API v3 first, then HTML scraper fallback
// ---------------------------------------------------------------------------
function yt_search($query, $limit = 30) {
    $cacheKey = "ytapi:" . md5($query . "|" . $limit);
    $cached = cache_get($cacheKey);
    if ($cached !== null) return $cached;

    $videos = array();
    $playlists = array();

    // 1. Try YouTube Data API v3 (stable, structured)
    if (YOUTUBE_API_KEY !== '') {
        $url = 'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=' . (int)$limit
             . '&q=' . urlencode($query) . '&key=' . urlencode(YOUTUBE_API_KEY);
        $r = an_curl($url, array('timeout' => 8));
        if ($r['ok']) {
            $data = json_decode($r['body'], true);
            if (isset($data['items']) && is_array($data['items'])) {
                foreach ($data['items'] as $item) {
                    $id = isset($item['id']['videoId']) ? $item['id']['videoId'] : '';
                    if (!$id) continue;
                    $snippet = isset($item['snippet']) ? $item['snippet'] : array();
                    $title = isset($snippet['title']) ? $snippet['title'] : '';
                    $author = isset($snippet['channelTitle']) ? $snippet['channelTitle'] : '';
                    // duration not available from search, we'll fetch later if needed
                    $videos[] = array(
                        'videoId' => $id,
                        'title' => $title,
                        'author' => $author,
                        'duration' => 'N/A',
                    );
                }
                $result = array('videos' => $videos, 'playlists' => $playlists);
                cache_set($cacheKey, $result, 3600000); // 1 hour
                return $result;
            }
        }
    }

    // 2. Fallback: old HTML scraper (kept for robustness)
    $result = yt_search_scraper($query, $limit);
    cache_set($cacheKey, $result, 600000); // 10 minutes
    return $result;
}

// Old scraper (renamed, not used directly outside)
function yt_search_scraper($query, $limit = 30) {
    $videos = array();
    $playlists = array();
    
    $url = "https://www.youtube.com/results?search_query=" . rawurlencode($query);
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 8);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 3);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_USERAGENT, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36");
    curl_setopt($ch, CURLOPT_HTTPHEADER, array(
        "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language: en-US,en;q=0.9",
        "Cookie: SOCS=CAESEwgDEgk2MTc4MjE0ODQaAmVuIAEaBgiA_LyaBg; CONSENT=PENDING+999"
    ));
    
    $html = curl_exec($ch);
    curl_close($ch);

    if ($html && preg_match("/ytInitialData\s*=\s*({.+?});/s", $html, $m)) {
        $data = json_decode($m[1], true);
        if ($data) {
            $vids = array();
            an_find_objects($data, "videoRenderer", $vids, $limit + 20);
            foreach ($vids as $v) {
                if (count($videos) >= $limit) break;
                $id = isset($v["videoId"]) ? $v["videoId"] : "";
                $title = an_deep_get($v, array("title", "runs", 0, "text"));
                if ($title === null && isset($v["title"]["simpleText"])) $title = $v["title"]["simpleText"];
                $author = an_deep_get($v, array("ownerText", "runs", 0, "text"));
                if ($author === null) $author = an_deep_get($v, array("longBylineText", "runs", 0, "text"));
                $dur = an_deep_get($v, array("lengthText", "simpleText"));
                if ($id !== "" && $title !== null && $title !== "") {
                    $videos[] = array(
                        "videoId" => $id,
                        "title" => (string)$title,
                        "author" => $author === null ? "" : (string)$author,
                        "duration" => $dur === null ? "N/A" : (string)$dur,
                    );
                }
            }
        }
    }

    if (count($videos) === 0 && $html && preg_match_all("/\"videoId\":\"([A-Za-z0-9_-]{11})\"/m", $html, $m2)) {
        $seen = array();
        foreach ($m2[1] as $vid) {
            if (!isset($seen[$vid])) {
                $seen[$vid] = true;
                $videos[] = array("videoId" => $vid, "title" => $query, "author" => "YouTube", "duration" => "N/A");
                if (count($videos) >= $limit) break;
            }
        }
    }

    return array("videos" => $videos, "playlists" => $playlists);
}

function yt_playlist_videos($listId, $limit) {
    $html = http_get_html('https://www.youtube.com/playlist?list=' . rawurlencode($listId), 10);
    $videos = array();
    if ($html !== '' && preg_match('/ytInitialData\s*=\s*(\{.+?\});/s', $html, $m)) {
        $data = safe_json_parse($m[1], null);
        if ($data !== null) {
            $vids = array();
            an_find_objects($data, 'playlistVideoRenderer', $vids, $limit + 5);
            foreach ($vids as $v) {
                if (count($videos) >= $limit) break;
                $id = isset($v['videoId']) ? $v['videoId'] : '';
                $title = an_deep_get($v, array('title', 'runs', 0, 'text'));
                if ($title === null && isset($v['title']['simpleText'])) $title = $v['title']['simpleText'];
                $author = an_deep_get($v, array('shortBylineText', 'runs', 0, 'text'));
                $dur = an_deep_get($v, array('lengthText', 'simpleText'));
                if ($id !== '' && $title !== null && $title !== '') {
                    $videos[] = array(
                        'videoId' => $id, 'title' => (string)$title,
                        'author' => $author === null ? '' : (string)$author,
                        'duration' => $dur === null ? 'N/A' : (string)$dur,
                    );
                }
            }
        }
    }
    return $videos;
}

// ===========================================================================
// Scrapers — Anison, AniDB, VGMdb
// ===========================================================================
function scrape_anison($animeName) {
    $variants = get_search_variants($animeName);
    foreach (array_slice($variants, 0, 3) as $query) {
        $searchUrl = 'http://anison.info/data/search.php?m=pro&q=' . rawurlencode($query);
        $html = fetch_with_encoding($searchUrl, 'SJIS');
        if ($html === '') continue;
        $programLink = null;
        if (preg_match('/href="([^"]*program\.php[^"]*)"/', $html, $m)) $programLink = $m[1];
        elseif (preg_match('/href="([^"]*pro\.php[^"]*)"/', $html, $m)) $programLink = $m[1];
        elseif (preg_match('/<div class="result">\s*<a href="([^"]+)"/', $html, $m)) $programLink = $m[1];
        if ($programLink === null) continue;
        $detailUrl = (strpos($programLink, 'http') === 0) ? $programLink : 'http://anison.info/data/' . $programLink;
        $detailHtml = fetch_with_encoding($detailUrl, 'SJIS');
        if ($detailHtml === '') continue;
        $results = array();
        if (preg_match_all('/<tr[^>]*>(.*?)<\/tr>/s', $detailHtml, $rows)) {
            foreach ($rows[1] as $tr) {
                $typeText = '';
                if (preg_match('/<td class="ue"[^>]*>(.*?)<\/td>/s', $tr, $m)) $typeText = trim(strip_tags($m[1]));
                $songTitle = '';
                if (preg_match('/<td class="song_name"[^>]*>(.*?)<\/td>/s', $tr, $m)) $songTitle = trim(strip_tags($m[1]));
                $artist = '';
                if (preg_match('/<td class="vocal_name"[^>]*>(.*?)<\/td>/s', $tr, $m)) $artist = trim(strip_tags($m[1]));
                if ($songTitle !== '') {
                    $type = 'OST';
                    if (stripos($typeText, 'OP') !== false || stripos($typeText, 'opening') !== false) $type = 'OP';
                    elseif (stripos($typeText, 'ED') !== false || stripos($typeText, 'ending') !== false) $type = 'ED';
                    $results[] = array(
                        'title' => $songTitle,
                        'artist' => ($artist !== '') ? $artist : 'Unknown Artist',
                        'type' => $type,
                        'tags' => array('Scraped'),
                        'animeName' => $animeName,
                    );
                }
            }
        }
        if (count($results) > 0) return $results;
    }
    return array();
}

function anidb_first_details_link($html) {
    if (preg_match('/<table[^>]*class="[^"]*animelist[^"]*"[^>]*>.*?<td class="name">\s*<a href="([^"]+)"/s', $html, $m)) return $m[1];
    if (preg_match('/<a href="(\/anime\/[^"]+)"/', $html, $m)) return $m[1];
    return null;
}

function scrape_anidb($animeName) {
    $variants = get_search_variants($animeName);
    foreach (array_slice($variants, 0, 3) as $query) {
        $searchUrl = 'https://anidb.net/anime/?adb.search=' . rawurlencode($query) . '&do.search=1';
        $html = fetch_with_encoding($searchUrl, 'utf-8');
        if ($html === '') continue;
        if (strpos($html, 'class="songlist"') === false && strpos($html, 'class="song"') === false) {
            $link = anidb_first_details_link($html);
            if ($link !== null) {
                $full = (strpos($link, 'http') === 0) ? $link : 'https://anidb.net' . $link;
                $detail = fetch_with_encoding($full, 'utf-8');
                if ($detail !== '') $html = $detail;
            }
        }
        $results = array();
        if (preg_match_all('/<tr[^>]*>(.*?)<\/tr>/s', $html, $rows)) {
            foreach ($rows[1] as $tr) {
                $typeText = '';
                if (preg_match('/<td class="type"[^>]*>(.*?)<\/td>/s', $tr, $m)) $typeText = trim(strip_tags($m[1]));
                $songTitle = '';
                if (preg_match('/<td class="name"[^>]*>(.*?)<\/td>/s', $tr, $m)) $songTitle = trim(strip_tags($m[1]));
                $artist = 'Various';
                if (preg_match('/<td class="creator"[^>]*>(.*?)<\/td>/s', $tr, $m)) {
                    $a = trim(strip_tags($m[1]));
                    if ($a !== '') $artist = $a;
                }
                if ($songTitle !== '') {
                    $type = 'OST';
                    if (stripos($typeText, 'OP') !== false || stripos($typeText, 'opening') !== false) $type = 'OP';
                    elseif (stripos($typeText, 'ED') !== false || stripos($typeText, 'ending') !== false) $type = 'ED';
                    $results[] = array(
                        'title' => $songTitle, 'artist' => $artist, 'type' => $type,
                        'tags' => array('AniDB'), 'animeName' => $animeName,
                    );
                }
            }
        }
        if (count($results) > 0) return $results;
    }
    return array();
}

function scrape_anidb_relations($animeName) {
    $variants = get_search_variants($animeName);
    foreach (array_slice($variants, 0, 3) as $query) {
        $searchUrl = 'https://anidb.net/anime/?adb.search=' . rawurlencode($query) . '&do.search=1';
        $html = fetch_with_encoding($searchUrl, 'utf-8');
        if ($html === '') continue;
        if (strpos($html, 'id="tab_relations"') === false && strpos($html, 'class="relations"') === false) {
            $link = anidb_first_details_link($html);
            if ($link !== null) {
                $full = (strpos($link, 'http') === 0) ? $link : 'https://anidb.net' . $link;
                $detail = fetch_with_encoding($full, 'utf-8');
                if ($detail !== '') $html = $detail;
            }
        }
        $relations = array();
        if (preg_match_all('/<tr[^>]*>(.*?)<\/tr>/s', $html, $rows)) {
            foreach ($rows[1] as $tr) {
                $type = '';
                if (preg_match('/<th[^>]*>(.*?)<\/th>/s', $tr, $m)) $type = trim(strip_tags($m[1]));
                $title = ''; $url = null;
                if (preg_match('/<td class="name"[^>]*>\s*<a href="([^"]+)"[^>]*>(.*?)<\/a>/s', $tr, $m)) {
                    $url = $m[1]; $title = trim(strip_tags($m[2]));
                }
                if ($title !== '' && $type !== '' && $type !== 'Type') {
                    $relations[] = array(
                        'title' => $title,
                        'type' => rtrim($type, ':'),
                        'url' => $url === null ? null : ((strpos($url, 'http') === 0) ? $url : 'https://anidb.net' . $url),
                    );
                }
            }
        }
        if (count($relations) > 0) return $relations;
    }
    return array();
}

function scrape_vgmdb_tracklists($animeName) {
    $variants = get_search_variants($animeName);
    foreach (array_slice($variants, 0, 2) as $query) {
        $searchUrl = 'https://vgmdb.net/search?q=' . rawurlencode($query);
        $html = fetch_with_encoding($searchUrl, 'utf-8');
        if ($html === '') continue;
        $verifiedTracks = array();
        $isAlbumPage = (strpos($html, 'id="tracklist"') !== false);

        if ($isAlbumPage) {
            $albumTitle = $animeName;
            if (preg_match('/<h1[^>]*>(.*?)<\/h1>/s', $html, $m)) $albumTitle = trim(strip_tags($m[1]));
            $catalog = '';
            if (preg_match('/<span class="smalltext"[^>]*>(.*?)<\/span>/s', $html, $m)) $catalog = trim(strip_tags($m[1]));
            an_vgmdb_parse_tracklist($html, $albumTitle, $catalog, $verifiedTracks);
        } else {
            $albums = array();
            if (preg_match_all('/<a href="(\/album\/[^"]+)"[^>]*>(.*?)<\/a>/s', $html, $m)) {
                for ($i = 0; $i < count($m[1]); $i++) {
                    $albums[] = array('title' => trim(strip_tags($m[2][$i])), 'url' => 'https://vgmdb.net' . $m[1][$i], 'catalog' => '');
                }
            }
            $relevant = array();
            foreach ($albums as $a) {
                $t = strtolower($a['title']);
                if (strpos($t, 'soundtrack') !== false || strpos($t, 'ost') !== false || strpos($t, 'original') !== false) $relevant[] = $a;
            }
            if (count($relevant) === 0) $relevant = array_slice($albums, 0, 3);
            $relevant = array_slice($relevant, 0, 3);
            foreach ($relevant as $album) {
                $albumHtml = fetch_with_encoding($album['url'], 'utf-8');
                if ($albumHtml === '') continue;
                $category = '';
                if (preg_match('/Category<\/[^>]+>.*?<td[^>]*>(.*?)<\/td>/is', $albumHtml, $m)) {
                    $category = strtolower(trim(strip_tags($m[1])));
                }
                if (strpos($category, 'game') !== false && strpos($category, 'animation') === false) continue;
                an_vgmdb_parse_tracklist($albumHtml, $album['title'], '', $verifiedTracks);
            }
        }
        if (count($verifiedTracks) > 0) return $verifiedTracks;
    }
    return array();
}

function an_vgmdb_parse_tracklist($html, $albumTitle, $catalog, &$out) {
    if (!preg_match('/<table[^>]*id="tracklist"[^>]*>(.*?)<\/table>/s', $html, $tm)) return;
    if (preg_match_all('/<tr[^>]*>(.*?)<\/tr>/s', $tm[1], $rows)) {
        foreach ($rows[1] as $tr) {
            $cells = array();
            if (preg_match_all('/<t[dh][^>]*>(.*?)<\/t[dh]>/s', $tr, $cm)) {
                foreach ($cm[1] as $c) $cells[] = trim(strip_tags($c));
            }
            if (count($cells) < 2) continue;
            $trackNum = $cells[0];
            $trackTitle = $cells[1];
            $trackTitle = preg_replace('/^\d+[\s.\-_]+/', '', $trackTitle);
            if ($trackTitle !== '' && stripos($trackTitle, 'track list') === false && strlen($trackTitle) >= 2) {
                $out[] = array(
                    'albumTitle' => $albumTitle,
                    'catalog' => $catalog,
                    'trackNum' => $trackNum,
                    'title' => $trackTitle,
                    'source' => 'VGMdb',
                );
            }
        }
    }
}

// ===========================================================================
// Tag Generator & Heuristics
// ===========================================================================
$GLOBALS['_SONG_KEYWORD_RULES'] = array(
    array('keywords' => array('rock', 'guitar', 'band', 'drums', 'riff'), 'tag' => 'Rock'),
    array('keywords' => array('metal', 'heavy', 'screamo', 'breakdown', 'distortion'), 'tag' => 'Metal'),
    array('keywords' => array('orchestra', 'symphony', 'philharmonic', 'strings', 'cello', 'violin'), 'tag' => 'Orchestral'),
    array('keywords' => array('piano', 'acoustic', 'unplugged', 'stripped'), 'tag' => 'Acoustic'),
    array('keywords' => array('electronic', 'synth', 'techno', 'edm', 'digital'), 'tag' => 'Electronic'),
    array('keywords' => array('jazz', 'swing', 'blues', 'brass', 'saxophone'), 'tag' => 'Jazz'),
    array('keywords' => array('hip hop', 'hip-hop', 'rap', 'beat'), 'tag' => 'Hip-Hop'),
    array('keywords' => array('dance', 'club', 'disco', 'house'), 'tag' => 'Dance'),
    array('keywords' => array('folk', 'acoustic guitar', 'country'), 'tag' => 'Folk'),
    array('keywords' => array('pop', 'catchy', 'hook'), 'tag' => 'Pop'),
    array('keywords' => array('ambient', 'atmospheric', 'soundscape', 'drone'), 'tag' => 'Ambient'),
    array('keywords' => array('funk', 'groove', 'bass line'), 'tag' => 'Funk'),
    array('keywords' => array('punk', 'fast', 'short', 'raw'), 'tag' => 'Punk'),
    array('keywords' => array('hikari', 'light', 'hero', 'rise', 'stand up', 'fight', 'break through'), 'tag' => 'Uplifting'),
    array('keywords' => array('kanashimi', 'sad', 'tears', 'namida', 'cry', 'goodbye', 'sayonara', 'lost'), 'tag' => 'Sad'),
    array('keywords' => array('tatakai', 'battle', 'war', 'fight', 'attack', 'charge', 'assault'), 'tag' => 'Epic'),
    array('keywords' => array('love', 'ai', 'koi', 'romance', 'heart', 'kiss', 'together'), 'tag' => 'Romantic'),
    array('keywords' => array('yume', 'dream', 'fantasy', 'imagine'), 'tag' => 'Dreamy'),
    array('keywords' => array('kurai', 'dark', 'shadow', 'night', 'abyss', 'despair'), 'tag' => 'Dark'),
    array('keywords' => array('hope', 'ashita', 'tomorrow', 'future', 'mirai'), 'tag' => 'Hopeful'),
    array('keywords' => array('natsukashii', 'memory', 'memories', 'nostalgia', 'past', 'remember'), 'tag' => 'Nostalgic'),
    array('keywords' => array('tanoshii', 'fun', 'party', 'celebrate', 'carnival'), 'tag' => 'Playful'),
    array('keywords' => array('fushigi', 'mystery', 'enigma', 'secret'), 'tag' => 'Mysterious'),
    array('keywords' => array('ikari', 'rage', 'anger', 'fury', 'hate'), 'tag' => 'Aggressive'),
    array('keywords' => array('shizuka', 'quiet', 'calm', 'peaceful', 'serene', 'gentle'), 'tag' => 'Serene'),
    array('keywords' => array('victory', 'win', 'champion', 'triumph', 'crown'), 'tag' => 'Triumphant'),
    array('keywords' => array('bittersweet', 'setsunai', 'longing', 'yearning'), 'tag' => 'Bittersweet'),
    array('keywords' => array('hype', 'exciting', 'thrilling', 'adrenaline'), 'tag' => 'Hype'),
    array('keywords' => array('brooding', 'ominous', 'foreboding'), 'tag' => 'Brooding'),
    array('keywords' => array('anthem', 'rally', 'unite', 'together we'), 'tag' => 'Anthemic'),
    array('keywords' => array('tense', 'suspense', 'danger', 'threat'), 'tag' => 'Tense'),
    array('keywords' => array('whimsical', 'playful', 'quirky', 'silly'), 'tag' => 'Whimsical'),
    array('keywords' => array('melancholy', 'melancholic', 'wistful', 'pensive'), 'tag' => 'Melancholic'),
    array('keywords' => array('fast', 'rapid', 'speed', 'rush', 'sprint'), 'tag' => 'Fast'),
    array('keywords' => array('slow', 'ballad', 'lullaby', 'gentle pace'), 'tag' => 'Slow'),
    array('keywords' => array('upbeat', 'lively', 'bouncy'), 'tag' => 'Upbeat'),
    array('keywords' => array('driving', 'pounding', 'relentless'), 'tag' => 'Driving'),
    array('keywords' => array('ballad', 'slow dance', 'love song'), 'tag' => 'Ballad'),
    array('keywords' => array('instrumental', 'no vocal', 'bgm', 'background music', 'off vocal'), 'tag' => 'Instrumental'),
    array('keywords' => array('choir', 'chorus', 'chorale', 'ensemble'), 'tag' => 'Choir'),
    array('keywords' => array('duet', 'duo', 'featuring', 'feat.'), 'tag' => 'Duet'),
    array('keywords' => array('rap', 'flow', 'mc'), 'tag' => 'Rap'),
    array('keywords' => array('screamo', 'scream', 'growl', 'harsh vocal'), 'tag' => 'Screamo'),
    array('keywords' => array('falsetto', 'high voice', 'soaring'), 'tag' => 'Falsetto'),
);

$GLOBALS['_LASTFM_TAG_MAP'] = array(
    'rock' => 'Rock', 'alternative rock' => 'Alternative', 'indie rock' => 'Indie',
    'punk' => 'Punk', 'punk rock' => 'Punk', 'metal' => 'Metal', 'heavy metal' => 'Metal',
    'power metal' => 'Power Metal', 'death metal' => 'Metal', 'black metal' => 'Metal',
    'progressive rock' => 'Progressive Rock', 'prog rock' => 'Progressive Rock',
    'pop' => 'Pop', 'j-pop' => 'J-Pop', 'japanese pop' => 'J-Pop',
    'j-rock' => 'J-Rock', 'japanese rock' => 'J-Rock',
    'anime' => 'Anisong', 'anisong' => 'Anisong', 'anime op' => 'Anisong',
    'electronic' => 'Electronic', 'electronica' => 'Electronic', 'edm' => 'Electronic',
    'synth' => 'Synth', 'synthpop' => 'Synth', 'synthwave' => 'Synth',
    'dance' => 'Dance', 'house' => 'Dance', 'techno' => 'Dance',
    'orchestral' => 'Orchestral', 'classical' => 'Classical', 'symphony' => 'Orchestral',
    'soundtrack' => 'Orchestral', 'score' => 'Orchestral',
    'acoustic' => 'Acoustic', 'unplugged' => 'Acoustic',
    'jazz' => 'Jazz', 'smooth jazz' => 'Jazz', 'jazz fusion' => 'Jazz',
    'hip hop' => 'Hip-Hop', 'hip-hop' => 'Hip-Hop', 'rap' => 'Hip-Hop', 'r&b' => 'R&B',
    'rnb' => 'R&B', 'soul' => 'R&B', 'folk' => 'Folk', 'folk rock' => 'Folk',
    'funk' => 'Funk', 'ska' => 'Ska', 'blues' => 'Blues', 'country' => 'Country',
    'indie' => 'Indie', 'indie pop' => 'Indie', 'visual kei' => 'Visual Kei',
    'visual kei rock' => 'Visual Kei', 'ambient' => 'Ambient', 'shoegaze' => 'Ambient',
    'energetic' => 'Energetic', 'energetic rock' => 'Energetic',
    'melancholic' => 'Melancholic', 'melancholy' => 'Melancholic',
    'sad' => 'Sad', 'depressing' => 'Sad', 'happy' => 'Uplifting', 'upbeat' => 'Upbeat',
    'epic' => 'Epic', 'cinematic' => 'Epic', 'aggressive' => 'Aggressive', 'intense' => 'Intense',
    'dark' => 'Dark', 'gothic' => 'Dark', 'dreamy' => 'Dreamy', 'ethereal' => 'Dreamy',
    'romantic' => 'Romantic', 'love' => 'Romantic', 'nostalgic' => 'Nostalgic', 'nostalgia' => 'Nostalgic',
    'chill' => 'Chill', 'chillout' => 'Chill', 'relaxing' => 'Chill',
    'playful' => 'Playful', 'fun' => 'Playful', 'mysterious' => 'Mysterious', 'trippy' => 'Mysterious',
    'whimsical' => 'Whimsical', 'anthemic' => 'Anthemic', 'anthem' => 'Anthemic',
    'triumphant' => 'Triumphant', 'victorious' => 'Triumphant',
    'hopeful' => 'Hopeful', 'inspiring' => 'Hopeful', 'bittersweet' => 'Bittersweet',
    'tense' => 'Tense', 'suspenseful' => 'Tense', 'brooding' => 'Brooding',
    'serene' => 'Serene', 'peaceful' => 'Serene', 'hype' => 'Hype', 'hype rock' => 'Hype',
);

function fetch_lastfm_tags($title, $artist) {
    $cacheKey = 'lastfmtags:' . md5(strtolower($title . '_' . $artist));
    $cached = cache_get($cacheKey);
    if ($cached !== null) return $cached;
    if (LASTFM_API_KEY === '') return array();
    $data = lastfm_call('track.gettoptags', array('artist' => $artist, 'track' => $title, 'autocorrect' => '1'));
    if ($data === null || !isset($data['toptags']['tag'])) return array();
    $raw = $data['toptags']['tag'];
    if (isset($raw['name'])) $raw = array($raw);
    $tags = array();
    foreach (array_slice($raw, 0, 10) as $t) {
        if (isset($t['name'])) $tags[] = strtolower(trim($t['name']));
    }
    cache_set($cacheKey, $tags, 3600000);
    return $tags;
}

function generate_song_tags($title, $artist, $animeName, $type) {
    $tags = array(); $seen = array();
    $combined = strtolower($title . ' ' . $artist . ' ' . $animeName);
    foreach ($GLOBALS['_SONG_KEYWORD_RULES'] as $rule) {
        foreach ($rule['keywords'] as $kw) {
            if (strpos($combined, $kw) !== false) {
                if (!isset($seen[$rule['tag']])) { $seen[$rule['tag']] = true; $tags[] = $rule['tag']; }
                break;
            }
        }
    }
    $artistLower = strtolower((string)$artist);
    if (strpos($artistLower, 'band') !== false || strpos($artistLower, 'project') !== false || strpos($artistLower, 'crew') !== false) {
        if (!isset($seen['Rock'])) { $seen['Rock'] = true; $tags[] = 'Rock'; }
    }
    if (preg_match('/[\x{3040}-\x{30ff}\x{4e00}-\x{9faf}]/u', (string)$artist)) {
        if (isset($seen['Rock']) && !isset($seen['J-Rock'])) { $seen['J-Rock'] = true; $tags[] = 'J-Rock'; }
        if (isset($seen['Pop']) && !isset($seen['J-Pop'])) { $seen['J-Pop'] = true; $tags[] = 'J-Pop'; }
    }
    if (strpos($combined, 'opening') !== false || strpos($combined, 'op ') !== false || strpos($combined, 'theme') !== false) {
        if (!isset($seen['Anisong'])) { $seen['Anisong'] = true; $tags[] = 'Anisong'; }
    }
    $female = array('liSA', 'Aimer', 'Reona', 'Eir Aoi', 'ClariS', 'Roselia', 'Mika Nakashima', 'Kana Nishino', 'yoasobi', 'Yorushika', 'ZUTOMAYO', 'milet', 'Hikaru Utada', 'Nana Mizuki');
    $male = array('ONE OK ROCK', 'MAN WITH A MISSION', 'UVERworld', 'ASIAN KUNG-FU', 'FLOW', 'KANA-BOON', 'Kenshi Yonezu', 'T.M.Revolution', 'Hiroyuki Sawano', 'Ling Tosite Sigure', 'The Oral Cigarettes');
    $group = array('band', 'project', 'crew', 'collective', 'ClariS', 'Roselia', 'Yoasobi', 'Yorushika', 'ZUTOMAYO', 'BUMP OF CHICKEN');
    foreach ($female as $f) { if (strpos((string)$artist, $f) !== false && !isset($seen['Female Vocal'])) { $seen['Female Vocal'] = true; $tags[] = 'Female Vocal'; break; } }
    foreach ($male as $m) { if (strpos((string)$artist, $m) !== false && !isset($seen['Male Vocal'])) { $seen['Male Vocal'] = true; $tags[] = 'Male Vocal'; break; } }
    foreach ($group as $g) { if (strpos((string)$artist, $g) !== false && !isset($seen['Group Vocal'])) { $seen['Group Vocal'] = true; $tags[] = 'Group Vocal'; break; } }
    if (strpos($artistLower, 'feat.') !== false || strpos($artistLower, ' & ') !== false || strpos($artistLower, ' vs ') !== false) {
        if (!isset($seen['Duet'])) { $seen['Duet'] = true; $tags[] = 'Duet'; }
    }
    $rawTags = fetch_lastfm_tags($title, $artist);
    foreach ($rawTags as $raw) {
        if (isset($GLOBALS['_LASTFM_TAG_MAP'][$raw])) {
            $mapped = $GLOBALS['_LASTFM_TAG_MAP'][$raw];
            if (!isset($seen[$mapped])) { $seen[$mapped] = true; $tags[] = $mapped; }
        }
    }
    if (count($tags) === 0) $tags = array('Hype');
    return array_slice($tags, 0, 8);
}

// ===========================================================================
// Theme Fetchers
// ===========================================================================
function fetch_themes_jikan($mal_id, $animeName) {
    $data = jikan_get('/anime/' . (int)$mal_id . '/themes', 8);
    $results = array();
    if ($data !== null && isset($data['data'])) {
        $results = an_parse_jikan_theme_strings($data['data'], $animeName);
        if (count($results) > 0) return $results;
    }
    $data2 = jikan_get('/anime/' . (int)$mal_id, 8);
    if ($data2 !== null && isset($data2['data'])) {
        $results = an_parse_jikan_theme_strings($data2['data'], $animeName);
        if (count($results) > 0) return $results;
    }
    return null;
}

function an_parse_jikan_theme_strings($data, $animeName) {
    $results = array();
    foreach (array('openings' => 'OP', 'endings' => 'ED') as $key => $type) {
        if (isset($data[$key]) && is_array($data[$key])) {
            foreach (array_slice($data[$key], 0, 5) as $entry) {
                $title = null; $artist = null;
                if (preg_match('/"([^"]+)"\s*(?:by\s+(.*?)(?:\s+\(eps|$))?/i', (string)$entry, $m)) {
                    $title = ($m[1] !== '') ? $m[1] : 'Unknown Theme';
                    $artist = (isset($m[2]) && $m[2] !== '') ? $m[2] : 'Unknown Artist';
                }
                if ($title !== null) {
                    $results[] = array(
                        'title' => trim($title), 'artist' => trim($artist), 'type' => $type,
                        'tags' => array('Hype'), 'animeName' => trim($animeName),
                    );
                }
            }
        }
    }
    return $results;
}

function fetch_themes_animethemes_moe($animeName) {
    $data = animethemes_search($animeName, 5);
    if ($data === null || !isset($data['anime']) || !is_array($data['anime']) || count($data['anime']) === 0) return null;
    $lower = strtolower(trim($animeName));
    $anime = $data['anime'][0];
    foreach ($data['anime'] as $a) {
        if (isset($a['name']) && strtolower(trim($a['name'])) === $lower) { $anime = $a; break; }
    }
    $results = array();
    if (isset($anime['animethemes']) && is_array($anime['animethemes'])) {
        foreach ($anime['animethemes'] as $t) {
            $type = 'OST';
            if (isset($t['type']) && $t['type'] === 'ED') $type = 'ED';
            elseif (isset($t['type']) && $t['type'] === 'OP') $type = 'OP';
            $songTitle = 'Unknown Theme';
            if (isset($t['song']['title'])) $songTitle = $t['song']['title'];
            $artistName = 'Unknown Artist';
            if (isset($t['song']['artists']) && is_array($t['song']['artists'])) {
                $names = array();
                foreach ($t['song']['artists'] as $art) {
                    $n = isset($art['name']) ? $art['name'] : (isset($art['as']) ? $art['as'] : '');
                    if ($n !== '') $names[] = $n;
                }
                if (count($names) > 0) $artistName = implode(', ', $names);
            }
            $results[] = array(
                'title' => trim($songTitle), 'artist' => trim($artistName), 'type' => $type,
                'tags' => array('Hype'),
                'animeName' => isset($anime['name']) ? trim($anime['name']) : trim($animeName),
            );
        }
    }
    return count($results) > 0 ? $results : null;
}

function get_theme_templates($animeName) {
    $clean = trim($animeName);
    return array(
        array('title' => $clean . ' - Opening Theme (OP 1)', 'artist' => 'Original Artist', 'type' => 'OP', 'tags' => array('Hype', 'Vocal'), 'animeName' => $clean),
        array('title' => $clean . ' - Ending Theme (ED 1)', 'artist' => 'Original Artist', 'type' => 'ED', 'tags' => array('Melodic', 'Chill'), 'animeName' => $clean),
        array('title' => $clean . ' - Main Sound Theme (OST)', 'artist' => 'Soundtrack Composer', 'type' => 'OST', 'tags' => array('Epic', 'Instrumental'), 'animeName' => $clean),
    );
}

function fetch_anime_themes_for_bulk($animeName, $mal_id) {
    $cacheKey = 'themesraw:' . strtolower(trim($animeName));
    $cached = cache_get($cacheKey);
    if ($cached !== null) return $cached;
    $moe = fetch_themes_animethemes_moe($animeName);
    if ($moe !== null && count($moe) > 0) { cache_set($cacheKey, $moe, 3600000); return $moe; }
    if ($mal_id) {
        $jikan = fetch_themes_jikan($mal_id, $animeName);
        if ($jikan !== null && count($jikan) > 0) { cache_set($cacheKey, $jikan, 3600000); return $jikan; }
    } else {
        foreach (array_slice(get_search_variants($animeName), 0, 3) as $query) {
            $d = jikan_get('/anime?q=' . rawurlencode($query) . '&limit=1', 8);
            if ($d !== null && isset($d['data'][0]['mal_id'])) {
                $jikan = fetch_themes_jikan($d['data'][0]['mal_id'], isset($d['data'][0]['title']) ? $d['data'][0]['title'] : $animeName);
                if ($jikan !== null && count($jikan) > 0) { cache_set($cacheKey, $jikan, 3600000); return $jikan; }
            }
            usleep(400000);
        }
    }
    $anison = scrape_anison($animeName);
    if (count($anison) > 0) { cache_set($cacheKey, $anison, 3600000); return $anison; }
    $anidb = scrape_anidb($animeName);
    if (count($anidb) > 0) { cache_set($cacheKey, $anidb, 3600000); return $anidb; }
    return get_theme_templates($animeName);
}

// ===========================================================================
// Fan-First Scoring & Lexicon Rules
// ===========================================================================
function an_fan_is_official($author) {
    $a = strtolower((string)$author);
    if ($a === '') return false;
    if (strpos($a, '- topic') !== false || strpos($a, '– topic') !== false) return true;
    if (strpos($a, 'vevo') !== false) return true;
    if (strpos($a, 'official') !== false) return true;
    if (strpos($a, '公式') !== false) return true;
    $labels = array(
        'lantis', 'sony music', 'avex', 'pony canyon', 'aniplex',
        'crunchyroll', 'toho', 'nbcuniversal', 'nippon columbia', 'columbia music',
        'frontier works', 'marvelous', 'flying dog', 'flyingdog', 'j storm',
        'warner music', 'universal music', 'music japan', 'king records',
        'kings records', 'japan records', 'sacra music', 'smr', 'sony',
        'shueisha', 'kodansha', 'tv tokyo', 'records', 'record company',
    );
    foreach ($labels as $l) { if (strpos($a, $l) !== false) return true; }
    return false;
}

function an_fan_bonus($author, $itemTitle) {
    $b = 0;
    if (an_fan_is_official($author)) $b -= 420;
    else $b += 120;
    $t = strtolower((string)$itemTitle);
    if ($t !== '') {
        if (strpos($t, 'full song') !== false || strpos($t, 'full version') !== false) $b += 60;
        elseif (preg_match('/\bfull\b/', $t)) $b += 30;
        if (strpos($t, 'lyrics') !== false || strpos($t, 'lyric') !== false) $b += 30;
        if (preg_match('/\bamv\b|\bmad\b/', $t)) $b += 25;
        if (strpos($t, 'creditless') !== false) $b += 25;
        if (strpos($t, 'official video') !== false || strpos($t, 'official mv') !== false
            || strpos($t, 'official audio') !== false || strpos($t, 'official music') !== false) $b -= 40;
    }
    return $b;
}

function an_derivative_lexicon() {
    $audio = array(
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
    );
    $length = array(
        'tv size', 'tv-size', 'tv ver', 'tv ver.', 'tv version', 'tv edit',
        'tv limited', 'tv length', 'tv-size ver', 'short ver', 'short version',
        'short edit', 'radio edit', 'tv版', 'ショートver',
    );
    return array('audio' => $audio, 'length' => $length);
}

function an_derivative_hit($text) {
    $t = ' ' . strtolower((string)$text) . ' ';
    if ($t === '  ') return '';
    $lex = an_derivative_lexicon();
    foreach (array('audio', 'length') as $tier) {
        foreach ($lex[$tier] as $marker) {
            $m = strtolower($marker);
            if ($m === '') continue;
            if (preg_match('/^[a-z0-9 ]+$/', $m) && strlen(str_replace(' ', '', $m)) < 9 && strpos($m, ' ') === false) {
                if (preg_match('/\b' . preg_quote($m, '/') . '(s|es|ed|ing|er|version)?\b/', $t)) return $tier;
            } else {
                if (strpos($t, $m) !== false) return $tier;
            }
        }
    }
    return '';
}

function an_strip_derivative_markers($title) {
    $t = (string)$title;
    if ($t === '') return '';
    $t = preg_replace_callback('/\([^)]{0,60}\)|\[[^\]]{0,60}\]|【[^】]{0,60}】|<[^>]{0,60}>/u',
        function ($m) { return an_derivative_hit($m[0]) !== '' ? ' ' : $m[0]; }, $t);
    $lex = an_derivative_lexicon();
    foreach (array('audio', 'length') as $tier) {
        foreach ($lex[$tier] as $marker) {
            $m = strtolower($marker);
            if ($m === '') continue;
            if (preg_match('/^[a-z0-9 ]+$/', $m) && strpos($m, ' ') === false && strlen($m) < 9) {
                $t = preg_replace('/\b' . preg_quote($m, '/') . '(s|es|ed|ing|er|version)?\b/i', ' ', $t);
            } else {
                $t = preg_replace('/' . preg_quote($m, '/') . '/i', ' ', $t);
            }
        }
    }
    $t = preg_replace('/\(\s*\)|\[\s*\]|【\s*】|<\s*>/u', ' ', $t);
    $t = preg_replace('/\bver\.?\b|\bversion\b/i', ' ', $t);
    $t = preg_replace('/\s{2,}/', ' ', $t);
    return trim($t, " \t\n\r\0\x0B-–—|·,:;");
}

function an_duration_score_adjust($durSec) {
    if ($durSec === null) return 0;
    if ($durSec >= 200) return 25;
    if ($durSec >= 150) return 10;
    if ($durSec >= 120) return -30;
    if ($durSec >= 85) return -120;
    return -200;
}

define('AN_POINTS_FLOOR', -400);

function an_points_rules() {
    return array(
        array('label' => 'full song',   'points' =>  60, 'markers' => array('full song', 'full version', 'full ver', 'フルバージョン', 'フルコーラス')),
        array('label' => 'full',        'points' =>  30, 'markers' => array('full')),
        array('label' => 'lyrics',      'points' =>  30, 'markers' => array('lyrics', 'lyric video', 'lyrics video')),
        array('label' => 'creditless',  'points' =>  25, 'markers' => array('creditless', 'creditsless', 'no credits', 'ノンクレジット')),
        array('label' => 'hd',          'points' =>  20, 'markers' => array('hd', '1080p', '720p', '60fps', '4k', 'uhd', '高画質')),
        array('label' => 'amv/mad fan edit', 'points' => 25, 'markers' => array('amv', 'mad', 'pmv', 'gmv')),
        array('label' => 'original',    'points' =>  15, 'markers' => array('original', 'オリジナル', 'original song', 'original pv', 'original mv')),
        array('label' => 'audio only',  'points' =>  10, 'markers' => array('audio', 'audio only', 'audio upload')),
        array('label' => 'theme',       'points' =>  10, 'markers' => array('theme', '主題歌')),
        array('label' => 'parody',      'points' => -300, 'markers' => array('parody', 'パロディ', 'parodie')),
        array('label' => 'trailer/teaser', 'points' => -250, 'markers' => array('trailer', 'teaser', '予告')),
        array('label' => 'preview',     'points' => -200, 'markers' => array('preview', 'snippet')),
        array('label' => 'subbed re-upload', 'points' => -150, 'markers' => array('subbed', 'subbed version', 'sub español', 'sub espanol')),
        array('label' => 'low quality', 'points' =>  -20, 'markers' => array('240p', '360p', '低画質')),
    );
}

function an_points_marker_hit($t, $marker) {
    $m = strtolower((string)$marker);
    if ($m === '') return false;
    if (preg_match('/^[a-z0-9]+$/', $m) && strlen($m) < 9) {
        return (bool)preg_match('/\b' . preg_quote($m, '/') . '(s|es|ed|ing|er|version)?\b/', $t);
    }
    return strpos($t, $m) !== false;
}

// ---- v12 SCORING: FAN-FIRST, ORIGINAL FULL SONGS ONLY (FIXES.md §18 spec).
// The previous body here had an inverted "OFFICIAL PREFERENCE" (+80 official /
// -30 fan) that contradicted the documented v11 points system — fan uploads
// are preferred (fan +120 / official -420), derivative recordings are
// hard-penalized below the floor (audio tier -1500, length tier -350), and
// the duration ladder matches §17.2.
function an_candidate_points($text, $author, $durSec) {
    $t = " " . strtolower((string)$text) . " ";
    $score = 0;
    $hits = array();

    // 1. Channel preference: fan upload +120, official/VEVO/Topic -420
    if ((string)$author !== "") {
        if (an_fan_is_official($author)) {
            $score -= 420;
            $hits[] = "official channel -420";
        } else {
            $score += 120;
            $hits[] = "fan upload +120";
        }
    }

    // 2. Positive/negative keyword rulebook (an_points_rules)
    foreach (an_points_rules() as $r) {
        $label = $r["label"];
        $pts = (int)$r["points"];
        foreach ($r["markers"] as $marker) {
            if (an_points_marker_hit($t, $marker)) {
                $score += $pts;
                $hits[] = $label . " " . ($pts >= 0 ? "+" : "") . $pts;
                break;
            }
        }
    }

    // 3. Derivative tiers — audio tier can never be out-scored (-1500);
    //    length tier is legal only as a last resort (-350).
    $tier = an_derivative_hit($text);
    if ($tier === "audio") {
        $score -= 1500;
        $hits[] = "cover/remix/derivative -1500";
    } elseif ($tier === "length") {
        $score -= 350;
        $hits[] = "tv size/short cut -350";
    }

    // 4. Duration ladder (only when a real duration is known — the resolver
    //    applies this AFTER the embed probe returns videoDetails.lengthSeconds).
    if ($durSec !== null) {
        $adj = an_duration_score_adjust($durSec);
        if ($adj !== 0) {
            $score += $adj;
            $hits[] = "duration " . ($adj >= 0 ? "+" : "") . $adj;
        }
    }

    return array("score" => $score, "hits" => $hits);
}

function score_video_result($itemTitle, $queryTitle, $queryType, $queryArtist, $queryAnime = '') {
    $normTitle = strtolower($itemTitle);
    $qTitleLower = strtolower($queryTitle);
    $qArtistLower = strtolower($queryArtist);
    $qAnimeLower = strtolower((string)$queryAnime);
    $score = 100;

    if (strpos($normTitle, $qTitleLower) !== false && $qTitleLower !== '') {
        $score += 150;
    } else {
        $queryWords = preg_split('/[\s,.\'"]+/', $qTitleLower, -1, PREG_SPLIT_NO_EMPTY);
        $matched = 0; $total = 0;
        foreach ($queryWords as $w) { if (strlen($w) > 2) { $total++; if (strpos($normTitle, $w) !== false) $matched++; } }
        if ($total > 0) $score += (int)floor(($matched / $total) * 80);
    }

    if ($qArtistLower !== '' && $qArtistLower !== 'unknown' && $qArtistLower !== 'unknown performer' && $qArtistLower !== 'various') {
        if (strpos($normTitle, $qArtistLower) !== false) { $score += 70; }
        else {
            $artistWords = preg_split('/[\s,.\'"]+/', $qArtistLower, -1, PREG_SPLIT_NO_EMPTY);
            $matched = 0; $total = 0;
            foreach ($artistWords as $w) { if (strlen($w) > 2) { $total++; if (strpos($normTitle, $w) !== false) $matched++; } }
            if ($total > 0) $score += (int)floor(($matched / $total) * 40);
        }
    }

    if ($qAnimeLower !== '' && strpos($normTitle, $qAnimeLower) !== false) {
        $score += 40;
    }

    $activeType = strtolower($queryType);
    if ($activeType === 'op' && (strpos($normTitle, 'op') !== false || strpos($normTitle, 'opening') !== false)) $score += 50;
    elseif ($activeType === 'ed' && (strpos($normTitle, 'ed') !== false || strpos($normTitle, 'ending') !== false)) $score += 50;
    elseif ($activeType === 'ost' && (strpos($normTitle, 'ost') !== false || strpos($normTitle, 'soundtrack') !== false || strpos($normTitle, 'bgm') !== false)) $score += 50;

    return $score;
}

function an_duration_seconds($dur) {
    $d = trim((string)$dur);
    if ($d === '' || $d === 'N/A' || !preg_match('/^\d{1,2}:\d{2}(?::\d{2})?$/', $d)) return null;
    $parts = explode(':', $d);
    $sec = 0;
    foreach ($parts as $p) { $sec = $sec * 60 + (int)$p; }
    return $sec;
}

function resolve_youtube_id($title, $artist, $animeName, $type, $excludedIds) {
    $cands = an_resolve_candidates($title, $artist, $animeName, $type, $excludedIds, 1);
    if (count($cands) === 0) return '';
    return $cands[0]['videoId'];
}

function resolve_youtube_best($title, $artist, $animeName, $type, $excludedIds) {
    $cands = an_resolve_candidates($title, $artist, $animeName, $type, $excludedIds, 1);
    if (count($cands) === 0) return null;
    return $cands[0];
}

// ---------------------------------------------------------------------------
// v12 RESILIENT CANDIDATE RESOLVER — REAL POINTS SYSTEM + EMBED VERIFICATION
// (rebuilds the engine documented in FIXES.md §17/§18 that was lost in the
// backup regression: the old body was a stub that returned the FIRST search
// result with a hardcoded score of 100 and points=["verified"], which is why
// link selection "didn't work as intended").
//
// Pipeline:
//   1. Sanitize the query (strip derivative markers — a TV-size repair must
//      search for the FULL song) and try up to two query variants.
//   2. Score every result: relevance (score_video_result) + points
//      (an_candidate_points — fan-first rulebook, derivative tiers, floor).
//   3. Drop below-AN_POINTS_FLOOR candidates BEFORE probing (covers, remixes
//      and english versions are never worth a probe).
//   4. Probe the top candidates with an_embed_probe (oEmbed + InnerTube +
//      Data API, SQLite-cached) — only state=ok links are returned, enriched
//      with REAL duration/author/title from videoDetails.
//   5. Sort by final score (duration ladder applied post-probe) and return
//      a transparent per-candidate receipt in `points`.
// ---------------------------------------------------------------------------
define('AN_CANDIDATE_PROBE_POOL', 8);

function an_resolve_candidates($title, $artist, $animeName, $type, $excludedIds, $maxCandidates = 10) {
    $cleanTitle = trim(an_strip_derivative_markers($title));
    if ($cleanTitle === "") $cleanTitle = trim((string)$title);
    $cleanArtist = trim((string)$artist);
    if ($cleanArtist === "Unknown" || $cleanArtist === "Various") $cleanArtist = "";

    // Query variants: natural first, anime-anchored fallback. The query is
    // NOT suffixed with " full song" — the rulebook rewards that marker in
    // result titles instead of biasing the search itself.
    $queries = array();
    $q = trim($cleanTitle . " " . $cleanArtist);
    if ($q !== "") $queries[] = $q;
    $q2 = trim((string)$animeName . " " . $cleanTitle);
    if ($q2 !== "" && $q2 !== $q) $queries[] = $q2;
    if (count($queries) === 0) $queries[] = trim((string)$animeName . " " . trim((string)$title));
    if (count($queries) === 0) return array();

    $excludedMap = array();
    if (is_array($excludedIds)) {
        foreach ($excludedIds as $ex) {
            if (is_string($ex) && $ex !== "") $excludedMap[$ex] = true;
        }
    }

    $ranked = array();
    $seen = array();
    foreach (array_slice($queries, 0, 2) as $query) {
        $res = yt_search($query, 15);
        $videos = isset($res["videos"]) ? $res["videos"] : array();
        foreach ($videos as $v) {
            $vid = isset($v["videoId"]) ? $v["videoId"] : "";
            $vtitle = isset($v["title"]) ? (string)$v["title"] : "";
            $vauthor = isset($v["author"]) ? (string)$v["author"] : "";
            if ($vid === "" || $vid === "Fve_l8I0Ayk") continue;
            if (isset($seen[$vid]) || isset($excludedMap[$vid])) continue;
            $seen[$vid] = true;

            $pts = an_candidate_points($vtitle, $vauthor, null);
            $score = score_video_result($vtitle, $cleanTitle, (string)$type, $cleanArtist, (string)$animeName)
                   + (int)$pts["score"];
            $ranked[] = array(
                "videoId" => $vid,
                "title" => $vtitle,
                "author" => $vauthor,
                "score" => $score,
                "points" => $pts["hits"],
                "duration" => null,
                "state" => "unverified",
                "via" => "direct",
                "verified" => false,
                "geo" => false,
            );
        }
        // First query variant produced a usable pool — skip the fallback
        // variant (saves one outbound search on the NAS).
        if (count($ranked) >= AN_CANDIDATE_PROBE_POOL) break;
    }
    if (count($ranked) === 0) return array();

    // Below-floor candidates are dropped BEFORE probing (v11: the -1500
    // audio-derivative penalty can never be out-scored, so covers, remixes,
    // nightcore, live takes and language variants are never even checked).
    $pool = array();
    foreach ($ranked as $c) {
        if ((int)$c["score"] >= AN_POINTS_FLOOR) $pool[] = $c;
    }
    if (count($pool) === 0) return array();

    an_usort_desc($pool, "score");
    $probeCount = max(AN_CANDIDATE_PROBE_POOL, (int)$maxCandidates);
    if ($probeCount > count($pool)) $probeCount = count($pool);
    $probeIds = array();
    foreach (array_slice($pool, 0, $probeCount) as $c) $probeIds[] = $c["videoId"];

    // ---- embeddability verification (batched + SQLite-cached) ----
    $verdicts = an_embed_probe($probeIds);

    $out = array();
    foreach ($pool as $c) {
        $vid = $c["videoId"];
        $v = isset($verdicts[$vid]) ? $verdicts[$vid] : null;
        // Only probe-confirmed playable links are ever returned — an
        // unverified pick is exactly the "broken link selection" bug.
        if ($v === null || !is_array($v) || (isset($v["state"]) ? $v["state"] : "") !== "ok") continue;

        // Real metadata from the InnerTube player payload: duration ladder,
        // canonical author/title (Data API search returns "N/A" durations).
        $it = isset($v["innertube"]) && is_array($v["innertube"]) ? $v["innertube"] : null;
        $durSec = null;
        if ($it !== null && isset($it["length"]) && is_numeric($it["length"])) {
            $durSec = (int)$it["length"];
            $c["duration"] = $durSec;
            $adj = an_duration_score_adjust($durSec);
            if ($adj !== 0) {
                $c["score"] += $adj;
                $c["points"][] = "duration " . ($adj >= 0 ? "+" : "") . $adj;
            }
            if (isset($it["author"]) && (string)$it["author"] !== "") $c["author"] = (string)$it["author"];
            if (isset($it["title"]) && (string)$it["title"] !== "") $c["title"] = (string)$it["title"];
        }

        $c["state"] = "ok";
        $c["via"] = isset($v["via"]) ? $v["via"] : "embed";
        $c["verified"] = true;
        $c["geo"] = !empty($v["geo"]);
        $c["points"][] = "verified via " . $c["via"];
        $out[] = $c;
    }

    // Final ordering with duration points included, then trim to request.
    an_usort_desc($out, "score");
    return array_slice($out, 0, max(1, (int)$maxCandidates));
}

function an_usort_desc(&$arr, $key) {
    $cmp = function ($a, $b) use ($key) {
        if ((int)$b[$key] == (int)$a[$key]) return 0;
        return ((int)$b[$key] > (int)$a[$key]) ? 1 : -1;
    };
    usort($arr, $cmp);
}

// ===========================================================================
// Multi-Signal Embed Health Probers
// ===========================================================================
function an_embed_feedback_table() {
    static $done = false;
    if ($done) return;
    try {
        db()->exec('CREATE TABLE IF NOT EXISTS embed_feedback (
            yt_id                TEXT PRIMARY KEY,
            error_code           INTEGER NOT NULL DEFAULT 0,
            reports              INTEGER NOT NULL DEFAULT 1,
            first_reported_at    INTEGER NOT NULL,
            last_reported_at     INTEGER NOT NULL)');
    } catch (Exception $e) {}
    $done = true;
}

function an_embed_feedback_record($ytId, $code) {
    an_embed_feedback_table();
    $now = now_ms();
    try {
        db_run('INSERT INTO embed_feedback (yt_id, error_code, reports, first_reported_at, last_reported_at)
                VALUES (?, ?, 1, ?, ?)
                ON CONFLICT(yt_id) DO UPDATE SET error_code = excluded.error_code,
                    reports = reports + 1, last_reported_at = excluded.last_reported_at',
            array($ytId, (int)$code, $now, $now));
        db_run('DELETE FROM api_cache WHERE key = ?', array('embprobe:' . $ytId));
    } catch (Exception $e) {}
}

function an_embed_feedback_recent() {
    an_embed_feedback_table();
    $map = array();
    try {
        $cutoff = now_ms() - 14 * 86400000;
        foreach (db_all('SELECT yt_id, last_reported_at FROM embed_feedback WHERE last_reported_at >= ?', array($cutoff)) as $r) {
            $map[$r['yt_id']] = (int)$r['last_reported_at'];
        }
    } catch (Exception $e) {}
    return $map;
}

function an_oembed_state($status) {
    if ($status === 200) return 'ok';
    if ($status === 400 || $status === 404) return 'dead';
    if ($status === 401) return 'embed-blocked';
    return 'unknown';
}

function an_verify_embeddable_multi($ids, $timeout = 6) {
    $out = array();
    $todo = array();
    $unique = array();
    foreach ($ids as $id) {
        if (!is_string($id) || $id === '' || isset($unique[$id])) continue;
        $unique[$id] = true;
    }
    $idList = array_keys($unique);

    foreach ($idList as $id) {
        $cached = cache_get('embverify:' . $id);
        if (is_array($cached) && isset($cached['state'])) {
            $out[$id] = $cached;
        } else {
            $todo[] = $id;
        }
    }

    if (count($todo) > 0) {
        $urls = array();
        foreach ($todo as $id) {
            $urls[] = 'https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D' . rawurlencode($id) . '&format=json';
        }
        $responses = an_curl_multi($urls, $timeout);
        foreach ($todo as $i => $id) {
            $status = isset($responses[$i]['status']) ? (int)$responses[$i]['status'] : 0;
            $state = an_oembed_state($status);
            $entry = array('status' => $status, 'state' => $state);
            $out[$id] = $entry;
            $ttl = 21600000;
            if ($state === 'dead' || $state === 'embed-blocked') $ttl = 86400000;
            elseif ($state === 'unknown') $ttl = 900000;
            cache_set('embverify:' . $id, $entry, $ttl);
        }
    }
    return $out;
}

function an_classify_embed($s) {
    // v12.1 rewrite — two holes found after field-testing against the NAS:
    //
    //   HOLE 1 (region/auth blocks audited as "ok"): InnerTube came back with
    //   playabilityStatus=ERROR and a generic reason ("Video unavailable") —
    //   none of the keyword branches matched, so the verdict fell through to
    //   the oEmbed 200 result and the video audited as playable. That is
    //   exactly the "exists but dies with an auth error in the player" class
    //   (e.g. o6wtDPVkKqI from a region-locked network). InnerTube is now
    //   AUTHORITATIVE: any non-OK verdict (except the bot wall) can never
    //   resolve to "ok".
    //
    //   HOLE 2 (browser feedback could condemn healthy videos): the browser
    //   report used to be the FIRST-priority signal. The v4-era patch
    //   reported errors blindly, so the table could poison good links for 14
    //   days. It is now a tie-breaker that only fires when every server
    //   probe returned no usable verdict.
    $oe   = isset($s['oembed']) ? $s['oembed'] : null;
    $it   = isset($s['innertube']) && is_array($s['innertube']) ? $s['innertube'] : null;
    $api  = isset($s['api']) && is_array($s['api']) ? $s['api'] : null;
    $rep  = !empty($s['reported']);

    $itStatus = $it ? (string)(isset($it['status']) ? $it['status'] : '') : '';
    $itReason = $it ? (string)(isset($it['reason']) ? $it['reason'] : '') : '';
    $itLow    = strtolower($itStatus . ' ' . $itReason);
    $apiEmbed = $api && isset($api['embeddable']) ? $api['embeddable'] : null;
    $apiPriv  = $api && isset($api['privacy']) ? strtolower((string)$api['privacy']) : '';
    $apiUp    = $api && isset($api['upload']) ? strtolower((string)$api['upload']) : '';

    // 1) Hard death signals — region-independent existence checks.
    if ($apiPriv === 'private' || $apiUp === 'deleted' || $apiUp === 'rejected' || $apiPriv === 'absent' || $apiUp === 'absent') {
        return array('state' => 'dead', 'via' => 'dataapi', 'reason' => 'privacy=' . $apiPriv . ' upload=' . $apiUp);
    }
    if ($oe === 'dead') return array('state' => 'dead', 'via' => 'oembed', 'reason' => 'oEmbed 404/400');

    // 2) InnerTube WEB_EMBEDDED_PLAYER playability — what the real embed
    //    player consults. Probed from THIS server's network, so the verdict
    //    matches what the LAN audience can actually play.
    if ($it !== null && $itStatus !== '') {
        if (strpos($itLow, 'not a bot') !== false) {
            // Bot wall (an IP judgment, not a video-health signal) — ignore
            // and fall through to the remaining probes.
        } elseif ($itStatus === 'OK' || $itStatus === 'LIVE_STREAM_OFFLINE') {
            return array('state' => 'ok', 'via' => 'innertube', 'reason' => 'WEB_EMBEDDED_PLAYER playabilityStatus=' . $itStatus);
        } elseif (strpos($itLow, 'playback on other websites has been disabled') !== false || strpos($itLow, 'watch on youtube') !== false) {
            return array('state' => 'embed-blocked', 'via' => 'innertube', 'reason' => 'syndication block: ' . substr($itReason, 0, 80));
        } elseif ($itStatus === 'UNPLAYABLE') {
            return array('state' => 'embed-blocked', 'via' => 'innertube', 'reason' => 'playability=UNPLAYABLE: ' . substr($itReason, 0, 80));
        } elseif (strpos($itLow, 'country') !== false) {
            return array('state' => 'restricted', 'via' => 'innertube', 'reason' => 'geo-restricted from this network: ' . substr($itReason, 0, 80));
        } elseif (strpos($itLow, 'age') !== false || strpos($itLow, 'inappropriate') !== false) {
            return array('state' => 'restricted', 'via' => 'innertube', 'reason' => 'age-gated in embed context');
        } elseif ($itStatus === 'LOGIN_REQUIRED') {
            return array('state' => 'restricted', 'via' => 'innertube', 'reason' => 'login required');
        } else {
            // ERROR and anything else non-OK: the embed context genuinely
            // cannot play this video (region/auth/removal shadow). v12 let
            // this fall through to oEmbed 200 = "ok" — the false-positive
            // class behind "audit says fine, player says unavailable".
            return array('state' => 'restricted', 'via' => 'innertube', 'reason' => 'playability=' . $itStatus . ($itReason !== '' ? ': ' . substr($itReason, 0, 80) : ''));
        }
    }

    // 3) oEmbed 401 — the endpoint is region/privacy sensitive; from this
    //    network the video is private or locked out.
    if ($oe === 'embed-blocked') return array('state' => 'embed-blocked', 'via' => 'oembed', 'reason' => 'oEmbed 401 (private or region-locked from this network)');

    // 4) Data API: owner disabled embedding outright.
    if ($apiEmbed === false) return array('state' => 'embed-blocked', 'via' => 'dataapi', 'reason' => 'status.embeddable=false');

    // 5) Positive verdicts — only reached when InnerTube had no say
    //    (absent, timed out, or bot-walled).
    if ($apiEmbed === true && ($oe === 'ok' || $oe === null)) {
        return array('state' => 'ok', 'via' => 'dataapi', 'reason' => 'Data API status.embeddable=true');
    }
    if ($oe === 'ok') {
        return array('state' => 'ok', 'via' => 'oembed', 'reason' => 'oEmbed 200');
    }

    // 6) Browser report — tie-breaker ONLY (v12.1 demotion). A real player
    //    error is still the strongest field signal when the server probes
    //    produced nothing, but it can no longer override a positive server
    //    verdict (ad-blocker 150 noise / poisoned legacy feedback).
    if ($rep) return array('state' => 'embed-blocked', 'via' => 'browser', 'reason' => 'player error reported by a real browser (no server verdict contradicts it)');

    if ($oe === 'unknown') return array('state' => 'unknown', 'via' => 'oembed', 'reason' => 'oEmbed unknown');
    return array('state' => 'unknown', 'via' => 'none', 'reason' => 'no signal');
}

function an_embed_site_url() {
    if (defined('APP_URL') && APP_URL !== '') return APP_URL;
    $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host = isset($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : '';
    if ($host !== '') return $scheme . '://' . $host;
    return 'https://anisync.app';
}

function an_innertube_embed_batch($ids, $timeout = 8) {
    if (count($ids) === 0) return array();
    $requests = array();
    foreach ($ids as $id) {
        $payload = array(
            'context' => array(
                'client' => array('clientName' => 'WEB_EMBEDDED_PLAYER', 'clientVersion' => '1.20240723.01.00', 'hl' => 'en', 'gl' => 'US'),
                'thirdParty' => array('embedUrl' => an_embed_site_url()),
            ),
            'videoId' => $id,
            'contentCheckOk' => true,
            'racyCheckOk' => true,
        );
        $requests[] = array(
            'url' => 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
            'method' => 'POST',
            'body' => json_encode($payload),
            'headers' => array('Content-Type: application/json', 'X-YouTube-Client-Name: 56', 'X-YouTube-Client-Version: 1.20240723.01.00'),
        );
    }
    $responses = an_curl_multi_generic($requests, $timeout);
    $out = array();
    foreach ($ids as $i => $id) {
        $body = isset($responses[$i]['body']) ? $responses[$i]['body'] : '';
        if ($body === '' || $responses[$i]['status'] < 200 || $responses[$i]['status'] >= 300) {
            $out[$id] = null;
            continue;
        }
        $d = json_decode($body, true);
        if (!is_array($d)) { $out[$id] = null; continue; }
        $ps = isset($d['playabilityStatus']) && is_array($d['playabilityStatus']) ? $d['playabilityStatus'] : array();
        // v12: also surface videoDetails — the resolver uses lengthSeconds for
        // the duration ladder and the canonical author/title for receipts.
        $vd = isset($d['videoDetails']) && is_array($d['videoDetails']) ? $d['videoDetails'] : array();
        $out[$id] = array(
            'status' => isset($ps['status']) ? (string)$ps['status'] : '',
            'reason' => isset($ps['reason']) ? (string)$ps['reason'] : '',
            'has_details' => count($vd) > 0,
            'length' => isset($vd['lengthSeconds']) && is_numeric($vd['lengthSeconds']) ? (int)$vd['lengthSeconds'] : null,
            'author' => isset($vd['author']) ? (string)$vd['author'] : '',
            'title' => isset($vd['title']) ? (string)$vd['title'] : '',
        );
    }
    return $out;
}

function an_ytapi_embed_batch($ids) {
    if (YOUTUBE_API_KEY === '' || count($ids) === 0) return array_fill_keys($ids, null);
    $out = array();
    foreach (array_chunk($ids, 50) as $chunk) {
        $url = 'https://www.googleapis.com/youtube/v3/videos?part=status,contentDetails,snippet&id=' . implode(',', array_map('rawurlencode', $chunk)) . '&key=' . rawurlencode(YOUTUBE_API_KEY);
        $r = an_curl($url, array('timeout' => 8));
        if (!$r['ok']) { foreach ($chunk as $id) { $out[$id] = null; } continue; }
        $d = json_decode($r['body'], true);
        if (!is_array($d) || isset($d['error'])) {
            foreach ($chunk as $id) { $out[$id] = null; }
            continue;
        }
        $items = isset($d['items']) && is_array($d['items']) ? $d['items'] : array();
        $byId = array();
        foreach ($items as $it) { if (isset($it['id'])) $byId[$it['id']] = $it; }
        foreach ($chunk as $id) {
            if (isset($byId[$id]) && isset($byId[$id]['status'])) {
                $st = $byId[$id]['status'];
                $geo = null;
                if (isset($byId[$id]['contentDetails']['regionRestriction']) && is_array($byId[$id]['contentDetails']['regionRestriction'])) {
                    $rr = $byId[$id]['contentDetails']['regionRestriction'];
                    if (isset($rr['allowed'])) $geo = array('allowed' => $rr['allowed']);
                    elseif (isset($rr['blocked'])) $geo = array('blocked' => $rr['blocked']);
                }
                $out[$id] = array(
                    'embeddable' => isset($st['embeddable']) ? (bool)$st['embeddable'] : null,
                    'privacy' => isset($st['privacyStatus']) ? (string)$st['privacyStatus'] : '',
                    'upload' => isset($st['uploadStatus']) ? (string)$st['uploadStatus'] : '',
                    'channel' => isset($byId[$id]['snippet']['channelTitle']) ? (string)$byId[$id]['snippet']['channelTitle'] : '',
                    'geo' => $geo,
                );
            } else {
                $out[$id] = array('embeddable' => null, 'privacy' => 'absent', 'upload' => 'absent', 'channel' => '', 'geo' => null);
            }
        }
    }
    return $out;
}

function an_embed_probe($ids, $opts = array()) {
    $out = array();
    $todo = array();
    $unique = array();
    foreach ($ids as $id) {
        if (!is_string($id) || !preg_match('/^[A-Za-z0-9_-]{11}$/', $id) || isset($unique[$id])) continue;
        $unique[$id] = true;
    }
    $idList = array_keys($unique);
    if (count($idList) === 0) return $out;

    $nocache = !empty($opts['nocache']);
    $runIt = !isset($opts['innertube']) ? true : (bool)$opts['innertube'];
    $runApi = !isset($opts['use_api']) ? true : (bool)$opts['use_api'];

    if (!$nocache) {
        foreach ($idList as $id) {
            $cached = cache_get('embprobe:' . $id);
            if (is_array($cached) && isset($cached['state'])) { $out[$id] = $cached; }
            else { $todo[] = $id; }
        }
    } else {
        $todo = $idList;
    }

    if (count($todo) > 0) {
        $oe = an_verify_embeddable_multi($todo, 6);
        $itIds = array();
        if ($runIt) {
            foreach ($todo as $id) {
                $st = isset($oe[$id]['state']) ? $oe[$id]['state'] : 'unknown';
                if ($st === 'dead' || $st === 'embed-blocked') continue;
                $itIds[] = $id;
            }
        }
        $it = an_innertube_embed_batch($itIds, 8);

        $apiIds = array();
        if ($runApi && YOUTUBE_API_KEY !== '') {
            foreach ($todo as $id) {
                $st = isset($oe[$id]['state']) ? $oe[$id]['state'] : 'unknown';
                if ($st === 'dead' || $st === 'embed-blocked') continue;
                $apiIds[] = $id;
            }
        }
        $api = an_ytapi_embed_batch($apiIds);
        $reported = an_embed_feedback_recent();

        foreach ($todo as $id) {
            $sig = array(
                'oembed' => isset($oe[$id]['state']) ? $oe[$id]['state'] : null,
                'innertube' => isset($it[$id]) ? $it[$id] : null,
                'api' => isset($api[$id]) ? $api[$id] : null,
                'reported' => array_key_exists($id, $reported),
            );
            $verdict = an_classify_embed($sig);
            $geo = null;
            if (isset($api[$id]) && is_array($api[$id]) && !empty($api[$id]['geo'])) $geo = $api[$id]['geo'];
            $entry = array(
                'state' => $verdict['state'],
                'via' => $verdict['via'],
                'reason' => $verdict['reason'],
                'oembed' => $sig['oembed'],
                'innertube' => $sig['innertube'],
                'browser' => $sig['reported'],
                'geo' => $geo,
            );
            $out[$id] = $entry;
            $ttl = 21600000;
            if ($verdict['state'] === 'dead' || $verdict['state'] === 'embed-blocked') $ttl = 86400000;
            elseif ($verdict['state'] === 'unknown') $ttl = 600000;
            elseif ($verdict['state'] === 'restricted') $ttl = 3600000;
            cache_set('embprobe:' . $id, $entry, $ttl);
        }
    }
    return $out;
}

// ===========================================================================
// Route Dispatcher
// ===========================================================================
function route_meta($method, $path) {
    $p = trim($path, "/");
    $parts = $p === "" ? array() : explode("/", $p);
    $n = count($parts);
    $ep = $n > 0 ? implode("/", $parts) : "";

    if ($method === "GET" && $ep === "vgmdb-verify") return meta_vgmdb_verify();
    if ($method === "GET" && $ep === "anidb-relations") return meta_anidb_relations();
    if ($method === "GET" && $ep === "verify-video") { rate_limit(120); return meta_verify_video(); }
    if ($method === "GET" && $ep === "anime-search") { rate_limit(120); return meta_anime_search(); }
    if ($method === "GET" && $ep === "anime-themes-ext") { rate_limit(120); return meta_anime_themes_ext(); }
    if ($method === "GET" && $ep === "animethemes-search") { rate_limit(120); require_auth(); return meta_animethemes_search(); }

    if ($method === "POST" && $ep === "verify-franchise") { rate_limit(30); require_auth(); return meta_verify_franchise(); }
    if ($method === "POST" && $ep === "match-tracks-to-mal") { rate_limit(30); require_auth(); return meta_match_tracks_to_mal(); }
    if ($method === "POST" && $ep === "filter-franchise") { rate_limit(30); require_auth(); return meta_filter_franchise(); }
    if ($method === "POST" && $ep === "align-single-anime") { rate_limit(30); require_auth(); return meta_align_single_anime(); }
    if ($method === "POST" && $ep === "align-batch-anime") { rate_limit(30); require_auth(); return meta_align_batch_anime(); }
    if ($method === "POST" && $ep === "auto-tag") { rate_limit(120); require_auth(); return meta_auto_tag(); }
    if ($method === "POST" && $ep === "smart-sweep-duplicates") { rate_limit(30); require_admin(); return meta_smart_sweep(); }
    if ($method === "POST" && $ep === "ai-themes") { rate_limit(120); require_auth(); return meta_ai_themes(); }
    if ($method === "POST" && $ep === "verify-batch") { rate_limit(120); require_auth(); return meta_verify_batch(); }
    if ($method === "POST" && $ep === "resolve-batch") { rate_limit(120); require_auth(); return meta_resolve_batch(); }
    if ($method === "POST" && $ep === "embed-fallback") { rate_limit(30); return meta_embed_fallback(); }
    if ($method === "POST" && $ep === "embed-feedback-batch") { rate_limit(30); return meta_embed_feedback_batch(); }
    if ($method === "POST" && $ep === "resolve-track-images-batch") { rate_limit(120); require_auth(); return meta_resolve_track_images(); }
    if ($method === "POST" && $ep === "resolve-single") { rate_limit(120); require_auth(); return meta_resolve_single(); }
    if ($method === "GET" && $ep === "full-playlist-discovery") { rate_limit(30); require_auth(); return meta_full_playlist_discovery(); }
    if ($method === "GET" && $ep === "youtube-search") { rate_limit(120); require_auth(); return meta_youtube_search(); }
    if ($method === "GET" && $ep === "youtube-playlist-fetch") { rate_limit(120); require_auth(); return meta_youtube_playlist_fetch(); }
    if ($method === "GET" && $ep === "itunes-albums") { rate_limit(120); require_auth(); return meta_itunes_albums(); }
    if ($method === "GET" && $ep === "anime-osts") { rate_limit(30); require_auth(); return meta_anime_osts(); }
    // v12: lyrics no longer require_auth — the deployed TrackPreviewDrawer
    // and YoutubePlayer call /api/lyrics with a bare fetch (no Bearer), so
    // the old gate made the lyrics tab silently 401 for every user. It is an
    // LRCLIB proxy (no Gemini spend); the 120/min rate limit stays.
    if ($method === "POST" && $ep === "lyrics") { rate_limit(120); return meta_lyrics(); }
    if ($method === "GET" && $ep === "bulk-anime-list") { rate_limit(120); require_admin(); return meta_bulk_anime_list(); }
    if ($method === "GET" && $ep === "bulk-popular") { rate_limit(120); require_admin(); return meta_bulk_popular(); }
    if ($method === "POST" && $ep === "analyze-taste") { rate_limit(30); require_auth(); return meta_analyze_taste(); }
    if ($method === "POST" && $ep === "analyze-track") { rate_limit(30); require_auth(); return meta_analyze_track(); }
    if ($method === "GET" && $ep === "artist-image") { rate_limit(120); require_auth(); return meta_artist_image(); }
    if ($method === "GET" && $ep === "anilist-search") { rate_limit(120); require_auth(); return meta_anilist_search(); }
    if ($method === "GET" && $ep === "anilist-anime") { rate_limit(120); require_auth(); return meta_anilist_anime(); }
    if ($method === "GET" && $ep === "anilist-staff-works") { rate_limit(120); require_auth(); return meta_anilist_staff_works(); }
    if ($method === "GET" && $ep === "anilist-staff-search") { rate_limit(120); require_auth(); return meta_anilist_staff_search(); }
    if ($method === "GET" && $ep === "musicbrainz-recordings") { rate_limit(120); require_auth(); return meta_mb_recordings(); }
    if ($method === "GET" && $ep === "musicbrainz-cover-art") { rate_limit(120); require_auth(); return meta_mb_cover_art(); }
    if ($method === "GET" && $ep === "lastfm-artist") { rate_limit(120); require_auth(); return meta_lastfm_artist(); }
    if ($method === "GET" && $ep === "lastfm-similar") { rate_limit(120); require_auth(); return meta_lastfm_similar(); }
    if ($method === "POST" && $ep === "lookup-artist") { rate_limit(120); require_admin(); return meta_lookup_artist(); }
    if ($method === "POST" && $ep === "lookup-artists-batch") { rate_limit(30); require_admin(); return meta_lookup_artists_batch(); }
    if ($method === "POST" && $ep === "vibe-spectrum") { rate_limit(30); require_auth(); return meta_vibe_spectrum(); }

    err_out(404, "Not found", "Unknown endpoint");
}

function meta_vgmdb_verify() {
    rate_limit(120);
    $name = isset($_GET['name']) ? (string)$_GET['name'] : '';
    if ($name === '') err_out(400, 'Bad request', 'name is required');
    $tracks = scrape_vgmdb_tracklists($name);
    json_out(array('tracks' => $tracks), 200);
}

function meta_anidb_relations() {
    rate_limit(120);
    $name = isset($_GET['name']) ? (string)$_GET['name'] : '';
    if ($name === '') err_out(400, 'Bad request', 'name is required');
    $relations = scrape_anidb_relations($name);
    json_out(array('relations' => $relations), 200);
}

function meta_verify_video() {
    $id = isset($_GET['id']) ? (string)$_GET['id'] : '';
    if ($id === '') err_out(400, 'Bad request', 'id is required');
    $nocache = (isset($_GET['refresh']) && $_GET['refresh'] === '1');
    $verdicts = an_embed_probe(array($id), $nocache ? array('nocache' => true) : array());
    $v = isset($verdicts[$id]) ? $verdicts[$id] : array('state' => 'unknown', 'via' => 'none', 'reason' => 'no signal');
    $alive = in_array($v['state'], array('ok', 'unknown'), true);
    json_out(array(
        'alive' => $alive,
        'state' => $v['state'],
        'via' => isset($v['via']) ? $v['via'] : '',
        'reason' => isset($v['reason']) ? $v['reason'] : '',
        'oembed' => isset($v['oembed']) ? $v['oembed'] : null,
        'innertube' => isset($v['innertube']) ? $v['innertube'] : null,
        'geo' => isset($v['geo']) ? $v['geo'] : null,
        'browserReported' => !empty($v['browser']),
    ), 200);
}


// ---------------------------------------------------------------------------
// v12 verify-batch — REAL verification. The old body was a stub that only
// regex-checked the ID FORMAT and marked every well-formed link "ok" (so the
// Stream Auditor reported "Database online and verified" no matter what —
// the "link audit is broken" bug). Now every ID goes through the multi-signal
// embed prober (oEmbed + InnerTube WEB_EMBEDDED_PLAYER + Data API + the
// browser feedback table), all batched and SQLite-cached, and library tracks
// whose TITLES mark them as covers/remixes/TV-size are flagged non-original
// (the v10 "purify the library" rule) so the auditor routes them to repair.
// ---------------------------------------------------------------------------
function meta_verify_batch() {
    $ids = body_get("ids", null);
    if (!is_array($ids)) err_out(400, "Bad request", "ids must be an array");
    $slice = array_slice($ids, 0, 50);
    // A 50-id probe fan-out (parallel curls, 6-8s timeouts) can outlive the
    // stock php.ini max_execution_time of 30s on a slow NAS.
    @set_time_limit(180);

    $results = array();
    $statuses = array();
    $states = array();
    $reasons = array();
    $valid = array();

    foreach ($slice as $id) {
        $key = (string)$id;
        $isFormatOk = (is_string($id) && preg_match("/^[A-Za-z0-9_-]{11}$/", $id) && $id !== "Fve_l8I0Ayk");
        $results[$key] = false;
        $statuses[$key] = "dead";
        $states[$key] = "invalid";
        $reasons[$key] = $isFormatOk ? "" : "malformed or placeholder id";
        if ($isFormatOk) $valid[] = $id;
    }

    // v10 title-flagging: look up which requested ids belong to library tracks
    // and check their titles against the derivative lexicon (indexed lookup —
    // needs schema v4's idx_tracks_yt).
    $titleFlags = array();
    if (count($valid) > 0) {
        try {
            $marks = implode(',', array_fill(0, count($valid), '?'));
            foreach (db_all('SELECT youtube_id, title FROM tracks WHERE youtube_id IN (' . $marks . ')', $valid) as $r) {
                $tier = an_derivative_hit($r['title']);
                if ($tier !== '') $titleFlags[$r['youtube_id']] = $tier;
            }
        } catch (Exception $e) {}
    }

    if (count($valid) > 0) {
        $verdicts = an_embed_probe($valid);
        foreach ($valid as $id) {
            $key = (string)$id;
            $v = isset($verdicts[$id]) ? $verdicts[$id] : array('state' => 'unknown', 'reason' => 'no signal');
            $state = isset($v['state']) ? $v['state'] : 'unknown';
            $reason = isset($v['reason']) ? $v['reason'] : '';
            // v11 semantics: ambiguous signals never condemn — only explicit
            // dead / embed-blocked / restricted verdicts (and title flags) do.
            $alive = in_array($state, array('ok', 'unknown'), true);
            if (isset($titleFlags[$id]) && $alive && $state === 'ok') {
                $alive = false;
                $state = 'non-original';
                $reason = 'title marks this upload as a ' . $titleFlags[$id] . '-tier derivative (cover/remix/TV-size)';
            }
            $results[$key] = $alive;
            $statuses[$key] = $alive ? "ok" : "dead";
            $states[$key] = $state;
            $reasons[$key] = $reason;
        }
    }

    json_out(array(
        "results" => $results,
        "statuses" => $statuses,
        "states" => $states,
        "reasons" => $reasons,
    ), 200);
}


function meta_anime_search() {
    $q = isset($_GET["q"]) ? (string)$_GET["q"] : (isset($_GET["anime"]) ? (string)$_GET["anime"] : "");
    if ($q === "") err_out(400, "Bad request", "q is required");

    $url = "https://kitsu.io/api/edge/anime?filter[text]=" . urlencode($q) . "&page[limit]=12";
    $r = an_curl($url, array("headers" => array("Accept: application/vnd.api+json")));
    if ($r["ok"]) {
        $d = safe_json_parse($r["body"], null);
        if (isset($d["data"]) && is_array($d["data"])) {
            $results = array();
            foreach ($d["data"] as $item) {
                $attr = isset($item["attributes"]) ? $item["attributes"] : array();
                $titles = isset($attr["titles"]) ? $attr["titles"] : array();
                $title = isset($titles["en"]) ? $titles["en"] : (isset($titles["en_jp"]) ? $titles["en_jp"] : (isset($attr["canonicalTitle"]) ? $attr["canonicalTitle"] : ""));
                $poster = isset($attr["posterImage"]["large"]) ? $attr["posterImage"]["large"] : (isset($attr["posterImage"]["medium"]) ? $attr["posterImage"]["medium"] : "");
                $results[] = array(
                    "mal_id" => (int)$item["id"],
                    "title" => $title,
                    "title_english" => isset($titles["en"]) ? $titles["en"] : $title,
                    "title_japanese" => isset($titles["ja_jp"]) ? $titles["ja_jp"] : "",
                    "images" => array("jpg" => array("image_url" => $poster, "large_image_url" => $poster)),
                    "year" => isset($attr["startDate"]) ? (int)substr($attr["startDate"], 0, 4) : null,
                    "type" => isset($attr["subtype"]) ? strtoupper($attr["subtype"]) : "TV",
                    "score" => isset($attr["averageRating"]) ? round($attr["averageRating"] / 10, 1) : null
                );
            }
            json_out(array("data" => $results), 200);
        }
    }
    json_out(array("data" => array()), 200);
}

function meta_anime_themes_ext() {
    $name = "";
    if (isset($_GET['name'])) $name = $_GET['name'];
    elseif (isset($_GET['anime'])) $name = $_GET['anime'];
    elseif (isset($_GET['q'])) $name = $_GET['q'];
    elseif (isset($_GET['animeName'])) $name = $_GET['animeName'];
    elseif (isset($_GET['id'])) $name = $_GET['id'];

    if ($name !== "") {
        $data = animethemes_search($name, 10);
        if ($data !== null && isset($data['anime'])) {
            $tracks = an_flatten_theme_results($data['anime']);
            json_out(array('data' => array('openings' => $tracks, 'endings' => array()), 'tracks' => $tracks), 200);
        }
    }
    json_out(array('data' => array('openings' => array(), 'endings' => array()), 'tracks' => array()), 200);
}

function create_function_fallback_matches($parent, $candidates) {
    $p = strtolower(preg_replace('/[:\-|~(|)].*$/', '', trim((string)$parent)));
    $out = array();
    foreach ($candidates as $c) {
        $child = is_string($c) ? $c : (isset($c['title']) ? $c['title'] : '');
        $child = strtolower(preg_replace('/[:\-|~(|)].*$/', '', trim($child)));
        if ($child === '') continue;
        if (strpos($child, $p) !== false || strpos($p, $child) !== false) $out[] = is_string($c) ? $c : $c['title'];
    }
    return $out;
}

function meta_verify_franchise() {
    $parent = body_get('parent', null);
    $candidates = body_get('candidates', null);
    if (!$parent || !is_array($candidates) || count($candidates) === 0) {
        json_out(array('matches' => array()), 200);
    }
    $fallback = create_function_fallback_matches($parent, $candidates);
    $safeCandidates = sanitize_array_for_prompt($candidates, 50, 200);
    $safeParent = sanitize_for_prompt($parent, 200);
    $prompt = 'You are an anime database expert. I have a main parent anime franchise called "' . $safeParent . "\".\n" .
        'I have a list of candidate anime show/part/seasons/movies from my database:' . "\n" .
        json_encode($safeCandidates) . "\n\n" .
        'Identify which of these candidate names actually belong to the "' . $safeParent . '" franchise (e.g. sequels, spin-offs, movies, alternative seasons, alternate versions, or different parts).' . "\n" .
        'Exclude any completely unrelated franchises or unrelated shows.' . "\n\n" .
        'Return a strict JSON object with a single key "matches" containing the validated candidate strings.';
    $schema = array('type' => 'OBJECT', 'properties' => array('matches' => array('type' => 'ARRAY', 'items' => array('type' => 'STRING'))), 'required' => array('matches'));
    $parsed = gemini_generate($prompt, $schema, null);
    if ($parsed !== null && isset($parsed['matches']) && is_array($parsed['matches'])) {
        json_out(array('matches' => $parsed['matches']), 200);
    }
    json_out(array('matches' => $fallback), 200);
}

function meta_match_tracks_to_mal() {
    $parent = body_get('parent', null);
    $malAnimes = body_get('malAnimes', null);
    $databaseTracks = body_get('databaseTracks', null);
    if (!$parent || !is_array($malAnimes) || !is_array($databaseTracks) || count($databaseTracks) === 0) {
        json_out(array('assignments' => new stdClass()), 200);
    }
    $fallback = array();
    foreach ($databaseTracks as $t) {
        $matched = null;
        $tNorm = strtolower(preg_replace('/[:\-|~(|)].*$/', '', trim((string)(isset($t['animeName']) ? $t['animeName'] : ''))));
        foreach ($malAnimes as $mal) {
            $mNorm = strtolower(preg_replace('/[:\-|~(|)].*$/', '', trim((string)(isset($mal['title']) ? $mal['title'] : ''))));
            if ($mNorm === '') continue;
            if (strpos($tNorm, $mNorm) !== false || strpos($mNorm, $tNorm) !== false) { $matched = $mal['title']; break; }
        }
        $fallback[(string)$t['id']] = $matched;
    }
    $safeParent = sanitize_for_prompt($parent, 200);
    $malList = array();
    foreach ($malAnimes as $a) { $malList[] = array('mal_id' => isset($a['mal_id']) ? $a['mal_id'] : null, 'title' => isset($a['title']) ? $a['title'] : '', 'type' => isset($a['type']) ? $a['type'] : null); }
    $dbList = array();
    foreach ($databaseTracks as $t) { $dbList[] = array('id' => $t['id'], 'title' => isset($t['title']) ? $t['title'] : '', 'artist' => isset($t['artist']) ? $t['artist'] : '', 'dbAnimeName' => isset($t['animeName']) ? $t['animeName'] : '', 'type' => isset($t['type']) ? $t['type'] : null); }
    $prompt = 'You are an expert anime metadata mapping assistant.' . "\n" .
        'Parent franchise: "' . $safeParent . '".' . "\n" .
        'MAL records: ' . json_encode(sanitize_array_for_prompt($malList, 50, 200)) . "\n" .
        'Local DB tracks: ' . json_encode(sanitize_array_for_prompt($dbList, 100, 200)) . "\n\n" .
        'Assign each database track ID to the most appropriate official MyAnimeList "title" string from the records list or null.' . "\n" .
        'Return strict JSON object: { "assignments": { "trackId": "MAL title" } }';
    $schema = array('type' => 'OBJECT', 'properties' => array('assignments' => array('type' => 'OBJECT', 'additionalProperties' => array('type' => 'STRING'))), 'required' => array('assignments'));
    $parsed = gemini_generate($prompt, $schema, null);
    if ($parsed !== null && isset($parsed['assignments']) && is_array($parsed['assignments'])) {
        json_out(array('assignments' => $parsed['assignments']), 200);
    }
    json_out(array('assignments' => $fallback), 200);
}

function meta_filter_franchise() {
    $mainAnime = body_get('mainAnime', null);
    $candidates = body_get('candidates', null);
    if (!$mainAnime || !is_array($candidates) || count($candidates) === 0) {
        json_out(array('relatedMalIds' => array()), 200);
    }
    $allIds = array();
    foreach ($candidates as $c) { if (isset($c['mal_id'])) $allIds[] = $c['mal_id']; }
    $safeMain = sanitize_for_prompt($mainAnime, 200);
    $candList = array();
    foreach ($candidates as $c) {
        $candList[] = array('mal_id' => isset($c['mal_id']) ? $c['mal_id'] : null, 'title' => isset($c['title']) ? $c['title'] : '', 'type' => isset($c['type']) ? $c['type'] : null, 'synopsis' => isset($c['synopsis']) ? substr((string)$c['synopsis'], 0, 120) : '');
    }
    $prompt = 'You are an expert anime franchise grouping assistant.' . "\n" .
        'Main series: "' . $safeMain . '"' . "\n" .
        'Candidates: ' . json_encode(sanitize_array_for_prompt($candList, 50, 200)) . "\n\n" .
        'Filter and output ONLY the mal_ids belonging to the SAME franchise/IP in a strict JSON: { "relatedMalIds": [1, 2, 3] }';
    $schema = array('type' => 'OBJECT', 'properties' => array('relatedMalIds' => array('type' => 'ARRAY', 'items' => array('type' => 'INTEGER'))), 'required' => array('relatedMalIds'));
    $parsed = gemini_generate($prompt, $schema, null);
    if ($parsed !== null && isset($parsed['relatedMalIds']) && is_array($parsed['relatedMalIds'])) {
        json_out(array('relatedMalIds' => $parsed['relatedMalIds']), 200);
    }
    json_out(array('relatedMalIds' => $allIds), 200);
}

function an_align_match($orig, $candidates) {
    $target = strtolower((string)$orig);
    $match = null;
    foreach ($candidates as $c) {
        $title = strtolower((string)(isset($c['title']) ? $c['title'] : ''));
        if ($title === '') continue;
        if (strpos($title, $target) !== false || strpos($target, $title) !== false) { $match = $c['title']; break; }
    }
    if ($match === null && isset($candidates[0]['title'])) $match = $candidates[0]['title'];
    return $match;
}

function meta_align_single_anime() {
    $orig = body_get('originalAnimeName', null);
    $malCandidates = body_get('malCandidates', null);
    if (!$orig || !is_array($malCandidates) || count($malCandidates) === 0) {
        json_out(array('alignedTitle' => null), 200);
    }
    $match = an_align_match($orig, $malCandidates);
    $safeOrig = sanitize_for_prompt($orig, 200);
    $candList = array();
    foreach ($malCandidates as $c) { $candList[] = array('title' => isset($c['title']) ? $c['title'] : '', 'mal_id' => isset($c['mal_id']) ? $c['mal_id'] : null, 'type' => isset($c['type']) ? $c['type'] : null, 'score' => isset($c['score']) ? $c['score'] : null); }
    $prompt = 'You are an expert anime database librarian.' . "\n" .
        'Local label: "' . $safeOrig . '"' . "\n" .
        'MAL candidates: ' . json_encode(sanitize_array_for_prompt($candList, 50, 200)) . "\n\n" .
        'Return strict JSON object: { "alignedTitle": "canonical MAL title" }';
    $schema = array('type' => 'OBJECT', 'properties' => array('alignedTitle' => array('type' => 'STRING', 'nullable' => true)), 'required' => array('alignedTitle'));
    $parsed = gemini_generate($prompt, $schema, null);
    if ($parsed !== null && isset($parsed['alignedTitle']) && $parsed['alignedTitle'] !== '') {
        json_out(array('alignedTitle' => $parsed['alignedTitle']), 200);
    }
    json_out(array('alignedTitle' => $match), 200);
}

function meta_align_batch_anime() {
    $batch = body_get('batch', null);
    if (!is_array($batch) || count($batch) === 0) json_out(array('alignments' => array()), 200);
    $fallback = array();
    foreach ($batch as $item) {
        $orig = isset($item['originalAnimeName']) ? $item['originalAnimeName'] : '';
        $candidates = isset($item['malCandidates']) ? $item['malCandidates'] : array();
        if (!is_array($candidates)) $candidates = array();
        $match = an_align_match($orig, $candidates);
        $tracks = isset($item['tracks']) && is_array($item['tracks']) ? $item['tracks'] : array();
        foreach ($tracks as $track) {
            $fallback[] = array('trackId' => isset($track['id']) ? $track['id'] : '', 'masterFranchiseName' => $orig, 'alignedPart' => $match);
        }
    }
    json_out(array('alignments' => $fallback), 200);
}

function meta_auto_tag() {
    $title = body_get('title', null);
    $artist = body_get('artist', '');
    $animeName = body_get('animeName', null);
    $type = body_get('type', 'OP');
    if (!$title || !$animeName) err_out(400, 'Bad request', 'title and animeName are required.');
    $tags = generate_song_tags($title, $artist === null ? '' : (string)$artist, (string)$animeName, $type === null ? 'OP' : (string)$type);
    json_out(array('tags' => $tags), 200);
}

function meta_smart_sweep() {
    $tracks = body_get('tracks', null);
    if (!is_array($tracks) || count($tracks) === 0) err_out(400, 'Bad request', 'tracks array is required');
    $duplicateIds = array();
    $visited = array();
    $processed = array();
    foreach ($tracks as $t) {
        $anime = strtolower(trim((string)(isset($t['animeName']) ? $t['animeName'] : '')));
        $anime = preg_replace('/[^a-z0-9]/', '', $anime);
        $cleanTitle = strtolower((string)(isset($t['title']) ? $t['title'] : ''));
        $cleanTitle = preg_replace('/\s*\(.*?\)/', '', $cleanTitle);
        $cleanTitle = preg_replace('/\s*\[.*?\]/', '', $cleanTitle);
        $cleanTitle = preg_replace('/[^a-z0-9]/', '', $cleanTitle);
        $processed[] = array(
            'id' => isset($t['id']) ? $t['id'] : '',
            'title' => isset($t['title']) ? $t['title'] : '',
            'animeName' => isset($t['animeName']) ? $t['animeName'] : '',
            'animePart' => isset($t['animePart']) ? $t['animePart'] : '',
            'artist' => isset($t['artist']) ? $t['artist'] : 'Unknown',
            'type' => isset($t['type']) ? $t['type'] : '',
            'youtubeId' => isset($t['youtubeId']) ? $t['youtubeId'] : '',
            'tags' => isset($t['tags']) && is_array($t['tags']) ? $t['tags'] : array(),
            'customImageUrl' => isset($t['customImageUrl']) ? $t['customImageUrl'] : '',
            'normAnime' => $anime,
            'cleanTitle' => $cleanTitle,
            'normArtist' => preg_replace('/[^a-z0-9]/', '', strtolower((string)(isset($t['artist']) ? $t['artist'] : ''))),
            'normType' => substr(strtolower((string)(isset($t['type']) ? $t['type'] : '')), 0, 2),
        );
    }
    $groups = array();
    foreach ($processed as $t) {
        $key = $t['cleanTitle'] . '_' . $t['normType'];
        if (!isset($groups[$key])) $groups[$key] = array();
        $groups[$key][] = $t;
    }
    foreach ($groups as $group) {
        if (count($group) < 2) continue;
        $cnt = count($group);
        for ($i = 0; $i < $cnt; $i++) {
            $a = $group[$i];
            if (isset($visited[$a['id']])) continue;
            for ($j = $i + 1; $j < $cnt; $j++) {
                $b = $group[$j];
                if (isset($visited[$b['id']])) continue;
                $animeMatch = ($a['normAnime'] !== '' && $b['normAnime'] !== '' &&
                    (strpos($a['normAnime'], $b['normAnime']) !== false || strpos($b['normAnime'], $a['normAnime']) !== false));
                $artistMatch = an_artist_vague($a['normArtist']) || an_artist_vague($b['normArtist']) ||
                    strpos($a['normArtist'], $b['normArtist']) !== false || strpos($b['normArtist'], $a['normArtist']) !== false;
                if ($animeMatch && $artistMatch) {
                    $scoreA = an_track_quality_score($a);
                    $scoreB = an_track_quality_score($b);
                    $toDelete = ($scoreA >= $scoreB) ? $b['id'] : $a['id'];
                    $duplicateIds[] = $toDelete;
                    $visited[$toDelete] = true;
                    if ($scoreA < $scoreB) break;
                }
            }
        }
    }
    json_out(array('duplicateIdsToDelete' => $duplicateIds, 'note' => 'Deduplication complete.'), 200);
}

function an_artist_vague($normArtist) {
    return $normArtist === '' || strpos($normArtist, 'unknown') !== false || strpos($normArtist, 'various') !== false;
}
function an_track_quality_score($t) {
    $s = 0;
    if ($t['youtubeId'] !== '' && $t['youtubeId'] !== 'Fve_l8I0Ayk' && strlen($t['youtubeId']) > 5) $s += 1000;
    if (strlen((string)$t['animePart']) > 5) $s += 50;
    if (is_array($t['tags']) && count($t['tags']) > 0) $s += 20;
    if ($t['customImageUrl'] !== '' && strpos($t['customImageUrl'], 'ytimg') === false) $s += 100;
    $s += strlen((string)$t['title']) + strlen((string)$t['animeName']);
    return $s;
}

function meta_ai_themes() {
    $animeName = body_get('animeName', null);
    $existingYtIds = body_get('existingYtIds', null);
    if (!is_string($animeName) || trim($animeName) === '') err_out(400, 'Bad request', 'animeName is required.');
    $excluded = array();
    if (is_array($existingYtIds)) { foreach ($existingYtIds as $id) { $excluded[] = (string)$id; } }
    $resolvedName = trim($animeName);
    $cacheKey = 'themes:' . strtolower($resolvedName);
    $cached = cache_get($cacheKey);
    if ($cached !== null) json_out($cached, 200);

    $baseThemes = array();
    foreach (array_slice(get_search_variants($resolvedName), 0, 2) as $query) {
        $d = jikan_get('/anime?q=' . rawurlencode($query) . '&limit=1', 8);
        if ($d !== null && isset($d['data'][0]['mal_id'])) {
            $malId = $d['data'][0]['mal_id'];
            if (isset($d['data'][0]['title'])) $resolvedName = $d['data'][0]['title'];
            $themes = fetch_themes_jikan($malId, $resolvedName);
            if ($themes !== null && count($themes) > 0) { $baseThemes = $themes; break; }
        }
        usleep(400000);
    }
    if (count($baseThemes) === 0) {
        $moe = fetch_themes_animethemes_moe($resolvedName);
        if ($moe !== null && count($moe) > 0) $baseThemes = $moe;
    }
    if (count($baseThemes) === 0) {
        $anison = scrape_anison($resolvedName);
        if (count($anison) > 0) $baseThemes = $anison;
    }
    if (count($baseThemes) === 0) {
        $anidb = scrape_anidb($resolvedName);
        if (count($anidb) > 0) $baseThemes = $anidb;
    }
    if (count($baseThemes) === 0) $baseThemes = get_theme_templates($resolvedName);

    $resolvedThemes = array();
    foreach (array_slice($baseThemes, 0, 10) as $theme) {
        $activeId = resolve_youtube_id(
            $theme['title'],
            isset($theme['artist']) && $theme['artist'] !== '' ? $theme['artist'] : 'Unknown',
            $resolvedName,
            isset($theme['type']) ? $theme['type'] : 'OP',
            $excluded
        );
        $finalId = ($activeId !== '') ? $activeId : 'Fve_l8I0Ayk';
        if ($activeId !== '') $excluded[] = $activeId;
        $type = (isset($theme['type']) && in_array($theme['type'], array('OP', 'ED', 'OST'), true)) ? $theme['type'] : 'OP';
        $resolvedThemes[] = array(
            'title' => $theme['title'],
            'artist' => (isset($theme['artist']) && $theme['artist'] !== '') ? $theme['artist'] : 'Unknown Performer',
            'type' => $type,
            'youtubeId' => $finalId,
        );
    }
    cache_set($cacheKey, $resolvedThemes, 3600000);
    json_out($resolvedThemes, 200);
}

function meta_resolve_batch() {
    $tracks = body_get('tracks', null);
    $existingYtIds = body_get('existingYtIds', null);
    if (!is_array($tracks)) err_out(400, 'Bad request', 'tracks must be an array of track items');
    // Each repair = 1 cached search + a batched, cached embed probe; a
    // 10-track chunk can outlive php.ini's 30s on the NAS.
    @set_time_limit(300);
    $listExcluded = is_array($existingYtIds) ? $existingYtIds : array();
    $resolved = array();
    $details = array();
    $batchSize = 10;
    for ($i = 0; $i < count($tracks); $i += $batchSize) {
        $chunk = array_slice($tracks, $i, $batchSize);
        foreach ($chunk as $t) {
            if (!is_array($t) || empty($t['title']) || empty($t['animeName'])) continue;
            $trackExcluded = $listExcluded;
            if (isset($t['excludeIds']) && is_array($t['excludeIds'])) {
                foreach ($t['excludeIds'] as $ex) {
                    if (is_string($ex) && preg_match('/^[A-Za-z0-9_-]{11}$/', $ex)) $trackExcluded[] = $ex;
                }
            }
            // v12: resolve_youtube_best now probes candidates for real
            // embeddability and applies the points system — nothing
            // unverified or below the floor can come back from here.
            $best = resolve_youtube_best($t['title'], isset($t['artist']) ? $t['artist'] : 'Unknown', $t['animeName'], isset($t['type']) ? $t['type'] : 'OP', $trackExcluded);
            if ($best !== null && $best['videoId'] !== '') {
                $resolved[(string)$t['id']] = $best['videoId'];
                $listExcluded[] = $best['videoId'];
                $details[(string)$t['id']] = array(
                    'videoId' => $best['videoId'],
                    'title' => isset($best['title']) ? $best['title'] : '',
                    'author' => isset($best['author']) ? $best['author'] : '',
                    'fan' => isset($best['author']) ? !an_fan_is_official($best['author']) : true,
                    'score' => isset($best['score']) ? (int)$best['score'] : 0,
                    'points' => (isset($best['points']) && is_array($best['points'])) ? $best['points'] : array(),
                    'duration' => isset($best['duration']) ? $best['duration'] : null,
                    'state' => isset($best['state']) ? $best['state'] : 'ok',
                    'via' => isset($best['via']) ? $best['via'] : '',
                );
            }
        }
        // Pace only between chunks that remain (was: slept after the last
        // chunk too, wasting 400ms per audit for nothing).
        if ($i + $batchSize < count($tracks)) usleep(400000);
    }
    json_out(array('resolved' => $resolved, 'details' => $details), 200);
}

function meta_resolve_track_images() {
    $tracks = body_get('tracks', null);
    $overwrite = body_get('overwrite', null);
    if (!is_array($tracks)) err_out(400, 'Bad request', 'tracks must be an array of tracks');
    $resolvedImages = array();
    $chunkSize = 5;
    for ($i = 0; $i < count($tracks); $i += $chunkSize) {
        $chunk = array_slice($tracks, $i, $chunkSize);
        foreach ($chunk as $track) {
            if (!is_array($track) || empty($track['id'])) continue;
            $inlineCover = isset($track['customImageUrl']) ? (string)$track['customImageUrl'] : '';
            $hasPremium = ($inlineCover !== '' && strpos($inlineCover, 'youtube.com') === false && strpos($inlineCover, 'ytimg.com') === false);
            if ($hasPremium && !$overwrite) continue;
            $title = isset($track['title']) ? (string)$track['title'] : '';
            $artist = isset($track['artist']) ? (string)$track['artist'] : '';
            $animeName = isset($track['animeName']) ? (string)$track['animeName'] : '';
            $cleanTitle = trim(preg_replace('/\(.*?\)|\[.*?\]/', '', $title));
            $cleanArtist = ($artist === 'Unknown' || $artist === 'Various') ? '' : trim(preg_replace('/\(.*?\)|\[.*?\]/', '', $artist));
            $searchQuery = trim($cleanArtist . ' ' . $cleanTitle);
            if ($searchQuery === '') $searchQuery = trim($animeName . ' ' . $cleanTitle);
            $data = http_get_json('https://itunes.apple.com/search?term=' . rawurlencode($searchQuery) . '&limit=1&entity=song', 8, 'aistudio-build-songs');
            if ($data !== null && isset($data['results'][0]['artworkUrl100'])) {
                $art = (string)$data['results'][0]['artworkUrl100'];
                $highres = str_replace('100x100bb.jpg', '600x600bb.jpg', $art);
                $highres = str_replace('100x100', '600x600', $highres);
                $resolvedImages[(string)$track['id']] = $highres;
                continue;
            }
            $jikan = jikan_get('/anime?q=' . rawurlencode($animeName) . '&limit=1', 8);
            $imgUrl = an_deep_get($jikan, array('data', 0, 'images', 'webp', 'large_image_url'));
            if ($imgUrl === null) $imgUrl = an_deep_get($jikan, array('data', 0, 'images', 'jpg', 'large_image_url'));
            if ($imgUrl === null) $imgUrl = an_deep_get($jikan, array('data', 0, 'images', 'jpg', 'image_url'));
            if ($imgUrl !== null) { $resolvedImages[(string)$track['id']] = (string)$imgUrl; continue; }
            if (!empty($track['youtubeId'])) {
                $resolvedImages[(string)$track['id']] = 'https://img.youtube.com/vi/' . $track['youtubeId'] . '/maxresdefault.jpg';
            }
        }
        if ($i + $chunkSize < count($tracks)) usleep(350000);
    }
    json_out(array('resolvedImages' => $resolvedImages), 200);
}

function meta_resolve_single() {
    $title = body_get('title', null);
    $artist = body_get('artist', 'Unknown');
    $animeName = body_get('animeName', null);
    $type = body_get('type', 'OP');
    $existingYtIds = body_get('existingYtIds', null);
    if (!$title || !$animeName) err_out(400, 'Bad request', 'title and animeName are required.');
    @set_time_limit(120);
    $listExcluded = is_array($existingYtIds) ? $existingYtIds : array();
    $liveId = resolve_youtube_id($title, $artist, $animeName, $type, $listExcluded);
    if ($liveId === '') err_out(404, 'Not found', 'Could not locate a working YouTube video ID for this song.');
    json_out(array('youtubeId' => $liveId), 200);
}

function meta_embed_fallback() {
    // v12: rate_limit(30) removed here — the dispatcher already applies it
    // at the route entry; the double increment was burning the 30/min budget
    // twice as fast for every player error.
    $vid = body_get('videoId', '');
    $code = body_get('code', 0);
    $confirmId = body_get('confirmId', '');
    $exclude = body_get('exclude', null);
    $trackIdIn = body_get('trackId', '');
    $isV2 = body_get('v', 1) >= 2;
    $reportOnly = body_get('reportOnly', false) ? true : false;

    if (!is_string($vid)) $vid = '';
    $vid = trim($vid);
    $trackIdIn = is_string($trackIdIn) ? trim($trackIdIn) : '';

    if (is_string($confirmId) && preg_match('/^[A-Za-z0-9_-]{11}$/', trim($confirmId))) {
        $confirmId = trim($confirmId);
        if (is_array($exclude)) {
            foreach (array_slice($exclude, 0, 20) as $ex) {
                $exId = is_array($ex) ? (isset($ex['videoId']) ? (string)$ex['videoId'] : '') : (string)$ex;
                if (preg_match('/^[A-Za-z0-9_-]{11}$/', $exId) && $exId !== $confirmId) {
                    an_embed_feedback_record($exId, is_array($ex) && isset($ex['code']) ? (int)$ex['code'] : 150);
                }
            }
        }
        $track = an_embed_fallback_find_track($vid, $trackIdIn);
        if ($track === null) json_out(array('ok' => false, 'error' => 'track not found'), 404);
        try {
            db_run('UPDATE tracks SET youtube_id = ? WHERE id = ?', array($confirmId, $track['id']));
        } catch (Exception $e) {
            err_out(500, 'Internal', 'Could not persist replacement stream: ' . $e->getMessage());
        }
        cache_set('embeddone:' . $track['id'], now_ms(), 300000);
        try { db_run('DELETE FROM api_cache WHERE key = ?', array('embedrepair:' . $track['id'])); } catch (Exception $e) {}
        json_out(array('ok' => true, 'persisted' => true, 'trackId' => $track['id'], 'videoId' => $confirmId, 'title' => (string)$track['title']), 200);
    }

    if ($vid !== '' && !preg_match('/^[A-Za-z0-9_-]{11}$/', $vid)) {
        err_out(400, 'Bad request', 'videoId malformed');
    }

    if ($vid !== '') {
        an_embed_feedback_record($vid, is_numeric($code) ? (int)$code : 0);
    }
    if (is_array($exclude)) {
        foreach (array_slice($exclude, 0, 20) as $ex) {
            $exId = is_array($ex) ? (isset($ex['videoId']) ? (string)$ex['videoId'] : '') : (string)$ex;
            if (preg_match('/^[A-Za-z0-9_-]{11}$/', $exId) && $exId !== $vid) {
                an_embed_feedback_record($exId, is_array($ex) && isset($ex['code']) ? (int)$ex['code'] : 150);
            }
        }
    }

    $out = array('watchUrl' => $vid !== '' ? 'https://www.youtube.com/watch?v=' . $vid : '');
    $track = an_embed_fallback_find_track($vid, $trackIdIn);
    if ($reportOnly || $track === null) json_out($out, 200);

    $cooldownKey = 'embedrepair:' . $track['id'];
    $cd = cache_get($cooldownKey);
    if ($cd !== null && is_array($cd) && isset($cd['vid']) && $cd['vid'] === $vid && $vid !== '') {
        $out['cooldown'] = true;
        json_out($out, 200);
    }
    if (cache_get('embeddone:' . $track['id']) !== null) {
        $out['repairedRecently'] = true;
        json_out($out, 200);
    }

    $excluded = array();
    if ($vid !== '') $excluded[] = $vid;
    if (is_array($exclude)) {
        foreach (array_slice($exclude, 0, 20) as $ex) {
            $exId = is_array($ex) ? (isset($ex['videoId']) ? (string)$ex['videoId'] : '') : (string)$ex;
            if (preg_match('/^[A-Za-z0-9_-]{11}$/', $exId)) $excluded[] = $exId;
        }
    }
    try {
        foreach (db_all('SELECT youtube_id FROM tracks', array()) as $r) {
            if (is_string($r['youtube_id']) && $r['youtube_id'] !== '') $excluded[] = $r['youtube_id'];
        }
    } catch (Exception $e) {}

    $part = isset($track['anime_part']) && $track['anime_part'] !== null ? (string)$track['anime_part'] : '';
    $lookupName = trim((string)$track['anime_name'] . ($part !== '' ? ' ' . $part : ''));
    $candidates = an_resolve_candidates((string)$track['title'], (string)$track['artist'], $lookupName, (string)$track['type'], $excluded, 5);

    if (!$isV2) {
        if (count($candidates) === 0) {
            cache_set($cooldownKey, array('vid' => $vid), 120000);
            json_out($out, 200);
        }
        $liveId = $candidates[0]['videoId'];
        try {
            db_run('UPDATE tracks SET youtube_id = ? WHERE id = ?', array($liveId, $track['id']));
        } catch (Exception $e) {
            err_out(500, 'Internal', 'Could not persist replacement stream: ' . $e->getMessage());
        }
        cache_set('embeddone:' . $track['id'], now_ms(), 300000);
        $out['fixedId'] = $liveId;
        $out['trackId'] = $track['id'];
        $out['title'] = (string)$track['title'];
        json_out($out, 200);
    }

    if (count($candidates) === 0) {
        cache_set($cooldownKey, array('vid' => $vid), 45000);
        $out['candidates'] = array();
        json_out($out, 200);
    }
    cache_set($cooldownKey, array('vid' => $vid), 45000);
    $out['candidates'] = $candidates;
    $out['trackId'] = $track['id'];
    $out['title'] = (string)$track['title'];
    json_out($out, 200);
}

function an_embed_fallback_find_track($vid, $trackId) {
    try {
        if ($trackId !== '' && preg_match('/^[A-Za-z0-9_-]{1,64}$/', $trackId)) {
            $t = db_one('SELECT id, title, artist, anime_name, anime_part, type FROM tracks WHERE id = ?', array($trackId));
            if ($t !== null) return $t;
        }
        if ($vid !== '' && preg_match('/^[A-Za-z0-9_-]{11}$/', $vid)) {
            return db_one('SELECT id, title, artist, anime_name, anime_part, type FROM tracks WHERE youtube_id = ?', array($vid));
        }
    } catch (Exception $e) {}
    return null;
}

function meta_embed_feedback_batch() {
    // v12: rate_limit(30) removed here — the dispatcher applies it at the
    // route entry (same double-increment bug as embed-fallback had).
    $reports = body_get('reports', null);
    if (!is_array($reports)) err_out(400, 'Bad request', 'reports must be an array');
    if (count($reports) > 200) $reports = array_slice($reports, 0, 200);
    $n = 0;
    foreach ($reports as $r) {
        $vid = is_array($r) ? (isset($r['videoId']) ? (string)$r['videoId'] : '') : (string)$r;
        $code = is_array($r) && isset($r['code']) ? (int)$r['code'] : 0;
        if (preg_match('/^[A-Za-z0-9_-]{11}$/', $vid)) {
            an_embed_feedback_record($vid, $code);
            $n++;
        }
    }
    json_out(array('ok' => true, 'recorded' => $n), 200);
}

function meta_full_playlist_discovery() {
    $animeName = isset($_GET['animeName']) ? (string)$_GET['animeName'] : '';
    if ($animeName === '') err_out(400, 'Bad request', 'animeName is required');
    $q = $animeName . ' anime full original soundtrack OST playlist';
    $res = yt_search($q, 10);
    $topPlaylists = array();
    foreach (array_slice($res['playlists'], 0, 10) as $p) {
        $topPlaylists[] = array('listId' => $p['listId'], 'title' => $p['title'], 'author' => $p['author'], 'videoCount' => isset($p['videoCount']) ? $p['videoCount'] : 0);
    }
    if (count($topPlaylists) === 0) err_out(404, 'Not found', 'No playlists found for this anime');
    $bestListId = $topPlaylists[0]['listId'];
    $playlistVideos = yt_playlist_videos($bestListId, 40);
    $videos = array();
    foreach (array_slice($playlistVideos, 0, 40) as $v) $videos[] = array('videoId' => $v['videoId'], 'rawTitle' => $v['title']);
    if (count($videos) === 0) err_out(404, 'Not found', 'Playlist is empty');
    $tracks = array();
    foreach ($videos as $v) {
        $tracks[] = array(
            'title' => trim(preg_replace('/\[.*?\]|\(.*?\)/', '', $v['rawTitle'])),
            'artist' => 'Various Artists', 'type' => 'OST',
            'tags' => array('Iconic', 'BGM', 'RawImport'), 'animeName' => $animeName, 'youtubeId' => $v['videoId'],
        );
    }
    json_out(array('osts' => $tracks), 200);
}

function meta_youtube_search() {
    $query = isset($_GET['q']) ? (string)$_GET['q'] : '';
    if ($query === '') err_out(400, 'Bad request', 'q is required');
    $res = yt_search($query, 30);
    $videos = array();
    foreach ($res['videos'] as $v) {
        $videos[] = array('title' => $v['title'], 'videoId' => $v['videoId'], 'duration' => $v['duration'], 'author' => $v['author']);
    }
    $playlists = array();
    foreach (array_slice($res['playlists'], 0, 10) as $p) {
        $playlists[] = array('title' => $p['title'], 'listId' => $p['listId'], 'videoCount' => isset($p['videoCount']) ? $p['videoCount'] : 0, 'author' => isset($p['author']) && $p['author'] !== '' ? $p['author'] : 'YouTube');
    }
    json_out(array('videos' => $videos, 'playlists' => $playlists), 200);
}

function meta_youtube_playlist_fetch() {
    $listId = isset($_GET['listId']) ? (string)$_GET['listId'] : '';
    if ($listId === '') err_out(400, 'Bad request', 'listId is required');
    $videos = yt_playlist_videos($listId, 60);
    $out = array();
    foreach ($videos as $v) {
        $out[] = array('videoId' => $v['videoId'], 'title' => $v['title'], 'author' => $v['author'], 'duration' => $v['duration']);
    }
    json_out(array('videos' => $out), 200);
}

function meta_itunes_albums() {
    $animeName = isset($_GET['animeName']) ? (string)$_GET['animeName'] : '';
    if ($animeName === '') err_out(400, 'Bad request', 'animeName is required');
    $data = http_get_json('https://itunes.apple.com/search?term=' . rawurlencode($animeName . ' soundtrack') . '&entity=album&limit=6', 8, 'Mozilla/5.0');
    if ($data === null || !isset($data['results']) || count($data['results']) === 0) {
        err_out(404, 'Not found', 'No official albums found');
    }
    $albumsToFetch = array();
    foreach (array_slice($data['results'], 0, 4) as $album) {
        $cName = strtolower(isset($album['collectionName']) ? (string)$album['collectionName'] : '');
        if (strpos($cName, 'cover') === false && strpos($cName, 'tribute') === false && strpos($cName, 'inspired') === false) {
            $albumsToFetch[] = $album;
        }
    }
    $albums = array();
    foreach ($albumsToFetch as $album) {
        $albums[] = array(
            'collectionId' => isset($album['collectionId']) ? $album['collectionId'] : null,
            'collectionName' => isset($album['collectionName']) ? $album['collectionName'] : '',
            'artistName' => isset($album['artistName']) ? $album['artistName'] : '',
            'artworkUrl' => isset($album['artworkUrl100']) ? $album['artworkUrl100'] : null,
            'releaseDate' => isset($album['releaseDate']) ? $album['releaseDate'] : null,
            'trackCount' => isset($album['trackCount']) ? $album['trackCount'] : null,
        );
    }
    $allTracks = array();
    $seen = array();
    foreach ($albumsToFetch as $album) {
        if (empty($album['collectionId'])) continue;
        $tracksData = http_get_json('https://itunes.apple.com/lookup?id=' . (int)$album['collectionId'] . '&entity=song', 8, 'Mozilla/5.0');
        if ($tracksData === null || !isset($tracksData['results'])) continue;
        foreach ($tracksData['results'] as $t) {
            if (isset($t['wrapperType']) && $t['wrapperType'] === 'track' && !empty($t['trackName'])) {
                $lower = strtolower(trim((string)$t['trackName']));
                if (isset($seen[$lower])) continue;
                $seen[$lower] = true;
                $allTracks[] = array(
                    'title' => trim((string)$t['trackName']),
                    'artist' => isset($t['artistName']) ? trim((string)$t['artistName']) : 'Unknown Artist',
                    'type' => 'OST', 'tags' => array('Official Album', 'BGM', 'Imported'),
                    'animeName' => $animeName, 'youtubeId' => '',
                );
            }
        }
    }
    json_out(array('osts' => $allTracks, 'albums' => $albums), 200);
}

function an_normalize_title($title) {
    if (!$title) return '';
    $t = strtolower((string)$title);
    $isTv = strpos($t, 'tv size') !== false || strpos($t, 'tv-size') !== false || strpos($t, 'tv edit') !== false;
    $isInst = strpos($t, 'instrumental') !== false || strpos($t, 'off vocal') !== false || strpos($t, 'karaoke') !== false || strpos($t, 'inst') !== false;
    $isRemix = strpos($t, 'remix') !== false || strpos($t, 'arrange') !== false;
    $t = preg_replace('/\(.*?\)/', '', $t);
    $t = preg_replace('/\[.*?\]/', '', $t);
    $t = preg_replace('/~.*?~/', '', $t);
    $t = preg_replace('/[^a-z0-9]/i', '', $t);
    $t = trim($t);
    if ($isTv) $t .= '_tv';
    if ($isInst) $t .= '_inst';
    if ($isRemix) $t .= '_remix';
    return $t;
}

function an_align_merge_tracks($listA, $listB) {
    $merged = array();
    $mapA = array();
    foreach ($listA as $item) {
        $key = an_normalize_title(isset($item['title']) ? $item['title'] : '');
        if ($key !== '') $mapA[$key] = $item;
        else $merged[] = $item;
    }
    foreach ($listB as $itemB) {
        $keyB = an_normalize_title(isset($itemB['title']) ? $itemB['title'] : '');
        if ($keyB === '') { $merged[] = $itemB; continue; }
        if (isset($mapA[$keyB])) {
            $itemA = $mapA[$keyB];
            $merged[] = array(
                'title' => (strlen((string)$itemA['title']) >= strlen((string)$itemB['title'])) ? $itemA['title'] : $itemB['title'],
                'artist' => (!empty($itemB['artist']) && strtolower((string)$itemB['artist']) !== 'unknown') ? $itemB['artist'] : (isset($itemA['artist']) ? $itemA['artist'] : 'Unknown'),
                'type' => 'OST',
                'tags' => array('VGMdb', 'Soundtrack'),
                'animeName' => (isset($itemB['animeName']) ? $itemB['animeName'] : (isset($itemA['animeName']) ? $itemA['animeName'] : '')),
            );
            unset($mapA[$keyB]);
        } else {
            $merged[] = $itemB;
        }
    }
    foreach ($mapA as $item) $merged[] = $item;
    return $merged;
}

function meta_anime_osts() {
    $animeName = isset($_GET['animeName']) ? (string)$_GET['animeName'] : '';
    if ($animeName === '') err_out(400, 'Bad request', 'animeName is required');
    $cacheKey = 'osts:' . strtolower(trim($animeName));
    $cached = cache_get($cacheKey);
    if ($cached !== null) json_out(array('osts' => $cached), 200);

    $anisonTracks = scrape_anison($animeName);
    $anidbTracks = scrape_anidb($animeName);
    $filteredAnison = array(); $filteredAnidb = array();
    foreach ($anisonTracks as $t) { if ($t['type'] === 'OST' || $t['type'] === 'IN') $filteredAnison[] = $t; }
    foreach ($anidbTracks as $t) { if ($t['type'] === 'OST' || $t['type'] === 'IN') $filteredAnidb[] = $t; }
    $mergedOsts = an_align_merge_tracks($filteredAnison, $filteredAnidb);
    $finalOsts = array_slice($mergedOsts, 0, 30);
    if (count($finalOsts) > 0) {
        cache_set($cacheKey, $finalOsts, 3600000);
        json_out(array('osts' => $finalOsts), 200);
    }
    $templates = array();
    foreach (get_theme_templates($animeName) as $t) { if ($t['type'] === 'OST') $templates[] = $t; }
    json_out(array('osts' => $templates), 200);
}

function meta_lyrics() {
    $title = body_get('title', null);
    $artist = body_get('artist', null);
    $animeName = body_get('animeName', null);
    if (!$title || !$animeName) err_out(400, 'Bad request', 'title and animeName are required.');
    $cacheKey = 'lyrics:' . strtolower(trim($animeName . '_' . $title));
    $cached = cache_get($cacheKey);
    if ($cached !== null) json_out($cached, 200);

    $candidates = array();
    if ($artist) $candidates[] = (string)$artist;
    $candidates[] = (string)$animeName;
    foreach ($candidates as $cand) {
        $exact = http_get_json('https://lrclib.net/api/get?' . http_build_query(array('track_name' => (string)$title, 'artist_name' => $cand)), 8, 'ANISYNC/1.0 (https://anisync.app)');
        if ($exact !== null && (isset($exact['plainLyrics']) || isset($exact['syncedLyrics'])) && ($exact['plainLyrics'] !== null || $exact['syncedLyrics'] !== null)) {
            $payload = an_lyrics_payload($exact);
            cache_set($cacheKey, $payload, 3600000);
            json_out($payload, 200);
        }
        $results = http_get_json('https://lrclib.net/api/search?' . http_build_query(array('track_name' => (string)$title, 'artist_name' => $cand)), 8, 'ANISYNC/1.0 (https://anisync.app)');
        if (is_array($results) && count($results) > 0) {
            $best = null; $bestScore = -1;
            foreach ($results as $r) {
                if (empty($r['syncedLyrics']) && empty($r['plainLyrics'])) continue;
                $score = 0;
                if (!empty($r['syncedLyrics'])) $score += 100;
                if ($score > $bestScore) { $bestScore = $score; $best = $r; }
            }
            if ($best !== null) {
                $payload = an_lyrics_payload($best);
                cache_set($cacheKey, $payload, 3600000);
                json_out($payload, 200);
            }
        }
    }
    $stub = array(
        'source' => 'stub',
        'japanese' => array('歌詞の同期にはAIが必要です', 'ウェブサイトから直接スクレイピングしています'),
        'romaji' => array('Kashi no douki ni wa AI ga hitsuyou desu', 'Web-site kara chokusetsu scraping shiteimasu'),
        'english' => array('Lyrics not found in LRCLIB — this is a placeholder.', 'Try a different track title or add lyrics at lrclib.net'),
        'meaning' => 'No synced lyrics found in LRCLIB for this track. Karaoke mode is unavailable.',
    );
    cache_set($cacheKey, $stub, 3600000);
    json_out($stub, 200);
}

function an_lyrics_payload($result) {
    $syncedLines = array();
    if (!empty($result['syncedLyrics'])) {
        $lines = explode("\n", (string)$result['syncedLyrics']);
        foreach ($lines as $line) {
            if (preg_match_all('/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/', $line, $m, PREG_SET_ORDER)) {
                $text = trim(preg_replace('/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/', '', $line));
                foreach ($m as $mm) {
                    $frac = isset($mm[3]) ? $mm[3] : '0';
                    $fracVal = ((int)$frac) / pow(10, strlen($frac));
                    $syncedLines[] = array('time' => ((int)$mm[1]) * 60 + ((int)$mm[2]) + $fracVal, 'text' => $text);
                }
            }
        }
    }
    $plainLines = array();
    if (!empty($result['plainLyrics'])) $plainLines = explode("\n", (string)$result['plainLyrics']);
    return array(
        'source' => 'lrclib',
        'trackName' => isset($result['trackName']) ? $result['trackName'] : null,
        'artistName' => isset($result['artistName']) ? $result['artistName'] : null,
        'albumName' => isset($result['albumName']) ? $result['albumName'] : null,
        'synced' => $syncedLines,
        'plainLyrics' => isset($result['plainLyrics']) ? $result['plainLyrics'] : null,
        'syncedLyrics' => isset($result['syncedLyrics']) ? $result['syncedLyrics'] : null,
        'japanese' => $plainLines,
        'romaji' => array(),
        'english' => $plainLines,
        'meaning' => 'Lyrics via LRCLIB.',
    );
}

function meta_bulk_anime_list() {
    $perPage = isset($_GET['limit']) ? (int)$_GET['limit'] : 50;
    $page = isset($_GET['startPage']) ? (int)$_GET['startPage'] : 1;
    if ($perPage <= 0) $perPage = 50;
    if ($page <= 0) $page = 1;
    $query = 'query ($page: Int, $perPage: Int) { Page(page: $page, perPage: $perPage) { pageInfo { hasNextPage currentPage lastPage } media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) { id idMal title { romaji english native } coverImage { large medium } format seasonYear season episodes averageScore popularity } } }';
    $d = anilist_query($query, array('page' => $page, 'perPage' => $perPage));
    if ($d === null) err_out(500, 'Internal', 'Failed to fetch anime list');
    $media = an_deep_get($d, array('data', 'Page', 'media'));
    $pageInfo = an_deep_get($d, array('data', 'Page', 'pageInfo'));
    if ($media === null) $media = array();
    if (!is_array($pageInfo)) $pageInfo = array();
    $list = array();
    foreach ($media as $a) {
        $title = an_deep_get($a, array('title', 'english'));
        if ($title === null || $title === '') $title = an_deep_get($a, array('title', 'romaji'));
        if ($title === null || $title === '') $title = an_deep_get($a, array('title', 'native'));
        $list[] = array(
            'title' => $title !== null && $title !== '' ? (string)$title : 'Unknown',
            'mal_id' => isset($a['idMal']) ? $a['idMal'] : null,
            'anilist_id' => isset($a['id']) ? $a['id'] : null,
            'cover' => an_deep_get($a, array('coverImage', 'large')) !== null ? an_deep_get($a, array('coverImage', 'large')) : an_deep_get($a, array('coverImage', 'medium')),
            'format' => isset($a['format']) ? $a['format'] : null,
            'year' => isset($a['seasonYear']) ? $a['seasonYear'] : null,
            'season' => isset($a['season']) ? $a['season'] : null,
            'episodes' => isset($a['episodes']) ? $a['episodes'] : null,
            'score' => isset($a['averageScore']) ? $a['averageScore'] : null,
            'popularity' => isset($a['popularity']) ? $a['popularity'] : null,
        );
    }
    json_out(array(
        'anime' => $list,
        'pageInfo' => array(
            'currentPage' => isset($pageInfo['currentPage']) ? $pageInfo['currentPage'] : $page,
            'hasNextPage' => isset($pageInfo['hasNextPage']) ? (bool)$pageInfo['hasNextPage'] : false,
            'lastPage' => isset($pageInfo['lastPage']) ? $pageInfo['lastPage'] : 1,
        ),
    ), 200);
}

$GLOBALS['_CURATED_POPULAR'] = array(
    array('Shingeki no Kyojin', 16498), array('Naruto Shippuden', 1735), array('One Piece', 21),
    array('Fullmetal Alchemist: Brotherhood', 5114), array('Kimetsu no Yaiba', 38000),
    array('Jujutsu Kaisen', 40748), array('Death Note', 1535), array('Boku no Hero Academia', 31964),
    array('Hunter x Hunter (2011)', 11061), array('Steins;Gate', 9253),
    array('Neon Genesis Evangelion', 30), array('Chainsaw Man', 44511), array('Tokyo Ghoul', 22319),
    array('One Punch Man', 30276), array('Mob Psycho 100', 32182),
    array('Attack on Titan: Final Season', 42897), array('Demon Slayer: Entertainment District', 42153),
    array('Jujutsu Kaisen 0', 48561), array('Spy x Family', 50265), array('Bleach', 269),
    array('Code Geass', 1575), array('Cowboy Bebop', 1), array('Dragon Ball Z', 813),
    array('Fairy Tail', 6702), array('Sword Art Online', 11757),
);

function meta_bulk_popular() {
    $limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 12;
    $startPage = isset($_GET['startPage']) ? (int)$_GET['startPage'] : 1;
    $keepOrder = (isset($_GET['keepOrder']) && $_GET['keepOrder'] === 'true');
    if ($limit <= 0) $limit = 12;
    $animeMapList = array();
    for ($p = 0; $p < max(1, ceil($limit / 25)); $p++) {
        $pageToFetch = (!$keepOrder && $limit <= 25 && $startPage === 1) ? mt_rand(1, 200) : $startPage + $p;
        $d = jikan_get('/top/anime?type=tv&filter=bypopularity&page=' . (int)$pageToFetch, 8);
        if ($d !== null && isset($d['data']) && is_array($d['data'])) {
            foreach ($d['data'] as $a) {
                if (!empty($a['title'])) $animeMapList[] = array('title' => $a['title'], 'mal_id' => isset($a['mal_id']) ? $a['mal_id'] : null);
            }
        }
        if (count($animeMapList) >= $limit) break;
        usleep(900000);
    }
    if (count($animeMapList) === 0) {
        $animeMapList = array_slice($GLOBALS['_CURATED_POPULAR'], 0, $limit);
    }
    if (!$keepOrder) shuffle($animeMapList);
    $animeMapList = array_slice($animeMapList, 0, $limit);

    $flatThemes = array();
    $numThemes = 0;
    foreach ($animeMapList as $animeItem) {
        $themes = fetch_anime_themes_for_bulk($animeItem['title'], isset($animeItem['mal_id']) ? $animeItem['mal_id'] : null);
        if (is_array($themes) && count($themes) > 0) {
            foreach ($themes as $t) { $flatThemes[] = $t; }
            $numThemes += count($themes);
        }
        if ($numThemes >= $limit) break;
        usleep(350000);
    }
    $finalTracks = array();
    foreach ($flatThemes as $t) {
        $finalTracks[] = array(
            'id' => generate_id(''),
            'youtubeId' => '',
            'title' => isset($t['title']) ? $t['title'] : '',
            'artist' => isset($t['artist']) ? $t['artist'] : 'Unknown',
            'animeName' => isset($t['animeName']) ? $t['animeName'] : '',
            'type' => isset($t['type']) ? $t['type'] : 'OP',
            'elo' => 1200, 'matchesPlayed' => 0, 'wins' => 0, 'losses' => 0, 'draws' => 0,
            'addedByUser' => false,
            'tags' => isset($t['tags']) && is_array($t['tags']) ? $t['tags'] : array('Hype'),
        );
    }
    json_out(array('tracks' => $finalTracks), 200);
}

function an_taste_fallback($username, $spectrum) {
    $n = isset($spectrum['nostalgia']) ? (int)$spectrum['nostalgia'] : 50;
    $h = isset($spectrum['hype']) ? (int)$spectrum['hype'] : 50;
    $a = isset($spectrum['atmospheric']) ? (int)$spectrum['atmospheric'] : 50;
    $sy = isset($spectrum['symphonic']) ? (int)$spectrum['symphonic'] : 50;
    $v = isset($spectrum['vocalIntensity']) ? (int)$spectrum['vocalIntensity'] : 50;
    $name = $username !== null && $username !== '' ? $username : 'Music Fan';
    return array(
        'archetypeName' => 'The Harmonic Seeker',
        'archetypeTagline' => 'A balanced wanderer appreciating the multi-faceted soundscapes of anime history.',
        'auraGradient' => 'from-emerald-500 to-teal-600',
        'musicPsychAnalysis' => 'Hello ' . $name . '! Looking at your vibe weights, you appreciate a balanced blend of distinct musical frequencies.',
        'moodDimensionBreakdown' => array(
            'hypeLevel' => $h > 70 ? 'Unstoppable high-velocity adrenaline driver.' : 'Measured, focused rhythmic engine.',
            'nostalgiaLevel' => $n > 70 ? 'Anchored in classic timeless golden age arrangements.' : 'Futuristic modern wave focus.',
            'atmosphericVibe' => $a > 70 ? 'Deeply immersive and melancholic.' : 'Bright and outward-facing.',
            'symphonicDepth' => $sy > 70 ? 'Cinematic scale with organic backing instruments.' : 'Sleek electronic style.',
            'vocalPresence' => $v > 70 ? 'High-pitched vocal gymnastics.' : 'Rhythmic vocal textures.',
        ),
        'aiCuratedRecommendations' => array(
            array('title' => 'Again', 'artist' => 'YUI', 'animeName' => 'Fullmetal Alchemist: Brotherhood', 'type' => 'OP', 'reason' => 'Classic nostalgic rock melody.'),
            array('title' => 'Gurenge', 'artist' => 'LiSA', 'animeName' => 'Demon Slayer: Kimetsu no Yaiba', 'type' => 'OP', 'reason' => 'Absolute powerhouse of hype and vocal drive.'),
            array('title' => 'Secret Base', 'artist' => 'Kayano Ai', 'animeName' => 'Anohana', 'type' => 'ED', 'reason' => 'Sentimental atmospheric classic.'),
        ),
    );
}

function meta_analyze_taste() {
    $username = body_get('username', null);
    $vibeSpectrum = body_get('vibeSpectrum', null);
    $resolvedSpectrum = is_array($vibeSpectrum) ? $vibeSpectrum : array('nostalgia' => 50, 'hype' => 50, 'atmospheric' => 50, 'symphonic' => 50, 'vocalIntensity' => 50);
    json_out(an_taste_fallback($username, $resolvedSpectrum), 200);
}

function meta_analyze_track() {
    $title = body_get('title', null);
    $artist = body_get('artist', null);
    $animeName = body_get('animeName', null);
    $type = body_get('type', null);
    if (!$title || !$animeName) err_out(400, 'Bad request', 'title and animeName are required.');
    $isOP = ($type === 'OP');
    $isED = ($type === 'ED');
    $fallback = array(
        'title' => $title,
        'artist' => ($artist !== null && $artist !== '') ? $artist : 'Unknown Artist',
        'animeName' => $animeName,
        'estimatedBpm' => $isOP ? 168 : ($isED ? 112 : 124),
        'estimatedKey' => $isOP ? 'F# Minor / A Major' : ($isED ? 'E Major / C# Minor' : 'D Minor'),
        'instrumentation' => $isOP ? 'Soaring overdrive electric guitars and double-kick drums.' : 'Acoustic steel guitars and warm grand piano keys.',
        'harmonicVibe' => 'Energetic chord progression that resolves into an explosive chorus.',
        'contextTrivia' => 'Iconic theme underscoring the dramatic arcs of ' . $animeName . '.',
    );
    json_out($fallback, 200);
}

function meta_artist_image() {
    $artist = isset($_GET['artist']) ? (string)$_GET['artist'] : '';
    if ($artist === '') err_out(400, 'Bad request', 'artist parameter is required');
    $resultData = array('imageUrl' => null, 'bio' => null, 'birthday' => null, 'websiteUrl' => null, 'malUrl' => null);
    $data = http_get_json('https://itunes.apple.com/search?term=' . rawurlencode($artist) . '&entity=musicArtist&limit=1', 8, 'Mozilla/5.0');
    if ($data !== null && isset($data['results'][0]['artistLinkUrl'])) {
        $artistUrl = (string)$data['results'][0]['artistLinkUrl'];
        $html = http_get_html($artistUrl, 8);
        if ($html !== '' && preg_match('/<meta property="og:image" content="([^"]+)"/', $html, $m)) {
            $resultData['imageUrl'] = str_replace('1200x630cw.png', '600x600cw.png', $m[1]);
            $resultData['websiteUrl'] = $artistUrl;
        }
    }
    $jikan = http_get_json('https://api.jikan.moe/v4/people?q=' . rawurlencode($artist) . '&limit=1', 8, JIKAN_UA);
    if ($jikan !== null && isset($jikan['data'][0])) {
        $person = $jikan['data'][0];
        $img = an_deep_get($person, array('images', 'jpg', 'image_url'));
        if ($resultData['imageUrl'] === null && $img !== null && strpos((string)$img, 'questionmark') === false) {
            $resultData['imageUrl'] = (string)$img;
        }
        if ($resultData['bio'] === null && isset($person['about'])) $resultData['bio'] = $person['about'];
        if ($resultData['birthday'] === null && isset($person['birthday'])) $resultData['birthday'] = $person['birthday'];
        if (isset($person['website_url']) && $person['website_url'] !== null && $person['website_url'] !== '') $resultData['websiteUrl'] = $person['website_url'];
        if (isset($person['url'])) $resultData['malUrl'] = $person['url'];
    }
    json_out($resultData, 200);
}

function an_flatten_theme_results($results) {
    $tracks = array();
    if (!is_array($results)) return $tracks;
    foreach ($results as $r) {
        $animeName = an_deep_get($r, array('anime', 'name'));
        if ($animeName === null && isset($r['name'])) $animeName = $r['name'];
        $themes = an_deep_get($r, array('themes'));
        if (!is_array($themes)) $themes = an_deep_get($r, array('animethemes'));
        if (!is_array($themes)) continue;
        foreach ($themes as $t) {
            $slug = isset($t['slug']) ? (string)$t['slug'] : '';
            $type = 'OST';
            if (strpos($slug, 'OP') === 0) $type = 'OP';
            elseif (strpos($slug, 'ED') === 0) $type = 'ED';
            $title = an_deep_get($t, array('song', 'title'));
            $artistName = 'Unknown';
            $artists = an_deep_get($t, array('song', 'artists'));
            if (is_array($artists) && count($artists) > 0) {
                $names = array();
                foreach ($artists as $art) {
                    $n = isset($art['name']) ? $art['name'] : (isset($art['as']) ? $art['as'] : '');
                    if ($n !== '') $names[] = $n;
                }
                if (count($names) > 0) $artistName = implode(', ', $names);
            }
            if ($title !== null && $title !== '') {
                $tracks[] = array(
                    'title' => (string)$title,
                    'artist' => $artistName,
                    'type' => $type,
                    'tags' => array('Hype'),
                    'animeName' => $animeName !== null ? (string)$animeName : '',
                );
            }
        }
    }
    return $tracks;
}

function meta_animethemes_search() {
    $animeName = "";
    if (isset($_GET['animeName']) && $_GET['animeName'] !== "") $animeName = (string)$_GET['animeName'];
    elseif (isset($_GET['q']) && $_GET['q'] !== "") $animeName = (string)$_GET['q'];
    elseif (isset($_GET['name']) && $_GET['name'] !== "") $animeName = (string)$_GET['name'];
    elseif (isset($_GET['anime']) && $_GET['anime'] !== "") $animeName = (string)$_GET['anime'];
    if ($animeName === "") err_out(400, 'Bad request', 'animeName is required');
    $data = animethemes_search($animeName, 10);
    $tracks = array();
    if ($data !== null && isset($data['anime'])) {
        $tracks = an_flatten_theme_results($data['anime']);
    }
    json_out(array('tracks' => $tracks, 'source' => 'animethemes'), 200);
}

function meta_anilist_search() {
    $q = isset($_GET['q']) ? (string)$_GET['q'] : '';
    if ($q === '') err_out(400, 'Bad request', 'q is required');
    $query = 'query ($q: String) { Page(perPage: 8) { media(search: $q, type: ANIME) { id idMal title { romaji english native } coverImage { large medium } format seasonYear episodes averageScore popularity description(asHtml: false) genres studios(isMain: true) { nodes { id name } } } } }';
    $d = anilist_query($query, array('q' => $q));
    $results = an_deep_get($d, array('data', 'Page', 'media'));
    if (!is_array($results)) $results = array();
    json_out(array('results' => $results), 200);
}

function meta_anilist_anime() {
    $id = isset($_GET['id']) ? (int)$_GET['id'] : 0;
    if ($id === 0) err_out(400, 'Bad request', 'id is required');
    $query = 'query ($id: Int) { Media(id: $id, type: ANIME) { id idMal title { romaji english native } coverImage { extraLarge large medium color } bannerImage format episodes duration season seasonYear genres averageScore popularity description(asHtml: false) startDate { year month day } studios { nodes { id name isAnimation } } staff(sort: RELEVANCE, perPage: 12) { nodes { id name { full native } image { large } language primaryOccupations } } } }';
    $d = anilist_query($query, array('id' => $id));
    $anime = an_deep_get($d, array('data', 'Media'));
    if (!is_array($anime)) $anime = null;
    json_out(array('anime' => $anime), 200);
}

function meta_anilist_staff_works() {
    $id = isset($_GET['id']) ? (int)$_GET['id'] : 0;
    if ($id === 0) err_out(400, 'Bad request', 'id is required');
    $query = 'query ($id: Int) { Staff(id: $id) { id name { full native } image { large } staffRelations(perPage: 25, sort: RELEVANCE) { edges { role node { id title { romaji english } coverImage { large } format seasonYear averageScore } } } } }';
    $d = anilist_query($query, array('id' => $id));
    $works = array();
    $edges = an_deep_get($d, array('data', 'Staff', 'staffRelations', 'edges'));
    if (is_array($edges)) {
        foreach ($edges as $e) {
            $node = isset($e['node']) ? $e['node'] : null;
            if (!is_array($node)) continue;
            $works[] = array(
                'id' => isset($node['id']) ? $node['id'] : null,
                'title' => an_deep_get($node, array('title', 'romaji')) !== null ? an_deep_get($node, array('title', 'romaji')) : an_deep_get($node, array('title', 'english')),
                'role' => isset($e['role']) ? $e['role'] : '',
                'cover' => an_deep_get($node, array('coverImage', 'large')),
                'year' => isset($node['seasonYear']) ? $node['seasonYear'] : null,
            );
        }
    }
    json_out(array('works' => $works), 200);
}

function meta_anilist_staff_search() {
    $q = isset($_GET['q']) ? (string)$_GET['q'] : '';
    if ($q === '') err_out(400, 'Bad request', 'q is required');
    $query = 'query ($q: String) { Page(perPage: 5) { staff(search: $q) { id name { full native } image { large } language primaryOccupations } } }';
    $d = anilist_query($query, array('q' => $q));
    $results = an_deep_get($d, array('data', 'Page', 'staff'));
    if (!is_array($results)) $results = array();
    json_out(array('results' => $results), 200);
}

function meta_mb_recordings() {
    $title = isset($_GET['title']) ? (string)$_GET['title'] : '';
    $artist = isset($_GET['artist']) ? (string)$_GET['artist'] : null;
    if ($title === '') err_out(400, 'Bad request', 'title is required');
    $recordings = mb_search_recordings($title, $artist, 10);
    json_out(array('recordings' => $recordings), 200);
}

function meta_mb_cover_art() {
    $title = isset($_GET['title']) ? (string)$_GET['title'] : '';
    $artist = isset($_GET['artist']) ? (string)$_GET['artist'] : null;
    if ($title === '') err_out(400, 'Bad request', 'title is required');
    $url = mb_find_cover_art($title, $artist);
    if ($url === null) err_out(404, 'Not found', 'No cover art found');
    json_out(array('url' => $url), 200);
}

function meta_lastfm_artist() {
    $artist = isset($_GET['artist']) ? (string)$_GET['artist'] : '';
    if ($artist === '') err_out(400, 'Bad request', 'artist is required');
    if (LASTFM_API_KEY === '') err_out(503, 'Service unavailable', 'LASTFM_API_KEY not configured');
    $data = lastfm_call('artist.getinfo', array('artist' => $artist, 'autocorrect' => '1'));
    if ($data === null || !isset($data['artist'])) err_out(404, 'Not found', 'Artist not found');
    $a = $data['artist'];
    $tags = array();
    if (isset($a['tags']['tag'])) {
        $tagArr = isset($a['tags']['tag']['name']) ? array($a['tags']['tag']) : $a['tags']['tag'];
        foreach ($tagArr as $t) { if (isset($t['name'])) $tags[] = $t['name']; }
    }
    json_out(array('artist' => array(
        'name' => isset($a['name']) ? $a['name'] : $artist,
        'mbid' => isset($a['mbid']) ? $a['mbid'] : null,
        'url' => isset($a['url']) ? $a['url'] : null,
        'bio' => an_deep_get($a, array('bio', 'summary')),
        'listeners' => isset($a['stats']['listeners']) ? (int)$a['stats']['listeners'] : null,
        'tags' => $tags,
        'image' => an_deep_get($a, array('image', 3, '#text')),
    )), 200);
}

function meta_lastfm_similar() {
    $artist = isset($_GET['artist']) ? (string)$_GET['artist'] : '';
    if ($artist === '') err_out(400, 'Bad request', 'artist is required');
    if (LASTFM_API_KEY === '') err_out(503, 'Service unavailable', 'LASTFM_API_KEY not configured');
    $data = lastfm_call('artist.getsimilar', array('artist' => $artist, 'autocorrect' => '1', 'limit' => 8));
    $similar = array();
    if ($data !== null && isset($data['similarartists']['artist'])) {
        $arr = isset($data['similarartists']['artist']['name']) ? array($data['similarartists']['artist']) : $data['similarartists']['artist'];
        foreach (array_slice($arr, 0, 8) as $a) {
            $similar[] = array('name' => isset($a['name']) ? $a['name'] : '', 'url' => isset($a['url']) ? $a['url'] : null);
        }
    }
    json_out(array('similar' => $similar), 200);
}

function an_is_unknown_artist($s) {
    if ($s === null || $s === '') return true;
    $v = strtolower(trim((string)$s));
    $unknowns = array('', 'unknown', 'unknown artist', 'unknown performer', 'various', 'various artists', 'n/a', 'original artist', 'soundtrack composer', 'original composer');
    return in_array($v, $unknowns, true);
}

function an_lookup_artist_for_track($animeName, $title, $type) {
    $candidates = array();
    $targetTitle = strtolower(trim((string)$title));
    $targetType = strtoupper((string)$type);
    
    $data = animethemes_search($animeName, 5);
    if ($data !== null && isset($data['anime'])) {
        $flat = an_flatten_theme_results($data['anime']);
        if (count($flat) > 0) {
            $match = null;
            foreach ($flat as $t) {
                $lt = strtolower(trim($t['title']));
                if ($lt === $targetTitle && ($targetType === '' || $t['type'] === $targetType)) { $match = $t; break; }
            }
            if ($match === null) { foreach ($flat as $t) { if (strtolower(trim($t['title'])) === $targetTitle) { $match = $t; break; } } }
            if ($match !== null && !an_is_unknown_artist($match['artist'])) {
                $candidates[] = array('artist' => $match['artist'], 'source' => 'animethemes', 'confidence' => 100);
            }
        }
    }
    an_usort_desc($candidates, 'confidence');
    if (count($candidates) === 0) return array('artist' => null, 'source' => 'none', 'candidates' => array());
    return array('artist' => $candidates[0]['artist'], 'source' => $candidates[0]['source'], 'candidates' => $candidates);
}

function meta_lookup_artist() {
    $animeName = body_get('animeName', null);
    $title = body_get('title', null);
    $type = body_get('type', null);
    if (!$animeName || !$title) err_out(400, 'Bad request', 'animeName and title are required.');
    $cacheKey = 'artistlookup:' . strtolower(trim((string)$animeName)) . '|' . strtolower(trim((string)$title)) . '|' . strtoupper((string)$type);
    $cached = cache_get($cacheKey);
    if ($cached !== null) {
        json_out(array('artist' => isset($cached['artist']) ? $cached['artist'] : null, 'source' => isset($cached['source']) ? $cached['source'] : 'none', 'cached' => true), 200);
    }
    $result = an_lookup_artist_for_track($animeName, $title, $type);
    cache_set($cacheKey, array('artist' => $result['artist'], 'source' => $result['source']), 86400000);
    json_out(array('artist' => $result['artist'], 'source' => $result['source'], 'candidates' => $result['candidates']), 200);
}

function meta_lookup_artists_batch() {
    $tracks = body_get('tracks', null);
    if (!is_array($tracks) || count($tracks) === 0) err_out(400, 'Bad request', 'tracks array is required.');
    $results = array();
    $startMs = now_ms();
    foreach ($tracks as $t) {
        if (!is_array($t) || empty($t['animeName']) || empty($t['title'])) continue;
        $cacheKey = 'artistlookup:' . strtolower(trim((string)$t['animeName'])) . '|' . strtolower(trim((string)$t['title'])) . '|' . strtoupper((string)(isset($t['type']) ? $t['type'] : ''));
        $cached = cache_get($cacheKey);
        if ($cached !== null) {
            $results[(string)$t['id']] = array('artist' => isset($cached['artist']) ? $cached['artist'] : null, 'source' => isset($cached['source']) ? $cached['source'] : 'none');
            continue;
        }
        $r = an_lookup_artist_for_track($t['animeName'], $t['title'], isset($t['type']) ? $t['type'] : null);
        $entry = array('artist' => $r['artist'], 'source' => $r['source']);
        cache_set($cacheKey, $entry, 86400000);
        $results[(string)$t['id']] = $entry;
    }
    json_out(array('results' => $results, 'elapsed_ms' => now_ms() - $startMs, 'resolved_count' => count($results), 'total_count' => count($tracks)), 200);
}

function meta_vibe_spectrum() {
    $tracks = body_get('tracks', null);
    $neutral = array('nostalgia' => 50, 'hype' => 50, 'atmospheric' => 50, 'symphonic' => 50, 'vocalIntensity' => 50);
    if (!is_array($tracks) || count($tracks) === 0) {
        json_out(array('vibe' => $neutral, 'tagCounts' => new stdClass(), 'trackCount' => 0, 'cached' => false), 200);
    }
    $tagCounts = array();
    foreach ($tracks as $t) {
        $tags = generate_song_tags(
            isset($t['title']) ? (string)$t['title'] : '',
            isset($t['artist']) ? (string)$t['artist'] : '',
            isset($t['animeName']) ? (string)$t['animeName'] : '',
            isset($t['type']) ? (string)$t['type'] : 'OP'
        );
        foreach ($tags as $tag) {
            if (!isset($tagCounts[$tag])) $tagCounts[$tag] = 0;
            $tagCounts[$tag]++;
        }
    }
    $trackCount = count($tracks);
    $softCap = max(3, $trackCount * 1.5);
    $vibe = array(
        'nostalgia' => an_vibe_norm(an_sum_tags($tagCounts, array('Nostalgic', 'Bittersweet', 'Brooding')), $softCap),
        'hype' => an_vibe_norm(an_sum_tags($tagCounts, array('Hype', 'Epic', 'Energetic', 'Aggressive', 'Intense', 'Fast', 'Driving', 'Anthemic', 'Triumphant', 'Tense')), $softCap),
        'atmospheric' => an_vibe_norm(an_sum_tags($tagCounts, array('Chill', 'Melancholic', 'Sad', 'Dreamy', 'Ambient', 'Serene', 'Mysterious', 'Whimsical', 'Romantic', 'Hopeful')), $softCap),
        'symphonic' => an_vibe_norm(an_sum_tags($tagCounts, array('Orchestral', 'Classical', 'Instrumental', 'Acoustic', 'Choir')), $softCap),
        'vocalIntensity' => an_vibe_norm(an_sum_tags($tagCounts, array('Male Vocal', 'Female Vocal', 'Group Vocal', 'Duet', 'Falsetto', 'Rap', 'Screamo')), $softCap),
    );
    json_out(array('vibe' => $vibe, 'tagCounts' => $tagCounts, 'trackCount' => $trackCount), 200);
}

function an_sum_tags($tagCounts, $names) {
    $total = 0;
    foreach ($names as $n) { if (isset($tagCounts[$n])) $total += $tagCounts[$n]; }
    return $total;
}

function an_vibe_norm($count, $softCap) {
    $v = (int)round(($count / $softCap) * 100);
    if ($v > 100) $v = 100;
    if ($v < 10) $v = 10;
    return $v;
}

function meta_musicbrainz_recordings() {
    $title = isset($_GET["title"]) ? trim((string)$_GET["title"]) : "";
    $artist = isset($_GET["artist"]) ? trim((string)$_GET["artist"]) : "";
    if ($title === "") err_out(400, "Bad request", "title is required");

    $query = 'recording:"' . $title . '"';
    if ($artist !== "") $query .= ' AND artist:"' . $artist . '"';

    $url = "https://musicbrainz.org/ws/2/recording?query=" . urlencode($query) . "&fmt=json&limit=10";
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 3);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 2);
    curl_setopt($ch, CURLOPT_USERAGENT, "AniSync/1.0.0 ( contact@anisync.local )");
    curl_setopt($ch, CURLOPT_HTTPHEADER, array("Accept: application/json"));
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    
    $res = curl_exec($ch);
    $http_code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($http_code === 200 && $res) {
        $data = json_decode($res, true);
        if (isset($data["recordings"]) && is_array($data["recordings"])) {
            json_out(array("recordings" => $data["recordings"]), 200);
        }
    }
    json_out(array("recordings" => array()), 200);
}