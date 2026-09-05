import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Star, Crown } from '@/utils/icons';
import confetti from 'canvas-confetti';
import { AnimeTrack } from '../types';

interface TrophyRevealProps {
  track?: AnimeTrack;
}

export function TrophyReveal({ track }: TrophyRevealProps) {
  const [stage, setStage] = useState<'build' | 'popOut' | 'show2D'>('build');

  useEffect(() => {
    // 0 -> 0.5s: spawn in
    const t1 = setTimeout(() => {
      setStage('popOut');
      const duration = 3000;
      const end = Date.now() + duration;

      const frame = () => {
        confetti({
          particleCount: 7,
          angle: 60,
          spread: 55,
          origin: { x: 0 },
          colors: ['#FFD34D', '#FFB800', '#FF8A3D']
        });
        confetti({
          particleCount: 7,
          angle: 120,
          spread: 55,
          origin: { x: 1 },
          colors: ['#FFD34D', '#FFB800', '#FF8A3D']
        });

        if (Date.now() < end) {
          requestAnimationFrame(frame);
        }
      };
      frame();
    }, 500);

    // Hold awesome pop out for a while, then settle to 2D
    const t2 = setTimeout(() => setStage('show2D'), 3000);

    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  const imageUrl = track?.customImageUrl || (track?.youtubeId ? `https://img.youtube.com/vi/${track.youtubeId}/mqdefault.jpg` : '');

  return (
    <div className="relative w-full h-80 md:h-96 flex justify-center items-center overflow-visible mb-8 z-50">
      
      {/* Background glow effects */}
      <motion.div 
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ 
           opacity: stage === 'show2D' ? 0.3 : [0.2, 0.8, 0.5, 0.8], 
           scale: stage === 'show2D' ? 1 : [0.8, 1.2, 1, 1.1] 
        }}
        transition={{ duration: 3, repeat: stage === 'show2D' ? 0 : Infinity }}
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-gold/30 via-burnt/5 to-transparent blur-2xl z-0 pointer-events-none"
      />

      {/* Screen-bursting light rays */}
      <AnimatePresence>
        {stage !== 'show2D' && (
          <motion.div
            initial={{ opacity: 0, scale: 0 }}
            animate={{ 
              opacity: [0, 1, 0.8], 
              scale: [0, 2, 1.5],
              rotate: 180
            }}
            exit={{ opacity: 0, scale: 0, transition: { duration: 0.5 } }}
            transition={{ duration: 2.5, ease: "easeOut" }}
            className="absolute inset-0 z-0 pointer-events-none flex justify-center items-center"
          >
            <div className="w-[1000px] h-[1000px] bg-[conic-gradient(from_0deg,_transparent_0deg,_rgba(255, 138, 61,0.2)_10deg,_transparent_20deg,_rgba(255, 211, 77,0.2)_30deg,_transparent_40deg,_rgba(255, 138, 61,0.2)_50deg,_transparent_60deg)] animate-[spin_12s_linear_infinite] mix-blend-screen opacity-40 blur-sm" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pop Out Stage: High-impact spinning vinyl record with floating golden crown */}
      <AnimatePresence>
        {stage === 'popOut' && (
          <motion.div
            key="pop-vinyl"
            initial={{ scale: 0, opacity: 0, y: 100 }}
            animate={{ scale: 1.2, opacity: 1, y: 0 }}
            exit={{ scale: 3, opacity: 0, filter: "blur(20px)" }}
            transition={{ type: "spring", stiffness: 100, damping: 10 }}
            className="absolute z-20 flex flex-col items-center"
          >
            {/* Centered straight Floating Crown above track circle */}
            <motion.div
              animate={{ y: [0, -12, 0], rotate: 0 }}
              transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
              className="absolute -top-20 z-30 filter drop-shadow-[0_5px_15px_rgba(255, 138, 61,0.8)]"
            >
              <Crown className="w-24 h-24 text-gold-bright fill-gold stroke-[1.5]" />
            </motion.div>

            {/* Glowing Vinyl Track Circle */}
            <div className="w-44 h-44 md:w-52 md:h-52 rounded-full bg-gradient-to-br from-gold via-gold-bright to-burnt p-[4px] shadow-[0_0_80px_rgba(255, 138, 61,0.7)] relative group">
              <div className="w-full h-full bg-neutral-950 rounded-full flex items-center justify-center relative overflow-hidden ring-4 ring-black ring-inset">
                
                {/* Shiny gloss overlay */}
                <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/10 to-transparent -translate-x-full group-hover:animate-[shimmer_2.5s_infinite]" />
                
                {/* Decorative vinyl record groove lines */}
                <div className="absolute inset-2 border-2 border-zinc-900/60 rounded-full opacity-70" />
                <div className="absolute inset-4 border border-zinc-900/50 rounded-full opacity-60" />
                <div className="absolute inset-6 border-2 border-zinc-900/40 rounded-full opacity-55" />
                <div className="absolute inset-8 border border-zinc-950 rounded-full opacity-50" />
                
                {/* Center label with Track Cover Photo */}
                <div className="w-24 h-24 md:w-30 md:h-30 rounded-full border-[3px] border-gold-bright/80 overflow-hidden relative z-10 shadow-lg bg-zinc-900 flex items-center justify-center animate-[spin_8s_linear_infinite]">
                  {imageUrl ? (
                    <img 
                      src={imageUrl} 
                      alt="" 
                      className="w-full h-full object-cover rounded-full" 
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-full h-full bg-[#0a0f1d] flex items-center justify-center text-center text-[11px] uppercase font-mono font-black text-gold-bright tracking-widest p-2">
                      Track Champion
                    </div>
                  )}
                  {/* Record center spindle hole */}
                  <div className="absolute w-3 h-3 bg-zinc-950 rounded-full border-2 border-gold-bright z-20 shadow-inner" />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 2D Final Settled State */}
      <AnimatePresence>
        {stage === 'show2D' && (
          <motion.div
            key="2d-vinyl"
            initial={{ scale: 3, opacity: 0, rotateY: 720, filter: "blur(20px)" }}
            animate={{ scale: 1, opacity: 1, rotateY: 0, filter: "blur(0px)" }}
            transition={{ type: "spring", stiffness: 150, damping: 15 }}
            className="absolute z-30 flex flex-col items-center"
          >
            {/* Centered straight Floating Crown */}
            <motion.div
              animate={{ y: [0, -8, 0], rotate: 0 }}
              transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
              className="absolute -top-16 z-30 filter drop-shadow-[0_4px_10px_rgba(255, 138, 61,0.6)]"
            >
              <Crown className="w-20 h-20 text-gold-bright fill-gold stroke-[1.5]" />
            </motion.div>

            {/* Glowing Vinyl Track Circle */}
            <div className="w-32 h-32 md:w-40 md:h-40 rounded-full bg-gradient-to-br from-gold via-gold-bright to-burnt p-[3px] shadow-[0_0_50px_rgba(255, 138, 61,0.5)] relative group">
              <div className="w-full h-full bg-neutral-950 rounded-full flex items-center justify-center relative overflow-hidden ring-2 ring-black ring-inset">
                
                {/* Shiny reflection */}
                <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/10 to-transparent -translate-x-full group-hover:animate-[shimmer_2.5s_infinite]" />
                
                {/* Vinyl record grooves */}
                <div className="absolute inset-1.5 border-2 border-zinc-900/60 rounded-full opacity-60" />
                <div className="absolute inset-3 border border-zinc-900/50 rounded-full opacity-50" />
                <div className="absolute inset-5 border-2 border-zinc-900/45 rounded-full opacity-45" />
                <div className="absolute inset-7 border border-zinc-950 rounded-full opacity-40" />

                {/* Center label with Track Cover */}
                <div className="w-18 h-18 md:w-24 md:h-24 rounded-full border-[2.5px] border-gold-bright/80 overflow-hidden relative z-10 shadow-md bg-zinc-900 flex items-center justify-center animate-[spin_12s_linear_infinite]">
                  {imageUrl ? (
                    <img 
                      src={imageUrl} 
                      alt="" 
                      className="w-full h-full object-cover rounded-full" 
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-full h-full bg-[#0a0f1d] flex items-center justify-center text-center text-[11px] uppercase font-mono font-black text-gold-bright tracking-wider">
                      CHAMP
                    </div>
                  )}
                  {/* Record spindle center hole */}
                  <div className="absolute w-2.5 h-2.5 bg-zinc-950 rounded-full border-[1.5px] border-gold-bright z-20 shadow-inner" />
                </div>
              </div>
            </div>
            
            {/* Dynamic visual impact ripples for 2D landing completion */}
            <motion.div 
               initial={{ scale: 0.5, opacity: 1 }}
               animate={{ scale: 2.2, opacity: 0 }}
               transition={{ duration: 1.2, ease: "easeOut" }}
               className="absolute inset-0 rounded-full border-4 border-gold-bright/60 pointer-events-none"
            />
            <motion.div 
               initial={{ scale: 0.5, opacity: 1 }}
               animate={{ scale: 3.2, opacity: 0 }}
               transition={{ duration: 1.6, delay: 0.1, ease: "easeOut" }}
               className="absolute inset-0 rounded-full border-2 border-gold-bright/40 pointer-events-none"
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Screen-bursting star explosion at very beginning */}
      <AnimatePresence>
        {stage === 'build' || stage === 'popOut' ? (
          <>
            {[...Array(24)].map((_, i) => (
              <motion.div
                key={i}
                initial={{ x: 0, y: 0, opacity: 0, scale: 0 }}
                animate={{ 
                  x: (Math.random() - 0.5) * 800, 
                  y: (Math.random() - 0.5) * 850,
                  opacity: [0, 1, 0],
                  scale: [0, Math.random() * 2.5 + 1, 0],
                  rotate: [0, 720]
                }}
                transition={{ duration: 2.8, delay: Math.random() * 0.15, ease: "easeOut" }}
                className="absolute z-40 text-gold-bright pointer-events-none"
                style={{ left: '50%', top: '50%' }}
              >
                <Star className="w-5 h-5 fill-current opacity-85 drop-shadow-[0_0_10px_rgba(255, 138, 61,0.8)]" />
              </motion.div>
            ))}
          </>
        ) : null}
      </AnimatePresence>

    </div>
  );
}
