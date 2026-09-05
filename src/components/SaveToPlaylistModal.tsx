import React, { useState, useMemo } from 'react';
import { AnimeTrack } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { generateId } from '../utils/autoId';
import { CustomPlaylist, isPlaylistPublic } from '../utils/playlists';
import { X, Check, Plus, Globe, Lock, Music, Loader2 } from '@/utils/icons';

// ─────────────────────────────────────────────────────────────────────────────
// SaveToPlaylistModal — YouTube-style "Save to playlist" picker.
// Opens from the leaderboard bookmark. Toggling a list adds/removes the track
// immediately via onSaveProfile({ customLists }). Quick-create makes a new
// playlist (with public/private choice) containing the track.
// ─────────────────────────────────────────────────────────────────────────────

interface SaveToPlaylistModalProps {
  track: AnimeTrack;
  currentUser: any;
  onSaveProfile?: (fields: any) => Promise<void> | void;
  onClose: () => void;
}

export default function SaveToPlaylistModal({
  track, currentUser, onSaveProfile, onClose,
}: SaveToPlaylistModalProps) {
  // Local mirror so checkboxes respond instantly; parent save is the source of truth.
  const [lists, setLists] = useState<CustomPlaylist[]>(currentUser?.customLists || []);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newVisibility, setNewVisibility] = useState<'public' | 'private'>('public');
  const [isCreating, setIsCreating] = useState(false);

  const sorted = useMemo(() => {
    return [...lists].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  }, [lists]);

  const persist = async (updated: CustomPlaylist[], successMsg?: string) => {
    setLists(updated);
    try {
      await onSaveProfile?.({ customLists: updated });
      if (successMsg) toast.success(successMsg);
    } catch {
      setLists(currentUser?.customLists || []); // revert on failure
      toast.error('Failed to save. Try again.');
    }
  };

  const toggleList = async (list: CustomPlaylist) => {
    if (busyId || !onSaveProfile) return;
    setBusyId(list.id);
    const has = (list.trackIds || []).includes(track.id);
    const updated = lists.map(l =>
      l.id === list.id
        ? {
            ...l,
            trackIds: has
              ? (l.trackIds || []).filter(t => t !== track.id)
              : [...(l.trackIds || []), track.id],
          }
        : l
    );
    await persist(updated, has ? undefined : `Saved to "${list.name}".`);
    setBusyId(null);
  };

  const createPlaylist = async () => {
    const name = newName.trim();
    if (!name) { toast.error('Give the playlist a name.'); return; }
    if (!onSaveProfile) { toast.error('Saving unavailable right now.'); return; }
    setIsCreating(true);
    const list: CustomPlaylist = {
      id: generateId('list'),
      name,
      trackIds: [track.id],
      visibility: newVisibility,
      createdAt: new Date().toISOString(),
    };
    await persist([...lists, list], `Created "${name}" and saved the track.`);
    setIsCreating(false);
    onClose();
  };

  const loggedIn = !!currentUser;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-sm bg-[#0e0e11] border border-zinc-800 rounded-2xl shadow-2xl max-h-[80vh] flex flex-col">

        {/* Header */}
        <div className="p-4 border-b border-zinc-900 flex items-center gap-3">
          <img src={track.customImageUrl || `https://img.youtube.com/vi/${track.youtubeId}/default.jpg`}
            alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" referrerPolicy="no-referrer" />
          <div className="min-w-0 flex-1">
            <h3 className="font-display font-black text-white text-sm uppercase tracking-tight truncate">Save to playlist</h3>
            <p className="text-[11px] text-zinc-500 truncate">{track.title}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-900 cursor-pointer shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {!loggedIn ? (
          <div className="p-8 text-center">
            <Music className="w-7 h-7 text-zinc-700 mx-auto mb-2" />
            <p className="text-xs font-black uppercase tracking-widest text-zinc-500">Log in to save tracks</p>
          </div>
        ) : !onSaveProfile ? (
          <div className="p-8 text-center">
            <p className="text-xs font-black uppercase tracking-widest text-zinc-500">Saving unavailable</p>
          </div>
        ) : (
          <>
            {/* List of playlists */}
            <div className="flex-1 overflow-y-auto p-2">
              {sorted.length === 0 && !creating && (
                <p className="text-[11px] text-zinc-600 text-center py-6 uppercase tracking-widest">
                  No playlists yet — create one below
                </p>
              )}
              {sorted.map(list => {
                const checked = (list.trackIds || []).includes(track.id);
                const isBusy = busyId === list.id;
                return (
                  <button key={list.id} onClick={() => toggleList(list)} disabled={!!busyId}
                    className="w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl hover:bg-zinc-900/60 transition-colors text-left cursor-pointer disabled:opacity-60">
                    <div className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                      checked ? 'bg-brand-primary border-brand-primary' : 'border-zinc-700'}`}>
                      {checked && <Check className="w-3.5 h-3.5 text-black" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-black text-white truncate">{list.name}</p>
                      <p className="text-[10px] text-zinc-600 font-mono uppercase tracking-wider flex items-center gap-1.5">
                        {isPlaylistPublic(list) ? <Globe className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                        {(list.trackIds || []).length} tracks
                      </p>
                    </div>
                    {isBusy && <Loader2 className="w-3.5 h-3.5 text-zinc-500 animate-spin shrink-0" />}
                  </button>
                );
              })}

              {/* Create new */}
              {creating ? (
                <div className="p-2.5 mx-1 mt-1 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2.5">
                  <input value={newName} onChange={e => setNewName(e.target.value)}
                    placeholder="Playlist name" autoFocus
                    className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white placeholder:text-zinc-600 outline-none focus:border-brand-primary/50" />
                  <div className="flex gap-1.5">
                    {(['public', 'private'] as const).map(v => (
                      <button key={v} onClick={() => setNewVisibility(v)}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-colors cursor-pointer ${
                          newVisibility === v
                            ? 'bg-brand-primary/15 border-brand-primary/40 text-white'
                            : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300'}`}>
                        {v === 'public' ? <Globe className="w-3 h-3" /> : <Lock className="w-3 h-3" />} {v}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-1.5">
                    <button onClick={() => { setCreating(false); setNewName(''); }}
                      className="flex-1 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:text-white cursor-pointer">
                      Cancel
                    </button>
                    <button onClick={createPlaylist} disabled={isCreating}
                      className="flex-1 py-2 rounded-lg bg-brand-primary text-black text-[10px] font-black uppercase tracking-widest hover:brightness-110 disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer">
                      {isCreating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Create
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => { setCreating(true); setNewVisibility('public'); }}
                  className="w-full flex items-center gap-3 px-2.5 py-2.5 mt-1 rounded-xl hover:bg-zinc-900/60 transition-colors text-left cursor-pointer">
                  <div className="w-5 h-5 rounded-md border border-dashed border-zinc-700 flex items-center justify-center shrink-0">
                    <Plus className="w-3 h-3 text-zinc-500" />
                  </div>
                  <p className="text-xs font-black text-zinc-300 uppercase tracking-widest">New playlist</p>
                </button>
              )}
            </div>

            <p className="px-4 pb-3 text-[10px] text-zinc-600 text-center">
              Changes save instantly
            </p>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}