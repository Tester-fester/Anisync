import React, { useState, useMemo, useEffect } from 'react';
import { AnimeTrack, TrackType, TrackReview } from '../types';
import { getAnimeEraAndYear } from '../utils/animeEras';
import { stripTypeTags } from '../utils/songTags';
import { toast } from 'sonner';
import { subscribeTrackReviews, addTrackReview, checkAndAwardCompletistBadge } from '../utils/firestoreService';
import { motion, AnimatePresence } from 'motion/react';
import { AnimatedCounter } from './AnimatedCounter';
import { ExportPlaylistMenu } from './ExportPlaylistMenu';
import SaveToPlaylistModal from './SaveToPlaylistModal';
import { AreaChart, Area, XAxis as ChartXAxis, YAxis as ChartYAxis, Tooltip as ChartTooltip, ResponsiveContainer } from 'recharts';
import {
  Play, Music, Tv, Plus, X, ListFilter, Heart, Bookmark, Loader2, Star,
  MessageSquare, AlertCircle, Trash2, ExternalLink, Youtube,
  Award, ArrowUp, ArrowDown, Check, Send, ListMusic,
} from '@/utils/icons';

const ERA_SHORT: Record<string, string> = {
  retro: 'Retro', classic: 'Classic', modern: 'Modern', reiwa: 'Reiwa',
};

const videoStatusCache = new Map<string, 'alive' | 'dead'>();

const extractYoutubeId = (url: string): string => {
  if (!url) return '';
  const trimmed = url.trim();
  if (trimmed.length === 11) return trimmed;
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = trimmed.match(regExp);
  return (match && match[2].length === 11) ? match[2] : trimmed;
};

const winRate = (t: AnimeTrack) =>
  t.matchesPlayed > 0 ? Math.round((t.wins / t.matchesPlayed) * 100) : null;

function WikiLink({
  wiki, type, value, className = '', hoverCls = 'hover:text-white',
}: {
  wiki?: (type: 'anime' | 'artist' | 'part' | 'track', key: string) => void;
  type: 'anime' | 'artist';
  value?: string;
  className?: string;
  hoverCls?: string;
}) {
  if (!value || !wiki) return <span className={className}>{value}</span>;
  return (
    <span
      onClick={(e) => { e.stopPropagation(); wiki(type, value); }}
      className={`${className} ${hoverCls} hover:underline underline-offset-2 decoration-dotted decoration-zinc-600 cursor-pointer transition-colors`}
      title={`View ${type === 'anime' ? 'anime' : 'artist'} page · ${value}`}
    >
      {value}
    </span>
  );
}

function LeaderboardTrackArtwork({ track, onPlay }: {
  track: AnimeTrack; onPlay: (t: AnimeTrack) => void;
}) {
  const [hasError, setHasError] = useState(false);
  return (
    <div
      className="relative w-12 h-12 md:w-14 md:h-14 shrink-0 rounded-lg overflow-hidden border border-zinc-800 bg-zinc-950 flex items-center justify-center cursor-pointer"
      onClick={(e) => { e.stopPropagation(); onPlay(track); }}
      title="Play Track"
    >
      {hasError ? (
        <Music className="w-5 h-5 text-zinc-600" />
      ) : (
        <img
          src={track.customImageUrl || `https://img.youtube.com/vi/${track.youtubeId}/mqdefault.jpg`}
          alt={track.title}
          className="w-full h-full object-cover group-hover:opacity-90 transition-all duration-300"
          referrerPolicy="no-referrer" loading="lazy" decoding="async"
          onError={() => setHasError(true)}
        />
      )}
      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
        <Play className="w-5 h-5 text-brand-primary fill-brand-primary drop-shadow-[0_0_8px_rgba(255, 61, 46,0.8)]" />
      </div>
    </div>
  );
}

