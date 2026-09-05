/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Calculates the expected score for player A against player B
 * based on their ELO ratings.
 */
export function getExpectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * Updates Elo ratings for two tracks based on the outcome and an optional voter coefficient (spam scaling).
 * outcome: 'A' if track A wins, 'B' if track B wins, 'draw' if it's a tie.
 * Returns the new ratings.
 */
export function calculateNewRatings(
  ratingA: number,
  ratingB: number,
  outcome: 'A' | 'B' | 'draw',
  kFactor: number = 32,
  voterCoefficient: number = 1.0
): {
  newRatingA: number;
  newRatingB: number;
  changeA: number;
  changeB: number;
} {
  const expectedA = getExpectedScore(ratingA, ratingB);
  const expectedB = getExpectedScore(ratingB, ratingA);

  let scoreA = 0.5;
  let scoreB = 0.5;

  if (outcome === 'A') {
    scoreA = 1;
    scoreB = 0;
  } else if (outcome === 'B') {
    scoreA = 0;
    scoreB = 1;
  }

  // Calculate standard Elo change
  const rawChangeA = kFactor * (scoreA - expectedA);
  const rawChangeB = kFactor * (scoreB - expectedB);

  // Apply voter coefficient to prevent rating inflation from speed-spammers
  const changeA = Math.round(rawChangeA * voterCoefficient);
  const changeB = Math.round(rawChangeB * voterCoefficient);

  // Protect against zero change in decisive matches if Elo values are high, unless voterCoefficient is near zero
  const forceChangeA = outcome === 'draw' ? changeA : (changeA === 0 && voterCoefficient > 0.1 ? (outcome === 'A' ? 1 : -1) : changeA);
  const forceChangeB = outcome === 'draw' ? changeB : (changeB === 0 && voterCoefficient > 0.1 ? (outcome === 'B' ? 1 : -1) : changeB);

  return {
    newRatingA: Math.max(100, Math.round(ratingA + forceChangeA)),
    newRatingB: Math.max(100, Math.round(ratingB + forceChangeB)),
    changeA: forceChangeA,
    changeB: forceChangeB,
  };
}

/**
 * Dynamically computes a voter coefficient based on timestamps of recent votes.
 * This penalizes rapid-fire spam clicks and ensures the ELO database remains pristine.
 */
export function computeVoterCoefficient(timestamps: number[]): {
  coefficient: number;
  avgIntervalSeconds: number;
  purityStatus: 'PERFECT' | 'GOOD' | 'FAST' | 'SPAM';
} {
  if (timestamps.length < 2) {
    return { coefficient: 1.0, avgIntervalSeconds: 99, purityStatus: 'PERFECT' };
  }

  // Calculate gaps between successive clicks (in ms)
  const intervals: number[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    intervals.push(timestamps[i] - timestamps[i - 1]);
  }

  const avgIntervalMs = intervals.reduce((sum, val) => sum + val, 0) / intervals.length;
  const avgIntervalSeconds = avgIntervalMs / 1000;

  let coefficient = 1.0;
  let purityStatus: 'PERFECT' | 'GOOD' | 'FAST' | 'SPAM' = 'PERFECT';

  if (avgIntervalSeconds >= 3.5) {
    coefficient = 1.0;
    purityStatus = 'PERFECT';
  } else if (avgIntervalSeconds >= 2.0) {
    // Scale linear from 0.7 up to 1.0
    const ratio = (avgIntervalSeconds - 2.0) / 1.5;
    coefficient = 0.7 + ratio * 0.3;
    purityStatus = 'GOOD';
  } else if (avgIntervalSeconds >= 1.0) {
    // Scale linear from 0.2 up to 0.7
    const ratio = (avgIntervalSeconds - 1.0) / 1.0;
    coefficient = 0.2 + ratio * 0.5;
    purityStatus = 'FAST';
  } else {
    // Rapid spam clicks (under 1.0s) scale coefficient down near zero
    const ratio = Math.max(0, avgIntervalSeconds) / 1.0;
    coefficient = 0.05 + ratio * 0.15;
    purityStatus = 'SPAM';
  }

  // Round coefficient to 3 decimal places for visual accuracy
  coefficient = Math.max(0.01, Math.min(1.0, parseFloat(coefficient.toFixed(3))));

  return { coefficient, avgIntervalSeconds, purityStatus };
}
