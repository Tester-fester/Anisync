import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Crown, Zap, Shield, Image as ImageIcon, Flame } from '@/utils/icons';

interface SubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpgrade: () => void;
}

export function SubscriptionModal({ isOpen, onClose, onUpgrade }: SubscriptionModalProps) {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        />
        <motion.div 
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative w-full max-w-lg bg-[#0A0805] border border-brand-primary/50 rounded-2xl overflow-hidden shadow-2xl flex flex-col"
        >
          <div className="absolute top-0 right-0 p-4 z-20">
            <button 
              onClick={onClose}
              className="p-2 bg-black/50 hover:bg-white/10 text-zinc-400 hover:text-white rounded-md backdrop-blur-md transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="relative p-8 overflow-y-auto max-h-[85vh]">
            {/* Header */}
            <div className="flex flex-col items-center justify-center text-center space-y-4 mb-8">
              <div className="w-20 h-20 rounded-lg bg-vermillion flex items-center justify-center shadow-lg">
                <Crown className="w-10 h-10 text-white drop-shadow-md" />
              </div>
              <div>
                <h2 className="text-3xl font-black font-mono text-white tracking-widest uppercase">
                  Anisync <span className="text-vermillion font-display">Pro</span>
                </h2>
                <p className="text-zinc-400 text-sm mt-3 leading-relaxed max-w-xs mx-auto">
                  Unlock the definitive anime music indexing experience and support the platform.
                </p>
              </div>
            </div>

            {/* Features */}
            <div className="space-y-4 mb-8">
              <div className="flex items-start gap-4 p-4 rounded-xl bg-white/5 border border-white/10">
                <div className="w-10 h-10 rounded-lg bg-brand-secondary/20 flex items-center justify-center shrink-0">
                  <ImageIcon className="w-5 h-5 text-brand-secondary" />
                </div>
                <div>
                  <h3 className="text-white font-black font-mono text-xs tracking-widest uppercase mb-1">Animated Customization</h3>
                  <p className="text-zinc-400 text-xs leading-relaxed">
                    Set high-quality, animated GIFs as your Profile Picture and Profile Banner to stand out in the Leaderboards.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4 p-4 rounded-xl bg-white/5 border border-white/10">
                <div className="w-10 h-10 rounded-lg bg-gold/20 flex items-center justify-center shrink-0">
                  <Crown className="w-5 h-5 text-gold-bright" />
                </div>
                <div>
                  <h3 className="text-white font-black font-mono text-xs tracking-widest uppercase mb-1">Exclusive Pokedex Glow</h3>
                  <p className="text-zinc-400 text-xs leading-relaxed">
                    Gain a celestial golden aura on your unlocked anime pokedex collectibles, showing off your encyclopedic knowledge with a crown.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4 p-4 rounded-xl bg-white/5 border border-white/10">
                <div className="w-10 h-10 rounded-lg bg-vermillion/20 flex items-center justify-center shrink-0">
                  <Zap className="w-5 h-5 text-vermillion" />
                </div>
                <div>
                  <h3 className="text-white font-black font-mono text-xs tracking-widest uppercase mb-1">100% Ad-Free Experience</h3>
                  <p className="text-zinc-400 text-xs leading-relaxed">
                    No sponsored banners. Zero interruptions. Just pure anime music discovery and tracking.
                  </p>
                </div>
              </div>
            </div>

            {/* Pricing / CTA */}
            <div className="p-6 bg-vermillion-tint/10 border border-brand-primary/30 rounded-lg flex flex-col items-center">
              <div className="flex items-baseline gap-1 mb-4">
                <span className="text-xl font-bold text-zinc-500">$</span>
                <span className="text-5xl font-black text-white tracking-tighter">4.99</span>
                <span className="text-sm font-medium text-zinc-400">/mo</span>
              </div>
              
              <button 
                onClick={onUpgrade}
                className="w-full py-4 bg-vermillion hover:bg-vermillion-hover text-black font-mono font-black text-sm uppercase tracking-[0.2em] rounded-md transition-all shadow-lg hover:shadow-xl active:translate-y-0"
              >
                Upgrade to Pro
              </button>
              <p className="text-[11px] uppercase tracking-widest text-zinc-500 mt-4 text-center">
                Cancel anytime. Billed monthly.
              </p>
            </div>
            
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
