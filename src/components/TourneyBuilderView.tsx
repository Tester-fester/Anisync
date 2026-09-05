import React, { useState, useMemo } from 'react';
import { AnimatePresence, Reorder, motion } from 'motion/react';
import {
  Search, Save, X, Trophy, Plus, ArrowLeft, GripVertical, Check,
  Music4, Sparkles, Play, Pencil, Trash2, Globe, Lock, Heart,
  BookmarkPlus, Users, Shuffle, Eraser,
} from '@/utils/icons';
import { AnimeTrack, UserAccount } from '../types';
import { toast } from 'sonner';
import { playTactileSound } from '../utils/tactileAudio';
import { generateId } from '../utils/autoId';
import {
  TournamentTemplate, CommunityTournamentTemplate,
  isTournamentPublic, tournamentRef, toggleTournamentRefs,
  getCommunityTournaments, getTournamentLikeCountsForOwner,
  pickRandomTrackIds,
} from '../utils/tournamentTemplates';

// ─────────────────────────────────────────────────────────────────────────────
// TourneyBuilderView — Tournament Maker with the playlist-style system:
//   • BUILD: slot-based bracket builder with public/private visibility,
//     drag-to-reorder seeds, auto-advancing slot focus, random fill, clear.
//   • MY TEMPLATES: your saved brackets — edit, run, toggle visibility,
//     delete, like counts.
//   • COMMUNITY: everyone's public templates — like ♥, save a private copy,
//     run instantly.
//
// Fixes vs. the old version:
//   • Slot updates no longer mutate state objects directly (old code did
//     `newArr[index].trackId = ...` on shared references).
//   • Invalid `w-5.5 h-5.5` classes removed (not in the Tailwind scale).
//   • Purple accent tabs → brand palette.
//   • Duplicate-track toast removed (the ✓ badge in results already says it).
// ─────────────────────────────────────────────────────────────────────────────

interface Slot {
  uid: string;
  trackId: string | null;
}

interface TourneyBuilderViewProps {
  tracks: AnimeTrack[];
  currentUser: UserAccount | null;
  userProfiles?: UserAccount[];
  /** Primary save path — persists customTournaments / likedTournamentRefs. */
  onSaveProfile?: (fields: any) => Promise<void> | void;
  /** Legacy fallback — only used when onSaveProfile isn't provided. */
  onSaveTournament?: (data: {
    name: string;
    size: 4 | 8 | 16 | 32;
    tracks: (string | null)[];
    visibility?: 'public' | 'private';
  }) => void;
  onCancel: () => void;
  /** Run a bracket immediately — map to your existing onStartCustomTournament. */
  onStartNow?: (trackIds: string[], title: string, templateId?: string) => void;
  onViewUserProfile?: (userId: string) => void;
}

const makeSlots = (n: number): Slot[] =>
  Array(n).fill(null).map(() => ({ uid: Math.random().toString(), trackId: null }));

