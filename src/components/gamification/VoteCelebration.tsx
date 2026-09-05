import { useEffect, useRef } from 'react';
import confetti from 'canvas-confetti';

// ---------------------------------------------------------------------------
// Winner color themes — based on the winning track's side.
// A = vermillion (left card), B = Japanese indigo (right card), draw = moss.
// Sides are deliberately OPPOSITE hues so viewers can tell them apart at a
// glance — cards, borders, glows and confetti all inherit the side color.
// ---------------------------------------------------------------------------
export const WINNER_COLORS = {
  A: {
    primary: '#FF3D2E',   // vermillion
    secondary: '#D0220F',
    glow: 'rgba(255, 61, 46, 0.6)',
    confetti: ['#FF3D2E', '#D0220F', '#FFD1CC', '#E88A7E', '#FBEAE8'],
  },
  B: {
    primary: '#3FA9F5',   // Japanese indigo (bright)
    secondary: '#1B2E4A',
    glow: 'rgba(63, 169, 245, 0.6)',
    confetti: ['#3FA9F5', '#1B2E4A', '#8FB3DE', '#3B5E8F', '#DCE7F5'],
  },
  draw: {
    primary: '#3DDC84',   // moss
    secondary: '#2BAE68',
    glow: 'rgba(61, 220, 132, 0.6)',
    confetti: ['#3DDC84', '#2BAE68', '#8CA97B', '#B5CBA5', '#EDF3E6'],
  },
} as const;

export type WinnerSide = 'A' | 'B' | 'draw';

interface CelebrationEffect {
  trigger: number;
  winner: WinnerSide;
}

/**
 * Canvas-confetti celebration — fires colored confetti from the winning side.
 * Uses the canvas-confetti library (GPU-accelerated <canvas>) which works
 * identically on all platforms (mobile + desktop, all browsers).
 *
 * 3 layers:
 *   1. Main burst from the winning card's position (80 particles)
 *   2. Side cannon from the screen edge (40 particles, 100ms delay)
 *   3. Center firework with star shapes (50 particles, 250ms delay)
 *
 * Colored by the winner's theme: vermillion for A, indigo for B, moss for draw.
 */
export function VoteCelebration({ trigger, winner }: CelebrationEffect) {
  const lastTrigger = useRef(0);

  useEffect(() => {
    if (trigger === 0 || trigger === lastTrigger.current) return;
    lastTrigger.current = trigger;

    const colors = [...WINNER_COLORS[winner].confetti];
    const isLeftWinner = winner === 'A';
    const isDraw = winner === 'draw';

    // x position: 0 = far left, 0.5 = center, 1 = far right
    const originX = isDraw ? 0.5 : isLeftWinner ? 0.25 : 0.75;

    // --- Layer 1: Main burst from the winning card's position ---
    confetti({
      particleCount: 80,
      spread: 70,
      origin: { x: originX, y: 0.6 },
      colors,
      startVelocity: 45,
      gravity: 0.8,
      ticks: 200,
      scalar: 1.1,
      shapes: ['circle', 'square'],
    });

    // --- Layer 2: Side cannon — shoots confetti across the screen ---
    setTimeout(() => {
      confetti({
        particleCount: 40,
        angle: isLeftWinner ? 60 : 120,
        spread: 55,
        origin: { x: isLeftWinner ? 0 : 1, y: 0.7 },
        colors,
        startVelocity: 60,
        gravity: 0.5,
        ticks: 250,
        scalar: 0.9,
      });
    }, 100);

    // --- Layer 3: Center firework — a second burst for extra impact ---
    if (!isDraw) {
      setTimeout(() => {
        confetti({
          particleCount: 50,
          spread: 100,
          startVelocity: 35,
          origin: { x: 0.5, y: 0.5 },
          colors,
          gravity: 0.6,
          ticks: 180,
          scalar: 1.2,
          shapes: ['star', 'circle'],
        });
      }, 250);
    }
  }, [trigger, winner]);

  // No DOM elements — canvas-confetti creates its own canvas overlay.
  // This prevents any "radar" / shockwave / flash visual artifacts.
  return null;
}

