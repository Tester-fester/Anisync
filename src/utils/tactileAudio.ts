/**
 * Tactile UI sound — thin wrapper around the shared SfxEngine in howlerAudio.ts.
 *
 * Why a wrapper instead of a separate engine? The old design had TWO competing
 * Web Audio contexts (Howler's + a separate one here), each with its own master
 * gain, reverb, and compressor. Layered sounds from both engines summed and
 * clipped unpredictably. Now we route everything through one master bus.
 *
 * The 5 tactile types map to engine events:
 *   primary  → 'click'   (tactile mechanical thock)
 *   success  → 'success' (ascending C major arpeggio)
 *   rose     → 'vote'    (ascending perfect-fifth reward)
 *   zinc     → 'tab'     (pure filtered noise switch)
 *   generic  → 'click'   (same as primary, with ±3% pitch jitter)
 */

import { sfx, initAudio } from './howlerAudio';

let lastSoundPlayedAt = 0;

export function playTactileSound(type: 'primary' | 'success' | 'rose' | 'zinc' | 'generic' = 'generic') {
  initAudio(); // ensure ctx is created on first user gesture

  // 80ms coalescence — filter duplicate click cascades from touch+mouse events
  const nowMs = Date.now();
  if (nowMs - lastSoundPlayedAt < 80) return;
  lastSoundPlayedAt = nowMs;

  switch (type) {
    case 'primary':
      sfx.play('click');
      break;
    case 'success':
      sfx.play('success');
      break;
    case 'rose':
      sfx.play('vote');
      break;
    case 'zinc':
      sfx.play('tab');
      break;
    case 'generic':
    default:
      sfx.play('click'); // engine adds ±3% pitch jitter so this doesn't get repetitive
      break;
  }
}

export function playLevelUpFanfare() {
  initAudio();
  sfx.play('champion');
}

/**
 * Global event listener — attaches to mousedown/touchstart and plays a soft
 * click on any button or cursor-pointer element.
 */
export function initTactileAudioGlobal() {
  if (typeof window === 'undefined') return;

  const handleInteraction = (e: Event) => {
    let target = e.target as HTMLElement | null;

    while (target && target !== document.body) {
      const classList = target.className || '';
      const isStringClass = typeof classList === 'string';

      if (isStringClass && classList.includes('btn-tactile-primary')) {
        playTactileSound('primary');
        return;
      }
      if (isStringClass && classList.includes('btn-tactile-success')) {
        playTactileSound('success');
        return;
      }
      if (isStringClass && classList.includes('btn-tactile-rose')) {
        playTactileSound('rose');
        return;
      }
      if (isStringClass && classList.includes('btn-tactile-zinc')) {
        playTactileSound('zinc');
        return;
      }

      if (target.tagName === 'BUTTON' || (isStringClass && classList.includes('cursor-pointer'))) {
        playTactileSound('generic');
        return;
      }

      target = target.parentElement;
    }
  };

  window.addEventListener('mousedown', handleInteraction, { capture: true, passive: true });
  window.addEventListener('touchstart', handleInteraction, { capture: true, passive: true });
}

/**
 * ELO counter tick — rapid ascending bleeps during ELO number animation.
 * Routes to the engine's 'elo' event which uses round-robin chromatic climb
 * (each tick is +1 semitone, wraps after 12). Far less fatiguing than a
 * static-frequency tick.
 */
export function playEloCounterTick(isUp: boolean, progress: number) {
  initAudio();
  if (!isUp) return; // descending ticks sound bad — skip
  sfx.play('elo');
}
