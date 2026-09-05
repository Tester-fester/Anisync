/**
 * Ambient particles component — floating music notes / sparkles.
 * Uses @tsparticles/react v4 (slim build).
 * Renders behind the arena + champion screen for atmosphere.
 */

import { useMemo, useEffect, useState } from 'react';
import Particles from '@tsparticles/react';
import { loadSlim } from '@tsparticles/slim';
import type { ISourceOptions } from '@tsparticles/engine';
import type { Engine } from '@tsparticles/engine';

let enginePromise: Promise<void> | null = null;

async function initEngine(engine: Engine) {
  await loadSlim(engine);
}

export function AmbientParticles({ variant = 'arena' }: { variant?: 'arena' | 'champion' }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!enginePromise) {
      enginePromise = import('@tsparticles/react').then(async ({ default: Particles }) => {
        // The v4 API auto-initializes on first render, but we need to load the slim preset
        const engine = (Particles as any).__engine;
        if (engine) {
          await loadSlim(engine);
        }
      });
    }
    enginePromise.then(() => setReady(true));
  }, []);

  const options = useMemo<ISourceOptions>(() => {
    if (variant === 'champion') {
      return {
        fpsLimit: 60,
        detectRetina: true,
        background: { color: 'transparent' },
        particles: {
          number: { value: 30, density: { enable: true } },
          color: { value: ['#FFD34D', '#FF8A3D', '#FBF3DC', '#fde68a'] },
          shape: { type: 'star' },
          opacity: {
            value: { min: 0.1, max: 0.6 },
            animation: { enable: true, speed: 0.5, sync: false },
          },
          size: { value: { min: 1, max: 4 } },
          move: {
            enable: true,
            speed: { min: 0.3, max: 1.2 },
            direction: 'top',
            random: true,
            outModes: { default: 'out' },
          },
        },
      };
    }
    // Arena variant — cyan + rose floating dots
    return {
      fpsLimit: 60,
      detectRetina: true,
      background: { color: 'transparent' },
      particles: {
        number: { value: 20, density: { enable: true } },
        color: { value: ['#FF3D2E', '#C81E55', '#3DDC84'] },
        shape: { type: 'circle' },
        opacity: {
          value: { min: 0.05, max: 0.3 },
          animation: { enable: true, speed: 0.3, sync: false },
        },
        size: { value: { min: 1, max: 3 } },
        move: {
          enable: true,
          speed: { min: 0.2, max: 0.6 },
          direction: 'none',
          random: true,
          outModes: { default: 'out' },
        },
        links: {
          enable: true,
          distance: 120,
          color: '#FF3D2E',
          opacity: 0.05,
          width: 1,
        },
      },
    };
  }, [variant]);

  if (!ready) return null;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
      <Particles id={`ambient-${variant}`} options={options} className="w-full h-full" />
    </div>
  );
}
