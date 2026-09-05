/**
 * ShareCard — visual shareable card for tracks and champions.
 * Renders a premium card with track art, ELO, anime name, and branding.
 * Can be exported to PNG via html-to-image.
 */

import React, { useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import { Download, Share2, Tv, Music, X } from '@/utils/icons';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';

interface ShareCardProps {
  track: {
    title: string;
    artist: string;
    animeName: string;
    elo: number;
    youtubeId?: string;
    customImageUrl?: string;
    type?: string;
  };
  isOpen: boolean;
  onClose: () => void;
  title?: string; // e.g., "CHAMPION" or "TOP RATED"
  accentColor?: string; // hex color for accents
}

export function ShareCard({ track, isOpen, onClose, title = 'TOP RATED', accentColor = '#FF3D2E' }: ShareCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);

  const coverUrl = track.customImageUrl
    || (track.youtubeId ? `https://img.youtube.com/vi/${track.youtubeId}/maxresdefault.jpg` : '');

  const handleDownload = async () => {
    if (!cardRef.current) return;
    setExporting(true);
    try {
      const dataUrl = await toPng(cardRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: '#100C0A',
      });
      const link = document.createElement('a');
      link.download = `anisync-${track.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.png`;
      link.href = dataUrl;
      link.click();
      toast.success('Share card downloaded!');
    } catch (err: any) {
      toast.error('Failed to generate image: ' + err.message);
    } finally {
      setExporting(false);
    }
  };

  const handleShare = async () => {
    if (!cardRef.current) return;
    setExporting(true);
    try {
      const dataUrl = await toPng(cardRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: '#100C0A',
      });
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], `anisync-${track.title}.png`, { type: 'image/png' });
      if (navigator.share && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: `ANISYNC — ${track.title}`,
          text: `Check out "${track.title}" by ${track.artist} on ANISYNC!`,
          files: [file],
        });
      } else {
        handleDownload();
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        handleDownload();
      }
    } finally {
      setExporting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className="flex flex-col items-center gap-6"
          >
            {/* The shareable card */}
            <div
              ref={cardRef}
              className="glass-modal relative w-[340px] sm:w-[400px] rounded-3xl overflow-hidden"
              style={{ background: `linear-gradient(135deg, #100C0A 0%, ${accentColor}15 50%, #100C0A 100%)` }}
            >
              {/* Top accent bar */}
              <div className="h-1.5 w-full" style={{ background: `linear-gradient(90deg, ${accentColor}, transparent, ${accentColor})` }} />

              {/* Content */}
              <div className="p-6 space-y-4">
                {/* Title badge */}
                <div className="flex items-center justify-between">
                  <span
                    className="px-2.5 py-1 rounded-md text-[10px] font-mono font-black uppercase tracking-widest border"
                    style={{ backgroundColor: `${accentColor}20`, borderColor: `${accentColor}40`, color: accentColor }}
                  >
                    {title}
                  </span>
                  <span className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">ANISYNC</span>
                </div>

                {/* Cover art */}
                <div className="relative w-full aspect-square rounded-2xl overflow-hidden border border-white/10 shadow-2xl">
                  {coverUrl ? (
                    <img src={coverUrl} alt={track.title} className="w-full h-full object-cover" crossOrigin="anonymous" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-zinc-900">
                      <Music className="w-16 h-16 text-zinc-700" />
                    </div>
                  )}
                  {/* Gradient overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                </div>

                {/* Track info */}
                <div className="space-y-1.5">
                  <h3 className="text-xl font-black text-white uppercase tracking-tight leading-none truncate">
                    {track.title}
                  </h3>
                  <p className="text-sm text-zinc-400 italic truncate">{track.artist}</p>
                  <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 font-mono uppercase tracking-wider">
                    <Tv className="w-3 h-3" style={{ color: accentColor }} />
                    <span className="truncate">{track.animeName}</span>
                  </div>
                </div>

                {/* ELO rating */}
                <div className="flex items-center justify-between pt-3 border-t border-white/5">
                  <span className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">ELO Rating</span>
                  <span className="text-2xl font-black font-mono" style={{ color: accentColor }}>
                    {track.elo}
                  </span>
                </div>
              </div>

              {/* Bottom branding */}
              <div className="px-6 py-3 bg-black/40 flex items-center justify-between">
                <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest">
                  anisync.app
                </span>
                <span className="text-[9px] font-mono text-zinc-700">
                  Anime Theme Ranking Engine
                </span>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-3">
              <button
                onClick={handleDownload}
                disabled={exporting}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-black uppercase tracking-wider transition-all disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                {exporting ? 'Generating...' : 'Download'}
              </button>
              <button
                onClick={handleShare}
                disabled={exporting}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all disabled:opacity-50"
                style={{ backgroundColor: accentColor, color: '#100C0A' }}
              >
                <Share2 className="w-4 h-4" />
                Share
              </button>
              <button
                onClick={onClose}
                className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-400 transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