function TrackPreviewDrawer({
  track, tracks, recentHistory, currentUser, onClose, onPlay,
  onSubmitProposal, onUpdateTrackYtId, onUpdateTrackTags, onDeleteTrack, onShowWiki, onSaveTrack,
}: {
  track: AnimeTrack;
  tracks: AnimeTrack[];
  recentHistory: any[];
  currentUser: any;
  onClose: () => void;
  onPlay: (t: AnimeTrack) => void;
  onSubmitProposal?: (p: any) => void;
  onUpdateTrackYtId?: (id: string, ytId: string) => void;
  onUpdateTrackTags?: (id: string, tags: string[]) => void;
  onDeleteTrack?: (id: string) => void;
  onShowWiki?: (type: 'anime' | 'artist' | 'part' | 'track', key: string) => void;
  onSaveTrack?: (t: AnimeTrack) => void;
}) {
  const [tab, setTab] = useState<'overview' | 'lyrics' | 'reviews'>('overview');
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [verifyStatus, setVerifyStatus] = useState<'pending' | 'alive' | 'dead'>('pending');
  const [isEditingYt, setIsEditingYt] = useState(false);
  const [ytValue, setYtValue] = useState(track.youtubeId);
  const [lyricsData, setLyricsData] = useState<any>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricLang, setLyricLang] = useState<'japanese' | 'romaji' | 'english'>('romaji');
  const [reviews, setReviews] = useState<TrackReview[]>([]);
  const [reviewRating, setReviewRating] = useState(10);
  const [reviewComment, setReviewComment] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [isReporting, setIsReporting] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const isAdmin = currentUser?.role === 'admin';

  useEffect(() => {
    setTab('overview');
    setIsEditingYt(false);
    setYtValue(track.youtubeId);
    setLyricsData(null);
    setLyricLang('romaji');
    setTagInput('');
  }, [track.id]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setCoverUrl(null);
    fetch(`/api/anime-search?q=${encodeURIComponent(track.animeName)}`)
      .then(res => res.json())
      .then(data => {
        if (!cancelled && data.data?.[0]?.images?.webp?.large_image_url) {
          setCoverUrl(data.data[0].images.webp.large_image_url);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [track.animeName]);

  useEffect(() => {
    const cached = videoStatusCache.get(track.youtubeId);
    if (cached) { setVerifyStatus(cached); return; }
    setVerifyStatus('pending');
    fetch(`/api/verify-video?id=${track.youtubeId}`)
      .then(r => r.json())
      .then(data => {
        const status: 'alive' | 'dead' = data.alive ? 'alive' : 'dead';
        videoStatusCache.set(track.youtubeId, status);
        setVerifyStatus(status);
      })
      .catch(() => setVerifyStatus('alive'));
  }, [track.youtubeId]);

  useEffect(() => {
    const unsubscribe = subscribeTrackReviews(track.id, setReviews);
    return () => unsubscribe();
  }, [track.id]);

  useEffect(() => {
    let cancelled = false;
    setLyricsLoading(true);
    setLyricsData(null);
    fetch('/api/lyrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: track.title, artist: track.artist || 'Unknown', animeName: track.animeName }),
    })
      .then(res => (res.ok ? res.json() : Promise.reject()))
      .then(data => { if (!cancelled) setLyricsData(data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLyricsLoading(false); });
    return () => { cancelled = true; };
  }, [track.id]);

  const eloHistory = useMemo(() => {
    const points = [{ name: 'Seed', elo: 1200, description: 'Starting baseline' }];
    recentHistory
      .filter(h => h.trackA?.id === track.id || h.trackB?.id === track.id)
      .forEach((h, i) => {
        const isA = h.trackA?.id === track.id;
        points.push({
          name: `#${i + 1}`,
          elo: isA ? h.trackA.eloAfter : h.trackB.eloAfter,
          description: `${h.winnerId === 'draw' ? 'Draw' : h.winnerId === (isA ? 'A' : 'B') ? 'Won' : 'Lost'} vs "${isA ? h.trackB.title : h.trackA.title}"`,
        });
      });
    return points;
  }, [track.id, recentHistory]);

  const siblings = useMemo(
    () => tracks.filter(t => t.animeName === track.animeName && t.id !== track.id),
    [track, tracks]
  );

  const handleSaveYt = () => {
    const newId = extractYoutubeId(ytValue);
    if (!newId || newId.length !== 11) { toast.error('That doesn\'t look like a valid YouTube ID.'); return; }
    onUpdateTrackYtId?.(track.id, newId);
    videoStatusCache.delete(track.youtubeId);
    setVerifyStatus('pending');
    setIsEditingYt(false);
    toast.success('YouTube link updated.');
  };

  const handleReport = async () => {
    setIsReporting(true);
    try {
      onSubmitProposal?.({
        type: 'fix_link',
        trackData: {
          title: track.title, artist: track.artist,
          animeName: track.animeName, type: track.type, youtubeId: track.youtubeId,
        },
        oldTrackId: track.id,
        proposedYtId: '',
        notes: `REPORTED: flagged as broken or incorrect. (Auto-verification: ${verifyStatus})`,
      });
      toast.success(`Report submitted for "${track.title}".`);
    } catch {
      toast.error('Failed to submit report.');
    } finally {
      setIsReporting(false);
    }
  };

  const handleSubmitReview = async () => {
    if (!currentUser) { toast.error('Log in to review tracks.'); return; }
    if (!reviewComment.trim()) { toast.error('Write a short comment first.'); return; }
    setSubmittingReview(true);
    try {
      // ⚠️ Adjust args if your firestoreService signature differs
      await addTrackReview(track.id, {
        userId: currentUser.id,
        username: currentUser.username || 'Anonymous',
        rating: reviewRating,
        comment: reviewComment.trim(),
      });
      try { await checkAndAwardCompletistBadge(currentUser.id); } catch { /* non-fatal */ }
      setReviewComment('');
      toast.success('Review posted!');
    } catch {
      toast.error('Failed to post review.');
    } finally {
      setSubmittingReview(false);
    }
  };

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (!tag) return;
    const current = track.tags || [];
    if (current.includes(tag)) { setTagInput(''); return; }
    onUpdateTrackTags?.(track.id, [...current, tag]);
    setTagInput('');
  };

  const statusDot = verifyStatus === 'alive'
    ? <span className="w-2 h-2 rounded-full bg-moss shrink-0" title="Link verified" />
    : verifyStatus === 'dead'
      ? <span className="w-2 h-2 rounded-full bg-vermillion shrink-0" title="Link appears dead" />
      : <span className="w-2 h-2 rounded-full bg-gold animate-pulse shrink-0" title="Verifying…" />;

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.aside
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 320, damping: 34 }}
        className="fixed z-50 inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl md:inset-y-0 md:left-auto md:right-0 md:w-[440px] md:max-h-none md:rounded-none md:border-l flex flex-col bg-[#0b0b0e] border-t md:border border-zinc-800 shadow-2xl"
      >
        <div className="relative shrink-0 border-b border-zinc-900">
          {coverUrl && (
            <div className="absolute inset-0 overflow-hidden opacity-20">
              <img src={coverUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#0b0b0e]" />
            </div>
          )}
          <div className="relative p-4 flex items-start gap-3">
            <LeaderboardTrackArtwork track={track} onPlay={onPlay} />
            <div className="min-w-0 flex-1">
              <h3 className="font-display font-black text-white uppercase leading-tight line-clamp-1">{track.title}</h3>
              <p className="text-xs text-zinc-400 truncate mt-0.5">
                <WikiLink wiki={onShowWiki} type="artist" value={track.artist} />
              </p>
              <p className="text-[11px] text-zinc-600 flex items-center gap-1.5 mt-0.5 min-w-0">
                <Tv className="w-3 h-3 shrink-0" />
                <WikiLink wiki={onShowWiki} type="anime" value={track.animeName} className="truncate" />
                <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 text-[10px] font-black shrink-0">{track.type}</span>
              </p>
            </div>
            <button onClick={onClose} className="p-2 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-900 shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="relative flex border-b border-zinc-900 px-2">
            {(['overview', 'lyrics', 'reviews'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`relative px-4 pb-2.5 pt-1 text-[11px] font-black uppercase tracking-widest transition-colors ${
                  tab === t ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'}`}>
                {t === 'overview' ? 'Overview' : t === 'lyrics' ? 'Lyrics' : (
                  <span className="flex items-center gap-1.5">
                    Reviews {reviews.length > 0 && <span className="text-zinc-600">({reviews.length})</span>}
                  </span>
                )}
                {tab === t && <motion.div layoutId="drawerTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-primary rounded-full" />}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {tab === 'overview' && (
            <>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: 'ELO', value: track.elo },
                  { label: 'Matches', value: track.matchesPlayed },
                  { label: 'Wins', value: track.wins },
                  { label: 'Win %', value: winRate(track) !== null ? `${winRate(track)}%` : '—' },
                ].map(s => (
                  <div key={s.label} className="bg-zinc-950 border border-zinc-900 rounded-xl p-3 text-center">
                    <div className="font-mono font-black text-white text-lg tabular-nums leading-none">{s.value}</div>
                    <div className="text-[9px] uppercase tracking-widest text-zinc-600 mt-1.5">{s.label}</div>
                  </div>
                ))}
              </div>

              <div className="bg-zinc-950 border border-zinc-900 rounded-xl p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-3">ELO Progression</p>
                {eloHistory.length > 2 ? (
                  <ResponsiveContainer width="100%" height={150}>
                    <AreaChart data={eloHistory}>
                      <defs>
                        <linearGradient id="eloGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#FF3D2E" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#FF3D2E" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <ChartXAxis dataKey="name" tick={{ fill: '#52525b', fontSize: 10 }} axisLine={false} tickLine={false} />
                      <ChartYAxis domain={['dataMin - 50', 'dataMax + 50']} tick={{ fill: '#52525b', fontSize: 10 }} axisLine={false} tickLine={false} width={42} />
                      <ChartTooltip
                        contentStyle={{ background: '#0e0e11', border: '1px solid #221B13', borderRadius: 12, fontSize: 12 }}
                        labelStyle={{ color: '#a1a1aa' }}
                        formatter={(v: any) => [`${v} ELO`, 'Rating']}
                      />
                      <Area type="monotone" dataKey="elo" stroke="#FF3D2E" strokeWidth={2} fill="url(#eloGrad)" />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-xs text-zinc-600 py-6 text-center">
                    Needs more recorded matches to chart ({track.matchesPlayed} played).
                  </p>
                )}
              </div>

              <div className="bg-zinc-950 border border-zinc-900 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-2">
                    {statusDot} YouTube Link
                  </p>
                  <a href={`https://youtube.com/watch?v=${track.youtubeId}`} target="_blank" rel="noreferrer"
                    className="text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-brand-primary flex items-center gap-1">
                    Open <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                {isEditingYt ? (
                  <div className="flex gap-2">
                    <input value={ytValue} onChange={e => setYtValue(e.target.value)}
                      placeholder="Paste new YouTube URL or ID"
                      className="flex-1 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white focus:outline-none focus:border-brand-primary/50" />
                    <button onClick={handleSaveYt} className="px-3 rounded-lg bg-brand-primary text-black" title="Save">
                      <Check className="w-4 h-4" />
                    </button>
                    <button onClick={() => { setIsEditingYt(false); setYtValue(track.youtubeId); }}
                      className="px-3 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400" title="Cancel">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <p className="text-[11px] font-mono text-zinc-600 truncate">youtube.com/watch?v={track.youtubeId}</p>
                )}
              </div>

              {siblings.length > 0 && (
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">
                    More from{' '}
                    <WikiLink wiki={onShowWiki} type="anime" value={track.animeName} className="text-zinc-400" />
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {siblings.map(s => (
                      <button key={s.id} onClick={() => onPlay(s)}
                        className="px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-[11px] text-zinc-400 hover:text-white hover:border-zinc-600 transition-colors flex items-center gap-1.5">
                        <Play className="w-3 h-3" /> {s.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {onUpdateTrackTags && (
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">Tags</p>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {(track.tags || []).map(tag => (
                      <span key={tag} className="flex items-center gap-1 px-2 py-1 rounded-md bg-zinc-950 border border-zinc-800 text-[11px] text-zinc-400">
                        {tag}
                        <button onClick={() => onUpdateTrackTags(track.id, (track.tags || []).filter(t => t !== tag))}
                          className="text-zinc-600 hover:text-vermillion"><X className="w-3 h-3" /></button>
                      </span>
                    ))}
                    {(track.tags || []).length === 0 && <span className="text-[11px] text-zinc-600">No tags yet.</span>}
                  </div>
                  <input value={tagInput} onChange={e => setTagInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                    placeholder="Add a tag and press Enter…"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-brand-primary/50" />
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                {onSaveTrack && (
                  <button onClick={() => onSaveTrack(track)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-white text-[11px] font-black uppercase tracking-widest">
                    <Bookmark className="w-3.5 h-3.5" /> Save
                  </button>
                )}
                {!isEditingYt && (
                  <button onClick={() => setIsEditingYt(true)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-white text-[11px] font-black uppercase tracking-widest">
                    <Youtube className="w-3.5 h-3.5" /> Fix Link
                  </button>
                )}
                <button onClick={handleReport} disabled={isReporting}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-gold-bright text-[11px] font-black uppercase tracking-widest disabled:opacity-50">
                  {isReporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <AlertCircle className="w-3.5 h-3.5" />} Report
                </button>
                {isAdmin && onDeleteTrack && (
                  <button onClick={() => { if (confirm(`Delete "${track.title}" permanently?`)) { onDeleteTrack(track.id); onClose(); } }}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-vermillion/10 border border-vermillion/30 text-vermillion hover:bg-vermillion/20 text-[11px] font-black uppercase tracking-widest">
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                  </button>
                )}
              </div>
            </>
          )}

          {tab === 'lyrics' && (
            <div>
              {lyricsLoading ? (
                <div className="py-16 flex flex-col items-center gap-3 text-zinc-600">
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <p className="text-xs uppercase tracking-widest">Fetching lyrics…</p>
                </div>
              ) : !lyricsData ? (
                <div className="py-16 text-center">
                  <Music className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
                  <p className="text-xs text-zinc-500 uppercase tracking-widest font-black">Lyrics unavailable</p>
                  <p className="text-[11px] text-zinc-600 mt-1">We couldn't find lyrics for this track.</p>
                </div>
              ) : (
                <>
                  <div className="flex gap-1 mb-4">
                    {(['japanese', 'romaji', 'english'] as const).map(lang => (
                      <button key={lang} onClick={() => setLyricLang(lang)}
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-colors ${
                          lyricLang === lang
                            ? 'bg-brand-primary/15 border-brand-primary/40 text-white'
                            : 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:text-zinc-300'}`}>
                        {lang === 'japanese' ? '日本語' : lang === 'romaji' ? 'Romaji' : 'English'}
                      </button>
                    ))}
                  </div>
                  <div className="space-y-2.5">
                    {(lyricsData[lyricLang] || []).map((line: string, i: number) => (
                      <p key={i} className={`text-sm leading-relaxed ${lyricLang === 'japanese' ? 'text-zinc-300' : 'text-zinc-400'}`}>{line}</p>
                    ))}
                  </div>
                  {lyricsData.meaning && (
                    <div className="mt-5 p-3 rounded-xl bg-zinc-950 border border-zinc-900">
                      <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600 mb-1.5">Meaning</p>
                      <p className="text-xs text-zinc-400 leading-relaxed">{lyricsData.meaning}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {tab === 'reviews' && (
            <div className="space-y-4">
              {currentUser ? (
                <div className="bg-zinc-950 border border-zinc-900 rounded-xl p-3.5 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Your Rating</p>
                    <div className="flex gap-1">
                      {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
                        <button key={n} onClick={() => setReviewRating(n)}
                          className={`w-5 h-5 rounded text-[10px] font-black transition-colors ${
                            n <= reviewRating ? 'bg-brand-primary text-black' : 'bg-zinc-900 text-zinc-600 hover:text-zinc-400'}`}>
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                  <textarea value={reviewComment} onChange={e => setReviewComment(e.target.value)} rows={2}
                    placeholder={`What do you think of "${track.title}"?`}
                    className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-brand-primary/50 resize-none" />
                  <button onClick={handleSubmitReview} disabled={submittingReview}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-brand-primary text-black text-[11px] font-black uppercase tracking-widest hover:brightness-110 disabled:opacity-50">
                    {submittingReview ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Post Review
                  </button>
                </div>
              ) : (
                <p className="text-xs text-zinc-600 text-center py-2">Log in to leave a review.</p>
              )}

              {reviews.length === 0 ? (
                <div className="py-10 text-center">
                  <MessageSquare className="w-7 h-7 text-zinc-700 mx-auto mb-2" />
                  <p className="text-xs text-zinc-500 uppercase tracking-widest font-black">No reviews yet</p>
                </div>
              ) : (
                reviews.map((r: any) => (
                  <div key={r.id} className="bg-zinc-950 border border-zinc-900 rounded-xl p-3.5">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-black text-zinc-300">{r.username || 'Anonymous'}</span>
                      <span className="flex items-center gap-1 text-[11px] font-mono text-gold-bright">
                        <Star className="w-3 h-3 fill-gold-bright" /> {r.rating}/10
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 leading-relaxed">{r.comment}</p>
                    {r.createdAt && (
                      <p className="text-[10px] text-zinc-600 mt-2">
                        {r.createdAt?.toDate ? r.createdAt.toDate().toLocaleDateString() : String(r.createdAt).slice(0, 10)}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </motion.aside>
    </>
  );
}

function SuggestTrackModal({ onClose, typeFilter, onSubmitProposal }: {
  onClose: () => void;
  typeFilter: 'ALL' | TrackType;
  onSubmitProposal?: (p: any) => void;
}) {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [anime, setAnime] = useState('');
  const [type, setType] = useState<TrackType>(typeFilter === 'ALL' ? 'OP' : typeFilter);
  const [yt, setYt] = useState('');

  const handleSubmit = () => {
    if (!title.trim() || !anime.trim()) { toast.error('Title and anime name are required.'); return; }
    if (!onSubmitProposal) { toast.error('Suggestions are unavailable right now.'); return; }
    onSubmitProposal({
      type: 'add_track',
      trackData: {
        title: title.trim(), artist: artist.trim(),
        animeName: anime.trim(), type,
        youtubeId: extractYoutubeId(yt),
      },
      notes: 'Suggested via the leaderboard form.',
    });
    toast.success(`Suggestion for "${title.trim()}" sent to the mods for review.`);
    onClose();
  };

  const inputCls = 'w-full px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-brand-primary/50';

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md bg-[#0e0e11] border border-zinc-800 rounded-2xl shadow-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-zinc-900">
          <h3 className="font-display font-black text-white uppercase tracking-tight">Suggest a Track</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-900">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-3 overflow-y-auto">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Track title *" className={inputCls} />
          <input value={artist} onChange={e => setArtist(e.target.value)} placeholder="Artist" className={inputCls} />
          <input value={anime} onChange={e => setAnime(e.target.value)} placeholder="Anime name *" className={inputCls} />
          <div className="flex gap-2">
            {(['OP', 'ED', 'OST'] as const).map(t => (
              <button key={t} onClick={() => setType(t)}
                className={`flex-1 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest border transition-colors ${
                  type === t ? 'bg-brand-primary/15 border-brand-primary/40 text-white' : 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:text-zinc-300'}`}>
                {t}
              </button>
            ))}
          </div>
          <input value={yt} onChange={e => setYt(e.target.value)} placeholder="YouTube URL or video ID" className={inputCls} />
          <p className="text-[11px] text-zinc-600 leading-relaxed">
            Suggestions are reviewed by the mods before being added to the registry.
          </p>
          <button onClick={handleSubmit}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-brand-primary text-black text-[11px] font-black uppercase tracking-widest hover:brightness-110 transition-all">
            <Send className="w-3.5 h-3.5" /> Submit to Mods
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

interface TrackLeaderboardProps {
  tracks: AnimeTrack[];
  onDeleteTrack: (id: string) => void;
  onUpdateTrackYtId?: (id: string, newYtId: string) => void;
  currentUser: any;
  onSubmitProposal?: (p: any) => void;
  onShowWiki?: (type: 'anime' | 'artist' | 'part' | 'track', key: string) => void;
  favorites?: string[];
  onToggleFavorite?: (id: string) => void;
  onUpdateTrackTags?: (id: string, tags: string[]) => void;
  onPlay: (track: AnimeTrack) => void;
  recentHistory?: any[];
  onSaveProfile?: (fields: any) => Promise<void> | void; // NEW — powers the save-to-playlist picker
  // REMOVED: saved / onToggleSaved (superseded by the playlist picker)
}

export default function TrackLeaderboard({
  tracks, onDeleteTrack, onUpdateTrackYtId,
  currentUser, onSubmitProposal, onShowWiki,
  favorites = [], onToggleFavorite, onUpdateTrackTags,
  onPlay, recentHistory = [], onSaveProfile,
}: TrackLeaderboardProps) {
  const [typeFilter, setTypeFilter] = useState<'ALL' | TrackType>('ALL');
  const [eraFilter, setEraFilter] = useState<'ALL' | 'retro' | 'classic' | 'modern' | 'reiwa'>('ALL');
  const [userListFilter, setUserListFilter] = useState<'ALL' | 'favorites' | 'playlists'>('ALL');
  const [selectedTagFilter, setSelectedTagFilter] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<'elo' | 'title' | 'matches' | 'winrate'>('elo');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [displayLimit, setDisplayLimit] = useState(20);

  const [rankFrom, setRankFrom] = useState('1');
  const [rankTo, setRankTo] = useState('');

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [isSuggestOpen, setIsSuggestOpen] = useState(false);
  const [previewTrack, setPreviewTrack] = useState<AnimeTrack | null>(null);
  const [saveTrack, setSaveTrack] = useState<AnimeTrack | null>(null);

  const isAdmin = currentUser?.role === 'admin';

  // Track IDs that live in ANY of my playlists (for the filled bookmark state)
  const myPlaylistTrackIds = useMemo(() => {
    const s = new Set<string>();
    (currentUser?.customLists || []).forEach((l: any) => (l.trackIds || []).forEach((id: string) => s.add(id)));
    return s;
  }, [currentUser?.customLists]);

  useEffect(() => { setDisplayLimit(20); }, [typeFilter, eraFilter, userListFilter, selectedTagFilter, sortBy, sortOrder, rankFrom, rankTo]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    tracks.forEach(t => stripTypeTags(t.tags).forEach(tag => set.add(tag)));
    return Array.from(set).slice(0, 12);
  }, [tracks]);

  const activeFilterCount = useMemo(() =>
    (typeFilter !== 'ALL' ? 1 : 0) +
    (eraFilter !== 'ALL' ? 1 : 0) +
    (userListFilter !== 'ALL' ? 1 : 0) +
    (selectedTagFilter !== 'ALL' ? 1 : 0),
  [typeFilter, eraFilter, userListFilter, selectedTagFilter]);

  const champion = useMemo(
    () => (tracks.length ? [...tracks].sort((a, b) => b.elo - a.elo)[0] : null),
    [tracks]
  );

  const processedTracks = useMemo(() => {
    let result = typeFilter === 'ALL' ? [...tracks] : tracks.filter(t => t.type === typeFilter);
    if (eraFilter !== 'ALL') {
      result = result.filter(t => getAnimeEraAndYear(t.animeName).eraId === eraFilter);
    }
    if (userListFilter === 'favorites') result = result.filter(t => favorites.includes(t.id));
    else if (userListFilter === 'playlists') result = result.filter(t => myPlaylistTrackIds.has(t.id));
    if (selectedTagFilter !== 'ALL') result = result.filter(t => t.tags?.includes(selectedTagFilter));

    result.sort((a, b) => {
      let valA: any, valB: any;
      if (sortBy === 'elo') { valA = a.elo; valB = b.elo; }
      else if (sortBy === 'title') { valA = a.title.toLowerCase(); valB = b.title.toLowerCase(); }
      else if (sortBy === 'matches') { valA = a.matchesPlayed; valB = b.matchesPlayed; }
      else {
        valA = a.matchesPlayed > 0 ? a.wins / a.matchesPlayed : 0;
        valB = b.matchesPlayed > 0 ? b.wins / b.matchesPlayed : 0;
      }
      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
    return result;
  }, [tracks, typeFilter, eraFilter, userListFilter, selectedTagFilter, sortBy, sortOrder, favorites, myPlaylistTrackIds]);

  const parsedFrom = useMemo(() => Math.max(1, parseInt(rankFrom, 10) || 1), [rankFrom]);
  const parsedTo = useMemo(() => {
    if (rankTo === '') return null;
    return Math.max(parseInt(rankTo, 10) || parsedFrom, parsedFrom);
  }, [rankTo, parsedFrom]);

  const rangeStart = parsedFrom - 1;
  const rangeEnd = parsedTo ?? processedTracks.length;
  const windowedCount = Math.max(0, Math.min(rangeEnd, processedTracks.length) - rangeStart);
  const rangeActive = parsedFrom !== 1 || parsedTo !== null;

  const visible = processedTracks.slice(rangeStart, rangeEnd).slice(0, displayLimit);

  const exportTracks = useMemo(
    () => processedTracks.slice(rangeStart, rangeEnd),
    [processedTracks, rangeStart, rangeEnd]
  );

  const toggleSort = (field: 'elo' | 'title' | 'matches' | 'winrate') => {
    if (sortBy === field) setSortOrder(p => (p === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(field); setSortOrder('desc'); }
  };

  const resetRange = () => { setRankFrom('1'); setRankTo(''); };

  const clearFilters = () => {
    setTypeFilter('ALL');
    setEraFilter('ALL');
    setUserListFilter('ALL');
    setSelectedTagFilter('ALL');
    resetRange();
  };

  const getRankStyle = (index: number) => {
    if (index === 0) return 'text-gold-bright bg-gold/10 border-gold/30';
    if (index === 1) return 'text-zinc-300 bg-zinc-400/10 border-zinc-400/30';
    if (index === 2) return 'text-burnt bg-burnt/10 border-burnt/30';
    return 'text-zinc-500 bg-zinc-900 border-zinc-800';
  };

  const SortHeader = ({ label, field, className = '' }: { label: string; field: 'elo' | 'title' | 'matches' | 'winrate'; className?: string }) => (
    <button onClick={() => toggleSort(field)}
      className={`flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-zinc-300 transition-colors ${className}`}>
      {label}
      {sortBy === field && (
        sortOrder === 'desc' ? <ArrowDown className="w-3 h-3 text-brand-primary" /> : <ArrowUp className="w-3 h-3 text-brand-primary" />
      )}
    </button>
  );

  const toolBtn =
    'h-11 rounded-xl bg-[#0A0805] border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700 hover:bg-zinc-900 transition-all flex items-center justify-center gap-2 px-4 text-[11px] font-black uppercase tracking-widest cursor-pointer';

  const numInputCls =
    'w-11 h-7 bg-zinc-950 border border-zinc-800 rounded-md text-center font-mono text-xs text-white tabular-nums placeholder:text-[9px] placeholder:text-zinc-600 focus:outline-none focus:border-brand-primary/50 focus:bg-zinc-900 transition-colors [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

  return (
    <div id="leaderboard" className="space-y-5 p-1">

      {champion && (
        <button onClick={() => onPlay(champion)}
          className="w-full flex items-center gap-4 bg-[#0e0e11] border border-gold/25 hover:border-gold/50 rounded-2xl p-3 pr-4 text-left group transition-colors">
          <img src={champion.customImageUrl || `https://img.youtube.com/vi/${champion.youtubeId}/mqdefault.jpg`}
            alt="" className="w-14 h-14 rounded-lg object-cover shrink-0" loading="lazy" referrerPolicy="no-referrer" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-gold-bright">
              <Award className="w-3 h-3" /> Current Champion
            </div>
            <p className="font-display font-black text-white uppercase truncate">{champion.title}</p>
            <p className="text-[11px] text-zinc-500 truncate">
              <WikiLink wiki={onShowWiki} type="artist" value={champion.artist} />
              {champion.artist && <span className="text-zinc-700"> · </span>}
              <WikiLink wiki={onShowWiki} type="anime" value={champion.animeName} />
            </p>
          </div>
          <div className="text-right shrink-0">
            <div className="font-mono font-black text-gold-bright text-lg leading-none tabular-nums">
              <AnimatedCounter value={champion.elo} direction="up" />
            </div>
            <div className="text-[9px] uppercase tracking-widest text-zinc-600 mt-1">ELO</div>
          </div>
          <Play className="w-5 h-5 text-zinc-600 group-hover:text-brand-primary shrink-0 transition-colors" />
        </button>
      )}

      {/* ─── Sticky Toolbar ─── */}
      <div className="relative sticky top-2 z-30">
        <div className="bg-[#0A0805]/95 backdrop-blur border border-zinc-900 rounded-2xl shadow-2xl shadow-zinc-900/40 p-2 flex flex-wrap items-center gap-2">

          <div className="flex items-center gap-2 h-11 rounded-xl bg-[#0A0805] border border-zinc-800 px-3 shrink-0">
            <span className={`hidden sm:block text-[10px] font-black uppercase tracking-widest transition-colors ${
              rangeActive ? 'text-brand-primary' : 'text-zinc-500'}`}>
              Rank
            </span>
            <div className="flex items-center gap-1">
              <input type="number" min={1} value={rankFrom}
                onChange={e => setRankFrom(e.target.value.replace(/[^0-9]/g, ''))}
                onBlur={() => setRankFrom(String(parsedFrom))}
                className={numInputCls} title="From rank" aria-label="From rank" />
              <span className="text-zinc-700 font-mono text-[10px] leading-none select-none">–</span>
              <input type="number" min={1} value={rankTo} placeholder="All"
                onChange={e => setRankTo(e.target.value.replace(/[^0-9]/g, ''))}
                onBlur={() => setRankTo(parsedTo === null ? '' : String(parsedTo))}
                className={numInputCls} title="To rank (empty = all)" aria-label="To rank" />
            </div>
            <span className="hidden md:block text-[10px] font-mono text-zinc-600 leading-none whitespace-nowrap">
              / {processedTracks.length}
            </span>
            {rangeActive && (
              <button onClick={resetRange} title="Reset rank range"
                className="flex items-center justify-center w-5 h-5 rounded-md text-zinc-600 hover:text-white hover:bg-zinc-800 transition-colors">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <div className="flex-1" />

          <div className="relative">
            <button onClick={() => setFiltersOpen(p => !p)}
              className={`${toolBtn} ${filtersOpen || activeFilterCount > 0 ? '!bg-brand-primary/15 !border-brand-primary/40 !text-brand-primary' : ''}`}>
              <ListFilter className="w-4 h-4" />
              <span className="hidden sm:inline">Filters</span>
              {activeFilterCount > 0 && (
                <span className="min-w-5 h-5 px-1 rounded-full bg-brand-primary text-black text-[10px] font-black flex items-center justify-center">
                  {activeFilterCount}
                </span>
              )}
            </button>

            {filtersOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setFiltersOpen(false)} />
                <div className="absolute right-0 top-full mt-2 z-40 w-72 bg-[#0e0e11] border border-zinc-800 rounded-xl shadow-2xl p-4 space-y-4">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">Type</p>
                    <div className="flex flex-wrap gap-1.5">
                      {(['ALL', 'OP', 'ED', 'OST'] as const).map(t => (
                        <button key={t} onClick={() => setTypeFilter(t)}
                          className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-colors ${
                            typeFilter === t ? 'bg-brand-primary/15 text-white border-brand-primary/40'
                              : 'bg-zinc-950 text-zinc-500 border-zinc-800 hover:text-zinc-300'}`}>
                          {t === 'ALL' ? 'All' : t}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">Era</p>
                    <div className="flex flex-wrap gap-1.5">
                      {(['ALL', 'retro', 'classic', 'modern', 'reiwa'] as const).map(era => (
                        <button key={era} onClick={() => setEraFilter(era)}
                          className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-colors ${
                            eraFilter === era ? 'bg-brand-secondary/20 text-brand-secondary border-brand-secondary/40'
                              : 'bg-zinc-950 text-zinc-500 border-zinc-800 hover:text-zinc-300'}`}>
                          {era === 'ALL' ? 'All' : ERA_SHORT[era]}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">My Lists</p>
                    <div className="flex gap-1.5">
                      {(['ALL', 'favorites', 'playlists'] as const).map(f => (
                        <button key={f} onClick={() => setUserListFilter(f)}
                          className={`flex-1 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-colors flex items-center justify-center gap-1 ${
                            userListFilter === f
                              ? f === 'favorites' ? 'bg-vermillion/10 text-vermillion border-vermillion/30'
                                : f === 'playlists' ? 'bg-brand-primary/15 text-brand-primary border-brand-primary/40'
                                  : 'bg-zinc-800 text-white border-zinc-700'
                              : 'bg-zinc-950 text-zinc-500 border-zinc-800 hover:text-zinc-300'}`}>
                          {f === 'favorites' && <Heart className="w-3 h-3" />}
                          {f === 'playlists' && <ListMusic className="w-3 h-3" />}
                          {f === 'ALL' ? 'All' : f === 'playlists' ? 'Playlists' : 'Favs'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {allTags.length > 0 && (
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">Tags</p>
                      <div className="flex flex-wrap gap-1.5">
                        {['ALL', ...allTags].map(tag => (
                          <button key={tag} onClick={() => setSelectedTagFilter(tag)}
                            className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-colors ${
                              selectedTagFilter === tag ? 'bg-brand-primary/15 text-white border-brand-primary/40'
                                : 'bg-zinc-950 text-zinc-500 border-zinc-800 hover:text-zinc-300'}`}>
                            {tag === 'ALL' ? 'All' : tag}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {(activeFilterCount > 0 || rangeActive) && (
                    <button onClick={clearFilters}
                      className="w-full py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-white text-[10px] font-black uppercase tracking-widest">
                      Reset All
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          <ExportPlaylistMenu tracks={exportTracks} variant="button" className={`${toolBtn} !px-4`} />

          <button onClick={() => setIsSuggestOpen(true)}
            className="h-11 flex-1 sm:flex-none px-4 rounded-xl bg-brand-primary text-black font-black text-[11px] uppercase tracking-widest hover:brightness-110 transition-all flex items-center justify-center gap-2 cursor-pointer">
            <Plus className="w-4 h-4" /> <span className="hidden sm:inline">Suggest</span>
          </button>
        </div>
      </div>

      {/* ─── Track List ─── */}
      <div className="bg-[#0A0805] border border-zinc-900 rounded-2xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-zinc-900">
          <p className="text-[10px] font-mono uppercase tracking-widest text-zinc-600">
            {rangeActive
              ? `Ranks ${parsedFrom}–${parsedTo ?? processedTracks.length} of ${processedTracks.length}`
              : `${processedTracks.length} ${typeFilter === 'ALL' ? 'tracks' : `${typeFilter}s`}`}
            {' '}· sorted by {sortBy}
          </p>
        </div>

        <div className="hidden md:grid md:grid-cols-[2.5rem_3.5rem_minmax(0,1.5fr)_5.5rem_4.5rem_4rem_4.5rem_5rem] xl:grid-cols-[2.5rem_3.5rem_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_5.5rem_4.5rem_4rem_4.5rem_5rem] items-center gap-3 px-4 py-2 border-b border-zinc-900 bg-zinc-950/50">
          <span className="text-[10px] font-black uppercase tracking-widest text-zinc-600">#</span>
          <span />
          <SortHeader label="Title" field="title" />
          <span className="hidden xl:block text-[10px] font-black uppercase tracking-widest text-zinc-500">Artist</span>
          <span className="hidden xl:block text-[10px] font-black uppercase tracking-widest text-zinc-500">Anime</span>
          <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500 text-center">W–L</span>
          <SortHeader label="Games" field="matches" className="justify-center" />
          <SortHeader label="Win%" field="winrate" className="justify-center" />
          <SortHeader label="ELO" field="elo" className="justify-end" />
          <span />
        </div>

        {visible.map((t, i) => {
          const rank = rangeStart + i + 1;
          const wr = winRate(t);
          const isFav = favorites.includes(t.id);
          const inPlaylist = myPlaylistTrackIds.has(t.id);
          return (
            <div key={t.id} onClick={() => setPreviewTrack(t)}
              className="group grid grid-cols-[1.75rem_3rem_minmax(0,1fr)_3.5rem] md:grid-cols-[2.5rem_3.5rem_minmax(0,1.5fr)_5.5rem_4.5rem_4rem_4.5rem_5rem] xl:grid-cols-[2.5rem_3.5rem_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_5.5rem_4.5rem_4rem_4.5rem_5rem] items-center gap-2 md:gap-3 px-4 py-2.5 border-b border-zinc-900/60 last:border-b-0 cursor-pointer hover:bg-zinc-900/40 transition-colors">
              <span className={`w-7 h-7 md:w-8 md:h-8 rounded-lg border flex items-center justify-center font-mono font-black text-xs tabular-nums ${getRankStyle(rank === 1 ? 0 : rank === 2 ? 1 : rank === 3 ? 2 : 3)}`}>
                {rank}
              </span>
              <LeaderboardTrackArtwork track={t} onPlay={onPlay} />
              <div className="min-w-0">
                <p className="text-sm font-bold text-white truncate group-hover:text-brand-primary transition-colors">{t.title}</p>
                <p className="text-[11px] text-zinc-500 truncate xl:hidden">
                  {t.artist && (
                    <>
                      <WikiLink wiki={onShowWiki} type="artist" value={t.artist} />
                      <span className="text-zinc-700"> · </span>
                    </>
                  )}
                  <WikiLink wiki={onShowWiki} type="anime" value={t.animeName} />
                  {typeFilter === 'ALL' && <span className="text-zinc-700"> · {t.type}</span>}
                </p>
              </div>
              <span className="hidden xl:block text-xs truncate">
                <WikiLink wiki={onShowWiki} type="artist" value={t.artist} className="text-zinc-500" />
              </span>
              <span className="hidden xl:block text-xs truncate text-zinc-500">
                <WikiLink wiki={onShowWiki} type="anime" value={t.animeName} />
                {typeFilter === 'ALL' && <span className="text-zinc-700"> · {t.type}</span>}
              </span>
              <span className="hidden md:block text-center font-mono text-xs text-zinc-400 tabular-nums">{t.wins}–{t.losses}</span>
              <span className="hidden md:block text-center font-mono text-xs text-zinc-500 tabular-nums">{t.matchesPlayed}</span>
              <span className="hidden md:block text-center font-mono text-xs text-zinc-500 tabular-nums">{wr !== null ? `${wr}%` : '—'}</span>
              <span className={`text-right font-mono font-black text-sm tabular-nums ${rank <= 3 ? 'text-gold-bright' : 'text-zinc-300'}`}>{t.elo}</span>
              <div className="hidden md:flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                {onToggleFavorite && (
                  <button onClick={e => { e.stopPropagation(); onToggleFavorite(t.id); }}
                    className={`p-1.5 rounded-md transition-colors ${isFav ? 'text-vermillion' : 'text-zinc-600 hover:text-vermillion'}`} title="Favorite">
                    <Heart className={`w-4 h-4 ${isFav ? 'fill-vermillion' : ''}`} />
                  </button>
                )}
                {onSaveProfile && (
                  <button onClick={e => { e.stopPropagation(); setSaveTrack(t); }}
                    className={`p-1.5 rounded-md transition-colors ${inPlaylist ? 'text-gold-bright' : 'text-zinc-600 hover:text-gold-bright'}`}
                    title={inPlaylist ? 'Saved to a playlist — manage' : 'Save to playlist'}>
                    <Bookmark className={`w-4 h-4 ${inPlaylist ? 'fill-gold-bright' : ''}`} />
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {processedTracks.length === 0 && (
          <div className="py-16 text-center">
            <Music className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
            <p className="font-display font-black text-white text-sm uppercase">No tracks match your filters</p>
            {activeFilterCount > 0 && (
              <button onClick={clearFilters} className="mt-3 px-4 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white text-[11px] font-black uppercase tracking-widest">
                Clear Filters
              </button>
            )}
          </div>
        )}

        {processedTracks.length > 0 && visible.length === 0 && rangeStart >= processedTracks.length && (
          <div className="py-16 text-center">
            <p className="font-display font-black text-white text-sm uppercase">Rank range is out of bounds</p>
            <p className="text-[11px] text-zinc-600 mt-1">
              This list only has {processedTracks.length} {processedTracks.length === 1 ? 'track' : 'tracks'} — ranks start at 1.
            </p>
            <button onClick={() => { resetRange(); setDisplayLimit(20); }}
              className="mt-3 px-4 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white text-[11px] font-black uppercase tracking-widest">
              Reset Range
            </button>
          </div>
        )}

        {visible.length < windowedCount && (
          <button onClick={() => setDisplayLimit(p => p + 20)}
            className="w-full py-3.5 text-[11px] font-black uppercase tracking-widest text-zinc-500 hover:text-white hover:bg-zinc-900/50 transition-colors">
            Load More ({visible.length} of {windowedCount})
          </button>
        )}
      </div>

      <AnimatePresence>
        {previewTrack && (
          <TrackPreviewDrawer
            key={previewTrack.id}
            track={previewTrack}
            tracks={tracks}
            recentHistory={recentHistory}
            currentUser={currentUser}
            onClose={() => setPreviewTrack(null)}
            onPlay={onPlay}
            onSubmitProposal={onSubmitProposal}
            onUpdateTrackYtId={onUpdateTrackYtId}
            onUpdateTrackTags={onUpdateTrackTags}
            onDeleteTrack={isAdmin ? onDeleteTrack : undefined}
            onShowWiki={onShowWiki}
            onSaveTrack={onSaveProfile ? (t) => setSaveTrack(t) : undefined}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isSuggestOpen && (
          <SuggestTrackModal onClose={() => setIsSuggestOpen(false)} typeFilter={typeFilter} onSubmitProposal={onSubmitProposal} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {saveTrack && (
          <SaveToPlaylistModal
            track={saveTrack}
            currentUser={currentUser}
            onSaveProfile={onSaveProfile}
            onClose={() => setSaveTrack(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}