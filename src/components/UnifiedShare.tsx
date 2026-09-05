import React, { useState, useRef, useEffect } from 'react';
import { Share2, Twitter, Link as LinkIcon, Smartphone } from '@/utils/icons';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';

interface UnifiedShareProps {
  title: string;
  text: string;
  url?: string;
  variant?: 'button' | 'icon';
  className?: string;
}

export const UnifiedShare: React.FC<UnifiedShareProps> = ({ title, text, url, variant = 'button', className = '' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  
  const shareUrl = url || window.location.origin;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title,
          text,
          url: shareUrl
        });
        setIsOpen(false);
      } catch (err) {
        console.error("Native share cancelled or failed", err);
      }
    } else {
      toast.error('Sharing is not supported here — copy the link instead.');
    }
  };

  const handleTwitterShare = () => {
    const tweetText = `${text}\n\n${shareUrl}\n#ANISYNC #AnimeMusic`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`, '_blank', 'noopener,noreferrer');
    setIsOpen(false);
  };

  const handleRedditShare = () => {
    const redditUrl = `https://www.reddit.com/submit?url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(text)}`;
    window.open(redditUrl, '_blank', 'noopener,noreferrer');
    setIsOpen(false);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(`${text}\n${shareUrl}`);
    toast.success('Link & text copied to clipboard!');
    setIsOpen(false);
  };

  return (
    <div className="relative inline-block" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={
          className || (variant === 'button'
            ? "px-6 py-3 rounded-xl border border-indigo-ink/50 text-gold-bright hover:text-white bg-indigo-ink/10 hover:bg-indigo-ink/30 text-xs font-black uppercase tracking-wider cursor-pointer transition-all flex items-center gap-2 shadow-[0_0_15px_rgba(27, 46, 74,0.15)] glow-blue-lg scale-[0.98]"
            : "p-2 rounded-full bg-zinc-900/60 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-800 transition-colors")
        }
        title="Share"
      >
        <Share2 className={variant === 'button' ? "w-4 h-4" : "w-4 h-4"} />
        {variant === 'button' && <span>Share</span>}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full mb-2 right-0 md:left-0 md:right-auto w-48 bg-[#100C0A] border border-zinc-800 rounded-xl shadow-2xl p-1 z-50 flex flex-col"
          >
            {typeof navigator !== 'undefined' && navigator.share && (
              <button
                onClick={handleNativeShare}
                className="flex items-center gap-2.5 px-3 py-2.5 text-xs font-bold text-white hover:bg-zinc-900 rounded-lg transition-colors text-left"
              >
                <Smartphone className="w-4 h-4 text-zinc-400" /> Native Share
              </button>
            )}
            <button
              onClick={handleTwitterShare}
              className="flex items-center gap-2.5 px-3 py-2.5 text-xs font-bold text-white hover:bg-[#1DA1F2]/20 hover:text-[#1DA1F2] rounded-lg transition-colors text-left"
            >
              <Twitter className="w-4 h-4 text-[#1DA1F2]" /> Share to X (Twitter)
            </button>
            <button
              onClick={handleRedditShare}
              className="flex items-center gap-2.5 px-3 py-2.5 text-xs font-bold text-white hover:bg-[#FF4500]/20 hover:text-[#FF4500] rounded-lg transition-colors text-left"
            >
              <div className="w-4 h-4 rounded-full bg-[#FF4500] flex items-center justify-center text-[#100C0A]">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3"><path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.56 12 8 12.56 8 13.25c0 .69.56 1.25 1.25 1.25.69 0 1.25-.56 1.25-1.25 0-.69-.56-1.25-1.25-1.25zm5.5 0c-.69 0-1.25.56-1.25 1.25 0 .69.56 1.25 1.25 1.25.69 0 1.25-.56 1.25-1.25 0-.69-.56-1.25-1.25-1.25zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"/></svg>
              </div>
              Share to Reddit
            </button>
            <div className="h-px bg-zinc-800 my-1"></div>
            <button
              onClick={handleCopyLink}
              className="flex items-center gap-2.5 px-3 py-2.5 text-xs font-bold text-white hover:bg-zinc-900 rounded-lg transition-colors text-left"
            >
              <LinkIcon className="w-4 h-4 text-zinc-400" /> Copy Link
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default UnifiedShare;
