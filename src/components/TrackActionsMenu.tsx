import React, { useState } from 'react';
import { AnimeTrack } from '../types';
import { 
  MoreVertical, 
  AlertTriangle, 
  ShieldAlert, 
  Trash2, 
  Check, 
  X, 
  Edit3,
  Tv, 
  Music
} from '@/utils/icons';
import { updateTrackInDb, deleteTrackFromDb, submitProposalToDb } from '../utils/firestoreService';
import { toast } from 'sonner';
import { confirm } from '../utils/confirm';

interface TrackActionsMenuProps {
  track: AnimeTrack;
  isAdmin?: boolean;
  className?: string;
  align?: 'left' | 'right';
  onOpenStateChange?: (isOpen: boolean) => void;
}

export default function TrackActionsMenu({ track, isAdmin = false, className = "", align = "right", onOpenStateChange }: TrackActionsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activePane, setActivePane] = useState<'options' | 'report' | 'edit'>('options');
  
  // Repo state
  const [reportReason, setReportReason] = useState('dead_link');
  const [reportNotes, setReportNotes] = useState('');
  const [reportCoverUrl, setReportCoverUrl] = useState('');
  
  // Edit state
  const [editTitle, setEditTitle] = useState(track.title);
  const [editArtist, setEditArtist] = useState(track.artist);
  const [editAnime, setEditAnime] = useState(track.animeName);
  const [editYtId, setEditYtId] = useState(track.youtubeId || '');
  const [editCustomImageUrl, setEditCustomImageUrl] = useState(track.customImageUrl || '');

  const toggleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    const newOpen = !isOpen;
    setIsOpen(newOpen);
    setActivePane('options');
    if (onOpenStateChange) {
      onOpenStateChange(newOpen);
    }
  };

  const handleReportSubmit = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const compiledNotes = [
        `User reported issue: ${reportReason}`,
        reportCoverUrl.trim() ? `Suggested Cover Art: ${reportCoverUrl.trim()}` : null,
        reportNotes.trim() ? `User Notes: ${reportNotes.trim()}` : null
      ].filter(Boolean).join('\n');

      await submitProposalToDb({
        id: Math.random().toString(36).substring(2, 11),
        type: 'fix_link',
        submittedBy: "User (Quick Action Menu)",
        submittedAt: new Date().toISOString(),
        status: 'pending',
        trackData: {
          title: track.title,
          artist: track.artist,
          animeName: track.animeName,
          type: track.type,
          youtubeId: track.youtubeId,
          customImageUrl: reportReason === 'wrong_cover' && reportCoverUrl.trim() ? reportCoverUrl : track.customImageUrl
        },
        oldTrackId: track.id,
        proposedYtId: reportReason === 'dead_link' ? 'REPLACEMENT_NEEDED' : track.youtubeId,
        notes: compiledNotes
      });
      toast.success("Issue reported successfully!");
      setIsOpen(false);
      if (onOpenStateChange) {
        onOpenStateChange(false);
      }
    } catch (err: any) {
      toast.error("Failed to submit issue report: " + err.message);
    }
  };

  const handleAdminSave = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await updateTrackInDb(track.id, {
        title: editTitle,
        artist: editArtist,
        animeName: editAnime,
        youtubeId: editYtId,
        customImageUrl: editCustomImageUrl
      });
      toast.success("Track updated in Database!");
      setIsOpen(false);
      if (onOpenStateChange) {
        onOpenStateChange(false);
      }
    } catch (err: any) {
      toast.error("Failed to update track: " + err.message);
    }
  };

  const handleAdminDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (await confirm({ title: `Permanently delete "${track.title}"?`, body: 'This cannot be undone.', confirmLabel: 'Delete', danger: true })) {
      try {
        await deleteTrackFromDb(track.id);
        toast.success("Track deleted successfully.");
        setIsOpen(false);
        if (onOpenStateChange) {
          onOpenStateChange(false);
        }
      } catch (err: any) {
        toast.error("Failed to delete track: " + err.message);
      }
    }
  };

  const hasPos = className.includes('absolute') || className.includes('fixed') || className.includes('relative');
  const finalClass = hasPos ? className : `relative ${className}`;

  return (
    <div className={finalClass} onClick={(e) => e.stopPropagation()}>
      {/* Small action button */}
      <button 
        onClick={toggleOpen}
        className="p-1 px-1.5 rounded-full text-slate-400/80 hover:text-white hover:bg-white/10 active:scale-95 transition-all cursor-pointer z-35 drop-shadow-md"
        title="Track options & feedback"
      >
        <MoreVertical className="w-5 h-5 drop-shadow-md" />
      </button>

      {isOpen && (
        <>
          {/* Transparent clickaway layout overlay */}
          <div className="fixed inset-0 z-40 pointer-events-auto" onClick={() => { setIsOpen(false); if (onOpenStateChange) onOpenStateChange(false); }} />
          
          <div className={`absolute ${align === 'left' ? 'left-0' : 'right-0'} mt-2 w-72 bg-[#100C0A]/95 backdrop-blur-xl border border-zinc-800 rounded-lg shadow-[0_10px_35px_rgba(0,0,0,0.8)] z-50 overflow-hidden font-sans text-white text-left`}>
            
            {/* Options Panel */}
            {activePane === 'options' && (
              <div className="p-1.5 flex flex-col gap-1">
                <div className="px-3 py-1.5 text-[11px] uppercase font-mono tracking-widest text-[#FF3D2E] border-b border-zinc-800/60 pb-1.5 mb-1 flex items-center justify-between">
                  <span>Track Settings</span>
                  <button onClick={() => { setIsOpen(false); if (onOpenStateChange) onOpenStateChange(false); }} className="text-zinc-500 hover:text-white">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                
                <button
                  onClick={(e) => { e.stopPropagation(); setActivePane('report'); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-slate-300 hover:bg-gold/10 hover:text-gold-bright rounded-md transition-colors"
                >
                  <AlertTriangle className="w-4 h-4 text-gold" />
                  <span>Report / Flag Issue</span>
                </button>

                {isAdmin && (
                  <>
                    <div className="h-px bg-zinc-800 my-1" />
                    <button
                      onClick={(e) => { e.stopPropagation(); setActivePane('edit'); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-slate-300 hover:bg-vermillion/10 hover:text-vermillion rounded-md transition-colors font-semibold"
                    >
                      <ShieldAlert className="w-4 h-4 text-vermillion" />
                      <span>Admin Quick Edit</span>
                    </button>
                    <button
                      onClick={handleAdminDelete}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-vermillion hover:bg-vermillion/20 hover:text-vermillion-tint rounded-md transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>Purge Track from Database</span>
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Report Form */}
            {activePane === 'report' && (
              <div className="p-3 flex flex-col gap-2.5">
                <div className="flex items-center justify-between text-gold-bright border-b border-zinc-800 pb-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    <span className="font-mono text-[11px] uppercase font-bold tracking-wider">Report Issue</span>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); setActivePane('options'); }} className="text-zinc-500 hover:text-white text-[11px] font-mono">
                    BACK
                  </button>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-mono text-slate-400 uppercase">Issue Type</label>
                  <select
                    value={reportReason}
                    onChange={(e) => setReportReason(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="bg-[#05090d] border border-zinc-800 text-xs text-white rounded p-1.5 focus:outline-none focus:border-gold"
                  >
                    <option value="dead_link">Dead Video / Broken Embed</option>
                    <option value="wrong_cover">Wrong Cover / Thumbnail Art</option>
                    <option value="wrong_song">Wrong Theme / Audio Mistake</option>
                    <option value="bad_quality">Muffled / Audio Cut Ending</option>
                    <option value="wrong_metadata">Typo in Anime or Artist</option>
                    <option value="duplicate">Duplicate Track Entry</option>
                    <option value="other">Other / Support Request</option>
                  </select>
                </div>

                {reportReason === 'wrong_cover' && (
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-mono text-slate-400 uppercase">Suggested Cover Image URL</label>
                    <input
                      type="text"
                      value={reportCoverUrl}
                      onChange={(e) => setReportCoverUrl(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      placeholder="https://example.com/cover.jpg"
                      className="bg-[#05090d] border border-zinc-800 text-xs text-white rounded p-1.5 focus:outline-none focus:border-gold font-sans"
                    />
                  </div>
                )}

                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-mono text-slate-400 uppercase">Additional Info (Optional)</label>
                  <textarea
                    value={reportNotes}
                    onChange={(e) => setReportNotes(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    placeholder="e.g. Correct link should be..."
                    rows={2}
                    className="bg-[#05090d] border border-zinc-800 text-xs text-white rounded p-1.5 focus:outline-none focus:border-gold resize-none font-sans"
                  />
                </div>

                <div className="flex gap-2 justify-end mt-1">
                  <button 
                    onClick={(e) => { e.stopPropagation(); setActivePane('options'); }}
                    className="px-2.5 py-1 text-[11px] text-zinc-400 hover:text-white transition-colors uppercase font-mono"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleReportSubmit}
                    className="px-3 py-1 text-[11px] bg-gold/20 text-gold-bright border border-gold/30 hover:bg-gold/40 rounded transition-colors font-bold uppercase font-mono"
                  >
                    Submit
                  </button>
                </div>
              </div>
            )}

            {/* Quick Edit Form */}
            {activePane === 'edit' && isAdmin && (
              <div className="p-3 flex flex-col gap-2.5">
                <div className="flex items-center justify-between text-vermillion border-b border-zinc-800 pb-2">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4" />
                    <span className="font-mono text-[11px] uppercase font-bold tracking-wider">Database Edit</span>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); setActivePane('options'); }} className="text-zinc-500 hover:text-white text-[11px] font-mono">
                    BACK
                  </button>
                </div>

                <div className="flex flex-col gap-1.5">
                  <div>
                    <label className="text-[11px] font-mono text-slate-400 uppercase">Track Title</label>
                    <input 
                      type="text" 
                      value={editTitle} 
                      onChange={e => setEditTitle(e.target.value)} 
                      onClick={e => e.stopPropagation()}
                      className="w-full bg-[#05090d] border border-rose-deep/40 rounded p-1.5 text-xs text-white focus:outline-none focus:border-vermillion" 
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-mono text-slate-400 uppercase">Anime Name</label>
                    <input 
                      type="text" 
                      value={editAnime} 
                      onChange={e => setEditAnime(e.target.value)} 
                      onClick={e => e.stopPropagation()}
                      className="w-full bg-[#05090d] border border-rose-deep/40 rounded p-1.5 text-xs text-white focus:outline-none focus:border-vermillion" 
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-mono text-slate-400 uppercase">Artist</label>
                    <input 
                      type="text" 
                      value={editArtist} 
                      onChange={e => setEditArtist(e.target.value)} 
                      onClick={e => e.stopPropagation()}
                      className="w-full bg-[#05090d] border border-rose-deep/40 rounded p-1.5 text-xs text-white focus:outline-none focus:border-vermillion" 
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-mono text-slate-400 uppercase">YouTube ID</label>
                    <input 
                      type="text" 
                      value={editYtId} 
                      onChange={e => setEditYtId(e.target.value)} 
                      onClick={e => e.stopPropagation()}
                      className="w-full bg-[#05090d] border border-rose-deep/40 rounded p-1.5 text-xs text-brand-secondary font-mono focus:outline-none focus:border-vermillion" 
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-mono text-slate-400 uppercase">Cover Image URL</label>
                    <input 
                      type="text" 
                      value={editCustomImageUrl} 
                      onChange={e => setEditCustomImageUrl(e.target.value)} 
                      onClick={e => e.stopPropagation()}
                      placeholder="Leave blank to use YouTube thumbnail"
                      className="w-full bg-[#05090d] border border-rose-deep/40 rounded p-1.5 text-xs text-white focus:outline-none focus:border-vermillion" 
                    />
                  </div>
                </div>

                <div className="flex gap-2 justify-end mt-1">
                  <button 
                    onClick={(e) => { e.stopPropagation(); setActivePane('options'); }}
                    className="px-2.5 py-1 text-[11px] text-zinc-400 hover:text-white transition-colors uppercase font-mono"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAdminSave}
                    className="flex items-center gap-1 px-3 py-1 text-[11px] bg-vermillion text-white hover:bg-vermillion-hover rounded font-bold shadow-md transition-colors uppercase font-mono"
                  >
                    <Check className="w-3 h-3" /> Save
                  </button>
                </div>
              </div>
            )}

          </div>
        </>
      )}
    </div>
  );
}