export default function TourneyBuilderView({
  tracks,
  currentUser,
  userProfiles = [],
  onSaveProfile,
  onSaveTournament,
  onCancel,
  onStartNow,
  onViewUserProfile,
}: TourneyBuilderViewProps) {
  const [view, setView] = useState<'build' | 'mine' | 'community'>('build');

  // ── Builder state ──
  const [name, setName] = useState('My Custom Grand Prix');
  const [size, setSize] = useState<4 | 8 | 16 | 32>(8);
  const [slots, setSlots] = useState<Slot[]>(makeSlots(8));
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [focusedSlotIndex, setFocusedSlotIndex] = useState<number | null>(0);
  const [builderFilterType, setBuilderFilterType] = useState<'ALL' | 'OP' | 'ED' | 'OST'>('ALL');

  // ── Community state ──
  const [communitySearch, setCommunitySearch] = useState('');

  // Tactile delay helper (preserved)
  const withDelay = (action: () => void, soundType: 'success' | 'primary' | 'rose' | 'zinc' | 'generic' = 'zinc', delayMs = 150) => {
    return (e?: React.MouseEvent) => {
      if (e) e.stopPropagation();
      playTactileSound(soundType);
      setTimeout(() => action(), delayMs);
    };
  };

  // ── Derived data ──
  const trackMap = useMemo(() => new Map(tracks.map(t => [t.id, t])), [tracks]);

  const myTemplates: TournamentTemplate[] = useMemo(
    () => (currentUser as any)?.customTournaments || [],
    [currentUser]
  );

  const myLikeCounts = useMemo(
    () => getTournamentLikeCountsForOwner(userProfiles, (currentUser as any)?.id),
    [userProfiles, currentUser]
  );

  const communityTournaments = useMemo(
    () => getCommunityTournaments(userProfiles, (currentUser as any)?.id),
    [userProfiles, currentUser]
  );

  const communityFiltered = useMemo(() => {
    const q = communitySearch.toLowerCase().trim();
    if (!q) return communityTournaments;
    return communityTournaments.filter(t =>
      t.name?.toLowerCase().includes(q) || t.ownerName?.toLowerCase().includes(q)
    );
  }, [communityTournaments, communitySearch]);

  const filledCount = slots.filter(s => s.trackId).length;

  const searchResults = useMemo(() => {
    let pool = tracks;
    if (builderFilterType !== 'ALL') pool = pool.filter(t => t.type === builderFilterType);
    if (!searchQuery.trim()) return pool.slice(0, 50);
    const q = searchQuery.toLowerCase();
    return pool.filter(t =>
      t.title.toLowerCase().includes(q) ||
      t.animeName.toLowerCase().includes(q) ||
      (t.artist || '').toLowerCase().includes(q)
    ).slice(0, 50);
  }, [searchQuery, builderFilterType, tracks]);

  // ── Builder handlers ──
  const handleSizeChange = (newSize: 4 | 8 | 16 | 32) => {
    setSize(newSize);
    setSlots(prev => {
      const next = [...prev];
      while (next.length < newSize) next.push({ uid: Math.random().toString(), trackId: null });
      next.length = newSize; // truncate
      return next;
    });
    setFocusedSlotIndex(prev => (prev !== null && prev >= newSize ? newSize - 1 : prev));
  };

  const handleSelectTrackForSlot = (trackId: string, index: number) => {
    // Immutable update — the old version mutated the slot objects in state.
    const next = slots.map((s, i) => (i === index ? { ...s, trackId } : s));
    setSlots(next);
    setSearchQuery('');

    const nextEmpty = next.findIndex(s => s.trackId === null);
    if (nextEmpty !== -1) setFocusedSlotIndex(nextEmpty);
    else setFocusedSlotIndex(null); // all full — release focus
  };

  const removeSlotTrack = (index: number) => {
    setSlots(prev => prev.map((s, i) => (i === index ? { ...s, trackId: null } : s)));
    setFocusedSlotIndex(index);
  };

  const handleFillRandom = () => {
    const usedIds = new Set(slots.map(s => s.trackId).filter(Boolean) as string[]);
    const pool = builderFilterType === 'ALL' ? tracks : tracks.filter(t => t.type === builderFilterType);
    const emptyCount = slots.filter(s => !s.trackId).length;
    if (emptyCount === 0) { toast.info('All slots are already filled.'); return; }
    const picks = pickRandomTrackIds(pool, emptyCount, usedIds);
    if (picks.length < emptyCount) {
      toast.error(`Only ${picks.length} unused ${builderFilterType === 'ALL' ? '' : builderFilterType + ' '}tracks available — fill ${picks.length} slot(s) or widen the filter.`);
      if (picks.length === 0) return;
    }
    let idx = 0;
    const next = slots.map(s => (!s.trackId && idx < picks.length ? { ...s, trackId: picks[idx++] } : s));
    setSlots(next);
    playTactileSound('primary');
    toast.success(`Filled ${picks.length} slot${picks.length === 1 ? '' : 's'} at random.`);
  };

  const handleClearAll = () => {
    setSlots(prev => prev.map(s => ({ ...s, trackId: null })));
    setFocusedSlotIndex(0);
    playTactileSound('rose');
  };

  // ── Template CRUD ──
  const handleSave = async () => {
    if (!name.trim()) return toast.error('Tournament needs a name.');
    if (slots.some(s => !s.trackId)) return toast.error('Please fill all slots before saving!');

    const trackIds = slots.map(s => s.trackId) as string[];

    if (onSaveProfile && currentUser) {
      const template: TournamentTemplate = {
        id: editingTemplateId || generateId('tourney'),
        name: name.trim(),
        size,
        trackIds,
        visibility,
        createdAt: new Date().toISOString(),
      };
      const updated = editingTemplateId
        ? myTemplates.map(t => (t.id === editingTemplateId ? { ...t, ...template } : t))
        : [...myTemplates, template];
      try {
        await onSaveProfile({ customTournaments: updated });
        setEditingTemplateId(template.id);
        toast.success(editingTemplateId
          ? `Updated "${template.name}".`
          : `Saved "${template.name}" as ${visibility} template.`);
      } catch {
        toast.error('Failed to save tournament.');
      }
    } else if (onSaveTournament) {
      // Legacy fallback path
      onSaveTournament({ name: name.trim(), size, tracks: trackIds, visibility });
      toast.success('Tournament saved!');
    } else {
      toast.error('Saving is unavailable right now.');
    }
  };

  const runBracketNow = () => {
    if (!onStartNow) return toast.info('Instant run is not wired up in this view yet.');
    if (slots.some(s => !s.trackId)) return toast.error('Fill all slots first!');
    playTactileSound('success');
    onStartNow(slots.map(s => s.trackId) as string[], name.trim() || 'Custom Bracket', editingTemplateId || undefined);
  };

  const loadTemplate = (t: TournamentTemplate) => {
    setEditingTemplateId(t.id);
    setName(t.name || 'My Custom Grand Prix');
    const tSize = (t.size ?? 8) as 4 | 8 | 16 | 32;
    setSize(tSize);
    setVisibility(isTournamentPublic(t) ? 'public' : 'private');
    const ids: string[] = (t.trackIds || (t as any).tracks || []).slice(0, tSize);
    const arr = makeSlots(tSize);
    ids.forEach((id, i) => { if (id) arr[i].trackId = id; });
    setSlots(arr);
    setSearchQuery('');
    setView('build');
    const firstEmpty = arr.findIndex(s => !s.trackId);
    setFocusedSlotIndex(firstEmpty !== -1 ? firstEmpty : null);
    toast.info(`Loaded "${t.name}" into the builder.`);
  };

  const startNew = () => {
    setEditingTemplateId(null);
    setName('My Custom Grand Prix');
    setSize(8);
    setVisibility('public');
    setSlots(makeSlots(8));
    setFocusedSlotIndex(0);
    setSearchQuery('');
    setView('build');
  };

  const deleteTemplate = async (t: TournamentTemplate) => {
    if (!confirm(`Permanently delete "${t.name}"?`)) return;
    try {
      await onSaveProfile?.({ customTournaments: myTemplates.filter(x => x.id !== t.id) });
      toast.success(`Deleted "${t.name}".`);
    } catch {
      toast.error('Failed to delete.');
    }
  };

  const toggleTemplateVisibility = async (t: TournamentTemplate) => {
    if (!onSaveProfile) return toast.error('Unavailable right now.');
    const makePublic = !isTournamentPublic(t);
    const updated = myTemplates.map(x =>
      x.id === t.id ? { ...x, visibility: makePublic ? 'public' : 'private', isPrivate: false } : x
    );
    try {
      await onSaveProfile({ customTournaments: updated });
      toast.success(`"${t.name}" is now ${makePublic ? 'public — visible in the community feed' : 'private'}.`);
    } catch {
      toast.error('Failed to update visibility.');
    }
  };

  // ── Community actions ──
  const toggleLike = async (ct: CommunityTournamentTemplate) => {
    if (!currentUser) return toast.error('Log in to like tournaments.');
    if (!onSaveProfile) return toast.error('Unavailable right now.');
    const ref = tournamentRef(ct.ownerId, ct.id);
    const nowLiked = !((currentUser as any)?.likedTournamentRefs || []).includes(ref);
    try {
      await onSaveProfile({ likedTournamentRefs: toggleTournamentRefs((currentUser as any)?.likedTournamentRefs, ref) });
      toast.success(nowLiked ? `Liked "${ct.name}".` : `Unliked "${ct.name}".`);
    } catch {
      toast.error('Failed to save like.');
    }
  };

  const alreadyCopied = (ct: CommunityTournamentTemplate) =>
    myTemplates.some(t => t.copiedFrom === tournamentRef(ct.ownerId, ct.id));

  const saveCommunityCopy = async (ct: CommunityTournamentTemplate) => {
    if (!currentUser) return toast.error('Log in to save tournaments.');
    if (!onSaveProfile) return toast.error('Unavailable right now.');
    if (alreadyCopied(ct)) return toast.info(`"${ct.name}" is already in your templates.`);
    const copy: TournamentTemplate = {
      id: generateId('tourney'),
      name: ct.name,
      size: ct.size,
      trackIds: [...(ct.trackIds || [])],
      visibility: 'private',
      createdAt: new Date().toISOString(),
      copiedFrom: tournamentRef(ct.ownerId, ct.id),
      originalCreatorName: ct.ownerName,
    };
    try {
      await onSaveProfile({ customTournaments: [...myTemplates, copy] });
      toast.success(`Saved "${ct.name}" to your templates (private).`);
    } catch {
      toast.error('Failed to save tournament.');
    }
  };

  const runTemplate = (t: TournamentTemplate) => {
    if (!onStartNow) return toast.info('Instant run is not wired up in this view yet.');
    const ids = (t.trackIds || (t as any).tracks || []).filter(id => trackMap.has(id));
    if (ids.length < (t.size ?? ids.length)) {
      return toast.error(`Only ${ids.length} of ${t.size} tracks still exist in the registry.`);
    }
    playTactileSound('success');
    onStartNow(ids, t.name, t.id);
  };

  // ── Shared UI bits ──
  const CoverMosaic = ({ trackIds }: { trackIds: string[] }) => {
    const covers = (trackIds || []).slice(0, 4).map(id => trackMap.get(id)).filter(Boolean) as AnimeTrack[];
    return (
      <div className="w-14 h-14 rounded-lg overflow-hidden border border-zinc-800 grid grid-cols-2 grid-rows-2 gap-px bg-zinc-950 shrink-0">
        {covers.length > 0 ? covers.map(t => (
          <img key={t.id}
            src={t.customImageUrl || `https://i.ytimg.com/vi/${t.youtubeId}/default.jpg`}
            alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" loading="lazy" />
        )) : (
          <div className="col-span-2 row-span-2 flex items-center justify-center">
            <Trophy className="w-5 h-5 text-zinc-700" />
          </div>
        )}
      </div>
    );
  };

  const viewBtn = (v: 'build' | 'mine' | 'community', label: string, count?: number) => (
    <button
      type="button"
      onClick={withDelay(() => setView(v), 'zinc')}
      className={`flex-1 sm:flex-none px-3.5 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors cursor-pointer whitespace-nowrap ${
        view === v ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'
      }`}>
      {label}{typeof count === 'number' && count > 0 && <span className="text-zinc-500 ml-1">({count})</span>}
    </button>
  );

  const iconBtn = 'p-2 rounded-lg bg-zinc-900 border border-zinc-800 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <div className="max-w-6xl mx-auto border border-zinc-900 bg-[#0A0805]/95 backdrop-blur-md rounded-2xl p-5 sm:p-6 lg:p-8 shadow-2xl shadow-black/80 relative overflow-visible">

      {/* Cyber corner brackets */}
      <div className="absolute top-4 left-4 w-3.5 h-3.5 border-t border-l border-brand-primary" />
      <div className="absolute top-4 right-4 w-3.5 h-3.5 border-t border-r border-brand-primary" />
      <div className="absolute bottom-4 left-4 w-3.5 h-3.5 border-b border-l border-brand-primary" />
      <div className="absolute bottom-4 right-4 w-3.5 h-3.5 border-b border-r border-brand-primary" />

      {/* ── Header ── */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6 border-b border-zinc-900 pb-5 relative z-10">
        <div className="flex items-center gap-4">
          <button onClick={withDelay(onCancel, 'rose')}
            className="p-2.5 bg-zinc-950 border border-zinc-900 hover:border-zinc-800 text-zinc-400 hover:text-white rounded-xl transition-all active:scale-95 cursor-pointer flex items-center justify-center">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="text-left">
            <h2 className="text-xl sm:text-2xl font-display font-black text-white flex items-center gap-2.5 tracking-tight uppercase">
              <Trophy className="w-5 h-5 text-brand-primary" />
              Tournament Maker
            </h2>
            <p className="text-zinc-500 font-mono tracking-widest text-[11px] uppercase mt-1">
              Build brackets · Save public or private · Browse the community
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full lg:w-auto">
          {/* Mode switcher */}
          <div className="flex gap-1 p-1 bg-zinc-950 border border-zinc-900 rounded-xl">
            {viewBtn('build', 'Build')}
            {viewBtn('mine', 'Templates', myTemplates.length)}
            {viewBtn('community', 'Community', communityTournaments.length)}
          </div>

          {/* Build actions */}
          {view === 'build' && (
            <div className="flex gap-2">
              {onStartNow && (
                <button onClick={withDelay(runBracketNow, 'primary')}
                  className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl bg-brand-primary/15 border border-brand-primary/40 text-brand-primary text-[10px] font-black uppercase tracking-widest hover:bg-brand-primary hover:text-black transition-all cursor-pointer flex items-center justify-center gap-2">
                  <Play className="w-3.5 h-3.5" /> Run Now
                </button>
              )}
              <button onClick={withDelay(handleSave, 'success')}
                className="flex-1 sm:flex-none px-5 py-2.5 rounded-xl bg-brand-secondary text-zinc-950 text-[10px] font-black uppercase tracking-widest hover:brightness-110 transition-all cursor-pointer flex items-center justify-center gap-2">
                <Save className="w-3.5 h-3.5" /> {editingTemplateId ? 'Update' : 'Save'}
              </button>
            </div>
          )}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {view === 'build' && (
          <motion.div key="build" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }} className="grid grid-cols-1 lg:grid-cols-12 gap-8 relative z-10">

            {/* ── Left: metadata + slots ── */}
            <div className="lg:col-span-7 space-y-6 text-left">

              {/* Metadata */}
              <div className="space-y-4 bg-zinc-950/45 p-4 border border-zinc-900 rounded-2xl">
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
                  <div className="sm:col-span-8 space-y-1.5">
                    <label className="text-zinc-500 text-[11px] font-mono font-black uppercase tracking-widest block">Grand Prix Title</label>
                    <input type="text" value={name} onChange={e => setName(e.target.value)}
                      className="w-full bg-black border border-zinc-900 focus:border-brand-primary rounded-xl px-4 py-3 text-xs text-white outline-none transition-all font-extrabold focus:ring-1 focus:ring-brand-primary/30"
                      placeholder="e.g. My Anime Mix 2026" />
                  </div>
                  <div className="sm:col-span-4 space-y-1.5">
                    <label className="text-zinc-500 text-[11px] font-mono font-black uppercase tracking-widest block">Capacity</label>
                    <div className="grid grid-cols-4 gap-1 bg-black p-1 border border-zinc-900 rounded-xl h-[46px] items-center">
                      {([4, 8, 16, 32] as const).map(s => (
                        <button key={s} type="button" onClick={withDelay(() => handleSizeChange(s), 'primary')}
                          className={`py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all cursor-pointer select-none text-center ${
                            size === s ? 'bg-zinc-100 text-zinc-950 shadow' : 'text-zinc-500 hover:text-zinc-400 hover:bg-zinc-900/45'
                          }`}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Visibility */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-1">
                  <div className="flex gap-1.5 flex-1">
                    {(['public', 'private'] as const).map(v => (
                      <button key={v} type="button" onClick={() => setVisibility(v)}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-colors cursor-pointer ${
                          visibility === v
                            ? 'bg-brand-primary/15 border-brand-primary/40 text-white'
                            : 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:text-zinc-300'
                        }`}>
                        {v === 'public' ? <Globe className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />} {v}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-zinc-600 leading-snug sm:max-w-[240px]">
                    Public templates appear in the community feed and can be liked & saved by others.
                  </p>
                </div>
              </div>

              {/* Slots header with progress + quick actions */}
              <div className="flex flex-wrap items-center justify-between gap-2 bg-zinc-950/30 px-3 py-2 border border-zinc-900/60 rounded-xl">
                <span className="text-zinc-400 text-[11px] font-mono font-black uppercase tracking-widest">
                  Bracket Slots ({size})
                </span>
                <div className="flex items-center gap-2">
                  <button onClick={withDelay(handleFillRandom, 'primary')} title="Fill empty slots randomly"
                    className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-brand-primary transition-colors cursor-pointer">
                    <Shuffle className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={withDelay(handleClearAll, 'rose')} title="Clear all slots"
                    className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-vermillion transition-colors cursor-pointer">
                    <Eraser className="w-3.5 h-3.5" />
                  </button>
                  <div className="w-20 h-1.5 bg-zinc-900 rounded-full overflow-hidden">
                    <div className="h-full bg-brand-primary rounded-full transition-all duration-300"
                      style={{ width: `${(filledCount / size) * 100}%` }} />
                  </div>
                  <span className="text-[10px] font-mono text-zinc-500 tabular-nums">{filledCount}/{size}</span>
                </div>
              </div>

              {/* Slots list */}
              <div className="max-h-[440px] overflow-y-auto pr-2 space-y-2 custom-scrollbar">
                <Reorder.Group axis="y" values={slots} onReorder={setSlots} className="space-y-2">
                  {slots.map((slot, i) => {
                    const track = trackMap.get(slot.trackId || '');
                    const isFocused = focusedSlotIndex === i;
                    return (
                      <Reorder.Item key={slot.uid} value={slot} className="relative group/slot">
                        <div className="flex items-center gap-2">
                          <div className="text-zinc-500 hover:text-zinc-400 cursor-grab active:cursor-grabbing p-1.5 transition-colors">
                            <GripVertical className="w-4 h-4" />
                          </div>
                          <button type="button"
                            onClick={withDelay(() => setFocusedSlotIndex(i), 'zinc')}
                            className={`flex-1 text-left p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between select-none ${
                              isFocused
                                ? 'border-brand-primary bg-brand-primary/10 shadow-[0_0_12px_rgba(255, 61, 46,0.15)]'
                                : track
                                  ? 'border-zinc-900 bg-zinc-950/50 hover:bg-zinc-900/30'
                                  : 'border-dashed border-zinc-800 bg-black/40 hover:border-zinc-700'
                            }`}>
                            {track ? (
                              <div className="flex items-center gap-3 w-full">
                                <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 border border-zinc-800">
                                  <img src={track.customImageUrl || `https://i.ytimg.com/vi/${track.youtubeId}/mqdefault.jpg`}
                                    className="w-full h-full object-cover" alt="" referrerPolicy="no-referrer" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-black text-white truncate leading-tight mb-0.5">{track.title}</p>
                                  <p className="text-[11px] text-zinc-400 truncate">{track.animeName} · {track.type}</p>
                                </div>
                                <span className="font-mono text-[11px] font-black text-zinc-500 shrink-0">SEED {i + 1}</span>
                              </div>
                            ) : (
                              <>
                                <div className="flex items-center gap-2.5">
                                  <span className="w-7 h-7 bg-zinc-900/60 rounded-full flex items-center justify-center font-mono text-[11px] font-bold text-zinc-500 border border-zinc-800">
                                    {i + 1}
                                  </span>
                                  <span className="text-xs text-zinc-500 font-bold uppercase tracking-wide">Empty Slot</span>
                                </div>
                                <Plus className="w-4 h-4 text-zinc-600 animate-pulse" />
                              </>
                            )}
                          </button>
                        </div>
                        {track && (
                          <button type="button" onClick={withDelay(() => removeSlotTrack(i), 'rose')}
                            className="absolute -right-1 -top-1 w-5 h-5 bg-zinc-900 hover:bg-vermillion text-zinc-400 hover:text-white rounded-full flex items-center justify-center opacity-0 group-hover/slot:opacity-100 border border-zinc-800 transition-all z-20 cursor-pointer shadow-md"
                            title="Remove Track">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </Reorder.Item>
                    );
                  })}
                </Reorder.Group>
              </div>

              {!currentUser && (
                <div className="p-3 bg-vermillion/5 border border-vermillion/10 rounded-xl text-center">
                  <p className="text-vermillion text-[11px] uppercase font-mono tracking-widest animate-pulse font-bold">
                    ⚠️ Log in to save templates to your cloud profile!
                  </p>
                </div>
              )}
            </div>

            {/* ── Right: track search ── */}
            <div className="lg:col-span-5 flex flex-col h-full bg-zinc-950/80 border border-zinc-900 rounded-2xl p-4 sm:p-5 relative min-h-[420px] lg:min-h-0 text-left">
              {focusedSlotIndex !== null ? (
                <div className="space-y-4 flex flex-col h-full">
                  <div className="space-y-4">
                    <div className="bg-[#0c121e] border border-brand-primary/20 rounded-xl p-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-brand-primary shrink-0" />
                        <span className="text-xs font-black font-mono uppercase tracking-wider text-brand-primary">
                          Filling Slot #{focusedSlotIndex + 1}
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-zinc-500 border border-zinc-800 px-2 py-0.5 rounded-md leading-none">
                        Registry
                      </span>
                    </div>

                    {/* Type filter — brand palette now */}
                    <div className="flex gap-1.5 bg-black p-1 border border-zinc-900 rounded-xl">
                      {(['ALL', 'OP', 'ED', 'OST'] as const).map(f => (
                        <button key={f} type="button" onClick={withDelay(() => setBuilderFilterType(f), 'zinc')}
                          className={`flex-1 py-1.5 text-[11px] font-black rounded-lg cursor-pointer uppercase transition-all tracking-wider select-none text-center border ${
                            builderFilterType === f
                              ? 'bg-brand-primary/15 text-white border-brand-primary/40'
                              : 'text-zinc-500 hover:text-zinc-400 hover:bg-zinc-900/30 border border-transparent'
                          }`}>
                          {f}
                        </button>
                      ))}
                    </div>

                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input type="text"
                        className="w-full bg-black border border-zinc-900 py-3 pl-9 pr-4 text-xs text-white rounded-xl outline-none focus:border-brand-primary/40 focus:ring-1 focus:ring-brand-primary/20"
                        placeholder="Search song title or anime name..."
                        value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
                      {searchQuery && (
                        <button type="button" onClick={() => setSearchQuery('')}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white cursor-pointer">
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>

                    <div className="max-h-[320px] overflow-y-auto space-y-1 pr-1 border-t border-zinc-900/60 pt-3 custom-scrollbar">
                      {searchResults.map(t => {
                        const isAlreadySelected = slots.some(s => s.trackId === t.id);
                        return (
                          <button key={t.id} type="button"
                            onClick={withDelay(() => handleSelectTrackForSlot(t.id, focusedSlotIndex), 'success')}
                            className="w-full flex items-center justify-between gap-2.5 p-2 rounded-xl text-left transition-all bg-black/40 hover:bg-zinc-900/45 border border-transparent hover:border-zinc-800 cursor-pointer group/item">
                            <div className="w-8 h-8 rounded-md overflow-hidden shrink-0 border border-zinc-800">
                              <img src={t.customImageUrl || `https://i.ytimg.com/vi/${t.youtubeId}/mqdefault.jpg`}
                                className="w-full h-full object-cover group-hover/item:scale-105 transition-transform" alt=""
                                referrerPolicy="no-referrer" loading="lazy" />
                            </div>
                            <div className="flex-1 min-w-0 leading-tight">
                              <p className="text-[11px] text-zinc-200 font-black truncate leading-tight mb-0.5">{t.title}</p>
                              <p className="text-[11px] text-zinc-500 truncate">{t.animeName} · {t.type}</p>
                            </div>
                            {isAlreadySelected && <Check className="w-3.5 h-3.5 text-brand-secondary shrink-0" />}
                          </button>
                        );
                      })}
                      {searchResults.length === 0 && (
                        <div className="text-center py-10 font-mono text-zinc-600 text-[11px] uppercase">
                          No matching registered themes
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-zinc-900 flex items-start gap-2 text-[11px] text-zinc-500 italic">
                    <Music4 className="w-4 h-4 text-brand-primary shrink-0 mt-0.5" />
                    <span>Clicking a theme binds it to the highlighted slot and auto-advances to the next empty one. Duplicates are allowed (✓ marks already-picked).</span>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
                  <Trophy className="w-8 h-8 text-zinc-800 border border-zinc-900 p-2 rounded-full" />
                  <p className="text-zinc-500 text-xs font-bold uppercase tracking-wider">All Slots Filled</p>
                  <p className="text-[11px] text-zinc-500 max-w-[240px] leading-relaxed font-mono">
                    Click any slot to replace its track, or hit Save / Run Now.
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {view === 'mine' && (
          <motion.div key="mine" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }} className="relative z-10 text-left">
            <div className="flex items-center justify-between gap-2 mb-4">
              <p className="text-[11px] font-mono font-black uppercase tracking-widest text-zinc-500">
                My Templates — {myTemplates.length} saved
              </p>
              <button onClick={withDelay(startNew, 'primary')}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand-primary text-black text-[10px] font-black uppercase tracking-widest hover:brightness-110 transition-all cursor-pointer">
                <Plus className="w-3.5 h-3.5" /> New Bracket
              </button>
            </div>

            {!currentUser ? (
              <div className="py-16 border border-dashed border-zinc-900 rounded-2xl text-center">
                <Users className="w-7 h-7 text-zinc-700 mx-auto mb-2" />
                <p className="text-[11px] font-black uppercase tracking-widest text-zinc-500">Log in to manage templates</p>
              </div>
            ) : myTemplates.length === 0 ? (
              <div className="py-16 border border-dashed border-zinc-900 rounded-2xl text-center">
                <Trophy className="w-7 h-7 text-zinc-700 mx-auto mb-2" />
                <p className="text-[11px] font-black uppercase tracking-widest text-zinc-500">No templates yet</p>
                <p className="text-[10px] text-zinc-600 mt-1">Build a bracket and hit Save.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {myTemplates.map(t => {
                  const likes = myLikeCounts[t.id] || 0;
                  const pub = isTournamentPublic(t);
                  const playableCount = (t.trackIds || (t as any).tracks || []).filter(id => trackMap.has(id)).length;
                  const canRun = playableCount >= t.size && !!onStartNow;
                  return (
                    <div key={t.id} className="bg-zinc-950/60 border border-zinc-900 hover:border-zinc-800 rounded-xl p-3 transition-colors">
                      <div className="flex items-center gap-3">
                        <CoverMosaic trackIds={t.trackIds || (t as any).tracks || []} />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-black text-white truncate flex items-center gap-1.5">
                            {t.name}
                            {pub ? <Globe className="w-3 h-3 text-zinc-600 shrink-0" /> : <Lock className="w-3 h-3 text-zinc-600 shrink-0" />}
                          </p>
                          <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-widest mt-0.5 flex items-center gap-2">
                            <span>{t.size} bracket</span>
                            <span>·</span>
                            <span>{(t.trackIds || (t as any).tracks || []).length} tracks</span>
                            {likes > 0 && (
                              <span className="flex items-center gap-0.5 text-vermillion/80">
                                <Heart className="w-2.5 h-2.5 fill-vermillion/80" /> {likes}
                              </span>
                            )}
                          </p>
                          {t.originalCreatorName && (
                            <p className="text-[9px] text-zinc-600 truncate mt-0.5">saved from {t.originalCreatorName}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 mt-2.5">
                        <button disabled={!canRun} onClick={withDelay(() => runTemplate(t), 'success')}
                          title={canRun ? 'Run this bracket now' : 'Not enough valid tracks or run not wired'}
                          className={`${iconBtn} flex-1 flex items-center justify-center gap-1.5 text-zinc-300 hover:text-white !py-2`}>
                          <Play className="w-3 h-3" />
                          <span className="text-[10px] font-black uppercase tracking-widest">Run</span>
                        </button>
                        <button onClick={withDelay(() => loadTemplate(t), 'zinc')} title="Edit in builder"
                          className={`${iconBtn} text-zinc-400 hover:text-white`}>
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={withDelay(() => toggleTemplateVisibility(t), 'zinc')}
                          title={pub ? 'Make private' : 'Make public'}
                          className={`${iconBtn} text-zinc-400 hover:text-brand-primary`}>
                          {pub ? <Globe className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                        </button>
                        <button onClick={withDelay(() => deleteTemplate(t), 'rose')} title="Delete"
                          className={`${iconBtn} text-zinc-500 hover:text-vermillion`}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}

        {view === 'community' && (
          <motion.div key="community" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }} className="relative z-10 text-left">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
              <p className="text-[11px] font-mono font-black uppercase tracking-widest text-zinc-500">
                Community Tournaments — {communityFiltered.length} public
              </p>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-zinc-600 absolute left-3 top-1/2 -translate-y-1/2" />
                <input value={communitySearch} onChange={e => setCommunitySearch(e.target.value)}
                  placeholder="Search tournaments or creators…"
                  className="w-full sm:w-64 pl-9 pr-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-[11px] text-white placeholder:text-zinc-600 outline-none focus:border-brand-primary/50" />
              </div>
            </div>

            {communityFiltered.length === 0 ? (
              <div className="py-16 border border-dashed border-zinc-900 rounded-2xl text-center">
                <Users className="w-7 h-7 text-zinc-700 mx-auto mb-2" />
                <p className="text-[11px] font-black uppercase tracking-widest text-zinc-500">
                  {communitySearch ? 'No tournaments match your search' : 'No community tournaments yet'}
                </p>
                {!communitySearch && (
                  <p className="text-[10px] text-zinc-600 mt-1">Save one of your brackets as public and be the first.</p>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {communityFiltered.map(ct => {
                  const liked = !!currentUser && ((currentUser as any)?.likedTournamentRefs || []).includes(tournamentRef(ct.ownerId, ct.id));
                  const saved = alreadyCopied(ct);
                  const playableCount = (ct.trackIds || []).filter(id => trackMap.has(id)).length;
                  const canRun = playableCount >= ct.size && !!onStartNow;
                  return (
                    <div key={`${ct.ownerId}-${ct.id}`} className="bg-zinc-950/60 border border-zinc-900 hover:border-zinc-800 rounded-xl p-3 transition-colors">
                      <div className="flex items-center gap-3">
                        <CoverMosaic trackIds={ct.trackIds || []} />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-black text-white truncate">{ct.name}</p>
                          <button onClick={() => onViewUserProfile?.(ct.ownerId)}
                            className="text-[10px] text-zinc-500 hover:text-brand-primary transition-colors truncate flex items-center gap-1 mt-0.5 cursor-pointer"
                            title={onViewUserProfile ? 'View creator profile' : undefined}>
                            {ct.ownerPicture
                              ? <img src={ct.ownerPicture} alt="" className="w-3.5 h-3.5 rounded-full object-cover" referrerPolicy="no-referrer" />
                              : <Users className="w-3 h-3" />}
                            by {ct.ownerName}
                          </button>
                          <p className="text-[10px] text-zinc-600 font-mono uppercase tracking-widest mt-0.5">
                            {ct.size} bracket · {(ct.trackIds || []).length} tracks
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 mt-2.5">
                        <button disabled={!canRun} onClick={withDelay(() => runTemplate(ct), 'success')}
                          title={canRun ? 'Run this bracket now' : 'Not enough valid tracks or run not wired'}
                          className={`${iconBtn} flex-1 flex items-center justify-center gap-1.5 text-zinc-300 hover:text-white !py-2`}>
                          <Play className="w-3 h-3" />
                          <span className="text-[10px] font-black uppercase tracking-widest">Run</span>
                        </button>
                        <button onClick={withDelay(() => saveCommunityCopy(ct), 'primary')} disabled={saved}
                          title={saved ? 'Already in your templates' : 'Save a private copy'}
                          className={`${iconBtn} ${saved ? 'text-brand-primary' : 'text-zinc-400 hover:text-gold-bright'}`}>
                          <BookmarkPlus className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={withDelay(() => toggleLike(ct), 'zinc')}
                          title={liked ? 'Unlike' : 'Like this tournament'}
                          className={`flex items-center gap-1 px-2.5 py-2 rounded-lg border transition-colors cursor-pointer ${
                            liked
                              ? 'bg-vermillion/10 border-vermillion/30 text-vermillion'
                              : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-vermillion'
                          }`}>
                          <Heart className={`w-3.5 h-3.5 ${liked ? 'fill-vermillion' : ''}`} />
                          <span className="text-[10px] font-black tabular-nums">{ct.likeCount}</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {!currentUser && (
              <p className="mt-4 text-center text-[10px] font-mono uppercase tracking-widest text-zinc-600">
                Log in to like & save community tournaments
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}