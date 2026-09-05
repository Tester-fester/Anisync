import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Play, Trophy, Music, UserPlus, Flame, MoveRight, CheckCircle2,
  Swords, Sparkles, Calendar, Link2, X
} from '@/utils/icons';
import { AnisyncLogo } from './AnisyncLogo';
import { safeSetJSON, safeGetJSON } from '../utils/safeLocalStorage';

export const WelcomeOnboarding: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    // NOTE: previously this hook exposed `window.__controlOnboarding = { setIsOpen, setStep }`
    // — a debug control that leaked into production. Removed; if you need to
    // re-trigger onboarding during dev, run `localStorage.removeItem('anisync_onboarding_complete')`
    // and reload, or use React DevTools to set state directly.

    // Auto-open for first-time users after a short delay so it doesn't fight
    // with the initial page paint. "Maybe later" postpones for 24h instead of
    // dismissing forever.
    const hasSeen = safeGetJSON<string | null>('anisync_onboarding_complete', null);
    const snoozedUntil = safeGetJSON<number>('anisync_onboarding_snooze_until', 0);
    const now = Date.now();
    if (!hasSeen && now > snoozedUntil) {
      const timer = setTimeout(() => setIsOpen(true), 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  const completeOnboarding = () => {
    safeSetJSON('anisync_onboarding_complete', 'true');
    setIsOpen(false);
  };

  const snoozeOnboarding = () => {
    // Snooze for 24 hours — gentler than "Skip" which dismissed forever.
    safeSetJSON('anisync_onboarding_snooze_until', Date.now() + 24 * 60 * 60 * 1000);
    setIsOpen(false);
  };

  const nextStep = () => {
    if (step < steps.length - 1) {
      setStep(prev => prev + 1);
    } else {
      completeOnboarding();
    }
  };

  const steps = [
    {
      title: "Welcome to ANISYNC",
      subtitle: "Vote. Rank. Discover.",
      icon: <AnisyncLogo className="w-16 h-16 text-brand-primary" />,
      content: "Vote in 1v1 anime-music battles and your votes reshape the global Elo leaderboard in real time. Find your next favorite opening, ending, or OST — and prove which tracks deserve the crown.",
      color: "from-brand-primary/20",
      accent: "text-brand-primary"
    },
    {
      title: "How Elo Works",
      subtitle: "Every vote shifts the rankings.",
      icon: <Sparkles className="w-16 h-16 text-gold-bright" />,
      content: "Each track starts at 1200 Elo. When you vote, the winner gains points and the loser loses points — bigger upsets mean bigger swings. Beat a top seed as an underdog and you'll see a massive jump. Your votes are weighted by your voting cadence (steady voters carry more weight than spammers).",
      color: "from-gold-bright/20",
      accent: "text-gold-bright"
    },
    {
      title: "The Arena",
      subtitle: "Pick a winner. Repeat.",
      icon: <Swords className="w-16 h-16 text-vermillion" />,
      content: "Two tracks, one click. Listen to both sides, then vote for the one that hits harder. Use blind mode to judge purely on sound — no anime bias. Your vote is logged instantly and the next matchup loads automatically.",
      color: "from-vermillion/20",
      accent: "text-vermillion"
    },
    {
      title: "Clash of the Day",
      subtitle: "A daily featured matchup.",
      icon: <Calendar className="w-16 h-16 text-gold" />,
      content: "Every day we feature one curated battle between two top-rated tracks. Vote once per day to earn a streak badge. Miss a day and your streak resets — so come back daily to climb the streak leaderboard.",
      color: "from-gold/20",
      accent: "text-gold"
    },
    {
      title: "Championships",
      subtitle: "Build your own bracket.",
      icon: <Trophy className="w-16 h-16 text-gold" />,
      content: "Create custom 4, 8, or 16-track tournaments and watch them battle down to a champion. Invite friends to vote in real time, or play offline to find your personal favorite from any anime franchise.",
      color: "from-gold/20",
      accent: "text-gold"
    },
    {
      title: "Your Profile",
      subtitle: "Badges, streaks, and stats.",
      icon: <UserPlus className="w-16 h-16 text-vermillion-tint" />,
      content: "Sign in with Google to track your favorites, earn voting badges, build custom playlists, and unlock a Spotify-Wrapped-style taste profile. Connect your MyAnimeList account to sync your anime watch history.",
      color: "from-vermillion-tint/20",
      accent: "text-vermillion-tint"
    },
    {
      title: "Ready to rank?",
      subtitle: "Let's go.",
      icon: <Flame className="w-16 h-16 text-brand-primary" />,
      content: "Start with the Arena to cast your first vote, browse the Leaderboard to see who's on top, or jump into Clash of the Day for your daily streak. The leaderboard updates live as you and thousands of other fans vote.",
      color: "from-brand-primary/20",
      accent: "text-brand-primary"
    }
  ];

  // Escape key closes (snoozes) the onboarding.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') snoozeOnboarding();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="onboarding-title"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            onClick={snoozeOnboarding}
          />

          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: -20 }}
            className={`relative w-full max-w-lg bg-[#0e1722] border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden`}
          >
            {/* Background effects */}
            <div className={`absolute top-0 left-0 right-0 h-64 bg-gradient-to-b ${steps[step].color} to-transparent opacity-50 transition-colors duration-500`} />

            {/* Close button — thumb-friendly × icon, top-right corner */}
            <button
              onClick={snoozeOnboarding}
              aria-label="Close onboarding"
              className="absolute top-4 right-4 z-10 w-9 h-9 flex items-center justify-center rounded-lg bg-black/40 border border-white/10 text-zinc-400 hover:text-white hover:bg-black/60 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
              <span className="sr-only">Close</span>
            </button>

            <div className="relative p-8 md:p-10 flex flex-col items-center text-center">
              <motion.div
                key={`icon-${step}`}
                initial={{ scale: 0.5, opacity: 0, rotate: -20 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                transition={{ type: "spring", damping: 15 }}
                className="mb-8 p-4 rounded-3xl bg-white/5 border border-white/10 backdrop-blur-md shadow-xl"
              >
                {steps[step].icon}
              </motion.div>

              <motion.h2
                id="onboarding-title"
                key={`title-${step}`}
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="text-2xl md:text-3xl font-display font-black text-white uppercase tracking-tight mb-2"
              >
                {steps[step].title}
              </motion.h2>

              <motion.p
                key={`subtitle-${step}`}
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.1 }}
                className={`text-sm md:text-base font-mono uppercase tracking-widest ${steps[step].accent} font-bold mb-6`}
              >
                {steps[step].subtitle}
              </motion.p>

              <motion.p
                key={`content-${step}`}
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="text-zinc-400 text-sm md:text-base leading-relaxed mb-10 min-h-[5rem]"
              >
                {steps[step].content}
              </motion.p>

              <div className="flex items-center justify-between w-full">
                <div className="flex gap-2">
                  {steps.map((_, i) => (
                    <div
                      key={i}
                      className={`h-1.5 rounded-full transition-all duration-300 ${i === step ? 'w-8 bg-brand-primary' : 'w-2 bg-zinc-800'}`}
                    />
                  ))}
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={snoozeOnboarding}
                    className="px-4 py-2 text-xs font-mono text-zinc-500 hover:text-white uppercase tracking-wider transition-colors"
                  >
                    Maybe later
                  </button>
                  <button
                    onClick={nextStep}
                    className="flex items-center gap-2 bg-brand-primary text-black px-6 py-2 rounded-lg font-bold hover:bg-brand-primary-hover transition-all hover:-translate-y-0.5 hover:shadow-md"
                  >
                    {step === steps.length - 1 ? (
                      <>Get Started <CheckCircle2 className="w-4 h-4" /></>
                    ) : (
                      <>Next <MoveRight className="w-4 h-4" /></>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
