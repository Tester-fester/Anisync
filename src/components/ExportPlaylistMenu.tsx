import React, { useState, useRef, useEffect } from 'react';
import { Youtube, Music, ListMusic, Copy } from '@/utils/icons';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';

interface ExportPlaylistMenuProps {
  tracks: { title: string; artist: string; youtubeId?: string }[];
  playlistName?: string;
  variant?: 'button' | 'icon';
  className?: string;
}

export const ExportPlaylistMenu: React.FC<ExportPlaylistMenuProps> = ({ tracks, playlistName = "ANISYNC Playlist", variant = 'button', className = '' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleExportYouTube = () => {
    const idsToExport = tracks.map(t => t.youtubeId).filter(id => id && id.length > 5).slice(0, 50);
    if (idsToExport.length === 0) {
      toast.error("No valid YouTube IDs found in the current selection.");
      return;
    }
    const url = `https://www.youtube.com/watch_videos?video_ids=${idsToExport.join(',')}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    toast.success(`Exporting ${idsToExport.length} tracks to a temporary YouTube playlist!`);
    setIsOpen(false);
  };

  const handleExportSpotifyText = () => {
    const textList = tracks.map(t => `${t.title} - ${t.artist}`).join('\n');
    navigator.clipboard.writeText(textList);
    toast.success('Track list copied to clipboard! You can paste this in Spotify or TuneMyMusic to create a playlist.');
    setIsOpen(false);
  };

  return (
    <div className="relative inline-block" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={
          className || (variant === 'button'
            ? "flex items-center justify-center gap-2 px-3.5 lg:px-4 py-3 md:py-3.5 rounded-xl bg-[#0A0805] border border-zinc-800 text-vermillion hover:text-white hover:border-vermillion/50 hover:bg-vermillion/20 font-black text-[11px] uppercase tracking-widest cursor-pointer transition-all"
            : "p-2 rounded-lg bg-zinc-900/60 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-800 transition-colors flex items-center justify-center")
        }
        title="Export Playlist"
      >
        <ListMusic className="w-4 h-4" />
        {variant === 'button' && <span>Export List</span>}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full mb-2 right-0 w-56 bg-[#100C0A] border border-zinc-800 rounded-xl shadow-2xl p-1 z-50 flex flex-col"
          >
            <div className="px-3 py-2 text-[11px] font-black uppercase tracking-wider text-zinc-500 border-b border-zinc-800 mb-1">
              Export {tracks.length} Tracks
            </div>
            
            <button
              onClick={handleExportYouTube}
              className="flex items-center gap-2.5 px-3 py-2.5 text-xs font-bold text-white hover:bg-vermillion/10 hover:text-vermillion rounded-lg transition-colors text-left"
            >
              <Youtube className="w-4 h-4 text-vermillion" /> Watch on YouTube
            </button>
            <button
              onClick={handleExportSpotifyText}
              className="flex items-center gap-2.5 px-3 py-2.5 text-xs font-bold text-white hover:bg-[#1DB954]/10 hover:text-[#1DB954] rounded-lg transition-colors text-left"
              title="Copy text list to clipboard for Spotify import tools"
            >
              <div className="w-4 h-4 rounded-full bg-[#1DB954] flex items-center justify-center text-[#100C0A]">
               <Music className="w-2.5 h-2.5" />
              </div>
              <div className="flex flex-col">
                <span>Copy for Spotify</span>
              </div>
            </button>
            <div className="h-px bg-zinc-800 my-1"></div>
            <button
              onClick={handleExportSpotifyText}
              className="flex items-center gap-2.5 px-3 py-2.5 text-xs font-bold text-white hover:bg-zinc-900 rounded-lg transition-colors text-left"
            >
              <Copy className="w-4 h-4 text-zinc-400" /> Copy Text List
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ExportPlaylistMenu;
